import { ENGAGEMENT_VARIANTS, getCaptureProductionMultiplier, getTerritoryDefenseMultiplier, getTerritoryProductionMultiplier, getTerritoryArmySpeedMultiplier, type EngagementVariant, type GameState } from '@crown-clash/game-core';
import { LAB_MAIN_MATCHES_PER_PARTICIPANT, LAB_NAMES, labReport, nextPilotIndex, pilotOrder, successfulMainTrials, type GameplayLabController, type GameplayLabStore, type LabRatings, type LabReplayOffer } from './GameplayLabController.js';
const styles = `
.gameplay-lab{position:fixed;inset:0;z-index:1000;color:#eef4ff;font-family:'Baloo 2',sans-serif;box-sizing:border-box;pointer-events:none}
.gameplay-lab *{box-sizing:border-box}.lab-screen{pointer-events:auto;height:100%;overflow:auto;background:radial-gradient(ellipse at top,#1b3153,#080e1b 65%);padding:24px 18px;display:flex;align-items:flex-start;justify-content:center}
.lab-card{margin:auto;width:min(100%,420px);border:1px solid #375079;border-radius:24px;padding:24px;background:#101b2ef2;box-shadow:0 16px 60px #0008}
.lab-eyebrow{color:#79b4ff;letter-spacing:2px;font-size:12px}.lab-card h1{font-size:28px;margin:8px 0}.lab-card p{color:#b4c5df;font-size:15px;line-height:1.5;margin:8px 0 18px}
.gameplay-lab button,.gameplay-lab select{font:inherit;min-height:46px;border-radius:12px;border:1px solid #415b85;background:#192b47;color:#edf5ff;padding:10px 14px;cursor:pointer;width:100%;margin:5px 0}
.gameplay-lab button:hover{background:#264774}.gameplay-lab button.primary{background:#386de1;border-color:#74a2ff;font-weight:800}.gameplay-lab button:focus-visible,.gameplay-lab select:focus-visible{outline:3px solid #f6c85c;outline-offset:2px}
.gameplay-lab textarea{font:inherit;width:100%;min-height:80px;background:#192b47;color:#edf5ff;border:1px solid #415b85;border-radius:12px;padding:10px}.gameplay-lab button:disabled{opacity:.45;cursor:default}.lab-inspector{pointer-events:auto;position:absolute;bottom:12px;left:12px;right:12px;background:#0b1425ed;border:1px solid #415b85;border-radius:14px;padding:10px;font-size:13px}.lab-inspector p{margin:0;white-space:pre-line}.lab-row{display:flex;gap:8px}.lab-row>*{flex:1}.lab-note{color:#9db2d1;font-size:13px;margin:8px 0}.lab-status{color:#f6c85c;font-size:13px;min-height:20px}
.lab-hud{display:flex;align-items:center;gap:10px;background:#0b1425ed;border-bottom:1px solid #375079;padding:8px 12px;height:70px}.lab-hud strong{flex:1;font-size:15px}.lab-hud button{width:auto;margin:0;min-width:70px}.lab-clock{font-family:'JetBrains Mono',monospace;color:#f6c85c;font-size:17px}
.lab-hint{position:absolute;bottom:12px;left:12px;right:12px;text-align:center;font-size:12px;pointer-events:none;background:#0b1425d9;padding:8px;border-radius:10px}.lab-hud-wrap{pointer-events:none}.lab-hud{pointer-events:auto}
@media(max-height:680px){.lab-screen{padding:12px}.lab-card{padding:16px}.lab-card h1{font-size:24px}.lab-card p{margin-bottom:10px}.gameplay-lab button,.gameplay-lab select{margin:3px 0}}
`;
const ratingsMarkup = (prefix: string) => [['repetition', 'Tekrar: 1 = kam, 5 = ziyad'], ['early', 'Natije zood maloom shod: 1 = kam, 5 = ziyad'], ['unfair', 'Naadelane bood: 1 = kam, 5 = ziyad']].map(([id, label]) => `<label for="${prefix}-${id}">${label}</label><select id="${prefix}-${id}"><option value="">Emtiaz bede</option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select>`).join('');
const readRatings = (node: HTMLElement, prefix: string): LabRatings => ({
    repetition: Number(node.querySelector<HTMLSelectElement>(`#${prefix}-repetition`)!.value),
    earlyDecided: Number(node.querySelector<HTMLSelectElement>(`#${prefix}-early`)!.value),
    unfair: Number(node.querySelector<HTMLSelectElement>(`#${prefix}-unfair`)!.value),
});
export class GameplayLabUI {
    private root = document.createElement('div');
    private clock?: HTMLElement;
    private inspectionId?: string;
    private inspecting?: HTMLElement;
    constructor() {
        this.root.className = 'gameplay-lab';
        const style = document.createElement('style');
        style.textContent = styles;
        this.root.append(style);
        document.body.append(this.root);
    }
    private content(html: string): HTMLElement {
        this.root.querySelectorAll(':scope > :not(style)').forEach((n) => n.remove());
        this.clock = undefined;
        this.inspecting = undefined;
        this.inspectionId = undefined;
        const node = document.createElement('div');
        node.style.height = '100%';
        node.innerHTML = html;
        this.root.append(node);
        return node;
    }
    private button(node: HTMLElement, id: string, action: () => void): void { node.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = action; }
    private status(node: HTMLElement, message: string): void { node.querySelector('#lab-status')!.textContent = message; }
    private offer(node: HTMLElement, store: GameplayLabStore, offer: LabReplayOffer, replay: () => void, next: () => void): void {
        this.button(node, 'lab-continue', () => { store.respondOffer(offer, 'continue'); next(); });
        this.button(node, 'lab-optional', () => { store.respondOffer(offer, 'replay'); replay(); });
    }
    selection(store: GameplayLabStore, start: (participant: number, variant: EngagementVariant, kind: 'main' | 'practice' | 'optional', retryOf?: string) => void, exit: () => void): void {
        const p = store.participant, index = nextPilotIndex(store.data, p), pending = store.pendingRating(p), offer = store.pendingOffer(p);
        const order = pilotOrder(p), complete = successfulMainTrials(store.data, p).length === LAB_MAIN_MATCHES_PER_PARTICIPANT && !pending;
        const node = this.content(`<div class="lab-screen"><div class="lab-card"><div class="lab-eyebrow">CROWN CLASH · C</div><h1>Recovery C</h1><p>Noskhe-ye C ba recovery-e 3 saniye. 2 match-e asli; bazi-e ekhtiari joda sabt mishe.</p><label for="lab-participant">Bazikon-e test</label><select id="lab-participant">${[1, 2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select><div id="lab-order" class="lab-note"></div>${pending ? `<div class="lab-note">Emtiaz-e match-e ghabli ro takmil kon.</div>${ratingsMarkup('pending')}<button id="lab-pending-rate">Sabt-e nazar</button>` : ''}${offer ? `<p>Bad az do match-e ${LAB_NAMES[offer.variant]}: yek dast-e dige mikhay?</p><div class="lab-row"><button id="lab-continue">Edame-ye test</button><button id="lab-optional">Yek dast-e dige</button></div>` : ''}<button id="lab-pilot" class="primary">Match-e asli-e ba’d</button><div class="lab-note">Tamrin-e azad (jozv-e pilot nist):</div>${ENGAGEMENT_VARIANTS.map(v => `<button id="lab-${v}">${LAB_NAMES[v]}</button>`).join('')}<label for="lab-reflection">Ba C, dast-e ba’d che tasmimi ro avaz mikoni?</label><textarea id="lab-reflection" maxlength="1000"></textarea><button id="lab-feedback">Sabt-e nazar</button><input id="lab-import-file" type="file" accept="application/json,.json" hidden><div class="lab-row"><button id="lab-import">Import JSON</button><button id="lab-export">Export JSON</button></div><button id="lab-exit">Khorooj</button><div id="lab-status" class="lab-status" role="status"></div></div></div>`);
        const participant = node.querySelector<HTMLSelectElement>('#lab-participant')!;
        participant.value = String(p);
        participant.onchange = () => { store.participant = Number(participant.value); this.selection(store, start, exit); };
        node.querySelector('#lab-order')!.textContent = `Tartib: ${order.map(v => LAB_NAMES[v][0]).join(' → ')} · ${index}/${LAB_MAIN_MATCHES_PER_PARTICIPANT} match`;
        const pilot = node.querySelector<HTMLButtonElement>('#lab-pilot')!;
        pilot.disabled = index >= LAB_MAIN_MATCHES_PER_PARTICIPANT || Boolean(pending) || Boolean(offer);
        this.button(node, 'lab-pilot', () => start(p, order[index], 'main'));
        for (const variant of ENGAGEMENT_VARIANTS)
            this.button(node, `lab-${variant}`, () => start(p, variant, 'practice'));
        if (pending)
            this.button(node, 'lab-pending-rate', () => { try {
                store.rateTrial(pending, readRatings(node, 'pending'));
                this.selection(store, start, exit);
            }
            catch {
                this.status(node, 'Har se emtiaz bayad 1 ta 5 bashe.');
            } });
        if (offer)
            this.offer(node, store, offer, () => start(p, offer.variant, 'optional', offer.trialId), () => this.selection(store, start, exit));
        const reflection = node.querySelector<HTMLTextAreaElement>('#lab-reflection')!;
        reflection.value = store.data.reflections[p] ?? '';
        reflection.disabled = !complete;
        node.querySelector<HTMLButtonElement>('#lab-feedback')!.disabled = !complete;
        this.button(node, 'lab-feedback', () => {
            if (!reflection.value.trim()) { this.status(node, 'Yek tasmim-e taze ro sabt kon.'); return; }
            store.data.reflections[p] = reflection.value.trim();
            store.save();
            this.status(node, store.error || 'Nazar zakhire shod.');
        });
        const file = node.querySelector<HTMLInputElement>('#lab-import-file')!;
        this.button(node, 'lab-import', () => file.click());
        file.onchange = async () => {
            const upload = file.files?.[0];
            if (!upload)
                return;
            try {
                store.importJson(await upload.text());
                this.selection(store, start, exit);
                this.status(this.root, store.error || 'Data jam shod.');
            }
            catch {
                this.status(node, 'JSON-e lab motabar nist; data-ye mojood hefz shod.');
            }
            file.value = '';
        };
        this.button(node, 'lab-export', () => this.export(store));
        this.button(node, 'lab-exit', exit);
        this.status(node, store.error || (labReport(store.data).complete ? 'Pilot takmil shod; gozaresh dar JSON-e.' : 'C entekhab shode; in test barande-ye retention moarefi nemikone.'));
    }
    match(variant: EngagementVariant, quit: () => void): void {
        const node = this.content(`<div class="lab-hud-wrap"><div class="lab-hud"><strong>${LAB_NAMES[variant]}</strong><span class="lab-clock">01:30</span><button id="lab-quit">Khorooj</button></div><div class="lab-hint">C: recovery-e tolid dar 3s. Drag: ersal · Tap: etelaat</div><div id="lab-inspector" class="lab-inspector" hidden><p id="lab-inspect"></p></div></div>`);
        this.clock = node.querySelector('.lab-clock')!;
        this.inspecting = node.querySelector('#lab-inspect')!;
        this.button(node, 'lab-quit', quit);
    }
    inspect(territoryId: string): void { this.inspectionId = territoryId; }
    update(state: GameState, _dragging = false, _terminal = false): void {
        const seconds = Math.max(0, Math.ceil(state.timeLimitSeconds - state.elapsedTimeSeconds));
        if (this.clock)
            this.clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        const territory = this.inspectionId ? state.territories[this.inspectionId] : undefined;
        if (!territory || !this.inspecting)
            return;
        const panel = this.root.querySelector<HTMLElement>('#lab-inspector')!;
        panel.hidden = false;
        const hint = this.root.querySelector<HTMLElement>('.lab-hint');
        if (hint)
            hint.hidden = true;
        const recovery = getCaptureProductionMultiplier(state.rules, state.simulationTick ?? 0, state.productionReadyTicks?.[territory.id]);
        const text = `${territory.name} · ${territory.owner} · ${territory.units} niroo\nPROD ${(territory.productionRate * getTerritoryProductionMultiplier(territory.type) * recovery).toFixed(2)}/s · DEF ×${getTerritoryDefenseMultiplier(territory.type)} · SPD ×${getTerritoryArmySpeedMultiplier(territory.type)}`;
        if (this.inspecting.textContent !== text) this.inspecting.textContent = text;
    }
    result(controller: GameplayLabController, retry: () => void, choose: () => void, exit: () => void): void {
        const result = controller.trial.battle.result;
        const node = this.content(`<div class="lab-screen"><div class="lab-card"><div class="lab-eyebrow">${LAB_NAMES[controller.trial.battle.variant as EngagementVariant]} · ${controller.trial.kind}</div><h1>${result === 'victory' ? 'Bordi!' : result === 'defeat' ? 'In dast ro bakhti' : result === 'quit' ? 'Match ro tark kardi' : 'Mosavi'}</h1>${ratingsMarkup('lab')}<button id="lab-rate">Sabt-e nazar</button><div id="lab-status" class="lab-status" role="status"></div><div id="lab-result-actions"></div><div class="lab-row"><button id="lab-export">Export JSON</button><button id="lab-exit">Khorooj</button></div></div></div>`);
        const actions = () => {
            const offer = controller.store.data.offers.find(o => o.trialId === controller.trial.id && !o.decision);
            const box = node.querySelector<HTMLElement>('#lab-result-actions')!;
            if (offer) {
                box.innerHTML = '<p>Yek dast-e dige mikhay?</p><div class="lab-row"><button id="lab-continue">Edame-ye test</button><button id="lab-optional">Yek dast-e dige</button></div>';
                this.offer(node, controller.store, offer, retry, choose);
            }
            else {
                box.innerHTML = '<button id="lab-retry">Yek dast-e ekhtiari</button><button id="lab-choose">Edame-ye test</button>';
                this.button(node, 'lab-retry', retry);
                this.button(node, 'lab-choose', choose);
            }
        };
        this.button(node, 'lab-rate', () => { try {
            controller.rate(readRatings(node, 'lab'));
            this.status(node, controller.store.error || 'Nazar zakhire shod.');
            actions();
        }
        catch {
            this.status(node, 'Har se emtiaz bayad 1 ta 5 bashe.');
        } });
        this.button(node, 'lab-export', () => this.export(controller.store));
        this.button(node, 'lab-exit', exit);
        actions();
        this.status(node, controller.store.error);
    }
    private export(store: GameplayLabStore): void {
        const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'crown-clash-C-v4.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    destroy(): void { this.root.remove(); }
}

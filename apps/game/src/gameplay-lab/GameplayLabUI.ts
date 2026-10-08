import { ENGAGEMENT_VARIANTS, LAB_UPGRADE, getCaptureProductionMultiplier, getTerritoryDefenseMultiplier, getTerritoryProductionMultiplier, getTerritoryArmySpeedMultiplier, type EngagementVariant, type GameState } from '@crown-clash/game-core';
import { LAB_NAMES, labReport, nextPilotIndex, pilotOrder, successfulMainTrials, type GameplayLabController, type GameplayLabStore, type LabRatings, type LabReplayOffer } from './GameplayLabController.js';
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
const upgradeLabel = '<bdi dir="rtl">۱۲ نیرو</bdi> → <bdi dir="rtl">تولید <bdi dir="ltr">+۵۰٪</bdi></bdi>';

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
    private upgradeButton?: HTMLButtonElement;
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
        this.upgradeButton = undefined;
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
        const order = pilotOrder(p), complete = successfulMainTrials(store.data, p).length === 8 && !pending;
        const node = this.content(`<div class="lab-screen"><div class="lab-card"><div class="lab-eyebrow">CROWN CLASH · ENGAGEMENT LAB</div><h1>Yek dast-e dige?</h1><p>C ro ba se taghyir-e joda moghayese kon. 8 match-e asli; bazi-e ekhtiari joda sabt mishe.</p><label for="lab-participant">Bazikon-e test</label><select id="lab-participant">${[1, 2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select><div id="lab-order" class="lab-note"></div>${pending ? `<div class="lab-note">Emtiaz-e match-e ghabli ro takmil kon.</div>${ratingsMarkup('pending')}<button id="lab-pending-rate">Sabt-e nazar</button>` : ''}${offer ? `<p>Bad az do match-e ${LAB_NAMES[offer.variant]}: yek dast-e dige mikhay?</p><div class="lab-row"><button id="lab-continue">Edame-ye test</button><button id="lab-optional">Yek dast-e dige</button></div>` : ''}<button id="lab-pilot" class="primary">${index === 4 ? 'Edame pas az esterahat' : 'Match-e asli-e ba’d'}</button>${index === 4 ? '<div class="lab-note">4 match takmil shod; mitooni alan esterahat koni.</div>' : ''}<div class="lab-note">Tamrin-e azad (jozv-e pilot nist):</div>${ENGAGEMENT_VARIANTS.map(v => `<button id="lab-${v}">${LAB_NAMES[v]}</button>`).join('')}<label for="lab-preference">Bad az 8 match: kodoom behtar bood?</label><select id="lab-preference"><option value="">Entekhab kon</option>${ENGAGEMENT_VARIANTS.map(v => `<option value="${v}">${LAB_NAMES[v]}</option>`).join('')}</select><label for="lab-reflection">Dast-e ba’d che tasmimi ro avaz mikoni?</label><textarea id="lab-reflection" maxlength="1000"></textarea><button id="lab-feedback">Sabt-e entekhab</button><input id="lab-import-file" type="file" accept="application/json,.json" hidden><div class="lab-row"><button id="lab-import">Import JSON</button><button id="lab-export">Export JSON</button></div><button id="lab-exit">Khorooj</button><div id="lab-status" class="lab-status" role="status"></div></div></div>`);
        const participant = node.querySelector<HTMLSelectElement>('#lab-participant')!;
        participant.value = String(p);
        participant.onchange = () => { store.participant = Number(participant.value); this.selection(store, start, exit); };
        node.querySelector('#lab-order')!.textContent = `Tartib: ${order.map(v => LAB_NAMES[v][0]).join(' → ')} · ${index}/8 match`;
        const pilot = node.querySelector<HTMLButtonElement>('#lab-pilot')!;
        pilot.disabled = index >= 8 || Boolean(pending) || Boolean(offer);
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
        const preference = node.querySelector<HTMLSelectElement>('#lab-preference')!, reflection = node.querySelector<HTMLTextAreaElement>('#lab-reflection')!;
        preference.value = store.data.preferences[p] ?? '';
        reflection.value = store.data.reflections[p] ?? '';
        preference.disabled = reflection.disabled = !complete;
        node.querySelector<HTMLButtonElement>('#lab-feedback')!.disabled = !complete;
        this.button(node, 'lab-feedback', () => {
            if (!preference.value || !reflection.value.trim()) {
                this.status(node, 'Noskhe va yek tasmim-e taze ro sabt kon.');
                return;
            }
            store.data.preferences[p] = preference.value as EngagementVariant;
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
        this.status(node, store.error || (labReport(store.data).complete ? 'Pilot takmil shod; gozaresh dar JSON-e.' : 'Gozaresh ta takmil-e 6 bazikon natije nemigire.'));
    }
    match(variant: EngagementVariant, quit: () => void, upgrade: (id: string) => void): void {
        const hints: Record<EngagementVariant, string> = { capture_recovery: 'C: recovery-e tolid dar 3s.', capture_recovery_targets: 'D: hadaf-e arzun ya tolid-e bishtar?', capture_recovery_tactical: 'E: hamle-ha-ye dar rah ro dar nazar begir.', capture_recovery_upgrade: 'F: tap rooye paygah; 12 niroo baraye +50% tolid.' };
        const node = this.content(`<div class="lab-hud-wrap"><div class="lab-hud"><strong>${LAB_NAMES[variant]}</strong><span class="lab-clock">01:30</span><button id="lab-quit">Khorooj</button></div><div class="lab-hint">${hints[variant]} Drag: ersal · Tap: etelaat</div><div id="lab-inspector" class="lab-inspector" hidden><p id="lab-inspect"></p>${variant === 'capture_recovery_upgrade' ? `<button id="lab-upgrade" aria-label="۱۲ نیرو برای افزایش پنجاه درصد تولید">${upgradeLabel}</button>` : ''}</div></div>`);
        this.clock = node.querySelector('.lab-clock')!;
        this.inspecting = node.querySelector('#lab-inspect')!;
        this.upgradeButton = node.querySelector<HTMLButtonElement>('#lab-upgrade') ?? undefined;
        if (this.upgradeButton)
            this.button(node, 'lab-upgrade', () => { if (this.inspectionId && !this.upgradeButton!.disabled)
                upgrade(this.inspectionId); });
        this.button(node, 'lab-quit', quit);
    }
    inspect(territoryId: string): void { this.inspectionId = territoryId; }
    update(state: GameState, dragging = false, terminal = false): void {
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
        const boosted = state.productionUpgrades?.[territory.id] ? LAB_UPGRADE.multiplier : 1;
        const text = `${territory.name} · ${territory.owner} · ${territory.units} niroo\nPROD ${(territory.productionRate * getTerritoryProductionMultiplier(territory.type) * recovery * boosted).toFixed(2)}/s · DEF ×${getTerritoryDefenseMultiplier(territory.type)} · SPD ×${getTerritoryArmySpeedMultiplier(territory.type)}${boosted > 1 ? ' · PROD +50%' : ''}`;
        if (this.inspecting.textContent !== text)
            this.inspecting.textContent = text;
        if (this.upgradeButton) {
            this.upgradeButton.hidden = territory.owner !== 'player';
            this.upgradeButton.disabled = dragging || terminal || state.status !== 'playing' || territory.owner !== 'player' || territory.units <= LAB_UPGRADE.cost || Boolean(state.productionUpgrades?.[territory.id]);
            const labelState = boosted > 1 ? 'upgraded' : 'available';
            if (this.upgradeButton.dataset.state !== labelState) {
                this.upgradeButton.dataset.state = labelState;
                this.upgradeButton.innerHTML = boosted > 1 ? '<bdi dir="rtl">تولید <bdi dir="ltr">+۵۰٪</bdi> فعال است</bdi>' : upgradeLabel;
            }
        }
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
                box.innerHTML = '<button id="lab-retry">Yek dast-e ekhtiari</button><button id="lab-choose">Entekhab-e noskhe / edame</button>';
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
        link.download = 'crown-clash-engagement-lab-v3.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    destroy(): void { this.root.remove(); }
}

import type { GameState, GameplayLabVariant } from '@crown-clash/game-core';
import { LAB_NAMES, LAB_ORDERS, labReport, type GameplayLabController, type GameplayLabStore } from './GameplayLabController.js';

const styles = `
.gameplay-lab{position:fixed;inset:0;z-index:1000;color:#eef4ff;font-family:'Baloo 2',sans-serif;box-sizing:border-box;pointer-events:none}
.gameplay-lab *{box-sizing:border-box}.lab-screen{pointer-events:auto;height:100%;overflow:auto;background:radial-gradient(ellipse at top,#1b3153,#080e1b 65%);padding:24px 18px;display:flex;align-items:flex-start;justify-content:center}
.lab-card{margin:auto;width:min(100%,420px);border:1px solid #375079;border-radius:24px;padding:24px;background:#101b2ef2;box-shadow:0 16px 60px #0008}
.lab-eyebrow{color:#79b4ff;letter-spacing:2px;font-size:12px}.lab-card h1{font-size:28px;margin:8px 0}.lab-card p{color:#b4c5df;font-size:15px;line-height:1.5;margin:8px 0 18px}
.gameplay-lab button,.gameplay-lab select{font:inherit;min-height:46px;border-radius:12px;border:1px solid #415b85;background:#192b47;color:#edf5ff;padding:10px 14px;cursor:pointer;width:100%;margin:5px 0}
.gameplay-lab button:hover{background:#264774}.gameplay-lab button.primary{background:#386de1;border-color:#74a2ff;font-weight:800}.gameplay-lab button:focus-visible,.gameplay-lab select:focus-visible{outline:3px solid #f6c85c;outline-offset:2px}
.lab-row{display:flex;gap:8px}.lab-row>*{flex:1}.lab-note{color:#9db2d1;font-size:13px;margin:8px 0}.lab-status{color:#f6c85c;font-size:13px;min-height:20px}
.lab-hud{display:flex;align-items:center;gap:10px;background:#0b1425ed;border-bottom:1px solid #375079;padding:8px 12px;height:70px}.lab-hud strong{flex:1;font-size:15px}.lab-hud button{width:auto;margin:0;min-width:70px}.lab-clock{font-family:'JetBrains Mono',monospace;color:#f6c85c;font-size:17px}
.lab-hint{position:absolute;bottom:12px;left:12px;right:12px;text-align:center;font-size:12px;pointer-events:none;background:#0b1425d9;padding:8px;border-radius:10px}.lab-hud-wrap{pointer-events:none}.lab-hud{pointer-events:auto}
@media(max-height:680px){.lab-screen{padding:12px}.lab-card{padding:16px}.lab-card h1{font-size:24px}.lab-card p{margin-bottom:10px}.gameplay-lab button,.gameplay-lab select{margin:3px 0}}
`;

export class GameplayLabUI {
  private root = document.createElement('div');
  private clock?: HTMLElement;
  constructor() {
    this.root.className = 'gameplay-lab';
    const style = document.createElement('style');
    style.textContent = styles;
    this.root.append(style);
    document.body.append(this.root);
  }
  private content(html: string): HTMLElement {
    this.root.querySelectorAll(':scope > :not(style)').forEach((node) => node.remove());
    const node = document.createElement('div');
    node.style.height = '100%';
    node.innerHTML = html;
    this.root.append(node);
    return node;
  }
  private button(node: HTMLElement, id: string, action: () => void): void {
    node.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = action;
  }
  selection(store: GameplayLabStore, start: (participant: number, variant: GameplayLabVariant) => void, exit: () => void): void {
    const node = this.content(`<div class="lab-screen"><div class="lab-card"><div class="lab-eyebrow">CROWN CLASH · GAMEPLAY LAB</div><h1>Yek dast, yek tasmim-e taze</h1><p>Se noskhe ro ba sharayet-e barabar moghayese kon. Har match 90 saniye; natije faghat baraye in test zakhire mishe.</p><label for="lab-participant">Bazikon-e test</label><select id="lab-participant">${[1,2,3,4,5,6].map((n) => `<option value="${n}">Bazikon ${n}</option>`).join('')}</select><div id="lab-order" class="lab-note"></div>${Object.entries(LAB_NAMES).map(([id, label]) => `<button id="lab-${id}" class="${id === 'baseline' ? 'primary' : ''}">${label}</button>`).join('')}<div class="lab-note">A: ghavanin-e alan · B: 25% sorat-e bishtar rooye jadde<br>C: tolid az 50% be 100% dar 3 saniye</div><label for="lab-preference">Ba'd az 6 match: kodoom behtar bood?</label><select id="lab-preference"><option value="">Hanooz entekhab nakardam</option>${Object.entries(LAB_NAMES).map(([id,label]) => `<option value="${id}">${label}</option>`).join('')}</select><input id="lab-import-file" type="file" accept="application/json,.json" hidden><div class="lab-row"><button id="lab-import">Import JSON</button><button id="lab-export">Export JSON</button></div><button id="lab-exit">Khorooj</button><div id="lab-status" class="lab-status"></div></div></div>`);
    const participant = node.querySelector<HTMLSelectElement>('#lab-participant')!;
    participant.value = String(store.participant);
    const preference = node.querySelector<HTMLSelectElement>('#lab-preference')!;
    const update = () => {
      const p = Number(participant.value);
      store.participant = p;
      const order = [...LAB_ORDERS[p - 1], ...LAB_ORDERS[p - 1]];
      const count = store.data.trials.filter((t) => t.participant === p && !t.retryOf && t.battle.result !== 'quit').length;
      node.querySelector('#lab-order')!.textContent = `Tartib: ${order.map((v) => LAB_NAMES[v][0]).join(' → ')} · ${count}/6 match`;
      preference.value = store.data.preferences[p] ?? '';
      node.querySelector('#lab-status')!.textContent = store.error || (labReport(store.data).complete ? 'Data-ye 6 bazikon takmil shod; gozaresh dar JSON-e.' : 'Gozaresh ta takmil-e 6 bazikon natije nemigire.');
    };
    participant.onchange = update;
    preference.onchange = () => {
      if (preference.value) store.data.preferences[participant.value] = preference.value as GameplayLabVariant;
      else delete store.data.preferences[participant.value];
      store.save(); update();
    };
    for (const variant of ['baseline', 'roads', 'capture_recovery'] as const) this.button(node, `lab-${variant}`, () => start(Number(participant.value), variant));
    const fileInput = node.querySelector<HTMLInputElement>('#lab-import-file')!;
    this.button(node, 'lab-import', () => fileInput.click());
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        store.importJson(await file.text()); update();
        node.querySelector('#lab-status')!.textContent = store.error || 'Data jam shod. File-ye akhar baraye trial-e tekrar-shode estefade mishe.';
      } catch { node.querySelector('#lab-status')!.textContent = 'JSON-e lab motabar nist; data-ye mojood hefz shod.'; }
      fileInput.value = '';
    };
    this.button(node, 'lab-export', () => this.export(store));
    this.button(node, 'lab-exit', exit);
    update();
  }
  match(variant: GameplayLabVariant, quit: () => void): void {
    const node = this.content(`<div class="lab-hud-wrap"><div class="lab-hud"><strong>${LAB_NAMES[variant]}</strong><span class="lab-clock">01:30</span><button id="lab-quit">Khorooj</button></div><div class="lab-hint">${variant === 'roads' ? 'Hamle azad-e; hadaf-e highlight-shode bonus-e jadde dare (+25% sorat).' : variant === 'capture_recovery' ? 'Tolid pas az fath: 50% ta 100% dar 3s. Recapture recovery ro aghab nemindaze.' : 'Drag kon ta hamle ya reinforcement befresti.'}</div></div>`);
    this.clock = node.querySelector('.lab-clock')!;
    this.button(node, 'lab-quit', quit);
  }
  update(state: GameState): void {
    const seconds = Math.max(0, Math.ceil(state.timeLimitSeconds - state.elapsedTimeSeconds));
    if (this.clock) this.clock.textContent = `${Math.floor(seconds / 60).toString().padStart(2,'0')}:${(seconds % 60).toString().padStart(2,'0')}`;
  }
  result(controller: GameplayLabController, retry: () => void, choose: () => void, exit: () => void): void {
    const result = controller.trial.battle.result;
    const node = this.content(`<div class="lab-screen"><div class="lab-card"><div class="lab-eyebrow">${LAB_NAMES[controller.battle.variant]}</div><h1>${result === 'victory' ? 'Bordi!' : result === 'defeat' ? 'In dast ro bakhti' : result === 'quit' ? 'Match ro tark kardi' : 'Mosavi'}</h1><p>Dast-e ba'd kodoom tasmim ro avaz mikoni?</p><label for="lab-repetition">Tekrar: 1 = kam, 5 = ziyad</label><select id="lab-repetition"><option value="">Emtiaz bede</option>${[1,2,3,4,5].map((n) => `<option>${n}</option>`).join('')}</select><label for="lab-early">Natije zood maloom shod: 1 = kam, 5 = ziyad</label><select id="lab-early"><option value="">Emtiaz bede</option>${[1,2,3,4,5].map((n) => `<option>${n}</option>`).join('')}</select><button id="lab-rate">Sabt-e nazar</button><div id="lab-status" class="lab-status"></div><button id="lab-retry" class="primary">Yek dast-e dige</button><button id="lab-choose">Entekhab-e noskhe</button><div class="lab-row"><button id="lab-export">Export JSON</button><button id="lab-exit">Khorooj</button></div></div></div>`);
    this.button(node, 'lab-rate', () => {
      try {
        controller.rate({ repetition: Number(node.querySelector<HTMLSelectElement>('#lab-repetition')!.value), earlyDecided: Number(node.querySelector<HTMLSelectElement>('#lab-early')!.value) });
        node.querySelector('#lab-status')!.textContent = controller.store.error || 'Nazar zakhire shod.';
      } catch { node.querySelector('#lab-status')!.textContent = 'Har do emtiaz ro az 1 ta 5 entekhab kon.'; }
    });
    this.button(node, 'lab-retry', retry);
    this.button(node, 'lab-choose', choose);
    this.button(node, 'lab-export', () => this.export(controller.store));
    this.button(node, 'lab-exit', exit);
    node.querySelector('#lab-status')!.textContent = controller.store.error;
  }
  private export(store: GameplayLabStore): void {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'crown-clash-gameplay-lab.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  destroy(): void { this.root.remove(); }
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['packages/game-core/src/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const core = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tactical-parity-'));
const cases = [], expected = {};
const mods = { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 };
const makeState = () => core.createInitialGameState({ gameplayRulesVersion: 3 });
const supply = makeState(); supply.territories.n_bot_right.owner = 'player';
const routeOrder = { at: 0, Source: 'n_bot_left', Target: 'n_bot_right', Owner: 'player' };
cases.push({ id: 'supply-pass', state: supply, ticks: 240, orders: [routeOrder], changes: [] });
for (const units of [1, 20]) cases.push({ id: `intercept-${units}`, state: supply, ticks: 240, orders: [routeOrder], changes: [{ at: 40, ID: 'p_base', Owner: 'enemy', Units: units }] });
cases.push({ id: 'destination-captured', state: supply, ticks: 240, orders: [routeOrder], changes: [{ at: 130, ID: 'n_bot_right', Owner: 'enemy', Units: 1 }] });
const equal = structuredClone(supply); equal.territories.n_center.owner = 'player'; equal.territories.p_base.x = equal.territories.n_center.x; equal.territories.p_base.y = equal.territories.n_center.y;
cases.push({ id: 'equal-paths', state: equal, ticks: 240, orders: [routeOrder], changes: [] });
cases.push({ id: 'simultaneous-waves', state: makeState(), ticks: 300, orders: [
  { at: 0, Source: 'p_base', Target: 'n_center', Owner: 'player' }, { at: 0, Source: 'e_base', Target: 'n_center', Owner: 'enemy' },
  { at: 0, Source: 'n_top_right', Target: 'n_center', Owner: 'enemy' }, { at: 0, Source: 'n_bot_left', Target: 'n_center', Owner: 'player' },
], changes: [] });
for (const c of cases) {
  let state = structuredClone(c.state), accumulators = {};
  expected[c.id] = [];
  for (let tick = 0; tick < c.ticks; tick++) {
    c.orders.forEach((o, i) => { if (o.at === tick) {
      const d = core.dispatchArmy(state.territories[o.Source], state.territories[o.Target], o.Owner, .5, () => `order_${i}`, 1, state);
      assert.ok(d.success && d.army && d.sourceTerritory, c.id);
      state.territories[o.Source] = d.sourceTerritory; state.armies.push(d.army);
      state.stats[o.Owner === 'player' ? 'playerUnitsDispatched' : 'enemyUnitsDispatched'] += d.army.units;
    }});
    for (const change of c.changes) if (change.at === tick) Object.assign(state.territories[change.ID], { owner: change.Owner, units: change.Units });
    const moves = core.evaluateTacticalMoves(state).map(m => ({ FromID: m.fromId, ToID: m.toId }));
    const r = core.stepSimulation(state, accumulators, .02); state = r.state; accumulators = r.accumulators;
    expected[c.id].push(structuredClone({ state, accumulators, moves }));
  }
}
for (const battlefieldId of ['crown_cross', 'twin_passes', 'royal_ring']) for (const version of [1, 2, 3, 4]) for (const upgraded of [false, true]) for (const botDifficulty of ['easy', 'normal', 'hard']) {
  const playerModifiers = upgraded ? { startingUnits: 32, productionRateMultiplier: 1.4, armySpeedMultiplier: 1.495 } : mods;
  const ids = core.getBattlefield(battlefieldId).territories.map(t => t.id);
  const actions = Array.from({ length: 100 }, (_, sequence) => ({ sequence, atSeconds: sequence * .8,
    sourceId: ids[(sequence * 3) % ids.length], targetId: ids[(sequence * 7 + 1) % ids.length] }));
  const replay = { botDifficulty, battlefieldId, gameplayRulesVersion: version, playerModifiers, enemyModifiers: mods, actions };
  const id = `${battlefieldId}-v${version}-${upgraded}-${botDifficulty}`;
  cases.push({ id, replay }); expected[id] = core.simulatePvpBattle(replay);
}
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    const result = Object.fromEntries(Object.entries(value).map(([k,v]) => [k, normalized(v)]));
    if ('territories' in result) result.productionReadyAtMs ??= {};
    if ('routeIds' in result) result.routeLeg ??= 0;
    if ('moves' in result) result.moves ??= [];
    return result;
  }
  return value;
}
function compare(a,b,where='root') {
  if (typeof a==='number' && typeof b==='number') { assert.ok(Math.abs(a-b)<1e-8, `${where}: ${a} != ${b}`); return; }
  if (a && b && typeof a==='object' && typeof b==='object') {
    assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),`${where}: keys`);
    for(const k of Object.keys(a))compare(a[k],b[k],`${where}.${k}`); return;
  }
  assert.equal(a,b,where);
}
try {
  fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify(cases));
  execFileSync('go',['test','-count=1','-run','^TestTacticalCrossEngine$','.'],{cwd:'apps/server-nakama',env:{...process.env,TACTICAL_PARITY_INPUT:path.join(dir,'input.json'),TACTICAL_PARITY_OUTPUT:path.join(dir,'output.json')},stdio:'pipe'});
  const actual=JSON.parse(fs.readFileSync(path.join(dir,'output.json'),'utf8'));
  compare(normalized(expected),normalized(actual));
  fs.mkdirSync('qa-artifacts/tactical',{recursive:true});
  fs.writeFileSync('qa-artifacts/tactical/parity.json',JSON.stringify({cases:cases.length,checkpoints:Object.values(expected).filter(Array.isArray).reduce((n,a)=>n+a.length,0),passed:true},null,2));
  console.log(`PASS: ${cases.length} cross-engine cases, full state/route/AI checkpoints and authoritative replay, v1/v2/v3/v4`);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }

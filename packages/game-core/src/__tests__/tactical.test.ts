import { describe, expect, it } from 'vitest';
import { createInitialGameState, dispatchArmy, dispatchMultipleArmies, findDispatchRoute, previewOrder,
  stepSimulation, evaluateTacticalMoves, simulatePvpBattle, armyDestination, armyArrivalSeconds, type GameState } from '../index.js';

const initial = () => createInitialGameState({ gameplayRulesVersion: 3 });
function send(state: GameState, from: string, to: string) {
  const result = dispatchArmy(state.territories[from], state.territories[to], 'player', .5, () => 'test', 1, state);
  expect(result.success).toBe(true); expect(result.army).toBeDefined(); expect(result.sourceTerritory).toBeDefined();
  state.territories[from] = result.sourceTerritory!; state.armies.push(result.army!);
  return result.army!;
}
function step(state: GameState, count: number) {
  let accumulators = {}; let arrivals = 0;
  for (let i = 0; i < count; i++) { const r = stepSimulation(state, accumulators, .02); state = r.state; accumulators = r.accumulators; arrivals += r.resolvedArrivals.length; }
  return { state, arrivals };
}
describe('tactical v3', () => {
  it.each(['crown_cross', 'twin_passes', 'royal_ring'] as const)('starts equal on %s with two towers and normal crown rules', battlefieldId => {
    const s = createInitialGameState({ gameplayRulesVersion: 3, battlefieldId });
    for (const owner of ['player','enemy']) {
      expect(Object.values(s.territories).filter(t => t.owner === owner).map(t => t.units).sort((a,b)=>a-b)).toEqual([14,28]);
    }
    expect(s.timeLimitSeconds).toBe(90);
    expect(createInitialGameState({ gameplayRulesVersion: 2, battlefieldId }).territories.p_base.units).toBe(20);
  });
  it('rejects remote attacks and disconnected reinforcement without debiting units', () => {
    const s = initial(), before = structuredClone(s);
    expect(dispatchArmy(s.territories.p_base, s.territories.e_base, 'player', .5, undefined, 1, s)).toMatchObject({ success: false });
    s.territories.n_top_left.owner = 'player';
    expect(findDispatchRoute(s, 'p_base', 'n_top_left','player')).toBeNull();
    s.territories.n_top_left.owner = 'neutral'; expect(s).toEqual(before);
    expect(dispatchArmy(s.territories.p_base,s.territories.e_base,'player',.5,undefined,1,{...s,gameplayRulesVersion:2}).success).toBe(true);
  });
  it('uses shortest friendly roads and deterministic lexical ties', () => {
    const s=initial();s.territories.n_bot_right.owner='player';
    expect(findDispatchRoute(s,'n_bot_left','n_bot_right','player')).toEqual(['n_bot_left','p_base','n_bot_right']);
    s.territories.n_center.owner='player';
    expect(findDispatchRoute(s,'n_bot_left','n_bot_right','player')).toEqual(['n_bot_left','n_center','n_bot_right']);
    // Make the two intermediary positions identical to exercise an exact equal-cost tie.
    s.territories.p_base.x=s.territories.n_center.x;s.territories.p_base.y=s.territories.n_center.y;
    expect(findDispatchRoute(s,'n_bot_left','n_bot_right','player')).toEqual(['n_bot_left','n_center','n_bot_right']);
  });
  it('debits half once, never deposits at a waypoint, preserves route across a saved state', () => {
    const s=initial();for(const t of Object.values(s.territories))t.productionRate=0;
    s.territories.n_bot_right.owner='player';s.territories.n_bot_right.units=3;
    const army=send(s,'n_bot_left','n_bot_right');expect(army.routeIds).toEqual(['n_bot_left','p_base','n_bot_right']);expect(army.speed).toBe(.5);
    expect(s.territories.n_bot_left.units).toBe(7);
    const transit=step(s,100);expect(transit.arrivals).toBe(0);expect(transit.state.territories.p_base.units).toBe(28);
    expect(transit.state.armies).toHaveLength(1);expect(transit.state.armies[0].routeLeg).toBe(1);
    const resumed=step(JSON.parse(JSON.stringify(transit.state)),100), continuous=step(transit.state,100);
    expect(resumed).toEqual(continuous);expect(resumed.arrivals).toBe(1);expect(resumed.state.armies).toHaveLength(0);expect(resumed.state.territories.n_bot_right.units).toBe(10);
  });
  it.each([1,20])('fights and stops at a cut waypoint with %i defenders, including when recaptured', units => {
    const s=initial();for(const t of Object.values(s.territories))t.productionRate=0;
    s.territories.n_bot_right.owner='player';const destinationBefore=s.territories.n_bot_right.units;
    send(s,'n_bot_left','n_bot_right');s.territories.p_base.owner='enemy';s.territories.p_base.units=units;
    const r=step(s,110);expect(r.arrivals).toBe(1);expect(r.state.armies).toHaveLength(0);expect(r.state.territories.n_bot_right.units).toBe(destinationBefore);
    expect(r.state.territories.p_base.owner).toBe(units===1?'player':'enemy');
  });
  it('resolves destination ownership at arrival and maintains capture recovery in v3', () => {
    const s=initial();send(s,'p_base','n_bot_left');s.territories.n_bot_left.owner='enemy';s.territories.n_bot_left.units=1;
    const r=step(s,100);expect(r.state.territories.n_bot_left.owner).toBe('player');expect(r.state.productionReadyAtMs?.n_bot_left).toBe(5000);
  });
  it('multi-select preview and dispatch use exactly the legal sources and fortress defense', () => {
    const s=initial();s.territories.n_mid_left.owner='player';
    const sources=['p_base','n_bot_left','n_mid_left'];
    const preview=previewOrder(s,sources,'n_bot_right','player');
    const actual=dispatchMultipleArmies(sources.map(id=>s.territories[id]),s.territories.n_bot_right,'player',.5,1,()=> 'test',s);
    expect(actual.armies).toHaveLength(1);expect(preview.sent).toBe(actual.totalUnitsDispatched);expect(preview.left).toBe(14);
    s.territories.p_base.units=30;const fortress=previewOrder(s,['p_base'],'n_center','player');expect(fortress.projected?.owner).toBe('neutral');
  });
  it('exposes a vacated flank to a legal counterattack', () => {
    const setup = () => { const s=initial();for(const t of Object.values(s.territories))t.productionRate=0;
      s.territories.n_mid_left.owner='enemy';s.territories.n_mid_left.units=20;return s; };
    const held=setup(),vacated=setup();send(vacated,'n_bot_left','p_base');
    for(const s of [held,vacated]) { const d=dispatchArmy(s.territories.n_mid_left,s.territories.n_bot_left,'enemy',.5,()=> 'counter',1,s);
      expect(d.success).toBe(true);s.territories.n_mid_left=d.sourceTerritory!;s.armies.push(d.army!); }
    expect(step(held,110).state.territories.n_bot_left.owner).toBe('player');
    expect(step(vacated,110).state.territories.n_bot_left.owner).toBe('enemy');
  });
  it('AI sees a cut supply as incoming at the first hostile waypoint', () => {
    const s=initial();s.territories.n_bot_right.owner='player';const a=send(s,'n_bot_left','n_bot_right');
    expect(armyDestination(a,s)).toBe('n_bot_right');expect(armyArrivalSeconds(a,s)).toBe(4);
    s.territories.p_base.owner='enemy';expect(armyDestination(a,s)).toBe('p_base');expect(armyArrivalSeconds(a,s)).toBe(2);
  });
  it('AI rescues a threatened tower before taking neutral land', () => {
    const s=initial();s.territories.n_top_right.units=1;
    s.territories.n_mid_right.owner='player';s.territories.n_mid_right.units=16;
    const d=dispatchArmy(s.territories.n_mid_right,s.territories.n_top_right,'player',.5,()=> 'threat',.3,s);
    s.territories.n_mid_right=d.sourceTerritory!;s.armies.push(d.army!);
    expect(evaluateTacticalMoves(s)).toEqual([{fromId:'e_base',toId:'n_top_right'}]);
  });
  it('AI coordinates legal waves and never changes the input or invents troops', () => {
    const s=initial();s.territories.e_base.units=28;s.territories.n_top_right.units=20;
    const before=structuredClone(s), moves=evaluateTacticalMoves(s);expect(moves.length).toBeGreaterThan(0);
    for(const m of moves)expect(findDispatchRoute(s,m.fromId,m.toId,'enemy')).not.toBeNull();expect(s).toEqual(before);
    const a=simulatePvpBattle({gameplayRulesVersion:3,actions:[]});expect(a.summary.status).toBe('defeat');expect(a.summary.actionsProcessed).toBe(0);
  });
});

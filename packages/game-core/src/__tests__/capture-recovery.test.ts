import { describe, expect, it } from 'vitest';
import { createInitialGameState, stepSimulation } from '../simulation.js';
import { GAMEPLAY_RULES_VERSION, getCaptureProductionMultiplier } from '../gameplay-rules.js';
import { simulatePvpBattle } from '../pvp.js';
import { createInitial2v2Territories, createInitial2v2GameState } from '../init2v2.js';
import { simulate2v2Battle } from '../pvp2v2.js';
import type { GameState, Team } from '../types.js';

function arrive(state: GameState, owner: Team, id = 'n_bot_left', units?: number): void {
  const t=state.territories[id];
  units ??= Math.ceil(t.units*(t.type==='fortress'?1.25:1))+100;
  state.armies.push({id:`arrival_${state.elapsedTimeSeconds}_${state.armies.length}`,sourceId:'p_base',targetId:id,owner,units,
    startX:0,startY:0,targetX:t.x,targetY:t.y,progress:1,speed:1,distance:1});
}
function fixture(version: 1|2 = GAMEPLAY_RULES_VERSION): GameState {
  const state=createInitialGameState({gameplayRulesVersion:version});
  Object.assign(state.territories.n_bot_left,{productionRate:50,type:'fortress',maxUnits:10000});return state;
}

describe('production C capture recovery',()=>{
  it.each([.02,.05])('uses simulation milliseconds for bot and live %.2fs ticks',delta=>{
    const state=fixture();arrive(state,'player');
    let r=stepSimulation(state,{n_bot_left:.95},delta);
    const ready=Math.round(delta*1000)+3000;
    expect(r.state.gameplayRulesVersion).toBe(2);expect(r.state.productionReadyAtMs).toEqual({n_bot_left:ready});
    expect(r.resolvedArrivals[0].captured).toBe(true);
    expect(r.accumulators.n_bot_left).toBeCloseTo((50*.5*delta)%1,12);
    expect(getCaptureProductionMultiplier(delta,ready)).toBe(.5);
    const capturedUnits=r.state.territories.n_bot_left.units;
    r=stepSimulation(r.state,r.accumulators,1.5);
    expect(getCaptureProductionMultiplier(r.state.elapsedTimeSeconds,ready)).toBe(.75);
    expect(r.state.territories.n_bot_left.units).toBeGreaterThan(capturedUnits);
    r=stepSimulation(r.state,r.accumulators,1.5);
    expect(getCaptureProductionMultiplier(r.state.elapsedTimeSeconds,ready)).toBe(1);
    expect(r.state.productionReadyAtMs!.n_bot_left).toBe(ready);
    expect(state.productionReadyAtMs).toBeUndefined(); // stepping doesn't mutate an old snapshot
  });
  it.each(['player','enemy'] as const)('recaptures by %s preserve recovery and clear previous production fractions',first=>{
    let state=fixture();arrive(state,first);let r=stepSimulation(state,{},.02);
    const ready=r.state.productionReadyAtMs!.n_bot_left;
    arrive(r.state,first,'n_bot_left',1);r=stepSimulation(r.state,r.accumulators,.02);
    expect(r.state.productionReadyAtMs!.n_bot_left).toBe(ready);
    for(let i=0;i<6;i++){
      r=stepSimulation(r.state,r.accumulators,.2);
      arrive(r.state,r.state.territories.n_bot_left.owner==='player'?'enemy':'player');
      r=stepSimulation(r.state,{...r.accumulators,n_bot_left:.95},.02);
      expect(r.resolvedArrivals[0].captured).toBe(true);
      expect(r.state.productionReadyAtMs!.n_bot_left).toBe(ready);
      const multiplier=getCaptureProductionMultiplier(r.state.elapsedTimeSeconds,ready);
      expect(r.accumulators.n_bot_left).toBeCloseTo(multiplier,12);
    }
    r=stepSimulation(r.state,r.accumulators,3);
    arrive(r.state,r.state.territories.n_bot_left.owner==='player'?'enemy':'player', 'n_bot_left',1000);
    r=stepSimulation(r.state,r.accumulators,.02);
    expect(r.state.productionReadyAtMs!.n_bot_left).toBe(Math.round(r.state.elapsedTimeSeconds*1000)+3000);
    expect(getCaptureProductionMultiplier(r.state.elapsedTimeSeconds,r.state.productionReadyAtMs!.n_bot_left)).toBe(.5);
  });
  it('keeps each building independent and leaves uncaptured bases at full production',()=>{
    let r=stepSimulation(fixture(),{},1);
    expect(r.state.territories.p_base.units).toBe(21);
    arrive(r.state,'player');r=stepSimulation(r.state,r.accumulators,.02);
    arrive(r.state,'enemy','n_bot_right');r=stepSimulation(r.state,r.accumulators,1);
    expect(r.state.productionReadyAtMs).toEqual({n_bot_left:4020,n_bot_right:5020});
    expect(getCaptureProductionMultiplier(r.state.elapsedTimeSeconds,4020)).toBeCloseTo(2/3);
    expect(getCaptureProductionMultiplier(r.state.elapsedTimeSeconds,5020)).toBe(.5);
  });
  it('preserves v1 production for historical snapshots and server-pinned old tickets',()=>{
    for(const version of [undefined,1] as const){const state=fixture(1);state.gameplayRulesVersion=version;arrive(state,'player');
      const r=stepSimulation(state,{n_bot_left:.95},.02);
      expect(r.state.productionReadyAtMs).toBeUndefined();expect(r.accumulators.n_bot_left).toBeCloseTo(.95,12);
    }
    for(const version of [1,2] as const){const options={actions:[{sequence:0,atSeconds:0,sourceId:'p_base',targetId:'n_bot_left'}],gameplayRulesVersion:version};
      expect(simulatePvpBattle(options)).toEqual(simulatePvpBattle(options));
      expect(simulatePvpBattle(options).finalState.gameplayRulesVersion).toBe(version);
    }
    expect(()=>createInitialGameState({gameplayRulesVersion:99 as any})).toThrow('unsupported_gameplay_rules_version');
  });
  it('starts 2v2 on C and supports an explicitly versioned legacy replay',()=>{
    const modifiers={startingUnits:20,productionRateMultiplier:1,armySpeedMultiplier:1};
    const options={territories:createInitial2v2Territories('quad_citadel'),battlefieldId:'quad_citadel' as const,
      spawnAssignments:[{slot:0 as const,territoryId:'a_base_w'},{slot:1 as const,territoryId:'a_base_e'},{slot:2 as const,territoryId:'b_base_w'},{slot:3 as const,territoryId:'b_base_e'}],
      modifiersBySlot:{0:modifiers,1:modifiers,2:modifiers,3:modifiers},actions:[]};
    expect(createInitial2v2GameState(options).gameplayRulesVersion).toBe(2);
    expect(simulate2v2Battle({...options,gameplayRulesVersion:1}).finalState.gameplayRulesVersion).toBeUndefined();
    expect(simulate2v2Battle(options).finalState.gameplayRulesVersion).toBe(2);
  });
});

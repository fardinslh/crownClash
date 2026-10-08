import { dispatchMultipleArmies, type MultiDispatchResult } from './dispatch.js';
import { evaluateAiMove } from './ai.js';
import { createInitialGameState, stepSimulation, type StepResult } from './simulation.js';
import { LAB_RULES_VERSION, gameplayLabRules, type GameplayLabVariant } from './gameplay-rules.js';
import type { CombatResult, GameState, Team } from './types.js';

export const LAB_TICK_SECONDS = 0.02;
export const LAB_AI_INTERVAL_TICKS = 90;

export interface LabAction {
  tick: number;
  owner: Exclude<Team, 'neutral'>;
  sourceId: string;
  targetId: string;
}

export interface LabSnapshot {
  tick: number;
  territories: Record<string, { owner: Team; units: number }>;
  armies: Array<Pick<GameState['armies'][number], 'id' | 'sourceId' | 'targetId' | 'owner' | 'units' | 'progress'>>;
}

export interface LabBattleRecord {
  rulesVersion: typeof LAB_RULES_VERSION;
  variant: GameplayLabVariant;
  actions: LabAction[];
  captures: Array<{ tick: number; arrival: CombatResult }>;
  snapshots: LabSnapshot[];
  result: GameState['status'] | 'quit';
  durationSeconds: number;
  lastLeadChangeSeconds: number;
}

/** Same fixed-clock domain engine for the playable lab, replay and simulations. */
export class GameplayLabBattle {
  state: GameState;
  accumulators: Record<string, number> = {};
  tick = 0;
  readonly record: LabBattleRecord;
  private ids = { player: 0, enemy: 0 };
  private lastLead = 0;

  constructor(readonly variant: GameplayLabVariant, private readonly automaticBot = true) {
    this.state = createInitialGameState({ battlefieldId: 'crown_cross', rules: gameplayLabRules(variant) });
    this.record = { rulesVersion: LAB_RULES_VERSION, variant, actions: [], captures: [], snapshots: [], result: 'playing', durationSeconds: 0, lastLeadChangeSeconds: 0 };
    this.snapshot();
  }

  dispatch(sourceIds: readonly string[], targetId: string, owner: 'player' | 'enemy' = 'player'): MultiDispatchResult {
    const target = this.state.territories[targetId];
    if (!target || this.state.status !== 'playing') {
      return { successes: [], armies: [], updatedSources: {}, totalUnitsDispatched: 0 };
    }
    const sources = sourceIds.map((id) => this.state.territories[id]).filter((t) => Boolean(t));
    const result = dispatchMultipleArmies(sources, target, owner, 0.5, 1, this.state,
      () => `pvp_${owner === 'enemy' ? 'ai' : 'player'}_${this.ids[owner]++}`);
    Object.assign(this.state.territories, result.updatedSources);
    this.state.armies.push(...result.armies);
    if (owner === 'player') this.state.stats.playerUnitsDispatched += result.totalUnitsDispatched;
    else this.state.stats.enemyUnitsDispatched += result.totalUnitsDispatched;
    for (const army of result.armies) {
      this.record.actions.push({ tick: this.tick, owner, sourceId: army.sourceId, targetId: army.targetId });
    }
    return result;
  }

  step(): StepResult {
    if (this.state.status !== 'playing') return { state: this.state, accumulators: this.accumulators, resolvedArrivals: [] };
    const result = stepSimulation(this.state, this.accumulators, LAB_TICK_SECONDS);
    this.tick++;
    this.state = result.state;
    this.accumulators = result.accumulators;
    for (const arrival of result.resolvedArrivals) {
      if (arrival.captured) this.record.captures.push({ tick: this.tick, arrival });
    }
    if (this.automaticBot && this.state.status === 'playing' && this.tick % LAB_AI_INTERVAL_TICKS === 0) {
      const move = evaluateAiMove(this.state.territories, 'enemy', 8);
      if (move) this.dispatch([move.fromId], move.toId, 'enemy');
    }
    if (this.tick % 50 === 0 || this.state.status !== 'playing') this.snapshot();
    this.record.durationSeconds = this.tick * LAB_TICK_SECONDS;
    this.record.result = this.state.status;
    return { ...result, state: this.state };
  }

  quit(): void {
    if (this.state.status !== 'playing') return;
    this.record.result = 'quit';
    this.record.durationSeconds = this.tick * LAB_TICK_SECONDS;
    this.snapshot();
  }

  private snapshot(): void {
    this.record.snapshots.push({ tick: this.tick,
      territories: Object.fromEntries(Object.values(this.state.territories).map((t) => [t.id, { owner: t.owner, units: t.units }])),
      armies: this.state.armies.map(({ id, sourceId, targetId, owner, units, progress }) => ({ id, sourceId, targetId, owner, units, progress })) });
    const all = Object.values(this.state.territories);
    const player = all.filter((t) => t.owner === 'player');
    const enemy = all.filter((t) => t.owner === 'enemy');
    const lead = Math.sign(player.length - enemy.length) || Math.sign(
      player.reduce((sum, t) => sum + t.units, 0) - enemy.reduce((sum, t) => sum + t.units, 0));
    if (lead !== this.lastLead) this.record.lastLeadChangeSeconds = this.tick * LAB_TICK_SECONDS;
    this.lastLead = lead;
  }
}

export function replayGameplayLab(record: LabBattleRecord): GameplayLabBattle {
  if (record.rulesVersion !== LAB_RULES_VERSION) throw new Error('incompatible_lab_rules_version');
  const battle = new GameplayLabBattle(record.variant, false);
  for (const action of record.actions) {
    if (!Number.isInteger(action.tick) || action.tick < battle.tick) throw new Error('invalid_lab_action_tick');
    while (battle.tick < action.tick && battle.state.status === 'playing') battle.step();
    if (battle.tick !== action.tick || battle.dispatch([action.sourceId], action.targetId, action.owner).armies.length !== 1) {
      throw new Error('invalid_lab_replay_action');
    }
  }
  const endTick = Math.round(record.durationSeconds / LAB_TICK_SECONDS);
  while (battle.tick < endTick && battle.state.status === 'playing') battle.step();
  if (record.result === 'quit') battle.quit();
  if (battle.record.result !== record.result || battle.tick !== endTick) throw new Error('invalid_lab_replay_result');
  return battle;
}

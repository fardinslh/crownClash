import { dispatchMultipleArmies, type MultiDispatchResult } from './dispatch.js';
import { evaluateAiMove } from './ai.js';
import { createInitialGameState, stepSimulation, type StepResult } from './simulation.js';
import { LAB_RULES_VERSION, gameplayLabRules, type GameplayLabVariant } from './gameplay-rules.js';
import { LAB_AI_INTERVAL_TICKS, LAB_COMMON_CONFIG, LAB_VARIANT_CONFIG, isEngagementVariant, LAB_TICK_SECONDS } from './gameplay-lab-config.js';
import { chooseLabProductionUpgrade, evaluateTacticalLabMove } from './gameplay-lab-ai.js';
import type { CombatResult, GameState, Team } from './types.js';
export { LAB_TICK_SECONDS, LAB_AI_INTERVAL_TICKS } from './gameplay-lab-config.js';
interface LabCommandClock {
    tick: number;
    owner: Exclude<Team, 'neutral'>;
}
export type LabAction = LabCommandClock & ({
    type: 'dispatch';
    sourceId: string;
    targetId: string;
    reinforcement: boolean;
    counterattack: boolean;
} | {
    type: 'upgrade';
    territoryId: string;
});
export interface LabSnapshot {
    tick: number;
    productionUpgrades: Record<string, true>;
    territories: Record<string, {
        owner: Team;
        units: number;
    }>;
    armies: Array<Pick<GameState['armies'][number], 'id' | 'sourceId' | 'targetId' | 'owner' | 'units' | 'progress'>>;
}
export interface LabBattleRecord {
    rulesVersion: typeof LAB_RULES_VERSION;
    variant: GameplayLabVariant;
    actions: LabAction[];
    captures: Array<{
        tick: number;
        arrival: CombatResult;
    }>;
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
        this.state = createInitialGameState({ battlefieldId: LAB_COMMON_CONFIG.battlefieldId, timeLimit: LAB_COMMON_CONFIG.timeLimitSeconds, rules: gameplayLabRules(variant) });
        for (const territory of Object.values(this.state.territories))
            if (territory.owner !== 'neutral')
                territory.units = LAB_COMMON_CONFIG.startingUnits;
        const targets = isEngagementVariant(variant) ? LAB_VARIANT_CONFIG[variant].targets : undefined;
        if (targets)
            for (const [id, [units, productionRate]] of Object.entries(targets)) {
                Object.assign(this.state.territories[id], { units, productionRate });
            }
        this.record = { rulesVersion: LAB_RULES_VERSION, variant, actions: [], captures: [], snapshots: [], result: 'playing', durationSeconds: 0, lastLeadChangeSeconds: 0 };
        this.snapshot();
    }
    dispatch(sourceIds: readonly string[], targetId: string, owner: 'player' | 'enemy' = 'player'): MultiDispatchResult {
        const target = this.state.territories[targetId];
        if (!target || this.state.status !== 'playing') {
            return { successes: [], armies: [], updatedSources: {}, totalUnitsDispatched: 0 };
        }
        const sources = [...new Set(sourceIds)].map((id) => this.state.territories[id]).filter((t) => Boolean(t));
        const result = dispatchMultipleArmies(sources, target, owner, LAB_COMMON_CONFIG.sendFraction, 1, this.state, () => `pvp_${owner === 'enemy' ? 'ai' : 'player'}_${this.ids[owner]++}`);
        Object.assign(this.state.territories, result.updatedSources);
        this.state.armies.push(...result.armies);
        if (owner === 'player')
            this.state.stats.playerUnitsDispatched += result.totalUnitsDispatched;
        else
            this.state.stats.enemyUnitsDispatched += result.totalUnitsDispatched;
        for (const army of result.armies) {
            const lastCapture = [...this.record.captures].reverse().find((c) => c.arrival.targetId === targetId);
            this.record.actions.push({ type: 'dispatch', tick: this.tick, owner, sourceId: army.sourceId, targetId: army.targetId,
                reinforcement: target.owner === owner, counterattack: target.owner !== owner && lastCapture?.arrival.previousOwner === owner && this.tick - lastCapture.tick <= 250 });
        }
        return result;
    }
    upgrade(territoryId: string, owner: 'player' | 'enemy' = 'player'): boolean {
        const config = this.state.rules?.productionUpgrade, territory = this.state.territories[territoryId];
        if (!config || !territory || (owner !== 'player' && owner !== 'enemy') || territory.owner !== owner || this.state.status !== 'playing' ||
            territory.units <= config.cost || this.state.productionUpgrades?.[territoryId])
            return false;
        territory.units -= config.cost;
        this.state.productionUpgrades = { ...this.state.productionUpgrades, [territoryId]: true };
        this.record.actions.push({ type: 'upgrade', tick: this.tick, owner, territoryId });
        return true;
    }
    step(): StepResult {
        if (this.state.status !== 'playing')
            return { state: this.state, accumulators: this.accumulators, resolvedArrivals: [] };
        const result = stepSimulation(this.state, this.accumulators, LAB_TICK_SECONDS);
        this.tick++;
        this.state = result.state;
        this.accumulators = result.accumulators;
        for (const arrival of result.resolvedArrivals) {
            if (arrival.captured)
                this.record.captures.push({ tick: this.tick, arrival });
        }
        // Snapshots precede commands at this tick, identically in live play and replay.
        if (this.tick % 50 === 0 || this.state.status !== 'playing')
            this.snapshot();
        if (this.automaticBot && this.state.status === 'playing' && this.tick % LAB_AI_INTERVAL_TICKS === 0) {
            const upgrade = chooseLabProductionUpgrade(this.state);
            if (upgrade)
                this.upgrade(upgrade, 'enemy');
            else {
                const move = isEngagementVariant(this.variant) && LAB_VARIANT_CONFIG[this.variant].bot === 'tactical' ? evaluateTacticalLabMove(this.state, this.accumulators) : evaluateAiMove(this.state.territories, 'enemy', 8);
                if (move)
                    this.dispatch([move.fromId], move.toId, 'enemy');
            }
        }
        this.record.durationSeconds = this.tick * LAB_TICK_SECONDS;
        this.record.result = this.state.status;
        return { ...result, state: this.state };
    }
    quit(): void {
        if (this.state.status !== 'playing')
            return;
        this.record.result = 'quit';
        this.record.durationSeconds = this.tick * LAB_TICK_SECONDS;
        this.snapshot();
    }
    private snapshot(): void {
        this.record.snapshots.push({ tick: this.tick,
            productionUpgrades: { ...this.state.productionUpgrades },
            territories: Object.fromEntries(Object.values(this.state.territories).map((t) => [t.id, { owner: t.owner, units: t.units }])),
            armies: this.state.armies.map(({ id, sourceId, targetId, owner, units, progress }) => ({ id, sourceId, targetId, owner, units, progress })) });
        const all = Object.values(this.state.territories);
        const player = all.filter((t) => t.owner === 'player');
        const enemy = all.filter((t) => t.owner === 'enemy');
        const lead = Math.sign(player.length - enemy.length) || Math.sign(player.reduce((sum, t) => sum + t.units, 0) - enemy.reduce((sum, t) => sum + t.units, 0));
        if (lead !== this.lastLead)
            this.record.lastLeadChangeSeconds = this.tick * LAB_TICK_SECONDS;
        this.lastLead = lead;
    }
}
export function replayGameplayLab(record: LabBattleRecord): GameplayLabBattle {
    if (record.rulesVersion !== LAB_RULES_VERSION)
        throw new Error('incompatible_lab_rules_version');
    if (!['baseline', 'roads', 'capture_recovery', 'capture_recovery_targets', 'capture_recovery_tactical', 'capture_recovery_upgrade'].includes(record.variant) ||
        !Number.isFinite(record.durationSeconds) || record.durationSeconds < 0 || record.durationSeconds > 91 ||
        Math.abs(Math.round(record.durationSeconds / LAB_TICK_SECONDS) * LAB_TICK_SECONDS - record.durationSeconds) > 1e-9)
        throw new Error('invalid_lab_replay_result');
    const battle = new GameplayLabBattle(record.variant, false);
    for (const action of record.actions) {
        if ((action.owner !== 'player' && action.owner !== 'enemy') || !Number.isInteger(action.tick) || action.tick < battle.tick || action.tick > Math.round(record.durationSeconds / LAB_TICK_SECONDS))
            throw new Error('invalid_lab_action_tick');
        while (battle.tick < action.tick && battle.state.status === 'playing')
            battle.step();
        if (battle.tick !== action.tick || (action.type === 'upgrade' ? !battle.upgrade(action.territoryId, action.owner) :
            action.type !== 'dispatch' || battle.dispatch([action.sourceId], action.targetId, action.owner).armies.length !== 1)) {
            throw new Error('invalid_lab_replay_action');
        }
    }
    const endTick = Math.round(record.durationSeconds / LAB_TICK_SECONDS);
    while (battle.tick < endTick && battle.state.status === 'playing')
        battle.step();
    if (record.result === 'quit')
        battle.quit();
    if (battle.record.result !== record.result || battle.tick !== endTick)
        throw new Error('invalid_lab_replay_result');
    return battle;
}

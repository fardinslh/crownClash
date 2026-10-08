import { scoreAiDispatch, type AiMove } from './ai.js';
import { calculateDispatchUnits, dispatchArmy } from './dispatch.js';
import { LAB_FORECAST_TICKS, LAB_TICK_SECONDS, LAB_UPGRADE } from './gameplay-lab-config.js';
import { getCaptureProductionMultiplier } from './gameplay-rules.js';
import { stepSimulation } from './simulation.js';
import { getTerritoryDefenseMultiplier, getTerritoryProductionMultiplier } from './territory-types.js';
import type { CombatResult, GameState, Territory } from './types.js';
type Owner = 'player' | 'enemy';
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export interface LabForecast {
    state: GameState;
    arrivals: Array<{
        tick: number;
        arrival: CombatResult;
    }>;
}
/** Uses the same fixed-tick engine, without a bot or speculative future orders. */
export function forecastLabBattle(state: GameState, accumulators: Record<string, number>): LabForecast {
    const arrivals: LabForecast['arrivals'] = [];
    let projected = state, production = accumulators;
    if (!state.armies.length)
        return { state, arrivals };
    for (let tick = 1; tick <= LAB_FORECAST_TICKS && projected.status === 'playing'; tick++) {
        const next = stepSimulation(projected, production, LAB_TICK_SECONDS);
        projected = next.state;
        production = next.accumulators;
        for (const arrival of next.resolvedArrivals)
            arrivals.push({ tick, arrival });
    }
    return { state: projected, arrivals };
}
function canSpare(source: Territory, owner: Owner, forecast: LabForecast): boolean {
    return !forecast.arrivals.some(({ arrival: a }) => a.targetId === source.id && a.previousOwner === owner &&
        a.attackerOwner !== owner && a.captured);
}
export function evaluateTacticalLabMove(state: GameState, accumulators: Record<string, number>, owner: Owner = 'enemy'): AiMove | null {
    if (state.status !== 'playing')
        return null;
    const forecast = forecastLabBattle(state, accumulators);
    // All source withdrawals can be forecast together: inbound combat and
    // generation are independent per territory. This preserves fortress rounding
    // across multiple arrivals, which subtracting troops from baseline results cannot.
    const exposed = forecast.arrivals.some(({arrival:a}) => a.attackerOwner !== owner && state.territories[a.targetId]?.owner === owner);
    const withdrawals = exposed ? {
        ...state, territories: Object.fromEntries(Object.entries(state.territories).map(([id,t]) => [id,
            t.owner === owner && t.units >= 8 ? {...t, units:t.units - calculateDispatchUnits(t.units)} : t]))
    } : state;
    const sourceSafety = exposed ? forecastLabBattle(withdrawals, accumulators) : forecast;
    const sources = Object.values(state.territories).filter((t) => t.owner === owner && t.units >= 8 && canSpare(t, owner, sourceSafety))
        .sort((a, b) => compareId(a.id, b.id));
    const threats = forecast.arrivals.filter(({ arrival: a }) => a.captured && a.previousOwner === owner && state.territories[a.targetId]?.owner === owner)
        .sort((a, b) => a.tick - b.tick || compareId(a.arrival.targetId, b.arrival.targetId));
    for (const threat of threats) {
        const target = state.territories[threat.arrival.targetId];
        // ceil(defenders * multiplier) must cover this known attack, plus two spare defenders.
        const required = Math.max(0, Math.floor((threat.arrival.incomingUnits - 1) / getTerritoryDefenseMultiplier(target.type)) + 1 - threat.arrival.previousUnits) + 2;
        const candidates = sources.flatMap((source) => {
            const dispatch = dispatchArmy(source, target, owner, 0.5, () => 'lab_forecast', 1, state);
            if (!dispatch.army || dispatch.army.units < required)
                return [];
            const etaTicks = Math.ceil(1 / dispatch.army.speed / LAB_TICK_SECONDS);
            const distance = Math.hypot(source.x - target.x, source.y - target.y);
            return etaTicks < threat.tick ? [{ source, distance }] : [];
        }).sort((a, b) => a.distance - b.distance || compareId(a.source.id, b.source.id));
        if (candidates.length)
            return { fromId: candidates[0].source.id, toId: target.id };
    }
    let best: AiMove | null = null, bestScore = 1e-9;
    const targets = Object.values(state.territories).sort((a, b) => compareId(a.id, b.id));
    for (const source of sources)
        for (const target of targets) {
            if (source.id === target.id || (target.owner === owner && threats.some((t) => t.arrival.targetId === target.id)) ||
                (target.owner !== owner && forecast.state.territories[target.id]?.owner === owner &&
                    state.armies.some((a) => a.owner === owner && a.targetId === target.id)))
                continue;
            const score = scoreAiDispatch(source, target, owner);
            if (score > bestScore) {
                bestScore = score;
                best = { fromId: source.id, toId: target.id };
            }
        }
    return best;
}
export function chooseLabProductionUpgrade(state: GameState, owner: Owner = 'enemy'): string | null {
    if (state.status !== 'playing' || !state.rules?.productionUpgrade)
        return null;
    const remaining = state.timeLimitSeconds - state.elapsedTimeSeconds;
    const candidates = Object.values(state.territories).flatMap((t) => {
        if (t.owner !== owner || t.units < LAB_UPGRADE.botMinimumUnits || state.productionUpgrades?.[t.id] ||
            state.armies.some((a) => a.targetId === t.id && a.owner !== owner && (1 - a.progress) / a.speed <= LAB_FORECAST_TICKS * LAB_TICK_SECONDS))
            return [];
        const extraProduction = t.productionRate * getTerritoryProductionMultiplier(t.type) * (LAB_UPGRADE.multiplier - 1);
        const nominalPayback = extraProduction > 0 ? LAB_UPGRADE.cost / extraProduction : Infinity;
        const recoverySeconds = Math.max(0, ((state.productionReadyTicks?.[t.id] ?? 0) - (state.simulationTick ?? 0)) * LAB_TICK_SECONDS);
        const recovery = getCaptureProductionMultiplier(state.rules, state.simulationTick ?? 0, state.productionReadyTicks?.[t.id]);
        const recoveryYield = recoverySeconds * (recovery + 1) / 2;
        // Integrate the known linear recovery instead of assuming full production immediately.
        const payback = recoverySeconds > 0 && nominalPayback < recoveryYield
            ? 2 * nominalPayback / (recovery + Math.sqrt(recovery * recovery + 2 * (1 - recovery) * nominalPayback / recoverySeconds))
            : nominalPayback + recoverySeconds - recoveryYield;
        return remaining >= LAB_UPGRADE.paybackPeriods * payback ? [{ id: t.id, payback }] : [];
    }).sort((a, b) => a.payback - b.payback || compareId(a.id, b.id));
    return candidates[0]?.id ?? null;
}

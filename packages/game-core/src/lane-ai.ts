import { LANE_CONFIG, maxLanes, type Lane, type LaneConfig, type LaneState } from './lanes.js';
import { findDispatchRoute } from './tactical-routes.js';
import { getTerritoryProductionMultiplier } from './territory-types.js';
import type { BotDifficulty } from './bot-difficulty.js';
import type { PlayerUpgradeModifiers } from './upgrades.js';
import type { GameState, Team, Territory } from './types.js';

/**
 * Difficulty ladder for lane battles, tuned by scripts/lanes-sim.mjs with PLAYER_MODEL=human (a slow,
 * late, imprecise player, which is how the first real-phone test played): mean win rate about
 * 0.81 / 0.41 / 0.16 for easy / normal / hard. The fast precise probe wins far more often, so it is
 * not the measure. The bot plans lanes this often, in seconds.
 */
export const LANE_BOT_TICK_SECONDS: Readonly<Record<BotDifficulty, number>> = Object.freeze({ easy: 8, normal: 6, hard: 4.5 });
/** Seconds before the bot plans its first lanes: a person needs a moment to read the board. */
export const LANE_BOT_START_SECONDS: Readonly<Record<BotDifficulty, number>> = Object.freeze({ easy: 10, normal: 8, hard: 2 });
export const LANE_ENEMY_MODIFIERS: Readonly<Record<BotDifficulty, PlayerUpgradeModifiers>> = Object.freeze({
  easy: Object.freeze({ startingUnits: 14, productionRateMultiplier: 0.6, armySpeedMultiplier: 1 }),
  normal: Object.freeze({ startingUnits: 18, productionRateMultiplier: 0.8, armySpeedMultiplier: 1 }),
  hard: Object.freeze({ startingUnits: 22, productionRateMultiplier: 1.0, armySpeedMultiplier: 1 }),
});

export interface LaneOrder { readonly from: string; readonly to: string }
export interface LaneOrders { readonly open: LaneOrder[]; readonly cut: LaneOrder[] }

export interface LanePlanOptions {
  /** 0 picks the best target; k picks the (k+1)-th best, to model weaker play in simulations. */
  readonly skill?: number;
  readonly config?: LaneConfig;
}

const regeneration = (t: Territory): number => (t.owner === 'neutral' ? 0 : t.productionRate * getTerritoryProductionMultiplier(t.type));
const byId = (a: Territory, b: Territory): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Deterministic lane policy shared by the bot and the balance probes (candidate rules v5).
 * Opens at most one new lane per tower per call on the weakest reachable tower whose
 * regeneration the stream can beat, rescues a friendly tower under lane attack, and cuts
 * lanes that are finished (target captured and full, rescue done) or cannot win.
 */
export function planLanes(state: GameState, lanes: LaneState, team: Team, options: LanePlanOptions = {}): LaneOrders {
  const config = options.config ?? LANE_CONFIG;
  const rate = 1 / config.emitSeconds;
  const towers = Object.values(state.territories).sort(byId);
  const mine = (l: Lane): boolean => l.owner === team;
  const open: LaneOrder[] = [];
  const cut: LaneOrder[] = [];

  for (const lane of lanes.lanes.filter(mine)) {
    const target = state.territories[lane.targetId];
    const source = state.territories[lane.sourceId];
    if (!target || !source) continue;
    const finished = target.owner === team && target.units >= (lane.sourceId === lane.targetId ? 0 : Math.min(target.maxUnits - 1, 14));
    const hopeless = target.owner !== team && rate <= regeneration(target) + 0.1;
    if (finished || hopeless) cut.push({ from: lane.sourceId, to: lane.targetId });
  }
  const cutKeys = new Set(cut.map((o) => `${o.from}>${o.to}`));
  const active = lanes.lanes.filter((l) => mine(l) && !cutKeys.has(`${l.sourceId}>${l.targetId}`));

  const attackedBy = (t: Territory): number => lanes.lanes.filter((l) => l.owner !== team && l.targetId === t.id).length;
  for (const source of towers.filter((t) => t.owner === team && t.units >= 4)) {
    const own = active.filter((l) => l.sourceId === source.id);
    if (own.length >= maxLanes(state, source.id)) continue;
    const targeted = (t: Territory): number => active.filter((l) => l.targetId === t.id).length;
    const distance = (t: Territory): number => Math.hypot(t.x - source.x, t.y - source.y);

    // Rescue: a threatened friendly tower with few defenders and a rich neighbour.
    const rescue = towers
      .filter((t) => t.owner === team && t.id !== source.id && attackedBy(t) > 0 && t.units < 8 && source.units >= 12 && targeted(t) === 0)
      .filter((t) => !own.some((l) => l.targetId === t.id) && findDispatchRoute(state, source.id, t.id, team))
      .sort((a, b) => a.units - b.units || byId(a, b))[0];
    if (rescue) { open.push({ from: source.id, to: rescue.id }); continue; }

    const options2 = towers
      .filter((t) => t.owner !== team && !own.some((l) => l.targetId === t.id) && targeted(t) < 2)
      .filter((t) => rate > regeneration(t) + 0.2 && findDispatchRoute(state, source.id, t.id, team))
      .map((t) => ({ t, score: t.units + (t.owner === 'neutral' ? 0 : 3) + distance(t) / 45 - (attackedBy(t) > 0 ? 2 : 0) }))
      .sort((a, b) => a.score - b.score || byId(a.t, b.t));
    const pick = options2[Math.min(options.skill ?? 0, options2.length - 1)];
    if (pick) open.push({ from: source.id, to: pick.t.id });
  }
  return { open, cut };
}

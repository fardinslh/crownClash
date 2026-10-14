import {
  calculateDispatchUnits, createInitialGameState, getTerritoryDefenseStrength,
  scoreAiDispatch, stepSimulation,
  type AiMove, type GameState, type StepResult, type Team,
} from '@crown-clash/game-core';

/** Local playtest only. Never registered in the authoritative match rules. */
export type PrototypeMode = 'crown' | 'classic';
export const CROWN_CONFIG = Object.freeze({
  territoryId: 'n_center',
  holdMs: 12_000,
  timeLimitSeconds: 90,
  baseUnits: 28,
  supportUnits: 14,
  crownUnits: 6,
  aiTickSeconds: 1.2,
});

export interface CrownProgress {
  holder: Team;
  heldMs: number;
  captures: number;
  firstCaptureSeconds: number | null;
}

export function createCrownProgress(): CrownProgress {
  return { holder: 'neutral', heldMs: 0, captures: 0, firstCaptureSeconds: null };
}

export function resolvePrototypeMode(data: {
  prototypeMode?: unknown; mode?: unknown; training?: unknown; botMatch?: unknown;
  liveMatch?: unknown; liveMatch2v2?: unknown; liveClient?: unknown;
} | undefined): PrototypeMode | null {
  if (!data || data.mode === 'live' || data.training || data.botMatch ||
      data.liveMatch || data.liveMatch2v2 || data.liveClient) return null;
  return data.prototypeMode === 'crown' || data.prototypeMode === 'classic' ? data.prototypeMode : null;
}

export function createPrototypeState(mode: PrototypeMode): GameState {
  const state = createInitialGameState({ battlefieldId: 'crown_cross' });
  if (mode === 'classic') return state;
  state.timeLimitSeconds = CROWN_CONFIG.timeLimitSeconds;
  for (const id of ['p_base', 'e_base']) state.territories[id].units = CROWN_CONFIG.baseUnits;
  // Rotationally symmetric support towers, using the existing art and controls.
  for (const [id, owner] of [['n_bot_left', 'player'], ['n_top_right', 'enemy']] as const) {
    state.territories[id].owner = owner;
    state.territories[id].units = CROWN_CONFIG.supportUnits;
  }
  const crown = state.territories[CROWN_CONFIG.territoryId];
  crown.name = 'Crown · Hold for 12s';
  crown.units = CROWN_CONFIG.crownUnits;
  crown.productionRate = 0;
  return state;
}

export function stepCrownMatch(
  state: GameState, accumulators: Record<string, number>, progress: CrownProgress, deltaSeconds: number,
): StepResult & { crown: CrownProgress } {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) throw new Error('invalid_crown_delta');
  if (!state.territories[CROWN_CONFIG.territoryId]) throw new Error('missing_crown');
  if (state.status !== 'playing') return { state, accumulators, resolvedArrivals: [], crown: progress };
  const dt = Math.min(deltaSeconds, Math.max(0, state.timeLimitSeconds - state.elapsedTimeSeconds));
  const result = stepSimulation(state, accumulators, dt);
  const captures = result.resolvedArrivals.filter(a => a.targetId === CROWN_CONFIG.territoryId && a.captured);
  const holder = result.state.territories[CROWN_CONFIG.territoryId].owner;
  // Any capture breaks the streak, even two captures that return ownership
  // to the original holder inside the same simulation tick.
  const heldMs = holder === 'neutral' || holder !== progress.holder || captures.length > 0
    ? 0 : Math.min(CROWN_CONFIG.holdMs, progress.heldMs + Math.round(dt * 1000));
  const crown: CrownProgress = {
    holder, heldMs, captures: progress.captures + captures.length,
    firstCaptureSeconds: progress.firstCaptureSeconds ?? (captures.length ? result.state.elapsedTimeSeconds : null),
  };
  // Crown hold is the only win condition. A 90s stalemate is a draw, never
  // decided by territory count or career strength. A completed hold wins
  // at the deadline; arrivals at that tick are resolved before the clock.
  result.state.status = heldMs >= CROWN_CONFIG.holdMs
    ? holder === 'player' ? 'victory' : 'defeat'
    : result.state.elapsedTimeSeconds >= state.timeLimitSeconds ? 'draw' : 'playing';
  return { ...result, crown };
}

/** A small objective-aware bot: coordinate a capture, protect a hold, then expand. */
export function evaluateCrownAiMoves(state: GameState, team: 'player' | 'enemy' = 'enemy'): AiMove[] {
  if (state.status !== 'playing') return [];
  const crown = state.territories[CROWN_CONFIG.territoryId];
  const sources = Object.values(state.territories)
    .filter(t => t.owner === team && t.id !== crown.id && t.units >= 4)
    .sort((a, b) => Math.hypot(a.x - crown.x, a.y - crown.y) - Math.hypot(b.x - crown.x, b.y - crown.y));
  const incoming = state.armies.filter(a => a.targetId === crown.id);
  const friendly = incoming.filter(a => a.owner === team).reduce((n, a) => n + a.units, 0);
  const hostile = incoming.filter(a => a.owner !== team).reduce((n, a) => n + a.units, 0);
  // Account for already committed troops; do not blindly drain all supports
  // every tick. The crown's garrison is held back to defend the objective.
  let needed = crown.owner === team
    ? Math.max(0, 14 + hostile - getTerritoryDefenseStrength(crown) - friendly)
    : Math.max(0, getTerritoryDefenseStrength(crown) + 5 + hostile - friendly);
  const available = sources.reduce((n, t) => n + calculateDispatchUnits(t.units), 0);
  if (needed > 0 && (crown.owner !== 'neutral' || available >= needed)) {
    const moves: AiMove[] = [];
    for (const source of sources) {
      moves.push({ fromId: source.id, toId: crown.id });
      needed -= calculateDispatchUnits(source.units);
      if (needed <= 0) break;
    }
    if (moves.length) return moves;
  }
  let best: AiMove | undefined;
  let bestScore = -Infinity;
  for (const source of sources) {
    for (const target of Object.values(state.territories)) {
      if (target.id === crown.id || target.owner === team) continue;
      if (calculateDispatchUnits(source.units) <= getTerritoryDefenseStrength(target)) continue;
      // Avoid sending another capture wave to an already sufficiently attacked target.
      const committed = state.armies.filter(a => a.owner === team && a.targetId === target.id)
        .reduce((n, a) => n + a.units, 0);
      if (committed > getTerritoryDefenseStrength(target)) continue;
      const score = scoreAiDispatch(source, target, team);
      if (score > bestScore) { best = { fromId: source.id, toId: target.id }; bestScore = score; }
    }
  }
  return best ? [best] : [];
}

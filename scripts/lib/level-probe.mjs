// Scripted player probes shared by the campaign and weekly-challenge scripts:
// the same four policies and reaction delays as bot-difficulty-balance.mjs.
// A probe proves a battle is winnable by a script; it says nothing about
// human difficulty or retention.
import { build } from 'esbuild';

const built = await build({ entryPoints: ['packages/game-core/src/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
export const c = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
export const policies = ['center', 'flank', 'split', 'counter'];
export const cadences = [1.8, 2.7, 3.6];

function choose(state, team, policy, turn) {
  if (policy === 'counter') return c.evaluateTacticalMoves(state, team);
  const sign = team === 'player' ? 1 : -1;
  const sources = Object.values(state.territories).filter((t) => t.owner === team && t.units >= 4);
  const targets = Object.values(state.territories).filter((t) => t.owner !== team);
  const score = (t) => policy === 'center'
    ? (t.id === 'n_center' ? -1000 : Math.hypot(t.x - 200, t.y - 360))
    : sign * (t.x - 200) * (policy === 'split' && turn % 2 ? -1 : 1) + Math.abs(t.y - (team === 'player' ? 110 : 610)) * 0.1;
  targets.sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : 1));
  for (const target of targets) {
    const available = sources.filter((s) => c.findDispatchRoute(state, s.id, target.id, team));
    if (!available.length) continue;
    if (policy !== 'center' && available.reduce((n, s) => n + c.calculateDispatchUnits(s.units), 0) <= c.getTerritoryDefenseStrength(target)) continue;
    return available.map((s) => ({ fromId: s.id, toId: target.id }));
  }
  return c.evaluateTacticalMoves(state, team);
}

/**
 * Plays one battle (level = { battlefieldId, botDifficulty, enemy }) with a
 * policy and returns the final status plus the player's recorded dispatches.
 */
export function play(level, policy, playerCadence) {
  let state = c.createInitialGameState({
    gameplayRulesVersion: c.LEVEL_RULES_VERSION,
    battlefieldId: level.battlefieldId,
    playerModifiers: c.LEVEL_PLAYER_MODIFIERS,
    enemyModifiers: level.enemy,
  });
  let acc = {}, sequence = 0, turn = 0;
  const actions = [];
  const cadence = { enemy: Math.round(c.getBotAiTickSeconds(level.botDifficulty) / 0.02), player: Math.round(playerCadence / 0.02) };
  const next = { ...cadence };
  for (let tick = 1; tick <= 4500 && state.status === 'playing'; tick++) {
    const step = c.stepSimulation(state, acc, 0.02); state = step.state; acc = step.accumulators;
    for (const team of ['enemy', 'player']) if (state.status === 'playing' && tick >= next[team]) {
      next[team] += cadence[team];
      const moves = team === 'enemy' ? c.evaluateTacticalMoves(state, team, level.enemy.armySpeedMultiplier) : choose(state, team, policy, turn++);
      for (const move of moves) {
        const d = c.dispatchArmy(state.territories[move.fromId], state.territories[move.toId], team, 0.5, () => `level_${sequence++}`, team === 'enemy' ? level.enemy.armySpeedMultiplier : 1, state);
        if (!d.success || !d.army || !d.sourceTerritory) continue;
        state.territories[move.fromId] = d.sourceTerritory; state.armies.push(d.army);
        if (team === 'player') actions.push({ sequence: actions.length, atSeconds: +(tick * 0.02).toFixed(2), sourceId: move.fromId, targetId: move.toId });
      }
    }
  }
  return { status: state.status, actions };
}

/** The shortest winning run (at most 120 actions) over every policy and delay, or undefined. */
export function bestWin(level) {
  let best;
  for (const policy of policies) for (const cadence of cadences) {
    const game = play(level, policy, cadence);
    if (game.status === 'victory' && game.actions.length <= 120 && (!best || game.actions.length < best.actions.length)) {
      best = { policy, cadence, actions: game.actions };
    }
  }
  return best;
}

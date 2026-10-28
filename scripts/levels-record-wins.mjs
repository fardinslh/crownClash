// Records one winning player action list per campaign level from the TS
// simulation (same probe policies as levels-balance.mjs) into
// apps/server-nakama/testdata/level_wins.json. The Go test replays them through
// the server's level verifier, so a TS/Go simulation drift on any level shows up
// as a failing replay instead of honest players being refused their reward.
import fs from 'node:fs';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['packages/game-core/src/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const c = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const policies = ['center', 'flank', 'split', 'counter'];
const cadences = [1.8, 2.7, 3.6];

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

function play(level, policy, playerCadence) {
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

const wins = {};
for (const level of c.LEVELS) {
  let best;
  for (const policy of policies) for (const cadence of cadences) {
    const game = play(level, policy, cadence);
    if (game.status === 'victory' && game.actions.length <= 120 && (!best || game.actions.length < best.actions.length)) {
      best = { policy, cadence, actions: game.actions };
    }
  }
  if (best) wins[level.id] = best;
  console.log(`level ${level.id}: ${best ? `${best.policy}@${best.cadence}s, ${best.actions.length} actions` : 'no recorded win'}`);
}
fs.mkdirSync('apps/server-nakama/testdata', { recursive: true });
fs.writeFileSync('apps/server-nakama/testdata/level_wins.json', JSON.stringify(wins));

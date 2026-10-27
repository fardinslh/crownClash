// Simulates every campaign level against scripted player policies and a range
// of reaction delays, the same probes as bot-difficulty-balance.mjs. Proves
// each level is winnable by a probe and that difficulty rises along the
// campaign. It does not measure human difficulty or retention.
import fs from 'node:fs';
import assert from 'node:assert/strict';
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
      }
    }
  }
  assert.notEqual(state.status, 'playing', `level ${level.id} must finish within the time limit`);
  return state.status;
}

const rows = c.LEVELS.map((level) => {
  const games = [];
  for (const policy of policies) for (const cadence of cadences) games.push({ policy, cadence, status: play(level, policy, cadence) });
  const wins = games.filter((g) => g.status === 'victory').length;
  const casual = games.filter((g) => g.cadence === 2.7);
  return {
    level: level.id, map: level.battlefieldId, bot: level.botDifficulty,
    winRate: +(wins / games.length).toFixed(2),
    casualWinRate: +(casual.filter((g) => g.status === 'victory').length / casual.length).toFixed(2),
    winningPolicies: [...new Set(games.filter((g) => g.status === 'victory').map((g) => g.policy))],
  };
});
console.table(rows.map((r) => ({ ...r, winningPolicies: r.winningPolicies.join(',') })));
fs.mkdirSync('qa-artifacts/levels', { recursive: true });
fs.writeFileSync('qa-artifacts/levels/balance.json', JSON.stringify({ assumptions: 'Scripted policies (4) x reaction delays (1.8/2.7/3.6s). Does not establish human difficulty or retention.', rows }, null, 2));

for (const r of rows) assert.ok(r.winRate > 0, `level ${r.level} must be winnable by at least one probe`);
assert.ok(rows[0].winRate >= 0.75, 'level 1 must be easy to win');
const half = rows.length / 2;
const avg = (xs) => xs.reduce((a, b) => a + b.winRate, 0) / xs.length;
assert.ok(avg(rows.slice(0, half)) > avg(rows.slice(half)), 'later levels must be harder than earlier ones');
assert.ok(rows.at(-1).winRate < rows[0].winRate, 'the last level must be harder than the first');
console.log('levels balance: ok');

// Simulates every campaign level against scripted player policies and a range
// of reaction delays, the same probes as bot-difficulty-balance.mjs. Proves
// each level is winnable by a probe and that difficulty rises along the
// campaign. It does not measure human difficulty or retention.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { c, play as probe, policies, cadences } from './lib/level-probe.mjs';

function play(level, policy, playerCadence) {
  const { status } = probe(level, policy, playerCadence);
  assert.notEqual(status, 'playing', `level ${level.id} must finish within the time limit`);
  return status;
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

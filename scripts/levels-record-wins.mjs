// Records one winning player action list per campaign level from the TS
// simulation (same probe policies as levels-balance.mjs) into
// apps/server-nakama/testdata/level_wins.json. The Go test replays them through
// the server's level verifier, so a TS/Go simulation drift on any level shows up
// as a failing replay instead of honest players being refused their reward.
import fs from 'node:fs';
import { bestWin, c } from './lib/level-probe.mjs';

const wins = {};
for (const level of c.LEVELS) {
  const best = bestWin(level);
  if (best) wins[level.id] = best;
  console.log(`level ${level.id}: ${best ? `${best.policy}@${best.cadence}s, ${best.actions.length} actions` : 'no recorded win'}`);
}
fs.mkdirSync('apps/server-nakama/testdata', { recursive: true });
fs.writeFileSync('apps/server-nakama/testdata/level_wins.json', JSON.stringify(wins));

// Records one winning probe run for each Weekly Challenge slot on each map into
// apps/server-nakama/testdata/weekly_wins.json. SLOTS mirrors weeklySlots in
// apps/server-nakama/weekly.go; the Go test replays every recorded win through
// the server's weekly verifier, so a drift between this table and Go (or between
// the TS and Go simulations) fails a test instead of refusing honest players.
// A probe win proves a script can win; it does not measure human difficulty.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { bestWin } from './lib/level-probe.mjs';

const enemy = (startingUnits, productionRateMultiplier) => ({ startingUnits, productionRateMultiplier, armySpeedMultiplier: 1 });
const SLOTS = [
  { slot: 1, botDifficulty: 'normal', enemy: enemy(20, 1) },
  { slot: 2, botDifficulty: 'hard', enemy: enemy(20, 0.95) },
  { slot: 3, botDifficulty: 'hard', enemy: enemy(22, 1.05) },
];
const MAPS = ['crown_cross', 'twin_passes', 'royal_ring'];

const wins = {};
for (const slot of SLOTS) for (const battlefieldId of MAPS) {
  const best = bestWin({ battlefieldId, botDifficulty: slot.botDifficulty, enemy: slot.enemy });
  assert.ok(best, `slot ${slot.slot} on ${battlefieldId} must be winnable by a probe`);
  wins[`${slot.slot}:${battlefieldId}`] = best;
  console.log(`slot ${slot.slot} ${battlefieldId}: ${best.policy}@${best.cadence}s, ${best.actions.length} actions`);
}
fs.mkdirSync('apps/server-nakama/testdata', { recursive: true });
fs.writeFileSync('apps/server-nakama/testdata/weekly_wins.json', JSON.stringify(wins));

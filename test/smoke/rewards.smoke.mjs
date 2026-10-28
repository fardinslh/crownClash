#!/usr/bin/env node
import { Client } from '@heroiclabs/nakama-js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Smoke test for the replay-verified coin rewards on a live Nakama + PostgreSQL
 * (docker compose with ALLOW_GUEST_AUTH=true): campaign first-clear rewards and
 * the Weekly Challenge. Plays the TS-recorded winning runs in testdata/ and checks
 * payment, the ledger, idempotency, "paid once" and rejection of a passive run.
 */
const HOST = process.env.NAKAMA_HOST || '127.0.0.1';
const PORT = process.env.NAKAMA_PORT || '7350';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps/server-nakama/testdata');
const levelWins = JSON.parse(readFileSync(path.join(dir, 'level_wins.json'), 'utf8'));
const weeklyWins = JSON.parse(readFileSync(path.join(dir, 'weekly_wins.json'), 'utf8'));

// Same key the server was started with: env first, then the repo's .env (never logged).
function serverKey() {
  if (process.env.NAKAMA_SERVER_KEY) return process.env.NAKAMA_SERVER_KEY;
  try {
    const line = readFileSync(path.join(dir, '../../../.env'), 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('NAKAMA_SERVER_KEY='));
    const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    if (value) return value;
  } catch {
    // No .env: the compose default applies.
  }
  return 'defaultkey';
}
const client = new Client(serverKey(), HOST, PORT, false);
const id = `rewards_smoke_${Date.now()}`;
const explain = async (promise, step) => {
  try { return await promise; } catch (error) {
    const detail = error instanceof Response ? `${error.status} ${await error.text()}` : String(error?.message ?? error);
    throw new Error(`${step} failed: ${detail}`);
  }
};
const session = await explain(client.authenticateCustom(`browser:${id}`, true, id, { platform: 'browser', init_data: `user_id=${id}&username=${id}` }), 'authenticate');
// The HTTP client returns the RPC payload already parsed; the socket returns a string.
const rpc = async (name, payload) => {
  const { payload: body } = await explain(client.rpc(session, name, payload), name);
  return typeof body === 'string' ? JSON.parse(body || '{}') : body ?? {};
};
const career = async () => (await rpc('career/get', {})).career;

const startCoins = (await career()).coins;
let expected = startCoins;

// ---- campaign: level 1 pays 25 once; a second clear pays nothing
const level1 = await rpc('levels/complete', { levelId: 1, claimId: `${id}_l1a`, actions: levelWins['1'].actions });
assert.equal(level1.result.success, true);
assert.equal(level1.result.reward, 25);
expected += 25;
assert.equal((await career()).coins, expected, 'level 1 pays 25');
const retry = await rpc('levels/complete', { levelId: 1, claimId: `${id}_l1a`, actions: levelWins['1'].actions });
assert.equal(retry.result.replayed, true, 'same claimId replays the stored result');
assert.equal((await career()).coins, expected, 'a retried claim never pays twice');
const again = await rpc('levels/complete', { levelId: 1, claimId: `${id}_l1b`, actions: levelWins['1'].actions });
assert.equal(again.result.reason, 'already_claimed');
assert.equal(again.result.reward, 0);
assert.equal((await career()).coins, expected, 'a second clear pays nothing');
const locked = await rpc('levels/complete', { levelId: 3, claimId: `${id}_l3`, actions: levelWins['3'].actions });
assert.equal(locked.result.reason, 'level_locked');
const passive = await rpc('levels/complete', { levelId: 2, claimId: `${id}_l2`, actions: [] });
assert.equal(passive.result.reason, 'not_victory', 'an empty run is not a win');

// ---- weekly: Gold (slot 3) pays 120 once
const week = (await rpc('weekly/get', {})).state;
assert.equal(week.slots.length, 3);
assert.ok(week.endsAt > Date.now(), 'the week ends in the future');
const gold = week.slots[2];
assert.equal(gold.coinReward, 120);
const win = weeklyWins[`3:${gold.battlefieldId}`];
assert.ok(win, `recorded win for gold on ${gold.battlefieldId}`);
const w1 = await rpc('weekly/complete', { weekIndex: week.weekIndex, slot: 3, claimId: `${id}_w1`, actions: win.actions });
assert.equal(w1.result.success, true);
assert.equal(w1.result.reward, 120);
expected += 120;
assert.equal((await career()).coins, expected, 'gold pays 120');
const w2 = await rpc('weekly/complete', { weekIndex: week.weekIndex, slot: 3, claimId: `${id}_w2`, actions: win.actions });
assert.equal(w2.result.reason, 'already_claimed');
assert.equal((await career()).coins, expected, 'a second weekly clear pays nothing');
const stale = await rpc('weekly/complete', { weekIndex: week.weekIndex - 1, slot: 1, claimId: `${id}_w3`, actions: [] });
assert.equal(stale.result.reason, 'week_over');
assert.equal((await rpc('weekly/get', {})).state.slots[2].claimed, true, 'weekly/get marks the slot claimed');
// A Bronze/Silver win recorded for another map must not pay on this week's map.
const wrong = week.slots[0].battlefieldId === 'crown_cross' ? 'twin_passes' : 'crown_cross';
const mismatched = await rpc('weekly/complete', { weekIndex: week.weekIndex, slot: 1, claimId: `${id}_w4`, actions: weeklyWins[`1:${wrong}`].actions });
assert.notEqual(mismatched.result.reward, 50, 'a win recorded on a different map does not pay');

const ledger = (await rpc('ledger/get', { limit: 50 })).entries;
const sources = ledger.filter((e) => e.source === 'level_reward' || e.source === 'weekly_challenge');
assert.equal(sources.length, 2, 'exactly two reward ledger entries');
assert.deepEqual(sources.map((e) => e.amount).sort((a, b) => a - b), [25, 120]);
for (const entry of sources) assert.equal(entry.resultingBalance - entry.previousBalance, entry.amount);

console.log(`rewards smoke: ok (coins ${startCoins} -> ${expected})`);

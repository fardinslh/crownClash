#!/usr/bin/env node
import { Client } from '@heroiclabs/nakama-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-End Smoke Test for Authoritative 2v2 Live Matches (ENABLE_2V2).
 *
 * Requires the stack to run with the 2v2 flag enabled:
 *   ENABLE_2V2=true docker compose up -d --build nakama
 *
 * Scenarios tested:
 * 1. Authenticate and connect four independent clients.
 * 2. All four submit deliberately LYING matchmaker tickets (1v1 query, no
 *    mode properties, four-player counts) and verify the server hook pins
 *    every ticket into one shared 2v2 match (ticket authority §3.2).
 * 3. Verify all four receive OP_MATCH_STARTED (schemaVersion 2) with two
 *    team-a and two team-b slots and a role-mapped authoritative snapshot.
 * 4. Teammate dispatch from a shared team base is accepted with per-slot
 *    sequence 0 and reaches both teammates' authoritative state.
 * 5. Cross-team dispatch (from an enemy-owned base) is rejected with
 *    invalid_dispatch; stale and gap sequences rejected with invalid_sequence.
 * 6. Slot-preserving reconnect: an unexpected socket drop, a fresh
 *    socket/session rejoining within the 30 s grace, the same slot/team
 *    restored, nextSequence restored, a full authoritative resync snapshot,
 *    a stale sequence rejected, and the next correct sequence accepted.
 * 7. Both team-B players surrender; the whole team forfeits; the connected
 *    players receive one OP_MATCH_RESULT with per-participant settlements
 *    (winnerTeamId 'a').
 * 8. PostgreSQL inspection: exactly 4 match_settlements_multi rows,
 *    exactly 1 match_replays row (mode 2v2, JSONB payload present), and
 *    exactly one coins ledger entry per participant (no trophy entries).
 * 9. Self-cleaning account/record removal in `finally`.
 */

const NAKAMA_HOST = process.env.NAKAMA_HOST || '127.0.0.1';
const NAKAMA_PORT = process.env.NAKAMA_PORT || '7350';

function loadEnvValue(filePath, key) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    if (withoutExport.slice(0, eq).trim() !== key) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value[0];
      const end = value.indexOf(quote, 1);
      if (end === -1) continue;
      value = value.slice(1, end);
    } else {
      const commentStart = value.indexOf(' #');
      if (commentStart !== -1) value = value.slice(0, commentStart).trim();
    }
    if (value) return value;
  }
  return undefined;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAKAMA_SERVER_KEY =
  process.env.NAKAMA_SERVER_KEY || loadEnvValue(path.join(REPO_ROOT, '.env'), 'NAKAMA_SERVER_KEY') || 'defaultkey';
const NAKAMA_SSL = process.env.NAKAMA_SSL === 'true';

// Opcodes from apps/server-nakama/live.go
const OP_MATCH_STARTED = 2;
const OP_STATE = 3;
const OP_COMMAND_ACCEPTED = 5;
const OP_COMMAND_REJECTED = 6;
const OP_MATCH_RESULT = 7;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_ID_REGEX = /^live2v2_[0-9a-f]{8}_\d+$/;
const PLAYER_COUNT = 4;
const TEST_ID_REGEX = /^smoke2v2_p[1-4]_\d+$/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(maxWaitMs = 15000) {
  const start = Date.now();
  const url = `http://${NAKAMA_HOST}:${NAKAMA_PORT}/`;
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return;
    } catch {
      // Retry
    }
    await sleep(500);
  }
  throw new Error(`Nakama server at ${url} is not responding. Is the stack running with ENABLE_2V2=true?`);
}

function parseRpcPayload(response) {
  if (!response) return null;
  const payload = response.payload ?? response;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }
  return payload;
}

function queryPostgres(sql) {
  return execFileSync(
    'docker',
    [
      'compose', 'exec', '-T', 'db', 'psql',
      '-U', 'crownclash', '-d', 'crownclash', '-v', 'ON_ERROR_STOP=1',
      '-t', '-A', '-F', '|', '-c', sql,
    ],
    { encoding: 'utf8' }
  );
}

function cleanDatabaseForPlayer(userId, matchId) {
  assert(UUID_REGEX.test(userId), `Invalid userId for cleanup: ${userId}`);
  const sql = `BEGIN;
DELETE FROM match_settlements_multi WHERE user_id = '${userId}';
DELETE FROM match_settlements WHERE player_id = '${userId}';
DELETE FROM economy_ledger WHERE player_id = '${userId}';
DELETE FROM player_names WHERE player_id = '${userId}';
DELETE FROM player_daily_progress WHERE player_id = '${userId}';
DELETE FROM daily_reward_claims WHERE player_id = '${userId}';
DELETE FROM league_reward_claims WHERE player_id = '${userId}';
DELETE FROM upgrade_purchases WHERE player_id = '${userId}';
DELETE FROM pvp_defenses WHERE player_id = '${userId}';
DELETE FROM pvp_attacks WHERE attacker_id = '${userId}' OR defender_id = '${userId}';
DELETE FROM bot_matches WHERE player_id = '${userId}';
DELETE FROM analytics_events WHERE player_id = '${userId}';
DELETE FROM players WHERE id = '${userId}';
COMMIT;`;
  queryPostgres(sql);
  if (matchId && MATCH_ID_REGEX.test(matchId)) {
    queryPostgres(`DELETE FROM match_replays WHERE match_id = '${matchId}';`);
  }
}

function verifyZeroRemainingRows(userId, label) {
  assert(UUID_REGEX.test(userId), `Invalid userId for zero-row verification: ${userId}`);
  const sql = `
SELECT 'match_settlements_multi', COUNT(*) FROM match_settlements_multi WHERE user_id = '${userId}'
UNION ALL SELECT 'match_settlements', COUNT(*) FROM match_settlements WHERE player_id = '${userId}'
UNION ALL SELECT 'economy_ledger', COUNT(*) FROM economy_ledger WHERE player_id = '${userId}'
UNION ALL SELECT 'player_names', COUNT(*) FROM player_names WHERE player_id = '${userId}'
UNION ALL SELECT 'player_daily_progress', COUNT(*) FROM player_daily_progress WHERE player_id = '${userId}'
UNION ALL SELECT 'players', COUNT(*) FROM players WHERE id = '${userId}';`;
  const output = queryPostgres(sql);
  const remaining = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((line) => parseInt(line.split('|')[1], 10) > 0)
    .map((line) => line.split('|').join(' (') + ' rows)');
  assert(remaining.length === 0, `Post-cleanup verification failed for ${label}: remaining rows in ${remaining.join(', ')}`);
}

function createCollector(socket) {
  const collected = { started: null, states: [], accepted: [], rejected: [], result: null };
  socket.onmatchdata = (data) => {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data.data));
      switch (data.op_code) {
        case OP_MATCH_STARTED:
          collected.started = parsed;
          break;
        case OP_STATE:
          collected.states.push(parsed.state);
          break;
        case OP_COMMAND_ACCEPTED:
          collected.accepted.push(parsed);
          break;
        case OP_COMMAND_REJECTED:
          collected.rejected.push(parsed);
          break;
        case OP_MATCH_RESULT:
          collected.result = parsed;
          break;
      }
    } catch {
      // Ignored
    }
  };
  return collected;
}

async function runSmokeTest() {
  console.log('================================================================');
  console.log('  Live 2v2 End-to-End Smoke Test (Real Nakama/Postgres Stack)   ');
  console.log('================================================================\n');

  console.log(`Checking Nakama health at ${NAKAMA_HOST}:${NAKAMA_PORT}...`);
  await waitForHealth();
  console.log('Nakama server is responsive.\n');

  const clients = [];
  const sessions = [];
  const sockets = [];
  const collectors = [];
  const testRunId = Date.now();
  const openedSockets = new Set();
  const cleanupFailures = [];
  let testError = null;
  const matchIds = [];

  for (let i = 0; i < PLAYER_COUNT; i++) {
    const client = new Client(NAKAMA_SERVER_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_SSL);
    const id = `smoke2v2_p${i + 1}_${testRunId}`;
    assert(TEST_ID_REGEX.test(id), `Invalid test ID: ${id}`);
    const session = await client.authenticateCustom(`browser:${id}`, true, `Commander2v2_${i + 1}_${testRunId}`, {
      platform: 'browser',
      init_data: `user_id=${id}&username=Commander2v2_${i + 1}_${testRunId}`,
    });
    assert(session?.user_id && UUID_REGEX.test(session.user_id), `Player ${i + 1} invalid user_id`);
    const socket = client.createSocket(NAKAMA_SSL, false);
    openedSockets.add(socket);
    await socket.connect(session, false);
    clients.push(client);
    sessions.push(session);
    sockets.push(socket);
    collectors.push(createCollector(socket));
  }
  console.log(`  ${PLAYER_COUNT} clients authenticated with distinct user_ids and connected.\n`);

  try {
    // ------------------------------------------------------------------
    // Scenario 1+2: lying tickets pooled into ONE 2v2 match
    // ------------------------------------------------------------------
    console.log('[SCENARIO 1] All four submit LYING matchmaker tickets (1v1 query, no properties)...');
    let matchedIds = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      sockets[i].onmatchmakermatched = (matched) => {
        if (matched?.match_id) matchedIds[i] = matched.match_id;
      };
    }

    for (let i = 0; i < PLAYER_COUNT; i++) {
      // Deliberately wrong: an empty query like the 1v1 client
      // (`addMatchmaker('', 2, 2)`) but with four-player counts. The server
      // hook must classify and pin it. nakama-js takes positional args.
      await sockets[i].addMatchmaker('', 4, 4);
    }
    console.log('  Four lying tickets submitted; waiting for the pool to complete...');

    // Nakama's matchmaker cadence can exceed 10s on a cold or contended CI
    // runner. Keep this above the client's 15s queue boundary so the smoke
    // test measures correctness rather than scheduler timing.
    for (let i = 0; i < 300; i++) {
      if (matchedIds.filter(Boolean).length === PLAYER_COUNT) break;
      await sleep(100);
    }
    assert(
      matchedIds.filter(Boolean).length === PLAYER_COUNT,
      `Expected all four onmatchmakermatched callbacks, got ${matchedIds.filter(Boolean).length}`
    );
    // The matchmaker hands out the raw Nakama match id; the canonical
    // live2v2_* id arrives inside the authoritative match_started payload.
    const rawMatchId = matchedIds[0];
    for (let i = 1; i < PLAYER_COUNT; i++) {
      assert(matchedIds[i] === rawMatchId, `Player ${i + 1} matched into ${matchedIds[i]}, expected ${rawMatchId}`);
    }
    assert(rawMatchId.includes('.crownclash'), `Unexpected raw match id: ${rawMatchId}`);
    console.log(`  All four pooled into one authoritative 2v2 match: ${rawMatchId}\n`);

    // ------------------------------------------------------------------
    // Scenario 3: join and receive match_started
    // ------------------------------------------------------------------
    console.log('[SCENARIO 2] All four join the match and signal ready...');
    for (let i = 0; i < PLAYER_COUNT; i++) {
      await sockets[i].joinMatch(rawMatchId);
    }
    // The match starts the countdown when everyone has joined and starts
    // playing when all four signal ready (early start).
    for (let i = 0; i < PLAYER_COUNT; i++) {
      await sockets[i].sendMatchState(rawMatchId, 1, JSON.stringify({
        schemaVersion: 2, type: 'ready', sequence: 0,
      }));
    }
    for (let i = 0; i < 50; i++) {
      if (collectors.every((c) => c.started)) break;
      await sleep(100);
    }
    // Slot assignment is draft-based (trophies, then user id), not join
    // order: index the collectors by their authoritative slot.
    const bySlot = [];
    const slotsByClient = [];
    const seenSlots = new Set();
    for (let i = 0; i < PLAYER_COUNT; i++) {
      assert(collectors[i].started, `Player ${i + 1} did not receive OP_MATCH_STARTED`);
      const started = collectors[i].started;
      assert(started.schemaVersion === 2, `Player ${i + 1} schemaVersion = ${started.schemaVersion}, want 2`);
      assert(started.mode === '2v2', `Player ${i + 1} mode = ${started.mode}, want 2v2`);
      if (i === 0) {
        assert(MATCH_ID_REGEX.test(started.matchId), `canonical 2v2 match ID malformed: ${started.matchId}`);
      }
      assert(started.matchId === collectors[0].started.matchId, `Player ${i + 1} matchId mismatch`);
      assert(!seenSlots.has(started.slot) && started.slot >= 0 && started.slot < 4, `Player ${i + 1} invalid slot ${started.slot}`);
      seenSlots.add(started.slot);
      bySlot[started.slot] = i;
      slotsByClient[i] = started.slot;
      const teamIds = started.players.map((p) => p.teamId).sort();
      assert(JSON.stringify(teamIds) === JSON.stringify(['a', 'a', 'b', 'b']), `Team distribution wrong: ${teamIds}`);
      assert(started.teamId === (started.slot < 2 ? 'a' : 'b'), `Player ${i + 1} teamId = ${started.teamId} for slot ${started.slot}`);
      const territories = started.state.territories;
      const playerOwned = Object.values(territories).filter((t) => t.owner === 'player');
      assert(playerOwned.length === 2, `Player ${i + 1} perspective must show exactly 2 own-team bases, got ${playerOwned.length}`);
    }
    const matchId = collectors[0].started.matchId;
    console.log(`  All four received OP_MATCH_STARTED (schemaVersion 2), canonical id ${matchId}.`);
    console.log(`  Slot order: ${bySlot.map((clientIndex, slot) => `slot${slot}->p${clientIndex + 1}`).join(', ')}\n`);

    // ------------------------------------------------------------------
    // Scenario 4: teammate dispatch accepted on shared territory
    // ------------------------------------------------------------------
    console.log('[SCENARIO 3] Teammate dispatch from a shared team base...');
    const started0 = collectors[bySlot[0]].started;
    const playerBase0 = Object.entries(started0.state.territories).find(([, t]) => t.owner === 'player' && t.units > 0);
    assert(playerBase0, 'No player-owned base with units for slot 0');
    const [sourceId] = playerBase0;
    const targetEntry = Object.entries(started0.state.territories).find(([id, t]) => t.owner !== 'player' && id !== sourceId);
    assert(targetEntry, 'No neutral/enemy target territory');
    const targetId = targetEntry[0];
    console.log(`  Slot 0 dispatching ${sourceId} -> ${targetId}, sequence 0`);

    // All client messages target the raw Nakama match id.
    await sockets[bySlot[0]].sendMatchState(rawMatchId, 1, JSON.stringify({
      schemaVersion: 2, type: 'dispatch', sequence: 0, sourceId, targetId,
    }));
    for (let i = 0; i < 50; i++) {
      if (collectors[bySlot[0]].accepted.length > 0 && collectors[bySlot[1]].states.some((s) => s.armies?.length > 0)) break;
      await sleep(100);
    }
    assert(collectors[bySlot[0]].accepted.length > 0, 'Slot 0 received no OP_COMMAND_ACCEPTED');
    assert(collectors[bySlot[0]].accepted[0].sequence === 0, 'Accepted sequence mismatch');
    assert(collectors[bySlot[0]].accepted[0].slot === 0, 'Accepted slot mismatch');
    const teammateState = collectors[bySlot[1]].states.find((s) => s.armies?.length > 0);
    assert(teammateState, 'Teammate (slot 1) did not receive the marching army in authoritative state');
    assert(
      teammateState.armies.some((a) => a.sourceId === sourceId && a.targetId === targetId),
      'Army in teammate state does not match the dispatch'
    );
    console.log('  Dispatch accepted; both team-A slots share the authoritative action.\n');

    // ------------------------------------------------------------------
    // Scenario 5: cross-team + invalid sequences rejected
    // ------------------------------------------------------------------
    console.log('[SCENARIO 4] Cross-team dispatch and sequence violations rejected...');
    // Slot 0 tries to dispatch from a team-B base (enemy-owned from their perspective).
    const enemyBaseEntry = Object.entries(started0.state.territories).find(([, t]) => t.owner === 'enemy');
    assert(enemyBaseEntry, 'No enemy-owned base visible for the rejection test');
    await sockets[bySlot[0]].sendMatchState(rawMatchId, 1, JSON.stringify({
      schemaVersion: 2, type: 'dispatch', sequence: 1, sourceId: enemyBaseEntry[0], targetId,
    }));
    // Stale sequence replay (0 already consumed).
    await sockets[bySlot[0]].sendMatchState(rawMatchId, 1, JSON.stringify({
      schemaVersion: 2, type: 'dispatch', sequence: 0, sourceId, targetId,
    }));
    // Sequence gap.
    await sockets[bySlot[1]].sendMatchState(rawMatchId, 1, JSON.stringify({
      schemaVersion: 2, type: 'dispatch', sequence: 99, sourceId, targetId,
    }));

    for (let i = 0; i < 50; i++) {
      if (collectors[bySlot[0]].rejected.length >= 2 && collectors[bySlot[1]].rejected.length >= 1) break;
      await sleep(100);
    }
    const crossTeam = collectors[bySlot[0]].rejected.find((r) => r.code === 'invalid_dispatch');
    const stale = collectors[bySlot[0]].rejected.find((r) => r.code === 'invalid_sequence' && r.sequence === 0);
    const gap = collectors[bySlot[1]].rejected.find((r) => r.code === 'invalid_sequence' && r.sequence === 99);
    assert(crossTeam, 'Cross-team dispatch was not rejected with invalid_dispatch');
    assert(stale, 'Stale sequence (0) was not rejected with invalid_sequence');
    assert(gap, 'Sequence gap (99) was not rejected with invalid_sequence');
    console.log('  invalid_dispatch and invalid_sequence rejections verified.\n');

    // ------------------------------------------------------------------
    // Scenario 5: slot-preserving reconnect within the 30 s grace window
    // ------------------------------------------------------------------
    console.log('[SCENARIO 5] Unexpected drop + reconnect restores the slot...');
    const reconnectClientIndex = bySlot[0];
    const reconnectSession = sessions[reconnectClientIndex];
    const reconnectStarted = collectors[reconnectClientIndex].started;
    const oldSocket = sockets[reconnectClientIndex];

    // Slot 0 has consumed exactly sequence 0 (accepted in scenario 3).
    console.log(`  Disconnecting slot 0 (player ${reconnectClientIndex + 1}) unexpectedly...`);
    oldSocket.disconnect(false);

    // Fresh socket on the SAME authenticated session, inside the grace.
    const reconnectedSocket = clients[reconnectClientIndex].createSocket(NAKAMA_SSL, false);
    openedSockets.add(reconnectedSocket);
    await reconnectedSocket.connect(reconnectSession, false);
    const reconnectCollector = createCollector(reconnectedSocket);
    collectors[reconnectClientIndex] = reconnectCollector;
    sockets[reconnectClientIndex] = reconnectedSocket;

    await reconnectedSocket.joinMatch(rawMatchId);
    console.log('  Rejoined the same match on a brand-new socket.');

    for (let i = 0; i < 60; i++) {
      if (reconnectCollector.started) break;
      await sleep(100);
    }
    assert(reconnectCollector.started, 'Reconnected slot did not receive the v2 resync (OP_MATCH_STARTED)');
    const resync = reconnectCollector.started;
    assert(resync.schemaVersion === 2, `Resync schemaVersion = ${resync.schemaVersion}, want 2`);
    assert(resync.matchId === matchId, `Resync matchId mismatch: ${resync.matchId}`);
    assert(resync.slot === reconnectStarted.slot, `Resync slot = ${resync.slot}, want ${reconnectStarted.slot}`);
    assert(resync.teamId === reconnectStarted.teamId, `Resync teamId = ${resync.teamId}, want ${reconnectStarted.teamId}`);
    assert(resync.nextSequence === 1, `Resync nextSequence = ${resync.nextSequence}, want 1 (sequence 0 accepted pre-drop)`);
    assert(
      resync.players.length === 4 &&
      JSON.stringify(resync.players.map((p) => p.slot).sort()) === JSON.stringify([0, 1, 2, 3]),
      'Resync roster must contain all four slots'
    );
    assert(resync.state && resync.state.territories && Object.keys(resync.state.territories).length >= 13, 'Resync state must be a full authoritative snapshot');
    console.log(`  Same slot/team restored; nextSequence=${resync.nextSequence}; full snapshot received.`);

    // A stale pre-disconnect sequence is rejected on the new session.
    await reconnectedSocket.sendMatchState(rawMatchId, 1, JSON.stringify({
      schemaVersion: 2, type: 'dispatch', sequence: 0, sourceId, targetId,
    }));
    // The next correct sequence is accepted.
    await reconnectedSocket.sendMatchState(rawMatchId, 1, JSON.stringify({
      schemaVersion: 2, type: 'dispatch', sequence: 1, sourceId, targetId,
    }));
    for (let i = 0; i < 50; i++) {
      if (reconnectCollector.rejected.length > 0 && reconnectCollector.accepted.length > 0) break;
      await sleep(100);
    }
    const staleReconnect = reconnectCollector.rejected.find((r) => r.code === 'invalid_sequence' && r.sequence === 0);
    const acceptedReconnect = reconnectCollector.accepted.find((r) => r.sequence === 1);
    assert(staleReconnect, 'Stale post-reconnect sequence 0 was not rejected');
    assert(acceptedReconnect, 'Post-reconnect sequence 1 was not accepted');
    console.log('  Stale sequence rejected; next correct sequence accepted.\n');

    // ------------------------------------------------------------------
    // Scenario 6: team-B double surrender forfeits the team
    // ------------------------------------------------------------------
    console.log('[SCENARIO 6] Both team-B players surrender (team forfeit)...');
    for (const slot of [2, 3]) {
      await sockets[bySlot[slot]].sendMatchState(rawMatchId, 1, JSON.stringify({
        schemaVersion: 2, type: 'surrender', sequence: 0,
      }));
    }
    for (let i = 0; i < 100; i++) {
      if (collectors.every((c) => c.result)) break;
      await sleep(100);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      // Surrendering players are kicked at surrender time (§5.3), so only
      // the connected team-A slots receive the result broadcast. The
      // surrendered team's settlements are verified in PostgreSQL below.
      const slot = collectors[i].started.slot;
      if (slot >= 2) continue;
      assert(collectors[i].result, `Team-A player ${i + 1} did not receive OP_MATCH_RESULT`);
      const result = collectors[i].result.result;
      assert(result.matchId === matchId, `Player ${i + 1} result matchId mismatch`);
      assert(result.mode === '2v2', `Player ${i + 1} result mode mismatch`);
      assert(result.winnerTeamId === 'a', `winnerTeamId = ${result.winnerTeamId}, want 'a'`);
      assert(result.participants.length === 4, 'Result must contain all four participants');
      for (const participant of result.participants) {
        const wantStatus = participant.teamId === 'a' ? 'victory' : 'defeat';
        assert(participant.status === wantStatus, `Slot ${participant.slot} status = ${participant.status}, want ${wantStatus}`);
        assert(participant.settlement, `Slot ${participant.slot} missing settlement`);
        assert(participant.settlement.breakdown.totalCoins > 0, `Slot ${participant.slot} paid no coins`);
        assert(participant.settlement.breakdown.trophyDelta === 0, `Slot ${participant.slot} trophyDelta = ${participant.settlement.breakdown.trophyDelta}, want 0 (casual)`);
      }
    }
    console.log('  Team forfeit settled atomically; connected players received per-participant results.\n');

    // ------------------------------------------------------------------
    // Scenario 7: PostgreSQL verification (4 settlements + replay + ledger)
    // ------------------------------------------------------------------
    console.log('[SCENARIO 7] PostgreSQL verification of atomic multi-settlement...');
    const settleCount = parseInt(
      queryPostgres(`SELECT COUNT(*) FROM match_settlements_multi WHERE match_id = '${matchId}';`).trim(),
      10
    );
    assert(settleCount === 4, `match_settlements_multi rows = ${settleCount}, want 4`);

    const statuses = queryPostgres(
      `SELECT user_id, slot, team_id, status FROM match_settlements_multi WHERE match_id = '${matchId}' ORDER BY slot;`
    ).trim().split('\n');
    assert(statuses.length === 4, 'Expected exactly four settlement rows');
    statuses.forEach((line, index) => {
      const [, slot, teamId, status] = line.split('|');
      assert(parseInt(slot, 10) === index, `Row ${index} has slot ${slot}`);
      assert(teamId === (index < 2 ? 'a' : 'b'), `Row ${index} team_id = ${teamId}`);
      assert(status === (index < 2 ? 'victory' : 'defeat'), `Row ${index} status = ${status}`);
      assert(sessions.some((s) => s.user_id === line.split('|')[0]), 'Settlement user_id is not one of the four clients');
    });

    const replay = queryPostgres(
      `SELECT mode, battlefield_id, payload IS NOT NULL AND payload::text != '' FROM match_replays WHERE match_id = '${matchId}';`
    ).trim().split('\n');
    assert(replay.length === 1 && replay[0] !== '', 'Expected exactly one match_replays row');
    const [replayMode, replayBattlefield, hasPayload] = replay[0].split('|');
    assert(replayMode === '2v2', `Replay mode = ${replayMode}, want 2v2`);
    assert(replayBattlefield === 'quad_citadel', `Replay battlefield = ${replayBattlefield}, want quad_citadel`);
    assert(hasPayload === 't', 'Replay payload JSONB is empty');

    for (let i = 0; i < PLAYER_COUNT; i++) {
      const userId = sessions[i].user_id;
      // Ledger ids embed the settlement timestamp; verify by count.
      const coinLedger = queryPostgres(
        `SELECT COUNT(*) FROM economy_ledger WHERE player_id = '${userId}' AND currency = 'coins' AND id LIKE '${matchId}\_%';`
      ).trim();
      assert(coinLedger === '1', `Player ${i + 1} has ${coinLedger} match coins ledger entries, want exactly 1 (idempotency)`);
      const trophyLedger = queryPostgres(
        `SELECT COUNT(*) FROM economy_ledger WHERE player_id = '${userId}' AND currency = 'trophies';`
      ).trim();
      assert(trophyLedger === '0', `Player ${i + 1} has ${trophyLedger} trophy ledger entries, want 0 (casual policy)`);
    }
    console.log('  4 settlement rows, 1 replay row, one coins ledger entry per participant verified.\n');

    matchIds.push(matchId);
  } catch (err) {
    testError = err;
  } finally {
    console.log('\n[CLEANUP] Cleaning up test resources...');
    for (const socket of openedSockets) {
      try {
        socket.disconnect(false);
      } catch {
        // Ignored
      }
    }
    openedSockets.clear();
    console.log('  All WebSockets disconnected.');

    for (let i = 0; i < PLAYER_COUNT; i++) {
      const session = sessions[i];
      if (!session?.user_id) continue;
      const label = `Player ${i + 1}`;
      try {
        cleanDatabaseForPlayer(session.user_id, matchIds[i]);
        console.log(`  PostgreSQL records removed for ${label}.`);
      } catch (err) {
        cleanupFailures.push({ operation: `${label} DB cleanup`, error: err });
      }
      try {
        await clients[i].deleteAccount(session);
        console.log(`  Nakama user account deleted for ${label}.`);
      } catch (err) {
        cleanupFailures.push({ operation: `${label} deleteAccount`, error: err });
      }
      try {
        verifyZeroRemainingRows(session.user_id, label);
        console.log(`  PostgreSQL zero-row verification passed for ${label}.`);
      } catch (err) {
        cleanupFailures.push({ operation: `${label} zero-row verification`, error: err });
      }
    }
  }

  if (testError) {
    throw testError;
  }
  if (cleanupFailures.length > 0) {
    throw new Error(`Smoke test failed due to ${cleanupFailures.length} cleanup failure(s).`);
  }

  console.log('================================================================');
  console.log('  SUCCESS: ALL 2V2 LIVE END-TO-END SCENARIOS VERIFIED!          ');
  console.log('================================================================');
}

runSmokeTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[SMOKE TEST FAILED]:', err);
    process.exit(1);
  });

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
 * 8. Career and daily progress counters advanced exactly once by the
 *    settled match (no double-application on settlement retries).
 * 9. Second match: an idle battlefield runs to the 90 s time limit and
 *    settles as a symmetric draw for all four connected participants
 *    (20 base coins, zero trophies). All four then vote rematch: a fresh
 *    match id is created with identical slots/teams and a pristine state;
 *    after it starts, both team-B slots surrender, the rematch forfeits
 *    and settles while every player row still exists.
 * 10. Third match: slot 3 drops and exhausts the 30 s grace (abandoned,
 *    no forfeit while the teammate fights on), the surviving team-B slot
 *    surrenders (team forfeit), the abandoned slot's settlement is the
 *    reduced consolation (10 coins, no bonuses, zero trophies); three
 *    rematch votes never trigger a rematch and the window expiry ends the
 *    match cleanly.
 * 11. PostgreSQL inspection for all settled matches (forfeit, draw,
 *    rematch forfeit, abandoned consolation): exactly 4
 *    match_settlements_multi rows and 1 match_replays row each (mode 2v2,
 *    JSONB payload present), exactly one coins ledger entry per
 *    participant per match (no trophy entries), and career/daily counters
 *    equal exactly 4. Cancel-with-zero-settlements during countdown is
 *    proven at the Go unit level (live2v2_test.go).
 * 11. Analytics ingestion through the real analytics/events RPC: five
 *    client-shaped events (match_start, forged match_end,
 *    match_reward_received, live_match_ended, 2v2 match_quit) are stored
 *    exactly once, forged result/duration/slot/team fields are normalized
 *    from the authoritative settlement and replay rows, duplicate delivery
 *    is absorbed, forged properties and nonexistent settlements fail
 *    closed, and no user identifiers leak into event properties.
 * 12. Self-cleaning account/record removal in `finally`.
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
UNION ALL SELECT 'analytics_events', COUNT(*) FROM analytics_events WHERE player_id = '${userId}'
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
  const collected = { started: null, states: [], accepted: [], rejected: [], result: null, rematchStarted: null };
  socket.onmatchdata = (data) => {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data.data));
      switch (data.op_code) {
        case OP_MATCH_STARTED:
          if (parsed.type === 'rematch_started') collected.rematchStarted = parsed;
          else collected.started = parsed;
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
    // Scenario 7: three rematch votes (the surrendered slot 2 was kicked
    // and cannot vote) must never trigger a rematch; the window expiry
    // ends the finished match cleanly. Career/daily advanced exactly once.
    // ------------------------------------------------------------------
    console.log('[SCENARIO 7] Three rematch votes time out with no rematch; counters applied exactly once...');
    const match1Collectors = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      match1Collectors.push(createCollector(sockets[i]));
    }
    // Connected after the forfeit: slots 0, 1 (team A) and slot 3 (its
    // surrender was rejected once the match had finished). Slot 2 was
    // kicked at surrender time and cannot vote (§5.3).
    for (const slot of [0, 1, 3]) {
      await sockets[bySlot[slot]].sendMatchState(rawMatchId, 1, JSON.stringify({
        schemaVersion: 2, type: 'rematch_vote', sequence: 0,
      }));
    }
    await sleep(12000);
    for (let i = 0; i < PLAYER_COUNT; i++) {
      assert(!match1Collectors[i].rematchStarted, 'Three votes must never trigger a rematch');
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const userId = sessions[i].user_id;
      const careerPlayed = queryPostgres(`SELECT matches_played FROM players WHERE id = '${userId}';`).trim();
      assert(careerPlayed === '1', `Player ${i + 1} career matches_played = ${careerPlayed}, want exactly 1 (settlement retries must not double-apply)`);
      const dailyPlayed = queryPostgres(`SELECT matches_played FROM player_daily_progress WHERE player_id = '${userId}';`).trim();
      assert(dailyPlayed === '1', `Player ${i + 1} daily matches_played = ${dailyPlayed}, want exactly 1`);
    }
    console.log('  Three votes expired silently; career and daily counters show exactly one settled match per player.\n');

    // ------------------------------------------------------------------
    // Scenario 8: an idle match runs to the 90 s time limit and settles as
    // a symmetric DRAW with all four slots connected. All four then vote
    // rematch: a fresh match id is created with identical slots, and one
    // explicit countdown surrender cancels it with zero settlements.
    // ------------------------------------------------------------------
    console.log('[SCENARIO 8] Deadline draw settles all four; rematch succeeds; countdown surrender cancels cleanly...');
    matchedIds = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      collectors[i] = createCollector(sockets[i]);
      sockets[i].onmatchmakermatched = (matched) => {
        if (matched?.match_id) matchedIds[i] = matched.match_id;
      };
      await sockets[i].addMatchmaker('', 4, 4);
    }
    for (let i = 0; i < 300; i++) {
      if (matchedIds.filter(Boolean).length === PLAYER_COUNT && matchedIds.every((id) => id && id !== rawMatchId)) break;
      await sleep(100);
    }
    assert(matchedIds.filter(Boolean).length === PLAYER_COUNT, 'Match 2: not all four players were matched');
    const rawMatchId2 = matchedIds[0];
    for (let i = 1; i < PLAYER_COUNT; i++) {
      assert(matchedIds[i] === rawMatchId2, `Match 2: Player ${i + 1} matched into ${matchedIds[i]}, expected ${rawMatchId2}`);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      await sockets[i].joinMatch(rawMatchId2);
      await sockets[i].sendMatchState(rawMatchId2, 1, JSON.stringify({
        schemaVersion: 2, type: 'ready', sequence: 0,
      }));
    }
    for (let i = 0; i < 100; i++) {
      if (collectors.every((c) => c.started)) break;
      await sleep(100);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      assert(collectors[i].started, `Match 2: Player ${i + 1} did not receive OP_MATCH_STARTED`);
    }
    assert(collectors.every((c) => c.started.matchId !== matchId), 'Match 2 must have a fresh canonical id');
    const matchId2 = collectors[0].started.matchId;
    matchIds.push(matchId2);
    const bySlot2 = collectors.map((c) => c.started.slot);
    const clientForSlot2 = [];
    for (let i = 0; i < PLAYER_COUNT; i++) clientForSlot2[bySlot2[i]] = i;
    console.log(`  Match 2 started: ${matchId2}; slot order ${bySlot2.map((slot, i) => `slot${slot}->p${i + 1}`).join(', ')}`);

    // Idle to the 90 s time limit (no dispatches: symmetric careers make
    // the draw deterministic). States must keep flowing meanwhile.
    const statesMidway = collectors[clientForSlot2[0]].states.length;
    await sleep(45000);
    assert(
      collectors[clientForSlot2[0]].states.length > statesMidway,
      'Match 2: authoritative states stopped flowing during the idle draw wait'
    );
    for (let i = 0; i < 1050; i++) {
      if (collectors.every((c) => c.result)) break;
      await sleep(100);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      assert(collectors[i].result, `Match 2: Player ${i + 1} did not receive the deadline OP_MATCH_RESULT`);
      const result = collectors[i].result.result;
      assert(result.matchId === matchId2, 'Match 2: result matchId mismatch');
      assert(result.winnerTeamId === '', `Match 2: winnerTeamId = ${result.winnerTeamId}, want '' (draw)`);
      assert(result.participants.length === 4, 'Match 2: result must contain all four participants');
      for (const participant of result.participants) {
        assert(participant.status === 'draw', `Match 2: slot ${participant.slot} status = ${participant.status}, want draw`);
        assert(participant.settlement.breakdown.trophyDelta === 0, 'Match 2: draw must not change trophies (casual)');
        assert(participant.settlement.breakdown.baseCoins === 20, `Match 2: draw base coins = ${participant.settlement.breakdown.baseCoins}, want 20`);
      }
    }
    console.log('  Deadline draw settled all four connected participants atomically.');

    // All four vote rematch (every slot still connected). The fresh match
    // keeps the identical slot order and a pristine state; after it starts
    // (all four ready), both team B slots surrender and the forfeit
    // settlement is verified while every player row still exists.
    const rematchCollectors = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      rematchCollectors.push(createCollector(sockets[i]));
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      await sockets[i].sendMatchState(rawMatchId2, 1, JSON.stringify({
        schemaVersion: 2, type: 'rematch_vote', sequence: 0,
      }));
    }
    for (let i = 0; i < 100; i++) {
      if (rematchCollectors.every((c) => c.rematchStarted)) break;
      await sleep(100);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      assert(rematchCollectors[i].rematchStarted, `Match 2: Player ${i + 1} did not receive the rematch_started broadcast`);
      const started = rematchCollectors[i].rematchStarted;
      assert(started.matchId && started.matchId !== rawMatchId2, `Match 2: rematch id not fresh: ${started.matchId}`);
      assert(started.matchId === rematchCollectors[0].rematchStarted.matchId, 'Match 2: rematch id mismatch');
    }
    const rematchRawId = rematchCollectors[0].rematchStarted.matchId;
    console.log(`  All four voted: rematch created with a fresh match id ${rematchRawId}.`);

    for (let i = 0; i < PLAYER_COUNT; i++) {
      await sockets[i].joinMatch(rematchRawId);
      await sockets[i].sendMatchState(rematchRawId, 1, JSON.stringify({
        schemaVersion: 2, type: 'ready', sequence: 0,
      }));
    }
    for (let i = 0; i < 100; i++) {
      if (rematchCollectors.every((c) => c.started)) break;
      await sleep(100);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      assert(rematchCollectors[i].started, `Match 2: Player ${i + 1} did not receive the rematch OP_MATCH_STARTED`);
      const started = rematchCollectors[i].started;
      assert(started.schemaVersion === 2 && started.mode === '2v2', 'Match 2: rematch start payload invalid');
      assert(started.slot === collectors[i].started.slot, `Match 2: rematch slot ${started.slot} != original ${collectors[i].started.slot}`);
      assert(started.teamId === collectors[i].started.teamId, 'Match 2: rematch teamId changed');
      assert(started.matchId !== matchId2, 'Match 2: rematch must carry a fresh canonical match id');
      assert(JSON.stringify(started.state.territories) === JSON.stringify(collectors[i].started.state.territories), 'Match 2: rematch must reset to the pristine initial state');
    }
    const rematchCanonicalId = rematchCollectors[0].started.matchId;
    matchIds.push(rematchCanonicalId);

    // Both team B slots surrender from playing: the team forfeits and the
    // settlement is written while every player row still exists.
    for (const slot of [2, 3]) {
      await sockets[clientForSlot2[slot]].sendMatchState(rematchRawId, 1, JSON.stringify({
        schemaVersion: 2, type: 'surrender', sequence: 0,
      }));
      await sleep(300);
    }
    for (let i = 0; i < 100; i++) {
      if (rematchCollectors[clientForSlot2[0]].result && rematchCollectors[clientForSlot2[1]].result) break;
      await sleep(100);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      if (rematchCollectors[i].rejected.length) {
        console.log(`  DEBUG client ${i + 1} rematch rejections: ${JSON.stringify(rematchCollectors[i].rejected)}`);
      }
    }
    for (const clientIndex of [clientForSlot2[0], clientForSlot2[1]]) {
      assert(rematchCollectors[clientIndex].result, `Match 2 rematch: Player ${clientIndex + 1} did not receive the forfeit result`);
      const result = rematchCollectors[clientIndex].result.result;
      assert(result.matchId === rematchCanonicalId, 'Match 2 rematch: result must reference the rematch canonical id');
      assert(result.winnerTeamId === 'a', `Match 2 rematch: winnerTeamId = ${result.winnerTeamId}, want a`);
      assert(result.participants.length === 4, 'Match 2 rematch: all four participants must be settled');
      for (const participant of result.participants) {
        const want = participant.teamId === 'a' ? 'victory' : 'defeat';
        assert(participant.status === want, `Match 2 rematch: slot ${participant.slot} status = ${participant.status}, want ${want}`);
      }
    }
    // Career/daily advanced exactly once more (the rematch settled).
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const userId = sessions[i].user_id;
      assert(
        queryPostgres(`SELECT matches_played FROM players WHERE id = '${userId}';`).trim() === '3',
        `Player ${i + 1} career matches_played must be exactly 3 after the rematch`
      );
    }
    console.log('  Rematch kept identical slots and a pristine state; the team-B forfeit settled while players existed.\n');

    // ------------------------------------------------------------------
    // Scenario 9: third match — abandoned consolation (30 s grace), then
    // the teammate's surrender forfeits the team.
    // ------------------------------------------------------------------
    console.log('[SCENARIO 9] Third match: abandoned slot consolation and team forfeit...');
    matchedIds = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      collectors[i] = createCollector(sockets[i]);
      sockets[i].onmatchmakermatched = (matched) => {
        if (matched?.match_id) matchedIds[i] = matched.match_id;
      };
      await sockets[i].addMatchmaker('', 4, 4);
    }
    for (let i = 0; i < 300; i++) {
      if (matchedIds.filter(Boolean).length === PLAYER_COUNT && matchedIds.every((id) => id && id !== rawMatchId && id !== rawMatchId2)) break;
      await sleep(100);
    }
    assert(matchedIds.filter(Boolean).length === PLAYER_COUNT, 'Match 3: not all four players were matched');
    const rawMatchId3 = matchedIds[0];
    for (let i = 1; i < PLAYER_COUNT; i++) {
      assert(matchedIds[i] === rawMatchId3, `Match 3: Player ${i + 1} matched into ${matchedIds[i]}, expected ${rawMatchId3}`);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      await sockets[i].joinMatch(rawMatchId3);
      await sockets[i].sendMatchState(rawMatchId3, 1, JSON.stringify({
        schemaVersion: 2, type: 'ready', sequence: 0,
      }));
    }
    for (let i = 0; i < 100; i++) {
      if (collectors.every((c) => c.started)) break;
      await sleep(100);
    }
    for (let i = 0; i < PLAYER_COUNT; i++) {
      assert(collectors[i].started, `Match 3: Player ${i + 1} did not receive OP_MATCH_STARTED`);
    }
    const matchId3 = collectors[0].started.matchId;
    matchIds.push(matchId3);
    const bySlot3 = collectors.map((c) => c.started.slot);
    const clientForSlot3 = [];
    for (let i = 0; i < PLAYER_COUNT; i++) clientForSlot3[bySlot3[i]] = i;
    console.log(`  Match 3 started: ${matchId3}; slot order ${bySlot3.map((slot, i) => `slot${slot}->p${i + 1}`).join(', ')}`);

    // Slot 3 drops unexpectedly: the 30 s grace runs; the match continues.
    const droppedClient = clientForSlot3[3];
    console.log(`  Match 3: slot 3 (player ${droppedClient + 1}) disconnects unexpectedly...`);
    sockets[droppedClient].disconnect(false);

    const statesBefore = collectors[clientForSlot3[0]].states.length;
    await sleep(32000);
    const statesAfter = collectors[clientForSlot3[0]].states.length;
    assert(statesAfter > statesBefore, 'Match 3: authoritative states stopped flowing during the grace window');
    for (const clientIndex of [clientForSlot3[0], clientForSlot3[1], clientForSlot3[2]]) {
      assert(!collectors[clientIndex].result, 'Match 3: a single abandoned slot must not end the match');
    }
    console.log('  30 s grace expired: slot 3 abandoned, the match kept running (no forfeit).');

    // The remaining team-B slot surrenders: team forfeit, atomic settle of 4.
    await sockets[clientForSlot3[2]].sendMatchState(rawMatchId3, 1, JSON.stringify({
      schemaVersion: 2, type: 'surrender', sequence: 0,
    }));
    for (let i = 0; i < 100; i++) {
      if (collectors[clientForSlot3[0]].result && collectors[clientForSlot3[1]].result) break;
      await sleep(100);
    }
    // The surrendering slot 2 is kicked before the result broadcast, so only
    // the surviving team-A clients receive OP_MATCH_RESULT (as in match 1).
    for (const clientIndex of [clientForSlot3[0], clientForSlot3[1]]) {
      assert(collectors[clientIndex].result, `Match 3: player ${clientIndex + 1} did not receive OP_MATCH_RESULT`);
      assert(!collectors[clientForSlot3[2]].result, 'Match 3: the kicked surrendering slot must not receive the result');
      const result = collectors[clientIndex].result.result;
      assert(result.matchId === matchId3, 'Match 3: result matchId mismatch');
      assert(result.winnerTeamId === 'a', 'Match 3: team-B forfeit must crown team A');
      const abandoned = result.participants.find((participant) => participant.slot === 3);
      assert(abandoned, 'Match 3: result must contain the abandoned slot 3');
      assert(abandoned.abandoned === true, 'Match 3: slot 3 must be flagged abandoned in the result payload');
      assert(abandoned.status === 'defeat', 'Match 3: abandoned slot must settle at the defeat tier');
      const breakdown = abandoned.settlement.breakdown;
      assert(
        breakdown.baseCoins === 10 && breakdown.speedBonus === 0 && breakdown.dominationBonus === 0 &&
        breakdown.streakBonus === 0 && breakdown.treasuryBonus === 0 && breakdown.totalCoins === 10 &&
        breakdown.trophyDelta === 0,
        `Match 3: abandoned consolation breakdown wrong: ${JSON.stringify(breakdown)}`
      );
    }
    console.log('  Team forfeit settled; the abandoned slot received the reduced consolation (10 coins, no bonuses).\n');

    // ------------------------------------------------------------------
    // Scenario 10: PostgreSQL verification — all four settled matches
    // atomic (forfeit, draw, rematch forfeit, abandoned consolation), the
    // abandoned slot's stored settlement carries the consolation, and the
    // counters advanced exactly once per settled match.
    // ------------------------------------------------------------------
    console.log('[SCENARIO 10] PostgreSQL verification of all matches and the counters...');
    const expectedStatuses = new Map([
      [matchId, ['victory', 'victory', 'defeat', 'defeat']],
      [matchId2, ['draw', 'draw', 'draw', 'draw']],
      [rematchCanonicalId, ['victory', 'victory', 'defeat', 'defeat']],
      [matchId3, ['victory', 'victory', 'defeat', 'defeat']],
    ]);
    for (const [settledMatchId, wanted] of expectedStatuses) {
      const settleCount = parseInt(
        queryPostgres(`SELECT COUNT(*) FROM match_settlements_multi WHERE match_id = '${settledMatchId}';`).trim(),
        10
      );
      assert(settleCount === 4, `match_settlements_multi rows for ${settledMatchId} = ${settleCount}, want 4`);

      const statuses = queryPostgres(
        `SELECT user_id, slot, team_id, status FROM match_settlements_multi WHERE match_id = '${settledMatchId}' ORDER BY slot;`
      ).trim().split('\n');
      assert(statuses.length === 4, `Expected exactly four settlement rows for ${settledMatchId}`);
      statuses.forEach((line, index) => {
        const [, slot, teamId, status] = line.split('|');
        assert(parseInt(slot, 10) === index, `Row ${index} has slot ${slot}`);
        assert(teamId === (index < 2 ? 'a' : 'b'), `Row ${index} team_id = ${teamId}`);
        assert(status === wanted[index], `Row ${index} status = ${status}, want ${wanted[index]}`);
        assert(sessions.some((s) => s.user_id === line.split('|')[0]), 'Settlement user_id is not one of the four clients');
      });

      const replay = queryPostgres(
        `SELECT mode, battlefield_id, payload IS NOT NULL AND payload::text != '' FROM match_replays WHERE match_id = '${settledMatchId}';`
      ).trim().split('\n');
      assert(replay.length === 1 && replay[0] !== '', `Expected exactly one match_replays row for ${settledMatchId}`);
      const [replayMode, replayBattlefield, hasPayload] = replay[0].split('|');
      assert(replayMode === '2v2', `Replay mode = ${replayMode}, want 2v2`);
      assert(replayBattlefield === 'quad_citadel', `Replay battlefield = ${replayBattlefield}, want quad_citadel`);
      assert(hasPayload === 't', 'Replay payload JSONB is empty');
    }
    console.log('  All four settled matches: 4 settlement rows and 1 replay row each, statuses correct.');

    // The abandoned slot's stored settlement JSON carries the consolation.
    const abandonedUserId = sessions[droppedClient].user_id;
    const consolation = queryPostgres(
      `SELECT (settlement->>'status') || '|' ||
              (settlement->'breakdown'->>'baseCoins') || '|' ||
              (settlement->'breakdown'->>'totalCoins') || '|' ||
              (settlement->'breakdown'->>'trophyDelta')
       FROM match_settlements_multi WHERE match_id = '${matchId3}' AND user_id = '${abandonedUserId}';`
    ).trim();
    assert(consolation === 'defeat|10|10|0', `Abandoned consolation stored = ${consolation}, want defeat|10|10|0`);

    for (let i = 0; i < PLAYER_COUNT; i++) {
      const userId = sessions[i].user_id;
      assert(
        queryPostgres(`SELECT matches_played FROM players WHERE id = '${userId}';`).trim() === '4',
        `Player ${i + 1} career matches_played must be exactly 4 after four settled matches`
      );
      assert(
        queryPostgres(`SELECT matches_played FROM player_daily_progress WHERE player_id = '${userId}';`).trim() === '2',
        `Player ${i + 1} daily matches_played must be capped at exactly 2`
      );
      const coinLedger = queryPostgres(
        `SELECT COUNT(*) FROM economy_ledger WHERE player_id = '${userId}' AND currency = 'coins' AND (id LIKE '${matchId}\_%' OR id LIKE '${matchId2}\_%' OR id LIKE '${rematchCanonicalId}\_%' OR id LIKE '${matchId3}\_%');`
      ).trim();
      assert(coinLedger === '4', `Player ${i + 1} has ${coinLedger} match coin ledger entries, want exactly 4 (one per settled match)`);
      const trophyLedger = queryPostgres(
        `SELECT COUNT(*) FROM economy_ledger WHERE player_id = '${userId}' AND currency = 'trophies';`
      ).trim();
      assert(trophyLedger === '0', `Player ${i + 1} has ${trophyLedger} trophy ledger entries, want 0 (casual policy)`);
    }
    console.log('  The abandoned consolation persisted exactly; counters advanced exactly once per settled match.\n');

    // ------------------------------------------------------------------
    // Scenario 11: analytics ingestion through the REAL analytics/events
    // RPC. The client-shaped batch (match_start, forged match_end,
    // match_reward_received, live_match_ended, match_quit) must be stored
    // exactly once; 2v2 result/reward fields must be normalized from the
    // stored settlement and replay rows; duplicates absorbed; forged
    // properties and nonexistent settlements must fail closed; and no user
    // identifiers may leak into event properties.
    // ------------------------------------------------------------------
    console.log('[SCENARIO 11] Analytics ingestion proof through the real RPC...');
    const analyticsMatchId = matchId; // match 1: settled forfeit, all four participants stored
    const analyticsClientIndex = bySlot[2]; // match 1's defeat player in slot 2
    const analyticsUserId = sessions[analyticsClientIndex].user_id;
    const analyticsSessionKey = `smoke_analytics_${analyticsMatchId}`.slice(0, 64);
    const occurredAt = Date.now();
    const analyticsBatch = [
      {
        eventId: 'smoke_a_start', name: 'match_start', sessionId: analyticsSessionKey,
        occurredAt, schemaVersion: 1,
        props: { matchId: analyticsMatchId, mode: '2v2', source: 'menu', battlefieldId: 'quad_citadel', slot: 2, teamId: 'b' },
      },
      {
        // Forged on purpose: result/duration/slot/team must be overwritten
        // from the authoritative defeat settlement during normalization.
        eventId: 'smoke_a_end', name: 'match_end', sessionId: analyticsSessionKey,
        occurredAt, schemaVersion: 1,
        props: { matchId: analyticsMatchId, mode: '2v2', result: 'victory', durationSeconds: 999, slot: 0, teamId: 'a' },
      },
      {
        eventId: 'smoke_a_reward', name: 'match_reward_received', sessionId: analyticsSessionKey,
        occurredAt, schemaVersion: 1,
        props: { matchId: analyticsMatchId, mode: '2v2' },
      },
      {
        eventId: 'smoke_a_live', name: 'live_match_ended', sessionId: analyticsSessionKey,
        occurredAt, schemaVersion: 1,
        props: { matchId: analyticsMatchId, status: 'defeat' },
      },
      {
        eventId: 'smoke_a_quit', name: 'match_quit', sessionId: analyticsSessionKey,
        occurredAt, schemaVersion: 1,
        props: { matchId: analyticsMatchId, mode: '2v2', durationSeconds: 40 },
      },
    ];
    const analyticsPayloadString = JSON.stringify({ events: analyticsBatch });
    // The game's NakamaClient submits analytics over the WebSocket rpc (the
    // HTTP client.rpc path double-wraps the payload) — mirror that exactly.
    const submitAnalytics = async () => parseRpcPayload(
      await sockets[analyticsClientIndex].rpc('analytics/events', analyticsPayloadString)
    );
    const firstIngestion = await submitAnalytics();
    assert(firstIngestion.accepted === 5 && firstIngestion.inserted === 5 && firstIngestion.duplicates === 0,
      `first analytics ingestion = ${JSON.stringify(firstIngestion)}, want accepted 5, inserted 5, duplicates 0`);

    const storedEvents = queryPostgres(
      `SELECT event_id || '|' || props FROM analytics_events WHERE player_id = '${analyticsUserId}' AND session_id = '${analyticsSessionKey}' ORDER BY event_id;`
    ).trim().split('\n');
    assert(storedEvents.length === 5, `analytics_events rows = ${storedEvents.length}, want 5 (stored exactly once)`);

    // Duplicate delivery: absorbed idempotently, no second rows.
    const duplicateIngestion = await submitAnalytics();
    assert(duplicateIngestion.inserted === 0 && duplicateIngestion.duplicates === 5,
      `duplicate analytics ingestion = ${JSON.stringify(duplicateIngestion)}, want inserted 0, duplicates 5`);
    assert(queryPostgres(
      `SELECT COUNT(*) FROM analytics_events WHERE player_id = '${analyticsUserId}' AND session_id = '${analyticsSessionKey}';`
    ).trim() === '5', 'duplicate analytics delivery must not add rows');

    const propsByEventId = {};
    for (const line of storedEvents) {
      const separator = line.indexOf('|');
      propsByEventId[line.slice(0, separator)] = JSON.parse(line.slice(separator + 1));
    }

    // The stored settlement is the normalization source of truth.
    const storedSettlement = queryPostgres(
      `SELECT slot::text || '|' || team_id || '|' ||
              (settlement->>'status') || '|' ||
              (settlement->'stats'->>'matchDurationSeconds') || '|' ||
              (settlement->'breakdown'->>'baseCoins') || '|' ||
              (settlement->'breakdown'->>'totalCoins') || '|' ||
              (settlement->'breakdown'->>'trophyDelta') || '|' ||
              (settlement->'newCareer'->>'coins')
       FROM match_settlements_multi WHERE match_id = '${analyticsMatchId}' AND user_id = '${analyticsUserId}';`
    ).trim().split('|');
    const [storedSlot, storedTeamId, storedStatus, storedDuration, storedBaseCoins, storedTotalCoins, storedTrophyDelta, storedResultingCoins] = storedSettlement;

    const endProps = propsByEventId['smoke_a_end'];
    assert(endProps.result === storedStatus, `match_end result = ${endProps.result}, want authoritative ${storedStatus} (forged 'victory' must not survive)`);
    assert(String(endProps.durationSeconds) === storedDuration, `match_end duration = ${endProps.durationSeconds}, want authoritative ${storedDuration} (forged 999 must not survive)`);
    assert(String(endProps.slot) === storedSlot && String(endProps.teamId) === storedTeamId, `match_end slot/team = ${endProps.slot}/${endProps.teamId}, want authoritative ${storedSlot}/${storedTeamId}`);
    assert(endProps.battlefieldId === 'quad_citadel', `match_end battlefieldId = ${endProps.battlefieldId}, want quad_citadel from the replay row`);

    const rewardProps = propsByEventId['smoke_a_reward'];
    assert(String(rewardProps.baseCoins) === storedBaseCoins && String(rewardProps.totalCoins) === storedTotalCoins && String(rewardProps.trophyDelta) === storedTrophyDelta,
      `reward values = ${JSON.stringify(rewardProps)}, want authoritative ${storedBaseCoins}/${storedTotalCoins}/${storedTrophyDelta}`);
    assert(String(rewardProps.resultingCoins) === storedResultingCoins, `resultingCoins = ${rewardProps.resultingCoins}, want authoritative ${storedResultingCoins}`);
    assert(Object.keys(rewardProps).every((key) => !/user/i.test(key)), 'reward properties must not carry user identifier keys');

    assert(propsByEventId['smoke_a_quit'].mode === '2v2', '2v2 match_quit must be accepted and stored');
    assert(propsByEventId['smoke_a_start'].slot === 2 && propsByEventId['smoke_a_start'].teamId === 'b', 'match_start attribution stored as submitted');

    // No user identifiers in ANY stored event properties.
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const userId = sessions[i].user_id;
      assert(
        queryPostgres(`SELECT COUNT(*) FROM analytics_events WHERE props::text LIKE '%${userId}%' OR props ? 'userId';`).trim() === '0',
        'user identifiers must never leak into analytics event properties'
      );
    }

    // Forged extra properties (an invented reward field) are rejected.
    const forgedExtra = JSON.stringify({
      events: [{ ...analyticsBatch[1], eventId: 'smoke_a_forged', props: { ...analyticsBatch[1].props, coins: 9999 } }],
    });
    let rejectedForged = false;
    try {
      await sockets[analyticsClientIndex].rpc('analytics/events', forgedExtra);
    } catch {
      rejectedForged = true;
    }
    assert(rejectedForged, 'match_end with an invented reward property must be rejected');
    assert(queryPostgres(`SELECT COUNT(*) FROM analytics_events WHERE event_id = 'smoke_a_forged';`).trim() === '0', 'rejected events must not store rows');

    // A nonexistent settlement id fails closed with the domain code.
    let bogusError = '';
    try {
      await sockets[analyticsClientIndex].rpc('analytics/events', JSON.stringify({
        events: [{
          eventId: 'smoke_a_bogus', name: 'match_end', sessionId: analyticsSessionKey,
          occurredAt, schemaVersion: 1,
          props: { matchId: 'live2v2_bogus_missing', mode: '2v2', result: 'victory', durationSeconds: 1 },
        }],
      }));
    } catch (err) {
      bogusError = String(err?.message ?? err);
    }
    assert(bogusError.includes('analytics_settlement_not_found'), `nonexistent settlement must fail closed, got: ${bogusError}`);
    assert(queryPostgres(`SELECT COUNT(*) FROM analytics_events WHERE event_id = 'smoke_a_bogus';`).trim() === '0', 'failed-closed events must not store rows');

    console.log('  Analytics: 5 events stored exactly once; forged fields normalized away; quit accepted; no identifier leaks; failures closed.\n');

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
        for (const matchId of matchIds) {
          cleanDatabaseForPlayer(session.user_id, matchId);
        }
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

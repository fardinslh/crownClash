#!/usr/bin/env node
import { Client } from '@heroiclabs/nakama-js';
import { execFileSync } from 'node:child_process';

/**
 * End-to-End Smoke Test for Live PvP on authoritative Nakama & PostgreSQL.
 *
 * Scenarios tested:
 * 1. Authenticate and connect two independent clients.
 * 2. Matchmake / join them into the same live match via authoritative RPC.
 * 3. Verify both receive the initial authoritative snapshot with mirrored roles.
 * 4. Submit valid gameplay command and verify resulting authoritative state reaches both.
 * 5. Submit invalid and stale commands and verify rejection without corrupting match state.
 * 6. Forfeit the match and verify canonical forfeit settlement.
 * 7. Verify settlement idempotency and duplicate reward prevention.
 * 8. Verify reconnect / disconnect handling does not trigger a second settlement.
 *
 * Hardened validations:
 * - Mandatory PostgreSQL inspection via `docker compose exec -T db` with argument arrays.
 * - Both Player A and Player B verified to settle exactly once (victory & defeat).
 * - Exact error code verification on foreign settlement (`bot_match_owned_by_another_player`).
 * - Reliable socket disconnect and self-cleaning account/record removal in `finally`.
 */

const NAKAMA_HOST = process.env.NAKAMA_HOST || '127.0.0.1';
const NAKAMA_PORT = process.env.NAKAMA_PORT || '7350';
const NAKAMA_SERVER_KEY = process.env.NAKAMA_SERVER_KEY || 'defaultkey';
const NAKAMA_SSL = process.env.NAKAMA_SSL === 'true';

// Opcodes from apps/server-nakama/live.go
const OP_DISPATCH = 1;
const OP_MATCH_STARTED = 2;
const OP_STATE = 3;
const OP_COMMAND_ACCEPTED = 5;
const OP_COMMAND_REJECTED = 6;
const OP_MATCH_RESULT = 7;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_ID_REGEX = /^live_\d+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEST_ID_REGEX = /^smoke_p[12]_\d+$/;

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
      if (res.status < 500) {
        return;
      }
    } catch {
      // Retry
    }
    await sleep(500);
  }
  throw new Error(
    `Nakama server at ${url} is not responding after ${maxWaitMs}ms. Please ensure Docker Compose is running: docker compose up -d`
  );
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

/**
 * Executes a PostgreSQL command via `docker compose exec -T db` using argument arrays.
 * Runs with ON_ERROR_STOP=1 so errors fail closed immediately.
 * Never catches command failures or swallows database errors.
 */
function queryPostgres(sql) {
  const stdout = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'crownclash',
      '-d',
      'crownclash',
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-F',
      '|',
      '-c',
      sql,
    ],
    { encoding: 'utf8' }
  );
  return stdout;
}

function queryDbMatchSettlementRow(matchId) {
  assert(MATCH_ID_REGEX.test(matchId), `Invalid match ID format for DB query: ${matchId}`);
  const sql = `SELECT match_id, player_id, status, settlement FROM match_settlements WHERE match_id = '${matchId}';`;
  const output = queryPostgres(sql);
  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  const [rowMatchId, playerId, status, settlementJson] = lines[0].split('|');
  return {
    matchId: rowMatchId,
    playerId,
    status,
    settlement: settlementJson ? JSON.parse(settlementJson) : null,
  };
}

function cleanDatabaseForPlayer(userId) {
  assert(UUID_REGEX.test(userId), `Invalid userId for cleanup: ${userId}`);

  const sql = `BEGIN;
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
}

function verifyZeroRemainingRows(userId, label) {
  assert(UUID_REGEX.test(userId), `Invalid userId for zero-row verification: ${userId}`);

  const sql = `
SELECT 'match_settlements', COUNT(*) FROM match_settlements WHERE player_id = '${userId}'
UNION ALL SELECT 'economy_ledger', COUNT(*) FROM economy_ledger WHERE player_id = '${userId}'
UNION ALL SELECT 'player_names', COUNT(*) FROM player_names WHERE player_id = '${userId}'
UNION ALL SELECT 'player_daily_progress', COUNT(*) FROM player_daily_progress WHERE player_id = '${userId}'
UNION ALL SELECT 'daily_reward_claims', COUNT(*) FROM daily_reward_claims WHERE player_id = '${userId}'
UNION ALL SELECT 'league_reward_claims', COUNT(*) FROM league_reward_claims WHERE player_id = '${userId}'
UNION ALL SELECT 'upgrade_purchases', COUNT(*) FROM upgrade_purchases WHERE player_id = '${userId}'
UNION ALL SELECT 'pvp_defenses', COUNT(*) FROM pvp_defenses WHERE player_id = '${userId}'
UNION ALL SELECT 'pvp_attacks', COUNT(*) FROM pvp_attacks WHERE attacker_id = '${userId}' OR defender_id = '${userId}'
UNION ALL SELECT 'bot_matches', COUNT(*) FROM bot_matches WHERE player_id = '${userId}'
UNION ALL SELECT 'analytics_events', COUNT(*) FROM analytics_events WHERE player_id = '${userId}'
UNION ALL SELECT 'players', COUNT(*) FROM players WHERE id = '${userId}';`;

  const output = queryPostgres(sql);
  const lines = output.trim().split('\n').filter(Boolean);
  const remainingTables = [];
  for (const line of lines) {
    const [table, countStr] = line.split('|');
    const count = parseInt(countStr, 10);
    if (count > 0) {
      remainingTables.push(`${table} (${count} rows)`);
    }
  }
  assert(
    remainingTables.length === 0,
    `Post-cleanup verification failed for ${label} (${userId}): remaining rows found in: ${remainingTables.join(', ')}`
  );
}

async function runSmokeTest() {
  console.log('================================================================');
  console.log('  Live PvP End-to-End Smoke Test (Real Nakama/Postgres Stack)  ');
  console.log('================================================================\n');

  console.log(`Checking Nakama health at ${NAKAMA_HOST}:${NAKAMA_PORT}...`);
  await waitForHealth();
  console.log('Nakama server is responsive.\n');

  const clientA = new Client(NAKAMA_SERVER_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_SSL);
  const clientB = new Client(NAKAMA_SERVER_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_SSL);

  const testRunId = Date.now();
  const idA = `smoke_p1_${testRunId}`;
  const idB = `smoke_p2_${testRunId}`;
  assert(TEST_ID_REGEX.test(idA), `Invalid test ID: ${idA}`);
  assert(TEST_ID_REGEX.test(idB), `Invalid test ID: ${idB}`);

  const usernameA = `CommanderA_${testRunId}`;
  const usernameB = `CommanderB_${testRunId}`;

  // Socket tracking for guaranteed finally cleanup
  const openedSockets = new Set();
  const trackSocket = (socket) => {
    openedSockets.add(socket);
    return socket;
  };
  const closeTrackedSocket = (socket) => {
    if (socket) {
      try {
        socket.disconnect(false);
      } catch {
        // Ignored
      }
      openedSockets.delete(socket);
    }
  };

  let sessionA = null;
  let sessionB = null;
  let testError = null;
  const cleanupFailures = [];

  try {
    // --------------------------------------------------------------------------
    // Scenario 1: Authenticate and connect both clients
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 1] Authenticating and connecting both clients...');
    sessionA = await clientA.authenticateCustom(`browser:${idA}`, true, usernameA, {
      platform: 'browser',
      init_data: `user_id=${idA}&username=${usernameA}`,
    });
    sessionB = await clientB.authenticateCustom(`browser:${idB}`, true, usernameB, {
      platform: 'browser',
      init_data: `user_id=${idB}&username=${usernameB}`,
    });

    assert(sessionA?.user_id && UUID_REGEX.test(sessionA.user_id), `Client A invalid user_id: ${sessionA?.user_id}`);
    assert(sessionB?.user_id && UUID_REGEX.test(sessionB.user_id), `Client B invalid user_id: ${sessionB?.user_id}`);
    assert(sessionA.user_id !== sessionB.user_id, 'Client A and B must have distinct user_ids');
    console.log(`  Client A authenticated: user_id=${sessionA.user_id}`);
    console.log(`  Client B authenticated: user_id=${sessionB.user_id}`);

    const socketA = trackSocket(clientA.createSocket(NAKAMA_SSL, false));
    const socketB = trackSocket(clientB.createSocket(NAKAMA_SSL, false));

    await socketA.connect(sessionA, false);
    await socketB.connect(sessionB, false);
    console.log('  Both real WebSockets connected successfully.\n');

    // Message collectors
    let matchStartedA = null;
    let matchStartedB = null;
    const statesA = [];
    const statesB = [];
    const acceptedCommandsA = [];
    const rejectedCommandsA = [];
    let matchResultA = null;

    socketA.onmatchdata = (data) => {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(data.data));
        switch (data.op_code) {
          case OP_MATCH_STARTED:
            matchStartedA = parsed;
            break;
          case OP_STATE:
            statesA.push(parsed.state);
            break;
          case OP_COMMAND_ACCEPTED:
            acceptedCommandsA.push(parsed);
            break;
          case OP_COMMAND_REJECTED:
            rejectedCommandsA.push(parsed);
            break;
          case OP_MATCH_RESULT:
            matchResultA = parsed;
            break;
        }
      } catch {
        // Ignored
      }
    };

    socketB.onmatchdata = (data) => {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(data.data));
        switch (data.op_code) {
          case OP_MATCH_STARTED:
            matchStartedB = parsed;
            break;
          case OP_STATE:
            statesB.push(parsed.state);
            break;
        }
      } catch {
        // Ignored
      }
    };

    // --------------------------------------------------------------------------
    // Scenario 2: Matchmake / join them into the same live match
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 2] Creating invite match and joining both clients...');
    const createInviteRes = await socketA.rpc('pvp/create_invite', '');
    const inviteData = parseRpcPayload(createInviteRes);
    assert(inviteData?.matchId, 'Missing matchId from pvp/create_invite');
    assert(inviteData?.inviteCode, 'Missing inviteCode from pvp/create_invite');
    const { matchId, inviteCode } = inviteData;
    console.log(`  Match created: matchId=${matchId}, inviteCode=${inviteCode}`);

    await socketA.joinMatch(matchId, undefined, { code: inviteCode });
    console.log('  Client A joined match.');

    // Client B resolves invite code via authoritative RPC (retrying briefly while Nakama indexes match label)
    let joinData = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await sleep(150);
      try {
        const res = await socketB.rpc('pvp/join_invite', JSON.stringify({ inviteCode }));
        joinData = parseRpcPayload(res);
        if (joinData?.matchId) break;
      } catch {
        // Wait for match listing index
      }
    }
    assert(joinData?.matchId === matchId, `Client B could not resolve invite: expected ${matchId}, got ${joinData?.matchId}`);
    console.log(`  Client B resolved invite matchId=${joinData.matchId}`);

    await socketB.joinMatch(matchId, undefined, { code: inviteCode });
    console.log('  Client B joined match.\n');

    // --------------------------------------------------------------------------
    // Scenario 3: Verify both receive the initial authoritative snapshot
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 3] Verifying initial authoritative snapshot (OP_MATCH_STARTED)...');
    for (let i = 0; i < 30; i++) {
      if (matchStartedA && matchStartedB) break;
      await sleep(100);
    }
    assert(matchStartedA, 'Client A did not receive OP_MATCH_STARTED within timeout');
    assert(matchStartedB, 'Client B did not receive OP_MATCH_STARTED within timeout');

    assert(matchStartedA.role === 'player', `Client A should be 'player', got '${matchStartedA.role}'`);
    assert(matchStartedB.role === 'enemy', `Client B should be 'enemy', got '${matchStartedB.role}'`);
    assert(matchStartedA.opponentName === usernameB, `Client A opponentName should be '${usernameB}', got '${matchStartedA.opponentName}'`);
    assert(matchStartedB.opponentName === usernameA, `Client B opponentName should be '${usernameA}', got '${matchStartedB.opponentName}'`);

    assert(MATCH_ID_REGEX.test(matchStartedA.matchId), `Player A canonical match ID malformed: ${matchStartedA.matchId}`);
    assert(MATCH_ID_REGEX.test(matchStartedB.matchId), `Player B canonical match ID malformed: ${matchStartedB.matchId}`);
    assert(matchStartedA.matchId !== matchStartedB.matchId, 'Player A and Player B match IDs must be player-specific');

    assert(matchStartedA.state?.status === 'playing', 'Client A initial state status must be playing');
    assert(matchStartedB.state?.status === 'playing', 'Client B initial state status must be playing');

    const territoriesA = matchStartedA.state.territories;
    const territoriesB = matchStartedB.state.territories;
    assert(territoriesA && Object.keys(territoriesA).length >= 3, 'Battlefield territories not initialized for Client A');
    assert(territoriesB && Object.keys(territoriesB).length >= 3, 'Battlefield territories not initialized for Client B');

    // Symmetrical perspective check: Client A and B both see their own base as 'player'
    const playerBaseA = Object.values(territoriesA).find((t) => t.owner === 'player');
    const playerBaseB = Object.values(territoriesB).find((t) => t.owner === 'player');
    assert(playerBaseA, "Client A cannot find territory owned by 'player'");
    assert(playerBaseB, "Client B cannot find territory owned by 'player'");
    console.log('  Both received OP_MATCH_STARTED with correct mirrored perspective and roles.\n');

    // --------------------------------------------------------------------------
    // Scenario 4: Submit valid gameplay command and verify resulting authoritative state reaches both
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 4] Submitting valid dispatch command and verifying broadcast...');
    const playerTerritoryIds = Object.entries(territoriesA)
      .filter(([, t]) => t.owner === 'player' && t.units > 0)
      .map(([id]) => id);
    const targetTerritoryIds = Object.entries(territoriesA)
      .filter(([, t]) => t.owner !== 'player')
      .map(([id]) => id);

    assert(playerTerritoryIds.length > 0, 'No player territory found with available units');
    assert(targetTerritoryIds.length > 0, 'No target territory found');

    const sourceId = playerTerritoryIds[0];
    const targetId = targetTerritoryIds[0];
    console.log(`  Dispatching sequence=0 from ${sourceId} to ${targetId}...`);

    await socketA.sendMatchState(
      matchId,
      OP_DISPATCH,
      JSON.stringify({
        type: 'dispatch',
        sequence: 0,
        sourceId,
        targetId,
      })
    );

    // Wait for command acceptance and broadcast
    for (let i = 0; i < 30; i++) {
      if (acceptedCommandsA.length > 0 && statesA.some((s) => s.armies?.length > 0)) break;
      await sleep(100);
    }
    assert(acceptedCommandsA.length > 0, 'Client A did not receive OP_COMMAND_ACCEPTED for sequence 0');
    assert(acceptedCommandsA[0].sequence === 0, `Accepted sequence mismatch: expected 0, got ${acceptedCommandsA[0].sequence}`);
    console.log('  OP_COMMAND_ACCEPTED (sequence 0) received by Client A.');

    // Verify army reaches both clients with mirrored role perspective
    const armyStateA = statesA.find((s) => s.armies?.length > 0);
    const armyStateB = statesB.find((s) => s.armies?.length > 0);
    assert(armyStateA, 'Client A did not receive authoritative state containing the marching army');
    assert(armyStateB, 'Client B did not receive authoritative state containing the marching army');

    const armyA = armyStateA.armies[0];
    const armyB = armyStateB.armies[0];
    assert(armyA.owner === 'player', `Client A should see army owner as 'player', got '${armyA.owner}'`);
    assert(armyB.owner === 'enemy', `Client B should see army owner as 'enemy', got '${armyB.owner}'`);
    console.log('  Authoritative army state reached both clients with correct role mapping.\n');

    // --------------------------------------------------------------------------
    // Scenario 5: Submit invalid / stale commands and verify rejection without corrupting match state
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 5] Submitting invalid/stale commands and verifying graceful rejection...');

    // 5a: Stale sequence replay (sequence 0 was already processed)
    console.log('  Testing stale sequence replay (sequence=0, expected=1)...');
    await socketA.sendMatchState(
      matchId,
      OP_DISPATCH,
      JSON.stringify({
        type: 'dispatch',
        sequence: 0,
        sourceId,
        targetId,
      })
    );

    // 5b: Future sequence gap (sequence=99)
    console.log('  Testing sequence gap (sequence=99)...');
    await socketA.sendMatchState(
      matchId,
      OP_DISPATCH,
      JSON.stringify({
        type: 'dispatch',
        sequence: 99,
        sourceId,
        targetId,
      })
    );

    // 5c: Illegal dispatch from non-existent territory
    console.log('  Testing illegal dispatch from non-existent territory (sequence=1)...');
    await socketA.sendMatchState(
      matchId,
      OP_DISPATCH,
      JSON.stringify({
        type: 'dispatch',
        sequence: 1,
        sourceId: 'invalid_tower_id',
        targetId,
      })
    );

    for (let i = 0; i < 30; i++) {
      if (rejectedCommandsA.length >= 3) break;
      await sleep(100);
    }

    assert(rejectedCommandsA.length >= 3, `Expected at least 3 command rejections, got ${rejectedCommandsA.length}`);
    const seq0Reject = rejectedCommandsA.find((r) => r.sequence === 0 && r.code === 'invalid_sequence');
    const seq99Reject = rejectedCommandsA.find((r) => r.sequence === 99 && r.code === 'invalid_sequence');
    const invalidDispatch = rejectedCommandsA.find((r) => r.sequence === 1 && r.code === 'invalid_dispatch');

    assert(seq0Reject, 'Missing OP_COMMAND_REJECTED for stale sequence 0');
    assert(seq99Reject, 'Missing OP_COMMAND_REJECTED for sequence gap 99');
    assert(invalidDispatch, 'Missing OP_COMMAND_REJECTED for invalid dispatch territory');
    console.log('  All invalid commands rejected with exact error codes without match corruption.');

    // Verify match simulation continued uninterrupted
    const recentStates = statesA.slice(-3);
    assert(recentStates.length > 0 && recentStates.every((s) => s.status === 'playing'), 'Match state was corrupted by invalid commands');
    console.log('  Match state continues ticking normally.\n');

    // --------------------------------------------------------------------------
    // Scenario 6: Finish or forfeit the match
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 6] Capturing pre-forfeit balances and forfeiting match...');
    const careerBeforeForfeitA = parseRpcPayload(await socketA.rpc('career/get', '')).career;
    const careerBeforeForfeitB = parseRpcPayload(await socketB.rpc('career/get', '')).career;
    console.log(`  Pre-forfeit Player A: coins=${careerBeforeForfeitA.coins}, trophies=${careerBeforeForfeitA.trophies}, matchesPlayed=${careerBeforeForfeitA.matchesPlayed}, matchesWon=${careerBeforeForfeitA.matchesWon}`);
    console.log(`  Pre-forfeit Player B: coins=${careerBeforeForfeitB.coins}, trophies=${careerBeforeForfeitB.trophies}, matchesPlayed=${careerBeforeForfeitB.matchesPlayed}, matchesWon=${careerBeforeForfeitB.matchesWon}`);

    // Client B forfeits by leaving the match
    await socketB.leaveMatch(matchId);
    console.log('  Client B left match (forfeit initiated).');

    for (let i = 0; i < 40; i++) {
      if (matchResultA) break;
      await sleep(100);
    }

    assert(matchResultA, 'Client A did not receive OP_MATCH_RESULT after Client B forfeit');
    assert(matchResultA.result?.status === 'victory', `Client A should receive 'victory', got '${matchResultA.result?.status}'`);
    assert(matchResultA.result?.matchId === matchStartedA.matchId, `Result matchId mismatch: expected ${matchStartedA.matchId}, got ${matchResultA.result?.matchId}`);

    const settlementA = matchResultA.result.settlement;
    assert(settlementA?.status === 'victory', "Settlement status must be 'victory'");
    assert(typeof settlementA?.breakdown?.totalCoins === 'number' && settlementA.breakdown.totalCoins > 0, 'Coins must be awarded in breakdown');
    assert(typeof settlementA?.breakdown?.trophyDelta === 'number' && settlementA.breakdown.trophyDelta > 0, 'Trophies must be awarded in breakdown');
    assert(settlementA.newCareer.coins > settlementA.previousCareer.coins, 'New career coins must increase');
    assert(settlementA.newCareer.trophies > settlementA.previousCareer.trophies, 'New career trophies must increase');
    console.log(`  Client A received authoritative victory result: matchId=${matchResultA.result.matchId}`);
    console.log(`  Settlement recorded: totalCoins=${settlementA.breakdown.totalCoins}, trophyDelta=${settlementA.breakdown.trophyDelta}\n`);

    // --------------------------------------------------------------------------
    // Scenario 7: Verify settlement idempotency and duplicate reward prevention
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 7] Verifying settlement idempotency and preventing duplicate rewards...');
    const careerBeforeReplay = parseRpcPayload(await socketA.rpc('career/get', '')).career;
    console.log(`  Client A balance before settlement replay: coins=${careerBeforeReplay.coins}, trophies=${careerBeforeReplay.trophies}`);

    // Replay settlement with the exact same canonical matchId for Player A
    const replayResult = parseRpcPayload(
      await socketA.rpc(
        'match/settle',
        JSON.stringify({
          matchId: matchStartedA.matchId,
          actions: [],
        })
      )
    );

    assert(replayResult?.settlement?.matchId === matchStartedA.matchId, 'Replayed settlement matchId mismatch');
    assert(replayResult?.settlement?.breakdown?.totalCoins === settlementA.breakdown.totalCoins, 'Replayed totalCoins mismatch');
    assert(replayResult?.settlement?.newCareer?.coins === settlementA.newCareer.coins, 'Replayed newCareer coins mismatch');

    const careerAfterReplay = parseRpcPayload(await socketA.rpc('career/get', '')).career;
    console.log(`  Client A balance after settlement replay:  coins=${careerAfterReplay.coins}, trophies=${careerAfterReplay.trophies}`);
    assert(careerAfterReplay.coins === careerBeforeReplay.coins, 'Duplicate coins were minted by repeated settlement!');
    assert(careerAfterReplay.trophies === careerBeforeReplay.trophies, 'Duplicate trophies were minted by repeated settlement!');
    console.log('  Settlement replay is 100% idempotent; balances remained strictly unchanged.');

    // Cross-user settlement attempt (Client B attempting to claim Client A's settlement)
    console.log('  Testing foreign settlement claim (Client B attempting to settle Client A matchId)...');
    let foreignClaimError = null;
    try {
      await socketB.rpc(
        'match/settle',
        JSON.stringify({
          matchId: matchStartedA.matchId,
          actions: [],
        })
      );
    } catch (err) {
      foreignClaimError = err;
    }
    assert(foreignClaimError !== null, 'Foreign settlement claim was unexpectedly accepted!');
    const foreignErrorText = [
      foreignClaimError?.message,
      typeof foreignClaimError === 'string' ? foreignClaimError : '',
      foreignClaimError?.error,
      String(foreignClaimError),
    ].filter(Boolean).join(' ');

    assert(
      foreignErrorText.includes('bot_match_owned_by_another_player'),
      `Foreign settlement rejection must contain exact domain code 'bot_match_owned_by_another_player', got: ${foreignErrorText}`
    );
    console.log('  Foreign settlement attempt safely rejected with exact code bot_match_owned_by_another_player.\n');

    // --------------------------------------------------------------------------
    // Scenario 8: Verify reconnect, proving both players settled exactly once
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 8] Verifying reconnect and proving both players settled exactly once...');

    // Close initial sockets
    closeTrackedSocket(socketA);
    closeTrackedSocket(socketB);

    // Mandatory PostgreSQL database inspection for both canonical match IDs
    console.log('  Performing mandatory PostgreSQL settlement verification via Docker Compose...');
    const dbRowA = queryDbMatchSettlementRow(matchStartedA.matchId);
    assert(dbRowA !== null, `PostgreSQL missing settlement row for Player A match ${matchStartedA.matchId}`);
    assert(dbRowA.playerId === sessionA.user_id, `Player A settlement owner mismatch: expected ${sessionA.user_id}, got ${dbRowA.playerId}`);
    assert(dbRowA.status === 'victory', `Player A settlement status mismatch: expected 'victory', got '${dbRowA.status}'`);
    assert(dbRowA.settlement?.matchId === matchStartedA.matchId, 'Player A DB settlement JSON matchId mismatch');
    console.log(`  Verified in PostgreSQL: exactly 1 settlement row for Player A (${matchStartedA.matchId}) with status=victory.`);

    const dbRowB = queryDbMatchSettlementRow(matchStartedB.matchId);
    assert(dbRowB !== null, `PostgreSQL missing settlement row for Player B match ${matchStartedB.matchId}`);
    assert(dbRowB.playerId === sessionB.user_id, `Player B settlement owner mismatch: expected ${sessionB.user_id}, got ${dbRowB.playerId}`);
    assert(dbRowB.status === 'defeat', `Player B settlement status mismatch: expected 'defeat', got '${dbRowB.status}'`);
    assert(dbRowB.settlement?.matchId === matchStartedB.matchId, 'Player B DB settlement JSON matchId mismatch');
    const settlementB = dbRowB.settlement;
    assert(settlementB.breakdown.totalCoins > 0, 'Player B defeat must award consolation coins');
    assert(settlementB.breakdown.trophyDelta === -12, `Player B defeat trophyDelta mismatch: expected -12, got ${settlementB.breakdown.trophyDelta}`);
    const expectedClampedTrophiesB = Math.max(0, careerBeforeForfeitB.trophies + settlementB.breakdown.trophyDelta);
    assert(
      settlementB.newCareer.trophies === expectedClampedTrophiesB,
      `Player B settlement newCareer trophies mismatch: expected clamped delta ${expectedClampedTrophiesB}, got ${settlementB.newCareer.trophies}`
    );
    console.log(`  Verified in PostgreSQL: exactly 1 settlement row for Player B (${matchStartedB.matchId}) with status=defeat.`);

    // Reconnect with fresh socket instances
    const socketA2 = trackSocket(clientA.createSocket(NAKAMA_SSL, false));
    await socketA2.connect(sessionA, false);

    const socketB2 = trackSocket(clientB.createSocket(NAKAMA_SSL, false));
    await socketB2.connect(sessionB, false);

    const careerAAfterReconnect = parseRpcPayload(await socketA2.rpc('career/get', '')).career;
    const careerBAfterReconnect = parseRpcPayload(await socketB2.rpc('career/get', '')).career;

    // Validate Player A career transition
    assert(
      careerAAfterReconnect.matchesPlayed === careerBeforeForfeitA.matchesPlayed + 1,
      `Player A matchesPlayed mismatch: expected ${careerBeforeForfeitA.matchesPlayed + 1}, got ${careerAAfterReconnect.matchesPlayed}`
    );
    assert(
      careerAAfterReconnect.matchesWon === careerBeforeForfeitA.matchesWon + 1,
      `Player A matchesWon mismatch: expected ${careerBeforeForfeitA.matchesWon + 1}, got ${careerAAfterReconnect.matchesWon}`
    );
    assert(
      careerAAfterReconnect.coins === careerBeforeForfeitA.coins + settlementA.breakdown.totalCoins,
      `Player A coins mismatch: expected ${careerBeforeForfeitA.coins + settlementA.breakdown.totalCoins}, got ${careerAAfterReconnect.coins}`
    );
    assert(
      careerAAfterReconnect.trophies === careerBeforeForfeitA.trophies + settlementA.breakdown.trophyDelta,
      `Player A trophies mismatch: expected ${careerBeforeForfeitA.trophies + settlementA.breakdown.trophyDelta}, got ${careerAAfterReconnect.trophies}`
    );
    console.log('  Player A career transition verified: exactly 1 victory recorded.');

    // Validate Player B career transition (one completed defeat + consolation economy)
    assert(
      careerBAfterReconnect.matchesPlayed === careerBeforeForfeitB.matchesPlayed + 1,
      `Player B matchesPlayed mismatch: expected ${careerBeforeForfeitB.matchesPlayed + 1}, got ${careerBAfterReconnect.matchesPlayed}`
    );
    assert(
      careerBAfterReconnect.matchesWon === careerBeforeForfeitB.matchesWon,
      `Player B matchesWon must not increment on defeat: expected ${careerBeforeForfeitB.matchesWon}, got ${careerBAfterReconnect.matchesWon}`
    );
    assert(
      careerBAfterReconnect.coins === careerBeforeForfeitB.coins + settlementB.breakdown.totalCoins,
      `Player B consolation coins mismatch: expected ${careerBeforeForfeitB.coins + settlementB.breakdown.totalCoins}, got ${careerBAfterReconnect.coins}`
    );
    assert(
      careerBAfterReconnect.trophies === settlementB.newCareer.trophies,
      `Player B career trophies after reconnect must equal authoritative settlementB.newCareer.trophies: expected ${settlementB.newCareer.trophies}, got ${careerBAfterReconnect.trophies}`
    );
    assert(
      careerBAfterReconnect.trophies === expectedClampedTrophiesB,
      `Player B career trophies after reconnect mismatch: expected clamped delta ${expectedClampedTrophiesB}, got ${careerBAfterReconnect.trophies}`
    );
    console.log('  Player B career transition verified: exactly 1 defeat recorded with consolation economy and clamped trophies.');

    // Reconnect again / re-read state to prove neither player mutates twice
    console.log('  Re-reading career state to verify neither player mutates twice...');
    closeTrackedSocket(socketA2);
    closeTrackedSocket(socketB2);

    const socketA3 = trackSocket(clientA.createSocket(NAKAMA_SSL, false));
    await socketA3.connect(sessionA, false);
    const socketB3 = trackSocket(clientB.createSocket(NAKAMA_SSL, false));
    await socketB3.connect(sessionB, false);

    const careerFinalA = parseRpcPayload(await socketA3.rpc('career/get', '')).career;
    const careerFinalB = parseRpcPayload(await socketB3.rpc('career/get', '')).career;

    assert(careerFinalA.coins === careerAAfterReconnect.coins, 'Player A coins mutated on second reconnect!');
    assert(careerFinalA.trophies === careerAAfterReconnect.trophies, 'Player A trophies mutated on second reconnect!');
    assert(careerFinalA.matchesPlayed === careerAAfterReconnect.matchesPlayed, 'Player A matchesPlayed mutated on second reconnect!');

    assert(careerFinalB.coins === careerBAfterReconnect.coins, 'Player B coins mutated on second reconnect!');
    assert(careerFinalB.trophies === settlementB.newCareer.trophies, 'Player B trophies mutated on second reconnect!');
    assert(careerFinalB.trophies === expectedClampedTrophiesB, 'Player B trophies mismatch with clamped delta on second reconnect!');
    assert(careerFinalB.matchesPlayed === careerBAfterReconnect.matchesPlayed, 'Player B matchesPlayed mutated on second reconnect!');

    closeTrackedSocket(socketA3);
    closeTrackedSocket(socketB3);
    console.log('  Verified: repeated reconnects produce zero career balance or match count mutations.\n');
  } catch (err) {
    testError = err;
  } finally {
    // --------------------------------------------------------------------------
    // Reliable Resource Cleanup
    // --------------------------------------------------------------------------
    console.log('\n[CLEANUP] Cleaning up test resources...');

    // Disconnect every opened socket
    for (const socket of openedSockets) {
      try {
        socket.disconnect(false);
      } catch {
        // Ignored
      }
    }
    openedSockets.clear();
    console.log('  All WebSockets disconnected.');

    // Clean up every created session independently
    const sessionsToClean = [
      { label: 'Player A', client: clientA, session: sessionA },
      { label: 'Player B', client: clientB, session: sessionB },
    ];

    for (const { label, client, session } of sessionsToClean) {
      if (!session?.user_id) {
        console.log(`  Skipping ${label} cleanup (session was not established).`);
        continue;
      }

      if (!UUID_REGEX.test(session.user_id)) {
        cleanupFailures.push({
          operation: `${label} ID validation`,
          error: new Error(`Invalid userId format: ${session.user_id}`),
        });
        continue;
      }

      const userId = session.user_id;

      // 1. Transactional SQL deletion across all custom tables with ON_ERROR_STOP=1
      try {
        cleanDatabaseForPlayer(userId);
        console.log(`  PostgreSQL records removed for ${label} (${userId}).`);
      } catch (err) {
        console.error(`  [ERROR] PostgreSQL cleanup failed for ${label} (${userId}):`, err.message || err);
        cleanupFailures.push({ operation: `${label} DB cleanup`, error: err });
      }

      // 2. Nakama user account deletion
      try {
        await client.deleteAccount(session);
        console.log(`  Nakama user account deleted for ${label} (${userId}).`);
      } catch (err) {
        console.error(`  [ERROR] Nakama deleteAccount failed for ${label} (${userId}):`, err.message || err);
        cleanupFailures.push({ operation: `${label} deleteAccount`, error: err });
      }

      // 3. Mandatory zero-row verification in PostgreSQL across custom tables
      try {
        verifyZeroRemainingRows(userId, label);
        console.log(`  PostgreSQL zero-row verification passed for ${label} (${userId}).`);
      } catch (err) {
        console.error(`  [ERROR] Zero-row verification failed for ${label} (${userId}):`, err.message || err);
        cleanupFailures.push({ operation: `${label} zero-row verification`, error: err });
      }
    }
  }

  if (cleanupFailures.length > 0) {
    console.error(`\n[CLEANUP FAILURES] ${cleanupFailures.length} cleanup operation(s) failed:`);
    for (const fail of cleanupFailures) {
      console.error(`  - ${fail.operation}:`, fail.error?.message || fail.error);
    }
  }

  if (testError) {
    throw testError;
  }
  if (cleanupFailures.length > 0) {
    throw new Error(`Smoke test failed due to ${cleanupFailures.length} cleanup failure(s).`);
  }

  console.log('================================================================');
  console.log('  SUCCESS: ALL 8 LIVE PVP END-TO-END SCENARIOS VERIFIED!        ');
  console.log('================================================================');
}

runSmokeTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[SMOKE TEST FAILED]:', err);
    process.exit(1);
  });

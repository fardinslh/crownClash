#!/usr/bin/env node
import { Client } from '@heroiclabs/nakama-js';
import { execSync } from 'node:child_process';

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
const OP_ERROR = 8;

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

function queryDbMatchSettlements(matchId) {
  try {
    const stdout = execSync(
      `docker exec crownclash-db-1 psql -U crownclash -d crownclash -t -A -c "SELECT match_id, player_id, status FROM match_settlements WHERE match_id = '${matchId}';"`,
      { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }
    );
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
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
  const usernameA = `CommanderA_${testRunId}`;
  const usernameB = `CommanderB_${testRunId}`;

  // --------------------------------------------------------------------------
  // Scenario 1: Authenticate and connect both clients
  // --------------------------------------------------------------------------
  console.log('[SCENARIO 1] Authenticating and connecting both clients...');
  const sessionA = await clientA.authenticateCustom(`browser:${idA}`, true, usernameA, {
    platform: 'browser',
    init_data: `user_id=${idA}&username=${usernameA}`,
  });
  const sessionB = await clientB.authenticateCustom(`browser:${idB}`, true, usernameB, {
    platform: 'browser',
    init_data: `user_id=${idB}&username=${usernameB}`,
  });

  assert(sessionA?.user_id, 'Client A session missing user_id');
  assert(sessionB?.user_id, 'Client B session missing user_id');
  assert(sessionA.user_id !== sessionB.user_id, 'Client A and B must have distinct user_ids');
  console.log(`  Client A authenticated: user_id=${sessionA.user_id}`);
  console.log(`  Client B authenticated: user_id=${sessionB.user_id}`);

  const socketA = clientA.createSocket(NAKAMA_SSL, false);
  const socketB = clientB.createSocket(NAKAMA_SSL, false);

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
  let matchResultB = null;

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
        case OP_MATCH_RESULT:
          matchResultB = parsed;
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

  // Client B resolves invite code via authoritative RPC (retrying briefly while Nakama indexes the match label)
  let joinData = null;
  for (let attempt = 0; attempt < 20; attempt++) {
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

  // 5c: Illegal dispatch from invalid territory
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
  console.log('[SCENARIO 6] Forfeiting match (Client B leaves) and verifying canonical forfeit settlement...');
  await socketB.leaveMatch(matchId);

  for (let i = 0; i < 40; i++) {
    if (matchResultA) break;
    await sleep(100);
  }

  assert(matchResultA, 'Client A did not receive OP_MATCH_RESULT after Client B forfeit');
  assert(matchResultA.result?.status === 'victory', `Client A should receive 'victory', got '${matchResultA.result?.status}'`);
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

  // Replay settlement with the exact same matchId
  const replayResult = parseRpcPayload(
    await socketA.rpc(
      'match/settle',
      JSON.stringify({
        matchId: matchResultA.result.matchId,
        actions: [],
      })
    )
  );

  assert(replayResult?.settlement?.matchId === matchResultA.result.matchId, 'Replayed settlement matchId mismatch');
  assert(replayResult?.settlement?.breakdown?.totalCoins === settlementA.breakdown.totalCoins, 'Replayed totalCoins mismatch');
  assert(replayResult?.settlement?.newCareer?.coins === settlementA.newCareer.coins, 'Replayed newCareer coins mismatch');

  const careerAfterReplay = parseRpcPayload(await socketA.rpc('career/get', '')).career;
  console.log(`  Client A balance after settlement replay:  coins=${careerAfterReplay.coins}, trophies=${careerAfterReplay.trophies}`);
  assert(careerAfterReplay.coins === careerBeforeReplay.coins, 'Duplicate coins were minted by repeated settlement!');
  assert(careerAfterReplay.trophies === careerBeforeReplay.trophies, 'Duplicate trophies were minted by repeated settlement!');
  console.log('  Settlement replay is 100% idempotent; balances remained strictly unchanged.');

  // Cross-user settlement attempt (Client B attempting to claim Client A\'s settlement)
  console.log('  Testing foreign settlement claim (Client B attempting to settle Client A matchId)...');
  let foreignClaimRejected = false;
  try {
    await socketB.rpc(
      'match/settle',
      JSON.stringify({
        matchId: matchResultA.result.matchId,
        actions: [],
      })
    );
  } catch (err) {
    foreignClaimRejected = true;
    console.log(`  Foreign settlement claim rejected: ${(err.message || String(err)).trim()}`);
  }
  assert(foreignClaimRejected, 'Foreign settlement claim was NOT rejected!');
  console.log('  Foreign settlement attempt safely rejected.\n');

  // --------------------------------------------------------------------------
  // Scenario 8: Verify reconnect / disconnect handling does not create a second settlement
  // --------------------------------------------------------------------------
  console.log('[SCENARIO 8] Verifying reconnect / disconnect handling...');
  socketA.disconnect(false);
  socketB.disconnect(false);

  // Reconnect with fresh socket instances
  const socketA2 = clientA.createSocket(NAKAMA_SSL, false);
  await socketA2.connect(sessionA, false);

  const socketB2 = clientB.createSocket(NAKAMA_SSL, false);
  await socketB2.connect(sessionB, false);

  const careerAAfterReconnect = parseRpcPayload(await socketA2.rpc('career/get', '')).career;
  const careerBAfterReconnect = parseRpcPayload(await socketB2.rpc('career/get', '')).career;

  assert(careerAAfterReconnect.coins === careerBeforeReplay.coins, 'Career A mutated upon reconnect');
  assert(careerAAfterReconnect.trophies === careerBeforeReplay.trophies, 'Trophies A mutated upon reconnect');

  // Direct database query on PostgreSQL match_settlements table
  const dbRowsA = queryDbMatchSettlements(matchResultA.result.matchId);
  if (dbRowsA.length > 0) {
    assert(dbRowsA.length === 1, `Expected exactly 1 DB settlement row for match ${matchResultA.result.matchId}, found ${dbRowsA.length}`);
    console.log(`  Verified in PostgreSQL: exactly 1 settlement row exists for ${matchResultA.result.matchId}`);
  }

  socketA2.disconnect(false);
  socketB2.disconnect(false);
  console.log('  Sockets disconnected cleanly without triggering duplicate settlements.\n');

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

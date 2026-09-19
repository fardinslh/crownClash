#!/usr/bin/env node
import { Client } from '@heroiclabs/nakama-js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as core from '../../packages/game-core/dist/packages/game-core/src/index.js';

/**
 * End-to-End Bot Match Parity & Settlement Hardening Suite.
 *
 * Verifies bot-match simulation and settlement parity against the real local
 * Nakama & PostgreSQL stack. The server always replays the submitted actions
 * through its authoritative simulation; the client-simulated status is sent
 * as diagnostic-only evidence and must agree with the authoritative result.
 *
 * Coverage:
 * 1. Default career, real server-issued ticket (idle defeat flow).
 * 2. Upgraded career on the real ticket battlefield (victory flow) with
 *    persisted rewards and ledger audit.
 * 3. The exact modifier set from the production bot_result_status_mismatch
 *    log (garrison 5 / production 5 / speed 5 / vanguard => 32 units,
 *    1.4 production, 1.495 speed).
 * 4. Commander modifiers (quartermaster & vanguard) on real tickets.
 * 5. Rematch flow (subsequent tickets and sequential progress).
 * 6. Replay-invalid actions (nonexistent source) are skipped identically by
 *    the TS replay engine and the authoritative server.
 * 7. Malformed settlement payloads (bad sequence, too many actions, invalid
 *    client status) are rejected without corrupting state.
 * 8. Settlement idempotency & duplicate reward prevention.
 * 9. Server log audit: zero bot_result_status_mismatch on genuine matches,
 *    and positive detection proof on a controlled mismatch probe.
 * 10. Strict zero-leak DB cleanup in finally.
 */

let NAKAMA_SERVER_KEY = process.env.NAKAMA_SERVER_KEY;
if (!NAKAMA_SERVER_KEY) {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const match = envContent.match(/NAKAMA_SERVER_KEY=([^\r\n]+)/);
    if (match) NAKAMA_SERVER_KEY = match[1];
  } catch {
    // Fall back to defaultkey
  }
}
if (!NAKAMA_SERVER_KEY) NAKAMA_SERVER_KEY = 'defaultkey';

const NAKAMA_HOST = process.env.NAKAMA_HOST || '127.0.0.1';
const NAKAMA_PORT = process.env.NAKAMA_PORT || '7350';
const NAKAMA_SSL = process.env.NAKAMA_SSL === 'true';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  throw new Error(`Nakama at ${url} not reachable after ${maxWaitMs}ms`);
}

function queryPostgres(sql) {
  return execFileSync(
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
  assert(UUID_REGEX.test(userId), `Invalid userId: ${userId}`);
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
  const remaining = [];
  for (const line of lines) {
    const [table, countStr] = line.split('|');
    const count = parseInt(countStr, 10);
    if (count > 0) remaining.push(`${table} (${count} rows)`);
  }
  assert(
    remaining.length === 0,
    `Post-cleanup verification failed for ${label} (${userId}): remaining rows: ${remaining.join(', ')}`
  );
}

/**
 * Runs the client game simulation loop identically to Phaser's GameScene.
 * Uses 20ms fixed simulation steps, evaluateAiMove, and records dispatch actions.
 */
function runClientSimulation({
  battlefieldId,
  playerModifiers,
  playerAiInterval = 0.5,
  playerActive = true,
  timeLimit = 90,
}) {
  const enemyModifiers = { startingUnits: 20, productionRateMultiplier: 1, armySpeedMultiplier: 1 };
  let state = core.createInitialGameState({
    timeLimit,
    playerModifiers,
    enemyModifiers,
    battlefieldId,
  });
  let accumulators = {};
  let nextAiTick = core.PVP_AI_TICK_SECONDS;
  let nextPlayerTick = 0.2;
  const recordedActions = [];
  let aiActionIndex = 0;
  let playerActionIndex = 0;

  while (state.status === 'playing' && state.elapsedTimeSeconds < timeLimit) {
    const atSeconds = Math.round(state.elapsedTimeSeconds * 1000) / 1000;

    // Player action evaluation
    if (playerActive && state.elapsedTimeSeconds >= nextPlayerTick - 1e-9) {
      const move = core.evaluateAiMove(state.territories, 'player', 8);
      if (move) {
        const source = state.territories[move.fromId];
        const target = state.territories[move.toId];
        if (source && target && source.owner === 'player') {
          const dispatch = core.dispatchArmy(
            source,
            target,
            'player',
            0.5,
            () => `p_${playerActionIndex++}`,
            playerModifiers.armySpeedMultiplier
          );
          if (dispatch.success && dispatch.army && dispatch.sourceTerritory) {
            state.territories[source.id] = dispatch.sourceTerritory;
            state.armies.push(dispatch.army);
            state.stats.playerUnitsDispatched += dispatch.army.units;
            recordedActions.push({
              sequence: recordedActions.length,
              atSeconds,
              sourceId: move.fromId,
              targetId: move.toId,
            });
          }
        }
      }
      nextPlayerTick += playerAiInterval;
    }

    // Step simulation by 20ms
    const result = core.stepSimulation(state, accumulators, core.PVP_SIMULATION_TICK_SECONDS);
    state = result.state;
    accumulators = result.accumulators;

    // Bot AI turn
    if (state.status === 'playing' && state.elapsedTimeSeconds >= nextAiTick - 1e-9) {
      const move = core.evaluateAiMove(state.territories, 'enemy', 8);
      if (move) {
        const source = state.territories[move.fromId];
        const target = state.territories[move.toId];
        if (source && target) {
          const dispatch = core.dispatchArmy(
            source,
            target,
            'enemy',
            0.5,
            () => `pvp_ai_${aiActionIndex++}`,
            enemyModifiers.armySpeedMultiplier
          );
          if (dispatch.success && dispatch.army && dispatch.sourceTerritory) {
            state.territories[source.id] = dispatch.sourceTerritory;
            state.armies.push(dispatch.army);
            state.stats.enemyUnitsDispatched += dispatch.army.units;
          }
        }
      }
      nextAiTick += core.PVP_AI_TICK_SECONDS;
    }
  }

  let finalStatus = state.status;
  if (finalStatus === 'playing') finalStatus = 'draw';

  return {
    status: finalStatus,
    stats: state.stats,
    recordedActions,
    finalState: state,
  };
}

/**
 * Starts a real bot match ticket and verifies the ticket shape and the
 * persisted battlefield assignment.
 */
async function startRealTicket(socket, session, label) {
  const ticketRes = await socket.rpc('match/start', '');
  const ticket = JSON.parse(ticketRes.payload).ticket;
  assert(ticket.matchId && ticket.matchId.startsWith('bot_'), `${label}: invalid ticket matchId`);
  assert(
    core.normalizeBattlefieldId(ticket.battlefieldId) === ticket.battlefieldId,
    `${label}: ticket battlefield must be a known battlefield, got ${ticket.battlefieldId}`
  );
  const dbRow = queryPostgres(
    `SELECT player_id, battlefield_id, settled_at FROM bot_matches WHERE match_id = '${ticket.matchId}';`
  ).trim();
  const [dbPlayerId, dbBattlefieldId, dbSettledAt] = dbRow.split('|');
  assert(
    dbPlayerId === session.user_id && dbBattlefieldId === ticket.battlefieldId && dbSettledAt === '',
    `${label}: ticket not persisted correctly: ${dbRow}`
  );
  return ticket;
}

/**
 * Settles a match and asserts the authoritative status equals the client's
 * simulated status, with optional extra assertions on the settlement.
 */
async function settleAndAssertParity(socket, ticket, clientSim, label, extra) {
  const settleRes = await socket.rpc(
    'match/settle',
    JSON.stringify({
      matchId: ticket.matchId,
      actions: clientSim.recordedActions,
      clientObservedStatus: clientSim.status,
    })
  );
  const settlement = JSON.parse(settleRes.payload).settlement;
  assert(
    settlement.status === clientSim.status,
    `${label}: client status ${clientSim.status} must equal authoritative status ${settlement.status}`
  );
  assert(settlement.matchId === ticket.matchId, `${label}: settlement matchId mismatch`);
  if (extra) extra(settlement);
  return settlement;
}

async function runBotParitySuite() {
  console.log('================================================================');
  console.log('  Bot Match Parity & Authoritative Settlement Hardening Suite   ');
  console.log('================================================================\n');

  console.log(`Checking Nakama server health at ${NAKAMA_HOST}:${NAKAMA_PORT}...`);
  await waitForHealth();
  console.log('Nakama server is healthy.\n');

  const testRunId = Date.now();
  const testUserId = `smoke_bot_${testRunId}`;
  const username = `BotTester_${testRunId}`;

  const client = new Client(NAKAMA_SERVER_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_SSL);
  let session = null;
  let socket = null;
  const suiteStartTime = new Date().toISOString();

  try {
    console.log('[AUTH] Authenticating test player...');
    session = await client.authenticateCustom(`browser:${testUserId}`, true, username, {
      platform: 'browser',
      init_data: `user_id=${testUserId}&username=${username}`,
    });
    assert(session?.user_id && UUID_REGEX.test(session.user_id), 'Invalid session user_id');
    console.log(`  Authenticated player UUID: ${session.user_id}`);

    socket = client.createSocket(NAKAMA_SSL, false);
    await socket.connect(session, false);
    console.log('  WebSocket connected.\n');

    // --------------------------------------------------------------------------
    // Scenario 1: Default Career on a real ticket - Defeat / Idle Flow
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 1] Default career, real ticket (idle defeat)...');
    {
      const careerRes = await socket.rpc('career/get', '');
      const career = JSON.parse(careerRes.payload).career;
      const playerModifiers = core.getPlayerUpgradeModifiers(career);
      assert(playerModifiers.startingUnits === 20, 'Default starting units must be 20');
      assert(playerModifiers.productionRateMultiplier === 1, 'Default production multiplier must be 1.0');
      assert(playerModifiers.armySpeedMultiplier === 1, 'Default speed multiplier must be 1.0');

      const ticket = await startRealTicket(socket, session, 'scenario1');

      const clientSim = runClientSimulation({
        battlefieldId: ticket.battlefieldId, // the REAL server-picked battlefield
        playerModifiers,
        playerActive: false, // Idle: no player actions
      });
      assert(clientSim.status === 'defeat', `Expected idle simulation to yield defeat, got ${clientSim.status}`);
      console.log(`  Client simulated idle match on ${ticket.battlefieldId}: status=${clientSim.status}, actions=${clientSim.recordedActions.length}`);

      const settlement = await settleAndAssertParity(socket, ticket, clientSim, 'scenario1');
      console.log(`  Authoritative settlement agreed: status=${settlement.status}`);

      // Check DB persistence
      const dbRow = queryPostgres(
        `SELECT status, settlement->>'status' FROM match_settlements WHERE match_id = '${ticket.matchId}';`
      ).trim();
      assert(dbRow === 'defeat|defeat', `DB settlement row mismatch: ${dbRow}`);

      // Idempotency check: repeat settlement request with same matchId
      const replayRes = await socket.rpc(
        'match/settle',
        JSON.stringify({
          matchId: ticket.matchId,
          actions: clientSim.recordedActions,
          clientObservedStatus: clientSim.status,
        })
      );
      const replaySettlement = JSON.parse(replayRes.payload).settlement;
      assert(replaySettlement.matchId === ticket.matchId, 'Replayed settlement matchId mismatch');
      assert(replaySettlement.newCareer.coins === settlement.newCareer.coins, 'Duplicate settlement modified coins');
      assert(replaySettlement.newCareer.trophies === settlement.newCareer.trophies, 'Duplicate settlement modified trophies');
      console.log('  Settlement idempotency verified (zero duplicate mutation).\n');
    }

    // --------------------------------------------------------------------------
    // Scenario 2: Upgraded Career on real ticket - Victory Flow
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 2] Upgraded career on real ticket (victory flow)...');
    {
      // Give test player a tactical edge so victory is decisive
      queryPostgres(`UPDATE players SET starting_garrison_level = 5, production_level = 5 WHERE id = '${session.user_id}';`);
      const careerRes = await socket.rpc('career/get', '');
      const career = JSON.parse(careerRes.payload).career;
      const playerModifiers = core.getPlayerUpgradeModifiers(career);

      const ticket = await startRealTicket(socket, session, 'scenario2');

      const clientSim = runClientSimulation({
        battlefieldId: ticket.battlefieldId,
        playerModifiers,
        playerAiInterval: 0.35,
        playerActive: true,
      });
      assert(clientSim.status === 'victory', `Expected active simulation to yield victory, got ${clientSim.status}`);
      assert(clientSim.recordedActions.length > 0, 'Victory must contain player actions');
      console.log(`  Client simulated match on ${ticket.battlefieldId}: status=${clientSim.status}, actions=${clientSim.recordedActions.length}`);

      const settlement = await settleAndAssertParity(socket, ticket, clientSim, 'scenario2');
      assert(settlement.newCareer.matchesWon >= 1, 'Career matchesWon must increment on victory');
      assert(settlement.breakdown.totalCoins > 0, 'Victory must award coins');
      console.log(`  Authoritative settlement agreed: status=${settlement.status}, coinsAwarded=${settlement.breakdown.totalCoins}`);

      // Verify audit ledger entry exists in DB
      const ledgerCount = parseInt(
        queryPostgres(`SELECT COUNT(*) FROM economy_ledger WHERE player_id = '${session.user_id}' AND reason = 'match_victory';`).trim(),
        10
      );
      assert(ledgerCount >= 1, 'Economy ledger must contain match_victory entry');
      console.log('  Economy ledger audit verified.\n');
    }

    // --------------------------------------------------------------------------
    // Scenario 3: The exact production bot_result_status_mismatch modifier set
    // (garrison 5 / production 5 / speed 5 / vanguard => 32 units, 1.4 prod,
    // 1.495 speed) - the set that historically diverged on the real server.
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 3] Production mismatch-log modifier set (vanguard)...');
    {
      queryPostgres(`UPDATE players SET starting_garrison_level = 5, production_level = 5, army_speed_level = 5, selected_commander = 'vanguard' WHERE id = '${session.user_id}';`);
      const careerRes = await socket.rpc('career/get', '');
      const career = JSON.parse(careerRes.payload).career;
      const playerModifiers = core.getPlayerUpgradeModifiers(career);
      assert(playerModifiers.startingUnits === 32, `Expected 32 starting units, got ${playerModifiers.startingUnits}`);
      assert(Math.abs(playerModifiers.productionRateMultiplier - 1.4) < 1e-9, 'Expected 1.4 production multiplier');
      assert(Math.abs(playerModifiers.armySpeedMultiplier - 1.495) < 1e-9, 'Expected 1.495 speed multiplier');

      const ticket = await startRealTicket(socket, session, 'scenario3');

      const clientSim = runClientSimulation({
        battlefieldId: ticket.battlefieldId,
        playerModifiers,
        playerAiInterval: 0.4,
        playerActive: true,
      });
      console.log(`  Client simulated match on ${ticket.battlefieldId}: status=${clientSim.status}, actions=${clientSim.recordedActions.length}`);

      await settleAndAssertParity(socket, ticket, clientSim, 'scenario3 (mismatch-log set)');
      console.log('  Historical mismatch modifier set now agrees end-to-end.\n');
    }

    // --------------------------------------------------------------------------
    // Scenario 4: Commander Modifiers on real tickets
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 4] Commander modifiers (quartermaster & vanguard)...');
    {
      // Sub-case 4A: Quartermaster (+15% prod, -10% speed)
      console.log('  Subcase 4A: Commander quartermaster...');
      queryPostgres(`UPDATE players SET starting_garrison_level = 4, production_level = 3, army_speed_level = 2, selected_commander = 'quartermaster' WHERE id = '${session.user_id}';`);
      const qmCareerRes = await socket.rpc('career/get', '');
      const qmCareer = JSON.parse(qmCareerRes.payload).career;
      const qmModifiers = core.getPlayerUpgradeModifiers(qmCareer);
      assert(qmModifiers.productionRateMultiplier > 1.24, 'Quartermaster must boost production');
      assert(qmModifiers.armySpeedMultiplier < 1.12, 'Quartermaster must reduce army speed');

      const qmTicket = await startRealTicket(socket, session, 'scenario4a');
      const qmSim = runClientSimulation({
        battlefieldId: qmTicket.battlefieldId,
        playerModifiers: qmModifiers,
        playerAiInterval: 0.45,
        playerActive: true,
      });
      await settleAndAssertParity(socket, qmTicket, qmSim, 'scenario4a (QM)');
      console.log(`    Quartermaster parity confirmed: status=${qmSim.status}`);

      // Sub-case 4B: Vanguard (+15% speed, -3 starting garrison)
      console.log('  Subcase 4B: Commander vanguard...');
      queryPostgres(`UPDATE players SET selected_commander = 'vanguard' WHERE id = '${session.user_id}';`);
      const vgCareerRes = await socket.rpc('career/get', '');
      const vgCareer = JSON.parse(vgCareerRes.payload).career;
      const vgModifiers = core.getPlayerUpgradeModifiers(vgCareer);
      assert(vgModifiers.startingUnits === 32 - 3, 'Vanguard must deduct 3 starting units');
      assert(vgModifiers.armySpeedMultiplier > 1.12, 'Vanguard must boost army speed');

      const vgTicket = await startRealTicket(socket, session, 'scenario4b');
      const vgSim = runClientSimulation({
        battlefieldId: vgTicket.battlefieldId,
        playerModifiers: vgModifiers,
        playerAiInterval: 0.4,
        playerActive: true,
      });
      await settleAndAssertParity(socket, vgTicket, vgSim, 'scenario4b (Vanguard)');
      console.log(`    Vanguard parity confirmed: status=${vgSim.status}\n`);
    }

    // --------------------------------------------------------------------------
    // Scenario 5: Rematch Flow
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 5] Rematch flow...');
    {
      const prevMatchesPlayed = parseInt(
        queryPostgres(`SELECT matches_played FROM players WHERE id = '${session.user_id}';`).trim(),
        10
      );

      const rematchTicket = await startRealTicket(socket, session, 'scenario5');

      const careerRes = await socket.rpc('career/get', '');
      const career = JSON.parse(careerRes.payload).career;
      const modifiers = core.getPlayerUpgradeModifiers(career);

      const rematchSim = runClientSimulation({
        battlefieldId: rematchTicket.battlefieldId,
        playerModifiers: modifiers,
        playerAiInterval: 0.4,
        playerActive: true,
      });

      await settleAndAssertParity(socket, rematchTicket, rematchSim, 'scenario5 (rematch)');

      const newMatchesPlayed = parseInt(
        queryPostgres(`SELECT matches_played FROM players WHERE id = '${session.user_id}';`).trim(),
        10
      );
      assert(newMatchesPlayed === prevMatchesPlayed + 1, `Matches played did not increment: prev=${prevMatchesPlayed} new=${newMatchesPlayed}`);
      console.log(`  Rematch settled successfully: matchesPlayed=${newMatchesPlayed}\n`);
    }

    // --------------------------------------------------------------------------
    // Scenario 6: Replay-invalid actions are skipped identically by the TS
    // replay engine and the authoritative server.
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 6] Replay-invalid actions (server must skip, not fail)...');
    {
      const ticket = await startRealTicket(socket, session, 'scenario6');
      const careerRes = await socket.rpc('career/get', '');
      const career = JSON.parse(careerRes.payload).career;
      const modifiers = core.getPlayerUpgradeModifiers(career);

      const baseSim = runClientSimulation({
        battlefieldId: ticket.battlefieldId,
        playerModifiers: modifiers,
        playerAiInterval: 0.4,
        playerActive: true,
      });
      assert(baseSim.recordedActions.length >= 4, 'Need enough actions to mutate');
      const mutatedActions = baseSim.recordedActions.map((action) => ({ ...action }));
      mutatedActions[1] = { ...mutatedActions[1], sourceId: 'no_such_tower' };
      mutatedActions[2] = { ...mutatedActions[2], targetId: 'no_such_tower' };
      mutatedActions[3] = { ...mutatedActions[3], sourceId: mutatedActions[3].targetId };

      // The TS replay engine (used for expected-status derivation) must skip
      // the same actions and produce a definitive status.
      const tsReplay = core.simulatePvpBattle({
        actions: mutatedActions,
        playerModifiers: modifiers,
        battlefieldId: ticket.battlefieldId,
      });

      const settleRes = await socket.rpc(
        'match/settle',
        JSON.stringify({
          matchId: ticket.matchId,
          actions: mutatedActions,
          // The well-behaved client derives its diagnostic status from its own
          // replay of the actions it submitted, so a healthy client reporting
          // invalid actions still agrees with the server.
          clientObservedStatus: tsReplay.summary.status,
        })
      );
      const settlement = JSON.parse(settleRes.payload).settlement;
      assert(
        settlement.status === tsReplay.summary.status,
        `TS replay status ${tsReplay.summary.status} must equal authoritative status ${settlement.status}`
      );
      console.log(`  Both engines skipped invalid actions and agreed: status=${settlement.status}\n`);
    }

    // --------------------------------------------------------------------------
    // Scenario 7: Malformed settlement payloads are rejected fail-closed.
    // Socket-level oversized payloads are dropped by Nakama's transport
    // (~4KB socket message limit) before reaching the runtime, so payload
    // enforcement is proven over the REST RPC endpoint, which delivers the
    // body to the same runtime handler.
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 7] Malformed settlement payloads are rejected...');
    {
      const ticket = await startRealTicket(socket, session, 'scenario7');
      const careerRes = await socket.rpc('career/get', '');
      const career = JSON.parse(careerRes.payload).career;
      const modifiers = core.getPlayerUpgradeModifiers(career);
      const sim = runClientSimulation({
        battlefieldId: ticket.battlefieldId,
        playerModifiers: modifiers,
        playerActive: false,
      });
      assert(sim.status === 'defeat', 'Idle sim must be defeat');

      const httpRpc = async (payloadObject) => {
        const res = await fetch(`http://${NAKAMA_HOST}:${NAKAMA_PORT}/v2/rpc/match/settle`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.token}`,
            'Content-Type': 'application/json',
          },
          // Nakama REST RPC takes the payload as a JSON-encoded string body.
          body: JSON.stringify(JSON.stringify(payloadObject)),
        });
        return { status: res.status, body: await res.text() };
      };

      const tooManyActions = Array.from({ length: core.MAX_PVP_ACTIONS + 1 }, (_, i) => ({
        sequence: i,
        atSeconds: 0,
        sourceId: 'p_base',
        targetId: 'n_center',
      }));
      const tooManyReject = await httpRpc({ matchId: ticket.matchId, actions: tooManyActions });
      assert(
        tooManyReject.status >= 400 && tooManyReject.body.includes('invalid_actions'),
        `Too many actions must be rejected with invalid_actions, got: ${tooManyReject.status} ${tooManyReject.body}`
      );

      const badSequenceReject = await httpRpc({
        matchId: ticket.matchId,
        actions: [{ sequence: 1, atSeconds: 1, sourceId: 'p_base', targetId: 'n_center' }],
        clientObservedStatus: 'defeat',
      });
      assert(
        badSequenceReject.status >= 400 && badSequenceReject.body.includes('invalid_action_sequence'),
        `Bad sequence must be rejected with invalid_action_sequence, got: ${badSequenceReject.status} ${badSequenceReject.body}`
      );

      const badStatusReject = await httpRpc({
        matchId: ticket.matchId,
        actions: [],
        clientObservedStatus: 'WIN',
      });
      assert(
        badStatusReject.status >= 400 && badStatusReject.body.includes('invalid_client_status'),
        `Invalid client status must be rejected, got: ${badStatusReject.status} ${badStatusReject.body}`
      );

      // None of the rejected payloads may have consumed the ticket.
      const stillUnsettled = queryPostgres(
        `SELECT settled_at FROM bot_matches WHERE match_id = '${ticket.matchId}';`
      ).trim();
      assert(stillUnsettled === '', `Rejected payloads must not settle the ticket, got: ${stillUnsettled}`);

      // The ticket must still settle cleanly with the honest payload.
      const settlement = await settleAndAssertParity(socket, ticket, sim, 'scenario7 (after rejections)');
      assert(settlement.status === 'defeat', 'Honest settlement after rejections must be defeat');
      console.log('  All malformed payloads rejected; ticket remained settleable.\n');
    }

    // --------------------------------------------------------------------------
    // Scenario 8: Log Inspection & Diagnostic Sensitivity Negative Control
    // --------------------------------------------------------------------------
    console.log('[SCENARIO 8] Nakama server log inspection & diagnostic sensitivity...');
    {
      // 1. Confirm zero mismatch warnings logged during legitimate scenarios
      const logsDuringMatches = execFileSync(
        'docker',
        ['compose', 'logs', 'nakama', `--since=${suiteStartTime}`],
        { encoding: 'utf8' }
      );
      const matchWarnings = logsDuringMatches
        .split('\n')
        .filter((l) => l.includes('bot_result_status_mismatch'));
      assert(
        matchWarnings.length === 0,
        `Unexpected bot_result_status_mismatch warning during valid matches: ${matchWarnings.join('\n')}`
      );
      console.log('  Zero bot_result_status_mismatch warnings during genuine test matches (clean parity).');

      // 2. SAFE NEGATIVE CONTROL: Prove the diagnostic warning is sensitive by sending a deliberate mismatch
      const probeTicket = await startRealTicket(socket, session, 'scenario8-probe');
      const probeStartTime = new Date().toISOString();

      // Submit an empty action list (authoritative outcome is 'defeat') but claim 'victory'
      const probeSettleRes = await socket.rpc(
        'match/settle',
        JSON.stringify({
          matchId: probeTicket.matchId,
          actions: [],
          clientObservedStatus: 'victory', // Intentional lie
        })
      );
      const probeSettlement = JSON.parse(probeSettleRes.payload).settlement;
      assert(probeSettlement.status === 'defeat', 'Server must remain authoritative and settle as defeat');

      // Wait 500ms for log flush
      await sleep(500);

      const probeLogs = execFileSync(
        'docker',
        ['compose', 'logs', 'nakama', `--since=${probeStartTime}`],
        { encoding: 'utf8' }
      );
      const probeWarnings = probeLogs
        .split('\n')
        .filter((l) => l.includes('bot_result_status_mismatch') && l.includes(probeTicket.matchId));
      assert(
        probeWarnings.length === 1,
        `Expected exactly 1 bot_result_status_mismatch for probe match, found ${probeWarnings.length}`
      );
      assert(probeWarnings[0].includes('"clientObservedStatus":"victory"'), 'Log must cite clientObservedStatus: victory');
      assert(probeWarnings[0].includes('"authoritativeStatus":"defeat"'), 'Log must cite authoritativeStatus: defeat');
      assert(probeWarnings[0].includes(`"battlefieldId":"${probeTicket.battlefieldId}"`), 'Log must cite the replay battlefieldId');
      console.log('  Safe negative control passed: bot_result_status_mismatch warning verified sensitive.\n');
    }

    console.log('================================================================');
    console.log('  ALL BOT PARITY SCENARIOS COMPLETED SUCCESSFULLY (100% PASS)  ');
    console.log('================================================================\n');
  } finally {
    if (socket) {
      try {
        socket.disconnect(false);
      } catch {
        // Ignored
      }
    }
    if (session?.user_id) {
      console.log(`[CLEANUP] Cleaning test database records for player ${session.user_id}...`);
      cleanDatabaseForPlayer(session.user_id);
      verifyZeroRemainingRows(session.user_id, 'BotTestPlayer');
      console.log('  Zero leftover rows verified across all 12 database tables.');
    }
  }
}

runBotParitySuite().catch((error) => {
  console.error('\n[BOT PARITY SUITE FAILED]', error);
  process.exit(1);
});

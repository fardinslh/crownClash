import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as NakamaClient } from '@heroiclabs/nakama-js';
import { LiveMatchClient } from '../LiveMatchClient.js';
import type { Session } from '@heroiclabs/nakama-js';
import type {
  LiveMatchError,
  LiveMatchResult2v2,
  LiveMatchStarted2v2,
} from '../LiveMatchClient.js';

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_FILE_DIR, '../../../../../');

// ── Real-stack client lifecycle (Phase 5) ─────────────────────────────────
// Drives the REAL LiveMatchClient class against the live Nakama stack
// (ENABLE_2V2=true): four authenticated players queue through the actual
// client engine, receive match_started_2v2, dispatch through the per-slot
// cursor, and settle through surrender. This exercises the exact event flow
// MenuScene and GameScene consume — not raw sockets.
//
// Gated behind LIVE_2V2_SMOKE=1 so ordinary unit runs stay hermetic:
//   npm run test:smoke:2v2:client   (from the repo root)

const LIVE = process.env.LIVE_2V2_SMOKE === '1';
const HOST = process.env.NAKAMA_HOST || '127.0.0.1';
const PORT = String(process.env.NAKAMA_PORT || '7350');
// The stack's socket key lives in .env (never logged, never hardcoded).
function loadServerKey(): string {
  if (process.env.NAKAMA_SERVER_KEY) return process.env.NAKAMA_SERVER_KEY;
  try {
    const envPath = path.resolve(TEST_FILE_DIR, '../../../../../.env');
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*NAKAMA_SERVER_KEY\s*=\s*(.+?)\s*$/);
      if (match) return match[1].replace(/^["']|["']$/g, '');
    }
  } catch {
    // fall through
  }
  return 'defaultkey';
}
const SERVER_KEY = loadServerKey();
const PLAYER_COUNT = 4;
const TEST_ID_REGEX = /^[0-9a-zA-Z_-]{4,64}$/;

interface PlayerHarness {
  client: LiveMatchClient;
  socket: unknown;
  session: Session;
  events: {
    started2v2: LiveMatchStarted2v2[];
    states: Array<{ tick: number }>;
    accepted: Array<{ sequence: number; slot: number }>;
    rejected: LiveMatchError[];
    results: LiveMatchResult2v2[];
    reconnects: number[];
    reconnectFailed: string[];
  };
  unsubscribe: () => void;
}

const harnesses: PlayerHarness[] = [];
const nakamaSdkClients: NakamaClient[] = [];

async function connectPlayer(index: number, runId: number): Promise<PlayerHarness> {
  const sdk = new NakamaClient(SERVER_KEY, HOST, PORT, false);
  nakamaSdkClients.push(sdk);
  // Same shapes as the proven raw-socket smoke: the custom account id is
  // `browser:<id>` while init_data carries the bare id (a colon inside
  // init_data user_id breaks the server's authenticate hook with a 500).
  const bareId = `smoke2v2client_p${index + 1}_${runId}`;
  const account = `browser:${bareId}`;
  expect(TEST_ID_REGEX.test(bareId)).toBe(true);
  const session = await sdk.authenticateCustom(
    account,
    true,
    `CmdrClient_${index + 1}_${runId}`,
    { platform: 'browser', init_data: `user_id=${bareId}&username=CmdrClient_${index + 1}_${runId}` }
  );
  const socket = sdk.createSocket(false, false);
  await socket.connect(session, false);

  const events = {
    started2v2: [] as LiveMatchStarted2v2[],
    states: [] as Array<{ tick: number }>,
    accepted: [] as Array<{ sequence: number; slot: number }>,
    rejected: [] as LiveMatchError[],
    results: [] as LiveMatchResult2v2[],
    reconnects: [] as number[],
    reconnectFailed: [] as string[],
  };
  const client = new LiveMatchClient(socket, {
    flags: { enable2v2: true },
    reconnectTransport: async () => {
      throw new Error('reconnect not exercised in this smoke');
    },
  });
  const unsubs = [
    client.on('match_started_2v2', (payload) => events.started2v2.push(payload)),
    client.on('state_2v2', (payload) => events.states.push(payload)),
    client.on('command_accepted_2v2', (payload) => events.accepted.push(payload)),
    client.on('command_rejected_2v2', (payload) => events.rejected.push(payload)),
    client.on('match_result_2v2', (payload) => events.results.push(payload)),
    client.on('reconnecting', ({ attempt }) => events.reconnects.push(attempt)),
    client.on('reconnect_failed', ({ code }) => events.reconnectFailed.push(code)),
  ];
  const unsubscribe = (): void => unsubs.forEach((off) => off());
  const harness: PlayerHarness = { client, socket, session, events, unsubscribe };
  harnesses.push(harness);
  return harness;
}

function userIdOf(harness: PlayerHarness): string {
  const id = harness.session.user_id;
  expect(typeof id).toBe('string');
  expect(id).toMatch(/^[0-9a-fA-F-]{36}$/);
  return id as string;
}

async function cleanupDatabase(runId: number): Promise<void> {
  // Same rows the raw-socket smoke scrubs, scoped to this run's user ids.
  const userIds = harnesses.map((h) => userIdOf(h));
  for (const userId of userIds) {
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
    execFileSync('docker', [
      'compose', 'exec', '-T', 'db', 'psql',
      '-U', 'crownclash', '-d', 'crownclash', '-v', 'ON_ERROR_STOP=1',
      '-t', '-A', '-c', sql,
    ], { encoding: 'utf8', cwd: REPO_ROOT });
  }
  void runId;
}

describe.skipIf(!LIVE)('LiveMatchClient 2v2 real-stack lifecycle', () => {
  afterAll(async () => {
    for (const harness of harnesses) {
      harness.unsubscribe();
      try { harness.client.close(); } catch { /* ignore */ }
    }
    harnesses.length = 0;
    nakamaSdkClients.length = 0;
  });

  it('queues four real clients, dispatches with slot cursors, and settles via surrender', async () => {
    const runId = Date.now();
    const players: PlayerHarness[] = [];
    try {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        players.push(await connectPlayer(i, runId));
      }

      // ── Queue through the REAL client engine ────────────────────────────
      // Phase 4 contract: connect resolves on ticket submission; the match
      // materializes via match_started_2v2 when the pool completes.
      await Promise.all(players.map((p) => p.client.connect('queue_2v2')));

      const waitUntil = async (
        condition: () => boolean,
        timeoutMs: number,
        what: string
      ): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (condition()) return;
          await new Promise((r) => setTimeout(r, 250));
        }
        throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
      };

      await waitUntil(
        () => players.every((p) => p.events.started2v2.length === 1),
        45_000,
        'match_started_2v2 for all four clients'
      );

      // Every client learns its slot/team/roster from its own event.
      const starts = players.map((p) => p.events.started2v2[0]);
      const slots = starts.map((s) => s.slot).sort();
      expect(slots).toEqual([0, 1, 2, 3]);
      for (const start of starts) {
        expect(start.players).toHaveLength(4);
        expect(start.state.status).toBe('playing');
        expect(typeof start.nextSequence).toBe('number');
      }
      // One shared canonical match id across all four perspectives.
      expect(new Set(starts.map((s) => s.matchId)).size).toBe(1);
      // Teams: two a, two b.
      expect(starts.filter((s) => s.teamId === 'a')).toHaveLength(2);

      // ── Slot 0 dispatches from its shared team base ─────────────────────
      const slot0Index = starts.findIndex((s) => s.slot === 0);
      const slot1Index = starts.findIndex((s) => s.slot === 1);
      const sequence = players[slot0Index].client.sendDispatch('a_base_w', 'a_gate_w');
      expect(sequence).toBe(starts[slot0Index].nextSequence);

      await waitUntil(
        () => players[slot0Index].events.accepted.length === 1,
        15_000,
        'command_accepted_2v2 on the dispatching slot'
      );
      expect(players[slot0Index].events.accepted[0].sequence).toBe(sequence);
      expect(players[slot0Index].events.accepted[0].slot).toBe(0);

      // The teammate receives the authoritative state carrying the army,
      // whose id encodes the dispatching slot (UI attribution source).
      await waitUntil(
        () => players[slot1Index].events.states.some((s) =>
          (s as unknown as { state: { armies: Array<{ id: string }> } }).state.armies.some(
            (army) => army.id.startsWith('2v2_')
          )
        ),
        15_000,
        'slot-attributed army in the teammate state'
      );

      // ── Team B surrenders both slots → team A wins ──────────────────────
      const teamBIndexes = starts
        .map((start, index) => (start.teamId === 'b' ? index : -1))
        .filter((index) => index >= 0);
      expect(teamBIndexes).toHaveLength(2);
      players[teamBIndexes[0]].client.sendSurrender();
      players[teamBIndexes[1]].client.sendSurrender();

      await waitUntil(
        () =>
          players[slot0Index].events.results.length === 1 &&
          players[slot1Index].events.results.length === 1,
        20_000,
        'match_result_2v2 on both surviving clients'
      );
      const results = [players[slot0Index].events.results[0], players[slot1Index].events.results[0]];
      for (const result of results) {
        expect(result.winnerTeamId).toBe('a');
        expect(result.participants).toHaveLength(4);
        const surrendered = result.participants?.filter((p) => p.abandoned) ?? [];
        expect(surrendered.map((p) => p.teamId).sort()).toEqual(['b', 'b']);
      }

      // The result is emitted exactly once per client (settlement dedupe).
      await new Promise((r) => setTimeout(r, 2_000));
      expect(players[slot0Index].events.results).toHaveLength(1);
      expect(players[slot1Index].events.results).toHaveLength(1);

      // Surrendering clients were kicked: no result reaches them.
      expect(players[teamBIndexes[0]].events.results).toHaveLength(0);
      expect(players[teamBIndexes[1]].events.results).toHaveLength(0);

      // No reconnects occurred during a healthy lifecycle.
      for (const player of players) {
        expect(player.events.reconnectFailed).toEqual([]);
      }

      await cleanupDatabase(runId);
    } finally {
      for (const player of players) {
        try { player.client.close(); } catch { /* ignore */ }
      }
      // Safety net: if the test failed before the normal cleanup, scrub rows.
      try {
        await cleanupDatabase(runId);
      } catch (error) {
        console.warn('[smoke] post-failure DB cleanup failed (rows may remain):', error);
      }
    }
  }, 180_000);
});

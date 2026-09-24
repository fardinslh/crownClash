#!/usr/bin/env node
import { Client } from '@heroiclabs/nakama-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MATCH_COUNT = Number(process.env.SOAK_2V2_MATCHES || 25);
const PLAYER_COUNT = MATCH_COUNT * 4;
const HOST = process.env.NAKAMA_HOST || '127.0.0.1';
const PORT = process.env.NAKAMA_PORT || '7350';
const SSL = process.env.NAKAMA_SSL === 'true';
const TIMEOUT_MS = Number(process.env.SOAK_2V2_TIMEOUT_MS || 60000);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    for (const raw of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^(?:export\s+)?([^=]+)=(.*)$/);
      if (!match || match[1].trim() !== key) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return value;
    }
  } catch { /* CI intentionally has no .env. */ }
  return undefined;
}

const SERVER_KEY = envValue('NAKAMA_SERVER_KEY') || 'defaultkey';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timeout: ${message}`);
}

function query(sql) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'crownclash', '-d', 'crownclash', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();
}

async function mapLimit(items, limit, work) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await work(items[index], index);
    }
  });
  await Promise.all(workers);
}

const runId = `${Date.now()}_${process.pid}`;
const players = Array.from({ length: PLAYER_COUNT }, (_, index) => ({ index, externalId: `soak2v2_${runId}_${index}` }));
const matchIds = new Set();

async function cleanup() {
  for (const player of players) {
    try { player.socket?.disconnect(false); } catch { /* best effort */ }
  }
  const userIds = players.map((p) => p.session?.user_id).filter((id) => /^[0-9a-f-]{36}$/i.test(id || ''));
  if (userIds.length) {
    const ids = userIds.map((id) => `'${id}'`).join(',');
    const matches = [...matchIds].filter((id) => /^live2v2_[0-9a-f]{8}_\d+$/.test(id)).map((id) => `'${id}'`).join(',');
    query(`BEGIN;
      DELETE FROM analytics_events WHERE player_id IN (${ids});
      DELETE FROM economy_ledger WHERE player_id IN (${ids});
      DELETE FROM player_daily_progress WHERE player_id IN (${ids});
      DELETE FROM match_settlements_multi WHERE user_id IN (${ids});
      ${matches ? `DELETE FROM match_replays WHERE match_id IN (${matches});` : ''}
      DELETE FROM player_names WHERE player_id IN (${ids});
      DELETE FROM pvp_defenses WHERE player_id IN (${ids});
      DELETE FROM players WHERE id IN (${ids});
      COMMIT;`);
  }
  await mapLimit(players.filter((p) => p.client && p.session), 20, async (player) => {
    try { await player.client.deleteAccount(player.session); } catch { /* best effort after DB cleanup */ }
  });
}

async function run() {
  assert(Number.isInteger(MATCH_COUNT) && MATCH_COUNT >= 1, 'SOAK_2V2_MATCHES must be a positive integer');
  console.log(`2v2 soak: ${MATCH_COUNT} concurrent matches / ${PLAYER_COUNT} clients`);
  const health = await fetch(`http://${HOST}:${PORT}/`);
  assert(health.status < 500, `Nakama unhealthy: HTTP ${health.status}`);

  const authStart = Date.now();
  await mapLimit(players, 20, async (player) => {
    const client = new Client(SERVER_KEY, HOST, PORT, SSL);
    const session = await client.authenticateCustom(`browser:${player.externalId}`, true, `Soak${player.index}`, {
      platform: 'browser', init_data: `user_id=${player.externalId}&username=Soak${player.index}`,
    });
    const socket = client.createSocket(SSL, false);
    await socket.connect(session, false);
    player.client = client;
    player.session = session;
    player.socket = socket;
    player.matchedAt = 0;
    player.startedAt = 0;
    player.settledAt = 0;
    socket.onmatchmakermatched = (matched) => {
      player.rawMatchId = matched.match_id;
      player.matchedAt = Date.now();
      matchIds.add(matched.match_id);
    };
    socket.onmatchdata = (message) => {
      let payload;
      try { payload = JSON.parse(decoder.decode(message.data)); } catch { return; }
      if (message.op_code === 2 && payload.type === 'match_started') {
        player.started = payload;
        player.startedAt = Date.now();
        matchIds.add(payload.matchId);
      }
      if (message.op_code === 7 && payload.type === 'match_result') {
        player.result = payload.result;
        player.settledAt = Date.now();
      }
      if (message.op_code === 8) player.error = payload.code || 'server_error';
    };
  });
  console.log(`authenticated ${PLAYER_COUNT} clients in ${Date.now() - authStart}ms`);

  const queuedAt = Date.now();
  await Promise.all(players.map((p) => p.socket.addMatchmaker('', 4, 4)));
  await waitUntil(() => players.every((p) => p.rawMatchId), 'all players matched');
  assert(matchIds.size === MATCH_COUNT, `formed ${matchIds.size} matches, want ${MATCH_COUNT}`);
  const groups = new Map();
  for (const player of players) {
    const group = groups.get(player.rawMatchId) || [];
    group.push(player);
    groups.set(player.rawMatchId, group);
  }
  for (const [id, group] of groups) assert(group.length === 4, `match ${id} has ${group.length} players`);

  await Promise.all(players.map((p) => p.socket.joinMatch(p.rawMatchId)));
  await waitUntil(() => players.every((p) => p.started), 'all matches started');
  for (const player of players) {
    assert(player.started.schemaVersion === 2 && player.started.mode === '2v2', `invalid start for player ${player.index}`);
  }

  const settleStarted = Date.now();
  for (const group of groups.values()) {
    const bySlot = new Map(group.map((p) => [p.started.slot, p]));
    for (const slot of [2, 3]) {
      const player = bySlot.get(slot);
      assert(player, `missing surrender slot ${slot}`);
      await player.socket.sendMatchState(player.rawMatchId, 1, encoder.encode(JSON.stringify({ schemaVersion: 2, type: 'surrender', sequence: 0 })));
    }
  }
  await waitUntil(() => [...groups.values()].every((group) => group.some((p) => p.result)), 'all matches settled');
  assert(players.every((p) => !p.error), `server errors: ${players.filter((p) => p.error).map((p) => p.error).join(',')}`);

  const canonicalIds = [...groups.values()].map((group) => group[0].started.matchId);
  const idList = canonicalIds.map((id) => `'${id}'`).join(',');
  assert(Number(query(`SELECT COUNT(*) FROM match_settlements_multi WHERE match_id IN (${idList});`)) === PLAYER_COUNT, 'settlement row count mismatch');
  assert(Number(query(`SELECT COUNT(*) FROM match_replays WHERE match_id IN (${idList});`)) === MATCH_COUNT, 'replay row count mismatch');
  assert(Number(query(`SELECT COUNT(*) FROM economy_ledger WHERE source IN (${idList}) AND currency = 'trophies';`)) === 0, 'casual soak wrote trophies');

  const queueLatencies = players.map((p) => p.matchedAt - queuedAt);
  const startLatencies = players.map((p) => p.startedAt - p.matchedAt);
  const settlementLatency = Date.now() - settleStarted;
  const metrics = {
    matches: MATCH_COUNT,
    players: PLAYER_COUNT,
    queueP95Ms: percentile(queueLatencies, 0.95),
    startP95Ms: percentile(startLatencies, 0.95),
    settlementAllMs: settlementLatency,
  };
  assert(metrics.queueP95Ms <= 15000, `queue p95 ${metrics.queueP95Ms}ms exceeds 15000ms`);
  // The authoritative countdown itself is 10 seconds; allow two seconds of
  // CI scheduling/network headroom while still catching a stalled handler.
  assert(metrics.startP95Ms <= 12000, `start p95 ${metrics.startP95Ms}ms exceeds 12000ms`);
  assert(metrics.settlementAllMs <= 15000, `settlement ${metrics.settlementAllMs}ms exceeds 15000ms`);
  console.log(`SOAK PASSED ${JSON.stringify(metrics)}`);
}

try {
  await run();
} finally {
  await cleanup();
}

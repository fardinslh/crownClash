import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { createApp } from '../app.js';
import { loadConfig } from '../env.js';

// Requires a real Postgres reachable at DATABASE_URL (see apps/server/README.md).
// Skips gracefully so `npm test` elsewhere in the monorepo is unaffected.
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('server integration', () => {
  let pool: Pool;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const config = loadConfig({ ...process.env, DATABASE_URL, ALLOW_GUEST_AUTH: 'true' } as NodeJS.ProcessEnv);
    pool = createPool(config.databaseUrl);
    await runMigrations(pool);

    const app = createApp(pool, config);
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    close = () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
  });

  afterAll(async () => {
    await close();
    await pool.end();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function readJson(res: Response): Promise<any> {
    return res.json();
  }

  function guestInitData(id: string): string {
    return new URLSearchParams({ user: JSON.stringify({ id, username: `Commander_${id}` }) }).toString();
  }

  async function loginGuest(): Promise<{ token: string; playerId: string }> {
    const id = `test_${randomUUID()}`;
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'browser', initData: guestInitData(id) }),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.token).toBeTypeOf('string');
    expect(body.career.coins).toBe(100);
    return { token: body.token as string, playerId: `browser:${id}` };
  }

  it('rejects requests with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/career`);
    expect(res.status).toBe(401);
  });

  it('rejects an invalid bearer token', async () => {
    const res = await fetch(`${baseUrl}/career`, { headers: { authorization: 'Bearer garbage' } });
    expect(res.status).toBe(401);
  });

  it('logs in a guest and returns a fresh default career', async () => {
    const { token } = await loginGuest();
    const res = await fetch(`${baseUrl}/career`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.career.coins).toBe(100);
    expect(body.career.startingGarrisonLevel).toBe(0);
  });

  it('settles a match and is idempotent for a repeated matchId', async () => {
    const { token } = await loginGuest();
    const matchId = `match_${randomUUID()}`;
    const payload = {
      matchId,
      status: 'victory',
      stats: {
        matchDurationSeconds: 35,
        playerUnitsDispatched: 20,
        enemyUnitsDispatched: 10,
        territoriesCapturedByPlayer: 6,
        territoriesCapturedByEnemy: 1,
      },
    };

    const first = await fetch(`${baseUrl}/matches/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson(first);
    expect(firstBody.settlement.newCareer.coins).toBe(100 + firstBody.settlement.breakdown.totalCoins);

    const second = await fetch(`${baseUrl}/matches/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const secondBody = await readJson(second);

    // Same settlement returned, and balances were not double-applied.
    expect(secondBody.settlement).toEqual(firstBody.settlement);

    const careerRes = await fetch(`${baseUrl}/career`, { headers: { authorization: `Bearer ${token}` } });
    const careerBody = await readJson(careerRes);
    expect(careerBody.career.coins).toBe(firstBody.settlement.newCareer.coins);
    expect(careerBody.career.matchesPlayed).toBe(1);
  });

  it('rejects invalid match settlement input', async () => {
    const { token } = await loginGuest();
    const res = await fetch(`${baseUrl}/matches/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchId: 'm1', status: 'not-a-status', stats: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('purchases an upgrade, persists it, and rejects insufficient funds', async () => {
    const { token } = await loginGuest();

    const purchase = await fetch(`${baseUrl}/upgrades/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'starting_garrison', purchaseId: `up_${randomUUID()}` }),
    });
    expect(purchase.status).toBe(200);
    const purchaseBody = await readJson(purchase);
    expect(purchaseBody.result.success).toBe(true);
    expect(purchaseBody.result.newCareer.startingGarrisonLevel).toBe(1);
    expect(purchaseBody.result.newCareer.coins).toBe(50); // 100 - first tier cost of 50

    // Player only has 50 coins left; next tier costs 100, so this must fail.
    const insufficientId = `up_${randomUUID()}`;
    const failed = await fetch(`${baseUrl}/upgrades/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'starting_garrison', purchaseId: insufficientId }),
    });
    expect(failed.status).toBe(200);
    const failedBody = await readJson(failed);
    expect(failedBody.result.success).toBe(false);
    expect(failedBody.result.reason).toBe('insufficient_coins');
  });

  it('is idempotent for a repeated upgrade purchaseId', async () => {
    const { token } = await loginGuest();
    const purchaseId = `up_${randomUUID()}`;

    const first = await fetch(`${baseUrl}/upgrades/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'production', purchaseId }),
    });
    const firstBody = await readJson(first);

    const second = await fetch(`${baseUrl}/upgrades/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'production', purchaseId }),
    });
    const secondBody = await readJson(second);

    expect(secondBody.result).toEqual(firstBody.result);

    const careerRes = await fetch(`${baseUrl}/career`, { headers: { authorization: `Bearer ${token}` } });
    const careerBody = await readJson(careerRes);
    // Coins were only deducted once despite the duplicate request.
    expect(careerBody.career.coins).toBe(50);
    expect(careerBody.career.productionLevel).toBe(1);
  });

  it('lists PvP opponents and settles a repeated attack only once', async () => {
    const attacker = await loginGuest();
    const defender = await loginGuest();

    const opponentsResponse = await fetch(`${baseUrl}/pvp/opponents`, {
      headers: { authorization: `Bearer ${attacker.token}` },
    });
    expect(opponentsResponse.status).toBe(200);
    const opponentsBody = await readJson(opponentsResponse);
    expect(opponentsBody.opponents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: defender.playerId }),
      ])
    );

    const attackPayload = {
      attackId: `attack_${randomUUID()}`,
      defenderId: defender.playerId,
      actions: [],
    };
    const first = await fetch(`${baseUrl}/pvp/attacks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${attacker.token}` },
      body: JSON.stringify(attackPayload),
    });
    expect(first.status).toBe(200);
    const firstBody = await readJson(first);
    expect(firstBody.result.attackId).toBe(attackPayload.attackId);
    expect(firstBody.result.settlement.newCareer.matchesPlayed).toBe(1);

    const second = await fetch(`${baseUrl}/pvp/attacks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${attacker.token}` },
      body: JSON.stringify(attackPayload),
    });
    expect(second.status).toBe(200);
    const secondBody = await readJson(second);
    expect(secondBody.result).toEqual(firstBody.result);

    const selfAttack = await fetch(`${baseUrl}/pvp/attacks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${attacker.token}` },
      body: JSON.stringify({
        attackId: `attack_self_${randomUUID()}`,
        defenderId: attacker.playerId,
        actions: [],
      }),
    });
    expect(selfAttack.status).toBe(400);
    expect((await readJson(selfAttack)).error).toBe('pvp_cannot_attack_self');
  });
});

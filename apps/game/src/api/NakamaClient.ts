import { Client, type Session, type Socket } from '@heroiclabs/nakama-js';
import type {
  EconomyLedgerEntry,
  MatchSettlement,
  PlayerCareer,
  PvpAction,
  UpgradePurchaseResult,
  UpgradeType,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { CareerApi, TrackedAnalyticsEvent } from './GameApiClient.js';
import { LiveMatchClient } from './LiveMatchClient.js';

interface IdentityResponse {
  platform: string;
  external_id: string;
  username: string;
  display_name: string;
}

/**
 * CareerApi implementation backed by Nakama RPC and socket APIs.
 *
 * Authentication flow:
 *   1. Call auth/register_identity RPC (unauthenticated, HTTP basic with
 *      server key) to verify platform init data and obtain a trusted
 *      "platform:externalId" custom ID.
 *   2. Authenticate with Nakama via authenticateCustom to get a session.
 *   3. Open a socket for real-time match and RPC communication.
 *   4. Fetch the player career via career/get RPC.
 */
export class NakamaClient implements CareerApi {
  private readonly client: Client;
  private readonly httpUrl: string;
  private readonly useSSL: boolean;
  private session: Session | null = null;
  private socket: Socket | null = null;

  constructor(
    host: string = import.meta.env.VITE_NAKAMA_HOST ||
      (import.meta.env.DEV ? '127.0.0.1' : typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'),
    port: string = import.meta.env.VITE_NAKAMA_PORT || '7350',
    useSSL: boolean = import.meta.env.VITE_NAKAMA_SSL === 'true' ||
      (!import.meta.env.DEV && typeof window !== 'undefined' && window.location.protocol === 'https:'),
    serverKey: string = import.meta.env.VITE_NAKAMA_SERVER_KEY || 'defaultkey'
  ) {
    this.useSSL = useSSL;
    this.client = new Client(serverKey, host, port, useSSL);
    this.httpUrl = `${useSSL ? 'https' : 'http'}://${host}:${port}`;
  }

  public async login(platform: PlatformAdapter): Promise<PlayerCareer> {
    // Step 1: Verify init data and obtain trusted custom ID.
    const identity = await this.registerIdentity(platform);

    // Step 2: Authenticate with Nakama.
    const customId = `${identity.platform}:${identity.external_id}`;
    this.session = await this.client.authenticateCustom(
      customId,
      true,
      identity.username || identity.display_name || ''
    );

    // Step 3: Open socket.
    this.socket = this.client.createSocket(this.useSSL, false);
    await this.socket.connect(this.session, false);

    // Step 4: Fetch career.
    const rpcResult = await this.socket.rpc('career/get', '');
    const data = JSON.parse(rpcResult.payload ?? '') as { career: PlayerCareer };
    return data.career;
  }

  public async getCareer(): Promise<PlayerCareer> {
    const result = await this.rpc('career/get', '');
    return (JSON.parse(result) as { career: PlayerCareer }).career;
  }

  public async getLedger(limit = 100): Promise<EconomyLedgerEntry[]> {
    const result = await this.rpc('ledger/get', JSON.stringify({ limit }));
    return (JSON.parse(result) as { entries: EconomyLedgerEntry[] }).entries;
  }

  public async settleMatch(
    matchId: string,
    actions: readonly PvpAction[]
  ): Promise<MatchSettlement> {
    const result = await this.rpc('match/settle', JSON.stringify({ matchId, actions }));
    return (JSON.parse(result) as { settlement: MatchSettlement }).settlement;
  }

  public async purchaseUpgrade(
    type: UpgradeType,
    purchaseId: string
  ): Promise<UpgradePurchaseResult> {
    const result = await this.rpc('upgrade/purchase', JSON.stringify({ type, purchaseId }));
    return (JSON.parse(result) as { result: UpgradePurchaseResult }).result;
  }

  public async trackEvents(events: readonly TrackedAnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.rpc('analytics/events', JSON.stringify({ events }));
  }

  public openLiveMatch(): LiveMatchClient {
    if (!this.socket) {
      throw new Error('live_socket_not_connected');
    }
    return new LiveMatchClient(this.socket);
  }

  public isAuthenticated(): boolean {
    return this.session !== null;
  }

  /**
   * Calls the register_identity RPC via HTTP basic auth (server key).
   * This is the only unauthenticated call; everything else goes through
   * the authenticated socket.
   */
  private async registerIdentity(platform: PlatformAdapter): Promise<IdentityResponse> {
    const serverKey = (this.client as unknown as { serverkey: string }).serverkey || 'defaultkey';
    const basicAuth = typeof btoa !== 'undefined'
      ? btoa(`${serverKey}:`)
      : Buffer.from(`${serverKey}:`).toString('base64');

    let response: Response;
    try {
      response = await fetch(`${this.httpUrl}/v2/rpc/auth/register_identity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          platform: platform.platform,
          initData: platform.getInitDataRaw(),
          username: platform.getUser().username,
        }),
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'identity_request_failed');
    }

    if (!response.ok) {
      let code = `http_${response.status}`;
      try {
        const body = await response.json();
        if (body && typeof body.error === 'string') code = body.error;
        else if (body && typeof body.message === 'string') code = body.message;
      } catch {
        // Keep HTTP status as error code.
      }
      throw new Error(code);
    }

    const body = await response.json();
    const payload = typeof body.payload === 'string' ? body.payload : JSON.stringify(body);
    return JSON.parse(payload) as IdentityResponse;
  }

  private async rpc(id: string, payload: string): Promise<string> {
    if (!this.socket) {
      throw new Error('socket_not_connected');
    }
    const result = await this.socket.rpc(id, payload);
    return result.payload ?? '';
  }
}

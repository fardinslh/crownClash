import { Client, type Session, type Socket } from '@heroiclabs/nakama-js';
import type {
  DailyClaimResult,
  DailyRewardType,
  DailyState,
  EconomyLedgerEntry,
  LeagueClaimResult,
  LeagueState,
  MatchSettlement,
  PlayerCareer,
  PvpAction,
  UpgradePurchaseResult,
  UpgradeType,
  CommanderId,
  CommanderSelectionResult,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { CareerApi, TrackedAnalyticsEvent } from './GameApiClient.js';
import { LiveMatchClient } from './LiveMatchClient.js';

/**
 * CareerApi implementation backed by Nakama RPC and socket APIs.
 *
 * Authentication flow:
 *   1. Authenticate with Nakama using the platform identity and raw init
 *      data. The server's before-auth hook verifies both before account
 *      creation.
 *   2. Open a socket for real-time match and RPC communication.
 *   3. Fetch the player career via career/get RPC.
 */
export class NakamaClient implements CareerApi {
  private readonly client: Client;
  private readonly useSSL: boolean;
  private session: Session | null = null;
  private socket: Socket | null = null;

  constructor(
    host: string = import.meta.env.VITE_NAKAMA_HOST ||
      (typeof window !== 'undefined' && window.location.hostname
        ? window.location.hostname
        : '127.0.0.1'),
    port: string = import.meta.env.VITE_NAKAMA_PORT || '7350',
    useSSL: boolean = import.meta.env.VITE_NAKAMA_SSL === 'true' ||
      (!import.meta.env.DEV && typeof window !== 'undefined' && window.location.protocol === 'https:'),
    serverKey: string = import.meta.env.VITE_NAKAMA_SERVER_KEY || 'defaultkey'
  ) {
    this.useSSL = useSSL;
    this.client = new Client(serverKey, host, port, useSSL);
  }

  public async login(platform: PlatformAdapter): Promise<PlayerCareer> {
    const user = platform.getUser();
    const customId = `${platform.platform}:${user.id}`;
    this.session = await this.client.authenticateCustom(
      customId,
      true,
      user.username || user.firstName || '',
      {
        platform: platform.platform,
        init_data: platform.getInitDataRaw(),
      }
    );

    this.socket = this.client.createSocket(this.useSSL, false);
    await this.socket.connect(this.session, false);

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

  public async selectCommander(commanderId: CommanderId): Promise<CommanderSelectionResult> {
    const result = await this.rpc('commander/select', JSON.stringify({ commanderId }));
    return (JSON.parse(result) as { result: CommanderSelectionResult }).result;
  }

  public async getDailyState(): Promise<DailyState> {
    const result = await this.rpc('daily/get', '');
    return (JSON.parse(result) as { state: DailyState }).state;
  }

  public async claimDailyReward(
    type: DailyRewardType,
    claimId: string
  ): Promise<DailyClaimResult> {
    const result = await this.rpc('daily/claim', JSON.stringify({ rewardType: type, claimId }));
    return (JSON.parse(result) as { result: DailyClaimResult }).result;
  }

  public async getLeagueState(): Promise<LeagueState> {
    const result = await this.rpc('league/get', '');
    return (JSON.parse(result) as { state: LeagueState }).state;
  }

  public async claimLeagueReward(rankId: string, claimId: string): Promise<LeagueClaimResult> {
    const result = await this.rpc('league/claim', JSON.stringify({ rankId, claimId }));
    return (JSON.parse(result) as { result: LeagueClaimResult }).result;
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

  private async rpc(id: string, payload: string): Promise<string> {
    if (!this.socket) {
      throw new Error('socket_not_connected');
    }
    const result = await this.socket.rpc(id, payload);
    return result.payload ?? '';
  }
}

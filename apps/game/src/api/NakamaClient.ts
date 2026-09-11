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
  BotMatchTicket,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import { StaleSocketError, type CareerApi, type TrackedAnalyticsEvent } from './GameApiClient.js';
import { LiveMatchClient } from './LiveMatchClient.js';

export function isNakamaTransportError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof StaleSocketError || (error as { isStaleSocket?: boolean })?.isStaleSocket === true) {
    return true;
  }

  const domainValidationErrors = [
    'bot_match_not_found',
    'bot_match_owned_by_another_player',
    'foreign ownership',
    'invalid_action',
    'invalid_actions',
    'invalid_argument',
    'invalid_payload',
    'invalid_upgrade_type',
    'invalid_purchase_id',
    'commander_locked',
    'insufficient_funds',
    'insufficient_coins',
    'already_claimed',
    'mission_incomplete',
    'rank_locked',
    'unauthenticated',
    'unauthorized',
  ];

  const errObj = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null;
  const message =
    error instanceof Error
      ? error.message
      : typeof errObj?.message === 'string'
        ? errObj.message
        : String(error);

  const code = typeof errObj?.code === 'string' ? errObj.code : '';
  const text = `${message} ${code}`.toLowerCase();

  if (domainValidationErrors.some((d) => text.includes(d))) {
    return false;
  }

  return (
    text.includes('socket connection has not been established yet') ||
    text.includes('timed out while waiting for a response') ||
    text.includes('timed out when trying to connect') ||
    text.includes('socket_closed') ||
    text.includes('socket_not_connected') ||
    text.includes('live_socket_not_connected') ||
    text.includes('connection closed') ||
    text.includes('connection lost') ||
    text.includes('closed socket') ||
    text.includes('network error') ||
    text.includes('failed to fetch') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    /websocket.*(?:closed|not open)/i.test(text)
  );
}

export function normalizeNakamaError(error: unknown): Error {
  if (error instanceof StaleSocketError) {
    return error;
  }
  if (isNakamaTransportError(error)) {
    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : (error as { message?: string })?.message || 'stale_socket_connection';
    return new StaleSocketError(rawMessage, error);
  }
  if (error instanceof Error) {
    return error;
  }
  const rawMessage =
    typeof error === 'string'
      ? error
      : (error as { message?: string })?.message || String(error);
  return new Error(rawMessage);
}

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

    this.socket?.disconnect(false);
    this.socket = this.client.createSocket(this.useSSL, false);
    await this.socket.connect(this.session, false);

    const result = await this.rpc('career/get', '');
    const data = JSON.parse(result) as { career: PlayerCareer };
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

  public async startBotMatch(): Promise<BotMatchTicket> {
    const result = await this.rpc('match/start', '');
    return (JSON.parse(result) as { ticket: BotMatchTicket }).ticket;
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
      throw new StaleSocketError('live_socket_not_connected');
    }
    return new LiveMatchClient(this.socket);
  }

  public isAuthenticated(): boolean {
    return this.session !== null;
  }

  private async rpc(id: string, payload: string): Promise<string> {
    if (!this.socket) {
      throw new StaleSocketError('socket_not_connected');
    }
    try {
      const result = await this.socket.rpc(id, payload);
      return result.payload ?? '';
    } catch (error: unknown) {
      throw normalizeNakamaError(error);
    }
  }
}

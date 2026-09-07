import type {
  EconomyLedgerEntry,
  MatchSettlement,
  PlayerCareer,
  PvpAction,
  PvpAttackHistoryEntry,
  PvpAttackResult,
  PvpDefenseSnapshot,
  PvpOpponent,
  UpgradePurchaseResult,
  UpgradeType,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import { LiveMatchClient } from './LiveMatchClient.js';

interface LoginResponse {
  token: string;
  career: PlayerCareer;
}

interface CareerResponse {
  career: PlayerCareer;
}

interface LedgerResponse {
  entries: EconomyLedgerEntry[];
}

interface SettlementResponse {
  settlement: MatchSettlement;
}

interface UpgradeResponse {
  result: UpgradePurchaseResult;
}

interface PvpOpponentsResponse {
  opponents: PvpOpponent[];
}

interface PvpDefenseResponse {
  defense: PvpDefenseSnapshot;
}

interface PvpAttackResponse {
  result: PvpAttackResult;
}

interface PvpHistoryResponse {
  history: PvpAttackHistoryEntry[];
}

export interface TrackedAnalyticsEvent {
  name: string;
  props?: Record<string, string | number | boolean>;
}

export interface CareerApi {
  login(platform: PlatformAdapter): Promise<PlayerCareer>;
  getCareer(): Promise<PlayerCareer>;
  getLedger(limit?: number): Promise<EconomyLedgerEntry[]>;
  settleMatch(matchId: string, actions: readonly PvpAction[]): Promise<MatchSettlement>;
  purchaseUpgrade(type: UpgradeType, purchaseId: string): Promise<UpgradePurchaseResult>;
  trackEvents(events: readonly TrackedAnalyticsEvent[]): Promise<void>;
  getPvpOpponents(limit?: number): Promise<PvpOpponent[]>;
  publishDefense(): Promise<PvpDefenseSnapshot>;
  submitPvpAttack(
    defenderId: string,
    attackId: string,
    actions: readonly PvpAction[]
  ): Promise<PvpAttackResult>;
  getPvpHistory(limit?: number): Promise<PvpAttackHistoryEntry[]>;
  openLiveMatch(): LiveMatchClient;
}

export class GameApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function isLocalCareerFallbackAllowed(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ALLOW_LOCAL_FALLBACK !== 'false';
}

/**
 * Thin client for server-authoritative career and economy operations.
 * The session token stays in memory and is recreated from platform init data
 * on every app launch.
 */
export class GameApiClient implements CareerApi {
  private readonly baseUrl: string;
  private sessionToken: string | null = null;

  constructor(
    baseUrl = import.meta.env.VITE_API_URL ||
      (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '')
  ) {
    if (!baseUrl) {
      throw new Error('VITE_API_URL_required');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async login(platform: PlatformAdapter): Promise<PlayerCareer> {
    const response = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: {
        platform: platform.platform,
        initData: platform.getInitDataRaw(),
      },
    });

    this.sessionToken = response.token;
    return response.career;
  }

  public async getCareer(): Promise<PlayerCareer> {
    return (await this.request<CareerResponse>('/career')).career;
  }

  public async getLedger(limit = 100): Promise<EconomyLedgerEntry[]> {
    return (await this.request<LedgerResponse>(`/ledger?limit=${limit}`)).entries;
  }

  /**
   * Settles a single-player match by submitting the recorded dispatch
   * actions. The server replays them through its own simulation and derives
   * the outcome, stats, and rewards; the client never decides them.
   */
  public async settleMatch(
    matchId: string,
    actions: readonly PvpAction[]
  ): Promise<MatchSettlement> {
    return (
      await this.request<SettlementResponse>('/matches/settle', {
        method: 'POST',
        body: { matchId, actions },
      })
    ).settlement;
  }

  public async trackEvents(events: readonly TrackedAnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.request('/analytics/events', { method: 'POST', body: { events } });
  }

  public async purchaseUpgrade(
    type: UpgradeType,
    purchaseId: string
  ): Promise<UpgradePurchaseResult> {
    return (
      await this.request<UpgradeResponse>('/upgrades/purchase', {
        method: 'POST',
        body: { type, purchaseId },
      })
    ).result;
  }

  public async getPvpOpponents(limit = 8): Promise<PvpOpponent[]> {
    return (await this.request<PvpOpponentsResponse>(`/pvp/opponents?limit=${limit}`)).opponents;
  }

  public async publishDefense(): Promise<PvpDefenseSnapshot> {
    return (
      await this.request<PvpDefenseResponse>('/pvp/defense/publish', {
        method: 'POST',
        body: {},
      })
    ).defense;
  }

  public async submitPvpAttack(
    defenderId: string,
    attackId: string,
    actions: readonly PvpAction[]
  ): Promise<PvpAttackResult> {
    return (
      await this.request<PvpAttackResponse>('/pvp/attacks', {
        method: 'POST',
        body: { defenderId, attackId, actions },
      })
    ).result;
  }

  public async getPvpHistory(limit = 20): Promise<PvpAttackHistoryEntry[]> {
    return (await this.request<PvpHistoryResponse>(`/pvp/history?limit=${limit}`)).history;
  }

  public openLiveMatch(): LiveMatchClient {
    if (!this.sessionToken) {
      throw new GameApiError('missing_session_token', 401);
    }
    return new LiveMatchClient(this.baseUrl, this.sessionToken);
  }

  public isAuthenticated(): boolean {
    return this.sessionToken !== null;
  }

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {}
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.sessionToken ? { authorization: `Bearer ${this.sessionToken}` } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new GameApiError(
        error instanceof Error ? error.message : 'network_request_failed',
        0
      );
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Keep the HTTP status as the useful error when the body is not JSON.
    }

    if (!response.ok) {
      const errorCode =
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'string'
          ? payload.error
          : `http_${response.status}`;
      throw new GameApiError(errorCode, response.status);
    }

    return payload as T;
  }
}

import type {
  EconomyLedgerEntry,
  MatchSettlement,
  MatchStats,
  PlayerCareer,
  UpgradePurchaseResult,
  UpgradeType,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';

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

export interface CareerApi {
  login(platform: PlatformAdapter): Promise<PlayerCareer>;
  getLedger(limit?: number): Promise<EconomyLedgerEntry[]>;
  settleMatch(
    matchId: string,
    status: 'victory' | 'defeat' | 'draw',
    stats: MatchStats
  ): Promise<MatchSettlement>;
  purchaseUpgrade(type: UpgradeType, purchaseId: string): Promise<UpgradePurchaseResult>;
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

  public async settleMatch(
    matchId: string,
    status: 'victory' | 'defeat' | 'draw',
    stats: MatchStats
  ): Promise<MatchSettlement> {
    return (
      await this.request<SettlementResponse>('/matches/settle', {
        method: 'POST',
        body: { matchId, status, stats },
      })
    ).settlement;
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

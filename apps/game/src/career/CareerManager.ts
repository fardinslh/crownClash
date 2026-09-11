/**
 * Crown Clash - Client Career & Auditable Economy Manager
 * Handles local persistence, auditable ledger tracking, and progression state.
 */

import {
  advanceDailyState,
  claimDailyRewardLocally,
  createDefaultCareer,
  createDailyState,
  DailyClaimResult,
  DailyRewardType,
  DailyState,
  EconomyLedgerEntry,
  LeagueClaimResult,
  LeagueState,
  MatchSettlement,
  MatchStats,
  normalizeDailyState,
  claimLeagueRewardLocally,
  createLeagueState,
  normalizeUpgradeLevel,
  PlayerCareer,
  PvpAction,
  purchaseUpgrade as purchaseCareerUpgrade,
  settleMatch,
  UpgradePurchaseResult,
  UpgradeType,
  CommanderId,
  CommanderSelectionResult,
  getKingdomLevel,
  isCommanderUnlocked,
  normalizeCommanderId,
  BotMatchTicket,
  createLocalBotMatchTicket,
} from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { CareerApi } from '../api/GameApiClient.js';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { getSharedGameApiClient } from '../api/sharedClient.js';
import { LiveMatchClient } from '../api/LiveMatchClient.js';

export class CareerManager {
  private static instance: CareerManager | null = null;
  private career: PlayerCareer;
  private ledger: EconomyLedgerEntry[] = [];
  private listeners: Set<(career: PlayerCareer) => void> = new Set();
  private readonly storageKey: string;
  private readonly ledgerStorageKey: string;
  private readonly dailyStorageKey: string;
  private readonly leagueStorageKey: string;
  private dailyState: DailyState;
  private remoteApi: CareerApi | null = null;
  private remoteConnected = false;
  private connectPromise: Promise<PlayerCareer> | null = null;

  private constructor(playerId: string) {
    this.storageKey = `crown_clash_career_${playerId}`;
    this.ledgerStorageKey = `crown_clash_ledger_${playerId}`;
    this.dailyStorageKey = `crown_clash_daily_${playerId}`;
    this.leagueStorageKey = `crown_clash_league_${playerId}`;
    this.career = this.loadCareer(playerId);
    this.ledger = this.loadLedger();
    this.dailyState = this.loadDailyState();
  }

  public static getInstance(playerId = 'player_guest'): CareerManager {
    if (!CareerManager.instance || CareerManager.instance.career.playerId !== playerId) {
      CareerManager.instance = new CareerManager(playerId);
    }
    return CareerManager.instance;
  }

  public getCareer(): PlayerCareer {
    return { ...this.career };
  }

  public getLedger(): readonly EconomyLedgerEntry[] {
    return [...this.ledger];
  }

  public subscribe(callback: (career: PlayerCareer) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public async connect(
    platform: PlatformAdapter,
    api: CareerApi = getSharedGameApiClient()
  ): Promise<PlayerCareer> {
    if (this.remoteConnected) {
      return this.getCareer();
    }
    // Deduplicate concurrent connects (e.g. menu + fast PLAY tap) so only a
    // single login is performed and out-of-order responses cannot clobber a
    // fresher career.
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this.performConnect(platform, api);
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async performConnect(platform: PlatformAdapter, api: CareerApi): Promise<PlayerCareer> {
    const career = await api.login(platform);
    this.remoteApi = api;
    this.remoteConnected = true;
    this.career = career;

    try {
      this.ledger = await api.getLedger();
    } catch (error) {
      console.warn('[CareerManager] Failed to hydrate economy ledger:', error);
    }

    this.saveCareer();
    this.saveLedger();
    this.emitChange();
    return this.getCareer();
  }

  /**
   * Re-fetches the authoritative career after the server mutated it outside
   * of this client's control (e.g. a live match settled on disconnect).
   */
  public async refreshRemoteCareer(): Promise<PlayerCareer> {
    const api = this.requireRemoteApi();
    const career = await api.getCareer();
    this.applyRemoteState(career, []);
    return this.getCareer();
  }

  public isRemoteConnected(): boolean {
    return this.remoteConnected;
  }

  public async recordMatchResultRemote(
    actions: readonly PvpAction[],
    matchId: string,
    platform?: PlatformAdapter
  ): Promise<MatchSettlement> {
    const api = this.requireRemoteApi();
    try {
      const settlement = await api.settleMatch(matchId, actions);
      this.applyRemoteState(settlement.newCareer, settlement.ledgerEntries);
      return settlement;
    } catch (error) {
      if (!platform) throw error;

      // Messenger/CDN proxies may silently drop an otherwise authenticated
      // WebSocket during a match. Re-authenticate once and retry settlement
      // so victory progress is preserved.
      this.remoteConnected = false;
      await this.connect(platform, api);
      const settlement = await api.settleMatch(matchId, actions);
      this.applyRemoteState(settlement.newCareer, settlement.ledgerEntries);
      return settlement;
    }
  }

  public async startBotMatch(platform?: PlatformAdapter): Promise<BotMatchTicket> {
    if (this.remoteConnected) {
      const api = this.requireRemoteApi();
      try {
        return await api.startBotMatch();
      } catch (error) {
        if (!platform) throw error;

        // Messenger/CDN proxies may silently drop an otherwise authenticated
        // WebSocket while the player is in a bot battle or viewing results.
        // Re-authenticate once so PLAY AGAIN does not reuse the stale socket.
        this.remoteConnected = false;
        await this.connect(platform, api);
        return api.startBotMatch();
      }
    }
    if (!isLocalCareerFallbackAllowed()) throw new Error('backend_required_for_match_start');
    return createLocalBotMatchTicket();
  }

  public async purchaseUpgradeRemote(type: UpgradeType): Promise<UpgradePurchaseResult> {
    const purchaseId = `upgrade_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = await this.requireRemoteApi().purchaseUpgrade(type, purchaseId);

    if (result.success) {
      this.applyRemoteState(result.newCareer, [result.ledgerEntry]);
    }

    return result;
  }

  public async selectCommander(commanderId: CommanderId): Promise<CommanderSelectionResult> {
    if (this.remoteConnected) {
      const result = await this.requireRemoteApi().selectCommander(commanderId);
      if (result.success) this.applyRemoteState(result.newCareer, []);
      return result;
    }
    if (!isLocalCareerFallbackAllowed()) throw new Error('backend_required_for_commander');
    if (!isCommanderUnlocked(commanderId, getKingdomLevel(this.career))) {
      return { success: false, reason: 'commander_locked', commanderId, newCareer: this.getCareer() };
    }
    this.career = { ...this.career, selectedCommanderId: commanderId };
    this.saveCareer();
    this.emitChange();
    return { success: true, commanderId, newCareer: this.getCareer() };
  }

  public getDailyStateRemote(): Promise<DailyState> {
    return this.requireRemoteApi().getDailyState();
  }

  public async claimDailyRewardRemote(type: DailyRewardType): Promise<DailyClaimResult> {
    const claimId = `daily_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = await this.requireRemoteApi().claimDailyReward(type, claimId);
    this.dailyState = result.state;
    this.saveDailyState();
    if (result.success && result.ledgerEntry) {
      this.applyRemoteState(result.newCareer, [result.ledgerEntry]);
    }
    return result;
  }

  public async getDailyState(): Promise<DailyState> {
    if (this.remoteConnected) {
      const state = await this.getDailyStateRemote();
      this.dailyState = state;
      this.saveDailyState();
      return state;
    }
    if (!isLocalCareerFallbackAllowed()) {
      throw new Error('backend_required_for_daily_missions');
    }
    this.dailyState = normalizeDailyState(this.dailyState);
    this.saveDailyState();
    return this.dailyState;
  }

  public async claimDailyReward(type: DailyRewardType): Promise<DailyClaimResult> {
    if (this.remoteConnected) return this.claimDailyRewardRemote(type);
    if (!isLocalCareerFallbackAllowed()) {
      throw new Error('backend_required_for_daily_claim');
    }

    const claimId = `daily_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const result = claimDailyRewardLocally(this.dailyState, this.career, type, claimId);
    this.dailyState = result.state;
    this.saveDailyState();
    if (result.success && result.ledgerEntry) {
      this.career = result.newCareer;
      this.ledger.push(result.ledgerEntry);
      this.saveCareer();
      this.saveLedger();
      this.emitChange();
    }
    return result;
  }

  public async getLeagueState(): Promise<LeagueState> {
    if (this.remoteConnected) return this.requireRemoteApi().getLeagueState();
    if (!isLocalCareerFallbackAllowed()) throw new Error('backend_required_for_league');
    return createLeagueState(this.career, this.loadLeagueClaims());
  }

  public async claimLeagueReward(rankId: string): Promise<LeagueClaimResult> {
    const claimId = `league_${rankId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (this.remoteConnected) {
      const result = await this.requireRemoteApi().claimLeagueReward(rankId, claimId);
      if (result.success && result.ledgerEntry) {
        this.applyRemoteState(result.newCareer, [result.ledgerEntry]);
      }
      return result;
    }
    if (!isLocalCareerFallbackAllowed()) throw new Error('backend_required_for_league_claim');
    const state = createLeagueState(this.career, this.loadLeagueClaims());
    const result = claimLeagueRewardLocally(state, this.career, rankId, claimId);
    if (result.success && result.ledgerEntry) {
      this.career = result.newCareer;
      this.ledger.push(result.ledgerEntry);
      this.saveLeagueClaims(
        result.state.tiers.filter((tier) => tier.claimed).map((tier) => tier.rankId)
      );
      this.saveCareer();
      this.saveLedger();
      this.emitChange();
    }
    return result;
  }

  public openLiveMatchRemote(): LiveMatchClient {
    return this.requireRemoteApi().openLiveMatch();
  }

  public applyLiveMatchSettlement(settlement: MatchSettlement): void {
    this.applyRemoteState(settlement.newCareer, settlement.ledgerEntries);
  }

  /**
   * Authoritatively settles match results, updates career balances, and appends to audit ledger.
   */
  public recordMatchResult(
    status: 'victory' | 'defeat' | 'draw',
    stats: MatchStats,
    matchId = `m_${Date.now()}`
  ): MatchSettlement {
    const settlement = settleMatch(this.career, status, stats, matchId, Date.now());

    // Update in-memory state
    this.career = settlement.newCareer;
    this.ledger.push(...settlement.ledgerEntries);
    this.dailyState = advanceDailyState(this.dailyState, settlement.status, settlement.stats);

    // Save state and audit log to storage
    this.saveCareer();
    this.saveLedger();
    this.saveDailyState();

    // Notify listeners (HUD counters, etc.)
    this.emitChange();

    return settlement;
  }

  public purchaseUpgrade(type: UpgradeType): UpgradePurchaseResult {
    const timestamp = Date.now();
    const purchaseId = `upgrade_${type}_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
    const result = purchaseCareerUpgrade(this.career, type, purchaseId, timestamp);

    if (!result.success) {
      return result;
    }

    this.career = result.newCareer;
    this.ledger.push(result.ledgerEntry);
    this.saveCareer();
    this.saveLedger();
    this.emitChange();

    return result;
  }

  private loadCareer(playerId: string): PlayerCareer {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createDefaultCareer(playerId);
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PlayerCareer>;
        if (parsed && typeof parsed.coins === 'number' && typeof parsed.trophies === 'number') {
          return {
            playerId,
            coins: Math.max(0, parsed.coins),
            gems: typeof parsed.gems === 'number' ? parsed.gems : 10,
            trophies: Math.max(0, parsed.trophies),
            startingGarrisonLevel: normalizeUpgradeLevel(
              parsed.startingGarrisonLevel,
              'starting_garrison'
            ),
            productionLevel: normalizeUpgradeLevel(parsed.productionLevel, 'production'),
            armySpeedLevel: normalizeUpgradeLevel(parsed.armySpeedLevel, 'army_speed'),
            treasuryLevel: normalizeUpgradeLevel(parsed.treasuryLevel, 'treasury'),
            selectedCommanderId: normalizeCommanderId(parsed.selectedCommanderId),
            matchesPlayed: parsed.matchesPlayed ?? 0,
            matchesWon: parsed.matchesWon ?? 0,
            currentStreak: parsed.currentStreak ?? 0,
            bestStreak: parsed.bestStreak ?? 0,
            lastMatchTimestamp: parsed.lastMatchTimestamp ?? 0,
          };
        }
      }
    } catch (err) {
      console.warn('[CareerManager] Failed to load career from storage, falling back to default:', err);
    }

    const initial = createDefaultCareer(playerId);
    this.saveCareerDirect(initial);
    return initial;
  }

  private requireRemoteApi(): CareerApi {
    if (!this.remoteApi || !this.remoteConnected) {
      throw new Error('career_remote_not_connected');
    }
    return this.remoteApi;
  }

  private applyRemoteState(career: PlayerCareer, entries: EconomyLedgerEntry[]): void {
    this.career = career;
    const knownEntryIds = new Set(this.ledger.map((entry) => entry.id));
    this.ledger.push(...entries.filter((entry) => !knownEntryIds.has(entry.id)));
    this.saveCareer();
    this.saveLedger();
    this.emitChange();
  }

  private loadLedger(): EconomyLedgerEntry[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(this.ledgerStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as EconomyLedgerEntry[];
        if (Array.isArray(parsed)) {
          return parsed.slice(-100); // Retain latest 100 entries for client auditing
        }
      }
    } catch {
      // Ignored
    }

    return [];
  }

  private loadDailyState(): DailyState {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createDailyState();
    }
    try {
      const raw = window.localStorage.getItem(this.dailyStorageKey);
      if (raw) return normalizeDailyState(JSON.parse(raw) as DailyState);
    } catch (error) {
      console.warn('[CareerManager] Failed to load daily progress:', error);
    }
    return createDailyState();
  }

  private loadLeagueClaims(): string[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const raw = window.localStorage.getItem(this.leagueStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
      return [];
    }
  }

  private saveLeagueClaims(rankIds: readonly string[]): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(this.leagueStorageKey, JSON.stringify(rankIds));
    } catch (error) {
      console.error('[CareerManager] Failed to save league claims:', error);
    }
  }

  private saveCareer(): void {
    this.saveCareerDirect(this.career);
  }

  private saveCareerDirect(career: PlayerCareer): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(career));
    } catch (err) {
      console.error('[CareerManager] Failed to save career:', err);
    }
  }

  private saveLedger(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const capped = this.ledger.slice(-100);
      window.localStorage.setItem(this.ledgerStorageKey, JSON.stringify(capped));
    } catch (err) {
      console.error('[CareerManager] Failed to save ledger:', err);
    }
  }

  private saveDailyState(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(this.dailyStorageKey, JSON.stringify(this.dailyState));
    } catch (error) {
      console.error('[CareerManager] Failed to save daily progress:', error);
    }
  }

  private emitChange(): void {
    const snapshot = this.getCareer();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[CareerManager] Listener error:', err);
      }
    });
  }
}

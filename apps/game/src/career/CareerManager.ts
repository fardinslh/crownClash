/**
 * Crown Clash - Client Career & Auditable Economy Manager
 * Handles local persistence, auditable ledger tracking, and progression state.
 */

import {
  createDefaultCareer,
  EconomyLedgerEntry,
  MatchSettlement,
  MatchStats,
  normalizeUpgradeLevel,
  PlayerCareer,
  purchaseUpgrade as purchaseCareerUpgrade,
  settleMatch,
  UpgradePurchaseResult,
  UpgradeType,
} from '@crown-clash/game-core';

export class CareerManager {
  private static instance: CareerManager | null = null;
  private career: PlayerCareer;
  private ledger: EconomyLedgerEntry[] = [];
  private listeners: Set<(career: PlayerCareer) => void> = new Set();
  private readonly storageKey: string;
  private readonly ledgerStorageKey: string;

  private constructor(playerId: string) {
    this.storageKey = `crown_clash_career_${playerId}`;
    this.ledgerStorageKey = `crown_clash_ledger_${playerId}`;
    this.career = this.loadCareer(playerId);
    this.ledger = this.loadLedger();
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

    // Save state and audit log to storage
    this.saveCareer();
    this.saveLedger();

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

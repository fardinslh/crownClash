import {
  formatDominancePercentages,
  type DominancePercentagesResult,
} from '../ui/HudLayout.js';

export interface StrideMetrics {
  leaderY: number;
  leaderScaleX: number;
  leaderScaleY: number;
  followerYOffset: number;
  followerScaleX: number;
  followerScaleY: number;
}

export const STRIDE_PERIOD_SECONDS = 0.26;

/**
 * Computes procedural rhythmic stride bounce and squash/stretch offsets
 * without allocating or updating Phaser Tween instances.
 */
export function computeMarchStride(
  phaseSeconds: number,
  delaySeconds: number = 0
): StrideMetrics {
  const phase = ((phaseSeconds - delaySeconds) / STRIDE_PERIOD_SECONDS) * Math.PI * 2;
  const sin = Math.sin(phase);

  return {
    leaderY: sin * 1.75 - 1.75,
    leaderScaleX: 0.24 - sin * 0.015,
    leaderScaleY: 0.26 + sin * 0.015,
    followerYOffset: sin * 1.25 - 1.25,
    followerScaleX: 0.18 - sin * 0.012,
    followerScaleY: 0.20 + sin * 0.012,
  };
}

/**
 * Calculates territory and army strengths and dominance percentages in a single pass
 * without allocating intermediate arrays (e.g. Object.values, .filter, .map).
 */
export function fastComputeDominance(gameState: {
  territories: Record<string, { owner: string; units: number }>;
  armies: ReadonlyArray<{ owner: string; units: number }>;
}): DominancePercentagesResult {
  let playerStrength = 0;
  let enemyStrength = 0;
  let neutralStrength = 0;
  let playerArmiesCount = 0;
  let enemyArmiesCount = 0;
  let enemyTerritoriesCount = 0;

  const terrs = gameState.territories;
  for (const id in terrs) {
    const t = terrs[id];
    if (t.owner === 'player') {
      playerStrength += 35 + t.units;
    } else if (t.owner === 'enemy') {
      enemyStrength += 35 + t.units;
      enemyTerritoriesCount++;
    } else {
      neutralStrength += 15 + t.units;
    }
  }

  const armies = gameState.armies;
  const armyLen = armies.length;
  for (let i = 0; i < armyLen; i++) {
    const a = armies[i];
    if (a.owner === 'player') {
      playerStrength += a.units;
      playerArmiesCount++;
    } else if (a.owner === 'enemy') {
      enemyStrength += a.units;
      enemyArmiesCount++;
    }
  }

  return formatDominancePercentages({
    playerStrength,
    enemyStrength,
    neutralStrength,
    playerArmiesCount,
    enemyArmiesCount,
    enemyTerritoriesCount,
  });
}

export interface DominanceDirtyResult {
  barsChanged: boolean;
  playerTextChanged: boolean;
  enemyTextChanged: boolean;
}

/**
 * Tracks dominance metrics and signals whether bars or text labels require visual updates,
 * avoiding expensive transform and geometry invalidations when values are identical.
 */
export class DominanceBarDirtyChecker {
  private lastPlayerPct = -1;
  private lastNeutralPct = -1;
  private lastEnemyPct = -1;
  private lastPlayerDomText = '';
  private lastEnemyDomText = '';

  public check(dominance: DominancePercentagesResult): DominanceDirtyResult {
    const barsChanged =
      dominance.playerPct !== this.lastPlayerPct ||
      dominance.neutralPct !== this.lastNeutralPct ||
      dominance.enemyPct !== this.lastEnemyPct;

    const playerTextChanged = dominance.playerDomText !== this.lastPlayerDomText;
    const enemyTextChanged = dominance.enemyDomText !== this.lastEnemyDomText;

    if (barsChanged) {
      this.lastPlayerPct = dominance.playerPct;
      this.lastNeutralPct = dominance.neutralPct;
      this.lastEnemyPct = dominance.enemyPct;
    }
    if (playerTextChanged) {
      this.lastPlayerDomText = dominance.playerDomText;
    }
    if (enemyTextChanged) {
      this.lastEnemyDomText = dominance.enemyDomText;
    }

    return { barsChanged, playerTextChanged, enemyTextChanged };
  }

  public reset(): void {
    this.lastPlayerPct = -1;
    this.lastNeutralPct = -1;
    this.lastEnemyPct = -1;
    this.lastPlayerDomText = '';
    this.lastEnemyDomText = '';
  }
}

export interface DustPuffItem {
  x: number;
  y: number;
  startY: number;
  scale: number;
  alpha: number;
  color: number;
  active: boolean;
  elapsed: number;
  duration: number;
}

/**
 * Reusable ring-buffer pool of dust particles that eliminates repeated game object
 * allocations and destroys during active marching dispatches.
 */
export class DustPuffSimulator {
  private items: DustPuffItem[];
  private nextIndex = 0;

  constructor(public readonly capacity = 16) {
    this.items = Array.from({ length: capacity }, () => ({
      x: 0,
      y: 0,
      startY: 0,
      scale: 1,
      alpha: 0,
      color: 0,
      active: false,
      elapsed: 0,
      duration: 0.22,
    }));
  }

  public spawn(x: number, y: number, color: number, duration = 0.22): DustPuffItem {
    const item = this.items[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % this.capacity;

    const jitterX = Math.random() * 4 - 2;
    const jitterY = Math.random() * 3 - 1.5;

    item.x = x + jitterX;
    item.y = y + 6 + jitterY;
    item.startY = item.y;
    item.scale = 1;
    item.alpha = 0.45;
    item.color = color;
    item.active = true;
    item.elapsed = 0;
    item.duration = duration;

    return item;
  }

  public update(deltaSeconds: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const item = this.items[i];
      if (!item.active) continue;

      item.elapsed += deltaSeconds;
      if (item.elapsed >= item.duration) {
        item.active = false;
        item.alpha = 0;
        continue;
      }

      const progress = item.elapsed / item.duration;
      item.scale = 1 + progress * 0.8;
      item.alpha = 0.45 * (1 - progress);
      item.y = item.startY - progress * 4;
    }
  }

  public getItems(): readonly DustPuffItem[] {
    return this.items;
  }

  public reset(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.items[i].active = false;
      this.items[i].alpha = 0;
    }
    this.nextIndex = 0;
  }
}


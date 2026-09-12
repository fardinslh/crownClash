import type Phaser from 'phaser';
import type { MarchingArmy, Team } from '@crown-clash/game-core';

export interface StressDispatchPair {
  sourceId: string;
  targetId: string;
  owner: Team;
}

const STRESS_LANES: StressDispatchPair[] = [
  { sourceId: 'p_base', targetId: 'n_center', owner: 'player' },
  { sourceId: 'e_base', targetId: 'n_center', owner: 'enemy' },
  { sourceId: 'n_bot_left', targetId: 'n_center', owner: 'player' },
  { sourceId: 'n_top_right', targetId: 'n_center', owner: 'enemy' },
  { sourceId: 'n_mid_left', targetId: 'n_mid_right', owner: 'player' },
  { sourceId: 'n_mid_right', targetId: 'n_mid_left', owner: 'enemy' },
  { sourceId: 'n_bot_right', targetId: 'p_base', owner: 'player' },
  { sourceId: 'n_top_left', targetId: 'e_base', owner: 'enemy' },
];

export class StressModeController {
  private game: Phaser.Game | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private laneIndex = 0;
  private armySequence = 1;
  private running = false;
  private testBannerEl: HTMLElement | null = null;

  constructor(game?: Phaser.Game) {
    if (game) this.attachGame(game);
  }

  public attachGame(game: Phaser.Game): void {
    this.game = game;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.ensureBanner();

    const activeScene = this.getGameScene();
    if (activeScene) {
      (activeScene as any).isStressMode = true;
    }

    this.intervalId = setInterval(() => {
      this.stepDispatch();
    }, 350);
  }

  public stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.removeBanner();
  }

  public reset(): void {
    this.stop();
    const scene = this.getGameScene();
    if (!scene || !(scene as any).gameState) return;

    const state = (scene as any).gameState;
    state.armies = [];
    state.status = 'playing';

    // Reset territories to healthy baseline
    for (const t of Object.values(state.territories as Record<string, any>)) {
      if (t.id === 'p_base') {
        t.owner = 'player';
        t.units = 25;
      } else if (t.id === 'e_base') {
        t.owner = 'enemy';
        t.units = 25;
      } else {
        t.owner = 'neutral';
        t.units = t.tier === 2 ? 14 : 8;
      }
    }

    if (typeof (scene as any).markTerritoriesDirty === 'function') {
      (scene as any).markTerritoriesDirty();
    }
    if (typeof (scene as any).updateTerritoryVisuals === 'function') {
      (scene as any).updateTerritoryVisuals(true);
    }
  }

  private stepDispatch(): void {
    const scene = this.getGameScene();
    if (!scene || !(scene as any).gameState) return;

    (scene as any).isStressMode = true;
    const state = (scene as any).gameState;
    if (state.status !== 'playing') {
      state.status = 'playing';
    }

    const pair = STRESS_LANES[this.laneIndex % STRESS_LANES.length];
    this.laneIndex++;

    const source = state.territories[pair.sourceId];
    const target = state.territories[pair.targetId];
    if (!source || !target) return;

    // Resupply source to prevent starvation
    if (source.units < 12) source.units = 20;

    const unitsToSend = 6;
    source.units = Math.max(1, source.units - unitsToSend);

    const army: MarchingArmy = {
      id: `stress_army_${this.armySequence++}`,
      owner: pair.owner,
      units: unitsToSend,
      sourceId: source.id,
      targetId: target.id,
      startX: source.x,
      startY: source.y,
      targetX: target.x,
      targetY: target.y,
      progress: 0,
      speed: 140,
      distance: Math.hypot(target.x - source.x, target.y - source.y),
    };

    state.armies.push(army);
    if (typeof (scene as any).markTerritoriesDirty === 'function') {
      (scene as any).markTerritoriesDirty();
    }
  }

  private getGameScene(): Phaser.Scene | null {
    if (!this.game?.scene) return null;
    return this.game.scene.getScene('GameScene') || null;
  }

  private ensureBanner(): void {
    if (typeof document === 'undefined' || this.testBannerEl) return;
    const banner = document.createElement('div');
    banner.id = 'stress-mode-banner';
    banner.textContent = '⚠️ TEST MODE (NO PROGRESSION)';
    banner.style.cssText = `
      position: fixed;
      top: max(4px, env(safe-area-inset-top));
      left: 50%;
      transform: translateX(-50%);
      z-index: 99998;
      background: #dc2626;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 3px 12px;
      border-radius: 999px;
      box-shadow: 0 2px 10px rgba(220, 38, 38, 0.6);
      pointer-events: none;
    `;
    document.body.appendChild(banner);
    this.testBannerEl = banner;
  }

  private removeBanner(): void {
    if (this.testBannerEl) {
      this.testBannerEl.remove();
      this.testBannerEl = null;
    }
  }

  public destroy(): void {
    this.stop();
  }
}

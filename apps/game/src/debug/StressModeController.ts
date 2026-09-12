import type Phaser from 'phaser';
import type { MarchingArmy, Team } from '@crown-clash/game-core';
import { QA_BANNER_TOP_CSS, QA_BANNER_HEIGHT_PX } from './qaLayout.js';

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
  private savedTerritoriesSnapshot: Record<string, { owner: Team; units: number }> | null = null;

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

    // Dual-gating: if in a browser window with search params, debug_performance=1 is strictly required
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug_performance') !== '1') {
        return;
      }
    }

    const activeScene = this.getGameScene();
    // Do not modify live authoritative match state
    if (activeScene && (activeScene as any).liveMode) {
      this.game?.registry?.set('qa_stress_mode', false);
      (activeScene as any).isStressMode = false;
      return;
    }

    this.running = true;
    this.ensureBanner();

    // Signal stress mode via registry so if GameScene mounts later, it activates isolated stress
    this.game?.registry?.set('qa_stress_mode', true);

    if (activeScene && (activeScene as any).gameState) {
      // Snapshot original territory state before simulation mutates units
      if (!this.savedTerritoriesSnapshot) {
        this.savedTerritoriesSnapshot = {};
        const territories = (activeScene as any).gameState.territories as Record<string, any>;
        if (territories) {
          for (const [id, t] of Object.entries(territories)) {
            this.savedTerritoriesSnapshot[id] = { owner: t.owner, units: t.units };
          }
        }
      }
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

    // Clear registry flag
    this.game?.registry?.set('qa_stress_mode', false);

    const activeScene = this.getGameScene();
    if (activeScene) {
      (activeScene as any).isStressMode = false;
    }
  }

  public reset(): void {
    this.stop();
    const scene = this.getGameScene();
    if (!scene || !(scene as any).gameState) return;

    // Ensure stress mode is cleared
    (scene as any).isStressMode = false;

    const state = (scene as any).gameState;
    // Strip generated stress armies
    state.armies = (state.armies || []).filter(
      (a: MarchingArmy) => !a.id.startsWith('stress_army_')
    );
    state.status = 'playing';

    // Restore territories from snapshot if available, or reset to baseline
    if (this.savedTerritoriesSnapshot) {
      for (const [id, saved] of Object.entries(this.savedTerritoriesSnapshot)) {
        const t = state.territories?.[id];
        if (t) {
          t.owner = saved.owner;
          t.units = saved.units;
        }
      }
      this.savedTerritoriesSnapshot = null;
    } else if (state.territories) {
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
    if (!scene || !(scene as any).gameState || (scene as any).liveMode) return;

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
    if (!this.game?.scene || typeof this.game.scene.getScene !== 'function') return null;
    return this.game.scene.getScene('GameScene') || null;
  }

  private ensureBanner(): void {
    if (typeof document === 'undefined' || this.testBannerEl) return;
    const banner = document.createElement('div');
    banner.id = 'stress-mode-banner';
    banner.textContent = '⚠️ TEST MODE (NO PROGRESSION)';
    banner.style.cssText = `
      position: fixed;
      top: ${QA_BANNER_TOP_CSS};
      left: 50%;
      transform: translateX(-50%);
      height: ${QA_BANNER_HEIGHT_PX}px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      z-index: 99998;
      background: #dc2626;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 0 12px;
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
    this.reset();
  }
}

import Phaser from 'phaser';
import { isLevelUnlocked, LEVELS, LEVEL_COUNT, LOGICAL_WIDTH, type LevelDefinition } from '@crown-clash/game-core';
import { createPlatformAdapter, type PlatformAdapter } from '@crown-clash/platform';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { faLevels } from '../i18n/faLevels.js';
import { faWeekly } from '../i18n/faWeekly.js';
import { faLane } from '../i18n/faLane.js';
import { featureFlags } from '../config/featureFlags.js';
import { nextLaneLevelId } from '../lane/laneProgress.js';
import { THEME, UI } from '../theme.js';
import { computeLevelsLayout, type LevelsLayout } from '../ui/LevelsLayout.js';
import { createText } from '../ui/TextStyles.js';
import { createIcon } from '../ui/icons.js';
import { bindSceneViewportResize, getSceneViewport, setupSceneCamera, type SceneViewport } from '../ui/Viewport.js';
import {
  createBackButton,
  createButton,
  createGlow,
  createHeader,
  fadeIn,
  goToScene,
  showToast,
  type KitButton,
} from '../ui/kit/index.js';
import { createHubBackdrop } from '../ui/kit/hubBackdrop.js';

/** Node colours per state: the next level glows gold, cleared ones turn green, locked ones fade to slate. */
const NODE_COLORS = {
  current: { fill: 0xf59e0b, rim: 0xfde68a, text: '#3b2305', textStroke: '#fde68a' },
  done: { fill: 0x10b981, rim: 0x6ee7b7, text: '#ffffff', textStroke: '#065f46' },
  locked: { fill: 0x3a4a6e, rim: 0x6b7ca3, text: '#cbd5e1', textStroke: '#1e293b' },
} as const;

const DIFFICULTY_COLORS: Record<LevelDefinition['botDifficulty'], string> = {
  easy: UI.text.success,
  normal: UI.text.gold,
  hard: UI.text.danger,
};

/**
 * Single-player campaign list. Levels unlock in order; progress is read from
 * (and written to) the backend by CareerManager. Tapping an open level starts
 * a client-local bot match (GameScene with `levelId`).
 */
export class LevelsScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private background!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private progressText?: Phaser.GameObjects.Text;
  private retryButton?: KitButton;
  private weeklyButton?: KitButton;
  private cards: Phaser.GameObjects.Container[] = [];
  private road?: Phaser.GameObjects.Graphics;
  private levelsCompleted = 0;
  private loaded = false;
  private active = false;
  private isExiting = false;
  private visitId = 0;
  private reducedMotion = false;
  private toastY = 600;

  constructor() {
    super({ key: 'LevelsScene' });
  }

  create(): void {
    this.active = true;
    this.isExiting = false;
    this.visitId += 1;
    this.cards = [];
    this.progressText = undefined;
    this.retryButton = undefined;
    this.weeklyButton = undefined;
    this.loaded = false;
    this.levelsCompleted = 0;
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    setupSceneCamera(this);
    bindSceneViewportResize(this, (vp) => this.applyLayout(vp));
    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);

    this.buildShell();
    this.platform.showBackButton(() => this.close());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.active = false;
      this.platform.hideBackButton();
    });
    void this.loadProgress();
    fadeIn(this);
  }

  private buildShell(): void {
    const vp = getSceneViewport(this);
    this.background = this.add.rectangle(0, 0, 10, 10, UI.bg).setDepth(-30);
    createHubBackdrop(this);
    createGlow(this, LOGICAL_WIDTH / 2, -30, vp.visibleWidth * 1.4, 280, 0x22c55e, 0.18);
    createBackButton(this, LOGICAL_WIDTH - 34, 38, () => this.close());
    createHeader(this, faLevels.title, faLevels.subtitle);
    this.statusText = createText(this, LOGICAL_WIDTH / 2, 0, faLevels.loading, {
      fontSize: `${UI.type.body}px`,
      fontStyle: '700',
      color: UI.text.muted,
    }).setOrigin(0.5);
    // The weekly challenge is server-only, so its entry shows only with a backend.
    if (this.careerManager.isRemoteConnected() || !isLocalCareerFallbackAllowed()) {
      this.weeklyButton = createButton(this, LOGICAL_WIDTH / 2, 0, {
        width: 344,
        height: 48,
        label: `${faWeekly.entry} · ${faWeekly.entryHint(250)}`,
        icon: 'trophy',
        variant: 'gold',
        fontSize: 15,
        onPress: () => this.openWeekly(),
      });
    }
    // Lane battles (candidate rules v5) are a client-local beta behind a build flag.
    if (featureFlags.enableLanes === true) {
      createButton(this, 76, 38, {
        width: 124,
        height: 44,
        label: faLane.entry,
        variant: 'secondary',
        fontSize: 11,
        onPress: () => this.openLaneBattle(),
      });
    }
    this.applyLayout(vp);
  }

  private applyLayout(vp: SceneViewport): void {
    const layout = computeLevelsLayout(LEVEL_COUNT, vp.visibleHeight);
    this.background.setPosition(LOGICAL_WIDTH / 2, vp.visibleHeight / 2).setSize(vp.visibleWidth, vp.visibleHeight);
    this.statusText.setY(layout.statusY);
    this.retryButton?.container.setY(layout.statusY + 56);
    this.progressText?.setY(layout.progressY);
    this.weeklyButton?.container.setY(layout.weeklyY);
    this.cards.forEach((card, index) => card.setPosition(layout.nodes[index].x, layout.nodes[index].y));
    if (this.cards.length > 0) this.drawRoad(layout);
    this.toastY = layout.toastY;
  }

  private async loadProgress(): Promise<void> {
    const visitId = this.visitId;
    try {
      if (!this.careerManager.isRemoteConnected() && !isLocalCareerFallbackAllowed()) {
        await this.careerManager.connect(this.platform);
      }
      const completed = await this.careerManager.getLevelsCompleted();
      if (!this.active || visitId !== this.visitId) return;
      this.levelsCompleted = completed;
      this.loaded = true;
      this.statusText.setVisible(false);
      this.renderCards();
    } catch (error) {
      console.error('[LevelsScene] Failed to load progress:', error);
      if (this.active && visitId === this.visitId) this.showLoadError();
    }
  }

  private showLoadError(): void {
    this.statusText.setText(faLevels.loadFailed).setColor(UI.text.danger).setVisible(true);
    this.retryButton?.container.destroy();
    let retried = false;
    this.retryButton = createButton(this, LOGICAL_WIDTH / 2, 0, {
      width: 170,
      height: 48,
      label: faLevels.retry,
      onPress: () => {
        if (retried) return;
        retried = true;
        this.retryButton?.container.destroy();
        this.retryButton = undefined;
        this.statusText.setText(faLevels.loading).setColor(UI.text.muted);
        void this.loadProgress();
      },
    });
    this.applyLayout(getSceneViewport(this));
  }

  private renderCards(): void {
    for (const card of this.cards) card.destroy(true);
    this.cards = LEVELS.map((level) => this.buildCard(level));
    this.progressText?.destroy();
    this.progressText = createText(this, LOGICAL_WIDTH / 2, 0, faLevels.progress(this.levelsCompleted, LEVEL_COUNT), {
      fontSize: `${UI.type.body}px`,
      fontStyle: '800',
      color: UI.text.secondary,
      stroke: UI.text.stroke,
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.applyLayout(getSceneViewport(this));
    if (!this.reducedMotion) {
      this.cards.forEach((card, index) => {
        card.setAlpha(0);
        this.tweens.add({ targets: card, alpha: 1, duration: 200, delay: index * 30 });
      });
    }
  }

  private buildCard(level: LevelDefinition): Phaser.GameObjects.Container {
    const layout = computeLevelsLayout(LEVEL_COUNT, getSceneViewport(this).visibleHeight);
    const radius = layout.nodeRadius;
    const side = layout.nodes[level.id - 1]?.labelSide === 'left' ? -1 : 1;
    const unlocked = isLevelUnlocked(this.levelsCompleted, level.id);
    const completed = level.id <= this.levelsCompleted;
    const current = unlocked && !completed;
    const palette = current ? NODE_COLORS.current : completed ? NODE_COLORS.done : NODE_COLORS.locked;
    const container = this.add.container(0, 0);
    // Raised round button: drop shadow, rim, face and a soft top gloss.
    const face = this.add.graphics();
    face.fillStyle(0x000000, 0.3).fillCircle(0, 3, radius + 1);
    face.fillStyle(palette.rim, 1).fillCircle(0, 0, radius);
    face.fillStyle(palette.fill, 1).fillCircle(0, 0, radius - 3.5);
    face.fillStyle(0xffffff, 0.22).fillEllipse(0, -radius * 0.38, radius * 1.15, radius * 0.7);
    const glow = current ? this.add.graphics().fillStyle(THEME.gold, 0.28).fillCircle(0, 0, radius + 9) : undefined;
    container.add(glow ? [glow, face] : [face]);
    if (completed) {
      container.add(createIcon(this, 0, 0, 'check', radius * 0.95));
    } else if (!unlocked) {
      container.add(createIcon(this, 0, 0, 'lock', radius * 0.8).setAlpha(0.85));
    } else {
      container.add(
        createText(this, 0, 1, `${level.id}`, {
          fontSize: `${Math.round(radius * 0.95)}px`,
          fontStyle: '900',
          color: palette.text,
          stroke: palette.textStroke,
          strokeThickness: 3,
        }).setOrigin(0.5),
      );
    }
    // Label on the free outer side: difficulty over the first-clear reward.
    const labelX = side * (radius + 10);
    const origin = side === 1 ? 0 : 1;
    const dim = unlocked ? 1 : 0.85;
    container.add(
      createText(this, labelX, completed ? 0 : -9, faLevels.difficulty[level.botDifficulty], {
        fontSize: '13px',
        fontStyle: '800',
        color: unlocked ? DIFFICULTY_COLORS[level.botDifficulty] : UI.text.muted,
        stroke: UI.text.stroke,
        strokeThickness: 3,
      }).setOrigin(origin, 0.5).setAlpha(dim),
    );
    if (!completed) {
      // First-clear reward preview; cleared levels show the check instead.
      const reward = createText(this, labelX + side * 18, 9, faLevels.rewardBadge(level.coinReward), {
        fontSize: '14px',
        fontStyle: '800',
        color: unlocked ? UI.text.gold : UI.text.muted,
        stroke: UI.text.stroke,
        strokeThickness: 3,
      }).setOrigin(origin, 0.5).setAlpha(dim);
      const coin = createIcon(this, labelX + side * 7, 9, 'coin', 15).setAlpha(dim);
      container.add([coin, reward]);
    }
    container.setSize(radius * 2 + 12, radius * 2 + 12).setInteractive({ useHandCursor: unlocked });
    container.on('pointerdown', () => this.onCardPressed(level, container));
    if (current && !this.reducedMotion) {
      this.tweens.add({ targets: container, scale: 1.08, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    return container;
  }

  /** The road under the nodes: tan track, with the cleared stretch lit green. */
  private drawRoad(layout: LevelsLayout): void {
    this.road?.destroy();
    if (layout.nodes.length < 2) return;
    const g = this.add.graphics().setDepth(-5);
    const points = layout.nodes.map((node) => new Phaser.Math.Vector2(node.x, node.y));
    const curve = new Phaser.Curves.Spline(points);
    const sampled = curve.getPoints(points.length * 14);
    const stroke = (width: number, color: number, alpha: number, until = sampled.length): void => {
      g.lineStyle(width, color, alpha);
      g.beginPath();
      sampled.slice(0, until).forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.strokePath();
    };
    stroke(layout.nodeRadius * 0.9 + 6, 0x000000, 0.2);
    stroke(layout.nodeRadius * 0.9, 0xd9c08a, 0.95);
    stroke(layout.nodeRadius * 0.9 - 8, 0xeed9a6, 0.9);
    const cleared = Math.min(this.levelsCompleted, layout.nodes.length - 1);
    if (cleared > 0) stroke(layout.nodeRadius * 0.9 - 8, 0x6ee7b7, 0.95, Math.round((cleared / (layout.nodes.length - 1)) * (sampled.length - 1)) + 1);
    this.road = g;
  }

  private onCardPressed(level: LevelDefinition, card: Phaser.GameObjects.Container): void {
    if (this.isExiting || !this.loaded) return;
    if (!isLevelUnlocked(this.levelsCompleted, level.id)) {
      sounds.playSelect();
      showToast(this, faLevels.locked, { y: this.toastY, tone: 'error', reducedMotion: this.reducedMotion });
      return;
    }
    this.isExiting = true;
    sounds.playReinforce();
    this.platform.hapticSelection();
    this.tweens.add({ targets: card, scale: 0.96, duration: 80, yoyo: true });
    goToScene(this, 'GameScene', { source: 'menu', levelId: level.id }, () => {
      this.isExiting = false;
    });
  }

  private openLaneBattle(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    sounds.playReinforce();
    this.platform.hapticSelection();
    goToScene(this, 'GameScene', { source: 'menu', lanes: { levelId: nextLaneLevelId() } }, () => {
      this.isExiting = false;
    });
  }

  private openWeekly(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    sounds.playReinforce();
    this.platform.hapticSelection();
    goToScene(this, 'WeeklyScene', undefined, () => {
      this.isExiting = false;
    });
  }

  private close(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    goToScene(this, 'MenuScene');
  }
}

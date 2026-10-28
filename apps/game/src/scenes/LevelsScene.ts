import Phaser from 'phaser';
import { getBattlefield, isLevelUnlocked, LEVELS, LEVEL_COUNT, LOGICAL_WIDTH, type LevelDefinition } from '@crown-clash/game-core';
import { createPlatformAdapter, type PlatformAdapter } from '@crown-clash/platform';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { battlefieldName } from '../i18n/faBattle.js';
import { faLevels } from '../i18n/faLevels.js';
import { faWeekly } from '../i18n/faWeekly.js';
import { faLane } from '../i18n/faLane.js';
import { featureFlags } from '../config/featureFlags.js';
import { nextLaneLevelId } from '../lane/laneProgress.js';
import { THEME, UI } from '../theme.js';
import { computeLevelsLayout } from '../ui/LevelsLayout.js';
import { createText } from '../ui/TextStyles.js';
import { createIcon } from '../ui/icons.js';
import { bindSceneViewportResize, getSceneViewport, setupSceneCamera, type SceneViewport } from '../ui/Viewport.js';
import {
  createBackButton,
  createButton,
  createGlow,
  createHeader,
  drawPanel,
  fadeIn,
  goToScene,
  showToast,
  type KitButton,
} from '../ui/kit/index.js';
import { createHubBackdrop } from '../ui/kit/hubBackdrop.js';

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
    this.cards.forEach((card, index) => card.setPosition(layout.cards[index].x, layout.cards[index].y));
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
      color: UI.text.muted,
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
    const { cardWidth: width, cardHeight: height } = layout;
    const unlocked = isLevelUnlocked(this.levelsCompleted, level.id);
    const completed = level.id <= this.levelsCompleted;
    const current = unlocked && !completed;
    const container = this.add.container(0, 0);
    const panel = drawPanel(this.add.graphics(), width, height, {
      fill: current ? 0x231a33 : UI.surface.raised,
      stroke: current ? THEME.gold : completed ? 0x10b981 : UI.border,
      radius: UI.radius.lg,
      alpha: unlocked ? 0.97 : 0.8,
    });
    const number = createText(this, width / 2 - 38, -4, `${level.id}`, {
      fontSize: '34px',
      fontStyle: '900',
      color: unlocked ? UI.text.gold : UI.text.muted,
      stroke: UI.text.stroke,
      strokeThickness: 4,
    }).setOrigin(0.5);
    const map = createText(this, width / 2 - 70, -height / 2 + 20, battlefieldName(level.battlefieldId, getBattlefield(level.battlefieldId).name), {
      fontSize: '12px',
      fontStyle: '700',
      color: unlocked ? UI.text.secondary : UI.text.muted,
    }).setOrigin(1, 0.5);
    const difficulty = createText(this, width / 2 - 70, height / 2 - 20, faLevels.difficulty[level.botDifficulty], {
      fontSize: '13px',
      fontStyle: '800',
      color: unlocked ? DIFFICULTY_COLORS[level.botDifficulty] : UI.text.muted,
    }).setOrigin(1, 0.5);
    const status = createIcon(this, -width / 2 + 24, 0, completed ? 'check' : unlocked ? 'swords' : 'lock', 24);
    if (!unlocked) status.setAlpha(0.7);
    container.add([panel, number, map, difficulty, status]);
    if (!completed) {
      // First-clear reward preview; cleared levels show the check instead.
      const coin = createIcon(this, -width / 2 + 62, 0, 'coin', 16);
      const reward = createText(this, -width / 2 + 76, 0, faLevels.rewardBadge(level.coinReward), {
        fontSize: '14px',
        fontStyle: '800',
        color: unlocked ? UI.text.gold : UI.text.muted,
      }).setOrigin(0, 0.5);
      if (!unlocked) {
        coin.setAlpha(0.6);
        reward.setAlpha(0.8);
      }
      container.add([coin, reward]);
    }
    container.setSize(width, height).setInteractive({ useHandCursor: unlocked });
    container.on('pointerdown', () => this.onCardPressed(level, container));
    if (current && !this.reducedMotion) {
      this.tweens.add({ targets: panel, alpha: 0.82, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    return container;
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

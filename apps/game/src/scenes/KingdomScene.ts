import Phaser from 'phaser';
import {
  getKingdomProgress,
  getUpgradeCardViewModel,
  KingdomProgress,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  UpgradeCardViewModel,
  UpgradeType,
} from '@crown-clash/game-core';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';
import { CareerManager } from '../career/CareerManager.js';
import { trackUpgradeEvent } from '../analytics/Analytics.js';
import { THEME } from '../theme.js';
import { UPGRADE_CARD_META, UPGRADE_TYPES } from '../upgrades/UpgradeCardMeta.js';
import { purchaseUpgradeThroughCareer } from '../upgrades/UpgradePurchaseController.js';
import { playUpgradeMilestoneCelebration } from '../upgrades/UpgradeMilestoneCelebration.js';
import { ScenePurchaseRunner } from '../upgrades/ScenePurchaseRunner.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  setupSceneCamera,
} from '../ui/Viewport.js';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

const CARD_WIDTH = 174;
const CARD_HEIGHT = 248;
const GRID_TOP = 166;
const ROW_GAP = 16;
const COL_X = [LOGICAL_WIDTH / 2 - CARD_WIDTH / 2 - 10, LOGICAL_WIDTH / 2 + CARD_WIDTH / 2 + 10];
const ROW_Y = [GRID_TOP + CARD_HEIGHT / 2, GRID_TOP + CARD_HEIGHT + ROW_GAP + CARD_HEIGHT / 2];
const GRID_POSITIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: COL_X[0], y: ROW_Y[0] },
  { x: COL_X[1], y: ROW_Y[0] },
  { x: COL_X[0], y: ROW_Y[1] },
  { x: COL_X[1], y: ROW_Y[1] },
];

interface CardHandle {
  container: Phaser.GameObjects.Container;
  refresh: () => void;
  celebrate: () => void;
}

export class KingdomScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private purchaseRunner!: ScenePurchaseRunner;
  private reducedMotion = false;
  private cards: Map<UpgradeType, CardHandle> = new Map();
  private goldText!: Phaser.GameObjects.Text;
  private goldBg!: Phaser.GameObjects.Rectangle;
  private kingdomArt!: Phaser.GameObjects.Graphics;
  private tierText!: Phaser.GameObjects.Text;
  private kingdomLevelText!: Phaser.GameObjects.Text;
  private tierGoalText!: Phaser.GameObjects.Text;
  private tierProgressFill!: Phaser.GameObjects.Rectangle;
  private toastBg!: Phaser.GameObjects.Rectangle;
  private toastText!: Phaser.GameObjects.Text;
  private backButtonHandler?: () => void;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  create(): void {
    setupSceneCamera(this);
    bindSceneViewportResize(this);
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);

    // The runner instance is captured by the purchase closure so a promise
    // started by an earlier visit can never fire hooks into this (or a
    // future) visit after shutdown().
    const runner = new ScenePurchaseRunner(
      (type) =>
        purchaseUpgradeThroughCareer(this.careerManager, this.platform, type, {
          onMilestone: (level) => {
            if (!runner.isActive) return;
            const position = this.cards.get(type)?.container;
            playUpgradeMilestoneCelebration(
              this,
              this.platform,
              level,
              {
                x: position?.x ?? LOGICAL_WIDTH / 2,
                y: (position?.y ?? LOGICAL_HEIGHT / 2) - CARD_HEIGHT / 2 - 14,
              },
              this.reducedMotion
            );
          },
        }),
      {
        onPendingChanged: () => this.refreshAll(),
        onResult: (type, purchase) => {
          if (purchase.success) {
            this.cards.get(type)?.celebrate();
            const previousTier = getKingdomProgress(purchase.previousCareer);
            const newTier = getKingdomProgress(purchase.newCareer);
            if (newTier.tierIndex > previousTier.tierIndex) {
              this.playKingdomTierCelebration(newTier);
            }
          } else if (purchase.reason === 'insufficient_coins') {
            this.showToast('Not enough gold for this upgrade yet.');
          } else if (purchase.reason === 'max_level') {
            this.showToast('This upgrade is already fully mastered.');
          }
        },
        onError: (_type, error) => {
          console.error('[KingdomScene] Upgrade purchase failed:', error);
          this.platform.hapticNotification('error');
          this.showToast("Couldn't reach the kingdom. Please try again.");
        },
      }
    );
    this.purchaseRunner = runner;

    this.backButtonHandler = () => this.closeKingdom();
    this.platform.showBackButton(this.backButtonHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      runner.shutdown();
      this.platform.hideBackButton();
    });

    this.buildScene();
    trackUpgradeEvent({ name: 'upgrade_panel_viewed', source: 'menu' });
  }

  private buildScene(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    this.add.rectangle(visibleWidth / 2, visibleHeight / 2, visibleWidth, visibleHeight, 0x070b14);
    const glow = this.add.graphics();
    glow.fillStyle(THEME.gold, 0.07);
    glow.fillCircle(LOGICAL_WIDTH / 2, 40, 220);

    this.buildHeader();
    this.buildKingdomProgress();

    UPGRADE_TYPES.forEach((type, index) => {
      const position = GRID_POSITIONS[index];
      this.cards.set(type, this.buildCard(type, position.x, position.y));
    });

    this.buildToast();
    this.refreshAll();
    this.playEntranceAnimation();
  }

  private buildHeader(): void {
    const backBg = this.add
      .rectangle(34, 34, 44, 44, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.9)
      .setInteractive({ useHandCursor: true });
    const backLabel = this.add
      .text(34, 34, '‹', {
        fontFamily: FONT_FAMILY,
        fontSize: '22px',
        fontStyle: '900',
        color: '#e2e8f0',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(backBg, backLabel);
    backBg.on('pointerdown', () => this.closeKingdom());

    this.add
      .text(LOGICAL_WIDTH / 2, 42, 'KINGDOM', {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        fontStyle: '900',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.add
      .text(LOGICAL_WIDTH / 2, 68, 'Grow your realm', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#93c5fd',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    this.goldBg = this.add
      .rectangle(LOGICAL_WIDTH - 24, 34, 10, 32, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0xf59e0b, 0.85);
    this.goldText = this.add
      .text(LOGICAL_WIDTH - 38, 34, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(1, 0.5);
  }

  private buildKingdomProgress(): void {
    const panel = this.add.graphics();
    panel.fillStyle(0x0f172a, 0.96);
    panel.fillRoundedRect(24, 84, LOGICAL_WIDTH - 48, 70, 10);
    panel.lineStyle(1.5, 0x334155, 0.95);
    panel.strokeRoundedRect(24, 84, LOGICAL_WIDTH - 48, 70, 10);
    panel.fillStyle(THEME.gold, 0.08);
    panel.fillCircle(87, 119, 48);

    this.kingdomArt = this.add.graphics();
    this.tierText = this.add.text(146, 96, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '13px',
      fontStyle: '900',
      color: '#f8fafc',
      stroke: '#000000',
      strokeThickness: 2,
      resolution: 2,
    });
    this.kingdomLevelText = this.add
      .text(376, 97, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: '900',
        color: '#fbbf24',
        resolution: 2,
      })
      .setOrigin(1, 0);

    this.add.rectangle(261, 124, 230, 7, 0x070b14, 1).setStrokeStyle(1, 0x334155, 1);
    this.tierProgressFill = this.add.rectangle(146, 124, 1, 5, THEME.gold, 1).setOrigin(0, 0.5);
    this.tierGoalText = this.add.text(146, 136, '', {
      fontFamily: FONT_FAMILY,
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#93c5fd',
      resolution: 2,
    });
  }

  private drawKingdom(progress: KingdomProgress): void {
    const graphics = this.kingdomArt;
    const stage = progress.tierIndex;
    const stone = [0x64748b, 0x64748b, 0x7180a5, 0x7667a8, 0xa97924][stage];
    const stoneLight = [0x94a3b8, 0x94a3b8, 0xa5b4fc, 0xc4b5fd, 0xfcd34d][stage];
    const roof = [0x854d0e, 0x1d4ed8, 0x3730a3, 0x7e22ce, 0xb45309][stage];
    const x = 87;
    const groundY = 146;

    graphics.clear();
    graphics.fillStyle(0x020617, 0.55);
    graphics.fillEllipse(x, groundY, 100, 15);

    if (stage === 0) {
      graphics.fillStyle(0x78350f, 1);
      graphics.fillRoundedRect(x - 29, groundY - 25, 58, 24, 3);
      graphics.fillStyle(0xb45309, 1);
      graphics.fillTriangle(x - 35, groundY - 24, x, groundY - 54, x + 35, groundY - 24);
      graphics.lineStyle(2, 0xfbbf24, 0.8);
      graphics.lineBetween(x, groundY - 55, x, groundY - 67);
      graphics.fillStyle(0xf59e0b, 1);
      graphics.fillTriangle(x, groundY - 67, x + 16, groundY - 62, x, groundY - 58);
      graphics.fillStyle(0x1f2937, 1);
      graphics.fillRoundedRect(x - 6, groundY - 16, 12, 15, 2);
      return;
    }

    const wallWidth = 50 + stage * 7;
    const wallTop = 119 - stage;
    graphics.fillStyle(stone, 1);
    graphics.fillRoundedRect(x - wallWidth / 2, wallTop, wallWidth, groundY - wallTop, 4);
    graphics.fillStyle(stoneLight, 0.9);
    for (let offset = -wallWidth / 2 + 4; offset < wallWidth / 2; offset += 13) {
      graphics.fillRect(x + offset, wallTop - 5, 8, 8);
    }

    const towerOffset = wallWidth / 2 - 4;
    for (const direction of [-1, 1]) {
      const towerX = x + direction * towerOffset;
      graphics.fillStyle(stone, 1);
      graphics.fillRoundedRect(towerX - 11, wallTop - 7, 22, groundY - wallTop + 7, 3);
      graphics.fillStyle(roof, 1);
      graphics.fillTriangle(towerX - 15, wallTop - 6, towerX, wallTop - 18, towerX + 15, wallTop - 6);
      graphics.fillStyle(0x0f172a, 0.9);
      graphics.fillRect(towerX - 2, wallTop + 7, 4, 8);
    }

    if (stage >= 2) {
      const keepTop = 108 - stage * 2;
      graphics.fillStyle(stoneLight, 1);
      graphics.fillRoundedRect(x - 18, keepTop, 36, groundY - keepTop, 4);
      graphics.fillStyle(roof, 1);
      graphics.fillTriangle(x - 23, keepTop + 1, x, keepTop - 14, x + 23, keepTop + 1);
      graphics.fillStyle(0xf59e0b, 1);
      graphics.fillRect(x - 3, keepTop + 12, 6, 10);
    }

    if (stage === 3) {
      const flagBase = 108 - stage * 2 - 14;
      graphics.lineStyle(2, 0xfbbf24, 1);
      graphics.lineBetween(x, flagBase, x, flagBase - 9);
      graphics.fillStyle(0xc084fc, 1);
      graphics.fillTriangle(x, flagBase - 9, x + 17, flagBase - 5, x, flagBase);
    }

    if (stage === 4) {
      const crownY = 80;
      graphics.fillStyle(0xfde047, 1);
      graphics.fillTriangle(x - 10, crownY + 9, x - 5, crownY, x, crownY + 9);
      graphics.fillTriangle(x, crownY + 9, x + 5, crownY - 2, x + 10, crownY + 9);
      graphics.fillRect(x - 10, crownY + 8, 20, 5);
    }
  }

  private buildCard(type: UpgradeType, x: number, y: number): CardHandle {
    const meta = UPGRADE_CARD_META[type];
    const container = this.add.container(x, y);

    const cardBg = this.add
      .rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, 0x111827, 0.97)
      .setStrokeStyle(1.5, 0x334155, 1);
    // Font sizes are chosen for the worst supported viewport: at 360x640
    // Phaser's FIT scaling renders logical pixels at ~0.89x, so a 10px label
    // lands at ~9 CSS px. Nothing below 10px is considered readable enough
    // for card content at that size.
    const titleText = this.add
      .text(0, -102, `${meta.icon} ${meta.title}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#f1f5f9',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitleText = this.add
      .text(0, -82, meta.subtitle, {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);
    const levelText = this.add
      .text(0, -58, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    const milestoneText = this.add
      .text(0, -37, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#93c5fd',
        resolution: 2,
      })
      .setOrigin(0.5);
    const progressTrack = this.add.rectangle(0, -25, 140, 6, 0x0b1120, 1).setStrokeStyle(1, 0x334155, 1);
    const progressFill = this.add.rectangle(-70, -25, 0, 4, 0x2563eb, 1).setOrigin(0, 0.5);
    const divider = this.add.rectangle(0, -11, CARD_WIDTH - 24, 1, 0x1e293b, 1);
    const nowLabel = this.add
      .text(0, 4, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);
    const nextLabel = this.add
      .text(0, 28, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#64ffda',
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);

    const buyBg = this.add
      .rectangle(0, 96, 146, 44, 0x2563eb, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1);
    const buyText = this.add
      .text(0, 96, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(buyBg, buyText);

    container.add([
      cardBg,
      titleText,
      subtitleText,
      levelText,
      milestoneText,
      progressTrack,
      progressFill,
      divider,
      nowLabel,
      nextLabel,
      buyBg,
      buyText,
    ]);

    const refresh = (): void => {
      const career = this.careerManager.getCareer();
      const card: UpgradeCardViewModel = getUpgradeCardViewModel(career, type);
      const isPending = this.purchaseRunner.pending === type;

      levelText.setText(`LV. ${card.level} / ${card.maxLevel}`);
      milestoneText.setText(card.milestoneLabel);

      const fillColor = card.milestoneProgress >= 1 ? 0xf59e0b : 0x2563eb;
      progressFill.setFillStyle(fillColor, 1);
      progressFill.setSize(Math.max(1, 140 * card.milestoneProgress), 4);
      cardBg.setStrokeStyle(1.5, card.isMaxLevel ? 0xf59e0b : 0x334155, 1);

      nowLabel.setText(`NOW   ${card.currentEffectLabel}`);
      nextLabel.setText(card.isMaxLevel ? '🏆 FULLY UPGRADED' : `NEXT  ${card.nextEffectLabel}`);
      nextLabel.setColor(card.isMaxLevel ? '#fbbf24' : '#64ffda');

      if (isPending) {
        buyText.setText('...');
        buyBg.setFillStyle(0x1f2937, 1).setStrokeStyle(1.5, 0x475569, 1);
        buyText.setColor('#94a3b8');
        buyBg.disableInteractive();
        return;
      }

      if (card.isMaxLevel) {
        buyText.setText('MAX');
        buyBg.setFillStyle(0x1f2937, 1).setStrokeStyle(1.5, 0xf59e0b, 0.7);
        buyText.setColor('#fbbf24');
        buyBg.disableInteractive();
        return;
      }

      buyText.setText(`${card.nextCost} 🪙`);
      buyBg
        .setFillStyle(card.canAfford ? 0x2563eb : 0x273449, 1)
        .setStrokeStyle(1.5, card.canAfford ? 0x60a5fa : 0x475569, 1);
      buyText.setColor(card.canAfford ? '#ffffff' : '#94a3b8');
      if (card.canAfford) {
        buyBg.setInteractive({ useHandCursor: true });
      } else {
        buyBg.disableInteractive();
      }
    };

    const celebrate = (): void => {
      if (this.reducedMotion) return;
      this.tweens.add({
        targets: container,
        scale: 1.06,
        duration: 140,
        yoyo: true,
        ease: 'Cubic.easeOut',
      });
    };

    buyBg.on('pointerdown', () => this.purchaseRunner.run(type));

    container.setScale(this.reducedMotion ? 1 : 0.9);
    container.setAlpha(this.reducedMotion ? 1 : 0);

    return { container, refresh, celebrate };
  }

  private buildToast(): void {
    this.toastBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 700, 320, 40, 0x0c1322, 0.98)
      .setStrokeStyle(1.5, 0xf87171, 0.9)
      .setDepth(300)
      .setAlpha(0);
    this.toastText = this.add
      .text(LOGICAL_WIDTH / 2, 700, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fecaca',
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(301)
      .setAlpha(0);
  }

  private showToast(message: string): void {
    this.toastText.setText(message);
    this.toastBg.setAlpha(1);
    this.toastText.setAlpha(1);
    this.tweens.killTweensOf([this.toastBg, this.toastText]);
    this.tweens.add({
      targets: [this.toastBg, this.toastText],
      alpha: 0,
      duration: 320,
      delay: this.reducedMotion ? 1400 : 2200,
      ease: 'Cubic.easeOut',
    });
  }

  private playEntranceAnimation(): void {
    if (this.reducedMotion) return;
    let index = 0;
    for (const card of this.cards.values()) {
      const delay = index * 50;
      this.tweens.add({
        targets: card.container,
        scale: 1,
        alpha: 1,
        duration: 240,
        delay,
        ease: 'Back.easeOut',
      });
      index += 1;
    }
  }

  private refreshAll(): void {
    const career = this.careerManager.getCareer();
    const kingdom = getKingdomProgress(career);
    this.goldText.setText(`🪙 ${career.coins}`);
    const width = this.goldText.width + 28;
    this.goldBg.setSize(width, 32);
    this.goldBg.setPosition(LOGICAL_WIDTH - 24 - width / 2, 34);
    this.goldText.setPosition(LOGICAL_WIDTH - 24 - 14, 34);

    this.drawKingdom(kingdom);
    this.tierText
      .setText(kingdom.tier.name.toUpperCase())
      .setColor(`#${kingdom.tier.color.toString(16).padStart(6, '0')}`);
    this.kingdomLevelText.setText(`POWER ${kingdom.totalLevel}/${kingdom.maxLevel}`);
    this.tierProgressFill.setFillStyle(kingdom.tier.color, 1);
    this.tierProgressFill.setSize(Math.max(1, 230 * kingdom.tierProgress), 5);
    this.tierGoalText.setText(
      kingdom.nextTier
        ? `${kingdom.levelsToNextTier} upgrade levels to ${kingdom.nextTier.name}`
        : 'Realm fully evolved'
    );
    this.cards.forEach((card) => card.refresh());
  }

  private playKingdomTierCelebration(progress: KingdomProgress): void {
    this.platform.hapticNotification('success');
    const banner = this.add
      .text(LOGICAL_WIDTH / 2, 112, `REALM EVOLVED\n${progress.tier.name.toUpperCase()}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: '900',
        color: '#fff7cc',
        stroke: '#713f12',
        strokeThickness: 5,
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(350);

    if (this.reducedMotion) {
      this.time.delayedCall(1500, () => banner.destroy());
      return;
    }

    banner.setScale(0.8).setAlpha(0);
    this.tweens.add({
      targets: banner,
      scale: 1,
      alpha: 1,
      duration: 240,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: banner,
          y: 100,
          alpha: 0,
          duration: 300,
          delay: 1200,
          ease: 'Cubic.easeIn',
          onComplete: () => banner.destroy(),
        });
      },
    });
  }

  private closeKingdom(): void {
    // Leaving mid-purchase would strand the in-flight request's UI callbacks
    // on a torn-down scene and let MenuScene render pre-purchase career data,
    // so the hub stays open until the purchase settles.
    if (!this.purchaseRunner.requestClose()) {
      this.showToast('Finishing your upgrade…');
      return;
    }
    this.scene.start('MenuScene');
  }

  private bindPressFeedback(
    background: Phaser.GameObjects.Rectangle,
    label: Phaser.GameObjects.Text
  ): void {
    const reset = (): void => {
      background.setScale(1);
      label.setScale(1);
    };
    background.on('pointerdown', () => {
      background.setScale(0.96);
      label.setScale(0.96);
    });
    background.on('pointerup', reset);
    background.on('pointerout', reset);
  }
}

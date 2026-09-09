import Phaser from 'phaser';
import {
  getUpgradeCardViewModel,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PlayerCareer,
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
  private reducedMotion = false;
  private pendingType: UpgradeType | null = null;
  private cards: Map<UpgradeType, CardHandle> = new Map();
  private goldText!: Phaser.GameObjects.Text;
  private goldBg!: Phaser.GameObjects.Rectangle;
  private goalText!: Phaser.GameObjects.Text;
  private toastBg!: Phaser.GameObjects.Rectangle;
  private toastText!: Phaser.GameObjects.Text;
  private backButtonHandler?: () => void;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  create(): void {
    const renderScale = (this.registry.get('renderScale') as number) || 1;
    this.cameras.main.setZoom(renderScale);
    this.cameras.main.centerOn(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);
    this.pendingType = null;

    this.backButtonHandler = () => this.closeKingdom();
    this.platform.showBackButton(this.backButtonHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.platform.hideBackButton());

    this.buildScene();
    trackUpgradeEvent({ name: 'upgrade_panel_viewed', source: 'menu' });
  }

  private buildScene(): void {
    this.add.rectangle(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x070b14);
    const glow = this.add.graphics();
    glow.fillStyle(THEME.gold, 0.07);
    glow.fillCircle(LOGICAL_WIDTH / 2, 40, 220);

    this.buildHeader();
    this.goalText = this.add
      .text(LOGICAL_WIDTH / 2, 138, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#93c5fd',
        stroke: '#000000',
        strokeThickness: 2,
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);

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
        fontSize: '11px',
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
        fontSize: '13px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(1, 0.5);
  }

  private buildCard(type: UpgradeType, x: number, y: number): CardHandle {
    const meta = UPGRADE_CARD_META[type];
    const container = this.add.container(x, y);

    const cardBg = this.add
      .rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, 0x111827, 0.97)
      .setStrokeStyle(1.5, 0x334155, 1);
    const titleText = this.add
      .text(0, -104, `${meta.icon} ${meta.title}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '900',
        color: '#f1f5f9',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitleText = this.add
      .text(0, -86, meta.subtitle, {
        fontFamily: FONT_FAMILY,
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);
    const levelText = this.add
      .text(0, -64, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    const milestoneText = this.add
      .text(0, -46, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#93c5fd',
        resolution: 2,
      })
      .setOrigin(0.5);
    const progressTrack = this.add.rectangle(0, -34, 140, 6, 0x0b1120, 1).setStrokeStyle(1, 0x334155, 1);
    const progressFill = this.add.rectangle(-70, -34, 0, 4, 0x2563eb, 1).setOrigin(0, 0.5);
    const divider = this.add.rectangle(0, -20, CARD_WIDTH - 24, 1, 0x1e293b, 1);
    const nowLabel = this.add
      .text(0, -6, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);
    const nextLabel = this.add
      .text(0, 16, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '9px',
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
        fontSize: '12px',
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
      const isPending = this.pendingType === type;

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

    buyBg.on('pointerdown', () => {
      if (this.pendingType !== null) return;
      void this.handlePurchase(type);
    });

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
        fontSize: '11px',
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
    this.goldText.setText(`🪙 ${career.coins}`);
    const width = this.goldText.width + 28;
    this.goldBg.setSize(width, 32);
    this.goldBg.setPosition(LOGICAL_WIDTH - 24 - width / 2, 34);
    this.goldText.setPosition(LOGICAL_WIDTH - 24 - 14, 34);

    this.goalText.setText(this.describeNextGoal(career));
    this.cards.forEach((card) => card.refresh());
  }

  private describeNextGoal(career: PlayerCareer): string {
    const candidates = UPGRADE_TYPES.map((type) => getUpgradeCardViewModel(career, type)).filter(
      (card) => card.nextCost !== null
    );
    if (candidates.length === 0) return '🏆 Every upgrade is fully mastered';

    const affordable = candidates.filter((card) => card.canAfford);
    const pool = affordable.length > 0 ? affordable : candidates;
    const goal = pool.reduce((best, card) => (card.nextCost! < best.nextCost! ? card : best));
    const meta = UPGRADE_CARD_META[goal.type];
    const prefix = affordable.length > 0 ? '✅ Ready' : '🎯 Next goal';
    return `${prefix}: ${meta.icon} ${meta.title} — ${goal.nextCost} 🪙`;
  }

  private async handlePurchase(type: UpgradeType): Promise<void> {
    this.pendingType = type;
    this.refreshAll();

    try {
      const purchase = await purchaseUpgradeThroughCareer(this.careerManager, this.platform, type, {
        onMilestone: (level) => {
          const position = this.cards.get(type)?.container;
          playUpgradeMilestoneCelebration(
            this,
            this.platform,
            level,
            { x: position?.x ?? LOGICAL_WIDTH / 2, y: (position?.y ?? LOGICAL_HEIGHT / 2) - CARD_HEIGHT / 2 - 14 },
            this.reducedMotion
          );
        },
      });

      if (purchase.success) {
        this.cards.get(type)?.celebrate();
      } else if (purchase.reason === 'insufficient_coins') {
        this.showToast("Not enough gold for this upgrade yet.");
      } else if (purchase.reason === 'max_level') {
        this.showToast('This upgrade is already fully mastered.');
      }
    } catch (error) {
      console.error('[KingdomScene] Upgrade purchase failed:', error);
      this.platform.hapticNotification('error');
      this.showToast("Couldn't reach the kingdom. Please try again.");
    } finally {
      this.pendingType = null;
      this.refreshAll();
    }
  }

  private closeKingdom(): void {
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

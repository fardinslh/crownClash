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
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { CareerManager } from '../career/CareerManager.js';
import { trackUpgradeEvent } from '../analytics/Analytics.js';
import { THEME, UI } from '../theme.js';
import { UPGRADE_CARD_META, UPGRADE_TYPES } from '../upgrades/UpgradeCardMeta.js';
import { purchaseUpgradeThroughCareer } from '../upgrades/UpgradePurchaseController.js';
import { playUpgradeMilestoneCelebration } from '../upgrades/UpgradeMilestoneCelebration.js';
import { ScenePurchaseRunner } from '../upgrades/ScenePurchaseRunner.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  SceneViewport,
  setupSceneCamera,
} from '../ui/Viewport.js';
import { computeKingdomLayout, KINGDOM_CARD_HEIGHT, KINGDOM_CARD_WIDTH } from '../ui/HubLayouts.js';
import { createText } from '../ui/TextStyles.js';
import { createIcon, type IconKey } from '../ui/icons.js';
import {
  anchorPillLeft,
  createBackButton,
  createButton,
  createGlow,
  createHeader,
  createPill,
  createProgressBar,
  drawPanel,
  fadeIn,
  goToScene,
  showToast,
  type KitPill,
  type KitProgressBar,
} from '../ui/kit/index.js';
import { fa, kingdomTierName, upgradeCopy, upgradeEffectLabel, upgradeMilestoneLabel } from '../i18n/fa.js';

const CARD_WIDTH = KINGDOM_CARD_WIDTH;
const CARD_HEIGHT = KINGDOM_CARD_HEIGHT;
const HERO_WIDTH = 360;

/** Vector icon per upgrade (the emoji in UpgradeCardMeta stay for legacy text surfaces). */
const UPGRADE_ICONS: Record<UpgradeType, IconKey> = {
  starting_garrison: 'castle',
  production: 'hammer',
  army_speed: 'bolt',
  treasury: 'coin',
};

/**
 * Rendered Crown Cross buildings (same rig as the battlefield) that stand in
 * for the player's kingdom, one per evolution stage.
 */
const KINGDOM_ART = [
  { key: 'hub_kingdom_outpost', file: 'outpost_player.webp' },
  { key: 'hub_kingdom_barracks', file: 'barracks_player.webp' },
  { key: 'hub_kingdom_keep', file: 'crown_keep_player.webp' },
  { key: 'hub_kingdom_citadel', file: 'citadel_player.webp' },
] as const;
const KINGDOM_ART_VERSION = 'cartoon-meadow-v1.6';

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
  private background!: Phaser.GameObjects.Rectangle;
  private progressContainer!: Phaser.GameObjects.Container;
  private heroPanel!: Phaser.GameObjects.Graphics;
  private heroGlow!: Phaser.GameObjects.Image;
  private kingdomArt?: Phaser.GameObjects.Image;
  private kingdomCrown?: Phaser.GameObjects.Image;
  private coinPill!: KitPill;
  private tierText!: Phaser.GameObjects.Text;
  private kingdomLevelText!: Phaser.GameObjects.Text;
  private tierGoalText!: Phaser.GameObjects.Text;
  private tierProgress!: KitProgressBar;
  private heroHeight = 112;
  private toastY = 700;
  private backButtonHandler?: () => void;
  private isExiting = false;

  constructor() {
    super({ key: 'KingdomScene' });
  }

  preload(): void {
    for (const art of KINGDOM_ART) {
      if (!this.textures.exists(art.key)) {
        this.load.image(art.key, `assets/territories/crown_cross/${art.file}?v=${KINGDOM_ART_VERSION}`);
      }
    }
  }

  create(): void {
    this.isExiting = false;
    this.cards = new Map();
    this.kingdomArt = undefined;
    this.kingdomCrown = undefined;
    setupSceneCamera(this);
    bindSceneViewportResize(this, (viewport) => this.applyLayout(viewport));
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);

    // The runner instance is captured by the purchase closure so a promise
    // started by an earlier visit can never fire hooks into this (or a
    // future) visit after shutdown().
    const runner = new ScenePurchaseRunner(
      async (type) => {
        if (!this.careerManager.isRemoteConnected() && !isLocalCareerFallbackAllowed()) {
          await this.careerManager.connect(this.platform);
        }
        return purchaseUpgradeThroughCareer(this.careerManager, this.platform, type, {
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
        });
      },
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
            this.showToast(fa.kingdom.notEnoughGold);
          } else if (purchase.reason === 'max_level') {
            this.showToast(fa.kingdom.maxed);
          }
        },
        onError: (_type, error) => {
          console.error('[KingdomScene] Upgrade purchase failed:', error);
          this.platform.hapticNotification('error');
          this.showToast(fa.kingdom.unreachable);
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
    fadeIn(this);
  }

  private buildScene(): void {
    const viewport = getSceneViewport(this);
    const layout = computeKingdomLayout(viewport.visibleHeight);
    this.background = this.add.rectangle(
      LOGICAL_WIDTH / 2,
      viewport.visibleHeight / 2,
      viewport.visibleWidth,
      viewport.visibleHeight,
      UI.bg
    );
    createGlow(this, LOGICAL_WIDTH / 2, -30, viewport.visibleWidth * 1.4, 280, THEME.gold, 0.14);

    this.buildHeader();
    this.buildKingdomProgress();

    UPGRADE_TYPES.forEach((type, index) => {
      const position = layout.cardPositions[index];
      this.cards.set(type, this.buildCard(type, position.x, position.y));
    });

    this.applyLayout(viewport);
    this.refreshAll();
    this.playEntranceAnimation();
  }

  private buildHeader(): void {
    // RTL: back sits top-right, the wallet top-left.
    createBackButton(this, LOGICAL_WIDTH - 34, 38, () => this.closeKingdom());
    createHeader(this, fa.kingdom.title, fa.kingdom.subtitle);
    this.coinPill = createPill(this, 0, 38, 'coin', '0');
  }

  private buildKingdomProgress(): void {
    this.progressContainer = this.add.container(0, 0);
    this.heroPanel = this.add.graphics();
    this.heroGlow = createGlow(this, 0, 0, 180, 150, THEME.gold, 0.3);

    this.tierText = createText(this, 0, 0, '', {
      fontSize: '18px',
      fontStyle: '900',
      stroke: UI.text.stroke,
      strokeThickness: 4,
    }).setOrigin(1, 0.5);
    this.kingdomLevelText = createText(this, 0, 0, '', {
      fontSize: '12px',
      fontStyle: '800',
      color: UI.text.gold,
    }).setOrigin(0, 0.5);
    this.tierProgress = createProgressBar(this, 0, 0, 196, 12, THEME.gold);
    this.tierGoalText = createText(this, 0, 0, '', {
      fontSize: '12px',
      fontStyle: '700',
      color: UI.text.accent,
    }).setOrigin(1, 0.5);

    this.progressContainer.add([
      this.heroPanel,
      this.heroGlow,
      this.tierText,
      this.kingdomLevelText,
      this.tierProgress.graphics,
      this.tierGoalText,
    ]);
  }

  /**
   * Positions hero content for the current hero height (resize only). Short
   * phones put the castle beside the progress (RTL: art on the right); tall
   * phones show the castle large with the progress underneath.
   */
  private layoutHero(): void {
    const h = this.heroHeight;
    const left = (LOGICAL_WIDTH - HERO_WIDTH) / 2;
    const right = left + HERO_WIDTH;
    drawPanel(this.heroPanel, HERO_WIDTH, h, { fill: UI.surface.raised, stroke: UI.border, radius: UI.radius.lg });
    this.heroPanel.setPosition(LOGICAL_WIDTH / 2, h / 2);

    if (h >= 170) {
      const artSize = Math.min(h - 78, 150);
      const artBottom = h - 70;
      this.heroGlow.setPosition(LOGICAL_WIDTH / 2, artBottom - artSize * 0.45).setDisplaySize(artSize * 2.6, artSize * 1.7);
      this.kingdomArt?.setPosition(LOGICAL_WIDTH / 2, artBottom).setDisplaySize(artSize, artSize);
      this.kingdomCrown?.setPosition(LOGICAL_WIDTH / 2, artBottom - artSize * 0.98);
      this.tierText.setPosition(right - 18, h - 56);
      this.kingdomLevelText.setPosition(left + 18, h - 56);
      this.tierProgress.setWidth(HERO_WIDTH - 36);
      this.tierProgress.graphics.setPosition(LOGICAL_WIDTH / 2, h - 34);
      this.tierGoalText.setPosition(right - 18, h - 15);
      return;
    }

    const artSize = h - 10;
    const artX = right - 18 - artSize / 2;
    this.heroGlow.setPosition(artX, h * 0.52).setDisplaySize(artSize * 1.9, artSize * 1.5);
    this.kingdomArt?.setPosition(artX, h - 6).setDisplaySize(artSize, artSize);
    this.kingdomCrown?.setPosition(artX, h - 6 - artSize * 0.98);
    const textRight = artX - artSize / 2 - 8;
    const textLeft = left + 16;
    const c = h / 2;
    this.tierText.setPosition(textRight, c - 28);
    this.kingdomLevelText.setPosition(textLeft, c - 28);
    this.tierProgress.setWidth(textRight - textLeft);
    this.tierProgress.graphics.setPosition((textLeft + textRight) / 2, c);
    this.tierGoalText.setPosition(textRight, c + 26);
  }

  private drawKingdom(progress: KingdomProgress): void {
    const stage = Math.min(progress.tierIndex, KINGDOM_ART.length - 1);
    const art = KINGDOM_ART[stage];
    if (this.textures?.exists?.(art.key)) {
      if (!this.kingdomArt) {
        this.kingdomArt = this.add.image(0, 0, art.key).setOrigin(0.5, 1);
        this.progressContainer.add(this.kingdomArt);
      } else {
        this.kingdomArt.setTexture(art.key);
      }
    } else if (!this.kingdomArt) {
      // Art failed to load (or headless tests): the castle icon still reads.
      this.kingdomArt = createIcon(this, 0, 0, 'castle', 80).setOrigin(0.5, 1);
      this.progressContainer.add(this.kingdomArt);
    }
    // The final evolution keeps the citadel and gains the gilded crown.
    const crowned = progress.tierIndex >= KINGDOM_ART.length;
    if (crowned && !this.kingdomCrown) {
      this.kingdomCrown = createIcon(this, 0, 0, 'crown', 34);
      this.progressContainer.add(this.kingdomCrown);
    }
    this.kingdomCrown?.setVisible(crowned);
    this.layoutHero();
  }

  private buildCard(type: UpgradeType, x: number, y: number): CardHandle {
    const meta = UPGRADE_CARD_META[type];
    const copy = upgradeCopy(type, meta);
    const container = this.add.container(x, y);
    const top = -CARD_HEIGHT / 2;
    const inner = CARD_WIDTH / 2 - 13;

    const cardBg = this.add.graphics();
    const iconTile = drawPanel(this.add.graphics({ x: inner - 18, y: top + 30 }), 40, 40, {
      fill: UI.surface.high, stroke: UI.borderStrong, radius: UI.radius.md, shadow: false,
    });
    const icon = createIcon(this, inner - 18, top + 30, UPGRADE_ICONS[type], 30);
    // Font sizes are chosen for the worst supported viewport: nothing below
    // 11px is used for card content.
    const titleText = createText(this, inner - 46, top + 22, copy.title, {
      fontSize: '15px',
      fontStyle: '900',
      color: UI.text.primary,
    }).setOrigin(1, 0.5);
    const subtitleText = createText(this, inner - 46, top + 42, copy.subtitle, {
      fontSize: '11px',
      fontStyle: '700',
      color: UI.text.muted,
    }).setOrigin(1, 0.5);
    const levelText = createText(this, inner, top + 68, '', {
      fontSize: '13px',
      fontStyle: '900',
      color: UI.text.gold,
    }).setOrigin(1, 0.5);
    const milestoneText = createText(this, -inner, top + 68, '', {
      fontSize: '11px',
      fontStyle: '700',
      color: UI.text.accent,
    }).setOrigin(0, 0.5);
    const progress = createProgressBar(this, 0, top + 86, CARD_WIDTH - 26, 10, UI.button.primary.fill);

    const effects = drawPanel(this.add.graphics({ x: 0, y: top + 120 }), CARD_WIDTH - 26, 46, {
      fill: UI.surface.base, stroke: UI.border, strokeAlpha: 0.8, radius: UI.radius.sm, shadow: false,
    });
    const nowTitle = createText(this, inner - 6, top + 109, fa.kingdom.now, {
      fontSize: '11px', fontStyle: '700', color: UI.text.muted,
    }).setOrigin(1, 0.5);
    const nextTitle = createText(this, inner - 6, top + 131, fa.kingdom.next, {
      fontSize: '11px', fontStyle: '700', color: UI.text.muted,
    }).setOrigin(1, 0.5);
    const nowLabel = createText(this, -inner + 6, top + 109, '', {
      fontSize: '12px', fontStyle: '800', color: UI.text.secondary,
    }).setOrigin(0, 0.5);
    const nextLabel = createText(this, -inner + 6, top + 131, '', {
      fontSize: '12px', fontStyle: '800', color: UI.text.success,
    }).setOrigin(0, 0.5);

    const buy = createButton(this, 0, top + 168, {
      width: CARD_WIDTH - 26,
      height: 44,
      label: '',
      icon: 'coin',
      variant: 'gold',
      fontSize: 16,
      onPress: () => this.purchaseRunner.run(type),
    });

    container.add([
      cardBg,
      iconTile,
      icon,
      titleText,
      subtitleText,
      levelText,
      milestoneText,
      progress.graphics,
      effects,
      nowTitle,
      nextTitle,
      nowLabel,
      nextLabel,
      buy.container,
    ]);

    let maxed: boolean | undefined;
    const refresh = (): void => {
      const career = this.careerManager.getCareer();
      const card: UpgradeCardViewModel = getUpgradeCardViewModel(career, type);
      const isPending = this.purchaseRunner.pending === type;

      if (maxed !== card.isMaxLevel) {
        maxed = card.isMaxLevel;
        drawPanel(cardBg, CARD_WIDTH, CARD_HEIGHT, {
          fill: UI.surface.raised,
          stroke: card.isMaxLevel ? THEME.gold : UI.border,
          radius: UI.radius.lg,
        });
      }
      levelText.setText(fa.kingdom.level(card.level, card.maxLevel));
      milestoneText.setText(upgradeMilestoneLabel(card.milestoneLabel));
      progress.setProgress(card.milestoneProgress, card.milestoneProgress >= 1 ? THEME.gold : UI.button.primary.fill);

      nowLabel.setText(upgradeEffectLabel(card.currentEffectLabel));
      nextLabel.setText(card.isMaxLevel ? fa.kingdom.fullyUpgraded : upgradeEffectLabel(card.nextEffectLabel ?? ''));
      nextLabel.setColor(card.isMaxLevel ? UI.text.gold : UI.text.success);

      if (isPending) {
        buy.setLabel('...');
        buy.setEnabled(false);
        return;
      }
      if (card.isMaxLevel) {
        buy.setLabel(fa.kingdom.max);
        buy.setEnabled(false);
        return;
      }
      buy.setLabel(`${card.nextCost}`);
      buy.setEnabled(card.canAfford);
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

    container.setScale(this.reducedMotion ? 1 : 0.9);
    container.setAlpha(this.reducedMotion ? 1 : 0);

    return { container, refresh, celebrate };
  }

  private applyLayout(viewport: SceneViewport): void {
    const layout = computeKingdomLayout(viewport.visibleHeight);
    this.background
      .setPosition(LOGICAL_WIDTH / 2, viewport.visibleHeight / 2)
      .setSize(viewport.visibleWidth, viewport.visibleHeight);
    this.progressContainer.setY(layout.panelY);
    if (layout.heroHeight !== this.heroHeight) {
      this.heroHeight = layout.heroHeight;
      this.layoutHero();
    }
    UPGRADE_TYPES.forEach((type, index) => {
      const position = layout.cardPositions[index];
      this.cards.get(type)?.container.setPosition(position.x, position.y);
    });
    this.toastY = layout.toastY;
  }

  private showToast(message: string): void {
    // Lifted off the layout anchor so the pill clears the screen's bottom edge.
    showToast(this, message, { y: this.toastY - 14, tone: 'error', reducedMotion: this.reducedMotion });
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
    this.coinPill.setText(`${career.coins}`);
    anchorPillLeft(this.coinPill, 16);

    this.drawKingdom(kingdom);
    this.tierText
      .setText(kingdomTierName(kingdom.tier.id, kingdom.tier.name))
      .setColor(`#${kingdom.tier.color.toString(16).padStart(6, '0')}`);
    this.kingdomLevelText.setText(fa.kingdom.power(kingdom.totalLevel, kingdom.maxLevel));
    this.tierProgress.setProgress(kingdom.tierProgress, kingdom.tier.color);
    this.tierGoalText.setText(
      kingdom.nextTier
        ? fa.kingdom.toNextTier(kingdom.levelsToNextTier, kingdomTierName(kingdom.nextTier.id, kingdom.nextTier.name))
        : fa.kingdom.fullyEvolved
    );
    this.cards.forEach((card) => card.refresh());
  }

  private playKingdomTierCelebration(progress: KingdomProgress): void {
    this.platform.hapticNotification('success');
    const bannerY = this.progressContainer.y + this.heroHeight / 2;
    const banner = createText(this, LOGICAL_WIDTH / 2, bannerY, fa.kingdom.evolved(kingdomTierName(progress.tier.id, progress.tier.name)), {
        fontSize: '20px',
        fontStyle: '900',
        color: '#fff7cc',
        stroke: '#713f12',
        strokeThickness: 6,
        align: 'center',
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
          y: bannerY - 12,
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
    if (this.isExiting) return;
    // Leaving mid-purchase would strand the in-flight request's UI callbacks
    // on a torn-down scene and let MenuScene render pre-purchase career data,
    // so the hub stays open until the purchase settles.
    if (!this.purchaseRunner.requestClose()) {
      this.showToast(fa.kingdom.finishingUpgrade);
      return;
    }
    this.isExiting = true;
    goToScene(this, 'MenuScene');
  }
}

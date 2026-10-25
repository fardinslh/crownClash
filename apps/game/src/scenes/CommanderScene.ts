import Phaser from 'phaser';
import {
  COMMANDERS, getKingdomLevel, isCommanderUnlocked, LOGICAL_WIDTH,
  type CommanderDefinition, type CommanderId,
} from '@crown-clash/game-core';
import { createPlatformAdapter, type PlatformAdapter } from '@crown-clash/platform';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { trackEvent } from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { UI } from '../theme.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  SceneViewport,
  setupSceneCamera,
} from '../ui/Viewport.js';
import { computeCommanderLayout } from '../ui/HubLayouts.js';
import { createText } from '../ui/TextStyles.js';
import { commanderIcon, createIcon } from '../ui/icons.js';
import {
  createBackButton,
  createButton,
  createGlow,
  createHeader,
  createPill,
  drawPanel,
  fadeIn,
  goToScene,
  showToast,
} from '../ui/kit/index.js';
import { commanderCopy, fa } from '../i18n/fa.js';

const CARD_WIDTH = 360;
const CARD_HEIGHT = 138;

export class CommanderScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private active = true;
  private pending = false;
  private isExiting = false;
  private reducedMotion = false;
  private background!: Phaser.GameObjects.Rectangle;
  private powerBadge!: Phaser.GameObjects.Container;
  private cards: Phaser.GameObjects.Container[] = [];
  private helperText!: Phaser.GameObjects.Text;

  constructor() { super({ key: 'CommanderScene' }); }

  create(): void {
    setupSceneCamera(this);
    bindSceneViewportResize(this, (viewport) => this.applyLayout(viewport));
    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);
    this.active = true;
    this.isExiting = false;
    this.pending = false;
    this.cards = [];
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    this.buildScene();
    this.platform.showBackButton(() => this.close());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.active = false;
      this.platform.hideBackButton();
    });
    trackEvent({ name: 'commander_panel_viewed' });
    fadeIn(this);
  }

  private buildScene(): void {
    const viewport = getSceneViewport(this);
    const layout = computeCommanderLayout(viewport.visibleHeight);
    this.background = this.add.rectangle(
      LOGICAL_WIDTH / 2,
      viewport.visibleHeight / 2,
      viewport.visibleWidth,
      viewport.visibleHeight,
      UI.bg
    );
    createGlow(this, LOGICAL_WIDTH / 2, -30, viewport.visibleWidth * 1.4, 300, 0x2563eb, 0.24);
    // RTL: back sits top-right.
    createBackButton(this, LOGICAL_WIDTH - 34, 38, () => this.close());
    createHeader(this, fa.council.title, fa.council.subtitle);
    const level = getKingdomLevel(this.careerManager.getCareer());
    this.powerBadge = createPill(this, LOGICAL_WIDTH / 2, layout.powerBadgeY, 'castle', fa.council.power(level)).container;
    COMMANDERS.forEach((commander, index) => this.createCard(commander, layout.cardYs[index], index, !this.reducedMotion));
    this.helperText = createText(this, LOGICAL_WIDTH / 2, layout.helperTextY, fa.council.helper, {
      fontSize: '12px', color: UI.text.muted, fontStyle: '700', align: 'center', wordWrap: { width: 340 },
    }).setOrigin(0.5);
    this.applyLayout(viewport);
  }

  private applyLayout(viewport: SceneViewport): void {
    const layout = computeCommanderLayout(viewport.visibleHeight);
    this.background
      .setPosition(LOGICAL_WIDTH / 2, viewport.visibleHeight / 2)
      .setSize(viewport.visibleWidth, viewport.visibleHeight);
    this.powerBadge.setY(layout.powerBadgeY);
    this.cards.forEach((card, index) => {
      if (layout.cardYs[index] !== undefined) {
        card.setY(layout.cardYs[index]);
      }
    });
    this.helperText.setY(layout.helperTextY);
  }

  private createCard(commander: CommanderDefinition, y: number, index: number, animate: boolean): void {
    const career = this.careerManager.getCareer();
    const unlocked = isCommanderUnlocked(commander.id, getKingdomLevel(career));
    const selected = career.selectedCommanderId === commander.id;
    const copy = commanderCopy(commander.id, commander);
    const right = CARD_WIDTH / 2 - 16;
    const container = this.add.container(LOGICAL_WIDTH / 2, y);
    const dim = unlocked ? 1 : 0.55;

    container.add(drawPanel(this.add.graphics(), CARD_WIDTH, CARD_HEIGHT, {
      fill: selected ? UI.surface.high : UI.surface.raised,
      stroke: selected ? commander.accent : UI.border,
      strokeAlpha: selected ? 1 : 0.9,
      radius: UI.radius.lg,
    }));
    // Top: emblem (right) with name and role; bottom: trade-off lines on the
    // right and the action on the left, so long copy never runs under it.
    const emblemX = right - 34;
    if (selected) container.add(createGlow(this, emblemX, -26, 150, 130, commander.accent, 0.45));
    const emblem = createIcon(this, emblemX, -26, commanderIcon(commander.id), 64).setAlpha(unlocked ? 1 : 0.45);
    container.add(emblem);
    if (!unlocked) container.add(createIcon(this, emblemX + 22, -6, 'lock', 26));

    const textRight = right - 78;
    container.add(createText(this, textRight, -42, copy.name, {
      fontSize: '18px', fontStyle: '900', color: unlocked ? UI.text.primary : UI.text.muted,
    }).setOrigin(1, 0.5).setAlpha(dim));
    container.add(createText(this, textRight, -18, copy.role, {
      fontSize: '12px', fontStyle: '700', color: UI.text.muted,
    }).setOrigin(1, 0.5).setAlpha(dim));
    container.add(this.add.rectangle(0, 8, CARD_WIDTH - 32, 1, UI.border, 0.9));
    container.add(createText(this, right, 28, copy.strength, {
      fontSize: '13px', fontStyle: '800', color: UI.text.success,
    }).setOrigin(1, 0.5).setAlpha(dim));
    container.add(createText(this, right, 50, copy.tradeoff, {
      fontSize: '13px', fontStyle: '800', color: UI.text.danger,
    }).setOrigin(1, 0.5).setAlpha(dim));

    const buttonX = -CARD_WIDTH / 2 + 82;
    const buttonY = 38;
    if (selected) {
      // Equipped is a state, not an action: a badge instead of a button.
      const badge = this.add.container(buttonX, buttonY, [
        drawPanel(this.add.graphics(), 140, 40, { fill: 0x0b3b2c, stroke: UI.button.success.fill, radius: 20, shadow: false }),
        createIcon(this, 46, 0, 'check', 20),
        createText(this, 32, 0, fa.council.equipped, { fontSize: '13px', fontStyle: '900', color: UI.text.success }).setOrigin(1, 0.5),
      ]);
      container.add(badge);
    } else {
      const button = createButton(this, buttonX, buttonY - 2, {
        width: 140,
        height: 44,
        label: unlocked ? fa.council.equip : fa.council.unlockAt(commander.unlockKingdomLevel),
        icon: unlocked ? undefined : 'castle',
        variant: 'primary',
        fontSize: 13,
        onPress: () => void this.select(commander.id),
      });
      if (!unlocked) button.setEnabled(false);
      container.add(button.container);
    }
    if (animate) {
      container.setAlpha(0).setScale(0.95);
      this.tweens.add({ targets: container, alpha: 1, scale: 1, duration: 260, delay: 60 + index * 60, ease: 'Back.easeOut' });
    }
    this.cards.push(container);
  }

  private async select(commanderId: CommanderId): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try {
      if (!this.careerManager.isRemoteConnected() && !isLocalCareerFallbackAllowed()) {
        await this.careerManager.connect(this.platform);
      }
      const result = await this.careerManager.selectCommander(commanderId);
      if (!this.active) return;
      if (!result.success) return this.showToast(fa.council.locked);
      sounds.playReinforce();
      this.platform.hapticNotification('success');
      trackEvent({ name: 'commander_selected', commanderId });
      this.cards.forEach((card) => card.destroy(true));
      this.cards = [];
      const { visibleHeight } = getSceneViewport(this);
      const layout = computeCommanderLayout(visibleHeight);
      COMMANDERS.forEach((commander, index) => this.createCard(commander, layout.cardYs[index], index, false));
      const chosen = COMMANDERS.findIndex((commander) => commander.id === commanderId);
      const card = this.cards[chosen];
      if (card && !this.reducedMotion) {
        this.tweens.add({ targets: card, scale: 1.04, duration: 140, yoyo: true, ease: 'Cubic.easeOut' });
      }
    } catch (error) {
      console.error('[CommanderScene] Selection failed:', error);
      if (this.active) this.showToast(fa.council.equipFailed);
    } finally { this.pending = false; }
  }

  private showToast(message: string): void {
    const { visibleHeight } = getSceneViewport(this);
    const layout = computeCommanderLayout(visibleHeight);
    showToast(this, message, { y: layout.toastY, tone: 'error', reducedMotion: this.reducedMotion });
  }

  private close(): void {
    if (this.isExiting) return;
    if (this.pending) return this.showToast(fa.council.equipping);
    this.isExiting = true;
    this.platform.hapticSelection();
    goToScene(this, 'MenuScene');
  }
}

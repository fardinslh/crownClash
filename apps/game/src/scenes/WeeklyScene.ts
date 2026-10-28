import Phaser from 'phaser';
import { getBattlefield, LOGICAL_WIDTH } from '@crown-clash/game-core';
import { createPlatformAdapter, type PlatformAdapter } from '@crown-clash/platform';
import type { WeeklyLaunch, WeeklySlotState, WeeklyState } from '../api/GameApiClient.js';
import { trackEvent } from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { battlefieldName } from '../i18n/faBattle.js';
import { faWeekly } from '../i18n/faWeekly.js';
import { THEME, UI } from '../theme.js';
import { computeWeeklyLayout, splitTimeLeft } from '../ui/WeeklyLayout.js';
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
  type KitButton,
} from '../ui/kit/index.js';
import { createHubBackdrop } from '../ui/kit/hubBackdrop.js';

const SLOT_ACCENTS = [0xc2763a, 0xcbd5e1, THEME.gold] as const;
const DIFFICULTY_COLORS = { easy: UI.text.success, normal: UI.text.gold, hard: UI.text.danger } as const;

/**
 * Weekly Challenge hub: three fixed battles (Bronze, Silver, Gold) the server
 * defines for the current week. Each pays its coin reward once per week after
 * the server replays the win; the battle itself is GameScene with `weekly`.
 */
export class WeeklyScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private background!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private countdownText?: Phaser.GameObjects.Text;
  private retryButton?: KitButton;
  private cards: Phaser.GameObjects.Container[] = [];
  private state?: WeeklyState;
  private active = false;
  private isExiting = false;
  private visitId = 0;
  private reducedMotion = false;
  private countdownTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: 'WeeklyScene' });
  }

  create(): void {
    this.active = true;
    this.isExiting = false;
    this.visitId += 1;
    this.cards = [];
    this.countdownText = undefined;
    this.retryButton = undefined;
    this.state = undefined;
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
      this.countdownTimer?.remove(false);
      this.platform.hideBackButton();
    });
    void this.loadWeek();
    fadeIn(this);
  }

  private buildShell(): void {
    const vp = getSceneViewport(this);
    this.background = this.add.rectangle(0, 0, 10, 10, UI.bg).setDepth(-30);
    createHubBackdrop(this);
    createGlow(this, LOGICAL_WIDTH / 2, -30, vp.visibleWidth * 1.4, 280, THEME.gold, 0.16);
    createBackButton(this, LOGICAL_WIDTH - 34, 38, () => this.close());
    createHeader(this, faWeekly.title, faWeekly.subtitle);
    this.statusText = createText(this, LOGICAL_WIDTH / 2, 0, faWeekly.loading, {
      fontSize: `${UI.type.body}px`,
      fontStyle: '700',
      color: UI.text.muted,
    }).setOrigin(0.5);
    this.applyLayout(vp);
  }

  private applyLayout(vp: SceneViewport): void {
    const layout = computeWeeklyLayout(this.state?.slots.length ?? 3, vp.visibleHeight);
    this.background.setPosition(LOGICAL_WIDTH / 2, vp.visibleHeight / 2).setSize(vp.visibleWidth, vp.visibleHeight);
    this.statusText.setY(layout.statusY);
    this.retryButton?.container.setY(layout.statusY + 56);
    this.countdownText?.setY(layout.countdownY);
    this.cards.forEach((card, index) => card.setPosition(LOGICAL_WIDTH / 2, layout.cardYs[index]));
  }

  private async loadWeek(): Promise<void> {
    const visitId = this.visitId;
    try {
      if (!this.careerManager.isRemoteConnected()) await this.careerManager.connect(this.platform);
      const state = await this.careerManager.getWeeklyChallenge();
      if (!this.active || visitId !== this.visitId) return;
      this.state = state;
      this.statusText.setVisible(false);
      trackEvent({ name: 'weekly_challenge_viewed' });
      this.renderWeek();
    } catch (error) {
      console.error('[WeeklyScene] Failed to load the week:', error);
      if (this.active && visitId === this.visitId) this.showLoadError();
    }
  }

  private showLoadError(): void {
    this.statusText.setText(faWeekly.loadFailed).setColor(UI.text.danger).setVisible(true);
    this.retryButton?.container.destroy();
    let retried = false;
    this.retryButton = createButton(this, LOGICAL_WIDTH / 2, 0, {
      width: 170,
      height: 48,
      label: faWeekly.retry,
      onPress: () => {
        if (retried) return;
        retried = true;
        this.retryButton?.container.destroy();
        this.retryButton = undefined;
        this.statusText.setText(faWeekly.loading).setColor(UI.text.muted);
        void this.loadWeek();
      },
    });
    this.applyLayout(getSceneViewport(this));
  }

  private renderWeek(): void {
    const state = this.state;
    if (!state) return;
    for (const card of this.cards) card.destroy(true);
    this.cards = state.slots.map((slot) => this.buildCard(state, slot));
    this.countdownText?.destroy();
    this.countdownText = createText(this, LOGICAL_WIDTH / 2, 0, this.countdownLabel(state), {
      fontSize: `${UI.type.body}px`,
      fontStyle: '800',
      color: UI.text.muted,
    }).setOrigin(0.5);
    this.countdownTimer?.remove(false);
    this.countdownTimer = this.time.addEvent({
      delay: 30_000,
      loop: true,
      callback: () => this.countdownText?.setText(this.countdownLabel(state)),
    });
    this.applyLayout(getSceneViewport(this));
    if (!this.reducedMotion) {
      this.cards.forEach((card, index) => {
        card.setAlpha(0);
        this.tweens.add({ targets: card, alpha: 1, duration: 200, delay: index * 60 });
      });
    }
  }

  private countdownLabel(state: WeeklyState): string {
    const { days, hours, minutes } = splitTimeLeft(state.endsAt - Date.now());
    return faWeekly.endsIn(days, hours, minutes);
  }

  private buildCard(state: WeeklyState, slot: WeeklySlotState): Phaser.GameObjects.Container {
    const { cardWidth: width, cardHeight: height } = computeWeeklyLayout(state.slots.length, getSceneViewport(this).visibleHeight);
    const accent = SLOT_ACCENTS[slot.slot - 1] ?? THEME.gold;
    const container = this.add.container(0, 0);
    const panel = drawPanel(this.add.graphics(), width, height, {
      fill: slot.claimed ? 0x14503a : UI.surface.high,
      stroke: slot.claimed ? 0x34d399 : accent,
      radius: UI.radius.lg,
      alpha: 0.97,
    });
    const right = width / 2 - 22;
    const name = createText(this, right, -height / 2 + 26, faWeekly.slotName[slot.slot - 1] ?? `${slot.slot}`, {
      fontSize: '24px',
      fontStyle: '900',
      color: UI.text.gold,
      stroke: UI.text.stroke,
      strokeThickness: 4,
    }).setOrigin(1, 0.5);
    const map = createText(this, right, 4, battlefieldName(slot.battlefieldId, getBattlefield(slot.battlefieldId).name), {
      fontSize: '13px',
      fontStyle: '700',
      color: UI.text.secondary,
    }).setOrigin(1, 0.5);
    const difficulty = createText(this, right, height / 2 - 24, faWeekly.difficulty[slot.botDifficulty], {
      fontSize: '13px',
      fontStyle: '800',
      color: DIFFICULTY_COLORS[slot.botDifficulty],
    }).setOrigin(1, 0.5);
    container.add([panel, name, map, difficulty]);
    if (slot.claimed) {
      container.add([
        createIcon(this, -width / 2 + 34, -10, 'check', 28),
        createText(this, -width / 2 + 34, 20, faWeekly.claimed, { fontSize: '11px', fontStyle: '800', color: UI.text.success }).setOrigin(0.5),
      ]);
    } else {
      container.add([
        createIcon(this, -width / 2 + 28, -4, 'coin', 22),
        createText(this, -width / 2 + 46, -4, faWeekly.reward(slot.coinReward), { fontSize: '20px', fontStyle: '900', color: UI.text.gold }).setOrigin(0, 0.5),
        createText(this, -width / 2 + 28, 22, faWeekly.play, { fontSize: '12px', fontStyle: '800', color: UI.text.accent }).setOrigin(0, 0.5),
      ]);
    }
    container.setSize(width, height).setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => this.onCardPressed(state, slot, container));
    return container;
  }

  private onCardPressed(state: WeeklyState, slot: WeeklySlotState, card: Phaser.GameObjects.Container): void {
    if (this.isExiting || !this.state) return;
    this.isExiting = true;
    sounds.playReinforce();
    this.platform.hapticSelection();
    this.tweens.add({ targets: card, scale: 0.97, duration: 80, yoyo: true });
    const weekly: WeeklyLaunch = {
      weekIndex: state.weekIndex,
      slot: slot.slot,
      battlefieldId: slot.battlefieldId,
      botDifficulty: slot.botDifficulty,
      enemy: slot.enemy,
      coinReward: slot.coinReward,
    };
    goToScene(this, 'GameScene', { source: 'menu', weekly }, () => {
      this.isExiting = false;
    });
  }

  private close(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    goToScene(this, 'LevelsScene');
  }
}

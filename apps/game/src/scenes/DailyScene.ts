import Phaser from 'phaser';
import {
  DailyMissionState,
  DailyState,
  formatDailyReset,
  LOGICAL_WIDTH,
} from '@crown-clash/game-core';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';
import { trackEvent } from '../analytics/Analytics.js';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { DailyClaimRunner } from '../daily/DailyClaimRunner.js';
import { THEME, UI } from '../theme.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  setupSceneCamera,
  type SceneViewport,
} from '../ui/Viewport.js';
import { computeDailyLayout } from '../ui/HubLayouts.js';
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
  showRewardBurst,
  showToast,
  type KitButton,
  type KitPill,
} from '../ui/kit/index.js';
import { fa, missionCopy } from '../i18n/fa.js';

const MISSION_ICONS: Record<DailyMissionState['id'], IconKey> = {
  play_matches: 'swords',
  win_match: 'crown',
  capture_territories: 'castle',
};

const CARD_WIDTH = 360;
const MISSION_HEIGHT = 104;
const CHEST_HEIGHT = 118;

export class DailyScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private claimRunner!: DailyClaimRunner;
  private state?: DailyState;
  private content?: Phaser.GameObjects.Container;
  private background!: Phaser.GameObjects.Rectangle;
  private resetText!: Phaser.GameObjects.Text;
  private coinPill?: KitPill;
  private statusText!: Phaser.GameObjects.Text;
  private retryButton?: KitButton;
  private missionCards: Phaser.GameObjects.Container[] = [];
  private chestCard?: Phaser.GameObjects.Container;
  private chestIcon?: Phaser.GameObjects.Image;
  private toastY = 690;
  private resetTimer?: Phaser.Time.TimerEvent;
  private active = true;
  private visitId = 0;
  private loadingReset = false;
  private reducedMotion = false;
  private isExiting = false;
  private animatedEntrance = false;

  constructor() {
    super({ key: 'DailyScene' });
  }

  create(): void {
    // Phaser reuses Scene instances. Reset every visit-scoped field that was
    // invalidated by the previous SHUTDOWN before starting new async work.
    this.active = true;
    this.isExiting = false;
    this.visitId += 1;
    this.loadingReset = false;
    this.state = undefined;
    this.content = undefined;
    this.missionCards = [];
    this.chestCard = undefined;
    this.chestIcon = undefined;
    this.retryButton = undefined;
    this.coinPill = undefined;
    this.resetTimer = undefined;
    this.animatedEntrance = false;

    setupSceneCamera(this);
    bindSceneViewportResize(this, (vp) => this.applyLayout(vp));
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);

    this.claimRunner = new DailyClaimRunner(
      (type) => this.careerManager.claimDailyReward(type),
      {
        onPendingChanged: () => this.renderContent(),
        onResult: (result) => {
          this.state = result.state;
          this.refreshGold();
          if (result.success) {
            if (this.careerManager.isRemoteConnected()) {
              trackEvent({ name: 'daily_reward_claimed', claimId: result.claimId });
            }
            this.playClaimCelebration(result.reward, result.rewardType === 'crown_chest');
          } else {
            this.showToast(this.failureMessage(result.reason));
          }
          this.renderContent();
        },
        onError: (_type, error) => {
          console.error('[DailyScene] Reward claim failed:', error);
          this.platform.hapticNotification('error');
          this.showToast(fa.daily.claimFailed);
        },
      }
    );

    this.buildShell();
    this.platform.showBackButton(() => this.closeDaily());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.active = false;
      this.claimRunner.shutdown();
      this.resetTimer?.destroy();
      this.platform.hideBackButton();
    });

    trackEvent({ name: 'daily_panel_viewed' });
    void this.loadState();
    fadeIn(this);
  }

  private buildShell(): void {
    const vp = getSceneViewport(this);
    this.background = this.add.rectangle(0, 0, 10, 10, UI.bg);
    createGlow(this, LOGICAL_WIDTH / 2, -30, vp.visibleWidth * 1.4, 280, THEME.gold, 0.14);

    // RTL: back sits top-right, the wallet top-left.
    createBackButton(this, LOGICAL_WIDTH - 34, 38, () => this.closeDaily());
    createHeader(this, fa.daily.title, fa.daily.subtitle);

    this.resetText = createText(this, LOGICAL_WIDTH / 2, 0, fa.daily.resetPlaceholder, {
        fontSize: '12px',
        fontStyle: '700',
        color: UI.text.muted,
      })
      .setOrigin(0.5);

    this.coinPill = createPill(this, 0, 38, 'coin', '0');
    this.refreshGold();

    this.statusText = createText(this, LOGICAL_WIDTH / 2, 0, fa.daily.loading, {
        fontSize: `${UI.type.body}px`,
        fontStyle: '700',
        color: UI.text.muted,
      })
      .setOrigin(0.5);

    this.applyLayout(vp);
  }

  applyLayout(vp: SceneViewport): void {
    const layout = computeDailyLayout(vp.visibleHeight);
    this.background.setPosition(LOGICAL_WIDTH / 2, vp.visibleHeight / 2).setSize(vp.visibleWidth, vp.visibleHeight);
    this.resetText.setY(layout.resetTextY);
    this.statusText.setY(layout.statusTextY);
    this.retryButton?.container.setY(layout.retryY);
    this.missionCards.forEach((card, index) => {
      card.setY(layout.missionYs[index]);
    });
    if (this.chestCard) {
      this.chestCard.setY(layout.chestY);
    }
    this.toastY = layout.toastY;
  }

  private async loadState(): Promise<void> {
    const visitId = this.visitId;
    try {
      if (!this.careerManager.isRemoteConnected() && !isLocalCareerFallbackAllowed()) {
        await this.careerManager.connect(this.platform);
      }
      const state = await this.careerManager.getDailyState();
      if (!this.active || visitId !== this.visitId) return;
      this.state = state;
      this.statusText.setVisible(false);
      this.renderContent();
      this.refreshResetText();
      if (!this.resetTimer) {
        this.resetTimer = this.time.addEvent({
          delay: 1000,
          loop: true,
          callback: () => this.refreshResetText(),
        });
      }
    } catch (error) {
      console.error('[DailyScene] Failed to load daily state:', error);
      if (this.active && visitId === this.visitId) {
        this.showLoadError(fa.daily.loadError);
      }
    }
  }

  private showLoadError(message: string): void {
    this.statusText.setText(message).setColor(UI.text.danger).setVisible(true);
    this.retryButton?.container.destroy();
    let retried = false;
    this.retryButton = createButton(this, LOGICAL_WIDTH / 2, 0, {
      width: 170,
      height: 48,
      label: fa.daily.retry,
      variant: 'primary',
      onPress: () => {
        if (retried) return;
        retried = true;
        this.retryButton?.container.destroy();
        this.retryButton = undefined;
        this.statusText.setText(fa.daily.loading).setColor(UI.text.muted);
        void this.loadState();
      },
    });
    this.applyLayout(getSceneViewport(this));
  }

  private renderContent(): void {
    if (!this.state || !this.claimRunner?.isActive) return;
    // The chest wiggle loops forever; stop it before its card is destroyed.
    if (this.chestIcon) this.tweens.killTweensOf(this.chestIcon);
    this.content?.destroy(true);
    this.content = this.add.container(0, 0);
    this.missionCards = [];
    // Cards slide in on the first render only; claim re-renders stay still.
    const animate = !this.reducedMotion && !this.animatedEntrance;
    this.animatedEntrance = true;
    this.state.missions.forEach((mission, index) => {
      const card = this.buildMissionCard(mission, 0, index, animate);
      this.missionCards.push(card);
      this.content!.add(card);
    });
    this.chestCard = this.buildChestCard(0, animate);
    this.content.add(this.chestCard);
    this.applyLayout(getSceneViewport(this));
  }

  private buildMissionCard(
    mission: DailyMissionState,
    y: number,
    index: number,
    animate: boolean
  ): Phaser.GameObjects.Container {
    const card = this.add.container(LOGICAL_WIDTH / 2, y);
    const claimable = mission.complete && !mission.claimed;
    const pending = this.claimRunner.pending === mission.id;
    const copy = missionCopy(mission.id, mission);
    const right = CARD_WIDTH / 2 - 14;
    const borderColor = mission.claimed ? THEME.gold : claimable ? UI.button.success.fill : UI.border;

    const background = drawPanel(this.add.graphics(), CARD_WIDTH, MISSION_HEIGHT, {
      fill: mission.claimed ? 0x15172a : UI.surface.raised,
      stroke: borderColor,
      radius: UI.radius.lg,
    });
    const iconTile = drawPanel(this.add.graphics({ x: right - 26, y: -14 }), 52, 52, {
      fill: claimable ? 0x0b3b2c : UI.surface.high,
      stroke: claimable ? UI.button.success.fill : UI.borderStrong,
      radius: UI.radius.md,
      shadow: false,
    });
    const icon = createIcon(this, right - 26, -14, MISSION_ICONS[mission.id], 34);
    const title = createText(this, right - 64, -30, copy.title, {
        fontSize: '15px',
        fontStyle: '900',
        color: mission.claimed ? UI.text.gold : UI.text.primary,
      })
      .setOrigin(1, 0.5);
    const description = createText(this, right - 64, -8, copy.description, {
        fontSize: '12px',
        fontStyle: '700',
        color: UI.text.muted,
      })
      .setOrigin(1, 0.5);

    // Reward chip, top-left (RTL: coin to the right of the amount).
    const rewardCoin = createIcon(this, -CARD_WIDTH / 2 + 66, -30, 'coin', 20);
    const reward = createText(this, -CARD_WIDTH / 2 + 54, -30, `+${mission.reward}`, {
        fontSize: '14px',
        fontStyle: '900',
        color: UI.text.gold,
      })
      .setOrigin(1, 0.5);

    // RTL progress: fills from the right; the count sits on the bar.
    const barRight = right - 64;
    const barLeft = -CARD_WIDTH / 2 + 150;
    const ratio = Math.min(1, mission.progress / mission.target);
    const bar = createProgressBar(this, (barLeft + barRight) / 2, 26, barRight - barLeft, 16, mission.complete ? THEME.gold : UI.button.primary.fill);
    bar.setProgress(ratio);
    const progress = createText(this, (barLeft + barRight) / 2, 26, `${mission.progress}/${mission.target}`, {
        fontSize: '11px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: UI.text.stroke,
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    const canClaim = claimable && !pending && this.claimRunner.pending === null;
    const button = createButton(this, -CARD_WIDTH / 2 + 72, 22, {
      width: 116,
      height: 44,
      label: mission.claimed ? fa.daily.claimed : pending ? '…' : claimable ? fa.daily.claim : fa.daily.inBattle,
      icon: mission.claimed ? 'check' : undefined,
      variant: 'success',
      fontSize: 13,
      onPress: () => this.claimRunner.run(mission.id),
    });
    if (!canClaim) button.setEnabled(false);

    const items: Phaser.GameObjects.GameObject[] = [
      background, iconTile, icon, title, description, rewardCoin, reward, bar.graphics, progress, button.container,
    ];
    if (mission.claimed) items.push(createIcon(this, right - 6, -34, 'check', 20));
    card.add(items);
    if (animate) {
      card.setAlpha(0).setX(LOGICAL_WIDTH / 2 + 14);
      this.tweens.add({
        targets: card,
        alpha: 1,
        x: LOGICAL_WIDTH / 2,
        duration: 240,
        delay: index * 55,
        ease: 'Cubic.easeOut',
      });
    }
    return card;
  }

  private buildChestCard(y: number, animate: boolean): Phaser.GameObjects.Container {
    const chest = this.state!.chest;
    const pending = this.claimRunner.pending === 'crown_chest';
    const claimedMissions = this.state!.missions.filter((mission) => mission.claimed).length;
    const right = CARD_WIDTH / 2 - 14;
    const card = this.add.container(LOGICAL_WIDTH / 2, y);
    const background = drawPanel(this.add.graphics(), CARD_WIDTH, CHEST_HEIGHT, {
      fill: chest.unlocked && !chest.claimed ? 0x231a33 : UI.surface.raised,
      stroke: chest.claimed || chest.unlocked ? THEME.gold : UI.borderStrong,
      radius: UI.radius.lg,
    });
    const halo = createGlow(this, right - 44, 0, 150, 130, THEME.gold, chest.unlocked && !chest.claimed ? 0.55 : 0.18);
    const icon = createIcon(this, right - 44, 0, chest.claimed ? 'chest_open' : 'chest', 70);
    if (!chest.unlocked) icon.setAlpha(0.75);
    this.chestIcon = icon;
    const title = createText(this, right - 98, -32, fa.daily.chestTitle, {
        fontSize: '18px',
        fontStyle: '900',
        color: chest.unlocked || chest.claimed ? UI.text.gold : UI.text.primary,
        stroke: UI.text.stroke,
        strokeThickness: 3,
      })
      .setOrigin(1, 0.5);
    const detail = createText(this, right - 98, -6, chest.claimed ? fa.daily.chestClaimed : chest.unlocked ? fa.daily.chestUnlocked : fa.daily.chestProgress(claimedMissions), {
        fontSize: '12px',
        fontStyle: '700',
        color: UI.text.muted,
      })
      .setOrigin(1, 0.5);
    const rewardCoin = createIcon(this, right - 108, 24, 'coin', 22);
    const reward = createText(this, right - 124, 24, `+${chest.reward}`, {
        fontSize: '16px',
        fontStyle: '900',
        color: UI.text.gold,
      })
      .setOrigin(1, 0.5);
    const canOpen = chest.unlocked && !chest.claimed && !pending && this.claimRunner.pending === null;
    const button = createButton(this, -CARD_WIDTH / 2 + 74, 20, {
      width: 120,
      height: 48,
      label: chest.claimed ? fa.daily.opened : pending ? '…' : chest.unlocked ? fa.daily.open : fa.daily.locked,
      icon: chest.claimed ? 'check' : chest.unlocked ? undefined : 'lock',
      variant: 'gold',
      fontSize: 14,
      onPress: () => this.claimRunner.run('crown_chest'),
    });
    if (!canOpen) button.setEnabled(false);
    card.add([background, halo, icon, title, detail, rewardCoin, reward, button.container]);

    if (canOpen && !this.reducedMotion) {
      // Unlocked chest wiggles to invite the tap.
      this.tweens.add({ targets: icon, angle: { from: -5, to: 5 }, duration: 160, yoyo: true, repeat: -1, repeatDelay: 1100, ease: 'Sine.easeInOut' });
    }
    if (animate) {
      card.setAlpha(0).setScale(0.94);
      this.tweens.add({ targets: card, alpha: 1, scale: 1, duration: 260, delay: 180, ease: 'Back.easeOut' });
    }
    return card;
  }

  private playClaimCelebration(reward: number, isChest: boolean): void {
    if (isChest) {
      sounds.playVictory();
      this.platform.hapticImpact('heavy');
    } else {
      sounds.playCoin();
      this.platform.hapticNotification('success');
    }
    const { visibleHeight } = getSceneViewport(this);
    showRewardBurst(this, LOGICAL_WIDTH / 2, visibleHeight * 0.46, reward, {
      title: isChest ? fa.daily.chestTitle : undefined,
      big: isChest,
      reducedMotion: this.reducedMotion,
    });
  }

  private refreshResetText(): void {
    if (!this.state) return;
    this.resetText.setText(fa.daily.reset(formatDailyReset(this.state.resetsAt)));
    if (Date.now() < this.state.resetsAt || this.loadingReset) return;
    this.loadingReset = true;
    void this.loadState().finally(() => {
      this.loadingReset = false;
    });
  }

  private refreshGold(): void {
    if (!this.coinPill) return;
    this.coinPill.setText(`${this.careerManager.getCareer().coins}`);
    anchorPillLeft(this.coinPill, 16);
  }

  private failureMessage(reason?: string): string {
    if (reason === 'not_complete') return fa.daily.notComplete;
    if (reason === 'already_claimed') return fa.daily.alreadyClaimed;
    if (reason === 'chest_locked') return fa.daily.chestLocked;
    return fa.daily.claimFailed;
  }

  private showToast(message: string): void {
    // Lifted off the layout anchor so the pill clears the screen's bottom edge.
    showToast(this, message, { y: this.toastY - 14, tone: 'error', reducedMotion: this.reducedMotion });
  }

  private closeDaily(): void {
    if (this.isExiting) return;
    if (!this.claimRunner.requestClose()) {
      this.showToast(fa.daily.finishingClaim);
      return;
    }
    this.isExiting = true;
    goToScene(this, 'MenuScene');
  }
}

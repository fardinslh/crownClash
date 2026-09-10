import Phaser from 'phaser';
import {
  DailyMissionState,
  DailyState,
  formatDailyReset,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
} from '@crown-clash/game-core';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';
import { trackEvent } from '../analytics/Analytics.js';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { DailyClaimRunner } from '../daily/DailyClaimRunner.js';
import { THEME } from '../theme.js';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';
const MISSION_ICONS: Record<DailyMissionState['id'], string> = {
  play_matches: '⚔️',
  win_match: '👑',
  capture_territories: '🏰',
};

export class DailyScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private claimRunner!: DailyClaimRunner;
  private state?: DailyState;
  private content?: Phaser.GameObjects.Container;
  private resetText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private goldBg!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private toastBg!: Phaser.GameObjects.Rectangle;
  private toastText!: Phaser.GameObjects.Text;
  private resetTimer?: Phaser.Time.TimerEvent;
  private active = true;
  private visitId = 0;
  private loadingReset = false;
  private reducedMotion = false;

  constructor() {
    super({ key: 'DailyScene' });
  }

  create(): void {
    // Phaser reuses Scene instances. Reset every visit-scoped field that was
    // invalidated by the previous SHUTDOWN before starting new async work.
    this.active = true;
    this.visitId += 1;
    this.loadingReset = false;
    this.state = undefined;
    this.content = undefined;
    this.resetTimer = undefined;

    const renderScale = (this.registry.get('renderScale') as number) || 1;
    this.cameras.main.setZoom(renderScale);
    this.cameras.main.centerOn(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
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
          this.showToast("Couldn't claim reward. Please try again.");
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
  }

  private buildShell(): void {
    this.add.rectangle(
      LOGICAL_WIDTH / 2,
      LOGICAL_HEIGHT / 2,
      LOGICAL_WIDTH,
      LOGICAL_HEIGHT,
      0x070b14
    );
    const glow = this.add.graphics();
    glow.fillStyle(THEME.gold, 0.08);
    glow.fillCircle(LOGICAL_WIDTH / 2, 68, 220);
    glow.fillStyle(0x2563eb, 0.06);
    glow.fillCircle(LOGICAL_WIDTH / 2, 430, 260);

    const backBg = this.add
      .rectangle(34, 34, 44, 44, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.9)
      .setInteractive({ useHandCursor: true });
    const backLabel = this.add
      .text(34, 32, '‹', {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        fontStyle: '900',
        color: '#e2e8f0',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(backBg, backLabel);
    backBg.on('pointerdown', () => this.closeDaily());

    this.add
      .text(LOGICAL_WIDTH / 2, 39, 'ROYAL ORDERS', {
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
      .text(LOGICAL_WIDTH / 2, 66, 'Complete today’s campaign', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#93c5fd',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    this.resetText = this.add
      .text(LOGICAL_WIDTH / 2, 101, 'RESET  --:--:--', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);

    this.goldBg = this.add
      .rectangle(LOGICAL_WIDTH - 24, 34, 10, 32, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, THEME.gold, 0.85);
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
    this.refreshGold();

    this.statusText = this.add
      .text(LOGICAL_WIDTH / 2, 340, 'Reading today’s orders…', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);

    this.toastBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 690, 330, 42, 0x0c1322, 0.98)
      .setStrokeStyle(1.5, 0xf87171, 0.9)
      .setDepth(300)
      .setAlpha(0);
    this.toastText = this.add
      .text(LOGICAL_WIDTH / 2, 690, '', {
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
        this.showLoadError("Couldn't load today's orders.");
      }
    }
  }

  private showLoadError(message: string): void {
    this.statusText.setText(message).setColor('#fca5a5').setVisible(true);
    const retryBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 392, 160, 44, 0x2563eb, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const retryLabel = this.add
      .text(LOGICAL_WIDTH / 2, 392, 'RETRY', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#ffffff',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(retryBg, retryLabel);
    retryBg.once('pointerdown', () => {
      retryBg.destroy();
      retryLabel.destroy();
      this.statusText.setText('Reading today’s orders…').setColor('#94a3b8');
      void this.loadState();
    });
  }

  private renderContent(): void {
    if (!this.state || !this.claimRunner?.isActive) return;
    this.content?.destroy(true);
    this.content = this.add.container(0, 0);

    const missionYs = [174, 291, 408];
    this.state.missions.forEach((mission, index) => {
      this.content!.add(this.buildMissionCard(mission, missionYs[index], index));
    });
    this.content.add(this.buildChestCard(566));
  }

  private buildMissionCard(
    mission: DailyMissionState,
    y: number,
    index: number
  ): Phaser.GameObjects.Container {
    const card = this.add.container(LOGICAL_WIDTH / 2, y);
    const claimable = mission.complete && !mission.claimed;
    const pending = this.claimRunner.pending === mission.id;
    const borderColor = mission.claimed ? THEME.gold : claimable ? 0x60a5fa : 0x334155;
    const background = this.add
      .rectangle(0, 0, 352, 104, mission.claimed ? 0x151827 : 0x111827, 0.98)
      .setStrokeStyle(claimable ? 2 : 1.5, borderColor, 1);
    const iconDisc = this.add
      .circle(-145, -20, 21, claimable ? 0x1d4ed8 : 0x0f172a, 1)
      .setStrokeStyle(1.5, borderColor, 0.85);
    const icon = this.add
      .text(-145, -20, MISSION_ICONS[mission.id], { fontSize: '19px', resolution: 2 })
      .setOrigin(0.5);
    const title = this.add
      .text(-114, -34, mission.title.toUpperCase(), {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: mission.claimed ? '#fde68a' : '#f1f5f9',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0, 0.5);
    const description = this.add
      .text(-114, -13, mission.description, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0, 0.5);
    const reward = this.add
      .text(145, -30, `+${mission.reward} 🪙`, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(1, 0.5);

    const track = this.add.rectangle(-145, 25, 188, 8, 0x080d18, 1).setOrigin(0, 0.5);
    const ratio = Math.min(1, mission.progress / mission.target);
    const fill = this.add
      .rectangle(-145, 25, Math.max(2, 188 * ratio), 6, mission.complete ? THEME.gold : 0x2563eb, 1)
      .setOrigin(0, 0.5);
    const progress = this.add
      .text(51, 25, `${mission.progress}/${mission.target}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        resolution: 2,
      })
      .setOrigin(1, 0.5);

    const button = this.add.rectangle(121, 24, 94, 40, 0x273449, 1).setStrokeStyle(1.5, 0x475569, 1);
    const buttonLabel = this.add
      .text(121, 24, mission.claimed ? 'CLAIMED ✓' : pending ? '…' : claimable ? 'CLAIM' : 'IN BATTLE', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: '900',
        color: mission.claimed ? '#fde68a' : claimable && !pending ? '#ffffff' : '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    if (claimable && !pending && this.claimRunner.pending === null) {
      button.setFillStyle(0x2563eb, 1).setStrokeStyle(1.5, 0x60a5fa, 1).setInteractive({ useHandCursor: true });
      this.bindPressFeedback(button, buttonLabel);
      button.on('pointerdown', () => this.claimRunner.run(mission.id));
    }

    card.add([
      background,
      iconDisc,
      icon,
      title,
      description,
      reward,
      track,
      fill,
      progress,
      button,
      buttonLabel,
    ]);
    if (!this.reducedMotion) {
      card.setAlpha(0).setX(LOGICAL_WIDTH / 2 - 12);
      this.tweens.add({
        targets: card,
        alpha: 1,
        x: LOGICAL_WIDTH / 2,
        duration: 220,
        delay: index * 45,
        ease: 'Cubic.easeOut',
      });
    }
    return card;
  }

  private buildChestCard(y: number): Phaser.GameObjects.Container {
    const chest = this.state!.chest;
    const pending = this.claimRunner.pending === 'crown_chest';
    const claimedMissions = this.state!.missions.filter((mission) => mission.claimed).length;
    const borderColor = chest.claimed ? THEME.gold : chest.unlocked ? 0xfbbf24 : 0x475569;
    const card = this.add.container(LOGICAL_WIDTH / 2, y);
    const background = this.add
      .rectangle(0, 0, 352, 118, chest.unlocked ? 0x1c1830 : 0x111827, 0.99)
      .setStrokeStyle(chest.unlocked ? 2.5 : 1.5, borderColor, 1);
    const halo = this.add.circle(-126, 0, 38, THEME.gold, chest.unlocked ? 0.12 : 0.04);
    const icon = this.add
      .text(-126, 0, chest.claimed ? '👑' : '🎁', { fontSize: '34px', resolution: 2 })
      .setOrigin(0.5);
    const title = this.add
      .text(-77, -35, 'CROWN CHEST', {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        fontStyle: '900',
        color: chest.unlocked || chest.claimed ? '#fde68a' : '#e2e8f0',
        stroke: '#000000',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(0, 0.5);
    const detail = this.add
      .text(-77, -10, chest.claimed ? 'Royal bounty collected' : chest.unlocked ? 'All orders fulfilled' : `Claim all orders  ${claimedMissions}/3`, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0, 0.5);
    const reward = this.add
      .text(-77, 17, `+${chest.reward} 🪙`, {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0, 0.5);
    const button = this.add.rectangle(113, 24, 100, 42, 0x273449, 1).setStrokeStyle(1.5, borderColor, 1);
    const buttonLabel = this.add
      .text(113, 24, chest.claimed ? 'OPENED ✓' : pending ? '…' : chest.unlocked ? 'OPEN' : 'LOCKED', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '900',
        color: chest.unlocked && !pending ? '#ffffff' : chest.claimed ? '#fde68a' : '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    if (chest.unlocked && !chest.claimed && !pending && this.claimRunner.pending === null) {
      button.setFillStyle(0xb7791f, 1).setStrokeStyle(2, 0xfbbf24, 1).setInteractive({ useHandCursor: true });
      this.bindPressFeedback(button, buttonLabel);
      button.on('pointerdown', () => this.claimRunner.run('crown_chest'));
    }
    card.add([background, halo, icon, title, detail, reward, button, buttonLabel]);
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
    const burst = this.add.container(LOGICAL_WIDTH / 2, isChest ? 355 : 330).setDepth(250);
    const glow = this.add.circle(0, 0, isChest ? 82 : 62, THEME.gold, 0.18);
    const label = this.add
      .text(0, 0, `${isChest ? 'CROWN CHEST\n' : ''}+${reward} 🪙`, {
        fontFamily: FONT_FAMILY,
        fontSize: isChest ? '22px' : '19px',
        fontStyle: '900',
        color: '#fde68a',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);
    burst.add([glow, label]);
    if (this.reducedMotion) {
      this.time.delayedCall(900, () => burst.destroy());
      return;
    }
    burst.setScale(0.75).setAlpha(0);
    this.tweens.add({
      targets: burst,
      scale: 1.08,
      alpha: 1,
      duration: 220,
      ease: 'Back.easeOut',
      yoyo: true,
      hold: 650,
      onComplete: () => burst.destroy(),
    });
  }

  private refreshResetText(): void {
    if (!this.state) return;
    this.resetText.setText(`RESET  ${formatDailyReset(this.state.resetsAt)}`);
    if (Date.now() < this.state.resetsAt || this.loadingReset) return;
    this.loadingReset = true;
    void this.loadState().finally(() => {
      this.loadingReset = false;
    });
  }

  private refreshGold(): void {
    const coins = this.careerManager.getCareer().coins;
    this.goldText?.setText(`🪙 ${coins}`);
    if (!this.goldText || !this.goldBg) return;
    const width = this.goldText.width + 28;
    this.goldBg.setSize(width, 32);
    this.goldBg.setPosition(LOGICAL_WIDTH - 24 - width / 2, 34);
    this.goldText.setPosition(LOGICAL_WIDTH - 38, 34);
  }

  private failureMessage(reason?: string): string {
    if (reason === 'not_complete') return 'Finish this order before claiming it.';
    if (reason === 'already_claimed') return 'This reward was already claimed.';
    if (reason === 'chest_locked') return 'Claim all three orders first.';
    return "Couldn't claim reward. Please try again.";
  }

  private showToast(message: string): void {
    this.toastText.setText(message).setAlpha(1);
    this.toastBg.setAlpha(1);
    this.tweens.killTweensOf([this.toastBg, this.toastText]);
    this.tweens.add({
      targets: [this.toastBg, this.toastText],
      alpha: 0,
      duration: 300,
      delay: this.reducedMotion ? 1400 : 2200,
      ease: 'Cubic.easeOut',
    });
  }

  private closeDaily(): void {
    if (!this.claimRunner.requestClose()) {
      this.showToast('Finishing your reward claim…');
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

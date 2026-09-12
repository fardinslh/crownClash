import Phaser from 'phaser';
import {
  getLeagueProgress,
  LOGICAL_WIDTH,
  RANK_TIERS,
  type LeagueState,
  type LeagueTierState,
} from '@crown-clash/game-core';
import { createPlatformAdapter, type PlatformAdapter } from '@crown-clash/platform';
import { trackEvent } from '../analytics/Analytics.js';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { sounds } from '../audio/SoundEffects.js';
import { CareerManager } from '../career/CareerManager.js';
import { THEME } from '../theme.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  setupSceneCamera,
  type SceneViewport,
} from '../ui/Viewport.js';
import { computeLeagueLayout } from '../ui/HubLayouts.js';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export class LeagueScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private state?: LeagueState;
  private content?: Phaser.GameObjects.Container;
  private background!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private coinText!: Phaser.GameObjects.Text;
  private retryBg?: Phaser.GameObjects.Rectangle;
  private retryText?: Phaser.GameObjects.Text;
  private summaryContainer?: Phaser.GameObjects.Container;
  private roadGraphics?: Phaser.GameObjects.Graphics;
  private tierRows: Phaser.GameObjects.Container[] = [];
  private kingdomButtonBg?: Phaser.GameObjects.Rectangle;
  private kingdomButtonText?: Phaser.GameObjects.Text;
  private toastBg!: Phaser.GameObjects.Rectangle;
  private toastText!: Phaser.GameObjects.Text;
  private pendingRankId: string | null = null;
  private active = false;
  private visitId = 0;
  private reducedMotion = false;

  constructor() {
    super({ key: 'LeagueScene' });
  }

  create(): void {
    this.active = true;
    this.visitId += 1;
    this.state = undefined;
    this.content = undefined;
    this.summaryContainer = undefined;
    this.roadGraphics = undefined;
    this.tierRows = [];
    this.kingdomButtonBg = undefined;
    this.kingdomButtonText = undefined;
    this.retryBg = undefined;
    this.retryText = undefined;
    this.pendingRankId = null;
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    setupSceneCamera(this);
    bindSceneViewportResize(this, (vp) => this.applyLayout(vp));
    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    this.careerManager = CareerManager.getInstance(this.platform.getUser().id);

    this.buildShell();
    this.platform.showBackButton(() => this.closeLeague());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.active = false;
      this.platform.hideBackButton();
    });
    trackEvent({ name: 'league_panel_viewed' });
    void this.loadState();
  }

  private buildShell(): void {
    const vp = getSceneViewport(this);
    this.background = this.add.rectangle(0, 0, 10, 10, 0x070b14);
    const glow = this.add.graphics();
    glow.fillStyle(THEME.gold, 0.1);
    glow.fillCircle(LOGICAL_WIDTH / 2, 30, 210);
    glow.fillStyle(0x2563eb, 0.06);
    glow.fillCircle(LOGICAL_WIDTH / 2, 430, 260);

    const backBg = this.add.rectangle(34, 34, 44, 44, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.9).setInteractive({ useHandCursor: true });
    const backText = this.add.text(34, 32, '‹', {
      fontFamily: FONT_FAMILY, fontSize: '26px', fontStyle: '900', color: '#e2e8f0', resolution: 2,
    }).setOrigin(0.5);
    this.bindPressFeedback(backBg, backText);
    backBg.on('pointerdown', () => this.closeLeague());

    this.add.text(LOGICAL_WIDTH / 2, 35, 'LEAGUE ROAD', {
      fontFamily: FONT_FAMILY, fontSize: '24px', fontStyle: '900', color: '#f8fafc',
      stroke: '#000000', strokeThickness: 4, resolution: 2,
    }).setOrigin(0.5);
    this.add.text(LOGICAL_WIDTH / 2, 63, 'Rise. Claim. Rule.', {
      fontFamily: FONT_FAMILY, fontSize: '12px', fontStyle: 'bold', color: '#93c5fd',
      stroke: '#000000', strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5);

    this.coinText = this.add.text(LOGICAL_WIDTH - 24, 34, '', {
      fontFamily: FONT_FAMILY, fontSize: '13px', fontStyle: '900', color: '#fbbf24',
      stroke: '#000000', strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0.5);
    this.refreshCoins();

    this.statusText = this.add.text(LOGICAL_WIDTH / 2, 0, 'Reading royal records…', {
      fontFamily: FONT_FAMILY, fontSize: '13px', fontStyle: 'bold', color: '#94a3b8', resolution: 2,
    }).setOrigin(0.5);

    this.toastBg = this.add.rectangle(LOGICAL_WIDTH / 2, 0, 330, 42, 0x0c1322, 0.98)
      .setStrokeStyle(1.5, 0xf87171, 0.9).setDepth(300).setAlpha(0);
    this.toastText = this.add.text(LOGICAL_WIDTH / 2, 0, '', {
      fontFamily: FONT_FAMILY, fontSize: '12px', fontStyle: 'bold', color: '#fecaca',
      align: 'center', resolution: 2,
    }).setOrigin(0.5).setDepth(301).setAlpha(0);

    this.applyLayout(vp);
  }

  applyLayout(vp: SceneViewport): void {
    const layout = computeLeagueLayout(vp.visibleHeight);
    this.background.setPosition(vp.visibleWidth / 2, vp.visibleHeight / 2).setSize(vp.visibleWidth, vp.visibleHeight);
    this.statusText.setY(layout.statusTextY);
    if (this.retryBg) this.retryBg.setY(layout.retryY);
    if (this.retryText) this.retryText.setY(layout.retryY);
    if (this.summaryContainer) this.summaryContainer.setY(layout.summaryY);
    if (this.roadGraphics) {
      this.roadGraphics.clear();
      this.roadGraphics.lineStyle(4, 0x334155, 0.8);
      this.roadGraphics.lineBetween(53, layout.roadStartY, 53, layout.roadEndY);
    }
    this.tierRows.forEach((row, index) => {
      row.setY(layout.tierYs[index]);
    });
    if (this.kingdomButtonBg) this.kingdomButtonBg.setY(layout.kingdomButtonY);
    if (this.kingdomButtonText) this.kingdomButtonText.setY(layout.kingdomButtonY);
    this.toastBg.setY(layout.toastY);
    this.toastText.setY(layout.toastY);
  }

  private async loadState(): Promise<void> {
    const visitId = this.visitId;
    try {
      if (!this.careerManager.isRemoteConnected() && !isLocalCareerFallbackAllowed()) {
        await this.careerManager.connect(this.platform);
      }
      const state = await this.careerManager.getLeagueState();
      if (!this.active || visitId !== this.visitId) return;
      this.state = state;
      this.statusText.setVisible(false);
      this.renderContent();
    } catch (error) {
      console.error('[LeagueScene] Failed to load league:', error);
      if (this.active && visitId === this.visitId) {
        this.showLoadError();
      }
    }
  }

  private showLoadError(): void {
    this.statusText.setText("Couldn't load League Road.").setColor('#fca5a5').setVisible(true);
    this.retryBg?.destroy();
    this.retryText?.destroy();
    this.retryBg = this.add.rectangle(LOGICAL_WIDTH / 2, 0, 160, 44, 0x2563eb, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1).setInteractive({ useHandCursor: true });
    this.retryText = this.add.text(LOGICAL_WIDTH / 2, 0, 'RETRY', {
      fontFamily: FONT_FAMILY, fontSize: '13px', fontStyle: '900', color: '#ffffff', resolution: 2,
    }).setOrigin(0.5);
    this.bindPressFeedback(this.retryBg, this.retryText);
    this.retryBg.once('pointerdown', () => {
      this.retryBg?.destroy();
      this.retryBg = undefined;
      this.retryText?.destroy();
      this.retryText = undefined;
      this.statusText.setText('Reading royal records…').setColor('#94a3b8');
      void this.loadState();
    });
    this.applyLayout(getSceneViewport(this));
  }

  private renderContent(): void {
    if (!this.state || !this.active) return;
    this.content?.destroy(true);
    this.content = this.add.container(0, 0);
    const progress = getLeagueProgress(this.state.trophies);

    this.summaryContainer = this.add.container(LOGICAL_WIDTH / 2, 0);
    const rankColor = progress.current.color;
    const summaryBg = this.add.rectangle(0, 0, 352, 88, 0x111827, 0.98)
      .setStrokeStyle(2, rankColor, 0.95);
    const title = this.add.text(-156, -27, `${progress.current.badge}  ${progress.current.name.toUpperCase()}`, {
      fontFamily: FONT_FAMILY, fontSize: '16px', fontStyle: '900', color: '#f8fafc',
      stroke: '#000000', strokeThickness: 2, resolution: 2,
    }).setOrigin(0, 0.5);
    const power = this.add.text(156, -27, `POWER ${this.state.kingdomPower}/80`, {
      fontFamily: FONT_FAMILY, fontSize: '11px', fontStyle: '900', color: '#c7d2fe', resolution: 2,
    }).setOrigin(1, 0.5);
    const track = this.add.rectangle(-156, 7, 312, 10, 0x080d18, 1).setOrigin(0, 0.5);
    const fill = this.add.rectangle(-156, 7, Math.max(3, 312 * progress.progress), 8, rankColor, 1).setOrigin(0, 0.5);
    const detail = this.add.text(0, 28,
      progress.next ? `${this.state.trophies} TROPHIES  •  ${progress.trophiesToNext} TO ${progress.next.name.toUpperCase()}` : `${this.state.trophies} TROPHIES  •  REALM MASTERED`, {
        fontFamily: FONT_FAMILY, fontSize: '11px', fontStyle: 'bold', color: '#94a3b8', resolution: 2,
      }).setOrigin(0.5);
    this.summaryContainer.add([summaryBg, title, power, track, fill, detail]);
    this.content.add(this.summaryContainer);

    this.roadGraphics = this.add.graphics();
    this.content.add(this.roadGraphics);
    this.tierRows = [];
    this.state.tiers.forEach((tier, index) => {
      const row = this.buildTierRow(tier, 0, index);
      this.tierRows.push(row);
      this.content!.add(row);
    });

    this.kingdomButtonBg = this.add.rectangle(LOGICAL_WIDTH / 2, 0, 220, 42, 0x111c33, 1)
      .setStrokeStyle(1.5, THEME.gold, 0.8).setInteractive({ useHandCursor: true });
    this.kingdomButtonText = this.add.text(LOGICAL_WIDTH / 2, 0, 'IMPROVE KINGDOM  🏰', {
      fontFamily: FONT_FAMILY, fontSize: '12px', fontStyle: '900', color: '#fde68a',
      stroke: '#000000', strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5);
    this.bindPressFeedback(this.kingdomButtonBg, this.kingdomButtonText);
    this.kingdomButtonBg.on('pointerdown', () => {
      sounds.playReinforce();
      this.platform.hapticSelection();
      this.scene.start('KingdomScene');
    });
    this.content.add([this.kingdomButtonBg, this.kingdomButtonText]);

    this.applyLayout(getSceneViewport(this));
  }

  private buildTierRow(tier: LeagueTierState, y: number, index: number): Phaser.GameObjects.Container {
    const rank = RANK_TIERS.find((item) => item.id === tier.rankId)!;
    const current = this.state?.currentRankId === tier.rankId;
    const claimable = tier.unlocked && !tier.claimed && tier.reward > 0;
    const pending = this.pendingRankId === tier.rankId;
    const row = this.add.container(0, y);
    const card = this.add.rectangle(214, 0, 320, 58, current ? 0x151d31 : 0x101725, 0.98)
      .setStrokeStyle(current ? 2 : 1, current ? rank.color : 0x334155, current ? 1 : 0.8);
    const node = this.add.circle(53, 0, current ? 18 : 15, tier.unlocked ? rank.color : 0x1e293b, 1)
      .setStrokeStyle(2, tier.unlocked ? rank.color : 0x475569, 1);
    const badge = this.add.text(53, 0, tier.badge, { fontSize: '15px', resolution: 2 }).setOrigin(0.5);
    const name = this.add.text(78, -13, tier.name.toUpperCase(), {
      fontFamily: FONT_FAMILY, fontSize: '12px', fontStyle: '900',
      color: tier.unlocked ? '#f8fafc' : '#64748b', stroke: '#000000', strokeThickness: 2, resolution: 2,
    }).setOrigin(0, 0.5);
    const rewardText = tier.reward > 0 ? `  •  +${tier.reward} 🪙` : '';
    const requirement = this.add.text(78, 12, `${current ? 'CURRENT LEAGUE' : `${tier.minTrophies} TROPHIES`}${rewardText}`, {
      fontFamily: FONT_FAMILY, fontSize: '11px', fontStyle: 'bold',
      color: current ? '#93c5fd' : '#94a3b8', resolution: 2,
    }).setOrigin(0, 0.5);
    const button = this.add.rectangle(326, 0, 86, 36, claimable ? 0x2563eb : 0x202b3d, 1)
      .setStrokeStyle(1.5, claimable ? 0x60a5fa : tier.claimed ? THEME.gold : 0x475569, 1);
    const buttonText = this.add.text(326, 0,
      pending ? '…' : tier.reward === 0 ? 'BEGUN ✓' : tier.claimed ? 'CLAIMED ✓' : claimable ? 'CLAIM' : 'LOCKED', {
        fontFamily: FONT_FAMILY, fontSize: '11px', fontStyle: '900',
        color: tier.claimed ? '#fde68a' : claimable ? '#ffffff' : '#94a3b8',
        stroke: '#000000', strokeThickness: 1.5, resolution: 2,
      }).setOrigin(0.5);
    if (claimable && !pending && this.pendingRankId === null) {
      button.setInteractive({ useHandCursor: true });
      this.bindPressFeedback(button, buttonText);
      button.on('pointerdown', () => void this.claimReward(tier.rankId));
    }
    row.add([card, node, badge, name, requirement, button, buttonText]);
    if (!this.reducedMotion) {
      row.setAlpha(0).setX(-10);
      this.tweens.add({ targets: row, alpha: 1, x: 0, duration: 200, delay: index * 35, ease: 'Cubic.easeOut' });
    }
    return row;
  }

  private async claimReward(rankId: string): Promise<void> {
    if (this.pendingRankId) return;
    const visitId = this.visitId;
    this.pendingRankId = rankId;
    this.renderContent();
    try {
      const result = await this.careerManager.claimLeagueReward(rankId);
      if (!this.active || visitId !== this.visitId) return;
      this.state = result.state;
      this.refreshCoins();
      if (result.success) {
        if (this.careerManager.isRemoteConnected()) {
          trackEvent({ name: 'league_reward_claimed', claimId: result.claimId });
        }
        this.playClaimCelebration(result.reward);
      } else {
        this.showToast(this.failureMessage(result.reason));
      }
    } catch (error) {
      console.error('[LeagueScene] Reward claim failed:', error);
      this.platform.hapticNotification('error');
      this.showToast("Couldn't claim reward. Please try again.");
    } finally {
      if (this.active && visitId === this.visitId) {
        this.pendingRankId = null;
        this.renderContent();
      }
    }
  }

  private playClaimCelebration(reward: number): void {
    sounds.playCoin();
    this.platform.hapticNotification('success');
    const burst = this.add.container(LOGICAL_WIDTH / 2, 350).setDepth(250);
    const glow = this.add.circle(0, 0, 72, THEME.gold, 0.2);
    const text = this.add.text(0, 0, `LEAGUE BOUNTY\n+${reward} 🪙`, {
      fontFamily: FONT_FAMILY, fontSize: '20px', fontStyle: '900', color: '#fde68a',
      stroke: '#000000', strokeThickness: 4, align: 'center', resolution: 2,
    }).setOrigin(0.5);
    burst.add([glow, text]);
    if (this.reducedMotion) {
      this.time.delayedCall(900, () => burst.destroy());
      return;
    }
    burst.setScale(0.75).setAlpha(0);
    this.tweens.add({ targets: burst, scale: 1.08, alpha: 1, duration: 220, ease: 'Back.easeOut', yoyo: true, hold: 650, onComplete: () => burst.destroy() });
  }

  private refreshCoins(): void {
    this.coinText?.setText(`🪙 ${this.careerManager.getCareer().coins}`);
  }

  private failureMessage(reason?: string): string {
    if (reason === 'not_unlocked') return 'Earn more trophies to unlock this reward.';
    if (reason === 'already_claimed') return 'This league reward was already claimed.';
    return "Couldn't claim reward. Please try again.";
  }

  private showToast(message: string): void {
    this.toastText.setText(message).setAlpha(1);
    this.toastBg.setAlpha(1);
    this.tweens.killTweensOf([this.toastBg, this.toastText]);
    this.tweens.add({ targets: [this.toastBg, this.toastText], alpha: 0, duration: 300, delay: 2000 });
  }

  private closeLeague(): void {
    if (this.pendingRankId) {
      this.showToast('Finishing your reward claim…');
      return;
    }
    this.scene.start('MenuScene');
  }

  private bindPressFeedback(background: Phaser.GameObjects.Rectangle, label: Phaser.GameObjects.Text): void {
    const reset = (): void => { background.setScale(1); label.setScale(1); };
    background.on('pointerdown', () => { background.setScale(0.96); label.setScale(0.96); });
    background.on('pointerup', reset);
    background.on('pointerout', reset);
  }
}

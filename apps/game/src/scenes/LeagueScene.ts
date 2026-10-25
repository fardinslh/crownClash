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
import { THEME, UI } from '../theme.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  setupSceneCamera,
  type SceneViewport,
} from '../ui/Viewport.js';
import { computeLeagueLayout } from '../ui/HubLayouts.js';
import { createText } from '../ui/TextStyles.js';
import { createIcon, rankIcon } from '../ui/icons.js';
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
import { fa, rankName } from '../i18n/fa.js';

/** RTL: the league road runs down the right edge; rows extend to its left. */
const ROAD_X = 356;
const ROW_LEFT = 18;
const ROW_RIGHT = 330;
const ROW_HEIGHT = 58;

export class LeagueScene extends Phaser.Scene {
  private platform!: PlatformAdapter;
  private careerManager!: CareerManager;
  private state?: LeagueState;
  private content?: Phaser.GameObjects.Container;
  private background!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private coinPill?: KitPill;
  private retryButton?: KitButton;
  private summaryContainer?: Phaser.GameObjects.Container;
  private roadGraphics?: Phaser.GameObjects.Graphics;
  private tierRows: Phaser.GameObjects.Container[] = [];
  private kingdomButton?: KitButton;
  private toastY = 690;
  private pendingRankId: string | null = null;
  private active = false;
  private visitId = 0;
  private reducedMotion = false;
  private isExiting = false;
  private animatedEntrance = false;

  constructor() {
    super({ key: 'LeagueScene' });
  }

  create(): void {
    this.active = true;
    this.isExiting = false;
    this.visitId += 1;
    this.state = undefined;
    this.content = undefined;
    this.summaryContainer = undefined;
    this.roadGraphics = undefined;
    this.tierRows = [];
    this.kingdomButton = undefined;
    this.retryButton = undefined;
    this.coinPill = undefined;
    this.pendingRankId = null;
    this.animatedEntrance = false;
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
    fadeIn(this);
  }

  private buildShell(): void {
    const vp = getSceneViewport(this);
    this.background = this.add.rectangle(0, 0, 10, 10, UI.bg);
    createGlow(this, LOGICAL_WIDTH / 2, -30, vp.visibleWidth * 1.4, 280, 0x6366f1, 0.2);

    // RTL: back sits top-right, the wallet top-left.
    createBackButton(this, LOGICAL_WIDTH - 34, 38, () => this.closeLeague());
    createHeader(this, fa.league.title, fa.league.subtitle);

    this.coinPill = createPill(this, 0, 38, 'coin', '0');
    this.refreshCoins();

    this.statusText = createText(this, LOGICAL_WIDTH / 2, 0, fa.league.loading, {
      fontSize: `${UI.type.body}px`, fontStyle: '700', color: UI.text.muted,
    }).setOrigin(0.5);

    this.applyLayout(vp);
  }

  applyLayout(vp: SceneViewport): void {
    const layout = computeLeagueLayout(vp.visibleHeight);
    this.background.setPosition(LOGICAL_WIDTH / 2, vp.visibleHeight / 2).setSize(vp.visibleWidth, vp.visibleHeight);
    this.statusText.setY(layout.statusTextY);
    this.retryButton?.container.setY(layout.retryY);
    if (this.summaryContainer) this.summaryContainer.setY(layout.summaryY);
    if (this.roadGraphics) this.drawRoad(layout.tierYs);
    this.tierRows.forEach((row, index) => {
      row.setY(layout.tierYs[index]);
    });
    this.kingdomButton?.container.setY(layout.kingdomButtonY);
    this.toastY = layout.toastY;
  }

  /** Thick rounded road; the reached stretch glows in the current rank colour. */
  private drawRoad(tierYs: readonly number[]): void {
    const g = this.roadGraphics;
    if (!g || !this.state) return;
    const top = tierYs[0];
    const bottom = tierYs[tierYs.length - 1];
    const currentIndex = Math.max(0, this.state.tiers.findIndex((tier) => tier.rankId === this.state!.currentRankId));
    const reachedY = tierYs[currentIndex] ?? top;
    const color = RANK_TIERS.find((rank) => rank.id === this.state!.currentRankId)?.color ?? THEME.gold;
    g.clear();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(ROAD_X - 8, top, 16, bottom - top + 4, 8);
    g.fillStyle(UI.surface.base, 1).fillRoundedRect(ROAD_X - 7, top - 2, 14, bottom - top + 4, 7);
    g.lineStyle(1.5, UI.borderStrong, 1).strokeRoundedRect(ROAD_X - 7, top - 2, 14, bottom - top + 4, 7);
    if (reachedY > top) {
      g.fillStyle(color, 1).fillRoundedRect(ROAD_X - 4, top, 8, reachedY - top, 4);
      g.fillStyle(0xffffff, 0.3).fillRoundedRect(ROAD_X - 3, top, 2, reachedY - top, 1);
    }
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
    this.statusText.setText(fa.league.loadFailed).setColor(UI.text.danger).setVisible(true);
    this.retryButton?.container.destroy();
    let retried = false;
    this.retryButton = createButton(this, LOGICAL_WIDTH / 2, 0, {
      width: 170,
      height: 48,
      label: fa.league.retry,
      variant: 'primary',
      onPress: () => {
        if (retried) return;
        retried = true;
        this.retryButton?.container.destroy();
        this.retryButton = undefined;
        this.statusText.setText(fa.league.loading).setColor(UI.text.muted);
        void this.loadState();
      },
    });
    this.applyLayout(getSceneViewport(this));
  }

  private renderContent(): void {
    if (!this.state || !this.active) return;
    this.content?.destroy(true);
    this.content = this.add.container(0, 0);
    const progress = getLeagueProgress(this.state.trophies);
    const animate = !this.reducedMotion && !this.animatedEntrance;
    this.animatedEntrance = true;

    this.summaryContainer = this.add.container(LOGICAL_WIDTH / 2, 0);
    const rankColor = progress.current.color;
    const summaryBg = drawPanel(this.add.graphics(), 364, 92, {
      fill: UI.surface.raised, stroke: rankColor, strokeAlpha: 0.9, radius: UI.radius.lg,
    });
    const glow = createGlow(this, 146, 0, 150, 120, rankColor, 0.35);
    const badge = createIcon(this, 146, 0, rankIcon(progress.current.id), 60);
    const title = createText(this, 106, -24, rankName(progress.current.id, progress.current.name), {
      fontSize: '19px', fontStyle: '900', color: UI.text.primary, stroke: UI.text.stroke, strokeThickness: 4,
    }).setOrigin(1, 0.5);
    const power = createText(this, -166, -24, fa.league.power(this.state.kingdomPower), {
      fontSize: '12px', fontStyle: '800', color: '#c7d2fe',
    }).setOrigin(0, 0.5);
    const bar = createProgressBar(this, -30, 4, 272, 12, rankColor);
    bar.setProgress(progress.progress);
    const detail = createText(this, 106, 28,
      progress.next ? fa.league.progressNext(this.state.trophies, progress.trophiesToNext, rankName(progress.next.id, progress.next.name)) : fa.league.progressMax(this.state.trophies), {
        fontSize: '12px', fontStyle: '700', color: UI.text.muted,
      }).setOrigin(1, 0.5);
    this.summaryContainer.add([summaryBg, glow, badge, title, power, bar.graphics, detail]);
    this.content.add(this.summaryContainer);
    if (animate) {
      this.summaryContainer.setAlpha(0).setScale(0.96);
      this.tweens.add({ targets: this.summaryContainer, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
    }

    this.roadGraphics = this.add.graphics();
    this.content.add(this.roadGraphics);
    this.tierRows = [];
    this.state.tiers.forEach((tier, index) => {
      const row = this.buildTierRow(tier, 0, index, animate);
      this.tierRows.push(row);
      this.content!.add(row);
    });

    this.kingdomButton = createButton(this, LOGICAL_WIDTH / 2, 0, {
      width: 250,
      height: 48,
      label: fa.league.improveKingdom,
      icon: 'castle',
      variant: 'secondary',
      onPress: () => {
        if (this.isExiting) return;
        this.isExiting = true;
        sounds.playReinforce();
        this.platform.hapticSelection();
        goToScene(this, 'KingdomScene');
      },
    });
    this.content.add(this.kingdomButton.container);

    this.applyLayout(getSceneViewport(this));
  }

  private buildTierRow(tier: LeagueTierState, y: number, index: number, animate: boolean): Phaser.GameObjects.Container {
    const rank = RANK_TIERS.find((item) => item.id === tier.rankId)!;
    const current = this.state?.currentRankId === tier.rankId;
    const claimable = tier.unlocked && !tier.claimed && tier.reward > 0;
    const pending = this.pendingRankId === tier.rankId;
    const row = this.add.container(0, y);
    const rowWidth = ROW_RIGHT - ROW_LEFT;
    const card = drawPanel(this.add.graphics({ x: ROW_LEFT + rowWidth / 2, y: 0 }), rowWidth, ROW_HEIGHT, {
      fill: current ? UI.surface.high : UI.surface.raised,
      stroke: current ? rank.color : claimable ? UI.button.success.fill : UI.border,
      strokeAlpha: current || claimable ? 1 : 0.8,
      radius: UI.radius.md,
      alpha: tier.unlocked ? 0.98 : 0.8,
    });
    const items: Phaser.GameObjects.GameObject[] = [card];
    if (current) items.push(createGlow(this, ROAD_X, 0, 96, 96, rank.color, 0.5));
    const badge = createIcon(this, ROAD_X, 0, rankIcon(tier.rankId), current ? 48 : 38);
    if (!tier.unlocked) badge.setAlpha(0.45);
    items.push(badge);

    const textRight = ROW_RIGHT - 14;
    const name = createText(this, textRight, -12, rankName(tier.rankId, tier.name), {
      fontSize: '15px', fontStyle: '900',
      color: tier.unlocked ? UI.text.primary : UI.text.muted,
    }).setOrigin(1, 0.5);
    const requirement = createText(this, textRight - 18, 12, current ? fa.league.currentLeague : fa.league.trophies(tier.minTrophies), {
      fontSize: '12px', fontStyle: '700',
      color: current ? UI.text.accent : UI.text.muted,
    }).setOrigin(1, 0.5);
    const requirementIcon = createIcon(this, textRight - 6, 12, current ? 'star' : 'trophy', 14);
    items.push(name, requirement, requirementIcon);

    if (tier.reward > 0) {
      items.push(
        createIcon(this, 190, 0, 'coin', 20),
        createText(this, 178, 0, `+${tier.reward}`, {
          fontSize: '14px', fontStyle: '900', color: tier.claimed ? UI.text.muted : UI.text.gold,
        }).setOrigin(1, 0.5),
      );
    }

    const label = pending ? '…' : tier.reward === 0 ? fa.league.begun : tier.claimed ? fa.league.claimed : claimable ? fa.league.claim : fa.league.locked;
    const icon = !pending && (tier.claimed || tier.reward === 0) ? 'check' : !tier.unlocked ? 'lock' : undefined;
    const button = createButton(this, ROW_LEFT + 52, -1, {
      width: 92,
      height: 44,
      label,
      icon,
      variant: 'success',
      fontSize: 12,
      onPress: () => void this.claimReward(tier.rankId),
    });
    if (!(claimable && !pending && this.pendingRankId === null)) button.setEnabled(false);
    items.push(button.container);

    row.add(items);
    if (animate) {
      row.setAlpha(0).setX(14);
      this.tweens.add({ targets: row, alpha: 1, x: 0, duration: 220, delay: 80 + index * 40, ease: 'Cubic.easeOut' });
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
      this.showToast(fa.league.claimFailed);
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
    const { visibleHeight } = getSceneViewport(this);
    showRewardBurst(this, LOGICAL_WIDTH / 2, visibleHeight * 0.46, reward, {
      title: fa.league.bounty,
      reducedMotion: this.reducedMotion,
    });
  }

  private refreshCoins(): void {
    if (!this.coinPill) return;
    this.coinPill.setText(`${this.careerManager.getCareer().coins}`);
    anchorPillLeft(this.coinPill, 16);
  }

  private failureMessage(reason?: string): string {
    if (reason === 'not_unlocked') return fa.league.notUnlocked;
    if (reason === 'already_claimed') return fa.league.alreadyClaimed;
    return fa.league.claimFailed;
  }

  private showToast(message: string): void {
    // Lifted off the layout anchor so the pill clears the screen's bottom edge.
    showToast(this, message, { y: this.toastY - 14, tone: 'error', reducedMotion: this.reducedMotion });
  }

  private closeLeague(): void {
    if (this.isExiting) return;
    if (this.pendingRankId) {
      this.showToast(fa.league.finishingClaim);
      return;
    }
    this.isExiting = true;
    goToScene(this, 'MenuScene');
  }
}

import Phaser from 'phaser';
import {
  BattlefieldId,
  BotMatchTicket,
  calculateDispatchUnits,
  CombatResult,
  createInitialGameState,
  dispatchArmy,
  dispatchMultipleArmies,
  consumeSimulationTicks,
  evaluateAiMove,
  GameState,
  getBattlefield,
  getPlayerUpgradeModifiers,
  getLeagueProgress,
  getUpgradeCardViewModel,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MarchingArmy,
  MatchSettlement,
  MatchStats,
  MAX_PVP_ACTIONS,
  PVP_AI_TICK_SECONDS,
  PVP_SIMULATION_TICK_SECONDS,
  PvpAction,
  stepSimulation,
  TERRITORY_TYPE_PRESENTATION,
  Territory,
  Team,
  UpgradeType,
} from '@crown-clash/game-core';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { CareerManager } from '../career/CareerManager.js';
import {
  trackEvent,
  trackTerminalMatchEvent,
  trackUpgradeEvent,
} from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';
import { THEME } from '../theme.js';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';
import { LiveMatchClient, LiveMatchResult, LiveMatchStarted } from '../api/LiveMatchClient.js';
import {
  shouldActivateStressMode,
  canInitiateBotSettlement,
  canFinalizeBotSettlement,
  processLiveMatchResult,
} from './gameSceneGuards.js';
import { purchaseUpgradeThroughCareer } from '../upgrades/UpgradePurchaseController.js';
import { playUpgradeMilestoneCelebration } from '../upgrades/UpgradeMilestoneCelebration.js';
import {
  applyPendingLiveDispatches,
  deriveLiveCombatArrivals,
  rejectLivePrediction,
  reconcileLiveArmies,
  stepLiveArmies,
  type PendingLiveDispatch,
} from '../combat/LiveCombatFeedback.js';
import { wholeMatchSeconds } from '../match/MatchPresentation.js';
import {
  MatchMenuController,
  type MatchMenuState,
} from '../match/MatchMenuController.js';
import {
  computeHudLayout,
  formatHudCoins,
  formatHudName,
  formatHudTrophies,
  getPillMaxContentWidth,
} from '../ui/HudLayout.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  setupSceneCamera,
} from '../ui/Viewport.js';
import {
  computeMarchStride,
  createStrideMetrics,
  fastComputeDominance,
  DominanceBarDirtyChecker,
  DustPuffSimulator,
} from '../combat/SmoothnessHelpers.js';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_FONT_FAMILY = '"Segoe UI", monospace, -apple-system, sans-serif';

interface TerritoryVisual {
  territory: Territory;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  basePlate: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  unitBadge: Phaser.GameObjects.Rectangle;
  unitText: Phaser.GameObjects.Text;
  typeText: Phaser.GameObjects.Text;
  lastOwner?: Team;
  lastUnits?: number;
}

interface ArmyFollower {
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  relX: number;
  relY: number;
  delaySeconds: number;
}

interface ArmyVisual {
  id: string;
  container: Phaser.GameObjects.Container;
  leaderSprite: Phaser.GameObjects.Image;
  leaderShadow: Phaser.GameObjects.Ellipse;
  badgeBg: Phaser.GameObjects.Rectangle;
  badgeText: Phaser.GameObjects.Text;
  followers: ArmyFollower[];
  rearOffset: { x: number; y: number };
  dustTimer: number;
  dustInterval: number;
  dustColor: number;
  roleLabel: string;
  phaseSeconds: number;
}

export class GameScene extends Phaser.Scene {
  private gameState!: GameState;
  private accumulators: Record<string, number> = {};
  private territoryVisuals: Map<string, TerritoryVisual> = new Map();
  private armyVisuals: Map<string, ArmyVisual> = new Map();

  // Performance optimization state
  private dustSimulator = new DustPuffSimulator(16);
  private dustPool: Phaser.GameObjects.Arc[] = [];
  private activeArmyIdsSet = new Set<string>();
  private dominanceDirtyChecker = new DominanceBarDirtyChecker();
  private sharedStrideMetrics = createStrideMetrics();
  private lastTimerSeconds = -1;
  private territoriesDirty = true;
  private lastTerritorySignature = 0;
  public isStressMode = false;

  // Interaction / Multi-Select Dragging
  private selectedSourceIds: string[] = [];
  private hoveredTargetId: string | null = null;
  private lastHoveredFriendlyId: string | null = null;
  private pointerWorldPoint = new Phaser.Math.Vector2();
  private dragGraphics!: Phaser.GameObjects.Graphics;
  private selectionRings: Map<string, Phaser.GameObjects.Arc> = new Map();
  private dragBadgeContainer!: Phaser.GameObjects.Container;
  private dragBadgeShadow!: Phaser.GameObjects.Rectangle;
  private dragBadgeBg!: Phaser.GameObjects.Rectangle;
  private dragBadgeText!: Phaser.GameObjects.Text;
  private reducedMotion = false;

  // Local AI: fixed match-time tick grid so the client prediction stays as
  // close as possible to the server's authoritative bot replay.
  private aiNextTick = PVP_AI_TICK_SECONDS;
  private botStepRemainder = 0;

  // Recorded dispatch intents replayed server-side for settlement.
  private matchActions: PvpAction[] = [];

  // UI HUD Elements (Clean Glassmorphic Command Console)
  private timerText!: Phaser.GameObjects.Text;
  private playerBar!: Phaser.GameObjects.Rectangle;
  private enemyBar!: Phaser.GameObjects.Rectangle;
  private neutralBar!: Phaser.GameObjects.Rectangle;
  private playerDomText!: Phaser.GameObjects.Text;
  private enemyDomText!: Phaser.GameObjects.Text;
  private tugCrown!: Phaser.GameObjects.Text;
  private bottomHintText!: Phaser.GameObjects.Text;
  private hudCoinsText!: Phaser.GameObjects.Text;
  private hudTrophiesText!: Phaser.GameObjects.Text;
  private dominanceBarTotalWidth = 350;
  private dominanceBarStartX = 25;

  // Career & Economy
  private careerManager!: CareerManager;
  private careerSubscription?: () => void;
  private playerArmySpeedMultiplier = 1;
  private activeMatchId = '';
  private battlefieldId: BattlefieldId = 'crown_cross';
  private backendConnectPromise: Promise<void> | null = null;
  private resultPending = false;
  private liveMode = false;
  private liveClient?: LiveMatchClient;
  private liveOpponentName = 'Opponent';
  private liveUnsubscribers: Array<() => void> = [];
  private livePredictions: PendingLiveDispatch[] = [];
  private lastAuthoritativeState: GameState | null = null;

  private enemyArmySpeedMultiplier = 1;

  // Result Modal
  private resultModalContainer?: Phaser.GameObjects.Container;
  private syncingModalContainer?: Phaser.GameObjects.Container;
  private settledMatchId?: string;

  // Match Menu & Navigation
  private matchMenuController!: MatchMenuController;
  private matchMenuModalContainer?: Phaser.GameObjects.Container;
  private isExiting = false;

  // Platform Adapter
  private platform!: PlatformAdapter;
  private lifecycleUnsubscribers: Array<() => void> = [];

  // Audio Atmosphere Tension
  private lastHeartbeatSecond: number = -1;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // Load 2.5D Rendered Territory Sprites
    this.load.image('outpost_neutral', 'assets/territories/outpost_neutral.png');
    this.load.image('outpost_player', 'assets/territories/outpost_player.png');
    this.load.image('outpost_enemy', 'assets/territories/outpost_enemy.png');
    this.load.image('crown_keep_neutral', 'assets/territories/crown_keep_neutral.png');
    this.load.image('crown_keep_player', 'assets/territories/crown_keep_player.png');
    this.load.image('crown_keep_enemy', 'assets/territories/crown_keep_enemy.png');
    this.load.image('citadel_player', 'assets/territories/citadel_player.png');
    this.load.image('citadel_enemy', 'assets/territories/citadel_enemy.png');

    // Load 2.5D Rendered Army Unit Sprites
    this.load.image('unit_leader_player', 'assets/units/unit_leader_player.png');
    this.load.image('unit_leader_enemy', 'assets/units/unit_leader_enemy.png');
    this.load.image('unit_follower_player', 'assets/units/unit_follower_player.png');
    this.load.image('unit_follower_enemy', 'assets/units/unit_follower_enemy.png');
  }

  create(): void {
    setupSceneCamera(this);
    bindSceneViewportResize(this);
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    const user = this.platform.getUser();
    this.careerManager = CareerManager.getInstance(user.id);
    const launchData = this.scene.settings.data as {
      source?: 'menu' | 'rematch';
      mode?: 'bot' | 'live';
      liveClient?: LiveMatchClient;
      liveMatch?: LiveMatchStarted;
      botMatch?: BotMatchTicket;
    } | undefined;
    this.liveMode = launchData?.mode === 'live';
    this.liveClient = launchData?.liveClient;
    this.liveOpponentName =
      launchData?.liveMatch?.opponentName || 'Opponent';
    const searchParams =
      typeof window !== 'undefined' && window.location?.search
        ? new URLSearchParams(window.location.search)
        : null;
    const isDebugPerformance = searchParams?.get('debug_performance') === '1';
    const isStressParam = searchParams?.get('stress_armies') === '1';
    const isRegistryStress = Boolean(this.registry?.get('qa_stress_mode'));
    const isLaunchStress = Boolean((launchData as any)?.stressMode);
    const requestedQaStress = isStressParam || isRegistryStress || isLaunchStress;

    // DUAL-GATING: stress mode STRICTLY requires debug_performance=1, requested QA stress, and !liveMode.
    this.isStressMode = shouldActivateStressMode({
      isDebugPerformance,
      requestedQaStress,
      liveMode: this.liveMode,
    });

    if (!this.liveMode && !launchData?.botMatch) {
      if (this.isStressMode) {
        // Disposable isolated offline QA match ticket: does not consume server bot ticket or leave unsettled DB records
        this.activeMatchId = 'qa_stress_isolated_' + Date.now();
        this.battlefieldId = 'crown_cross';
      } else {
        console.error('[GameScene] Missing server-issued bot match ticket');
        this.scene.start('MenuScene');
        return;
      }
    } else {
      this.activeMatchId = launchData?.botMatch?.matchId ?? '';
      this.battlefieldId = launchData?.botMatch?.battlefieldId ?? 'crown_cross';
    }
    this.matchActions = [];
    this.liveUnsubscribers = [];
    this.livePredictions = [];
    this.lifecycleUnsubscribers = [];
    const unpause = this.platform.on('appPaused', () => {
      sounds.stopBattleMusic();
    });
    const unresume = this.platform.on('appResumed', () => {
      if (this.gameState?.status === 'playing' && !sounds.isMuted()) {
        sounds.startBattleMusic();
      }
      this.markTerritoriesDirty();
    });
    this.lifecycleUnsubscribers.push(unpause, unresume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.platform.hideBackButton();
      this.cleanup();
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.platform.hideBackButton();
      this.cleanup();
    });
    this.backendConnectPromise = !this.liveMode
      ? this.careerManager
          .connect(this.platform)
          .then(() => undefined)
          .catch((error: unknown) => {
            console.warn('[GameScene] Backend unavailable, using local career cache:', error);
          })
      : Promise.resolve();
    this.createUpgradedMatchState();
    if (this.liveMode && launchData?.liveMatch) {
      this.gameState = launchData.liveMatch.state;
      this.lastAuthoritativeState = launchData.liveMatch.state;
      this.activeMatchId = launchData.liveMatch.matchId;
      this.battlefieldId = launchData.liveMatch.state.battlefieldId ?? 'crown_cross';
    }
    this.isExiting = false;
    this.matchMenuController = new MatchMenuController({
      liveMode: this.liveMode,
      matchId: this.activeMatchId,
      getDurationSeconds: () => wholeMatchSeconds(this.gameState?.elapsedTimeSeconds ?? 0),
      closeLiveClient: () => {
        if (this.liveClient) {
          this.liveClient.close();
          this.liveClient = undefined;
        }
      },
      trackQuit: (event) => trackTerminalMatchEvent(event),
      trackAnalytics: (event) => trackEvent(event),
      onStateChange: (state) => this.handleMatchMenuStateChange(state),
      onExitConfirmed: () => this.handleMatchExitConfirmed(),
      isModalVisible: () =>
        Boolean(
          this.matchMenuModalContainer &&
            this.matchMenuModalContainer.active &&
            this.matchMenuModalContainer.visible
        ),
    });
    this.platform.showBackButton(() => {
      if (this.isExiting) return;
      if (this.resultModalContainer || this.syncingModalContainer) {
        this.returnToMenu();
        return;
      }
      this.matchMenuController.handleBackButton();
    });
    trackEvent({
      name: 'match_start',
      matchId: this.activeMatchId,
      mode: this.liveMode ? 'live' : 'bot',
      source: launchData?.source ?? 'menu',
      battlefieldId: this.battlefieldId,
    });
    if (this.liveMode && launchData?.liveMatch) {
      this.bindLiveMatch(this.liveClient);
    }
    this.accumulators = {};
    for (const vis of this.territoryVisuals.values()) {
      vis.container.destroy();
    }
    this.territoryVisuals.clear();
    for (const vis of this.armyVisuals.values()) {
      vis.container.destroy();
    }
    this.armyVisuals.clear();
    this.selectedSourceIds = [];
    this.hoveredTargetId = null;
    this.lastHoveredFriendlyId = null;
    this.selectionRings.clear();
    this.aiNextTick = PVP_AI_TICK_SECONDS;
    this.botStepRemainder = 0;
    this.lastHeartbeatSecond = -1;
    this.initDustPool();
    this.dominanceDirtyChecker.reset();
    this.lastTimerSeconds = -1;
    this.territoriesDirty = true;

    // Start atmospheric battle music
    sounds.startBattleMusic();

    // 1. Draw Arena Background & Connecting Lanes
    this.createArenaBackground();

    // 2. Drag & selection graphics
    this.dragGraphics = this.add.graphics().setDepth(50);

    // Live Drag Badge preview
    this.dragBadgeContainer = this.add.container(0, 0).setDepth(55).setVisible(false);
    this.dragBadgeShadow = this.add.rectangle(0, 3, 100, 28, 0x000000, 0.32);
    this.dragBadgeBg = this.add
      .rectangle(0, 0, 96, 26, 0x070d1a, 0.96)
      .setStrokeStyle(2, THEME.teams.player.primary, 1);
    this.dragBadgeText = this.add
      .text(0, 0, '⚔ 10', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.dragBadgeContainer.add([this.dragBadgeShadow, this.dragBadgeBg, this.dragBadgeText]);

    // 3. Build Territory Visuals
    this.createTerritoryObjects();

    // 4. Create HUD
    this.createHud();

    // Compact, non-blocking reveal: enough context to notice the map without
    // covering towers or delaying input.
    this.showBattlefieldReveal();

    // 5. Setup Pointer Input Listeners
    this.setupInputs();
  }

  private initDustPool(): void {
    for (const arc of this.dustPool) {
      arc.destroy();
    }
    this.dustPool = [];
    this.dustSimulator.reset();
    for (let i = 0; i < 16; i++) {
      const arc = this.add.circle(0, 0, 3, 0xffffff, 0).setDepth(33).setVisible(false);
      this.dustPool.push(arc);
    }
  }

  private createArenaBackground(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);

    this.add
      .rectangle(
        visibleWidth / 2,
        visibleHeight / 2,
        visibleWidth,
        visibleHeight,
        0x060a13
      )
      .setDepth(0);

    // Broad team-colored light pools make the two fronts readable without
    // competing with the territory ownership colors.
    this.add
      .ellipse(visibleWidth / 2, 112, 470, 260, THEME.teams.enemy.dark, 0.12)
      .setDepth(0);
    this.add
      .ellipse(visibleWidth / 2, visibleHeight - 70, 500, 290, THEME.teams.player.dark, 0.14)
      .setDepth(0);

    const fieldGraphics = this.add.graphics().setDepth(1);
    fieldGraphics.fillStyle(0x101827, 0.42);
    fieldGraphics.fillRoundedRect(10, 78, visibleWidth - 20, visibleHeight - 98, 18);

    // Subtle command-grid structure adds scale and keeps the empty arena from
    // looking like a flat color fill.
    fieldGraphics.lineStyle(1, 0x334155, 0.12);
    for (let x = 28; x < visibleWidth; x += 36) {
      fieldGraphics.lineBetween(x, 88, x, visibleHeight - 30);
    }
    for (let y = 94; y < visibleHeight - 28; y += 36) {
      fieldGraphics.lineBetween(18, y, visibleWidth - 18, y);
    }

    const lanesGraphics = this.add.graphics().setDepth(2);

    const connections: [string, string][] = [
      ['p_base', 'n_bot_left'],
      ['p_base', 'n_center'],
      ['p_base', 'n_bot_right'],
      ['n_bot_left', 'n_mid_left'],
      ['n_bot_right', 'n_mid_right'],
      ['n_mid_left', 'n_center'],
      ['n_mid_right', 'n_center'],
      ['n_mid_left', 'n_top_left'],
      ['n_mid_right', 'n_top_right'],
      ['n_center', 'e_base'],
      ['n_top_left', 'e_base'],
      ['n_top_right', 'e_base'],
      ['n_bot_left', 'n_center'],
      ['n_bot_right', 'n_center'],
      ['n_top_left', 'n_center'],
      ['n_top_right', 'n_center'],
    ];

    const terrs = this.gameState.territories;

    // Recessed tactical roads: shadow, stone surface, then dotted center inlay.
    lanesGraphics.lineStyle(18, 0x020617, 0.58);
    connections.forEach(([idA, idB]) => {
      const a = terrs[idA];
      const b = terrs[idB];
      if (a && b) {
        lanesGraphics.lineBetween(a.x, a.y, b.x, b.y);
      }
    });

    lanesGraphics.lineStyle(12, 0x111c2d, 0.94);
    connections.forEach(([idA, idB]) => {
      const a = terrs[idA];
      const b = terrs[idB];
      if (a && b) {
        lanesGraphics.lineBetween(a.x, a.y, b.x, b.y);
      }
    });

    lanesGraphics.fillStyle(0x64748b, 0.22);
    connections.forEach(([idA, idB]) => {
      const a = terrs[idA];
      const b = terrs[idB];
      if (!a || !b) return;
      const distance = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      const dotCount = Math.max(1, Math.floor(distance / 22));
      for (let index = 1; index < dotCount; index++) {
        const progress = index / dotCount;
        lanesGraphics.fillCircle(
          Phaser.Math.Linear(a.x, b.x, progress),
          Phaser.Math.Linear(a.y, b.y, progress),
          1.25
        );
      }
    });

    // Ground sockets visually anchor the rendered 2.5D buildings.
    Object.values(terrs).forEach((t) => {
      lanesGraphics.fillStyle(0x050a12, 0.96);
      lanesGraphics.fillCircle(t.x, t.y + 3, t.radius + 10);
      lanesGraphics.lineStyle(2, 0x334155, 0.72);
      lanesGraphics.strokeCircle(t.x, t.y + 3, t.radius + 10);
      lanesGraphics.lineStyle(1, 0x94a3b8, 0.18);
      lanesGraphics.strokeCircle(t.x, t.y + 3, t.radius + 5);
    });

    const centerTerr = terrs['n_center'];
    if (centerTerr) {
      lanesGraphics.lineStyle(1.5, THEME.gold, 0.28);
      lanesGraphics.strokeCircle(centerTerr.x, centerTerr.y, 58);
      lanesGraphics.lineStyle(1, THEME.gold, 0.12);
      lanesGraphics.strokeCircle(centerTerr.x, centerTerr.y, 68);
    }

    const border = this.add.graphics().setDepth(3);
    border.lineStyle(1.5, 0x475569, 0.66);
    border.strokeRoundedRect(8, 76, LOGICAL_WIDTH - 16, LOGICAL_HEIGHT - 128, 16);
    border.lineStyle(3, THEME.gold, 0.58);
    const cornerLength = 22;
    const left = 12;
    const right = LOGICAL_WIDTH - 12;
    const top = 80;
    const bottom = LOGICAL_HEIGHT - 56;
    border.lineBetween(left, top + cornerLength, left, top);
    border.lineBetween(left, top, left + cornerLength, top);
    border.lineBetween(right - cornerLength, top, right, top);
    border.lineBetween(right, top, right, top + cornerLength);
    border.lineBetween(left, bottom - cornerLength, left, bottom);
    border.lineBetween(left, bottom, left + cornerLength, bottom);
    border.lineBetween(right - cornerLength, bottom, right, bottom);
    border.lineBetween(right, bottom, right, bottom - cornerLength);
  }

  private createTerritoryObjects(): void {
    Object.values(this.gameState.territories).forEach((territory, index) => {
      const container = this.add.container(territory.x, territory.y).setDepth(20);

      const teamStyle = THEME.teams[territory.owner];

      const groundShadow = this.add.ellipse(
        0,
        territory.radius * 0.5,
        territory.radius * 2.2,
        territory.radius * 0.78,
        0x000000,
        0.5
      );

      const basePlate = this.add
        .circle(0, 4, territory.radius + 7, 0x09111e, 0.98)
        .setStrokeStyle(2, teamStyle.dark, 0.95);

      const ring = this.add
        .circle(0, 4, territory.radius + 10, teamStyle.glow, 0.12)
        .setStrokeStyle(2.5, teamStyle.primary, 0.92);

      // 2.5D Rendered Fortress Sprite
      const textureKey = this.getTerritoryTextureKey(territory);
      const spriteSize = territory.tier === 3 ? 92 : territory.tier === 2 ? 80 : 66;
      const sprite = this.add.image(0, -8, textureKey).setDisplaySize(spriteSize, spriteSize);

      // Unit Count Badge Pill
      const badgeY = territory.tier === 3 ? 25 : territory.tier === 2 ? 21 : 17;
      const badgeWidth = territory.tier === 3 ? 46 : territory.tier === 2 ? 42 : 38;
      const unitBadge = this.add
        .rectangle(0, badgeY, badgeWidth, 22, 0x070d1a, 0.96)
        .setStrokeStyle(1.5, teamStyle.primary, 1);

      // Unit Count Text with resolution: 2 and bold stroke for retina sharpness
      const unitText = this.add
        .text(0, badgeY, territory.units.toString(), {
          fontFamily: MONO_FONT_FAMILY,
          fontSize: territory.tier === 3 ? '15px' : '14px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
          resolution: 2,
        })
        .setOrigin(0.5);

      const typeStyle = TERRITORY_TYPE_PRESENTATION[territory.type];
      const typeText = this.add
        .text(0, badgeY + 18, typeStyle.label, {
          fontFamily: MONO_FONT_FAMILY,
          fontSize: '9px',
          fontStyle: 'bold',
          color: `#${typeStyle.color.toString(16).padStart(6, '0')}`,
          backgroundColor: '#070d1a',
          padding: { x: 3, y: 1 },
          resolution: 2,
        })
        .setOrigin(0.5);

      container.add([groundShadow, ring, basePlate, sprite, unitBadge, unitText, typeText]);

      // Make interactive for touch / click
      container.setSize(territory.radius * 2.5, territory.radius * 2.5);
      container.setInteractive({ useHandCursor: true });

      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.isExiting || this.matchMenuController?.isOpen()) return;
        this.startDragFromTerritory(territory.id, pointer);
      });

      this.territoryVisuals.set(territory.id, {
        territory,
        container,
        sprite,
        basePlate,
        ring,
        unitBadge,
        unitText,
        typeText,
        lastOwner: territory.owner,
        lastUnits: territory.units,
      });

      if (!this.reducedMotion) {
        container.setScale(0.82).setAlpha(0);
        this.tweens.add({
          targets: container,
          scale: 1,
          alpha: 1,
          duration: 260,
          delay: 50 + index * 42,
          ease: 'Back.easeOut',
        });
        this.tweens.add({
          targets: sprite,
          y: -10,
          duration: 1500 + index * 45,
          delay: 320 + index * 70,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    });
    this.markTerritoriesDirty();
    this.lastTerritorySignature = this.computeTerritorySignature();
  }

  private createHud(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);

    // Compute player HUD label width for dynamic pill sizing
    const playerLabelCandidate = this.computePlayerHudLabel();
    const tempText = this.add.text(0, 0, playerLabelCandidate, {
      fontFamily: FONT_FAMILY,
      fontSize: '11px',
      fontStyle: 'bold',
      resolution: 2,
    }).setVisible(false);
    const textWidth = Math.ceil(tempText.width);
    tempText.destroy();

    const hudLayout = computeHudLayout(visibleWidth, textWidth, { isLiveMode: this.liveMode });
    this.dominanceBarTotalWidth = hudLayout.dominanceBar.trackWidth;
    this.dominanceBarStartX = hudLayout.dominanceBar.bounds.x;

    // 1. Header Glass Panel Bar (y: 0 to 70)
    this.add
      .rectangle(visibleWidth / 2, 39, visibleWidth, 74, 0x000000, 0.36)
      .setDepth(89);

    this.add
      .rectangle(visibleWidth / 2, 35, visibleWidth, 70, 0x090f1d, 0.96)
      .setDepth(90);

    this.add
      .rectangle(visibleWidth / 2, 70, visibleWidth, 1.5, 0x1e293b, 1)
      .setDepth(91);
    this.add
      .rectangle(visibleWidth / 4, 70, visibleWidth / 2, 1.5, THEME.teams.player.primary, 0.58)
      .setDepth(92);
    this.add
      .rectangle(
        (visibleWidth * 3) / 4,
        70,
        visibleWidth / 2,
        1.5,
        THEME.teams.enemy.primary,
        0.58
      )
      .setDepth(92);

    // 2. Top Row (y: 20): Profile, Trophies, Coins, Clock, and Audio
    const career = this.careerManager.getCareer();

    // Left: Player Profile Pill with dynamic sizing
    this.add
      .rectangle(
        hudLayout.playerPill.center.x,
        hudLayout.playerPill.center.y,
        hudLayout.playerPill.visibleBounds.width,
        hudLayout.playerPill.visibleBounds.height,
        0x0f172a,
        0.95
      )
      .setStrokeStyle(1.5, 0x3b82f6, 0.9)
      .setDepth(95);

    const playerMaxW = getPillMaxContentWidth(hudLayout.playerPill.visibleBounds.width);
    const playerLabel = this.computePlayerHudLabel(playerMaxW);

    this.add
      .text(hudLayout.playerPill.center.x, hudLayout.playerPill.center.y, playerLabel, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#93c5fd',
        stroke: '#030712',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96);

    // Trophies Pill
    this.add
      .rectangle(
        hudLayout.trophyPill.center.x,
        hudLayout.trophyPill.center.y,
        hudLayout.trophyPill.visibleBounds.width,
        hudLayout.trophyPill.visibleBounds.height,
        0x0f172a,
        0.95
      )
      .setStrokeStyle(1.5, 0x818cf8, 0.9)
      .setDepth(95);

    const trophyMaxW = getPillMaxContentWidth(hudLayout.trophyPill.visibleBounds.width);
    this.hudTrophiesText = this.add
      .text(
        hudLayout.trophyPill.center.x,
        hudLayout.trophyPill.center.y,
        formatHudTrophies(career.trophies, trophyMaxW),
        {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#c7d2fe',
          stroke: '#030712',
          strokeThickness: 2,
          resolution: 2,
        }
      )
      .setOrigin(0.5)
      .setDepth(96);

    // Gold Coins Pill (or Live Opponent Pill in Live PvP)
    this.add
      .rectangle(
        hudLayout.coinPill.center.x,
        hudLayout.coinPill.center.y,
        hudLayout.coinPill.visibleBounds.width,
        hudLayout.coinPill.visibleBounds.height,
        this.liveMode ? 0x1e1520 : 0x0f172a,
        0.95
      )
      .setStrokeStyle(1.5, this.liveMode ? 0xf87171 : 0xf59e0b, 0.9)
      .setDepth(95);

    const coinMaxW = getPillMaxContentWidth(hudLayout.coinPill.visibleBounds.width);
    const coinOrOpponentLabel = this.liveMode
      ? formatHudName(this.liveOpponentName, coinMaxW, '🔴 ')
      : formatHudCoins(career.coins, coinMaxW);

    this.hudCoinsText = this.add
      .text(
        hudLayout.coinPill.center.x,
        hudLayout.coinPill.center.y,
        coinOrOpponentLabel,
        {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          fontStyle: 'bold',
          color: this.liveMode ? '#fca5a5' : '#fef08a',
          stroke: '#030712',
          strokeThickness: 2,
          resolution: 2,
        }
      )
      .setOrigin(0.5)
      .setDepth(96);

    // Royal Match Clock Pill
    this.add
      .rectangle(
        hudLayout.clockPill.center.x,
        hudLayout.clockPill.center.y,
        hudLayout.clockPill.visibleBounds.width,
        hudLayout.clockPill.visibleBounds.height,
        0x111827,
        0.95
      )
      .setStrokeStyle(1.5, 0xf59e0b, 0.9)
      .setDepth(95);

    this.timerText = this.add
      .text(
        hudLayout.clockPill.center.x,
        hudLayout.clockPill.center.y,
        '⏱ 01:30',
        {
          fontFamily: MONO_FONT_FAMILY,
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#fbbf24',
          stroke: '#030712',
          strokeThickness: 2,
          resolution: 2,
        }
      )
      .setOrigin(0.5)
      .setDepth(96);

    // Right: Match Menu Button
    // Compact visible button (36x26) centered at (visibleWidth - 25, 20) with >= 44x44 touch hit zone
    const menuBtnX = hudLayout.menuButton.center.x;
    const menuBtnY = hudLayout.menuButton.center.y;
    const menuVisW = hudLayout.menuButton.visibleBounds.width;
    const menuVisH = hudLayout.menuButton.visibleBounds.height;
    const menuHitW = hudLayout.menuButton.hitBounds.width;
    const menuHitH = hudLayout.menuButton.hitBounds.height;

    const menuBg = this.add
      .rectangle(menuBtnX, menuBtnY, menuVisW, menuVisH, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.9)
      .setDepth(95);

    const menuIcon = this.add.graphics().setDepth(96);
    menuIcon.setPosition(menuBtnX, menuBtnY);
    menuIcon.lineStyle(2, 0xf8fafc, 0.95);
    menuIcon.beginPath();
    menuIcon.moveTo(-7, -5);
    menuIcon.lineTo(7, -5);
    menuIcon.moveTo(-7, 0);
    menuIcon.lineTo(7, 0);
    menuIcon.moveTo(-7, 5);
    menuIcon.lineTo(7, 5);
    menuIcon.strokePath();

    // 44x44 interactive zone guarantees >= 44x44 touch target strictly aligned with icon and button
    const menuHit = this.add
      .zone(menuBtnX, menuBtnY, menuHitW, menuHitH)
      .setInteractive({ useHandCursor: true })
      .setDepth(97);

    menuHit.on('pointerdown', () => {
      if (this.resultModalContainer || this.isExiting) return;
      this.platform.hapticSelection();
      this.matchMenuController.openMenu();
    });
    this.bindPressFeedback(menuHit, menuIcon, menuBg);

    // Auto-update HUD when career balance changes (bot battles only for coins)
    this.careerSubscription = this.careerManager.subscribe((updatedCareer) => {
      if (this.hudCoinsText && this.hudCoinsText.active && !this.liveMode) {
        const coinPillMaxW = getPillMaxContentWidth(hudLayout.coinPill.visibleBounds.width);
        this.hudCoinsText.setText(formatHudCoins(updatedCareer.coins, coinPillMaxW));
      }
      if (this.hudTrophiesText && this.hudTrophiesText.active) {
        const trophyPillMaxW = getPillMaxContentWidth(hudLayout.trophyPill.visibleBounds.width);
        this.hudTrophiesText.setText(formatHudTrophies(updatedCareer.trophies, trophyPillMaxW));
      }
    });

    // 3. Row 2 (y: 50): The Dynamic Tug-of-War Dominance Bar
    const barTotalWidth = hudLayout.dominanceBar.trackWidth;
    const barHeight = hudLayout.dominanceBar.trackHeight;
    const barY = hudLayout.dominanceBar.center.y;
    const barStartX = hudLayout.dominanceBar.bounds.x;

    // Dominance Bar Track Background
    this.add
      .rectangle(hudLayout.dominanceBar.center.x, barY, barTotalWidth, barHeight, 0x0b1120, 1)
      .setStrokeStyle(1, 0x1e293b, 1)
      .setDepth(92);

    this.playerBar = this.add
      .rectangle(barStartX, barY, barTotalWidth / 3, barHeight - 2, THEME.teams.player.primary, 0.95)
      .setOrigin(0, 0.5)
      .setDepth(93);

    this.neutralBar = this.add
      .rectangle(barStartX + barTotalWidth / 3, barY, barTotalWidth / 3, barHeight - 2, 0x334155, 0.8)
      .setOrigin(0, 0.5)
      .setDepth(93);

    this.enemyBar = this.add
      .rectangle(barStartX + (barTotalWidth / 3) * 2, barY, barTotalWidth / 3, barHeight - 2, THEME.teams.enemy.primary, 0.95)
      .setOrigin(0, 0.5)
      .setDepth(93);

    // Live Score Badges at Left & Right of Dominance Bar
    this.playerDomText = this.add
      .text(barStartX + 6, barY, '33%', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#030712',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(0, 0.5)
      .setDepth(96);

    this.enemyDomText = this.add
      .text(barStartX + barTotalWidth - 6, barY, '33%', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#030712',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(1, 0.5)
      .setDepth(96);

    // The Tug-of-War Crown Needle!
    this.tugCrown = this.add
      .text(hudLayout.dominanceBar.center.x, barY - 1, '👑', {
        fontSize: '14px',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(98);

    // 4. Bottom Tactical Control Hint Bar
    const bottomBarY = Math.max(691, visibleHeight - 28);
    this.add
      .rectangle(visibleWidth / 2, bottomBarY + 3, Math.min(364, visibleWidth - 36), 42, 0x000000, 0.34)
      .setDepth(94);
    this.add
      .rectangle(visibleWidth / 2, bottomBarY, Math.min(360, visibleWidth - 40), 40, 0x090f1d, 0.94)
      .setStrokeStyle(1.5, 0x334155, 0.92)
      .setDepth(95);

    this.add
      .text(visibleWidth / 2, bottomBarY - 9, 'DEF shields  •  PROD trains  •  SPD marches', {
        fontFamily: MONO_FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#f8c76a',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96);

    const initialHint = this.liveMode
      ? `⚔ Live battle vs ${this.formatShortName(this.liveOpponentName, 12)}`
      : '⚔ Drag across towers to attack or reinforce';
    this.bottomHintText = this.add
      .text(visibleWidth / 2, bottomBarY + 10, initialHint, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: this.liveMode ? '#93c5fd' : '#cbd5e1',
        stroke: '#030712',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96);
  }

  private computePlayerHudLabel(maxContentWidth?: number): string {
    const rawName = this.platform.getUser().username || this.platform.getUser().firstName || 'Commander';
    if (maxContentWidth !== undefined) {
      return formatHudName(rawName, maxContentWidth, '🔵 ');
    }
    return `🔵 ${this.formatShortName(rawName, 7)}`;
  }

  private formatShortName(name: string, maxLen = 8): string {
    if (!name) return 'Player';
    const trimmed = name.trim();
    let candidate = trimmed;
    if (trimmed.startsWith('Commander_')) {
      candidate = 'Cmdr ' + (trimmed.slice(10, 14) || trimmed.slice(10));
    }
    if (candidate.length > maxLen) {
      return candidate.slice(0, maxLen - 1) + '…';
    }
    return candidate;
  }

  private getTerritoryUnderPointer(pointer: Phaser.Input.Pointer): Territory | null {
    pointer.positionToCamera(this.cameras.main, this.pointerWorldPoint);
    let closest: Territory | null = null;
    let minDistance = Infinity;

    for (const t of Object.values(this.gameState.territories)) {
      const dist = Phaser.Math.Distance.Between(
        this.pointerWorldPoint.x,
        this.pointerWorldPoint.y,
        t.x,
        t.y
      );
      const hitRadius = t.radius + 18;
      if (dist <= hitRadius && dist < minDistance) {
        minDistance = dist;
        closest = t;
      }
    }
    return closest;
  }

  private setupInputs(): void {
    // Global scene pointerdown for responsive touch targets
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (
        this.isExiting ||
        this.matchMenuController?.isOpen() ||
        this.gameState.status !== 'playing' ||
        this.selectedSourceIds.length > 0
      ) {
        return;
      }

      const territory = this.getTerritoryUnderPointer(pointer);
      if (territory) {
        this.startDragFromTerritory(territory.id, pointer);
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isExiting || this.matchMenuController?.isOpen() || this.selectedSourceIds.length === 0) {
        return;
      }

      const hoveredTerritory = this.getTerritoryUnderPointer(pointer);
      const previousTargetId = this.hoveredTargetId;

      // Check if we just left a previously hovered friendly territory.
      // If the player dragged onto a friendly territory and then moved away without releasing,
      // that means they swiped through it to link it into a coordinated multi-base strike!
      if (this.lastHoveredFriendlyId && (!hoveredTerritory || hoveredTerritory.id !== this.lastHoveredFriendlyId)) {
        const prevFriendly = this.gameState.territories[this.lastHoveredFriendlyId];
        if (
          prevFriendly &&
          prevFriendly.owner === 'player' &&
          prevFriendly.units > 1 &&
          !this.selectedSourceIds.includes(prevFriendly.id)
        ) {
          this.selectedSourceIds.push(prevFriendly.id);
          this.highlightSelectedTerritory(prevFriendly.id);
          sounds.playReinforce();
          this.platform.hapticImpact('light');
        }
        this.lastHoveredFriendlyId = null;
      }

      // Now update hovered target or potential friendly candidate
      if (hoveredTerritory) {
        if (this.selectedSourceIds.includes(hoveredTerritory.id)) {
          // Already one of the dispatch sources, cannot target itself
          this.hoveredTargetId = null;
        } else {
          // Valid target: either enemy/neutral to attack, OR friendly to reinforce!
          this.hoveredTargetId = hoveredTerritory.id;
          if (hoveredTerritory.owner === 'player') {
            this.lastHoveredFriendlyId = hoveredTerritory.id;
          }
        }
      } else {
        this.hoveredTargetId = null;
      }

      if (previousTargetId && previousTargetId !== this.hoveredTargetId) {
        const previousTargetVisual = this.territoryVisuals.get(previousTargetId);
        if (previousTargetVisual) {
          this.tweens.killTweensOf(previousTargetVisual.ring);
          previousTargetVisual.ring.setScale(1).setAlpha(1);
        }
      }

      if (this.hoveredTargetId && this.hoveredTargetId !== previousTargetId) {
        this.platform.hapticSelection();
        const targetVisual = this.territoryVisuals.get(this.hoveredTargetId);
        if (targetVisual && !this.reducedMotion) {
          this.tweens.killTweensOf(targetVisual.ring);
          targetVisual.ring.setScale(1.08).setAlpha(1);
          this.tweens.add({
            targets: targetVisual.ring,
            scale: 1,
            alpha: 0.92,
            duration: 150,
            ease: 'Cubic.easeOut',
          });
        }
      }

      this.renderDragTrajectory(pointer);
    });

    this.input.on('pointerup', () => {
      if (this.isExiting || this.matchMenuController?.isOpen()) {
        this.cancelDragSelection();
        return;
      }
      this.handlePointerRelease();
    });
  }

  private startDragFromTerritory(territoryId: string, _pointer?: Phaser.Input.Pointer): void {
    if (this.isExiting || this.matchMenuController?.isOpen() || this.gameState.status !== 'playing') return;

    const territory = this.gameState.territories[territoryId];
    if (!territory) return;

    if (territory.owner === 'player' && territory.units > 1) {
      this.selectedSourceIds = [territoryId];
      this.lastHoveredFriendlyId = null;
      this.hoveredTargetId = null;
      this.highlightSelectedTerritory(territoryId);
      sounds.playDispatch();
      this.platform.hapticImpact('light');
    }
  }

  private highlightSelectedTerritory(territoryId: string): void {
    const territory = this.gameState.territories[territoryId];
    if (!territory) return;

    let ring = this.selectionRings.get(territoryId);
    if (!ring) {
      ring = this.add
        .circle(0, 0, territory.radius + 6, 0xffffff, 0)
        .setStrokeStyle(3, 0xffffff, 0.95)
        .setDepth(45);
      this.selectionRings.set(territoryId, ring);
    }
    ring.setPosition(territory.x, territory.y).setVisible(true);
    this.tweens.killTweensOf(ring);
    ring.setScale(0.88).setAlpha(1);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: ring,
        scale: 1.2,
        alpha: 0.28,
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    const vis = this.territoryVisuals.get(territoryId);
    if (vis) {
      if (this.reducedMotion) {
        vis.container.setScale(1.08);
      } else {
        this.tweens.add({
          targets: vis.container,
          scale: 1.14,
          duration: 100,
          ease: 'Sine.easeOut',
        });
      }
    }
  }

  private renderDragTrajectory(pointer: Phaser.Input.Pointer): void {
    this.dragGraphics.clear();
    if (this.selectedSourceIds.length === 0) {
      this.dragBadgeContainer.setVisible(false);
      return;
    }

    const selectedTerritories = this.selectedSourceIds
      .map((id) => this.gameState.territories[id])
      .filter((t): t is Territory => Boolean(t));

    if (selectedTerritories.length === 0) {
      this.dragBadgeContainer.setVisible(false);
      return;
    }

    const target = this.hoveredTargetId ? this.gameState.territories[this.hoveredTargetId] : null;
    pointer.positionToCamera(this.cameras.main, this.pointerWorldPoint);
    const targetX = target ? target.x : this.pointerWorldPoint.x;
    const targetY = target ? target.y : this.pointerWorldPoint.y;

    const isHoveringTarget = !!target;
    const isFriendly = target && target.owner === 'player';

    const color = isHoveringTarget
      ? isFriendly
        ? 0x10b981
        : 0xf59e0b
      : THEME.teams.player.light;

    // A dark under-stroke keeps the command path readable over roads and units.
    this.dragGraphics.lineStyle(8, 0x020617, 0.72);
    selectedTerritories.forEach((src) => {
      this.dragGraphics.lineBetween(src.x, src.y, targetX, targetY);
    });
    this.dragGraphics.lineStyle(3.5, color, 0.96);
    selectedTerritories.forEach((src) => {
      this.dragGraphics.lineBetween(src.x, src.y, targetX, targetY);

      const angle = Phaser.Math.Angle.Between(src.x, src.y, targetX, targetY);
      const stopDistance = target ? target.radius + 10 : 2;
      const tipX = targetX - Math.cos(angle) * stopDistance;
      const tipY = targetY - Math.sin(angle) * stopDistance;
      const rearX = tipX - Math.cos(angle) * 10;
      const rearY = tipY - Math.sin(angle) * 10;
      const wingX = Math.cos(angle + Math.PI / 2) * 5;
      const wingY = Math.sin(angle + Math.PI / 2) * 5;
      this.dragGraphics.fillStyle(color, 1);
      this.dragGraphics.fillTriangle(
        tipX,
        tipY,
        rearX + wingX,
        rearY + wingY,
        rearX - wingX,
        rearY - wingY
      );
    });

    // If multiple sources, draw a visual connection chain between the selected sources
    if (selectedTerritories.length > 1) {
      this.dragGraphics.lineStyle(2, 0x60a5fa, 0.5);
      for (let i = 0; i < selectedTerritories.length - 1; i++) {
        this.dragGraphics.lineBetween(
          selectedTerritories[i].x,
          selectedTerritories[i].y,
          selectedTerritories[i + 1].x,
          selectedTerritories[i + 1].y
        );
      }
    }

    // Target reticle or end dot
    if (isHoveringTarget && target) {
      const reticleRadius = target.radius + 10;
      this.dragGraphics.fillStyle(color, 0.09);
      this.dragGraphics.fillCircle(target.x, target.y, reticleRadius);
      this.dragGraphics.lineStyle(5, 0x020617, 0.78);
      this.dragGraphics.strokeCircle(target.x, target.y, reticleRadius);
      this.dragGraphics.lineStyle(2.5, color, 1);
      this.dragGraphics.strokeCircle(target.x, target.y, reticleRadius);
      this.dragGraphics.lineStyle(2, color, 0.9);
      const tickInner = reticleRadius + 4;
      const tickOuter = reticleRadius + 10;
      for (let index = 0; index < 4; index++) {
        const angle = index * (Math.PI / 2);
        this.dragGraphics.lineBetween(
          target.x + Math.cos(angle) * tickInner,
          target.y + Math.sin(angle) * tickInner,
          target.x + Math.cos(angle) * tickOuter,
          target.y + Math.sin(angle) * tickOuter
        );
      }
    } else {
      this.dragGraphics.lineStyle(2, color, 0.42);
      this.dragGraphics.strokeCircle(targetX, targetY, 10);
      this.dragGraphics.fillStyle(color, 0.9);
      this.dragGraphics.fillCircle(targetX, targetY, 4);
    }

    // Live Tactical Dispatch Badge in the center of the drag group
    const totalUnitsToSend = selectedTerritories.reduce(
      (sum, src) => sum + calculateDispatchUnits(src.units, 0.5),
      0
    );

    const centroidX = selectedTerritories.reduce((sum, src) => sum + src.x, 0) / selectedTerritories.length;
    const centroidY = selectedTerritories.reduce((sum, src) => sum + src.y, 0) / selectedTerritories.length;

    const midX = (centroidX + targetX) / 2;
    const midY = (centroidY + targetY) / 2;

    const badgeWasVisible = this.dragBadgeContainer.visible;
    this.dragBadgeContainer.setPosition(midX, midY).setVisible(true);
    if (!badgeWasVisible && !this.reducedMotion) {
      this.dragBadgeContainer.setScale(0.9).setAlpha(0.5);
      this.tweens.add({
        targets: this.dragBadgeContainer,
        scale: 1,
        alpha: 1,
        duration: 140,
        ease: 'Back.easeOut',
      });
    }

    const sourceCountLabel = selectedTerritories.length > 1 ? ` (${selectedTerritories.length} bases)` : '';

    if (isHoveringTarget && target) {
      if (isFriendly) {
        this.dragBadgeText.setText(`+${totalUnitsToSend} REINFORCE${sourceCountLabel}`);
        this.dragBadgeText.setColor('#10b981');
        this.dragBadgeBg.setStrokeStyle(2, 0x10b981, 1);
      } else {
        if (totalUnitsToSend > target.units) {
          const rem = totalUnitsToSend - target.units;
          this.dragBadgeText.setText(`⚔ ${totalUnitsToSend} (WIN +${rem})${sourceCountLabel}`);
          this.dragBadgeText.setColor('#f59e0b');
          this.dragBadgeBg.setStrokeStyle(2, 0xf59e0b, 1);
        } else if (totalUnitsToSend === target.units) {
          this.dragBadgeText.setText(`⚔ ${totalUnitsToSend} (TIE)${sourceCountLabel}`);
          this.dragBadgeText.setColor('#fb923c');
          this.dragBadgeBg.setStrokeStyle(2, 0xfb923c, 1);
        } else {
          const needed = target.units - totalUnitsToSend;
          this.dragBadgeText.setText(`⚔ ${totalUnitsToSend} (-${needed})${sourceCountLabel}`);
          this.dragBadgeText.setColor('#ef4444');
          this.dragBadgeBg.setStrokeStyle(2, 0xef4444, 1);
        }
      }
    } else {
      this.dragBadgeText.setText(`⚔ SEND ${totalUnitsToSend}${sourceCountLabel}`);
      this.dragBadgeText.setColor('#ffffff');
      this.dragBadgeBg.setStrokeStyle(2, THEME.teams.player.primary, 0.95);
    }
    const badgeWidth = Math.ceil(this.dragBadgeText.width) + 20;
    this.dragBadgeBg.setSize(badgeWidth, 26);
    this.dragBadgeShadow.setSize(badgeWidth + 4, 28);

    // Dynamic Bottom Action Bar Update
    this.bottomHintText
      .setText(`⚔ Swiping from ${selectedTerritories.length} towers -> ${totalUnitsToSend} troops ready`)
      .setColor('#60a5fa');
  }

  private handlePointerRelease(): void {
    if (this.bottomHintText) {
      const territories = Object.values(this.gameState?.territories ?? {});
      const enemyTerritoriesCount = territories.filter((t) => t.owner === 'enemy').length;
      const enemyArmiesCount = (this.gameState?.armies ?? []).filter((a) => a.owner === 'enemy').length;
      if (enemyTerritoriesCount === 0 && enemyArmiesCount > 0 && this.gameState?.status === 'playing') {
        this.bottomHintText.setText('⚔ LAST ENEMY ARMY REMAINING').setColor('#fbbf24');
      } else {
        const defaultHint = this.liveMode
          ? `⚔ Live battle vs ${this.formatShortName(this.liveOpponentName, 12)}`
          : '⚔ Drag across towers to attack or reinforce';
        this.bottomHintText.setText(defaultHint).setColor(this.liveMode ? '#93c5fd' : '#94a3b8');
      }
    }

    if (this.selectedSourceIds.length === 0) {
      this.dragBadgeContainer.setVisible(false);
      return;
    }

    const sourceIds = [...this.selectedSourceIds];
    const targetId = this.hoveredTargetId;

    // Reset visuals on all selected territories
    for (const id of sourceIds) {
      const vis = this.territoryVisuals.get(id);
      if (vis) {
        if (this.reducedMotion) {
          vis.container.setScale(1);
        } else {
          this.tweens.add({
            targets: vis.container,
            scale: 1.0,
            duration: 120,
            ease: 'Sine.easeOut',
          });
        }
      }
    }

    for (const ring of this.selectionRings.values()) {
      this.tweens.killTweensOf(ring);
      ring.setVisible(false).setScale(1).setAlpha(1);
    }
    if (targetId) {
      const targetVisual = this.territoryVisuals.get(targetId);
      if (targetVisual) {
        this.tweens.killTweensOf(targetVisual.ring);
        targetVisual.ring.setScale(1).setAlpha(1);
      }
    }

    this.selectedSourceIds = [];
    this.hoveredTargetId = null;
    this.lastHoveredFriendlyId = null;
    this.dragGraphics.clear();
    this.dragBadgeContainer.setVisible(false);

    if (targetId && !sourceIds.includes(targetId)) {
      const target = this.gameState.territories[targetId];
      const sources = sourceIds
        .map((id) => this.gameState.territories[id])
        .filter((t): t is Territory => Boolean(t));

      if (target && sources.length > 0) {
        if (this.liveMode) {
          try {
            const multiDispatch = dispatchMultipleArmies(
              sources,
              target,
              'player',
              0.5,
              this.playerArmySpeedMultiplier
            );

            if (multiDispatch.armies.length > 0) {
              const liveClient = this.liveClient;
              if (!liveClient) throw new Error('live_connection_not_open');
              const predictedArmies = multiDispatch.armies.map((army) => {
                const sequence = liveClient.sendDispatch(army.sourceId, army.targetId);
                const predictedArmy = { ...army, id: `pred_${sequence}` };
                this.livePredictions.push({
                  sequence,
                  armyId: predictedArmy.id,
                  sourceId: predictedArmy.sourceId,
                  units: predictedArmy.units,
                });
                return predictedArmy;
              });
              Object.assign(this.gameState.territories, multiDispatch.updatedSources);
              this.gameState.armies.push(...predictedArmies);
              this.markTerritoriesDirty();
              this.updateTerritoryVisuals();

              sounds.playDispatch();
              this.platform.hapticImpact(sources.length > 1 ? 'heavy' : 'medium');
            }
          } catch (error) {
            console.warn('[GameScene] Live dispatch failed:', error);
            this.showLiveConnectionError();
          }
        } else if (this.matchActions.length + sources.length > MAX_PVP_ACTIONS) {
          // The server replay only accepts a bounded action list; stop
          // dispatching before the cap so the settlement replay stays valid.
          this.spawnFloatingText(
            LOGICAL_WIDTH / 2,
            96,
            'command limit reached',
            '#f87171'
          );
        } else {
          // Execute Coordinated Multi-Dispatch (or Reinforcement)
          const multiDispatch = dispatchMultipleArmies(
            sources,
            target,
            'player',
            0.5,
            this.playerArmySpeedMultiplier
          );

          if (multiDispatch.armies.length > 0) {
            Object.assign(this.gameState.territories, multiDispatch.updatedSources);
            this.gameState.armies.push(...multiDispatch.armies);
            this.gameState.stats.playerUnitsDispatched += multiDispatch.totalUnitsDispatched;
            this.recordDispatchActions(multiDispatch.armies);
            this.markTerritoriesDirty();
            this.updateTerritoryVisuals();

            sounds.playDispatch();
            this.platform.hapticImpact(multiDispatch.armies.length > 1 ? 'heavy' : 'medium');
          }
        }
      }
    }
  }

  update(_time: number, delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const deltaSeconds = delta / 1000;

    if (this.gameState.status === 'playing' && !this.liveMode) {
      if (!this.matchMenuController?.isPaused()) {
        this.stepBotMatch(deltaSeconds);

        // Update HUD
        this.updateHud();

        // Check Game Over
        if (this.gameState.status !== 'playing') {
          this.endMatch();
        }
      }
    }
    if (this.liveMode && this.gameState.status === 'playing') {
      this.stepLiveMatch(deltaSeconds);
      this.updateHud();
    }

    // 6. Update Visuals
    this.updateTerritoryVisuals();
    if (!this.matchMenuController?.isPaused()) {
      this.updateArmyVisuals(deltaSeconds);
    }
  }

  /**
   * Steps the local bot-match prediction, clipping each step at the AI's
   * fixed tick grid (every PVP_AI_TICK_SECONDS of match time) so the client
   * prediction matches the server's authoritative replay as closely as
   * possible.
   */
  private stepBotMatch(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    if (!Number.isFinite(this.botStepRemainder) || this.botStepRemainder < 0) {
      this.botStepRemainder = 0;
    }
    // Do not run thousands of combat ticks in one frame after a suspended
    // WebView resumes. Bot match time is logical, not wall-clock time.
    const budget = consumeSimulationTicks(this.botStepRemainder, Math.min(deltaSeconds, 0.25));
    this.botStepRemainder = Number.isFinite(budget.remainderSeconds) ? budget.remainderSeconds : 0;
    // Every gameplay mutation runs on the same 20 ms clock used by the
    // authoritative replay. Render-frame size can no longer change combat.
    const ticks = Math.min(budget.ticks, 20);
    if (ticks > 0) {
      this.markTerritoriesDirty();
    }
    for (let index = 0; index < ticks && this.gameState.status === 'playing'; index++) {
      const result = stepSimulation(
        this.gameState,
        this.accumulators,
        PVP_SIMULATION_TICK_SECONDS
      );
      this.gameState = result.state;
      this.accumulators = result.accumulators;
      result.resolvedArrivals.forEach((arrival) => this.onCombatArrival(arrival));
      if (
        this.gameState.status === 'playing' &&
        this.gameState.elapsedTimeSeconds >= this.aiNextTick - 1e-9
      ) {
        this.executeAiTurn();
        this.aiNextTick += PVP_AI_TICK_SECONDS;
      }
    }
    if (budget.ticks > ticks) {
      this.botStepRemainder += (budget.ticks - ticks) * PVP_SIMULATION_TICK_SECONDS;
    }
  }

  private stepLiveMatch(deltaSeconds: number): void {
    if (this.gameState.armies.length > 0) {
      this.gameState.armies = stepLiveArmies(this.gameState.armies, deltaSeconds);
    }
  }

  private showBattlefieldReveal(): void {
    const battlefield = getBattlefield(this.battlefieldId);
    const reveal = this.add.container(82, 92).setDepth(94);
    const shadow = this.add.rectangle(0, 2, 132, 30, 0x000000, 0.38);
    const panel = this.add
      .rectangle(0, 0, 132, 28, 0x0b1220, 0.96)
      .setStrokeStyle(1.5, battlefield.accent, 0.95);
    const title = this.add
      .text(0, 0, `◆ ${battlefield.name.toUpperCase()}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    reveal.add([shadow, panel, title]);

    if (this.reducedMotion) {
      this.time.delayedCall(1_300, () => reveal.destroy());
      return;
    }
    this.tweens.add({
      targets: reveal,
      y: 84,
      alpha: 0,
      delay: 950,
      duration: 320,
      ease: 'Sine.easeIn',
      onComplete: () => reveal.destroy(),
    });
  }

  private recordDispatchActions(armies: readonly MarchingArmy[]): void {
    if (this.liveMode) return;
    const atSeconds =
      Math.round(this.gameState.elapsedTimeSeconds * 1000) / 1000;
    for (const army of armies) {
      if (this.matchActions.length >= MAX_PVP_ACTIONS) return;
      this.matchActions.push({
        sequence: this.matchActions.length,
        atSeconds,
        sourceId: army.sourceId,
        targetId: army.targetId,
      });
    }
  }

  private executeAiTurn(): void {
    const move = evaluateAiMove(this.gameState.territories, 'enemy', 8);
    if (!move) return;

    const source = this.gameState.territories[move.fromId];
    const target = this.gameState.territories[move.toId];
    if (!source || !target) return;

    const dispatch = dispatchArmy(source, target, 'enemy', 0.5, undefined, this.enemyArmySpeedMultiplier);
    if (dispatch.success && dispatch.army && dispatch.sourceTerritory) {
      this.gameState.territories[source.id] = dispatch.sourceTerritory;
      this.gameState.armies.push(dispatch.army);
      this.gameState.stats.enemyUnitsDispatched += dispatch.army.units;
      this.markTerritoriesDirty();

      // Small telegraph pulse on AI territory
      const vis = this.territoryVisuals.get(source.id);
      if (vis && !this.reducedMotion) {
        this.tweens.add({
          targets: vis.container,
          scale: 1.1,
          duration: 90,
          yoyo: true,
        });
      }
    }
  }

  /**
   * Development / QA Benchmark dispatch adapter.
   * Invokes the exact production dispatchArmy logic from @crown-clash/game-core.
   * Isolated to QA benchmarking and debug performance runs; never alters settlement or PvP results.
   */
  public executeQaDispatch(sourceId: string, targetId: string, owner: Team): boolean {
    if (!this.gameState || this.gameState.status !== 'playing' || this.liveMode) {
      return false;
    }
    const source = this.gameState.territories[sourceId];
    const target = this.gameState.territories[targetId];
    if (!source || !target || source.id === target.id) {
      return false;
    }

    // Ensure source has units and correct owner for valid production dispatch
    if (source.owner !== owner) {
      source.owner = owner;
    }
    if (source.units < 10) {
      source.units = 25;
    }

    const speedMultiplier = owner === 'player' ? this.playerArmySpeedMultiplier : this.enemyArmySpeedMultiplier;
    const dispatch = dispatchArmy(source, target, owner, 0.5, undefined, speedMultiplier);

    if (dispatch.success && dispatch.army && dispatch.sourceTerritory) {
      this.gameState.territories[source.id] = dispatch.sourceTerritory;
      this.gameState.armies.push(dispatch.army);
      if (owner === 'player') {
        this.gameState.stats.playerUnitsDispatched += dispatch.army.units;
      } else {
        this.gameState.stats.enemyUnitsDispatched += dispatch.army.units;
      }
      this.markTerritoriesDirty();
      this.updateTerritoryVisuals();
      return true;
    }

    return false;
  }

  private onCombatArrival(arrival: CombatResult): void {
    const vis = this.territoryVisuals.get(arrival.targetId);
    if (!vis) return;

    const teamStyle = THEME.teams[arrival.newOwner];
    const targetRoleStyle = TERRITORY_TYPE_PRESENTATION[vis.territory.type];

    if (arrival.captured) {
      const capturedByPlayer = arrival.attackerOwner === 'player';
      if (arrival.targetId === 'n_center' && capturedByPlayer) {
        sounds.playCrownCapture();
      } else if (capturedByPlayer) {
        sounds.playCapture();
      } else {
        sounds.playCombatHit();
      }
      if (!this.reducedMotion) {
        this.cameras.main.shake(
          arrival.targetId === 'n_center' ? 160 : 100,
          capturedByPlayer ? 0.006 : 0.0045
        );
      }
      this.platform.hapticImpact('heavy');

      // Shake & scale pop
      if (!this.reducedMotion) {
        this.tweens.add({
          targets: vis.container,
          scale: 1.22,
          duration: 125,
          yoyo: true,
          ease: 'Back.easeOut',
        });
      }

      this.spawnImpactRing(
        vis.territory.x,
        vis.territory.y,
        vis.territory.radius + 2,
        teamStyle.glow,
        2.25
      );
      this.spawnCaptureFlash(vis.territory.x, vis.territory.y, teamStyle.light);
      this.spawnCaptureBurst(vis.territory.x, vis.territory.y, teamStyle.light);

      this.spawnFloatingText(
        vis.territory.x,
        vis.territory.y - 20,
        capturedByPlayer ? `CAPTURE +${arrival.remainingUnits}` : 'TOWER LOST',
        teamStyle.lightHex
      );
    } else if (arrival.reinforced) {
      // Friendly Reinforcement Feedback
      sounds.playReinforce();
      this.platform.hapticImpact('light');

      if (!this.reducedMotion) {
        this.tweens.add({
          targets: vis.container,
          scale: 1.08,
          duration: 90,
          yoyo: true,
        });
      }

      this.spawnFloatingText(
        vis.territory.x,
        vis.territory.y - 20,
        `+${arrival.incomingUnits}`,
        '#10b981'
      );
      this.spawnImpactRing(
        vis.territory.x,
        vis.territory.y,
        vis.territory.radius,
        0x10b981,
        1.55
      );
    } else {
      sounds.playCombatHit();
      this.platform.hapticImpact('medium');
      const fortressBlocked = vis.territory.type === 'fortress';

      if (!this.reducedMotion) {
        this.tweens.add({
          targets: vis.container,
          x: vis.territory.x + 4,
          duration: 40,
          yoyo: true,
          repeat: 2,
          onComplete: () => {
            vis.container.x = vis.territory.x;
          },
        });
      }

      this.spawnFloatingText(
        vis.territory.x,
        vis.territory.y - 20,
        fortressBlocked ? `DEFLECT -${arrival.incomingUnits}` : `-${arrival.incomingUnits}`,
        fortressBlocked ? '#fbbf24' : '#ef4444'
      );
      this.spawnImpactRing(
        vis.territory.x,
        vis.territory.y,
        vis.territory.radius,
        fortressBlocked ? targetRoleStyle.color : THEME.teams.enemy.light,
        fortressBlocked ? 1.7 : 1.35
      );
      if (fortressBlocked) this.pulseTerritoryRole(vis, targetRoleStyle.color);
    }
    this.markTerritoriesDirty();
  }

  private spawnCaptureFlash(x: number, y: number, color: number): void {
    if (this.reducedMotion) return;
    const flash = this.add.circle(x, y, 10, color, 0.42).setDepth(30);
    this.tweens.add({
      targets: flash,
      scale: 5.2,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private spawnImpactRing(
    x: number,
    y: number,
    radius: number,
    color: number,
    targetScale: number
  ): void {
    const ring = this.add
      .circle(x, y, radius, color, 0.04)
      .setStrokeStyle(3, color, 0.95)
      .setDepth(31);

    this.tweens.add({
      targets: ring,
      scale: this.reducedMotion ? 1 : targetScale,
      alpha: 0,
      duration: this.reducedMotion ? 180 : 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private spawnCaptureBurst(x: number, y: number, color: number): void {
    if (this.reducedMotion) return;

    for (let index = 0; index < 8; index++) {
      const angle = (Math.PI * 2 * index) / 8 - Math.PI / 2;
      const distance = index % 2 === 0 ? 44 : 34;
      const spark = this.add
        .rectangle(x, y, 3, 8, color, 0.95)
        .setRotation(angle)
        .setDepth(32);

      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        scaleY: 0.25,
        alpha: 0,
        duration: 360,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }

  private pulseTerritoryRole(vis: TerritoryVisual, color: number): void {
    if (this.reducedMotion) return;
    this.tweens.killTweensOf([vis.typeText, vis.unitBadge]);
    vis.typeText.setScale(1).setAlpha(1);
    vis.unitBadge.setScale(1);
    vis.typeText.setColor(`#${color.toString(16).padStart(6, '0')}`);
    this.tweens.add({
      targets: [vis.typeText, vis.unitBadge],
      scale: 1.18,
      duration: 90,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    const float = this.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(60);

    this.tweens.add({
      targets: float,
      y: y - 28,
      alpha: 0,
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => float.destroy(),
    });
  }

  private getTerritoryTextureKey(territory: Territory): string {
    if (territory.id === 'p_base') {
      return territory.owner === 'player' ? 'citadel_player' : 'citadel_enemy';
    }
    if (territory.id === 'e_base') {
      return territory.owner === 'enemy' ? 'citadel_enemy' : 'citadel_player';
    }
    if (territory.id === 'n_center') {
      return `crown_keep_${territory.owner}`;
    }
    return `outpost_${territory.owner}`;
  }

  markTerritoriesDirty(): void {
    this.territoriesDirty = true;
  }

  private computeTerritorySignature(): number {
    let sig = 17;
    const terrs = this.gameState?.territories;
    if (!terrs) return sig;
    for (const id in terrs) {
      const t = terrs[id];
      const ownerCode = t.owner === 'player' ? 1 : t.owner === 'enemy' ? 2 : 0;
      sig = (Math.imul(31, sig) + t.units + ownerCode * 10007) | 0;
    }
    return sig;
  }

  updateTerritoryVisuals(force = false): void {
    const currentSig = this.computeTerritorySignature();
    const signatureChanged = currentSig !== this.lastTerritorySignature;

    if (!this.territoriesDirty && !signatureChanged && !force) {
      return;
    }

    this.territoriesDirty = false;
    this.lastTerritorySignature = currentSig;

    for (const [id, vis] of this.territoryVisuals.entries()) {
      const stateTerritory = this.gameState.territories[id];
      if (!stateTerritory) continue;

      const producedUnit =
        stateTerritory.type === 'barracks' &&
        stateTerritory.units > vis.territory.units &&
        stateTerritory.owner === vis.territory.owner;
      vis.territory = stateTerritory;

      if (vis.lastUnits !== stateTerritory.units) {
        vis.lastUnits = stateTerritory.units;
        vis.unitText.setText(stateTerritory.units.toString());
      }

      if (producedUnit) {
        this.pulseTerritoryRole(
          vis,
          TERRITORY_TYPE_PRESENTATION.barracks.color
        );
      }

      if (vis.lastOwner !== stateTerritory.owner) {
        vis.lastOwner = stateTerritory.owner;
        const teamStyle = THEME.teams[stateTerritory.owner];
        vis.basePlate.setStrokeStyle(2, teamStyle.dark, 0.95);
        vis.ring.setStrokeStyle(2.5, teamStyle.primary, 0.95);
        vis.ring.setFillStyle(teamStyle.glow, 0.12);
        vis.unitBadge.setStrokeStyle(1.5, teamStyle.primary);

        const targetTexture = this.getTerritoryTextureKey(stateTerritory);
        if (vis.sprite.texture.key !== targetTexture) {
          vis.sprite.setTexture(targetTexture);
        }
      }
    }
  }

  private destroyArmyVisual(visual: ArmyVisual): void {
    this.tweens.killTweensOf(visual.container);
    for (const f of visual.followers) {
      f.sprite.destroy();
      f.shadow.destroy();
    }
    visual.leaderSprite.destroy();
    visual.leaderShadow.destroy();
    visual.badgeText.destroy();
    visual.badgeBg.destroy();
    visual.container.destroy();
  }

  private updateArmyVisuals(deltaSeconds: number): void {
    // Owner is part of the visual key as defense-in-depth against an older
    // server producing the same per-player sequence ID for both commanders.
    this.activeArmyIdsSet.clear();
    const armies = this.gameState.armies;
    const armyCount = armies.length;
    for (let i = 0; i < armyCount; i++) {
      const army = armies[i];
      this.activeArmyIdsSet.add(`${army.owner}:${army.id}`);
    }

    // Destroy visuals for finished armies
    for (const [id, visual] of this.armyVisuals.entries()) {
      if (!this.activeArmyIdsSet.has(id)) {
        this.destroyArmyVisual(visual);
        this.armyVisuals.delete(id);
      }
    }

    // Update or create visual for each active army
    for (const army of armies) {
      const currentX = Phaser.Math.Linear(army.startX, army.targetX, army.progress);
      const currentY = Phaser.Math.Linear(army.startY, army.targetY, army.progress);
      const visualId = `${army.owner}:${army.id}`;

      let visual = this.armyVisuals.get(visualId);

      if (!visual) {
        const sourceType = this.gameState.territories[army.sourceId]?.type ?? 'barracks';
        const roleStyle = TERRITORY_TYPE_PRESENTATION[sourceType];
        const container = this.add.container(currentX, currentY).setDepth(35);

        // Calculate travel angle and direction vectors
        const angle = Phaser.Math.Angle.Between(army.startX, army.startY, army.targetX, army.targetY);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const perpX = -sin;
        const perpY = cos;
        const isFacingLeft = cos < -0.05;

        // Determine follower formation based on army size
        const followerOffsets: Array<{ x: number; y: number; delay: number }> = [];
        if (army.units >= 15) {
          followerOffsets.push(
            { x: -14 * cos + 7 * perpX, y: -14 * sin + 7 * perpY, delay: 45 },
            { x: -22 * cos - 7 * perpX, y: -22 * sin - 7 * perpY, delay: 90 },
            { x: -30 * cos, y: -30 * sin, delay: 135 }
          );
        } else if (army.units >= 6) {
          followerOffsets.push(
            { x: -15 * cos + 6 * perpX, y: -15 * sin + 6 * perpY, delay: 50 },
            { x: -24 * cos - 6 * perpX, y: -24 * sin - 6 * perpY, delay: 100 }
          );
        } else {
          followerOffsets.push({ x: -16 * cos, y: -16 * sin, delay: 60 });
        }
        if (sourceType === 'barracks') {
          followerOffsets.push({
            x: -38 * cos + 9 * perpX,
            y: -38 * sin + 9 * perpY,
            delay: 150,
          });
        }

        if (sourceType === 'stable') {
          const speedLines = this.add.graphics();
          speedLines.lineStyle(2, roleStyle.color, 0.65);
          for (const offset of [-7, 0, 7]) {
            speedLines.lineBetween(
              -cos * 42 + perpX * offset,
              -sin * 42 + perpY * offset,
              -cos * 21 + perpX * offset,
              -sin * 21 + perpY * offset
            );
          }
          container.add(speedLines);
        }

        const roleAura = this.add
          .circle(0, 1, 15, roleStyle.color, 0.1)
          .setStrokeStyle(sourceType === 'fortress' ? 3 : 1.5, roleStyle.color, 0.82);
        container.add(roleAura);

        const followers: ArmyFollower[] = [];
        const followerTexture = army.owner === 'player' ? 'unit_follower_player' : 'unit_follower_enemy';

        for (const f of followerOffsets) {
          const shadow = this.add.ellipse(f.x, f.y + 7, 13, 6, 0x000000, 0.32);
          const sprite = this.add
            .image(f.x, f.y, followerTexture)
            .setScale(0.19)
            .setFlipX(isFacingLeft);

          container.add([shadow, sprite]);
          followers.push({
            shadow,
            sprite,
            relX: f.x,
            relY: f.y,
            delaySeconds: f.delay / 1000,
          });
        }

        // Commander / Leader Unit
        const leaderShadow = this.add.ellipse(0, 9, 18, 7, 0x000000, 0.38);
        const leaderTexture = army.owner === 'player' ? 'unit_leader_player' : 'unit_leader_enemy';
        const leaderSprite = this.add
          .image(0, 0, leaderTexture)
          .setScale(0.25)
          .setFlipX(isFacingLeft);

        // High-contrast Troop Count Pill Badge
        const badgeY = -19;
        const initialUnits = `${roleStyle.label} ${army.units}`;
        const badgeWidth = Math.max(42, initialUnits.length * 7 + 14);
        const badgeBg = this.add
          .rectangle(0, badgeY, badgeWidth, 18, 0x090d16, 0.94)
          .setStrokeStyle(1.5, roleStyle.color, 1);

        const badgeText = this.add
          .text(0, badgeY, initialUnits, {
            fontFamily: FONT_FAMILY,
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2.5,
            resolution: 2,
          })
          .setOrigin(0.5);

        container.add([leaderShadow, leaderSprite, badgeBg, badgeText]);

        const lastOffset = followerOffsets[followerOffsets.length - 1] ?? { x: 0, y: 0 };
        visual = {
          id: visualId,
          container,
          leaderSprite,
          leaderShadow,
          badgeBg,
          badgeText,
          followers,
          rearOffset: { x: lastOffset.x, y: lastOffset.y },
          dustTimer: 0.05,
          dustInterval: sourceType === 'stable' ? 0.09 : sourceType === 'barracks' ? 0.14 : 0.18,
          dustColor: roleStyle.color,
          roleLabel: roleStyle.label,
          phaseSeconds: 0,
        };
        this.armyVisuals.set(visualId, visual);
        if (!this.reducedMotion) {
          container.setScale(0.86).setAlpha(0);
          this.tweens.add({
            targets: container,
            scale: 1,
            alpha: 1,
            duration: 150,
            ease: 'Back.easeOut',
          });
        }
      } else {
        visual.container.setPosition(currentX, currentY);
        const unitsStr = `${visual.roleLabel} ${army.units}`;
        if (visual.badgeText.text !== unitsStr) {
          visual.badgeText.setText(unitsStr);
          const newWidth = Math.max(42, unitsStr.length * 7 + 14);
          visual.badgeBg.setSize(newWidth, 18);
        }

        // Emit rhythmic dust puff behind rearmost follower
        visual.dustTimer -= deltaSeconds;
        if (!this.reducedMotion && visual.dustTimer <= 0) {
          visual.dustTimer = visual.dustInterval;
          this.dustSimulator.spawn(
            currentX + visual.rearOffset.x,
            currentY + visual.rearOffset.y,
            visual.dustColor
          );
        }
      }

      if (!this.reducedMotion) {
        visual.phaseSeconds += deltaSeconds;
        const leaderStride = computeMarchStride(visual.phaseSeconds, 0, this.sharedStrideMetrics);
        visual.leaderSprite.y = leaderStride.leaderY;
        visual.leaderSprite.setScale(leaderStride.leaderScaleX, leaderStride.leaderScaleY);

        const followerCount = visual.followers.length;
        for (let fIdx = 0; fIdx < followerCount; fIdx++) {
          const f = visual.followers[fIdx];
          const fStride = computeMarchStride(visual.phaseSeconds, f.delaySeconds, this.sharedStrideMetrics);
          f.sprite.y = f.relY + fStride.followerYOffset;
          f.sprite.setScale(fStride.followerScaleX, fStride.followerScaleY);
        }
      }
    }

    if (!this.reducedMotion) {
      this.dustSimulator.update(deltaSeconds);
      const dustItems = this.dustSimulator.getItems();
      const poolLen = this.dustPool.length;
      for (let i = 0; i < poolLen; i++) {
        const item = dustItems[i];
        const arc = this.dustPool[i];
        if (!arc || !item) continue;
        if (item.active) {
          arc.setVisible(true);
          arc.setPosition(item.x, item.y);
          arc.setScale(item.scale);
          arc.setAlpha(item.alpha);
          if (arc.fillColor !== item.color) {
            arc.setFillStyle(item.color, item.alpha);
          }
        } else if (arc.visible) {
          arc.setVisible(false);
        }
      }
    }
  }

  private updateHud(): void {
    // 1. Timer & Dynamic Tension Loop
    const remaining = Math.max(0, this.gameState.timeLimitSeconds - this.gameState.elapsedTimeSeconds);
    const roundedSecs = Math.floor(remaining);
    if (roundedSecs !== this.lastTimerSeconds) {
      this.lastTimerSeconds = roundedSecs;
      const mins = Math.floor(remaining / 60);
      const secs = roundedSecs % 60;
      this.timerText.setText(`⏱ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }

    if (remaining <= 15 && this.gameState.status === 'playing') {
      const currentSec = Math.floor(remaining);
      if (currentSec !== this.lastHeartbeatSecond) {
        this.lastHeartbeatSecond = currentSec;
        const urgency = remaining <= 5 ? 'high' : 'medium';
        sounds.playHeartbeat(urgency);
        this.platform.hapticImpact(remaining <= 5 ? 'medium' : 'light');

        this.timerText.setColor(remaining <= 5 ? '#ef4444' : '#f59e0b');
        this.tweens.add({
          targets: this.timerText,
          scale: 1.15,
          duration: 90,
          yoyo: true,
          ease: 'Sine.easeOut',
        });
      }
    } else {
      this.timerText.setColor('#fbbf24');
    }

    // 2. Dynamic Tug-of-War Dominance Bar
    const dominance = fastComputeDominance(this.gameState);
    const playerPct = dominance.playerPct;
    const neutralPct = dominance.neutralPct;

    const barTotalWidth = this.dominanceBarTotalWidth;
    const playerWidth = Math.max(14, (playerPct / 100) * barTotalWidth);
    const neutralWidth = Math.max(8, (neutralPct / 100) * barTotalWidth);
    const enemyWidth = Math.max(14, barTotalWidth - playerWidth - neutralWidth);
    const barStartX = this.dominanceBarStartX;

    const dirty = this.dominanceDirtyChecker.check(dominance);
    if (dirty.barsChanged) {
      this.playerBar.setPosition(barStartX, this.playerBar.y).setDisplaySize(playerWidth, 12);
      this.neutralBar.setPosition(barStartX + playerWidth, this.neutralBar.y).setDisplaySize(neutralWidth, 12);
      this.enemyBar.setPosition(barStartX + playerWidth + neutralWidth, this.enemyBar.y).setDisplaySize(enemyWidth, 12);
    }

    if (dirty.playerTextChanged) {
      this.playerDomText.setText(dominance.playerDomText);
    }
    if (dirty.enemyTextChanged) {
      this.enemyDomText.setText(dominance.enemyDomText);
    }

    // 3. Tactical banner / Hint updates when not actively dragging
    if (this.selectedSourceIds.length === 0 && this.bottomHintText) {
      if (dominance.isLastEnemyArmy && this.gameState.status === 'playing') {
        const lastArmyText = '⚔ LAST ENEMY ARMY REMAINING';
        if (this.bottomHintText.text !== lastArmyText) {
          this.bottomHintText.setText(lastArmyText).setColor('#fbbf24');
        }
      } else if (this.bottomHintText.text === '⚔ LAST ENEMY ARMY REMAINING') {
        const defaultHint = this.liveMode
          ? `⚔ Live battle vs ${this.formatShortName(this.liveOpponentName, 12)}`
          : '⚔ Drag across towers to attack or reinforce';
        this.bottomHintText.setText(defaultHint).setColor(this.liveMode ? '#93c5fd' : '#94a3b8');
      }
    }

    // Smooth Tug-of-War Crown Needle glide towards the leading front
    const targetCrownX = barStartX + playerWidth + neutralWidth / 2;
    if (Math.abs(this.tugCrown.x - targetCrownX) > 0.1) {
      this.tugCrown.x = Phaser.Math.Linear(this.tugCrown.x, targetCrownX, 0.12);
    }
  }

  private endMatch(): void {
    if (!canInitiateBotSettlement({
      isExiting: this.isExiting,
      hasResultModal: Boolean(this.resultModalContainer),
      resultPending: this.resultPending,
      isStressMode: this.isStressMode,
      liveMode: this.liveMode,
    })) {
      return;
    }

    sounds.stopBattleMusic();
    this.resultPending = true;
    this.renderSyncingModal();
    void this.finalizeMatch();
  }

  private localMatchStats(): MatchStats {
    return {
      matchDurationSeconds: Math.floor(this.gameState.elapsedTimeSeconds),
      playerUnitsDispatched: this.gameState.stats.playerUnitsDispatched,
      enemyUnitsDispatched: this.gameState.stats.enemyUnitsDispatched,
      territoriesCapturedByPlayer: this.gameState.stats.territoriesCapturedByPlayer,
      territoriesCapturedByEnemy: this.gameState.stats.territoriesCapturedByEnemy,
    };
  }

  private async finalizeMatch(): Promise<void> {
    if (!canFinalizeBotSettlement({
      isStressMode: this.isStressMode,
      liveMode: this.liveMode,
    })) {
      return;
    }
    try {
      await this.backendConnectPromise;
      let settlement: MatchSettlement;
      if (this.careerManager.isRemoteConnected()) {
        // Server replays the recorded actions and derives the outcome.
        settlement = await this.careerManager.recordMatchResultRemote(
          this.matchActions,
          this.activeMatchId,
          this.platform
        );
      } else if (isLocalCareerFallbackAllowed()) {
        settlement = this.careerManager.recordMatchResult(
          this.gameState.status as 'victory' | 'defeat' | 'draw',
          this.localMatchStats(),
          this.activeMatchId
        );
      } else {
        throw new Error('backend_required_for_match_settlement');
      }

      this.resultPending = false;
      this.dismissSyncingModal();
      const stats =
        settlement.stats && settlement.stats.matchDurationSeconds > 0
          ? settlement.stats
          : this.localMatchStats();
      trackTerminalMatchEvent({
        name: 'match_end',
        matchId: settlement.matchId,
        mode: 'bot',
        result: settlement.status,
        durationSeconds: stats.matchDurationSeconds,
      });
      trackEvent({
        name: 'match_reward_received',
        matchId: settlement.matchId,
        mode: 'bot',
      });
      if (settlement.rankPromoted && this.careerManager.isRemoteConnected()) {
        trackEvent({ name: 'rank_promoted', matchId: settlement.matchId });
      }
      this.renderResultModal(settlement.status, stats, settlement);
    } catch (error) {
      this.resultPending = false;
      this.dismissSyncingModal();
      this.showSettlementError(error);
    }
  }

  private renderResultModal(
    status: 'victory' | 'defeat' | 'draw',
    stats: MatchStats,
    settlement: ReturnType<CareerManager['recordMatchResult']>
  ): void {
    const duration = wholeMatchSeconds(stats.matchDurationSeconds);
    const isWin = status === 'victory';

    if (isWin) {
      sounds.playVictory();
      this.platform.hapticNotification('success');
      this.cameras.main.flash(350, 37, 99, 235);
    } else {
      sounds.playDefeat();
      this.platform.hapticNotification('warning');
    }

    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const modal = this.add.container(visibleWidth / 2, visibleHeight / 2).setDepth(200);
    this.resultModalContainer = modal;
    modal.setScale(0.8);
    modal.setAlpha(0);

    // Dark backdrop overlay
    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x000000, 0.78)
      .setInteractive();

    // Modal Card
    const cardHeight = 640;
    const card = this.add
      .rectangle(0, 0, 330, cardHeight, 0x0c1322, 0.98)
      .setStrokeStyle(2, isWin ? 0xf59e0b : 0xef4444, 0.95);

    // Header Title & Subtitle
    const titleText = isWin ? 'VICTORY!' : 'DEFEAT';
    const titleColor = isWin ? '#fbbf24' : '#ef4444';
    const subText = isWin ? '👑 ALL ENEMY BASES CAPTURED!' : '⚔️ YOUR DEFENSES HAVE FALLEN';

    const title = this.add
      .text(0, -275, titleText, {
        fontFamily: FONT_FAMILY,
        fontSize: '32px',
        fontStyle: '900',
        color: titleColor,
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5);

    const subtitle = this.add
      .text(0, -240, subText, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: isWin ? '#93c5fd' : '#f87171',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    // Rank Tier Banner (e.g. ⚔️ SOLDIER RANK • 🏆 120)
    const rankTier = settlement.newRank;
    const rankBanner = this.add
      .rectangle(0, -208, 280, 36, 0x111c33, 0.95)
      .setStrokeStyle(1.5, rankTier.color, 0.9);

    const rankText = this.add
      .text(0, -214, `${rankTier.badge} ${rankTier.name.toUpperCase()} (🏆 ${settlement.newCareer.trophies})`, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    const leagueProgress = getLeagueProgress(settlement.newCareer.trophies);
    const rankProgressTrack = this.add.rectangle(0, -198, 252, 4, 0x080d18, 1);
    const rankProgressFill = this.add
      .rectangle(-126, -198, Math.max(3, 252 * leagueProgress.progress), 3, rankTier.color, 1)
      .setOrigin(0, 0.5);

    // Two Big Reward Cards: Trophies Card and Gold Card
    const trophyCardX = -72;
    const trophyCardY = -153;
    const trophyDeltaStr =
      settlement.breakdown.trophyDelta > 0
        ? `+${settlement.breakdown.trophyDelta}`
        : `${settlement.breakdown.trophyDelta}`;
    const trophyColor = settlement.breakdown.trophyDelta >= 0 ? '#fbbf24' : '#f87171';

    const trophyCardBg = this.add
      .rectangle(trophyCardX, trophyCardY, 130, 64, 0x111827, 0.95)
      .setStrokeStyle(1.5, isWin ? 0xf59e0b : 0x374151, 0.85);

    const trophyLabel = this.add
      .text(trophyCardX, trophyCardY - 17, 'TROPHIES', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    const trophyValue = this.add
      .text(trophyCardX, trophyCardY + 10, `${trophyDeltaStr} 🏆`, {
        fontFamily: FONT_FAMILY,
        fontSize: '19px',
        fontStyle: '900',
        color: trophyColor,
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);

    // Gold Card (right)
    const goldCardX = 72;
    const goldCardY = -153;
    const goldCardBg = this.add
      .rectangle(goldCardX, goldCardY, 130, 64, 0x111827, 0.95)
      .setStrokeStyle(1.5, 0xf59e0b, 0.85);

    const goldLabel = this.add
      .text(goldCardX, goldCardY - 17, 'GOLD REWARD', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    const goldValue = this.add
      .text(goldCardX, goldCardY + 10, `+${settlement.breakdown.totalCoins} 🪙`, {
        fontFamily: FONT_FAMILY,
        fontSize: '19px',
        fontStyle: '900',
        color: '#f59e0b',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);

    // Bonus Breakdown Chip
    const primaryBreakdown: string[] = [`Base: ${settlement.breakdown.baseCoins}`];
    if (settlement.breakdown.speedBonus > 0) primaryBreakdown.push(`Speed: +${settlement.breakdown.speedBonus}`);
    if (settlement.breakdown.dominationBonus > 0) primaryBreakdown.push(`Dominance: +${settlement.breakdown.dominationBonus}`);
    const secondaryBreakdown: string[] = [];
    if (settlement.breakdown.streakBonus > 0) secondaryBreakdown.push(`Streak: +${settlement.breakdown.streakBonus}`);
    if (settlement.breakdown.treasuryBonus > 0) secondaryBreakdown.push(`Treasury: +${settlement.breakdown.treasuryBonus}`);

    const bonusChipText = this.add
      .text(0, -108, [primaryBreakdown.join('  •  '), secondaryBreakdown.join('  •  ')].filter(Boolean).join('\n'), {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#38bdf8',
        stroke: '#000000',
        strokeThickness: 1.5,
        align: 'center',
        lineSpacing: 3,
        resolution: 2,
      })
      .setOrigin(0.5);

    // Match Stats Summary Section
    const statsBox = this.add
      .rectangle(0, -68, 280, 52, 0x0f172a, 0.9)
      .setStrokeStyle(1, 0x1e293b, 1);

    const matchStatsText = this.add
      .text(
        0,
        -68,
        `⏱ Time: ${duration}s    🏰 Captured: ${stats.territoriesCapturedByPlayer}    ⚔ Dispatched: ${stats.playerUnitsDispatched}\n🔥 Win Streak: ${settlement.newCareer.currentStreak}    👑 Total Wins: ${settlement.newCareer.matchesWon}`,
        {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#cbd5e1',
          stroke: '#000000',
          strokeThickness: 2,
          align: 'center',
          lineSpacing: 4,
          resolution: 2,
        }
      )
      .setOrigin(0.5);

    // Rank Promotion Banner (if promoted)
    let promoContainer: Phaser.GameObjects.Container | null = null;
    if (settlement.rankPromoted) {
      promoContainer = this.add.container(0, -208);
      const promoGlow = this.add
        .rectangle(0, 0, 284, 28, 0xf59e0b, 0.3)
        .setStrokeStyle(2, 0xfde047, 1);
      const promoText = this.add
        .text(0, 0, `🎉 PROMOTED TO ${rankTier.name.toUpperCase()}!`, {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          fontStyle: '900',
          color: '#fef08a',
          stroke: '#000000',
          strokeThickness: 2.5,
          resolution: 2,
        })
        .setOrigin(0.5);
      promoContainer.add([promoGlow, promoText]);
      this.tweens.add({
        targets: promoGlow,
        alpha: 0.8,
        duration: 350,
        yoyo: true,
        repeat: -1,
      });
    }

    const upgradeBalanceText = this.add
      .text(0, -25, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    const upgradeObjects: Phaser.GameObjects.GameObject[] = [upgradeBalanceText];
    const refreshUpgradeRows: Array<() => void> = [];
    const upgradeRows: ReadonlyArray<{
      type: UpgradeType;
      x: number;
      y: number;
      icon: string;
      title: string;
    }> = [
      { type: 'starting_garrison', x: -72, y: 7, icon: '🏰', title: 'CITADEL' },
      { type: 'production', x: 72, y: 7, icon: '⚒', title: 'WAR FORGE' },
      { type: 'army_speed', x: -72, y: 57, icon: '⚡', title: 'ROYAL ROADS' },
      { type: 'treasury', x: 72, y: 57, icon: '🪙', title: 'TREASURY' },
    ];

    for (const row of upgradeRows) {
      const rowBg = this.add
        .rectangle(row.x, row.y, 134, 44, 0x111827, 0.96)
        .setStrokeStyle(1, 0x334155, 1);
      const label = this.add
        .text(row.x, row.y - 7, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '8px',
          fontStyle: 'bold',
          color: '#e2e8f0',
          stroke: '#000000',
          strokeThickness: 1,
          lineSpacing: 1,
          resolution: 2,
        })
        .setOrigin(0.5);
      const buyBg = this.add
        .rectangle(row.x, row.y + 13, 76, 16, 0x2563eb, 1)
        .setStrokeStyle(1, 0x60a5fa, 1);
      const buyText = this.add
        .text(row.x, row.y + 13, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '8px',
          fontStyle: '900',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 1.5,
          resolution: 2,
        })
        .setOrigin(0.5);
      this.bindPressFeedback(rowBg, buyText);

      const refresh = (): void => {
        const career = this.careerManager.getCareer();
        const card = getUpgradeCardViewModel(career, row.type);

        label.setText(
          `${row.icon} ${row.title} LV.${card.level}/${card.maxLevel}\n${card.currentEffectLabel} • ${card.milestoneLabel}`
        );
        buyText.setText(card.nextCost === null ? 'MAX' : `${card.nextCost} 🪙`);
        upgradeBalanceText.setText(`UPGRADE YOUR ARMY  •  ${career.coins} 🪙`);

        buyBg
          .setFillStyle(card.canAfford ? 0x2563eb : 0x273449, 1)
          .setStrokeStyle(1.5, card.canAfford ? 0x60a5fa : 0x475569, 1);
        buyText.setColor(card.canAfford ? '#ffffff' : '#94a3b8');
        if (card.canAfford) {
          rowBg.setInteractive({ useHandCursor: true });
        } else {
          rowBg.disableInteractive();
        }
      };

      rowBg.on('pointerdown', () => {
        rowBg.disableInteractive();
        void this.purchaseUpgrade(row.type, refreshUpgradeRows);
      });

      refreshUpgradeRows.push(refresh);
      upgradeObjects.push(rowBg, label, buyBg, buyText);
    }
    refreshUpgradeRows.forEach((refresh) => refresh());
    trackUpgradeEvent({
      name: 'upgrade_panel_viewed',
      source: 'result',
    });

    // Play Again Button
    const btnY = 135;
    const btnBg = this.add
      .rectangle(0, btnY, 240, 50, isWin ? 0x2563eb : 0x374151, 1)
      .setStrokeStyle(2, isWin ? 0x60a5fa : 0x9ca3af, 1)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add
      .text(0, btnY, 'PLAY AGAIN ⚔', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(btnBg, btnText);

    btnBg.on('pointerover', () => {
      btnBg.setScale(1.03);
      btnText.setScale(1.03);
    });
    btnBg.on('pointerout', () => {
      btnBg.setScale(1.0);
      btnText.setScale(1.0);
    });
    btnBg.on('pointerdown', () => {
      sounds.playDispatch();
      this.platform.hapticSelection();
      btnBg.disableInteractive();
      btnText.setText('SCOUTING...');
      void this.restartMatch().catch((error: unknown) => {
        console.error('[GameScene] Rematch start failed:', error);
        if (!this.scene.isActive()) return;
        btnText.setText('TRY AGAIN');
        btnBg.setInteractive({ useHandCursor: true });
        this.platform.hapticNotification('error');
      });
    });

    // Native Messenger Share Button
    const shareY = 190;
    const shareBg = this.add
      .rectangle(0, shareY, 240, 46, 0x1e293b, 1)
      .setStrokeStyle(1.5, 0x475569, 1)
      .setInteractive({ useHandCursor: true });

    const shareText = this.add
      .text(0, shareY, 'SHARE RESULT 📢', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(shareBg, shareText);

    shareBg.on('pointerover', () => {
      shareBg.setScale(1.02);
      shareText.setScale(1.02);
    });
    shareBg.on('pointerout', () => {
      shareBg.setScale(1.0);
      shareText.setScale(1.0);
    });
    shareBg.on('pointerdown', async () => {
      this.platform.hapticSelection();
      const shareMsg = isWin
        ? `👑 I conquered Crown Clash in ${duration}s! 🏆 Trophies: ${settlement.newCareer.trophies} ⚔️ Challenge my realm!`
        : `⚔ I fought for the Crown in Crown Clash! Challenge my realm!`;
      await this.platform.share({ text: shareMsg });
    });

    const menuY = 245;
    const menuBg = this.add
      .rectangle(0, menuY, 240, 46, 0x0f172a, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const menuText = this.add
      .text(0, menuY, 'MAIN MENU', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#bfdbfe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(menuBg, menuText);

    menuBg.on('pointerover', () => {
      menuBg.setScale(1.02);
      menuText.setScale(1.02);
    });
    menuBg.on('pointerout', () => {
      menuBg.setScale(1);
      menuText.setScale(1);
    });
    menuBg.on('pointerdown', () => {
      this.platform.hapticSelection();
      this.returnToMenu();
    });

    modal.add([
      backdrop,
      card,
      title,
      subtitle,
      rankBanner,
      rankText,
      rankProgressTrack,
      rankProgressFill,
      trophyCardBg,
      trophyLabel,
      trophyValue,
      goldCardBg,
      goldLabel,
      goldValue,
      bonusChipText,
      statsBox,
      matchStatsText,
      ...upgradeObjects,
      btnBg,
      btnText,
      shareBg,
      shareText,
      menuBg,
      menuText,
    ]);

    if (promoContainer) {
      modal.add(promoContainer);
    }

    // Modal Entrance Animation
    this.tweens.add({
      targets: modal,
      scale: 1.0,
      alpha: 1.0,
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (settlement.rankPromoted) {
          sounds.playRankUp();
        } else if (isWin) {
          sounds.playCoin();
          this.time.delayedCall(220, () => sounds.playTrophy());
        }
      },
    });

    this.resultModalContainer = modal;
  }

  private showSettlementError(error: unknown): void {
    console.error('[GameScene] Match settlement failed:', error);

    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const modal = this.add.container(visibleWidth / 2, visibleHeight / 2).setDepth(220);
    this.resultModalContainer = modal;

    const card = this.add
      .rectangle(0, 0, 300, 270, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0xef4444, 0.95);
    const liveConnectionLost = this.liveMode;
    const title = this.add
      .text(0, -62, liveConnectionLost ? 'CONNECTION LOST' : 'SYNC FAILED', {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        fontStyle: '900',
        color: '#f87171',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    const message = this.add
      .text(
        0,
        -20,
        liveConnectionLost
          ? 'The live match was surrendered.\nReturn to the main menu.'
          : 'Your result was not saved.\nRetry before leaving the battle.',
        {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        align: 'center',
        lineSpacing: 5,
        resolution: 2,
        }
      )
      .setOrigin(0.5);
    const retryBg = this.add
      .rectangle(0, 55, 190, 50, 0x2563eb, 1)
      .setStrokeStyle(2, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const retryText = this.add
      .text(0, 55, liveConnectionLost ? 'MAIN MENU' : 'RETRY SYNC', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(retryBg, retryText);

    retryBg.on('pointerdown', () => {
      modal.destroy();
      this.resultModalContainer = undefined;
      if (liveConnectionLost) {
        this.returnToMenu();
      } else {
        this.resultPending = true;
        this.renderSyncingModal();
        void this.finalizeMatch();
      }
    });

    const menuBg = this.add
      .rectangle(0, 105, 190, 46, 0x0f172a, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const menuText = this.add
      .text(0, 105, 'MAIN MENU', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#bfdbfe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(menuBg, menuText);
    menuBg.on('pointerdown', () => {
      this.platform.hapticSelection();
      this.returnToMenu();
    });

    modal.add([card, title, message, retryBg, retryText, menuBg, menuText]);
    modal.setScale(0.92).setAlpha(0);
    this.tweens.add({
      targets: modal,
      scale: 1,
      alpha: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });
  }

  private renderSyncingModal(): void {
    if (this.syncingModalContainer) return;
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const modal = this.add.container(visibleWidth / 2, visibleHeight / 2).setDepth(210);
    this.syncingModalContainer = modal;

    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x000000, 0.65)
      .setInteractive();
    const card = this.add
      .rectangle(0, 0, 280, 140, 0x0c1322, 0.98)
      .setStrokeStyle(2, 0x3b82f6, 0.9);
    const title = this.add
      .text(0, -25, 'BATTLE COMPLETE', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(0, 15, 'SYNCING RESULT...', {
        fontFamily: MONO_FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#93c5fd',
        resolution: 2,
      })
      .setOrigin(0.5);

    modal.add([backdrop, card, title, subtitle]);

    if (!this.reducedMotion) {
      this.tweens.add({
        targets: subtitle,
        alpha: 0.4,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private dismissSyncingModal(): void {
    if (this.syncingModalContainer) {
      this.syncingModalContainer.destroy();
      this.syncingModalContainer = undefined;
    }
  }

  private bindPressFeedback(
    interactiveTarget: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Zone,
    label: Phaser.GameObjects.Text | Phaser.GameObjects.Graphics,
    visualBg?: Phaser.GameObjects.Rectangle
  ): void {
    const bg = visualBg || (interactiveTarget as Phaser.GameObjects.Rectangle);
    const reset = (): void => {
      bg.setScale(1);
      label.setScale(1);
    };
    interactiveTarget.on('pointerdown', () => {
      bg.setScale(0.96);
      label.setScale(0.96);
    });
    interactiveTarget.on('pointerup', reset);
    interactiveTarget.on('pointerout', reset);
  }

  private returnToMenu(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    sounds.stopBattleMusic();
    this.resultPending = false;
    this.input.enabled = false;
    this.resultModalContainer?.destroy();
    this.resultModalContainer = undefined;
    this.syncingModalContainer?.destroy();
    this.syncingModalContainer = undefined;
    this.matchMenuModalContainer?.destroy();
    this.matchMenuModalContainer = undefined;
    this.scene.start('MenuScene');
  }

  private handleMatchMenuStateChange(state: MatchMenuState): void {
    this.matchMenuModalContainer?.destroy();
    this.matchMenuModalContainer = undefined;

    if (state === 'menu') {
      this.cancelDragSelection();
      this.renderMatchMenuModal();
    } else if (state === 'confirm') {
      this.cancelDragSelection();
      this.renderMatchConfirmModal();
    }
  }

  private handleMatchExitConfirmed(): void {
    this.matchMenuModalContainer?.destroy();
    this.matchMenuModalContainer = undefined;
    this.returnToMenu();
  }

  private cancelDragSelection(): void {
    for (const id of this.selectedSourceIds) {
      const ring = this.selectionRings.get(id);
      if (ring) {
        this.tweens.killTweensOf(ring);
        ring.setVisible(false);
      }
      const vis = this.territoryVisuals.get(id);
      if (vis) {
        this.tweens.killTweensOf(vis.container);
        vis.container.setScale(1);
      }
    }
    if (this.hoveredTargetId) {
      const targetVisual = this.territoryVisuals.get(this.hoveredTargetId);
      if (targetVisual) {
        this.tweens.killTweensOf(targetVisual.ring);
        targetVisual.ring.setScale(1).setAlpha(1);
      }
    }
    this.selectedSourceIds = [];
    this.hoveredTargetId = null;
    this.lastHoveredFriendlyId = null;
    this.dragGraphics?.clear();
    this.dragBadgeContainer?.setVisible(false);
  }

  private renderMatchMenuModal(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const modal = this.add.container(visibleWidth / 2, visibleHeight / 2).setDepth(150);
    this.matchMenuModalContainer = modal;

    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x070b14, 0.82)
      .setInteractive();
    backdrop.on('pointerdown', () => {
      this.platform.hapticSelection();
      this.matchMenuController.closeMenu();
    });

    const cardHeight = this.liveMode ? 284 : 244;
    const card = this.add
      .rectangle(0, 0, 276, cardHeight, 0x0c1322, 0.98)
      .setStrokeStyle(1.5, 0x2563eb, 0.95);
    const cardGlow = this.add
      .rectangle(0, 0, 276, cardHeight, 0x111c33, 0.35)
      .setStrokeStyle(1, 0x60a5fa, 0.35);

    const titleY = -cardHeight / 2 + 28;
    const titleText = this.liveMode ? 'BATTLE MENU' : 'PAUSED';
    const title = this.add
      .text(0, titleY, titleText, {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: '900',
        color: '#f8fafc',
        stroke: '#030712',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);

    const elements: Phaser.GameObjects.GameObject[] = [backdrop, card, cardGlow, title];

    let startBtnY = titleY + 34;

    if (this.liveMode) {
      const warningBg = this.add
        .rectangle(0, startBtnY + 4, 234, 26, 0x450a0a, 0.95)
        .setStrokeStyle(1, 0xef4444, 0.9);
      const warningText = this.add
        .text(0, startBtnY + 4, '● LIVE BATTLE CONTINUES', {
          fontFamily: MONO_FONT_FAMILY,
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#fca5a5',
          resolution: 2,
        })
        .setOrigin(0.5);
      elements.push(warningBg, warningText);
      startBtnY += 40;
    }

    // 1. RESUME BUTTON (min 44 height)
    const resumeY = startBtnY + 12;
    const resumeBg = this.add
      .rectangle(0, resumeY, 234, 44, 0x2563eb, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const resumeText = this.add
      .text(0, resumeY, 'RESUME', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(resumeBg, resumeText);
    resumeBg.on('pointerdown', () => {
      this.platform.hapticSelection();
      this.matchMenuController.closeMenu();
    });
    elements.push(resumeBg, resumeText);

    // 2. SOUND TOGGLE BUTTON (min 44 height)
    const soundY = resumeY + 52;
    const soundBg = this.add
      .rectangle(0, soundY, 234, 44, 0x111c33, 1)
      .setStrokeStyle(1.5, 0x334155, 1)
      .setInteractive({ useHandCursor: true });
    const soundText = this.add
      .text(0, soundY, sounds.isMuted() ? 'SOUND: OFF' : 'SOUND: ON', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(soundBg, soundText);
    soundBg.on('pointerdown', () => {
      const isMuted = sounds.toggleMute();
      soundText.setText(isMuted ? 'SOUND: OFF' : 'SOUND: ON');
      this.platform.hapticSelection();
    });
    elements.push(soundBg, soundText);

    // 3. LEAVE MATCH BUTTON (min 44 height)
    const leaveY = soundY + 52;
    const leaveBg = this.add
      .rectangle(0, leaveY, 234, 44, 0x1e1520, 1)
      .setStrokeStyle(1.5, 0xef4444, 0.9)
      .setInteractive({ useHandCursor: true });
    const leaveText = this.add
      .text(0, leaveY, 'LEAVE MATCH', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#f87171',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(leaveBg, leaveText);
    leaveBg.on('pointerdown', () => {
      this.platform.hapticSelection();
      this.matchMenuController.openConfirm('menu');
    });
    elements.push(leaveBg, leaveText);

    modal.add(elements);

    if (!this.reducedMotion) {
      modal.setScale(0.95).setAlpha(0);
      this.tweens.add({
        targets: modal,
        scale: 1,
        alpha: 1,
        duration: 120,
        ease: 'Cubic.easeOut',
      });
    }
  }

  private renderMatchConfirmModal(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const modal = this.add.container(visibleWidth / 2, visibleHeight / 2).setDepth(150);
    this.matchMenuModalContainer = modal;

    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x070b14, 0.82)
      .setInteractive();
    backdrop.on('pointerdown', () => {
      this.platform.hapticSelection();
      this.matchMenuController.backToMenu();
    });

    const cardHeight = this.liveMode ? 290 : 250;
    const card = this.add
      .rectangle(0, 0, 276, cardHeight, 0x0c1322, 0.98)
      .setStrokeStyle(1.5, 0xef4444, 0.95);
    const cardGlow = this.add
      .rectangle(0, 0, 276, cardHeight, 0x22131b, 0.35)
      .setStrokeStyle(1, 0xf87171, 0.35);

    const titleY = -cardHeight / 2 + 28;
    const title = this.add
      .text(0, titleY, 'LEAVE MATCH?', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: '900',
        color: '#f8fafc',
        stroke: '#030712',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);

    const message = this.matchMenuController.getConfirmationMessage();
    const subtitleY = titleY + 28;
    const subtitle = this.add
      .text(0, subtitleY, message, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        color: this.liveMode ? '#fca5a5' : '#94a3b8',
        align: 'center',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    const elements: Phaser.GameObjects.GameObject[] = [backdrop, card, cardGlow, title, subtitle];

    let btnStartY = subtitleY + 26;

    if (this.liveMode) {
      const warningBg = this.add
        .rectangle(0, btnStartY + 4, 234, 26, 0x450a0a, 0.95)
        .setStrokeStyle(1, 0xef4444, 0.9);
      const warningText = this.add
        .text(0, btnStartY + 4, '● LIVE BATTLE CONTINUES', {
          fontFamily: MONO_FONT_FAMILY,
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#fca5a5',
          resolution: 2,
        })
        .setOrigin(0.5);
      elements.push(warningBg, warningText);
      btnStartY += 40;
    }

    // 1. KEEP PLAYING BUTTON (min 44 height)
    const keepY = btnStartY + 14;
    const keepBg = this.add
      .rectangle(0, keepY, 234, 44, 0x2563eb, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const keepText = this.add
      .text(0, keepY, 'KEEP PLAYING', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(keepBg, keepText);
    keepBg.on('pointerdown', () => {
      this.platform.hapticSelection();
      this.matchMenuController.backToMenu();
    });
    elements.push(keepBg, keepText);

    // 2. LEAVE MATCH CONFIRM BUTTON (min 44 height)
    const confirmLeaveY = keepY + 52;
    const confirmLeaveBg = this.add
      .rectangle(0, confirmLeaveY, 234, 44, 0xdc2626, 1)
      .setStrokeStyle(1.5, 0xf87171, 1)
      .setInteractive({ useHandCursor: true });
    const confirmLeaveText = this.add
      .text(0, confirmLeaveY, 'LEAVE MATCH', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(confirmLeaveBg, confirmLeaveText);
    confirmLeaveBg.on('pointerdown', () => {
      this.platform.hapticNotification('warning');
      this.matchMenuController.confirmExit();
    });
    elements.push(confirmLeaveBg, confirmLeaveText);

    modal.add(elements);

    if (!this.reducedMotion) {
      modal.setScale(0.95).setAlpha(0);
      this.tweens.add({
        targets: modal,
        scale: 1,
        alpha: 1,
        duration: 120,
        ease: 'Cubic.easeOut',
      });
    }
  }

  private async purchaseUpgrade(
    type: UpgradeType,
    refreshUpgradeRows: Array<() => void>
  ): Promise<void> {
    try {
      await this.backendConnectPromise;
      await purchaseUpgradeThroughCareer(this.careerManager, this.platform, type, {
        onMilestone: (level) =>
          playUpgradeMilestoneCelebration(
            this,
            this.platform,
            level,
            { x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT / 2 + 95 },
            this.reducedMotion
          ),
      });
    } catch (error) {
      console.error('[GameScene] Upgrade purchase failed:', error);
      this.platform.hapticNotification('error');
    } finally {
      refreshUpgradeRows.forEach((refreshRow) => refreshRow());
    }
  }

  private async restartMatch(): Promise<void> {
    const botMatch = await this.careerManager.startBotMatch(this.platform);
    if (!this.scene.isActive()) return;
    this.liveClient?.close();
    this.liveClient = undefined;
    this.scene.restart({ source: 'rematch', mode: 'bot', botMatch });
  }

  private createUpgradedMatchState(): void {
    const modifiers = getPlayerUpgradeModifiers(this.careerManager.getCareer());
    this.playerArmySpeedMultiplier = modifiers.armySpeedMultiplier;
    this.enemyArmySpeedMultiplier = 1;
    this.gameState = createInitialGameState({
      playerModifiers: modifiers,
      battlefieldId: this.battlefieldId,
    });
  }

  private bindLiveMatch(client?: LiveMatchClient): void {
    if (!client) {
      this.showLiveConnectionError();
      return;
    }
    this.liveUnsubscribers.push(
      client.on('state', (state) => {
        if (this.resultModalContainer) return;
        if (
          this.lastAuthoritativeState &&
          state.elapsedTimeSeconds <= this.lastAuthoritativeState.elapsedTimeSeconds
        ) {
          return;
        }
        const arrivals = this.lastAuthoritativeState
          ? deriveLiveCombatArrivals(this.lastAuthoritativeState, state)
          : [];
        this.lastAuthoritativeState = state;
        const { reconciledArmies, matchedVisualRenames } = reconcileLiveArmies(
          this.gameState.armies,
          state.armies
        );
        for (const { fromId, toId } of matchedVisualRenames) {
          const vis = this.armyVisuals.get(fromId);
          if (vis) {
            vis.id = toId;
            this.armyVisuals.delete(fromId);
            this.armyVisuals.set(toId, vis);
          }
        }
        const retainedPredictionIds = new Set(
          reconciledArmies
            .filter((army) => army.id.startsWith('pred_'))
            .map((army) => army.id)
        );
        this.livePredictions = this.livePredictions.filter((prediction) =>
          retainedPredictionIds.has(prediction.armyId)
        );
        this.gameState = {
          ...state,
          territories: applyPendingLiveDispatches(state.territories, this.livePredictions),
          armies: reconciledArmies,
        };
        this.markTerritoriesDirty();
        arrivals.forEach((arrival) => this.onCombatArrival(arrival));
      }),
      client.on('command_rejected', ({ code, sequence }) => {
        this.spawnFloatingText(LOGICAL_WIDTH / 2, 96, code.replaceAll('_', ' '), '#f87171');
        if (sequence === undefined) return;
        const rejected = rejectLivePrediction(
          this.gameState.armies,
          this.livePredictions,
          sequence
        );
        this.livePredictions = rejected.pendingDispatches;
        this.gameState.armies = rejected.armies;
        if (this.lastAuthoritativeState) {
          this.gameState.territories = applyPendingLiveDispatches(
            this.lastAuthoritativeState.territories,
            this.livePredictions
          );
          this.markTerritoriesDirty();
          this.updateTerritoryVisuals();
        }
      }),
      client.on('match_result', (result) => {
        this.handleLiveMatchResult(result, client);
      }),
      client.on('closed', () => {
        if (this.isExiting) return;
        if (!this.resultModalContainer && this.gameState.status === 'playing') {
          const durationSeconds = this.gameState.elapsedTimeSeconds;
          if (trackTerminalMatchEvent({
            name: 'match_quit',
            matchId: this.activeMatchId,
            mode: 'live',
            durationSeconds,
          })) {
            trackEvent({ name: 'live_match_disconnected', matchId: this.activeMatchId });
          }
          this.showLiveConnectionError();
        }
      }),
      client.on('error', ({ code }) => {
        if (this.isExiting) return;
        if (code === 'settlement_failed') {
          this.showLiveConnectionError();
        }
      })
    );
  }

  private showLiveConnectionError(): void {
    if (this.isExiting || this.resultModalContainer) return;
    this.liveClient?.close();
    this.liveClient = undefined;
    this.gameState.status = 'defeat';
    // The server settles the disconnect result on its side; refresh the
    // local career cache so balances reflect that authoritative settlement.
    if (this.careerManager.isRemoteConnected()) {
      void this.careerManager.refreshRemoteCareer().catch(() => undefined);
    }
    this.showSettlementError(new Error('live_connection_closed'));
  }

  public handleLiveMatchResult(result: LiveMatchResult, client?: LiveMatchClient): boolean {
    const processed = processLiveMatchResult(result, {
      isExiting: this.isExiting,
      hasResultModal: Boolean(this.resultModalContainer),
      isStressMode: this.isStressMode,
      settledMatchId: this.settledMatchId,
      applySettlement: (settlement) => {
        this.gameState.status = result.status;
        this.resultPending = false;
        this.careerManager.applyLiveMatchSettlement(settlement);
      },
      renderModal: (status, stats, settlement) => {
        this.renderResultModal(status, stats, settlement);
      },
      closeClient: () => {
        client?.close();
      },
    });

    if (processed) {
      this.settledMatchId = result.matchId;
    }
    return processed;
  }

  private cleanup(): void {
    this.platform.hideBackButton();
    this.matchMenuModalContainer?.destroy();
    this.matchMenuModalContainer = undefined;
    this.syncingModalContainer?.destroy();
    this.syncingModalContainer = undefined;
    sounds.stopBattleMusic();
    this.time.removeAllEvents();
    this.tweens.killAll();
    for (const visual of this.armyVisuals.values()) {
      this.destroyArmyVisual(visual);
    }
    this.armyVisuals.clear();
    for (const vis of this.territoryVisuals.values()) {
      this.tweens.killTweensOf([vis.container, vis.ring, vis.typeText, vis.unitBadge]);
      vis.container.destroy();
    }
    this.territoryVisuals.clear();
    for (const arc of this.dustPool) {
      arc.destroy();
    }
    this.dustPool = [];
    this.dustSimulator.reset();
    this.activeArmyIdsSet.clear();
    this.dominanceDirtyChecker.reset();
    this.input.removeAllListeners();
    this.livePredictions = [];
    this.lastAuthoritativeState = null;
    this.careerSubscription?.();
    this.careerSubscription = undefined;
    for (const unsubscribe of this.liveUnsubscribers) {
      unsubscribe();
    }
    this.liveUnsubscribers = [];
    this.liveClient?.close();
    this.liveClient = undefined;
    this.resultModalContainer?.destroy();
    this.resultModalContainer = undefined;
    for (const unsubscribe of this.lifecycleUnsubscribers) {
      unsubscribe();
    }
    this.lifecycleUnsubscribers = [];
    this.settledMatchId = undefined;
    this.isStressMode = false;
    this.registry?.set('qa_stress_mode', false);
  }
}

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
  PlayerCareer,
  PvpAction,
  Slot,
  stepSimulation,
  TERRITORY_TYPE_PRESENTATION,
  Territory,
  TerritoryType,
  Team,
  UpgradeType,
} from '@crown-clash/game-core';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { CareerManager } from '../career/CareerManager.js';
import { TrainingOverlayUI } from './trainingOverlay.js';
import { TutorialController } from '../tutorial/TutorialController.js';
import {
  applyTrainingSandbox,
  isTrainingTerritoryBright,
  resolveTrainingGuidance,
  TRAINING_DIM_ALPHA,
  TRAINING_TIME_LIMIT_SECONDS,
} from '../tutorial/trainingGuidance.js';
import {
  clearTrainingProgress,
  createTrainingTicket,
  loadTrainingProgress,
  remapTrainingMenuAnalytics,
  saveTrainingProgress,
  TRAINING_ACTIONS_COMPLETE,
  tutorialQuitEvent,
} from '../tutorial/TutorialStatus.js';
import { dismissStartupLoadingShell } from '../ui/StartupLoadingShell.js';
import {
  ARENA_PROP_DISPLAY,
  arenaPropTextureKey,
  ArenaPropKind,
  battlefieldIdFromLaunchData,
  createProceduralTerritoryFallbackTexture,
  drawSocketRimLight,
  getArenaGroundSprite,
  getArenaPropPositions,
  listEnvironmentPropSpritePaths,
  listRuntimeSpritePaths,
  runtimeTerritoryTextureKey,
  territoryArtFootprint,
  resolveTerritoryTextureKey,
  territoryHitAreaSize,
} from '../art/BattlefieldArt.js';
import {
  BOARD_VERTICAL_SPACING,
  createBoardLayout,
  groundPlateImageRect,
  groundPlateScreenRect,
  projectLifted,
  PLINTH_TOP_LIFT,
  type BoardLayout,
  type BoardPoint,
} from '../art/boardProjection.js';
import {
  trackEvent,
  trackTerminalMatchEvent,
  trackUpgradeEvent,
} from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';
import { THEME } from '../theme.js';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';
import {
  LiveMatchClient,
  LiveMatchResult,
  LiveMatchStarted,
  LiveMatchStarted2v2,
  LiveMatchResult2v2,
} from '../api/LiveMatchClient.js';
import {
  shouldActivateStressMode,
  canInitiateBotSettlement,
  canFinalizeBotSettlement,
  processLiveMatchResult,
  isCurrent2v2MatchResult,
  selectLocal2v2Participant,
  track2v2ResultAnalytics,
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
  type SceneViewport,
} from '../ui/Viewport.js';
import { computeResultRankPresentation, computeTwoVTwoResultGrid } from '../ui/ResultModalLayout.js';
import {
  computeTwoVTwoHudLayout,
  computeTwoVTwoSlotBadges,
  formatTeammateBanner,
  formatTwoVTwoSlotBadge,
  slotFromTwoVTwoArmyId,
  TWO_V_TWO_SHARED_CUE_GLYPH,
  TWO_V_TWO_SLOT_SHAPES,
  type TwoVTwoSlotBadge,
} from '../ui/TwoVTwoHudLayout.js';
import {
  buildTwoVTwoResultViewModel,
  formatTwoVTwoResultCellLabel,
  twoVTwoResultHeadline,
  TWO_V_TWO_CASUAL_NOTICE,
  twoVTwoRematchButtonLabel,
} from '../pvp/TwoVTwoResultViewModel.js';
import { createBattlefieldDecorations, createBattlefieldTerrainLayers } from '../ui/BattlefieldArenaLayout.js';
import { drawTowerRoleIcon } from '../ui/TowerRoleIcon.js';
import {
  computeMarchStride,
  createStrideMetrics,
  fastComputeDominance,
  DominanceBarDirtyChecker,
  DustPuffSimulator,
} from '../combat/SmoothnessHelpers.js';
import { createText, FONT_FAMILY, MONO_FONT_FAMILY } from '../ui/TextStyles.js';

/**
 * Debounce for the viewport-driven arena rebuild. The camera re-centers
 * immediately on every resize event; the heavier dressing rebuild waits for
 * the viewport to settle (interactive resizes, Bale expand animation).
 */
const VIEWPORT_RELAYOUT_DEBOUNCE_MS = 200;

/**
 * Rendered army unit sprites: leader/follower x player/enemy x march facing
 * (see tools/blender/generate_units.py). front is also shipped under the
 * legacy no-suffix name, so consumers fall back to it whenever a facing
 * texture is unavailable (bare-instance tests, failed loads).
 */
const UNIT_SPRITE_BASES = [
  'unit_leader_player',
  'unit_leader_enemy',
  'unit_follower_player',
  'unit_follower_enemy',
] as const;
const UNIT_SPRITE_FACINGS = ['front', 'back', 'side'] as const;

interface TerritoryVisual {
  territory: Territory;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  basePlate: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Ellipse;
  /**
   * Unit-count badge: a rounded pill Image (cc_tbadge_* canvas texture) when
   * the texture API is available, otherwise the legacy Rectangle fallback.
   * Both keep the same 22px-tall geometry so layout and tests hold.
   */
  unitBadge: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  /**
   * The badge's resting scale. Texture pill badges render from a
   * 2x-resolution canvas (retina sharpness), so their base scale is 0.5 —
   * pulses must be relative to this base or the pill would permanently
   * double in size (the old absolute setScale(1) pulse bug).
   */
  unitBadgeBaseScale: number;
  unitText: Phaser.GameObjects.Text;
  typeIcon: Phaser.GameObjects.Graphics;
  /** 2v2 only: '⧉' cue marking a team-shared fortress (hidden when lost). */
  sharedCue?: Phaser.GameObjects.Text;
  lastOwner?: Team;
  lastUnits?: number;
}

interface ArmyFollower {
  shadow: Phaser.GameObjects.Image | Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  relX: number;
  relY: number;
  delaySeconds: number;
}

interface ArmyVisual {
  id: string;
  container: Phaser.GameObjects.Container;
  roleAura?: Phaser.GameObjects.Image | Phaser.GameObjects.Arc | Phaser.GameObjects.Ellipse;
  leaderSprite: Phaser.GameObjects.Image;
  leaderShadow: Phaser.GameObjects.Image | Phaser.GameObjects.Ellipse;
  badgeBg: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  badgeText: Phaser.GameObjects.Text;
  badgeColor: number;
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
  /** Board projection (identity for un-migrated battlefields, diorama for crown_cross). */
  private boardLayout: BoardLayout = createBoardLayout('crown_cross', 720);
  /**
   * Arena dressing objects (backdrop, light pools, field plate, roads,
   * border, props) rebuilt whenever the viewport size changes — see
   * applyViewportLayout.
   */
  private arenaVisuals: Phaser.GameObjects.GameObject[] = [];
  /** Bottom HUD chrome repositioned when the viewport height changes. */
  private bottomBarShadow?: Phaser.GameObjects.Rectangle;
  private bottomBarBg?: Phaser.GameObjects.Rectangle;
  /** Debounced viewport rebuild; coalesces rapid resize / expand events. */
  private viewportRelayoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last viewport the arena presentation was built for (idempotency guard). */
  private lastAppliedViewport = { width: 0, height: 0 };
  /**
   * Whether the rendered full-field ground plate texture loaded. On the
   * diorama board the plate bakes raised stone plinths under every socket,
   * so the flat vector socket fills/plinths are skipped (see
   * createArenaBackground / createTerritoryObjects).
   */
  private hasGroundPlate = false;
  /**
   * Ambient cloud shadows drifting over the board (living-board polish):
   * soft dark blobs far above the ground layers but below every gameplay
   * object. Rebuilt with the arena dressing on viewport changes; never
   * created under reduced motion.
   */
  private cloudShadows: Array<{
    image: Phaser.GameObjects.Image;
    /** Lissajous frequencies (rad/ms), phases and amplitudes in screen px. */
    fx: number;
    fy: number;
    px: number;
    py: number;
    ax: number;
    ay: number;
    cx: number;
    cy: number;
  }> = [];
  /** Reusable screen point for per-frame projections (zero allocation in march loops). */
  private boardPoint: BoardPoint = { u: 0, v: 0 };
  private dragGraphics!: Phaser.GameObjects.Graphics;
  private selectionRings: Map<string, Phaser.GameObjects.Ellipse> = new Map();
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
  private legendGroups: Array<{ type: TerritoryType; icon: Phaser.GameObjects.Graphics; word: Phaser.GameObjects.Text }> = [];
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

  // Version-2 (2v2) session UI state. Null outside flagged 2v2 matches.
  private live2v2: {
    payload: LiveMatchStarted2v2;
    badges: readonly TwoVTwoSlotBadge[];
    ally: TwoVTwoSlotBadge;
    allyName: string;
  } | null = null;
  private twoVTwoAppliedStartId: string | null = null;
  private twoVTwoRematchVoteSent = false;
  private twoVTwoSurrenderSent = false;
  private twoVTwoReconnectOverlay?: Phaser.GameObjects.Container;
  private twoVTwoHudLayout: ReturnType<typeof computeTwoVTwoHudLayout> | null = null;

  private enemyArmySpeedMultiplier = 1;

  // Result Modal
  private resultModalContainer?: Phaser.GameObjects.Container;
  private syncingModalContainer?: Phaser.GameObjects.Container;
  private settledMatchId?: string;

  // Match Menu & Navigation
  private matchMenuController!: MatchMenuController;
  private matchMenuModalContainer?: Phaser.GameObjects.Container;
  private isExiting = false;

  // Guided training battle (first-play tutorial): a client-local bot match
  // that never settles, never rewards, and completes only through the five
  // guided actions. See TutorialController/TutorialStatus.
  private trainingMode = false;
  private trainingController?: TutorialController;
  private trainingOverlay?: TrainingOverlayUI;
  private trainingCompletionPending = false;

  // Platform Adapter
  private platform!: PlatformAdapter;
  private lifecycleUnsubscribers: Array<() => void> = [];

  // Runtime art integration: keys of texture files that failed to load
  // (substituted with procedural fallbacks, see BattlefieldArt.ts).
  private missingTerritoryTextures = new Set<string>();

  // Audio Atmosphere Tension
  private lastHeartbeatSecond: number = -1;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // Track texture files that fail to load so the scene can substitute
    // procedural fallbacks instead of rendering broken sprites (the game must
    // never depend on the Blender source pipeline being present).
    this.missingTerritoryTextures.clear();
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      if (typeof file?.key === 'string') {
        this.missingTerritoryTextures.add(file.key);
      }
    });

    // Territory sprites load through the canonical runtime asset manifest
    // (art/asset-manifest.json): the active battlefield's pack preloads every
    // texture key the resolver can emit, so capture-driven owner swaps always
    // reference a loaded texture. Battlefields without dedicated art map to
    // the shared generic pack. Scene settings data is already available here
    // (preload runs before create()), so the derivation matches create().
    const launchData = this.scene.settings.data as {
      botMatch?: BotMatchTicket;
      liveMatch?: LiveMatchStarted;
      liveMatch2v2?: LiveMatchStarted2v2;
    } | undefined;
    const battlefieldId = battlefieldIdFromLaunchData(launchData);
    for (const [textureKey, filePath] of Object.entries(listRuntimeSpritePaths(battlefieldId))) {
      this.load.image(runtimeTerritoryTextureKey(battlefieldId, textureKey), filePath);
    }
    // Shared environment props (trees, bushes, grass, rocks, pennants) render
    // behind territory platforms on every battlefield.
    for (const [textureKey, filePath] of Object.entries(listEnvironmentPropSpritePaths())) {
      this.load.image(arenaPropTextureKey(textureKey as ArenaPropKind), filePath);
    }
    // The battlefield's rendered full-field ground plate (optional: when the
    // ground pack is inactive, createArenaBackground falls back to the flat
    // vector ground).
    const ground = getArenaGroundSprite(battlefieldId);
    if (ground) {
      this.load.image(ground.textureKey, ground.path);
    }

    // Load 2.5D Rendered Army Unit Sprites (one per march facing: toward the
    // viewer, away, and across the board — plus the legacy front view under
    // the no-suffix name as the fallback texture).
    for (const base of UNIT_SPRITE_BASES) {
      for (const facing of UNIT_SPRITE_FACINGS) {
        this.load.image(`${base}_${facing}`, `assets/units/${base}_${facing}.png`);
      }
      this.load.image(base, `assets/units/${base}.png`);
    }
  }

  create(): void {
    setupSceneCamera(this);
    // The viewport height can change after boot (Bale expand applying late,
    // rotation, window resize). The camera re-centers immediately on every
    // resize; the debounced callback rebuilds the arena for the new height
    // so the map always uses the real mobile viewport (applyViewportLayout).
    const initialVp = getSceneViewport(this);
    this.lastAppliedViewport = { width: initialVp.visibleWidth, height: initialVp.visibleHeight };
    bindSceneViewportResize(this, (vp) => {
      this.scheduleViewportRelayout(vp);
    });
    this.initArmyVisualTextures();
    this.reducedMotion =
      this.registry.get('reducedEffects') === true ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);

    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    const user = this.platform.getUser();
    this.careerManager = CareerManager.getInstance(user.id);
    const launchData = this.scene.settings.data as {
      source?: 'menu' | 'rematch';
      mode?: 'bot' | 'live';
      training?: boolean;
      liveClient?: LiveMatchClient;
      liveMatch?: LiveMatchStarted;
      liveMatch2v2?: LiveMatchStarted2v2;
      botMatch?: BotMatchTicket;
      career?: PlayerCareer;
    } | undefined;
    this.liveMode = launchData?.mode === 'live';
    // A guided training battle is a client-local bot match: no server
    // ticket, no settlement, no rewards. Completion is reported by this
    // client after the five guided actions and saved account-wide on the
    // server (the server does not replay or verify the actions — it only
    // gates bot matches and matchmaker tickets on the saved flag).
    this.trainingMode = launchData?.training === true && !this.liveMode;
    this.liveClient = launchData?.liveClient;
    this.liveOpponentName =
      launchData?.liveMatch?.opponentName || 'Opponent';
    if (launchData?.liveMatch2v2) {
      this.initTwoVTwoSession(launchData.liveMatch2v2);
    }
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
      if (this.trainingMode) {
        // Local-only training ticket: never settled, never rewarded, and
        // invisible to the server's bot-match gating.
        const trainingTicket = createTrainingTicket();
        this.activeMatchId = trainingTicket.matchId;
        this.battlefieldId = trainingTicket.battlefieldId;
      } else if (this.isStressMode) {
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
    this.createUpgradedMatchState(launchData?.career ?? this.careerManager.getCareer());
    if (this.liveMode && launchData?.liveMatch2v2) {
      // 2v2: the server's per-slot projected state is authoritative.
      this.gameState = launchData.liveMatch2v2.state;
      this.lastAuthoritativeState = launchData.liveMatch2v2.state;
      this.activeMatchId = launchData.liveMatch2v2.matchId;
      this.battlefieldId = launchData.liveMatch2v2.state.battlefieldId ?? 'crown_cross';
      this.twoVTwoAppliedStartId = launchData.liveMatch2v2.matchId;
    } else if (this.liveMode && launchData?.liveMatch) {
      this.gameState = launchData.liveMatch.state;
      this.lastAuthoritativeState = launchData.liveMatch.state;
      this.activeMatchId = launchData.liveMatch.matchId;
      this.battlefieldId = launchData.liveMatch.state.battlefieldId ?? 'crown_cross';
    }
    this.isExiting = false;
    this.matchMenuController = new MatchMenuController({
      liveMode: this.liveMode,
      matchId: this.activeMatchId,
      confirmationMessage: this.live2v2
        ? 'Surrendering removes you from this battle.\nYour teammate keeps fighting.'
        : this.trainingMode
          ? 'Leave training?\nYour guided progress is saved.'
          : undefined,
      getDurationSeconds: () => wholeMatchSeconds(this.gameState?.elapsedTimeSeconds ?? 0),
      closeLiveClient: () => {
        if (this.liveClient) {
          this.liveClient.close();
          this.liveClient = undefined;
        }
      },
      // Training has no real match to quit: leaving it is a tutorial skip,
      // never a match_quit terminal event.
      trackQuit: (event) => {
        if (this.trainingMode) return false;
        return trackTerminalMatchEvent(event);
      },
      // Training is not a match: ordinary match_* menu navigation events
      // are remapped to the tutorial equivalents (or suppressed) so
      // analytics never reports a fake bot match around the tutorial.
      trackAnalytics: (event) => {
        if (this.trainingMode) {
          const tutorialEvent = remapTrainingMenuAnalytics(event);
          if (tutorialEvent) trackEvent(tutorialEvent);
          return;
        }
        trackEvent(event);
      },
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
    if (this.trainingMode) {
      // Training is not a real match: no match_start analytics, no match
      // settlement, no rewards. Only the stable tutorial_* events fire.
      trackEvent({ name: 'tutorial_started' });
    } else {
      trackEvent({
        name: 'match_start',
        matchId: this.activeMatchId,
        mode: this.is2v2 ? '2v2' : this.liveMode ? 'live' : 'bot',
        source: launchData?.source ?? 'menu',
        battlefieldId: this.battlefieldId,
        ...(this.live2v2
          ? { slot: this.live2v2.payload.slot, teamId: this.live2v2.payload.teamId }
          : {}),
      });
    }
    if (this.liveMode && launchData?.liveMatch2v2) {
      this.bind2v2LiveMatch(this.liveClient);
    } else if (this.liveMode && launchData?.liveMatch) {
      this.bindLiveMatch(this.liveClient);
    }
    this.accumulators = {};
    this.destroyBattlefieldVisuals();
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

    // True 2.5D diorama: the authoritative flat world renders through the
    // battlefield's board projection. Identity layouts (un-migrated maps)
    // project 1:1, so only diorama battlefields shift on screen.
    this.boardLayout = createBoardLayout(this.battlefieldId, getSceneViewport(this).visibleHeight);

    // 1. Draw Arena Background & Connecting Lanes
    this.createArenaBackground();

    // 2. Drag & selection graphics
    this.dragGraphics = this.add.graphics().setDepth(this.boardLayout.overlayDepth(50));

    // Live Drag Badge preview
    this.dragBadgeContainer = this.add.container(0, 0).setDepth(this.boardLayout.overlayDepth(55)).setVisible(false);
    this.dragBadgeShadow = this.add.rectangle(0, 3, 100, 28, 0x000000, 0.32);
    this.dragBadgeBg = this.add
      .rectangle(0, 0, 96, 26, 0x070d1a, 0.96)
      .setStrokeStyle(2, THEME.teams.player.primary, 1);
    this.dragBadgeText = createText(this, 0, 0, '⚔ 10', {
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

    // 6. Guided training battle (first-play tutorial)
    if (this.trainingMode) {
      // The training instruction strip replaces the bottom hint band (the
      // only tower-free band — see BattlefieldArenaLayout), so hide the
      // redundant ordinary-match hint + role legend while training owns it.
      this.bottomHintText?.setVisible(false);
      for (const group of this.legendGroups) {
        group.icon.setVisible(false);
        group.word.setVisible(false);
      }
      this.initTrainingBattle();
    }

    // First-launch readiness: the startup loading shell sits above the
    // canvas (z-index 10000) and captures touches, so it must be gone by
    // the time any interactive scene is ready for input. MenuScene dismisses
    // it after building the menu, but the first-launch auto-training path
    // leaves that build entirely — so the dismissal lives here, at the end
    // of scene construction, with input listeners attached and the training
    // overlay up. The call is idempotent for every other entry path.
    dismissStartupLoadingShell();
  }

  /**
   * Boots the guided training battle: the controller resumes from the
   * player's saved progress marker, the overlay renders the current step,
   * and every controller event routes to analytics + persistence. The
   * battle itself uses the real bot-match controls; only settlement and
   * rewards are suppressed (see update/endMatch guards).
   */
  private initTrainingBattle(): void {
    const playerId = this.platform.getUser().id;
    const progress = loadTrainingProgress(playerId);
    if (progress === TRAINING_ACTIONS_COMPLETE) {
      // Reload/relaunch after a failed save: the guided actions were
      // already performed. Boot silently into the completed state and go
      // straight to the save-retry flow — the actions are never repeated.
      this.trainingController = new TutorialController(() => undefined, {
        resumeCompleted: true,
      });
      this.trainingOverlay = new TrainingOverlayUI(this);
      this.handleTrainingCompleted();
      return;
    }
    this.trainingController = new TutorialController(
      (event) => {
        // Note: the controller emits its first 'started'/'step_entered'
        // synchronously during construction, before the field assignment
        // above completes — the guards below make those construction-time
        // events harmless (the resumed step index is already persisted).
        if (event.type === 'step_entered') {
          if (this.trainingController) {
            saveTrainingProgress(playerId, this.trainingController.currentStepIndex);
          }
          this.renderTrainingStep();
        } else if (event.type === 'step_completed') {
          if (event.stepId) {
            trackEvent({ name: 'tutorial_step_completed', stepId: event.stepId });
          }
        } else if (event.type === 'completed') {
          this.handleTrainingCompleted();
        } else if (event.type === 'skipped') {
          trackEvent(tutorialQuitEvent(event.stepId ?? null));
        }
      },
      { startStep: progress }
    );
    this.trainingOverlay = new TrainingOverlayUI(this);
    this.renderTrainingStep();
  }

  /** Renders the current guided step, including the territory spotlight. */
  private renderTrainingStep(): void {
    const controller = this.trainingController;
    const overlay = this.trainingOverlay;
    if (!controller || !overlay) return;
    const step = controller.currentStep;
    overlay.renderStep(step, controller.currentStepIndex);
    if (!step || !this.gameState) return;

    // Adaptive Clash Royale-style guidance: spotlight the live strongest
    // owned tower and the nearest capturable target, and demonstrate the
    // exact drag gesture with the animated hand hint. Points map through the
    // board projection so the spotlights and the hand hint land on the
    // projected towers (sockets sit on the baked plinth top on the diorama
    // plate).
    const guidance = resolveTrainingGuidance(this.gameState.territories, step.id);
    const toPoint = (id: string): { x: number; y: number; radius: number } | null => {
      const t = this.gameState.territories[id];
      if (!t) return null;
      const anchor = this.projectSocketPoint(t.x, t.y);
      return { x: anchor.u, y: anchor.v, radius: t.radius };
    };
    const spotlightPoints = guidance.spotlightIds
      .map(toPoint)
      .filter((p): p is { x: number; y: number; radius: number } => p !== null);
    overlay.spotlightTargets(spotlightPoints);
    const hintPoints = guidance.hintPath
      .map((id) => this.gameState.territories[id])
      .filter((t): t is Territory => Boolean(t))
      .map((t) => {
        const anchor = this.projectSocketPoint(t.x, t.y);
        return { x: anchor.u, y: anchor.v };
      });
    overlay.showHandHint(hintPoints);
    this.applyTrainingDimming(guidance.spotlightIds);
  }

  /**
   * Dims the field for the Clash Royale-style focus: the current step's
   * spotlighted towers AND every player-owned tower stay bright (capturing
   * must feel rewarding — a freshly captured tower that fades reads as
   * broken, not "mine"); unguided enemy/neutral towers dim. Re-applied once
   * after the creation reveal tweens settle (they write alpha 1 for
   * ~600ms after scene start) and re-applied by renderTrainingStep on every
   * player capture so a tower brightens the moment it turns blue.
   */
  private trainingDimmingToken = 0;

  private applyTrainingDimming(spotlightIds: readonly string[]): void {
    if (!this.trainingMode) return;
    this.trainingDimmingToken += 1;
    const token = this.trainingDimmingToken;
    const apply = () => {
      if (token !== this.trainingDimmingToken || !this.trainingController?.isActive) return;
      for (const [id, vis] of this.territoryVisuals) {
        const owner = this.gameState.territories[id]?.owner;
        const bright = isTrainingTerritoryBright(id, owner, spotlightIds);
        vis.container.setAlpha(bright ? 1 : TRAINING_DIM_ALPHA);
      }
    };
    apply();
    this.time.delayedCall(850, apply);
  }

  /** Restores full board brightness (victory celebration / exit). */
  private clearTrainingDimming(): void {
    this.trainingDimmingToken += 1;
    for (const vis of this.territoryVisuals.values()) {
      vis.container.setAlpha(1);
    }
  }

  /**
   * All guided actions performed: celebrate the Clash Royale-style victory
   * (the enemy base just fell), then save the account-wide completion on
   * the server (fail-closed), then start the first real bot match. The
   * progress marker is cleared and the completion analytics emitted only
   * AFTER the server confirms the write — a failed save keeps the
   * actions-complete state persisted so retries and reloads resume here
   * without repeating the guided actions.
   */
  private handleTrainingCompleted(): void {
    if (this.trainingCompletionPending || this.isExiting) return;
    this.trainingCompletionPending = true;
    const playerId = this.platform.getUser().id;
    this.clearTrainingDimming();
    this.trainingOverlay?.showVictoryCelebration();
    sounds.playVictory();
    this.platform.hapticNotification('success');
    void this.careerManager
      .completeTutorialRemote(this.platform)
      .then(() => {
        // Confirmed server success — only now clear the local progress and
        // emit the completion analytics. Both are exactly-once across
        // retries: no failure path ever reaches this branch.
        clearTrainingProgress(playerId);
        trackEvent({ name: 'tutorial_completed' });
        if (this.isExiting) return;
        this.startFirstRealMatch();
      })
      .catch((error: unknown) => {
        console.warn('[GameScene] Tutorial completion save failed (retryable):', error);
        this.trainingCompletionPending = false;
        // The guided actions are already performed: persist the
        // actions-complete state so a retry, a relaunch, or a full reload
        // resumes straight into this save flow instead of forcing the
        // player to repeat the tutorial actions.
        saveTrainingProgress(playerId, TRAINING_ACTIONS_COMPLETE);
        if (this.isExiting) return;
        // Fail-closed: the tutorial remains incomplete until the server
        // accepts the write. RETRY re-runs the save; nothing is unlocked
        // locally.
        this.trainingOverlay?.setCelebrationSaving(false);
        this.trainingOverlay?.showSaveError(() => this.handleTrainingCompleted());
        this.platform.hapticNotification('error');
      });
  }

  /** Launches the first ordinary bot match after a saved tutorial. */
  private startFirstRealMatch(): void {
    void this.careerManager
      .startBotMatch(this.platform)
      .then((botMatch) => {
        if (!this.scene.isActive()) return;
        sounds.playDispatch();
        this.platform.hapticImpact('medium');
        this.scene.start('GameScene', { source: 'menu', botMatch });
      })
      .catch((error: unknown) => {
        console.warn('[GameScene] First bot match start failed, returning to menu:', error);
        if (!this.scene.isActive()) return;
        // The tutorial IS complete (server-saved); the menu no longer
        // gates entry, so the player can simply press PLAY.
        this.returnToMenu();
      });
  }

  /**
   * Rebuilds the training battlefield in place: winning or losing the
   * training battle never completes (or ends) the tutorial — only the
   * guided actions do. A rare early match end (outside the scripted
   * enemy-base finale) just resets the sandbox so the remaining actions
   * stay performable.
   */
  private resetTrainingBattlefield(): void {
    this.destroyBattlefieldVisuals();
    this.createUpgradedMatchState();
    this.createTerritoryObjects();
    this.markTerritoriesDirty();
    this.accumulators = {};
    this.aiNextTick = PVP_AI_TICK_SECONDS;
    this.botStepRemainder = 0;
    this.selectedSourceIds = [];
    this.hoveredTargetId = null;
    this.lastHoveredFriendlyId = null;
    this.renderTrainingStep();
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

  /** Tracks an arena dressing object so applyViewportLayout can rebuild it. */
  private trackArenaVisual<T extends Phaser.GameObjects.GameObject>(visual: T): T {
    this.arenaVisuals.push(visual);
    return visual;
  }

  /**
   * Coalesces rapid viewport changes into one arena rebuild. Camera
   * re-centering already ran synchronously in the resize handler, so the
   * presentation is never stale for longer than the debounce window.
   */
  private scheduleViewportRelayout(vp: SceneViewport): void {
    if (this.viewportRelayoutTimer !== null) {
      clearTimeout(this.viewportRelayoutTimer);
    }
    this.viewportRelayoutTimer = setTimeout(() => {
      this.viewportRelayoutTimer = null;
      this.applyViewportLayout(vp);
    }, VIEWPORT_RELAYOUT_DEBOUNCE_MS);
  }

  /**
   * Rebuilds the viewport-dependent arena presentation after the visible
   * size changes (Bale expand applying late, rotation, desktop window
   * resize). Safe mid-match: gameplay state and hit radii live in the flat
   * authoritative world space — the board projection is presentation-only,
   * and hit-testing always unprojects through the live layout.
   */
  private applyViewportLayout(vp: SceneViewport): void {
    if (
      vp.visibleWidth === this.lastAppliedViewport.width &&
      vp.visibleHeight === this.lastAppliedViewport.height
    ) {
      return;
    }
    this.lastAppliedViewport = { width: vp.visibleWidth, height: vp.visibleHeight };
    this.boardLayout = createBoardLayout(this.battlefieldId, vp.visibleHeight);

    // Static dressing is cheap to redraw once per settled viewport: destroy
    // and rebuild it for the new height. createArenaBackground covers the
    // whole dressing stack (backdrop, pools, field plate, roads, border,
    // and the environment props at its tail). Prop sway tweens target the
    // tracked images, so they die with their targets here — nothing keeps
    // animating a destroyed sprite.
    for (const visual of this.arenaVisuals) {
      this.tweens.killTweensOf(visual);
      visual.destroy();
    }
    this.arenaVisuals = [];
    this.createArenaBackground();

    // Territory platforms only reposition: their baked sizes come from the
    // layout scale (identity 1 / diorama capped at SCALE_MAX), which does
    // not change with height — no rebuild, no tween restart, no hit-area
    // loss. Depths follow the painter's band at the new screen Y.
    const layout = this.boardLayout;
    const onBakedPlinth = this.hasGroundPlate && layout.isDimetric;
    for (const [id, vis] of this.territoryVisuals.entries()) {
      const territory = this.gameState.territories[id];
      if (!territory) continue;
      const anchor = onBakedPlinth
        ? projectLifted(layout, territory.x, territory.y, PLINTH_TOP_LIFT)
        : layout.project(territory.x, territory.y);
      vis.container.setPosition(anchor.u, anchor.v);
      vis.container.setDepth(layout.gameplayDepth('territory', anchor.v));
    }
    // Active selection rings re-anchor to their sockets.
    for (const [id, ring] of this.selectionRings.entries()) {
      const territory = this.gameState.territories[id];
      if (!territory) continue;
      const anchor = this.projectSocketPoint(territory.x, territory.y);
      ring.setPosition(anchor.u, anchor.v);
    }

    // Bottom HUD chrome follows the viewport bottom edge (and re-fits its
    // width on wide-screen changes).
    const bottomBarY = Math.max(691, vp.visibleHeight - 28);
    this.bottomBarShadow?.setPosition(LOGICAL_WIDTH / 2, bottomBarY + 3);
    this.bottomBarShadow?.setSize(Math.min(364, vp.visibleWidth - 36), 42);
    this.bottomBarBg?.setPosition(LOGICAL_WIDTH / 2, bottomBarY);
    this.bottomBarBg?.setSize(Math.min(360, vp.visibleWidth - 40), 40);
    this.bottomHintText?.setPosition(LOGICAL_WIDTH / 2, bottomBarY + 10);
    const legendY = bottomBarY - 9;
    for (const group of this.legendGroups) {
      group.icon.setY(legendY);
      group.word.setY(legendY);
    }
    this.resultModalContainer?.setPosition(LOGICAL_WIDTH / 2, vp.visibleHeight / 2);
  }

  private createArenaBackground(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const battlefield = getBattlefield(this.battlefieldId);
    const arena = battlefield.visual;
    const layout = this.boardLayout;
    const project = (x: number, y: number): BoardPoint => layout.project(x, y);
    const verticalScale = layout.verticalScale();

    this.trackArenaVisual(
      this.add
        .rectangle(
          LOGICAL_WIDTH / 2,
          visibleHeight / 2,
          visibleWidth,
          visibleHeight,
          0x060a13
        )
        .setDepth(0)
    );

    // Broad team-colored light pools make the two fronts readable without
    // competing with the territory ownership colors. Both board styles
    // anchor the pools to the projected bases and foreshorten with the
    // plane: identity layouts project 1:1, so the pools lock onto the actual
    // base sockets at any viewport height instead of drifting away from
    // them on tall screens.
    const enemyPool = project(200, 110);
    const playerPool = project(200, 610);
    this.trackArenaVisual(
      this.add
        .ellipse(enemyPool.u, enemyPool.v, Math.max(470, visibleWidth) * layout.scale, 260 * verticalScale, THEME.teams.enemy.dark, 0.12)
        .setDepth(0)
    );
    this.trackArenaVisual(
      this.add
        .ellipse(playerPool.u, playerPool.v, Math.max(500, visibleWidth) * layout.scale, 290 * verticalScale, THEME.teams.player.dark, 0.14)
        .setDepth(0)
    );

    const fieldGraphics = this.trackArenaVisual(this.add.graphics().setDepth(1));
    // A denser base lets the location-specific terrain read as a miniature
    // world, rather than a translucent panel floating over the app chrome.
    // With a rendered ground plate it also sits underneath as the fallback
    // colour the plate's bottom feather dissolves into on tall screens.
    fieldGraphics.fillStyle(arena.field, 0.9);
    if (layout.isDimetric) {
      const boardRect = groundPlateScreenRect(layout);
      fieldGraphics.fillRoundedRect(
        boardRect.cx - boardRect.width / 2,
        boardRect.cy - boardRect.height / 2,
        boardRect.width,
        boardRect.height,
        18 * layout.scale
      );
    } else {
      // The flat board's panel anchors to the authored world rect
      // (10..390 x 78..700) and stretches with the projection on tall
      // viewports (identity at 720: 10, 78, 380, 622 — pixel-identical).
      const panelTop = project(10, 78);
      const panelBottom = project(390, 700);
      fieldGraphics.fillRoundedRect(
        panelTop.u,
        panelTop.v,
        panelBottom.u - panelTop.u,
        panelBottom.v - panelTop.v,
        18
      );
    }

    // The rendered full-field ground plate (Blender-baked meadow, dirt roads
    // and socket shading, 380x640 logical px, 1:1 with socket/road geometry).
    // When it is unavailable (pack inactive or texture not loaded) the flat
    // vector ground below still renders the battlefield complete. The texture
    // manager guard is optional-chained because bare-instance unit tests call
    // create() without booting Phaser's texture system. On the diorama board
    // the plate image is centered on the projected world-rect center and
    // carries the baked plinth headroom + slab skirt bands, so its height
    // comes from the image aspect (see groundPlateImageRect).
    const groundSprite = getArenaGroundSprite(this.battlefieldId);
    const ground =
      groundSprite && this.textures?.exists(groundSprite.textureKey) ? groundSprite : null;
    this.hasGroundPlate = ground !== null;
    if (ground) {
      const plateRect = groundPlateImageRect(layout);
      this.trackArenaVisual(
        this.add
          .image(plateRect.cx, plateRect.cy, ground.textureKey)
          .setDisplaySize(plateRect.width, plateRect.height)
          .setDepth(1)
      );

      // Diorama framing, only on viewports taller than the plate image
      // (tablets / desktop portrait, where the whole miniature floats over
      // the backdrop): a soft contact shadow under the baked slab skirt and
      // a faint cool glow behind the board, so it reads as a lit miniature
      // on a table. Phones crop the plate to the band, so both layers stay
      // off there — the check is the whole cost.
      const plateTop = plateRect.cy - plateRect.height / 2;
      const plateBottom = plateRect.cy + plateRect.height / 2;
      if (plateBottom < visibleHeight - 4) {
        const shadowKey = this.ensureRadialGradientTexture(
          'cc_plate_shadow',
          '0, 0, 0',
          [[0, 0.5], [0.6, 0.26], [1, 0]],
        );
        if (shadowKey) {
          this.trackArenaVisual(
            this.add
              .image(plateRect.cx, plateBottom + 12, shadowKey)
              .setDisplaySize(plateRect.width * 1.12, 46)
              .setDepth(1)
          );
        }
      }
      if (plateTop > 4 || plateBottom < visibleHeight - 4) {
        const glowKey = this.ensureRadialGradientTexture(
          'cc_board_glow',
          '168, 210, 255',
          [[0, 0.12], [0.55, 0.05], [1, 0]],
        );
        if (glowKey) {
          this.trackArenaVisual(
            this.add
              .image(plateRect.cx, plateRect.cy, glowKey)
              .setDisplaySize(plateRect.width * 1.9, plateRect.height * 1.5)
              .setDepth(0)
          );
        }
      }
    }

    // Map-specific terrain is deliberately a single static Graphics layer:
    // richer ground composition at no runtime allocation or draw-object cost.
    // The rendered ground plate already bakes this composition, so the vector
    // layers only run on the fallback path. Every shape draws through the
    // board projection (identity layouts project 1:1, so un-migrated maps
    // render pixel-identical to the flat board).
    if (!ground) {
      // Authored terrain shapes use the same expanded ground geometry as
      // Blender. Local territory rings/buildings keep their original scale.
      const terrainVerticalScale = verticalScale * (layout.isDimetric ? BOARD_VERTICAL_SPACING : 1);
      for (const layer of createBattlefieldTerrainLayers(arena.motif, visibleHeight)) {
        if (layer.kind === 'roundedRect') {
          const center = project(layer.x, layer.y);
          const width = layer.width * layout.scale;
          const height = layer.height * terrainVerticalScale;
          fieldGraphics.fillStyle(layer.color, layer.alpha);
          fieldGraphics.fillRoundedRect(center.u - width / 2, center.v - height / 2, width, height, layer.radius * layout.scale);
          if (layer.strokeColor !== undefined && layer.strokeAlpha !== undefined) {
            fieldGraphics.lineStyle(1.5, layer.strokeColor, layer.strokeAlpha);
            fieldGraphics.strokeRoundedRect(center.u - width / 2, center.v - height / 2, width, height, layer.radius * layout.scale);
          }
        } else if (layer.kind === 'ellipse') {
          const center = project(layer.x, layer.y);
          fieldGraphics.fillStyle(layer.color, layer.alpha);
          fieldGraphics.fillEllipse(center.u, center.v, layer.width * layout.scale, layer.height * terrainVerticalScale);
          if (layer.strokeColor !== undefined && layer.strokeAlpha !== undefined) {
            fieldGraphics.lineStyle(1.5, layer.strokeColor, layer.strokeAlpha);
            fieldGraphics.strokeEllipse(center.u, center.v, layer.width * layout.scale, layer.height * terrainVerticalScale);
          }
        } else {
          const a = project(layer.x1, layer.y1);
          const b = project(layer.x2, layer.y2);
          const c = project(layer.x3, layer.y3);
          fieldGraphics.fillStyle(layer.color, layer.alpha);
          fieldGraphics.fillTriangle(a.u, a.v, b.u, b.v, c.u, c.v);
        }
      }
    }

    // Per-motif guide zones are now merely a quiet architectural underlay;
    // the terrain plates above carry the sense of place. Keeping these soft
    // avoids the old card-grid look on compact screens.
    if (!ground) {
      for (const decoration of createBattlefieldDecorations(arena.motif, visibleHeight)) {
        if (decoration.kind === 'zone') {
          const center = project(decoration.x, decoration.y);
          const width = decoration.width * layout.scale;
          const height = decoration.height * verticalScale;
          const left = center.u - width / 2;
          const top = center.v - height / 2;
          fieldGraphics.fillStyle(arena.motifColor, 0.025);
          fieldGraphics.fillRoundedRect(left, top, width, height, 22 * layout.scale);
          fieldGraphics.lineStyle(1, arena.motifColor, 0.08);
          fieldGraphics.strokeRoundedRect(left, top, width, height, 22 * layout.scale);
        }
      }

      // Art Bible lighting: a warm champagne key pool from the top-left and a
      // cool sky-blue ambient pool opposite (two static one-time fills). The
      // rendered ground bakes its own lighting falloff.
      const keyPool = project(130, 180);
      const skyPool = project(280, 520);
      fieldGraphics.fillStyle(0xfff5e6, this.battlefieldId === 'crown_cross' ? 0.02 : 0.07);
      fieldGraphics.fillEllipse(keyPool.u, keyPool.v, 240 * layout.scale, 200 * verticalScale);
      fieldGraphics.fillStyle(0xa8d2ff, this.battlefieldId === 'crown_cross' ? 0.02 : 0.06);
      fieldGraphics.fillEllipse(skyPool.u, skyPool.v, 220 * layout.scale, 240 * verticalScale);

      if (this.battlefieldId === 'crown_cross') {
        // Fixed, low-contrast grass blades and a mowed ring under the keep; all
        // drawn once below playable roads.
        for (let i = 0; i < 150; i++) {
          const x = 25 + ((i * 73) % 350);
          const y = 95 + ((i * 113) % 542);
          const w = 5 + (i % 7);
          const bladeA = project(x - w, y);
          const bladeB = project(x + w, y - 3);
          const bladeC = project(x + w / 2, y + 6);
          fieldGraphics.fillStyle(i % 3 === 0 ? 0x4e8a5c : 0x1f3d28, 0.10);
          fieldGraphics.fillTriangle(bladeA.u, bladeA.v, bladeB.u, bladeB.v, bladeC.u, bladeC.v);
        }
        fieldGraphics.lineStyle(1, 0x1b3624, 0.45);
        for (let y = 312; y < 414; y += 17) {
          const halfWidth = Math.sqrt(Math.max(0, 64 * 64 - (y - 360) ** 2));
          const ringLeft = project(200 - halfWidth, y);
          const ringRight = project(200 + halfWidth, y);
          fieldGraphics.lineBetween(ringLeft.u, ringLeft.v, ringRight.u, ringRight.v);
        }
      } else {
        // Identity fallback board: the legacy grid runs unprojected (this
        // branch never renders a diorama battlefield today).
        fieldGraphics.lineStyle(1, arena.grid, 0.045);
        for (let x = 32; x < LOGICAL_WIDTH - 10; x += 56) {
          fieldGraphics.lineBetween(x, 88, x, visibleHeight - 30);
        }
        for (let y = 100; y < visibleHeight - 28; y += 56) {
          fieldGraphics.lineBetween(18, y, LOGICAL_WIDTH - 18, y);
        }
      }

      // Every map gets a recognizable silhouette, rendered once into the same
      // static Graphics object to stay cheap on low-end Canvas devices.
      fieldGraphics.lineStyle(1.5, arena.motifColor, 0.13);
      fieldGraphics.fillStyle(arena.motifColor, 0.035);
      for (const decoration of createBattlefieldDecorations(arena.motif, visibleHeight)) {
        if (decoration.kind === 'zone') {
          // Zones were already tinted in the floor pass above.
          continue;
        }
        if (decoration.kind === 'line') {
          const a = project(decoration.x1, decoration.y1);
          const b = project(decoration.x2, decoration.y2);
          fieldGraphics.lineBetween(a.u, a.v, b.u, b.v);
        } else if (decoration.kind === 'ellipse') {
          const center = project(decoration.x, decoration.y);
          const rx = (decoration.width * layout.scale) / 2;
          const ry = (decoration.height * verticalScale) / 2;
          const segments = 28;
          for (let index = 0; index < segments; index++) {
            const start = (index / segments) * Math.PI * 2;
            const end = ((index + 1) / segments) * Math.PI * 2;
            fieldGraphics.lineBetween(
              center.u + Math.cos(start) * rx,
              center.v + Math.sin(start) * ry,
              center.u + Math.cos(end) * rx,
              center.v + Math.sin(end) * ry
            );
          }
        } else {
          const a = project(decoration.x1, decoration.y1);
          const b = project(decoration.x2, decoration.y2);
          const c = project(decoration.x3, decoration.y3);
          fieldGraphics.fillTriangle(a.u, a.v, b.u, b.v, c.u, c.v);
        }
      }
    }

    const lanesGraphics = this.trackArenaVisual(this.add.graphics().setDepth(2));
    const connections = battlefield.roads;

    const terrs = this.gameState.territories;

    // Recessed tactical roads. Over a rendered ground plate the dirt roads
    // are already baked in on the same centerlines (organic edges, ruts,
    // dry-grass shoulders), so the dynamic layer thins to a single soft
    // recessed lane plus quiet inlay dots: the tactical routes stay legible
    // without double-painting a second road surface over the baked one.
    // Without a plate the full treatment renders the board complete: a
    // wide shadow cut, a worn stone shoulder, a quieter inset surface,
    // rounded terminals, inlay dots and (Crown Cross) cobbled joints.
    const drawLanePass = (width: number, color: number, alpha: number): void => {
      lanesGraphics.lineStyle(width * layout.scale, color, alpha);
      connections.forEach(([idA, idB]) => {
        const a = terrs[idA];
        const b = terrs[idB];
        if (a && b) {
          const pa = project(a.x, a.y);
          const pb = project(b.x, b.y);
          lanesGraphics.lineBetween(pa.u, pa.v, pb.u, pb.v);
        }
      });
    };
    const drawInlayDots = (alpha: number): void => {
      lanesGraphics.fillStyle(arena.roadInlay, alpha);
      connections.forEach(([idA, idB]) => {
        const a = terrs[idA];
        const b = terrs[idB];
        if (!a || !b) return;
        const distance = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        const dotCount = Math.max(1, Math.floor(distance / 30));
        for (let index = 1; index < dotCount; index++) {
          const progress = index / dotCount;
          const dot = project(
            Phaser.Math.Linear(a.x, b.x, progress),
            Phaser.Math.Linear(a.y, b.y, progress)
          );
          lanesGraphics.fillEllipse(dot.u, dot.v, 2.5 * layout.scale, 2.5 * verticalScale);
        }
      });
    };

    if (ground) {
      drawLanePass(12, 0x020617, 0.06);
      drawInlayDots(0.06);
    } else {
      drawLanePass(22, 0x020617, 0.56);
      drawLanePass(17, arena.road, 0.42);
      drawLanePass(11, arena.road, 0.82);

      // Rounded road terminals blend each lane end into its socket.
      lanesGraphics.fillStyle(arena.road, 0.82);
      connections.forEach(([idA, idB]) => {
        const a = terrs[idA];
        const b = terrs[idB];
        if (a && b) {
          const pa = project(a.x, a.y);
          const pb = project(b.x, b.y);
          lanesGraphics.fillEllipse(pa.u, pa.v, 12 * layout.scale, 12 * verticalScale);
          lanesGraphics.fillEllipse(pb.u, pb.v, 12 * layout.scale, 12 * verticalScale);
        }
      });

      drawInlayDots(0.24);

      if (this.battlefieldId === 'crown_cross') {
        // Cobbled lane joints preserve the exact road centerlines and widths.
        connections.forEach(([idA, idB]) => {
          const a = terrs[idA]; const b = terrs[idB];
          if (!a || !b) return;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const nx = -(b.y - a.y) / d; const ny = (b.x - a.x) / d;
          lanesGraphics.lineStyle(1, 0x111b29, 0.22);
          for (let step = 14; step < d; step += 14) {
            const x = a.x + (b.x - a.x) * step / d;
            const y = a.y + (b.y - a.y) * step / d;
            const crossA = project(x - nx * 5, y - ny * 5);
            const crossB = project(x + nx * 5, y + ny * 5);
            lanesGraphics.lineBetween(crossA.u, crossA.v, crossB.u, crossB.v);
            const dirA = project(x, y);
            const dirB = project(x + (b.x - a.x) / d * 7, y + (b.y - a.y) / d * 7);
            lanesGraphics.lineBetween(dirA.u, dirA.v, dirB.u, dirB.v);
          }
        });
      }
    }

    // Living board: two soft cloud shadows drift over the plane on slow
    // Lissajous paths, so the meadow breathes even while nothing happens.
    // They sit just above the tactical lane layer and below every prop,
    // platform and unit (depth 3 vs 10+), darkening only ground and roads.
    // Never created under reduced motion; two images with two sines per
    // frame is the whole runtime cost.
    this.createAmbientCloudShadows(layout);

    // Ground sockets visually anchor the rendered 2.5D buildings: a soft
    // plinth pool grounds each one, then the socket ring and key-light rim.
    // Over a rendered ground the plate already bakes its own contact
    // shading, so the plinth pool thins. On the diorama plate the baked
    // raised stone plinth + lip under each socket replaces the flat vector
    // pool/fill/rings entirely (the ownership ring traces the lip instead,
    // in createTerritoryObjects). Ground circles foreshorten to ellipses
    // through the board projection (identity: exact circles).
    const skipFlatSockets = this.hasGroundPlate && layout.isDimetric;
    if (!skipFlatSockets) {
      Object.values(terrs).forEach((t) => {
        const art = territoryArtFootprint(this.battlefieldId, t);
        const pool = project(t.x, t.y + 6);
        const socket = project(t.x, t.y + 3);
        lanesGraphics.fillStyle(0x020617, ground ? 0.2 : 0.3);
        lanesGraphics.fillEllipse(
          pool.u,
          pool.v,
          (art.socketRadius + 4) * 2 * layout.scale,
          (art.socketRadius + 4) * 1.3 * verticalScale
        );
        lanesGraphics.fillStyle(arena.socket, 0.96);
        lanesGraphics.fillEllipse(socket.u, socket.v, art.socketRadius * 2 * layout.scale, art.socketRadius * 2 * verticalScale);
        lanesGraphics.lineStyle(2, arena.grid, this.battlefieldId === 'crown_cross' ? 0.32 : 0.76);
        lanesGraphics.strokeEllipse(socket.u, socket.v, art.socketRadius * 2 * layout.scale, art.socketRadius * 2 * verticalScale);
        lanesGraphics.lineStyle(1, arena.roadInlay, 0.2);
        lanesGraphics.strokeEllipse(socket.u, socket.v, (art.socketRadius - 5) * 2 * layout.scale, (art.socketRadius - 5) * 2 * verticalScale);
        // Art Bible key-light rim (single pass, warm champagne) lifts the
        // sockets' toy-like volume without extra display objects.
        if (this.battlefieldId !== 'crown_cross') drawSocketRimLight(lanesGraphics, socket.u, socket.v, art.socketRadius * layout.scale);
      });
    }

    // Rendered environment props (trees, bushes, grass, rocks, pennants):
    // static images between the roads (depth 2) and territory platforms
    // (depth 20), so gameplay objects always stay on top. Placements are
    // provably clear of territories and roads — see BattlefieldArt.
    this.createArenaProps();

    const centerTerr =
      terrs['n_center'] ??
      Object.values(terrs).find(
        (t) => t.owner === 'neutral' && t.tier >= 2 && t.type === 'fortress'
      );
    if (centerTerr && this.battlefieldId !== 'crown_cross') {
      // Ground circles foreshorten/stretch to ellipses through the board
      // projection (identity at 720: exact circles).
      const center = project(centerTerr.x, centerTerr.y);
      lanesGraphics.lineStyle(1.5, THEME.gold, 0.28);
      lanesGraphics.strokeEllipse(center.u, center.v, 116 * layout.scale, 116 * verticalScale);
      lanesGraphics.lineStyle(1, THEME.gold, 0.12);
      lanesGraphics.strokeEllipse(center.u, center.v, 136 * layout.scale, 136 * verticalScale);
    }

    // On the diorama board the extruded slab replaces the flat frame (the
    // plate's baked skirt is the arena edge); identity boards keep the
    // legacy border + gold corner brackets, drawn in world coordinates
    // through the projection so the frame stretches with the whole map on
    // tall viewports (identity at 720: the legacy LOGICAL_HEIGHT anchors).
    if (!layout.isDimetric) {
      const border = this.trackArenaVisual(this.add.graphics().setDepth(3));
      border.lineStyle(1.5, 0x475569, 0.66);
      const frameTopLeft = project(8, 76);
      const frameBottomRight = project(392, 668);
      border.strokeRoundedRect(
        frameTopLeft.u,
        frameTopLeft.v,
        frameBottomRight.u - frameTopLeft.u,
        frameBottomRight.v - frameTopLeft.v,
        16
      );
      border.lineStyle(3, THEME.gold, 0.58);
      const cornerLength = 22;
      const left = 12;
      const right = LOGICAL_WIDTH - 12;
      const top = 80;
      const bottom = 664;
      const bracket = (x1: number, y1: number, x2: number, y2: number): void => {
        const a = project(x1, y1);
        const b = project(x2, y2);
        border.lineBetween(a.u, a.v, b.u, b.v);
      };
      bracket(left, top + cornerLength, left, top);
      bracket(left, top, left + cornerLength, top);
      bracket(right - cornerLength, top, right, top);
      bracket(right, top, right, top + cornerLength);
      bracket(left, bottom - cornerLength, left, bottom);
      bracket(left, bottom, left + cornerLength, bottom);
      bracket(right - cornerLength, bottom, right, bottom);
      bracket(right, bottom, right, bottom - cornerLength);
    }
  }

  /**
   * Living-board ambience: soft cloud shadows drifting over the plane.
   *
   * Two radial-gradient blobs follow slow Lissajous paths centered on the
   * projected plane rect, so they wander the meadow forever without ever
   * leaving the board (no bounds logic, no wrap, no per-frame allocation).
   * Depth 3 keeps them above the tactical lanes (2) and below every prop
   * and gameplay object (10+): they shade ground and roads only. On the
   * near-black backdrop outside the plate a dark shadow is invisible, so
   * tall viewports need no clipping.
   */
  private createAmbientCloudShadows(layout: BoardLayout): void {
    this.cloudShadows = [];
    if (this.reducedMotion) return;
    const textureKey = this.ensureRadialGradientTexture(
      'cc_cloud_shadow',
      '6, 10, 20',
      [[0, 0.13], [0.5, 0.08], [1, 0]],
    );
    if (!textureKey) return;

    const plane = groundPlateScreenRect(layout);
    const TAU = Math.PI * 2;
    const specs = [
      { widthFactor: 0.58, heightFactor: 0.3, periodX: 290_000, periodY: 430_000, phaseX: 0.0, phaseY: 2.1, ampXFactor: 0.42, ampYFactor: 0.34 },
      { widthFactor: 0.42, heightFactor: 0.22, periodX: 230_000, periodY: 350_000, phaseX: 2.4, phaseY: 0.7, ampXFactor: 0.36, ampYFactor: 0.3 },
    ];
    for (const spec of specs) {
      const image = this.trackArenaVisual(
        this.add
          .image(plane.cx, plane.cy, textureKey)
          .setDisplaySize(plane.width * spec.widthFactor, plane.height * spec.heightFactor)
          .setDepth(3)
      );
      this.cloudShadows.push({
        image,
        fx: TAU / spec.periodX,
        fy: TAU / spec.periodY,
        px: spec.phaseX,
        py: spec.phaseY,
        ax: plane.width * spec.ampXFactor,
        ay: plane.height * spec.ampYFactor,
        cx: plane.cx,
        cy: plane.cy,
      });
    }
  }

  /**
   * Generic soft radial-gradient canvas texture (transparent film). Shared
   * by the ambient cloud shadows, the diorama plate drop shadow and the
   * cool board glow, so every soft light blob on the board follows one
   * recipe and one alpha budget.
   */
  private ensureRadialGradientTexture(
    key: string,
    rgb: string,
    stops: ReadonlyArray<readonly [number, number]>,
    size = 128,
  ): string | null {
    const textures = this.textures;
    if (!textures || typeof textures.exists !== 'function') return null;
    if (textures.exists(key)) return key;
    if (typeof document === 'undefined' || !document.createElement) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, size * 0.03, half, half, half);
      for (const [offset, alpha] of stops) {
        gradient.addColorStop(offset, `rgba(${rgb}, ${alpha})`);
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      textures.addCanvas(key, canvas);
      return key;
    } catch (err) {
      console.warn(`[GameScene] Failed to create ${key} texture:`, err);
      return null;
    }
  }

  /**
   * Static environment prop layer: one bottom-anchored image per placement,
   * above the roads/border (depth 2/3) and below every territory platform
   * (depth 20). No per-frame work: images are created once. Pennants get a
   * subtle wind sway (rotation around their bottom anchor) unless reduced
   * motion is on; relayout rebuilds this whole layer and its tweens.
   */
  private createArenaProps(): void {
    const paths = listEnvironmentPropSpritePaths();
    if (Object.keys(paths).length === 0) return;
    const layout = this.boardLayout;
    let swayIndex = 0;
    for (const prop of getArenaPropPositions(this.battlefieldId)) {
      const display = ARENA_PROP_DISPLAY[prop.kind];
      const anchor = layout.project(prop.x, prop.y);
      const image = this.trackArenaVisual(
        this.add
          .image(anchor.u, anchor.v, arenaPropTextureKey(prop.kind))
          .setOrigin(0.5, 1)
          .setDepth(layout.gameplayDepth('prop', anchor.v))
          .setAlpha(display.alpha)
      );
      image.setDisplaySize(display.height * layout.scale, display.height * layout.scale);
      if (prop.kind === 'pennant' && !this.reducedMotion) {
        // Wind sway: a few degrees of rotation around the bottom anchor,
        // phase-staggered so the field's pennants never move in lockstep.
        this.tweens.add({
          targets: image,
          angle: { from: -2.5, to: 2.5 },
          duration: 2300 + (swayIndex % 3) * 320,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        swayIndex += 1;
      }
    }
  }

  private createTerritoryObjects(): void {
    const layout = this.boardLayout;
    const scale = layout.scale;
    const verticalScale = layout.verticalScale();
    // On the diorama plate every socket sits on a baked raised stone
    // plinth (lip top at PLINTH_TOP_LIFT world px), so territory visuals
    // anchor at the plinth TOP and the flat pool/shadow/fill are skipped:
    // the plinth grounds the platform and the ownership ring traces the
    // lip rim (plateRadius mirrors the kit's lip radius 1:1).
    const onBakedPlinth = this.hasGroundPlate && layout.isDimetric;
    Object.values(this.gameState.territories).forEach((territory, index) => {
      const anchor = onBakedPlinth
        ? projectLifted(layout, territory.x, territory.y, PLINTH_TOP_LIFT)
        : layout.project(territory.x, territory.y);
      const container = this.add
        .container(anchor.u, anchor.v)
        .setDepth(layout.gameplayDepth('territory', anchor.v));
      const art = territoryArtFootprint(this.battlefieldId, territory);

      const teamStyle = THEME.teams[territory.owner];

      // Contact shadow under the platform. On the baked plinth the plate's
      // own baked plinth shading grounds the platform, so no vector shadow.
      const groundShadow = onBakedPlinth
        ? null
        : this.add.ellipse(
            0,
            territory.radius * 0.5 * verticalScale,
            art.shadowWidth * scale,
            art.shadowHeight * scale,
            0x000000,
            0.55
          );

      // Match the raised base plate to its battlefield's terrain palette.
      // This retains the high-contrast ownership ring while avoiding the
      // detached black-node look of the former universal plate. Ground
      // circles foreshorten to ellipses on the diorama board. On a baked
      // plinth its stone replaces both the flat fill and extra dark stroke;
      // the single team-colored ownership ring traces the lip rim.
      const terrainSocket = getBattlefield(this.battlefieldId).visual.socket;
      const basePlate = this.add
        .ellipse(
          0,
          4 * verticalScale,
          art.plateRadius * 2 * scale,
          art.plateRadius * 2 * verticalScale,
          terrainSocket,
          onBakedPlinth ? 0 : 0.98
        )
        .setStrokeStyle(2, teamStyle.dark, onBakedPlinth ? 0 : 0.95);

      const ring = this.add
        .ellipse(0, 4 * verticalScale, art.ringRadius * 2 * scale, art.ringRadius * 2 * verticalScale, teamStyle.glow, 0.06)
        .setStrokeStyle(2, teamStyle.primary, 0.92);

      // 2.5D Rendered Fortress Sprite (procedural fallback if the file failed).
      // Sized for presence: the rendered silhouettes carry the map's mass.
      // Visual-only — the hit area stays the authoritative radius*2.5.
      const textureKey = this.ensureTerritoryTexture(this.getTerritoryTextureKey(territory));
      const sprite = this.add
        .image(0, art.spriteY * scale, textureKey)
        .setDisplaySize(art.spriteSize * scale, art.spriteSize * scale);

      // Unit Count Badge Pill: rounded canvas-texture pill with a subtle
      // top-light gradient (batched Image instead of a Shape). Falls back
      // to the legacy stroked rectangle when the texture API is unavailable
      // (bare test instances). Same 22px-tall geometry as before.
      const badgeY = art.badgeY * scale;
      const badgeWidth = territory.tier === 3 ? 46 : territory.tier === 2 ? 42 : 38;
      const badgeTextureKey = this.getOrCreateTerritoryBadgeTexture(teamStyle.primary, badgeWidth);
      const unitBadge = badgeTextureKey
        ? this.add.image(0, badgeY, badgeTextureKey).setDisplaySize(badgeWidth, 22)
        : this.add
            .rectangle(0, badgeY, badgeWidth, 22, 0x070d1a, 0.96)
            .setStrokeStyle(1.5, teamStyle.primary, 1);
      // Resting badge scale, derived from the object itself: 1 for the
      // Rectangle fallback, 0.5 for the 2x-canvas texture pills.
      const unitBadgeBaseScale = unitBadge.scaleX;

      // Unit Count Text with resolution: 2 and bold stroke for retina sharpness
      const unitText = createText(this, 0, badgeY, territory.units.toString(), {
          fontFamily: MONO_FONT_FAMILY,
          fontSize: territory.tier === 3 ? '15px' : '14px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
          resolution: 2,
        })
        .setOrigin(0.5);

      // Tower role icon (replaces the SPD/DEF/PROD text label), centered
      // beneath the unit badge. Drawn once at visual creation; the icon is
      // drawn around the graphics origin so scale pulses stay centered.
      // Badge bottom is badgeY + 11; centering the 16px icon at badgeY + 21
      // keeps its top edge 2 logical px clear of the badge.
      const roleIconSize = 16;
      const typeIcon = this.add.graphics();
      drawTowerRoleIcon(typeIcon, territory.type, -roleIconSize / 2, -roleIconSize / 2, roleIconSize);
      typeIcon.setPosition(art.roleIconX * scale, art.roleIconY * scale);

      // 2v2 shared-territory cue: every tier-3 fortress is a team-shared
      // base (either teammate may dispatch from it). Glyph + banner copy —
      // never color alone.
      let sharedCue: Phaser.GameObjects.Text | undefined;
      if (this.is2v2 && territory.type === 'fortress' && territory.tier === 3) {
        sharedCue = createText(this, art.sharedCueX * scale, art.sharedCueY * scale, TWO_V_TWO_SHARED_CUE_GLYPH, {
            fontFamily: FONT_FAMILY,
            fontSize: '10px',
            fontStyle: 'bold',
            color: '#c7d2fe',
            stroke: '#030712',
            strokeThickness: 1.5,
            resolution: 2,
          })
          .setOrigin(0.5)
          .setDepth(1);
      }

      container.add([
        ...(groundShadow ? [groundShadow] : []),
        ring,
        basePlate,
        sprite,
        unitBadge,
        unitText,
        typeIcon,
        ...(sharedCue ? [sharedCue] : []),
      ]);

      // Make interactive for touch / click (hit area unchanged from legacy)
      container.setSize(territoryHitAreaSize(territory.radius), territoryHitAreaSize(territory.radius));
      container.setInteractive({ useHandCursor: true });

      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.isExiting || this.matchMenuController?.isOpen()) return;
        if (this.is2v2InputBlocked()) return;
        this.startDragFromTerritory(territory.id, pointer);
      });

      this.territoryVisuals.set(territory.id, {
        territory,
        container,
        sprite,
        basePlate,
        ring,
        unitBadge,
        unitBadgeBaseScale,
        unitText,
        typeIcon,
        sharedCue,
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
          y: (art.spriteY - 2) * scale,
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
    const { visibleWidth, visibleHeight, scrollX } = getSceneViewport(this);

    // Compute player HUD label width for dynamic pill sizing
    const playerLabelCandidate = this.computePlayerHudLabel();
    const tempText = createText(this, 0, 0, playerLabelCandidate, {
      fontFamily: FONT_FAMILY,
      fontSize: '11px',
      fontStyle: 'bold',
      resolution: 2,
    }).setVisible(false);
    const textWidth = Math.ceil(tempText.width);
    tempText.destroy();

    const hudLayout = computeHudLayout(visibleWidth, textWidth, {
      isLiveMode: this.liveMode,
      originX: scrollX,
    });
    this.dominanceBarTotalWidth = hudLayout.dominanceBar.trackWidth;
    this.dominanceBarStartX = hudLayout.dominanceBar.bounds.x;

    // 2v2 header: slot badge strip + teammate banner replace the trophy and
    // coin pills (2v2 awards coins after settlement, but does not need an
    // in-match balance pill). The clock is re-aligned
    // by the dedicated layout helper; everything else stays identical.
    let twoVTwoClock = hudLayout.clockPill;
    if (this.is2v2 && this.live2v2) {
      const menuHit = hudLayout.menuButton.hitBounds;
      const twoVTwoLayout = computeTwoVTwoHudLayout(visibleWidth, menuHit, scrollX);
      this.twoVTwoHudLayout = twoVTwoLayout;
      twoVTwoClock = {
        center: twoVTwoLayout.clockPill.center,
        visibleBounds: twoVTwoLayout.clockPill.bounds,
      };
    }

    // 1. Header Glass Panel Bar (y: 0 to 70)
    this.add
      .rectangle(LOGICAL_WIDTH / 2, 39, visibleWidth, 74, 0x000000, 0.36)
      .setDepth(89);

    this.add
      .rectangle(LOGICAL_WIDTH / 2, 35, visibleWidth, 70, 0x090f1d, 0.96)
      .setDepth(90);

    this.add
      .rectangle(LOGICAL_WIDTH / 2, 70, visibleWidth, 1.5, 0x1e293b, 1)
      .setDepth(91);
    this.add
      .rectangle(LOGICAL_WIDTH / 2 - visibleWidth / 4, 70, visibleWidth / 2, 1.5, THEME.teams.player.primary, 0.58)
      .setDepth(92);
    this.add
      .rectangle(
        LOGICAL_WIDTH / 2 + visibleWidth / 4,
        70,
        visibleWidth / 2,
        1.5,
        THEME.teams.enemy.primary,
        0.58
      )
      .setDepth(92);

    // 2. Top Row (y: 20): Profile, Trophies, Coins, Clock, and Audio
    const career = this.careerManager.getCareer();

    // Left: Player Profile Pill with dynamic sizing. In 2v2 the four-slot
    // strip owns the entire left side of this row, so no 1v1 profile layer
    // may be rendered beneath it.
    if (!this.is2v2) {
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

      createText(this, hudLayout.playerPill.center.x, hudLayout.playerPill.center.y, playerLabel, {
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
    }

    // Trophies Pill (skipped in 2v2: casual matches never stake trophies)
    if (!this.is2v2) {
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
      this.hudTrophiesText = createText(this,
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
    }

    // Gold Coins Pill (or Live Opponent Pill in Live PvP) — also skipped in
    // 2v2: the slot badge strip occupies this row instead.
    if (!this.is2v2) {
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

      this.hudCoinsText = createText(this,
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
    }

    // Royal Match Clock Pill (2v2 uses the re-aligned 2v2 clock position)
    this.add
      .rectangle(
        twoVTwoClock.center.x,
        twoVTwoClock.center.y,
        twoVTwoClock.visibleBounds.width,
        twoVTwoClock.visibleBounds.height,
        0x111827,
        0.95
      )
      .setStrokeStyle(1.5, 0xf59e0b, 0.9)
      .setDepth(95);

    this.timerText = createText(this,
        twoVTwoClock.center.x,
        twoVTwoClock.center.y,
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

    // 2v2 slot badge strip + teammate banner (flagged sessions only).
    // Identity: distinct shape glyph + A/B slot label per slot; the YOU
    // badge adds a star marker. Color only reinforces, never carries.
    if (this.is2v2 && this.live2v2 && this.twoVTwoHudLayout) {
      const twoVTwoLayout = this.twoVTwoHudLayout;
      const badgeColor = (teamId: 'a' | 'b'): number => (teamId === 'a' ? 0x3b82f6 : 0xef4444);
      this.live2v2.badges.forEach((badge, index) => {
        const layout = twoVTwoLayout.badges[index];
        if (!layout) return;
        const isAllyBadge = badge.isAlly;
        this.add
          .rectangle(layout.center.x, layout.center.y, layout.bounds.width, layout.bounds.height, 0x0f172a, 0.95)
          .setStrokeStyle(badge.isYou ? 2 : 1.5, badge.isYou ? 0xf59e0b : badgeColor(badge.teamId), 0.95)
          .setDepth(95);
        createText(this,
            layout.center.x,
            layout.center.y,
            formatTwoVTwoSlotBadge(badge),
            {
              fontFamily: FONT_FAMILY,
              fontSize: badge.isYou ? '8px' : '11px',
              fontStyle: 'bold',
              align: 'center',
              lineSpacing: badge.isYou ? -3 : 0,
              color: badge.isYou ? '#fbbf24' : isAllyBadge ? '#93c5fd' : '#fca5a5',
              stroke: '#030712',
              strokeThickness: 1.5,
              resolution: 2,
            }
          )
          .setOrigin(0.5)
          .setDepth(96);
      });

      const allyBadge = this.live2v2.ally;
      const bannerLayout = twoVTwoLayout.teammateBanner;
      createText(this,
          bannerLayout.center.x,
          bannerLayout.center.y,
          formatTeammateBanner(
            allyBadge,
            this.live2v2.allyName,
            this.formatShortName(this.live2v2.allyName, 14)
          ),
          {
            fontFamily: FONT_FAMILY,
            fontSize: '9px',
            fontStyle: 'bold',
            color: '#93c5fd',
            stroke: '#030712',
            strokeThickness: 1.5,
            resolution: 2,
          }
        )
        .setOrigin(0.5)
        .setDepth(96);
    }

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
    this.playerDomText = createText(this, barStartX + 6, barY, '33%', {
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

    this.enemyDomText = createText(this, barStartX + barTotalWidth - 6, barY, '33%', {
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
    this.tugCrown = createText(this, hudLayout.dominanceBar.center.x, barY - 1, '👑', {
        fontSize: '14px',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(98);

    // 4. Bottom Tactical Control Hint Bar
    const bottomBarY = Math.max(691, visibleHeight - 28);
    this.bottomBarShadow = this.add
      .rectangle(LOGICAL_WIDTH / 2, bottomBarY + 3, Math.min(364, visibleWidth - 36), 42, 0x000000, 0.34)
      .setDepth(94);
    this.bottomBarBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, bottomBarY, Math.min(360, visibleWidth - 40), 40, 0x090f1d, 0.94)
      .setStrokeStyle(1.5, 0x334155, 0.92)
      .setDepth(95);

    // Legend: three compact role-icon + word groups on one centered row.
    // Created once here; never redrawn per frame. Reset first: the scene
    // instance survives restarts, so a rematch must not append to the
    // previous match's entries.
    this.legendGroups = [];
    const legendY = bottomBarY - 9;
    const legendIconSize = 13;
    const iconWordGap = 5;
    const groupGap = 18;
    const legendSpecs: Array<{ type: TerritoryType; word: string }> = [
      { type: 'fortress', word: 'SHIELDS' },
      { type: 'barracks', word: 'TRAINS' },
      { type: 'stable', word: 'MARCHES' },
    ];
    const legendWords = legendSpecs.map((spec) =>
      createText(this, 0, legendY, spec.word, {
          fontFamily: MONO_FONT_FAMILY,
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#f8c76a',
          resolution: 2,
        })
        .setOrigin(0, 0.5)
        .setDepth(96)
    );
    const groupWidths = legendWords.map((word) => legendIconSize + iconWordGap + word.width);
    const legendRowWidth =
      groupWidths.reduce((sum, w) => sum + w, 0) + groupGap * (legendSpecs.length - 1);
    let legendCursorX = LOGICAL_WIDTH / 2 - legendRowWidth / 2;
    legendSpecs.forEach((spec, i) => {
      const icon = this.add.graphics();
      drawTowerRoleIcon(icon, spec.type, -legendIconSize / 2, -legendIconSize / 2, legendIconSize);
      icon.setPosition(legendCursorX + legendIconSize / 2, legendY).setDepth(96);
      legendWords[i].setPosition(legendCursorX + legendIconSize + iconWordGap, legendY);
      this.legendGroups.push({ type: spec.type, icon, word: legendWords[i] });
      legendCursorX += groupWidths[i] + groupGap;
    });

    const initialHint = this.is2v2
      ? '⚔ Drag across towers — bases are shared with your ally'
      : this.liveMode
        ? `⚔ Live battle vs ${this.formatShortName(this.liveOpponentName, 12)}`
        : '⚔ Drag across towers to attack or reinforce';
    this.bottomHintText = createText(this, LOGICAL_WIDTH / 2, bottomBarY + 10, initialHint, {
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
      return formatHudName(rawName, maxContentWidth, this.playerHudPrefix());
    }
    return `${this.playerHudPrefix()}${this.formatShortName(rawName, 7)}`;
  }

  /** 2v2 uses the slot's shape glyph (non-color identity); 1v1 keeps 🔵. */
  private playerHudPrefix(): string {
    const mine = this.live2v2?.badges.find((badge) => badge.isYou);
    return mine ? `${mine.shape} ` : '🔵 ';
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
    // Pointer lands in projected screen space: map it back to the
    // authoritative flat world before the circle hit-test (identity layouts
    // unproject 1:1, so legacy hit accuracy is unchanged).
    const world = this.boardLayout.unproject(this.pointerWorldPoint.x, this.pointerWorldPoint.y);
    let closest: Territory | null = null;
    let minDistance = Infinity;

    for (const t of Object.values(this.gameState.territories)) {
      const dist = Phaser.Math.Distance.Between(world.x, world.y, t.x, t.y);
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
      // The player's own gesture replaces the tutorial hand demonstration.
      this.trainingOverlay?.notifyPlayerInteraction();
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

    // The player released the screen: their finger stops being the live
    // gesture demonstration, so the guided touch indicator may resume.
    this.input.on('pointerup', () => {
      this.trainingOverlay?.notifyInteractionEnded();
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

  /**
   * Projects a territory-socket world point onto the surface the camera
   * actually sees there: the baked plinth top on the diorama plate (see
   * PLINTH_TOP_LIFT), or the flat ground everywhere else. Every overlay that
   * anchors to a socket (selection/drag rings, target markers, arrival VFX)
   * draws through this so it hugs the platform instead of sinking into it.
   */
  private projectSocketPoint(x: number, y: number): BoardPoint {
    if (this.hasGroundPlate && this.boardLayout.isDimetric) {
      return projectLifted(this.boardLayout, x, y, PLINTH_TOP_LIFT);
    }
    return this.boardLayout.project(x, y);
  }

  private highlightSelectedTerritory(territoryId: string): void {
    const territory = this.gameState.territories[territoryId];
    if (!territory) return;
    const layout = this.boardLayout;

    let ring = this.selectionRings.get(territoryId);
    if (!ring) {
      // Ground circles foreshorten to ellipses through the board projection
      // (identity layouts: scale/verticalScale are 1, so an exact circle).
      ring = this.add
        .ellipse(
          0,
          0,
          (territory.radius + 6) * 2 * layout.scale,
          (territory.radius + 6) * 2 * layout.verticalScale(),
          0xffffff,
          0
        )
        .setStrokeStyle(3, 0xffffff, 0.95)
        .setDepth(layout.overlayDepth(45));
      this.selectionRings.set(territoryId, ring);
    }
    const anchor = this.projectSocketPoint(territory.x, territory.y);
    ring.setPosition(anchor.u, anchor.v).setVisible(true);
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
    // The whole gesture overlay draws in projected screen space: sources,
    // hovered targets and the free pointer all map through the board layout
    // (identity layouts project 1:1, so un-migrated maps render unchanged).
    // Socket-anchored points (sources, hovered targets) sit on the surface
    // the camera sees there: the baked plinth top on the diorama plate.
    const layout = this.boardLayout;
    const sourceAnchors = selectedTerritories.map((src) => ({
      source: src,
      anchor: this.projectSocketPoint(src.x, src.y),
    }));
    pointer.positionToCamera(this.cameras.main, this.pointerWorldPoint);
    const targetAnchor = target
      ? this.projectSocketPoint(target.x, target.y)
      : { u: this.pointerWorldPoint.x, v: this.pointerWorldPoint.y };
    const targetX = targetAnchor.u;
    const targetY = targetAnchor.v;

    const isHoveringTarget = !!target;
    const isFriendly = target && target.owner === 'player';

    const color = isHoveringTarget
      ? isFriendly
        ? 0x10b981
        : 0xf59e0b
      : THEME.teams.player.light;

    // A dark under-stroke keeps the command path readable over roads and units.
    this.dragGraphics.lineStyle(8, 0x020617, 0.72);
    sourceAnchors.forEach(({ anchor }) => {
      this.dragGraphics.lineBetween(anchor.u, anchor.v, targetX, targetY);
    });
    this.dragGraphics.lineStyle(3.5, color, 0.96);
    sourceAnchors.forEach(({ anchor }) => {
      this.dragGraphics.lineBetween(anchor.u, anchor.v, targetX, targetY);

      const angle = Phaser.Math.Angle.Between(anchor.u, anchor.v, targetX, targetY);
      const stopDistance = target ? (target.radius + 10) * layout.scale : 2;
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
    if (sourceAnchors.length > 1) {
      this.dragGraphics.lineStyle(2, 0x60a5fa, 0.5);
      for (let i = 0; i < sourceAnchors.length - 1; i++) {
        this.dragGraphics.lineBetween(
          sourceAnchors[i].anchor.u,
          sourceAnchors[i].anchor.v,
          sourceAnchors[i + 1].anchor.u,
          sourceAnchors[i + 1].anchor.v
        );
      }
    }

    // Target reticle or end dot
    if (isHoveringTarget && target) {
      const reticleRadius = (target.radius + 10) * layout.scale;
      this.dragGraphics.fillStyle(color, 0.09);
      this.dragGraphics.fillCircle(targetX, targetY, reticleRadius);
      this.dragGraphics.lineStyle(5, 0x020617, 0.78);
      this.dragGraphics.strokeCircle(targetX, targetY, reticleRadius);
      this.dragGraphics.lineStyle(2.5, color, 1);
      this.dragGraphics.strokeCircle(targetX, targetY, reticleRadius);
      this.dragGraphics.lineStyle(2, color, 0.9);
      const tickInner = reticleRadius + 4;
      const tickOuter = reticleRadius + 10;
      for (let index = 0; index < 4; index++) {
        const angle = index * (Math.PI / 2);
        this.dragGraphics.lineBetween(
          targetX + Math.cos(angle) * tickInner,
          targetY + Math.sin(angle) * tickInner,
          targetX + Math.cos(angle) * tickOuter,
          targetY + Math.sin(angle) * tickOuter
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

    const centroidU = sourceAnchors.reduce((sum, { anchor }) => sum + anchor.u, 0) / sourceAnchors.length;
    const centroidV = sourceAnchors.reduce((sum, { anchor }) => sum + anchor.v, 0) / sourceAnchors.length;

    const midX = (centroidU + targetX) / 2;
    const midY = (centroidV + targetY) / 2;

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
        // A real WIN/TIE/-N outcome preview is one of the guided
        // training actions.
        this.trainingController?.onPreviewShown();
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
          if (this.is2v2InputBlocked()) return;
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
            this.trainingController?.onDispatch(sourceIds, targetId);
          }
        }
      }
    }
  }

  update(time: number, delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const deltaSeconds = delta / 1000;

    if (this.trainingController?.isActive) {
      this.trainingController.onTimerTick(deltaSeconds);
    }

    if (this.gameState.status === 'playing' && !this.liveMode) {
      // Training freezes the battle only while the fresh first instruction
      // is unread (and while the completion save is in flight); a resumed
      // tutorial plays under live conditions.
      const trainingPaused =
        this.trainingController?.shouldPauseSimulation === true || this.trainingCompletionPending;
      if (!this.matchMenuController?.isPaused() && !trainingPaused) {
        this.stepBotMatch(deltaSeconds);

        // Update HUD
        this.updateHud();

        // Check Game Over. Training never ends the match through the
        // ordinary flow: the enemy-base capture routes through the
        // completion celebration (frozen battle), and any other early
        // end just resets the sandbox so the remaining guided actions
        // stay performable.
        if (this.gameState.status !== 'playing') {
          if (this.trainingMode) {
            // Victory celebration owns the frozen state — never reset
            // mid-celebration.
            if (!this.trainingCompletionPending) {
              this.resetTrainingBattlefield();
            }
          } else {
            this.endMatch();
          }
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

    // 7. Ambient cloud shadows follow their Lissajous paths (two sines per
    // cloud, zero allocation). Guarded so bare test loops calling update()
    // without a scene timestamp stay safe.
    if (this.cloudShadows.length > 0 && Number.isFinite(time)) {
      for (let index = 0; index < this.cloudShadows.length; index++) {
        const cloud = this.cloudShadows[index];
        cloud.image.setPosition(
          cloud.cx + Math.sin(time * cloud.fx + cloud.px) * cloud.ax,
          cloud.cy + Math.sin(time * cloud.fy + cloud.py) * cloud.ay
        );
      }
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
        this.aiNextTick += PVP_AI_TICK_SECONDS;
        // Scripted training battle: the enemy never acts. Clash
        // Royale-style passive tutorial opponent — the player is the only
        // commander on the field.
        if (this.trainingMode) continue;
        this.executeAiTurn();
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
    // The two north citadels flank the center on Quad Citadel, so its
    // transient map label belongs in the gap between them, not over a base.
    const reveal = this.add.container(this.battlefieldId === 'quad_citadel' ? 200 : 82, 92).setDepth(94);
    const shadow = this.add.rectangle(0, 2, 132, 30, 0x000000, 0.38);
    const panel = this.add
      .rectangle(0, 0, 132, 28, 0x0b1220, 0.96)
      .setStrokeStyle(1.5, battlefield.accent, 0.95);
    const title = createText(this, 0, 0, `◆ ${battlefield.name.toUpperCase()}`, {
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
    // Every arrival effect anchors at the territory's projected screen
    // point, lifted onto the baked plinth top on the diorama plate.
    const anchor = this.projectSocketPoint(vis.territory.x, vis.territory.y);
    const anchorScale = this.boardLayout.scale;

    if (arrival.captured) {
      const capturedByPlayer = arrival.attackerOwner === 'player';
      // A player capture is one of the guided training actions.
      this.trainingController?.onCapture(arrival.targetId, capturedByPlayer);
      // A mid-step capture changes the board: the step's spotlight/hand
      // guidance snapshot was computed when the step ENTERED, so without
      // this re-resolve the demo keeps pointing at a tower the player
      // already owns (stale guidance) until the next step begins. The
      // freshly captured tower also brightens immediately via the ownership
      // dimming rule inside renderTrainingStep.
      if (this.trainingMode && capturedByPlayer && this.trainingController?.isActive) {
        this.renderTrainingStep();
      }
      const isCrownKeep =
        arrival.targetId === 'n_center' ||
        (vis.territory.type === 'fortress' && vis.territory.tier === 2);
      if (isCrownKeep && capturedByPlayer) {
        sounds.playCrownCapture();
      } else if (capturedByPlayer) {
        sounds.playCapture();
      } else {
        sounds.playCombatHit();
      }
      if (!this.reducedMotion) {
        this.cameras.main.shake(
          isCrownKeep ? 160 : 100,
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
        anchor.u,
        anchor.v,
        (vis.territory.radius + 2) * anchorScale,
        teamStyle.glow,
        2.25
      );
      this.spawnCaptureFlash(anchor.u, anchor.v, teamStyle.light);
      this.spawnCaptureBurst(anchor.u, anchor.v, teamStyle.light);

      this.spawnFloatingText(
        anchor.u,
        anchor.v - 20 * anchorScale,
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
        anchor.u,
        anchor.v - 20 * anchorScale,
        `+${arrival.incomingUnits}`,
        '#10b981'
      );
      this.spawnImpactRing(
        anchor.u,
        anchor.v,
        vis.territory.radius * anchorScale,
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
          x: anchor.u + 4,
          duration: 40,
          yoyo: true,
          repeat: 2,
          onComplete: () => {
            vis.container.x = anchor.u;
          },
        });
      }

      this.spawnFloatingText(
        anchor.u,
        anchor.v - 20 * anchorScale,
        fortressBlocked ? `DEFLECT -${arrival.incomingUnits}` : `-${arrival.incomingUnits}`,
        fortressBlocked ? '#fbbf24' : '#ef4444'
      );
      this.spawnImpactRing(
        anchor.u,
        anchor.v,
        vis.territory.radius * anchorScale,
        fortressBlocked ? targetRoleStyle.color : THEME.teams.enemy.light,
        fortressBlocked ? 1.7 : 1.35
      );
      if (fortressBlocked) this.pulseTerritoryRole(vis);
    }
    this.markTerritoriesDirty();
  }

  private spawnCaptureFlash(x: number, y: number, color: number): void {
    if (this.reducedMotion) return;
    const flash = this.add.circle(x, y, 10, color, 0.42).setDepth(this.boardLayout.overlayDepth(30));
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
      .setDepth(this.boardLayout.overlayDepth(31));

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
        .setDepth(this.boardLayout.overlayDepth(32));

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

  private pulseTerritoryRole(vis: TerritoryVisual): void {
    if (this.reducedMotion) return;
    this.tweens.killTweensOf([vis.typeIcon, vis.unitBadge]);
    vis.typeIcon.setScale(1).setAlpha(1);
    // Texture pill badges rest at half scale (2x-resolution canvas), so the
    // pulse must be relative to each object's own base. The old absolute
    // setScale(1) + scale-to-1.18 pulse permanently doubled captured
    // barracks' counters.
    vis.unitBadge.setScale(vis.unitBadgeBaseScale);
    this.tweens.add({
      targets: vis.typeIcon,
      scale: 1.18,
      duration: 90,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
    this.tweens.add({
      targets: vis.unitBadge,
      scale: vis.unitBadgeBaseScale * 1.18,
      duration: 90,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    const float = createText(this, x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(this.boardLayout.overlayDepth(60));

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
    return resolveTerritoryTextureKey(territory);
  }

  /**
   * Returns a texture key guaranteed to exist: if the loaded file failed
   * (missing/corrupt asset), a stylized procedural fallback is generated so
   * the battlefield never renders broken or invisible territory sprites.
   */
  private ensureTerritoryTexture(textureKey: string): string {
    const textures = this.textures;
    const texturesApiReady = !!textures && typeof textures.exists === 'function';
    const runtimeKey = runtimeTerritoryTextureKey(this.battlefieldId, textureKey);
    const fileFailed = this.missingTerritoryTextures?.has(runtimeKey) ?? false;
    if (fileFailed || (texturesApiReady && !textures!.exists(runtimeKey))) {
      return createProceduralTerritoryFallbackTexture(textures, textureKey);
    }
    return runtimeKey;
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
        this.pulseTerritoryRole(vis);
      }

      if (vis.lastOwner !== stateTerritory.owner) {
        vis.lastOwner = stateTerritory.owner;
        const teamStyle = THEME.teams[stateTerritory.owner];
        const onBakedPlinth = this.hasGroundPlate && this.boardLayout.isDimetric;
        vis.basePlate.setStrokeStyle(2, teamStyle.dark, onBakedPlinth ? 0 : 0.95);
        vis.ring.setStrokeStyle(2, teamStyle.primary, 0.95);
        vis.ring.setFillStyle(teamStyle.glow, 0.06);
        // Texture pill badges swap to the new team's texture; the legacy
        // Rectangle fallback keeps restroking.
        const badgeWidth = stateTerritory.tier === 3 ? 46 : stateTerritory.tier === 2 ? 42 : 38;
        const badgeTexture = this.getOrCreateTerritoryBadgeTexture(teamStyle.primary, badgeWidth);
        if (badgeTexture && vis.unitBadge instanceof Phaser.GameObjects.Image) {
          if (vis.unitBadge.texture.key !== badgeTexture) {
            vis.unitBadge.setTexture(badgeTexture).setDisplaySize(badgeWidth, 22);
          }
        } else if (vis.unitBadge instanceof Phaser.GameObjects.Rectangle) {
          vis.unitBadge.setStrokeStyle(1.5, teamStyle.primary);
        }

        const targetTexture = this.ensureTerritoryTexture(this.getTerritoryTextureKey(stateTerritory));
        if (vis.sprite.texture.key !== targetTexture) {
          vis.sprite.setTexture(targetTexture);
        }
      }
    }
  }

  private initArmyVisualTextures(): void {
    if (!this.textures || typeof this.textures.exists !== 'function') return;
    if (typeof document === 'undefined' || !document.createElement) return;

    // 1. Soft Elliptical Shadow Texture (32x16, white fill with radial alpha falloff)
    if (!this.textures.exists('cc_army_shadow')) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const grad = ctx.createRadialGradient(16, 8, 0, 16, 8, 14);
          grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
          grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.85)');
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(16, 8, 15, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          this.textures.addCanvas('cc_army_shadow', canvas);
        }
      } catch (err) {
        console.warn('[GameScene] Failed to create cc_army_shadow texture:', err);
      }
    }

    // 2. Role Aura Ring Textures (Normal and Fortress)
    if (!this.textures.exists('cc_army_aura_normal')) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.beginPath();
          ctx.arc(32, 32, 30, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(32, 32, 28.5, 0, Math.PI * 2);
          ctx.stroke();

          this.textures.addCanvas('cc_army_aura_normal', canvas);
        }
      } catch (err) {
        console.warn('[GameScene] Failed to create cc_army_aura_normal texture:', err);
      }
    }

    if (!this.textures.exists('cc_army_aura_fortress')) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.beginPath();
          ctx.arc(32, 32, 30, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(32, 32, 27, 0, Math.PI * 2);
          ctx.stroke();

          this.textures.addCanvas('cc_army_aura_fortress', canvas);
        }
      } catch (err) {
        console.warn('[GameScene] Failed to create cc_army_aura_fortress texture:', err);
      }
    }
  }

  /**
   * Rounded pill texture for the territory unit-count badge (per team color
   * x tier width). Slightly lighter toward the top so the pill reads as
   * glass catching the key light instead of a flat black rectangle; team
   * color stays on the stroke, so ownership reads exactly as before.
   */
  private getOrCreateTerritoryBadgeTexture(strokeColor: number, width: number): string | null {
    const textures = this.textures;
    if (!textures || typeof textures.exists !== 'function') return null;
    if (typeof document === 'undefined' || !document.createElement) return null;

    const colorHex = strokeColor.toString(16).padStart(6, '0');
    const key = `cc_tbadge_${colorHex}_${width}`;
    if (textures.exists(key)) return key;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = 44;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.scale(2, 2);
      const gradient = ctx.createLinearGradient(0, 0, 0, 22);
      gradient.addColorStop(0, 'rgba(17, 26, 43, 0.97)');
      gradient.addColorStop(0.45, 'rgba(9, 13, 22, 0.96)');
      gradient.addColorStop(1, 'rgba(6, 9, 16, 0.97)');

      const radius = 9;
      ctx.fillStyle = gradient;
      ctx.strokeStyle = `#${colorHex}`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(0.75, 0.75, width - 1.5, 20.5, radius);
      } else {
        ctx.rect(0.75, 0.75, width - 1.5, 20.5);
      }
      ctx.fill();
      ctx.stroke();

      // Inner top light: a faint bright course just under the upper edge.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(2.25, 2.25, width - 4.5, 17.5, radius - 1.5);
      } else {
        ctx.rect(2.25, 2.25, width - 4.5, 17.5);
      }
      ctx.stroke();

      textures.addCanvas(key, canvas);
      return key;
    } catch (err) {
      console.warn(`[GameScene] Failed to create territory badge texture for width ${width}:`, err);
      return null;
    }
  }

  private getOrCreateBadgeTexture(strokeColor: number, width: number): string | null {
    if (!this.textures || typeof this.textures.exists !== 'function') return null;
    if (typeof document === 'undefined' || !document.createElement) return null;

    const colorHex = strokeColor.toString(16).padStart(6, '0');
    const key = `cc_badge_${colorHex}_${width}`;
    if (this.textures.exists(key)) return key;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = 36;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.scale(2, 2);
      const strokeCss = `#${colorHex}`;
      const fillCss = 'rgba(9, 13, 22, 0.94)';

      ctx.fillStyle = fillCss;
      ctx.strokeStyle = strokeCss;
      ctx.lineWidth = 1.5;

      const radius = 4;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(0.75, 0.75, width - 1.5, 18 - 1.5, radius);
      } else {
        ctx.rect(0.75, 0.75, width - 1.5, 18 - 1.5);
      }
      ctx.fill();
      ctx.stroke();

      this.textures.addCanvas(key, canvas);
      return key;
    } catch (err) {
      console.warn(`[GameScene] Failed to create badge texture for width ${width}:`, err);
      return null;
    }
  }

  private destroyArmyVisual(visual: ArmyVisual): void {
    this.tweens.killTweensOf(visual.container);
    if (visual.roleAura) {
      visual.roleAura.destroy();
    }
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

    // Update or create visual for each active army. Marching stays
    // authoritative in flat world space; rendering projects through the
    // board layout (identity layouts project 1:1).
    const layout = this.boardLayout;
    const scale = layout.scale;
    const verticalScale = layout.verticalScale();
    for (const army of armies) {
      const currentX = Phaser.Math.Linear(army.startX, army.targetX, army.progress);
      const currentY = Phaser.Math.Linear(army.startY, army.targetY, army.progress);
      const anchor = layout.projectInto(currentX, currentY, this.boardPoint);
      const visualId = `${army.owner}:${army.id}`;

      let visual = this.armyVisuals.get(visualId);

      if (!visual) {
        const sourceType = this.gameState.territories[army.sourceId]?.type ?? 'barracks';
        const roleStyle = TERRITORY_TYPE_PRESENTATION[sourceType];
        const container = this.add
          .container(anchor.u, anchor.v)
          .setDepth(layout.gameplayDepth('convoy', anchor.v));

        // Screen-space travel direction: the projected march vector drives
        // facing, formation and speedlines so they read correctly on the
        // foreshortened diorama board (identity: the world vector).
        const angle = Phaser.Math.Angle.Between(
          0,
          0,
          (army.targetX - army.startX) * scale,
          (army.targetY - army.startY) * verticalScale * (layout.isDimetric ? BOARD_VERTICAL_SPACING : 1)
        );
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const perpX = -sin;
        const perpY = cos;
        const isFacingLeft = cos < -0.05;
        // March facing from the screen-space travel direction: across the
        // board (side, mirrored for leftward marches), toward the viewer
        // (front) or away (back). Falls back to the legacy front sprite.
        const pickUnitTexture = (role: 'leader' | 'follower'): string => {
          const roleBase =
            army.owner === 'player'
              ? role === 'leader'
                ? 'unit_leader_player'
                : 'unit_follower_player'
              : role === 'leader'
                ? 'unit_leader_enemy'
                : 'unit_follower_enemy';
          const facing =
            Math.abs(cos) >= Math.abs(sin) ? 'side' : sin > 0 ? 'front' : 'back';
          const key = `${roleBase}_${facing}`;
          return this.textures?.exists(key) ? key : roleBase;
        };

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

        let speedLines: Phaser.GameObjects.Graphics | undefined;
        if (sourceType === 'stable') {
          speedLines = this.add.graphics();
          speedLines.lineStyle(2, roleStyle.color, 0.65);
          for (const offset of [-7, 0, 7]) {
            speedLines.lineBetween(
              (-cos * 42 + perpX * offset) * scale,
              (-sin * 42 + perpY * offset) * scale,
              (-cos * 21 + perpX * offset) * scale,
              (-sin * 21 + perpY * offset) * scale
            );
          }
        }

        // 1. Role Aura (Batch-friendly Image running on MultiPipeline).
        // A ground ring: foreshortens with the board plane.
        let roleAura: Phaser.GameObjects.Image | Phaser.GameObjects.Arc | Phaser.GameObjects.Ellipse;
        const auraTexture = sourceType === 'fortress' ? 'cc_army_aura_fortress' : 'cc_army_aura_normal';
        if (this.textures?.exists(auraTexture)) {
          roleAura = this.add
            .image(0, 1, auraTexture)
            .setDisplaySize(30 * scale, 30 * verticalScale)
            .setTint(roleStyle.color);
        } else {
          roleAura = this.add
            .ellipse(0, 1, 30 * scale, 30 * verticalScale, roleStyle.color, 0.1)
            .setStrokeStyle(sourceType === 'fortress' ? 3 : 1.5, roleStyle.color, 0.82);
        }

        // 2. Followers (Shadows & Sprites). Formation offsets are screen
        // units; the board scale keeps them proportionate on the diorama.
        const followers: ArmyFollower[] = [];
        const followerTexture = pickUnitTexture('follower');
        const hasShadowTexture = Boolean(this.textures?.exists('cc_army_shadow'));

        for (const f of followerOffsets) {
          const followerX = f.x * scale;
          const followerY = f.y * scale;
          const shadow = hasShadowTexture
            ? this.add
                .image(followerX, followerY + 7 * scale, 'cc_army_shadow')
                .setDisplaySize(13 * scale, 6 * scale)
                .setTint(0x000000)
                .setAlpha(0.32)
            : this.add.ellipse(followerX, followerY + 7 * scale, 13 * scale, 6 * scale, 0x000000, 0.32);

          const sprite = this.add
            .image(followerX, followerY, followerTexture)
            .setScale(0.19 * scale)
            .setFlipX(isFacingLeft);

          followers.push({
            shadow,
            sprite,
            relX: followerX,
            relY: followerY,
            delaySeconds: f.delay / 1000,
          });
        }

        // 3. Commander / Leader Unit
        const leaderShadow = hasShadowTexture
          ? this.add
              .image(0, 9 * scale, 'cc_army_shadow')
              .setDisplaySize(18 * scale, 7 * scale)
              .setTint(0x000000)
              .setAlpha(0.38)
          : this.add.ellipse(0, 9 * scale, 18 * scale, 7 * scale, 0x000000, 0.38);

        const leaderTexture = pickUnitTexture('leader');
        const leaderSprite = this.add
          .image(0, 0, leaderTexture)
          .setScale(0.25 * scale)
          .setFlipX(isFacingLeft);

        // 4. High-contrast Troop Count Pill Badge. In 2v2 the marching
        // army is attributed to its dispatching slot via the shape glyph
        // parsed from the server army id (predictions use my own slot).
        // Put the label ahead of downward marches so it does not cover the rear rank.
        const badgeY = (this.battlefieldId === 'crown_cross' ? sin > 0.15 ? 24 : -23 : -19) * scale;
        const slotAttribution2v2 = this.twoVTwoArmyShape(army);
        const initialUnits = slotAttribution2v2
          ? `${slotAttribution2v2} ${roleStyle.label} ${army.units}`
          : `${roleStyle.label} ${army.units}`;
        const badgeWidth = Math.max(42, initialUnits.length * 7 + 14);

        const badgeKey = this.getOrCreateBadgeTexture(roleStyle.color, badgeWidth);
        let badgeBg: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
        if (badgeKey && this.textures?.exists(badgeKey)) {
          badgeBg = this.add.image(0, badgeY, badgeKey).setDisplaySize(badgeWidth, 18);
        } else {
          badgeBg = this.add
            .rectangle(0, badgeY, badgeWidth, 18, 0x090d16, 0.94)
            .setStrokeStyle(1.5, roleStyle.color, 1);
        }

        const badgeText = createText(this, 0, badgeY, initialUnits, {
            fontFamily: FONT_FAMILY,
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2.5,
            resolution: 2,
          })
          .setOrigin(0.5);

        // 5. Grouped Render Hierarchy to prevent MultiPipeline <-> ShapePipeline thrashing:
        // Layer 0: Role aura (MultiPipeline)
        // Layer 1: Follower shadows & Leader shadow (MultiPipeline - cc_army_shadow)
        // Layer 2: Speedlines (if stable)
        // Layer 3: Follower sprites & Leader sprite (MultiPipeline - unit textures)
        // Layer 4: Badge background (MultiPipeline - cc_badge_...)
        // Layer 5: Badge text (Canvas Text)
        const elementsToAdd: Phaser.GameObjects.GameObject[] = [];
        if (roleAura) elementsToAdd.push(roleAura);
        for (const f of followers) elementsToAdd.push(f.shadow);
        elementsToAdd.push(leaderShadow);
        if (speedLines) elementsToAdd.push(speedLines);
        for (const f of followers) elementsToAdd.push(f.sprite);
        elementsToAdd.push(leaderSprite);
        elementsToAdd.push(badgeBg);
        elementsToAdd.push(badgeText);

        container.add(elementsToAdd);

        const lastOffset = followerOffsets[followerOffsets.length - 1] ?? { x: 0, y: 0 };
        visual = {
          id: visualId,
          container,
          roleAura,
          leaderSprite,
          leaderShadow,
          badgeBg,
          badgeText,
          badgeColor: roleStyle.color,
          followers,
          // Screen-space rear offset (already scaled) for the dust trail.
          rearOffset: { x: lastOffset.x * scale, y: lastOffset.y * scale },
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
        visual.container.setPosition(anchor.u, anchor.v);
        visual.container.setDepth(layout.gameplayDepth('convoy', anchor.v));
        const slotAttribution2v2 = this.twoVTwoArmyShape(army);
        const unitsStr = slotAttribution2v2
          ? `${slotAttribution2v2} ${visual.roleLabel} ${army.units}`
          : `${visual.roleLabel} ${army.units}`;
        if (visual.badgeText.text !== unitsStr) {
          visual.badgeText.setText(unitsStr);
          const newWidth = Math.max(42, unitsStr.length * 7 + 14);
          if (visual.badgeBg instanceof Phaser.GameObjects.Rectangle) {
            visual.badgeBg.setSize(newWidth, 18);
          } else {
            const newKey = this.getOrCreateBadgeTexture(visual.badgeColor, newWidth);
            if (newKey && visual.badgeBg.texture?.key !== newKey) {
              visual.badgeBg.setTexture(newKey);
              visual.badgeBg.setDisplaySize(newWidth, 18);
            }
          }
        }

        // Emit rhythmic dust puff behind rearmost follower. Dust items live
        // in screen space; the puff trails the projected convoy rear.
        visual.dustTimer -= deltaSeconds;
        if (!this.reducedMotion && visual.dustTimer <= 0) {
          visual.dustTimer = visual.dustInterval;
          this.dustSimulator.spawn(
            anchor.u + visual.rearOffset.x,
            anchor.v + visual.rearOffset.y,
            visual.dustColor
          );
        }
      }

      if (!this.reducedMotion) {
        visual.phaseSeconds += deltaSeconds;
        const leaderStride = computeMarchStride(visual.phaseSeconds, 0, this.sharedStrideMetrics);
        visual.leaderSprite.y = leaderStride.leaderY;
        visual.leaderSprite.setScale(leaderStride.leaderScaleX * scale, leaderStride.leaderScaleY * scale);

        const followerCount = visual.followers.length;
        for (let fIdx = 0; fIdx < followerCount; fIdx++) {
          const f = visual.followers[fIdx];
          const fStride = computeMarchStride(visual.phaseSeconds, f.delaySeconds, this.sharedStrideMetrics);
          f.sprite.y = f.relY + fStride.followerYOffset;
          f.sprite.setScale(fStride.followerScaleX * scale, fStride.followerScaleY * scale);
        }
      }
    }

    if (!this.reducedMotion) {
      this.dustSimulator.update(deltaSeconds);
      const dustItems = this.dustSimulator.getItems();
      const poolLen = this.dustPool.length;
      const dustLayout = this.boardLayout;
      for (let i = 0; i < poolLen; i++) {
        const item = dustItems[i];
        const arc = this.dustPool[i];
        if (!arc || !item) continue;
        if (item.active) {
          arc.setVisible(true);
          arc.setPosition(item.x, item.y);
          // Painter's depth: a puff sorts with the gameplay band it sits in.
          arc.setDepth(dustLayout.gameplayDepth('dust', item.y));
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
        const defaultHint = this.is2v2
          ? '⚔ Drag across towers — bases are shared with your ally'
          : this.liveMode
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
    // Training battles never settle: no coins, trophies, missions, or
    // match settlement may ever originate from the guided battle.
    if (this.trainingMode) return;
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
        // The locally observed status is sent along as diagnostic-only,
        // untrusted evidence so the server can log a structured warning
        // when it disagrees with its own authoritative settlement.
        settlement = await this.careerManager.recordMatchResultRemote(
          this.matchActions,
          this.activeMatchId,
          this.platform,
          this.gameState.status as 'victory' | 'defeat' | 'draw'
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
    const modal = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(200);
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

    const title = createText(this, 0, -275, titleText, {
        fontFamily: FONT_FAMILY,
        fontSize: '32px',
        fontStyle: '900',
        color: titleColor,
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5);

    const subtitle = createText(this, 0, -240, subText, {
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
    const rankPresentation = computeResultRankPresentation(settlement.rankPromoted);
    const rankBanner = this.add
      .rectangle(0, rankPresentation.rankY, 280, 36, 0x111c33, 0.95)
      .setStrokeStyle(1.5, rankTier.color, 0.9)
      .setVisible(rankPresentation.showRankSummary);

    const rankText = createText(this, 0, rankPresentation.rankY - 6, `${rankTier.badge} ${rankTier.name.toUpperCase()} (🏆 ${settlement.newCareer.trophies})`, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setVisible(rankPresentation.showRankSummary);

    const leagueProgress = getLeagueProgress(settlement.newCareer.trophies);
    const rankProgressTrack = this.add
      .rectangle(0, rankPresentation.rankY + 10, 252, 4, 0x080d18, 1)
      .setVisible(rankPresentation.showRankSummary);
    const rankProgressFill = this.add
      .rectangle(-126, rankPresentation.rankY + 10, Math.max(3, 252 * leagueProgress.progress), 3, rankTier.color, 1)
      .setOrigin(0, 0.5)
      .setVisible(rankPresentation.showRankSummary);

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

    const trophyLabel = createText(this, trophyCardX, trophyCardY - 17, 'TROPHIES', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    const trophyValue = createText(this, trophyCardX, trophyCardY + 10, `${trophyDeltaStr} 🏆`, {
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

    const goldLabel = createText(this, goldCardX, goldCardY - 17, 'GOLD REWARD', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    const goldValue = createText(this, goldCardX, goldCardY + 10, `+${settlement.breakdown.totalCoins} 🪙`, {
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

    const bonusChipText = createText(this, 0, -108, [primaryBreakdown.join('  •  '), secondaryBreakdown.join('  •  ')].filter(Boolean).join('\n'), {
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

    const matchStatsText = createText(this,
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
    if (rankPresentation.showPromotion) {
      promoContainer = this.add.container(0, rankPresentation.rankY);
      const promoGlow = this.add
        .rectangle(0, 0, 284, 28, 0x3b2f0b, 1)
        .setStrokeStyle(2, 0xfde047, 1);
      const promoText = createText(this, 0, 0, `🎉 PROMOTED TO ${rankTier.name.toUpperCase()}!`, {
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

    const upgradeBalanceText = createText(this, 0, -25, '', {
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
      const label = createText(this, row.x, row.y - 7, '', {
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
      const buyText = createText(this, row.x, row.y + 13, '', {
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

    const btnText = createText(this, 0, btnY, 'PLAY AGAIN ⚔', {
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

    const shareText = createText(this, 0, shareY, 'SHARE RESULT 📢', {
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
    const menuText = createText(this, 0, menuY, 'MAIN MENU', {
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

    const { visibleHeight } = getSceneViewport(this);
    const modal = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(220);
    this.resultModalContainer = modal;

    const card = this.add
      .rectangle(0, 0, 300, 270, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0xef4444, 0.95);
    const liveConnectionLost = this.liveMode;
    const title = createText(this, 0, -62, liveConnectionLost ? 'CONNECTION LOST' : 'SYNC FAILED', {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        fontStyle: '900',
        color: '#f87171',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    const message = createText(this,
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
    const retryText = createText(this, 0, 55, liveConnectionLost ? 'MAIN MENU' : 'RETRY SYNC', {
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
    const menuText = createText(this, 0, 105, 'MAIN MENU', {
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
    const modal = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(210);
    this.syncingModalContainer = modal;

    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x000000, 0.65)
      .setInteractive();
    const card = this.add
      .rectangle(0, 0, 280, 140, 0x0c1322, 0.98)
      .setStrokeStyle(2, 0x3b82f6, 0.9);
    const title = createText(this, 0, -25, 'BATTLE COMPLETE', {
        fontFamily: FONT_FAMILY,
        fontSize: '18px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitle = createText(this, 0, 15, 'SYNCING RESULT...', {
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
    if (this.trainingMode) {
      // Leaving mid-training is a tutorial skip, not a match quit: the
      // progress marker survives, so the next launch resumes the remaining
      // guided actions. The 'skipped' controller event tracks analytics.
      this.trainingController?.skip();
    }
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
    const modal = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(150);
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
    const title = createText(this, 0, titleY, titleText, {
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
      const warningText = createText(this, 0, startBtnY + 4, '● LIVE BATTLE CONTINUES', {
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
    const resumeText = createText(this, 0, resumeY, 'RESUME', {
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
    const soundText = createText(this, 0, soundY, sounds.isMuted() ? 'SOUND: OFF' : 'SOUND: ON', {
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

    // 3. LEAVE MATCH BUTTON (min 44 height). 2v2 renames it to SURRENDER:
    // leaving mid-battle is an explicit surrender (§5.0).
    const leaveY = soundY + 52;
    const leaveBg = this.add
      .rectangle(0, leaveY, 234, 44, 0x1e1520, 1)
      .setStrokeStyle(1.5, 0xef4444, 0.9)
      .setInteractive({ useHandCursor: true });
    const leaveText = createText(this, 0, leaveY, this.is2v2 ? 'SURRENDER' : 'LEAVE MATCH', {
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
    const modal = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(150);
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
    const title = createText(this, 0, titleY, 'LEAVE MATCH?', {
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
    const subtitle = createText(this, 0, subtitleY, message, {
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
      const warningText = createText(this, 0, btnStartY + 4, '● LIVE BATTLE CONTINUES', {
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
    const keepText = createText(this, 0, keepY, 'KEEP PLAYING', {
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

    // 2. LEAVE/SURRENDER CONFIRM BUTTON (min 44 height). In 2v2 this sends
    // the one-shot surrender before exit; repeated taps cannot send twice.
    const confirmLeaveY = keepY + 52;
    const confirmLeaveBg = this.add
      .rectangle(0, confirmLeaveY, 234, 44, 0xdc2626, 1)
      .setStrokeStyle(1.5, 0xf87171, 1)
      .setInteractive({ useHandCursor: true });
    const confirmLeaveText = createText(this, 0, confirmLeaveY, this.is2v2 ? 'SURRENDER' : 'LEAVE MATCH', {
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
      if (this.is2v2 && !this.twoVTwoSurrenderSent) {
        this.twoVTwoSurrenderSent = true;
        try {
          this.liveClient?.sendSurrender();
        } catch (error) {
          console.warn('[GameScene] Surrender send failed:', error);
        }
      }
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

  private createUpgradedMatchState(career = this.careerManager.getCareer()): void {
    const modifiers = getPlayerUpgradeModifiers(career);
    this.playerArmySpeedMultiplier = modifiers.armySpeedMultiplier;
    this.enemyArmySpeedMultiplier = 1;
    this.gameState = createInitialGameState({
      playerModifiers: modifiers,
      battlefieldId: this.battlefieldId,
    });
    // Clash Royale-style sandbox: the training player is overpowered and
    // the scripted enemy HQ is weak, so every guided action (including the
    // finale base capture) succeeds. Client-local training only — the
    // state never settles, so no economy value is touched.
    if (this.trainingMode) {
      applyTrainingSandbox(this.gameState.territories);
      this.gameState.timeLimitSeconds = TRAINING_TIME_LIMIT_SECONDS;
    }
  }

  /** Destroys every territory/army visual (scene restart or 2v2 rematch). */
  private destroyBattlefieldVisuals(): void {
    for (const vis of this.territoryVisuals.values()) {
      this.tweens.killTweensOf([vis.container, vis.ring, vis.typeIcon, vis.unitBadge]);
      vis.container.destroy();
    }
    this.territoryVisuals.clear();
    for (const visual of this.armyVisuals.values()) {
      this.destroyArmyVisual(visual);
    }
    this.armyVisuals.clear();
  }

  private bindLiveMatch(client?: LiveMatchClient): void {
    if (!client) {
      this.showLiveConnectionError();
      return;
    }
    this.liveUnsubscribers.push(
      client.on('state', (state) => {
        if (this.resultModalContainer) return;
        this.applyLiveServerState(state);
      }),
      client.on('command_rejected', ({ code, sequence }) => {
        this.rejectLiveCommand(code, sequence);
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

  /**
   * Applies one authoritative server state snapshot on top of the local
   * prediction layer. Shared by the 1v1 `state` and 2v2 `state_2v2` paths —
   * both projections carry the same GameState shape for the local player.
   */
  private applyLiveServerState(state: GameState): void {
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
  }

  /**
   * Server rejected a command: roll back that prediction and re-apply the
   * last authoritative territories. Shared by 1v1 and 2v2 rejections.
   */
  private rejectLiveCommand(code: string, sequence: number | undefined): void {
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
  }

  // ── Version-2 (2v2) session UI ─────────────────────────────────────────

  /** True while this scene is running a flagged 2v2 match. */
  private get is2v2(): boolean {
    return this.live2v2 !== null;
  }

  private initTwoVTwoSession(payload: LiveMatchStarted2v2): void {
    const badges = computeTwoVTwoSlotBadges(payload.slot);
    const ally = badges.find((badge) => badge.isAlly);
    const allyEntry = payload.players.find((entry) => entry.slot === ally?.slot);
    this.live2v2 = {
      payload,
      badges,
      ally: ally ?? badges[0],
      allyName: allyEntry?.displayName ?? 'Ally',
    };
    this.twoVTwoAppliedStartId = payload.matchId;
    this.twoVTwoRematchVoteSent = false;
    this.twoVTwoSurrenderSent = false;
  }

  private bind2v2LiveMatch(client?: LiveMatchClient): void {
    if (!client) {
      this.show2v2AbandonedOverlay('connection_closed');
      return;
    }
    this.liveUnsubscribers.push(
      client.on('state_2v2', ({ state }) => {
        if (this.resultModalContainer) return;
        this.applyLiveServerState(state);
      }),
      client.on('command_rejected_2v2', ({ code, sequence }) => {
        this.rejectLiveCommand(code, sequence);
      }),
      client.on('match_started_2v2', (payload) => {
        this.handle2v2MatchStarted(payload);
      }),
      client.on('match_result_2v2', (result) => {
        this.handle2v2MatchResult(result, client);
      }),
      client.on('reconnecting', ({ attempt }) => {
        if (this.isExiting) return;
        this.show2v2ReconnectOverlay(attempt);
      }),
      client.on('reconnected', () => {
        this.hide2v2ReconnectOverlay();
      }),
      client.on('reconnect_failed', ({ code }) => {
        if (this.isExiting) return;
        this.hide2v2ReconnectOverlay();
        this.show2v2AbandonedOverlay(code);
      }),
      client.on('rematch_started', () => {
        if (this.isExiting) return;
        this.handle2v2RematchStarted(client);
      }),
      client.on('expired', ({ matchId }) => {
        if (this.isExiting) return;
        this.handle2v2MatchExpired(matchId);
      }),
      client.on('closed', () => {
        // Fires only when the v2 session is not active (terminal states).
        if (this.isExiting) return;
        if (this.resultModalContainer || this.twoVTwoReconnectOverlay) return;
        if (this.gameState.status === 'playing') {
          // Terminal dedup: a later match_result for the same match will not
          // re-emit match_end after this quit (shared terminalMatchIds set).
          trackTerminalMatchEvent({
            name: 'match_quit',
            matchId: this.activeMatchId,
            mode: '2v2',
            durationSeconds: this.gameState.elapsedTimeSeconds,
          });
          this.show2v2AbandonedOverlay('connection_closed');
        }
      }),
      client.on('error', ({ code }) => {
        if (this.isExiting) return;
        if (this.resultModalContainer) return;
        if (code === 'settlement_failed') {
          this.show2v2AbandonedOverlay(code);
        }
      })
    );
  }

  /**
   * Version-2 match start. Exactly one of:
   * - initial/resync snapshot for the current match id: applied once;
   * - the rematch's start: full in-place battlefield reset.
   */
  private handle2v2MatchStarted(payload: LiveMatchStarted2v2): void {
    if (this.isExiting) return;
    if (payload.matchId === this.twoVTwoAppliedStartId) {
      // Resync (§5.1): apply the authoritative snapshot exactly once. The
      // pending predictions are already dropped client-side; local state
      // becomes the server state with no prediction replay.
      this.livePredictions = [];
      this.gameState = payload.state;
      this.lastAuthoritativeState = payload.state;
      this.markTerritoriesDirty();
      this.hide2v2ReconnectOverlay();
      return;
    }
    this.resetFor2v2Rematch(payload);
  }

  /** Rebuilds the battlefield in place for the identical-slot rematch. */
  private resetFor2v2Rematch(payload: LiveMatchStarted2v2): void {
    this.resultModalContainer?.destroy();
    this.resultModalContainer = undefined;
    this.syncingModalContainer?.destroy();
    this.syncingModalContainer = undefined;
    this.initTwoVTwoSession(payload);
    this.activeMatchId = payload.matchId;
    this.gameState = payload.state;
    this.lastAuthoritativeState = payload.state;
    this.livePredictions = [];
    this.settledMatchId = undefined;
    this.resultPending = false;
    this.destroyBattlefieldVisuals();
    this.createTerritoryObjects();
    this.markTerritoriesDirty();
    this.sounds2v2RestartMusic();
    trackEvent({
      name: 'match_start',
      matchId: payload.matchId,
      mode: '2v2',
      source: 'rematch',
      battlefieldId: this.battlefieldId,
      slot: payload.slot,
      teamId: payload.teamId,
    });
  }

  private sounds2v2RestartMusic(): void {
    if (!sounds.isMuted()) {
      sounds.startBattleMusic();
    }
  }

  private handle2v2MatchResult(result: LiveMatchResult2v2, client?: LiveMatchClient): void {
    if (this.isExiting || this.resultModalContainer) return;
    // Current-match guard: only a result for the ACTIVE 2v2 match with a
    // well-formed participant set may touch the session. A delayed result
    // from a previous match (after a rematch started) is dropped before any
    // state, career, analytics, music, or modal mutation.
    const mySlot = this.live2v2?.payload.slot ?? -1;
    const myTeamId = this.live2v2?.payload.teamId ?? null;
    if (!isCurrent2v2MatchResult({ result, activeMatchId: this.activeMatchId, mySlot, myTeamId })) return;
    if (this.settledMatchId === result.matchId) return;
    this.settledMatchId = result.matchId;

    // Session-less results can only be cancelled (no per-slot view); the
    // view-model slot is cosmetic there.
    const viewSlot: Slot = mySlot === -1 ? 0 : mySlot;
    const model = buildTwoVTwoResultViewModel(
      result,
      viewSlot,
      this.rosterNameMap()
    );
    this.hide2v2ReconnectOverlay();

    // Career cache: the server already persisted the per-participant
    // settlement (casual policy: coin rewards, no trophy changes); refresh the local
    // snapshot from my own authoritative settlement when present.
    if (!model.cancelled && this.live2v2) {
      const mine = selectLocal2v2Participant(result, mySlot);
      if (mine?.settlement) {
        this.careerManager.applyLiveMatchSettlement(mine.settlement);
      }
      track2v2ResultAnalytics({
        matchId: result.matchId,
        cancelled: model.cancelled,
        myStatus: model.myStatus,
        durationSeconds:
          mine?.settlement && mine.settlement.stats.matchDurationSeconds > 0
            ? mine.settlement.stats.matchDurationSeconds
            : this.gameState.elapsedTimeSeconds,
        slot: this.live2v2.payload.slot,
        teamId: this.live2v2.payload.teamId,
      });
    }

    if (model.cancelled || model.myStatus === 'victory') {
      if (!model.cancelled) {
        sounds.playVictory();
        this.platform.hapticNotification('success');
        this.cameras.main.flash(350, 37, 99, 235);
      }
    } else {
      sounds.playDefeat();
      this.platform.hapticNotification('warning');
    }
    sounds.stopBattleMusic();
    this.render2v2ResultModal(model, client);
  }

  private rosterNameMap(): Record<number, string> {
    const map: Record<number, string> = {};
    for (const entry of this.live2v2?.payload.players ?? []) {
      map[entry.slot] = entry.displayName;
    }
    return map;
  }

  /**
   * Rematch-window expiry (§2.6: idlers drop to the menu). The session is
   * terminal on the client side too; no reconnect can follow. The terminal
   * match_end analytics were already recorded with the settlement, so this
   * path deliberately emits nothing further.
   */
  private handle2v2MatchExpired(matchId: string): void {
    if (matchId !== this.activeMatchId) return;
    this.returnToMenu();
  }

  private handle2v2RematchStarted(client: LiveMatchClient): void {    // All four voted: the fresh match keeps identical slots. Ready-signal so
    // the server's countdown starts immediately, and hold the result modal
    // in a pending state until the new match_started_2v2 resets the battle.
    this.twoVTwoRematchVoteSent = false;
    try {
      client.sendReady();
    } catch {
      // Not fatal: the countdown still starts the match without ready votes.
    }
    if (!this.resultModalContainer) return;
    const pending = createText(this, 0, 60, 'REMATCH FOUND — ENTERING THE ARENA…', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#c7d2fe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.resultModalContainer.add(pending);
    // Freeze the modal buttons: the match is already decided.
    this.resultModalContainer.setAlpha(0.92);
  }

  private render2v2ResultModal(model: ReturnType<typeof buildTwoVTwoResultViewModel>, client?: LiveMatchClient): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const headline = twoVTwoResultHeadline(model);
    const modal = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(200);
    this.resultModalContainer = modal;
    modal.setScale(0.85);
    modal.setAlpha(0);

    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x000000, 0.78)
      .setInteractive();

    const card = this.add
      .rectangle(0, 0, 330, 640, 0x0c1322, 0.98)
      .setStrokeStyle(2, model.cancelled ? 0x64748b : THEME.twoVTwoAccent, 0.95);

    const title = createText(this, 0, -275, headline.title, {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        fontStyle: '900',
        color: headline.color,
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5);

    const subtitle = createText(this, 0, -238, headline.subtitle, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        stroke: '#000000',
        strokeThickness: 2,
        align: 'center',
        lineSpacing: 4,
        resolution: 2,
      })
      .setOrigin(0.5);

    // Casual notice — honest no-rewards copy replaces the 1v1 reward cards.
    const casualNotice = createText(this, 0, -202, TWO_V_TWO_CASUAL_NOTICE, {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    const grid = computeTwoVTwoResultGrid();
    const elements: Phaser.GameObjects.GameObject[] = [
      backdrop, card, title, subtitle, casualNotice,
    ];

    const separator = this.add
      .rectangle(0, grid.separatorY, 290, 1.5, 0x1e293b, 1);
    elements.push(separator);

    const rows: ReadonlyArray<{
      group: (typeof model.teams)[number];
      cells: typeof grid.myTeamRow;
      labelY: number;
    }> = [
      { group: model.teams[0], cells: grid.myTeamRow, labelY: grid.rowLabels.myTeamY },
      { group: model.teams[1], cells: grid.otherTeamRow, labelY: grid.rowLabels.otherTeamY },
    ];

    for (const row of rows) {
      if (model.cancelled) break;
      const teamStyle = THEME.teams[row.group.teamId === 'a' ? 'player' : 'enemy'];
      const teamLabelText = row.group.isMyTeam
        ? `${row.group.isWinner ? '🏆' : '🛡'} YOUR TEAM ${row.group.teamId.toUpperCase()}${row.group.isWinner ? ' — WINNER' : ''}`
        : `${row.group.isWinner ? '🏆' : '⚔'} ENEMY TEAM ${row.group.teamId.toUpperCase()}${row.group.isWinner ? ' — WINNER' : ''}`;
      const teamLabel = createText(this, 0, row.labelY, teamLabelText, {
          fontFamily: FONT_FAMILY,
          fontSize: '10px',
          fontStyle: '900',
          color: row.group.isWinner ? '#fbbf24' : '#94a3b8',
          stroke: '#000000',
          strokeThickness: 1.5,
          resolution: 2,
        })
        .setOrigin(0.5);
      elements.push(teamLabel);

      row.group.participants.forEach((participant, index) => {
        const cell = row.cells[index];
        if (!cell) return;
        const badge = this.live2v2?.badges.find((b) => b.slot === participant.slot);
        const shape = badge?.shape ?? '';
        const bg = this.add
          .rectangle(cell.center.x, cell.center.y, cell.width, cell.height, 0x111827, 0.95)
          .setStrokeStyle(
            1.5,
            participant.isYou ? 0xf59e0b : teamStyle.primary,
            participant.isYou ? 0.95 : 0.85
          );
        // Identity: shape glyph + slot label + YOU marker; color reinforces.
        const nameLabel = createText(this,
            cell.center.x,
            cell.center.y - 22,
            formatTwoVTwoResultCellLabel(shape, participant.label, participant.isYou, participant.displayName),
            {
              fontFamily: FONT_FAMILY,
              fontSize: '11px',
              fontStyle: 'bold',
              color: '#f8fafc',
              stroke: '#000000',
              strokeThickness: 1.5,
              resolution: 2,
            }
          )
          .setOrigin(0.5);
        const statusLabel = createText(this, cell.center.x, cell.center.y + 2, participant.status.toUpperCase(), {
            fontFamily: FONT_FAMILY,
            fontSize: '13px',
            fontStyle: '900',
            color:
              participant.status === 'victory'
                ? '#fbbf24'
                : participant.status === 'defeat'
                  ? '#f87171'
                  : '#cbd5e1',
            stroke: '#000000',
            strokeThickness: 2,
            resolution: 2,
          })
          .setOrigin(0.5);
        const statsLabel = createText(this,
            cell.center.x,
            cell.center.y + 22,
            participant.abandoned
              ? `ABANDONED${participant.coinsAwarded === null ? '' : ` · +${participant.coinsAwarded}g`}`
              : `${participant.coinsAwarded === null ? '' : `+${participant.coinsAwarded}g · `}⚔${participant.unitsDispatched ?? '—'} · 🏰${participant.territoriesCaptured ?? '—'}`,
            {
              fontFamily: FONT_FAMILY,
              fontSize: '9px',
              fontStyle: 'bold',
              color: participant.abandoned ? '#f87171' : '#94a3b8',
              stroke: '#000000',
              strokeThickness: 1,
              resolution: 2,
            }
          )
          .setOrigin(0.5);
        elements.push(bg, nameLabel, statusLabel, statsLabel);
      });
    }

    if (model.cancelled) {
      const cancelledNote = createText(this, 0, -110, 'No result was recorded for this match.', {
          fontFamily: FONT_FAMILY,
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#94a3b8',
          stroke: '#000000',
          strokeThickness: 1.5,
          resolution: 2,
        })
        .setOrigin(0.5);
      elements.push(cancelledNote);
    }

    // One-shot rematch vote (§5.4): all four must vote; the button consumes
    // into a sent-state and cannot send twice.
    const rematchY = 135;
    const rematchBg = this.add
      .rectangle(0, rematchY, 240, 50, 0x17123a, 1)
      .setStrokeStyle(2, THEME.twoVTwoAccent, 1)
      .setInteractive({ useHandCursor: true });
    const rematchText = createText(this, 0, rematchY, twoVTwoRematchButtonLabel(this.twoVTwoRematchVoteSent), {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '900',
        color: '#c7d2fe',
        stroke: '#000000',
        strokeThickness: 2,
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(rematchBg, rematchText);
    rematchBg.on('pointerdown', () => {
      if (this.twoVTwoRematchVoteSent || model.cancelled) return;
      this.twoVTwoRematchVoteSent = true;
      try {
        client?.sendRematchVote();
      } catch (error) {
        // The vote window may have closed; surface it without crashing.
        this.spawnFloatingText(LOGICAL_WIDTH / 2, 96, 'rematch unavailable', '#f87171');
        console.warn('[GameScene] Rematch vote failed:', error);
        this.twoVTwoRematchVoteSent = false;
        return;
      }
      this.platform.hapticSelection();
      rematchBg.disableInteractive();
      rematchText.setText(twoVTwoRematchButtonLabel(true));
      rematchBg.setFillStyle(0x0f0b24, 1);
    });
    elements.push(rematchBg, rematchText);

    const shareY = 190;
    const shareBg = this.add
      .rectangle(0, shareY, 240, 46, 0x1e293b, 1)
      .setStrokeStyle(1.5, 0x475569, 1)
      .setInteractive({ useHandCursor: true });
    const shareText = createText(this, 0, shareY, 'SHARE RESULT 📢', {
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
    shareBg.on('pointerdown', async () => {
      this.platform.hapticSelection();
      await this.platform.share({
        text: model.myStatus === 'victory'
          ? '👑 Our team seized the Quad Citadel in Crown Clash 2v2! ⚔️ Join the battle!'
          : '⚔ We fought for the Quad Citadel in Crown Clash 2v2! Challenge us!',
      });
    });
    elements.push(shareBg, shareText);

    const menuY = 245;
    const menuBg = this.add
      .rectangle(0, menuY, 240, 46, 0x0f172a, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const menuText = createText(this, 0, menuY, 'MAIN MENU', {
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
    elements.push(menuBg, menuText);

    modal.add(elements);
    this.tweens.add({
      targets: modal,
      scale: 1.0,
      alpha: 1.0,
      duration: 260,
      ease: 'Back.easeOut',
    });
    this.resultModalContainer = modal;
  }

  // ── 2v2 reconnect / abandon overlays ────────────────────────────────────

  private show2v2ReconnectOverlay(attempt: number): void {
    if (this.isExiting || this.resultModalContainer) return;
    if (this.twoVTwoReconnectOverlay) {
      this.twoVTwoReconnectOverlay.destroy();
    }
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const overlay = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(230);
    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x000000, 0.85)
      .setInteractive();
    const card = this.add
      .rectangle(0, 0, 290, 170, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0xf59e0b, 0.95);
    const title = createText(this, 0, -50, 'CONNECTION LOST', {
        fontFamily: FONT_FAMILY,
        fontSize: '19px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitle = createText(this, 0, -8, `Reconnecting… (attempt ${attempt + 1})\nYour slot is held for 30s`, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#e2e8f0',
        align: 'center',
        lineSpacing: 5,
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    const spinner = createText(this, 0, 48, '⏳', { fontSize: '22px', resolution: 2 })
      .setOrigin(0.5);
    this.tweens.add({
      targets: spinner,
      angle: 360,
      duration: 1200,
      repeat: -1,
    });
    overlay.add([backdrop, card, title, subtitle, spinner]);
    this.twoVTwoReconnectOverlay = overlay;
  }

  private hide2v2ReconnectOverlay(): void {
    this.twoVTwoReconnectOverlay?.destroy();
    this.twoVTwoReconnectOverlay = undefined;
  }

  /** Terminal reconnect failure: the slot is gone; the only way out is menu. */
  private show2v2AbandonedOverlay(code: string): void {
    this.hide2v2ReconnectOverlay();
    if (this.isExiting || this.resultModalContainer) return;
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const overlay = this.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(230);
    this.twoVTwoReconnectOverlay = overlay;
    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x000000, 0.88)
      .setInteractive();
    const card = this.add
      .rectangle(0, 0, 300, 220, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0xef4444, 0.95);
    const title = createText(this, 0, -75, 'MATCH ABANDONED', {
        fontFamily: FONT_FAMILY,
        fontSize: '19px',
        fontStyle: '900',
        color: '#f87171',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitle = createText(this, 0, -25, 'You could not rejoin in time.\nThe match continues without you.', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        align: 'center',
        lineSpacing: 5,
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    const codeText = createText(this, 0, 22, code.replaceAll('_', ' '), {
        fontFamily: FONT_FAMILY,
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#64748b',
        stroke: '#000000',
        strokeThickness: 1,
        resolution: 2,
      })
      .setOrigin(0.5);
    const menuBg = this.add
      .rectangle(0, 70, 200, 48, 0x0f172a, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const menuText = createText(this, 0, 70, 'RETURN TO MENU', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
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
    overlay.add([backdrop, card, title, subtitle, codeText, menuBg, menuText]);
  }

  /** Dispatch and drag input are inert while reconnecting or surrendered. */
  private is2v2InputBlocked(): boolean {
    if (!this.is2v2) return false;
    return this.twoVTwoSurrenderSent || Boolean(this.twoVTwoReconnectOverlay);
  }

  /**
   * Shape glyph for a marching army in 2v2: parsed from the version-2
   * server army id; local predictions carry my own slot's shape. Null in
   * 1v1 or for ids that do not encode a slot.
   */
  private twoVTwoArmyShape(army: MarchingArmy): string | null {
    if (!this.live2v2) return null;
    if (army.id.startsWith('pred_')) {
      const mine = this.live2v2.badges.find((badge) => badge.isYou);
      return mine?.shape ?? null;
    }
    const slot = slotFromTwoVTwoArmyId(army.id);
    if (slot === null) return null;
    return TWO_V_TWO_SLOT_SHAPES[slot] ?? null;
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
    if (this.viewportRelayoutTimer !== null) {
      clearTimeout(this.viewportRelayoutTimer);
      this.viewportRelayoutTimer = null;
    }
    this.arenaVisuals = [];
    this.cloudShadows = [];
    this.lastAppliedViewport = { width: 0, height: 0 };
    this.bottomBarShadow = undefined;
    this.bottomBarBg = undefined;
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
      this.tweens.killTweensOf([vis.container, vis.ring, vis.typeIcon, vis.unitBadge]);
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
    this.hide2v2ReconnectOverlay();
    this.live2v2 = null;
    this.twoVTwoAppliedStartId = null;
    this.twoVTwoHudLayout = null;
    this.twoVTwoRematchVoteSent = false;
    this.twoVTwoSurrenderSent = false;
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
    this.trainingController?.destroy();
    this.trainingController = undefined;
    this.trainingOverlay?.destroy();
    this.trainingOverlay = undefined;
    this.trainingMode = false;
    this.trainingCompletionPending = false;
  }
}

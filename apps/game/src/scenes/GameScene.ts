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
import { LiveMatchClient, LiveMatchStarted } from '../api/LiveMatchClient.js';
import { purchaseUpgradeThroughCareer } from '../upgrades/UpgradePurchaseController.js';
import { playUpgradeMilestoneCelebration } from '../upgrades/UpgradeMilestoneCelebration.js';
import {
  deriveLiveCombatArrivals,
  reconcileLiveArmies,
  stepLiveArmies,
} from '../combat/LiveCombatFeedback.js';
import { wholeMatchSeconds } from '../match/MatchPresentation.js';

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
}

export class GameScene extends Phaser.Scene {
  private gameState!: GameState;
  private accumulators: Record<string, number> = {};
  private territoryVisuals: Map<string, TerritoryVisual> = new Map();
  private armyVisuals: Map<string, ArmyVisual> = new Map();

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
  private lastAuthoritativeState: GameState | null = null;

  private enemyArmySpeedMultiplier = 1;

  // Result Modal
  private resultModalContainer?: Phaser.GameObjects.Container;

  // Platform Adapter
  private platform!: PlatformAdapter;

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
    const renderScale = this.registry.get('renderScale') as number || 1;
    this.cameras.main.setZoom(renderScale);
    this.cameras.main.centerOn(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
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
    if (!this.liveMode && !launchData?.botMatch) {
      console.error('[GameScene] Missing server-issued bot match ticket');
      this.scene.start('MenuScene');
      return;
    }
    this.activeMatchId = launchData?.botMatch?.matchId ?? '';
    this.battlefieldId = launchData?.botMatch?.battlefieldId ?? 'crown_cross';
    this.matchActions = [];
    this.liveUnsubscribers = [];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
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

  private createArenaBackground(): void {
    this.add
      .rectangle(
        LOGICAL_WIDTH / 2,
        LOGICAL_HEIGHT / 2,
        LOGICAL_WIDTH,
        LOGICAL_HEIGHT,
        0x060a13
      )
      .setDepth(0);

    // Broad team-colored light pools make the two fronts readable without
    // competing with the territory ownership colors.
    this.add
      .ellipse(LOGICAL_WIDTH / 2, 112, 470, 260, THEME.teams.enemy.dark, 0.12)
      .setDepth(0);
    this.add
      .ellipse(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 70, 500, 290, THEME.teams.player.dark, 0.14)
      .setDepth(0);

    const fieldGraphics = this.add.graphics().setDepth(1);
    fieldGraphics.fillStyle(0x101827, 0.42);
    fieldGraphics.fillRoundedRect(10, 78, LOGICAL_WIDTH - 20, LOGICAL_HEIGHT - 132, 18);

    // Subtle command-grid structure adds scale and keeps the empty arena from
    // looking like a flat color fill.
    fieldGraphics.lineStyle(1, 0x334155, 0.12);
    for (let x = 28; x < LOGICAL_WIDTH; x += 36) {
      fieldGraphics.lineBetween(x, 88, x, LOGICAL_HEIGHT - 66);
    }
    for (let y = 94; y < LOGICAL_HEIGHT - 64; y += 36) {
      fieldGraphics.lineBetween(18, y, LOGICAL_WIDTH - 18, y);
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
  }

  private createHud(): void {
    // 1. Header Glass Panel Bar (y: 0 to 70)
    this.add
      .rectangle(LOGICAL_WIDTH / 2, 39, LOGICAL_WIDTH, 74, 0x000000, 0.36)
      .setDepth(89);

    this.add
      .rectangle(LOGICAL_WIDTH / 2, 35, LOGICAL_WIDTH, 70, 0x090f1d, 0.96)
      .setDepth(90);

    this.add
      .rectangle(LOGICAL_WIDTH / 2, 70, LOGICAL_WIDTH, 1.5, 0x1e293b, 1)
      .setDepth(91);
    this.add
      .rectangle(LOGICAL_WIDTH / 4, 70, LOGICAL_WIDTH / 2, 1.5, THEME.teams.player.primary, 0.58)
      .setDepth(92);
    this.add
      .rectangle(
        (LOGICAL_WIDTH * 3) / 4,
        70,
        LOGICAL_WIDTH / 2,
        1.5,
        THEME.teams.enemy.primary,
        0.58
      )
      .setDepth(92);

    // 2. Top Row (y: 20): Profile, Trophies, Coins, Clock, and Audio
    const career = this.careerManager.getCareer();

    // Left: Player Profile Pill with dynamic sizing
    const playerLabel = this.computePlayerHudLabel();

    const playerText = this.add
      .text(0, 0, playerLabel, {
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


    const textWidth = Math.ceil(playerText.width);
    const playerPillWidth = Math.min(100, Math.max(74, textWidth + 14));
    const playerPillCenterX = 10 + playerPillWidth / 2;

    this.add
      .rectangle(playerPillCenterX, 20, playerPillWidth, 24, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x3b82f6, 0.9)
      .setDepth(95);

    playerText.setPosition(playerPillCenterX, 20);

    // Trophies Pill
    const trophyPillWidth = 56;
    const trophyPillX = playerPillCenterX + playerPillWidth / 2 + 5 + trophyPillWidth / 2;
    this.add
      .rectangle(trophyPillX, 20, trophyPillWidth, 24, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x818cf8, 0.9)
      .setDepth(95);

    this.hudTrophiesText = this.add
      .text(trophyPillX, 20, `🏆 ${career.trophies}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#c7d2fe',
        stroke: '#030712',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96);

    // Gold Coins Pill (or Live Opponent Pill in Live PvP)
    const coinPillWidth = 68;
    const coinPillX = trophyPillX + trophyPillWidth / 2 + 5 + coinPillWidth / 2;
    this.add
      .rectangle(
        coinPillX,
        20,
        coinPillWidth,
        24,
        this.liveMode ? 0x1e1520 : 0x0f172a,
        0.95
      )
      .setStrokeStyle(1.5, this.liveMode ? 0xf87171 : 0xf59e0b, 0.9)
      .setDepth(95);

    this.hudCoinsText = this.add
      .text(
        coinPillX,
        20,
        this.liveMode
          ? `🔴 ${this.formatShortName(this.liveOpponentName, 6)}`
          : `🪙 ${career.coins}`,
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
    const clockPillWidth = 72;
    const clockPillX = coinPillX + coinPillWidth / 2 + 5 + clockPillWidth / 2;
    this.add
      .rectangle(clockPillX, 20, clockPillWidth, 24, 0x111827, 0.95)
      .setStrokeStyle(1.5, 0xf59e0b, 0.9)
      .setDepth(95);

    this.timerText = this.add
      .text(clockPillX, 20, '⏱ 01:30', {
        fontFamily: MONO_FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fbbf24',
        stroke: '#030712',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96);

    // Right: Audio Toggle Pill
    const rightPillX = LOGICAL_WIDTH - 22;
    const muteBg = this.add
      .rectangle(rightPillX, 20, 40, 32, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.8)
      .setDepth(95);

    const muteIcon = sounds.isMuted() ? '🔇' : '🔊';
    const muteBtn = this.add
      .text(rightPillX, 20, muteIcon, {
        fontSize: '13px',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96);

    muteBg.setInteractive({ useHandCursor: true });
    muteBg.on('pointerdown', () => {
      const isMuted = sounds.toggleMute();
      muteBtn.setText(isMuted ? '🔇' : '🔊');
      this.platform.hapticSelection();
    });
    this.bindPressFeedback(muteBg, muteBtn);

    // Auto-update HUD when career balance changes (bot battles only for coins)
    this.careerSubscription = this.careerManager.subscribe((updatedCareer) => {
      if (this.hudCoinsText && this.hudCoinsText.active && !this.liveMode) {
        this.hudCoinsText.setText(`🪙 ${updatedCareer.coins}`);
      }
      if (this.hudTrophiesText && this.hudTrophiesText.active) {
        this.hudTrophiesText.setText(`🏆 ${updatedCareer.trophies}`);
      }
    });

    // 3. Row 2 (y: 48): The Dynamic Tug-of-War Dominance Bar
    const barTotalWidth = 350;
    const barHeight = 14;
    const barY = 48;
    const barStartX = LOGICAL_WIDTH / 2 - barTotalWidth / 2;

    // Dominance Bar Track Background
    this.add
      .rectangle(LOGICAL_WIDTH / 2, barY, barTotalWidth, barHeight, 0x0b1120, 1)
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
      .text(LOGICAL_WIDTH / 2, barY - 1, '👑', {
        fontSize: '14px',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(98);

    // 4. Bottom Tactical Control Hint Bar
    this.add
      .rectangle(LOGICAL_WIDTH / 2, 694, 364, 42, 0x000000, 0.34)
      .setDepth(94);
    this.add
      .rectangle(LOGICAL_WIDTH / 2, 691, 360, 40, 0x090f1d, 0.94)
      .setStrokeStyle(1.5, 0x334155, 0.92)
      .setDepth(95);

    this.add
      .text(LOGICAL_WIDTH / 2, 682, 'DEF shields  •  PROD trains  •  SPD marches', {
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
      .text(LOGICAL_WIDTH / 2, 701, initialHint, {
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

  private computePlayerHudLabel(): string {
    const rawName = this.platform.getUser().username || this.platform.getUser().firstName || 'Commander';
    return `🔵 ${this.formatShortName(rawName, 7)}`;
  }

  private formatShortName(name: string, maxLen = 8): string {
    if (!name) return 'Player';
    const trimmed = name.trim();
    if (trimmed.startsWith('Commander_')) {
      return 'Cmdr ' + trimmed.slice(10, 14);
    }
    if (trimmed.length > maxLen) {
      return trimmed.slice(0, maxLen - 1) + '…';
    }
    return trimmed;
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
      if (this.gameState.status !== 'playing' || this.selectedSourceIds.length > 0) return;

      const territory = this.getTerritoryUnderPointer(pointer);
      if (territory) {
        this.startDragFromTerritory(territory.id, pointer);
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.selectedSourceIds.length === 0) return;

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
      this.handlePointerRelease();
    });
  }

  private startDragFromTerritory(territoryId: string, _pointer?: Phaser.Input.Pointer): void {
    if (this.gameState.status !== 'playing') return;

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
    this.bottomHintText
      .setText('⚔ Drag across towers to attack or reinforce')
      .setColor('#94a3b8');

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
              const predictedArmies = multiDispatch.armies.map((army, idx) => ({
                ...army,
                id: `pred_${Date.now()}_${idx}`,
              }));
              Object.assign(this.gameState.territories, multiDispatch.updatedSources);
              this.gameState.armies.push(...predictedArmies);
              this.updateTerritoryVisuals();

              for (const success of multiDispatch.successes) {
                if (success.army) {
                  this.liveClient?.sendDispatch(success.army.sourceId, success.army.targetId);
                }
              }

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

            sounds.playDispatch();
            this.platform.hapticImpact(multiDispatch.armies.length > 1 ? 'heavy' : 'medium');
          }
        }
      }
    }
  }

  update(_time: number, delta: number): void {
    const deltaSeconds = delta / 1000;

    if (this.gameState.status === 'playing' && !this.liveMode) {
      this.stepBotMatch(deltaSeconds);

      // Update HUD
      this.updateHud();

      // Check Game Over
      if (this.gameState.status !== 'playing') {
        this.endMatch();
      }
    }
    if (this.liveMode && this.gameState.status === 'playing') {
      this.stepLiveMatch(deltaSeconds);
      this.updateHud();
    }

    // 6. Update Visuals
    this.updateTerritoryVisuals();
    this.updateArmyVisuals(deltaSeconds);
  }

  /**
   * Steps the local bot-match prediction, clipping each step at the AI's
   * fixed tick grid (every PVP_AI_TICK_SECONDS of match time) so the client
   * prediction matches the server's authoritative replay as closely as
   * possible.
   */
  private stepBotMatch(deltaSeconds: number): void {
    // Do not run thousands of combat ticks in one frame after a suspended
    // WebView resumes. Bot match time is logical, not wall-clock time.
    const budget = consumeSimulationTicks(this.botStepRemainder, Math.min(deltaSeconds, 0.25));
    this.botStepRemainder = budget.remainderSeconds;
    // Every gameplay mutation runs on the same 20 ms clock used by the
    // authoritative replay. Render-frame size can no longer change combat.
    const ticks = Math.min(budget.ticks, 20);
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

  private updateTerritoryVisuals(): void {
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

  private spawnDustPuff(x: number, y: number, color: number): void {
    const jitterX = Math.random() * 4 - 2;
    const jitterY = Math.random() * 3 - 1.5;
    const dust = this.add
      .circle(x + jitterX, y + 6 + jitterY, 3, color, 0.45)
      .setDepth(33);

    this.tweens.add({
      targets: dust,
      scale: 1.8,
      alpha: 0,
      y: dust.y - 4,
      duration: 220,
      onComplete: () => {
        this.tweens.killTweensOf(dust);
        dust.destroy();
      },
    });
  }

  private destroyArmyVisual(visual: ArmyVisual): void {
    this.tweens.killTweensOf(visual.container);
    this.tweens.killTweensOf(visual.leaderSprite);
    for (const f of visual.followers) {
      this.tweens.killTweensOf(f.sprite);
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
    const activeArmyIds = new Set(
      this.gameState.armies.map((army) => `${army.owner}:${army.id}`)
    );

    // Destroy visuals for finished armies
    for (const [id, visual] of this.armyVisuals.entries()) {
      if (!activeArmyIds.has(id)) {
        this.destroyArmyVisual(visual);
        this.armyVisuals.delete(id);
      }
    }

    // Update or create visual for each active army
    for (const army of this.gameState.armies) {
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

          if (!this.reducedMotion) {
            // Alternating rhythmic stride bounce
            this.tweens.add({
              targets: sprite,
              y: f.y - 2.5,
              scaleX: 0.175,
              scaleY: 0.205,
              duration: 130,
              delay: f.delay,
              yoyo: true,
              repeat: -1,
              ease: 'Sine.easeInOut',
            });
          }

          container.add([shadow, sprite]);
          followers.push({ shadow, sprite, relX: f.x, relY: f.y });
        }

        // Commander / Leader Unit
        const leaderShadow = this.add.ellipse(0, 9, 18, 7, 0x000000, 0.38);
        const leaderTexture = army.owner === 'player' ? 'unit_leader_player' : 'unit_leader_enemy';
        const leaderSprite = this.add
          .image(0, 0, leaderTexture)
          .setScale(0.25)
          .setFlipX(isFacingLeft);

        if (!this.reducedMotion) {
          // Leader stride bounce + squash/stretch
          this.tweens.add({
            targets: leaderSprite,
            y: -3.5,
            scaleX: 0.23,
            scaleY: 0.27,
            duration: 130,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        }

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
          this.spawnDustPuff(
            currentX + visual.rearOffset.x,
            currentY + visual.rearOffset.y,
            visual.dustColor
          );
        }
      }
    }
  }

  private updateHud(): void {
    // 1. Timer & Dynamic Tension Loop
    const remaining = Math.max(0, this.gameState.timeLimitSeconds - this.gameState.elapsedTimeSeconds);
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    const timerStr = `⏱ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    if (this.timerText.text !== timerStr) {
      this.timerText.setText(timerStr);
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
    // Combines territorial ownership and active field armies for live tactical responsiveness
    const territories = Object.values(this.gameState.territories);
    let playerStrength = 0;
    let enemyStrength = 0;
    let neutralStrength = 0;

    territories.forEach((t) => {
      if (t.owner === 'player') playerStrength += 35 + t.units;
      else if (t.owner === 'enemy') enemyStrength += 35 + t.units;
      else neutralStrength += 15 + t.units;
    });

    this.gameState.armies.forEach((a) => {
      if (a.owner === 'player') playerStrength += a.units;
      else if (a.owner === 'enemy') enemyStrength += a.units;
    });

    const totalStrength = Math.max(1, playerStrength + enemyStrength + neutralStrength);
    const playerPct = Math.round((playerStrength / totalStrength) * 100);
    const enemyPct = Math.round((enemyStrength / totalStrength) * 100);
    const neutralPct = Math.max(0, 100 - playerPct - enemyPct);

    const barTotalWidth = 350;
    const playerWidth = Math.max(14, (playerPct / 100) * barTotalWidth);
    const neutralWidth = Math.max(8, (neutralPct / 100) * barTotalWidth);
    const enemyWidth = Math.max(14, barTotalWidth - playerWidth - neutralWidth);

    const barStartX = LOGICAL_WIDTH / 2 - barTotalWidth / 2;
    this.playerBar.setPosition(barStartX, this.playerBar.y).setDisplaySize(playerWidth, 12);
    this.neutralBar.setPosition(barStartX + playerWidth, this.neutralBar.y).setDisplaySize(neutralWidth, 12);
    this.enemyBar.setPosition(barStartX + playerWidth + neutralWidth, this.enemyBar.y).setDisplaySize(enemyWidth, 12);

    const playerDomStr = `${playerPct}%`;
    if (this.playerDomText.text !== playerDomStr) {
      this.playerDomText.setText(playerDomStr);
    }
    const enemyDomStr = `${enemyPct}%`;
    if (this.enemyDomText.text !== enemyDomStr) {
      this.enemyDomText.setText(enemyDomStr);
    }

    // Smooth Tug-of-War Crown Needle glide towards the leading front
    const targetCrownX = barStartX + playerWidth + neutralWidth / 2;
    this.tugCrown.x = Phaser.Math.Linear(this.tugCrown.x, targetCrownX, 0.12);
  }

  private endMatch(): void {
    if (this.resultModalContainer || this.resultPending) return;

    sounds.stopBattleMusic();
    this.resultPending = true;
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

    const modal = this.add.container(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2).setDepth(200);
    this.resultModalContainer = modal;
    modal.setScale(0.8);
    modal.setAlpha(0);

    // Dark backdrop overlay
    const backdrop = this.add
      .rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.78)
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

    const modal = this.add.container(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2).setDepth(220);
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

  private returnToMenu(): void {
    sounds.stopBattleMusic();
    this.resultPending = false;
    this.input.enabled = false;
    this.resultModalContainer?.destroy();
    this.resultModalContainer = undefined;
    this.scene.start('MenuScene');
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
        this.gameState = {
          ...state,
          armies: reconciledArmies,
        };
        arrivals.forEach((arrival) => this.onCombatArrival(arrival));
      }),
      client.on('command_rejected', ({ code }) => {
        this.spawnFloatingText(LOGICAL_WIDTH / 2, 96, code.replaceAll('_', ' '), '#f87171');
        this.gameState.armies = this.gameState.armies.filter((a) => !a.id.startsWith('pred_'));
      }),
      client.on('match_result', (result) => {
        const terminalEventRecorded = trackTerminalMatchEvent({
          name: 'match_end',
          matchId: result.matchId,
          mode: 'live',
          result: result.status,
          durationSeconds: result.stats.matchDurationSeconds,
        });
        this.gameState.status = result.status;
        this.resultPending = false;
        this.careerManager.applyLiveMatchSettlement(result.settlement);
        if (terminalEventRecorded) {
          trackEvent({
            name: 'match_reward_received',
            matchId: result.matchId,
            mode: 'live',
          });
          if (result.settlement.rankPromoted) {
            trackEvent({ name: 'rank_promoted', matchId: result.matchId });
          }
          trackEvent({
            name: 'live_match_ended',
            matchId: result.matchId,
            status: result.status,
          });
        }
        this.renderResultModal(result.status, result.stats, result.settlement);
        client.close();
      }),
      client.on('closed', () => {
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
        if (code === 'settlement_failed') {
          this.showLiveConnectionError();
        }
      })
    );
  }

  private showLiveConnectionError(): void {
    if (this.resultModalContainer) return;
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

  private cleanup(): void {
    sounds.stopBattleMusic();
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
    this.input.removeAllListeners();
    this.lastAuthoritativeState = null;
    this.careerSubscription?.();
    this.careerSubscription = undefined;
    for (const unsubscribe of this.liveUnsubscribers) {
      unsubscribe();
    }
    this.liveUnsubscribers = [];
    this.liveClient?.close();
    this.liveClient = undefined;
  }
}

import Phaser from 'phaser';
import {
  calculateDispatchUnits,
  CombatResult,
  createInitialGameState,
  dispatchArmy,
  dispatchMultipleArmies,
  evaluateAiMove,
  GameState,
  getNextUpgradeCost,
  getPlayerUpgradeModifiers,
  getUpgradeLevel,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MatchStats,
  stepSimulation,
  Territory,
  UPGRADE_DEFINITIONS,
  UpgradeType,
} from '@crown-clash/game-core';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { CareerManager } from '../career/CareerManager.js';
import { trackEvent, trackUpgradeEvent } from '../analytics/Analytics.js';
import { sounds } from '../audio/SoundEffects.js';
import { THEME } from '../theme.js';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_FONT_FAMILY = '"Segoe UI", monospace, -apple-system, sans-serif';

interface TerritoryVisual {
  territory: Territory;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Arc;
  unitBadge: Phaser.GameObjects.Rectangle;
  unitText: Phaser.GameObjects.Text;
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
  private dragGraphics!: Phaser.GameObjects.Graphics;
  private selectionRings: Map<string, Phaser.GameObjects.Arc> = new Map();
  private dragBadgeContainer!: Phaser.GameObjects.Container;
  private dragBadgeBg!: Phaser.GameObjects.Rectangle;
  private dragBadgeText!: Phaser.GameObjects.Text;

  // AI Timer
  private aiTimer: number = 0;
  private aiInterval: number = 1.8; // seconds between AI decisions

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
  private playerArmySpeedMultiplier = 1;
  private activeMatchId = '';
  private backendConnectPromise: Promise<void> | null = null;
  private resultPending = false;

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
    this.platform = (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    const user = this.platform.getUser();
    this.careerManager = CareerManager.getInstance(user.id);
    this.activeMatchId = this.createMatchId();
    this.backendConnectPromise = this.careerManager
      .connect(this.platform)
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[GameScene] Backend unavailable, using local career cache:', error);
      });
    const launchData = this.scene.settings.data as { source?: 'menu' | 'rematch' } | undefined;
    trackEvent({ name: 'match_start', source: launchData?.source ?? 'menu' });
    this.createUpgradedMatchState();
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
    this.aiTimer = 1.6; // give player a fair 1.6s reaction window at match start
    this.lastHeartbeatSecond = -1;

    // Start atmospheric battle music
    sounds.startBattleMusic();

    // 1. Draw Arena Background & Connecting Lanes
    this.createArenaBackground();

    // 2. Drag & selection graphics
    this.dragGraphics = this.add.graphics().setDepth(50);

    // Live Drag Badge preview
    this.dragBadgeContainer = this.add.container(0, 0).setDepth(55).setVisible(false);
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
    this.dragBadgeContainer.add([this.dragBadgeBg, this.dragBadgeText]);

    // 3. Build Territory Visuals
    this.createTerritoryObjects();

    // 4. Create HUD
    this.createHud();

    // 5. Setup Pointer Input Listeners
    this.setupInputs();
  }

  private createArenaBackground(): void {
    // Deep rich tactical battlefield background
    const bg = this.add.rectangle(
      LOGICAL_WIDTH / 2,
      LOGICAL_HEIGHT / 2,
      LOGICAL_WIDTH,
      LOGICAL_HEIGHT,
      0x070b14
    );
    bg.setDepth(0);

    // Strategic Cobblestone Roadways & Tactical Conduits
    const lanesGraphics = this.add.graphics().setDepth(1);

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

    // 1. Road Underlay (Dark stone cobblestone paths)
    lanesGraphics.lineStyle(14, 0x0f172a, 0.95);
    connections.forEach(([idA, idB]) => {
      const a = terrs[idA];
      const b = terrs[idB];
      if (a && b) {
        lanesGraphics.lineBetween(a.x, a.y, b.x, b.y);
      }
    });

    // 2. Road Border Rails (Tactical slate trim)
    lanesGraphics.lineStyle(2, 0x1e293b, 0.75);
    connections.forEach(([idA, idB]) => {
      const a = terrs[idA];
      const b = terrs[idB];
      if (a && b) {
        lanesGraphics.lineBetween(a.x, a.y, b.x, b.y);
      }
    });

    // 3. Central Tactical Conduit Hubs under territories
    Object.values(terrs).forEach((t) => {
      lanesGraphics.fillStyle(0x0f172a, 0.95);
      lanesGraphics.fillCircle(t.x, t.y, t.radius + 6);
      lanesGraphics.lineStyle(1.5, 0x1e293b, 0.85);
      lanesGraphics.strokeCircle(t.x, t.y, t.radius + 6);
    });

    // 4. Strategic Center Keep Tactical Rings
    const centerTerr = terrs['n_center'];
    if (centerTerr) {
      lanesGraphics.lineStyle(1, 0x334155, 0.35);
      lanesGraphics.strokeCircle(centerTerr.x, centerTerr.y, 58);
    }

    // 5. Arena Perimeter Border
    const border = this.add.graphics().setDepth(2);
    border.lineStyle(1.5, 0x1e293b, 0.65);
    border.strokeRoundedRect(8, 76, LOGICAL_WIDTH - 16, LOGICAL_HEIGHT - 128, 16);
  }

  private createTerritoryObjects(): void {
    Object.values(this.gameState.territories).forEach((territory) => {
      const container = this.add.container(territory.x, territory.y).setDepth(20);

      const teamStyle = THEME.teams[territory.owner];

      // Ground glow / base ring
      const ring = this.add
        .circle(0, 4, territory.radius + 5, teamStyle.glow, 0.22)
        .setStrokeStyle(3, teamStyle.primary, 0.95);

      // 2.5D Rendered Fortress Sprite
      const textureKey = this.getTerritoryTextureKey(territory);
      const spriteSize = territory.tier === 3 ? 92 : territory.tier === 2 ? 80 : 66;
      const sprite = this.add.image(0, -6, textureKey).setDisplaySize(spriteSize, spriteSize);

      // Unit Count Badge Pill
      const badgeY = territory.tier === 3 ? 25 : territory.tier === 2 ? 21 : 17;
      const badgeWidth = territory.tier === 3 ? 46 : territory.tier === 2 ? 42 : 38;
      const unitBadge = this.add
        .rectangle(0, badgeY, badgeWidth, 22, 0x070d1a, 0.96)
        .setStrokeStyle(1.5, teamStyle.primary, 1);

      // Unit Count Text with resolution: 2 and bold stroke for retina sharpness
      const unitText = this.add
        .text(0, badgeY, territory.units.toString(), {
          fontFamily: FONT_FAMILY,
          fontSize: territory.tier === 3 ? '15px' : '14px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
          resolution: 2,
        })
        .setOrigin(0.5);

      container.add([ring, sprite, unitBadge, unitText]);

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
        ring,
        unitBadge,
        unitText,
      });
    });
  }

  private createHud(): void {
    // 1. Header Glass Panel Bar (y: 0 to 70)
    this.add
      .rectangle(LOGICAL_WIDTH / 2, 35, LOGICAL_WIDTH, 70, 0x090f1d, 0.96)
      .setDepth(90);

    this.add
      .rectangle(LOGICAL_WIDTH / 2, 70, LOGICAL_WIDTH, 1.5, 0x1e293b, 1)
      .setDepth(91);

    // 2. Top Row (y: 20): Profile, Trophies, Coins, Clock, and Audio
    const user = this.platform.getUser();
    const career = this.careerManager.getCareer();

    // Left: Player Profile Pill with dynamic sizing
    let rawName = user.username || 'Commander';
    if (rawName.startsWith('Commander_')) {
      rawName = 'Cmdr ' + rawName.slice(10);
    } else if (rawName.length > 8) {
      rawName = rawName.slice(0, 7) + '…';
    }
    const playerLabel = `🔵 ${rawName}`;

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

    // Gold Coins Pill
    const coinPillWidth = 60;
    const coinPillX = trophyPillX + trophyPillWidth / 2 + 5 + coinPillWidth / 2;
    this.add
      .rectangle(coinPillX, 20, coinPillWidth, 24, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0xf59e0b, 0.9)
      .setDepth(95);

    this.hudCoinsText = this.add
      .text(coinPillX, 20, `🪙 ${career.coins}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#030712',
        strokeThickness: 2,
        resolution: 2,
      })
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
    this.add
      .rectangle(rightPillX, 20, 32, 24, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.8)
      .setDepth(95);

    const muteIcon = sounds.isMuted() ? '🔇' : '🔊';
    const muteBtn = this.add
      .text(rightPillX, 20, muteIcon, {
        fontSize: '13px',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96)
      .setInteractive({ useHandCursor: true });

    muteBtn.on('pointerdown', () => {
      const isMuted = sounds.toggleMute();
      muteBtn.setText(isMuted ? '🔇' : '🔊');
      this.platform.hapticSelection();
    });

    // Auto-update HUD when career balance changes
    this.careerManager.subscribe((updatedCareer) => {
      if (this.hudCoinsText && this.hudCoinsText.active) {
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

    // 4. Bottom Tactical Control Hint Bar (y: 692)
    this.add
      .rectangle(LOGICAL_WIDTH / 2, 692, 360, 26, 0x090f1d, 0.94)
      .setStrokeStyle(1.5, 0x1e293b, 1)
      .setDepth(95);

    this.bottomHintText = this.add
      .text(LOGICAL_WIDTH / 2, 692, '⚔ Drag across towers to attack or reinforce', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        stroke: '#030712',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(96);
  }

  private getTerritoryUnderPointer(pointer: Phaser.Input.Pointer): Territory | null {
    let closest: Territory | null = null;
    let minDistance = Infinity;

    for (const t of Object.values(this.gameState.territories)) {
      const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, t.x, t.y);
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

    const vis = this.territoryVisuals.get(territoryId);
    if (vis) {
      this.tweens.add({
        targets: vis.container,
        scale: 1.14,
        duration: 100,
        ease: 'Sine.easeOut',
      });
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
    const targetX = target ? target.x : pointer.x;
    const targetY = target ? target.y : pointer.y;

    const isHoveringTarget = !!target;
    const isFriendly = target && target.owner === 'player';

    const color = isHoveringTarget
      ? isFriendly
        ? 0x10b981
        : 0xf59e0b
      : THEME.teams.player.light;

    // Draw trajectory lines from EACH selected source territory converging on target
    this.dragGraphics.lineStyle(4, color, 0.88);
    selectedTerritories.forEach((src) => {
      this.dragGraphics.lineBetween(src.x, src.y, targetX, targetY);
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
      this.dragGraphics.lineStyle(3, color, 1);
      this.dragGraphics.strokeCircle(target.x, target.y, target.radius + 8);
    } else {
      this.dragGraphics.fillStyle(color, 0.9);
      this.dragGraphics.fillCircle(targetX, targetY, 6);
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

    this.dragBadgeContainer.setPosition(midX, midY).setVisible(true);

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
    this.dragBadgeBg.setSize(Math.ceil(this.dragBadgeText.width) + 20, 26);

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
        this.tweens.add({
          targets: vis.container,
          scale: 1.0,
          duration: 120,
          ease: 'Sine.easeOut',
        });
      }
    }

    for (const ring of this.selectionRings.values()) {
      ring.setVisible(false);
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
        // Execute Coordinated Multi-Dispatch (or Reinforcement)
        const multiDispatch = dispatchMultipleArmies(
          sources,
          target,
          'player',
          0.5,
          this.playerArmySpeedMultiplier
        );

        if (multiDispatch.armies.length > 0) {
          // Update all source territories in state
          Object.assign(this.gameState.territories, multiDispatch.updatedSources);
          this.gameState.armies.push(...multiDispatch.armies);
          this.gameState.stats.playerUnitsDispatched += multiDispatch.totalUnitsDispatched;

          if (target.owner === 'player') {
            sounds.playReinforce();
          } else {
            sounds.playDispatch();
          }
          this.platform.hapticImpact(multiDispatch.armies.length > 1 ? 'heavy' : 'medium');
        }
      }
    }
  }

  update(_time: number, delta: number): void {
    const deltaSeconds = delta / 1000;

    if (this.gameState.status === 'playing') {
      // 1. AI Decision Ticker
      this.aiTimer -= deltaSeconds;
      if (this.aiTimer <= 0) {
        this.aiTimer = this.aiInterval + (Math.random() * 0.6 - 0.3); // add slight organic jitter
        this.executeAiTurn();
      }

      // 2. Step Core Simulation
      const step = stepSimulation(this.gameState, this.accumulators, deltaSeconds);
      this.gameState = step.state;
      this.accumulators = step.accumulators;

      // 3. Process combat arrivals & trigger punchy feedback
      step.resolvedArrivals.forEach((arrival) => {
        this.onCombatArrival(arrival);
      });

      // 4. Update HUD
      this.updateHud();

      // 5. Check Game Over
      if (this.gameState.status !== 'playing') {
        this.showResultModal(this.gameState.status);
      }
    }

    // 6. Update Visuals
    this.updateTerritoryVisuals();
    this.updateArmyVisuals(deltaSeconds);
  }

  private executeAiTurn(): void {
    const move = evaluateAiMove(this.gameState.territories, 'enemy', 8);
    if (!move) return;

    const source = this.gameState.territories[move.fromId];
    const target = this.gameState.territories[move.toId];
    if (!source || !target) return;

    const dispatch = dispatchArmy(source, target, 'enemy', 0.5);
    if (dispatch.success && dispatch.army && dispatch.sourceTerritory) {
      this.gameState.territories[source.id] = dispatch.sourceTerritory;
      this.gameState.armies.push(dispatch.army);
      this.gameState.stats.enemyUnitsDispatched += dispatch.army.units;

      // Small telegraph pulse on AI territory
      const vis = this.territoryVisuals.get(source.id);
      if (vis) {
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

    if (arrival.captured) {
      // Capture Feedback!
      if (arrival.targetId === 'n_center') {
        sounds.playCrownCapture();
        this.cameras.main.shake(180, 0.008);
      } else {
        sounds.playCapture();
        this.cameras.main.shake(120, 0.005);
      }
      this.platform.hapticImpact('heavy');

      // Shake & scale pop
      this.tweens.add({
        targets: vis.container,
        scale: 1.25,
        duration: 130,
        yoyo: true,
        ease: 'Back.easeOut',
      });

      // Expanding Shockwave Ring
      const shockwave = this.add
        .circle(vis.territory.x, vis.territory.y, vis.territory.radius, teamStyle.glow, 0.6)
        .setDepth(30);

      this.tweens.add({
        targets: shockwave,
        scale: 2.2,
        alpha: 0,
        duration: 400,
        ease: 'Cubic.easeOut',
        onComplete: () => shockwave.destroy(),
      });

      // Floating capture badge
      this.spawnFloatingText(
        vis.territory.x,
        vis.territory.y - 20,
        `+${arrival.remainingUnits}`,
        teamStyle.lightHex
      );
    } else if (arrival.reinforced) {
      // Friendly Reinforcement Feedback
      sounds.playReinforce();
      this.platform.hapticImpact('light');

      this.tweens.add({
        targets: vis.container,
        scale: 1.08,
        duration: 90,
        yoyo: true,
      });

      this.spawnFloatingText(
        vis.territory.x,
        vis.territory.y - 20,
        `+${arrival.incomingUnits}`,
        '#10b981'
      );
    } else {
      // Attack defended / repelled
      sounds.playCombatHit();
      this.platform.hapticImpact('medium');

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

      this.spawnFloatingText(
        vis.territory.x,
        vis.territory.y - 20,
        `-${arrival.incomingUnits}`,
        '#ef4444'
      );
    }
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

      vis.territory = stateTerritory;
      vis.unitText.setText(stateTerritory.units.toString());

      const teamStyle = THEME.teams[stateTerritory.owner];
      vis.ring.setStrokeStyle(3, teamStyle.primary);
      vis.ring.setFillStyle(teamStyle.glow, 0.25);
      vis.unitBadge.setStrokeStyle(1.5, teamStyle.primary);

      const targetTexture = this.getTerritoryTextureKey(stateTerritory);
      if (vis.sprite.texture.key !== targetTexture) {
        vis.sprite.setTexture(targetTexture);
      }
    }
  }

  private spawnDustPuff(x: number, y: number): void {
    const jitterX = Math.random() * 4 - 2;
    const jitterY = Math.random() * 3 - 1.5;
    const dust = this.add
      .circle(x + jitterX, y + 6 + jitterY, 3, 0x94a3b8, 0.45)
      .setDepth(33);

    this.tweens.add({
      targets: dust,
      scale: 1.8,
      alpha: 0,
      y: dust.y - 4,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => dust.destroy(),
    });
  }

  private updateArmyVisuals(deltaSeconds: number): void {
    const activeArmyIds = new Set(this.gameState.armies.map((a) => a.id));

    // Destroy visuals for finished armies
    for (const [id, visual] of this.armyVisuals.entries()) {
      if (!activeArmyIds.has(id)) {
        visual.container.destroy();
        this.armyVisuals.delete(id);
      }
    }

    // Update or create visual for each active army
    for (const army of this.gameState.armies) {
      const currentX = Phaser.Math.Linear(army.startX, army.targetX, army.progress);
      const currentY = Phaser.Math.Linear(army.startY, army.targetY, army.progress);

      let visual = this.armyVisuals.get(army.id);

      if (!visual) {
        const teamStyle = THEME.teams[army.owner];
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

        const followers: ArmyFollower[] = [];
        const followerTexture = army.owner === 'player' ? 'unit_follower_player' : 'unit_follower_enemy';

        for (const f of followerOffsets) {
          const shadow = this.add.ellipse(f.x, f.y + 7, 13, 6, 0x000000, 0.32);
          const sprite = this.add
            .image(f.x, f.y, followerTexture)
            .setScale(0.19)
            .setFlipX(isFacingLeft);

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

        // High-contrast Troop Count Pill Badge
        const badgeY = -19;
        const initialUnits = army.units.toString();
        const badgeWidth = Math.max(26, initialUnits.length * 8 + 14);
        const badgeBg = this.add
          .rectangle(0, badgeY, badgeWidth, 18, 0x090d16, 0.94)
          .setStrokeStyle(1.5, teamStyle.primary, 1);

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
          id: army.id,
          container,
          leaderSprite,
          leaderShadow,
          badgeBg,
          badgeText,
          followers,
          rearOffset: { x: lastOffset.x, y: lastOffset.y },
          dustTimer: 0.05,
        };
        this.armyVisuals.set(army.id, visual);
      } else {
        visual.container.setPosition(currentX, currentY);
        const unitsStr = army.units.toString();
        if (visual.badgeText.text !== unitsStr) {
          visual.badgeText.setText(unitsStr);
          const newWidth = Math.max(26, unitsStr.length * 8 + 14);
          visual.badgeBg.setSize(newWidth, 18);
        }

        // Emit rhythmic dust puff behind rearmost follower
        visual.dustTimer -= deltaSeconds;
        if (visual.dustTimer <= 0) {
          visual.dustTimer = 0.14;
          this.spawnDustPuff(
            currentX + visual.rearOffset.x,
            currentY + visual.rearOffset.y
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
    this.timerText.setText(`⏱ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);

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

    this.playerDomText.setText(`${playerPct}%`);
    this.enemyDomText.setText(`${enemyPct}%`);

    // Smooth Tug-of-War Crown Needle glide towards the leading front
    const targetCrownX = barStartX + playerWidth + neutralWidth / 2;
    this.tugCrown.x = Phaser.Math.Linear(this.tugCrown.x, targetCrownX, 0.12);
  }

  private showResultModal(status: 'victory' | 'defeat' | 'draw'): void {
    if (this.resultModalContainer || this.resultPending) return;

    sounds.stopBattleMusic();

    const duration = Math.floor(this.gameState.elapsedTimeSeconds);
    const stats: MatchStats = {
      matchDurationSeconds: duration,
      playerUnitsDispatched: this.gameState.stats.playerUnitsDispatched,
      enemyUnitsDispatched: this.gameState.stats.enemyUnitsDispatched,
      territoriesCapturedByPlayer: this.gameState.stats.territoriesCapturedByPlayer,
      territoriesCapturedByEnemy: this.gameState.stats.territoriesCapturedByEnemy,
    };

    this.resultPending = true;
    void this.finalizeMatch(status, stats);
  }

  private async finalizeMatch(status: 'victory' | 'defeat' | 'draw', stats: MatchStats): Promise<void> {
    try {
      await this.backendConnectPromise;
      const settlement = this.careerManager.isRemoteConnected()
        ? await this.careerManager.recordMatchResultRemote(status, stats, this.activeMatchId)
        : isLocalCareerFallbackAllowed()
          ? this.careerManager.recordMatchResult(status, stats, this.activeMatchId)
          : (() => {
              throw new Error('backend_required_for_match_settlement');
            })();

      this.resultPending = false;
      this.renderResultModal(status, stats, settlement);
    } catch (error) {
      this.resultPending = false;
      this.showSettlementError(status, stats, error);
    }
  }

  private renderResultModal(
    status: 'victory' | 'defeat' | 'draw',
    stats: MatchStats,
    settlement: ReturnType<CareerManager['recordMatchResult']>
  ): void {
    const duration = stats.matchDurationSeconds;
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
      .rectangle(0, -208, 280, 26, 0x111c33, 0.95)
      .setStrokeStyle(1.5, rankTier.color, 0.9);

    const rankText = this.add
      .text(0, -208, `${rankTier.badge} ${rankTier.name.toUpperCase()} (🏆 ${settlement.newCareer.trophies})`, {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

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
    const breakdownParts: string[] = [`Base: ${settlement.breakdown.baseCoins}`];
    if (settlement.breakdown.speedBonus > 0) breakdownParts.push(`Speed: +${settlement.breakdown.speedBonus}`);
    if (settlement.breakdown.dominationBonus > 0) breakdownParts.push(`Dominance: +${settlement.breakdown.dominationBonus}`);
    if (settlement.breakdown.streakBonus > 0) breakdownParts.push(`Streak: +${settlement.breakdown.streakBonus}`);

    const bonusChipText = this.add
      .text(0, -105, breakdownParts.join('  •  '), {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#38bdf8',
        stroke: '#000000',
        strokeThickness: 1.5,
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
      y: number;
      icon: string;
      title: string;
    }> = [
      { type: 'starting_garrison', y: 12, icon: '🏰', title: 'STRONGHOLD' },
      { type: 'production', y: 58, icon: '⚒', title: 'WAR FORGE' },
      { type: 'army_speed', y: 104, icon: '⚡', title: 'SWIFT MARCH' },
    ];

    for (const row of upgradeRows) {
      const rowBg = this.add
        .rectangle(0, row.y, 280, 40, 0x111827, 0.96)
        .setStrokeStyle(1, 0x334155, 1);
      const label = this.add
        .text(-128, row.y, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#e2e8f0',
          stroke: '#000000',
          strokeThickness: 1.5,
          lineSpacing: 1,
          resolution: 2,
        })
        .setOrigin(0, 0.5);
      const buyBg = this.add
        .rectangle(103, row.y, 66, 28, 0x2563eb, 1)
        .setStrokeStyle(1.5, 0x60a5fa, 1);
      const buyText = this.add
        .text(103, row.y, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '10px',
          fontStyle: '900',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 1.5,
          resolution: 2,
        })
        .setOrigin(0.5);

      const refresh = (): void => {
        const career = this.careerManager.getCareer();
        const level = getUpgradeLevel(career, row.type);
        const maxLevel = UPGRADE_DEFINITIONS[row.type].maxLevel;
        const cost = getNextUpgradeCost(career, row.type);
        const effect =
          row.type === 'starting_garrison'
            ? `+${level * 3} starting troops`
            : row.type === 'production'
              ? `+${level * 8}% production`
              : `+${level * 6}% march speed`;

        label.setText(`${row.icon} ${row.title}  LV.${level}/${maxLevel}\n${effect}`);
        buyText.setText(cost === null ? 'MAX' : `${cost} 🪙`);
        upgradeBalanceText.setText(`UPGRADE YOUR ARMY  •  ${career.coins} 🪙`);

        const canBuy = cost !== null && career.coins >= cost;
        buyBg
          .setFillStyle(canBuy ? 0x2563eb : 0x273449, 1)
          .setStrokeStyle(1.5, canBuy ? 0x60a5fa : 0x475569, 1);
        buyText.setColor(canBuy ? '#ffffff' : '#94a3b8');
        if (canBuy) {
          buyBg.setInteractive({ useHandCursor: true });
        } else {
          buyBg.disableInteractive();
        }
      };

      buyBg.on('pointerdown', () => {
        buyBg.disableInteractive();
        void this.purchaseUpgrade(row.type, refreshUpgradeRows);
      });

      refreshUpgradeRows.push(refresh);
      upgradeObjects.push(rowBg, label, buyBg, buyText);
    }
    refreshUpgradeRows.forEach((refresh) => refresh());
    trackUpgradeEvent({
      name: 'upgrade_panel_viewed',
      coins: settlement.newCareer.coins,
      startingGarrisonLevel: settlement.newCareer.startingGarrisonLevel,
      productionLevel: settlement.newCareer.productionLevel,
      armySpeedLevel: settlement.newCareer.armySpeedLevel,
    });

    // Play Again Button
    const btnY = 170;
    const btnBg = this.add
      .rectangle(0, btnY, 240, 44, isWin ? 0x2563eb : 0x374151, 1)
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
      this.restartMatch();
    });

    // Native Messenger Share Button
    const shareY = 225;
    const shareBg = this.add
      .rectangle(0, shareY, 240, 38, 0x1e293b, 1)
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

    modal.add([
      backdrop,
      card,
      title,
      subtitle,
      rankBanner,
      rankText,
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

  private showSettlementError(
    status: 'victory' | 'defeat' | 'draw',
    stats: MatchStats,
    error: unknown
  ): void {
    console.error('[GameScene] Match settlement failed:', error);

    const modal = this.add.container(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2).setDepth(220);
    this.resultModalContainer = modal;

    const card = this.add
      .rectangle(0, 0, 300, 210, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0xef4444, 0.95);
    const title = this.add
      .text(0, -62, 'SYNC FAILED', {
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
      .text(0, -20, 'Your result was not saved.\nRetry before leaving the battle.', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        align: 'center',
        lineSpacing: 5,
        resolution: 2,
      })
      .setOrigin(0.5);
    const retryBg = this.add
      .rectangle(0, 55, 190, 42, 0x2563eb, 1)
      .setStrokeStyle(2, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const retryText = this.add
      .text(0, 55, 'RETRY SYNC', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    retryBg.on('pointerdown', () => {
      modal.destroy();
      this.resultModalContainer = undefined;
      this.resultPending = true;
      void this.finalizeMatch(status, stats);
    });

    modal.add([card, title, message, retryBg, retryText]);
  }

  private async purchaseUpgrade(
    type: UpgradeType,
    refreshUpgradeRows: Array<() => void>
  ): Promise<void> {
    try {
      await this.backendConnectPromise;
      const purchase = this.careerManager.isRemoteConnected()
        ? await this.careerManager.purchaseUpgradeRemote(type)
        : isLocalCareerFallbackAllowed()
          ? this.careerManager.purchaseUpgrade(type)
          : (() => {
              throw new Error('backend_required_for_upgrade_purchase');
            })();

      if (purchase.success) {
        sounds.playCoin();
        this.platform.hapticNotification('success');
        trackUpgradeEvent({
          name: 'upgrade_purchase_succeeded',
          upgradeType: type,
          level: getUpgradeLevel(purchase.newCareer, type),
          cost: purchase.cost,
          resultingCoins: purchase.newCareer.coins,
        });
      } else {
        trackUpgradeEvent({
          name: 'upgrade_purchase_failed',
          upgradeType: type,
          cost: purchase.cost,
          reason: purchase.reason,
          coins: purchase.newCareer.coins,
        });
      }
    } catch (error) {
      console.error('[GameScene] Upgrade purchase failed:', error);
      this.platform.hapticNotification('error');
    } finally {
      refreshUpgradeRows.forEach((refreshRow) => refreshRow());
    }
  }

  private createMatchId(): string {
    return `match_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private restartMatch(): void {
    if (this.resultModalContainer) {
      this.resultModalContainer.destroy();
      this.resultModalContainer = undefined;
    }

    // Destroy all army visuals
    for (const visual of this.armyVisuals.values()) {
      visual.container.destroy();
    }
    this.armyVisuals.clear();

    // Reset state & restart scene cleanly
    this.activeMatchId = this.createMatchId();
    trackEvent({ name: 'match_start', source: 'rematch' });
    this.createUpgradedMatchState();
    this.accumulators = {};
    this.selectedSourceIds = [];
    this.hoveredTargetId = null;
    this.lastHoveredFriendlyId = null;
    for (const ring of this.selectionRings.values()) {
      ring.setVisible(false);
    }
    this.dragGraphics.clear();
    this.dragBadgeContainer.setVisible(false);
    this.aiTimer = 1.6;
    this.lastHeartbeatSecond = -1;

    // Restart atmospheric battle music
    sounds.startBattleMusic();

    // Reset territory objects
    this.updateTerritoryVisuals();

    // Small celebratory restart pop
    this.cameras.main.flash(200, 20, 30, 50);
  }

  private createUpgradedMatchState(): void {
    const modifiers = getPlayerUpgradeModifiers(this.careerManager.getCareer());
    this.playerArmySpeedMultiplier = modifiers.armySpeedMultiplier;
    this.gameState = createInitialGameState({ playerModifiers: modifiers });
  }
}

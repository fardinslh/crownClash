import Phaser from 'phaser';
import {
  CombatResult,
  createInitialGameState,
  dispatchArmy,
  evaluateAiMove,
  GameState,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  stepSimulation,
  Territory,
} from '@crown-clash/game-core';
import { sounds } from '../audio/SoundEffects.js';
import { THEME } from '../theme.js';

interface TerritoryVisual {
  territory: Territory;
  container: Phaser.GameObjects.Container;
  bgCircle: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  crownIcon?: Phaser.GameObjects.Text;
  unitText: Phaser.GameObjects.Text;
  nameText: Phaser.GameObjects.Text;
}

interface ArmyVisual {
  id: string;
  container: Phaser.GameObjects.Container;
  circle: Phaser.GameObjects.Arc;
  text: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private gameState!: GameState;
  private accumulators: Record<string, number> = {};
  private territoryVisuals: Map<string, TerritoryVisual> = new Map();
  private armyVisuals: Map<string, ArmyVisual> = new Map();

  // Interaction / Dragging
  private selectedSourceId: string | null = null;
  private hoveredTargetId: string | null = null;
  private dragGraphics!: Phaser.GameObjects.Graphics;
  private selectionRing!: Phaser.GameObjects.Arc;

  // AI Timer
  private aiTimer: number = 0;
  private aiInterval: number = 1.8; // seconds between AI decisions

  // UI HUD Elements
  private timerText!: Phaser.GameObjects.Text;
  private playerBar!: Phaser.GameObjects.Rectangle;
  private enemyBar!: Phaser.GameObjects.Rectangle;
  private neutralBar!: Phaser.GameObjects.Rectangle;

  // Result Modal
  private resultModalContainer?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.gameState = createInitialGameState();
    this.accumulators = {};
    this.territoryVisuals.clear();
    this.armyVisuals.clear();
    this.selectedSourceId = null;
    this.hoveredTargetId = null;
    this.aiTimer = 0.5; // first AI check after 0.5s

    // 1. Draw Arena Background & Connecting Lanes
    this.createArenaBackground();

    // 2. Drag & selection graphics
    this.dragGraphics = this.add.graphics().setDepth(50);
    this.selectionRing = this.add
      .circle(0, 0, 40, 0xffffff, 0)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setVisible(false)
      .setDepth(45);

    // 3. Build Territory Visuals
    this.createTerritoryObjects();

    // 4. Create HUD
    this.createHud();

    // 5. Setup Pointer Input Listeners
    this.setupInputs();
  }

  private createArenaBackground(): void {
    // Subtle gradient-like arena background
    const bg = this.add.rectangle(
      LOGICAL_WIDTH / 2,
      LOGICAL_HEIGHT / 2,
      LOGICAL_WIDTH,
      LOGICAL_HEIGHT,
      THEME.background
    );
    bg.setDepth(0);

    // Tactical subtle lane connections between strategic territories
    const lanesGraphics = this.add.graphics().setDepth(1);
    lanesGraphics.lineStyle(2, THEME.arenaGrid, 0.7);

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
    connections.forEach(([idA, idB]) => {
      const a = terrs[idA];
      const b = terrs[idB];
      if (a && b) {
        lanesGraphics.lineBetween(a.x, a.y, b.x, b.y);
      }
    });

    // Subtle arena perimeter glow
    const border = this.add.graphics().setDepth(2);
    border.lineStyle(2, THEME.arenaBorder, 0.5);
    border.strokeRoundedRect(8, 8, LOGICAL_WIDTH - 16, LOGICAL_HEIGHT - 16, 16);
  }

  private createTerritoryObjects(): void {
    Object.values(this.gameState.territories).forEach((territory) => {
      const container = this.add.container(territory.x, territory.y).setDepth(20);

      const teamStyle = THEME.teams[territory.owner];

      // Outer glow / border ring
      const ring = this.add
        .circle(0, 0, territory.radius + 4, teamStyle.glow, 0.25)
        .setStrokeStyle(3, teamStyle.primary, 1);

      // Core territory body
      const bgCircle = this.add.circle(0, 0, territory.radius, teamStyle.dark, 1);

      // Crown icon for bases
      let crownIcon: Phaser.GameObjects.Text | undefined;
      if (territory.id === 'p_base' || territory.id === 'e_base' || territory.id === 'n_center') {
        const symbol = territory.id === 'n_center' ? '👑' : '🏰';
        crownIcon = this.add
          .text(0, -territory.radius * 0.42, symbol, {
            fontSize: territory.id === 'n_center' ? '15px' : '14px',
          })
          .setOrigin(0.5);
        container.add(crownIcon);
      }

      // Unit Count Text
      const unitText = this.add
        .text(0, crownIcon ? 4 : 0, territory.units.toString(), {
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: territory.tier === 3 ? '22px' : '18px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setOrigin(0.5);

      // Subtitle / Name Text
      const nameText = this.add
        .text(0, territory.radius + 12, territory.name, {
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '10px',
          color: THEME.textMuted,
        })
        .setOrigin(0.5);

      container.add([ring, bgCircle, unitText, nameText]);

      // Make interactive for touch / click
      container.setSize(territory.radius * 2.4, territory.radius * 2.4);
      container.setInteractive({ useHandCursor: true });

      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.startDragFromTerritory(territory.id, pointer);
      });

      this.territoryVisuals.set(territory.id, {
        territory,
        container,
        bgCircle,
        ring,
        crownIcon,
        unitText,
        nameText,
      });
    });
  }

  private createHud(): void {
    const hudY = 24;

    // Top Title
    this.add
      .text(LOGICAL_WIDTH / 2, hudY, 'CROWN CLASH', {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '15px',
        fontStyle: '900',
        color: THEME.textLight,
      })
      .setOrigin(0.5)
      .setDepth(100);

    // Match Timer
    this.timerText = this.add
      .text(LOGICAL_WIDTH / 2, hudY + 22, '01:30', {
        fontFamily: 'monospace, -apple-system',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fbbf24',
      })
      .setOrigin(0.5)
      .setDepth(100);

    // Territory Dominance Balance Bar
    const barWidth = 240;
    const barHeight = 8;
    const barY = hudY + 42;

    this.add
      .rectangle(LOGICAL_WIDTH / 2, barY, barWidth, barHeight, 0x1e293b)
      .setDepth(99);

    this.playerBar = this.add
      .rectangle(LOGICAL_WIDTH / 2 - barWidth / 2, barY, 80, barHeight, THEME.teams.player.primary)
      .setOrigin(0, 0.5)
      .setDepth(100);

    this.neutralBar = this.add
      .rectangle(LOGICAL_WIDTH / 2, barY, 80, barHeight, THEME.teams.neutral.primary)
      .setOrigin(0, 0.5)
      .setDepth(100);

    this.enemyBar = this.add
      .rectangle(LOGICAL_WIDTH / 2 + barWidth / 2, barY, 80, barHeight, THEME.teams.enemy.primary)
      .setOrigin(1, 0.5)
      .setDepth(100);

    // Bottom Tactical Control Hint
    this.add
      .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 24, 'Drag from your Blue territory to attack or reinforce', {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '11px',
        color: '#64748b',
      })
      .setOrigin(0.5)
      .setDepth(100);
  }

  private setupInputs(): void {
    // Global scene pointerdown for responsive touch targets
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.gameState.status !== 'playing' || this.selectedSourceId) return;

      for (const t of Object.values(this.gameState.territories)) {
        const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, t.x, t.y);
        if (dist <= t.radius + 16) {
          this.startDragFromTerritory(t.id, pointer);
          break;
        }
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.selectedSourceId) return;

      // Find hovered territory
      let found: Territory | null = null;
      for (const t of Object.values(this.gameState.territories)) {
        if (t.id === this.selectedSourceId) continue;
        const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, t.x, t.y);
        if (dist <= t.radius + 18) {
          found = t;
          break;
        }
      }
      this.hoveredTargetId = found ? found.id : null;

      this.renderDragTrajectory(pointer);
    });

    this.input.on('pointerup', () => {
      this.handlePointerRelease();
    });
  }

  private startDragFromTerritory(territoryId: string, _pointer?: Phaser.Input.Pointer): void {
    if (this.gameState.status !== 'playing') return;

    // Always inspect live gameState so any captured territory can dispatch immediately
    const territory = this.gameState.territories[territoryId];
    if (!territory) return;

    if (territory.owner === 'player' && territory.units > 1) {
      this.selectedSourceId = territoryId;
      this.selectionRing.setPosition(territory.x, territory.y).setVisible(true);

      const vis = this.territoryVisuals.get(territoryId);
      if (vis) {
        this.tweens.add({
          targets: vis.container,
          scale: 1.12,
          duration: 100,
          ease: 'Sine.easeOut',
        });
      }

      sounds.playDispatch();
    }
  }

  private renderDragTrajectory(pointer: Phaser.Input.Pointer): void {
    this.dragGraphics.clear();
    if (!this.selectedSourceId) return;

    const src = this.gameState.territories[this.selectedSourceId];
    if (!src) return;

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

    // Draw trajectory line with glow
    this.dragGraphics.lineStyle(5, color, 0.9);
    this.dragGraphics.lineBetween(src.x, src.y, targetX, targetY);

    // Arrowhead / target circle indicator
    if (isHoveringTarget && target) {
      this.dragGraphics.lineStyle(3, color, 1);
      this.dragGraphics.strokeCircle(target.x, target.y, target.radius + 8);
    } else {
      this.dragGraphics.fillStyle(color, 0.9);
      this.dragGraphics.fillCircle(targetX, targetY, 6);
    }
  }

  private handlePointerRelease(): void {
    if (!this.selectedSourceId) return;

    const sourceId = this.selectedSourceId;
    const targetId = this.hoveredTargetId;

    // Reset visuals
    const vis = this.territoryVisuals.get(sourceId);
    if (vis) {
      this.tweens.add({
        targets: vis.container,
        scale: 1.0,
        duration: 120,
        ease: 'Sine.easeOut',
      });
    }

    this.selectedSourceId = null;
    this.hoveredTargetId = null;
    this.selectionRing.setVisible(false);
    this.dragGraphics.clear();

    if (targetId && targetId !== sourceId) {
      const src = this.gameState.territories[sourceId];
      const target = this.gameState.territories[targetId];

      if (src && target) {
        // Execute Player Dispatch
        const dispatch = dispatchArmy(src, target, 'player', 0.5);
        if (dispatch.success && dispatch.army && dispatch.sourceTerritory) {
          // Update territory units in state
          this.gameState.territories[sourceId] = dispatch.sourceTerritory;
          this.gameState.armies.push(dispatch.army);
          this.gameState.stats.playerUnitsDispatched += dispatch.army.units;

          sounds.playDispatch();
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
    this.updateArmyVisuals();
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
      sounds.playCapture();

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
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color,
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

  private updateTerritoryVisuals(): void {
    for (const [id, vis] of this.territoryVisuals.entries()) {
      const stateTerritory = this.gameState.territories[id];
      if (!stateTerritory) continue;

      vis.territory = stateTerritory;
      vis.unitText.setText(stateTerritory.units.toString());

      const teamStyle = THEME.teams[stateTerritory.owner];
      vis.bgCircle.setFillStyle(teamStyle.dark);
      vis.ring.setStrokeStyle(3, teamStyle.primary);
      vis.ring.setFillStyle(teamStyle.glow, 0.25);
    }
  }

  private updateArmyVisuals(): void {
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

        const circle = this.add
          .circle(0, 0, 13, teamStyle.primary, 1)
          .setStrokeStyle(2, 0xffffff, 0.95);

        const text = this.add
          .text(0, 0, army.units.toString(), {
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#ffffff',
          })
          .setOrigin(0.5);

        container.add([circle, text]);
        visual = { id: army.id, container, circle, text };
        this.armyVisuals.set(army.id, visual);
      } else {
        visual.container.setPosition(currentX, currentY);
        visual.text.setText(army.units.toString());
      }
    }
  }

  private updateHud(): void {
    // 1. Timer
    const remaining = Math.max(0, this.gameState.timeLimitSeconds - this.gameState.elapsedTimeSeconds);
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    this.timerText.setText(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);

    if (remaining <= 10) {
      this.timerText.setColor('#ef4444');
    }

    // 2. Dominance Bar
    const territories = Object.values(this.gameState.territories);
    const total = territories.length;
    const playerCount = territories.filter((t) => t.owner === 'player').length;
    const enemyCount = territories.filter((t) => t.owner === 'enemy').length;
    const neutralCount = total - playerCount - enemyCount;

    const barTotalWidth = 240;
    const playerWidth = (playerCount / total) * barTotalWidth;
    const neutralWidth = (neutralCount / total) * barTotalWidth;
    const enemyWidth = (enemyCount / total) * barTotalWidth;

    const startX = LOGICAL_WIDTH / 2 - barTotalWidth / 2;
    this.playerBar.setPosition(startX, this.playerBar.y).setDisplaySize(playerWidth, 8);
    this.neutralBar.setPosition(startX + playerWidth, this.neutralBar.y).setDisplaySize(neutralWidth, 8);
    this.enemyBar.setPosition(startX + playerWidth + neutralWidth, this.enemyBar.y).setDisplaySize(enemyWidth, 8);
  }

  private showResultModal(status: 'victory' | 'defeat' | 'draw'): void {
    if (this.resultModalContainer) return;

    if (status === 'victory') {
      sounds.playVictory();
    } else {
      sounds.playDefeat();
    }

    const isWin = status === 'victory';
    const titleText = isWin ? 'VICTORY!' : 'DEFEAT';
    const titleColor = isWin ? '#fbbf24' : '#ef4444';
    const subText = isWin
      ? 'All enemy fortresses captured!'
      : 'Your defenses have fallen!';

    const modal = this.add.container(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2).setDepth(200);

    // Dark backdrop overlay
    const backdrop = this.add
      .rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.75)
      .setInteractive();

    // Modal Card
    const card = this.add
      .rectangle(0, 0, 320, 360, 0x111827, 0.98)
      .setStrokeStyle(2, isWin ? 0xf59e0b : 0xef4444, 0.9);

    const title = this.add
      .text(0, -120, titleText, {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '34px',
        fontStyle: '900',
        color: titleColor,
      })
      .setOrigin(0.5);

    const subtitle = this.add
      .text(0, -78, subText, {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '13px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    // Stats Section
    const duration = Math.floor(this.gameState.elapsedTimeSeconds);
    const statsText = this.add
      .text(
        0,
        -15,
        `⏱ Match Time: ${duration}s\n\n🏰 Territories Captured: ${this.gameState.stats.territoriesCapturedByPlayer}\n\n⚔ Units Dispatched: ${this.gameState.stats.playerUnitsDispatched}`,
        {
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '14px',
          color: '#e2e8f0',
          align: 'center',
          lineSpacing: 4,
        }
      )
      .setOrigin(0.5);

    // Play Again Button
    const btnY = 95;
    const btnBg = this.add
      .rectangle(0, btnY, 220, 52, isWin ? 0x2563eb : 0x374151, 1)
      .setStrokeStyle(2, isWin ? 0x60a5fa : 0x9ca3af, 1)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add
      .text(0, btnY, 'PLAY AGAIN ⚔', {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    btnBg.on('pointerover', () => {
      btnBg.setScale(1.04);
      btnText.setScale(1.04);
    });

    btnBg.on('pointerout', () => {
      btnBg.setScale(1.0);
      btnText.setScale(1.0);
    });

    btnBg.on('pointerdown', () => {
      sounds.playDispatch();
      this.restartMatch();
    });

    modal.add([backdrop, card, title, subtitle, statsText, btnBg, btnText]);

    // Modal Entrance Animation
    modal.setScale(0.8);
    modal.setAlpha(0);
    this.tweens.add({
      targets: modal,
      scale: 1.0,
      alpha: 1.0,
      duration: 220,
      ease: 'Back.easeOut',
    });

    this.resultModalContainer = modal;
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
    this.gameState = createInitialGameState();
    this.accumulators = {};
    this.selectedSourceId = null;
    this.hoveredTargetId = null;
    this.aiTimer = 0.5;

    // Reset territory objects
    this.updateTerritoryVisuals();

    // Small celebratory restart pop
    this.cameras.main.flash(200, 20, 30, 50);
  }
}

import Phaser from 'phaser';
import {
  getRankTier,
  getCommander,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
} from '@crown-clash/game-core';
import { trackEvent } from '../analytics/Analytics.js';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { CareerManager } from '../career/CareerManager.js';
import { sounds } from '../audio/SoundEffects.js';
import { THEME } from '../theme.js';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';
import { LiveMatchClient } from '../api/LiveMatchClient.js';
import { LivePvpController, isValidRoomCode, sanitizeRoomCode } from '../pvp/LivePvpController.js';
import { isTutorialCompleted } from '../tutorial/TutorialController.js';
import { dismissStartupLoadingShell } from '../ui/StartupLoadingShell.js';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export class MenuScene extends Phaser.Scene {
  private liveClient?: LiveMatchClient;
  private pvpController?: LivePvpController;
  private backButtonUnregister?: () => void;
  private joinCodeInput?: HTMLInputElement;
  private joinCodeInputCleanup?: () => void;

  constructor() {
    super({ key: 'MenuScene' });
  }

  shutdown(): void {
    this.pvpController?.destroy();
    this.pvpController = undefined;
    this.liveClient?.close();
    this.liveClient = undefined;
    this.backButtonUnregister?.();
    this.backButtonUnregister = undefined;
    this.joinCodeInputCleanup?.();
    this.joinCodeInput = undefined;
    this.joinCodeInputCleanup = undefined;
  }

  create(): void {
    const renderScale = this.registry.get('renderScale') as number || 1;
    this.cameras.main.setZoom(renderScale);
    this.cameras.main.centerOn(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);

    const platform: PlatformAdapter =
      (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    const careerManager = CareerManager.getInstance(platform.getUser().id);

    void this.initializeMenu(platform, careerManager);
  }

  private async initializeMenu(
    platform: PlatformAdapter,
    careerManager: CareerManager
  ): Promise<void> {
    try {
      await careerManager.connect(platform);
    } catch (error) {
      console.warn('[MenuScene] Backend unavailable, using local career cache:', error);
    }

    if (!careerManager.isRemoteConnected() && !isLocalCareerFallbackAllowed()) {
      this.showBackendUnavailable();
      return;
    }

    const career = careerManager.getCareer();
    const rank = getRankTier(career.trophies);

    sounds.stopBattleMusic();
    trackEvent({
      name: 'menu_viewed',
      rankId: rank.id,
    });

    this.add.rectangle(
      LOGICAL_WIDTH / 2,
      LOGICAL_HEIGHT / 2,
      LOGICAL_WIDTH,
      LOGICAL_HEIGHT,
      0x070b14
    );

    const glow = this.add.graphics();
    glow.fillStyle(0x1d4ed8, 0.16);
    glow.fillCircle(LOGICAL_WIDTH / 2, 248, 118);
    glow.fillStyle(THEME.gold, 0.08);
    glow.fillCircle(LOGICAL_WIDTH / 2, 248, 168);

    const crest = this.add.container(LOGICAL_WIDTH / 2, 248);
    const crestRing = this.add.circle(0, 0, 78, 0x0c1322, 0.96).setStrokeStyle(2.5, THEME.gold, 0.95);
    const innerRing = this.add.circle(0, 0, 62, 0x111c33, 0.9).setStrokeStyle(1.5, 0x60a5fa, 0.55);
    const crown = this.add
      .text(0, -4, '👑', {
        fontSize: '54px',
        resolution: 2,
      })
      .setOrigin(0.5);
    crest.add([crestRing, innerRing, crown]);
    this.tweens.add({
      targets: crest,
      y: 240,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.add
      .text(LOGICAL_WIDTH / 2, 78, 'CROWN CLASH', {
        fontFamily: FONT_FAMILY,
        fontSize: '34px',
        fontStyle: '900',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 5,
        resolution: 2,
      })
      .setOrigin(0.5);

    this.add
      .text(LOGICAL_WIDTH / 2, 114, 'TAKE THE REALM', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#93c5fd',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    this.add
      .rectangle(LOGICAL_WIDTH / 2, 368, 280, 34, 0x111c33, 0.95)
      .setStrokeStyle(1.5, rank.color, 0.9);
    this.add
      .text(LOGICAL_WIDTH / 2, 368, `${rank.badge}  ${rank.name.toUpperCase()}  •  🏆 ${career.trophies}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    this.add
      .rectangle(LOGICAL_WIDTH / 2 - 72, 418, 124, 44, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0xf59e0b, 0.85);
    this.add
      .text(LOGICAL_WIDTH / 2 - 72, 408, 'GOLD', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.add
      .text(LOGICAL_WIDTH / 2 - 72, 426, `🪙 ${career.coins}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        fontStyle: '900',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    this.add
      .rectangle(LOGICAL_WIDTH / 2 + 72, 418, 124, 44, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x818cf8, 0.85);
    this.add
      .text(LOGICAL_WIDTH / 2 + 72, 408, 'WINS', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 1.5,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.add
      .text(LOGICAL_WIDTH / 2 + 72, 426, `👑 ${career.matchesWon}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        fontStyle: '900',
        color: '#c7d2fe',
        stroke: '#000000',
        strokeThickness: 2.5,
        resolution: 2,
      })
      .setOrigin(0.5);

    const commander = getCommander(career.selectedCommanderId);
    this.add
      .text(LOGICAL_WIDTH / 2, 461, `DOCTRINE  •  ${commander.name.toUpperCase()}`, {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: '900',
        color: '#93c5fd',
        resolution: 2,
      })
      .setOrigin(0.5);

    const playBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 500, 250, 56, 0x2563eb, 1)
      .setStrokeStyle(2.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const playText = this.add
      .text(LOGICAL_WIDTH / 2, 500, 'PLAY  ⚔', {
        fontFamily: FONT_FAMILY,
        fontSize: '22px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(playBg, playText);

    playBg.on('pointerover', () => {
      playBg.setScale(1.03);
      playText.setScale(1.03);
    });
    playBg.on('pointerout', () => {
      playBg.setScale(1);
      playText.setScale(1);
    });
    playBg.on('pointerdown', () => {
      playBg.disableInteractive();
      playText.setText('SCOUTING...');
      void careerManager.startBotMatch(platform).then((botMatch) => {
        if (!this.scene.isActive()) return;
        sounds.playDispatch();
        platform.hapticImpact('medium');
        this.scene.start('GameScene', { source: 'menu', botMatch });
      }).catch((error: unknown) => {
        console.error('[MenuScene] Match start failed:', error);
        if (!this.scene.isActive()) return;
        playText.setText('TRY AGAIN');
        playBg.setInteractive({ useHandCursor: true });
        platform.hapticNotification('error');
      });
    });

    const secondaryButtonStyle = (online: boolean): { fill: number; stroke: number } => ({
      fill: online ? 0x111c33 : 0x273449,
      stroke: online ? 0x60a5fa : 0x475569,
    });

    const liveStyle = secondaryButtonStyle(careerManager.isRemoteConnected());
    const liveBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 562, 250, 48, liveStyle.fill, 1)
      .setStrokeStyle(1.5, liveStyle.stroke, 1)
      .setInteractive({ useHandCursor: true });
    const liveText = this.add
      .text(
        LOGICAL_WIDTH / 2,
        562,
        careerManager.isRemoteConnected() ? 'LIVE PVP  ⚔' : 'LIVE PVP OFFLINE',
        {
          fontFamily: FONT_FAMILY,
          fontSize: '14px',
          fontStyle: '900',
          color: careerManager.isRemoteConnected() ? '#bfdbfe' : '#94a3b8',
          stroke: '#000000',
          strokeThickness: 2,
          resolution: 2,
        }
      )
      .setOrigin(0.5);
    this.bindPressFeedback(liveBg, liveText);

    if (!careerManager.isRemoteConnected()) {
      liveBg.disableInteractive();
    } else {
      liveBg.on('pointerdown', () => {
        liveBg.disableInteractive();
        this.openLivePvpLobby(platform, careerManager, liveBg, liveText);
      });
    }

    const trainingComplete = isTutorialCompleted(platform.getUser().id);
    const trainingBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 622, 250, 44, 0x1c1830, 1)
      .setStrokeStyle(1.5, THEME.gold, 0.9)
      .setInteractive({ useHandCursor: true });
    const trainingText = this.add
      .text(
        LOGICAL_WIDTH / 2,
        622,
        trainingComplete ? 'WAR ACADEMY  ✓' : 'NEW  •  WAR ACADEMY',
        {
          fontFamily: FONT_FAMILY,
          fontSize: '12px',
          fontStyle: '900',
          color: '#fde68a',
          stroke: '#000000',
          strokeThickness: 2,
          resolution: 2,
        }
      )
      .setOrigin(0.5);
    this.bindPressFeedback(trainingBg, trainingText);
    trainingBg.on('pointerdown', () => {
      trainingBg.disableInteractive();
      sounds.playReinforce();
      platform.hapticSelection();
      this.scene.start('TrainingScene');
    });

    const dailyAvailable = careerManager.isRemoteConnected() || isLocalCareerFallbackAllowed();
    const dailyBg = this.add
      .rectangle(56, 680, 82, 44, dailyAvailable ? 0x1c1830 : 0x273449, 1)
      .setStrokeStyle(1.5, dailyAvailable ? THEME.gold : 0x475569, 0.9)
      .setInteractive({ useHandCursor: true });
    const dailyText = this.add
      .text(56, 680, dailyAvailable ? 'DAILY' : 'OFFLINE', {
        fontFamily: FONT_FAMILY,
        fontSize: dailyAvailable ? '12px' : '10px',
        fontStyle: '900',
        color: dailyAvailable ? '#fde68a' : '#94a3b8',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(dailyBg, dailyText);
    if (dailyAvailable) {
      dailyBg.on('pointerdown', () => {
        dailyBg.disableInteractive();
        sounds.playReinforce();
        platform.hapticSelection();
        this.scene.start('DailyScene');
      });
    } else {
      dailyBg.disableInteractive();
    }

    const leagueBg = this.add
      .rectangle(152, 680, 82, 44, 0x151d31, 1)
      .setStrokeStyle(1.5, 0x818cf8, 0.9)
      .setInteractive({ useHandCursor: true });
    const leagueText = this.add
      .text(152, 680, 'LEAGUE', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: '900',
        color: '#c7d2fe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(leagueBg, leagueText);
    leagueBg.on('pointerdown', () => {
      leagueBg.disableInteractive();
      sounds.playTrophy();
      platform.hapticSelection();
      this.scene.start('LeagueScene');
    });

    const kingdomBg = this.add
      .rectangle(248, 680, 82, 44, 0x111c33, 1)
      .setStrokeStyle(1.5, THEME.gold, 0.8)
      .setInteractive({ useHandCursor: true });
    const kingdomText = this.add
      .text(248, 680, 'KINGDOM', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: '900',
        color: '#fde68a',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(kingdomBg, kingdomText);
    kingdomBg.on('pointerdown', () => {
      kingdomBg.disableInteractive();
      sounds.playReinforce();
      platform.hapticSelection();
      this.scene.start('KingdomScene');
    });

    const commanderBg = this.add
      .rectangle(344, 680, 82, 44, 0x172033, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 0.85)
      .setInteractive({ useHandCursor: true });
    const commanderText = this.add
      .text(344, 680, 'COUNCIL', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: '900',
        color: '#bfdbfe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(commanderBg, commanderText);
    commanderBg.on('pointerdown', () => {
      commanderBg.disableInteractive();
      sounds.playReinforce();
      platform.hapticSelection();
      this.scene.start('CommanderScene');
    });

    const muteX = LOGICAL_WIDTH - 28;
    const muteBg = this.add
      .rectangle(muteX, 28, 40, 36, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.8);
    const muteBtn = this.add
      .text(muteX, 28, sounds.isMuted() ? '🔇' : '🔊', {
        fontSize: '14px',
        resolution: 2,
      })
      .setOrigin(0.5)
    muteBg.setInteractive({ useHandCursor: true });
    muteBg.on('pointerdown', () => {
      const muted = sounds.toggleMute();
      muteBtn.setText(muted ? '🔇' : '🔊');
      platform.hapticSelection();
    });
    this.bindPressFeedback(muteBg, muteBtn);
    dismissStartupLoadingShell();
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

  private openLivePvpLobby(
    platform: PlatformAdapter,
    careerManager: CareerManager,
    raidButton: Phaser.GameObjects.Rectangle,
    raidText: Phaser.GameObjects.Text
  ): void {
    // ------------------------------------------------------------------ setup
    const controller = new LivePvpController();
    this.pvpController?.destroy();
    this.pvpController = controller;

    // Root overlay – centred coordinate system (0,0 = screen centre)
    const overlay = this.add
      .container(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2)
      .setDepth(150);

    // Dim the background; swallow all pointer events so nothing behind fires
    const backdrop = this.add
      .rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.78)
      .setInteractive();
    overlay.add(backdrop);

    // View containers – only one is visible at a time
    const lobbyView = this.add.container(0, 0);
    const waitingView = this.add.container(0, 0);
    const joinView = this.add.container(0, 0);
    const loadingView = this.add.container(0, 0);
    const errorView = this.add.container(0, 0);
    overlay.add([lobbyView, waitingView, joinView, loadingView, errorView]);

    const hideAll = (): void => {
      [lobbyView, waitingView, joinView, loadingView, errorView].forEach((v) =>
        v.setVisible(false)
      );
      joinInput.style.display = 'none';
    };

    // --------------------------------------------------- helpers
    const TS = (
      txt: string,
      x: number,
      y: number,
      size: string,
      color: string,
      extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}
    ) =>
      this.add
        .text(x, y, txt, {
          fontFamily: FONT_FAMILY,
          fontSize: size,
          fontStyle: 'bold',
          color,
          stroke: '#000000',
          strokeThickness: 2,
          resolution: 2,
          align: 'center',
          ...extra,
        })
        .setOrigin(0.5);

    const makeBtn = (
      x: number,
      y: number,
      w: number,
      h: number,
      fill: number,
      strokeColor: number,
      label: string,
      labelColor: string,
      labelSize = '14px'
    ): { bg: Phaser.GameObjects.Rectangle; txt: Phaser.GameObjects.Text } => {
      const bg = this.add
        .rectangle(x, y, w, h, fill, 1)
        .setStrokeStyle(1.5, strokeColor, 1)
        .setInteractive({ useHandCursor: true });
      const txt = this.add
        .text(x, y, label, {
          fontFamily: FONT_FAMILY,
          fontSize: labelSize,
          fontStyle: '900',
          color: labelColor,
          stroke: '#000000',
          strokeThickness: 2,
          resolution: 2,
        })
        .setOrigin(0.5);
      this.bindPressFeedback(bg, txt);
      return { bg, txt };
    };

    // --------------------------------------------------- CLOSE / BACK helper
    const closeLobby = (): void => {
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.destroy();
      this.pvpController = undefined;
      this.backButtonUnregister?.();
      this.backButtonUnregister = undefined;
      platform.hideBackButton();
      cleanupJoinInput();
      overlay.destroy();
      raidButton.setInteractive({ useHandCursor: true });
      raidText.setText('LIVE PVP  ⚔');
    };

    // ---------------------------------------------------------------- LOBBY VIEW
    const lobbyCard = this.add
      .rectangle(0, 0, 320, 300, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0x60a5fa, 0.95);

    TS('LIVE PVP', 0, -120, '22px', '#bfdbfe', { fontStyle: '900', strokeThickness: 3 });
    TS('Challenge a Commander in real time', 0, -92, '10px', '#94a3b8', { strokeThickness: 1 });

    const { bg: queueBg, txt: queueTxt } = makeBtn(
      0, -42, 260, 52, 0x2563eb, 0x60a5fa, 'QUICK MATCH  ⚔', '#ffffff', '14px'
    );
    const { bg: createBg, txt: createTxt } = makeBtn(
      0, 20, 260, 48, 0x0e2a1a, 0x34d399, 'CREATE BATTLE  🔗', '#6ee7b7', '13px'
    );
    const { bg: joinBg, txt: joinTxt } = makeBtn(
      0, 75, 260, 48, 0x11153a, 0x818cf8, 'JOIN BATTLE  ↗', '#c7d2fe', '13px'
    );

    // Close ✕ in top-right of lobby card
    const lobbyCloseBg = this.add
      .rectangle(145, -135, 44, 44, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    const lobbyCloseBtn = TS('✕', 145, -135, '20px', '#94a3b8');
    this.bindPressFeedback(lobbyCloseBg, lobbyCloseBtn);
    lobbyCloseBg.on('pointerdown', closeLobby);

    lobbyView.add([
      lobbyCard, queueBg, queueTxt, createBg, createTxt, joinBg, joinTxt,
      lobbyCloseBg, lobbyCloseBtn,
    ]);

    // -------------------------------------------------------- WAITING VIEW (room host)
    const waitCard = this.add
      .rectangle(0, 0, 320, 340, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0x34d399, 0.9);
    const waitTitle = TS('BATTLE ROOM CREATED', 0, -145, '14px', '#6ee7b7', { fontStyle: '900', strokeThickness: 2 });
    const waitSubtitle = TS('Share this code with your opponent', 0, -122, '10px', '#94a3b8', { strokeThickness: 1 });

    // Big mono room-code badge
    const codeBadgeBg = this.add
      .rectangle(0, -75, 260, 54, 0x071a10, 0.98)
      .setStrokeStyle(2, 0x34d399, 0.85);
    const codeText = this.add
      .text(0, -75, '--------', {
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#86efac',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
        letterSpacing: 6,
      })
      .setOrigin(0.5);

    const { bg: copyBg, txt: copyTxt } = makeBtn(
      -67, -5, 120, 44, 0x1c2a1c, 0x34d399, '📋  COPY', '#86efac', '12px'
    );
    const { bg: shareBg, txt: shareTxt } = makeBtn(
      67, -5, 120, 44, 0x111c33, 0x60a5fa, '🔗  SHARE', '#93c5fd', '12px'
    );

    // Pulsing waiting indicator
    const waitDot = TS('⏳', 0, 52, '18px', '#fbbf24');
    const waitStatus = TS('WAITING FOR OPPONENT…', 0, 80, '11px', '#94a3b8', { strokeThickness: 1 });
    this.tweens.add({
      targets: waitDot,
      alpha: 0.3,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const { bg: leaveRoomBg, txt: leaveRoomTxt } = makeBtn(
      0, 130, 180, 42, 0x1f0a0a, 0xf87171, '✕  LEAVE ROOM', '#fca5a5', '12px'
    );

    waitingView.add([
      waitCard, waitTitle, waitSubtitle,
      codeBadgeBg, codeText,
      copyBg, copyTxt,
      shareBg, shareTxt,
      waitDot, waitStatus,
      leaveRoomBg, leaveRoomTxt,
    ]);

    // -------------------------------------------------------- JOIN CODE VIEW
    // Position panel high (y = -120 from screen centre) so it sits above
    // the virtual keyboard (typically 280–350 px tall on mobile)
    const joinCard = this.add
      .rectangle(0, -110, 300, 210, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0x818cf8, 0.9);
    const joinTitle = TS('ENTER INVITE CODE', 0, -200, '14px', '#c7d2fe', { fontStyle: '900', strokeThickness: 2 });
    const joinSubtitle = TS('8-character code your friend shared', 0, -182, '10px', '#94a3b8', { strokeThickness: 1 });

    // Keep the keyboard input invisible. Phaser renders the visible field so
    // it always shares the modal's coordinate system on every viewport.
    const joinInput = document.createElement('input');
    joinInput.type = 'text';
    joinInput.maxLength = 8;
    joinInput.autocomplete = 'off';
    joinInput.autocapitalize = 'characters';
    joinInput.spellcheck = false;
    joinInput.inputMode = 'text';
    joinInput.setAttribute('aria-label', 'Invite code');
    joinInput.style.cssText = [
      'position: fixed',
      'display: none',
      'left: 0',
      'bottom: 0',
      'width: 1px',
      'height: 1px',
      'opacity: 0',
      'pointer-events: none',
      'font-size: 16px',
      'border: 0',
      'margin: 0',
      'padding: 0',
    ].join(';');
    document.body.appendChild(joinInput);

    let inputCleanedUp = false;
    const cleanupJoinInput = (): void => {
      if (inputCleanedUp) return;
      inputCleanedUp = true;
      joinInput.remove();
      if (this.joinCodeInput === joinInput) this.joinCodeInput = undefined;
      if (this.joinCodeInputCleanup === cleanupJoinInput) {
        this.joinCodeInputCleanup = undefined;
      }
    };

    this.joinCodeInput = joinInput;
    this.joinCodeInputCleanup = cleanupJoinInput;
    const joinInputBg = this.add
      .rectangle(0, -123, 230, 46, 0x0f172a, 1)
      .setStrokeStyle(2, 0x818cf8, 1)
      .setInteractive({ useHandCursor: true });
    const joinInputText = this.add
      .text(0, -123, 'TAP TO TYPE', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: '700',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);
    const joinErrorText = TS('', 0, -87, '10px', '#f87171', { strokeThickness: 1 });

    const { bg: joinSubmitBg, txt: joinSubmitTxt } = makeBtn(
      55, -50, 130, 42, 0x2563eb, 0x60a5fa, 'JOIN  ↗', '#ffffff', '13px'
    );
    const { bg: joinCancelBg, txt: joinCancelTxt } = makeBtn(
      -75, -50, 100, 42, 0x1a1a2e, 0x475569, 'CANCEL', '#94a3b8', '12px'
    );

    joinView.add([
      joinCard, joinTitle, joinSubtitle,
      joinInputBg, joinInputText,
      joinErrorText,
      joinSubmitBg, joinSubmitTxt,
      joinCancelBg, joinCancelTxt,
    ]);

    // -------------------------------------------------------- LOADING VIEW
    const loadCard = this.add
      .rectangle(0, 0, 280, 160, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0x60a5fa, 0.8);
    const loadSpinner = TS('⏳', 0, -30, '32px', '#60a5fa');
    const loadText = TS('CONNECTING…', 0, 18, '13px', '#93c5fd', { strokeThickness: 2 });
    this.tweens.add({
      targets: loadSpinner,
      angle: 360,
      duration: 1200,
      repeat: -1,
    });
    const { bg: loadCancelBg, txt: loadCancelTxt } = makeBtn(
      0, 58, 140, 38, 0x1f0a0a, 0xf87171, 'CANCEL', '#fca5a5', '12px'
    );
    loadingView.add([loadCard, loadSpinner, loadText, loadCancelBg, loadCancelTxt]);

    // -------------------------------------------------------- ERROR VIEW
    const errCard = this.add
      .rectangle(0, 0, 300, 220, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0xf87171, 0.9);
    const errIcon = TS('⚠', 0, -85, '28px', '#f87171');
    const errMsg = this.add
      .text(0, -38, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fca5a5',
        stroke: '#000000',
        strokeThickness: 1,
        resolution: 2,
        align: 'center',
        wordWrap: { width: 260 },
      })
      .setOrigin(0.5);
    const { bg: retryBg, txt: retryTxt } = makeBtn(
      -70, 62, 120, 42, 0x2563eb, 0x60a5fa, '↺  RETRY', '#ffffff', '12px'
    );
    const { bg: errBackBg, txt: errBackTxt } = makeBtn(
      70, 62, 120, 42, 0x111c33, 0x475569, '← BACK', '#94a3b8', '12px'
    );
    errorView.add([errCard, errIcon, errMsg, retryBg, retryTxt, errBackBg, errBackTxt]);

    // ------------------------------------------------ VIEW RENDERER
    let lastRetryMode: 'queue' | 'create' | 'join' = 'queue';
    let lastRetryCode = '';

    const showView = (view: import('../pvp/LivePvpController.js').LivePvpView, opts: {
      code?: string; error?: string; copied?: boolean;
    } = {}): void => {
      hideAll();
      switch (view) {
        case 'lobby':
          lobbyView.setVisible(true);
          this.backButtonUnregister?.();
          platform.hideBackButton();
          this.backButtonUnregister = platform.on('backButtonClicked', closeLobby);
          platform.showBackButton(closeLobby);
          break;
        case 'creating':
        case 'joining':
        case 'queueing':
          loadingView.setVisible(true);
          loadText.setText(
            view === 'creating' ? 'CREATING ROOM…' :
            view === 'joining'  ? 'JOINING ROOM…' :
                                   'FINDING OPPONENT…'
          );
          break;
        case 'waiting': {
          waitingView.setVisible(true);
          const formatted = opts.code
            ? opts.code.slice(0, 4) + '-' + opts.code.slice(4)
            : '--------';
          codeText.setText(formatted);
          if (opts.copied) {
            copyTxt.setText('COPIED! ✓');
            copyBg.setFillStyle(0x065f46, 1);
          } else {
            copyTxt.setText('📋  COPY');
            copyBg.setFillStyle(0x1c2a1c, 1);
          }
          const backToLobby = (): void => controller.cancel();
          this.backButtonUnregister?.();
          this.backButtonUnregister = platform.on('backButtonClicked', backToLobby);
          platform.showBackButton(backToLobby);
          break;
        }
        case 'entering_code': {
          joinView.setVisible(true);
          joinInput.style.display = 'block';
          joinErrorText.setText(opts.error ?? '');
          const backToLobby = (): void => controller.cancel();
          this.backButtonUnregister?.();
          this.backButtonUnregister = platform.on('backButtonClicked', backToLobby);
          platform.showBackButton(backToLobby);
          break;
        }
        case 'error':
          errorView.setVisible(true);
          errMsg.setText(opts.error ?? 'Could not connect to Live PvP.');
          break;
      }
    };

    // ------------------------------------------------ STATE SUBSCRIPTION
    controller.subscribe((state) => {
      showView(state.view, {
        code: state.roomCode,
        error: state.errorMessage,
        copied: state.copied,
      });
    });

    // ------------------------------------------------ LIVE CLIENT FACTORY
    const startClient = (mode: 'queue' | 'create' | 'join', roomCode?: string): void => {
      if (this.liveClient) return;
      lastRetryMode = mode;
      lastRetryCode = roomCode ?? '';

      let client: LiveMatchClient;
      try {
        client = careerManager.openLiveMatchRemote();
      } catch {
        controller.onError('invite_create_failed');
        return;
      }
      this.liveClient = client;

      let matchStarted = false;

      client.on('invite_created', ({ roomCode: createdCode }) => {
        controller.onInviteCreated(createdCode);
      });

      client.on('match_started', (match) => {
        matchStarted = true;
        trackEvent({ name: 'live_match_started', matchId: match.matchId });
        controller.destroy();
        this.pvpController = undefined;
        platform.hideBackButton();
        this.backButtonUnregister?.();
        this.backButtonUnregister = undefined;
        cleanupJoinInput();
        overlay.destroy();
        this.liveClient = undefined;
        this.scene.start('GameScene', {
          source: 'menu',
          mode: 'live',
          liveClient: client,
          liveMatch: match,
        });
      });

      client.on('error', ({ code }) => {
        if (matchStarted) return;
        controller.onError(code);
        client.close();
        this.liveClient = undefined;
      });

      client.on('closed', () => {
        if (matchStarted) return;
        controller.onError('connection_closed');
        this.liveClient = undefined;
      });

      void client
        .connect(mode, roomCode)
        .then(() => {
          if (mode === 'queue') trackEvent({ name: 'live_queue_joined' });
          if (mode === 'create') trackEvent({ name: 'live_invite_created' });
          if (mode === 'join') trackEvent({ name: 'live_invite_joined' });
        })
        .catch((err: unknown) => {
          const code =
            err instanceof Error ? err.message : 'invite_create_failed';
          controller.onError(code);
          client.close();
          this.liveClient = undefined;
        });
    };

    // ------------------------------------------------ LOBBY BUTTON HANDLERS
    queueBg.on('pointerdown', () => {
      if (!controller.startQueueing()) return;
      startClient('queue');
    });

    createBg.on('pointerdown', () => {
      if (!controller.startCreating()) return;
      startClient('create');
    });

    joinBg.on('pointerdown', () => {
      const linked = new URLSearchParams(window.location.search).get('liveRoom');
      if (linked) {
        if (!controller.startJoining(linked).success) return;
        startClient('join', linked);
        return;
      }
      controller.startEnteringCode();
      window.setTimeout(() => {
        joinInput.value = '';
        joinInputText
          .setText('TAP TO TYPE')
          .setFontSize('11px')
          .setColor('#94a3b8')
          .setLetterSpacing(0);
        joinInput.focus();
      }, 80);
    });

    // ------------------------------------------------ WAITING VIEW HANDLERS
    copyBg.on('pointerdown', () => {
      const state = controller.getState();
      if (!state.roomCode) return;
      const bare = state.roomCode;
      if (navigator.clipboard) {
        void navigator.clipboard.writeText(bare).then(() => {
          controller.markCopied();
          platform.hapticNotification('success');
        });
      } else {
        const ta = document.createElement('textarea');
        ta.value = bare;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        controller.markCopied();
        platform.hapticNotification('success');
      }
    });

    shareBg.on('pointerdown', () => {
      const state = controller.getState();
      if (!state.roomCode) return;
      const code = state.roomCode;
      const url = new URL(window.location.href);
      url.searchParams.set('liveRoom', code);
      void platform.share({
        text: `Join my live Crown Clash battle! Code: ${code.slice(0,4)}-${code.slice(4)}`,
        url: url.toString(),
      });
      platform.hapticSelection();
    });

    leaveRoomBg.on('pointerdown', () => {
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.cancel();
      platform.hapticSelection();
    });

    // ------------------------------------------------ JOIN CODE VIEW HANDLERS
    const joinInputEl = joinInput;
    joinInputBg.on('pointerdown', () => joinInputEl.focus());
    joinInputEl.addEventListener('input', () => {
      const sanitized = sanitizeRoomCode(joinInputEl.value);
      if (joinInputEl.value !== sanitized) joinInputEl.value = sanitized;
      joinInputText
        .setText(sanitized || 'TAP TO TYPE')
        .setFontSize(sanitized ? '22px' : '11px')
        .setColor(sanitized ? '#ffffff' : '#94a3b8')
        .setLetterSpacing(sanitized ? 5 : 0);
      joinErrorText.setText('');
      const valid = isValidRoomCode(sanitized);
      joinSubmitBg.setFillStyle(valid ? 0x2563eb : 0x1e293b, 1);
    });
    joinInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinSubmitBg.emit('pointerdown');
    });
    joinInputEl.addEventListener('focus', () => {
      joinInputBg.setStrokeStyle(2, 0xa5b4fc, 1);
    });
    joinInputEl.addEventListener('blur', () => {
      joinInputBg.setStrokeStyle(2, 0x818cf8, 1);
    });

    joinSubmitBg.on('pointerdown', () => {
      const code = sanitizeRoomCode(joinInputEl.value);
      const result = controller.startJoining(code);
      if (!result.success) {
        joinErrorText.setText(result.error ?? 'Invalid code.');
        platform.hapticNotification('error');
        return;
      }
      startClient('join', code);
    });

    joinCancelBg.on('pointerdown', () => {
      controller.cancel();
      platform.hapticSelection();
    });

    // ------------------------------------------------ LOADING CANCEL
    loadCancelBg.on('pointerdown', () => {
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.cancel();
      platform.hapticSelection();
    });

    // ------------------------------------------------ ERROR VIEW HANDLERS
    retryBg.on('pointerdown', () => {
      if (this.liveClient) return;
      if (lastRetryMode === 'join') {
        if (!controller.startJoining(lastRetryCode).success) return;
      } else if (lastRetryMode === 'create') {
        if (!controller.startCreating()) return;
      } else {
        if (!controller.startQueueing()) return;
      }
      startClient(lastRetryMode, lastRetryCode || undefined);
      platform.hapticSelection();
    });

    errBackBg.on('pointerdown', () => {
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.returnToLobby();
      platform.hapticSelection();
    });
  }

  private showBackendUnavailable(): void {
    this.add.rectangle(
      LOGICAL_WIDTH / 2,
      LOGICAL_HEIGHT / 2,
      LOGICAL_WIDTH,
      LOGICAL_HEIGHT,
      0x070b14
    );
    this.add
      .text(LOGICAL_WIDTH / 2, 250, 'CROWN CLASH', {
        fontFamily: FONT_FAMILY,
        fontSize: '30px',
        fontStyle: '900',
        color: '#f8fafc',
        stroke: '#000000',
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.add
      .text(LOGICAL_WIDTH / 2, 330, 'Connection required to load your realm.', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#cbd5e1',
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);
    const retryBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 410, 190, 50, 0x2563eb, 1)
      .setStrokeStyle(2, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const retryText = this.add
      .text(LOGICAL_WIDTH / 2, 410, 'RETRY', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(retryBg, retryText);
    retryBg.on('pointerdown', () => this.scene.restart());
    dismissStartupLoadingShell();
  }
}

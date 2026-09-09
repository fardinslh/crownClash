import Phaser from 'phaser';
import {
  getRankTier,
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

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export class MenuScene extends Phaser.Scene {
  private liveClient?: LiveMatchClient;

  constructor() {
    super({ key: 'MenuScene' });
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

    const playBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 518, 250, 56, 0x2563eb, 1)
      .setStrokeStyle(2.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const playText = this.add
      .text(LOGICAL_WIDTH / 2, 518, 'PLAY  ⚔', {
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
      sounds.playDispatch();
      platform.hapticImpact('medium');
      this.scene.start('GameScene', { source: 'menu' });
    });

    const secondaryButtonStyle = (online: boolean): { fill: number; stroke: number } => ({
      fill: online ? 0x111c33 : 0x273449,
      stroke: online ? 0x60a5fa : 0x475569,
    });

    const liveStyle = secondaryButtonStyle(careerManager.isRemoteConnected());
    const liveBg = this.add
      .rectangle(LOGICAL_WIDTH / 2, 590, 250, 50, liveStyle.fill, 1)
      .setStrokeStyle(1.5, liveStyle.stroke, 1)
      .setInteractive({ useHandCursor: true });
    const liveText = this.add
      .text(
        LOGICAL_WIDTH / 2,
        590,
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

    const dailyOnline = careerManager.isRemoteConnected();
    const dailyBg = this.add
      .rectangle(LOGICAL_WIDTH / 2 - 66, 654, 118, 44, dailyOnline ? 0x1c1830 : 0x273449, 1)
      .setStrokeStyle(1.5, dailyOnline ? THEME.gold : 0x475569, 0.9)
      .setInteractive({ useHandCursor: true });
    const dailyText = this.add
      .text(LOGICAL_WIDTH / 2 - 66, 654, dailyOnline ? '📜 DAILY' : 'DAILY OFFLINE', {
        fontFamily: FONT_FAMILY,
        fontSize: dailyOnline ? '13px' : '10px',
        fontStyle: '900',
        color: dailyOnline ? '#fde68a' : '#94a3b8',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(dailyBg, dailyText);
    if (dailyOnline) {
      dailyBg.on('pointerdown', () => {
        dailyBg.disableInteractive();
        sounds.playReinforce();
        platform.hapticSelection();
        this.scene.start('DailyScene');
      });
    } else {
      dailyBg.disableInteractive();
    }

    const kingdomBg = this.add
      .rectangle(LOGICAL_WIDTH / 2 + 66, 654, 118, 44, 0x111c33, 1)
      .setStrokeStyle(1.5, THEME.gold, 0.8)
      .setInteractive({ useHandCursor: true });
    const kingdomText = this.add
      .text(LOGICAL_WIDTH / 2 + 66, 654, '🏰 KINGDOM', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
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
    const overlay = this.add.container(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2).setDepth(150);
    const backdrop = this.add
      .rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.76)
      .setInteractive();
    const card = this.add
      .rectangle(0, 0, 330, 430, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0x60a5fa, 0.95);
    const title = this.add
      .text(0, -190, 'LIVE PVP', {
        fontFamily: FONT_FAMILY,
        fontSize: '24px',
        fontStyle: '900',
        color: '#bfdbfe',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(0, -155, 'Play against a commander in real time', {
        fontFamily: FONT_FAMILY,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);
    const status = this.add
      .text(0, 125, 'Choose how to enter the battle', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#60a5fa',
        align: 'center',
        resolution: 2,
      })
      .setOrigin(0.5);
    const closeBg = this.add
      .rectangle(140, -200, 40, 40, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    const close = this.add
      .text(140, -200, '✕', {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color: '#94a3b8',
        resolution: 2,
      })
      .setOrigin(0.5);

    const closeLobby = (): void => {
      this.liveClient?.close();
      this.liveClient = undefined;
      overlay.destroy();
      raidButton.setInteractive({ useHandCursor: true });
      raidText.setText('LIVE PVP  ⚔');
    };
    closeBg.on('pointerdown', closeLobby);
    this.bindPressFeedback(closeBg, close);
    const queueBg = this.add
      .rectangle(0, -95, 250, 50, 0x2563eb, 1)
      .setStrokeStyle(2, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const queueText = this.add
      .text(0, -95, 'FIND OPPONENT  ⚔', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    const createBg = this.add
      .rectangle(0, -35, 250, 50, 0x111c33, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const createText = this.add
      .text(0, -35, 'CREATE INVITE  🔗', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#bfdbfe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    const joinBg = this.add
      .rectangle(0, 25, 250, 50, 0x111c33, 1)
      .setStrokeStyle(1.5, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const joinText = this.add
      .text(0, 25, 'JOIN INVITE  ↗', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        fontStyle: '900',
        color: '#bfdbfe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(queueBg, queueText);
    this.bindPressFeedback(createBg, createText);
    this.bindPressFeedback(joinBg, joinText);
    overlay.add([
      backdrop,
      card,
      title,
      subtitle,
      status,
      closeBg,
      close,
      queueBg,
      queueText,
      createBg,
      createText,
      joinBg,
      joinText,
    ]);

    const startClient = (mode: 'queue' | 'create' | 'join', roomCode?: string): void => {
      if (this.liveClient) return;
      let client: LiveMatchClient;
      try {
        client = careerManager.openLiveMatchRemote();
      } catch {
        status.setText('COULD NOT CONNECT TO LIVE PVP');
        raidButton.setInteractive({ useHandCursor: true });
        raidText.setText('LIVE PVP  ⚔');
        return;
      }
      this.liveClient = client;
      let matchStarted = false;
      client.on('queue_waiting', () => status.setText('WAITING FOR AN OPPONENT...'));
      client.on('invite_waiting', () => status.setText('SHARE THE INVITE CODE WITH YOUR FRIEND'));
      client.on('invite_created', ({ roomCode: createdCode }) => {
        status.setText(`INVITE CODE: ${createdCode}\nWaiting for your friend...`);
        const inviteUrl = new URL(window.location.href);
        inviteUrl.searchParams.set('liveRoom', createdCode);
        void platform.share({
          text: `Join my live Crown Clash battle. Code: ${createdCode}`,
          url: inviteUrl.toString(),
        });
      });
      client.on('match_started', (match) => {
        matchStarted = true;
        trackEvent({ name: 'live_match_started', matchId: match.matchId });
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
        status.setText(`LIVE PVP ERROR\n${code}`);
        client.close();
        this.liveClient = undefined;
        raidButton.setInteractive({ useHandCursor: true });
        raidText.setText('LIVE PVP  ⚔');
      });
      client.on('closed', () => {
        if (matchStarted) return;
        status.setText('CONNECTION CLOSED');
        this.liveClient = undefined;
        raidButton.setInteractive({ useHandCursor: true });
        raidText.setText('LIVE PVP  ⚔');
      });
      void client.connect(mode, roomCode)
        .then(() => {
          if (mode === 'queue') trackEvent({ name: 'live_queue_joined' });
          if (mode === 'create') trackEvent({ name: 'live_invite_created' });
          if (mode === 'join') trackEvent({ name: 'live_invite_joined' });
        })
        .catch(() => {
          status.setText('COULD NOT CONNECT TO LIVE PVP');
          client.close();
          this.liveClient = undefined;
          raidButton.setInteractive({ useHandCursor: true });
          raidText.setText('LIVE PVP  ⚔');
        });
    };

    queueBg.on('pointerdown', () => startClient('queue'));
    createBg.on('pointerdown', () => startClient('create'));
    joinBg.on('pointerdown', () => {
      const linkedRoomCode = new URLSearchParams(window.location.search).get('liveRoom');
      if (linkedRoomCode) {
        startClient('join', linkedRoomCode);
        return;
      }
      // window.prompt is unavailable in most messenger WebViews; use an
      // in-scene input instead.
      this.showJoinCodeEntry(overlay, (roomCode) => startClient('join', roomCode));
    });
  }

  private showJoinCodeEntry(
    overlay: Phaser.GameObjects.Container,
    onStart: (roomCode: string) => void
  ): void {
    const panel = this.add.container(0, 0);
    const backdrop = this.add
      .rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.72)
      .setInteractive();
    const card = this.add
      .rectangle(0, 0, 300, 210, 0x0c1322, 0.99)
      .setStrokeStyle(2, 0x60a5fa, 0.95);
    const title = this.add
      .text(0, -72, 'ENTER INVITE CODE', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: '900',
        color: '#bfdbfe',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    const input = this.add.dom(
      0,
      -15,
      'input',
      'width: 220px; height: 44px; font-size: 20px; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 4px; border-radius: 8px; border: 2px solid #60a5fa; background: #0f172a; color: #ffffff; outline: none; box-sizing: border-box;',
      ''
    );
    const errorText = this.add
      .text(0, 22, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#f87171',
        resolution: 2,
      })
      .setOrigin(0.5);
    const joinBg = this.add
      .rectangle(0, 66, 180, 42, 0x2563eb, 1)
      .setStrokeStyle(2, 0x60a5fa, 1)
      .setInteractive({ useHandCursor: true });
    const joinText = this.add
      .text(0, 66, 'JOIN BATTLE', {
        fontFamily: FONT_FAMILY,
        fontSize: '13px',
        fontStyle: '900',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);
    this.bindPressFeedback(joinBg, joinText);
    panel.add([backdrop, card, title, input, errorText, joinBg, joinText]);
    overlay.add(panel);

    const inputElement = input.node as HTMLInputElement;
    const submit = (): void => {
      const value = (inputElement.value || '').trim().toUpperCase();
      if (!/^[0-9A-F]{8}$/.test(value)) {
        errorText.setText('Enter the 8-character code your friend shared');
        return;
      }
      panel.destroy();
      onStart(value);
    };
    joinBg.on('pointerdown', submit);
    inputElement.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    window.setTimeout(() => inputElement.focus(), 50);
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
  }
}

import Phaser from 'phaser';
import { getRankTier, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';
import { trackEvent } from '../analytics/Analytics.js';
import { CareerManager } from '../career/CareerManager.js';
import { sounds } from '../audio/SoundEffects.js';
import { THEME } from '../theme.js';
import { createPlatformAdapter, PlatformAdapter } from '@crown-clash/platform';

const FONT_FAMILY = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const platform: PlatformAdapter =
      (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    const user = platform.getUser();
    const career = CareerManager.getInstance(user.id).getCareer();
    const rank = getRankTier(career.trophies);

    sounds.stopBattleMusic();
    trackEvent({ name: 'session_start', playerId: user.id });
    trackEvent({
      name: 'menu_viewed',
      coins: career.coins,
      trophies: career.trophies,
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

    this.add
      .text(LOGICAL_WIDTH / 2, 572, 'Drag across towers to attack or reinforce', {
        fontFamily: FONT_FAMILY,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 2,
        resolution: 2,
      })
      .setOrigin(0.5);

    const muteX = LOGICAL_WIDTH - 28;
    this.add
      .rectangle(muteX, 28, 36, 28, 0x0f172a, 0.95)
      .setStrokeStyle(1.5, 0x334155, 0.8);
    const muteBtn = this.add
      .text(muteX, 28, sounds.isMuted() ? '🔇' : '🔊', {
        fontSize: '14px',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    muteBtn.on('pointerdown', () => {
      const muted = sounds.toggleMute();
      muteBtn.setText(muted ? '🔇' : '🔊');
      platform.hapticSelection();
    });
  }
}

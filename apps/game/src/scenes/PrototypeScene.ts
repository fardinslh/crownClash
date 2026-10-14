import Phaser from 'phaser';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import { sounds } from '../audio/SoundEffects.js';
import { dismissStartupLoadingShell } from '../ui/StartupLoadingShell.js';
import { bindSceneViewportResize, getSceneViewport, setupSceneCamera } from '../ui/Viewport.js';
import { createText } from '../ui/TextStyles.js';
import type { PrototypeMode } from '../prototype/CrownMatch.js';

/** Offline comparison entry: no login, tutorial completion, or economy writes. */
export class PrototypeScene extends Phaser.Scene {
  private launching = false;
  constructor() { super({ key: 'PrototypeScene' }); }

  create(): void {
    this.launching = false;
    setupSceneCamera(this);
    bindSceneViewportResize(this, () => this.scene.restart());
    sounds.stopBattleMusic();
    const platform = this.registry.get('platform') as PlatformAdapter | undefined;
    platform?.showBackButton(() => this.scene.start('MenuScene'));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => platform?.hideBackButton());
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const cx = LOGICAL_WIDTH / 2;
    const top = (visibleHeight - 620) / 2;
    this.add.rectangle(cx, visibleHeight / 2, visibleWidth, visibleHeight, 0x070b14);
    const halo = this.add.graphics();
    halo.fillStyle(0xf59e0b, .07).fillCircle(cx, top + 100, 114);
    this.add.circle(cx, top + 93, 40, 0x182033).setStrokeStyle(2, 0xfbbf24);
    createText(this, cx, top + 93, '👑', { fontSize: '38px' }).setOrigin(.5);
    createText(this, cx, top + 157, 'CROWN PLAYTEST', { fontSize: '27px', color: '#f8fafc' }).setOrigin(.5);
    createText(this, cx, top + 187, 'ONE MAP  /  TWO WAYS TO WIN', { fontSize: '11px', color: '#94a3b8' }).setOrigin(.5);

    const card = (mode: PrototypeMode, y: number, title: string, description: string, color: number) => {
      const bg = this.add.rectangle(cx, y, 340, 128, 0x111c30)
        .setStrokeStyle(1.5, color).setInteractive({ useHandCursor: true });
      createText(this, cx - 148, y - 41, title, { fontSize: '21px', color: mode === 'crown' ? '#fde68a' : '#93c5fd' });
      createText(this, cx - 148, y - 6, description, { fontSize: '12px', color: '#cbd5e1', lineSpacing: 3 });
      createText(this, cx + 143, y - 31, 'PLAY ›', { fontSize: '13px', color: '#ffffff' }).setOrigin(1, .5);
      bg.on('pointerdown', () => {
        if (this.launching) return;
        this.launching = true;
        sounds.playDispatch();
        platform?.hapticSelection();
        this.scene.start('GameScene', { prototypeMode: mode, source: 'menu' });
      });
    };
    card('crown', top + 287, 'CROWN HOLD', 'Hold the center for 12 seconds straight.\nTwo starting towers. Crown makes no troops.', 0xf59e0b);
    card('classic', top + 433, 'CLASSIC', 'Original rules and starting armies.\nConquer the map or lead when time runs out.', 0x3b82f6);
    createText(this, cx, top + 520, '1v1 vs bot · Crown Cross · Equal upgrades\nPractice only — no coins or rank changes', {
      fontSize: '12px', color: '#94a3b8', align: 'center', lineSpacing: 4,
    }).setOrigin(.5);
    const back = this.add.rectangle(cx, top + 580, 220, 46, 0x182033)
      .setStrokeStyle(1, 0x334155).setInteractive({ useHandCursor: true });
    createText(this, cx, top + 580, 'BACK TO MAIN GAME', { fontSize: '13px', color: '#cbd5e1' }).setOrigin(.5);
    back.on('pointerdown', () => this.scene.start('MenuScene'));
    dismissStartupLoadingShell();
  }
}

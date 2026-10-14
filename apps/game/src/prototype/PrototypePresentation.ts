import Phaser from 'phaser';
import { LOGICAL_WIDTH, type MatchStatus } from '@crown-clash/game-core';
import { createText } from '../ui/TextStyles.js';
import { getSceneViewport } from '../ui/Viewport.js';
import { CROWN_CONFIG, type CrownProgress, type PrototypeMode } from './CrownMatch.js';

/** A small fixed HUD and one ring; no particles or per-frame texture creation. */
export class CrownHud {
  private readonly objects: Phaser.GameObjects.GameObject[];
  private readonly banner: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private readonly ring: Phaser.GameObjects.Graphics;
  private lastFrame = '';

  constructor(scene: Phaser.Scene) {
    const plate = scene.add.rectangle(200, 50, 354, 28, 0x0b1425).setDepth(99);
    this.banner = createText(scene, 200, 50, '', { fontSize: '13px', color: '#fde68a' }).setOrigin(.5).setDepth(100);
    this.ring = scene.add.graphics().setDepth(82);
    this.label = createText(scene, 0, 0, '', {
      fontSize: '11px', color: '#fde68a', backgroundColor: '#0b1425', padding: { x: 6, y: 3 },
    }).setOrigin(.5).setDepth(86);
    this.objects = [plate, this.banner, this.ring, this.label];
  }

  update(progress: CrownProgress, point: { u: number; v: number }, scale: number, badgeY: number): void {
    const frame = `${progress.holder}:${Math.floor(progress.heldMs / 100)}:${point.u}:${point.v}:${scale}`;
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    const seconds = ((CROWN_CONFIG.holdMs - progress.heldMs) / 1000).toFixed(1);
    const color = progress.holder === 'player' ? 0x60a5fa : progress.holder === 'enemy' ? 0xf87171 : 0xfbbf24;
    const textColor = `#${color.toString(16).padStart(6, '0')}`;
    this.banner.setText(progress.holder === 'neutral' ? 'TAKE THE CROWN · HOLD FOR 12s'
      : progress.holder === 'player' ? `DEFEND · ${seconds}s TO WIN` : `RETAKE · BOT WINS IN ${seconds}s`).setColor(textColor);
    this.label.setPosition(point.u, point.v + badgeY * scale + 24)
      .setText(progress.holder === 'neutral' ? 'CROWN · NO PRODUCTION' : `${progress.holder === 'player' ? 'YOU' : 'BOT'} · ${seconds}s`)
      .setColor(textColor);
    this.ring.clear();
    const rx = 59 * scale;
    const ry = 29 * scale;
    this.ring.lineStyle(4, 0x0b1425, .85).strokeEllipse(point.u, point.v, rx * 2, ry * 2);
    this.ring.lineStyle(2, color, .45).strokeEllipse(point.u, point.v, rx * 2, ry * 2);
    if (progress.heldMs > 0) {
      const fraction = progress.heldMs / CROWN_CONFIG.holdMs;
      this.ring.lineStyle(4, color, 1).beginPath();
      const steps = Math.max(1, Math.ceil(fraction * 64));
      for (let i = 0; i <= steps; i++) {
        const angle = -Math.PI / 2 + (i / steps) * fraction * Math.PI * 2;
        const x = point.u + Math.cos(angle) * rx;
        const y = point.v + Math.sin(angle) * ry;
        if (i === 0) this.ring.moveTo(x, y); else this.ring.lineTo(x, y);
      }
      this.ring.strokePath();
    }
  }

  destroy(): void { for (const object of this.objects) object.destroy(); }
}

export function renderPrototypeResult(
  scene: Phaser.Scene, mode: PrototypeMode, result: Exclude<MatchStatus, 'playing'>,
  duration: number, captures: number, onRetry: () => void, onCompare: () => void, onMenu: () => void,
): Phaser.GameObjects.Container {
  const { visibleWidth, visibleHeight } = getSceneViewport(scene);
  const container = scene.add.container(LOGICAL_WIDTH / 2, visibleHeight / 2).setDepth(200);
  const shade = scene.add.rectangle(0, 0, visibleWidth, visibleHeight, 0x030712, .8).setInteractive();
  const card = scene.add.rectangle(0, 0, 332, 364, 0x101b2e).setStrokeStyle(2, 0xe9b94f);
  const title = result === 'victory' ? 'VICTORY' : result === 'defeat' ? 'BOT WINS' : 'DRAW';
  const text = (y: number, value: string, size: string, color: string) =>
    createText(scene, 0, y, value, { fontSize: size, color, align: 'center', lineSpacing: 4 }).setOrigin(.5);
  container.add([shade, card,
    text(-146, mode === 'crown' ? 'CROWN HOLD · PLAYTEST' : 'CLASSIC · PLAYTEST', '12px', '#94a3b8'),
    text(-110, title, '32px', result === 'defeat' ? '#fca5a5' : '#fde68a'),
    text(-68, mode === 'crown'
      ? result === 'draw' ? 'Neither side held the crown for 12s.' : `${result === 'victory' ? 'You' : 'The bot'} held the crown for 12 seconds.`
      : 'Original conquest rules.', '13px', '#e2e8f0'),
    text(-32, `${duration.toFixed(1)}s played${mode === 'crown' ? `  ·  ${captures} crown captures` : ''}`, '12px', '#94a3b8'),
  ]);
  let selected = false;
  const button = (y: number, label: string, fill: number, action: () => void) => {
    const bg = scene.add.rectangle(0, y, 280, 48, fill).setStrokeStyle(1, 0x64748b)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => { if (!selected) { selected = true; action(); } });
    container.add([bg, text(y, label, '15px', '#ffffff')]);
  };
  button(17, 'PLAY AGAIN', 0x2563eb, onRetry);
  button(75, mode === 'crown' ? 'COMPARE WITH CLASSIC' : 'TRY CROWN HOLD', 0x273449, onCompare);
  button(133, 'CHOOSE MODE', 0x182033, onMenu);
  container.add(text(166, 'Practice only · No coins or rank changes', '10px', '#94a3b8'));
  return container;
}

import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';
import { getSceneViewport } from '../Viewport.js';
import { UI, type ButtonVariant } from '../../theme.js';
import { createText } from '../TextStyles.js';
import { createIcon, iconTexture, type IconKey } from '../icons.js';
import { sounds } from '../../audio/SoundEffects.js';
import { startScene } from '../../scenes/lazyScenes.js';

/**
 * Shared hub UI kit: rounded panels, chunky casual buttons with a pressed
 * lip, pills, one toast and the RTL back button. Every hub scene uses
 * these instead of hand-rolled rectangles so geometry, colour and press
 * feedback stay consistent (Art Bible "Hub UI").
 */

export interface PanelOptions {
  fill?: number;
  stroke?: number;
  strokeAlpha?: number;
  radius?: number;
  shadow?: boolean;
  alpha?: number;
}

/** Rounded panel drawn into one Graphics, centred on (0, 0). */
export function drawPanel(g: Phaser.GameObjects.Graphics, width: number, height: number, options: PanelOptions = {}): Phaser.GameObjects.Graphics {
  const { fill = UI.surface.raised, stroke = UI.border, strokeAlpha = 1, radius = UI.radius.md, shadow = true, alpha = 0.97 } = options;
  const x = -width / 2;
  const y = -height / 2;
  g.clear();
  if (shadow) {
    // Two offset passes read as a soft drop shadow without a blur filter.
    g.fillStyle(0x000000, 0.18).fillRoundedRect(x - 1, y + 3, width + 2, height + 4, radius + 1);
    g.fillStyle(0x000000, 0.22).fillRoundedRect(x, y + 2, width, height + 1, radius);
  }
  g.fillStyle(fill, alpha).fillRoundedRect(x, y, width, height, radius);
  // Soft top highlight for depth on flat dark surfaces.
  g.fillStyle(0xffffff, 0.035).fillRoundedRect(x + 2, y + 2, width - 4, Math.min(height / 2, 28), { tl: radius - 2, tr: radius - 2, bl: 0, br: 0 });
  if (strokeAlpha > 0) g.lineStyle(1.5, stroke, strokeAlpha).strokeRoundedRect(x, y, width, height, radius);
  return g;
}

export function createPanel(scene: Phaser.Scene, x: number, y: number, width: number, height: number, options: PanelOptions = {}): Phaser.GameObjects.Graphics {
  return drawPanel(scene.add.graphics({ x, y }), width, height, options);
}

export interface ButtonOptions {
  width: number;
  height?: number;
  label: string;
  variant?: ButtonVariant;
  icon?: IconKey;
  fontSize?: number;
  onPress: () => void;
  /** Optional haptic hook (platform adapters live outside the kit). */
  haptic?: () => void;
}

export interface KitButton {
  readonly container: Phaser.GameObjects.Container;
  readonly label: Phaser.GameObjects.Text;
  setLabel(text: string): void;
  setEnabled(enabled: boolean): void;
  setVariant(variant: ButtonVariant): void;
}

const LIP = 4;

/** Chunky rounded button: body over a darker lip that it presses into. */
export function createButton(scene: Phaser.Scene, x: number, y: number, options: ButtonOptions): KitButton {
  const height = Math.max(44, options.height ?? 52);
  const width = options.width;
  let variant: ButtonVariant = options.variant ?? 'primary';
  let enabled = true;
  const lip = scene.add.graphics();
  const body = scene.add.graphics();
  const content = scene.add.container(0, 0);
  const label = createText(scene, 0, 0, options.label, {
    fontSize: `${options.fontSize ?? UI.type.label}px`,
    fontStyle: '800',
    color: UI.button[variant].text,
  }).setOrigin(0.5);
  content.add(label);
  let icon: Phaser.GameObjects.Image | undefined;
  if (options.icon) {
    const iconSize = Math.round(height * 0.46);
    icon = createIcon(scene, 0, 0, options.icon, iconSize);
    content.add(icon);
  }
  const layoutContent = (): void => {
    if (!icon) return;
    // RTL reading order: icon sits to the right of the label.
    const gap = 8;
    const total = label.width + gap + icon.displayWidth;
    label.setX(-total / 2 + label.width / 2);
    icon.setX(total / 2 - icon.displayWidth / 2);
  };
  layoutContent();

  const draw = (): void => {
    const colors = UI.button[variant];
    const fill = enabled ? colors.fill : UI.button.secondary.fill;
    const lipColor = enabled ? colors.lip : UI.button.secondary.lip;
    lip.clear().fillStyle(0x000000, 0.3).fillRoundedRect(-width / 2, -height / 2 + LIP + 2, width, height, 14)
      .fillStyle(lipColor, 1).fillRoundedRect(-width / 2, -height / 2 + LIP, width, height, 14);
    body.clear().fillStyle(fill, 1).fillRoundedRect(-width / 2, -height / 2, width, height, 14)
      .fillStyle(enabled ? colors.gloss : 0x475569, enabled ? 0.28 : 0.12)
      .fillRoundedRect(-width / 2 + 3, -height / 2 + 3, width - 6, height * 0.42, { tl: 11, tr: 11, bl: 6, br: 6 });
    label.setColor(enabled ? colors.text : UI.text.muted);
    icon?.setAlpha(enabled ? 1 : 0.5);
  };
  draw();

  const container = scene.add.container(x, y, [lip, body, content]);
  container.setSize(width, height + LIP);
  container.setInteractive({ useHandCursor: true });
  const press = (down: boolean): void => {
    body.setY(down ? LIP - 1 : 0);
    content.setY(down ? LIP - 1 : 0);
  };
  container.on('pointerdown', () => {
    if (!enabled) return;
    press(true);
    sounds.playClick();
    options.haptic?.();
  });
  container.on('pointerout', () => press(false));
  container.on('pointerup', () => {
    if (!enabled) return;
    const wasDown = body.y !== 0;
    press(false);
    if (wasDown) options.onPress();
  });

  return {
    container,
    label,
    setLabel(text: string) { label.setText(text); layoutContent(); },
    setEnabled(next: boolean) { enabled = next; press(false); draw(); },
    setVariant(next: ButtonVariant) { variant = next; draw(); },
  };
}

export interface KitPill {
  readonly container: Phaser.GameObjects.Container;
  setText(text: string): void;
}

/** Rounded stat pill: icon + value, sized to its content. */
export function createPill(scene: Phaser.Scene, x: number, y: number, icon: IconKey, text: string, options: { minWidth?: number; stroke?: number; color?: string } = {}): KitPill {
  const height = 34;
  const g = scene.add.graphics();
  const image = createIcon(scene, 0, 0, icon, 22);
  const value = createText(scene, 0, 0, text, {
    fontSize: '15px',
    fontStyle: '800',
    color: options.color ?? UI.text.gold,
  }).setOrigin(0.5);
  const container = scene.add.container(x, y, [g, image, value]);
  const layout = (): void => {
    const width = Math.max(options.minWidth ?? 0, value.width + 22 + 26);
    g.clear().fillStyle(0x000000, 0.3).fillRoundedRect(-width / 2, -height / 2 + 3, width, height, height / 2)
      .fillStyle(UI.surface.base, 0.96).fillRoundedRect(-width / 2, -height / 2, width, height, height / 2)
      .lineStyle(1.5, options.stroke ?? 0xb45309, 0.9).strokeRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    image.setX(width / 2 - 20);
    value.setX(-width / 2 + 12 + value.width / 2);
    container.setSize(width, height);
  };
  layout();
  return { container, setText(next: string) { value.setText(next); layout(); } };
}

const toasts = new WeakMap<Phaser.Scene, Phaser.GameObjects.Container>();

/** One toast per scene; a new message replaces the old one. Always fades. */
export function showToast(scene: Phaser.Scene, message: string, options: { y?: number; tone?: 'info' | 'error' | 'success'; reducedMotion?: boolean } = {}): void {
  toasts.get(scene)?.destroy();
  const tone = options.tone ?? 'info';
  const color = tone === 'error' ? UI.text.danger : tone === 'success' ? UI.text.success : UI.text.primary;
  const text = createText(scene, 0, 0, message, {
    fontSize: '13px',
    fontStyle: '700',
    color,
    align: 'center',
    wordWrap: { width: 300 },
  }).setOrigin(0.5);
  const width = Math.min(340, text.width + 36);
  const height = text.height + 22;
  const g = drawPanel(scene.add.graphics(), width, height, { fill: UI.surface.high, stroke: tone === 'error' ? 0xdc2626 : UI.borderStrong, radius: height / 2 > 22 ? 14 : height / 2 });
  // Hub scenes lay out in logical units (camera zoom = render scale), so
  // centre on the logical width rather than the camera's physical size.
  const visibleHeight = scene.scale?.gameSize ? getSceneViewport(scene).visibleHeight : LOGICAL_HEIGHT;
  const container = scene.add.container(LOGICAL_WIDTH / 2, options.y ?? visibleHeight - 120, [g, text]).setDepth(5000);
  toasts.set(scene, container);
  if (!options.reducedMotion) {
    container.setAlpha(0).setY(container.y + 10);
    scene.tweens.add({ targets: container, alpha: 1, y: container.y - 10, duration: 180, ease: 'Sine.easeOut' });
  }
  scene.tweens.add({
    targets: container,
    alpha: 0,
    delay: options.reducedMotion ? 1600 : 2200,
    duration: 320,
    ease: 'Cubic.easeIn',
    onComplete: () => {
      if (toasts.get(scene) === container) toasts.delete(scene);
      container.destroy();
    },
  });
}

export interface KitIconButton {
  readonly container: Phaser.GameObjects.Container;
  setIcon(key: IconKey): void;
}

/** Square 44px icon button (mute, close). Fires on release. */
export function createIconButton(scene: Phaser.Scene, x: number, y: number, key: IconKey, onPress: () => void, iconSize = 22): KitIconButton {
  const g = drawPanel(scene.add.graphics(), 44, 44, { fill: UI.surface.raised, stroke: UI.borderStrong, radius: 12 });
  const icon = createIcon(scene, 0, 0, key, iconSize);
  const container = scene.add.container(x, y, [g, icon]).setSize(44, 44).setInteractive({ useHandCursor: true });
  let down = false;
  container.on('pointerdown', () => { down = true; container.setScale(0.92); sounds.playClick(); });
  container.on('pointerout', () => { down = false; container.setScale(1); });
  container.on('pointerup', () => {
    container.setScale(1);
    if (!down) return;
    down = false;
    onPress();
  });
  return {
    container,
    setIcon(next: IconKey) { icon.setTexture(iconTexture(next)).setDisplaySize(iconSize, iconSize); },
  };
}

/** RTL back button (top-right, chevron pointing right), 44px target. */
export function createBackButton(scene: Phaser.Scene, x: number, y: number, onPress: () => void): Phaser.GameObjects.Container {
  return createIconButton(scene, x, y, 'back', onPress, 20).container;
}

/** Shared hub header: title and subtitle centred at the top. */
export function createHeader(scene: Phaser.Scene, title: string, subtitle: string): { title: Phaser.GameObjects.Text; subtitle: Phaser.GameObjects.Text } {
  return {
    title: createText(scene, LOGICAL_WIDTH / 2, 38, title, {
      fontSize: `${UI.type.title + 4}px`,
      fontStyle: '900',
      color: UI.text.primary,
      stroke: UI.text.stroke,
      strokeThickness: 5,
    }).setOrigin(0.5),
    subtitle: createText(scene, LOGICAL_WIDTH / 2, 66, subtitle, {
      fontSize: `${UI.type.body}px`,
      fontStyle: '700',
      color: UI.text.accent,
      stroke: UI.text.stroke,
      strokeThickness: 3,
    }).setOrigin(0.5),
  };
}

/** Keeps a pill's left edge at `left` (pills resize with their text). */
export function anchorPillLeft(pill: KitPill, left: number): void {
  pill.container.setX(left + pill.container.width / 2);
}

const GLOW_TEXTURE = 'ui_soft_glow';

/** Soft radial glow (white, tinted per use). Never a flat alpha circle. */
export function createGlow(scene: Phaser.Scene, x: number, y: number, width: number, height: number, color: number, alpha: number): Phaser.GameObjects.Image {
  const textures = scene.textures as Phaser.Textures.TextureManager | undefined;
  if (textures && typeof textures.createCanvas === 'function' && !textures.exists(GLOW_TEXTURE)) {
    const texture = textures.createCanvas(GLOW_TEXTURE, 128, 128);
    const ctx = texture?.getContext();
    if (texture && ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      // Smooth (roughly gaussian) falloff so the edge is invisible.
      [[0, 1], [0.25, 0.78], [0.5, 0.42], [0.75, 0.14], [1, 0]].forEach(([stop, a]) =>
        gradient.addColorStop(stop, `rgba(255,255,255,${a})`));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      texture.refresh();
    }
  }
  return scene.add.image(x, y, GLOW_TEXTURE).setDisplaySize(width, height).setTint(color).setAlpha(alpha);
}

const RAYS_TEXTURE = 'ui_soft_rays';

/** Soft sunburst behind hero art (one texture; rotate it with a tween). */
export function createRays(scene: Phaser.Scene, x: number, y: number, size: number, color: number, alpha: number): Phaser.GameObjects.Image {
  const textures = scene.textures as Phaser.Textures.TextureManager | undefined;
  if (textures && typeof textures.createCanvas === 'function' && !textures.exists(RAYS_TEXTURE)) {
    const texture = textures.createCanvas(RAYS_TEXTURE, 256, 256);
    const ctx = texture?.getContext();
    if (texture && ctx) {
      const count = 14;
      ctx.translate(128, 128);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const w = (Math.PI / count) * 0.55;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 128, a - w, a + w);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      // Fade the rays out towards the rim.
      ctx.globalCompositeOperation = 'destination-in';
      const fade = ctx.createRadialGradient(0, 0, 8, 0, 0, 128);
      fade.addColorStop(0, 'rgba(255,255,255,0.9)');
      fade.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      fade.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(-128, -128, 256, 256);
      texture.refresh();
    }
  }
  return scene.add.image(x, y, RAYS_TEXTURE).setDisplaySize(size, size).setTint(color).setAlpha(alpha);
}

/**
 * Short reward celebration: glow (+ rays for big rewards), coin and amount.
 * Destroys itself; reduced motion shows it statically.
 */
export function showRewardBurst(scene: Phaser.Scene, x: number, y: number, reward: number, options: { title?: string; big?: boolean; reducedMotion?: boolean } = {}): void {
  const big = options.big ?? false;
  const burst = scene.add.container(x, y).setDepth(250);
  const glow = createGlow(scene, 0, 0, big ? 300 : 230, big ? 300 : 230, 0xf59e0b, 0.55);
  burst.add(glow);
  if (big) burst.add(createRays(scene, 0, 0, 320, 0xfde68a, 0.3));
  const amount = createText(scene, -16, options.title ? 18 : 0, `+${reward}`, {
    fontSize: big ? '30px' : '26px',
    fontStyle: '900',
    color: '#fde68a',
    stroke: '#000000',
    strokeThickness: 6,
  }).setOrigin(0.5);
  const coin = createIcon(scene, amount.x + amount.width / 2 + 20, amount.y, 'coin', big ? 40 : 34);
  burst.add([amount, coin]);
  if (options.title) {
    burst.add(createText(scene, 0, -22, options.title, {
      fontSize: '20px',
      fontStyle: '900',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 5,
    }).setOrigin(0.5));
  }
  if (options.reducedMotion) {
    scene.time.delayedCall(1000, () => burst.destroy());
    return;
  }
  burst.setScale(0.6).setAlpha(0);
  scene.tweens.add({
    targets: burst,
    scale: 1.05,
    alpha: 1,
    duration: 240,
    ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({
        targets: burst,
        y: y - 26,
        alpha: 0,
        delay: 700,
        duration: 320,
        ease: 'Cubic.easeIn',
        onComplete: () => burst.destroy(),
      });
    },
  });
}

export interface KitProgressBar {
  readonly graphics: Phaser.GameObjects.Graphics;
  setProgress(ratio: number, color?: number): void;
  setWidth(width: number): void;
}

/**
 * Rounded progress bar centred on (x, y). RTL: the fill grows from the
 * right edge. Redrawn only when the value changes.
 */
export function createProgressBar(scene: Phaser.Scene, x: number, y: number, initialWidth: number, height: number, color: number, options: { track?: number; rtl?: boolean } = {}): KitProgressBar {
  const g = scene.add.graphics({ x, y });
  let width = initialWidth;
  const rtl = options.rtl ?? true;
  let current = { ratio: 0, color };
  const draw = (): void => {
    const r = height / 2;
    g.clear();
    g.fillStyle(options.track ?? 0x050913, 1).fillRoundedRect(-width / 2, -height / 2, width, height, r);
    g.lineStyle(1, UI.border, 1).strokeRoundedRect(-width / 2, -height / 2, width, height, r);
    const ratio = Math.max(0, Math.min(1, current.ratio));
    if (ratio <= 0) return;
    const fillWidth = Math.max(height, (width - 2) * ratio);
    const left = rtl ? width / 2 - 1 - fillWidth : -width / 2 + 1;
    const fillR = Math.min(r - 1, fillWidth / 2);
    g.fillStyle(current.color, 1).fillRoundedRect(left, -height / 2 + 1, fillWidth, height - 2, fillR);
    g.fillStyle(0xffffff, 0.28).fillRoundedRect(left + 2, -height / 2 + 2, Math.max(0, fillWidth - 4), Math.max(1, (height - 2) * 0.38), Math.max(0, fillR - 1));
  };
  draw();
  return {
    graphics: g,
    setProgress(ratio: number, nextColor?: number) {
      current = { ratio, color: nextColor ?? current.color };
      draw();
    },
    setWidth(next: number) {
      if (next === width) return;
      width = next;
      draw();
    },
  };
}

/** Scale-press feedback for custom interactive objects. */
export function bindPressFeedback(target: Phaser.GameObjects.GameObject & { setScale(v: number): unknown }, ...followers: Array<{ setScale(v: number): unknown }>): void {
  const all = [target, ...followers];
  const set = (scale: number): void => { for (const item of all) item.setScale(scale); };
  target.on('pointerdown', () => set(0.96));
  target.on('pointerup', () => set(1));
  target.on('pointerout', () => set(1));
}

const FADE_MS = 170;

/**
 * Fade the camera out, then start `key`. The target scene fades itself in.
 * `onFail` runs if a lazily loaded scene chunk cannot be fetched.
 */
export function goToScene(scene: Phaser.Scene, key: string, data?: object, onFail?: () => void): void {
  const camera = scene.cameras?.main;
  if (!camera || typeof camera.fadeOut !== 'function') {
    startScene(scene, key, data, onFail);
    return;
  }
  camera.once('camerafadeoutcomplete', () => startScene(scene, key, data, onFail));
  camera.fadeOut(FADE_MS, 7, 11, 20);
}

/** Call at the end of a scene's create(). */
export function fadeIn(scene: Phaser.Scene): void {
  scene.cameras?.main?.fadeIn?.(FADE_MS, 7, 11, 20);
}

import Phaser from 'phaser';
import { RANK_TIERS } from '@crown-clash/game-core';

/**
 * Flat vector icon set drawn once into canvas textures, replacing UI emoji
 * (which render differently on every Android/iOS WebView). One shared style:
 * a dark rounded outline, a base fill with a soft top-lit gradient and a
 * light highlight. Icons are authored on a 64-unit grid, rasterised at 2x
 * (128px masters, crisp at DPR 2-3) and displayed at 14-96px with
 * `createIcon`.
 */
export type IconKey =
  | 'coin' | 'trophy' | 'crown' | 'sound_on' | 'sound_off' | 'chest' | 'chest_open'
  | 'sword' | 'swords' | 'castle' | 'hammer' | 'bolt' | 'shield' | 'close' | 'back' | 'gem'
  | 'star' | 'scroll' | 'lock' | 'check' | 'warning'
  | 'cmd_crown_guard' | 'cmd_quartermaster' | 'cmd_vanguard'
  | 'rank_recruit' | 'rank_soldier' | 'rank_knight' | 'rank_commander' | 'rank_warlord' | 'rank_crown_lord';

const GRID = 64;
const SCALE = 2;
const OUTLINE = 0x0b1020;
const textureKey = (key: IconKey): string => `ui_icon_v2_${key}`;

type Point = readonly [number, number];
type Corner = number | { tl: number; tr: number; bl: number; br: number };

const rgba = (color: number, alpha = 1): string =>
  `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;

const shade = (color: number, amount: number): number => {
  const mix = (channel: number): number =>
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return (mix((color >> 16) & 255) << 16) | (mix((color >> 8) & 255) << 8) | mix(color & 255);
};

/**
 * Tiny Graphics-like pen over Canvas2D. Canvas gives round joins/caps and
 * gradients, which Phaser Graphics cannot, while the drawing code stays as
 * terse as before.
 */
class Pen {
  private fill = '#000';
  private stroke = '#000';
  private width = 1;

  constructor(readonly ctx: CanvasRenderingContext2D) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  fillStyle(color: number, alpha = 1): this { this.fill = rgba(color, alpha); return this; }
  lineStyle(width: number, color: number, alpha = 1): this { this.width = width; this.stroke = rgba(color, alpha); return this; }

  private doFill(style: string | CanvasGradient = this.fill): this { this.ctx.fillStyle = style; this.ctx.fill(); return this; }
  /** Fills the current path with the current fill style. */
  fillPath(): this { return this.doFill(); }
  /** Flat (no outline) polygon in the current fill style. */
  fillPoly(points: readonly Point[]): this { return this.path(points).doFill(); }
  private doStroke(): this { this.ctx.lineWidth = this.width; this.ctx.strokeStyle = this.stroke; this.ctx.stroke(); return this; }

  circlePath(x: number, y: number, r: number): this { this.ctx.beginPath(); this.ctx.arc(x, y, r, 0, Math.PI * 2); return this; }
  fillCircle(x: number, y: number, r: number): this { return this.circlePath(x, y, r).doFill(); }
  strokeCircle(x: number, y: number, r: number): this { return this.circlePath(x, y, r).doStroke(); }
  fillEllipse(x: number, y: number, w: number, h: number): this {
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    return this.doFill();
  }
  fillRect(x: number, y: number, w: number, h: number): this { this.ctx.fillStyle = this.fill; this.ctx.fillRect(x, y, w, h); return this; }
  roundRectPath(x: number, y: number, w: number, h: number, r: Corner): this {
    const c = typeof r === 'number' ? { tl: r, tr: r, bl: r, br: r } : r;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + c.tl, y);
    ctx.arcTo(x + w, y, x + w, y + h, c.tr);
    ctx.arcTo(x + w, y + h, x, y + h, c.br);
    ctx.arcTo(x, y + h, x, y, c.bl);
    ctx.arcTo(x, y, x + w, y, c.tl);
    ctx.closePath();
    return this;
  }
  fillRoundedRect(x: number, y: number, w: number, h: number, r: Corner): this { return this.roundRectPath(x, y, w, h, r).doFill(); }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    return this.doStroke();
  }
  arc(x: number, y: number, r: number, start: number, end: number): this {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, start, end);
    return this.doStroke();
  }
  path(points: readonly Point[]): this {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    return this;
  }
  polyline(points: readonly Point[]): this {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    return this.doStroke();
  }
  /** Vertical top-lit gradient for the current path's bounds. */
  gradient(color: number, top: number, bottom: number): CanvasGradient {
    const g = this.ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, rgba(shade(color, 0.28)));
    g.addColorStop(0.55, rgba(color));
    g.addColorStop(1, rgba(shade(color, -0.18)));
    return g;
  }
  /** Outlined, gradient-filled polygon: the base shape of most icons. */
  shape(points: readonly Point[], color: number, outline = true): this {
    const ys = points.map((p) => p[1]);
    const g = this.gradient(color, Math.min(...ys), Math.max(...ys));
    if (outline) this.path(points).lineStyle(5, OUTLINE).doStroke();
    return this.path(points).doFill(g);
  }
  disc(x: number, y: number, r: number, color: number, outline = true): this {
    if (outline) this.lineStyle(5, OUTLINE).strokeCircle(x, y, r);
    return this.circlePath(x, y, r).doFill(this.gradient(color, y - r, y + r));
  }
  box(x: number, y: number, w: number, h: number, r: Corner, color: number, outline = true): this {
    if (outline) this.roundRectPath(x, y, w, h, r).lineStyle(5, OUTLINE).doStroke();
    return this.roundRectPath(x, y, w, h, r).doFill(this.gradient(color, y, y + h));
  }
  /** Thick line drawn as an outlined capsule. */
  bar(x1: number, y1: number, x2: number, y2: number, width: number, color: number): this {
    this.lineStyle(width + 5, OUTLINE).lineBetween(x1, y1, x2, y2);
    return this.lineStyle(width, color).lineBetween(x1, y1, x2, y2);
  }
  /** Several capsules sharing one outline pass, so joints stay clean. */
  bars(lines: ReadonlyArray<readonly [number, number, number, number]>, width: number, color: number): this {
    this.lineStyle(width + 5, OUTLINE);
    for (const [x1, y1, x2, y2] of lines) this.lineBetween(x1, y1, x2, y2);
    this.lineStyle(width, color);
    for (const [x1, y1, x2, y2] of lines) this.lineBetween(x1, y1, x2, y2);
    return this;
  }
  gloss(x: number, y: number, w: number, h: number, alpha = 0.55): this {
    return this.fillStyle(0xffffff, alpha).fillEllipse(x, y, w, h);
  }
}

const star = (cx: number, cy: number, outer: number, inner: number): Point[] => {
  const pts: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
};

const SHIELD: Point[] = [[32, 5], [55, 12], [52, 36], [32, 59], [12, 36], [9, 12]];
const CROWN: Point[] = [[9, 46], [6, 18], [20, 30], [32, 11], [44, 30], [58, 18], [55, 46]];

/** White glyphs used inside medallions (commander emblems, rank badges). */
const glyph = {
  shield: (p: Pen, s = 1, cx = 32, cy = 32): void => {
    p.shape(SHIELD.map(([x, y]) => [cx + (x - 32) * s, cy + (y - 32) * s] as Point), 0xf8fafc);
  },
  crown: (p: Pen, s = 1, cx = 32, cy = 32): void => {
    p.shape(CROWN.map(([x, y]) => [cx + (x - 32) * s, cy + (y - 30) * s] as Point), 0xf8fafc);
  },
  star: (p: Pen, s = 1, cx = 32, cy = 32): void => { p.shape(star(cx, cy + 1, 15 * s, 6.5 * s), 0xf8fafc); },
  chevron: (p: Pen, y: number): void => { p.shape([[17, y], [32, y - 10], [47, y], [47, y + 7], [32, y - 3], [17, y + 7]], 0xf8fafc); },
};

/** Medallion base: outlined disc in `color` with a rim and gloss. */
const medallion = (p: Pen, color: number): void => {
  p.disc(32, 32, 27, shade(color, -0.25));
  p.circlePath(32, 32, 22).fillStyle(color).fillPath();
  p.fillStyle(0xffffff, 0.16).fillEllipse(32, 21, 34, 16);
};

/** Rank insignia: a heater shield in the rank colour with a white glyph. */
const rankBadge = (color: number, inner: (p: Pen) => void) => (p: Pen): void => {
  p.shape([[32, 3], [57, 10], [55, 34], [32, 61], [9, 34], [7, 10]], shade(color, -0.2));
  p.shape([[32, 9], [51, 14], [49, 33], [32, 53], [15, 33], [13, 14]], color, false);
  p.fillStyle(0xffffff, 0.18).fillEllipse(32, 17, 30, 10);
  inner(p);
};

const rankColor = (id: string): number => RANK_TIERS.find((tier) => tier.id === id)?.color ?? 0x94a3b8;

const DRAW: Record<IconKey, (p: Pen) => void> = {
  coin: (p) => {
    p.disc(32, 33, 25, 0xd97706);
    p.circlePath(32, 31, 21).fillStyle(0xfbbf24).fillPath();
    p.lineStyle(3, 0xd97706).strokeCircle(32, 31, 15);
    p.shape([[24, 37], [24, 25], [28.5, 30], [32, 23], [35.5, 30], [40, 25], [40, 37]], 0xd97706, false);
    p.gloss(23, 21, 11, 6, 0.7);
  },
  trophy: (p) => {
    p.lineStyle(9, OUTLINE).arc(17, 25, 9, Math.PI * 0.5, Math.PI * 1.6).arc(47, 25, 9, -Math.PI * 0.6, Math.PI * 0.5);
    p.lineStyle(4.5, 0xf59e0b).arc(17, 25, 9, Math.PI * 0.5, Math.PI * 1.6).arc(47, 25, 9, -Math.PI * 0.6, Math.PI * 0.5);
    p.shape([[15, 10], [49, 10], [46, 31], [38, 40], [26, 40], [18, 31]], 0xfbbf24);
    p.fillStyle(0xfff7d6, 0.7).fillRoundedRect(21, 14, 5, 17, 2.5);
    p.box(28, 39, 8, 9, 1, 0xd97706);
    p.box(17, 48, 30, 9, 3, 0x92400e);
  },
  crown: (p) => {
    p.shape(CROWN, 0xfbbf24);
    p.box(9, 44, 46, 10, 3, 0xd97706);
    p.disc(32, 35, 5, 0xef4444, false);
    p.disc(19, 38, 3.5, 0x3b82f6, false).disc(45, 38, 3.5, 0x3b82f6, false);
    p.disc(6, 18, 4, 0xfde68a).disc(32, 11, 4.5, 0xfde68a).disc(58, 18, 4, 0xfde68a);
  },
  sound_on: (p) => {
    p.shape([[8, 24], [20, 24], [34, 11], [34, 53], [20, 40], [8, 40]], 0xe2e8f0);
    p.lineStyle(9, OUTLINE).arc(36, 32, 11, -0.85, 0.85).arc(36, 32, 21, -0.85, 0.85);
    p.lineStyle(4.5, 0xe2e8f0).arc(36, 32, 11, -0.85, 0.85).arc(36, 32, 21, -0.85, 0.85);
  },
  sound_off: (p) => {
    p.shape([[8, 24], [20, 24], [34, 11], [34, 53], [20, 40], [8, 40]], 0x94a3b8);
    p.bar(42, 23, 57, 41, 5, 0xf87171).bar(57, 23, 42, 41, 5, 0xf87171);
  },
  chest: (p) => {
    p.box(7, 28, 50, 29, { tl: 2, tr: 2, bl: 5, br: 5 }, 0xa16207);
    p.box(7, 11, 50, 19, { tl: 12, tr: 12, bl: 2, br: 2 }, 0xc2410c);
    p.fillStyle(0xfbbf24).fillRect(15, 11, 6, 46).fillRect(43, 11, 6, 46).fillRect(7, 26, 50, 5);
    p.box(26, 27, 12, 14, 3, 0xfde68a);
    p.fillStyle(OUTLINE).fillCircle(32, 33, 2.5);
    p.gloss(24, 16, 14, 5, 0.35);
  },
  chest_open: (p) => {
    p.fillStyle(0xfde68a, 0.55).fillEllipse(32, 30, 54, 24);
    p.box(8, 6, 48, 18, { tl: 12, tr: 12, bl: 2, br: 2 }, 0x9a3412);
    p.box(7, 32, 50, 25, { tl: 2, tr: 2, bl: 5, br: 5 }, 0xa16207);
    p.disc(22, 30, 6, 0xfbbf24).disc(34, 27, 7, 0xfbbf24).disc(45, 31, 5, 0xfbbf24);
    p.fillStyle(0xfbbf24).fillRect(15, 34, 6, 23).fillRect(43, 34, 6, 23).fillRect(7, 36, 50, 5);
  },
  sword: (p) => {
    p.shape([[29, 5], [35, 5], [36, 40], [28, 40]], 0xe2e8f0);
    p.fillStyle(0xffffff, 0.85).fillRect(30.5, 9, 2, 28);
    p.box(16, 39, 32, 7, 3, 0xf59e0b);
    p.box(28.5, 46, 7, 10, 2, 0x92400e);
    p.disc(32, 58, 4, 0xf59e0b);
  },
  swords: (p) => {
    const blade = (flip: number): void => {
      const x = (v: number): number => (flip > 0 ? v : 64 - v);
      p.shape([[x(10), 6], [x(16), 6], [x(44), 40], [x(40), 44]], 0xe2e8f0);
      p.bar(x(34), 50, x(50), 34, 4, 0xf59e0b);
      p.bar(x(46), 46, x(55), 55, 5, 0x92400e);
    };
    blade(1);
    blade(-1);
  },
  castle: (p) => {
    p.box(12, 26, 40, 31, 2, 0xcbd5e1);
    p.box(5, 17, 15, 40, 2, 0xe2e8f0);
    p.box(44, 17, 15, 40, 2, 0xe2e8f0);
    p.shape([[3, 19], [12.5, 5], [22, 19]], 0x3b82f6);
    p.shape([[42, 19], [51.5, 5], [61, 19]], 0x3b82f6);
    p.shape([[25, 57], [25, 44], [32, 37], [39, 44], [39, 57]], 0x334155);
    p.bar(32, 26, 32, 10, 1.5, 0x475569);
    p.shape([[33, 9], [45, 13], [33, 17]], 0xef4444, false);
  },
  hammer: (p) => {
    p.box(28, 22, 9, 37, 3, 0xb45309);
    p.box(11, 8, 42, 17, 4, 0x94a3b8);
    p.fillStyle(0xf1f5f9, 0.9).fillRoundedRect(14, 11, 36, 4, 2);
  },
  bolt: (p) => {
    p.shape([[37, 4], [12, 37], [28, 37], [22, 60], [52, 24], [35, 24], [43, 4]], 0xfacc15);
    p.fillStyle(0xfffbeb, 0.85).fillPoly([[37, 9], [21, 31], [28, 31]]);
  },
  shield: (p) => {
    p.shape(SHIELD, 0xf59e0b);
    p.shape([[32, 11], [49, 16], [46, 35], [32, 52], [18, 35], [15, 16]], 0x2563eb, false);
    p.fillStyle(0x93c5fd, 0.5).fillPoly([[32, 11], [15, 16], [17, 30], [32, 30]]);
  },
  close: (p) => {
    p.bar(17, 17, 47, 47, 7, 0xe2e8f0).bar(47, 17, 17, 47, 7, 0xe2e8f0);
  },
  back: (p) => {
    // RTL: "back" points right.
    p.lineStyle(14, OUTLINE).lineBetween(24, 12, 44, 32).lineBetween(44, 32, 24, 52);
    p.lineStyle(8, 0xf1f5f9).lineBetween(24, 12, 44, 32).lineBetween(44, 32, 24, 52);
  },
  gem: (p) => {
    p.shape([[16, 8], [48, 8], [60, 24], [32, 58], [4, 24]], 0xa855f7);
    p.shape([[16, 8], [48, 8], [42, 24], [22, 24]], 0xe9d5ff, false);
    p.lineStyle(2, 0x6b21a8).lineBetween(6, 24, 58, 24).lineBetween(22, 24, 32, 56).lineBetween(42, 24, 32, 56);
  },
  star: (p) => {
    p.shape(star(32, 34, 28, 12.5), 0xfacc15);
    p.gloss(26, 22, 9, 5, 0.6);
  },
  scroll: (p) => {
    p.box(13, 10, 38, 44, 2, 0xfde68a);
    p.box(9, 5, 46, 10, 5, 0xd97706);
    p.box(9, 49, 46, 10, 5, 0xd97706);
    p.fillStyle(0x92400e, 0.75);
    for (const y of [22, 30, 38]) p.fillRoundedRect(19, y, 26, 3.5, 1.75);
  },
  lock: (p) => {
    p.lineStyle(13, OUTLINE).arc(32, 27, 12, Math.PI, 0);
    p.lineStyle(7, 0xcbd5e1).arc(32, 27, 12, Math.PI, 0);
    p.lineStyle(13, OUTLINE).lineBetween(20, 27, 20, 31).lineBetween(44, 27, 44, 31);
    p.lineStyle(7, 0xcbd5e1).lineBetween(20, 27, 20, 31).lineBetween(44, 27, 44, 31);
    p.box(11, 29, 42, 29, 6, 0xf59e0b);
    p.fillStyle(OUTLINE).fillCircle(32, 41, 4).fillRect(30.5, 41, 3, 9);
  },
  check: (p) => {
    p.lineStyle(15, OUTLINE).polyline([[12, 33], [26, 47], [52, 18]]);
    p.lineStyle(8, 0x34d399).polyline([[12, 33], [26, 47], [52, 18]]);
  },
  warning: (p) => {
    p.shape([[32, 6], [59, 54], [5, 54]], 0xfbbf24);
    p.bars([[32, 22, 32, 37]], 6, 0x1c1206);
    p.fillStyle(0x1c1206).fillCircle(32, 46, 3.6);
  },
  cmd_crown_guard: (p) => {
    medallion(p, 0x2563eb);
    glyph.shield(p, 0.62);
    glyph.crown(p, 0.32, 32, 30);
  },
  cmd_quartermaster: (p) => {
    medallion(p, 0x059669);
    p.box(19, 23, 26, 22, 3, 0xd6a35c);
    p.fillStyle(0x92400e, 0.85).fillRect(19, 32, 26, 3).fillRect(30.5, 23, 3, 22);
    p.shape([[22, 23], [42, 23], [32, 13]], 0xf8fafc);
  },
  cmd_vanguard: (p) => {
    medallion(p, 0xd97706);
    p.shape([[32, 12], [47, 30], [38, 30], [38, 51], [26, 51], [26, 30], [17, 30]], 0xf8fafc);
  },
  rank_recruit: rankBadge(rankColor('recruit'), (p) => glyph.chevron(p, 34)),
  rank_soldier: rankBadge(rankColor('soldier'), (p) => { glyph.chevron(p, 28); glyph.chevron(p, 41); }),
  rank_knight: rankBadge(rankColor('knight'), (p) => glyph.star(p, 0.85, 32, 30)),
  rank_commander: rankBadge(rankColor('commander'), (p) => glyph.crown(p, 0.5, 32, 30)),
  rank_warlord: rankBadge(rankColor('warlord'), (p) => {
    p.bars([[32, 14, 32, 48], [21, 18, 21, 30], [43, 18, 43, 30], [21, 31, 43, 31]], 5, 0xf8fafc);
  }),
  rank_crown_lord: rankBadge(rankColor('crown_lord'), (p) => {
    p.shape([[23, 18], [41, 18], [48, 27], [32, 46], [16, 27]], 0xf8fafc);
    p.lineStyle(1.5, 0x94a3b8).lineBetween(17, 27, 47, 27);
  }),
};

/** Rank badge icon for a rank id (falls back to the recruit badge). */
export function rankIcon(rankId: string): IconKey {
  const key = `rank_${rankId}`;
  return key in DRAW ? (key as IconKey) : 'rank_recruit';
}

/** Commander emblem for a commander id. */
export function commanderIcon(commanderId: string): IconKey {
  const key = `cmd_${commanderId}`;
  return key in DRAW ? (key as IconKey) : 'cmd_crown_guard';
}

/** Draws every icon texture once per game; later calls are no-ops. */
export function ensureIcons(scene: Phaser.Scene): void {
  const textures = scene.textures as Phaser.Textures.TextureManager | undefined;
  if (!textures || typeof textures.createCanvas !== 'function') return;
  for (const key of Object.keys(DRAW) as IconKey[]) {
    const tk = textureKey(key);
    if (textures.exists(tk)) continue;
    const texture = textures.createCanvas(tk, GRID * SCALE, GRID * SCALE);
    const ctx = texture?.getContext();
    if (!texture || !ctx) continue;
    ctx.save();
    ctx.scale(SCALE, SCALE);
    DRAW[key](new Pen(ctx));
    ctx.restore();
    texture.refresh();
  }
}

/** An icon image at `size` logical px. */
export function createIcon(scene: Phaser.Scene, x: number, y: number, key: IconKey, size: number): Phaser.GameObjects.Image {
  ensureIcons(scene);
  return scene.add.image(x, y, textureKey(key)).setDisplaySize(size, size);
}

export function iconTexture(key: IconKey): string {
  return textureKey(key);
}

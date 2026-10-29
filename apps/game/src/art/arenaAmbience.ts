import type Phaser from 'phaser';
import type { BattlefieldId } from '@crown-clash/game-core';
import type { BoardLayout } from './boardProjection.js';

/**
 * Living-board ambience: a handful of tiny drifting motes per biome (pollen,
 * seeds, petals, dust, butterflies) and water glints on the Twin Passes brook.
 *
 * Cost model, chosen for low-end Android WebViews:
 *  - one 96x16 canvas texture with six frames, so every mote shares a batch
 *    (normal blend only: an ADD blend would break the batch per mote);
 *  - at most 14 images on the high tier and 8 on mid; none on low or under
 *    reduced motion;
 *  - per frame, a few sines per mote and setters only (zero allocation).
 *
 * Motes sit at depth 11: above the environment props (10), below every
 * territory, army and HUD object (17.6+), so they never cover gameplay.
 */

export type MoteKind = 'pollen' | 'seed' | 'petal' | 'dust' | 'butterfly' | 'glint';
export type AmbienceTier = 'low' | 'mid' | 'high';

export const AMBIENCE_TEXTURE_KEY = 'cc_arena_ambience';
export const AMBIENCE_DEPTH = 11;
const FRAME_SIZE = 16;
const FRAMES: readonly MoteKind[] = ['pollen', 'seed', 'petal', 'dust', 'butterfly', 'glint'];

/** Full-tier mote counts per biome (the mid tier keeps ~60% of each kind). */
export const AMBIENCE_BY_BATTLEFIELD: Readonly<Record<BattlefieldId, Readonly<Partial<Record<MoteKind, number>>>>> =
  Object.freeze({
    crown_cross: { pollen: 9, butterfly: 3 },
    twin_passes: { seed: 5, butterfly: 2, glint: 7 },
    royal_ring: { petal: 9, butterfly: 3 },
    quad_citadel: { dust: 10, seed: 3 },
  });

/** Fraction of the full mote budget a device gets. */
export function ambienceBudget(tier: AmbienceTier, reducedMotion: boolean): number {
  if (reducedMotion || tier === 'low') return 0;
  return tier === 'mid' ? 0.6 : 1;
}

/** One mote's deterministic path, in logical world units and milliseconds. */
export interface MotePlan {
  readonly kind: MoteKind;
  readonly x: number;
  readonly y: number;
  /** Drift amplitude (world units) and angular frequency (rad/ms) per axis. */
  readonly ax: number;
  readonly ay: number;
  readonly fx: number;
  readonly fy: number;
  readonly phase: number;
  /** Display size in world units and peak alpha. */
  readonly size: number;
  readonly alpha: number;
}

// Small deterministic PRNG so the same battlefield always plans the same field.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Twin Passes brook centre line at logical y (mirrors `_river_ribbon` in crown_cross_kit.py). */
export function brookCenterX(y: number): number {
  const feature = 398 - y;
  return 200 + 4 * Math.sin(feature * 0.024) + 3 * Math.sin(feature * 0.012 + 0.4);
}

const TAU = Math.PI * 2;

export function planAmbience(battlefieldId: BattlefieldId, budget: number): MotePlan[] {
  if (budget <= 0) return [];
  const counts = AMBIENCE_BY_BATTLEFIELD[battlefieldId] ?? {};
  const random = mulberry32(
    [...battlefieldId].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 16777619), 2166136261)
  );
  const plans: MotePlan[] = [];
  for (const kind of FRAMES) {
    const full = counts[kind] ?? 0;
    const count = Math.round(full * budget);
    for (let i = 0; i < count; i++) {
      const phase = random() * TAU;
      if (kind === 'glint') {
        // Spread evenly down the brook, inside its banks.
        const y = 195 + ((i + 0.2 + random() * 0.6) / count) * 340;
        plans.push({ kind, x: brookCenterX(y) + (random() - 0.5) * 16, y, ax: 0, ay: 0,
          fx: TAU / (2200 + random() * 2000), fy: 0, phase, size: 9 + random() * 4, alpha: 0.95 });
        continue;
      }
      const butterfly = kind === 'butterfly';
      // Stratified across the board so motes never clump in one corner.
      const x = 30 + ((i + random()) / count) * 340;
      const y = 120 + random() * 560;
      plans.push({
        kind,
        x,
        y,
        ax: butterfly ? 46 + random() * 34 : 14 + random() * 22,
        ay: butterfly ? 34 + random() * 26 : 10 + random() * 18,
        fx: TAU / ((butterfly ? 15000 : 11000) + random() * 9000),
        fy: TAU / ((butterfly ? 11000 : 8000) + random() * 7000),
        phase,
        size: butterfly ? 14 : kind === 'petal' ? 8 : kind === 'dust' ? 5.5 : 6,
        alpha: butterfly ? 0.95 : kind === 'dust' ? 0.5 : 0.75,
      });
    }
  }
  return plans;
}

/** Draws the six 16px mote frames into one canvas texture (once per game). */
export function ensureAmbienceTexture(textures: Phaser.Textures.TextureManager): boolean {
  if (textures.exists(AMBIENCE_TEXTURE_KEY)) return true;
  if (typeof document === 'undefined' || !document.createElement) return false;
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_SIZE * FRAMES.length;
  canvas.height = FRAME_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const soft = (cx: number, rgb: string, radius: number) => {
    const g = ctx.createRadialGradient(cx, 8, 0, cx, 8, radius);
    g.addColorStop(0, `rgba(${rgb}, 1)`);
    g.addColorStop(0.45, `rgba(${rgb}, 0.85)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - 8, 0, FRAME_SIZE, FRAME_SIZE);
  };
  soft(8, '255, 246, 170', 6); // pollen: warm cream-yellow
  soft(24, '255, 255, 255', 6.5); // seed: white fluff
  // petal: rose ellipse with a lighter core
  ctx.fillStyle = 'rgba(244, 120, 160, 1)';
  ctx.beginPath();
  ctx.ellipse(40, 8, 6, 3.6, -0.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 196, 214, 1)';
  ctx.beginPath();
  ctx.ellipse(39, 7.4, 3, 1.6, -0.5, 0, TAU);
  ctx.fill();
  soft(56, '236, 206, 140', 6.5); // dust: sunlit warm sand
  // butterfly: two wing pairs around a dark body (scaleX flaps it)
  ctx.fillStyle = 'rgba(255, 214, 72, 1)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(72 + side * 3.6, 5.6, 3.8, 3.4, side * 0.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(72 + side * 3, 10.6, 2.8, 2.4, side * -0.4, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(70, 44, 20, 1)';
  ctx.fillRect(71.2, 3.5, 1.6, 9.5);
  // glint: four-point sparkle with a soft halo
  soft(88, '235, 255, 255', 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  ctx.beginPath();
  ctx.moveTo(88, 1); ctx.lineTo(89.1, 6.9); ctx.lineTo(95, 8); ctx.lineTo(89.1, 9.1);
  ctx.lineTo(88, 15); ctx.lineTo(86.9, 9.1); ctx.lineTo(81, 8); ctx.lineTo(86.9, 6.9);
  ctx.closePath();
  ctx.fill();
  const texture = textures.addCanvas(AMBIENCE_TEXTURE_KEY, canvas);
  if (!texture) return false;
  FRAMES.forEach((kind, index) => texture.add(kind, 0, index * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE));
  return true;
}

interface LiveMote {
  readonly plan: MotePlan;
  readonly image: Phaser.GameObjects.Image;
  readonly u: number;
  readonly v: number;
  readonly su: number;
  readonly sv: number;
  readonly scale: number;
}

/** Runtime half: owns the mote images for one arena layout and steps them each frame. */
export class ArenaAmbience {
  private readonly motes: LiveMote[] = [];

  constructor(
    scene: Phaser.Scene,
    layout: BoardLayout,
    plans: readonly MotePlan[],
    track: (image: Phaser.GameObjects.Image) => Phaser.GameObjects.Image,
  ) {
    if (plans.length === 0 || !ensureAmbienceTexture(scene.textures)) return;
    // The projection is affine, so one probe gives the per-axis screen scale of a world unit.
    const origin = layout.project(200, 398);
    const probe = layout.project(201, 399);
    const su = probe.u - origin.u;
    const sv = probe.v - origin.v;
    for (const plan of plans) {
      const base = layout.project(plan.x, plan.y);
      const image = track(
        scene.add.image(base.u, base.v, AMBIENCE_TEXTURE_KEY, plan.kind).setDepth(AMBIENCE_DEPTH).setAlpha(0)
      );
      const scale = (plan.size * layout.scale) / FRAME_SIZE;
      image.setScale(scale);
      this.motes.push({ plan, image, u: base.u, v: base.v, su, sv, scale });
    }
  }

  get size(): number {
    return this.motes.length;
  }

  update(time: number): void {
    for (let i = 0; i < this.motes.length; i++) {
      const { plan, image, u, v, su, sv, scale } = this.motes[i];
      const t = time * plan.fx + plan.phase;
      if (plan.kind === 'glint') {
        // Brief sparkle: mostly dark, a sharp peak once per cycle.
        const s = Math.max(0, Math.sin(t));
        const peak = s * s * s * s;
        image.setAlpha(peak * plan.alpha).setScale(scale * (0.6 + 0.5 * peak));
        continue;
      }
      const ty = time * plan.fy + plan.phase * 1.7;
      image.setPosition(u + Math.sin(t) * plan.ax * su, v + Math.sin(ty) * plan.ay * sv);
      // Fade in and out slowly so motes appear and leave instead of popping.
      const fade = 0.5 + 0.5 * Math.sin(t * 0.5 + 1.3);
      image.setAlpha(plan.alpha * (0.25 + 0.75 * fade));
      if (plan.kind === 'butterfly') {
        image.setScale(scale * (0.3 + 0.7 * Math.abs(Math.sin(time * 0.016 + plan.phase))), scale);
        image.setFlipX(Math.cos(t) < 0);
      } else if (plan.kind === 'petal') {
        image.setRotation(Math.sin(ty * 1.4) * 0.9);
      }
    }
  }
}

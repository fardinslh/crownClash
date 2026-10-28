import { soldierPosition, type GameState, type LaneState, type Team } from '@crown-clash/game-core';

/** The lane rules live in game-core (shared with the replay); the client drives the same engine. */
export { LaneEngine as LaneRuntime, capturesBetween } from '@crown-clash/game-core';

/** One tower's path slots: its tier, and how many of them are free. */
export interface TierDots { readonly u: number; readonly v: number; readonly tier: number; readonly free: number; readonly owner: Team }

/** A column of dots beside a tower's count: a bright dot is a free path, a dim one a path with a lane running. */
export function drawTierDots(graphics: LaneGraphics, dots: readonly TierDots[], scale: number): void {
  for (const dot of dots) {
    if (dot.owner === 'neutral') continue;
    const gap = 10 * scale;
    for (let i = 0; i < dot.tier; i++) {
      const y = dot.v + (i - (dot.tier - 1) / 2) * gap;
      const free = i < dot.free;
      graphics.fillStyle(0x020617, 0.92).fillCircle(dot.u, y, 5.4 * scale);
      graphics.fillStyle(free ? 0xffffff : LANE_COLORS[dot.owner], free ? 1 : 0.6).fillCircle(dot.u, y, free ? 3.8 * scale : 2.6 * scale);
    }
  }
}

/** The few Phaser Graphics calls the lane drawing needs, so it can be tested with a fake. */
export interface LaneGraphics {
  lineStyle(width: number, color: number, alpha: number): LaneGraphics;
  lineBetween(x1: number, y1: number, x2: number, y2: number): LaneGraphics;
  fillStyle(color: number, alpha: number): LaneGraphics;
  fillCircle(x: number, y: number, radius: number): LaneGraphics;
}

export const LANE_COLORS: Readonly<Record<Team, number>> = Object.freeze({ player: 0x60a5fa, enemy: 0xf87171, neutral: 0x94a3b8 });

/** Draws every lane as a translucent beam along its road and every soldier as a dot in file. */
export function drawLanes(
  graphics: LaneGraphics, state: GameState, lanes: LaneState,
  project: (x: number, y: number) => { u: number; v: number }, scale: number,
  options: { soldierDots?: boolean } = {},
): void {
  for (const lane of lanes.lanes) {
    const color = LANE_COLORS[lane.owner];
    for (let i = 0; i < lane.routeIds.length - 1; i++) {
      const a = state.territories[lane.routeIds[i]], b = state.territories[lane.routeIds[i + 1]];
      if (!a || !b) continue;
      const p = project(a.x, a.y), q = project(b.x, b.y);
      graphics.lineStyle(15 * scale, color, 0.28).lineBetween(p.u, p.v, q.u, q.v);
      graphics.lineStyle(5 * scale, color, 0.85).lineBetween(p.u, p.v, q.u, q.v);
    }
  }
  if (options.soldierDots === false) return;
  for (const soldier of lanes.soldiers) {
    const at = soldierPosition(state, soldier);
    const p = project(at.x, at.y);
    graphics.fillStyle(0xffffff, 0.95).fillCircle(p.u, p.v, 6.4 * scale);
    graphics.fillStyle(LANE_COLORS[soldier.owner], 1).fillCircle(p.u, p.v, 4.8 * scale);
  }
}

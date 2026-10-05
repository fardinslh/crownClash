import { rectanglesIntersect, type Rect } from '../ui/HudLayout.js';

const CANDIDATES = [[0, 1], [-44, 1], [44, 1], [0, -1], [-44, -1], [44, -1],
  [-62, 0], [62, 0], [0, 2], [0, -2]] as const;

export interface ArmyBadgeOffset { x: number; y: number }
export interface ArmyBadgeRoute {
  start: ArmyBadgeOffset;
  end: ArmyBadgeOffset;
  offset: ArmyBadgeOffset;
  width: number;
  progressOffset: number;
  progressRate?: number;
}

/** Continuous edge clamping; never reselect an offset during a march. */
export function anchoredArmyBadge(
  x: number, y: number, offset: ArmyBadgeOffset, width: number, bounds: Rect,
): Rect {
  return {
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - width, x + offset.x - width / 2)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - 18, y + offset.y - 9)),
    width, height: 18,
  };
}

/** Pick once using the whole route, rather than hopping around nearby labels. */
export function planArmyBadgeOffset(
  start: { x: number; y: number }, end: { x: number; y: number },
  preferredY: number, width: number, blockers: readonly Rect[], bounds: Rect,
  otherRoutes: readonly ArmyBadgeRoute[] = [],
): ArmyBadgeOffset {
  const candidates: ArmyBadgeOffset[] = CANDIDATES.map(([x, direction]) => ({ x, y: preferredY * direction }));
  candidates.push({ x: -84, y: preferredY }, { x: 84, y: preferredY });
  let best = candidates[0];
  let bestScore = Infinity;
  // A maximum 4px step covers even thin role markers, including edge clamping.
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 4));
  for (const offset of candidates) {
    let score = 0;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const rect = anchoredArmyBadge(start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t, offset, width, bounds);
      const padded = { x: rect.x - 3, y: rect.y - 3, width: width + 6, height: 24 };
      for (const blocker of blockers) if (rectanglesIntersect(padded, blocker)) score++;
      for (const route of otherRoutes) {
        const progress = t * (route.progressRate ?? 1) + route.progressOffset;
        if (progress < 0 || progress > 1) continue;
        const other = anchoredArmyBadge(route.start.x + (route.end.x - route.start.x) * progress,
          route.start.y + (route.end.y - route.start.y) * progress, route.offset, route.width, bounds);
        if (rectanglesIntersect(padded, other)) score++;
      }
      if (score >= bestScore) break;
    }
    if (score < bestScore) { best = offset; bestScore = score; }
    if (score === 0) break;
  }
  return best;
}

import type { Territory } from '@crown-clash/game-core';

export interface WorldPoint { x: number; y: number }

/**
 * Towers whose hit circle the finger crossed between two pointer samples, in
 * the order it crossed them. A fast swipe can jump over a small tower between
 * two move events, so the sample points alone would miss it.
 */
export function territoriesCrossedBySegment(
  territories: Iterable<Territory>, from: WorldPoint, to: WorldPoint, hitPadding: number,
): Territory[] {
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const crossed: Array<{ territory: Territory; along: number }> = [];
  for (const territory of territories) {
    const along = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((territory.x - from.x) * dx + (territory.y - from.y) * dy) / lengthSq));
    const closest = Math.hypot(from.x + dx * along - territory.x, from.y + dy * along - territory.y);
    if (closest <= territory.radius + hitPadding) crossed.push({ territory, along });
  }
  return crossed.sort((a, b) => a.along - b.along || (a.territory.id < b.territory.id ? -1 : 1)).map(({ territory }) => territory);
}

import { rectanglesIntersect, type Rect } from '../ui/HudLayout.js';

const CANDIDATES = [[0, 1], [-44, 1], [44, 1], [0, -1], [-44, -1], [44, -1],
  [-62, 0], [62, 0], [0, 2], [0, -2]] as const;

/** Keeps existing army badges clear of territory annotations and each other. */
export function placeArmyBadge(
  x: number, y: number, preferredY: number, width: number,
  blockers: readonly Rect[], bounds: Rect,
): Rect {
  const height = 18;
  const fit = (cx: number, cy: number): Rect => ({
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - width, cx - width / 2)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - height, cy - height / 2)),
    width, height,
  });
  const clear = (rect: Rect): boolean => {
    const padded = { x: rect.x - 3, y: rect.y - 3, width: width + 6, height: height + 6 };
    return !blockers.some((blocker) => rectanglesIntersect(padded, blocker));
  };
  for (const [dx, direction] of CANDIDATES) {
    const rect = fit(x + dx, y + preferredY * direction);
    if (clear(rect)) return rect;
  }
  // Dense simultaneous dispatches can fill the local candidates. Search
  // the same visible field for the nearest free spot; never hide a count.
  let nearest: Rect | undefined;
  let distance = Infinity;
  for (let cy = bounds.y + 9; cy <= bounds.y + bounds.height - 9; cy += 24) {
    for (let cx = bounds.x + width / 2; cx <= bounds.x + bounds.width - width / 2; cx += 28) {
      const rect = fit(cx, cy);
      const nextDistance = (cx - x) ** 2 + (cy - y - preferredY) ** 2;
      if (nextDistance < distance && clear(rect)) {
        nearest = rect;
        distance = nextDistance;
      }
    }
  }
  return nearest ?? fit(x, y + preferredY);
}

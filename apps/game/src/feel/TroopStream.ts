/**
 * Marching column layout. A bigger army should look bigger: instead of a
 * fixed 1–3 followers, the convoy grows into a two-file column behind its
 * leader. Presentation only — the simulated army is still one entity.
 *
 * Offsets are in unscaled screen units relative to the leader:
 * `back` along the reverse travel direction, `side` across it.
 */
export interface StreamSlot {
  readonly back: number;
  readonly side: number;
  readonly delayMs: number;
}

/** Followers on capable devices; low-end devices keep the old small squad. */
export const STREAM_MAX_FOLLOWERS = { full: 10, reduced: 4 } as const;

export function troopFollowerCount(units: number, maxFollowers: number): number {
  if (!Number.isFinite(units) || units < 6) return 1;
  return Math.max(1, Math.min(Math.floor(maxFollowers), 1 + Math.floor(units / 5)));
}

export function troopStreamSlots(units: number, maxFollowers: number, extraRearGuard = false): StreamSlot[] {
  const count = troopFollowerCount(units, maxFollowers) + (extraRearGuard ? 1 : 0);
  const slots: StreamSlot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2);
    const lastAlone = i === count - 1 && count % 2 === 1 && count > 1;
    const side = count === 1 || lastAlone ? 0 : i % 2 === 0 ? 6 : -6;
    slots.push({ back: 15 + row * 9 + (i % 2) * 4, side, delayMs: 45 * (i + 1) });
  }
  return slots;
}

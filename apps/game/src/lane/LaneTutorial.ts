import { planLanes, type GameState, type LaneState } from '@crown-clash/game-core';

export type LaneTutorialStep = 'drag' | 'cut' | 'conquer';

export const LANE_TUTORIAL_DONE_KEY = 'crown_clash_lane_tutorial_done';
/** How long the last caption stays up before the tutorial counts as finished. */
export const LANE_TUTORIAL_CONQUER_SECONDS = 6;

export function laneTutorialDone(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): boolean {
  try { return storage?.getItem(LANE_TUTORIAL_DONE_KEY) === '1'; } catch { return false; }
}

export function markLaneTutorialDone(storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try { storage?.setItem(LANE_TUTORIAL_DONE_KEY, '1'); } catch { /* the tutorial just shows again next time */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof window !== 'undefined' ? window.localStorage : undefined; } catch { return undefined; }
}

/** A finger demonstration between two world points (flat coordinates). */
export interface LaneTutorialHand { readonly from: { x: number; y: number }; readonly to: { x: number; y: number } }

export interface LaneTutorialView {
  readonly step: LaneTutorialStep;
  readonly hand: LaneTutorialHand | null;
}

/**
 * First-battle guide for lane battles, taught by doing like Tower War's three captions: drag to open
 * a lane, swipe across it to cut it, then take every enemy tower. It never blocks input; it only
 * advances when the player has done the thing. No Phaser here: the scene draws the caption and hand.
 */
export class LaneTutorial {
  step: LaneTutorialStep = 'drag';
  private conquerSince?: number;
  private hadLane = false;
  finished = false;

  /**
   * Advances from the live state. `nowSeconds` is match time. Returns what to show, or null when done.
   */
  update(state: GameState, lanes: LaneState, nowSeconds: number): LaneTutorialView | null {
    if (this.finished) return null;
    const playerLanes = lanes.lanes.filter((l) => l.owner === 'player');
    if (this.step === 'drag' && playerLanes.length > 0) {
      this.step = 'cut';
      this.hadLane = true;
    }
    if (this.step === 'cut' && this.hadLane && playerLanes.length === 0) {
      this.step = 'conquer';
      this.conquerSince = nowSeconds;
    }
    if (this.step === 'conquer' && this.conquerSince !== undefined && nowSeconds - this.conquerSince >= LANE_TUTORIAL_CONQUER_SECONDS) {
      this.finished = true;
      return null;
    }
    return { step: this.step, hand: this.step === 'conquer' ? null : this.handFor(state, lanes, playerLanes[0]) };
  }

  private handFor(state: GameState, lanes: LaneState, lane: LaneState['lanes'][number] | undefined): LaneTutorialHand | null {
    if (this.step === 'drag') {
      const order = planLanes(state, lanes, 'player').open[0];
      const from = state.territories[order?.from ?? 'p_base'];
      const to = state.territories[order?.to ?? 'n_bot_left'];
      return from && to ? { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } } : null;
    }
    // Cut: sweep across the middle of the player's first lane, perpendicular to it.
    if (!lane) return null;
    const a = state.territories[lane.routeIds[0]], b = state.territories[lane.routeIds[lane.routeIds.length - 1]];
    if (!a || !b) return null;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = (b.y - a.y) * 0.3, dy = -(b.x - a.x) * 0.3;
    return { from: { x: mid.x + dx, y: mid.y + dy }, to: { x: mid.x - dx, y: mid.y - dy } };
  }
}

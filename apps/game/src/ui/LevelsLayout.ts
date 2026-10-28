import { LOGICAL_WIDTH } from '@crown-clash/game-core';

export interface LevelNodeLayout {
  readonly x: number;
  readonly y: number;
  /** Which side of the node its difficulty and reward label sits on (always the outer, free side). */
  readonly labelSide: 'left' | 'right';
}

export interface LevelsLayout {
  readonly nodeRadius: number;
  readonly nodes: readonly LevelNodeLayout[];
  readonly progressY: number;
  /** Centre of the Weekly Challenge entry button under the map. */
  readonly weeklyY: number;
  readonly weeklyHeight: number;
  readonly statusY: number;
  readonly toastY: number;
}

const HEADER_BOTTOM = 96;
const WEEKLY_HEIGHT = 48;
/** Progress line (28) plus the weekly button and its gaps. */
const BOTTOM_MARGIN = 28 + WEEKLY_HEIGHT + 32;
const MIN_RADIUS = 22;
const MAX_RADIUS = 32;
const MAX_PITCH = 84;
/** Horizontal distance of the zigzag from the centre line. */
const ZIGZAG_OFFSET = 62;

/**
 * A winding road: level 1 at the bottom right (RTL start), the road zigzags up to the last
 * level at the top. Nodes share the height between the header and the bottom margin, so ten
 * of them fit on a 640px-tall viewport without scrolling and spread out on taller phones
 * (radius grows from 22 to 32, a 44px+ tap target at the smallest). The Weekly Challenge
 * button sits in the bottom margin, below the progress line.
 */
export function computeLevelsLayout(levelCount: number, visibleHeight: number): LevelsLayout {
  const count = Math.max(0, levelCount);
  const steps = Math.max(1, count - 1);
  const span = (radius: number): number => {
    const bottom = visibleHeight - 92 - 10 - radius;
    return bottom - (HEADER_BOTTOM + radius + 16);
  };
  const nodeRadius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, (span(MIN_RADIUS) / steps) * 0.45));
  const bottom = visibleHeight - 92 - 10 - nodeRadius;
  const available = span(nodeRadius);
  const pitch = Math.min(MAX_PITCH, available / steps);
  // Centre the road vertically when the pitch is capped on tall phones.
  const start = bottom - (available - pitch * steps) / 2;
  const cx = LOGICAL_WIDTH / 2;
  const nodes: LevelNodeLayout[] = [];
  for (let index = 0; index < count; index++) {
    const right = index % 2 === 0;
    nodes.push({ x: cx + (right ? ZIGZAG_OFFSET : -ZIGZAG_OFFSET), y: start - index * pitch, labelSide: right ? 'right' : 'left' });
  }
  return {
    nodeRadius,
    nodes,
    progressY: visibleHeight - WEEKLY_HEIGHT - 44,
    weeklyY: visibleHeight - 20 - WEEKLY_HEIGHT / 2,
    weeklyHeight: WEEKLY_HEIGHT,
    statusY: HEADER_BOTTOM + (visibleHeight - HEADER_BOTTOM - BOTTOM_MARGIN) / 2,
    toastY: visibleHeight - WEEKLY_HEIGHT - 60,
  };
}

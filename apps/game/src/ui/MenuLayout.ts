import { LOGICAL_HEIGHT } from '@crown-clash/game-core';

export interface MenuLayout {
  titleY: number;
  subtitleY: number;
  crestY: number;
  rankY: number;
  statsY: number;
  doctrineY: number;
  playY: number;
  livePvpY: number;
  trainingY: number;
  navigationY: number;
}

const BASE_LAYOUT: MenuLayout = {
  titleY: 78,
  subtitleY: 114,
  crestY: 248,
  rankY: 368,
  statsY: 418,
  doctrineY: 461,
  playY: 500,
  livePvpY: 562,
  trainingY: 622,
  navigationY: 680,
};

const SURPLUS_WEIGHTS: Record<keyof MenuLayout, number> = {
  titleY: 0.08,
  subtitleY: 0.08,
  crestY: 0.2,
  rankY: 0.35,
  statsY: 0.45,
  doctrineY: 0.54,
  playY: 0.63,
  livePvpY: 0.75,
  trainingY: 0.88,
  navigationY: 1,
};

/** Uses surplus portrait height while preserving the proven 400x720 layout. */
export function computeMenuLayout(visibleHeight: number): MenuLayout {
  const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);
  const layout = { ...BASE_LAYOUT };

  for (const key of Object.keys(layout) as Array<keyof MenuLayout>) {
    layout[key] += surplus * SURPLUS_WEIGHTS[key];
  }

  return layout;
}

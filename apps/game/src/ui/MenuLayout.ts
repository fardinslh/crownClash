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

/** Bottom navigation tile height (centre is `navigationY`). */
export const MENU_NAV_TILE_HEIGHT = 62;

const BASE_LAYOUT: MenuLayout = {
  titleY: 70,
  subtitleY: 104,
  crestY: 206,
  rankY: 312,
  statsY: 368,
  doctrineY: 418,
  playY: 462,
  livePvpY: 528,
  trainingY: 594,
  navigationY: 674,
};

const SURPLUS_WEIGHTS: Record<keyof MenuLayout, number> = {
  titleY: 0.06,
  subtitleY: 0.06,
  crestY: 0.22,
  rankY: 0.38,
  statsY: 0.45,
  doctrineY: 0.52,
  playY: 0.6,
  livePvpY: 0.72,
  trainingY: 0.84,
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

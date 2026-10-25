import { describe, expect, it } from 'vitest';
import { computeMenuLayout, MENU_NAV_TILE_HEIGHT } from '../MenuLayout.js';

describe('computeMenuLayout', () => {
  it('preserves the compact 720px layout exactly', () => {
    expect(computeMenuLayout(720)).toEqual({
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
    });
  });

  it('anchors navigation near the bottom and uses tall-phone surplus', () => {
    const layout = computeMenuLayout(867);

    expect(layout.navigationY).toBe(821);
    expect(867 - (layout.navigationY + MENU_NAV_TILE_HEIGHT / 2)).toBe(15);
    expect(layout.crestY).toBeGreaterThan(206);
    expect(layout.playY).toBeGreaterThan(462);
  });

  it('keeps tall-phone controls separated', () => {
    const layout = computeMenuLayout(867);

    expect(layout.statsY - layout.rankY).toBeGreaterThanOrEqual(60);
    expect(layout.playY - layout.doctrineY).toBeGreaterThanOrEqual(48);
    expect(layout.livePvpY - layout.playY).toBeGreaterThanOrEqual(76);
    expect(layout.trainingY - layout.livePvpY).toBeGreaterThanOrEqual(76);
    expect(layout.navigationY - layout.trainingY).toBeGreaterThanOrEqual(74);
  });

  it('never compresses below the supported logical height', () => {
    expect(computeMenuLayout(667)).toEqual(computeMenuLayout(720));
  });
});

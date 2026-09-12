import { describe, expect, it } from 'vitest';
import { computeMenuLayout } from '../MenuLayout.js';

describe('computeMenuLayout', () => {
  it('preserves the compact 720px layout exactly', () => {
    expect(computeMenuLayout(720)).toEqual({
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
    });
  });

  it('anchors navigation near the bottom and uses tall-phone surplus', () => {
    const layout = computeMenuLayout(867);

    expect(layout.navigationY).toBe(827);
    expect(867 - (layout.navigationY + 22)).toBe(18);
    expect(layout.crestY).toBeGreaterThan(248);
    expect(layout.playY).toBeGreaterThan(500);
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

import { describe, expect, it } from 'vitest';
import { computeResultRankPresentation } from './ResultModalLayout.js';

describe('result modal rank presentation', () => {
  it('shows only the normal rank summary without a promotion', () => {
    expect(computeResultRankPresentation(false)).toEqual({
      rankY: -208,
      showRankSummary: true,
      showPromotion: false,
    });
  });

  it('replaces the normal rank summary with the promotion banner', () => {
    expect(computeResultRankPresentation(true)).toEqual({
      rankY: -208,
      showRankSummary: false,
      showPromotion: true,
    });
  });
});

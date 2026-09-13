export interface ResultRankPresentation {
  rankY: number;
  showRankSummary: boolean;
  showPromotion: boolean;
}

export function computeResultRankPresentation(rankPromoted: boolean): ResultRankPresentation {
  return {
    rankY: -208,
    showRankSummary: !rankPromoted,
    showPromotion: rankPromoted,
  };
}

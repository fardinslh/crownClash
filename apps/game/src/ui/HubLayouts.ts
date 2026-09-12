import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';

// --- TRAINING SCENE LAYOUT ---
export interface TrainingLayout {
  cardY: number;
  cardOffset: number;
  dotsY: number;
  navigationButtonsY: number;
  menuButtonY: number;
}

export function computeTrainingLayout(visibleHeight: number): TrainingLayout {
  const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);
  const cardY = 88 + Math.round(surplus * 0.16);

  return {
    cardY,
    cardOffset: cardY - 88,
    dotsY: 554 + Math.round(surplus * 0.54),
    navigationButtonsY: 598 + Math.round(surplus * 0.76),
    menuButtonY: 666 + surplus,
  };
}

// --- DAILY SCENE LAYOUT ---
export interface DailyLayout {
  resetTextY: number;
  statusTextY: number;
  retryY: number;
  missionYs: [number, number, number];
  chestY: number;
  toastY: number;
}

export function computeDailyLayout(visibleHeight: number): DailyLayout {
  const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);

  return {
    resetTextY: 101 + Math.round(surplus * 0.05),
    statusTextY: 340 + Math.round(surplus * 0.35),
    retryY: 392 + Math.round(surplus * 0.35),
    missionYs: [
      174 + Math.round(surplus * 0.12),
      291 + Math.round(surplus * 0.34),
      408 + Math.round(surplus * 0.56),
    ],
    chestY: 566 + Math.round(surplus * 0.82),
    toastY: 690 + surplus,
  };
}

// --- LEAGUE SCENE LAYOUT ---
export interface LeagueLayout {
  summaryY: number;
  roadStartY: number;
  roadEndY: number;
  tierYs: [number, number, number, number, number, number];
  kingdomButtonY: number;
  toastY: number;
  statusTextY: number;
  retryY: number;
}

export function computeLeagueLayout(visibleHeight: number): LeagueLayout {
  const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);
  const summaryY = 130 + Math.round(surplus * 0.08);
  const tier0 = 214 + Math.round(surplus * 0.16);
  const tierStep = 68 + Math.round(surplus * 0.09);

  const tierYs: [number, number, number, number, number, number] = [
    tier0,
    tier0 + tierStep,
    tier0 + tierStep * 2,
    tier0 + tierStep * 3,
    tier0 + tierStep * 4,
    tier0 + tierStep * 5,
  ];

  return {
    summaryY,
    roadStartY: tier0 - 1,
    roadEndY: tierYs[5],
    tierYs,
    kingdomButtonY: 643 + Math.round(surplus * 0.88),
    toastY: 690 + surplus,
    statusTextY: 350 + Math.round(surplus * 0.40),
    retryY: 398 + Math.round(surplus * 0.40),
  };
}

// --- KINGDOM SCENE LAYOUT ---
export interface KingdomLayout {
  panelY: number;
  gridTop: number;
  rowGap: number;
  cardPositions: Array<{ x: number; y: number }>;
  toastY: number;
}

const KINGDOM_CARD_WIDTH = 174;
const KINGDOM_CARD_HEIGHT = 248;
const KINGDOM_COL_X = [
  LOGICAL_WIDTH / 2 - KINGDOM_CARD_WIDTH / 2 - 10,
  LOGICAL_WIDTH / 2 + KINGDOM_CARD_WIDTH / 2 + 10,
];

export function computeKingdomLayout(visibleHeight: number): KingdomLayout {
  const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);
  const panelY = 84 + Math.round(surplus * 0.06);
  const gridTop = 166 + Math.round(surplus * 0.12);
  const rowGap = 16 + Math.round(surplus * 0.35);

  const row0Center = gridTop + KINGDOM_CARD_HEIGHT / 2;
  const row1Center = gridTop + KINGDOM_CARD_HEIGHT + rowGap + KINGDOM_CARD_HEIGHT / 2;

  return {
    panelY,
    gridTop,
    rowGap,
    cardPositions: [
      { x: KINGDOM_COL_X[0], y: row0Center },
      { x: KINGDOM_COL_X[1], y: row0Center },
      { x: KINGDOM_COL_X[0], y: row1Center },
      { x: KINGDOM_COL_X[1], y: row1Center },
    ],
    toastY: 700 + surplus,
  };
}

// --- COMMANDER SCENE LAYOUT ---
export interface CommanderLayout {
  powerBadgeY: number;
  cardYs: [number, number, number];
  helperTextY: number;
  toastY: number;
}

export function computeCommanderLayout(visibleHeight: number): CommanderLayout {
  const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);
  const card0 = 188 + Math.round(surplus * 0.12);
  const cardStep = 157 + Math.round(surplus * 0.24);

  return {
    powerBadgeY: 98 + Math.round(surplus * 0.05),
    cardYs: [card0, card0 + cardStep, card0 + cardStep * 2],
    helperTextY: 681 + surplus,
    toastY: 650 + surplus,
  };
}

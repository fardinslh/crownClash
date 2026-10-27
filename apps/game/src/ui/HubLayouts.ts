import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';

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
    statusTextY: 340 + Math.round(surplus * 0.3),
    retryY: 392 + Math.round(surplus * 0.3),
    // The list stays compact on tall phones (no stretched gaps); the chest
    // keeps a little more air as the goal of the screen.
    missionYs: [
      174 + Math.round(surplus * 0.08),
      291 + Math.round(surplus * 0.16),
      408 + Math.round(surplus * 0.24),
    ],
    chestY: 566 + Math.round(surplus * 0.36),
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
  /** Top edge of the kingdom hero panel. */
  panelY: number;
  /** Hero panel height; tall phones spend their surplus on the castle art. */
  heroHeight: number;
  gridTop: number;
  rowGap: number;
  cardPositions: Array<{ x: number; y: number }>;
  toastY: number;
}

export const KINGDOM_CARD_WIDTH = 178;
export const KINGDOM_CARD_HEIGHT = 204;
const KINGDOM_COL_GAP = 12;
const KINGDOM_ROW_GAP = 12;
const KINGDOM_COL_X = [
  LOGICAL_WIDTH / 2 + KINGDOM_CARD_WIDTH / 2 + KINGDOM_COL_GAP / 2,
  LOGICAL_WIDTH / 2 - KINGDOM_CARD_WIDTH / 2 - KINGDOM_COL_GAP / 2,
];

/**
 * Compact two-by-two upgrade grid under a hero panel. The row gap never
 * stretches; extra portrait height grows the hero (castle art) instead.
 * RTL: the first card is the top-right one.
 */
export function computeKingdomLayout(visibleHeight: number): KingdomLayout {
  const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);
  const panelY = 86 + Math.round(surplus * 0.04);
  const heroHeight = 112 + Math.round(Math.min(surplus, 220) * 0.7);
  const gridTop = panelY + heroHeight + 12;
  const rowGap = KINGDOM_ROW_GAP;

  const row0Center = gridTop + KINGDOM_CARD_HEIGHT / 2;
  const row1Center = gridTop + KINGDOM_CARD_HEIGHT + rowGap + KINGDOM_CARD_HEIGHT / 2;

  return {
    panelY,
    heroHeight,
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
  const card0 = 188 + Math.round(surplus * 0.1);
  const cardStep = 157 + Math.round(surplus * 0.12);

  return {
    powerBadgeY: 98 + Math.round(surplus * 0.05),
    cardYs: [card0, card0 + cardStep, card0 + cardStep * 2],
    helperTextY: 681 + surplus,
    toastY: 650 + surplus,
  };
}

// --- HUB BACKDROP ---
/** Width / height of the exported meadow band (assets/hub/hub_meadow.webp). */
export const BACKDROP_ASPECT = 512 / 298;

export interface BackdropTile {
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly flipY: boolean;
}

/**
 * Tiles of the band, top to bottom, alternating a vertical mirror so the
 * seams are invisible. The band is scaled to cover the full visible width.
 */
export function computeBackdropTiles(visibleWidth: number, visibleHeight: number, aspect = BACKDROP_ASPECT): BackdropTile[] {
  if (!(visibleWidth > 0) || !(visibleHeight > 0) || !(aspect > 0)) return [];
  const height = visibleWidth / aspect;
  const count = Math.max(1, Math.ceil(visibleHeight / height));
  return Array.from({ length: count }, (_, i) => ({ y: i * height, width: visibleWidth, height, flipY: i % 2 === 1 }));
}

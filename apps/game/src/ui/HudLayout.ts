export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudElementLayout {
  center: { x: number; y: number };
  visibleBounds: Rect;
  hitBounds?: Rect;
}

export interface DominanceBarLayout {
  center: { x: number; y: number };
  bounds: Rect;
  trackWidth: number;
  trackHeight: number;
}

export interface HudLayoutResult {
  headerBar: Rect;
  playerPill: HudElementLayout;
  trophyPill: HudElementLayout;
  coinPill: HudElementLayout;
  clockPill: HudElementLayout;
  menuButton: HudElementLayout & { hitBounds: Rect };
  dominanceBar: DominanceBarLayout;
}

/**
 * Determines whether two 2D axis-aligned bounding boxes strictly intersect.
 */
export function rectanglesIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Computes deterministic layout metrics for the Crown Clash top HUD.
 *
 * Requirements:
 * - Row 1 items (Player, Trophies, Coins/Opponent, Clock, Menu Button) are centered at y = 20.
 * - Visible menu button is 36x26, centered at y = 20 (y: 7..33).
 * - Menu touch target is >= 44x44, centered at y = 20 (y: -2..42).
 * - Dominance bar is centered at y = 50 with height 14 (y: 43..57).
 * - Visible menu button and touch hit area never intersect the dominance bar.
 */
export function computeHudLayout(
  screenWidth: number,
  playerTextWidth: number = 50
): HudLayoutResult {
  // 1. Header glass panel background spans the full width of the viewport
  const headerBar: Rect = {
    x: 0,
    y: 0,
    width: screenWidth,
    height: 70,
  };

  // 2. Menu button (Right side)
  // Preserves >= 44x44 touch target while keeping visible frame compact (36x26)
  const menuCenterX = screenWidth - 25;
  const menuCenterY = 20;
  const menuVisibleWidth = 36;
  const menuVisibleHeight = 26;
  const menuHitSize = 44;

  const menuButton: HudElementLayout & { hitBounds: Rect } = {
    center: { x: menuCenterX, y: menuCenterY },
    visibleBounds: {
      x: menuCenterX - menuVisibleWidth / 2,
      y: menuCenterY - menuVisibleHeight / 2,
      width: menuVisibleWidth,
      height: menuVisibleHeight,
    },
    hitBounds: {
      x: menuCenterX - menuHitSize / 2,
      y: menuCenterY - menuHitSize / 2,
      width: menuHitSize,
      height: menuHitSize,
    },
  };

  // 3. Row 1 HUD pills (y center = 20, height = 24)
  const pillY = 20;
  const pillHeight = 24;
  const pillGap = 5;

  // Player Pill: dynamic width clamped to [70, 96]
  const playerPillWidth = Math.min(96, Math.max(70, Math.ceil(playerTextWidth) + 14));
  const playerPillStartX = 10;
  const playerPill: HudElementLayout = {
    center: { x: playerPillStartX + playerPillWidth / 2, y: pillY },
    visibleBounds: {
      x: playerPillStartX,
      y: pillY - pillHeight / 2,
      width: playerPillWidth,
      height: pillHeight,
    },
  };

  // Trophies Pill
  const trophyPillWidth = 56;
  const trophyPillStartX = playerPill.visibleBounds.x + playerPillWidth + pillGap;
  const trophyPill: HudElementLayout = {
    center: { x: trophyPillStartX + trophyPillWidth / 2, y: pillY },
    visibleBounds: {
      x: trophyPillStartX,
      y: pillY - pillHeight / 2,
      width: trophyPillWidth,
      height: pillHeight,
    },
  };

  // Coins / Opponent Pill
  const coinPillWidth = 68;
  const coinPillStartX = trophyPill.visibleBounds.x + trophyPillWidth + pillGap;
  const coinPill: HudElementLayout = {
    center: { x: coinPillStartX + coinPillWidth / 2, y: pillY },
    visibleBounds: {
      x: coinPillStartX,
      y: pillY - pillHeight / 2,
      width: coinPillWidth,
      height: pillHeight,
    },
  };

  // Clock Pill
  const clockPillWidth = 72;
  const clockPillStartX = coinPill.visibleBounds.x + coinPillWidth + pillGap;
  const clockPill: HudElementLayout = {
    center: { x: clockPillStartX + clockPillWidth / 2, y: pillY },
    visibleBounds: {
      x: clockPillStartX,
      y: pillY - pillHeight / 2,
      width: clockPillWidth,
      height: pillHeight,
    },
  };

  // 4. Row 2 Dynamic Dominance Bar (y center = 50, height = 14)
  const barHeight = 14;
  const barY = 50;
  const barWidth = Math.min(screenWidth - 30, 360);
  const barStartX = (screenWidth - barWidth) / 2;

  const dominanceBar: DominanceBarLayout = {
    center: { x: screenWidth / 2, y: barY },
    bounds: {
      x: barStartX,
      y: barY - barHeight / 2,
      width: barWidth,
      height: barHeight,
    },
    trackWidth: barWidth,
    trackHeight: barHeight,
  };

  return {
    headerBar,
    playerPill,
    trophyPill,
    coinPill,
    clockPill,
    menuButton,
    dominanceBar,
  };
}

export interface DominanceCalculationInput {
  playerStrength: number;
  enemyStrength: number;
  neutralStrength: number;
  playerArmiesCount: number;
  enemyArmiesCount: number;
  enemyTerritoriesCount: number;
}

export interface DominancePercentagesResult {
  playerPct: number;
  enemyPct: number;
  neutralPct: number;
  playerDomText: string;
  enemyDomText: string;
  isLastEnemyArmy: boolean;
}

/**
 * Calculates display percentages and visual widths for the dominance bar.
 * Ensures enemy dominance never displays plain "0%" while enemy strength
 * or active armies remain on the field, preventing apparent game freezes.
 */
export function formatDominancePercentages(
  input: DominanceCalculationInput
): DominancePercentagesResult {
  const {
    playerStrength,
    enemyStrength,
    neutralStrength,
    enemyArmiesCount,
    enemyTerritoriesCount,
  } = input;

  const hasEnemyPresence = enemyStrength > 0 || enemyArmiesCount > 0;
  const isLastEnemyArmy = enemyTerritoriesCount === 0 && enemyArmiesCount > 0;

  const totalStrength = Math.max(1, playerStrength + enemyStrength + neutralStrength);
  const rawPlayerPct = (playerStrength / totalStrength) * 100;
  const rawEnemyPct = (enemyStrength / totalStrength) * 100;

  let playerPct = Math.round(rawPlayerPct);
  let enemyPct = Math.round(rawEnemyPct);

  if (hasEnemyPresence) {
    if (enemyPct < 1) {
      enemyPct = 1;
    }
    if (playerPct > 99) {
      playerPct = 99;
    }
  }

  const neutralPct = Math.max(0, 100 - playerPct - enemyPct);

  const enemyDomText = hasEnemyPresence
    ? rawEnemyPct < 0.5
      ? '<1%'
      : `${enemyPct}%`
    : '0%';

  const playerDomText = `${playerPct}%`;

  return {
    playerPct,
    enemyPct,
    neutralPct,
    playerDomText,
    enemyDomText,
    isLastEnemyArmy,
  };
}

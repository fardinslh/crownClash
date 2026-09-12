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

export const HUD_FONT_FAMILY =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';
export const HUD_MONO_FONT_FAMILY =
  'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace';

export const HUD_PILL_HORIZONTAL_PADDING = 10;

export interface HudFontStyle {
  fontSize?: number;
  bold?: boolean;
  mono?: boolean;
}

export interface HudLayoutOptions {
  isLiveMode?: boolean;
  coinOrOpponentTextWidth?: number;
}

export function getPillMaxContentWidth(pillWidth: number): number {
  return Math.max(0, pillWidth - HUD_PILL_HORIZONTAL_PADDING);
}

let cachedCanvasContext: CanvasRenderingContext2D | null | undefined = undefined;

function getCanvasContext(): CanvasRenderingContext2D | null {
  if (cachedCanvasContext !== undefined) return cachedCanvasContext;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const canvas = document.createElement('canvas');
      cachedCanvasContext = canvas.getContext('2d');
    } catch {
      cachedCanvasContext = null;
    }
  } else {
    cachedCanvasContext = null;
  }
  return cachedCanvasContext;
}

/**
 * Fallback font metrics model for Node.js test environments without canvas.
 * Accurately models Segoe UI / Apple-System proportional widths at 11px bold.
 */
function estimateTextWidthFallback(
  text: string,
  fontSize: number,
  isBold: boolean,
  isMono: boolean
): number {
  const scale = fontSize / 11;
  if (isMono) {
    return Array.from(text).length * 7.4 * scale;
  }

  let total = 0;
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) || 0;

    // Common game emoji & symbols
    if (code >= 0x1f300 && code <= 0x1faff) {
      total += 14.5;
    } else if (code === 0x2694 || code === 0x23f1 || code === 0x2b50 || code === 0x2705 || code === 0x26a0) {
      total += 14.5;
    } else if (code === 0x2026) {
      // Ellipsis …
      total += 7.0;
    } else if (char === ' ') {
      total += 3.5;
    } else if ('!:,.;|\''.includes(char)) {
      total += 3.2;
    } else if ('-_()[]?/"*`'.includes(char)) {
      total += 5.0;
    } else if ('iljtrf'.includes(char)) {
      total += 4.2;
    } else if ('mw'.includes(char)) {
      total += 9.4;
    } else if (char >= 'a' && char <= 'z') {
      total += 6.3;
    } else if ('IJ'.includes(char)) {
      total += 4.8;
    } else if ('MWOQG'.includes(char)) {
      total += 9.8;
    } else if (char >= 'A' && char <= 'Z') {
      total += 7.6;
    } else if (char >= '0' && char <= '9') {
      total += 6.8;
    } else if (code >= 0x0600 && code <= 0x06ff) {
      // Persian / Arabic characters
      total += 7.2;
    } else if (code >= 0x4e00 && code <= 0x9fff) {
      // CJK characters
      total += 11.0;
    } else {
      total += 7.0;
    }
  }

  if (isBold) {
    total *= 1.05;
  }
  return total * scale;
}

/**
 * Measures the rendered pixel width of text. Uses HTML5 Canvas 2D when available,
 * or a proportional font metrics estimation in headless/Node environments.
 */
export function measureHudTextWidth(
  text: string,
  style: HudFontStyle = {},
  customMeasureFn?: (t: string) => number
): number {
  if (!text) return 0;
  if (customMeasureFn) return customMeasureFn(text);

  const ctx = getCanvasContext();
  const fontSize = style.fontSize ?? 11;
  const isBold = style.bold ?? true;
  const isMono = style.mono ?? false;

  if (ctx) {
    ctx.font = `${isBold ? 'bold ' : ''}${fontSize}px ${isMono ? HUD_MONO_FONT_FAMILY : HUD_FONT_FAMILY}`;
    return Math.ceil(ctx.measureText(text).width);
  }

  return Math.ceil(estimateTextWidthFallback(text, fontSize, isBold, isMono));
}

/**
 * Truncates text with an ellipsis so that its rendered width never exceeds maxWidth.
 * Respects Unicode code point boundaries so emojis and non-ASCII glyphs are not broken.
 */
export function fitTextToWidth(
  text: string,
  maxWidth: number,
  options: {
    fontStyle?: HudFontStyle;
    ellipsis?: string;
    measureFn?: (t: string) => number;
  } = {}
): string {
  const { fontStyle, ellipsis = '…', measureFn } = options;
  const measure = (s: string) => measureHudTextWidth(s, fontStyle, measureFn);

  if (!text) return '';
  if (maxWidth <= 0) return '';
  if (measure(text) <= maxWidth) return text;

  const ellipsisWidth = measure(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    return ellipsis;
  }

  const codePoints = Array.from(text);
  let low = 0;
  let high = codePoints.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = codePoints.slice(0, mid).join('') + ellipsis;
    if (measure(candidate) <= maxWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best || ellipsis;
}

/**
 * Formats a player or opponent name for a HUD pill:
 * - Trims whitespace and handles empty/null fallback ('Player' or 'Opponent').
 * - Formats Commander_XXXX to 'Cmdr XXXX'.
 * - Accounts for the leading icon/prefix inside the available width.
 * - Truncates deterministically with ellipsis so total rendered width <= maxAvailableWidth.
 */
export function formatHudName(
  rawName: string | null | undefined,
  maxAvailableWidth: number,
  prefix: string = '',
  measureFn?: (t: string) => number
): string {
  const trimmed = (rawName ?? '').trim();
  let candidate = trimmed;

  if (!candidate) {
    candidate = prefix.includes('🔴') ? 'Opponent' : 'Player';
  } else if (candidate.startsWith('Commander_')) {
    const id = candidate.slice(10, 14);
    candidate = 'Cmdr ' + (id || candidate.slice(10));
  }

  const prefixWidth = measureHudTextWidth(prefix, undefined, measureFn);
  const availableForName = Math.max(0, maxAvailableWidth - prefixWidth);

  const fittedName = fitTextToWidth(candidate, availableForName, {
    fontStyle: { fontSize: 11, bold: true },
    ellipsis: '…',
    measureFn,
  });

  return `${prefix}${fittedName}`;
}

/**
 * Formats large coin or trophy numbers into compact representations (e.g. 12.5k, 1.5M).
 */
export function formatCompactNumber(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n < 10_000) {
    return n.toString();
  }
  if (n < 100_000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (n < 1_000_000) {
    return `${Math.floor(n / 1000)}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Formats trophy count with icon and guarantees it fits inside the available width.
 */
export function formatHudTrophies(
  trophies: number,
  maxAvailableWidth: number,
  measureFn?: (t: string) => number
): string {
  const prefix = '🏆 ';
  const numStr = formatCompactNumber(trophies);
  const full = `${prefix}${numStr}`;
  if (measureHudTextWidth(full, undefined, measureFn) <= maxAvailableWidth) {
    return full;
  }
  const prefixWidth = measureHudTextWidth(prefix, undefined, measureFn);
  const fitted = fitTextToWidth(numStr, Math.max(0, maxAvailableWidth - prefixWidth), {
    fontStyle: { fontSize: 11, bold: true },
    measureFn,
  });
  return `${prefix}${fitted}`;
}

/**
 * Formats coin count with icon and guarantees it fits inside the available width.
 */
export function formatHudCoins(
  coins: number,
  maxAvailableWidth: number,
  measureFn?: (t: string) => number
): string {
  const prefix = '🪙 ';
  const numStr = formatCompactNumber(coins);
  const full = `${prefix}${numStr}`;
  if (measureHudTextWidth(full, undefined, measureFn) <= maxAvailableWidth) {
    return full;
  }
  const prefixWidth = measureHudTextWidth(prefix, undefined, measureFn);
  const fitted = fitTextToWidth(numStr, Math.max(0, maxAvailableWidth - prefixWidth), {
    fontStyle: { fontSize: 11, bold: true },
    measureFn,
  });
  return `${prefix}${fitted}`;
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
 * - All pills maintain strictly positive gaps and never collide with the 44x44 menu hit zone.
 */
export function computeHudLayout(
  screenWidth: number,
  playerTextWidth: number = 50,
  options: HudLayoutOptions = {}
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

  const isLiveMode = options.isLiveMode ?? false;

  // Sizing budget:
  // Menu hit target starts at menuCenterX - 22 = screenWidth - 47.
  // Clock pill must end at or before screenWidth - 49 (leaving at least 2px clearance).
  // Total available horizontal width for all 4 pills + 3 gaps (15px) = screenWidth - 49 - 10 = screenWidth - 59.
  const totalAvailableForPills = screenWidth - 59 - 3 * pillGap;

  const trophyPillWidth = 56;
  const clockPillWidth = 68; // 68px accommodates '⏱ 01:30' (52px) with 8px horizontal padding
  // In Live PvP, allocate 72px on screens >= 375px for opponent name; otherwise 68px.
  const coinPillWidth = isLiveMode && screenWidth >= 375 ? 72 : 68;

  // Player Pill: dynamic width bounded by available space and clamped to [68, maxPlayerWidth]
  const maxAllowedPlayerWidth = Math.max(
    68,
    totalAvailableForPills - (trophyPillWidth + coinPillWidth + clockPillWidth)
  );
  const maxPlayerWidth = Math.min(screenWidth <= 360 ? 84 : 96, maxAllowedPlayerWidth);
  const desiredPlayerWidth = Math.ceil(playerTextWidth) + 14;
  const playerPillWidth = Math.min(maxPlayerWidth, Math.max(68, desiredPlayerWidth));

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

/**
 * Shared layout constants and CSS expressions for QA HUD and Test Banner positioning.
 * Guarantees zero overlap across mobile viewports (375x667, 430x932) and notch/island insets.
 */
export const QA_BANNER_TOP_PX = 4;
export const QA_BANNER_HEIGHT_PX = 24;
export const QA_BANNER_BOTTOM_PX = 40; // Inclusive of box-shadow boundary (24px + 4px + 12px shadow)

export const QA_LAYOUT_GAP_PX = 8;
export const QA_HUD_TOP_PX = QA_BANNER_BOTTOM_PX + QA_LAYOUT_GAP_PX; // 48px

/**
 * Top offset expression for the fixed stress mode banner.
 */
export const QA_BANNER_TOP_CSS = 'max(4px, env(safe-area-inset-top))';

/**
 * Top offset expression for the performance HUD container.
 * Starts at 48px (or safe-area-inset-top + 44px), guaranteeing an 8px vertical clearance below the banner.
 */
export const QA_HUD_TOP_CSS = `max(${QA_HUD_TOP_PX}px, calc(env(safe-area-inset-top) + ${QA_HUD_TOP_PX - QA_BANNER_TOP_PX}px))`;

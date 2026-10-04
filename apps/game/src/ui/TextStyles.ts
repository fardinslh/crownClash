import Phaser from 'phaser';

/**
 * Shared game typography. Fonts are bundled in `public/fonts` and registered
 * via `@font-face` in `index.html`; `main.ts` waits for them before Phaser
 * boots so canvas text always renders with real heavy weights.
 *
 * - Baloo 2 (700/800): display font for every label, button, and title.
 * - JetBrains Mono (400/700): numbers that must stay width-stable
 *   (timers, unit counts, score pills).
 *
 * Persian player names fall back to system fonts per glyph; the bundled
 * faces cover Latin only.
 */
export const FONT_FAMILY =
  '"Baloo 2", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export const MONO_FONT_FAMILY =
  '"JetBrains Mono", ui-monospace, "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", monospace';

/**
 * Create canvas text with game-wide defaults: the bundled display font,
 * a chunky weight, and glyph textures rendered at the device render scale
 * (the camera zooms by `renderScale`, so textures below that look soft).
 * Caller styles win; pass `fontFamily: MONO_FONT_FAMILY` for tabular digits.
 */
export function createText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string,
  style: Phaser.Types.GameObjects.Text.TextStyle = {}
): Phaser.GameObjects.Text {
  const renderScale = (scene.registry.get('renderScale') as number | undefined) ?? 1;
  return scene.add.text(x, y, content, {
    fontFamily: FONT_FAMILY,
    fontStyle: '700',
    resolution: renderScale,
    ...style,
  });
}

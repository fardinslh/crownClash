import Phaser from 'phaser';

/**
 * Shared game typography. Fonts are bundled in `public/fonts` and registered
 * via `@font-face` in `index.html`; `main.ts` waits for them before Phaser
 * boots so canvas text always renders with real heavy weights.
 *
 * - Vazirmatn (variable 100-900): Persian UI text and player names. Listed
 *   first so Persian glyphs always resolve to it; Latin glyphs in the same
 *   string use it too, which keeps mixed-script labels visually consistent.
 * - Baloo 2 (700/800): Latin fallback display face.
 * - JetBrains Mono (400/700): numbers that must stay width-stable
 *   (timers, unit counts, score pills).
 */
export const FONT_FAMILY =
  '"Vazirmatn", "Baloo 2", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

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
  const text = scene.add.text(x, y, isolatePersian(content), {
    fontFamily: FONT_FAMILY,
    fontStyle: '700',
    resolution: renderScale,
    ...style,
  });
  const setText = text.setText.bind(text);
  text.setText = (value: string | string[]) =>
    setText(Array.isArray(value) ? value.map(isolatePersian) : isolatePersian(value));
  return text;
}

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const RTL_ISOLATE_START = '\u2067';
const RTL_ISOLATE_END = '\u2069';

/**
 * Canvas text runs in an LTR paragraph, so a Persian line's trailing
 * punctuation ("." "…" "!") and embedded numbers land on the wrong side.
 * Wrapping each Persian line in an RTL isolate fixes the ordering without
 * Phaser's `rtl` style, which renders nothing in Phaser 4.2. Lines without
 * Arabic-script letters (numbers, codes, emoji) are left untouched.
 */
export function isolatePersian(content: string): string {
  if (!ARABIC_SCRIPT.test(content)) return content;
  return content
    .split('\n')
    .map((line) =>
      ARABIC_SCRIPT.test(line) && !line.startsWith(RTL_ISOLATE_START)
        ? `${RTL_ISOLATE_START}${line}${RTL_ISOLATE_END}`
        : line
    )
    .join('\n');
}

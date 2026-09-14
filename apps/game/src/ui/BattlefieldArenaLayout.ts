import type { BattlefieldMotif } from '@crown-clash/game-core';

export type ArenaDecoration =
  | { readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'triangle'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x3: number; readonly y3: number };

/** Static, allocation-light motif geometry. Gameplay coordinates remain unchanged. */
export function createBattlefieldDecorations(
  motif: BattlefieldMotif,
  visibleHeight: number
): readonly ArenaDecoration[] {
  const top = 88;
  const bottom = Math.min(664, visibleHeight - 30);

  if (motif === 'twin_passes') {
    const decorations: ArenaDecoration[] = [
      { kind: 'line', x1: 46, y1: top, x2: 46, y2: bottom },
      { kind: 'line', x1: 154, y1: top, x2: 154, y2: bottom },
      { kind: 'line', x1: 246, y1: top, x2: 246, y2: bottom },
      { kind: 'line', x1: 354, y1: top, x2: 354, y2: bottom },
    ];
    for (let y = 116; y < bottom - 20; y += 92) {
      decorations.push(
        { kind: 'triangle', x1: 18, y1: y + 34, x2: 46, y2: y, x3: 72, y3: y + 34 },
        { kind: 'triangle', x1: 328, y1: y + 34, x2: 354, y2: y, x3: 382, y3: y + 34 }
      );
    }
    return decorations;
  }

  if (motif === 'royal_ring') {
    return [
      { kind: 'ellipse', x: 200, y: 360, width: 318, height: 430 },
      { kind: 'ellipse', x: 200, y: 360, width: 248, height: 334 },
      { kind: 'line', x1: 200, y1: 112, x2: 200, y2: 608 },
      { kind: 'line', x1: 45, y1: 360, x2: 355, y2: 360 },
      { kind: 'line', x1: 90, y1: 205, x2: 310, y2: 515 },
      { kind: 'line', x1: 310, y1: 205, x2: 90, y2: 515 },
    ];
  }

  return [
    { kind: 'line', x1: 200, y1: top, x2: 200, y2: bottom },
    { kind: 'line', x1: 18, y1: 360, x2: 382, y2: 360 },
    { kind: 'line', x1: 55, y1: 145, x2: 345, y2: 575 },
    { kind: 'line', x1: 345, y1: 145, x2: 55, y2: 575 },
    { kind: 'ellipse', x: 200, y: 360, width: 150, height: 150 },
  ];
}

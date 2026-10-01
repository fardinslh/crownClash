import type { BattlefieldMotif } from '@crown-clash/game-core';

/** Put the training instruction in the spare gap below the board on tall phones. */
export function trainingOverlayPanelY(visibleHeight: number): number {
  const bottomBarY = Math.max(691, visibleHeight - 28);
  // Reserve room for the retry button, which hangs 68px below the panel
  // center when a completion save fails. Short screens use the top overlay.
  return bottomBarY >= 815 ? 730 : Math.max(96, Math.min(126, visibleHeight * 0.16));
}

export type ArenaDecoration =
  | { readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'triangle'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x3: number; readonly y3: number }
  | { readonly kind: 'zone'; readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/**
 * Broad, non-interactive ground forms that give every battlefield a tangible
 * sense of place. They sit under roads and territory sockets, so they cannot
 * affect gameplay readability or touch targets. Colours deliberately live
 * here rather than in the simulation data: they are art direction only.
 */
export type ArenaTerrainLayer =
  | {
      readonly kind: 'roundedRect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly radius: number;
      readonly color: number;
      readonly alpha: number;
      readonly strokeColor?: number;
      readonly strokeAlpha?: number;
    }
  | {
      readonly kind: 'ellipse';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly color: number;
      readonly alpha: number;
      readonly strokeColor?: number;
      readonly strokeAlpha?: number;
    }
  | {
      readonly kind: 'triangle';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x3: number;
      readonly y3: number;
      readonly color: number;
      readonly alpha: number;
    };

/**
 * Hand-composed terrain plates for the fixed 400px tactical board. These are
 * deliberately large, quiet forms rather than a procedural texture: they
 * make the maps feel like miniature places at phone size while preserving the
 * hierarchy of roads, ownership rings, and unit badges above them.
 */
export function createBattlefieldTerrainLayers(
  motif: BattlefieldMotif,
  _visibleHeight: number
): readonly ArenaTerrainLayer[] {
  if (motif === 'twin_passes') {
    // Highland pasture shelves frame a cold ravine: dark tree-lines flank the
    // pass, a brook threads the middle, and rocky crags guard the corners.
    // The safe middle stays open for the pass's important vertical routes.
    return [
      { kind: 'roundedRect', x: 88, y: 376, width: 142, height: 558, radius: 42, color: 0x1e4432, alpha: 0.72, strokeColor: 0x4e8a62, strokeAlpha: 0.22 },
      { kind: 'roundedRect', x: 312, y: 376, width: 142, height: 558, radius: 42, color: 0x1e4432, alpha: 0.72, strokeColor: 0x4e8a62, strokeAlpha: 0.22 },
      { kind: 'roundedRect', x: 200, y: 376, width: 76, height: 506, radius: 32, color: 0x14352a, alpha: 0.86, strokeColor: 0x3e8056, strokeAlpha: 0.2 },
      { kind: 'ellipse', x: 200, y: 376, width: 44, height: 430, color: 0x2f92a3, alpha: 0.13, strokeColor: 0x79d7e4, strokeAlpha: 0.16 },
      { kind: 'triangle', x1: 18, y1: 190, x2: 78, y2: 112, x3: 138, y3: 190, color: 0x4c7057, alpha: 0.32 },
      { kind: 'triangle', x1: 262, y1: 190, x2: 322, y2: 112, x3: 382, y3: 190, color: 0x4c7057, alpha: 0.32 },
      { kind: 'triangle', x1: 18, y1: 624, x2: 78, y2: 546, x3: 138, y3: 624, color: 0x3e5c48, alpha: 0.28 },
      { kind: 'triangle', x1: 262, y1: 624, x2: 322, y2: 546, x3: 382, y3: 624, color: 0x3e5c48, alpha: 0.28 },
    ];
  }

  if (motif === 'royal_ring') {
    // A manicured palace lawn: nested hedged courts with gold trim make the
    // radial topology read as an intentional ceremonial garden arena.
    return [
      { kind: 'roundedRect', x: 200, y: 376, width: 356, height: 558, radius: 46, color: 0x235640, alpha: 0.8, strokeColor: 0xc9a961, strokeAlpha: 0.18 },
      { kind: 'ellipse', x: 200, y: 360, width: 274, height: 354, color: 0x31714e, alpha: 0.17, strokeColor: 0xe3c87a, strokeAlpha: 0.22 },
      { kind: 'ellipse', x: 200, y: 360, width: 186, height: 244, color: 0x1d4a34, alpha: 0.78, strokeColor: 0xa78bfa, strokeAlpha: 0.22 },
      { kind: 'roundedRect', x: 200, y: 376, width: 78, height: 492, radius: 28, color: 0x355f45, alpha: 0.42, strokeColor: 0xe7cc87, strokeAlpha: 0.12 },
      { kind: 'ellipse', x: 74, y: 192, width: 72, height: 110, color: 0x9e6d53, alpha: 0.12 },
      { kind: 'ellipse', x: 326, y: 552, width: 72, height: 110, color: 0x9e6d53, alpha: 0.12 },
    ];
  }

  if (motif === 'quad_citadel') {
    // Four trampled parade grounds meet at the contested central crossroads:
    // worn dirt camps cut into the olive meadow, brush-lined and sun-baked.
    return [
      { kind: 'roundedRect', x: 112, y: 224, width: 166, height: 188, radius: 34, color: 0x4c4232, alpha: 0.68, strokeColor: 0x8a744e, strokeAlpha: 0.18 },
      { kind: 'roundedRect', x: 288, y: 224, width: 166, height: 188, radius: 34, color: 0x4c4232, alpha: 0.68, strokeColor: 0x8a744e, strokeAlpha: 0.18 },
      { kind: 'roundedRect', x: 112, y: 500, width: 166, height: 188, radius: 34, color: 0x4c4232, alpha: 0.68, strokeColor: 0x8a744e, strokeAlpha: 0.18 },
      { kind: 'roundedRect', x: 288, y: 500, width: 166, height: 188, radius: 34, color: 0x4c4232, alpha: 0.68, strokeColor: 0x8a744e, strokeAlpha: 0.18 },
      { kind: 'ellipse', x: 200, y: 360, width: 178, height: 166, color: 0x2f5236, alpha: 0.34, strokeColor: 0x9ab07a, strokeAlpha: 0.19 },
      { kind: 'roundedRect', x: 200, y: 360, width: 86, height: 506, radius: 20, color: 0x33402a, alpha: 0.72 },
      { kind: 'triangle', x1: 22, y1: 334, x2: 74, y2: 360, x3: 22, y3: 386, color: 0x7f6250, alpha: 0.2 },
      { kind: 'triangle', x1: 378, y1: 334, x2: 326, y2: 360, x3: 378, y3: 386, color: 0x7f6250, alpha: 0.2 },
    ];
  }

  // Crown Cross: quiet royal meadow with one worn central green; bright
  // courts and wide gold lanes hid the buildings and were rejected in review.
  return [
    { kind: 'roundedRect', x: 200, y: 376, width: 356, height: 558, radius: 46, color: 0x224b33, alpha: 0.78, strokeColor: 0x6fa383, strokeAlpha: 0.12 },
    { kind: 'ellipse', x: 200, y: 360, width: 136, height: 136, color: 0x397550, alpha: 0.36, strokeColor: 0x8fb898, strokeAlpha: 0.15 },
  ];
}

/**
 * Static, allocation-light motif geometry. Gameplay coordinates remain
 * unchanged. Zones are large soft floor tints (plaza courts, pass corridors,
 * quadrant plates) that break up the empty arena floor; lines and triangles
 * remain the recognizable per-map silhouettes. Everything is drawn once into
 * a single static Graphics object below roads, sockets, and territories.
 */
export function createBattlefieldDecorations(
  motif: BattlefieldMotif,
  visibleHeight: number
): readonly ArenaDecoration[] {
  const top = 88;
  const bottom = Math.min(664, visibleHeight - 30);

  if (motif === 'twin_passes') {
    // Two fortified corridors (the passes) with a quiet meadow column
    // between them; cairn triangles mark the pass footholds.
    const decorations: ArenaDecoration[] = [
      { kind: 'zone', x: 100, y: 376, width: 104, height: 508 },
      { kind: 'zone', x: 300, y: 376, width: 104, height: 508 },
      { kind: 'zone', x: 200, y: 376, width: 86, height: 420 },
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
    // Concentric court tiles: layered ring fills read as a processional
    // courtyard, with radial spokes to the compass territories.
    return [
      { kind: 'zone', x: 200, y: 360, width: 318, height: 430 },
      { kind: 'zone', x: 200, y: 360, width: 246, height: 334 },
      { kind: 'zone', x: 200, y: 360, width: 168, height: 232 },
      { kind: 'line', x1: 200, y1: 112, x2: 200, y2: 608 },
      { kind: 'line', x1: 45, y1: 360, x2: 355, y2: 360 },
      { kind: 'line', x1: 90, y1: 205, x2: 310, y2: 515 },
      { kind: 'line', x1: 310, y1: 205, x2: 90, y2: 515 },
      { kind: 'ellipse', x: 200, y: 360, width: 150, height: 150 },
    ];
  }

  if (motif === 'quad_citadel') {
    // Four citadel quadrant courts meeting at the central keep apron; the
    // diagonals are the dueling boulevards of the 2v2 map.
    return [
      { kind: 'zone', x: 122, y: 238, width: 128, height: 150 },
      { kind: 'zone', x: 278, y: 238, width: 128, height: 150 },
      { kind: 'zone', x: 122, y: 482, width: 128, height: 150 },
      { kind: 'zone', x: 278, y: 482, width: 128, height: 150 },
      { kind: 'zone', x: 200, y: 360, width: 150, height: 120 },
      { kind: 'line', x1: 60, y1: 150, x2: 340, y2: 570 },
      { kind: 'line', x1: 340, y1: 150, x2: 60, y2: 570 },
      { kind: 'line', x1: 200, y1: top, x2: 200, y2: bottom },
      { kind: 'ellipse', x: 200, y: 360, width: 170, height: 150 },
    ];
  }

  // No decorative lines that can be mistaken for playable connections.
  return [{ kind: 'ellipse', x: 200, y: 360, width: 136, height: 136 }];
}

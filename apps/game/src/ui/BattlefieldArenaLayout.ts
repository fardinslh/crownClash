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
    // Weathered mountain shelves frame a cold ravine. The safe middle remains
    // open for the pass's important vertical routes and central props.
    return [
      { kind: 'roundedRect', x: 88, y: 376, width: 142, height: 558, radius: 42, color: 0x12333c, alpha: 0.72, strokeColor: 0x3b7f87, strokeAlpha: 0.22 },
      { kind: 'roundedRect', x: 312, y: 376, width: 142, height: 558, radius: 42, color: 0x12333c, alpha: 0.72, strokeColor: 0x3b7f87, strokeAlpha: 0.22 },
      { kind: 'roundedRect', x: 200, y: 376, width: 76, height: 506, radius: 32, color: 0x071d27, alpha: 0.86, strokeColor: 0x2e7781, strokeAlpha: 0.2 },
      { kind: 'ellipse', x: 200, y: 376, width: 44, height: 430, color: 0x2f92a3, alpha: 0.14, strokeColor: 0x79d7e4, strokeAlpha: 0.16 },
      { kind: 'triangle', x1: 18, y1: 190, x2: 78, y2: 112, x3: 138, y3: 190, color: 0x40606b, alpha: 0.32 },
      { kind: 'triangle', x1: 262, y1: 190, x2: 322, y2: 112, x3: 382, y3: 190, color: 0x40606b, alpha: 0.32 },
      { kind: 'triangle', x1: 18, y1: 624, x2: 78, y2: 546, x3: 138, y3: 624, color: 0x34535f, alpha: 0.28 },
      { kind: 'triangle', x1: 262, y1: 624, x2: 322, y2: 546, x3: 382, y3: 624, color: 0x34535f, alpha: 0.28 },
    ];
  }

  if (motif === 'royal_ring') {
    // A warm palace court with a deep royal carpet. Nested marble courts make
    // the radial topology read as an intentional ceremonial arena.
    return [
      { kind: 'roundedRect', x: 200, y: 376, width: 356, height: 558, radius: 46, color: 0x261b3d, alpha: 0.8, strokeColor: 0x8d70b8, strokeAlpha: 0.18 },
      { kind: 'ellipse', x: 200, y: 360, width: 274, height: 354, color: 0x60447b, alpha: 0.17, strokeColor: 0xd6b2eb, strokeAlpha: 0.22 },
      { kind: 'ellipse', x: 200, y: 360, width: 186, height: 244, color: 0x2d2149, alpha: 0.78, strokeColor: 0xa78bfa, strokeAlpha: 0.22 },
      { kind: 'roundedRect', x: 200, y: 376, width: 78, height: 492, radius: 28, color: 0x422b5f, alpha: 0.42, strokeColor: 0xe7cc87, strokeAlpha: 0.12 },
      { kind: 'ellipse', x: 74, y: 192, width: 72, height: 110, color: 0x9e6d53, alpha: 0.12 },
      { kind: 'ellipse', x: 326, y: 552, width: 72, height: 110, color: 0x9e6d53, alpha: 0.12 },
    ];
  }

  if (motif === 'quad_citadel') {
    // Four canvas-and-iron parade grounds meet at the contested central
    // crossroads. Their colour temperature is intentionally cooler than the
    // crown court and warmer than the mountain passes.
    return [
      { kind: 'roundedRect', x: 112, y: 224, width: 166, height: 188, radius: 34, color: 0x302852, alpha: 0.68, strokeColor: 0x716bb1, strokeAlpha: 0.18 },
      { kind: 'roundedRect', x: 288, y: 224, width: 166, height: 188, radius: 34, color: 0x302852, alpha: 0.68, strokeColor: 0x716bb1, strokeAlpha: 0.18 },
      { kind: 'roundedRect', x: 112, y: 500, width: 166, height: 188, radius: 34, color: 0x302852, alpha: 0.68, strokeColor: 0x716bb1, strokeAlpha: 0.18 },
      { kind: 'roundedRect', x: 288, y: 500, width: 166, height: 188, radius: 34, color: 0x302852, alpha: 0.68, strokeColor: 0x716bb1, strokeAlpha: 0.18 },
      { kind: 'ellipse', x: 200, y: 360, width: 178, height: 166, color: 0x29446f, alpha: 0.34, strokeColor: 0xa5b4fc, strokeAlpha: 0.19 },
      { kind: 'roundedRect', x: 200, y: 360, width: 86, height: 506, radius: 20, color: 0x1c2348, alpha: 0.72 },
      { kind: 'triangle', x1: 22, y1: 334, x2: 74, y2: 360, x3: 22, y3: 386, color: 0x7f6250, alpha: 0.2 },
      { kind: 'triangle', x1: 378, y1: 334, x2: 326, y2: 360, x3: 378, y3: 386, color: 0x7f6250, alpha: 0.2 },
    ];
  }

  // Crown Cross: a processional stone court, four warm garden courts, and a
  // gold-lit crown plaza at the contested centre.
  return [
    { kind: 'roundedRect', x: 200, y: 376, width: 356, height: 558, radius: 46, color: 0x162336, alpha: 0.78, strokeColor: 0x5b6f88, strokeAlpha: 0.16 },
    { kind: 'roundedRect', x: 200, y: 376, width: 70, height: 506, radius: 22, color: 0x26354b, alpha: 0.62, strokeColor: 0x8c9aab, strokeAlpha: 0.12 },
    { kind: 'roundedRect', x: 104, y: 225, width: 154, height: 160, radius: 30, color: 0x59402c, alpha: 0.38, strokeColor: 0xd49c45, strokeAlpha: 0.18 },
    { kind: 'roundedRect', x: 296, y: 225, width: 154, height: 160, radius: 30, color: 0x59402c, alpha: 0.38, strokeColor: 0xd49c45, strokeAlpha: 0.18 },
    { kind: 'roundedRect', x: 104, y: 505, width: 154, height: 160, radius: 30, color: 0x59402c, alpha: 0.38, strokeColor: 0xd49c45, strokeAlpha: 0.18 },
    { kind: 'roundedRect', x: 296, y: 505, width: 154, height: 160, radius: 30, color: 0x59402c, alpha: 0.38, strokeColor: 0xd49c45, strokeAlpha: 0.18 },
    { kind: 'ellipse', x: 200, y: 360, width: 176, height: 176, color: 0x8c5d12, alpha: 0.26, strokeColor: 0xf5b83b, strokeAlpha: 0.28 },
    { kind: 'ellipse', x: 200, y: 360, width: 112, height: 112, color: 0xeab84d, alpha: 0.08, strokeColor: 0xffdf85, strokeAlpha: 0.16 },
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

  // crown_cross: the royal crossroads — processional cross axes, corner
  // plaza courts, and a crown rondel at the heart of the field.
  return [
    { kind: 'zone', x: 105, y: 225, width: 130, height: 142 },
    { kind: 'zone', x: 295, y: 225, width: 130, height: 142 },
    { kind: 'zone', x: 105, y: 505, width: 130, height: 142 },
    { kind: 'zone', x: 295, y: 505, width: 130, height: 142 },
    { kind: 'line', x1: 200, y1: top, x2: 200, y2: bottom },
    { kind: 'line', x1: 18, y1: 360, x2: 382, y2: 360 },
    { kind: 'line', x1: 55, y1: 145, x2: 345, y2: 575 },
    { kind: 'line', x1: 345, y1: 145, x2: 55, y2: 575 },
    { kind: 'ellipse', x: 200, y: 360, width: 150, height: 150 },
  ];
}

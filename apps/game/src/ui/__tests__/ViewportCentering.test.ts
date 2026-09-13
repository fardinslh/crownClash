import { describe, expect, it } from 'vitest';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';

interface CenteredViewportSimulation {
  parentWidth: number;
  parentHeight: number;
  renderScale: number;
  canvasWidth: number;
  canvasHeight: number;
  styleWidth: number;
  styleHeight: number;
  visibleWidth: number;
  visibleHeight: number;
  scrollX: number;
  scrollY: number;
  screenLeftWorldX: number;
  screenRightWorldX: number;
  screenCenterWorldX: number;
  /** Translates a screen coordinate (0 to styleWidth) into world space */
  screenToWorld: (screenX: number, screenY: number) => { worldX: number; worldY: number };
  /** Translates a world coordinate into screen space (0 to styleWidth) */
  worldToScreen: (worldX: number, worldY: number) => { screenX: number; screenY: number };
}

/**
 * Simulates Phaser.Scale.EXPAND combined with camera centering on (LOGICAL_WIDTH / 2, visibleHeight / 2)
 * as implemented in Viewport.ts.
 */
function simulateCenteredViewport(
  parentWidth: number,
  parentHeight: number,
  renderScale: number,
  cameraCenterX: number = LOGICAL_WIDTH / 2
): CenteredViewportSimulation {
  const baseWidth = LOGICAL_WIDTH * renderScale;
  const baseHeight = LOGICAL_HEIGHT * renderScale;

  const scaleX = parentWidth / baseWidth;
  const scaleY = parentHeight / baseHeight;

  let canvasWidth: number;
  let canvasHeight: number;

  if (scaleX < scaleY) {
    // Screen is taller than 400:720 -> expand vertically
    canvasWidth = baseWidth;
    canvasHeight = scaleX !== 0 ? parentHeight / scaleX : baseHeight;
  } else {
    // Screen is wider than 400:720 -> expand horizontally (e.g. Samsung J5, 16:9, tablets)
    canvasWidth = scaleY !== 0 ? parentWidth / scaleY : baseWidth;
    canvasHeight = baseHeight;
  }

  const styleWidth = parentWidth;
  const styleHeight = parentHeight;

  const visibleWidth = Math.max(LOGICAL_WIDTH, Math.round(canvasWidth / renderScale));
  const visibleHeight = Math.max(LOGICAL_HEIGHT, Math.round(canvasHeight / renderScale));

  // Camera centered on cameraCenterX:
  // camera.scrollX = cameraCenterX - (canvasWidth / (2 * zoom)) = cameraCenterX - visibleWidth / 2
  const scrollX = Math.round(cameraCenterX - visibleWidth / 2);
  const scrollY = 0;

  const screenToWorld = (screenX: number, screenY: number) => {
    // Phaser camera.getWorldPoint(screenX, screenY):
    // worldX = (screenX - styleWidth / 2) / (scale * zoom) + cameraCenterX
    // Since styleWidth / canvasWidth == parentWidth / canvasWidth == scale,
    // (screenX / styleWidth) * visibleWidth + scrollX
    const normalizedX = screenX / styleWidth;
    const normalizedY = screenY / styleHeight;
    return {
      worldX: scrollX + normalizedX * visibleWidth,
      worldY: scrollY + normalizedY * visibleHeight,
    };
  };

  const worldToScreen = (worldX: number, worldY: number) => {
    const normalizedX = (worldX - scrollX) / visibleWidth;
    const normalizedY = (worldY - scrollY) / visibleHeight;
    return {
      screenX: normalizedX * styleWidth,
      screenY: normalizedY * styleHeight,
    };
  };

  return {
    parentWidth,
    parentHeight,
    renderScale,
    canvasWidth,
    canvasHeight,
    styleWidth,
    styleHeight,
    visibleWidth,
    visibleHeight,
    scrollX,
    scrollY,
    screenLeftWorldX: scrollX,
    screenRightWorldX: scrollX + visibleWidth,
    screenCenterWorldX: scrollX + visibleWidth / 2,
    screenToWorld,
    worldToScreen,
  };
}

describe('ViewportCentering - Low-End Bale Canvas & Tall Phones', () => {
  describe('Samsung Galaxy J5 (SM-J530F, 16:9 / 720x1280 physical, Canvas 1x fallback)', () => {
    it('centers arena and keeps towers horizontally symmetric before Bale expand (360x556)', () => {
      const vp = simulateCenteredViewport(360, 556, 1);

      // On 360x556, aspect ratio is 556/360 = 1.544 < 1.8.
      // Visible width must expand horizontally beyond 400.
      expect(vp.visibleWidth).toBeGreaterThan(LOGICAL_WIDTH);
      expect(vp.visibleWidth).toBe(466);
      expect(vp.scrollX).toBe(-33);

      // The physical center of the screen (x = 180) must map to LOGICAL_WIDTH / 2 (200)
      const centerWorld = vp.screenToWorld(180, 278);
      expect(centerWorld.worldX).toBe(200);

      // Left tower (x = 85) and right tower (x = 315) are authored symmetrically around x = 200
      const leftTowerScreen = vp.worldToScreen(85, 400);
      const rightTowerScreen = vp.worldToScreen(315, 400);

      const distanceToLeftEdge = leftTowerScreen.screenX;
      const distanceToRightEdge = vp.styleWidth - rightTowerScreen.screenX;

      // Both towers must be at the exact same distance from screen edges
      expect(Math.abs(distanceToLeftEdge - distanceToRightEdge)).toBeLessThan(0.1);
    });

    it('centers arena and keeps towers horizontally symmetric after Bale expand (360x640)', () => {
      const vp = simulateCenteredViewport(360, 640, 1);

      // On 360x640 (standard 16:9), 640/360 = 1.778 < 1.8.
      expect(vp.visibleWidth).toBeGreaterThan(LOGICAL_WIDTH);
      expect(vp.visibleWidth).toBe(405);
      expect(vp.scrollX).toBe(-2);

      // Physical center of screen must map to LOGICAL_WIDTH / 2 (200 within half-pixel rounding)
      const centerWorld = vp.screenToWorld(180, 320);
      expect(Math.abs(centerWorld.worldX - 200)).toBeLessThanOrEqual(0.5);

      // Towers must be symmetric from screen edges
      const leftTowerScreen = vp.worldToScreen(85, 400);
      const rightTowerScreen = vp.worldToScreen(315, 400);
      const distanceToLeftEdge = leftTowerScreen.screenX;
      const distanceToRightEdge = vp.styleWidth - rightTowerScreen.screenX;
      // Both towers must be symmetric within 1 pixel (due to integer rounding of odd width 405)
      expect(Math.abs(distanceToLeftEdge - distanceToRightEdge)).toBeLessThan(1.0);
    });

    it('accurately round-trips screen-to-world pointer coordinates across entire canvas', () => {
      const vp = simulateCenteredViewport(360, 556, 1);

      const testCoords = [
        { screenX: 0, screenY: 0 },
        { screenX: 180, screenY: 278 },
        { screenX: 360, screenY: 556 },
        { screenX: 91.2, screenY: 400 },
        { screenX: 268.8, screenY: 400 },
      ];

      for (const coord of testCoords) {
        const world = vp.screenToWorld(coord.screenX, coord.screenY);
        const roundTrip = vp.worldToScreen(world.worldX, world.worldY);
        expect(roundTrip.screenX).toBeCloseTo(coord.screenX, 4);
        expect(roundTrip.screenY).toBeCloseTo(coord.screenY, 4);
      }
    });
  });

  describe('Tall Mobile Phones (Aspect Ratio >= 1.8: Poco, iPhone, Pixel)', () => {
    const TALL_DEVICES = [
      { name: '360x800 (Small Android)', width: 360, height: 800 },
      { name: '390x844 (iPhone 12/13/14)', width: 390, height: 844 },
      { name: '412x915 (Galaxy S21)', width: 412, height: 915 },
      { name: '430x932 (iPhone 14/15/16 Pro Max)', width: 430, height: 932 },
    ];

    TALL_DEVICES.forEach((device) => {
      it(`maintains scrollX = 0 and centers camera on LOGICAL_WIDTH / 2 for ${device.name}`, () => {
        const vp = simulateCenteredViewport(device.width, device.height, 1);

        // On tall phones, visibleWidth is clamped to LOGICAL_WIDTH (400)
        expect(vp.visibleWidth).toBe(LOGICAL_WIDTH);
        // scrollX is (400 - 400) / 2 = 0
        expect(vp.scrollX).toBe(0);

        // Physical center maps to LOGICAL_WIDTH / 2 (200)
        const centerWorld = vp.screenToWorld(device.width / 2, device.height / 2);
        expect(centerWorld.worldX).toBe(200);

        // Towers are symmetric
        const leftTowerScreen = vp.worldToScreen(85, 400);
        const rightTowerScreen = vp.worldToScreen(315, 400);
        const distanceToLeftEdge = leftTowerScreen.screenX;
        const distanceToRightEdge = vp.styleWidth - rightTowerScreen.screenX;
        expect(Math.abs(distanceToLeftEdge - distanceToRightEdge)).toBeLessThan(0.1);
      });
    });
  });

  describe('Negative Control - Catch Asymmetry if Centered on visibleWidth / 2', () => {
    it('fails horizontal symmetry when camera is centered on visibleWidth / 2 instead of LOGICAL_WIDTH / 2', () => {
      // Simulate buggy behavior where camera was centered on visibleWidth / 2 (233)
      const buggyVp = simulateCenteredViewport(360, 556, 1, 466 / 2);

      // On buggy viewport, scrollX = 0
      expect(buggyVp.scrollX).toBe(0);

      // Screen center maps to 233, not 200
      const centerWorld = buggyVp.screenToWorld(180, 278);
      expect(centerWorld.worldX).toBe(233);

      // Distance from left screen edge to left tower (world 85)
      const leftTowerScreen = buggyVp.worldToScreen(85, 400);
      const rightTowerScreen = buggyVp.worldToScreen(315, 400);
      const distanceToLeftEdge = leftTowerScreen.screenX;
      const distanceToRightEdge = buggyVp.styleWidth - rightTowerScreen.screenX;

      // Under buggy behavior, there is a ~51px asymmetry on screen (corresponding to 66px in world)
      const asymmetry = Math.abs(distanceToLeftEdge - distanceToRightEdge);
      expect(asymmetry).toBeGreaterThan(50);
    });
  });
});

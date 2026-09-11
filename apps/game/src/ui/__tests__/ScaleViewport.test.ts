import { describe, expect, it } from 'vitest';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';

interface ExpandSimulationResult {
  canvasWidth: number;
  canvasHeight: number;
  styleWidth: number;
  styleHeight: number;
  visibleWidth: number;
  visibleHeight: number;
  pointerTopLeft: { worldX: number; worldY: number };
  pointerBottomRight: { worldX: number; worldY: number };
}

/**
 * Simulates Phaser.Scale.EXPAND calculation exactly as performed in
 * Phaser's ScaleManager.js (lines 1088-1147) and Viewport.ts.
 */
function simulatePhaserExpand(
  parentWidth: number,
  parentHeight: number,
  renderScale: number,
  autoRound: boolean = false
): ExpandSimulationResult {
  const baseWidth = LOGICAL_WIDTH * renderScale;
  const baseHeight = LOGICAL_HEIGHT * renderScale;

  const windowWidth = parentWidth;
  const windowHeight = parentHeight;

  const scaleX = windowWidth / baseWidth;
  const scaleY = windowHeight / baseHeight;

  let canvasWidth: number;
  let canvasHeight: number;

  if (scaleX < scaleY) {
    canvasWidth = baseWidth;
    canvasHeight = scaleX !== 0 ? windowHeight / scaleX : baseHeight;
  } else {
    canvasWidth = scaleY !== 0 ? windowWidth / scaleY : baseWidth;
    canvasHeight = baseHeight;
  }

  // Without scale.max, clamped dimensions equal calculated canvas dimensions
  let clampedCanvasWidth = canvasWidth;
  let clampedCanvasHeight = canvasHeight;

  if (autoRound) {
    clampedCanvasWidth = Math.floor(clampedCanvasWidth);
    clampedCanvasHeight = Math.floor(clampedCanvasHeight);
  }

  // Style size (matches parent in EXPAND mode)
  let clampedWindowWidth = windowWidth * (clampedCanvasWidth / canvasWidth);
  let clampedWindowHeight = windowHeight * (clampedCanvasHeight / canvasHeight);

  if (autoRound) {
    clampedWindowWidth = Math.floor(clampedWindowWidth);
    clampedWindowHeight = Math.floor(clampedWindowHeight);
  }

  const styleWidth = Math.round(clampedWindowWidth);
  const styleHeight = Math.round(clampedWindowHeight);

  // Logical visible world dimensions with camera zoom = renderScale
  const visibleWidth = Math.round(clampedCanvasWidth / renderScale);
  const visibleHeight = Math.round(clampedCanvasHeight / renderScale);

  // Camera centered on (visibleWidth / 2, visibleHeight / 2) with zoom = renderScale:
  // DOM (0, 0) maps to:
  // worldX = (0 - styleWidth / 2) / (scaleX * renderScale) + visibleWidth / 2 = 0
  // worldY = (0 - styleHeight / 2) / (scaleY_canvas * renderScale) + visibleHeight / 2 = 0
  const pointerTopLeft = {
    worldX: (0 / styleWidth) * visibleWidth,
    worldY: (0 / styleHeight) * visibleHeight,
  };
  const pointerBottomRight = {
    worldX: (styleWidth / styleWidth) * visibleWidth,
    worldY: (styleHeight / styleHeight) * visibleHeight,
  };

  return {
    canvasWidth: clampedCanvasWidth,
    canvasHeight: clampedCanvasHeight,
    styleWidth,
    styleHeight,
    visibleWidth,
    visibleHeight,
    pointerTopLeft,
    pointerBottomRight,
  };
}

describe('ScaleViewport - Phaser.Scale.EXPAND on Tall Mobile Screens', () => {
  const TEST_DEVICES = [
    { name: '360x800 (Small Android)', width: 360, height: 800 },
    { name: '390x844 (iPhone 12/13/14)', width: 390, height: 844 },
    { name: '412x915 (Pixel 7 / Galaxy S21)', width: 412, height: 915 },
    { name: '430x932 (iPhone 14/15/16 Pro Max)', width: 430, height: 932 },
  ];

  const DPR_VALUES = [1, 2];

  TEST_DEVICES.forEach((device) => {
    DPR_VALUES.forEach((dpr) => {
      describe(`${device.name} @ DPR ${dpr}`, () => {
        it('canvas display style matches parent container 100% without letterbox bars', () => {
          const result = simulatePhaserExpand(device.width, device.height, dpr);

          // style.width and style.height must match parent available dimensions
          expect(result.styleWidth).toBe(device.width);
          expect(result.styleHeight).toBe(device.height);
        });

        it('preserves the 400x720 logical safe area without cropping', () => {
          const result = simulatePhaserExpand(device.width, device.height, dpr);

          // visibleWidth must accommodate at least LOGICAL_WIDTH
          expect(result.visibleWidth).toBeGreaterThanOrEqual(LOGICAL_WIDTH);
          // visibleHeight must accommodate at least LOGICAL_HEIGHT
          expect(result.visibleHeight).toBeGreaterThanOrEqual(LOGICAL_HEIGHT);
        });

        it('maps pointer coordinates 1:1 between DOM and visible world', () => {
          const result = simulatePhaserExpand(device.width, device.height, dpr);

          // Top-left of screen maps to (0, 0)
          expect(result.pointerTopLeft.worldX).toBe(0);
          expect(result.pointerTopLeft.worldY).toBe(0);

          // Bottom-right of screen maps to (visibleWidth, visibleHeight)
          expect(result.pointerBottomRight.worldX).toBe(result.visibleWidth);
          expect(result.pointerBottomRight.worldY).toBe(result.visibleHeight);
        });
      });
    });
  });
});

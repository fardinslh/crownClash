import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';

export interface SceneViewport {
  visibleWidth: number;
  visibleHeight: number;
  renderScale: number;
  scrollX: number;
  scrollY: number;
  left: number;
  right: number;
  centerX: number;
  centerY: number;
  safeArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Calculates current visible game dimensions in logical coordinates.
 * In Phaser.Scale.EXPAND mode, the game expands beyond the base LOGICAL_WIDTH x LOGICAL_HEIGHT
 * to match the parent aspect ratio without letterboxing.
 */
export function getSceneViewport(scene: Phaser.Scene): SceneViewport {
  const renderScale = (scene.registry.get('renderScale') as number) || 1;
  const gameSize = scene.scale.gameSize;
  const visibleWidth = Math.max(LOGICAL_WIDTH, Math.round(gameSize.width / renderScale));
  const visibleHeight = Math.max(LOGICAL_HEIGHT, Math.round(gameSize.height / renderScale));

  const scrollX = Math.round((LOGICAL_WIDTH - visibleWidth) / 2);
  const scrollY = 0;

  return {
    visibleWidth,
    visibleHeight,
    renderScale,
    scrollX,
    scrollY,
    left: scrollX,
    right: scrollX + visibleWidth,
    centerX: LOGICAL_WIDTH / 2,
    centerY: visibleHeight / 2,
    safeArea: {
      x: 0,
      y: 0,
      width: LOGICAL_WIDTH,
      height: visibleHeight,
    },
  };
}

/**
 * Standardizes camera zoom and centering for a scene in EXPAND mode.
 * Centering horizontally on LOGICAL_WIDTH / 2 guarantees that scenes and game
 * boards designed for 400 logical width remain strictly centered on wider screens
 * (e.g. Samsung Galaxy J5, 16:9, or tablets) without shifting left or distorting.
 * On tall phones (aspect ratio >= 1.8), visibleWidth equals LOGICAL_WIDTH, so scrollX is 0.
 */
export function setupSceneCamera(scene: Phaser.Scene): SceneViewport {
  const vp = getSceneViewport(scene);
  scene.cameras.main.setZoom(vp.renderScale);
  scene.cameras.main.centerOn(LOGICAL_WIDTH / 2, vp.visibleHeight / 2);
  return vp;
}

/**
 * Attaches a resize handler to keep the camera centered when orientation or viewport changes.
 * Also hooks platform-level viewportChanged events (e.g. from Bale expand()) to refresh scale.
 */
export function bindSceneViewportResize(
  scene: Phaser.Scene,
  onResize?: (vp: SceneViewport) => void
): () => void {
  const handler = () => {
    const vp = setupSceneCamera(scene);
    onResize?.(vp);
  };

  scene.scale.on('resize', handler);

  const platform = scene.registry.get('platform') as PlatformAdapter | undefined;
  let unbindPlatform: (() => void) | undefined;
  if (platform?.on) {
    unbindPlatform = platform.on('viewportChanged', () => {
      scene.scale.refresh();
      handler();
    });
  }

  const cleanup = () => {
    scene.scale.off('resize', handler);
    unbindPlatform?.();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  return cleanup;
}

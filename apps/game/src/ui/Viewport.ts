import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@crown-clash/game-core';

export interface SceneViewport {
  visibleWidth: number;
  visibleHeight: number;
  renderScale: number;
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

  return {
    visibleWidth,
    visibleHeight,
    renderScale,
    safeArea: {
      x: 0,
      y: 0,
      width: LOGICAL_WIDTH,
      height: LOGICAL_HEIGHT,
    },
  };
}

/**
 * Standardizes camera zoom and centering for a scene in EXPAND mode.
 * Centering on (visibleWidth / 2, visibleHeight / 2) guarantees that (0, 0) in world coordinates
 * is strictly aligned with the top-left of the viewport, (visibleWidth, visibleHeight) is aligned
 * with the bottom-right, and input pointer coordinates map 1:1 onto game world coordinates.
 */
export function setupSceneCamera(scene: Phaser.Scene): SceneViewport {
  const vp = getSceneViewport(scene);
  scene.cameras.main.setZoom(vp.renderScale);
  scene.cameras.main.centerOn(vp.visibleWidth / 2, vp.visibleHeight / 2);
  return vp;
}

/**
 * Attaches a resize handler to keep the camera centered when orientation or viewport changes.
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
  const cleanup = () => {
    scene.scale.off('resize', handler);
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  return cleanup;
}

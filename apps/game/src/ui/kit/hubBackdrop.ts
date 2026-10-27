import Phaser from 'phaser';
import { LOGICAL_WIDTH } from '@crown-clash/game-core';
import { getSceneViewport } from '../Viewport.js';
import { computeBackdropTiles } from '../HubLayouts.js';
import { UI } from '../../theme.js';

/**
 * Hub screens used to sit on a flat near-black rectangle while the battlefield
 * is a bright Blender meadow, so moving between them felt like two games.
 * The backdrop is one clean meadow band from the Blender ground plate,
 * mirrored vertically to fill any screen height, dimmed so panels stay
 * readable. It loads after the first paint (the flat colour is the fallback).
 */
export const HUB_BACKDROP_KEY = 'hub_meadow';
export const HUB_BACKDROP_PATH = 'assets/hub/hub_meadow.webp';
export const HUB_BACKDROP_VERSION = 'hub-meadow-v1';
/** How much of the meadow the dark navy veil covers (higher = darker). */
const VEIL_ALPHA = 0.74;

export interface HubBackdrop {
  /** Re-fits the tiles after a viewport change. */
  layout(): void;
  destroy(): void;
}

/**
 * Adds the meadow behind everything else in the scene. Safe in bare test
 * scenes: every Phaser API it needs is feature-checked.
 */
export function createHubBackdrop(scene: Phaser.Scene, options: { reducedMotion?: boolean } = {}): HubBackdrop {
  let tiles: Phaser.GameObjects.Image[] = [];
  let veil: Phaser.GameObjects.Rectangle | undefined;
  let destroyed = false;

  const canLoad =
    typeof scene.load?.image === 'function' &&
    typeof scene.load?.once === 'function' &&
    typeof scene.load?.start === 'function' &&
    typeof scene.textures?.exists === 'function' &&
    typeof scene.add?.image === 'function' &&
    typeof scene.add?.rectangle === 'function';

  const clear = (): void => {
    for (const tile of tiles) tile.destroy();
    tiles = [];
    veil?.destroy();
    veil = undefined;
  };

  const layout = (): void => {
    if (destroyed || !scene.textures.exists(HUB_BACKDROP_KEY)) return;
    clear();
    const { visibleWidth, visibleHeight } = getSceneViewport(scene);
    const cx = LOGICAL_WIDTH / 2;
    const left = cx - visibleWidth / 2;
    tiles = computeBackdropTiles(visibleWidth, visibleHeight).map((tile) =>
      scene.add
        .image(left, tile.y, HUB_BACKDROP_KEY)
        .setOrigin(0, 0)
        // 1px overlap hides the sub-pixel seam between mirrored tiles.
        .setDisplaySize(tile.width, tile.height + 1)
        .setFlipY(tile.flipY)
        .setDepth(-20),
    );
    veil = scene.add.rectangle(cx, visibleHeight / 2, visibleWidth, visibleHeight, UI.bg, VEIL_ALPHA).setDepth(-19);
    if (!options.reducedMotion && typeof scene.tweens?.add === 'function') {
      const group = [...tiles, veil];
      for (const item of group) item.setAlpha(0);
      tiles.forEach((tile) => scene.tweens.add({ targets: tile, alpha: 1, duration: 220, ease: 'Sine.easeOut' }));
      scene.tweens.add({ targets: veil, alpha: VEIL_ALPHA, duration: 220, ease: 'Sine.easeOut' });
    }
  };

  const onResize = (): void => layout();

  if (canLoad) {
    if (scene.textures.exists(HUB_BACKDROP_KEY)) {
      layout();
    } else {
      scene.load.once(`filecomplete-image-${HUB_BACKDROP_KEY}`, layout);
      scene.load.image(HUB_BACKDROP_KEY, `${HUB_BACKDROP_PATH}?v=${HUB_BACKDROP_VERSION}`);
      // A failed or slow request leaves the flat colour; never blocks the scene.
      if (!scene.load.isLoading?.()) scene.load.start();
    }
    scene.scale?.on?.('resize', onResize);
  }

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    scene.scale?.off?.('resize', onResize);
    scene.load?.off?.(`filecomplete-image-${HUB_BACKDROP_KEY}`, layout);
    clear();
  };
  scene.events?.once?.(Phaser.Scenes.Events.SHUTDOWN, destroy);

  return { layout, destroy };
}

export interface HubTexture {
  readonly key: string;
  readonly path: string;
}

/**
 * Loads hub art after first paint and calls `onReady` once every texture is
 * available (immediately when cached). A failed load never calls back, so
 * callers keep their vector fallback. `isAlive` guards a scene that shut
 * down while the request was in flight.
 */
export function loadHubTextures(
  scene: Phaser.Scene,
  textures: readonly HubTexture[],
  onReady: () => void,
  isAlive: () => boolean = () => true,
): void {
  if (
    typeof scene.load?.image !== 'function' ||
    typeof scene.load?.once !== 'function' ||
    typeof scene.load?.start !== 'function' ||
    typeof scene.textures?.exists !== 'function'
  ) {
    return;
  }
  const missing = textures.filter((t) => !scene.textures.exists(t.key));
  if (missing.length === 0) {
    onReady();
    return;
  }
  let pending = missing.length;
  for (const texture of missing) {
    scene.load.once(`filecomplete-image-${texture.key}`, () => {
      pending--;
      if (pending === 0 && isAlive() && textures.every((t) => scene.textures.exists(t.key))) onReady();
    });
    scene.load.image(texture.key, texture.path);
  }
  if (!scene.load.isLoading?.()) scene.load.start();
}

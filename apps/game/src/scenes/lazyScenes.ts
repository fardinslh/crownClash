import type Phaser from 'phaser';

/**
 * Hub scenes that are not needed for the first playable screen. Their code
 * ships as separate chunks and is registered with Phaser on first use, so the
 * initial bundle only carries the menu and the battle.
 */
const LOADERS: Readonly<Record<string, () => Promise<Phaser.Types.Scenes.SceneType>>> = {
  RealmScene: () => import('./RealmScene.js').then((m) => m.RealmScene),
  KingdomScene: () => import('./KingdomScene.js').then((m) => m.KingdomScene),
  DailyScene: () => import('./DailyScene.js').then((m) => m.DailyScene),
  LevelsScene: () => import('./LevelsScene.js').then((m) => m.LevelsScene),
  WeeklyScene: () => import('./WeeklyScene.js').then((m) => m.WeeklyScene),
  LeagueScene: () => import('./LeagueScene.js').then((m) => m.LeagueScene),
  CommanderScene: () => import('./CommanderScene.js').then((m) => m.CommanderScene),
};

const pending = new Map<string, Promise<void>>();

const isReady = (manager: Phaser.Scenes.SceneManager, key: string): boolean =>
  !(key in LOADERS) || !!manager.getScene(key);

/** Registers a lazy scene once; concurrent callers share one load. */
export function ensureSceneRegistered(manager: Phaser.Scenes.SceneManager, key: string): Promise<void> {
  if (isReady(manager, key)) return Promise.resolve();
  let load = pending.get(key);
  if (!load) {
    load = LOADERS[key]()
      .then((sceneClass) => {
        if (!manager.getScene(key)) manager.add(key, sceneClass, false);
      })
      .finally(() => pending.delete(key));
    pending.set(key, load);
  }
  return load;
}

/**
 * Starts `key`. Eager scenes and already-loaded lazy scenes start
 * synchronously; otherwise the chunk is fetched first. `onFail` runs if the
 * chunk cannot be loaded (offline, stale deploy) so the caller can unlock.
 */
export function startScene(scene: Phaser.Scene, key: string, data?: object, onFail?: () => void): void {
  const manager = scene.scene.manager;
  const start = (): void => {
    if (data === undefined) scene.scene.start(key);
    else scene.scene.start(key, data);
  };
  if (!manager || isReady(manager, key)) {
    start();
    return;
  }
  ensureSceneRegistered(manager, key).then(start, (error: unknown) => {
    console.warn(`[lazyScenes] Could not load ${key}:`, error);
    scene.cameras?.main?.fadeIn?.(170, 7, 11, 20);
    onFail?.();
  });
}

/** Warms the hub chunks while the player sits on the menu (after first paint). */
export function prefetchLazyScenes(manager: Phaser.Scenes.SceneManager): void {
  const run = (): void => {
    for (const key of Object.keys(LOADERS)) void ensureSceneRegistered(manager, key).catch(() => {});
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

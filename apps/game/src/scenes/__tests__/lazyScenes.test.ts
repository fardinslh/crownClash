import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loads } = vi.hoisted(() => ({ loads: { failKingdom: false } }));

vi.mock('../KingdomScene.js', () => {
  if (loads.failKingdom) throw new Error('chunk failed');
  return { KingdomScene: class KingdomScene {} };
});
vi.mock('../RealmScene.js', () => ({ RealmScene: class RealmScene {} }));
vi.mock('../DailyScene.js', () => ({ DailyScene: class DailyScene {} }));
vi.mock('../LeagueScene.js', () => ({ LeagueScene: class LeagueScene {} }));
vi.mock('../CommanderScene.js', () => ({ CommanderScene: class CommanderScene {} }));

import { ensureSceneRegistered, startScene } from '../lazyScenes.js';

function fakeManager() {
  const scenes = new Map<string, unknown>([['MenuScene', {}]]);
  return {
    scenes,
    getScene: vi.fn((key: string) => scenes.get(key) ?? null),
    add: vi.fn((key: string, cls: unknown) => scenes.set(key, cls)),
  };
}

function fakeScene(manager: ReturnType<typeof fakeManager> | undefined) {
  const start = vi.fn();
  const fadeIn = vi.fn();
  return {
    start,
    fadeIn,
    scene: { manager, start } as never,
    cameras: { main: { fadeIn } },
  };
}

describe('lazyScenes', () => {
  beforeEach(() => {
    loads.failKingdom = false;
  });

  it('registers a lazy scene once even with concurrent callers', async () => {
    const manager = fakeManager();
    await Promise.all([
      ensureSceneRegistered(manager as never, 'DailyScene'),
      ensureSceneRegistered(manager as never, 'DailyScene'),
    ]);
    expect(manager.add).toHaveBeenCalledTimes(1);
    expect(manager.add).toHaveBeenCalledWith('DailyScene', expect.any(Function), false);
    await ensureSceneRegistered(manager as never, 'DailyScene');
    expect(manager.add).toHaveBeenCalledTimes(1);
  });

  it('ignores eager scenes', async () => {
    const manager = fakeManager();
    await ensureSceneRegistered(manager as never, 'MenuScene');
    expect(manager.add).not.toHaveBeenCalled();
  });

  it('starts eager and already-registered scenes synchronously', () => {
    const manager = fakeManager();
    const s = fakeScene(manager);
    startScene(s as never, 'MenuScene');
    expect(s.start).toHaveBeenCalledWith('MenuScene');

    manager.scenes.set('LeagueScene', {});
    startScene(s as never, 'LeagueScene', { a: 1 });
    expect(s.start).toHaveBeenCalledWith('LeagueScene', { a: 1 });
  });

  it('starts without a manager (headless/test scenes)', () => {
    const s = fakeScene(undefined);
    startScene(s as never, 'KingdomScene');
    expect(s.start).toHaveBeenCalledWith('KingdomScene');
  });

  it('loads the chunk before starting an unregistered lazy scene', async () => {
    const manager = fakeManager();
    const s = fakeScene(manager);
    startScene(s as never, 'CommanderScene');
    expect(s.start).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(s.start).toHaveBeenCalledWith('CommanderScene'));
    expect(manager.add).toHaveBeenCalledWith('CommanderScene', expect.any(Function), false);
  });

  it('calls onFail and fades back in when the chunk cannot load', async () => {
    loads.failKingdom = true;
    vi.resetModules();
    const { startScene: freshStart } = await import('../lazyScenes.js');
    const manager = fakeManager();
    const s = fakeScene(manager);
    const onFail = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    freshStart(s as never, 'KingdomScene', undefined, onFail);
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(s.start).not.toHaveBeenCalled();
    expect(s.fadeIn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

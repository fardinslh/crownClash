import { describe, expect, it, vi } from 'vitest';
import { ArmyVisualPool } from '../ArmyVisualPool.js';
import type { MarchingArmy } from '@crown-clash/game-core';

function createMockScene(): any {
  const objects: any[] = [];
  const mockScene = {
    add: {
      container: vi.fn((x: number, y: number) => {
        const c: any = {
          x,
          y,
          visible: false,
          depth: 0,
          scale: 1,
          alpha: 1,
          children: [],
          inDisplayList: true,
          removeFromDisplayList: vi.fn(() => { c.inDisplayList = false; return c; }),
          addToDisplayList: vi.fn(() => { c.inDisplayList = true; return c; }),
          setPosition(nx: number, ny: number) { c.x = nx; c.y = ny; return c; },
          setVisible(v: boolean) { c.visible = v; return c; },
          setDepth(d: number) { c.depth = d; return c; },
          setScale(s: number) { c.scale = s; return c; },
          setAlpha(a: number) { c.alpha = a; return c; },
          add(ch: any) {
            if (Array.isArray(ch)) c.children.push(...ch);
            else c.children.push(ch);
            return c;
          },
          destroy: vi.fn(),
        };
        objects.push(c);
        return c;
      }),
      image: vi.fn((x: number, y: number, key: string) => {
        const img: any = {
          x,
          y,
          texture: { key },
          visible: true,
          scale: 1,
          flipX: false,
          alpha: 1,
          setPosition(nx: number, ny: number) { img.x = nx; img.y = ny; return img; },
          setVisible(v: boolean) { img.visible = v; return img; },
          setScale(s: number) { img.scale = s; return img; },
          setDisplaySize(w: number, h: number) { img.displayWidth = w; img.displayHeight = h; return img; },
          setAlpha(a: number) { img.alpha = a; return img; },
          setFlipX(f: boolean) { img.flipX = f; return img; },
          setTexture(k: string) { img.texture.key = k; return img; },
          destroy: vi.fn(),
        };
        objects.push(img);
        return img;
      }),
      circle: vi.fn((x: number, y: number, r: number, fill: number, alpha: number) => {
        const circ: any = {
          x, y, r, fill, alpha,
          visible: true,
          setFillStyle: vi.fn().mockReturnThis(),
          setStrokeStyle: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        };
        objects.push(circ);
        return circ;
      }),
      rectangle: vi.fn((x: number, y: number, w: number, h: number) => {
        const rect: any = {
          x, y, w, h,
          visible: true,
          setSize(nw: number, nh: number) { rect.w = nw; rect.h = nh; return rect; },
          setStrokeStyle: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        };
        objects.push(rect);
        return rect;
      }),
      text: vi.fn((x: number, y: number, text: string) => {
        const txt: any = {
          x, y, text,
          visible: true,
          setText(t: string) { txt.text = t; return txt; },
          setOrigin: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        };
        objects.push(txt);
        return txt;
      }),
    },
    tweens: {
      killTweensOf: vi.fn(),
    },
  };
  return { mockScene, objects };
}

describe('ArmyVisualPool', () => {
  const sampleArmy: MarchingArmy = {
    id: 'army_1',
    owner: 'player',
    sourceId: 'p_base',
    targetId: 'n_center',
    units: 12,
    startX: 100,
    startY: 200,
    targetX: 300,
    targetY: 400,
    distance: 282.8,
    progress: 0.5,
    speed: 60,
  };

  it('pre-allocates capacity in free list', () => {
    const { mockScene } = createMockScene();
    const pool = new ArmyVisualPool(mockScene, 4);

    const stats = pool.getPoolStats();
    expect(stats.total).toBe(4);
    expect(stats.free).toBe(4);
    expect(stats.active).toBe(0);
  });

  it('acquires visual from pool and configures properties without allocating new objects', () => {
    const { mockScene, objects } = createMockScene();
    const pool = new ArmyVisualPool(mockScene, 4);
    const initialObjectCount = objects.length;

    const visual = pool.acquire(sampleArmy, 'barracks');
    expect(visual.id).toBe('player:army_1');
    expect(visual.container.visible).toBe(true);
    expect(visual.badgeText.text).toBe('PROD 12');
    expect(visual.activeFollowerCount).toBe(2);

    // No new game objects were created during acquire
    expect(objects.length).toBe(initialObjectCount);

    const stats = pool.getPoolStats();
    expect(stats.free).toBe(3);
    expect(stats.active).toBe(1);
  });

  it('re-acquiring after release reuses the exact same visual instance', () => {
    const { mockScene } = createMockScene();
    const pool = new ArmyVisualPool(mockScene, 2);

    const first = pool.acquire(sampleArmy, 'barracks');
    expect(pool.getPoolStats().active).toBe(1);

    pool.release(first);
    expect(pool.getPoolStats().active).toBe(0);
    expect(first.container.visible).toBe(false);

    // Re-acquire -> must be the same instance
    const second = pool.acquire({ ...sampleArmy, id: 'army_2', units: 8 }, 'stable');
    expect(second).toBe(first);
    expect(second.id).toBe('player:army_2');
    expect(second.container.visible).toBe(true);
    expect(second.badgeText.text).toBe('SPD 8');
  });

  it('reduced-effects mode caps active follower escorts to 1', () => {
    const { mockScene } = createMockScene();
    const pool = new ArmyVisualPool(mockScene, 2);

    // Normal mode with 20 units -> 4 followers
    const bigArmy: MarchingArmy = { ...sampleArmy, units: 20 };
    const normalVis = pool.acquire(bigArmy, 'barracks', false);
    expect(normalVis.activeFollowerCount).toBe(4);
    pool.release(normalVis);

    // Reduced effects mode with 20 units -> capped to 1 follower
    const reducedVis = pool.acquire(bigArmy, 'barracks', true);
    expect(reducedVis.activeFollowerCount).toBe(1);
    expect(reducedVis.followers[0].sprite.visible).toBe(true);
    expect(reducedVis.followers[1].sprite.visible).toBe(false);
  });

  it('expands capacity dynamically if free list is exhausted', () => {
    const { mockScene } = createMockScene();
    const pool = new ArmyVisualPool(mockScene, 1);

    const v1 = pool.acquire(sampleArmy, 'barracks');
    expect(pool.getPoolStats().total).toBe(1);
    expect(pool.getPoolStats().free).toBe(0);

    const v2 = pool.acquire({ ...sampleArmy, id: 'army_extra' }, 'barracks');
    expect(pool.getPoolStats().total).toBe(2);
    expect(pool.getPoolStats().active).toBe(2);
    expect(v1).not.toBe(v2);
  });

  it('destroy cleans up all Phaser GameObjects in the pool', () => {
    const { mockScene } = createMockScene();
    const pool = new ArmyVisualPool(mockScene, 2);

    const v = pool.acquire(sampleArmy, 'barracks');
    pool.destroy();

    expect(v.container.destroy).toHaveBeenCalled();
    expect(v.leaderSprite.destroy).toHaveBeenCalled();
    expect(v.leaderShadow.destroy).toHaveBeenCalled();
    expect(v.badgeText.destroy).toHaveBeenCalled();
    expect(v.badgeBg.destroy).toHaveBeenCalled();

    const stats = pool.getPoolStats();
    expect(stats.total).toBe(0);
  });

  it('detaches dormant containers from display list and re-attaches on acquire', () => {
    const { mockScene } = createMockScene();
    const pool = new ArmyVisualPool(mockScene, 2);

    const visual = pool.acquire(sampleArmy, 'barracks');
    expect((visual.container as any).inDisplayList).toBe(true);
    expect((visual.container as any).addToDisplayList).toHaveBeenCalled();

    pool.release(visual);
    expect((visual.container as any).inDisplayList).toBe(false);
    expect((visual.container as any).removeFromDisplayList).toHaveBeenCalled();
  });
});

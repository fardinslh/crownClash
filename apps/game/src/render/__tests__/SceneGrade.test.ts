import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { SCENE_GRADE, applySceneGrade } from '../SceneGrade.js';

const sceneWith = (internal: unknown): Phaser.Scene => ({ cameras: { main: { filters: { internal } } } }) as unknown as Phaser.Scene;

describe('applySceneGrade', () => {
  it('adds one colour matrix with the grade values when enabled', () => {
    const colorMatrix = { saturate: vi.fn(), contrast: vi.fn() };
    const addColorMatrix = vi.fn(() => ({ colorMatrix }));
    expect(applySceneGrade(sceneWith({ addColorMatrix }), true)).toBe(true);
    expect(addColorMatrix).toHaveBeenCalledOnce();
    expect(colorMatrix.saturate).toHaveBeenCalledWith(SCENE_GRADE.saturation, true);
    expect(colorMatrix.contrast).toHaveBeenCalledWith(SCENE_GRADE.contrast, true);
  });

  it('does nothing when disabled (low and mid tiers) or when the camera has no filter API', () => {
    const addColorMatrix = vi.fn();
    expect(applySceneGrade(sceneWith({ addColorMatrix }), false)).toBe(false);
    expect(addColorMatrix).not.toHaveBeenCalled();
    expect(applySceneGrade(sceneWith(undefined), true)).toBe(false);
    expect(applySceneGrade({} as Phaser.Scene, true)).toBe(false);
  });
});

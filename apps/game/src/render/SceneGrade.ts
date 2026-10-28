import type Phaser from 'phaser';

/**
 * Colour grade of the battle camera: richer greens and blues and a touch more contrast. A navy vignette was
 * tried and rejected (it dimmed the whole board and the HUD), so this is one full-screen pass.
 */
export const SCENE_GRADE = Object.freeze({ saturation: 0.25, contrast: 0.08 });

interface GradeCamera {
  filters?: {
    internal?: {
      addColorMatrix?: () => { colorMatrix: { saturate(amount: number, multiply?: boolean): unknown; contrast(amount: number, multiply?: boolean): unknown } };
    };
  };
}

/**
 * Applies the grade to the scene's main camera. It costs a full-screen pass, so it is for the `high` render
 * tier only (callers pass `enabled`); anything missing from the camera API (tests, old builds) is skipped.
 * Returns true when the filter was added.
 */
export function applySceneGrade(scene: Phaser.Scene, enabled: boolean): boolean {
  if (!enabled) return false;
  const internal = (scene.cameras?.main as unknown as GradeCamera | undefined)?.filters?.internal;
  if (!internal?.addColorMatrix) return false;
  const matrix = internal.addColorMatrix().colorMatrix;
  matrix.saturate(SCENE_GRADE.saturation, true);
  matrix.contrast(SCENE_GRADE.contrast, true);
  return true;
}

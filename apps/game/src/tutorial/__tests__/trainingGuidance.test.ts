import { describe, expect, it } from 'vitest';
import type { Territory } from '@crown-clash/game-core';
import {
  applyTrainingSandbox,
  isTrainingTerritoryBright,
  resolveTrainingGuidance,
  TRAINING_DIM_ALPHA,
  TRAINING_ENEMY_BASE_PRODUCTION,
  TRAINING_TIME_LIMIT_SECONDS,
} from '../trainingGuidance.js';
import { TUTORIAL_ENEMY_BASE_ID, TUTORIAL_STEPS } from '../TutorialController.js';

// ---------------------------------------------------------------------------
// Helpers — the fixed crown_cross training battlefield (battlefields.json)
// ---------------------------------------------------------------------------

interface TerritorySeed {
  id: string;
  x: number;
  y: number;
  radius?: number;
  owner?: Territory['owner'];
  units?: number;
  productionRate?: number;
}

const CROWN_CROSS: readonly TerritorySeed[] = [
  { id: 'p_base', x: 200, y: 610, radius: 36, owner: 'player', units: 20, productionRate: 1.2 },
  { id: 'e_base', x: 200, y: 110, radius: 36, owner: 'enemy', units: 20, productionRate: 1.2 },
  { id: 'n_bot_left', x: 85, y: 485, radius: 27, owner: 'neutral', units: 8, productionRate: 0.9 },
  { id: 'n_bot_right', x: 315, y: 485, radius: 27, owner: 'neutral', units: 8, productionRate: 0.9 },
  { id: 'n_center', x: 200, y: 360, radius: 32, owner: 'neutral', units: 14, productionRate: 1.1 },
  { id: 'n_mid_left', x: 75, y: 360, radius: 26, owner: 'neutral', units: 10, productionRate: 0.85 },
  { id: 'n_mid_right', x: 325, y: 360, radius: 26, owner: 'neutral', units: 10, productionRate: 0.85 },
  { id: 'n_top_left', x: 85, y: 235, radius: 27, owner: 'neutral', units: 8, productionRate: 0.9 },
  { id: 'n_top_right', x: 315, y: 235, radius: 27, owner: 'neutral', units: 8, productionRate: 0.9 },
];

function makeTerritories(
  overrides: Record<string, Partial<TerritorySeed>> = {}
): Record<string, Territory> {
  const territories: Record<string, Territory> = {};
  for (const seed of CROWN_CROSS) {
    const o = overrides[seed.id] ?? {};
    territories[seed.id] = {
      id: seed.id,
      name: seed.id,
      x: o.x ?? seed.x,
      y: o.y ?? seed.y,
      radius: o.radius ?? seed.radius ?? 27,
      owner: o.owner ?? seed.owner ?? 'neutral',
      units: o.units ?? seed.units ?? 8,
      maxUnits: seed.id.endsWith('_base') ? 65 : 40,
      productionRate: o.productionRate ?? seed.productionRate ?? 0.9,
      tier: seed.id.endsWith('_base') ? 3 : seed.id === 'n_center' ? 2 : 1,
      type: seed.id === 'n_center' || seed.id.endsWith('_base') ? 'fortress' : 'barracks',
    } satisfies Territory;
  }
  return territories;
}

// ---------------------------------------------------------------------------
// Sandbox tuning
// ---------------------------------------------------------------------------

describe('applyTrainingSandbox', () => {
  it('overpowers the player base and guts the enemy base (Clash Royale-style)', () => {
    const territories = makeTerritories();
    applyTrainingSandbox(territories);

    // Boosted player base: the first dispatch (~20 units) always beats the
    // weak guided neutral towers (8 units).
    expect(territories.p_base.units).toBe(40);
    // Gutted enemy base: the scripted finale stays a guaranteed first-try win.
    expect(territories.e_base.units).toBe(10);
    expect(territories.e_base.productionRate).toBe(TRAINING_ENEMY_BASE_PRODUCTION);
  });

  it('never lowers an already-stronger player base and respects maxUnits', () => {
    const territories = makeTerritories({
      p_base: { units: 60 },
    });
    applyTrainingSandbox(territories);
    expect(territories.p_base.units).toBe(60);
  });

  it('leaves neutral towers untouched so the taught mechanics match the real game', () => {
    const territories = makeTerritories();
    applyTrainingSandbox(territories);
    expect(territories.n_bot_left.units).toBe(8);
    expect(territories.n_center.units).toBe(14);
    expect(territories.n_bot_left.productionRate).toBe(0.9);
  });

  it('tolerates a missing base without throwing', () => {
    const territories = makeTerritories();
    delete territories.p_base;
    delete territories.e_base;
    expect(() => applyTrainingSandbox(territories)).not.toThrow();
  });

  it('keeps the generous no-pressure training time limit exported for the scene', () => {
    expect(TRAINING_TIME_LIMIT_SECONDS).toBeGreaterThan(90);
  });

  it('never dims a player-owned tower, even when the step spotlight does not know about it yet', () => {
    // The dimming rule is ownership-first: captured towers brighten the
    // moment they turn blue, even mid-step before the spotlight list is
    // recomputed (a pale freshly-captured tower reads as broken).
    expect(isTrainingTerritoryBright('n_center', 'player', ['p_base', 'e_base'])).toBe(true);
    expect(isTrainingTerritoryBright('p_base', 'player', [])).toBe(true);
  });

  it('dims unguided enemy/neutral towers but keeps the guided ones bright', () => {
    const spotlight = ['p_base', 'n_bot_left'];
    expect(isTrainingTerritoryBright('p_base', 'player', spotlight)).toBe(true);
    expect(isTrainingTerritoryBright('n_bot_left', 'neutral', spotlight)).toBe(true);
    expect(isTrainingTerritoryBright('n_center', 'neutral', spotlight)).toBe(false);
    expect(isTrainingTerritoryBright('e_base', 'enemy', spotlight)).toBe(false);
    expect(TRAINING_DIM_ALPHA).toBeLessThan(1);
  });

  it('treats an unknown owner conservatively as dimmable', () => {
    expect(isTrainingTerritoryBright('x', undefined, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Adaptive guidance
// ---------------------------------------------------------------------------

describe('resolveTrainingGuidance', () => {
  it('guides the first drag from the player base to the nearest weak tower', () => {
    const guidance = resolveTrainingGuidance(makeTerritories(), 'drag_to_attack');
    // n_bot_left and n_bot_right are equidistant; ties break leftmost.
    expect(guidance.spotlightIds).toEqual(['p_base', 'n_bot_left']);
    expect(guidance.hintPath).toEqual(['p_base', 'n_bot_left']);
  });

  it('never suggests the enemy base before the finale step', () => {
    for (const stepId of ['drag_to_attack', 'preview_result', 'tower_roles', 'multi_dispatch'] as const) {
      const guidance = resolveTrainingGuidance(makeTerritories(), stepId);
      expect(guidance.spotlightIds).not.toContain(TUTORIAL_ENEMY_BASE_ID);
      expect(guidance.hintPath).not.toContain(TUTORIAL_ENEMY_BASE_ID);
    }
  });

  it('skips already-owned towers when suggesting the next target', () => {
    const territories = makeTerritories({
      n_bot_left: { owner: 'player', units: 4 },
    });
    const guidance = resolveTrainingGuidance(territories, 'tower_roles');
    expect(guidance.spotlightIds).toEqual(['p_base', 'n_bot_right']);
    expect(guidance.hintPath).toEqual(['p_base', 'n_bot_right']);
  });

  it('re-points guidance away from towers captured mid-step (stale-guidance regression)', () => {
    // Step 1's capture lands a beat AFTER step 2 entered (dispatch completes
    // on release, the capture ~1s later): with n_bot_left now player-owned,
    // re-resolving the preview_result guidance must move to the next
    // capturable target instead of pointing at the player's own tower.
    const territories = makeTerritories({
      n_bot_left: { owner: 'player', units: 12 },
    });
    const guidance = resolveTrainingGuidance(territories, 'preview_result');
    expect(guidance.spotlightIds).toEqual(['p_base', 'n_bot_right']);
    expect(guidance.hintPath).toEqual(['p_base', 'n_bot_right']);
  });

  it('chains the combo sources so the stroke flows toward the target', () => {
    const territories = makeTerritories({
      n_bot_left: { owner: 'player', units: 22 },
      n_bot_right: { owner: 'player', units: 6 },
    });
    const guidance = resolveTrainingGuidance(territories, 'multi_dispatch');
    // The two strongest owned towers are chained (n_bot_left 22, p_base 20)
    // and the nearest capturable target from n_bot_left is n_mid_left
    // (dist ≈ 125). The chain starts at the tower FARTHEST from the target
    // (p_base, dist ≈ 280) so the demonstrated stroke flows toward it.
    expect(guidance.hintPath).toEqual(['p_base', 'n_bot_left', 'n_mid_left']);
    expect(guidance.spotlightIds).toEqual(['p_base', 'n_bot_left', 'n_mid_left']);
  });

  it('never duplicates the source in the combo path with a single owned tower', () => {
    const guidance = resolveTrainingGuidance(makeTerritories(), 'multi_dispatch');
    expect(guidance.hintPath).toEqual(['p_base', 'n_bot_left']);
    expect(new Set(guidance.hintPath).size).toBe(guidance.hintPath.length);
  });

  it('sweeps every owned tower into the enemy-base finale as one continuous stroke', () => {
    const territories = makeTerritories({
      n_bot_left: { owner: 'player', units: 9 },
      n_center: { owner: 'player', units: 3 },
    });
    const guidance = resolveTrainingGuidance(territories, 'destroy_base');
    expect(guidance.hintPath.at(-1)).toBe(TUTORIAL_ENEMY_BASE_ID);
    expect(guidance.spotlightIds.at(-1)).toBe(TUTORIAL_ENEMY_BASE_ID);
    // The sweep is a greedy nearest-neighbor stroke starting at the tower
    // FARTHEST from the enemy base, so it reads as one smooth drag across
    // the field: p_base → n_bot_left → n_center → e_base.
    expect(guidance.hintPath).toEqual([
      'p_base',
      'n_bot_left',
      'n_center',
      TUTORIAL_ENEMY_BASE_ID,
    ]);
    expect(guidance.spotlightIds).toEqual(guidance.hintPath);
  });

  it('degrades gracefully without a player base', () => {
    const territories = makeTerritories();
    delete territories.p_base;
    for (const stepId of TUTORIAL_STEPS) {
      const guidance = resolveTrainingGuidance(territories, stepId);
      expect(guidance.spotlightIds).toEqual([]);
      expect(guidance.hintPath).toEqual([]);
    }
  });
});

import type { Team } from '@crown-clash/game-core';

/** Why a tower's garrison number changed; production gets no pop. */
export type CountCause = 'drop' | 'hit' | 'gain' | 'capture';

/** Badge pop per cause (multiplied by the badge's own base scale). */
export const COUNT_PUNCH_SCALE: Record<CountCause, number> = {
  drop: 0.88,
  hit: 1.16,
  gain: 1.14,
  capture: 1.28,
};

/**
 * Intermediate values for a counter roll, ending exactly at `to`. At most
 * `maxSteps` text redraws (Canvas re-rasterises a Text on every change),
 * evenly spaced and never repeating a value.
 */
export function rollSteps(from: number, to: number, maxSteps = 6): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [to];
  const distance = Math.abs(to - from);
  if (distance === 0) return [];
  const steps = Math.max(1, Math.min(Math.floor(maxSteps), distance));
  const values: number[] = [];
  for (let i = 1; i <= steps; i++) {
    const value = Math.round(from + ((to - from) * i) / steps);
    if (values[values.length - 1] !== value) values.push(value);
  }
  values[values.length - 1] = to;
  return values;
}

export type CaptureShake = 'big' | 'small' | 'none';

/**
 * Camera shake is reserved for moments that matter to the player: taking
 * the crown keep, or losing one of their own towers. Ordinary captures get
 * the pop, ring and burst only, so the screen does not shake constantly.
 */
export function captureShake(input: { crownKeep: boolean; attacker: Team; previousOwner: Team }): CaptureShake {
  if (input.attacker === 'player' && input.crownKeep) return 'big';
  if (input.previousOwner === 'player' && input.attacker !== 'player') return 'small';
  return 'none';
}

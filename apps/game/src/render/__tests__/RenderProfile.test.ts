import { describe, expect, it } from 'vitest';
import { selectRenderProfile } from '../RenderProfile.js';

describe('selectRenderProfile', () => {
  it('uses Canvas at 1x for the measured legacy Bale Android device', () => {
    expect(
      selectRenderProfile({
        platform: 'bale',
        devicePixelRatio: 2,
        userAgent:
          'Mozilla/5.0 (Linux; Android 9; SM-J530F Build/PPR1.180610.011; wv)',
        deviceMemory: 2,
      })
    ).toEqual({ renderer: 'canvas', renderScale: 1, reducedEffects: true });
  });

  it('uses Canvas for a low-memory Bale Android even on a newer OS', () => {
    expect(
      selectRenderProfile({
        platform: 'bale',
        devicePixelRatio: 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 12; Mobile)',
        deviceMemory: 2,
      })
    ).toEqual({ renderer: 'canvas', renderScale: 1, reducedEffects: true });
  });

  it('preserves WebGL auto-selection and the existing DPR cap elsewhere', () => {
    expect(
      selectRenderProfile({
        platform: 'telegram',
        devicePixelRatio: 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 9; Mobile)',
        deviceMemory: 2,
      })
    ).toEqual({ renderer: 'auto', renderScale: 2, reducedEffects: false });

    expect(
      selectRenderProfile({
        platform: 'bale',
        devicePixelRatio: 1.5,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        deviceMemory: 8,
      })
    ).toEqual({ renderer: 'auto', renderScale: 1.5, reducedEffects: false });
  });
});


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
    ).toEqual({ renderer: 'canvas', renderScale: 1, reducedEffects: true, tier: 'low', assetTier: 'sd' });
  });

  it('uses Canvas for a low-memory Bale Android even on a newer OS', () => {
    expect(
      selectRenderProfile({
        platform: 'bale',
        devicePixelRatio: 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 12; Mobile)',
        deviceMemory: 2,
      })
    ).toEqual({ renderer: 'canvas', renderScale: 1, reducedEffects: true, tier: 'low', assetTier: 'sd' });
  });

  it('preserves WebGL auto-selection and the existing DPR cap elsewhere', () => {
    expect(
      selectRenderProfile({
        platform: 'telegram',
        devicePixelRatio: 3,
        userAgent: 'Mozilla/5.0 (Linux; Android 9; Mobile)',
        deviceMemory: 2,
      })
    ).toEqual({ renderer: 'auto', renderScale: 2, reducedEffects: false, tier: 'mid', assetTier: 'sd' });

    expect(
      selectRenderProfile({
        platform: 'bale',
        devicePixelRatio: 1.5,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
        deviceMemory: 8,
      })
    ).toEqual({ renderer: 'auto', renderScale: 1.5, reducedEffects: false, tier: 'mid', assetTier: 'sd' });
  });

  describe('high tier', () => {
    const modern = { platform: 'telegram' as const, devicePixelRatio: 3, userAgent: 'Mozilla/5.0 (Linux; Android 15; Mobile)', deviceMemory: 8, hardwareConcurrency: 8 };

    it('renders at the device pixel ratio up to 3x and asks for the HD art', () => {
      expect(selectRenderProfile(modern)).toEqual({ renderer: 'auto', renderScale: 3, reducedEffects: false, tier: 'high', assetTier: 'hd' });
      expect(selectRenderProfile({ ...modern, devicePixelRatio: 4 }).renderScale).toBe(3);
      expect(selectRenderProfile({ ...modern, devicePixelRatio: 2.75 }).renderScale).toBe(2.75);
    });

    it('stays mid when the device is not clearly capable', () => {
      expect(selectRenderProfile({ ...modern, devicePixelRatio: 2 }).tier).toBe('mid');
      expect(selectRenderProfile({ ...modern, deviceMemory: 4 }).tier).toBe('mid');
      expect(selectRenderProfile({ ...modern, hardwareConcurrency: 4 }).tier).toBe('mid');
      expect(selectRenderProfile({ ...modern, userAgent: 'Mozilla/5.0 (Linux; Android 8; Mobile)' }).tier).toBe('mid');
    });

    it('treats unknown memory and cores as capable on a high-DPR modern device (browsers hide them)', () => {
      expect(selectRenderProfile({ ...modern, deviceMemory: undefined, hardwareConcurrency: undefined }).tier).toBe('high');
    });

    it('honours a stored cap from a measured slow session, one tier at a time', () => {
      expect(selectRenderProfile({ ...modern, tierCap: 'mid' })).toMatchObject({ tier: 'mid', renderScale: 2, assetTier: 'sd' });
      expect(selectRenderProfile({ ...modern, tierCap: 'low' })).toMatchObject({ tier: 'low', renderScale: 1, reducedEffects: true, assetTier: 'sd' });
      expect(selectRenderProfile({ ...modern, tierCap: 'high' }).tier).toBe('high');
    });

    it('never lets a cap lift the legacy Bale Android profile', () => {
      const legacy = selectRenderProfile({ platform: 'bale', devicePixelRatio: 3, userAgent: 'Mozilla/5.0 (Linux; Android 9; Mobile)', tierCap: 'high' });
      expect(legacy).toMatchObject({ renderer: 'canvas', tier: 'low' });
    });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRemoteFeatureFlags,
  disableRemoteFeatureFlags,
  featureFlags,
  resolveFeatureFlags,
} from '../featureFlags.js';

describe('2v2 feature rollout', () => {
  beforeEach(() => disableRemoteFeatureFlags());

  it('defaults closed unless the build-time flag is exactly true', () => {
    expect(resolveFeatureFlags({})).toEqual({ enable2v2: false });
    expect(resolveFeatureFlags({ VITE_ENABLE_2V2: 'TRUE' })).toEqual({ enable2v2: false });
    expect(resolveFeatureFlags({ VITE_ENABLE_2V2: 'true' })).toEqual({ enable2v2: true });
  });

  it('applies the authenticated server decision and can be killed immediately', () => {
    applyRemoteFeatureFlags({ enable2v2: true, rolloutPercent: 5, platform: 'bale' });
    expect(featureFlags.enable2v2).toBe(true);
    disableRemoteFeatureFlags();
    expect(featureFlags.enable2v2).toBe(false);
  });
});

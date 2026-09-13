import type { PlatformType } from '@crown-clash/platform';

export interface RenderEnvironment {
  platform: PlatformType;
  devicePixelRatio: number;
  userAgent: string;
  deviceMemory?: number;
}

export interface RenderProfile {
  renderer: 'auto' | 'canvas';
  renderScale: number;
  reducedEffects: boolean;
}

const getAndroidMajorVersion = (userAgent: string): number | undefined => {
  const match = /Android\s+(\d+)/i.exec(userAgent);
  return match ? Number.parseInt(match[1], 10) : undefined;
};

export const selectRenderProfile = (environment: RenderEnvironment): RenderProfile => {
  const androidMajor = getAndroidMajorVersion(environment.userAgent);
  const lowMemory =
    typeof environment.deviceMemory === 'number' && environment.deviceMemory <= 2;
  const legacyBaleAndroid =
    environment.platform === 'bale' &&
    ((androidMajor !== undefined && androidMajor <= 9) || lowMemory);

  if (legacyBaleAndroid) {
    return {
      renderer: 'canvas',
      renderScale: 1,
      reducedEffects: true,
    };
  }

  return {
    renderer: 'auto',
    renderScale: Math.min(Math.max(environment.devicePixelRatio || 1, 1), 2),
    reducedEffects: false,
  };
};

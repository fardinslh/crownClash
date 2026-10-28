import { Team } from '@crown-clash/game-core';

export interface TeamVisualTheme {
  primary: number;
  primaryHex: string;
  dark: number;
  darkHex: string;
  light: number;
  lightHex: string;
  glow: number;
}

export const THEME = {
  background: 0x0a0e17,
  arenaGrid: 0x162032,
  arenaBorder: 0x223048,
  textLight: '#f8fafc',
  textMuted: '#94a3b8',
  gold: 0xf59e0b,
  goldHex: '#f59e0b',
  // 2v2 mode accent (quad_citadel accent from the server battlefield def);
  // identity in 2v2 is never color-only — slot shapes and A/B labels carry it.
  twoVTwoAccent: 0x818cf8,
  twoVTwoAccentHex: '#818cf8',
  teams: {
    player: {
      primary: 0x3b82f6,
      primaryHex: '#3b82f6',
      dark: 0x1d4ed8,
      darkHex: '#1d4ed8',
      light: 0x93c5fd,
      lightHex: '#93c5fd',
      glow: 0x60a5fa,
    },
    enemy: {
      primary: 0xef4444,
      primaryHex: '#ef4444',
      dark: 0xb91c1c,
      darkHex: '#b91c1c',
      light: 0xfca5a5,
      lightHex: '#fca5a5',
      glow: 0xf87171,
    },
    neutral: {
      primary: 0x64748b,
      primaryHex: '#64748b',
      dark: 0x334155,
      darkHex: '#334155',
      light: 0xcbd5e1,
      lightHex: '#cbd5e1',
      glow: 0x94a3b8,
    },
  } as Record<Team, TeamVisualTheme>,
};

/**
 * Hub/HUD design tokens (Art Bible "Hub UI"). Scenes and the ui/kit
 * components read these instead of hand-picking hex values.
 */
export const UI = {
  bg: 0x070b14,
  bgHex: '#070b14',
  surface: { base: 0x10204a, raised: 0x1a3170, high: 0x24428f },
  border: 0x4a6bc4,
  borderStrong: 0x7a99e6,
  radius: { sm: 8, md: 12, lg: 16 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  type: { caption: 11, body: 13, label: 15, title: 20, display: 28 },
  text: {
    primary: '#f8fafc',
    secondary: '#cbd5e1',
    muted: '#94a3b8',
    accent: '#93c5fd',
    gold: '#fde68a',
    danger: '#fca5a5',
    success: '#6ee7b7',
    stroke: '#030712',
  },
  button: {
    primary: { fill: 0x2563eb, lip: 0x1e3a8a, gloss: 0x60a5fa, text: '#ffffff' },
    gold: { fill: 0xf59e0b, lip: 0x92400e, gloss: 0xfde68a, text: '#1c1206' },
    success: { fill: 0x10b981, lip: 0x065f46, gloss: 0x6ee7b7, text: '#04130d' },
    secondary: { fill: 0x2d4a94, lip: 0x13265a, gloss: 0x8fabee, text: '#f1f5ff' },
    danger: { fill: 0xdc2626, lip: 0x7f1d1d, gloss: 0xfca5a5, text: '#ffffff' },
  },
} as const;

export type ButtonVariant = keyof typeof UI.button;

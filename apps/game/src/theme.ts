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

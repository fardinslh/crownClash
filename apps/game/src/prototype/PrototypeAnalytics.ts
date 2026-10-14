import type { PrototypeMode } from './CrownMatch.js';

export const PROTOTYPE_EVENT = 'crown-clash:prototype';
export const PROTOTYPE_STORAGE_KEY = 'crown_clash_prototype_events_v1';
export type PrototypeEvent = {
  name: 'prototype_start' | 'prototype_end' | 'prototype_quit' | 'prototype_first_dispatch' | 'prototype_crown_captured';
  matchId: string;
  mode: PrototypeMode;
  elapsedSeconds: number;
  source?: 'menu' | 'rematch' | 'compare';
  result?: 'victory' | 'defeat' | 'draw';
  holder?: 'player' | 'enemy' | 'neutral';
  captures?: number;
  firstCaptureSeconds?: number;
};

/** Bounded local playtest evidence, deliberately outside production analytics. */
export function trackPrototypeEvent(event: PrototypeEvent): void {
  if (typeof window === 'undefined') return;
  const detail = { ...event, version: 1, occurredAt: Date.now() };
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(PROTOTYPE_STORAGE_KEY) ?? '[]');
    const history: unknown[] = Array.isArray(saved) ? saved : [];
    window.sessionStorage.setItem(PROTOTYPE_STORAGE_KEY, JSON.stringify([...history.slice(-99), detail]));
  } catch { /* Disabled/full storage must not interrupt a local playtest. */ }
  window.dispatchEvent(new CustomEvent(PROTOTYPE_EVENT, { detail }));
}

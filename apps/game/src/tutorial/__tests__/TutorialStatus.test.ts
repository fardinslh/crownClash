import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLegacyTutorialMarker,
  clearTrainingProgress,
  createTrainingTicket,
  legacyMarkerKey,
  loadTrainingProgress,
  migrateLegacyTutorialMarker,
  readLegacyTutorialMarker,
  remapTrainingMenuAnalytics,
  resolveMenuEntryAction,
  resolvePvpEntryAction,
  resolvePlayEntryAction,
  saveTrainingProgress,
  trainingProgressKey,
  tutorialQuitEvent,
  TRAINING_ACTIONS_COMPLETE,
  type TutorialCompletionApi,
} from '../TutorialStatus.js';
import type { PlayerCareer } from '@crown-clash/game-core';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function mockLocalStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn((_: number): string | null => null),
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: mock },
    writable: true,
    configurable: true,
  });
  return store;
}

function makeApi(behavior: 'ok' | 'fail'): TutorialCompletionApi {
  return {
    completeTutorial: vi.fn(() => {
      if (behavior === 'fail') return Promise.reject(new Error('network_down'));
      return Promise.resolve({ tutorialCompleted: true } satisfies Partial<PlayerCareer>);
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TutorialStatus', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = mockLocalStorage();
    vi.clearAllMocks();
  });

  describe('legacy marker keys', () => {
    it('uses the historical per-player key so old graduates are detected', () => {
      expect(legacyMarkerKey('alice')).toBe('crown_clash_tutorial_alice');
      store.set('crown_clash_tutorial_alice', '1');
      expect(readLegacyTutorialMarker('alice')).toBe(true);
      expect(readLegacyTutorialMarker('bob')).toBe(false);
    });

    it('treats a missing window.localStorage as no marker (fail-closed)', () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      expect(readLegacyTutorialMarker('alice')).toBe(false);
      expect(() => clearLegacyTutorialMarker('alice')).not.toThrow();
      expect(() => saveTrainingProgress('alice', 2)).not.toThrow();
      expect(loadTrainingProgress('alice')).toBe(0);
    });
  });

  describe('training progress marker (resume)', () => {
    it('round-trips the resume step per player', () => {
      expect(trainingProgressKey('alice')).toBe('crown_clash_training_progress_alice');
      saveTrainingProgress('alice', 2);
      expect(loadTrainingProgress('alice')).toBe(2);
      expect(loadTrainingProgress('bob')).toBe(0); // per-player isolation
      clearTrainingProgress('alice');
      expect(loadTrainingProgress('alice')).toBe(0);
    });

    it('round-trips the actions-complete sentinel so a failed save never repeats the guided actions', () => {
      expect(TRAINING_ACTIONS_COMPLETE).toBe(5);
      saveTrainingProgress('alice', TRAINING_ACTIONS_COMPLETE);
      expect(loadTrainingProgress('alice')).toBe(TRAINING_ACTIONS_COMPLETE);
      // Clearing after a confirmed server write removes it entirely.
      clearTrainingProgress('alice');
      expect(loadTrainingProgress('alice')).toBe(0);
    });

    it('accepts every valid resume step and clamps the rest to a fresh start', () => {
      for (const step of [0, 1, 2, 3, 4, TRAINING_ACTIONS_COMPLETE]) {
        saveTrainingProgress('alice', step);
        expect(loadTrainingProgress('alice')).toBe(step);
      }
      for (const bad of ['-1', '6', '99', 'abc', '']) {
        store.set('crown_clash_training_progress_alice', bad);
        expect(loadTrainingProgress('alice')).toBe(0);
      }
    });
  });

  describe('training ticket', () => {
    it('is local-only: training id, fixed crown_cross battlefield', () => {
      const ticket = createTrainingTicket(1234);
      expect(ticket.matchId.startsWith('training_')).toBe(true);
      expect(ticket.battlefieldId).toBe('crown_cross');
    });
  });

  describe('legacy migration (exactly once)', () => {
    it('migrates a War Academy graduate to the server and consumes the marker', async () => {
      store.set('crown_clash_tutorial_alice', '1');
      store.set('crown_clash_training_progress_alice', '3'); // stale
      const api = makeApi('ok');

      const result = await migrateLegacyTutorialMarker(api, 'alice', false);

      expect(result).toEqual({ completed: true, migrated: true });
      expect(api.completeTutorial).toHaveBeenCalledTimes(1);
      // Marker consumed: the migration can never run again for this player.
      expect(store.has('crown_clash_tutorial_alice')).toBe(false);
      expect(store.has('crown_clash_training_progress_alice')).toBe(false);
    });

    it('keeps the marker and stays incomplete when the migration save fails', async () => {
      store.set('crown_clash_tutorial_alice', '1');
      const api = makeApi('fail');

      const result = await migrateLegacyTutorialMarker(api, 'alice', false);

      expect(result).toEqual({ completed: false, migrated: false });
      // Marker survives so the next launch retries — never falsely complete.
      expect(store.has('crown_clash_tutorial_alice')).toBe(true);
    });

    it('does not migrate players without the legacy marker (all other existing players train)', async () => {
      const api = makeApi('ok');
      const result = await migrateLegacyTutorialMarker(api, 'newbie', false);
      expect(result).toEqual({ completed: false, migrated: false });
      expect(api.completeTutorial).not.toHaveBeenCalled();
    });

    it('a graduate on a second device (server already complete) skips and clears stale markers', async () => {
      store.set('crown_clash_tutorial_alice', '1'); // e.g. stale on this device
      const api = makeApi('ok');

      const result = await migrateLegacyTutorialMarker(api, 'alice', true);

      expect(result).toEqual({ completed: true, migrated: false });
      expect(api.completeTutorial).not.toHaveBeenCalled();
      expect(store.has('crown_clash_tutorial_alice')).toBe(false);
    });

    it('an account switch migrates independently per player id', async () => {
      store.set('crown_clash_tutorial_alice', '1');
      const api = makeApi('ok');

      const alice = await migrateLegacyTutorialMarker(api, 'alice', false);
      const bob = await migrateLegacyTutorialMarker(api, 'bob', false);

      expect(alice.migrated).toBe(true);
      expect(bob).toEqual({ completed: false, migrated: false });
      expect(api.completeTutorial).toHaveBeenCalledTimes(1);
    });
  });

  describe('entry gating (first-entry routing policy)', () => {
    it('first launch auto-starts training exactly once per session', () => {
      expect(resolveMenuEntryAction(false, false)).toBe('auto_training');
      expect(resolveMenuEntryAction(false, true)).toBe('menu'); // skipped this session
      expect(resolveMenuEntryAction(true, false)).toBe('menu');
      expect(resolveMenuEntryAction(true, true)).toBe('menu');
    });

    it('bot and PvP entry both redirect to training while incomplete', () => {
      expect(resolvePlayEntryAction(false)).toBe('training');
      expect(resolvePlayEntryAction(true)).toBe('bot');
      expect(resolvePvpEntryAction(false)).toBe('training');
      expect(resolvePvpEntryAction(true)).toBe('pvp');
    });
  });

  describe('quit analytics mapping', () => {
    it('maps the last guided step to the stable tutorial_skipped event', () => {
      expect(tutorialQuitEvent('multi_dispatch')).toEqual({
        name: 'tutorial_skipped',
        lastStepId: 'multi_dispatch',
      });
      // No current step (edge): falls back to the first step id.
      expect(tutorialQuitEvent(null).lastStepId).toBe('drag_to_attack');
    });
  });

  describe('training menu analytics remap', () => {
    it('remaps every ordinary match menu navigation event to its tutorial equivalent', () => {
      expect(remapTrainingMenuAnalytics({ name: 'match_menu_opened' })).toEqual({
        name: 'tutorial_menu_opened',
      });
      expect(remapTrainingMenuAnalytics({ name: 'match_resumed' })).toEqual({
        name: 'tutorial_menu_closed',
      });
      expect(remapTrainingMenuAnalytics({ name: 'match_leave_requested' })).toEqual({
        name: 'tutorial_leave_requested',
      });
      expect(remapTrainingMenuAnalytics({ name: 'match_leave_cancelled' })).toEqual({
        name: 'tutorial_leave_cancelled',
      });
    });

    it('suppresses match_quit_confirmed and any unknown/future match_* event', () => {
      expect(remapTrainingMenuAnalytics({ name: 'match_quit_confirmed' })).toBeNull();
      expect(remapTrainingMenuAnalytics({ name: 'match_quit' })).toBeNull();
      expect(remapTrainingMenuAnalytics({ name: 'match_end' })).toBeNull();
      expect(remapTrainingMenuAnalytics({ name: 'some_future_event' })).toBeNull();
    });
  });
});

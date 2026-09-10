import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  TutorialController,
  TutorialEvent,
  TUTORIAL_STEPS,
  isTutorialCompleted,
  markTutorialCompleted,
} from '../TutorialController.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRecorder() {
  const events: TutorialEvent[] = [];
  const callback = (event: TutorialEvent) => events.push({ ...event });
  return { events, callback };
}

function createController(playerId = 'test_player') {
  const recorder = createRecorder();
  const controller = new TutorialController(playerId, recorder.callback);
  return { controller, events: recorder.events };
}

// Mock localStorage
function mockLocalStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() { return store.size; },
    key: vi.fn((_: number): string | null => null),
  };

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: mock },
    writable: true,
    configurable: true,
  });

  return { store, mock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TutorialController', () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  // 1. Correct step order & Bug 4 timing
  describe('step order and timing', () => {
    it('follows the expected sequence: drag_to_attack → preview_result → tower_roles → multi_dispatch → complete', () => {
      const { controller, events } = createController();

      // Initial state
      expect(controller.isActive).toBe(true);
      expect(controller.currentStepId).toBe('drag_to_attack');

      // Step 1: dispatch advances past drag_to_attack
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');

      // Step 2: preview_result remains visible for min duration (2.5s) AND waits for first capture
      controller.onTimerTick(2.6);
      // Min duration met, but first capture has not occurred yet -> stays in preview_result
      expect(controller.currentStepId).toBe('preview_result');

      // First player capture occurs -> now enters tower_roles
      controller.onCapture('n_bot_left', true);
      expect(controller.currentStepId).toBe('tower_roles');

      // Step 3: tower_roles remains visible for ~4 seconds
      controller.onTimerTick(3.5);
      expect(controller.currentStepId).toBe('tower_roles');
      controller.onTimerTick(0.6); // Total >= 4.0s -> enters multi_dispatch
      expect(controller.currentStepId).toBe('multi_dispatch');

      // Step 4: multi_dispatch advances on 2+ source dispatch
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');
      expect(controller.isActive).toBe(false);
      expect(controller.isCompleted).toBe(true);

      // Verify step_entered events have correct stepIds
      const stepEnteredEvents = events.filter(e => e.type === 'step_entered');
      const stepIds = stepEnteredEvents.map(e => e.stepId);
      expect(stepIds).toEqual([
        'drag_to_attack',   // initial entry
        'preview_result',   // after first dispatch
        'tower_roles',      // after preview timer + capture
        'multi_dispatch',   // after tower_roles duration
      ]);

      // Verify step_completed events have correct stepIds
      const stepCompletedEvents = events.filter(e => e.type === 'step_completed');
      const completedStepIds = stepCompletedEvents.map(e => e.stepId);
      expect(completedStepIds).toEqual([
        'drag_to_attack',
        'preview_result',
        'tower_roles',
        'multi_dispatch',
      ]);
    });

    it('preview_result waits for min duration if capture happens early', () => {
      const { controller } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');

      // Fast capture at 1.0s (e.g. close march)
      controller.onTimerTick(1.0);
      controller.onCapture('n_bot_left', true);

      // Must remain in preview_result until min readable duration (2.5s) is met
      expect(controller.currentStepId).toBe('preview_result');

      // Timer completes remaining 1.5s
      controller.onTimerTick(1.6);
      expect(controller.currentStepId).toBe('tower_roles');
    });
  });

  // 2. Invalid actions do not advance steps
  describe('invalid actions', () => {
    it('onCapture during drag_to_attack does not advance', () => {
      const { controller } = createController();
      expect(controller.currentStepId).toBe('drag_to_attack');
      controller.onCapture('n_bot_left', true);
      expect(controller.currentStepId).toBe('drag_to_attack');
    });

    it('onDispatch with 0 sources does not advance', () => {
      const { controller } = createController();
      controller.onDispatch([], 'n_bot_left');
      expect(controller.currentStepId).toBe('drag_to_attack');
    });

    it('second dispatch does not skip preview_result before capture (Bug 4 Rule 7)', () => {
      const { controller } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');

      // Second dispatch during preview_result must be ignored
      controller.onDispatch(['p_base'], 'n_bot_right');
      expect(controller.currentStepId).toBe('preview_result');
    });

    it('enemy capture does not advance preview_result to tower_roles', () => {
      const { controller } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(3.0);
      expect(controller.currentStepId).toBe('preview_result');

      // Enemy capture should not satisfy the first player capture requirement
      controller.onCapture('n_top_right', false);
      expect(controller.currentStepId).toBe('preview_result');
    });

    it('capture or dispatch during tower_roles does not cut short the 4s duration', () => {
      const { controller } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(2.5);
      controller.onCapture('n_bot_left', true);
      expect(controller.currentStepId).toBe('tower_roles');

      // Actions during tower_roles do not advance before timer
      controller.onCapture('n_bot_right', true);
      controller.onDispatch(['p_base'], 'n_center');
      expect(controller.currentStepId).toBe('tower_roles');

      // Only the 4s timer advances to multi_dispatch
      controller.onTimerTick(4.0);
      expect(controller.currentStepId).toBe('multi_dispatch');
    });

    it('single-source dispatch during multi_dispatch does not complete', () => {
      const { controller } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(2.5);
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(4.0);
      expect(controller.currentStepId).toBe('multi_dispatch');

      // Single source dispatch should NOT complete
      controller.onDispatch(['p_base'], 'n_center');
      expect(controller.currentStepId).toBe('multi_dispatch');
      expect(controller.isActive).toBe(true);
    });
  });

  // 3. Valid dispatch advances the first step
  describe('first dispatch', () => {
    it('valid dispatch from any player territory advances drag_to_attack', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');
    });

    it('dispatch from a non-base territory also advances', () => {
      const { controller } = createController();
      controller.onDispatch(['n_bot_left'], 'n_center');
      expect(controller.currentStepId).toBe('preview_result');
    });
  });

  // 4. Coordinated multi-source dispatch completes the tutorial
  describe('multi dispatch completion', () => {
    it('dispatching from 2+ sources completes the tutorial', () => {
      const { controller, events } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(2.5);
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(4.0);
      expect(controller.currentStepId).toBe('multi_dispatch');

      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');
      expect(controller.isCompleted).toBe(true);
      expect(controller.isActive).toBe(false);

      const completedEvents = events.filter(e => e.type === 'completed');
      expect(completedEvents).toHaveLength(1);
    });

    it('dispatching from 3 sources also works', () => {
      const { controller } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(2.5);
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(4.0);

      controller.onDispatch(['p_base', 'n_bot_left', 'n_bot_right'], 'n_center');
      expect(controller.isCompleted).toBe(true);
    });
  });

  // 5. Skip completes persistence and suppresses future tutorials
  describe('skip', () => {
    it('skip immediately deactivates the controller', () => {
      const { controller } = createController();
      expect(controller.isActive).toBe(true);
      controller.skip();
      expect(controller.isActive).toBe(false);
    });

    it('skip fires skipped event with current step ID', () => {
      const { controller, events } = createController();
      controller.skip();
      const skippedEvents = events.filter(e => e.type === 'skipped');
      expect(skippedEvents).toHaveLength(1);
      expect(skippedEvents[0].stepId).toBe('drag_to_attack');
    });

    it('skip persists completion to localStorage', () => {
      const playerId = 'skip_test_player';
      const { controller } = createController(playerId);

      expect(isTutorialCompleted(playerId)).toBe(false);
      controller.skip();
      expect(isTutorialCompleted(playerId)).toBe(true);
    });

    it('after skip, further events are ignored', () => {
      const { controller, events } = createController();
      controller.skip();
      const eventCountAfterSkip = events.length;

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(5.0);

      expect(events.length).toBe(eventCountAfterSkip);
    });
  });

  // 6. Bug 3: Match end is NOT a skip
  describe('match end behavior (Bug 3)', () => {
    it('destroy on match end does not emit tutorial_skipped and does not mark completion', () => {
      const playerId = 'match_end_player';
      const { controller, events } = createController(playerId);
      expect(controller.isActive).toBe(true);

      // Match ends naturally: GameScene destroys the active tutorial
      controller.destroy();

      expect(controller.isActive).toBe(false);
      expect(controller.isCompleted).toBe(false);
      // Must NOT emit tutorial_skipped
      expect(events.some(e => e.type === 'skipped')).toBe(false);
      // Must NOT persist completion
      expect(isTutorialCompleted(playerId)).toBe(false);
    });
  });

  // 7. Persistence across sessions
  describe('persistence across sessions', () => {
    it('completed tutorial is persisted and detected', () => {
      const playerId = 'persist_player';
      const { controller } = createController(playerId);

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(2.5);
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(4.0);
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');

      expect(controller.isCompleted).toBe(true);
      expect(isTutorialCompleted(playerId)).toBe(true);
    });

    it('markTutorialCompleted sets the flag', () => {
      const playerId = 'mark_test';
      expect(isTutorialCompleted(playerId)).toBe(false);
      markTutorialCompleted(playerId);
      expect(isTutorialCompleted(playerId)).toBe(true);
    });
  });

  // 8. Scene shutdown suppresses delayed callbacks
  describe('destroy / scene shutdown', () => {
    it('destroy prevents further event callbacks', () => {
      const { controller, events } = createController();
      controller.destroy();
      const eventCountAfterDestroy = events.length;

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.skip();

      expect(events.length).toBe(eventCountAfterDestroy);
    });

    it('destroyed controller reports inactive', () => {
      const { controller } = createController();
      controller.destroy();
      expect(controller.isActive).toBe(false);
    });
  });

  // 9. Analytics events fire once and use stable step IDs
  describe('analytics events', () => {
    it('tutorial_started fires exactly once at construction', () => {
      const { events } = createController();
      const startedEvents = events.filter(e => e.type === 'started');
      expect(startedEvents).toHaveLength(1);
    });

    it('step_entered events use stable IDs from TUTORIAL_STEPS', () => {
      const { controller, events } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(2.5);
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(4.0);
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');

      const stepEnteredEvents = events.filter(e => e.type === 'step_entered');
      for (const event of stepEnteredEvents) {
        expect(TUTORIAL_STEPS).toContain(event.stepId);
      }
    });

    it('completed fires exactly once after all steps', () => {
      const { controller, events } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(2.5);
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(4.0);
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');

      const completedEvents = events.filter(e => e.type === 'completed');
      expect(completedEvents).toHaveLength(1);
    });

    it('skipped fires exactly once with lastStepId', () => {
      const { controller, events } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.skip();

      const skippedEvents = events.filter(e => e.type === 'skipped');
      expect(skippedEvents).toHaveLength(1);
      expect(skippedEvents[0].stepId).toBe('preview_result');
    });
  });

  // 10. Bug 1: Simulation pause behavior & replay parity
  describe('simulation pause (Bug 1)', () => {
    it('shouldPauseSimulation is true during drag_to_attack', () => {
      const { controller } = createController();
      expect(controller.shouldPauseSimulation).toBe(true);
      expect(controller.shouldSuppressAI).toBe(true);
    });

    it('shouldPauseSimulation becomes false immediately after first dispatch', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.shouldPauseSimulation).toBe(false);
      expect(controller.shouldSuppressAI).toBe(false);
    });

    it('shouldPauseSimulation is false after skip', () => {
      const { controller } = createController();
      controller.skip();
      expect(controller.shouldPauseSimulation).toBe(false);
    });

    it('shouldPauseSimulation is false after destroy', () => {
      const { controller } = createController();
      controller.destroy();
      expect(controller.shouldPauseSimulation).toBe(false);
    });
  });

  // 11. Bug 5: Restricted WebView localStorage crash protection
  describe('restricted WebView storage crash safety (Bug 5)', () => {
    it('handles restricted WebView where localStorage getter throws without crashing', () => {
      Object.defineProperty(globalThis.window, 'localStorage', {
        get() {
          throw new Error('SecurityError: The operation is insecure.');
        },
        configurable: true,
      });

      // Must return false and not throw
      expect(isTutorialCompleted('restricted_player')).toBe(false);

      // Must complete silently without crashing
      expect(() => markTutorialCompleted('restricted_player')).not.toThrow();

      // Controller must continue functioning normally without crashing
      const { controller, events } = createController('restricted_player');
      expect(controller.isActive).toBe(true);
      expect(() => controller.skip()).not.toThrow();
      expect(controller.isActive).toBe(false);
      expect(events.some(e => e.type === 'skipped')).toBe(true);
    });
  });

  // Edge cases
  describe('edge cases', () => {
    it('callback errors do not crash the controller', () => {
      const errorCallback = () => { throw new Error('callback error'); };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => new TutorialController('err_player', errorCallback)).not.toThrow();

      consoleSpy.mockRestore();
    });

    it('currentStep returns null when inactive', () => {
      const { controller } = createController();
      controller.skip();
      expect(controller.currentStep).toBeNull();
      expect(controller.currentStepId).toBeNull();
    });
  });
});

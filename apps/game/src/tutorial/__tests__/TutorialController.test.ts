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

  // 1. Correct step order
  describe('step order', () => {
    it('follows the expected step sequence: drag_to_attack → preview_result → tower_roles → multi_dispatch → complete', () => {
      const { controller, events } = createController();

      // Initial state
      expect(controller.isActive).toBe(true);
      expect(controller.currentStepId).toBe('drag_to_attack');

      // Step 1: dispatch advances past drag_to_attack
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');

      // Step 2: preview_result auto-advances after timed display
      controller.onPreviewShown();
      controller.onTimerTick(3.0); // > 2.5s threshold
      expect(controller.currentStepId).toBe('tower_roles');

      // Step 3: tower_roles advances on player capture
      controller.onCapture('n_bot_left', true);
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
        'tower_roles',      // after preview timer
        'multi_dispatch',   // after capture
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
  });

  // 2. Invalid actions do not advance steps
  describe('invalid actions', () => {
    it('onCapture during drag_to_attack does not advance', () => {
      const { controller } = createController();
      expect(controller.currentStepId).toBe('drag_to_attack');
      controller.onCapture('n_bot_left', true);
      expect(controller.currentStepId).toBe('drag_to_attack');
    });

    it('onPreviewShown during drag_to_attack does not advance', () => {
      const { controller } = createController();
      controller.onPreviewShown();
      controller.onTimerTick(5.0);
      expect(controller.currentStepId).toBe('drag_to_attack');
    });

    it('onDispatch with 0 sources does not advance', () => {
      const { controller } = createController();
      controller.onDispatch([], 'n_bot_left');
      expect(controller.currentStepId).toBe('drag_to_attack');
    });

    it('enemy capture during tower_roles does not advance', () => {
      const { controller } = createController();

      // Advance to tower_roles
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      expect(controller.currentStepId).toBe('tower_roles');

      // Enemy capture should not advance
      controller.onCapture('n_top_right', false);
      expect(controller.currentStepId).toBe('tower_roles');
    });

    it('single-source dispatch during multi_dispatch does not complete', () => {
      const { controller } = createController();

      // Advance to multi_dispatch
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      controller.onCapture('n_bot_left', true);
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

  // 4. First capture advances the role step
  describe('first capture', () => {
    it('player capture advances tower_roles step', () => {
      const { controller } = createController();

      // Advance to tower_roles
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      expect(controller.currentStepId).toBe('tower_roles');

      controller.onCapture('n_bot_left', true);
      expect(controller.currentStepId).toBe('multi_dispatch');
    });
  });

  // 5. Coordinated multi-source dispatch completes the tutorial
  describe('multi dispatch completion', () => {
    it('dispatching from 2+ sources completes the tutorial', () => {
      const { controller, events } = createController();

      // Advance to multi_dispatch
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      controller.onCapture('n_bot_left', true);
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
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      controller.onCapture('n_bot_left', true);

      controller.onDispatch(['p_base', 'n_bot_left', 'n_bot_right'], 'n_center');
      expect(controller.isCompleted).toBe(true);
    });
  });

  // 6. Skip completes persistence and suppresses future tutorials
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
      controller.onPreviewShown();
      controller.onTimerTick(5.0);

      expect(events.length).toBe(eventCountAfterSkip);
    });
  });

  // 7. Refresh/reload does not restart a completed tutorial
  describe('persistence across sessions', () => {
    it('completed tutorial is persisted and detected', () => {
      const playerId = 'persist_player';
      const { controller } = createController(playerId);

      // Complete the full tutorial
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      controller.onCapture('n_bot_left', true);
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

      // No new events should have been emitted
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

      // Complete all steps
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      controller.onCapture('n_bot_left', true);
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');

      const stepEnteredEvents = events.filter(e => e.type === 'step_entered');
      for (const event of stepEnteredEvents) {
        expect(TUTORIAL_STEPS).toContain(event.stepId);
      }
    });

    it('completed fires exactly once after all steps', () => {
      const { controller, events } = createController();

      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(3.0);
      controller.onCapture('n_bot_left', true);
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');

      const completedEvents = events.filter(e => e.type === 'completed');
      expect(completedEvents).toHaveLength(1);
    });

    it('skipped fires exactly once with lastStepId', () => {
      const { controller, events } = createController();

      // Advance to preview_result then skip
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.skip();

      const skippedEvents = events.filter(e => e.type === 'skipped');
      expect(skippedEvents).toHaveLength(1);
      expect(skippedEvents[0].stepId).toBe('preview_result');
    });

    it('no duplicate started events if events are replayed', () => {
      const { events } = createController();
      // Just constructing the controller should produce exactly one 'started'
      expect(events.filter(e => e.type === 'started')).toHaveLength(1);
    });
  });

  // 10. AI suppression flag behavior
  describe('AI suppression', () => {
    it('shouldSuppressAI is true during drag_to_attack', () => {
      const { controller } = createController();
      expect(controller.shouldSuppressAI).toBe(true);
    });

    it('shouldSuppressAI becomes false after first dispatch', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.shouldSuppressAI).toBe(false);
    });

    it('shouldSuppressAI is false after skip', () => {
      const { controller } = createController();
      controller.skip();
      expect(controller.shouldSuppressAI).toBe(false);
    });

    it('shouldSuppressAI is false after destroy', () => {
      const { controller } = createController();
      controller.destroy();
      expect(controller.shouldSuppressAI).toBe(false);
    });
  });

  // Edge cases
  describe('edge cases', () => {
    it('preview_result can be advanced by a second dispatch instead of timer', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');

      // Dispatch again without waiting for timer
      controller.onDispatch(['p_base'], 'n_center');
      expect(controller.currentStepId).toBe('tower_roles');
    });

    it('timer tick without preview shown does not advance', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');

      // Tick without preview shown
      controller.onTimerTick(5.0);
      expect(controller.currentStepId).toBe('preview_result');
    });

    it('callback errors do not crash the controller', () => {
      const errorCallback = () => { throw new Error('callback error'); };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
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

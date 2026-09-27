import { describe, expect, it } from 'vitest';
import {
  TutorialController,
  TutorialEvent,
  TUTORIAL_STEPS,
} from '../TutorialController.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRecorder() {
  const events: TutorialEvent[] = [];
  const callback = (event: TutorialEvent) => events.push({ ...event });
  return { events, callback };
}

function createController(startStep?: number) {
  const recorder = createRecorder();
  const controller = new TutorialController(recorder.callback, startStep === undefined ? {} : { startStep });
  return { controller, events: recorder.events };
}

/** Drives the four guided actions in the natural play order. */
function performAllGuidedActions(controller: TutorialController): void {
  // Step 1: first dispatch (release) completes drag_to_attack.
  controller.onDispatch(['p_base'], 'n_bot_left');
  // Step 2: the drag-badge outcome preview becomes visible, then the
  // minimum display duration elapses.
  controller.onPreviewShown();
  controller.onTimerTick(TutorialController.PREVIEW_RESULT_MIN_DURATION + 0.1);
  // Step 3: a player capture, then the roles display beat.
  controller.onCapture('n_bot_left', true);
  controller.onTimerTick(TutorialController.TOWER_ROLES_MIN_DURATION + 0.1);
  // Step 4: a multi-source dispatch completes the tutorial.
  controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TutorialController', () => {
  // 1. Step order & action-driven completion
  describe('guided action sequence', () => {
    it('follows drag_to_attack → preview_result → tower_roles → multi_dispatch → complete', () => {
      const { controller, events } = createController();
      expect(controller.currentStepId).toBe('drag_to_attack');

      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepId).toBe('preview_result');

      controller.onPreviewShown();
      controller.onTimerTick(TutorialController.PREVIEW_RESULT_MIN_DURATION + 0.1);
      expect(controller.currentStepId).toBe('tower_roles');

      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(TutorialController.TOWER_ROLES_MIN_DURATION + 0.1);
      expect(controller.currentStepId).toBe('multi_dispatch');

      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');
      expect(controller.isCompleted).toBe(true);
      expect(controller.isActive).toBe(false);

      const types = events.map((event) => event.type);
      expect(types).toEqual([
        'started',
        'step_entered',
        'step_completed',
        'step_entered',
        'step_completed',
        'step_entered',
        'step_completed',
        'step_entered',
        'step_completed',
        'completed',
      ]);
      expect(events[0].type).toBe('started');
      expect(events.at(-1)).toEqual({ type: 'completed' });
    });

    it('completes only through the four performed actions, never by winning or time alone', () => {
      const { controller } = createController();
      // Time passing alone can never finish any step or the tutorial.
      controller.onTimerTick(600);
      expect(controller.currentStepId).toBe('drag_to_attack');
      expect(controller.isCompleted).toBe(false);

      // Dispatches without the preview/capture actions stall the tutorial.
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onDispatch(['p_base'], 'n_bot_right');
      controller.onTimerTick(600);
      expect(controller.currentStepId).toBe('preview_result');
      expect(controller.isCompleted).toBe(false);
    });
  });

  // 2. Per-step action requirements
  describe('per-step requirements', () => {
    it('preview_result requires a seen outcome badge AND the minimum display duration', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left'); // → preview_result

      // Duration without a preview does not advance.
      controller.onTimerTick(TutorialController.PREVIEW_RESULT_MIN_DURATION + 1);
      expect(controller.currentStepId).toBe('preview_result');

      // Preview without the duration does not advance.
      controller.onPreviewShown();
      expect(controller.currentStepId).toBe('preview_result');

      // Both together advance.
      controller.onTimerTick(TutorialController.PREVIEW_RESULT_MIN_DURATION + 0.1);
      expect(controller.currentStepId).toBe('tower_roles');
    });

    it('tower_roles completes on a player capture after the display beat (enemy captures do nothing)', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(TutorialController.PREVIEW_RESULT_MIN_DURATION + 0.1);

      controller.onCapture('n_center', false); // enemy capture: ignored
      controller.onTimerTick(TutorialController.TOWER_ROLES_MIN_DURATION + 0.1);
      expect(controller.currentStepId).toBe('tower_roles');

      controller.onCapture('n_center', true); // player capture
      controller.onTimerTick(TutorialController.TOWER_ROLES_MIN_DURATION + 0.1);
      expect(controller.currentStepId).toBe('multi_dispatch');
    });

    it('multi_dispatch requires two or more sources in one release', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(TutorialController.PREVIEW_RESULT_MIN_DURATION + 0.1);
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(TutorialController.TOWER_ROLES_MIN_DURATION + 0.1);

      controller.onDispatch(['p_base'], 'n_center'); // single source: not enough
      expect(controller.currentStepId).toBe('multi_dispatch');
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');
      expect(controller.isCompleted).toBe(true);
    });
  });

  // 3. Simulation pause contract
  describe('simulation pause', () => {
    it('pauses only while the fresh first step is active; resumes after the first dispatch', () => {
      const { controller } = createController();
      expect(controller.shouldPauseSimulation).toBe(true);
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.shouldPauseSimulation).toBe(false);
    });

    it('never pauses a resumed tutorial', () => {
      const { controller } = createController(1);
      expect(controller.currentStepId).toBe('preview_result');
      expect(controller.shouldPauseSimulation).toBe(false);
    });
  });

  // 4. Resume support
  describe('resume', () => {
    it('resumes from the requested step without repeating completed actions', () => {
      const { controller, events } = createController(2);
      expect(controller.currentStepId).toBe('tower_roles');
      // Only the resumed step_entered follows started (no earlier steps).
      expect(events.map((e) => e.type)).toEqual(['started', 'step_entered']);
      expect(events[1].stepId).toBe('tower_roles');

      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(TutorialController.TOWER_ROLES_MIN_DURATION + 0.1);
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');
      expect(controller.isCompleted).toBe(true);
    });

    it('clamps invalid resume indices to a fresh start', () => {
      for (const bad of [-3, 4, 99, Number.NaN]) {
        const { controller } = createController(bad);
        expect(controller.currentStepId).toBe('drag_to_attack');
        expect(controller.currentStepIndex).toBe(0);
      }
    });

    it('exposes the step index for persistence between sessions', () => {
      const { controller } = createController();
      expect(controller.currentStepIndex).toBe(0);
      controller.onDispatch(['p_base'], 'n_bot_left');
      expect(controller.currentStepIndex).toBe(1);
    });

    it('resumeCompleted boots silently into the completed state with no events (failed-save resume)', () => {
      const recorder = createRecorder();
      const controller = new TutorialController(recorder.callback, { resumeCompleted: true });
      // Silent: no started, no step_entered, no completed event — the four
      // actions were already performed in a previous session.
      expect(recorder.events).toEqual([]);
      expect(controller.isCompleted).toBe(true);
      expect(controller.isActive).toBe(false);
      expect(controller.currentStep).toBeNull();
      expect(controller.shouldPauseSimulation).toBe(false);
      // All gameplay hooks are inert: nothing can repeat or re-fire.
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onCapture('n_bot_left', true);
      controller.onTimerTick(600);
      controller.skip();
      expect(recorder.events).toEqual([]);
      expect(controller.isCompleted).toBe(true);
    });
  });

  // 5. Skip semantics (no completion side effect)
  describe('skip', () => {
    it('abandons the tutorial without completing it', () => {
      const { controller, events } = createController(1);
      controller.skip();
      expect(controller.isSkipped).toBe(true);
      expect(controller.isCompleted).toBe(false);
      expect(controller.isActive).toBe(false);
      expect(events.at(-1)).toEqual({ type: 'skipped', stepId: 'preview_result' });

      // No further events after skip.
      controller.onDispatch(['p_base', 'n_bot_left'], 'n_center');
      expect(events.length).toBe(3);
    });
  });

  // 6. Lifecycle and robustness
  describe('lifecycle and robustness', () => {
    it('destroy stops all callbacks', () => {
      const { controller, events } = createController();
      controller.destroy();
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onTimerTick(1);
      controller.onCapture('x', true);
      expect(events.length).toBe(2); // only the construction-time events
    });

    it('event callback errors are contained and do not break the controller', () => {
      const controller = new TutorialController(() => {
        throw new Error('listener crash');
      });
      expect(() => {
        controller.onDispatch(['p_base'], 'n_bot_left');
        controller.onPreviewShown();
        controller.onTimerTick(TutorialController.PREVIEW_RESULT_MIN_DURATION + 0.1);
        controller.onCapture('n', true);
        controller.onTimerTick(TutorialController.TOWER_ROLES_MIN_DURATION + 0.1);
        controller.onDispatch(['a', 'b'], 'c');
      }).not.toThrow();
      expect(controller.isCompleted).toBe(true);
    });

    it('non-positive and non-finite timer ticks are ignored', () => {
      const { controller } = createController();
      controller.onDispatch(['p_base'], 'n_bot_left');
      controller.onPreviewShown();
      controller.onTimerTick(0);
      controller.onTimerTick(-5);
      controller.onTimerTick(Number.POSITIVE_INFINITY);
      expect(controller.currentStepId).toBe('preview_result');
    });

    it('performAllGuidedActions helper drives full completion', () => {
      const { controller } = createController();
      performAllGuidedActions(controller);
      expect(controller.isCompleted).toBe(true);
      expect(TUTORIAL_STEPS.length).toBe(4);
    });
  });
});

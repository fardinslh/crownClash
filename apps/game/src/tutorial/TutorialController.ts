/**
 * Crown Clash — First-Session Battle Tutorial Controller
 *
 * Framework-free state machine governing the guided first-battle tutorial.
 * This module has zero Phaser dependency and is fully unit-testable.
 *
 * Steps:
 *   drag_to_attack  → Player dispatches from any owned tower
 *   preview_result  → Auto-advances after first dispatch preview (or timed)
 *   tower_roles     → Auto-advances after first player capture
 *   multi_dispatch  → Player dispatches from 2+ sources
 *   (complete)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const TUTORIAL_STEPS = [
  'drag_to_attack',
  'preview_result',
  'tower_roles',
  'multi_dispatch',
] as const;

export type TutorialStepId = (typeof TUTORIAL_STEPS)[number];

export interface TutorialStepInfo {
  id: TutorialStepId;
  /** Short instruction shown in the overlay bubble. */
  instruction: string;
  /** Territory ID to spotlight (if any). */
  spotlightTarget?: string;
}

const STEP_DEFINITIONS: readonly TutorialStepInfo[] = [
  {
    id: 'drag_to_attack',
    instruction: 'Drag from your tower to attack!',
    spotlightTarget: 'p_base',
  },
  {
    id: 'preview_result',
    instruction: 'Badge shows WIN, TIE, or missing units',
  },
  {
    id: 'tower_roles',
    instruction: 'DEF shields • PROD trains • SPD marches',
  },
  {
    id: 'multi_dispatch',
    instruction: 'Drag across towers for a combo attack!',
  },
];

export type TutorialEventType =
  | 'started'
  | 'step_entered'
  | 'step_completed'
  | 'completed'
  | 'skipped';

export interface TutorialEvent {
  type: TutorialEventType;
  stepId?: TutorialStepId;
}

export type TutorialEventCallback = (event: TutorialEvent) => void;

// ---------------------------------------------------------------------------
// Persistence helpers (localStorage, no server dependency)
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'crown_clash_tutorial_';

function storageKey(playerId: string): string {
  return `${STORAGE_PREFIX}${playerId}`;
}

export function isTutorialCompleted(playerId: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(storageKey(playerId)) === '1';
  } catch {
    return false;
  }
}

export function markTutorialCompleted(playerId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey(playerId), '1');
  } catch {
    // Storage unavailable in some WebViews — silently ignored.
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class TutorialController {
  private stepIndex = 0;
  private _isCompleted = false;
  private _isSkipped = false;
  private destroyed = false;
  private previewShownForCurrentStep = false;

  /** Elapsed time in the current timed step (seconds). */
  private timedElapsed = 0;
  /** Seconds to auto-advance timed steps. */
  private static readonly TIMED_STEP_DURATION = 2.5;
  /** Seconds to auto-advance tower roles explanation. */
  private static readonly TOWER_ROLES_DURATION = 4.0;

  constructor(
    private readonly playerId: string,
    private readonly onEvent: TutorialEventCallback,
  ) {
    // Fire the initial started event and enter the first step.
    this.emit({ type: 'started' });
    this.emit({ type: 'step_entered', stepId: this.currentStepId ?? undefined });
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  get isActive(): boolean {
    return !this._isCompleted && !this._isSkipped && !this.destroyed;
  }

  get isCompleted(): boolean {
    return this._isCompleted;
  }

  get currentStep(): TutorialStepInfo | null {
    if (!this.isActive) return null;
    return STEP_DEFINITIONS[this.stepIndex] ?? null;
  }

  get currentStepId(): TutorialStepId | null {
    return this.currentStep?.id ?? null;
  }

  /**
   * When true, the bot AI should be suppressed so the player can read
   * the first instruction without time pressure.
   */
  get shouldSuppressAI(): boolean {
    return this.isActive && this.stepIndex === 0;
  }

  // -----------------------------------------------------------------------
  // Gameplay event hooks — called by GameScene
  // -----------------------------------------------------------------------

  /**
   * Called when the player successfully dispatches troops.
   * @param sourceIds  Territory IDs the player dispatched from.
   * @param _targetId  Target territory ID (unused currently, reserved).
   */
  onDispatch(sourceIds: readonly string[], _targetId: string): void {
    if (!this.isActive) return;

    const step = this.currentStepId;

    if (step === 'drag_to_attack') {
      // Any valid dispatch advances past the first step.
      if (sourceIds.length >= 1) {
        this.advanceStep();
      }
      return;
    }

    if (step === 'preview_result') {
      // A second dispatch while we're showing the preview info also advances.
      this.advanceStep();
      return;
    }

    if (step === 'multi_dispatch') {
      if (sourceIds.length >= 2) {
        this.advanceStep(); // completes the tutorial
      }
      return;
    }
  }

  /**
   * Called when a territory capture resolves.
   */
  onCapture(_territoryId: string, capturedByPlayer: boolean): void {
    if (!this.isActive) return;

    if (this.currentStepId === 'tower_roles' && capturedByPlayer) {
      this.advanceStep();
    }
  }

  /**
   * Called when the drag-badge preview becomes visible to the player.
   */
  onPreviewShown(): void {
    if (!this.isActive) return;

    if (this.currentStepId === 'preview_result') {
      this.previewShownForCurrentStep = true;
    }
  }

  /**
   * Called every frame with the frame delta (seconds).
   * Used to auto-advance timed informational steps.
   */
  onTimerTick(deltaSeconds: number): void {
    if (!this.isActive) return;

    if (
      this.currentStepId === 'preview_result' &&
      this.previewShownForCurrentStep
    ) {
      this.timedElapsed += deltaSeconds;
      if (this.timedElapsed >= TutorialController.TIMED_STEP_DURATION) {
        this.advanceStep();
      }
      return;
    }

    if (this.currentStepId === 'tower_roles') {
      this.timedElapsed += deltaSeconds;
      if (this.timedElapsed >= TutorialController.TOWER_ROLES_DURATION) {
        this.advanceStep();
      }
      return;
    }
  }

  // -----------------------------------------------------------------------
  // User actions
  // -----------------------------------------------------------------------

  skip(): void {
    if (!this.isActive) return;

    const lastStepId = this.currentStepId ?? undefined;
    this._isSkipped = true;
    this.emit({ type: 'skipped', stepId: lastStepId });
    this.persist();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Prevents any further callbacks from firing. Call on scene shutdown.
   */
  destroy(): void {
    this.destroyed = true;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private advanceStep(): void {
    if (!this.isActive) return;

    const finishedStepId = this.currentStepId;
    this.stepIndex++;
    this.previewShownForCurrentStep = false;
    this.timedElapsed = 0;

    if (finishedStepId) {
      this.emit({ type: 'step_completed', stepId: finishedStepId });
    }

    if (this.stepIndex >= STEP_DEFINITIONS.length) {
      // Tutorial complete
      this._isCompleted = true;
      this.emit({ type: 'completed' });
      this.persist();
    } else {
      this.emit({ type: 'step_entered', stepId: this.currentStepId! });
    }
  }

  private persist(): void {
    markTutorialCompleted(this.playerId);
  }

  private emit(event: TutorialEvent): void {
    if (this.destroyed) return;
    try {
      this.onEvent(event);
    } catch (err) {
      console.error('[TutorialController] Event callback error:', err);
    }
  }
}

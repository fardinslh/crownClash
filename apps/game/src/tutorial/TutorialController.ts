/**
 * Crown Clash — Guided Training Battle Controller
 *
 * Framework-free state machine governing the first-play tutorial battle.
 * This module has zero Phaser dependency and is fully unit-testable. The
 * tutorial is completed by PERFORMING the four core actions with the real
 * battle controls — never by winning a match:
 *
 *   drag_to_attack  → Player dispatches from an owned tower (release)
 *   preview_result  → Player sees a WIN/TIE/-N drag-badge outcome preview
 *   tower_roles     → Player captures a territory (roles taught on capture)
 *   multi_dispatch  → Player dispatches from 2+ sources at once
 *   (complete)
 *
 * The controller is intentionally persistence-free: the battle scene owns
 * progress (resume marker) and the server owns completion (account-wide
 * flag). See TutorialStatus.ts for both.
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
    instruction: 'Drag from your blue tower to attack!',
    spotlightTarget: 'p_base',
  },
  {
    id: 'preview_result',
    instruction: 'Badge shows WIN, TIE, or missing units',
  },
  {
    id: 'tower_roles',
    instruction: 'Capture a tower! DEF shields • PROD trains • SPD marches',
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

export interface TutorialStartOptions {
  /**
   * Step index to resume from (0-3). Actions already performed in a
   * previous session are not repeated. Out-of-range values clamp to a
   * fresh start.
   */
  readonly startStep?: number;
  /**
   * Boot directly into the completed state WITHOUT emitting any events.
   * Used when the four guided actions were already performed in a previous
   * session but the server save failed: the battle scene resumes straight
   * into the save-retry flow instead of repeating the actions.
   */
  readonly resumeCompleted?: boolean;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class TutorialController {
  private stepIndex = 0;
  private _isCompleted = false;
  private _isSkipped = false;
  private destroyed = false;
  private firstCaptureOccurred = false;
  private previewShown = false;

  /** Elapsed time in the current step (seconds). */
  private stepElapsed = 0;

  /** Minimum readable display time for the preview result step. */
  public static readonly PREVIEW_RESULT_MIN_DURATION = 2.5;
  /** Minimum display time for the tower-roles step after a capture. */
  public static readonly TOWER_ROLES_MIN_DURATION = 1.5;

  constructor(
    private readonly onEvent: TutorialEventCallback,
    options: TutorialStartOptions = {},
  ) {
    if (options.resumeCompleted === true) {
      // Silent completed state for the save-retry resume path: the four
      // guided actions were genuinely performed in a previous session, so
      // no started/step events fire and no action is required again.
      this.stepIndex = STEP_DEFINITIONS.length - 1;
      this._isCompleted = true;
      return;
    }
    const requested = Math.trunc(options.startStep ?? 0);
    this.stepIndex =
      Number.isFinite(requested) && requested > 0 && requested < STEP_DEFINITIONS.length
        ? requested
        : 0;
    // Fire the initial started event and enter the (possibly resumed) step.
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

  get isSkipped(): boolean {
    return this._isSkipped;
  }

  /** Current step index; persists as the resume marker between sessions. */
  get currentStepIndex(): number {
    return this.stepIndex;
  }

  get currentStep(): TutorialStepInfo | null {
    if (!this.isActive) return null;
    return STEP_DEFINITIONS[this.stepIndex] ?? null;
  }

  get currentStepId(): TutorialStepId | null {
    return this.currentStep?.id ?? null;
  }

  /**
   * When true, the entire bot match simulation (including elapsed time and
   * bot AI) is paused so the player can read the first instruction without
   * time pressure. Only a fresh first step freezes the battle; a resumed
   * tutorial keeps running so repeated actions happen in live conditions.
   */
  get shouldPauseSimulation(): boolean {
    return this.isActive && this.stepIndex === 0;
  }

  /** Backward-compatible alias for shouldPauseSimulation. */
  get shouldSuppressAI(): boolean {
    return this.shouldPauseSimulation;
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
      // First valid dispatch completes drag_to_attack and unfreezes simulation.
      if (sourceIds.length >= 1) {
        this.advanceStep();
      }
      return;
    }

    // Dispatches during the reading/capture steps must not skip ahead: the
    // preview step requires a seen outcome badge, the roles step a capture,
    // and the final step a multi-source dispatch.
    if (step === 'preview_result' || step === 'tower_roles') {
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

    if (capturedByPlayer) {
      this.firstCaptureOccurred = true;

      // The roles step is completed by the capture itself (after a short
      // readable display beat handled by onTimerTick).
      if (this.currentStepId === 'tower_roles') {
        if (this.stepElapsed >= TutorialController.TOWER_ROLES_MIN_DURATION) {
          this.advanceStep();
        }
      }
    }
  }

  /**
   * Called when the drag-badge outcome preview (WIN/TIE/-N) becomes visible
   * to the player. Counts as the guided "outcome preview" action.
   */
  onPreviewShown(): void {
    if (!this.isActive) return;
    this.previewShown = true;
  }

  /**
   * Called every frame with the frame delta (seconds).
   * Advances the current step's minimum display duration.
   */
  onTimerTick(deltaSeconds: number): void {
    if (!this.isActive) return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.stepElapsed += deltaSeconds;

    if (this.currentStepId === 'preview_result') {
      if (
        this.previewShown &&
        this.stepElapsed >= TutorialController.PREVIEW_RESULT_MIN_DURATION
      ) {
        this.advanceStep();
      }
      return;
    }

    if (this.currentStepId === 'tower_roles') {
      if (
        this.firstCaptureOccurred &&
        this.stepElapsed >= TutorialController.TOWER_ROLES_MIN_DURATION
      ) {
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
    this.stepElapsed = 0;
    this.previewShown = false;
    this.firstCaptureOccurred = false;

    if (finishedStepId) {
      this.emit({ type: 'step_completed', stepId: finishedStepId });
    }

    if (this.stepIndex >= STEP_DEFINITIONS.length) {
      // All four guided actions performed: the tutorial is complete.
      this._isCompleted = true;
      this.emit({ type: 'completed' });
    } else {
      this.emit({ type: 'step_entered', stepId: this.currentStepId! });
    }
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

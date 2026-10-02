/**
 * Crown Clash — Guided Training Battle Controller
 *
 * Framework-free state machine governing the first-play tutorial battle
 * (Clash Royale-style: scripted, forgiving, and ending in a guaranteed
 * climactic victory over the enemy base). This module has zero Phaser
 * dependency and is fully unit-testable. The tutorial is completed by
 * PERFORMING the five guided actions with the real battle controls:
 *
 *   drag_to_attack  → Player drags from an owned tower to a highlighted
 *                     target and releases (the animated hand demonstrates
 *                     the gesture first).
 *   preview_result  → Player holds a drag over a target and reads the
 *                     ⚔ WIN/TIE/-N outcome preview badge.
 *   tower_roles     → Player captures a territory (captured towers fight
 *                     for you — roles are kept out of the bubble).
 *   multi_dispatch  → Player chains a drag through 2+ owned towers.
 *   destroy_base    → Player captures the enemy base → VICTORY
 *                     celebration, then the account-wide completion save.
 *
 * The controller is intentionally persistence-free: the battle scene owns
 * progress (resume marker) and the server owns completion (account-wide
 * flag). See TutorialStatus.ts for both.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The enemy HQ territory on the fixed training battlefield (crown_cross). */
export const TUTORIAL_ENEMY_BASE_ID = 'e_base';

export const TUTORIAL_STEPS = [
  'drag_to_attack',
  'preview_result',
  'tower_roles',
  'multi_dispatch',
  'destroy_base',
] as const;

export type TutorialStepId = (typeof TUTORIAL_STEPS)[number];

export interface TutorialStepInfo {
  id: TutorialStepId;
  /** Short, imperative instruction shown in the overlay bubble. */
  instruction: string;
  /**
   * Territory IDs to spotlight for this step (guidance sources and the
   * suggested target). The battle scene resolves live coordinates and may
   * override adaptively (see trainingGuidance.ts).
   */
  spotlightTargets: readonly string[];
  /**
   * Territory IDs in gesture order for the animated hand hint. The final
   * ID is the release target. Empty = no hand hint for this step.
   */
  hintPath: readonly string[];
}

const STEP_DEFINITIONS: readonly TutorialStepInfo[] = [
  {
    id: 'drag_to_attack',
    instruction: 'Drag from your tower to the glowing tower!',
    spotlightTargets: ['p_base', 'n_bot_left'],
    hintPath: ['p_base', 'n_bot_left'],
  },
  {
    id: 'preview_result',
    instruction: 'Hold over a target — the badge predicts WIN or LOSE!',
    spotlightTargets: ['p_base', 'n_bot_right'],
    hintPath: ['p_base', 'n_bot_right'],
  },
  {
    id: 'tower_roles',
    instruction: 'Captured towers fight for you — take another!',
    spotlightTargets: ['n_center'],
    hintPath: ['p_base', 'n_center'],
  },
  {
    id: 'multi_dispatch',
    instruction: 'COMBO! Drag through BOTH towers, then release on the target!',
    spotlightTargets: ['p_base', 'n_bot_left', 'n_center'],
    hintPath: ['p_base', 'n_bot_left', 'n_center'],
  },
  {
    id: 'destroy_base',
    instruction: 'FINISH THEM! Drag across your towers and take the enemy base!',
    spotlightTargets: ['p_base', TUTORIAL_ENEMY_BASE_ID],
    hintPath: ['p_base', TUTORIAL_ENEMY_BASE_ID],
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
   * Step index to resume from (0 to TUTORIAL_STEPS.length - 1). Actions
   * already performed in a previous session are not repeated. Out-of-range
   * values clamp to a fresh start.
   */
  readonly startStep?: number;
  /**
   * Boot directly into the completed state WITHOUT emitting any events.
   * Used when the guided actions were already performed in a previous
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
      // Silent completed state for the save-retry resume path: the guided
      // actions were genuinely performed in a previous session, so
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
    // and the final two steps a multi-source dispatch / the base capture.
    if (
      step === 'preview_result' ||
      step === 'tower_roles' ||
      step === 'destroy_base'
    ) {
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
  onCapture(territoryId: string, capturedByPlayer: boolean): void {
    if (!this.isActive) return;

    if (capturedByPlayer) {
      this.firstCaptureOccurred = true;

      // The roles step is completed by the capture itself (after a short
      // readable display beat handled by onTimerTick).
      if (this.currentStepId === 'tower_roles') {
        if (this.stepElapsed >= TutorialController.TOWER_ROLES_MIN_DURATION) {
          this.advanceStep();
        }
        return;
      }

      // Clash Royale-style climax: capturing the enemy base IS the tutorial
      // victory. It completes immediately — the victory celebration that
      // follows is the readable display beat.
      if (
        this.currentStepId === 'destroy_base' &&
        territoryId === TUTORIAL_ENEMY_BASE_ID
      ) {
        this.advanceStep();
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
      // All guided actions performed: the tutorial is complete.
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

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
  try {
    if (typeof window === 'undefined') return false;
    const storage = window.localStorage;
    if (!storage) return false;
    return storage.getItem(storageKey(playerId)) === '1';
  } catch {
    return false;
  }
}

export function markTutorialCompleted(playerId: string): void {
  try {
    if (typeof window === 'undefined') return;
    const storage = window.localStorage;
    if (!storage) return;
    storage.setItem(storageKey(playerId), '1');
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
  private firstCaptureOccurred = false;

  /** Elapsed time in preview_result step (seconds). */
  private previewElapsed = 0;
  /** Elapsed time in tower_roles step (seconds). */
  private towerRolesElapsed = 0;

  /** Minimum readable display time for the preview result step. */
  public static readonly PREVIEW_RESULT_MIN_DURATION = 2.5;
  /** Display duration for explaining tower roles. */
  public static readonly TOWER_ROLES_DURATION = 4.0;

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
   * When true, the entire bot match simulation (including elapsed time and bot AI)
   * is paused so the player can read the first instruction without time pressure.
   */
  get shouldPauseSimulation(): boolean {
    return this.isActive && this.stepIndex === 0;
  }

  /**
   * Backward-compatible alias for shouldPauseSimulation.
   */
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

    // Rule 7: A second dispatch must NOT skip preview_result before capture.
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

      // In preview_result, once minimum display duration is met AND capture occurred, enter tower_roles.
      if (
        this.currentStepId === 'preview_result' &&
        this.previewElapsed >= TutorialController.PREVIEW_RESULT_MIN_DURATION
      ) {
        this.advanceStep();
      }
    }
  }

  /**
   * Called when the drag-badge preview becomes visible to the player.
   */
  onPreviewShown(): void {
    // Retained for interface compatibility.
  }

  /**
   * Called every frame with the frame delta (seconds).
   * Used to advance timed steps when requirements are met.
   */
  onTimerTick(deltaSeconds: number): void {
    if (!this.isActive) return;

    if (this.currentStepId === 'preview_result') {
      this.previewElapsed += deltaSeconds;
      // preview_result remains visible for min duration AND waits for first capture.
      if (
        this.previewElapsed >= TutorialController.PREVIEW_RESULT_MIN_DURATION &&
        this.firstCaptureOccurred
      ) {
        this.advanceStep();
      }
      return;
    }

    if (this.currentStepId === 'tower_roles') {
      this.towerRolesElapsed += deltaSeconds;
      if (this.towerRolesElapsed >= TutorialController.TOWER_ROLES_DURATION) {
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
    this.previewElapsed = 0;
    this.towerRolesElapsed = 0;

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

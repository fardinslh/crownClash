/**
 * Crown Clash — Tutorial completion status, legacy migration, and entry
 * gating (framework-free, unit-testable).
 *
 * Ownership rules:
 *   - The SERVER owns tutorial completion as an account-wide flag (the
 *     players row). The server gates bot matches and matchmaker tickets on
 *     it, but it does NOT replay or verify the training actions: the flag
 *     is written when an authenticated client reports training completion
 *     (honest-client trust — see the security note below).
 *   - The client owns only a per-player TRAINING PROGRESS marker so an
 *     interrupted tutorial resumes at the last unfinished guided action,
 *     and so a completed-but-unsaved tutorial retries the save without
 *     repeating the guided actions.
 *   - The legacy per-player localStorage completion marker written by the
 *     retired War Academy flow is migrated to the server exactly once:
 *     on success it is consumed (removed), on failure it survives so the
 *     next launch retries. It is never written by the new flow.
 *
 * Failure policy: every failure mode resolves to "tutorial not completed"
 * (fail-closed). A player is never falsely marked complete by a login or
 * save failure.
 *
 * Security note (honest boundary): any authenticated client can call
 * tutorial/complete directly; the server trusts the client's claim that
 * the guided actions were performed. This is acceptable because the
 * tutorial carries no rewards or economy value — it only gates first
 * entry into bot/PvP matchmaking. Do not describe this as "verified
 * training"; it is an account-wide flag written after honest-client
 * training.
 */

import type { BotMatchTicket } from '@crown-clash/game-core';
import type { TutorialStepId } from './TutorialController.js';
import { TUTORIAL_STEPS } from './TutorialController.js';

const LEGACY_MARKER_PREFIX = 'crown_clash_tutorial_';
const TRAINING_PROGRESS_PREFIX = 'crown_clash_training_progress_';

export const TRAINING_BATTLEFIELD_ID = 'crown_cross';

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy completion marker (War Academy graduates) — read + consume only
// ---------------------------------------------------------------------------

export function legacyMarkerKey(playerId: string): string {
  return `${LEGACY_MARKER_PREFIX}${playerId}`;
}

export function readLegacyTutorialMarker(playerId: string): boolean {
  try {
    return safeStorage()?.getItem(legacyMarkerKey(playerId)) === '1';
  } catch {
    return false;
  }
}

export function clearLegacyTutorialMarker(playerId: string): void {
  try {
    safeStorage()?.removeItem(legacyMarkerKey(playerId));
  } catch {
    // Storage unavailable in some WebViews — the server flag is what
    // matters; a stale marker only causes a harmless no-op migration.
  }
}

// ---------------------------------------------------------------------------
// Training progress marker (resume an interrupted or unsaved tutorial)
// ---------------------------------------------------------------------------

export function trainingProgressKey(playerId: string): string {
  return `${TRAINING_PROGRESS_PREFIX}${playerId}`;
}

/**
 * Progress sentinel: all guided actions were performed, but the
 * server save has not succeeded yet. A launch with this marker resumes
 * straight into the save-retry flow — the actions are never repeated.
 */
export const TRAINING_ACTIONS_COMPLETE = TUTORIAL_STEPS.length;

export function saveTrainingProgress(playerId: string, stepIndex: number): void {
  try {
    safeStorage()?.setItem(trainingProgressKey(playerId), String(stepIndex));
  } catch {
    // Resume is best-effort: without storage the tutorial restarts at 0.
  }
}

/**
 * Loads the resume state: a step index (0 to TUTORIAL_STEPS.length - 1) to
 * resume at, TRAINING_ACTIONS_COMPLETE = actions done, save pending.
 * Anything corrupt or out of range resolves to a fresh start (0).
 */
export function loadTrainingProgress(playerId: string): number {
  try {
    const raw = safeStorage()?.getItem(trainingProgressKey(playerId));
    const parsed = Number.parseInt(raw ?? '0', 10);
    if (
      Number.isFinite(parsed) &&
      parsed >= 0 &&
      parsed <= TRAINING_ACTIONS_COMPLETE
    ) {
      return parsed;
    }
  } catch {
    // Fall through to a fresh start.
  }
  return 0;
}

export function clearTrainingProgress(playerId: string): void {
  try {
    safeStorage()?.removeItem(trainingProgressKey(playerId));
  } catch {
    // Ignored.
  }
}

// ---------------------------------------------------------------------------
// Training match ticket (local only — never settled, never rewarded)
// ---------------------------------------------------------------------------

/**
 * A training battle is a client-local bot match: no server ticket, no
 * settlement, no economy. It uses the fixed crown_cross battlefield so the
 * guided spotlight target (p_base) always exists.
 */
export function createTrainingTicket(now = Date.now()): BotMatchTicket {
  return {
    matchId: `training_${now}_${Math.random().toString(36).slice(2, 10)}`,
    battlefieldId: TRAINING_BATTLEFIELD_ID,
  };
}

// ---------------------------------------------------------------------------
// Server status + legacy migration
// ---------------------------------------------------------------------------

/** Minimal API surface needed for tutorial status and completion. */
export interface TutorialCompletionApi {
  /**
   * Marks the tutorial complete on the server. Resolves on success and
   * rejects on failure; the resolved value is caller-specific (the full
   * API also returns the fresh career).
   */
  completeTutorial(): Promise<unknown>;
}

export interface TutorialHydrationResult {
  readonly completed: boolean;
  /** True when a legacy local marker was successfully migrated this launch. */
  readonly migrated: boolean;
}

/**
 * Resolves the account-wide tutorial status after login and migrates a
 * legacy War Academy marker to the server exactly once.
 *
 * Precondition: `serverCompleted` is the SERVER-known status (never a local
 * guess). Callers must obtain it from the authenticated career payload.
 */
export async function migrateLegacyTutorialMarker(
  api: TutorialCompletionApi,
  playerId: string,
  serverCompleted: boolean
): Promise<TutorialHydrationResult> {
  if (serverCompleted) {
    // Already complete account-wide (e.g. a graduate's second device).
    // Consume any stale local marker so migration cannot re-run no-ops.
    clearLegacyTutorialMarker(playerId);
    clearTrainingProgress(playerId);
    return { completed: true, migrated: false };
  }
  if (!readLegacyTutorialMarker(playerId)) {
    return { completed: false, migrated: false };
  }
  try {
    await api.completeTutorial();
  } catch {
    // Migration failed (network/server): keep the marker and stay
    // incomplete — the next launch retries. Never falsely complete.
    return { completed: false, migrated: false };
  }
  clearLegacyTutorialMarker(playerId);
  clearTrainingProgress(playerId);
  return { completed: true, migrated: true };
}

// ---------------------------------------------------------------------------
// Entry gating (menu / first launch)
// ---------------------------------------------------------------------------

export type MenuEntryAction = 'auto_training' | 'menu';
export type PlayEntryAction = 'training' | 'bot';
export type PvpEntryAction = 'training' | 'pvp';

/**
 * First-launch policy: an incomplete tutorial auto-starts the training
 * battle once per session (a skipped training returns to the menu without
 * bouncing straight back). This is a UX routing gate, not a security
 * control — the security boundary is the server-side bot/matchmaker gate
 * on the account-wide flag.
 */
export function resolveMenuEntryAction(
  tutorialCompleted: boolean,
  trainingAlreadyLaunchedThisSession: boolean
): MenuEntryAction {
  return !tutorialCompleted && !trainingAlreadyLaunchedThisSession
    ? 'auto_training'
    : 'menu';
}

/** Ordinary bot entry: an incomplete tutorial is always routed to training first. */
export function resolvePlayEntryAction(tutorialCompleted: boolean): PlayEntryAction {
  return tutorialCompleted ? 'bot' : 'training';
}

/** PvP (1v1 and 2v2) entry: same first-entry routing as bot entry. */
export function resolvePvpEntryAction(tutorialCompleted: boolean): PvpEntryAction {
  return tutorialCompleted ? 'pvp' : 'training';
}

// ---------------------------------------------------------------------------
// Analytics helpers (event names are stable production contracts)
// ---------------------------------------------------------------------------

export function tutorialQuitEvent(lastStepId: TutorialStepId | null): {
  name: 'tutorial_skipped';
  lastStepId: TutorialStepId;
} {
  return { name: 'tutorial_skipped', lastStepId: lastStepId ?? 'drag_to_attack' };
}

export type TutorialMenuAnalyticsEvent =
  | { name: 'tutorial_menu_opened' }
  | { name: 'tutorial_menu_closed' }
  | { name: 'tutorial_leave_requested' }
  | { name: 'tutorial_leave_cancelled' };

/**
 * Remaps the match menu controller's navigation analytics for the guided
 * training battle. Training is not a match: ordinary match_* menu events
 * are suppressed and replaced with the tutorial equivalents so analytics
 * never reports a fake bot match around the tutorial. Unknown/future
 * match_* events map to null (suppressed).
 */
export function remapTrainingMenuAnalytics(
  event: { name: string }
): TutorialMenuAnalyticsEvent | null {
  switch (event.name) {
    case 'match_menu_opened':
      return { name: 'tutorial_menu_opened' };
    case 'match_resumed':
      return { name: 'tutorial_menu_closed' };
    case 'match_leave_requested':
      return { name: 'tutorial_leave_requested' };
    case 'match_leave_cancelled':
      return { name: 'tutorial_leave_cancelled' };
    default:
      return null;
  }
}

/**
 * 3-2-1-GO before a bot battle. Matches used to start mid-motion with only a
 * small map label, so the first seconds had no "the fight begins" moment.
 *
 * The bot simulation runs on a logical clock that the server replays from
 * recorded actions, so holding it during the countdown changes no outcome —
 * the same thing the pause menu already does. Live PvP has no server
 * countdown, so it never gets a blocking intro.
 */
export type IntroPhase = 3 | 2 | 1 | 'go' | 'done';

export interface IntroStep {
  readonly phase: IntroPhase;
  readonly atMs: number;
}

export const INTRO_STEP_MS = 600;
/** How long the GO stamp stays up; the battle is already running under it. */
export const INTRO_GO_MS = 450;

export function matchIntroSchedule(stepMs = INTRO_STEP_MS, goMs = INTRO_GO_MS): IntroStep[] {
  return [
    { phase: 3, atMs: 0 },
    { phase: 2, atMs: stepMs },
    { phase: 1, atMs: stepMs * 2 },
    { phase: 'go', atMs: stepMs * 3 },
    { phase: 'done', atMs: stepMs * 3 + goMs },
  ];
}

/** True while the battle must not advance or accept orders. */
export function isIntroHolding(phase: IntroPhase): boolean {
  return phase === 3 || phase === 2 || phase === 1;
}

export interface IntroEligibility {
  readonly liveMode: boolean;
  readonly trainingMode: boolean;
  readonly stressMode: boolean;
  /** A resumed battle (e.g. a saved Realm attack) is already under way. */
  readonly elapsedSeconds: number;
}

/**
 * Bot, practice and Realm battles get the countdown. Training keeps its
 * own frozen first step, stress/benchmark runs need a deterministic start,
 * and a resumed battle must not count down again.
 */
export function shouldPlayMatchIntro(input: IntroEligibility): boolean {
  return !input.liveMode && !input.trainingMode && !input.stressMode && input.elapsedSeconds <= 0;
}

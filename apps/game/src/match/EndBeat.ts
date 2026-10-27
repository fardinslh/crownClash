/**
 * The moment a bot battle ends. The server replays the match and decides
 * the result, so the client must not announce a winner first — but waiting
 * silently behind a "syncing" card threw away the climax. The end beat is an
 * outcome-neutral stamp with a factual cause, shown while settlement is
 * already in flight; the syncing card appears only if the server is slower.
 */
export type LocalEndCause = 'time_up' | 'eliminated';

export const END_BEAT_MS = 1100;

export function resolveLocalEndCause(input: { elapsedSeconds: number; timeLimitSeconds: number }): LocalEndCause {
  return input.elapsedSeconds >= input.timeLimitSeconds ? 'time_up' : 'eliminated';
}

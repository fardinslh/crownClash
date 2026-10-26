/**
 * How long the 1v1 live queue waits for a real opponent before the game
 * switches the player to a bot match. Balanced against the live-queue
 * abandon rate (`live_queue_joined` vs `live_queue_fallback`): long enough for
 * two players who queue together to meet, short enough to stay under the
 * "empty game" patience of a short mobile session.
 */
export const LIVE_QUEUE_BOT_FALLBACK_SECONDS = 15;

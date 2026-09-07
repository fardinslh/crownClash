import { GameApiClient } from './GameApiClient.js';

let sharedClient: GameApiClient | null = null;

/**
 * Returns the process-wide API client so the session token is shared by
 * every consumer (career manager, analytics sink, live matches) instead of
 * each module performing its own login.
 */
export function getSharedGameApiClient(): GameApiClient {
  if (!sharedClient) {
    sharedClient = new GameApiClient();
  }
  return sharedClient;
}

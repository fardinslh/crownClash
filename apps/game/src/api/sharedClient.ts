import { NakamaClient } from './NakamaClient.js';
import type { CareerApi } from './GameApiClient.js';

let sharedClient: NakamaClient | null = null;

/**
 * Returns the process-wide Nakama client so the session and socket are
 * shared by every consumer (career manager, analytics sink, live matches)
 * instead of each module performing its own login.
 */
export function getSharedGameApiClient(): CareerApi {
  if (!sharedClient) {
    sharedClient = new NakamaClient();
  }
  return sharedClient;
}

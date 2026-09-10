import type { UpgradeFailureReason, UpgradeType } from '@crown-clash/game-core';
import type { TutorialStepId } from '../tutorial/TutorialController.js';

export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_EVENT_NAME_MAX_LENGTH = 64;
export const ANALYTICS_PROPERTY_MAX_COUNT = 16;
export const ANALYTICS_PROPERTY_KEY_MAX_LENGTH = 64;
export const ANALYTICS_PROPERTY_STRING_MAX_LENGTH = 256;

type AnalyticsPrimitive = string | number | boolean;

export type AnalyticsEventInput =
  | { name: 'session_start' }
  | { name: 'menu_viewed'; rankId: string }
  | {
      name: 'match_start';
      matchId: string;
      mode: 'bot' | 'live';
      source: 'menu' | 'rematch';
    }
  | {
      name: 'match_end';
      matchId: string;
      mode: 'bot' | 'live';
      result: 'victory' | 'defeat' | 'draw';
      durationSeconds: number;
    }
  | {
      name: 'match_quit';
      matchId: string;
      mode: 'live';
      durationSeconds: number;
    }
  | { name: 'match_reward_received'; matchId: string; mode: 'bot' | 'live' }
  | { name: 'upgrade_panel_viewed'; source: 'menu' | 'result' }
  | { name: 'upgrade_purchase_succeeded'; purchaseId: string }
  | {
      name: 'upgrade_purchase_failed';
      upgradeType: UpgradeType;
      reason: UpgradeFailureReason;
    }
  | { name: 'daily_panel_viewed' }
  | { name: 'daily_reward_claimed'; claimId: string }
  | { name: 'league_panel_viewed' }
  | { name: 'league_reward_claimed'; claimId: string }
  | { name: 'commander_panel_viewed' }
  | { name: 'commander_selected'; commanderId: 'crown_guard' | 'quartermaster' | 'vanguard' }
  | { name: 'rank_promoted'; matchId: string }
  | { name: 'live_queue_joined' }
  | { name: 'live_invite_created' }
  | { name: 'live_invite_joined' }
  | { name: 'live_match_started'; matchId: string }
  | {
      name: 'live_match_ended';
      matchId: string;
      status: 'victory' | 'defeat' | 'draw';
    }
  | { name: 'live_match_disconnected'; matchId: string }
  | { name: 'tutorial_started' }
  | { name: 'tutorial_step_completed'; stepId: TutorialStepId }
  | { name: 'tutorial_completed' }
  | { name: 'tutorial_skipped'; lastStepId: TutorialStepId };

export type UpgradeAnalyticsEvent = Extract<
  AnalyticsEventInput,
  { name: 'upgrade_panel_viewed' | 'upgrade_purchase_succeeded' | 'upgrade_purchase_failed' }
>;

export interface AnalyticsEvent {
  eventId: string;
  name: AnalyticsEventInput['name'];
  sessionId: string;
  occurredAt: number;
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  props: Record<string, AnalyticsPrimitive>;
}

const EVENT_NAMES: ReadonlySet<AnalyticsEvent['name']> = new Set([
  'session_start',
  'menu_viewed',
  'match_start',
  'match_end',
  'match_quit',
  'match_reward_received',
  'upgrade_panel_viewed',
  'upgrade_purchase_succeeded',
  'upgrade_purchase_failed',
  'daily_panel_viewed',
  'daily_reward_claimed',
  'league_panel_viewed',
  'league_reward_claimed',
  'commander_panel_viewed',
  'commander_selected',
  'rank_promoted',
  'live_queue_joined',
  'live_invite_created',
  'live_invite_joined',
  'live_match_started',
  'live_match_ended',
  'live_match_disconnected',
  'tutorial_started',
  'tutorial_step_completed',
  'tutorial_completed',
  'tutorial_skipped',
]);

const sessionId = createIdentifier('session');
let sessionStarted = false;
const terminalMatchIds = new Set<string>();

function createIdentifier(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function isPrimitive(value: unknown): value is AnalyticsPrimitive {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<AnalyticsEvent>;
  if (
    typeof event.eventId !== 'string' ||
    event.eventId.length === 0 ||
    typeof event.sessionId !== 'string' ||
    event.sessionId.length === 0 ||
    typeof event.occurredAt !== 'number' ||
    !Number.isFinite(event.occurredAt) ||
    event.schemaVersion !== ANALYTICS_SCHEMA_VERSION ||
    typeof event.name !== 'string' ||
    !EVENT_NAMES.has(event.name as AnalyticsEvent['name']) ||
    !event.props ||
    typeof event.props !== 'object' ||
    Array.isArray(event.props)
  ) {
    return false;
  }

  const properties = Object.entries(event.props);
  return (
    properties.length <= ANALYTICS_PROPERTY_MAX_COUNT &&
    properties.every(
      ([key, property]) =>
        key.length > 0 &&
        key.length <= ANALYTICS_PROPERTY_KEY_MAX_LENGTH &&
        isPrimitive(property) &&
        (typeof property !== 'string' || property.length <= ANALYTICS_PROPERTY_STRING_MAX_LENGTH)
    )
  );
}

export function trackEvent(event: AnalyticsEventInput): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  const { name, ...props } = event;
  window.dispatchEvent(
    new CustomEvent<AnalyticsEvent>('crown-clash:analytics', {
      detail: {
        eventId: createIdentifier('event'),
        name,
        sessionId,
        occurredAt: Date.now(),
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        props,
      },
    })
  );
}

export function trackSessionStart(): void {
  if (sessionStarted) return;
  sessionStarted = true;
  trackEvent({ name: 'session_start' });
}

/**
 * Returns false when an earlier terminal event already represents this match.
 */
export function trackTerminalMatchEvent(
  event: Extract<AnalyticsEventInput, { name: 'match_end' | 'match_quit' }>
): boolean {
  if (terminalMatchIds.has(event.matchId)) return false;
  terminalMatchIds.add(event.matchId);
  trackEvent(event);
  return true;
}

export function trackUpgradeEvent(event: UpgradeAnalyticsEvent): void {
  trackEvent(event);
}

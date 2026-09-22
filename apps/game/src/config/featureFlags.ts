/**
 * Client feature flags.
 *
 * The 2v2 flag is the Phase 4 rollout boundary (docs/2v2-architecture.md
 * Phase 4/8): it is read once at startup, defaults to false, and must be
 * queried before any 2v2 entry point is shown (Phase 5). When false, no 2v2
 * matchmaker ticket can ever be submitted — the client networking layer
 * double-checks this flag at ticket time. Remote-config wiring arrives in
 * Phase 8; the flag is inert until then and never enables itself.
 */

export interface FeatureFlags {
  readonly enable2v2: boolean;
}

export type FeatureFlagEnvironment = {
  readonly VITE_ENABLE_2V2?: string;
};

export function resolveFeatureFlags(env: FeatureFlagEnvironment | undefined = undefined): FeatureFlags {
  const source: FeatureFlagEnvironment =
    env ??
    (typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as unknown as FeatureFlagEnvironment)
      : {});
  return {
    // Opt-in string, not truthy coercion: absent, empty, or any value other
    // than exactly 'true' keeps 2v2 disabled.
    enable2v2: source.VITE_ENABLE_2V2 === 'true',
  };
}

/** Process-wide snapshot Phase 5 can query before showing a 2v2 entry. */
export const featureFlags: FeatureFlags = resolveFeatureFlags();

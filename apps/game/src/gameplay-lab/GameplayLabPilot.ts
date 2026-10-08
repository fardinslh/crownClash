import { ENGAGEMENT_VARIANTS, type EngagementVariant, type LabBattleRecord } from '@crown-clash/game-core';
export const LAB_STORAGE_KEY = 'crown_clash_gameplay_lab_v3';
export const LAB_NAMES: Record<EngagementVariant, string> = {
    capture_recovery: 'C · Recovery', capture_recovery_targets: 'D · Hadaf',
    capture_recovery_tactical: 'E · Tactical', capture_recovery_upgrade: 'F · Investment',
};
const [C, D, E, F] = ENGAGEMENT_VARIANTS;
export const LAB_ORDERS: readonly (readonly EngagementVariant[])[] = [
    [C, D, E, F], [D, E, F, C], [E, F, C, D], [F, C, D, E], [C, F, E, D], [D, C, F, E],
];
export function pilotOrder(participant: number): EngagementVariant[] {
    const first = LAB_ORDERS[participant - 1];
    if (!first)
        throw new Error('invalid_lab_participant');
    return [...first, ...[...first].reverse()];
}
export interface LabRatings {
    repetition: number;
    earlyDecided: number;
    unfair: number;
}
export interface LabTrial {
    id: string;
    participant: number;
    kind: 'main' | 'practice' | 'optional';
    pilotIndex?: number;
    retryOf?: string;
    battle: LabBattleRecord;
    ratings?: LabRatings;
    events: Array<{
        name: 'start' | 'end' | 'quit' | 'retry' | 'offer_shown' | 'offer_replay' | 'offer_continue';
        tick: number;
    }>;
}
export interface LabReplayOffer {
    participant: number;
    variant: EngagementVariant;
    trialId: string;
    decision?: 'replay' | 'continue';
}
export interface LabData {
    schemaVersion: 3;
    trials: LabTrial[];
    preferences: Record<string, EngagementVariant>;
    reflections: Record<string, string>;
    offers: LabReplayOffer[];
}
export const successfulMainTrials = (data: LabData, participant: number): LabTrial[] => data.trials
    .filter((t) => t.participant === participant && t.kind === 'main' && t.battle.result !== 'quit')
    .sort((a, b) => a.pilotIndex! - b.pilotIndex!);
export function nextPilotIndex(data: LabData, participant: number): number {
    const main = successfulMainTrials(data, participant);
    let index = 0;
    while (main.some((t) => t.pilotIndex === index))
        index++;
    return index;
}
const median = (values: number[]): number | null => {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export function labReport(data: LabData) {
    const variants = ENGAGEMENT_VARIANTS.map((variant) => {
        const trials = data.trials.filter((t) => t.battle.variant === variant);
        const main = trials.filter((t) => t.kind === 'main' && t.battle.result !== 'quit');
        const rated = main.filter((t) => t.ratings);
        const offers = data.offers.filter((o) => o.variant === variant);
        const dispatches = trials.flatMap((t) => t.battle.actions.filter((a) => a.type === 'dispatch'));
        return { variant, matches: trials.length, mainMatches: main.length,
            practiceMatches: trials.filter((t) => t.kind === 'practice').length,
            optionalMatches: trials.filter((t) => t.kind === 'optional').length,
            quits: trials.filter((t) => t.battle.result === 'quit').length,
            offersShown: offers.length, offersAnswered: offers.filter((o) => o.decision).length,
            replayParticipants: new Set(offers.filter((o) => o.decision === 'replay').map((o) => o.participant)).size,
            medianRepetition: median(rated.map((t) => t.ratings!.repetition)),
            medianEarlyDecided: median(rated.map((t) => t.ratings!.earlyDecided)),
            medianUnfair: median(rated.map((t) => t.ratings!.unfair)),
            medianDurationSeconds: median(main.map((t) => t.battle.durationSeconds)),
            wins: main.filter((t) => t.battle.result === 'victory').length,
            upgrades: trials.flatMap((t) => t.battle.actions).filter((a) => a.type === 'upgrade').length,
            upgradeTimings: trials.flatMap((t) => t.battle.actions.flatMap((a) => a.type === 'upgrade'
                ? [{ trialId: t.id, kind: t.kind, owner: a.owner, territoryId: a.territoryId, seconds: a.tick * 0.02 }] : [])),
            openings: [...new Set(main.map((t) => t.battle.actions.filter((a) => a.type === 'dispatch' && a.owner === 'player').slice(0, 3)
                    .map((a) => a.type === 'dispatch' ? `${a.sourceId}>${a.targetId}` : '').join('|')))].filter(Boolean),
            dispatches: dispatches.length,
            reinforcements: dispatches.filter((a) => a.type === 'dispatch' && a.reinforcement).length,
            counterattacks: dispatches.filter((a) => a.type === 'dispatch' && a.counterattack).length,
            medianLastLeadChangeSeconds: median(main.map((t) => t.battle.lastLeadChangeSeconds)),
        };
    });
    const complete = Array.from({ length: 6 }, (_, i) => i + 1).every((p) => {
        const main = successfulMainTrials(data, p);
        return main.length === 8 && main.every((t) => t.ratings) && Boolean(data.preferences[p]) && Boolean(data.reflections[p]?.trim()) &&
            ENGAGEMENT_VARIANTS.every((v) => data.offers.some((o) => o.participant === p && o.variant === v && o.decision));
    });
    const baseline = variants[0];
    const candidates = complete ? variants.slice(1).filter((v) => Object.values(data.preferences).filter((p) => p === v.variant).length >= 4 && v.replayParticipants >= baseline.replayParticipants + 2 &&
        v.medianRepetition! <= baseline.medianRepetition! && v.medianEarlyDecided! <= baseline.medianEarlyDecided! && v.medianUnfair! <= baseline.medianUnfair!)
        .map((v) => v.variant) : [];
    return { complete, candidates, variants, note: 'Six-person pilot only; voluntary replay is not proof of retention.' };
}

import { ENGAGEMENT_VARIANTS, type EngagementVariant, type LabBattleRecord } from '@crown-clash/game-core';
export const LAB_STORAGE_KEY = 'crown_clash_gameplay_lab_v4';
export const LAB_NAMES: Record<EngagementVariant, string> = { capture_recovery: 'C · Recovery' };
export const LAB_MAIN_MATCHES_PER_PARTICIPANT = 2;
export function pilotOrder(participant: number): EngagementVariant[] {
    if (!Number.isInteger(participant) || participant < 1 || participant > 6) throw new Error('invalid_lab_participant');
    return ['capture_recovery', 'capture_recovery'];
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
    schemaVersion: 4;
    trials: LabTrial[];
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
        return main.length === LAB_MAIN_MATCHES_PER_PARTICIPANT && main.every((t) => t.ratings) && Boolean(data.reflections[p]?.trim()) &&
            ENGAGEMENT_VARIANTS.every((v) => data.offers.some((o) => o.participant === p && o.variant === v && o.decision));
    });
    return { complete, candidates: [] as EngagementVariant[], variants, note: 'C only; no comparison or retention winner can be inferred.' };
}

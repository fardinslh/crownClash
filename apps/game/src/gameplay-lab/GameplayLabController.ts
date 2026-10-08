import { GameplayLabBattle, isEngagementVariant, type EngagementVariant } from '@crown-clash/game-core';
import { LAB_STORAGE_KEY, labReport, nextPilotIndex, pilotOrder, successfulMainTrials, type LabData, type LabRatings, type LabReplayOffer, type LabTrial } from './GameplayLabPilot.js';
import { readLabData } from './GameplayLabValidation.js';
export * from './GameplayLabPilot.js';
export interface LabStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
const ratingsValid = (ratings: LabRatings) => [ratings.repetition, ratings.earlyDecided, ratings.unfair].every((n) => Number.isInteger(n) && n >= 1 && n <= 5);
/** Local experiment persistence only: no career, API or production analytics dependencies. */
export class GameplayLabStore {
    participant = 1;
    data: LabData = { schemaVersion: 3, trials: [], preferences: {}, reflections: {}, offers: [] };
    error = '';
    constructor(private readonly storage?: LabStorage) {
        if (!storage) {
            this.error = 'Zakhire-ye local dar dastres nist; JSON ro export kon.';
            return;
        }
        try {
            const saved = storage.getItem(LAB_STORAGE_KEY);
            if (saved)
                this.data = readLabData(saved);
        }
        catch {
            this.error = 'Data-ye ghabli load nashod. Export-e in session dar dastres-e.';
        }
    }
    save(): void {
        if (!this.storage)
            return;
        try {
            this.storage.setItem(LAB_STORAGE_KEY, JSON.stringify(this.data));
            this.error = '';
        }
        catch {
            this.error = 'Zakhire-ye local nashod. Ghabl az bastan, JSON ro export kon.';
        }
    }
    exportJson(): string { return JSON.stringify({ ...this.data, report: labReport(this.data) }, null, 2); }
    importJson(json: string): void {
        const imported = readLabData(json);
        const merged = new Map(this.data.trials.map((t) => [t.id, t]));
        for (const trial of imported.trials) {
            const previous = merged.get(trial.id);
            if (previous && (previous.participant !== trial.participant || previous.battle.variant !== trial.battle.variant ||
                previous.kind !== trial.kind || previous.pilotIndex !== trial.pilotIndex || previous.retryOf !== trial.retryOf))
                throw new Error('conflicting_lab_trial');
            merged.set(trial.id, trial);
        }
        const offers = new Map(this.data.offers.map((o) => [`${o.participant}:${o.variant}`, o]));
        for (const offer of imported.offers) {
            const key = `${offer.participant}:${offer.variant}`, previous = offers.get(key);
            if (previous && (previous.trialId !== offer.trialId || (previous.decision && previous.decision !== offer.decision)))
                throw new Error('conflicting_lab_offer');
            offers.set(key, offer);
        }
        const candidate: LabData = { schemaVersion: 3, trials: [...merged.values()], offers: [...offers.values()],
            preferences: { ...this.data.preferences, ...imported.preferences }, reflections: { ...this.data.reflections, ...imported.reflections } };
        this.data = readLabData(JSON.stringify(candidate));
        this.save();
    }
    pendingRating(participant = this.participant): LabTrial | undefined {
        return successfulMainTrials(this.data, participant).find((t) => !t.ratings);
    }
    pendingOffer(participant = this.participant): LabReplayOffer | undefined {
        return this.data.offers.find((o) => o.participant === participant && !o.decision);
    }
    nextVariant(participant = this.participant): EngagementVariant | undefined {
        return pilotOrder(participant)[nextPilotIndex(this.data, participant)];
    }
    rateTrial(trial: LabTrial, ratings: LabRatings): void {
        if (!this.data.trials.includes(trial) || !ratingsValid(ratings))
            throw new Error('invalid_lab_ratings');
        trial.ratings = ratings;
        const main = successfulMainTrials(this.data, trial.participant).filter((t) => t.battle.variant === trial.battle.variant);
        if (trial.kind === 'main' && trial.battle.result !== 'quit' && main.length === 2 && main.every((t) => t.ratings) &&
            !this.data.offers.some((o) => o.participant === trial.participant && o.variant === trial.battle.variant)) {
            const second = main[1];
            this.data.offers.push({ participant: trial.participant, variant: trial.battle.variant as EngagementVariant, trialId: second.id });
            second.events.push({ name: 'offer_shown', tick: Math.round(second.battle.durationSeconds / 0.02) });
        }
        this.save();
    }
    respondOffer(offer: LabReplayOffer, decision: 'replay' | 'continue'): void {
        if (!this.data.offers.includes(offer) || offer.decision || !['replay', 'continue'].includes(decision))
            throw new Error('invalid_lab_offer');
        const trial = this.data.trials.find((t) => t.id === offer.trialId);
        if (!trial)
            throw new Error('invalid_lab_offer');
        offer.decision = decision;
        trial.events.push({ name: `offer_${decision}`, tick: Math.round(trial.battle.durationSeconds / 0.02) });
        this.save();
    }
}
export class GameplayLabController {
    readonly battle: GameplayLabBattle;
    readonly trial: LabTrial;
    private finished = false;
    constructor(readonly store: GameplayLabStore, participant: number, readonly variant: EngagementVariant, retryOf?: string, kind: LabTrial['kind'] = 'practice') {
        if (!Number.isInteger(participant) || participant < 1 || participant > 6)
            throw new Error('invalid_lab_participant');
        if (!isEngagementVariant(variant))
            throw new Error('invalid_lab_variant');
        const index = nextPilotIndex(store.data, participant);
        if (kind === 'main' && (retryOf || store.pendingRating(participant) || store.pendingOffer(participant) || pilotOrder(participant)[index] !== variant))
            throw new Error('invalid_lab_pilot_start');
        this.battle = new GameplayLabBattle(variant);
        this.trial = { id: crypto.randomUUID?.() ?? `lab_${Date.now()}_${Math.random().toString(36).slice(2)}`, participant, kind,
            ...(kind === 'main' ? { pilotIndex: index } : {}), ...(retryOf ? { retryOf } : {}),
            battle: this.battle.record, events: [{ name: 'start', tick: 0 }] };
    }
    finish(quit = false): void {
        if (this.finished)
            return;
        if (quit)
            this.battle.quit();
        else if (this.battle.state.status === 'playing')
            throw new Error('lab_match_still_playing');
        this.finished = true;
        this.trial.events.push({ name: this.battle.record.result === 'quit' ? 'quit' : 'end', tick: this.battle.tick });
        this.store.data.trials.push(this.trial);
        this.store.save();
    }
    rate(ratings: LabRatings): void {
        if (!this.finished)
            throw new Error('invalid_lab_ratings');
        this.store.rateTrial(this.trial, ratings);
    }
    retry(): void {
        if (!this.finished)
            throw new Error('lab_match_still_playing');
        this.trial.events.push({ name: 'retry', tick: this.battle.tick });
        this.store.save();
    }
}
export function isGameplayLabRequested(development: boolean, search: string): boolean {
    return development && new URLSearchParams(search).get('gameplay_lab') === '1';
}

import { ENGAGEMENT_VARIANTS, LAB_RULES_VERSION, LAB_TICK_SECONDS, getBattlefield, replayGameplayLab, type LabBattleRecord } from '@crown-clash/game-core';
import { pilotOrder, successfulMainTrials, type LabData } from './GameplayLabPilot.js';
const labVariants = new Set<unknown>(ENGAGEMENT_VARIANTS);
const labTerritories = new Set(getBattlefield('crown_cross').territories.map((t) => t.id));
const objectValid = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const textValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const participantValid = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
const unitsValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ownerValid = (value: unknown) => value === 'player' || value === 'enemy';
const teamValid = (value: unknown) => value === 'neutral' || ownerValid(value);
const territoryValid = (value: unknown): value is string => typeof value === 'string' && labTerritories.has(value);
const ratingValid = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
function timelineValid(value: unknown, endTick: number, entryValid: (entry: Record<string, unknown>) => boolean): boolean {
    if (!Array.isArray(value))
        return false;
    let previousTick = 0;
    return value.every((entry: unknown) => {
        if (!objectValid(entry) || !unitsValid(entry.tick) || entry.tick < previousTick || entry.tick > endTick || !entryValid(entry))
            return false;
        previousTick = entry.tick;
        return true;
    });
}
function battleValid(value: unknown): value is LabBattleRecord {
    if (!objectValid(value) || value.rulesVersion !== LAB_RULES_VERSION || !labVariants.has(value.variant) ||
        !['victory', 'defeat', 'draw', 'quit'].includes(String(value.result)) ||
        typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 0 || value.durationSeconds > 91 ||
        typeof value.lastLeadChangeSeconds !== 'number' || !Number.isFinite(value.lastLeadChangeSeconds) ||
        value.lastLeadChangeSeconds < 0 || value.lastLeadChangeSeconds > value.durationSeconds)
        return false;
    const endTick = Math.round(value.durationSeconds / LAB_TICK_SECONDS);
    if (Math.abs(endTick * LAB_TICK_SECONDS - value.durationSeconds) > 1e-9)
        return false;
    return timelineValid(value.actions, endTick, (a) => ownerValid(a.owner) && (a.type === 'dispatch' ? territoryValid(a.sourceId) && territoryValid(a.targetId) && a.sourceId !== a.targetId && typeof a.reinforcement === 'boolean' && typeof a.counterattack === 'boolean' : a.type === 'upgrade' && value.variant === 'capture_recovery_upgrade' && territoryValid(a.territoryId))) &&
        timelineValid(value.captures, endTick, ({ arrival: a }) => objectValid(a) && territoryValid(a.targetId) &&
            ownerValid(a.attackerOwner) && teamValid(a.previousOwner) && a.newOwner === a.attackerOwner && a.previousOwner !== a.newOwner &&
            unitsValid(a.previousUnits) && unitsValid(a.incomingUnits) && a.incomingUnits > 0 && unitsValid(a.remainingUnits) && a.remainingUnits > 0 &&
            a.captured === true && a.reinforced === false) &&
        Array.isArray(value.snapshots) && value.snapshots.length > 0 && value.snapshots[0]?.tick === 0 &&
        value.snapshots.at(-1)?.tick === endTick && timelineValid(value.snapshots, endTick, (s) => objectValid(s.productionUpgrades) && Object.entries(s.productionUpgrades).every(([id, upgraded]) => territoryValid(id) && upgraded === true && value.variant === 'capture_recovery_upgrade') &&
        objectValid(s.territories) && Object.keys(s.territories).length === labTerritories.size &&
        Object.entries(s.territories).every(([id, t]) => territoryValid(id) && objectValid(t) && teamValid(t.owner) && unitsValid(t.units)) &&
        Array.isArray(s.armies) && s.armies.every((a: unknown) => objectValid(a) && textValid(a.id) &&
        territoryValid(a.sourceId) && territoryValid(a.targetId) && a.sourceId !== a.targetId && ownerValid(a.owner) &&
        unitsValid(a.units) && a.units > 0 && typeof a.progress === 'number' && Number.isFinite(a.progress) && a.progress >= 0 && a.progress < 1));
}
export function readLabData(json: string): LabData {
    const data: unknown = JSON.parse(json);
    const ids = new Set<string>();
    const slots = new Set<string>();
    const checkedBattles = new Set<string>();
    if (!objectValid(data) || data.schemaVersion !== 3 || !Array.isArray(data.trials) || !objectValid(data.preferences) ||
        !Object.entries(data.preferences).every(([id, variant]) => participantValid(Number(id)) && String(Number(id)) === id && labVariants.has(variant)))
        throw new Error('invalid_lab_data');
    for (const trial of data.trials) {
        if (!objectValid(trial) || !textValid(trial.id) || ids.has(trial.id) || !participantValid(trial.participant) || !battleValid(trial.battle) || !['main', 'practice', 'optional'].includes(String(trial.kind)) ||
            (trial.kind === 'main' ? !unitsValid(trial.pilotIndex) || trial.pilotIndex >= 8 || pilotOrder(trial.participant)[trial.pilotIndex] !== trial.battle.variant || trial.retryOf !== undefined : trial.pilotIndex !== undefined) ||
            (trial.retryOf !== undefined && (!textValid(trial.retryOf) || trial.retryOf === trial.id)) ||
            !Array.isArray(trial.events) || trial.events[0]?.name !== 'start' || trial.events[0]?.tick !== 0 ||
            trial.events[1]?.name !== (trial.battle.result === 'quit' ? 'quit' : 'end') ||
            trial.events[1]?.tick !== Math.round(trial.battle.durationSeconds / LAB_TICK_SECONDS) ||
            !timelineValid(trial.events, Math.round(trial.battle.durationSeconds / LAB_TICK_SECONDS), (e) => ['start', 'end', 'quit', 'retry', 'offer_shown', 'offer_replay', 'offer_continue'].includes(String(e.name))) || trial.events.slice(2).some((e) => !['retry', 'offer_shown', 'offer_replay', 'offer_continue'].includes(e.name)) ||
            (trial.ratings !== undefined && (!objectValid(trial.ratings) || !ratingValid(trial.ratings.repetition) || !ratingValid(trial.ratings.earlyDecided) || !ratingValid(trial.ratings.unfair)))) {
            throw new Error('invalid_lab_data');
        }
        const serialized = JSON.stringify(trial.battle);
        if (!checkedBattles.has(serialized)) {
            try {
                const replay = replayGameplayLab(trial.battle);
                if (!sameValue(replay.record, trial.battle))
                    throw new Error('inconsistent_lab_replay');
            }
            catch {
                throw new Error('invalid_lab_data');
            }
            checkedBattles.add(serialized);
        }
        if (trial.kind === 'main' && trial.battle.result !== 'quit') {
            const slot = `${trial.participant}:${trial.pilotIndex}`;
            if (slots.has(slot))
                throw new Error('invalid_lab_data');
            slots.add(slot);
        }
        ids.add(trial.id);
    }
    if (!objectValid(data.reflections) || !Object.entries(data.reflections).every(([id, v]) => participantValid(Number(id)) && String(Number(id)) === id && typeof v === 'string' && v.length <= 1000) || !Array.isArray(data.offers))
        throw new Error('invalid_lab_data');
    const typed = data as unknown as LabData;
    const offers = new Set<string>();
    for (const offer of typed.offers) {
        if (!objectValid(offer) || !participantValid(offer.participant) || !labVariants.has(offer.variant) || !textValid(offer.trialId) ||
            (offer.decision !== undefined && offer.decision !== 'replay' && offer.decision !== 'continue'))
            throw new Error('invalid_lab_data');
        const key = `${offer.participant}:${offer.variant}`, trial = typed.trials.find((t) => t.id === offer.trialId);
        const main = successfulMainTrials(typed, offer.participant).filter((t) => t.battle.variant === offer.variant);
        if (offers.has(key) || !trial || main.length !== 2 || !main.every((t) => t.ratings) || main[1].id !== offer.trialId ||
            trial.events.filter((e) => e.name === 'offer_shown').length !== 1 ||
            trial.events.filter((e) => e.name === 'offer_continue' || e.name === 'offer_replay').length !== (offer.decision ? 1 : 0) ||
            (offer.decision && !trial.events.some((e) => e.name === `offer_${offer.decision}`)))
            throw new Error('invalid_lab_data');
        offers.add(key);
    }
    for (const trial of typed.trials) {
        const offer = typed.offers.find((o) => o.trialId === trial.id);
        if (!offer && trial.events.some((e) => e.name.startsWith('offer_')))
            throw new Error('invalid_lab_data');
        if (trial.retryOf) {
            const previous = typed.trials.find((t) => t.id === trial.retryOf);
            if (!previous || previous.participant !== trial.participant || previous.battle.variant !== trial.battle.variant)
                throw new Error('invalid_lab_data');
        }
    }
    for (let p = 1; p <= 6; p++) {
        const main = successfulMainTrials(typed, p);
        if (main.some((t, index) => t.pilotIndex !== index))
            throw new Error('invalid_lab_data');
    }
    return typed;
}
/** JSON objects may arrive in a different key order; array order remains meaningful. */
function sameValue(left: unknown, right: unknown): boolean {
    if (left === right)
        return true;
    if (Array.isArray(left))
        return Array.isArray(right) && left.length === right.length && left.every((v, i) => sameValue(v, right[i]));
    if (!objectValid(left) || !objectValid(right))
        return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

import { LAB_RULES_VERSION, LAB_TICK_SECONDS, GameplayLabBattle, getBattlefield, type GameplayLabVariant, type LabBattleRecord } from '@crown-clash/game-core';

export const LAB_STORAGE_KEY = 'crown_clash_gameplay_lab_v2';
export const LAB_ORDERS: readonly (readonly GameplayLabVariant[])[] = [
  ['baseline', 'roads', 'capture_recovery'], ['roads', 'capture_recovery', 'baseline'],
  ['capture_recovery', 'baseline', 'roads'], ['baseline', 'capture_recovery', 'roads'],
  ['capture_recovery', 'roads', 'baseline'], ['roads', 'baseline', 'capture_recovery'],
];
export const LAB_NAMES: Record<GameplayLabVariant, string> = {
  baseline: 'A · Mabna', roads: 'B · Jadde', capture_recovery: 'C · Recovery',
};
export interface LabRatings { repetition: number; earlyDecided: number }
export interface LabTrial {
  id: string;
  participant: number;
  retryOf?: string;
  battle: LabBattleRecord;
  ratings?: LabRatings;
  events: Array<{ name: 'start' | 'end' | 'quit' | 'retry'; tick: number }>;
}
export interface LabData {
  schemaVersion: 2;
  trials: LabTrial[];
  preferences: Record<string, GameplayLabVariant>;
}
export interface LabStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const labVariants = new Set<unknown>(['baseline', 'roads', 'capture_recovery']);
const labTerritories = new Set(getBattlefield('crown_cross').territories.map((t) => t.id));
const objectValid = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const textValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const participantValid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
const unitsValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ownerValid = (value: unknown) => value === 'player' || value === 'enemy';
const teamValid = (value: unknown) => value === 'neutral' || ownerValid(value);
const territoryValid = (value: unknown): value is string => typeof value === 'string' && labTerritories.has(value);
const ratingValid = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

function timelineValid(value: unknown, endTick: number, entryValid: (entry: Record<string, unknown>) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  let previousTick = 0;
  return value.every((entry: unknown) => {
    if (!objectValid(entry) || !unitsValid(entry.tick) || entry.tick < previousTick || entry.tick > endTick || !entryValid(entry)) return false;
    previousTick = entry.tick;
    return true;
  });
}

function battleValid(value: unknown): value is LabBattleRecord {
  if (!objectValid(value) || value.rulesVersion !== LAB_RULES_VERSION || !labVariants.has(value.variant) ||
    !['victory', 'defeat', 'draw', 'quit'].includes(String(value.result)) ||
    typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 0 || value.durationSeconds > 91 ||
    typeof value.lastLeadChangeSeconds !== 'number' || !Number.isFinite(value.lastLeadChangeSeconds) ||
    value.lastLeadChangeSeconds < 0 || value.lastLeadChangeSeconds > value.durationSeconds) return false;
  const endTick = Math.round(value.durationSeconds / LAB_TICK_SECONDS);
  if (Math.abs(endTick * LAB_TICK_SECONDS - value.durationSeconds) > 1e-9) return false;
  return timelineValid(value.actions, endTick, (a) => ownerValid(a.owner) && territoryValid(a.sourceId) && territoryValid(a.targetId) && a.sourceId !== a.targetId) &&
    timelineValid(value.captures, endTick, ({ arrival: a }) => objectValid(a) && territoryValid(a.targetId) &&
      ownerValid(a.attackerOwner) && teamValid(a.previousOwner) && a.newOwner === a.attackerOwner && a.previousOwner !== a.newOwner &&
      unitsValid(a.previousUnits) && unitsValid(a.incomingUnits) && a.incomingUnits > 0 && unitsValid(a.remainingUnits) && a.remainingUnits > 0 &&
      a.captured === true && a.reinforced === false) &&
    Array.isArray(value.snapshots) && value.snapshots.length > 0 && value.snapshots[0]?.tick === 0 &&
    value.snapshots.at(-1)?.tick === endTick && timelineValid(value.snapshots, endTick, (s) =>
      objectValid(s.territories) && Object.keys(s.territories).length === labTerritories.size &&
      Object.entries(s.territories).every(([id, t]) => territoryValid(id) && objectValid(t) && teamValid(t.owner) && unitsValid(t.units)) &&
      Array.isArray(s.armies) && s.armies.every((a: unknown) => objectValid(a) && textValid(a.id) &&
        territoryValid(a.sourceId) && territoryValid(a.targetId) && a.sourceId !== a.targetId && ownerValid(a.owner) &&
        unitsValid(a.units) && a.units > 0 && typeof a.progress === 'number' && Number.isFinite(a.progress) && a.progress >= 0 && a.progress < 1));
}

function readLabData(json: string): LabData {
  const data: unknown = JSON.parse(json);
  const ids = new Set<string>();
  if (!objectValid(data) || data.schemaVersion !== 2 || !Array.isArray(data.trials) || !objectValid(data.preferences) ||
    !Object.entries(data.preferences).every(([id, variant]) => participantValid(Number(id)) && String(Number(id)) === id && labVariants.has(variant))) throw new Error('invalid_lab_data');
  for (const trial of data.trials) {
    if (!objectValid(trial) || !textValid(trial.id) || ids.has(trial.id) || !participantValid(trial.participant) || !battleValid(trial.battle) ||
      (trial.retryOf !== undefined && (!textValid(trial.retryOf) || trial.retryOf === trial.id)) ||
      !Array.isArray(trial.events) || trial.events[0]?.name !== 'start' || trial.events[0]?.tick !== 0 ||
      trial.events[1]?.name !== (trial.battle.result === 'quit' ? 'quit' : 'end') ||
      trial.events[1]?.tick !== Math.round(trial.battle.durationSeconds / LAB_TICK_SECONDS) ||
      !timelineValid(trial.events, Math.round(trial.battle.durationSeconds / LAB_TICK_SECONDS), (e) =>
        ['start', 'end', 'quit', 'retry'].includes(String(e.name))) || trial.events.slice(2).some((e) => e.name !== 'retry') ||
      (trial.ratings !== undefined && (!objectValid(trial.ratings) || !ratingValid(trial.ratings.repetition) || !ratingValid(trial.ratings.earlyDecided)))) {
      throw new Error('invalid_lab_data');
    }
    ids.add(trial.id);
  }
  return data as unknown as LabData;
}

/** Only owns lab data; deliberately has no career, API or production analytics dependency. */
export class GameplayLabStore {
  participant = 1;
  data: LabData = { schemaVersion: 2, trials: [], preferences: {} };
  error = '';
  constructor(private readonly storage?: LabStorage) {
    if (!storage) { this.error = 'Zakhire-ye local dar dastres nist; JSON ro export kon.'; return; }
    try {
      const saved = storage?.getItem(LAB_STORAGE_KEY);
      if (saved) {
        this.data = readLabData(saved);
      }
    } catch {
      this.error = 'Data-ye ghabli load nashod. Export-e in session dar dastres-e.';
    }
  }
  save(): void {
    if (!this.storage) return;
    try { this.storage.setItem(LAB_STORAGE_KEY, JSON.stringify(this.data)); this.error = ''; }
    catch { this.error = 'Zakhire-ye local nashod. Ghabl az bastan, JSON ro export kon.'; }
  }
  exportJson(): string { return JSON.stringify({ ...this.data, report: labReport(this.data) }, null, 2); }
  importJson(json: string): void {
    const imported = readLabData(json);
    const merged = new Map(this.data.trials.map((trial) => [trial.id, trial]));
    for (const trial of imported.trials) {
      const previous = merged.get(trial.id);
      if (previous && (previous.participant !== trial.participant || previous.battle.variant !== trial.battle.variant)) throw new Error('conflicting_lab_trial');
      merged.set(trial.id, trial);
    }
    this.data = { schemaVersion: 2, trials: [...merged.values()], preferences: { ...this.data.preferences, ...imported.preferences } };
    this.save();
  }
}

export class GameplayLabController {
  readonly battle: GameplayLabBattle;
  readonly trial: LabTrial;
  private finished = false;
  constructor(readonly store: GameplayLabStore, participant: number, variant: GameplayLabVariant, retryOf?: string) {
    if (!Number.isInteger(participant) || participant < 1 || participant > 6) throw new Error('invalid_lab_participant');
    this.battle = new GameplayLabBattle(variant);
    this.trial = { id: crypto.randomUUID?.() ?? `lab_${Date.now()}_${Math.random().toString(36).slice(2)}`, participant, retryOf, battle: this.battle.record, events: [{ name: 'start', tick: 0 }] };
  }
  finish(quit = false): void {
    if (this.finished) return;
    if (quit) this.battle.quit();
    else if (this.battle.state.status === 'playing') throw new Error('lab_match_still_playing');
    this.finished = true;
    this.trial.events.push({ name: quit ? 'quit' : 'end', tick: this.battle.tick });
    this.store.data.trials.push(this.trial);
    this.store.save();
  }
  rate(ratings: LabRatings): void {
    if (!this.finished || ![ratings.repetition, ratings.earlyDecided].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) {
      throw new Error('invalid_lab_ratings');
    }
    this.trial.ratings = ratings;
    this.store.save();
  }
  retry(): void {
    if (!this.finished) throw new Error('lab_match_still_playing');
    this.trial.events.push({ name: 'retry', tick: this.battle.tick });
    this.store.save();
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function labReport(data: LabData) {
  const variants = (['baseline', 'roads', 'capture_recovery'] as const).map((variant) => {
    const trials = data.trials.filter((t) => t.battle.variant === variant);
    const rated = trials.filter((t) => t.ratings);
    const pilotRated = Array.from({ length: 6 }, (_, index) => index + 1).flatMap((participant) =>
      rated.filter((t) => t.participant === participant && !t.retryOf && t.battle.result !== 'quit').slice(0, 2));
    return { variant, matches: trials.length, rated: rated.length,
      quits: trials.filter((t) => t.battle.result === 'quit').length,
      retries: trials.filter((t) => t.events.some((e) => e.name === 'retry')).length,
      openings: [...new Set(trials.map((t) => t.battle.actions.filter((a) => a.owner === 'player').slice(0, 3)
        .map((a) => `${a.sourceId}>${a.targetId}`).join('|')))].filter(Boolean),
      medianRepetition: median(rated.map((t) => t.ratings!.repetition)),
      medianEarlyDecided: median(rated.map((t) => t.ratings!.earlyDecided)),
      pilotMedianRepetition: median(pilotRated.map((t) => t.ratings!.repetition)),
      pilotMedianEarlyDecided: median(pilotRated.map((t) => t.ratings!.earlyDecided)),
      medianLastLeadChangeSeconds: median(trials.map((t) => t.battle.lastLeadChangeSeconds)),
    };
  });
  const complete = Array.from({ length: 6 }, (_, index) => index + 1).every((participant) =>
    Boolean(data.preferences[participant]) && variants.every(({ variant }) =>
      data.trials.filter((t) => t.participant === participant && t.battle.variant === variant && t.ratings && !t.retryOf && t.battle.result !== 'quit').length >= 2));
  const baseline = variants[0];
  const candidates = complete ? variants.slice(1).filter((v) =>
    Array.from({ length: 6 }, (_, index) => data.preferences[index + 1]).filter((p) => p === v.variant).length >= 4 &&
    v.pilotMedianRepetition! <= baseline.pilotMedianRepetition! && v.pilotMedianEarlyDecided! <= baseline.pilotMedianEarlyDecided!).map((v) => v.variant) : [];
  return { complete, candidates, variants, note: 'Lead changes are a proxy; this pilot does not prove retention.' };
}

export function isGameplayLabRequested(development: boolean, search: string): boolean {
  return development && new URLSearchParams(search).get('gameplay_lab') === '1';
}

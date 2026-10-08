import { describe, expect, it } from 'vitest';
import { GameplayLabController, GameplayLabStore, LAB_STORAGE_KEY, isGameplayLabRequested, labReport } from './GameplayLabController.js';

describe('isolated gameplay lab', () => {
  it('requires development and the explicit entry parameter', () => {
    expect(isGameplayLabRequested(true, '?gameplay_lab=1')).toBe(true);
    expect(isGameplayLabRequested(false, '?gameplay_lab=1')).toBe(false);
    expect(isGameplayLabRequested(true, '')).toBe(false);
    expect(isGameplayLabRequested(true, '?gameplay_lab=true')).toBe(false);
  });

  it.each(['victory', 'defeat', 'draw', 'quit'] as const)('records %s, ratings and retry only under the lab storage key', (result) => {
    const storage = new Map([['crown_clash_career_guest', 'untouched-career'], ['crown_clash_ledger_guest', 'untouched-ledger']]);
    const writes: string[] = [];
    const store = new GameplayLabStore({ getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { writes.push(key); storage.set(key, value); } });
    const controller = new GameplayLabController(store, 1, 'roads');
    controller.battle.dispatch(['p_base'], 'n_bot_left');
    for (let i = 0; i < 100; i++) controller.battle.step();
    if (result !== 'quit') controller.battle.state.status = result;
    if (result !== 'quit') controller.battle.record.result = result;
    controller.finish(result === 'quit'); controller.finish(result === 'quit');
    controller.rate({ repetition: 2, earlyDecided: 3 }); controller.retry();
    expect(store.data.trials).toHaveLength(1);
    expect(store.data.trials[0].battle.result).toBe(result);
    expect(store.data.trials[0].events.map((e) => e.name)).toEqual(['start', result === 'quit' ? 'quit' : 'end', 'retry']);
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(new Set([LAB_STORAGE_KEY]));
    expect(storage.get('crown_clash_career_guest')).toBe('untouched-career');
    expect(storage.get('crown_clash_ledger_guest')).toBe('untouched-ledger');
    expect(JSON.parse(store.exportJson()).report.complete).toBe(false);
  });

  it('rejects invalid ratings, premature completion and exposes storage failure', () => {
    const store = new GameplayLabStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
    const controller = new GameplayLabController(store, 1, 'capture_recovery');
    expect(() => controller.finish()).toThrow('lab_match_still_playing');
    controller.finish(true);
    expect(() => controller.rate({ repetition: 0, earlyDecided: 6 })).toThrow('invalid_lab_ratings');
    expect(store.error).toContain('JSON');
    expect(JSON.parse(store.exportJson()).trials).toHaveLength(1);
  });

  it('merges exports idempotently and rejects malformed data without losing existing trials', () => {
    const source = new GameplayLabStore();
    const trial = new GameplayLabController(source, 2, 'roads'); trial.finish(true);
    const destination = new GameplayLabStore();
    destination.importJson(source.exportJson()); destination.importJson(source.exportJson());
    expect(destination.data.trials).toHaveLength(1);
    expect(destination.data.trials[0].participant).toBe(2);
    const before = destination.exportJson();
    expect(() => destination.importJson('{"schemaVersion":2,"trials":[{}],"preferences":{}}')).toThrow('invalid_lab_data');
    expect(destination.exportJson()).toBe(before);
  });

  it('preserves the previous experiment and rejects its exports or mislabeled rule versions', () => {
    const oldJson = '{"schemaVersion":1,"trials":[],"preferences":{"1":"roads"}}';
    const storage = new Map([['crown_clash_gameplay_lab_v1', oldJson]]);
    const store = new GameplayLabStore({ getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value) });
    expect(store.data.trials).toEqual([]); expect(store.data.preferences).toEqual({});
    const c = new GameplayLabController(store, 1, 'capture_recovery'); c.finish(true);
    expect(storage.get('crown_clash_gameplay_lab_v1')).toBe(oldJson);
    expect(storage.has(LAB_STORAGE_KEY)).toBe(true);
    const before = store.exportJson();
    expect(() => store.importJson(oldJson)).toThrow('invalid_lab_data');
    const mislabeled = JSON.parse(before); mislabeled.trials[0].battle.rulesVersion = 1;
    expect(() => store.importJson(JSON.stringify(mislabeled))).toThrow('invalid_lab_data');
    expect(store.exportJson()).toBe(before);
  });

  it.each([
    ['missing snapshots', (t: any) => { t.battle.snapshots = []; }],
    ['invalid snapshot owner', (t: any) => { t.battle.snapshots[0].territories.p_base.owner = 'unknown'; }],
    ['negative snapshot units', (t: any) => { t.battle.snapshots[0].territories.p_base.units = -1; }],
    ['missing snapshot territory', (t: any) => { delete t.battle.snapshots[0].territories.p_base; }],
    ['invalid snapshot army', (t: any) => { t.battle.snapshots[1].armies.push({}); }],
    ['invalid capture', (t: any) => { t.battle.captures[0].arrival.captured = false; }],
    ['action after match', (t: any) => { t.battle.actions[0].tick = 201; }],
    ['unknown action territory', (t: any) => { t.battle.actions[0].targetId = 'missing'; }],
    ['lead change after match', (t: any) => { t.battle.lastLeadChangeSeconds = 5; }],
    ['invalid retry reference', (t: any) => { t.retryOf = 0; }],
    ['invalid preferences object', (_t: any, data: any) => { data.preferences = []; }],
  ])('rejects %s without changing existing data', (_name, mutate) => {
    const store = new GameplayLabStore();
    const controller = new GameplayLabController(store, 1, 'roads');
    expect(controller.battle.dispatch(['p_base'], 'n_bot_left').armies).toHaveLength(1);
    for (let i = 0; i < 200; i++) controller.battle.step();
    controller.finish(true);
    expect(controller.battle.record.captures.length).toBeGreaterThan(0);
    expect(controller.battle.record.snapshots.length).toBeGreaterThan(1);
    const before = store.exportJson();
    const malformed = JSON.parse(before);
    mutate(malformed.trials[0], malformed);
    expect(() => store.importJson(JSON.stringify(malformed))).toThrow('invalid_lab_data');
    expect(store.exportJson()).toBe(before);
  });

  it('only qualifies a candidate after all six participants complete the pilot', () => {
    const store = new GameplayLabStore();
    for (let participant = 1; participant <= 6; participant++) {
      for (const variant of ['baseline', 'roads', 'capture_recovery'] as const) {
        for (let repeat = 0; repeat < 2; repeat++) {
          const c = new GameplayLabController(store, participant, variant);
          c.battle.state.status = 'victory'; c.battle.record.result = 'victory'; c.finish();
          c.rate({ repetition: variant === 'roads' ? 2 : 3, earlyDecided: 3 });
        }
      }
      store.data.preferences[participant] = participant <= 4 ? 'roads' : 'baseline';
    }
    expect(labReport(store.data)).toMatchObject({ complete: true, candidates: ['roads'] });
    delete store.data.trials[0].ratings;
    expect(labReport(store.data)).toMatchObject({ complete: false, candidates: [] });
  });
});

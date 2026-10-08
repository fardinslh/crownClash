import { GameplayLabBattle, type EngagementVariant, type LabBattleRecord } from '@crown-clash/game-core';
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
    const controller = new GameplayLabController(store, 1, 'capture_recovery');
    controller.battle.dispatch(['p_base'], 'n_bot_left');
    for (let i = 0; i < 100; i++) controller.battle.step();
    if (result !== 'quit') controller.battle.state.status = result;
    if (result !== 'quit') controller.battle.record.result = result;
    controller.finish(result === 'quit'); controller.finish(result === 'quit');
    controller.rate({ repetition: 2, earlyDecided: 3, unfair: 2 }); controller.retry();
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
    expect(() => controller.rate({ repetition: 0, earlyDecided: 6, unfair: 2 })).toThrow('invalid_lab_ratings');
    expect(store.error).toContain('JSON');
    expect(JSON.parse(store.exportJson()).trials).toHaveLength(1);
  });

  it('merges exports idempotently and rejects malformed data without losing existing trials', () => {
    const source = new GameplayLabStore();
    const trial = new GameplayLabController(source, 2, 'capture_recovery'); trial.finish(true);
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
    const storage = new Map([['crown_clash_gameplay_lab_v1', oldJson], ['crown_clash_gameplay_lab_v2', '{"schemaVersion":2}']]);
    const store = new GameplayLabStore({ getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value) });
    expect(store.data.trials).toEqual([]); expect(store.data.preferences).toEqual({});
    const c = new GameplayLabController(store, 1, 'capture_recovery'); c.finish(true);
    expect(storage.get('crown_clash_gameplay_lab_v1')).toBe(oldJson);
    expect(storage.has(LAB_STORAGE_KEY)).toBe(true);
    expect(storage.get('crown_clash_gameplay_lab_v2')).toBe('{"schemaVersion":2}');
    expect(() => store.importJson('{"schemaVersion":2}')).toThrow('invalid_lab_data');
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
    ['impossible dispatch', (t: any) => { t.battle.actions[0].owner = 'enemy'; }],
    ['inconsistent snapshot', (t: any) => { t.battle.snapshots[0].territories.p_base.units = 21; }],
    ['unknown action territory', (t: any) => { t.battle.actions[0].targetId = 'missing'; }],
    ['lead change after match', (t: any) => { t.battle.lastLeadChangeSeconds = 5; }],
    ['invalid retry reference', (t: any) => { t.retryOf = 0; }],
    ['invalid preferences object', (_t: any, data: any) => { data.preferences = []; }],
  ])('rejects %s without changing existing data', (_name, mutate) => {
    const store = new GameplayLabStore();
    const controller = new GameplayLabController(store, 1, 'capture_recovery');
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

  it('qualifies only with 48 main matches, 24 answered offers, preference and reflection', () => {
    const store = completePilot();
    expect(labReport(store.data)).toMatchObject({ complete: true, candidates: ['capture_recovery_targets'] });
    expect(store.data.trials).toHaveLength(48);
    expect(store.data.offers).toHaveLength(24);
    const report = labReport(store.data);
    expect(report.variants[1].replayParticipants).toBe(4);
    delete store.data.trials[0].ratings;
    expect(labReport(store.data)).toMatchObject({ complete: false, candidates: [] });
  });

  it('requires all three negative ratings, enough replay improvement and a complete reflection', () => {
    const store=completePilot();
    store.data.trials.find(t=>t.battle.variant==='capture_recovery_targets')!.ratings!.unfair=5;
    for(const t of store.data.trials.filter(t=>t.battle.variant==='capture_recovery_targets'))t.ratings!.unfair=5;
    expect(labReport(store.data).candidates).toEqual([]);
    for(const t of store.data.trials)t.ratings!.unfair=2;
    for(const o of store.data.offers.filter(o=>o.variant==='capture_recovery'))o.decision='replay';
    expect(labReport(store.data).candidates).toEqual([]);
    delete store.data.reflections[1];expect(labReport(store.data).complete).toBe(false);
  });

  it('quit, practice and optional matches never advance the prescribed pilot', () => {
    const store=new GameplayLabStore();
    const quit=new GameplayLabController(store,1,'capture_recovery',undefined,'main');quit.finish(true);
    expect(store.nextVariant()).toBe('capture_recovery');
    const practice=new GameplayLabController(store,1,'capture_recovery_targets');practice.finish(true);
    const optional=new GameplayLabController(store,1,'capture_recovery',quit.trial.id,'optional');optional.finish(true);
    expect(store.nextVariant()).toBe('capture_recovery');expect(store.data.offers).toEqual([]);
    expect(()=>new GameplayLabController(store,1,'capture_recovery_targets',undefined,'main')).toThrow('invalid_lab_pilot_start');
    const main=new GameplayLabController(store,1,'capture_recovery',undefined,'main');
    main.battle.state.status='victory';main.battle.record.result='victory';main.finish();
    expect(store.pendingRating()).toBe(main.trial);
    expect(()=>new GameplayLabController(store,1,'capture_recovery_targets',undefined,'main')).toThrow('invalid_lab_pilot_start');
    main.rate({repetition:2,earlyDecided:2,unfair:2});
    expect(store.nextVariant()).toBe('capture_recovery_targets');
  });

  it('resumes missing ratings and unanswered offers after reload, and preserves the first answer during import', () => {
    const storage=new Map<string,string>();
    const adapter={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,value);}};
    let store=new GameplayLabStore(adapter);
    for(let index=0;index<5;index++){
      const variant=store.nextVariant()!, c=new GameplayLabController(store,1,variant,undefined,'main');
      const record=completedBattle(variant);Object.assign(c.battle.record,structuredClone(record));
      c.battle.tick=Math.round(record.durationSeconds/.02);c.battle.state.status=record.result as 'victory'|'defeat'|'draw';c.finish();
      if(index<4)c.rate({repetition:2,earlyDecided:2,unfair:2});
    }
    store=new GameplayLabStore(adapter);
    expect(store.pendingRating()?.pilotIndex).toBe(4);expect(store.pendingOffer()).toBeUndefined();
    store.rateTrial(store.pendingRating()!,{repetition:2,earlyDecided:2,unfair:2});
    store=new GameplayLabStore(adapter);
    expect(store.pendingOffer()).toMatchObject({participant:1,variant:'capture_recovery_upgrade'});
    expect(()=>new GameplayLabController(store,1,store.nextVariant()!,undefined,'main')).toThrow('invalid_lab_pilot_start');
    store.respondOffer(store.pendingOffer()!,'continue');
    const before=store.exportJson(), conflicting=JSON.parse(before);
    conflicting.offers[0].decision='replay';
    conflicting.trials[4].events.find((e:any)=>e.name==='offer_continue').name='offer_replay';
    expect(()=>store.importJson(JSON.stringify(conflicting))).toThrow('conflicting_lab_offer');
    expect(store.exportJson()).toBe(before);
  });

  it('offers once, persists unanswered offers, excludes optional replay and merges a full pilot idempotently', () => {
    const source=completePilot();
    const trial=source.data.trials.find(t=>t.participant===1&&t.pilotIndex===4)!;
    const offer=source.data.offers.find(o=>o.trialId===trial.id)!;
    expect(()=>source.respondOffer(offer,'continue')).toThrow('invalid_lab_offer');
    source.rateTrial(trial,{repetition:2,earlyDecided:2,unfair:2});expect(source.data.offers).toHaveLength(24);
    const extra=new GameplayLabController(source,1,trial.battle.variant as EngagementVariant,trial.id,'optional');extra.finish(true);
    const destination=new GameplayLabStore();destination.importJson(source.exportJson());destination.importJson(source.exportJson());
    expect(destination.data.trials).toHaveLength(49);expect(destination.data.offers).toHaveLength(24);
    expect(labReport(destination.data).variants.reduce((sum,v)=>sum+v.mainMatches,0)).toBe(48);
    const before=destination.exportJson(), bad=JSON.parse(before);bad.offers.push(bad.offers[0]);
    expect(()=>destination.importJson(JSON.stringify(bad))).toThrow('invalid_lab_data');expect(destination.exportJson()).toBe(before);
  });
});

function completePilot(): GameplayLabStore {
  const store=new GameplayLabStore();
  for(let participant=1;participant<=6;participant++){
    for(let index=0;index<8;index++){
      const variant=store.nextVariant(participant)!;
      const c=new GameplayLabController(store,participant,variant,undefined,'main');
      const record = completedBattle(variant);
      Object.assign(c.battle.record, structuredClone(record));
      c.battle.tick = Math.round(record.durationSeconds / .02);
      c.battle.state.status = record.result as 'victory' | 'defeat' | 'draw';
      c.finish();
      c.rate({repetition:variant==='capture_recovery_targets'?2:3,earlyDecided:3,unfair:2});
      const offer=store.pendingOffer(participant);
      if(offer)store.respondOffer(offer,variant==='capture_recovery_targets'&&participant<=4?'replay':'continue');
    }
    store.data.preferences[participant]=participant<=4?'capture_recovery_targets':'capture_recovery';
    store.data.reflections[participant]='Keep troops for a counterattack.';
  }
  return store;
}

const completedRecords = new Map<EngagementVariant,LabBattleRecord>();
function completedBattle(variant: EngagementVariant): LabBattleRecord {
  let record=completedRecords.get(variant);
  if(!record){const b=new GameplayLabBattle(variant);while(b.state.status==='playing')b.step();record=b.record;completedRecords.set(variant,record);}
  return record;
}

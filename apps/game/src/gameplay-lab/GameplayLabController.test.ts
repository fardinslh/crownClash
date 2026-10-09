import { GameplayLabBattle, type LabBattleRecord } from '@crown-clash/game-core';
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
    const oldJson = '{"schemaVersion":3,"trials":[],"preferences":{"1":"capture_recovery"}}';
    const storage = new Map([['crown_clash_gameplay_lab_v3', oldJson], ['crown_clash_gameplay_lab_v2', '{"schemaVersion":2}']]);
    const store = new GameplayLabStore({ getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value) });
    expect(store.data.trials).toEqual([]); expect(store.data.reflections).toEqual({});
    const c = new GameplayLabController(store, 1, 'capture_recovery'); c.finish(true);
    expect(storage.get('crown_clash_gameplay_lab_v3')).toBe(oldJson);
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
    ['invalid reflections object', (_t: any, data: any) => { data.reflections = []; }],
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

  it('C is the only retained version and completion never asserts a comparison winner', () => {
    const store=completePilot();
    expect(store.data.trials).toHaveLength(12);expect(store.data.offers).toHaveLength(6);
    expect(labReport(store.data)).toMatchObject({complete:true,candidates:[]});
    expect(labReport(store.data).variants).toHaveLength(1);
    expect(labReport(store.data).variants[0]).toMatchObject({variant:'capture_recovery',mainMatches:12,replayParticipants:4});
    delete store.data.trials[0].ratings;
    expect(labReport(store.data)).toMatchObject({complete:false,candidates:[]});
  });
  it('quit, practice and optional replay do not advance main quota',()=>{
    const store=new GameplayLabStore();
    const c=new GameplayLabController(store,1,'capture_recovery',undefined,'main');c.finish(true);
    const practice=new GameplayLabController(store,1,'capture_recovery');practice.finish(true);
    const optional=new GameplayLabController(store,1,'capture_recovery',practice.trial.id,'optional');optional.finish(true);
    expect(store.nextVariant()).toBe('capture_recovery');expect(store.data.offers).toEqual([]);
    const main=completeMain(store,1);
    expect(store.pendingRating()).toBe(main.trial);
    expect(()=>new GameplayLabController(store,1,'capture_recovery',undefined,'main')).toThrow('invalid_lab_pilot_start');
    main.rate({repetition:2,earlyDecided:2,unfair:2});expect(store.nextVariant()).toBe('capture_recovery');
  });
  it('restores missing ratings and unanswered offers, keeping the first answer during import',()=>{
    const storage=new Map<string,string>();
    const adapter={getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>{storage.set(k,v);}};
    let store=new GameplayLabStore(adapter);
    completeMain(store,1).rate({repetition:2,earlyDecided:2,unfair:2});completeMain(store,1);
    store=new GameplayLabStore(adapter);expect(store.pendingRating()?.pilotIndex).toBe(1);
    store.rateTrial(store.pendingRating()!,{repetition:2,earlyDecided:2,unfair:2});
    store=new GameplayLabStore(adapter);expect(store.pendingOffer()).toMatchObject({participant:1,variant:'capture_recovery'});
    expect(()=>new GameplayLabController(store,1,'capture_recovery',undefined,'main')).toThrow('invalid_lab_pilot_start');
    store.respondOffer(store.pendingOffer()!,'continue');
    const before=store.exportJson(),bad=JSON.parse(before);bad.offers[0].decision='replay';
    bad.trials[1].events.find((e:any)=>e.name==='offer_continue').name='offer_replay';
    expect(()=>store.importJson(JSON.stringify(bad))).toThrow('conflicting_lab_offer');expect(store.exportJson()).toBe(before);
  });
  it('offers once and imports completed C data idempotently',()=>{
    const source=completePilot(),trial=source.data.trials[1],offer=source.data.offers[0];
    expect(()=>source.respondOffer(offer,'continue')).toThrow('invalid_lab_offer');
    source.rateTrial(trial,{repetition:2,earlyDecided:2,unfair:2});expect(source.data.offers).toHaveLength(6);
    new GameplayLabController(source,1,'capture_recovery',trial.id,'optional').finish(true);
    const dest=new GameplayLabStore();dest.importJson(source.exportJson());dest.importJson(source.exportJson());
    expect(dest.data.trials).toHaveLength(13);expect(dest.data.offers).toHaveLength(6);
    expect(labReport(dest.data).variants[0].mainMatches).toBe(12);
    const before=dest.exportJson(),bad=JSON.parse(before);bad.offers.push(bad.offers[0]);
    expect(()=>dest.importJson(JSON.stringify(bad))).toThrow('invalid_lab_data');expect(dest.exportJson()).toBe(before);
  });
  it.each(['baseline','roads','capture_recovery_targets','capture_recovery_tactical','capture_recovery_upgrade'])('rejects retired %s without losing C records',(variant)=>{
    const store=new GameplayLabStore();new GameplayLabController(store,1,'capture_recovery').finish(true);
    const before=store.exportJson(),bad=JSON.parse(before);bad.trials[0].battle.variant=variant;
    expect(()=>store.importJson(JSON.stringify(bad))).toThrow('invalid_lab_data');expect(store.exportJson()).toBe(before);
    expect(()=>new GameplayLabController(store,1,variant as any)).toThrow('invalid_lab_variant');
  });
});

let completedRecord: LabBattleRecord | undefined;
function completeMain(store:GameplayLabStore,participant:number):GameplayLabController{
  if(!completedRecord){const b=new GameplayLabBattle('capture_recovery');while(b.state.status==='playing')b.step();completedRecord=b.record;}
  const c=new GameplayLabController(store,participant,'capture_recovery',undefined,'main');
  Object.assign(c.battle.record,structuredClone(completedRecord));c.battle.tick=Math.round(completedRecord.durationSeconds/.02);
  c.battle.state.status=completedRecord.result as 'victory'|'defeat'|'draw';c.finish();return c;
}
function completePilot():GameplayLabStore{
  const store=new GameplayLabStore();
  for(let participant=1;participant<=6;participant++){
    for(let i=0;i<2;i++)completeMain(store,participant).rate({repetition:2,earlyDecided:2,unfair:2});
    store.respondOffer(store.pendingOffer(participant)!,participant<=4?'replay':'continue');store.data.reflections[participant]='Keep troops for a counterattack.';
  }
  return store;
}

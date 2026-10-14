import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const baseline = process.env.BOT_DIFFICULTY_BASELINE_REF ?? 'tactical-v3-2026-10-14';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-history-check-'));
const load=async entryPoints=>{const r=await build({entryPoints:[entryPoints],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));};
try{
 execFileSync('git',['archive',baseline,'packages/game-core','apps/server-nakama/battlefields.json','--output='+path.join(dir,'baseline.tar')]);
 execFileSync('tar',['-xf',path.join(dir,'baseline.tar'),'-C',dir]);
 const before=await load(path.join(dir,'packages/game-core/src/index.ts')),after=await load('packages/game-core/src/index.ts');
 let cases=0;
 for(const battlefieldId of ['crown_cross','twin_passes','royal_ring'])for(const version of [1,2,3])for(const upgraded of [false,true])for(const policy of [0,1,2]){
  const ids=before.getBattlefield(battlefieldId).territories.map(t=>t.id);
  const actions=policy===0?[]:Array.from({length:110},(_,sequence)=>({sequence,atSeconds:sequence*.7,sourceId:ids[(sequence*(policy+2))%ids.length],targetId:ids[(sequence*7+policy)%ids.length]}));
  const replay={battlefieldId,gameplayRulesVersion:version,playerModifiers:{startingUnits:upgraded?32:20,productionRateMultiplier:upgraded?1.4:1,armySpeedMultiplier:upgraded?1.495:1},actions};
  assert.deepEqual(after.simulatePvpBattle(replay),before.simulatePvpBattle(replay),`${battlefieldId} v${version} upgraded=${upgraded} policy=${policy}`);cases++;
 }
 const report={cases,versions:[1,2,3],baseline,comparison:'Exact full state and summary equality for default/normal against released tactical-v3',passed:true};
 fs.mkdirSync('qa-artifacts/bot-difficulty',{recursive:true});fs.writeFileSync('qa-artifacts/bot-difficulty/history.json',JSON.stringify(report,null,2));console.log(`PASS ${cases} historical replays: exact v1/v2/v3 normal state and summary equality`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}

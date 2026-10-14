import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const baseline=process.env.TACTICAL_BASELINE_DIR;
assert.ok(baseline&&fs.existsSync(path.join(baseline,'tracked.patch')),'Provide the pre-task snapshot, not current source');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-history-check-'));
const load=async entryPoints=>{const r=await build({entryPoints:[entryPoints],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));};
try{
 execFileSync('git',['archive','HEAD','packages/game-core','apps/server-nakama/battlefields.json','--output='+path.join(dir,'baseline.tar')]);
 execFileSync('tar',['-xf',path.join(dir,'baseline.tar'),'-C',dir]);
 fs.cpSync(path.join(baseline,'packages/game-core'),path.join(dir,'packages/game-core'),{recursive:true});
 const maps=path.join(baseline,'apps/server-nakama/battlefields.json');if(fs.existsSync(maps))fs.copyFileSync(maps,path.join(dir,'apps/server-nakama/battlefields.json'));
 const before=await load(path.join(dir,'packages/game-core/src/index.ts')),after=await load('packages/game-core/src/index.ts');
 let cases=0;
 for(const battlefieldId of ['crown_cross','twin_passes','royal_ring'])for(const version of [1,2])for(const upgraded of [false,true])for(const policy of [0,1,2]){
  const ids=before.getBattlefield(battlefieldId).territories.map(t=>t.id);
  const actions=policy===0?[]:Array.from({length:110},(_,sequence)=>({sequence,atSeconds:sequence*.7,sourceId:ids[(sequence*(policy+2))%ids.length],targetId:ids[(sequence*7+policy)%ids.length]}));
  const replay={battlefieldId,gameplayRulesVersion:version,playerModifiers:{startingUnits:upgraded?32:20,productionRateMultiplier:upgraded?1.4:1,armySpeedMultiplier:upgraded?1.495:1},actions};
  assert.deepEqual(after.simulatePvpBattle(replay),before.simulatePvpBattle(replay),`${battlefieldId} v${version} upgraded=${upgraded} policy=${policy}`);cases++;
 }
 const report={cases,versions:[1,2],comparison:'Exact full state and summary equality against pre-task working tree',passed:true};
 fs.mkdirSync('qa-artifacts/tactical',{recursive:true});fs.writeFileSync('qa-artifacts/tactical/history.json',JSON.stringify(report,null,2));console.log(`PASS ${cases} historical replays: exact v1/v2 state and summary equality`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}

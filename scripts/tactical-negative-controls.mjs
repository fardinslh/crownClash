import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const out='qa-artifacts/tactical';fs.mkdirSync(out,{recursive:true});
if(!process.env.TEST_POSTGRES_DSN)throw Error('TEST_POSTGRES_DSN is required: do not count a skipped database test');
const cases=[
 {id:'hostile-adjacency',file:'packages/game-core/src/tactical-routes.ts',from:'return tacticalNeighbors(state, sourceId).includes(targetId) ? [sourceId, targetId] : null;',to:'return [sourceId, targetId];',command:['npm','--workspace=packages/game-core','test','--','--run','src/__tests__/tactical.test.ts'],failure:'rejects remote attacks'},
 {id:'command-destination',file:'apps/game/src/scenes/GameScene.ts',from:'targetId: armyDestination(army),',to:'targetId: army.targetId,',command:['npm','--workspace=apps/game','test','--','--run','src/scenes/__tests__/GameSceneInitializationParity.test.ts'],failure:'records the commanded destination'},
 {id:'rpc-capability',file:'apps/server-nakama/main.go',from:'store.CreateBotMatch(ctx, userID, request.SupportedGameplayRulesVersions...)',to:'store.CreateBotMatch(ctx, userID)',cwd:'apps/server-nakama',command:['go','test','-count=1','-run','^TestTacticalPostgresRPCAndSocialTickets$','-v','.'],failure:'RPC {"supportedGameplayRulesVersions":[1,2,3]}'},
];
const report=[];
function run(c,phase){const r=spawnSync(c.command[0],c.command.slice(1),{cwd:c.cwd,encoding:'utf8',timeout:60000,env:process.env});const output=(r.stdout??'')+(r.stderr??'');fs.writeFileSync(`${out}/negative-${c.id}-${phase}.log`,output);if(r.error)throw r.error;assert.notEqual(r.status,null,'test process must exit');return {status:r.status,output};}
for(const c of cases){const original=fs.readFileSync(c.file,'utf8');assert.equal(original.split(c.from).length,2,`unique mutation: ${c.id}`);assert.equal(run(c,'before').status,0);
 try{fs.writeFileSync(c.file,original.replace(c.from,c.to));const bad=run(c,'broken');assert.notEqual(bad.status,0,'broken behavior must fail');assert.ok(bad.output.includes(c.failure),'failure must name the intended assertion');}
 finally{fs.writeFileSync(c.file,original);}
 assert.equal(run(c,'restored').status,0,'restored behavior must pass');report.push({id:c.id,baseline:'pass',negative:'expected failure',restored:'pass'});console.log(`PASS sensitivity: ${c.id}`);
}
fs.writeFileSync(`${out}/negative-controls.json`,JSON.stringify(report,null,2));

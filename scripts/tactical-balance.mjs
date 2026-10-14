import fs from 'node:fs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({entryPoints:['packages/game-core/src/index.ts'],bundle:true,format:'esm',platform:'node',write:false});
const c = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const policies=['center','flank','split','counter'];
function choose(state,team,policy,turn){
  if(policy==='counter')return c.evaluateTacticalMoves(state,team);
  const sign=team==='player'?1:-1;
  const sources=Object.values(state.territories).filter(t=>t.owner===team&&t.units>=4);
  const targets=Object.values(state.territories).filter(t=>t.owner!==team);
  const score=t=>policy==='center'?(t.id==='n_center'?-1000:Math.hypot(t.x-200,t.y-360)):
    (sign*(t.x-200)*(policy==='split'&&turn%2?-1:1))+Math.abs(t.y-(team==='player'?110:610))*.1;
  targets.sort((a,b)=>score(a)-score(b)||a.id.localeCompare(b.id));
  for(const target of targets){
    const available=sources.filter(s=>c.findDispatchRoute(state,s.id,target.id,team));
    if(!available.length)continue;
    // Rush policies can pressure a held objective; expansion only pays for a capturable target.
    if(policy!=='center'&&available.reduce((n,s)=>n+c.calculateDispatchUnits(s.units),0)<=c.getTerritoryDefenseStrength(target))continue;
    return available.map(s=>({fromId:s.id,toId:target.id}));
  }
  return c.evaluateTacticalMoves(state,team);
}
const results=[];
for(const map of ['crown_cross','twin_passes','royal_ring'])for(let a=0;a<policies.length;a++)for(let b=a+1;b<policies.length;b++)for(const swap of [false,true])for(const delay of [0,.6,1.2]){
  let state=c.createInitialGameState({gameplayRulesVersion:3,battlefieldId:map}),acc={},firstContest=null;
  const policy={player:policies[swap?b:a],enemy:policies[swap?a:b]},next={player:0,enemy:Math.round(delay/.02)},turns={player:0,enemy:0};
  const trace=[];let captures=0,commands=0;
  for(let tick=0;state.status==='playing'&&tick<4500;tick++){
    for(const team of ['player','enemy'])if(tick>=next[team]){
      next[team]+=90;const moves=choose(state,team,policy[team],turns[team]++);
      for(const move of moves){
        const d=c.dispatchArmy(state.territories[move.fromId],state.territories[move.toId],team,.5,()=>`sim_${commands++}`,1,state);
        assert.ok(d.success&&d.army&&d.sourceTerritory,'policy must issue legal commands');
        trace.push({at:tick*.02,team,...move});state.territories[move.fromId]=d.sourceTerritory;state.armies.push(d.army);
      }
    }
    const step=c.stepSimulation(state,acc,.02);state=step.state;acc=step.accumulators;
    for(const arrival of step.resolvedArrivals){if(arrival.captured)captures++;if(arrival.previousOwner!=='neutral'&&!arrival.reinforced)firstContest??=state.elapsedTimeSeconds;}
  }
  assert.notEqual(state.status,'playing');
  results.push({map,policy,delay,result:state.status,duration:state.elapsedTimeSeconds,firstContest,captures,commands,trace});
}
const byPolicy=Object.fromEntries(policies.map(policy=>{
  const games=results.filter(r=>Object.values(r.policy).includes(policy));
  const wins=games.filter(r=>r.result===(r.policy.player===policy?'victory':'defeat')).length;
  return [policy,{games:games.length,wins,draws:games.filter(r=>r.result==='draw').length,winRate:wins/games.length}];
}));
const idleProbes=[];
for(const map of ['crown_cross','twin_passes','royal_ring'])for(const idleTeam of ['player','enemy']){
 let state=c.createInitialGameState({gameplayRulesVersion:3,battlefieldId:map}),acc={};
 const activeTeam=idleTeam==='player'?'enemy':'player';let sequence=0;
 for(let tick=0;state.status==='playing'&&tick<4500;tick++){
  if(tick%90===0)for(const m of c.evaluateTacticalMoves(state,activeTeam)){
   const d=c.dispatchArmy(state.territories[m.fromId],state.territories[m.toId],activeTeam,.5,()=>`idle_probe_${sequence++}`,1,state);
   assert.ok(d.success&&d.army&&d.sourceTerritory);state.territories[m.fromId]=d.sourceTerritory;state.armies.push(d.army);
  }
  const r=c.stepSimulation(state,acc,.02);state=r.state;acc=r.accumulators;
 }
 assert.notEqual(state.status,'playing');idleProbes.push({map,idleTeam,result:state.status,idleWon:state.status===(idleTeam==='player'?'victory':'defeat')});
}
const noContest=results.filter(r=>r.firstContest===null).length;
const report={version:3,assumptions:'Deterministic scripted policies, three maps, mirrored policy assignments, enemy reaction delays 0/0.6/1.2s; not human retention evidence.',games:results.length,byPolicy,idleProbes,
  noContest,lateContest:results.filter(r=>r.firstContest===null||r.firstContest>30).length,
  medianFirstContest:results.map(r=>r.firstContest??90).sort((a,b)=>a-b)[Math.floor(results.length/2)],
  centerDominates:byPolicy.center.winRate>=.8,
  publicReleaseBlocked:true,releaseReason:`${noContest} matches had no direct player-versus-player clash; investigate stalling and counter-policy dominance before release. Human playtest and real-device checks pending; simulation is not retention proof.`,results};
fs.mkdirSync('qa-artifacts/tactical',{recursive:true});fs.writeFileSync('qa-artifacts/tactical/balance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,results:undefined},null,2));

import fs from 'node:fs';import path from 'node:path';
import * as core from '../packages/game-core/dist/packages/game-core/src/index.js';
const commanders=['crown_guard','quartermaster','vanguard'];
const maps=['crown_cross','twin_passes','royal_ring'];
const levelPairs=[[[0,0,0],[0,0,0]],[[20,20,20],[0,0,0]],[[0,0,0],[20,20,20]],[[5,10,15],[10,5,0]],[[20,20,20],[20,20,20]]];
const battles=[];
for(const policy of ['equal','bounded'])for(const battlefieldId of maps)for(const [own,enemy] of levelPairs)for(const commander of commanders)for(const defender of commanders){
 const pm=core.realmModifiers(own,enemy,commander,policy).modifiers,em=core.realmModifiers(enemy,own,defender,policy).modifiers;
 // One fixed opening, deliberately identical across experiments. This isolates
 // power effects; it does not model human strategy or estimate conversion.
 const initial=core.createInitialGameState({battlefieldId,gameplayRulesVersion:2,playerModifiers:pm,enemyModifiers:em});
 const source=initial.territories.p_base;
 const target=Object.values(initial.territories).filter(t=>t.owner==='neutral').sort((a,b)=>Math.hypot(a.x-source.x,a.y-source.y)-Math.hypot(b.x-source.x,b.y-source.y))[0];
 if(!source||!target)throw new Error('missing map opening');
 const actions=[{sequence:0,atSeconds:0,sourceId:source.id,targetId:target.id}];
 const result=core.simulatePvpBattle({gameplayRulesVersion:2,battlefieldId,playerModifiers:pm,enemyModifiers:em,actions});
 if(result.summary.actionsProcessed!==1)throw new Error('opening dispatch was not processed');
 battles.push({policy,battlefieldId,commander,defender,own,enemy,playerModifiers:pm,enemyModifiers:em,actions,status:result.summary.status,stats:result.summary.stats});
}
let seed=20261012;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const population=[];
for(let player=0;player<1000;player++){
 let career=core.createDefaultCareer(`sim_${player}`),earned=0,spent=0;
 for(let day=0;day<30;day++)for(let match=0;match<15;match++){
  const social=match<3,status=random()<.55?'victory':'defeat';
  const reward=social?20:core.calculateMatchRewards(status,{matchDurationSeconds:70,territoriesCapturedByPlayer:3,territoriesCapturedByEnemy:0,playerUnitsDispatched:100,enemyUnitsDispatched:100},career.currentStreak,career.treasuryLevel).totalCoins;
  earned+=reward;career.coins+=reward;if(!social)career.currentStreak=status==='victory'?career.currentStreak+1:0;
  for(const goal of ['starting_garrison','production','army_speed','treasury']){const purchase=core.purchaseUpgrade(career,goal,`sim_${player}_${day}_${match}_${goal}`);if(purchase.success){spent+=purchase.cost;career=purchase.newCareer;}}
 }
 population.push({earned,spent,remaining:career.coins,kingdomLevel:core.getKingdomLevel(career)});
}
const avg=key=>population.reduce((sum,p)=>sum+p[key],0)/population.length;
const sink=Object.values(core.UPGRADE_DEFINITIONS).reduce((sum,u)=>sum+u.costs.reduce((a,b)=>a+b,0),0);
const report={modelVersion:1,seed:20261012,assumptions:{players:1000,days:30,matchesPerDay:15,winRate:.55,socialMatchesPerDay:3,rankedUniqueOpponentsAssumed:true,dailyAndLeagueClaimsIncluded:false,purchasesIncluded:false,humanStrategyModeled:false},finiteCoinSink:sink,economy:{meanEarned:avg('earned'),meanSpent:avg('spent'),meanRemaining:avg('remaining'),meanKingdomLevel:avg('kingdomLevel'),maxedPlayers:population.filter(p=>p.kingdomLevel===80).length},battles};
const out=path.resolve('qa-artifacts/realm-balance.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({battles:battles.length,finiteCoinSink:sink,economy:report.economy,output:out}));

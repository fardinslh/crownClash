import fs from 'node:fs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints:['packages/game-core/src/index.ts'], bundle:true, format:'esm', platform:'node', write:false });
const c = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const policies = ['center','flank','split','counter'];
function choose(state, team, policy, turn) {
  if (policy === 'counter') return c.evaluateTacticalMoves(state, team);
  const sign = team === 'player' ? 1 : -1;
  const sources = Object.values(state.territories).filter(t => t.owner === team && t.units >= 4);
  const targets = Object.values(state.territories).filter(t => t.owner !== team);
  const score = t => policy === 'center' ? (t.id === 'n_center' ? -1000 : Math.hypot(t.x-200,t.y-360)) : sign*(t.x-200)*(policy==='split' && turn%2 ? -1:1)+Math.abs(t.y-(team==='player'?110:610))*.1;
  targets.sort((a,b) => score(a)-score(b) || (a.id < b.id ? -1:1));
  for (const target of targets) {
    const available = sources.filter(s => c.findDispatchRoute(state,s.id,target.id,team));
    if (!available.length) continue;
    if (policy !== 'center' && available.reduce((n,s) => n+c.calculateDispatchUnits(s.units),0) <= c.getTerritoryDefenseStrength(target)) continue;
    return available.map(s => ({fromId:s.id,toId:target.id}));
  }
  return c.evaluateTacticalMoves(state,team);
}
const results = [];
for (const map of ['crown_cross','twin_passes','royal_ring']) for (const difficulty of c.BOT_DIFFICULTIES) for (const policy of policies) for (const botTeam of ['player','enemy']) for (const playerCadence of [1.8,2.7,3.6]) {
  const humanTeam = botTeam === 'player' ? 'enemy':'player';
  let state = c.createInitialGameState({gameplayRulesVersion:3,battlefieldId:map}), acc = {}, sequence = 0, turn = 0;
  const cadence = {[botTeam]:Math.round(c.getBotAiTickSeconds(difficulty)/.02),[humanTeam]:Math.round(playerCadence/.02)};
  const next = {...cadence}, trace = [];
  for (let tick = 1; tick <= 4500 && state.status === 'playing'; tick++) {
    const step = c.stepSimulation(state,acc,.02); state = step.state; acc = step.accumulators;
    for (const team of [botTeam,humanTeam]) if (state.status === 'playing' && tick >= next[team]) {
      next[team] += cadence[team];
      const moves = team === botTeam ? c.evaluateTacticalMoves(state,team) : choose(state,team,policy,turn++);
      for (const move of moves) {
        const d = c.dispatchArmy(state.territories[move.fromId],state.territories[move.toId],team,.5,()=>`difficulty_${sequence++}`,1,state);
        assert.ok(d.success && d.army && d.sourceTerritory, 'probe must issue legal commands');
        state.territories[move.fromId] = d.sourceTerritory; state.armies.push(d.army);
        state.stats[team==='player'?'playerUnitsDispatched':'enemyUnitsDispatched'] += d.army.units;
        trace.push({at:tick*.02,team,...move});
      }
    }
  }
  assert.notEqual(state.status,'playing');
  results.push({map,difficulty,policy,botTeam,playerCadence,result:state.status,botWon:state.status===(botTeam==='player'?'victory':'defeat'),duration:state.elapsedTimeSeconds,trace});
}
const levels = Object.fromEntries(c.BOT_DIFFICULTIES.map(difficulty => {
  const games = results.filter(r=>r.difficulty===difficulty), wins=games.filter(r=>r.botWon).length;
  return [difficulty,{games:games.length,wins,winRate:wins/games.length,draws:games.filter(r=>r.result==='draw').length}];
}));
const report = {assumptions:'Scripted policies and reaction delays on all three maps, both sides. Equal troops/production. Does not establish human difficulty or retention.',games:results.length,levels,results};
fs.mkdirSync('qa-artifacts/bot-difficulty',{recursive:true});
fs.writeFileSync('qa-artifacts/bot-difficulty/balance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,results:undefined},null,2));
assert.ok(levels.easy.winRate < levels.normal.winRate && levels.normal.winRate < levels.hard.winRate,'probe difficulty must increase across levels');

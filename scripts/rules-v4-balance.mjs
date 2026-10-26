// Rules v4 ability balance probe: scripted player policies (with and
// without each commander ability) against the real tactical bot at every
// difficulty, on all three 1v1 maps. Probes, not models of human skill.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['packages/game-core/src/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const c = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const policies = ['center', 'flank', 'split', 'counter'];
const commanders = [null, 'crown_guard', 'quartermaster', 'vanguard'];
// BOT_ABILITY=off reproduces the earlier baseline where the bot had no ability.
const botAbility = process.env.BOT_ABILITY !== 'off';

function choose(state, policy, turn) {
  if (policy === 'counter') return c.evaluateTacticalMoves(state, 'player');
  const sources = Object.values(state.territories).filter(t => t.owner === 'player' && t.units >= 4);
  const targets = Object.values(state.territories).filter(t => t.owner !== 'player');
  const score = t => policy === 'center' ? (t.id === 'n_center' ? -1000 : Math.hypot(t.x - 200, t.y - 360))
    : (t.x - 200) * (policy === 'split' && turn % 2 ? -1 : 1) + Math.abs(t.y - 110) * .1;
  targets.sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : 1));
  for (const target of targets) {
    const available = sources.filter(s => c.findDispatchRoute(state, s.id, target.id, 'player'));
    if (!available.length) continue;
    if (policy !== 'center' && available.reduce((n, s) => n + c.calculateDispatchUnits(s.units), 0) <= c.getTerritoryDefenseStrength(target)) continue;
    return available.map(s => ({ fromId: s.id, toId: target.id }));
  }
  return c.evaluateTacticalMoves(state, 'player');
}

/** When and where each scripted commander spends its one ability. */
function chooseAbility(state, commanderId) {
  if (state.playerAbilityUsed || state.elapsedTimeSeconds < c.ABILITY_CONFIG.unlockSeconds) return null;
  const own = Object.values(state.territories).filter(t => t.owner === 'player');
  if (!own.length) return null;
  const ability = c.COMMANDER_ABILITY[commanderId];
  if (ability === 'royal_shield') {
    const threat = {};
    for (const a of state.armies) if (a.owner === 'enemy' && state.territories[c.armyDestination(a)]?.owner === 'player') threat[c.armyDestination(a)] = (threat[c.armyDestination(a)] ?? 0) + a.units;
    const [target] = Object.entries(threat).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return target && target[1] >= state.territories[target[0]].units * .8 ? { sourceId: target[0], targetId: target[0] } : null;
  }
  if (ability === 'supply_drop') {
    const frontier = own.map(t => ({ t, hostile: Object.values(state.territories).filter(n => n.owner !== 'player' && c.findDispatchRoute(state, t.id, n.id, 'player')).length }))
      .sort((a, b) => b.hostile - a.hostile || b.t.units - a.t.units || (a.t.id < b.t.id ? -1 : 1))[0];
    return frontier ? { sourceId: frontier.t.id, targetId: frontier.t.id } : null;
  }
  for (const source of [...own].sort((a, b) => b.units - a.units || (a.id < b.id ? -1 : 1))) {
    const targets = Object.values(state.territories).filter(t => t.owner !== 'player' && c.findDispatchRoute(state, source.id, t.id, 'player'))
      .filter(t => Math.floor(c.calculateDispatchUnits(source.units) * c.ABILITY_CONFIG.chargeUnitMultiplier) > c.getTerritoryDefenseStrength(t) && c.calculateDispatchUnits(source.units) <= c.getTerritoryDefenseStrength(t))
      .sort((a, b) => (a.owner === 'enemy' ? 0 : 1) - (b.owner === 'enemy' ? 0 : 1) || a.units - b.units || (a.id < b.id ? -1 : 1));
    if (targets.length) return { sourceId: source.id, targetId: targets[0].id };
  }
  return null;
}

const results = [];
for (const map of ['crown_cross', 'twin_passes', 'royal_ring']) for (const difficulty of c.BOT_DIFFICULTIES) for (const policy of policies) for (const cadence of [1.8, 2.7, 3.6]) for (const commanderId of commanders) {
  let state = c.createInitialGameState({ gameplayRulesVersion: 4, battlefieldId: map }), acc = {}, sequence = 0, turn = 0;
  const every = { enemy: Math.round(c.getBotAiTickSeconds(difficulty) / .02), player: Math.round(cadence / .02) };
  const next = { ...every };
  let abilityAt = null, botAbilityAt = null, firstContact = null;
  for (let tick = 1; tick <= 4500 && state.status === 'playing'; tick++) {
    const step = c.stepSimulation(state, acc, .02); state = step.state; acc = step.accumulators;
    if (firstContact === null && step.resolvedArrivals.some(r => r.previousOwner !== 'neutral' && r.attackerOwner !== r.previousOwner)) firstContact = state.elapsedTimeSeconds;
    for (const team of ['enemy', 'player']) if (state.status === 'playing' && tick >= next[team]) {
      next[team] += every[team];
      if (team === 'player' && commanderId) {
        const use = chooseAbility(state, commanderId);
        if (use) {
          const r = c.applyPlayerAbility(state, commanderId, use.sourceId, use.targetId, 1, `ability_${sequence++}`);
          if (r) { state = r.state; abilityAt = state.elapsedTimeSeconds; }
        }
      }
      let moves = team === 'enemy' ? c.evaluateTacticalMoves(state, 'enemy') : choose(state, policy, turn++);
      if (team === 'enemy' && botAbility) {
        const botCommander = c.BOT_COMMANDER[difficulty];
        const choice = c.chooseBotAbility(state, 'enemy', botCommander, moves);
        const r = choice && c.applyTeamAbility(state, 'enemy', botCommander, choice.sourceId, choice.targetId, 1, `bot_ability_${sequence++}`);
        if (choice && r) { state = r.state; moves = choice.moves; botAbilityAt = state.elapsedTimeSeconds; }
      }
      for (const move of moves) {
        const d = c.dispatchArmy(state.territories[move.fromId], state.territories[move.toId], team, .5, () => `v4_${sequence++}`, 1, state);
        if (!d.success) continue;
        state.territories[move.fromId] = d.sourceTerritory; state.armies.push(d.army);
        state.stats[team === 'player' ? 'playerUnitsDispatched' : 'enemyUnitsDispatched'] += d.army.units;
      }
    }
  }
  assert.notEqual(state.status, 'playing');
  results.push({ map, difficulty, policy, cadence, commanderId: commanderId ?? 'none', result: state.status, playerWon: state.status === 'victory', abilityAt, botAbilityAt, firstContact });
}

const rate = games => ({ games: games.length, wins: games.filter(g => g.playerWon).length, winRate: +(games.filter(g => g.playerWon).length / games.length).toFixed(3) });
const byCommander = Object.fromEntries(commanders.map(id => [id ?? 'none', rate(results.filter(r => r.commanderId === (id ?? 'none')))]));
const byDifficulty = Object.fromEntries(c.BOT_DIFFICULTIES.map(d => [d, Object.fromEntries(commanders.map(id => [id ?? 'none', rate(results.filter(r => r.difficulty === d && r.commanderId === (id ?? 'none'))).winRate]))]));
const abilityUse = Object.fromEntries(commanders.filter(Boolean).map(id => {
  const games = results.filter(r => r.commanderId === id);
  return [id, { used: games.filter(g => g.abilityAt !== null).length, games: games.length }];
}));
const botAbilityUse = Object.fromEntries(c.BOT_DIFFICULTIES.map(d => {
  const games = results.filter(r => r.difficulty === d);
  return [d, { commander: c.BOT_COMMANDER[d] ?? null, used: games.filter(g => g.botAbilityAt !== null).length, games: games.length }];
}));
const noContact = Object.fromEntries(['crown_cross', 'twin_passes', 'royal_ring'].map(m => [m, results.filter(r => r.map === m && r.firstContact === null).length]));
const report = { assumptions: 'Scripted player policies vs the tactical bot; equal troops; fog does not affect the simulation. Not a model of human skill.', config: c.ABILITY_CONFIG, botAbility, games: results.length, byCommander, byDifficulty, abilityUse, botAbilityUse, noContact, results };
fs.mkdirSync('qa-artifacts/rules-v4', { recursive: true });
fs.writeFileSync(botAbility ? 'qa-artifacts/rules-v4/balance.json' : 'qa-artifacts/rules-v4/balance-no-bot-ability.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));

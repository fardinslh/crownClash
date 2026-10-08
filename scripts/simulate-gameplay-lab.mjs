import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GameplayLabBattle, replayGameplayLab, LAB_RULES_VERSION, calculateDispatchUnits,
  getTerritoryDefenseStrength } from '../packages/game-core/dist/packages/game-core/src/index.js';

const policies = ['rush', 'expansion', 'counterattack'];
const variants = ['baseline', 'roads', 'capture_recovery'];

function choose(battle, owner, policy) {
  const state = battle.state;
  const territories = Object.values(state.territories);
  const foe = owner === 'player' ? 'enemy' : 'player';
  let best = null, bestScore = 0;
  for (const source of territories.filter((t) => t.owner === owner && t.units >= 8)) {
    const sending = calculateDispatchUnits(source.units);
    for (const target of territories) {
      if (source.id === target.id) continue;
      const defense = getTerritoryDefenseStrength(target);
      const incoming = state.armies.filter((a) => a.owner === foe && a.targetId === target.id).reduce((sum, a) => sum + a.units, 0);
      const distance = Math.hypot(source.x - target.x, source.y - target.y);
      let score = -1;
      if (target.owner === owner) {
        if (policy === 'counterattack' && incoming > target.units) score = 200 + incoming - target.units - distance * .06;
      } else if (sending > defense) {
        const neutral = target.owner === 'neutral';
        if (policy === 'expansion') score = (neutral ? 160 : 70) + (target.type === 'barracks' ? 25 : 0) - distance * .06;
        else if (policy === 'rush') score = (neutral ? 60 : 180) + sending - defense - distance * .06;
        else score = (neutral ? 80 : 150) + sending - defense - distance * .06;
      }
      if (score > bestScore) { bestScore = score; best = { fromId: source.id, toId: target.id }; }
    }
  }
  return best;
}

const matches = [];
for (const variant of variants) {
  for (const left of policies) for (const right of policies) for (const swapped of [false, true]) {
    const playerPolicy = swapped ? right : left, enemyPolicy = swapped ? left : right;
    const battle = new GameplayLabBattle(variant, false);
    while (battle.state.status === 'playing') {
      if (battle.tick % 90 === 0) {
        // Both policies receive the same cadence; swap both positions and dispatch order.
        for (const owner of swapped ? ['enemy', 'player'] : ['player', 'enemy']) {
          const move = choose(battle, owner, owner === 'player' ? playerPolicy : enemyPolicy);
          if (move) assert.equal(battle.dispatch([move.fromId], move.toId, owner).armies.length, 1, 'policy must dispatch a legal army');
        }
      }
      battle.step();
      assert.ok(battle.tick <= 4501, 'match must terminate at its time limit');
    }
    const replay = replayGameplayLab(battle.record);
    assert.deepEqual(replay.state, battle.state, 'simulation replay must reproduce the exact final state');
    const lastCapture = battle.record.captures.at(-1)?.tick ?? 0;
    matches.push({ variant, playerPolicy, enemyPolicy, swapped, result: battle.state.status,
      durationSeconds: battle.record.durationSeconds, captures: battle.record.captures.length,
      actions: battle.record.actions.length, lastLeadChangeSeconds: battle.record.lastLeadChangeSeconds,
      secondsSinceLastCapture: (battle.tick - lastCapture) * .02 });
  }
}
const report = { schemaVersion: 2, rulesVersion: LAB_RULES_VERSION, matches,
  variants: variants.map((variant) => {
    const group = matches.filter((m) => m.variant === variant);
    return { variant, matches: group.length,
      timeouts: group.filter((m) => m.durationSeconds >= 90).length,
      averageCaptures: group.reduce((sum, m) => sum + m.captures, 0) / group.length,
      lateCaptureIdleMatches: group.filter((m) => m.secondsSinceLastCapture >= 30).length,
      policyResults: policies.map((policy) => {
        const appearances = group.flatMap((m) => [
          ...(m.playerPolicy === policy ? [m.result === 'victory' ? 'win' : m.result === 'defeat' ? 'loss' : 'draw'] : []),
          ...(m.enemyPolicy === policy ? [m.result === 'defeat' ? 'win' : m.result === 'victory' ? 'loss' : 'draw'] : []),
        ]);
        return { policy, appearances: appearances.length, wins: appearances.filter((r) => r === 'win').length,
          losses: appearances.filter((r) => r === 'loss').length, draws: appearances.filter((r) => r === 'draw').length };
      }),
    };
  }), note: 'Scripted policies identify balance risks. Capture inactivity and lead changes are proxies, not proof of boredom or retention.' };
const output = path.resolve(process.argv[2] ?? 'qa-artifacts/gameplay-lab/simulation.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ matches: matches.length, variants: report.variants, output }, null, 2));

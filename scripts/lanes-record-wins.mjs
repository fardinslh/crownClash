// Records one winning lane battle per lane level (shared lane-aware policy as the player, varied
// reaction delay and skill) into apps/server-nakama/testdata/lane_wins.json: the player's recorded
// orders plus the final state the TS replay (simulateLaneBattle) reaches. The Go test replays the
// orders and must reach the same state, so any drift between the TS and Go lane rules fails a test.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { c } from './lib/level-probe.mjs';

const cadences = [1.5, 2.1, 2.7, 3.3, 3.9];
const skills = [0, 1, 2];

function live(level, playerCadence, skill) {
  let state = c.createInitialGameState({ gameplayRulesVersion: c.LEVEL_RULES_VERSION, battlefieldId: level.battlefieldId, playerModifiers: c.LEVEL_PLAYER_MODIFIERS, enemyModifiers: level.enemy });
  const engine = new c.LaneEngine(level.botDifficulty);
  let acc = {};
  const actions = [];
  const every = Math.round(playerCadence / 0.02);
  let next = every;
  for (let tick = 1; tick <= 4600 && state.status === 'playing'; tick++) {
    ({ state, accumulators: acc } = engine.step(state, acc, 0.02));
    if (state.status !== 'playing' || tick < next) continue;
    next += every;
    const at = +(tick * 0.02).toFixed(3);
    const plan = c.planLanes(state, engine.lanes, 'player', { skill });
    for (const o of plan.cut) if (engine.cut(o.from, o.to)) actions.push({ sequence: actions.length, atSeconds: at, kind: 'cut', sourceId: o.from, targetId: o.to });
    for (const o of plan.open) {
      const before = engine.lanes.lanes.length;
      if (engine.open(state, o.from, o.to) && engine.lanes.lanes.length > before) actions.push({ sequence: actions.length, atSeconds: at, kind: 'lane', sourceId: o.from, targetId: o.to });
    }
  }
  return { status: state.status, actions };
}

const digest = (state) => Object.fromEntries(Object.values(state.territories).map((t) => [t.id, [t.owner, t.units]]));
const wins = {};
for (const level of c.LANE_LEVELS) {
  let best;
  for (const cadence of cadences) for (const skill of skills) {
    const run = live(level, cadence, skill);
    if (run.status === 'victory' && run.actions.length <= c.MAX_LANE_ACTIONS && (!best || run.actions.length < best.actions.length)) best = { cadence, skill, actions: run.actions };
  }
  assert.ok(best, `lane level ${level.id} must be winnable by a probe within ${c.MAX_LANE_ACTIONS} orders`);
  const replay = c.simulateLaneBattle({ battlefieldId: level.battlefieldId, botDifficulty: level.botDifficulty, enemy: level.enemy, actions: best.actions });
  assert.equal(replay.summary.status, 'victory', `the TS replay of level ${level.id} must also win`);
  wins[level.id] = { ...best, expected: { status: replay.summary.status, durationSeconds: replay.summary.durationSeconds, towers: digest(replay.finalState) } };
  console.log(`lane level ${level.id} (${level.botDifficulty}, ${level.battlefieldId}): ${best.actions.length} orders, ${replay.summary.durationSeconds}s`);
}
fs.mkdirSync('apps/server-nakama/testdata', { recursive: true });
fs.writeFileSync('apps/server-nakama/testdata/lane_wins.json', JSON.stringify(wins));

// Balance check for the lane mechanic (candidate rules v5): the shared lane-aware policy
// (packages/game-core/src/lane-ai.ts) plays both sides. The enemy uses the bot cadence of its
// difficulty; the "player" varies reaction delay and skill (0 = best target, 1 and 2 = worse
// picks) to stand in for people. 15 games per cell. Probe wins show playability by a script,
// not human fun or retention. LANE_CONFIG='{"emitSeconds":0.3}' overrides the lane constants.
import { c } from './lib/level-probe.mjs';

const maps = ['crown_cross', 'twin_passes', 'royal_ring'];
const enemies = JSON.parse(process.env.ENEMIES ?? 'null') ?? c.LANE_ENEMY_MODIFIERS;
const botTicks = JSON.parse(process.env.BOT_TICKS ?? 'null') ?? c.LANE_BOT_TICK_SECONDS;
const cadences = [1.5, 2.1, 2.7, 3.3, 3.9];
const skills = [0, 1, 2];
const config = { ...c.LANE_CONFIG, ...JSON.parse(process.env.LANE_CONFIG ?? '{}') };

function apply(state, lanes, team, orders) {
  for (const o of orders.cut) lanes = c.cutLane(lanes, team, o.from, o.to);
  for (const o of orders.open) lanes = c.openLane(state, lanes, team, o.from, o.to);
  return lanes;
}

export function play(battlefieldId, difficulty, playerCadence, skill) {
  const enemy = { ...enemies[difficulty], armySpeedMultiplier: 1 };
  let state = c.createInitialGameState({ gameplayRulesVersion: 3, battlefieldId, playerModifiers: c.LEVEL_PLAYER_MODIFIERS, enemyModifiers: enemy });
  let acc = {}, lanes = c.emptyLaneState(), orders = 0;
  const cadence = { enemy: Math.round(botTicks[difficulty] / 0.02), player: Math.round(playerCadence / 0.02) };
  const next = { ...cadence };
  for (let tick = 1; tick <= 4500 && state.status === 'playing'; tick++) {
    ({ state, accumulators: acc, lanes } = c.stepLaneSimulation(state, acc, lanes, 0.02, config));
    for (const team of ['enemy', 'player']) if (state.status === 'playing' && tick >= next[team]) {
      next[team] += cadence[team];
      const plan = c.planLanes(state, lanes, team, { skill: team === 'player' ? skill : 0, config });
      if (team === 'player') orders += plan.open.length + plan.cut.length;
      lanes = apply(state, lanes, team, plan);
    }
  }
  return { status: state.status, seconds: state.elapsedTimeSeconds, orders };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  for (const difficulty of ['easy', 'normal', 'hard']) for (const map of maps) {
    const games = [];
    for (const cadence of cadences) for (const skill of skills) games.push(play(map, difficulty, cadence, skill));
    const wins = games.filter((g) => g.status === 'victory');
    rows.push({
      difficulty, map, winRate: +(wins.length / games.length).toFixed(2),
      avgWinSeconds: wins.length ? +(wins.reduce((n, g) => n + g.seconds, 0) / wins.length).toFixed(0) : null,
      avgOrdersInWins: wins.length ? +(wins.reduce((n, g) => n + g.orders, 0) / wins.length).toFixed(0) : null,
      unfinished: games.filter((g) => g.status === 'playing').length,
    });
  }
  console.log(JSON.stringify(config));
  console.table(rows);
  const avg = (d) => rows.filter((r) => r.difficulty === d).reduce((n, r) => n + r.winRate, 0) / 3;
  console.log(`mean win rate: easy ${avg('easy').toFixed(2)}, normal ${avg('normal').toFixed(2)}, hard ${avg('hard').toFixed(2)}`);
}

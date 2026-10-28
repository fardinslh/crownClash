// Feasibility check for the lane mechanic (candidate rules v5, packages/game-core/src/lanes.ts):
// scripted players versus the lane bot on every map. Reports win rate, match length and how
// many orders a player needs (a lane replaces many 50% sends, so the action cap stops binding).
// Probe wins show playability by a script, not human fun or retention.
import { c, choose, policies, cadences } from './lib/level-probe.mjs';

const maps = ['crown_cross', 'twin_passes', 'royal_ring'];
const enemies = { easy: { startingUnits: 16, productionRateMultiplier: 0.9 }, normal: { startingUnits: 20, productionRateMultiplier: 1 }, hard: { startingUnits: 22, productionRateMultiplier: 1.05 } };

const full = (t) => t.units >= t.maxUnits;

function play(battlefieldId, difficulty, policy, playerCadence) {
  const enemy = { ...enemies[difficulty], armySpeedMultiplier: 1 };
  let state = c.createInitialGameState({ gameplayRulesVersion: 3, battlefieldId, playerModifiers: c.LEVEL_PLAYER_MODIFIERS, enemyModifiers: enemy });
  let acc = {}, lanes = c.emptyLaneState(), turn = 0, opens = 0, cuts = 0;
  const cadence = { enemy: Math.round(c.getBotAiTickSeconds(difficulty) / 0.02), player: Math.round(playerCadence / 0.02) };
  const next = { ...cadence };
  for (let tick = 1; tick <= 4500 && state.status === 'playing'; tick++) {
    ({ state, accumulators: acc, lanes } = c.stepLaneSimulation(state, acc, lanes, 0.02));
    for (const team of ['enemy', 'player']) if (state.status === 'playing' && tick >= next[team]) {
      next[team] += cadence[team];
      for (const lane of lanes.lanes.filter((l) => l.owner === team)) {
        const target = state.territories[lane.targetId];
        if (target.owner === team && full(target)) { lanes = c.cutLane(lanes, team, lane.sourceId, lane.targetId); if (team === 'player') cuts++; }
      }
      const moves = team === 'enemy' ? c.evaluateTacticalMoves(state, team, 1) : choose(state, team, policy, turn++);
      for (const move of moves) {
        const before = lanes.lanes.length;
        lanes = c.openLane(state, lanes, team, move.fromId, move.toId);
        if (team === 'player' && lanes.lanes.length > before) opens++;
      }
    }
  }
  return { status: state.status, seconds: state.elapsedTimeSeconds, orders: opens + cuts };
}

const rows = [];
for (const difficulty of ['easy', 'normal', 'hard']) for (const map of maps) {
  const games = [];
  for (const policy of policies) for (const cadence of cadences) games.push(play(map, difficulty, policy, cadence));
  const wins = games.filter((g) => g.status === 'victory');
  rows.push({
    difficulty, map, winRate: +(wins.length / games.length).toFixed(2),
    avgWinSeconds: wins.length ? +(wins.reduce((n, g) => n + g.seconds, 0) / wins.length).toFixed(0) : null,
    avgOrdersInWins: wins.length ? +(wins.reduce((n, g) => n + g.orders, 0) / wins.length).toFixed(0) : null,
    unfinished: games.filter((g) => g.status === 'playing').length,
  });
}
console.table(rows);

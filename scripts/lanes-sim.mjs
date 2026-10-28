// Balance check for the lane mechanic (candidate rules v5). The shared lane-aware policy
// (packages/game-core/src/lane-ai.ts) plays both sides through the same LaneEngine the client
// uses. Two player models (PLAYER_MODEL): 'probe' is a fast, precise script; 'human' is slower,
// starts late, sends one or two orders per action and often picks the second or third best
// target, which is how the first real-phone test went. A person is much weaker than the probe, so
// the ladder is tuned on 'human'. Probe wins show playability by a script, not human fun or
// retention. Overrides: ENEMIES, BOT_TICKS, BOT_START (JSON, per difficulty), LANE_CONFIG.
import { c } from './lib/level-probe.mjs';

const maps = ['crown_cross', 'twin_passes', 'royal_ring'];
const model = process.env.PLAYER_MODEL ?? 'human';
const MODELS = {
  probe: { cadences: [1.5, 2.1, 2.7, 3.3, 3.9], skills: [0, 1, 2], startDelays: [0], ordersPerAction: [99] },
  human: { cadences: [3, 4, 5, 6], skills: [1, 2], startDelays: [4, 8], ordersPerAction: [1, 2] },
};
const { cadences, skills, startDelays, ordersPerAction } = MODELS[model];
const enemies = JSON.parse(process.env.ENEMIES ?? 'null') ?? c.LANE_ENEMY_MODIFIERS;
const botTicks = JSON.parse(process.env.BOT_TICKS ?? 'null') ?? c.LANE_BOT_TICK_SECONDS;
const botStart = JSON.parse(process.env.BOT_START ?? 'null') ?? c.LANE_BOT_START_SECONDS;
const config = { ...c.LANE_CONFIG, ...JSON.parse(process.env.LANE_CONFIG ?? '{}') };

export function play(battlefieldId, difficulty, playerCadence, skill, startDelay = 0, perAction = 99) {
  const enemy = { ...enemies[difficulty], armySpeedMultiplier: 1 };
  let state = c.createInitialGameState({ gameplayRulesVersion: 3, battlefieldId, playerModifiers: c.LEVEL_PLAYER_MODIFIERS, enemyModifiers: enemy });
  const engine = new c.LaneEngine(difficulty, config, { startSeconds: botStart[difficulty], tickSeconds: botTicks[difficulty] });
  let acc = {}, orders = 0;
  const every = Math.round(playerCadence / 0.02);
  let next = Math.max(every, Math.round(startDelay / 0.02));
  for (let tick = 1; tick <= 4600 && state.status === 'playing'; tick++) {
    ({ state, accumulators: acc } = engine.step(state, acc, 0.02));
    if (state.status !== 'playing' || tick < next) continue;
    next += every;
    const plan = c.planLanes(state, engine.lanes, 'player', { skill, config });
    for (const o of plan.cut) if (engine.cut(o.from, o.to)) orders++;
    for (const o of plan.open.slice(0, perAction)) if (engine.open(state, o.from, o.to)) orders++;
  }
  return { status: state.status, seconds: state.elapsedTimeSeconds, orders };
}

export function evaluate() {
  const rows = [];
  for (const difficulty of ['easy', 'normal', 'hard']) for (const map of maps) {
    const games = [];
    for (const cadence of cadences) for (const skill of skills) for (const delay of startDelays) for (const per of ordersPerAction) games.push(play(map, difficulty, cadence, skill, delay, per));
    const wins = games.filter((g) => g.status === 'victory');
    rows.push({
      difficulty, map, winRate: +(wins.length / games.length).toFixed(2),
      avgWinSeconds: wins.length ? +(wins.reduce((n, g) => n + g.seconds, 0) / wins.length).toFixed(0) : null,
      avgOrdersInWins: wins.length ? +(wins.reduce((n, g) => n + g.orders, 0) / wins.length).toFixed(0) : null,
      unfinished: games.filter((g) => g.status === 'playing').length,
    });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = evaluate();
  console.log(`player model: ${model}; ${JSON.stringify(config)}`);
  console.table(rows);
  const avg = (d) => rows.filter((r) => r.difficulty === d).reduce((n, r) => n + r.winRate, 0) / 3;
  console.log(`mean win rate: easy ${avg('easy').toFixed(2)}, normal ${avg('normal').toFixed(2)}, hard ${avg('hard').toFixed(2)}`);
}

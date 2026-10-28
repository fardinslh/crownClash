import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANE_LEVELS } from '../lane-levels.js';
import { LaneReplayError, MAX_LANE_ACTIONS, simulateLaneBattle, type LaneAction } from '../lane-replay.js';

const level = LANE_LEVELS[0];
const run = (actions: LaneAction[], l = level) => simulateLaneBattle({ battlefieldId: l.battlefieldId, botDifficulty: l.botDifficulty, enemy: l.enemy, actions });
const act = (sequence: number, atSeconds: number, kind: LaneAction['kind'], sourceId: string, targetId: string): LaneAction => ({ sequence, atSeconds, kind, sourceId, targetId });

describe('simulateLaneBattle', () => {
  it('is deterministic and a passive player does not win', () => {
    const a = run([]);
    expect(run([]).finalState).toEqual(a.finalState);
    expect(a.summary.status).not.toBe('victory');
    expect(a.summary.actionsProcessed).toBe(0);
  });

  it('applies a legal lane and ignores orders that are illegal in the replayed state', () => {
    const processed = run([
      act(0, 0, 'lane', 'p_base', 'n_bot_left'),
      act(1, 0.5, 'lane', 'p_base', 'p_base'), // not a lane to itself
      act(2, 1, 'lane', 'e_base', 'n_center'), // not the player's tower
      act(3, 2, 'cut', 'p_base', 'n_top_right'), // no such lane
    ]).summary.actionsProcessed;
    expect(processed).toBe(1);
  });

  it('rejects malformed action lists', () => {
    const code = (actions: LaneAction[]) => { try { run(actions); return 'ok'; } catch (e) { return e instanceof LaneReplayError ? e.code : 'other'; } };
    expect(code(Array.from({ length: MAX_LANE_ACTIONS + 1 }, (_, i) => act(i, 0, 'lane', 'p_base', 'n_bot_left')))).toBe('too_many_actions');
    expect(code([act(1, 0, 'lane', 'p_base', 'n_bot_left')])).toBe('invalid_sequence');
    expect(code([{ ...act(0, 0, 'lane', 'p_base', 'n_bot_left'), kind: 'ability' as never }])).toBe('invalid_action_kind');
    expect(code([act(0, -1, 'lane', 'p_base', 'n_bot_left')])).toBe('invalid_timestamp');
    expect(code([act(0, 2, 'lane', 'p_base', 'n_bot_left'), act(1, 1, 'lane', 'p_base', 'n_bot_left')])).toBe('invalid_timestamp');
    expect(code([act(0, 91, 'lane', 'p_base', 'n_bot_left')])).toBe('invalid_timestamp');
    expect(code([act(0, 0, 'lane', 'nope', 'n_bot_left')])).toBe('invalid_territory');
  });

  it('replays every recorded winning run to the recorded final state', () => {
    const wins = JSON.parse(readFileSync(new URL('../../../../apps/server-nakama/testdata/lane_wins.json', import.meta.url), 'utf8')) as Record<string, {
      actions: LaneAction[]; expected: { status: string; durationSeconds: number; towers: Record<string, [string, number]> };
    }>;
    for (const l of LANE_LEVELS) {
      const win = wins[String(l.id)];
      expect(win, `level ${l.id} has a recorded win`).toBeDefined();
      const result = run(win.actions, l);
      expect(result.summary.status).toBe(win.expected.status);
      expect(result.summary.durationSeconds).toBe(win.expected.durationSeconds);
      expect(Object.fromEntries(Object.values(result.finalState.territories).map((t) => [t.id, [t.owner, t.units]]))).toEqual(win.expected.towers);
    }
  });
});

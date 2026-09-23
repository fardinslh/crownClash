import { describe, expect, it } from 'vitest';
import type { LiveMatchResult2v2 } from '../../api/LiveMatchClient.js';
import {
  buildTwoVTwoResultViewModel,
  formatTwoVTwoResultCellLabel,
  twoVTwoResultHeadline,
  TWO_V_TWO_CASUAL_NOTICE,
  twoVTwoRematchButtonLabel,
} from '../TwoVTwoResultViewModel.js';

function settledResult(): LiveMatchResult2v2 {
  return {
    matchId: 'match-1',
    winnerTeamId: 'a',
    participants: [
      {
        slot: 0,
        teamId: 'a',
        userId: 'u0',
        status: 'victory',
        stats: {
          matchDurationSeconds: 90,
          playerUnitsDispatched: 30,
          enemyUnitsDispatched: 0,
          territoriesCapturedByPlayer: 4,
          territoriesCapturedByEnemy: 0,
        },
        abandoned: false,
        settlement: {
          matchId: 'match-1',
          breakdown: { totalCoins: 65, trophyDelta: 0 },
        } as never,
      },
      {
        slot: 1,
        teamId: 'a',
        userId: 'u1',
        status: 'victory',
        abandoned: false,
      },
      {
        slot: 2,
        teamId: 'b',
        userId: 'u2',
        status: 'defeat',
        abandoned: true,
      },
      {
        slot: 3,
        teamId: 'b',
        userId: 'u3',
        status: 'defeat',
        abandoned: false,
      },
    ],
  };
}

describe('buildTwoVTwoResultViewModel', () => {
  it('groups participants into my-team-first rows', () => {
    const model = buildTwoVTwoResultViewModel(settledResult(), 1);
    expect(model.cancelled).toBe(false);
    expect(model.myStatus).toBe('victory');
    expect(model.winnerTeamId).toBe('a');
    expect(model.hasSettlements).toBe(true);

    const [myTeam, otherTeam] = model.teams;
    expect(myTeam.isMyTeam).toBe(true);
    expect(myTeam.teamId).toBe('a');
    expect(myTeam.isWinner).toBe(true);
    expect(myTeam.participants.map((p) => p.slot)).toEqual([0, 1]);
    expect(myTeam.participants.map((p) => p.label)).toEqual(['A1', 'A2']);

    expect(otherTeam.isMyTeam).toBe(false);
    expect(otherTeam.teamId).toBe('b');
    expect(otherTeam.isWinner).toBe(false);
    expect(otherTeam.participants.map((p) => p.slot)).toEqual([2, 3]);
  });

  it('marks the local card with YOU', () => {
    const model = buildTwoVTwoResultViewModel(settledResult(), 3);
    const you = model.teams[0].participants.find((p) => p.isYou);
    expect(you?.slot).toBe(3);
    expect(you?.label).toBe('B2');
    expect(you?.status).toBe('defeat');
  });

  it('carries stats and the abandoned flag onto cards', () => {
    const model = buildTwoVTwoResultViewModel(settledResult(), 0);
    const slot0 = model.teams[0].participants[0];
    expect(slot0.unitsDispatched).toBe(30);
    expect(slot0.territoriesCaptured).toBe(4);
    expect(slot0.coinsAwarded).toBe(65);
    const slot2 = model.teams[1].participants[0];
    expect(slot2.abandoned).toBe(true);
    expect(slot2.coinsAwarded).toBeNull();
  });

  it('fills a missing participant as an unknown card instead of crashing', () => {
    const partial = settledResult();
    const broken = { ...partial, participants: partial.participants?.slice(0, 3) };
    const model = buildTwoVTwoResultViewModel(broken, 0);
    const unknown = model.teams[1].participants.find((p) => p.slot === 3);
    expect(unknown?.status).toBe('unknown');
    expect(unknown?.unitsDispatched).toBeNull();
  });

  it('builds the cancelled model without participants or rewards', () => {
    const cancelled: LiveMatchResult2v2 = { matchId: 'match-2', outcome: 'cancelled' };
    const model = buildTwoVTwoResultViewModel(cancelled, 2);
    expect(model.cancelled).toBe(true);
    expect(model.hasSettlements).toBe(false);
    expect(model.winnerTeamId).toBeNull();
    expect(model.teams[0].participants).toHaveLength(0);
    expect(model.teams[1].participants).toHaveLength(0);
    expect(model.teams[0].teamId).toBe('b');
    expect(model.teams[1].teamId).toBe('a');
  });
});

describe('2v2 result copy', () => {
  it('speaks honestly about casual rewards', () => {
    expect(TWO_V_TWO_CASUAL_NOTICE).toMatch(/CASUAL/i);
    expect(TWO_V_TWO_CASUAL_NOTICE).toMatch(/no trophy changes/i);
  });

  it('heads victory, defeat, draw and cancelled differently', () => {
    const victory = buildTwoVTwoResultViewModel(settledResult(), 0);
    expect(twoVTwoResultHeadline(victory).title).toBe('VICTORY!');
    const defeat = buildTwoVTwoResultViewModel(settledResult(), 3);
    expect(twoVTwoResultHeadline(defeat).title).toBe('DEFEAT');
    const cancelled = buildTwoVTwoResultViewModel({ matchId: 'm', outcome: 'cancelled' }, 0);
    const cancelledHeadline = twoVTwoResultHeadline(cancelled);
    expect(cancelledHeadline.title).toBe('MATCH CANCELLED');
    expect(cancelledHeadline.subtitle).toMatch(/No trophies or gold/i);
  });

  it('one-shot rematch button label consumes into sent state', () => {
    expect(twoVTwoRematchButtonLabel(false)).toMatch(/VOTE REMATCH/);
    expect(twoVTwoRematchButtonLabel(true)).toBe('REMATCH VOTE SENT ✓');
  });

  it('cell labels keep the YOU marker readable under truncation', () => {
    expect(formatTwoVTwoResultCellLabel('▲', 'A2', true, 'Commander_YOU')).toBe(
      '▲ A2 ★YOU Commander…'
    );
    expect(formatTwoVTwoResultCellLabel('●', 'A1', false, 'Commander_8A2F')).toBe(
      '● A1 Commander…'
    );
    expect(formatTwoVTwoResultCellLabel('■', 'B1', false, 'Ally')).toBe('■ B1 Ally');
    expect(formatTwoVTwoResultCellLabel('◆', 'B2', false, '')).toBe('◆ B2 Commander');
  });
});

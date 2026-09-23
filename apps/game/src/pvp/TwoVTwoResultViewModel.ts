import type {
  Slot,
  TeamId,
  TwoVTwoParticipantResult,
} from '@crown-clash/game-core';
import { TWO_V_TWO_SLOTS } from '@crown-clash/game-core';
import type { LiveMatchResult2v2 } from '../api/LiveMatchClient.js';
import { slotLabel } from '../ui/TwoVTwoHudLayout.js';

// ── 2v2 result view model (docs/2v2-architecture.md Phase 5) ──────────────
// Pure grouping/copy logic for the 2v2 results modal. Deterministic and
// renderer-free so the full matrix is testable without Phaser.

export interface TwoVTwoParticipantCard {
  readonly slot: Slot;
  readonly teamId: TeamId;
  /** 'A1' | 'A2' | 'B1' | 'B2' */
  readonly label: string;
  readonly displayName: string;
  readonly status: 'victory' | 'defeat' | 'draw' | 'unknown';
  readonly abandoned: boolean;
  readonly unitsDispatched: number | null;
  readonly territoriesCaptured: number | null;
  readonly coinsAwarded: number | null;
  readonly isYou: boolean;
}

export interface TwoVTwoTeamGroup {
  readonly teamId: TeamId;
  readonly isMyTeam: boolean;
  readonly isWinner: boolean;
  readonly participants: readonly TwoVTwoParticipantCard[];
}

export interface TwoVTwoResultViewModel {
  readonly matchId: string;
  /** Cancelled matches never show participants or rewards. */
  readonly cancelled: boolean;
  readonly myStatus: 'victory' | 'defeat' | 'draw' | 'unknown';
  readonly winnerTeamId: TeamId | null;
  readonly teams: readonly [TwoVTwoTeamGroup, TwoVTwoTeamGroup];
  /** True when the authoritative per-participant settlement is present. */
  readonly hasSettlements: boolean;
}

function participantCard(
  participant: TwoVTwoParticipantResult,
  mySlot: Slot,
  rosterNames: Readonly<Record<number, string>>
): TwoVTwoParticipantCard {
  const stats = participant.stats;
  return {
    slot: participant.slot,
    teamId: participant.teamId,
    label: slotLabel(participant.slot),
    displayName: rosterNames[participant.slot] ?? `Commander ${participant.slot + 1}`,
    status: participant.status ?? 'unknown',
    abandoned: participant.abandoned === true,
    unitsDispatched: typeof stats?.playerUnitsDispatched === 'number' ? stats.playerUnitsDispatched : null,
    territoriesCaptured:
      typeof stats?.territoriesCapturedByPlayer === 'number'
        ? stats.territoriesCapturedByPlayer
        : null,
    coinsAwarded:
      typeof participant.settlement?.breakdown?.totalCoins === 'number'
        ? participant.settlement.breakdown.totalCoins
        : null,
    isYou: participant.slot === mySlot,
  };
}

/**
 * Groups the authoritative per-participant results into two ordered team
 * rows (my team first). Cancelled matches carry no participants and produce
 * the cancelled view model (no rewards copy is applied by the renderer).
 */
export function buildTwoVTwoResultViewModel(
  result: LiveMatchResult2v2,
  mySlot: Slot,
  rosterNames: Readonly<Record<number, string>> = {}
): TwoVTwoResultViewModel {
  if (result.outcome === 'cancelled' || !result.participants) {
    return {
      matchId: result.matchId,
      cancelled: true,
      myStatus: 'unknown',
      winnerTeamId: null,
      teams: [
        { teamId: mySlot < 2 ? 'a' : 'b', isMyTeam: true, isWinner: false, participants: [] },
        { teamId: mySlot < 2 ? 'b' : 'a', isMyTeam: false, isWinner: false, participants: [] },
      ],
      hasSettlements: false,
    };
  }

  const myTeamId: TeamId = mySlot < 2 ? 'a' : 'b';
  const winnerTeamId = result.winnerTeamId ?? null;
  const bySlot = new Map(result.participants.map((p) => [p.slot, p]));
  const cards = TWO_V_TWO_SLOTS.map((slot) => {
    const participant = bySlot.get(slot);
    if (participant) return participantCard(participant, mySlot, rosterNames);
    // Fail closed: a missing participant renders as an unknown card rather
    // than crashing or inventing stats.
    return {
      slot,
      teamId: (slot < 2 ? 'a' : 'b') as TeamId,
      label: slotLabel(slot),
      displayName: rosterNames[slot] ?? `Commander ${slot + 1}`,
      status: 'unknown' as const,
      abandoned: false,
      unitsDispatched: null,
      territoriesCaptured: null,
      coinsAwarded: null,
      isYou: slot === mySlot,
    };
  });

  const teamA = cards.filter((card) => card.teamId === 'a');
  const teamB = cards.filter((card) => card.teamId === 'b');
  const myTeam: TwoVTwoTeamGroup = {
    teamId: myTeamId,
    isMyTeam: true,
    isWinner: winnerTeamId === myTeamId,
    participants: myTeamId === 'a' ? teamA : teamB,
  };
  const otherTeamId: TeamId = myTeamId === 'a' ? 'b' : 'a';
  const otherTeam: TwoVTwoTeamGroup = {
    teamId: otherTeamId,
    isMyTeam: false,
    isWinner: winnerTeamId === otherTeamId,
    participants: otherTeamId === 'a' ? teamA : teamB,
  };

  return {
    matchId: result.matchId,
    cancelled: false,
    myStatus: (bySlot.get(mySlot)?.status ?? 'unknown') as TwoVTwoResultViewModel['myStatus'],
    winnerTeamId,
    teams: [myTeam, otherTeam],
    hasSettlements: result.participants.some((p) => Boolean(p.settlement)),
  };
}

/**
 * Casual 2v2 never changes trophies or coins; the modal shows honest copy
 * instead of the 1v1 reward cards.
 */
export function twoVTwoResultHeadline(model: TwoVTwoResultViewModel): {
  title: string;
  subtitle: string;
  color: string;
} {
  if (model.cancelled) {
    return {
      title: 'MATCH CANCELLED',
      subtitle: 'The battle was abandoned.\nNo trophies or gold changed hands.',
      color: '#94a3b8',
    };
  }
  if (model.myStatus === 'victory') {
    return {
      title: 'VICTORY!',
      subtitle: '👑 YOUR TEAM SEIZED THE CITADEL',
      color: '#fbbf24',
    };
  }
  if (model.myStatus === 'defeat') {
    return {
      title: 'DEFEAT',
      subtitle: '⚔️ YOUR TEAM’S DEFENSES HAVE FALLEN',
      color: '#ef4444',
    };
  }
  return {
    title: 'DRAW',
    subtitle: '🛡 NEITHER SIDE CLAIMED THE CITADEL',
    color: '#94a3b8',
  };
}

export const TWO_V_TWO_CASUAL_NOTICE = 'CASUAL MATCH — no trophy changes';

/** One-shot rematch vote button copy. */
export function twoVTwoRematchButtonLabel(voted: boolean): string {
  return voted ? 'REMATCH VOTE SENT ✓' : 'VOTE REMATCH 🔄 (all 4 must agree)';
}

/**
 * Participant card name row: shape + slot label + YOU marker + name. The
 * name truncates deterministically so the marker always stays readable
 * inside a 140px card (fits ~128px of text at 11px).
 */
export function formatTwoVTwoResultCellLabel(
  shape: string,
  label: string,
  isYou: boolean,
  displayName: string,
  maxNameChars = 9
): string {
  const name = (displayName ?? '').trim() || 'Commander';
  const truncated =
    name.length > maxNameChars ? `${name.slice(0, maxNameChars)}…` : name;
  return `${shape} ${label}${isYou ? ' ★YOU' : ''} ${truncated}`;
}

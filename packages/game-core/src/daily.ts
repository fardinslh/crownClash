import type { DailyMissionState, DailyRewardType, DailyState, MatchStats } from './types.js';
import type { EconomyLedgerEntry, PlayerCareer } from './progression.js';

export type DailyClaimFailureReason = 'not_complete' | 'already_claimed' | 'chest_locked';

export interface DailyClaimResult {
  claimId: string;
  success: boolean;
  reason?: DailyClaimFailureReason;
  rewardType: DailyRewardType;
  reward: number;
  replayed: boolean;
  state: DailyState;
  newCareer: PlayerCareer;
  ledgerEntry?: EconomyLedgerEntry;
}

const MISSION_DEFINITIONS: ReadonlyArray<
  Pick<DailyMissionState, 'id' | 'title' | 'description' | 'target' | 'reward'>
> = [
  {
    id: 'play_matches',
    title: 'Battle Orders',
    description: 'Play 2 matches',
    target: 2,
    reward: 30,
  },
  {
    id: 'win_match',
    title: 'Claim Victory',
    description: 'Win 1 match',
    target: 1,
    reward: 40,
  },
  {
    id: 'capture_territories',
    title: 'Expand the Realm',
    description: 'Capture 10 towers',
    target: 10,
    reward: 50,
  },
];

const CROWN_CHEST_REWARD = 75;
const tehranDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function tehranDayKey(timestamp: number): string {
  const parts = tehranDayFormatter.formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function tehranDayWindow(now: number): { dayKey: string; resetsAt: number } {
  const dayKey = tehranDayKey(now);
  let low = now;
  let high = now + 30 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (tehranDayKey(middle) === dayKey) low = middle;
    else high = middle;
  }
  return { dayKey, resetsAt: high };
}

export function createDailyState(now = Date.now()): DailyState {
  const window = tehranDayWindow(now);
  return {
    ...window,
    missions: MISSION_DEFINITIONS.map((mission) => ({
      ...mission,
      progress: 0,
      complete: false,
      claimed: false,
    })),
    chest: { reward: CROWN_CHEST_REWARD, unlocked: false, claimed: false },
  };
}

export function normalizeDailyState(value: DailyState | undefined, now = Date.now()): DailyState {
  const window = tehranDayWindow(now);
  if (!value || value.dayKey !== window.dayKey) return createDailyState(now);

  const previous = new Map(value.missions.map((mission) => [mission.id, mission]));
  const missions = MISSION_DEFINITIONS.map((definition) => {
    const stored = previous.get(definition.id);
    const progress = Math.min(definition.target, Math.max(0, Math.floor(stored?.progress ?? 0)));
    return {
      ...definition,
      progress,
      complete: progress >= definition.target,
      claimed: stored?.claimed === true,
    };
  });
  const unlocked = missions.every((mission) => mission.claimed);
  return {
    ...window,
    missions,
    chest: {
      reward: CROWN_CHEST_REWARD,
      unlocked,
      claimed: unlocked && value.chest?.claimed === true,
    },
  };
}

export function advanceDailyState(
  value: DailyState | undefined,
  status: 'victory' | 'defeat' | 'draw',
  stats: MatchStats,
  now = Date.now()
): DailyState {
  const state = normalizeDailyState(value, now);
  return normalizeDailyState(
    {
      ...state,
      missions: state.missions.map((mission) => {
        let increase = 0;
        if (mission.id === 'play_matches') increase = 1;
        if (mission.id === 'win_match' && status === 'victory') increase = 1;
        if (mission.id === 'capture_territories') {
          increase = Math.max(0, Math.floor(stats.territoriesCapturedByPlayer));
        }
        const progress = Math.min(mission.target, mission.progress + increase);
        return { ...mission, progress, complete: progress >= mission.target };
      }),
    },
    now
  );
}

export function claimDailyRewardLocally(
  value: DailyState | undefined,
  career: PlayerCareer,
  rewardType: DailyRewardType,
  claimId: string,
  now = Date.now()
): DailyClaimResult {
  const state = normalizeDailyState(value, now);
  const mission = state.missions.find((item) => item.id === rewardType);
  const reason: DailyClaimFailureReason | undefined = mission
    ? mission.claimed
      ? 'already_claimed'
      : !mission.complete
        ? 'not_complete'
        : undefined
    : state.chest.claimed
      ? 'already_claimed'
      : !state.chest.unlocked
        ? 'chest_locked'
        : undefined;
  if (reason) {
    return {
      claimId,
      success: false,
      reason,
      rewardType,
      reward: 0,
      replayed: false,
      state,
      newCareer: { ...career },
    };
  }

  const reward = mission?.reward ?? CROWN_CHEST_REWARD;
  const nextState = normalizeDailyState(
    {
      ...state,
      missions: state.missions.map((item) =>
        item.id === rewardType ? { ...item, claimed: true } : item
      ),
      chest:
        rewardType === 'crown_chest' ? { ...state.chest, claimed: true } : state.chest,
    },
    now
  );
  const newCareer = { ...career, coins: career.coins + reward };
  const ledgerEntry: EconomyLedgerEntry = {
    id: `daily_${claimId}`,
    player: career.playerId,
    currency: 'coins',
    amount: reward,
    reason: `daily_${rewardType}`,
    source: 'daily_reward',
    previousBalance: career.coins,
    resultingBalance: newCareer.coins,
    timestamp: now,
  };
  return {
    claimId,
    success: true,
    rewardType,
    reward,
    replayed: false,
    state: nextState,
    newCareer,
    ledgerEntry,
  };
}

export function formatDailyReset(resetsAt: number, now = Date.now()): string {
  const remainingSeconds = Math.max(0, Math.ceil((resetsAt - now) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Crown Clash - Core Game Domain Types
 * Server-authoritative and client-shared domain models
 */

export type Team = 'player' | 'enemy' | 'neutral';
export type TerritoryType = 'fortress' | 'barracks' | 'stable';

export interface Territory {
  id: string;
  name: string;
  x: number; // Logical viewport X (e.g. 0 to 400)
  y: number; // Logical viewport Y (e.g. 0 to 720)
  radius: number;
  owner: Team;
  units: number;
  maxUnits: number;
  productionRate: number; // units per second (0 for neutral)
  tier: 1 | 2 | 3;
  type: TerritoryType;
}

export interface MarchingArmy {
  id: string;
  sourceId: string;
  targetId: string;
  owner: Team;
  units: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number; // 0.0 to 1.0
  speed: number; // fraction of journey per second (e.g. 0.25 = 4 seconds total)
  distance: number;
}

export interface CombatResult {
  targetId: string;
  attackerOwner: Team;
  previousOwner: Team;
  newOwner: Team;
  previousUnits: number;
  incomingUnits: number;
  remainingUnits: number;
  captured: boolean;
  reinforced: boolean;
}

export type MatchStatus = 'playing' | 'victory' | 'defeat' | 'draw';

export interface MatchStats {
  matchDurationSeconds: number;
  playerUnitsDispatched: number;
  enemyUnitsDispatched: number;
  territoriesCapturedByPlayer: number;
  territoriesCapturedByEnemy: number;
}

export interface GameState {
  territories: Record<string, Territory>;
  armies: MarchingArmy[];
  status: MatchStatus;
  elapsedTimeSeconds: number;
  timeLimitSeconds: number;
  stats: MatchStats;
}

export type DailyRewardType =
  | 'play_matches'
  | 'win_match'
  | 'capture_territories'
  | 'crown_chest';

export interface DailyMissionState {
  id: Exclude<DailyRewardType, 'crown_chest'>;
  title: string;
  description: string;
  progress: number;
  target: number;
  reward: number;
  complete: boolean;
  claimed: boolean;
}

export interface DailyChestState {
  reward: number;
  unlocked: boolean;
  claimed: boolean;
}

export interface DailyState {
  dayKey: string;
  resetsAt: number;
  missions: DailyMissionState[];
  chest: DailyChestState;
}

export interface LeagueTierState {
  rankId: string;
  name: string;
  badge: string;
  minTrophies: number;
  reward: number;
  unlocked: boolean;
  claimed: boolean;
}

export interface LeagueState {
  trophies: number;
  kingdomPower: number;
  currentRankId: string;
  tiers: LeagueTierState[];
}

export interface LeagueClaimResult {
  claimId: string;
  success: boolean;
  reason?: 'invalid_rank' | 'not_unlocked' | 'already_claimed';
  rankId: string;
  reward: number;
  replayed: boolean;
  state: LeagueState;
  newCareer: import('./progression.js').PlayerCareer;
  ledgerEntry?: import('./progression.js').EconomyLedgerEntry;
}

/**
 * Crown Clash - Core Game Domain Types
 * Server-authoritative and client-shared domain models
 */

export type Team = 'player' | 'enemy' | 'neutral';

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

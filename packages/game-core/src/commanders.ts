import type { PlayerCareer } from './progression.js';

export type CommanderId = 'crown_guard' | 'quartermaster' | 'vanguard';

export interface CommanderSelectionResult {
  readonly success: boolean;
  readonly reason?: 'invalid_commander' | 'commander_locked';
  readonly commanderId: CommanderId;
  readonly newCareer: PlayerCareer;
}

export interface CommanderDefinition {
  readonly id: CommanderId;
  readonly name: string;
  readonly role: string;
  readonly unlockKingdomLevel: number;
  readonly accent: number;
  readonly startingUnitsDelta: number;
  readonly productionMultiplier: number;
  readonly armySpeedMultiplier: number;
  readonly strength: string;
  readonly tradeoff: string;
}

export const DEFAULT_COMMANDER_ID: CommanderId = 'crown_guard';

export const COMMANDERS: readonly CommanderDefinition[] = [
  {
    id: 'crown_guard',
    name: 'Crown Guard',
    role: 'Balanced command',
    unlockKingdomLevel: 0,
    accent: 0x60a5fa,
    startingUnitsDelta: 0,
    productionMultiplier: 1,
    armySpeedMultiplier: 1,
    strength: 'No weakness',
    tradeoff: 'No specialty',
  },
  {
    id: 'quartermaster',
    name: 'Quartermaster',
    role: 'Builds armies faster',
    unlockKingdomLevel: 10,
    accent: 0x34d399,
    startingUnitsDelta: 0,
    productionMultiplier: 1.15,
    armySpeedMultiplier: 0.9,
    strength: '+15% production',
    tradeoff: '-10% march speed',
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    role: 'Strikes before rivals',
    unlockKingdomLevel: 25,
    accent: 0xf59e0b,
    startingUnitsDelta: -3,
    productionMultiplier: 1,
    armySpeedMultiplier: 1.15,
    strength: '+15% march speed',
    tradeoff: '-3 starting troops',
  },
] as const;

export function normalizeCommanderId(value: unknown): CommanderId {
  return COMMANDERS.some((commander) => commander.id === value)
    ? (value as CommanderId)
    : DEFAULT_COMMANDER_ID;
}

export function getCommander(id: unknown): CommanderDefinition {
  const safeId = normalizeCommanderId(id);
  return COMMANDERS.find((commander) => commander.id === safeId) ?? COMMANDERS[0];
}

export function isCommanderUnlocked(id: unknown, kingdomLevel: number): boolean {
  return kingdomLevel >= getCommander(id).unlockKingdomLevel;
}

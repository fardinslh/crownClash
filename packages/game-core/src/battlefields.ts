export type BattlefieldId = 'crown_cross' | 'twin_passes' | 'royal_ring';

export interface BattlefieldDefinition {
  readonly id: BattlefieldId;
  readonly name: string;
  readonly subtitle: string;
  readonly accent: number;
}

export interface BotMatchTicket {
  readonly matchId: string;
  readonly battlefieldId: BattlefieldId;
}

export const DEFAULT_BATTLEFIELD_ID: BattlefieldId = 'crown_cross';

export const BATTLEFIELDS: readonly BattlefieldDefinition[] = [
  { id: 'crown_cross', name: 'Crown Cross', subtitle: 'Control the central keep', accent: 0xf59e0b },
  { id: 'twin_passes', name: 'Twin Passes', subtitle: 'Fast towers rule the flanks', accent: 0x38bdf8 },
  { id: 'royal_ring', name: 'Royal Ring', subtitle: 'Choose your attack lane', accent: 0xa78bfa },
] as const;

export function normalizeBattlefieldId(value: unknown): BattlefieldId {
  return BATTLEFIELDS.some((battlefield) => battlefield.id === value)
    ? (value as BattlefieldId)
    : DEFAULT_BATTLEFIELD_ID;
}

export function getBattlefield(value: unknown): BattlefieldDefinition {
  const id = normalizeBattlefieldId(value);
  return BATTLEFIELDS.find((battlefield) => battlefield.id === id) ?? BATTLEFIELDS[0];
}

export function createLocalBotMatchTicket(now = Date.now()): BotMatchTicket {
  const index = Math.floor(Math.random() * BATTLEFIELDS.length);
  return {
    matchId: `local_${now}_${Math.random().toString(36).slice(2, 10)}`,
    battlefieldId: BATTLEFIELDS[index]?.id ?? DEFAULT_BATTLEFIELD_ID,
  };
}

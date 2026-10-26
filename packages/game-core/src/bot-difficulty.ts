import type { CommanderId } from './commanders.js';

/** Reaction cadence only: all levels use the same legal AI and troop economy. */
export type BotDifficulty = 'easy' | 'normal' | 'hard';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
/**
 * The commander (and so the one ability) the bot brings to a v4 match. Easy
 * stays ability-free so new players meet a gentler opponent. Mirrored in Go
 * (`bot_difficulty.go`).
 */
export const BOT_COMMANDER: Readonly<Record<BotDifficulty, CommanderId | undefined>> = Object.freeze({
  easy: undefined,
  normal: 'quartermaster',
  hard: 'vanguard',
});
export function getBotAiTickSeconds(difficulty: BotDifficulty = 'normal'): number {
  switch (difficulty) {
    case 'easy': return 3.6;
    case 'normal': return 1.8;
    case 'hard': return 0.9;
    default: throw new Error('invalid_bot_difficulty');
  }
}

/** Reaction cadence only: all levels use the same legal AI and troop economy. */
export type BotDifficulty = 'easy' | 'normal' | 'hard';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
export function getBotAiTickSeconds(difficulty: BotDifficulty = 'normal'): number {
  switch (difficulty) {
    case 'easy': return 3.6;
    case 'normal': return 1.8;
    case 'hard': return 0.9;
    default: throw new Error('invalid_bot_difficulty');
  }
}

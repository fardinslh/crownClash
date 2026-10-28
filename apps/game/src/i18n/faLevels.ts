import type { BotDifficulty } from '@crown-clash/game-core';
import { ltr } from './fa.js';

/** Persian copy for the single-player campaign (levels). */
export const faLevels = {
  title: 'مراحل',
  subtitle: 'از آسان شروع کن و تا آخر برو',
  progress: (completed: number, total: number): string => `${completed} / ${total}`,
  level: (id: number): string => `مرحله ${id}`,
  locked: 'اول مرحلهٔ قبلی را ببر.',
  loading: 'در حال بارگذاری…',
  loadFailed: 'پیشرفت مراحل بارگذاری نشد.',
  retry: 'تلاش دوباره',
  rewardBadge: (coins: number): string => ltr(`+${coins}`),
  difficulty: { easy: 'آسان', normal: 'متوسط', hard: 'سخت' } satisfies Record<BotDifficulty, string>,
  result: {
    victory: 'پیروزی!',
    defeat: 'شکست',
    draw: 'مساوی',
    victorySub: (id: number): string => `مرحله ${id} را بردی`,
    defeatSub: 'دوباره امتحان کن',
    drawSub: 'برنده‌ای نبود؛ دوباره امتحان کن',
    allDone: 'همهٔ مراحل را تمام کردی!',
    saveFailed: 'پیشرفت ذخیره نشد. دوباره وارد مراحل شو.',
    reward: (coins: number): string => `جایزهٔ اولین برد: ${ltr(`+${coins}`)} سکه`,
    next: 'مرحلهٔ بعد',
    retry: 'تلاش دوباره',
    back: 'بازگشت به مراحل',
  },
} as const;

import type { BotDifficulty } from '@crown-clash/game-core';
import { ltr } from './fa.js';

/** Persian copy for the Weekly Challenge (three fixed battles per week). */
export const faWeekly = {
  entry: 'چالش هفتگی',
  entryHint: (coins: number): string => `تا ${ltr(`+${coins}`)} سکه`,
  title: 'چالش هفتگی',
  subtitle: 'هر هفته سه نبرد تازه، جایزهٔ هر کدام یک بار',
  loading: 'در حال بارگذاری…',
  loadFailed: 'چالش هفتگی بارگذاری نشد.',
  retry: 'تلاش دوباره',
  slotName: ['برنز', 'نقره', 'طلا'] as const,
  difficulty: { easy: 'آسان', normal: 'متوسط', hard: 'سخت' } satisfies Record<BotDifficulty, string>,
  reward: (coins: number): string => ltr(`+${coins}`),
  claimed: 'گرفته شد',
  play: 'شروع',
  weekOver: 'هفته تمام شد. چالش‌های جدید را ببین.',
  endsIn: (days: number, hours: number, minutes: number): string => {
    if (days > 0) return `پایان هفته: ${days} روز و ${hours} ساعت`;
    if (hours > 0) return `پایان هفته: ${hours} ساعت و ${minutes} دقیقه`;
    return `پایان هفته: ${Math.max(1, minutes)} دقیقه`;
  },
  result: {
    victory: 'پیروزی!',
    defeat: 'شکست',
    draw: 'مساوی',
    victorySub: (slot: number): string => `چالش ${faWeekly.slotName[slot - 1] ?? slot} را بردی`,
    alreadyClaimed: 'جایزهٔ این چالش را قبلاً گرفته‌ای',
    defeatSub: 'دوباره امتحان کن',
    drawSub: 'برنده‌ای نبود؛ دوباره امتحان کن',
    saveFailed: 'جایزه ثبت نشد. دوباره وارد چالش هفتگی شو.',
    weekOver: 'این هفته تمام شده بود؛ جایزه‌ای ثبت نشد.',
    reward: (coins: number): string => `جایزهٔ چالش: ${ltr(`+${coins}`)} سکه`,
    retry: 'تلاش دوباره',
    back: 'بازگشت به چالش‌ها',
  },
} as const;

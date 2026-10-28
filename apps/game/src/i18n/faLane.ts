import { ltr } from './fa.js';

/** Persian copy for lane battles (candidate rules v5, behind a feature flag). */
export const faLane = {
  entry: 'نبرد مسیر · آزمایشی',
  attack: 'حمله با مسیر',
  feed: 'تقویت با مسیر',
  towersSelected: (count: number): string => `${ltr(`${count}`)} برج انتخاب شد`,
  hint: 'از برج بکش تا مسیر باز شود · روی مسیر بکش تا قطع شود',
  noPath: 'مسیر آزاد نیست؛ یک مسیر را قطع کن',
  cut: 'مسیر قطع شد',
  result: {
    victorySub: (id: number): string => `نبرد ${ltr(`${id}`)} را بردی`,
    allDone: 'همهٔ نبردهای مسیر را بردی!',
    next: 'نبرد بعد',
  },
} as const;

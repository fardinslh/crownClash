/**
 * Persian (fa) UI copy. The launch audience is Persian-speaking, so there is
 * no language switch: scenes import these strings directly. Rank and
 * commander names live in game-core (English, covered by tests and sent to
 * the server), so the client maps their ids to display names here instead of
 * editing the shared data.
 */

const RANK_NAMES: Readonly<Record<string, string>> = {
  recruit: 'تازه‌کار',
  soldier: 'سرباز',
  knight: 'شوالیه',
  commander: 'فرمانده',
  warlord: 'سردار',
  crown_lord: 'ارباب تاج',
};

export interface CommanderCopy {
  readonly name: string;
  readonly role: string;
  readonly strength: string;
  readonly tradeoff: string;
}

/**
 * Left-to-right isolate for a signed number ("+15%", "-3") inside Persian
 * copy, so the sign stays attached to its number instead of drifting to
 * the far end of the RTL line.
 */
export function ltr(value: string): string {
  return `\u2066${value}\u2069`;
}

const COMMANDER_COPY: Readonly<Record<string, CommanderCopy>> = {
  crown_guard: {
    name: 'نگهبان تاج',
    role: 'فرماندهی متعادل',
    strength: 'بدون ضعف',
    tradeoff: 'بدون تخصص',
  },
  quartermaster: {
    name: 'سرتدارکات',
    role: 'ارتش را سریع‌تر می‌سازد',
    strength: `${ltr('+15%')} تولید`,
    tradeoff: `${ltr('-10%')} سرعت حرکت`,
  },
  vanguard: {
    name: 'پیشتاز',
    role: 'پیش از حریف حمله می‌کند',
    strength: `${ltr('+15%')} سرعت حرکت`,
    tradeoff: `${ltr('-3')} سرباز اولیه`,
  },
};

/** Display name for a rank id, falling back to the English data name. */
export function rankName(id: string, fallback: string): string {
  return RANK_NAMES[id] ?? fallback;
}

/** Display copy for a commander id, falling back to the English data. */
export function commanderCopy(
  id: string,
  fallback: CommanderCopy
): CommanderCopy {
  return COMMANDER_COPY[id] ?? fallback;
}

const MISSION_COPY: Readonly<Record<string, { title: string; description: string }>> = {
  play_matches: { title: 'دستور نبرد', description: '۲ بازی انجام بده' },
  win_match: { title: 'طعم پیروزی', description: '۱ بازی را ببر' },
  capture_territories: { title: 'گسترش قلمرو', description: '۱۰ برج را تسخیر کن' },
};

/** Display copy for a daily mission id, falling back to the data text. */
export function missionCopy(
  id: string,
  fallback: { title: string; description: string }
): { title: string; description: string } {
  return MISSION_COPY[id] ?? fallback;
}

const TIER_NAMES: Readonly<Record<string, string>> = {
  war_camp: 'اردوگاه جنگ',
  stone_fort: 'دژ سنگی',
  royal_keep: 'قلعه سلطنتی',
  grand_citadel: 'ارگ بزرگ',
  crown_capital: 'پایتخت تاج',
};

/** Display name for a kingdom tier id, falling back to the English data. */
export function kingdomTierName(id: string, fallback: string): string {
  return TIER_NAMES[id] ?? fallback;
}

const UPGRADE_TITLES: Readonly<Record<string, { title: string; subtitle: string }>> = {
  starting_garrison: { title: 'ارگ', subtitle: 'سربازان اولیه' },
  production: { title: 'کارگاه جنگ', subtitle: 'سرعت تولید' },
  army_speed: { title: 'جاده‌های سلطنتی', subtitle: 'سرعت حرکت' },
  treasury: { title: 'خزانه', subtitle: 'پاداش سکه' },
};

/** Persian title/subtitle for an upgrade type, falling back to the given text. */
export function upgradeCopy(
  type: string,
  fallback: { title: string; subtitle: string }
): { title: string; subtitle: string } {
  return UPGRADE_TITLES[type] ?? fallback;
}

/**
 * game-core builds upgrade effect labels in English ("+4 troops",
 * "+10% production"). The suffix set is closed, so the client localizes it
 * here instead of changing the shared label function.
 */
export function upgradeEffectLabel(label: string): string {
  return label
    .replace(/^([+\-−]?\d+(?:\.\d+)?%?)/, (value) => ltr(value))
    .replace(/ troops$/, ' سرباز')
    .replace(/ production$/, ' تولید')
    .replace(/ march$/, ' سرعت حرکت')
    .replace(/ coins$/, ' سکه');
}

export const fa = {
  kingdom: {
    title: 'قلمرو',
    subtitle: 'قلمرویت را رشد بده',
    power: (level: number, max: number): string => `قدرت ${level}/${max}`,
    toNextTier: (levels: number, next: string): string => `${levels} ارتقا تا ${next}`,
    fullyEvolved: 'قلمرو به اوج رسید',
    evolved: (tier: string): string => `قلمرو تکامل یافت\n${tier}`,
    notEnoughGold: 'سکه‌ات برای این ارتقا کافی نیست.',
    maxed: 'این ارتقا به حداکثر رسیده است.',
    finishingUpgrade: 'در حال نهایی کردن ارتقا…',
    unreachable: 'به قلمرو وصل نشدیم. دوباره تلاش کن.',
    level: (level: number, max: number): string => `سطح ${ltr(`${level} / ${max}`)}`,
    now: 'الان',
    next: 'بعدی',
    fullyUpgraded: 'کامل',
    max: 'حداکثر',
    milestone: (level: number): string => `مرحلهٔ ${level} کامل شد!`,
  },
  training: {
    victory: 'پیروزی!',
    savingSub: 'آموزش تمام شد — در حال ذخیره…',
    complete: 'آموزش تمام شد!',
    starting: 'نبرد اول شروع می‌شود — این بار با جایزه سکه!',
    saveFailed: 'ذخیره نشد — برای تلاش دوباره بزن',
  },
  tutorial: {
    dragToAttack: 'از برجت به سمت برج درخشان بکش!',
    previewResult: 'روی هدف نگه دار — برچسب برد یا باخت را نشان می‌دهد!',
    towerRoles: 'برج‌های تسخیرشده برای تو می‌جنگند — یکی دیگر بگیر!',
    multiDispatch: 'کمبو! از هر دو برج رد شو و روی هدف رها کن!',
    destroyBase: 'کارش را تمام کن! از برج‌هایت بکش و پایگاه دشمن را بگیر!',
  },
  league: {
    loadFailed: 'جاده لیگ بارگذاری نشد.',
    title: 'جاده لیگ',
    subtitle: 'اوج بگیر. جایزه بگیر. حکومت کن.',
    loading: 'در حال خواندن سوابق سلطنتی…',
    retry: 'تلاش دوباره',
    power: (n: number): string => `قدرت ${n}/80`,
    progressNext: (trophies: number, toNext: number, next: string): string =>
      `${trophies} جام  •  ${toNext} تا ${next}`,
    progressMax: (trophies: number): string => `${trophies} جام  •  استاد قلمرو`,
    improveKingdom: 'ارتقای قلمرو',
    currentLeague: 'لیگ فعلی',
    trophies: (n: number): string => `${n} جام`,
    begun: 'آغاز',
    claimed: 'گرفته شد',
    claim: 'دریافت',
    locked: 'قفل',
    bounty: 'جایزه لیگ',
    notUnlocked: 'برای باز شدن این جایزه جام بیشتری بگیر.',
    alreadyClaimed: 'جایزه این لیگ قبلاً گرفته شده است.',
    claimFailed: 'جایزه دریافت نشد. دوباره تلاش کن.',
    finishingClaim: 'در حال نهایی کردن جایزه…',
  },
  council: {
    title: 'شورای جنگ',
    subtitle: 'یک آیین نبرد انتخاب کن',
    power: (n: number): string => `قدرت قلمرو  ${n}`,
    helper: 'این انتخاب‌ها استراتژی را عوض می‌کنند، نه قدرت کل را.',
    equipped: 'انتخاب شده',
    equip: 'انتخاب',
    unlockAt: (n: number): string => `قدرت ${n}`,
    locked: 'این فرمانده هنوز قفل است.',
    equipFailed: 'انتخاب انجام نشد. دوباره تلاش کن.',
    equipping: 'در حال انتخاب فرمانده…',
  },
  difficulty: {
    easy: { title: 'آسان', description: 'زمان بیشتر برای واکنش' },
    normal: { title: 'معمولی', description: 'چالش اصلی بازی' },
    hard: { title: 'سخت', description: 'تصمیم‌گیری سریع‌تر حریف' },
    eyebrow: 'نبرد با ربات',
    heading: 'چالشت را انتخاب کن',
    note: 'سربازها یکسان. فقط سرعت واکنش فرق دارد.',
    play: 'بازی',
    back: 'بازگشت',
  },
  daily: {
    title: 'دستورهای سلطنتی',
    subtitle: 'کمپین امروز را کامل کن',
    reset: (time: string): string => `بازنشانی  ${time}`,
    resetPlaceholder: 'بازنشانی  --:--:--',
    loading: 'در حال خواندن دستورهای امروز…',
    loadError: 'دستورهای امروز بارگذاری نشد.',
    retry: 'تلاش دوباره',
    claimed: 'گرفته شد',
    claim: 'دریافت',
    inBattle: 'در نبرد',
    chestTitle: 'صندوق تاج',
    chestClaimed: 'جایزهٔ سلطنتی گرفته شد',
    chestUnlocked: 'همهٔ دستورها انجام شد',
    chestProgress: (done: number): string => `همهٔ دستورها را بگیر  ${done}/3`,
    opened: 'باز شد',
    open: 'باز کن',
    locked: 'قفل',
    notComplete: 'اول این دستور را کامل کن.',
    alreadyClaimed: 'این جایزه قبلاً گرفته شده است.',
    chestLocked: 'اول هر سه دستور را بگیر.',
    claimFailed: 'جایزه دریافت نشد. دوباره تلاش کن.',
    finishingClaim: 'در حال نهایی کردن جایزه…',
  },
  menu: {
    title: 'کرون کلش',
    subtitle: 'قلمرو را تسخیر کن',
    coins: 'سکه',
    coinsRealm: 'سکه · قلمرو',
    wins: 'برد',
    commanderLine: (name: string): string => `فرمانده  •  ${name}`,
    play: 'بازی',
    scouting: 'در حال جست‌وجو…',
    tryAgain: 'تلاش دوباره',
    livePvp: 'نبرد آنلاین',
    livePvpOffline: 'نبرد آنلاین (آفلاین)',
    levels: 'مراحل',
    trainingRequired: 'آموزش  •  الزامی',
    daily: 'روزانه',
    offline: 'آفلاین',
    league: 'لیگ',
    kingdom: 'قلمرو',
    council: 'فرماندهان',
    connectionRequired: 'برای بارگذاری قلمرو به اینترنت نیاز است.',
    retry: 'تلاش دوباره',
  },
  lobby: {
    title: 'نبرد آنلاین',
    subtitle: 'همین حالا با یک فرمانده رقابت کن',
    quickMatch: 'بازی سریع',
    twoVTwo: '۲ در ۲ دوستانه',
    twoVTwoSub: 'هم‌تیمی شو · بدون تغییر جام',
    createBattle: 'ساخت اتاق نبرد',
    joinBattle: 'ورود به اتاق',
    roomCreated: 'اتاق نبرد ساخته شد',
    shareCode: 'این کد را برای حریفت بفرست',
    copy: 'کپی',
    copied: 'کپی شد',
    share: 'اشتراک',
    waitingOpponent: 'منتظر حریف…',
    leaveRoom: 'خروج از اتاق',
    enterCode: 'کد دعوت را وارد کن',
    codeHint: 'کد ۸ حرفی که دوستت فرستاده',
    tapToType: 'برای تایپ بزن',
    inviteCodeLabel: 'کد دعوت',
    join: 'ورود',
    cancel: 'انصراف',
    connecting: 'در حال اتصال…',
    creatingRoom: 'در حال ساخت اتاق…',
    joiningRoom: 'در حال ورود به اتاق…',
    findingOpponent: 'در حال یافتن حریف…',
    noOpponentBot: 'حریفی آنلاین نبود.\nنبرد با بات شروع می‌شود…',
    finding2v2: 'در حال یافتن نبرد ۲ در ۲…\nبه ۴ فرمانده نیاز است',
    retry: 'تلاش دوباره',
    back: 'بازگشت',
    connectFailed: 'اتصال به نبرد آنلاین برقرار نشد.',
    invalidCode: 'کد نامعتبر است.',
    shareText: (code: string): string => `به نبرد آنلاین من در کرون کلش بپیوند! کد: ${code}`,
  },
} as const;

/** game-core milestone labels ("M5 ✓", "M5→10") in Persian. */
export function upgradeMilestoneLabel(label: string): string {
  const done = /^M(\d+) ✓$/.exec(label);
  if (done) return `مرحلهٔ ${done[1]} کامل`;
  const next = /^M\d+→(\d+)$/.exec(label);
  if (next) return `هدف: سطح ${next[1]}`;
  return label;
}

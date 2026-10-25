/**
 * Persian copy for the battle UI (HUD, drag preview, result/pause/reconnect
 * modals). Kept separate from `fa.ts` so menu and battle copy can evolve
 * independently. Digits stay Latin. Display names for data that lives in
 * game-core (battlefields, tower names, upgrade effects) are mapped here by id
 * or pattern, with the English data as the fallback.
 */

const BATTLEFIELD_NAMES: Readonly<Record<string, string>> = {
  crown_cross: 'چهارراه تاج',
  twin_passes: 'گذرگاه‌های دوقلو',
  royal_ring: 'حلقهٔ سلطنتی',
  quad_citadel: 'دژ چهارگانه',
};

export function battlefieldName(id: string, fallback: string): string {
  return BATTLEFIELD_NAMES[id] ?? fallback;
}

const TERRITORY_EXPLICIT: Readonly<Record<string, string>> = {
  'Player Fortress': 'دژ ما',
  'Enemy Citadel': 'قلعهٔ دشمن',
  'Crown Keep': 'برج تاج',
  'Quad Keep': 'برج چهارگانه',
};

const TERRITORY_KINDS: Readonly<Record<string, string>> = {
  Barracks: 'سربازخانه',
  Stable: 'اصطبل',
  Bastion: 'بارو',
  Outpost: 'پاسگاه',
  Gate: 'دروازه',
  Pass: 'گذرگاه',
  Spur: 'تیغه',
  Citadel: 'قلعه',
};

const TERRITORY_DIRECTIONS: Readonly<Record<string, string>> = {
  North: 'شمال',
  South: 'جنوب',
  East: 'شرق',
  West: 'غرب',
  Northeast: 'شمال‌شرق',
  Northwest: 'شمال‌غرب',
  Southeast: 'جنوب‌شرق',
  Southwest: 'جنوب‌غرب',
  Lower: 'پایین',
  Upper: 'بالا',
};

/**
 * Persian display name for a tower: `<kind> <direction> [level]`, e.g.
 * "East Lower Outpost" -> "پاسگاه شرق پایین". Unknown names stay English.
 */
export function territoryName(name: string): string {
  const explicit = TERRITORY_EXPLICIT[name];
  if (explicit) return explicit;
  const words = name.split(' ');
  const kindIndex = words.findIndex((word) => TERRITORY_KINDS[word] !== undefined);
  if (kindIndex < 0) return name;
  const rest = [...words.slice(0, kindIndex), ...words.slice(kindIndex + 1)];
  if (!rest.every((word) => TERRITORY_DIRECTIONS[word] !== undefined)) return name;
  const side = words.slice(kindIndex + 1).map((word) => TERRITORY_DIRECTIONS[word]);
  const lead = words.slice(0, kindIndex).map((word) => TERRITORY_DIRECTIONS[word]);
  return [TERRITORY_KINDS[words[kindIndex]], ...lead, ...side].join(' ');
}

const OWNERS: Readonly<Record<string, string>> = {
  player: 'تو',
  enemy: 'دشمن',
  neutral: 'بی‌طرف',
};

const BOT_DIFFICULTIES: Readonly<Record<string, string>> = {
  easy: 'آسان',
  normal: 'عادی',
  hard: 'سخت',
};

/** `+4 troops`, `+10% production` ... from game-core's upgrade labels. */
export function upgradeEffectLabel(label: string): string {
  return label
    .replace(/troops$/, 'سرباز')
    .replace(/% production$/, '٪ تولید')
    .replace(/% march$/, '٪ سرعت حرکت')
    .replace(/% coins$/, '٪ سکه');
}

export const faBattle = {
  names: {
    opponent: 'حریف',
    player: 'بازیکن',
    commander: 'فرمانده',
    commanderShort: 'فرمانده ',
    ally: 'هم‌تیمی',
  },
  legend: { shields: 'دفاع', trains: 'تولید', marches: 'سرعت' },
  hud: {
    battlefieldTitle: (name: string): string => `◆ ${name}`,
    draggingTeamHint: '⚔ از برج‌ها بکش — پایگاه‌ها با هم‌تیمی مشترک است',
    liveHint: (opponent: string): string => `⚔ نبرد آنلاین با ${opponent}`,
    botNoTrophies: (difficulty: string): string => `بات ${botDifficulty(difficulty)} · بدون جام`,
    botDrag: (difficulty: string): string => `بات ${botDifficulty(difficulty)} · از برج‌ها بکش`,
    selectingHint: (towers: number, troops: number): string =>
      `⚔ ${towers} برج انتخاب شد · ${troops} سرباز آماده`,
    lastEnemyArmy: '⚔ آخرین لشکر دشمن باقی مانده',
    production: (percent: number, seconds: string): string => `تولید ${percent}%\n${seconds}ث`,
    inspector: (name: string, owner: string, prod: string, def: number, spd: number): string =>
      `${territoryName(name)} · ${OWNERS[owner] ?? owner}\nتولید ${prod}/s · دفاع ×${def} · سرعت ×${spd}`,
  },
  ability: {
    royal_shield: { name: 'سپر سلطنتی', target: 'روی یکی از برج‌هایت بزن تا 8 ثانیه دو برابر مقاوم شود', used: 'سپر فعال شد!' },
    supply_drop: { name: 'تدارکات', target: 'روی یکی از برج‌هایت بزن تا 5 سرباز بگیرد', used: '5 سرباز رسید!' },
    vanguard_charge: { name: 'یورش', target: 'از برجت به هدف بکش — سربازها دو برابر قوی و تندتر می‌روند', used: 'یورش!' },
    locked: (seconds: number): string => `قدرت فرمانده تا ${seconds} ثانیه دیگر`,
    ready: 'قدرت فرمانده آماده است — دکمه را بزن!',
    cancelled: 'لغو شد',
    invalid: 'این‌جا نمی‌شود — برج خودت را انتخاب کن',
    chargeLabel: 'یورش',
  },
  drag: {
    reinforce: (n: number, src: string): string => `+${n} تقویت${src}`,
    win: (n: number, rem: number, src: string): string => `⚔ ${n} (برد +${rem})${src}`,
    tie: (n: number, src: string): string => `⚔ ${n} (مساوی)${src}`,
    lose: (n: number, needed: number, src: string): string => `⚔ ${n} (-${needed})${src}`,
    send: (n: number, src: string): string => `⚔ ارسال ${n}${src}`,
    bases: (n: number): string => ` (${n} پایگاه)`,
    towersSelected: (n: number): string => `${n} برج انتخاب شد`,
    towersSelectedHint: 'از برج‌های آبی بیشتری بکش، بعد هدف را انتخاب کن',
    partialSources: (sent: number, total: number): string => `${sent}/${total} برج · `,
    noRoute: (n: number, friendly: boolean): string =>
      `${n} برج انتخابی مسیر ${friendly ? 'دوستانه' : 'مستقیم'} ندارد`,
    tooFew: (n: number): string => `${n} برج انتخابی سرباز کافی ندارد`,
    sendStay: (sent: number, left: number): string => `${sent} ارسال · ${left} می‌ماند`,
    estimateReinforce: 'تقویت',
    estimateCapture: 'تسخیر محتمل',
    estimateDefense: 'دفاع محتمل',
    currentBoard: 'وضعیت فعلی',
    releaseToReinforce: 'رها کن تا تقویت شود · ادامه بده تا این برج هم انتخاب شود',
    mayChange: 'ورود لشکرها و تولید می‌تواند نتیجه را عوض کند',
    commandLimit: 'سقف دستورها پر شد',
    needMoreTroops: 'سرباز کافی نیست — اول برج را تقویت کن',
  },
  float: {
    supplyIntercepted: 'تدارکات رهگیری شد',
    capture: (n: number): string => `تسخیر +${n}`,
    towerLost: 'برج از دست رفت',
    deflect: (n: number): string => `دفع -${n}`,
    rematchUnavailable: 'بازی مجدد ممکن نیست',
  },
  result: {
    victory: 'پیروزی!',
    draw: 'مساوی',
    defeat: 'شکست',
    automaticDefense: (name: string): string => `⚔ ${name} · دفاع خودکار`,
    botPractice: 'تمرین با بات · بدون جام',
    winSub: '👑 همهٔ پایگاه‌های دشمن تسخیر شد!',
    drawSub: '⚔ نبرد مساوی تمام شد',
    loseSub: '⚔️ دفاع‌هایت سقوط کردند',
    rank: (badge: string, name: string, trophies: number): string => `${badge} ${name} (🏆 ${trophies})`,
    trophies: 'جام',
    goldReward: 'جایزهٔ سکه',
    base: (n: number): string => `پایه: ${n}`,
    speed: (n: number): string => `سرعت: +${n}`,
    dominance: (n: number): string => `برتری: +${n}`,
    streak: (n: number): string => `برد پیاپی: +${n}`,
    treasury: (n: number): string => `خزانه: +${n}`,
    noRepeatReward: 'جایزهٔ تکراری ندارد · نبرد ثبت شد',
    stats: (time: number, captured: number, sent: number, streak: number, wins: number): string =>
      `⏱ زمان: ${time}s    🏰 تسخیر: ${captured}    ⚔ ارسال: ${sent}\n🔥 برد پیاپی: ${streak}    👑 کل بردها: ${wins}`,
    promoted: (rank: string): string => `🎉 ارتقا به ${rank}!`,
    upgrades: {
      starting_garrison: 'دژ',
      production: 'آهنگری',
      army_speed: 'راه‌های سلطنتی',
      treasury: 'خزانه',
    } as Readonly<Record<string, string>>,
    upgradeRow: (icon: string, title: string, level: number, max: number, detail: string): string =>
      `${icon} ${title} سطح ${level}/${max}\n${detail}`,
    upgradeNext: (effect: string): string => `بعدی: ${upgradeEffectLabel(effect)}`,
    max: 'حداکثر',
    growRealm: 'قلمروت را رشد بده',
    upgradeArmy: 'ارتشت را ارتقا بده',
    playAgain: 'بازی دوباره ⚔',
    scouting: 'در حال جست‌وجو…',
    tryAgain: 'تلاش دوباره',
    shareResult: 'اشتراک نتیجه 📢',
    tryShareAgain: 'اشتراک دوباره',
    mainMenu: 'منوی اصلی',
    shareWin: (time: number, trophies: number): string =>
      `👑 در کرون کلش ${time} ثانیه‌ای پیروز شدم! 🏆 جام‌ها: ${trophies} ⚔️ قلمروم را به چالش بکش!`,
    shareLose: '⚔ در کرون کلش برای تاج جنگیدم! قلمروم را به چالش بکش!',
    connectionLost: 'اتصال قطع شد',
    syncFailed: 'ثبت نتیجه ناموفق',
    liveSurrendered: 'نبرد آنلاین تسلیم شد.\nبه منوی اصلی برگرد.',
    notSaved: 'نتیجه ذخیره نشد.\nپیش از خروج دوباره تلاش کن.',
    retrySync: 'تلاش دوباره',
    battleComplete: 'نبرد تمام شد',
    syncing: 'در حال ثبت نتیجه…',
  },
  menu: {
    battleMenu: 'منوی نبرد',
    paused: 'توقف',
    liveContinues: '● نبرد آنلاین ادامه دارد',
    resume: 'ادامه',
    soundOn: 'صدا: روشن',
    soundOff: 'صدا: خاموش',
    surrender: 'تسلیم',
    leaveMatch: 'ترک بازی',
    leaveTitle: 'ترک بازی؟',
    keepPlaying: 'ادامه بازی',
    surrenderConfirm2v2: 'با تسلیم از این نبرد خارج می‌شوی.\nهم‌تیمی‌ات به جنگ ادامه می‌دهد.',
    leaveTraining: 'از آموزش خارج می‌شوی؟\nپیشرفتت ذخیره می‌شود.',
    leaveLive: 'خروج یعنی باخت در این بازی.',
    leaveBot: 'پیشرفت این نبرد از بین می‌رود.',
  },
  twoVTwo: {
    youMarker: '★ تو',
    youInline: ' ★تو',
    banner: (shape: string, label: string, name: string): string =>
      `${shape} ${label} · هم‌تیمی: ${name} · پایگاه‌های مشترک`,
    yourTeam: (icon: string, team: string, winner: boolean): string =>
      `${icon} تیم تو ${team}${winner ? ' — برنده' : ''}`,
    enemyTeam: (icon: string, team: string, winner: boolean): string =>
      `${icon} تیم حریف ${team}${winner ? ' — برنده' : ''}`,
    abandoned: (coins: number | null): string => `ترک کرد${coins === null ? '' : ` · +${coins}🪙`}`,
    cancelledNote: 'نتیجه‌ای برای این نبرد ثبت نشد.',
    rematchFound: 'حریف پیدا شد — ورود به میدان…',
    shareWin: '👑 تیم ما دژ چهارگانه را در کرون کلش ۲ در ۲ گرفت! ⚔️ به نبرد بپیوند!',
    shareLose: '⚔ تیم ما در کرون کلش ۲ در ۲ برای دژ چهارگانه جنگید! ما را به چالش بکش!',
    cancelledTitle: 'نبرد لغو شد',
    cancelledSubtitle: 'نبرد رها شد.\nجام و سکه‌ای جابه‌جا نشد.',
    winSub: '👑 تیمت دژ را گرفت',
    loseSub: '⚔️ دفاع‌های تیمت سقوط کردند',
    drawSub: '🛡 هیچ طرف دژ را نگرفت',
    casualNotice: 'بازی دوستانه — بدون تغییر جام',
    rematchSent: 'رأی بازی مجدد ارسال شد ✓',
    rematchVote: 'رأی بازی مجدد 🔄 (هر ۴ نفر باید موافق باشند)',
  },
  reconnect: {
    title: 'اتصال قطع شد',
    subtitle: (attempt: number): string =>
      `در حال اتصال مجدد… (تلاش ${attempt})\nجایگاهت تا 30 ثانیه نگه داشته می‌شود`,
    abandonedTitle: 'نبرد رها شد',
    abandonedSubtitle: 'به‌موقع برنگشتی.\nنبرد بدون تو ادامه دارد.',
    returnToMenu: 'بازگشت به منو',
  },
} as const;

function botDifficulty(difficulty: string): string {
  return BOT_DIFFICULTIES[difficulty] ?? difficulty;
}

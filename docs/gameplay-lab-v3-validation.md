# گزارش اعتبارسنجی Gameplay Lab v3

این گزارش تاریخی مربوط به commit `83d4931` است؛ نسخه‌های D/E/F از کد فعلی حذف شده‌اند. گزارش فعلی در [gameplay-lab-validation.md](gameplay-lab-validation.md) قرار دارد.

تاریخ: ۲۰۲۶-۱۰-۰۸. دامنه: چهار آزمایش مستقل C/D/E/F، فقط در development. راهنمای همان نسخه در تاریخچهٔ Git موجود است.

## تغییرهای قابل بررسی

- `packages/game-core/src/gameplay-lab-config.ts`: مقادیر مشترک، چهار profile و override محلی D.
- `gameplay-lab-ai.ts`: forecast پنج‌ثانیه‌ای، دفاع E، بررسی دقیق امنیت منابع و سرمایه‌گذاری F. امتیازدهی تولیدی در `ai.ts` استخراج شده و ترتیب/خروجی evaluator تولیدی حفظ شده است.
- `simulation.ts`, `types.ts`, `gameplay-lab.ts`: ارتقا، حذف در capture، فرمان‌های مجزا و replay ثابت بیست‌میلی‌ثانیه‌ای.
- `apps/game/src/gameplay-lab`: سهمیه/ترتیب پایلوت، ratingهای سه‌گانه، offer/اولین پاسخ، reflection، گزارش، v3 و اعتبارسنجی import با replay.
- `GameScene.ts`: tap اطلاعات و دکمهٔ ارتقا، بازخورد و غیرفعال‌سازی در شرایط نامعتبر.
- `scripts/simulate-gameplay-lab.mjs`, `scripts/gameplay-lab-qa.mjs` و تست‌ها: شواهد شبیه‌سازی، touch، performance و isolation.

نقشهٔ مشترک سرور، اقتصاد و مسیر multiplayer تغییر نکردند. قالب A/B فقط برای تست‌های مقایسهٔ قدیمی موتور باقی است؛ UI و import v3 فقط C/D/E/F را می‌پذیرند.

## نتیجهٔ checks

| فرمان | نتیجه |
|---|---|
| `npm test` | ۹۱۷ پاس، ۲ skip موجود؛ صفر شکست |
| `npm run typecheck` | پاس برای core، platform و game |
| `npm run build` | پاس؛ هشدار اندازهٔ chunk مربوط به Phaser باقی است |
| `CROSS_ENGINE_GO_MODE=host npm run test:parity` | پاس ابزار؛ TS/Go در ۶۸ سناریو برابر؛ client prediction در ۶۷/۶۸، شامل مورد ورودی نامعتبر ابزار |
| `CROSS_ENGINE_GO_MODE=host npm run test:parity:2v2` | پاس در ۲۹ سناریو، شامل رد ورودی نامعتبر |
| `npm run test:gameplay-lab` | ۲۲۴ match؛ state، accumulator و تمام record در replay یکسان |
| `npm run test:qa:gameplay-lab` | touch و بررسی بصری چهار نسخه در دو viewport پاس |
| QA روی build تولیدی با `?gameplay_lab=1` | ورود عادی MenuScene؛ Lab UI و store باز نشدند |
| `git diff --check` | بدون خطای whitespace |

Skipها مربوط به تست live 2v2 بدون opt-in و شاخهٔ نبودن cwebp روی سیستمی هستند که cwebp دارد. هیچ check ضروری این Lab skip نشده است.

QA شامل tap خودی/خنثی/دشمن، حفظ drag و multi-select، هزینهٔ دقیق ارتقا و دکمهٔ ۴۶px، منع ارتقای مجدد و هنگام drag، به‌روزرسانی مالکیت، recovery، نتیجهٔ خودکار، هشت match اصلی، چهار offer هم‌وزن، reload با offer بی‌پاسخ، retry اختیاری، export واقعی و import idempotent است. Pointer fixtureهای دارای state دست‌کاری‌شده از دادهٔ پایلوت/import کنار گذاشته شدند. matchهای اصلی QA با موتور واقعی تا نتیجه اجرا شدند؛ این‌ها دادهٔ انسانی نیستند.

در Lab هیچ درخواست خارجی/API مسدودشده، event analytics تولیدی، career/ledger/daily/league write یا خطای runtime مرورگر ثبت نشد. کلید v2 بدون تغییر باقی ماند. تست scene دسترسی به CareerManager، login/settlement/reward و terminal analytics را نیز منع می‌کند.

## AI با CPU چهار برابر کندتر

Chrome headless با CDP throttling واقعی ۴×، ۳۰ warmup و ۱۲۰ تصمیم؛ دو حالت هجده ارتشِ در راه، شامل سفر طولانی و حمله/دفاع نزدیک. زمان‌ها روی همین کامپیوتر هستند، نه یک گوشی Android فیزیکی.

| viewport | تصمیم | ارتش | p95 (ms) | max (ms) |
|---|---:|---:|---:|---:|
| 360×640 | 120 | 18 | 5.50 | 8.20 |
| 390×844 | 120 | 18 | 5.30 | 5.80 |

هر دو شرط p95 < 16ms و max ≤ 50ms برقرار بودند.

## شبیه‌سازی و خطرهای balance

Rush، expansion، counterattack و بات هر نسخه، با جابه‌جایی طرف‌ها و ترتیب ارسال اجرا شدند. F برای هر policy، سرمایه‌گذاری فعال و غیرفعال دارد.

| نسخه | match | رسیدن به سقف زمان | میانگین capture | تعداد upgrade |
|---|---:|---:|---:|---:|
| C | 32 | 6 | 17.47 | 0 |
| D | 32 | 12 | 21.72 | 0 |
| E | 32 | 8 | 18.16 | 0 |
| F | 128 | 21 | 18.51 | 30 |

هیچ match سی ثانیهٔ آخر را بدون capture نگذرانده است. D در این policyها بیشتر به سقف زمان رسید؛ طولانی شدن match یک خطر قابل بررسی در playtest است. در F، سرمایه‌گذاری خودکار برتری سراسری نشان نداد و فقط ۳۰ ارتقا رخ داد. Counterattack در F با و بدون سرمایه‌گذاری ۲۲ برد از ۳۲ appearance داشت؛ نتیجهٔ یک مجموعهٔ policy است و راهبرد غالب انسانی را اثبات نمی‌کند. از این اعداد برندهٔ engagement اعلام نمی‌شود.

## حساسیت تست‌ها

کنترل‌های منفی موقت پس از اجرا بازگردانده شدند و مسیر درست دوباره پاس شد:

- هزینهٔ ۱۳ به‌جای ۱۲ و حذف تصمیم تاکتیکی E: ۷ شکست مرتبط در تست دامنه.
- حذف شرط تکمیل پایلوت و حذف arming tap در object pointerdown: ۴ شکست در report و tap خودی/خنثی/دشمن.
- قبول همهٔ منابع به‌عنوان امن: ۲ شکست، شامل گرد کردن دفاع قلعه در دو حملهٔ متوالی. نسخهٔ درست امنیت منابع را با موتور مشترک، پس از کسر نیروی ارسالی، پیش‌بینی می‌کند.
- `CC_LAB_QA_NEGATIVE_CONTROL=performance`: شکست به دلیل p95 و max برابر ۶۰ms. Assertهای benchmark تضعیف نشدند.

## کار انسانی باقی‌مانده

پایلوت شش‌نفره هنوز اجرا نشده است؛ هیچ شاهدی برای engagement یا retention و هیچ نسخهٔ برنده‌ای اعلام نشده است. باید ۴۸ match اصلی، ratingهای سه‌گانه، ۲۴ پاسخ offer، ترجیح و reflection جمع شوند. شرط حداقل چهار ترجیح، حداقل دو replay بیشتر از C و بدتر نبودن هر سه median اعمال می‌شود. سپس دربارهٔ ترکیب تغییرها و مرحلهٔ بعد تصمیم گرفته می‌شود.

Touch این مرحله رویداد واقعی مرورگر تحت emulation است. بررسی روی گوشی فیزیکی کم‌قدرت و WebView بله/ایتا/تلگرام همچنان لازم است. هیچ انتشار gameplay اصلی در این مرحله انجام نشده است.

Screenshotها، JSON evidence و simulation قابل بازتولید در `qa-artifacts/gameplay-lab` هستند؛ فایل‌های تولیدشده و profile مرورگر وارد Git نمی‌شوند. متن گزارش و ابزارهای بازتولید در repository ثبت می‌شوند.

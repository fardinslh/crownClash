# Gameplay Lab — C، نسخهٔ ۴

C تنها گزینهٔ قابل اجراست. نسخه‌های A/B و D/E/F، بات تاکتیکی و ارتقای تولید حذف شده‌اند. این انتخاب، انتخاب محافظه‌کارانهٔ پایهٔ موجود است؛ دادهٔ انسانی برای معرفی برندهٔ engagement نداریم.

Lab فقط در development با `?gameplay_lab=1` باز می‌شود. بازی production از این مسیر وارد Lab نمی‌شود. login، settlement، reward، career و analytics تولیدی در Lab اجرا نمی‌شوند. نقشهٔ مشترک سرور تغییر نکرده است.

## اجرا و قواعد

```sh
npm --workspace=apps/game run dev -- --host 0.0.0.0
```

آدرس: `http://localhost:3000/?gameplay_lab=1`. برای گوشی از IP محلی کامپیوتر استفاده کنید. اگر پورت مشغول است، پورت انتخاب‌شدهٔ Vite را جایگزین کنید.

تنظیمات در `packages/game-core/src/gameplay-lab-config.ts` هستند: نقشهٔ `crown_cross`، شروع با ۲۰ نیرو، ارسال ۵۰٪، سقف ۹۰ ثانیه و یک تصمیم بات فعلی هر ۱٫۸ ثانیه. پس از تصرف، تولید از ۵۰٪ طی سه ثانیه کامل می‌شود؛ recapture در recovery زمان را تمدید نمی‌کند. پیشرفت تولید قبلی هنگام capture پاک می‌شود. دفاع، ظرفیت، سرعت و ضرایب نوع ساختمان حفظ شده‌اند.

Tap کوتاه، حداکثر ۲۵۰ms و جابه‌جایی کمتر از ۱۰ پیکسل CSS، اطلاعات تولید مؤثر، دفاع و سرعت را نشان می‌دهد. Drag و multi-select فرمان حمله‌اند. دکمهٔ ارتقا وجود ندارد. با تغییر مالکیت، اطلاعات همان frame به‌روز می‌شوند.

## بازخورد C

شش نفر، هر نفر دو match اصلی C: ۱۲ match. شمارهٔ بازیکن روی دستگاه‌ها یکتا و ثابت باشد. دکمهٔ match اصلی سهمیه را جلو می‌برد؛ practice، optional و quit جدا ثبت می‌شوند. Quit سهمیه را جلو نمی‌برد و retry همیشه optional است.

پس از هر match، سه امتیاز ۱ تا ۵ ثبت می‌شوند: تکراری بودن، زود معلوم شدن نتیجه و ناعادلانه بودن. پس از دومین match اصلی، «ادامهٔ تست» و «یک دست دیگر» با وزن بصری برابر نمایش داده می‌شوند. نمایش پیشنهاد و فقط اولین پاسخ هر نفر ثبت می‌شود. بعد از دو match و تکمیل ratingها، بازیکن یک تصمیمی را که در دست بعد عوض می‌کند ثبت می‌کند. rating و پیشنهاد بی‌پاسخ پس از reload قابل تکمیل‌اند.

گزارش، تعداد replay، ratingها، quit، نتیجه، مدت، انتخاب‌های آغازین، reinforcement و counterattack را نشان می‌دهد. تنها C آزمایش می‌شود؛ گزارش هرگز برنده یا نامزد مقایسه اعلام نمی‌کند و این داده‌ها اثبات retention نیستند.

## داده و replay

Schema و rules برابر ۴ و کلید ذخیره `crown_clash_gameplay_lab_v4` است. داده‌های v2 و v3 دست‌نخورده می‌مانند و load/import/merge نمی‌شوند. آزمایش قبلی در تاریخچهٔ Git و [گزارش تاریخی v3](gameplay-lab-v3-validation.md) قابل بررسی است.

Export شامل فرمان‌های `dispatch` دو طرف، tick، capture، snapshotهای یک‌ثانیه‌ای، نتیجه، مدت، نوع match، retry، rating، replay offer و reflection است. Replay بات را دوباره تصمیم‌گیری نمی‌کند؛ فرمان‌های ثبت‌شده را با tick ثابت ۲۰ms اجرا می‌کند. Snapshot هر tick پیش از فرمان همان tick ثبت می‌شود.

Import دادهٔ قدیمی، نسخهٔ حذف‌شده، فرمان نامعتبر، snapshot ناسازگار با replay، سهمیهٔ تکراری و offer متناقض را رد می‌کند و دادهٔ موجود را حفظ می‌کند. import مجدد همان export idempotent است؛ اولین پاسخ offer قابل جایگزینی نیست.

## اعتبارسنجی

```sh
npm test
npm run typecheck
npm run build
CROSS_ENGINE_GO_MODE=host npm run test:parity
CROSS_ENGINE_GO_MODE=host npm run test:parity:2v2
npm run test:gameplay-lab
npm run test:qa:gameplay-lab
node scripts/serve-dist.mjs 4173
CC_QA_EXPECT_PRODUCTION=1 CC_QA_APP_URL='http://127.0.0.1:4173/?gameplay_lab=1' npm run test:qa:gameplay-lab
```

QA به dev server و Chrome نیاز دارد؛ آدرس دلخواه با `CC_QA_APP_URL` تنظیم می‌شود. touch واقعی مرورگر با emulation در ۳۶۰×۶۴۰ و ۳۹۰×۸۴۴، tap، drag، multi-select، recovery، نتیجهٔ خودکار، دو match اصلی، پیشنهاد، reload، retry و import/export بررسی می‌شوند. fixtureهای دست‌کاری‌شدهٔ pointer پیش از تولید export کنار گذاشته می‌شوند؛ matchهای اصلی با موتور واقعی تا نتیجه اجرا می‌شوند و playtest انسانی نیستند.

بات فعلی با CPU throttling چهاربرابری اندازه‌گیری می‌شود؛ p95 باید کمتر از ۱۶ms و max حداکثر ۵۰ms باشد. کنترل منفی `CC_LAB_QA_NEGATIVE_CONTROL=performance npm run test:qa:gameplay-lab` باید با زمان تزریقی ۶۰ms شکست بخورد.

Simulation شامل rush، expansion، counterattack و امتیازدهی بات فعلی با جابه‌جایی طرف‌ها و ترتیب ارسال است: ۳۲ match. state، accumulator و record هر match باید دقیقاً با replay برابر باشند. screenshot، evidence و simulation در `qa-artifacts/gameplay-C` خارج از Git ذخیره می‌شوند. profileهای موقت مرورگر در finally پاک می‌شوند.

گزارش فعلی در [gameplay-lab-validation.md](gameplay-lab-validation.md) است. آزمایش روی گوشی فیزیکی، WebView پیام‌رسان و playtest انسانی هنوز انجام نشده‌اند.

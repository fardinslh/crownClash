# گزارش اعتبارسنجی C — نسخهٔ ۴

تاریخ: ۲۰۲۶-۱۰-۰۹. دامنه: نگه داشتن C و حذف سایر نسخه‌های آزمایشی. C به دلیل سادگی و انتخاب قبلی به‌عنوان پایه نگه داشته شده است؛ دادهٔ انسانی برای اثبات برتری engagement نداریم. این تغییر هنوز قوانین بازی اصلی سرور را به C تبدیل نمی‌کند.

## تغییرها

- config و ورودی‌های اجرا/import فقط C را می‌پذیرند. مسیر A/B و D/E/F، override نقشه، evaluator تاکتیکی و فرمان/وضعیت/دکمهٔ ارتقا حذف شدند.
- recovery از ۵۰٪ تا ۱۰۰٪ طی سه ثانیه، عدم تمدید در recapture، بات فعلی و کنترل drag/multi-select حفظ شدند. tap اطلاعات تولید، دفاع و سرعت را نمایش می‌دهد.
- سهمیهٔ بازخورد C برای شش نفر، دو match اصلی به‌ازای هر نفر است: ۱۲ match، شش پیشنهاد replay و reflection. practice/optional/quit جدا هستند. گزارش هیچ نامزد یا برندهٔ مقایسه اعلام نمی‌کند.
- schema/rules برابر ۴، storage فقط `crown_clash_gameplay_lab_v4`؛ داده‌های v2/v3 حفظ شده‌اند و import نمی‌شوند. گزارش تاریخی نسخهٔ قبل در [gameplay-lab-v3-validation.md](gameplay-lab-v3-validation.md) است.

## شواهد

| check | نتیجه |
|---|---|
| `npm test` | ۹۰۴ پاس، دو skip موجود، صفر شکست: core 181، platform 18، app 685، scripts 20 |
| `npm run typecheck` | core/platform/game پاس |
| `npm run build` | پاس؛ هشدار قبلی اندازهٔ chunk Phaser باقی است |
| `CROSS_ENGINE_GO_MODE=host npm run test:parity` | TS/Go: 68/68، client prediction: 67/68 با مورد ورودی نامعتبر موجود ابزار؛ فرمان پاس |
| `CROSS_ENGINE_GO_MODE=host npm run test:parity:2v2` | 29/29 پاس، شامل fail-closed ورودی نامعتبر |
| `npm run test:gameplay-lab` | ۳۲ match C؛ state، accumulator و record هر replay دقیقاً برابر |
| QA development | touch واقعی CDP با emulation در 360×640 و 390×844 پاس |
| QA production build با `?gameplay_lab=1` | ورود عادی MenuScene، نبود Lab UI/store در هر دو viewport |
| بررسی بصری | selection، inspector، recovery و offer در هر دو اندازه بررسی شدند |
| `git diff --check` | بدون خطای whitespace |

Skipها مربوط به live 2v2 بدون opt-in و نبود cwebp روی سیستمی هستند که این ابزار را دارد. هیچ check ضروری C skip نشده است.

QA شامل tap خودی/خنثی/دشمن بدون حمله، نبود upgrade، drag و multi-select با دو فرمان واقعی، شمارندهٔ `PROD 50% / 3.0s`، quit، retry اختیاری، دو match اصلی بدون دست‌کاری state تا نتیجهٔ خودکار، rating، دو گزینهٔ هم‌وزن، reload با پیشنهاد بی‌پاسخ، export واقعی و import idempotent است. fixtureهای دست‌کاری‌شدهٔ pointer پیش از ثبت دادهٔ import پاک می‌شوند؛ این QA playtest انسانی نیست.

در Lab هیچ درخواست خارجی/API مسدودشده، analytics تولیدی، career/ledger/daily/league write یا خطای runtime ثبت نشد. کلیدهای v2 و v3 دست‌نخورده ماندند. تست scene دسترسی به login/settlement/reward/CareerManager و terminal analytics را منع می‌کند.

## سرعت و simulation

بات فعلی با CPU throttling چهاربرابری Chrome، ۳۰ warmup و ۱۲۰ تصمیم در دو fixture سنجیده شد. fixture دارای ۱۸ ارتش در راه و تصمیم‌های غیرnull است. C فقط وضعیت فعلی پایگاه‌ها را امتیازدهی می‌کند؛ forecast آزمایشی حذف شده است. p95 در هر دو viewport برابر 0.10ms و max به‌ترتیب 0.60ms و 0.50ms بود؛ شرط p95 < 16ms و max ≤ 50ms برقرار است. JSON evidence زمان دقیق هر اجرا را نگه می‌دارد. این اندازه‌گیری روی همین کامپیوتر است و عملکرد گوشی فیزیکی را اثبات نمی‌کند.

Rush، expansion، counterattack و امتیازدهی بات فعلی با جابه‌جایی طرف‌ها و ترتیب ارسال اجرا شدند. از ۳۲ match، شش مورد به سقف ۹۰ ثانیه رسیدند؛ میانگین capture برابر 17.46875 بود و هیچ match سی ثانیهٔ آخر بدون capture نماند. نتایج policyها شاهد balance هستند و engagement را اثبات نمی‌کنند.

## حساسیت تست‌ها

کنترل‌های منفی بدون تضعیف assertionها اجرا شدند و نسخهٔ درست سپس دوباره پاس شد:

- ضریب شروع recovery برابر ۱ به‌جای ۰٫۵: چهار شکست مرتبط در تست دامنه.
- پذیرش دوبارهٔ نسخهٔ حذف‌شدهٔ D: شکست regression مربوط به رد ورودی بازنشسته.
- `CC_LAB_QA_NEGATIVE_CONTROL=performance`: شکست به دلیل p95/max برابر ۶۰ms.

در توسعهٔ benchmark، prerequisite «تصمیم غیرnull» یک fixture بدون هدف قابل حمله را رد کرد. fixture اصلاح شد و مسیر مثبت و منفی دوباره اجرا شدند.

## محدودیت‌ها و انتشار

Playtest انسانی، گوشی فیزیکی کم‌قدرت و WebView پیام‌رسان هنوز بررسی نشده‌اند. هیچ ادعای افزایش engagement/retention نداریم. screenshotها، simulation و evidence فعلی در `qa-artifacts/gameplay-C` و خارج از Git هستند؛ ابزارها و گزارش در repository ذخیره می‌شوند.

حذف نسخه‌ها برای commit آماده است. فعال‌سازی C در production نیازمند تعیین دامنهٔ انتشار و تغییر هماهنگ موتور authoritative سرور و replay است؛ cleanup فعلی چنین تغییری نمی‌دهد. push/deploy این مرحله هنوز انجام نشده است.

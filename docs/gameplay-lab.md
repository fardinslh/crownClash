# Gameplay Lab

Prototype-e local baraye moghayese-ye A (mabna), B (bonus-e jadde) va C (recovery-e tolid).
Voroodi faghat dar development faal-e. Match-ha login, settlement, reward,
rank, daily progress ya event-e analytics-e production nadaran.

## Ejra

```sh
npm --workspace=apps/game run dev -- --host 0.0.0.0
```

Dar browser `http://localhost:3000/?gameplay_lab=1` ro baz kon.
Baraye mobile az IP-e local-e computer ba hamin port va query estefade kon.
Har do taraf ba 20 niroo va modifier-e 1, rooye `crown_cross` bazi mikonan.

- A: ghavanin-e alan.
- B: hamle va reinforcement be har hadaf azad-e. Source-e vasl ba jadde-ye
  mostaghim, 25% sorat-e bishtar dare; masiryabi-e khodkar nadarim. Dar multi-select,
  hame-ye source-ha ersal mikonan va bonus baraye har masir joda hesab mishe.
  Highlight neshan-e bonus-e jadde-st. Bot ham hamin bonus ro migire.
- C: pas az fath-e neutral ya doshman, tolid az hamoon tick ba 50% shoroo mishe
  va khatti, tey 150 tick-e 20ms (3s), be 100% mires-e. Recapture dar recovery,
  deadline ro reset nemikone. Fath pas az takmil-e recovery, recovery-e jadid
  misaze. Reinforcement reset nemikone. Defa va ersal azad-an. Progress-e
  tolid-e malek-e ghabli montaghel nemishe. Label darsad va zaman-e baghimande ro neshon mide.

Bonus-e 25%, tolid-e aval-e 50% va recovery-e 150 tick dar `gameplay-rules.ts`
taarif shodan. In adad-ha baraye prototype-an va bayad ba playtest sanjide beshan.

## Playtest-e 6 nafar

Har nafar yek shomare-ye 1 ta 6 entekhab kone. Tartib-e pishnahadi baraye
har shomare dar safhe hast: har noskhe do bar, ba tartib-e charkheshi.
Ba'd az har match, emtiaz-e tekrar va maloom shodan-e zoodhangam-e natije
ro az 1 (kam) ta 5 (ziyad) sabt kone. Dar akhar, noskhe-ye tarjihi ro entekhab kone.

Retry-e ekhtiari jodagane sabt mishe; jozv-e 6 match-e asli hesab nemishe.
Quit ham sabt mishe va bayad match-e asli dobare anjam beshe.
Preference faghat pas az takmil-e match-ha dar tahlil estefade mishe.

Data dar `crown_clash_gameplay_lab_v2` zakhire mishe va ba Export JSON khorooji
migire. Export shamel action-ha-ye har do taraf, capture-ha, snapshot-e har
saniye, natije, quit, retry, rating va gozaresh-e pilot-e.
Schema va rules version-e in azmayesh 2-e. Data-ye version-e 1 dar key-e ghabli
hefz mishe, vali load/import nemishe ta ghavanin-e motefavet moghayese nashan.
Dar chand device, JSON-ha ro ba shomare-ye yekta-ye bazikon jam kon va ba
Import JSON dar safhe-ye entekhab import kon. Trial-ha ba ID edgham mishan;
import-e dobare tedad-e match ro ziyad nemikone. Baraye trial ya preference-e
tekrar-shode, file-ye akhar estefade mishe. JSON-e namotabar rad mishe;
owner, niroo, capture, snapshot va tartib-e tick-ha ham validate mishan.
Ba Export JSON, gozaresh-e data-ye jam-shode ro migiri.

Gate-e pilot: hadeaghal 4 az 6 nafar B ya C ro tarjih bedan va median-e
har do rating dar do match-e asli-e har nafar az A bishtar nashe. Ta data-ye
hame-ye nafarat takmil nashe, report hich candidate-i moarefi nemikone.
Taghyir-e lead va faghed-e capture boodan faghat proxy-an; retention ro sabet nemikonan.

## Verification

```sh
npm test
npm run typecheck
npm run build
CROSS_ENGINE_GO_MODE=host npm run test:parity
npm run test:gameplay-lab
npm run test:qa:gameplay-lab
```

QA-e browser be dev server va Chrome niaz dare. Touch-e multi-attack, retry,
natije-ye khodkar va import/export ro dar 360x640 va 390x844 check mikone.
Profile-ha dar temporary
directory-an; screenshots va evidence dar `qa-artifacts/gameplay-lab`-an.
Simulation 54 match ba rush, expansion va counterattack va jabejayi-e
taraf-ha ejra mikone. Har match bayad ba replay state-e daghighan yeksan bede.

## Natije-ye simulation-e rules version 2

| Noskhe | Match | Match-e ta time limit | Miyangin-e capture |
|---|---:|---:|---:|
| A | 18 | 4 | 22.5 |
| B | 18 | 9 | 20.7 |
| C | 18 | 4 | 22.4 |

Dar in policy-ha, hich match-i 30 saniye-ye akhar ro bedoon capture nagozarond.
B bishtar be time limit resid; in yek risk baraye kesh omadane match-e.
Counterattack dar B, 9 az 12 appearance ro bord; in neshane-ye risk-e balance-e,
na saboot-e strategy-e ghaleb dar bazi-e ensani.
In data-ye scripted-e, na playtest-e ensani. Pilot-e 6 nafar hanooz anjam nashode.
Ghavanin-e server baraye rollout-e in prototype taghyir nakardan.

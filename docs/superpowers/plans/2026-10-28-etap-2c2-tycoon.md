# Etap 2C2: wpięcie tycoona w grę — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** moduły ekonomii tycoon z C1 (`src/sim/economy/tycoon/**`) działają w prawdziwej grze: w `EconomyState`, `stepMinute`, poleceniach, zapisie i interfejsie, a potem są wyważone botami i opisane w oknie „Jak grać”.

**Architektura:** cały stan tycoona to jedno pole `EconomyState.tycoon: TycoonState`. `economy.ts` woła czyste funkcje modułów w kolejności z `tycoon/INTEGRATION.md` (wzorzec: `tycoon/sandbox.ts`, `stepSandbox`). Polecenia gracza idą wyłącznie przez `applyCommand` (`commands.ts`), więc dziennik i `replayRun` obejmują je same. Karta decyzji zatrzymuje grę w **wołających** `stepMinute` (`advanceEconomy`, `replayRun`, `skip`, boty), a nie w samym `stepMinute`: testy rankingu (gałąź B) wołają `stepMinute` w pętli i zawisłyby.

**Stos:** TypeScript, Vitest, Preact + signals, Vite. Bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-27-traszka-tycoon-design.md` (§6.5, §7.1a, §7.5, §10), kontrakty `docs/superpowers/specs/2026-10-28-etap-2-podzial-i-kontrakty.md`, instrukcja C1 `src/sim/economy/tycoon/INTEGRATION.md` (decyzje właściciela z 28.10 i kolejność kroków minuty), raport C1 `docs/superpowers/reports/2026-10-28-etap-2c1.md`. Wykonawca czyta `INTEGRATION.md` przed każdym zadaniem kamienia 1.

## Zasady wspólne (obowiązują w każdym zadaniu)

- `src/sim` przechodzi `tests/architecture.test.ts`: bez `Date`, `Math.random`, `performance`, `window`, `localStorage`, `process`, `fetch`, `self`, `**`, `Math.pow` (jest `powInt` w `exactMath.ts`), `Math.log*`, `Math.hypot`, trygonometrii. Losowanie tylko `rand01`: w `tycoon/` kanały ze stałych `CH` (`tycoon/channels.ts`, 100–199), poza nim literały < 100.
- Polecenia (`Command`) mają tylko płaskie pola; nowe polecenie przechodzi wszystkie kroki z komentarza nad `Command` w `commands.ts` (unia, `VALID`, `run`, `COMMAND_TYPES`, `CASES` w `commands.test.ts`, `AFTER` w `src/game/actions.ts`, wysyłka przez `game.dispatch`). Nazwy poleceń w camelCase, jak istniejące.
- Stan to JSON z liczbami i identyfikatorami. Teksty z liczbami formatuje interfejs (`toLocaleString('pl-PL')`), a `fillText`, `kpiTitle` i `hintText` dostają funkcję formatującą. `text` w `EconEvent` może mieć liczby sformatowane, tak jak dziś (zdarzenia nie są stanem).
- Zapis: `EconomyState.version` zostaje `1`, a `SAVE_SCHEMA` zostaje `2`. Dzięki temu cofnięcie wdrożenia wczyta nowy zapis; nieznane pole `tycoon` przepadnie, ale postęp zostanie. Zapis bez `tycoon` migruje w `sanitizeEconomy`. Fixtures `src/game/fixtures/save-v1-*.json` i `save-v2-*.json` muszą się wczytać bez utraty gotówki, poziomu, XP, ulepszeń, sprzętu, remontu i historii.
- `seedHash` tycoona to `EconomyState.seedHash`: kanały 100–199 oddzielają go od losowań ekonomii.
- Nazwy fikcyjne: Traszka, Ogonki, Centrala, Szop 24h, Kawka Express. Żadnych prawdziwych marek. Teksty po polsku, z polskimi znakami.
- **Nie ruszaj:** `src/render/**`, `src/game/scene.ts`, `src/ui/sfx.ts`, `public/assets/audio/**`, `api/**`, `src/server/**`, `src/ui/ranking/**`. Dźwięki nowych zdarzeń biorą istniejące rodzaje `Sfx` (`'pop'`, `'coins'`, `'levelup'`, `'error'`…). Drobne zmiany są dozwolone w `src/game/frame.ts` (`isModalOpen`), `src/ui/App.tsx` (montowanie okien) i `src/ui/ui.css`.
- Po każdym zadaniu: `npx vitest run`, `npm run typecheck` i `npm run build` zielone. Commit po polsku ze stopką `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Bez push.
- Interfejs: czytelny na telefonie o szerokości 390 px, w stylu obecnych paneli (`tt-btn`, `Section`, `Row`, `Bar` w `src/ui/game/panels.tsx`, style w `src/ui/ui.css`).

## Na co uważać w przeglądzie

1. **Dziennik bez odpowiedzi na kartę:** `replayRun` nie może zawisnąć ani pominąć skutku karty. Zatwierdza wtedy odpowiedzi domyślne i dochodzi do `untilMinute`. Test w zadaniu 5.
2. **Stary albo zepsuty zapis:** brak `tycoon`, `trust` równe `null`, tekst albo 150, stare `priority`, `quests` i `giftAt`. Zapis wczytuje się z zaufaniem 60 albo przyciętym do 0–100 i z profilem z mapy priorytetów. Testy w zadaniach 1, 2 i 6.
3. **Stuknięcie, którego nie da się wykonać:** puste siły, zamknięty sklep, brak palety albo miejsca. Odmowa bez zużycia sił i bez `NaN`. Test w zadaniu 4.
4. **Przypięci ponad personel i zwolnienie:** `normalizePins`. `staffOnShift` daje dokładnie jedną pozycję na osobę na zmianie, także przy zerze ludzi, w nocy i przy chorym z karty. Test w zadaniu 2.
5. **×8 i karta w środku klatki:** `advanceEconomy` staje dokładnie na minucie `showAt`, ułamek zegara się nie zbiera, a po odpowiedzi gra rusza dalej. Test w zadaniu 5.

---

## Kamień 1: ekonomia i zapis

### Task 1: Stan tycoona w `EconomyState`, zaufanie Centrali, nowe liczniki i migracja zapisu

**Pliki:**
- Zmień: `src/sim/economy/economy.ts`, `src/sim/economy/sanitize.ts`, `src/sim/economy/tycoon/state.ts` (usuń `TycoonState.lastReport`, bo raport idzie do `MonthReport.detail` w zadaniu 6), `src/game/session.ts` (wywołanie `sanitizeEconomy`), `src/ui/game/panels.tsx` (`s.trust` → `s.tycoon.trust.value`)
- Testy: `src/sim/economy/sanitize.test.ts`, `src/sim/economy/economy.test.ts`, `src/game/session.test.ts`, `src/sim/economy/tycoon/state.test.ts`

**Interfejsy (produkuje):**
- `EconomyState.tycoon: TycoonState`; pole `EconomyState.trust` znika.
- `Counters` dostaje `bonus: number` (premie Centrali), `wut: number` (opłata WUT ponad próg) i `fineCount: number` (liczba mandatów). `emptyCounters` i `sanitize` uzupełniają brak zerem.
- `EconEventKind` dostaje `'trust-tier' | 'card' | 'card-result' | 'kpi-week'`.
- `export function changeTrust(s: EconomyState, reason: TrustReason, delta: number, out?: EconEvent[]): number` w `economy.ts` woła `addTrust`. Gdy zmieni się `trustTier(...).id`, dopisuje do `out` zdarzenie `{ kind: 'trust-tier', text: \`Zaufanie Centrali: ${tier.label}. ${tier.flavor}\` }`. Zwraca zmianę z `addTrust`.
- `export function kpiMetricsOf(s: EconomyState): KpiMetrics`: `customers`, `hotSold` i `lost` z `s.total`, `fines` z `s.total.fineCount`, `cleanSum` z `tycoon.hall.totalSum`, `cleanMinutes` z `tycoon.hall.totalMinutes`.
- `export function kpiScaleOf(s: EconomyState, info: StoreInfo): KpiScale`, czyli `{ dailyCustomers: expectedDailyCustomers(s, info), dailyMargin: estimatedDailyMargin(s, info), level: s.level }`.
- `export function sanitizeEconomy(raw: unknown, defaults: EconomyState, info: StoreInfo): EconomyState | null` z trzecim parametrem, bo skala KPI świeżego tygodnia potrzebuje `info`. `openSave` w `session.ts` podaje `world.info`.
- Prywatny helper `bonus(s, amount)` w `economy.ts`, jak `income`, ale na licznik `bonus`.

- [ ] **Krok 1: testy, które padają**
  - `sanitize.test.ts` → „zapis bez pola tycoon bierze zaufanie ze starego trust”: `raw.trust = 42` daje `tycoon.trust.value === 42`; `null`, `'x'` i brak dają 60; `150` daje 100.
  - `sanitize.test.ts`: test „wynik ma dokładnie pola `EconomyState`” uzupełniony o `tycoon`, bez `trust`.
  - `sanitize.test.ts` → „createEconomy przez JSON i sanitize wraca bajt w bajt”: `JSON.stringify(sanitizeEconomy(JSON.parse(JSON.stringify(e)), d, info)) === JSON.stringify(e)`.
  - `session.test.ts` → „fixtures save-v2-dzien30 i save-v2-remont2 wczytują się z postępem”: `cash`, `level`, `xp`, `upgrades`, `equipment`, `remontLevel` i `history` równe fixture; `tycoon.trust.value` równe `trust` z fixture. To samo dla `save-v1-*`.
  - `economy.test.ts` → „mandat obniża zaufanie z przyczyną mandaty”: po wymuszonym mandacie `tycoon.trust.month.mandaty === -1` i `total.fineCount === 1`.
  - `economy.test.ts` → „zaufanie 0 przy zamknięciu miesiąca to koniec gry”: przed ostatnim dniem miesiąca ustaw `tycoon.trust.value = 2`, wynik miesiąca ujemny; po 23:00 ostatniego dnia `gameOver === true`, a w zdarzeniach jest `'gameover'`.
  - `economy.test.ts` → „zmiana progu zaufania daje zdarzenie trust-tier”: `changeTrust(s, 'inne', -40, out)` z 60 daje `out` z `kind: 'trust-tier'`, a `changeTrust(s, 'inne', 0.1, out)` niczego nie dopisuje.
- [ ] **Krok 2:** uruchom `npx vitest run src/sim/economy src/game/session.test.ts`. Oczekiwane: nowe testy FAIL.
- [ ] **Krok 3: implementacja**
  - `createEconomy` buduje `tycoon: createTycoon({ day, seedHash, trust: TRUST.start, weather: rollWeather(seedHash, day, dateOfGameDay(day).month), metrics: kpiMetricsOf(s), scale: kpiScaleOf(s, info) })`. `tycoon` jest polem od początku, więc `kpiMetricsOf` czyta `s.total` i świeży `hall`; tycoon złóż po obiekcie bazowym.
  - Wszystkie zmiany zaufania idą przez `changeTrust`:
    - kierowca zabrał palety: `'palety'`, `TRUST.driverReturned`;
    - `returnPallet`: `'palety'`, `TRUST.returnedPallet`;
    - mandat: `'mandaty'`, `TRUST.fine`, plus `fineCount++`;
    - wynik miesiąca: `'wynik'`, `TRUST.monthProfit` albo `TRUST.monthLoss`.
  - Premia od obrotu w `closeMonth`: `bonus(s, Math.round(turnoverBonusShare(value) * m.revenue))`; dawne „≥ 70 to 1%” znika.
  - Wynik dnia i miesiąca: `margin + bonus + other − wages − media − fee − fines − logistics − wut`.
  - Na końcu `closeMonth`: `closeTrustMonth(s.tycoon.trust)` (zadanie 6 weźmie wynik do raportu). Potem, gdy `trustTerminates(value)` i nie ma jeszcze końca gry: `gameOver = true` i zdarzenie `'gameover'` z tekstem „Centrala wypowiada umowę franczyzową: zaufanie spadło do zera. Dziękujemy za współpracę.”
  - `sanitizeEconomy`: `tycoon: sanitizeTycoon(raw.tycoon, { day: dayOf(minute), seedHash, trust: raw.trust, staff, metrics, scale: kpiScaleOf(wynik, info) })`. Liczniki i `hall` są już po sanitize; `trust: raw.trust` daje surową wartość, a `sanitizeTrust` ją sprawdza.
- [ ] **Krok 4:** `npx vitest run`, `npm run typecheck`. Oczekiwane: PASS.
- [ ] **Krok 5:** commit `feat(tycoon): stan tycoona w EconomyState, zaufanie Centrali z przyczynami i migracja zapisu`.

### Task 2: Pula ludzi zamiast priorytetu, automatyka w osobominutach, `staffOnShift`

**Pliki:**
- Utwórz: `src/sim/economy/tycoon/shift.ts`, `src/sim/economy/tycoon/shift.test.ts`
- Zmień: `src/sim/economy/economy.ts`, `src/sim/economy/commands.ts`, `src/sim/economy/sanitize.ts`, `src/game/actions.ts` (`AFTER`), `src/ui/game/panels.tsx` (przyciski priorytetu zastąpione trzema przyciskami profilu; pełny panel to zadanie 8)
- Testy: `src/sim/economy/economy.test.ts`, `src/sim/economy/commands.test.ts`, `src/sim/run.test.ts` (polityka bota: `setPriority` → `setStaffProfile`/`pinStaff`), `src/game/actions.test.ts`, `src/ui/game/panels.test.tsx`

**Interfejsy:**
- Pobiera: `StaffPoolState`, `stepStaff`, `tillDemand`, `serveTill`, `unloadDemand`, `restockDemand`, `setStaffProfile`, `pinStaff`, `normalizePins`, `PEOPLE_PER_PALLET`, `RobotFleet` (`tycoon/staff.ts`).
- Produkuje:
  - `EconomyState.shift: { staff: number; human: TaskMinutes }`: liczba osób na zmianie i ich osobominuty wg zadania w ostatniej wykonanej minucie. Zapisuje go `stepMinute` w każdej minucie, także nocą (`staff: 0`).
  - `EconomyState.priority` znika.
  - `lastCashiers = shift.human.kasa` oraz `lastWorkers = human.rozladunek + human.wykladanie + human.sprzatanie` zostają. Czytają je tymczasowy adapter sesji „Ludzie na ekranie” i obecne panele.
  - Polecenia `{ type: 'setStaffProfile'; profile: StaffProfile }` i `{ type: 'pinStaff'; task: StaffTask; count: number }`. `count` jest całkowite i ≥ 0; górną granicę przycina `pinStaff`. `setPriority` znika z `Command`, `VALID`, `run`, `COMMAND_TYPES`, `CASES` i `AFTER`.
  - `fire` po zwolnieniu woła `normalizePins(s.tycoon.staff, s.staff)`.
  - `export function robotFleet(s: EconomyState): RobotFleet` = `{ tasmociag: level(s,'tasmociag'), wykladacz: level(s,'wykladacz'), prasa: level(s,'prasa'), edward: humanoid ? 1 : 0 }`. `'prasa'` dochodzi do `UpgradeId` w zadaniu 3; do tego czasu `level` daje 0.
  - `Effects.autoUnload` i `Effects.autoRestock` znikają (automatykę liczy pula).
  - `export function staffOnShift(state: EconomyState): Array<{ id: number; task: StaffTask | 'wolny' }>` w `tycoon/shift.ts`.
- [ ] **Krok 1: testy, które padają (`shift.test.ts`)**
  - „jedna pozycja na każdą osobę na zmianie”: dla `staff` 0…`STAFF_MAX` w godzinach otwarcia `staffOnShift(s).length === staff`, a `id` to kolejno 0…n−1.
  - „poza godzinami pracy pusto”: o 3:00 `[]`.
  - „chory z karty zmniejsza zmianę”: aktywny efekt karty `staff: -1` daje o jedną pozycję mniej.
  - „największe reszty”: n=3, `shift.human = { kasa: 1.4, rozladunek: 0.9, wykladanie: 0.7, sprzatanie: 0 }` daje zadania `['kasa', 'rozladunek', 'wykladanie']`.
  - „bezczynni to wolny”: n=3, human `{ kasa: 1.2, … 0 }` daje `['kasa', 'wolny', 'wolny']`.
  - „najpierw przypięci”: n=2, `pinned.sprzatanie = 1`, human `{ kasa: 1, sprzatanie: 1 }` daje `['kasa', 'sprzatanie']`.
  - „przypięty bez pracy wraca do puli”: n=2, `pinned.rozladunek = 1`, human `{ kasa: 2 }` daje `['kasa', 'kasa']`.
  - „pierwsza minuta po otwarciu”: `shift.staff === 0` przy n=2 daje `['kasa', 'wolny']`.
- [ ] **Krok 2:** `npx vitest run src/sim/economy/tycoon/shift.test.ts`. Oczekiwane: FAIL (brak modułu).
- [ ] **Krok 3: `staffOnShift`**
  - n = `isOpenMinute(minuteInDay(minute)) ? clamp(Math.floor(staff + cardModifiers(tycoon.cards, minute).staff), 0, STAFF_MAX) : 0`.
  - Gdy `shift.staff === 0` i n > 0: osoba 0 na kasie, reszta wolna.
  - W przeciwnym razie dla każdego zadania `k_t = min(pinned[t], floor(human[t] + 1e-9))`, obcinane do pozostałych ludzi.
  - Reszta ludzi metodą największych reszt: kwoty `q_t = max(0, human[t] − k_t)`, miejsc do obsadzenia `min(reszta ludzi, round(Σq))`, najpierw części całkowite, potem największe ułamki (remis: kolejność `STAFF_TASKS`). Kto zostanie, jest `'wolny'`.
  - Wynik w kolejności `STAFF_TASKS`, potem wolni, z `id` od 0. Dzięki temu kasa ma najniższe numery, jak w adapterze sesji „Ludzie na ekranie”.
- [ ] **Krok 4: testy ekonomii, które padają (`economy.test.ts`, `commands.test.ts`)**
  - „profil dostawa rozładowuje więcej niż kolejka”: ten sam stan z 2 paletami i kolejką; po 60 minutach suma `pallets[].total` przy `'dostawa'` jest mniejsza niż przy `'kolejka'`.
  - „taśmociąg rozładowuje nocą”: `upgrades.tasmociag = 1`, paleta na zapleczu, 2:00. Po 30 minutach towaru na palecie ubyło, a `shift.staff === 0`.
  - „zwolnienie przycina przypiętych”: staff 3, `pinStaff('kasa', 3)`, `fire`, więc `tycoon.staff.pinned.kasa === 2`.
  - `isCommand` odrzuca `pinStaff` z `count` równym `NaN`, `-1`, `1.5`, `'2'` i z `task: 'kawa'`, `setStaffProfile` z `'__proto__'`, a `setPriority` jest nieznane.
  - `sanitize.test.ts`: zapis bez `tycoon` z `priority` daje profil `klienci` → `kolejka`, `palety` → `dostawa`, `rowno` → `kolejka`.
- [ ] **Krok 5: `stepMinute`, kroki 4–8 z `INTEGRATION.md`, na razie bez śmieci i czystości (zadanie 3)**
  - Przyjścia i rezygnacje jak dziś.
  - `till = tillDemand({ queue, tills: fx.tills, tillRate: TILL_RATE * fx.tillSpeed, sco: fx.sco, scoRate: SCO_RATE * fx.scoSpeed, scoAccept: fx.scoAccept })`, przy zamkniętym sklepie z `queue: 0`.
  - `demand.kasa = till.demand`.
  - `demand.rozladunek = min(unloadDemand(palety z rate = UNLOAD_RATE*fx.unloadMult*UNLOAD_AT[loc]), room / (UNLOAD_RATE*fx.unloadMult))`, gdzie `room` = wolne miejsce na zapleczu (`backroomCap − Σbackroom`) plus wolne miejsce na półkach.
  - `demand.wykladanie = restockDemand(Σc min(shelfCap−shelf, backroom), RESTOCK_RATE)`, `demand.sprzatanie = 0`.
  - `alloc = stepStaff(pool, { staff: na zmianie, demand, robots: robotFleet(s), scoFreed: till.freed })`.
  - Obsługa: `serveTill(till, alloc.total.kasa, TILL_RATE*fx.tillSpeed)`, potem `sell(s, fx, served.total, served.sco / served.total)`.
  - Rozładunek: minuty `alloc.total.rozladunek` rozdane po paletach w kolejności `PALLET_ORDER`, potem `since`; na paletę `use = min(zostało, PEOPLE_PER_PALLET, p.total / rate)` i `unloadPallet(..., use * rate)`.
  - Wykładanie: `restock(s, info, 1, alloc.total.wykladanie * RESTOCK_RATE)`.
  - Na koniec `s.shift = { staff, human: alloc.human }`. `allocateCashiers`, `doWork`, pilne wykładanie i automatyka z `fx` znikają.
- [ ] **Krok 6:** `npx vitest run`, `npm run typecheck`, `npm run build`. Oczekiwane: PASS, łącznie z odtworzeniem w `run.test.ts`.
- [ ] **Krok 7:** commit `feat(tycoon): pula ludzi z profilami i przypięciem zamiast priorytetu, automatyka w osobominutach, staffOnShift`.

### Task 3: Śmieci, czystość sali, pogoda, niedziela i prasa do kartonów

**Pliki:** zmień `src/sim/economy/economy.ts`, `src/sim/economy/upgrades.ts`, `src/sim/economy/sanitize.ts`; testy `economy.test.ts`, `sanitize.test.ts`.

**Interfejsy:**
- Pobiera: `palletBags`, `addWaste`, `settleWaste`, `wasteSpots`, `wasteDemand`, `removeWaste`, `hallObstacle`, `wasteMinute` (`waste.ts`); `soilHall`, `cleaningDemand`, `cleanHall`, `sampleHall`, `cleanlinessEffects`, `rollWeather` (`cleanliness.ts`); `dayTrafficMult` (`sunday.ts`).
- Produkuje:
  - `Pallet.bags?: number`, liczone w `deliver` przez `palletBags(items)`.
  - `export function arrivalRate(s: EconomyState, info: StoreInfo): number`: oczekiwani klienci w tej minucie (lambda przed losowaniem), z ruchem niedzielnym i przeszkodą z worków. Potrzebna testom i kartom.
  - `UpgradeId` dostaje `'prasa'`: `group: 'warsztat'`, `names: ['Prasa do kartonów z imadła po dziadku']`, `effect: 'Worek śmieci wynosi się w 2 osobominuty zamiast 5'`, `flavor: 'Imadło wreszcie się przydało. Dziadek byłby dumny, Centrala mniej.'`, `maxLevel: 1`, `baseCost: 6000`, `costMult: 1`.
- [ ] **Krok 1: testy, które padają**
  - „rozładowana paleta zostawia worki”: paleta, której ponad 40% to napoje, daje 2 worki w `tycoon.waste.backroom`, a zwykła 1.
  - „worki zajmują miejsca palet na zapleczu”: 4 worki zmniejszają `freeSpots(s, info, 'backroom')` o 1.
  - „pełne zaplecze wyrzuca worki do sali i skraca cierpliwość”: `tycoon.waste.hall > 0` obniża efektywną cierpliwość o `hallObstacle`.
  - „sprzątanie najpierw wynosi worki”: przy profilu `'porzadek'` po 30 minutach otwarcia liczba worków spada.
  - „niedziela ma więcej klientów”: `arrivalRate` w niedzielę o 12:00 to ×1,35 soboty o 12:00 (przy tym samym stanie).
  - „pogoda losuje się o północy”: po przejściu przez 0:00 `tycoon.hall.weather === rollWeather(seedHash, day, month)`.
- [ ] **Krok 2:** uruchom testy. Oczekiwane: FAIL.
- [ ] **Krok 3: implementacja kroków 1, 3, 5, 8 i 9 z `INTEGRATION.md`**
  - Pogoda o północy.
  - `bags` w `deliver`.
  - `addWaste(waste, p.bags ?? 1, wasteRoom)`, gdy `unloadPallet` przekracza próg „paleta rozładowana”; `wasteRoom = fx.backroomSpots − palety na zapleczu`.
  - `freeSpot` i `freeSpots` dla `backroom` z limitem pomniejszonym o `wasteSpots(waste)`.
  - `settleWaste(waste, wasteRoom)` po `deliver`, `movePallet` i `relayout`.
  - Cierpliwość: `fx.patience + cleanlinessEffects(c).patience − hallObstacle(waste)`. Ruch: `Math.max(0.5, 1 − 0.08 × (paletyWSali + hallObstacle))` i `× dayTrafficMult(day)`.
  - `demand.sprzatanie = wasteDemand(waste, prasa) + cleaningDemand(hall)`; praca `cleanHall(hall, m − removeWaste(waste, m, prasa))`.
  - Co minutę `soilHall(hall, przyjścia, waste.hall)` i `wasteMinute(waste)`; gdy otwarte, `sampleHall(hall)`.
  - W `sell` reputacja `+= served × cleanlinessEffects(c).repPerCustomer`.
  - W `closeMonth` wołaj `closeWasteMonth` i `closeHallMonth`; zadanie 6 weźmie wynik do raportu.
- [ ] **Krok 4:** `npx vitest run`, `npm run typecheck`. Oczekiwane: PASS.
- [ ] **Krok 5:** commit `feat(tycoon): śmieci z palet, czystość sali, pogoda, ruch niedzielny i prasa do kartonów`.

### Task 4: Siły franczyzobiorcy przy stuknięciach; paczka od Centrali znika

**Pliki:**
- Zmień: `economy.ts`, `catalog.ts` (usuń `GIFT_*`), `progress.ts` (usuń `XP.gift`, jeśli nikt go nie używa), `commands.ts` (usuń `claimGift` i strażnika okna paczki), `sanitize.ts`, `src/game/actions.ts` (usuń `AFTER.claimGift`), `src/ui/game/overlays.tsx` (usuń `GiftDrop` i `lateGift`), `src/ui/App.tsx` (usuń montowanie `GiftDrop`)
- Testy: przepisz `src/sim/economy/tapGift.test.ts` na `src/sim/economy/taps.test.ts` (combo i siły; testy paczek znikają), a także `commands.test.ts`, `run.test.ts` (polityka bez `claimGift`), `actions.test.ts`, `overlays.test.tsx`

**Interfejsy:**
- Pobiera: `tap`, `tapItems`, `fatigueNight`, `FATIGUE` (`fatigue.ts`).
- Produkuje:
  - `tapTill(s, info, combo): CommandResult` sprawdza po kolei: sklep otwarty (zadanie 5 dopisze „i nie zamknięty kartą”) i `queue ≥ 1`. Dopiero potem `r = tap(s.tycoon.fatigue, 'kasa', combo)`. Odmowa to `{ ok: false, text: r.text }`, a obsłużonych jest `Math.min(s.queue, r.power)`.
  - `tapPallet(...)` sprawdza paletę i miejsce (`palletRoom(s, info, fx, p) > 0`, nowy helper: wolne zaplecze plus wolne półki kategorii, które są na palecie), potem `tap(..., 'paleta', combo)`. Sztuk jest `tapItems(r.power) * (1 + 0.25 * level(s, 'wozek'))`.
  - `closeDay` woła `fatigueNight(s.tycoon.fatigue)`.
  - Znikają `tapBoost`, `tapBoostUntil`, `giftSeq`, `giftAt`, `claimGift`, `scheduleGift`, `giftOpen`, `giftWindowFrom` i `GiftKind`.
- [ ] **Krok 1: testy, które padają (`taps.test.ts`)**
  - „50 stuknięć w kasę zużywa pulę, 51. to odmowa rąk”: kolejka 60, sklep otwarty, combo 1. 50 udanych, potem `{ ok: false }` z tekstem zawierającym „Ręce odmawiają”. `tycoon.fatigue.energy === 0`, a gotówka po odmowie bez zmian.
  - „odmowa nie podtrzymuje combo”: po odmowie `tapStreak` bez zmian.
  - „stuknięcie w zamknięty sklep nie zużywa sił”: o 3:00 `energy === 100`.
  - „paleta bez miejsca nie zużywa sił”: pełne zaplecze i półki, `energy === 100`.
  - „noc oddaje 70 sił”: po pustej puli i 23:00 `energy === 70`.
  - „zmęczenie przeniesione obniża moc”: następnego dnia `carried === 30`, więc stuknięcie w kasę obsługuje 0,82 klienta (`toBeCloseTo(0.82)`).
  - `sanitize.test.ts`: stary zapis z `giftAt`, `giftSeq` i `tapBoostUntil` wczytuje się bez tych pól.
- [ ] **Krok 2:** uruchom testy. Oczekiwane: FAIL.
- [ ] **Krok 3:** implementacja według interfejsów.
- [ ] **Krok 4:** `npx vitest run`, `npm run typecheck`, `npm run build`. Oczekiwane: PASS.
- [ ] **Krok 5:** commit `feat(tycoon): stuknięcia zużywają siły franczyzobiorcy, paczka od Centrali znika`.

### Task 5: Karty dnia i okólniki z pauzą i odpowiedzią domyślną

**Pliki:**
- Zmień: `economy.ts`, `commands.ts`, `src/sim/economy/clock.ts`, `src/sim/run.ts`, `src/game/actions.ts` (`AFTER.answerCard`, `skip` staje na karcie, `EVENT_SFX`: `card` → `'pop'`)
- Testy: `economy.test.ts`, `commands.test.ts`, `src/game/loop.test.ts` albo nowy `src/sim/economy/clock.test.ts`, `src/sim/run.test.ts` (polityka odpowiada na karty losowo, czasem domyślnie), `actions.test.ts`

**Interfejsy:**
- Pobiera: `drawDayCards`, `visibleCards`, `cardsBlocking`, `resolveCard`, `pruneCardMods`, `cardModifiers`, `fillText`, `CardContext` (`cards.ts`), `applyCardOutcome` (`state.ts`).
- Produkuje:
  - `export const awaitingDecision = (s: EconomyState): boolean => !s.gameOver && cardsBlocking(s.tycoon.cards, s.minute)`.
  - `export function cardContext(s: EconomyState, info: StoreInfo): CardContext` z polami jak w `INTEGRATION.md`, §5. `dailyRevenue` = `expectedDailyCustomers` × średni obrót na klienta (jak `REVENUE_PER_CUSTOMER` w `sandbox.ts`, ale z `CAT_INFO` i `HOT`).
  - `export function answerCard(s: EconomyState, seq: number, answer: number, out: EconEvent[]): CommandResult`:
    - `resolveCard`, potem `applyCardOutcome`; próg zaufania przed i po, przy zmianie zdarzenie `'trust-tier'`;
    - po stronie ekonomii: `other` ze znakiem (`income` albo `charge('other')`; w tym celu `charge` przyjmuje `'other'` jako koszt ujemny), `bonus` → `bonus()`, `fine` (ujemne) → `charge('fines', −fine)` i `fineCount++`, `logistics` (ujemne) → `charge('logistics', −x)`, reputacja z przycięciem 0–100, `ogonki`, `xp`;
    - zdarzenie `{ kind: 'card-result', text: fillText(o.text, o.params, fmt) }`.
  - Polecenie `{ type: 'answerCard'; seq: number; answer: number }`; oba pola całkowite.
  - `stepMinute`:
    - o północy, po pogodzie, `drawDayCards(cards, cardContext(s, info), seedHash)`;
    - co minutę `pruneCardMods`;
    - `mods = cardModifiers(cards, minute)`: ruch ×`mods.traffic`, marża w `sell` ×`mods.margin`, `open = isStoreOpen(s) && !mods.closed` (to samo w `tapTill`), osoby na zmianie `max(0, staff + mods.staff)`;
    - po `s.minute++`: dla każdej karty z `showAt === s.minute` zdarzenie `{ kind: 'card', text: tytuł karty }`.
  - Sam `stepMinute` **nie** sprawdza `awaitingDecision`.
  - `createEconomy` losuje karty dnia 0 (`now = OPEN_FROM`).
  - `advanceEconomy`: na początku każdego obrotu pętli `if (awaitingDecision(s)) break;`, przed zebraniem ułamka zegara. Gra stoi, a `clock.acc` się nie zmienia.
  - `replayRun`, w każdej minucie:
    1. polecenia z dziennika;
    2. `if (state.minute >= untilMinute || state.gameOver) return state`;
    3. `if (awaitingDecision(state))`: dla każdej `visibleCards` `applyCommand(state, info, { type: 'answerCard', seq, answer: defaultAnswer })`;
    4. `stepMinute`.

    Komentarz nad `replayRun` dopisuje regułę: „karta bez odpowiedzi w dzienniku dostaje odpowiedź zaznaczoną z góry”.
  - `skip` w `actions.ts` przerywa pętlę, gdy `awaitingDecision(session.econ)`.
- [ ] **Krok 1: testy, które padają**
  - „karta zatrzymuje zegar dokładnie na showAt”: `advanceEconomy` z 10 000 s przy świeżej grze kończy się na `s.minute === pierwsza karta.showAt`. Drugie wywołanie zwraca 0, a `clock.acc` się nie zmienia.
  - „odpowiedź wznawia grę”: `applyCommand(answerCard z defaultAnswer)` daje `ok`, `awaitingDecision === false`, a `advanceEconomy` znów wykonuje minuty.
  - „zła odpowiedź nie zmienia stanu”: nieznany `seq` albo `answer` poza zakresem daje `ok: false`, a `JSON.stringify(stan)` bez zmian.
  - „skutek karty trafia do liczników”: odpowiedź z `delta.fine < 0` zwiększa `month.fines` o `−fine` i `fineCount` o 1; z `delta.bonus` zwiększa `month.bonus`.
  - „XP za kartę”: odpowiedź na zdarzenie daje +10 XP, na okólnik +15.
  - `run.test.ts`: „dziennik bez odpowiedzi na kartę odtwarza się do końca”: log z samymi stuknięciami, `replayRun(run, 3 dni)` kończy się, a `state.minute === untilMinute`. Stan równa się żywej grze, w której polityka zatwierdzała odpowiedzi domyślne w minucie karty (bajt w bajt).
  - `run.test.ts`: „odtworzenie do minuty karty to stan przed odpowiedzią”: `replayRun(run, showAt)` równa się migawce żywej gry w `showAt` przed odpowiedzią.
  - Istniejące testy „12 seedów × 90 dni” przechodzą z polityką, która odpowiada na karty.
- [ ] **Krok 2:** uruchom testy. Oczekiwane: FAIL.
- [ ] **Krok 3:** implementacja według interfejsów. Polityki pętli w testach (`playLive`, `runBot`) muszą odpowiadać na karty, bo inaczej gra stoi.
- [ ] **Krok 4:** `npx vitest run`, `npm run typecheck`, `npm run build`. Oczekiwane: PASS.
- [ ] **Krok 5:** commit `feat(tycoon): karty dnia i okólniki zatrzymują grę do odpowiedzi; odtworzenie zatwierdza domyślne`.

### Task 6: WUT, KPI tygodnia zamiast zleceń, raport miesięczny

**Pliki:**
- Zmień: `economy.ts`, `commands.ts` (usuń `claimQuest`), `sanitize.ts`, `src/game/session.ts` (usuń `econForSave` z tytułami zleceń i `fillQuests`), `src/game/actions.ts` (usuń `AFTER.claimQuest`), `src/ui/game/panels.tsx` (`GoalsPanel` pokazuje na razie tytuł KPI tygodnia i postęp; pełny panel to zadanie 11), `src/ui/game/overlays.tsx` (`ReportModal` czyta dalej `MonthReport` i się kompiluje)
- Usuń: `src/sim/economy/quests.ts`, `src/sim/economy/quests.test.ts`
- Testy: `economy.test.ts`, `sanitize.test.ts`, `session.test.ts`, `actions.test.ts`, `panels.test.tsx`

**Interfejsy:**
- Pobiera: `wutFromSales`, `wutFromSco`, `closeWutMonth` (`wut.ts`); `closeKpiWeek`, `closeKpiMonth`, `kpiTitle` (`kpi.ts`); `buildMonthReport`, `reportCommentText` (`report.ts`); `closeStaffDay`, `closeStaffMonth`, `closeFatigueMonth`, `closeCardsMonth`, `closeHallMonth`, `closeTrustMonth`.
- Produkuje:
  - `MonthReport.detail: TycoonMonthReport | null` (null w raportach ze starych zapisów; `sanitize` przez `sanitizeReport`). `MonthReport.comment = reportCommentText(detail.commentId)`.
  - `sell`: `wutFromSales(wut, revenue)` i `wutFromSco(wut, revenue * scoShare, 1 − 0.4 * level(s, 'kamery'))`; `fx.shrink` znika.
  - `closeDay`: `closeStaffDay`. Gdy `day === kpi.toDay`: `r = closeKpiWeek(kpi, kpiMetricsOf(s), seedHash, day + 1, kpiScaleOf(s, info))`, potem `changeTrust('kpi', r.trust)`, `bonus(r.bonus)`, `xp += r.xp` i zdarzenie `'kpi-week'` z tekstem z `kpiTitle(kind, target, fmt)`, wynikiem i premią.
  - `closeMonth`, w tej kolejności:
    1. opłata;
    2. premia od obrotu;
    3. `w = closeWutMonth(wut, m.revenue)` i `charge('wut', w.charge)`;
    4. wynik;
    5. `changeTrust('wynik')`;
    6. `buildMonthReport({ monthIndex: monthIndexOf(day), figures, trust: closeTrustMonth(...), cleanlinessAvg: closeHallMonth(...), staff: closeStaffMonth(...), days, staffCount: s.staff, exhaustedDays: closeFatigueMonth(...).exhaustedDays, kpi: closeKpiMonth(...), cards: closeCardsMonth(...), marginPerCustomer }, seedHash)`.

    `figures` mapuje `Counters` na `MonthFigures` (`bonuses` ← `bonus`). Wynik raportu równa się `profit` w `history`.
  - Złota paleta: premia idzie do `bonus()`, nie do `income()`.
  - Znikają `quests`, `questSeq`, `cleanDays`, `fillQuests`, `claimQuest`, `questScale`, `centralaComment` i `newQuest`.
- [ ] **Krok 1: testy, które padają**
  - „SCO dopisuje kradzieże do WUT, kamery mniej”: 1000 zł obrotu przez SCO daje w `wut.month.kradziez` różnicę 40 zł z kamerami poziomu 0 i 24 zł z poziomem 1 (licz różnicę przed i po).
  - „WUT ponad próg to pozycja raportu”: ręcznie dopisany WUT 5% obrotu daje przy zamknięciu miesiąca `month.wut > 0` przed wyzerowaniem i pozycję `'wut'` w `lastReport.detail.lines`.
  - „wynik raportu = suma pozycji = history.profit”: po 30 dniach biernej gry `detail.result === history[0].profit` (`toBeCloseTo`).
  - „KPI tygodnia zamyka się w niedzielę o 23:00”: pierwsza niedziela daje zdarzenie `'kpi-week'`, zaufanie z przyczyną `kpi` ±, a przy trafieniu `month.bonus > 0` i XP.
  - `sanitize.test.ts`: zapis z `quests` i `questSeq` wczytuje się bez nich; `lastReport` bez `detail` daje `detail: null`.
- [ ] **Krok 2:** uruchom testy. Oczekiwane: FAIL.
- [ ] **Krok 3:** implementacja według interfejsów.
- [ ] **Krok 4:** `npx vitest run`, `npm run typecheck`, `npm run build`. Oczekiwane: PASS.
- [ ] **Krok 5:** commit `feat(tycoon): WUT, KPI tygodnia zamiast zleceń i raport miesięczny z zaufaniem, komentarzem i wskazówką`.

### Task 7: Boty na prawdziwej ekonomii (pomiar przed wyważeniem)

**Pliki:** utwórz `src/sim/economy/tycoon/economyEnv.ts` i `src/sim/economy/tycoon/economyEnv.test.ts`.

**Interfejsy:**
- Pobiera: `BotEnv`, `BotView`, `BotCommand`, `BOTS`, `runBot` (`bots.ts`), `awaitingDecision`, `stepMinute` i `applyCommand`.
- Produkuje:
  - `export function economyEnv(run: { state: EconomyState; info: StoreInfo }): BotEnv`. Mapowanie poleceń: `'card.answer'` → `answerCard`, `'staff.profile'` → `setStaffProfile`, `'tap.till'` → `tapTill`, `'tap.pallet'` → `tapPallet`, wszystkie przez `applyCommand`. `step()` zwraca `false` przy `awaitingDecision`, a w przeciwnym razie wykonuje `stepMinute`. `view()` buduje `BotView` jak `sandboxView`.
  - `export function measureBots(seeds: readonly string[], minutes: number): Record<BotName, number[]>`: suma `history[].profit` każdego bota na każdym seedzie, start z `freshRun(seed)`.
- [ ] **Krok 1:** test „boty przechodzą dwa miesiące prawdziwej gry bez NaN i bez zawieszenia”: 4 boty × seed `'traszka-1'`, `TWO_MONTHS`, dwa raporty w `history`, wszystkie liczby stanu skończone.
- [ ] **Krok 2:** implementacja, potem PASS.
- [ ] **Krok 3:** zapisz tabelę `measureBots(['makieta', 'kielbasa-42', 'traszka-1'], TWO_MONTHS)` w `/Users/mpawelczuk/ZabkaTycone/.superpowers/sdd/etap-2c2/raport.md` (sekcja „Balans przed strojeniem”).
- [ ] **Krok 4:** commit `test(tycoon): boty na prawdziwej ekonomii, pomiar przed wyważeniem`.

---

## Kamień 2: interfejs

Zasada dla wszystkich zadań: komponenty dostają stan z `ui.econ` i wysyłają polecenia przez `game.dispatch`. Testy idą w stylu `panels.test.tsx` i `overlays.test.tsx` (`vnodeTree`). Kontroler po kamieniu sprawdza całość w przeglądarce przy szerokości 390 px.

### Task 8: Panel „Ludzie”: profile, przypięcia, kto co robi

**Pliki:** zmień `src/ui/game/panels.tsx` (`PeoplePanel`) i `src/ui/ui.css`; test w `panels.test.tsx`.
- Sekcje panelu:
  - **„Zmiana”:** liczba osób, przyciski zatrudnij i zwolnij jak dziś, płaca dzienna.
  - **„Profil pracy”:** trzy przyciski `STAFF_PROFILES` z `PROFILE_LABEL`, aktywny ma klasę `on`, pod spodem `PROFILE_HINT`.
  - **„Kto co robi teraz”:** wiersz na każde zadanie z `STAFF_TASKS` (`TASK_LABEL`) z liczbą osób z `staffOnShift(s)` dla tego zadania i liczbą przypiętych z przyciskami − i + (`pinStaff`; − nieaktywne przy 0, + nieaktywne, gdy suma przypiętych równa się `s.staff`). Wolni w osobnym wierszu.
  - **„Dziś”:** osobominuty `tycoon.staff.day.worked` wg zadania. Ostrzeżenie „czekało N min”, gdy `starved[t] > 30`.
- Testy:
  - klik w profil wysyła `{ type: 'setStaffProfile', profile }`;
  - + przy kasie wysyła `{ type: 'pinStaff', task: 'kasa', count: pinned + 1 }`;
  - − przy 0 jest `disabled`;
  - liczby osób zgadzają się ze `staffOnShift`.
- Commit `feat(ui): panel Ludzie z profilami pracy, przypięciem i podglądem zadań`.

### Task 9: Pasek sił, zaufanie w HUD, sklep (WUT, czystość), toasty bez migania

**Pliki:** `src/ui/game/Hud.tsx`, `src/ui/game/overlays.tsx` (`ClickerBar`), `src/ui/game/panels.tsx` (`StorePanel`), `src/ui/state.ts` (`pushToast`), `src/ui/ui.css`; testy w `overlays.test.tsx`, `panels.test.tsx` i `src/ui/state.test.ts`.
- `ClickerBar`:
  - nad przyciskami pasek sił: `Siły {energy}/100` z `Bar` i ostrzeżeniem poniżej 20;
  - przycisk nieaktywny, gdy `energy < tapCost(kind)`, z `title` „Ręce odmawiają, odpocznij do jutra”;
  - po udanym stuknięciu dymek jak dziś.
- HUD: znaczek zaufania `Zaufanie {value}` z `trustTier(value).label`, klasa ostrzeżenia poniżej 30.
- `StorePanel`:
  - zaufanie z `flavor` progu;
  - „WUT w tym miesiącu”: `wutTotal` wobec progu `WUT.threshold × month.revenue` (`Bar`);
  - „Czystość sali”: `Math.round(hall.cleanliness)`% i `WEATHER_LABEL[hall.weather]`.
- `pushToast`: toast trwa `readMs(text)` ms (`notices.ts`), błąd jak dziś 2200 ms.
- Testy:
  - pasek sił pokazuje `energy` ze stanu;
  - przycisk kasy `disabled` przy `energy` 1;
  - toast o tekście 300 znaków znika po 12 000 ms, nie po 4000 (`vi.useFakeTimers`);
  - wiersz WUT pokazuje próg.
- Commit `feat(ui): pasek sił, zaufanie Centrali w HUD, WUT i czystość w panelu sklepu, toasty bez migania`.

### Task 10: Karta dnia: okno decyzji

**Pliki:**
- Utwórz: `src/ui/game/cards.tsx` (`CardDesk`), `src/ui/game/cardText.ts` (`deltaLines`), `src/ui/game/cards.test.tsx`, `src/ui/game/cardText.test.ts`
- Zmień: `src/ui/App.tsx` (montowanie `CardDesk`), `src/ui/ui.css`

**Interfejsy:**
- `export function deltaLines(a: AnswerInstance, fmt: (n: number) => string): string[]`: krótkie skutki do pokazania, czyli zł (cash, bonus, fine, logistics, ze znakiem), „zaufanie ±n”, „WUT +n zł”, „czas ludzi n min”, „siły −n”, „reputacja ±n”, „Ogonki +n”, „ryzyko n%: …” i szacunek efektów na czas (`mods[].estimate`, „ok. ±n zł”).
- `CardDesk` pokazuje się, gdy `visibleCards(s.tycoon.cards, s.minute).length > 0`:
  - nagłówek „Karta 1 z N”, `title` i `fillText(text, params, fmtPl)` z `cardDef(id)`;
  - odpowiedzi jako przyciski wyboru z `label` i `deltaLines`, odpowiedź domyślna zaznaczona z góry (stan lokalny po `seq`);
  - przycisk „Zatwierdź” wysyła `{ type: 'answerCard', seq, answer }`.

  Bez zamykania krzyżykiem: gra stoi, aż gracz wybierze.
- `EVENT_SFX` w `actions.ts`: `'card-result'` → `'coins'`, gdy w tekście jest premia; inaczej bez dźwięku.
- Testy:
  - domyślna zaznaczona;
  - klik w inną i „Zatwierdź” wysyła tę inną;
  - samo „Zatwierdź” wysyła `defaultAnswer`;
  - `deltaLines` dla `{ fine: -300 }` zawiera „−300 zł”, a dla ryzyka `chance 0.3` zawiera „30%”.
- Commit `feat(ui): karta dnia z odpowiedziami, skutkami i odpowiedzią zaznaczoną z góry`.

### Task 11: Raport miesięczny i KPI tygodnia w zakładce „Cele”

**Pliki:** `src/ui/game/overlays.tsx` (`ReportBody`, `ReportModal`), `src/ui/game/panels.tsx` (`GoalsPanel`); testy w `overlays.test.tsx` i `panels.test.tsx`.
- `ReportBody` dla `detail !== null`:
  - pozycje `detail.lines` z `REPORT_LINE_LABEL` (koszty ze znakiem minus) i wynik;
  - zaufanie `start → end` z `trust.reasons` (`TRUST_REASON_LABEL`);
  - komentarz Centrali;
  - wskazówka `hintText(hint, fmtPl)`;
  - KPI w miesiącu `hit/miss`.

  Dla `detail === null` zostaje dzisiejszy widok.
- `GoalsPanel`:
  - KPI tygodnia: `kpiTitle(kind, target, fmtPl)`, `KPI_FLAVOR[kind]`, `Bar` z `kpiProgress`, „do niedzieli: N dni”, nagroda („zaufanie +3, premia ok. X zł, +XP”);
  - pod spodem kamienie milowe, jeśli panel je dziś pokazuje.
- Testy:
  - raport z `detail` pokazuje linię „WUT ponad próg” i tekst wskazówki;
  - `GoalsPanel` pokazuje tytuł KPI.
- Commit `feat(ui): raport miesięczny z pozycjami, zaufaniem i wskazówką; KPI tygodnia w Celach`.

### Task 12: Pauza fabularna: zdarzenia, które czekają na „OK”

**Pliki:** `src/ui/state.ts` (`story`), `src/game/actions.ts` (`handleEvents`), `src/game/frame.ts` (`isModalOpen`), `src/ui/game/overlays.tsx` (`StoryModal`), `src/ui/App.tsx`; testy w `actions.test.ts`, `frame.test.ts` i `overlays.test.tsx`.
- `export const story: Signal<{ id: number; title: string; text: string }[]>` w `state.ts`, plus `pushStory(title, text)` i `dismissStory()`.
- `handleEvents` kieruje do `pushStory` zamiast toastu:
  - `'trust-tier'` z tytułem „Zaufanie Centrali”;
  - `'remont'` (koniec remontu) z tytułem „Remont zakończony”;
  - `'gameover'`;
  - `'levelup'` z niepustym `unlocks`. Baner `celebration` zostaje, a okno ma tytuł „Poziom N” i listę odblokowań.

  Reszta idzie do toastów jak dziś.
- `isModalOpen` zwraca prawdę także przy `ui.story.value.length > 0`.
- `StoryModal`: pierwszy wpis, przycisk „OK” woła `dismissStory`.
- Testy:
  - zdarzenie `'trust-tier'` trafia do `story`, a nie do toastów;
  - `isModalOpen()` przy niepustym `story` daje `true`;
  - „OK” zdejmuje wpis.
- Commit `feat(ui): ważne zdarzenia zatrzymują grę do OK (zaufanie, remont, odblokowania)`.

### Task 13 (kontroler): sprawdzenie w przeglądarce i raport kamienia 2

- Podgląd na porcie 5194 (konfiguracja w `.claude/launch.json`). Sprawdź:
  - nowa gra: karta dnia o swojej godzinie zatrzymuje grę;
  - odpowiedź wznawia grę;
  - stukanie aż do odmowy rąk;
  - profil „Dostawa” i przypięcie osoby;
  - raport miesięczny po `skip`;
  - stary zapis (fixture v2 wstrzyknięty do `localStorage`) wczytuje się z zaufaniem.
- Zrzuty ekranu przy szerokości 390 px i na desktopie. Konsola bez błędów.
- Raport w `/Users/mpawelczuk/ZabkaTycone/.superpowers/sdd/etap-2c2/raport.md`. Koniec tury z notką „Kamień 2 gotowy (commit …)”.

---

## Kamień 3: balans i instrukcja

### Task 14: Wyważenie na prawdziwej ekonomii i test balansu

**Pliki:** liczby w `catalog.ts`, `tycoon/*.ts` (stałe `FATIGUE`, `TRUST`, `WUT`, `KPI`, `CARDS`, skale talii), test `src/sim/economy/tycoon/balance.test.ts` na `measureBots`.

**Cele z §7.5:**
- bierny ≈ 0 po dwóch miesiącach;
- stukanie dokłada najwyżej 15–20%;
- dobre decyzje dają 2–4× wynik biernego;
- „decyzje bez stukania” wygrywa ze „stukaniem bez decyzji”.

Przed strojeniem kontroler zapisuje w rejestrze, jak mierzy „2–4×”, gdy bierny ≈ 0 (np. wobec typowej marży miesiąca). Jeśli kryterium zmienia grę, pyta właściciela.
- Commit `balance(tycoon): ...` z tabelą przed i po w raporcie.

### Task 15: Okno „Jak grać”

**Pliki:**
- Utwórz: `src/ui/howto/howto.ts` (treść jako dane: sekcje z tekstem, liczby wstawiane ze stałych: `FATIGUE.pool`, `FATIGUE.tapCost`, `FATIGUE.nightRecovery`, `TRUST.start`, `WUT.threshold`, `SUNDAY_TRAFFIC`, `OPEN_FROM/OPEN_TO`, `KPI.trustHit`…), `src/ui/howto/HowTo.tsx`, testy
- Zmień: `src/ui/state.ts` (`howTo: Signal<boolean>`), `src/game/frame.ts` (`isModalOpen`), `src/game/actions.ts` (okno otwiera się po zamknięciu ekranu startowego w `openChosenStore`), `src/ui/game/overlays.tsx` (`Settings`: przycisk „Jak grać”), `src/ui/App.tsx`
- Treść ze szkicu `/Users/mpawelczuk/ZabkaTycone/.superpowers/sdd/instrukcja/szkic.md` (jeśli już jest) dopasowana do ekonomii po C2. Przycisk „Zaczynamy” zamyka okno; do tego czasu czas gry stoi.
- Testy:
  - liczby w treści równają się stałym (zmiana stałej zmienia tekst);
  - okno otwarte daje `isModalOpen() === true`;
  - przycisk w ⚙ ustawia `howTo` na `true`.
- Commit `feat(ui): okno Jak grać po ekranie startowym i w ustawieniach, liczby ze stałych gry`.

### Task 16 (kontroler): spec i raport kamienia 3

- Dopisz do §6.5, §7.1a i §7.5 decyzje właściciela z `INTEGRATION.md`:
  - niedziela bez placówki pocztowej (ruch ×1,35);
  - pauza na kartach z odpowiedzią zaznaczoną z góry;
  - ubytek SCO w WUT;
  - XP za karty i KPI;
  - przypięci wracają do puli;
  - wypowiedzenie na koniec miesiąca;
  - wiek na SCO wymaga człowieka.

  Zaktualizuj też §10 (niedziele niehandlowe).
- Raport, commit `docs(spec): ...`, notka „Kamień 3 gotowy (commit …)”.

## Przeniesione albo pominięte (rejestr)

- Własna kolejność zadań (`setStaffOrder`, permutacja) to kamień 3, o ile starczy czasu: profile i przypięcia pokrywają rdzeń §6.5. `setStaffOrder` z C1 zostaje nieużywane.
- Mapowanie starych poleceń w dziennikach (`claimGift`, `claimQuest`, `setPriority`): odpadają przez `isCommand` jako nieznane. Dzienniki trybu zwykłego nie wychodzą poza przeglądarkę, a ranking jeszcze nie działa.

# Etap 2A: Fundament (polecenia, dziennik, odtwarzanie, rozbicie main.ts) — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** każda akcja gracza to serializowalne `Command` stosowane przez jedno czyste `applyCommand` w `src/sim`; bieg da się zapisać jako (seed, dziennik poleceń) i odtworzyć co do bajtu; `src/main.ts` przestaje być nietestowalnym dyspozytorem.

**Architektura:** kamień 1 dokłada do symulacji warstwę poleceń (`src/sim/economy/commands.ts`) i odtwarzanie (`src/sim/run.ts`), usuwa z niej rzeczy zależne od silnika JS i zegara, a stan gry (combo, okna paczek) przejmuje to, co dziś liczy interfejs. `main.ts` w kamieniu 1 się nie zmienia i działa po staremu (stare funkcje symulacji zostają z tymi samymi sygnaturami). Kamień 2 przepina interfejs na polecenia i rozbija `main.ts` na `src/game/{controls,scene,actions,frame}.ts`.

**Stos:** TypeScript 7, Vite 8, Vitest 5 (środowisko node), Preact + @preact/signals, three 0.186.

**Spec:** `docs/superpowers/specs/2026-10-28-etap-2-podzial-i-kontrakty.md` (kontrakty §2, zasady §3), `docs/superpowers/specs/2026-10-27-traszka-tycoon-design.md` §14.1 i §14.7. Źródła: `/Users/mpawelczuk/ZabkaTycone/.superpowers/sdd/etap-2/inwentarz-polecen.md` (C1–C18, H1–H4), `/Users/mpawelczuk/ZabkaTycone/.superpowers/sdd/2026-10-27-etap-1-wycinek-wygladu/final-review-report.md` (I5, L1–L14).

## Global Constraints

- Pliki wolno zmieniać tylko te z §1 kontraktów dla strumienia A: `src/main.ts`, nowe `src/game/{controls,scene,actions,frame}.ts`, `src/sim/economy/commands.ts`, `src/sim/run.ts`, `src/sim/store/layoutFor.ts`, `src/game/session.ts`, `src/sim/economy/*` (tylko pod polecenia i zakazy z §3), `src/ui/state.ts`, `tests/architecture.test.ts`, `vite.config.ts`, oraz testy i fixtures. Wyjątki konieczne i jednolinijkowe: `src/ui/game/panels.tsx` (tytuł zlecenia, K2: wywołania poleceń), `src/ui/game/overlays.tsx` (K2), `src/vite-env.d.ts` (deklaracja stałej wersji). Nigdy: `api/**`, `src/server/**`, `src/sim/ranked.ts`, `src/ui/ranking/**`, `src/game/playerKey.ts`, `src/sim/economy/tycoon/**`.
- Nazwy i sygnatury z §2 kontraktów dokładnie: `Command`, `CommandOutcome { result; events; layoutChanged }`, `applyCommand(state, info, cmd)`, `LogEntry { minute; seq; cmd }`, `RunRecord { seed; gameVersion; generatorVersion; mode; log }`, `replayRun(run, untilMinute)`. Wolno dopisać pola opcjonalne (nie psują kodu B i C).
- `src/sim` bez `three` (także `import('three')`), `Math.random`, `Date`, `performance`, `localStorage`, `window`, importów z `render`/`ui`/`game`, plików `.tsx`; w `src/sim` poza `crowd/` i `nav/` bez `Math.hypot`, `Math.log*`, `Math.pow`, `**`, `Math.exp*`, `Math.cbrt` i trygonometrii.
- Losowość tylko `rand01(seedHash, a, b)`. Kanały w użyciu: 1, 3, 7, 11, 12, 13, 21, 22. Ten plan bierze **30** (okna paczek). 100–199 należą do C.
- Teksty z `toLocaleString` nie trafiają do stanu (zdarzenia i wyniki poleceń mogą je mieć: to wyświetlanie).
- Zapisy z produkcji (v1: sam `EconomyState`; v2: koperta `{schema: 2, …}`) wczytują się dalej. `SAVE_SCHEMA` zostaje 2, `EconomyState.version` zostaje 1: zmiany stanu są addytywne albo obsłużone w `sanitizeEconomy`.
- Komentarze i komunikaty po polsku, identyfikatory po angielsku, styl jak w otaczającym kodzie (gęste komentarze „dlaczego”, bez zbędnych).
- Każdy commit: `npm test`, `npm run typecheck`, `npm run build` zielone. Commity po polsku, ze stopką `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Tylko własna gałąź, bez push.
- Kamień 1 nie dotyka `src/main.ts`.

## Review Focus

1. **Stary zapis z produkcji** (v1 bez koperty, v2 z tytułami zleceń, bez pól combo i paczki) musi się wczytać, zachować postęp i grać dalej. Testy: Task 1 (przypięcie), Task 5 i Task 7 (migracje w oczekiwanej wartości).
2. **Wrogi albo zepsuty dziennik** (nieznany typ, `id` ulepszenia spoza katalogu, `NaN`, tekst zamiast liczby, wpisy nieposortowane, minuta sprzed startu lub po końcu) nie może rzucić ani zepsuć stanu. Testy: Task 8 (`isCommand`, odrzucenie bez zmian stanu), Task 9 (dziennik ze śmieciami).
3. **Remont w środku biegu**: nowy układ z `layoutFor(seed, poziom)` w `applyCommand` i w odtworzeniu musi być ten sam co dziś w `syncLayout`; odtworzenie musi dalej liczyć na nowym `StoreInfo`. Testy: Task 8, Task 9 (boty z remontami).
4. **Koniec gry (bankructwo) w środku biegu**: odtwarzanie kończy się (bez pętli bez końca), polecenia po końcu są odrzucane. Test: Task 9.
5. **Okno paczki przez noc, remont i zapis/wczytanie w trakcie okna**: jeden odbiór na okno, po wygaśnięciu kolejne okno, stary zapis dostaje okno. Testy: Task 7.

---

# Kamień milowy 1 (symulacja, sesja, testy; bez `src/main.ts`)

### Task 1: Fixtures v2 z kodu produkcyjnego i przypięcie wczytywania

Kod `src/sim` i `src/game/session.ts` jest dziś identyczny z produkcją (`git diff a700259 HEAD -- src/sim src/game/session.ts` pusty), więc zapis wygenerowany teraz to dokładnie format produkcji. Robimy go **przed** jakąkolwiek zmianą.

**Files:**
- Create: `src/game/fixtures/save-v2-dzien30.json`, `src/game/fixtures/save-v2-remont2.json`
- Modify: `src/game/session.test.ts` (nowy `describe('zapisy v2 z produkcji')`)

**Interfaces:**
- Produces: dwa pliki koperty v2 (`SaveEnvelope`) i test, który kolejne zadania aktualizują o jawnie opisane migracje.

- [ ] **Step 1: Wygeneruj fixtures jednorazowym testem (pliku testu nie commitujemy)**
  Tymczasowy `src/game/makeFixtures.tmp.test.ts`: `createSession` z seedem `'traszka-v2-a'` (sklep z tym seedem, `partner` = `{points: 0, networkIncome: 0, stores: 0}`) i `'traszka-v2-b'` (`partner` = `{points: 120, networkIncome: 350, stores: 2}`), gra przez `stepMinute` z prostym botem (stuknięcia `tapPallet`/`tapTill` z `combo` 1, `claimQuest` gotowych zleceń, `claimGift` co ~1500 minut, `buyUpgrade` i `buyEquipment` gdy stać, `startRemont` + `syncLayout(session)` gdy się da). Plik A: koniec po 30 dniach (raport miesięczny w `lastReport`, palety, dostawy, 3 zlecenia z tytułami). Plik B: gra aż `remontLevel === 2` i jeszcze 3 dni (sprzęt w slotach, `partner`). Zapis: `saveSession` na `memoryStorage` i odczyt surowego JSON spod `traszka:save:<seed>`. Jeżeli bot nie dobije do remontu 2 w 400 dniach, zmień seed, nie logikę. Zapisz pliki sformatowane `JSON.stringify(x)` (jedna linia, jak fixtures v1).
- [ ] **Step 2: Test przypinający** w `src/game/session.test.ts`, dla obu plików: `storage.setItem(key(seed), text(file))`; `createSession(seed, false, partner)` daje `fromSave === true`, `loadNotice === null`, `s.layout` równe `fixture.layout`, `s.econ` równe `fixture.econ` (`toEqual`), a po 10 dniach `stepMinute` wszystkie liczby w `JSON.stringify(s.econ)` skończone i `s.econ.minute` większe o 14 400. Zwykła gra też: `saveSession(s)` po wczytaniu daje kopertę z tym samym `layout` i `econ`.
- [ ] **Step 3: Uruchom** `npx vitest run src/game/session.test.ts` → PASS. Usuń plik tymczasowy.
- [ ] **Step 4: Commit** `test(zapis): fixtures koperty v2 z kodu produkcji i przypięcie ich wczytywania`

### Task 2: Kolejność miejsc na palety bez `Math.hypot`

**Files:**
- Modify: `src/sim/economy/storeInfo.ts:144-146` (`floorSpots`)
- Create: `src/sim/economy/storeInfo.test.ts`

**Interfaces:**
- Produces: `computeStoreInfo` z tą samą kolejnością `info.spots.floor` co dziś.

- [ ] **Step 1: Test dowodowy** w `storeInfo.test.ts`: kopia dzisiejszej funkcji `floorSpots` wklejona do testu jako `legacyFloorSpots(layout)` (z `Math.hypot`; w testach wolno). Test `'kolejność miejsc w sali jak przy Math.hypot: 1000 seedów × 4 poziomy remontu'`: dla `seed = \`spot-${i}\``, `i < Number(process.env.SPOT_SEEDS ?? 1000)`, `level` 0..3: `computeStoreInfo(layoutFor(seed, level)).spots.floor` równe `legacyFloorSpots(layout)` (`toEqual`, kolejność się liczy). `layoutFor` importuj z `@/game/session` (Task 6 przeniesie import).
- [ ] **Step 2: Zmiana**: komparator na kwadrat odległości w liczbach całkowitych: `dx = 2 * a.x - width`, `dy = 2 * a.y - (FRONT_WALL_Y + layout.midWallY)` (środek ma połówki, podwojenie daje liczby całkowite i dokładne kwadraty), remis rozstrzyga jawnie indeks kandydata w tablicy (dziś robi to stabilność sortowania). Komentarz: dlaczego bez `Math.hypot` (L8: funkcja nie musi być poprawnie zaokrąglona, a kolejność decyduje o liczbie miejsc i o `Pallet.spot` w zapisie).
- [ ] **Step 3: Uruchom** `npx vitest run src/sim/economy/storeInfo.test.ts` → PASS; jednorazowo `SPOT_SEEDS=5000 npx vitest run src/sim/economy/storeInfo.test.ts` → PASS (wynik i czas do raportu zadania). Test w zestawie ma trwać < 10 s; jeśli dłużej, zmniejsz domyślną liczbę seedów do 600, nie mniej.
- [ ] **Step 4: Commit** `fix(sim): kolejność miejsc na palety z całkowitego kwadratu odległości zamiast Math.hypot (L8)`

### Task 3: Matematyka niezależna od silnika i kalendarz bez `Date`

**Files:**
- Modify: `src/sim/economy/progress.ts` (`xpToNext`), `src/sim/economy/upgrades.ts` (`upgradeCost`, `equipmentCost`), `src/sim/economy/economy.ts:610` (`checkFine`), `src/sim/economy/quests.ts` (`niceRound`), `src/sim/economy/sanitize.ts:57`, `src/sim/economy/calendar.ts`
- Create: `src/sim/economy/exactMath.ts`, `src/sim/economy/exactMath.test.ts`, `src/sim/economy/calendar.test.ts`

**Interfaces:**
- Produces (`exactMath.ts`): `powInt(base: number, n: number): number` (n całkowite ≥ 0, pętla mnożeń); `FINE_PALLET_POW: readonly number[]` (n ** 1.4 dla n = 0..40 jako literały); `pow10Floor(n: number): number` (największa potęga 10 ≤ n, pętla); `xpCurve(level: number): number` = `Math.round(120 * level ** 1.55)` liczone dokładnie.
- Produces (`calendar.ts`): te same eksporty co dziś (`dateOfDay`, `isLastDayOfMonth`, `dayOf`, `minuteOfDay`, `isOpenAt`, `formatDate`, `formatClock`, `formatMonth`, `WEEKDAY_SHORT`, `MONTH_NAME`, `GameDate`), bez `Date`.

- [ ] **Step 1: Testy równoważności (piszemy przed zmianą, porównują z dzisiejszymi wzorami w V8)** w `exactMath.test.ts`:
  - `'powInt w cenach: każde ulepszenie i sprzęt, poziomy 0..maxLevel (sprzęt 0..50), ta sama cena co z **'`: dla każdej definicji z `UPGRADES` i `EQUIPMENT` `Math.round((baseCost * powInt(costMult, n)) / 50) * 50 === Math.round((baseCost * costMult ** n) / 50) * 50`.
  - `'FINE_PALLET_POW to n ** 1.4 co do bitu'`: `FINE_PALLET_POW[n] === n ** 1.4` dla n = 0..40, i `FINE_PALLET_POW.length === 41`.
  - `'pow10Floor jak 10 ** floor(log10 n)'`: dla wszystkich całkowitych 11..200 000, każdej potęgi 10 od 1e1 do 1e15 oraz sąsiadów (`p * (1 - 2 ** -52)`, `p * (1 + 2 ** -52)`; w teście `**` wolno) i 10 000 liczb `11 + rand01(1, i) * 1e9`.
  - `'xpCurve jak Math.round(120 * level ** 1.55) dla poziomów 1..10 000'`.
- [ ] **Step 2: Uruchom** → FAIL (brak modułu).
- [ ] **Step 3: Implementacja `exactMath.ts`.** `FINE_PALLET_POW`: wartości wypisane z `Array.from({ length: 41 }, (_, n) => n ** 1.4)` jako literały (najkrótszy zapis JS odtwarza tę samą liczbę w każdym silniku). `xpCurve`: wykładnik 1,55 = 31/20, więc szukamy `r = round(120 · L^(31/20))` w BigInt: `N = 120n ** 20n * BigInt(L) ** 31n`, `r` = największe całkowite z `r ** 20n <= N` (wyszukiwanie binarne albo Newton), zaokrąglenie w górę gdy `(2r+1) ** 20n <= N * 2n ** 20n`; wynik w tablicy‑pamięci modułu (`processLevels` woła to co minutę). Uwaga: `**` na BigInt też zakaże test architektury — użyj pomocniczej `bigPow(b: bigint, n: number): bigint` (pętla mnożeń). Jeżeli test ze Step 1 znajdzie poziom, na którym wynik dokładny różni się od V8, zatrzymaj się i zgłoś (nie dopasowuj na siłę).
- [ ] **Step 4: Podmiany**: `xpToNext(level) = xpCurve(level)`; `upgradeCost`/`equipmentCost` przez `powInt`; `checkFine`: `FINE_PALLET_POW[Math.min(outside.length, FINE_PALLET_POW.length - 1)]` (więcej niż 40 palet na chodniku nie występuje: Task 2 widział najwyżej 17 miejsc przy szerokości 40; test w Step 6 tego pilnuje); `niceRound`: `const p = pow10Floor(n)`; `sanitize.ts`: `id: 1_073_741_824` z komentarzem `2^30`.
- [ ] **Step 5: Kalendarz.** Test w `calendar.test.ts` (w teście `Date` wolno): `'dateOfDay jak Date.UTC dla dni −1000..80 000'` porównuje z kopią starej implementacji (`new Date(Date.UTC(2026, 8, 1) + day * 86_400_000)` i `getUTC*`), plus `isLastDayOfMonth` i `formatMonth` dla tych samych dni. Implementacja: dzień 0 gry to dzień 20 697 od 1970‑01‑01; data z liczby dni algorytmem „civil from days” (H. Hinnant) w samych dzieleniach całkowitych (`Math.floor`), dzień tygodnia `(dni + 4) mod 7` (1970‑01‑01 to czwartek), z poprawką na ujemne reszty. Komentarz w pliku z uzasadnieniem: `Date.UTC` ze stałymi to co prawda zachowanie określone w ECMAScript, ale wyjątek od prostej reguły „w `src/sim` nie ma `Date`” osłabiłby ją dla B i C, a serwer odtwarzający bieg nie powinien zależeć od żadnego API daty; arytmetyka całkowita jest dokładna w każdym silniku.
- [ ] **Step 6: Test zasięgu tablicy mandatu** w `storeInfo.test.ts` (próbka z Task 2): największa liczba miejsc na chodniku < `FINE_PALLET_POW.length`.
- [ ] **Step 7: Uruchom** `npm test` (cały zestaw: liczby gry, testy ekonomii, zapisów i benchmarku muszą wyjść identyczne) → PASS; `npm run typecheck` → PASS.
- [ ] **Step 8: Commit** `fix(sim): potęgi, logarytm i kalendarz bez funkcji zależnych od silnika JS (L8), z dowodem tych samych wartości`

### Task 4: Mocniejszy test architektury

**Files:**
- Modify: `tests/architecture.test.ts`

**Interfaces:**
- Produces: `simViolations(path: string, source: string): string[]` (lokalnie w teście) — lista złamanych reguł dla pliku; reguły z Global Constraints.

- [ ] **Step 1: Testy reguł na próbkach (żeby wyrażenia nie były puste)**: `it.each` z parami (kod, oczekiwana reguła): `import * as T from 'three'`, `await import('three')`, `Math.random()`, `new Date()`, `Date.now()`, `performance.now()`, `localStorage.getItem('x')`, `window.foo`, `import { x } from '@/render/y'`, `import { x } from '../../ui/state'`, `import { x } from '@/game/session'`, `Math.hypot(1, 2)`, `Math.log10(5)`, `Math.log(5)`, `Math.pow(2, 3)`, `2 ** 3`, `Math.atan2(1, 2)`, `Math.sin(1)`, `Math.exp(1)` → każda zgłoszona; oraz próbki, które przejść muszą: `/** komentarz z Date i ** */ const x = 1;`, `// Math.random w komentarzu`, `const update = 1;` (nie `Date`), `Math.sqrt(4)`, `Math.floor(1.5)`. Reguły matematyczne dotyczą ścieżek `src/sim/**` poza `src/sim/crowd/` i `src/sim/nav/` (próbka z `src/sim/crowd/x.ts` i `Math.atan2` przechodzi).
- [ ] **Step 2: Test całości**: `simViolations` dla każdego pliku `src/sim/**/*.ts` poza `*.test.ts` → pusta lista; brak plików `.tsx` w `src/sim`. Komentarze usuwa się przed dopasowaniem (`/\*[\s\S]*?\*/` i `//` do końca linii).
- [ ] **Step 3: Uruchom** `npx vitest run tests/architecture.test.ts` → PASS (Task 2 i 3 usunęły znane naruszenia; jeżeli coś zostało, napraw w duchu Task 3 i opisz w raporcie).
- [ ] **Step 4: Commit** `test(architektura): src/sim bez zegara, przeglądarki, warstw wyżej i matematyki zależnej od silnika (kontrakty §3)`

### Task 5: Tytuły zleceń poza stanem (L9) z migracją zapisów

**Files:**
- Modify: `src/sim/economy/quests.ts`, `src/sim/economy/sanitize.ts:202-216`, `src/ui/game/panels.tsx:370`, testy używające `q.title` (`grep -rn "\.title" src | grep -i quest`), `src/game/session.test.ts` i `src/sim/economy/sanitize.test.ts` (oczekiwania dla fixtures)

**Interfaces:**
- Produces: `Quest` bez pola `title`; `questTitle(q: Pick<Quest, 'kind' | 'target'>): string` w `quests.ts` (tabela `TITLE` jak dziś; tylko do wyświetlania).

- [ ] **Step 1: Testy**: `newQuest` zwraca obiekt bez klucza `title`; `questTitle({ kind: 'serve', target: 1500 })` to `'Obsłuż 1500 klientów'` porównane z `\`Obsłuż ${(1500).toLocaleString('pl-PL')} klientów\`` (ten sam napis co dziś); `sanitizeEconomy` zapisu z `quests[].title` (fixtures v1 i v2) zwraca zlecenia bez `title`, z tymi samymi `id`, `kind`, `target`, `start`, `reward`; zlecenie bez `title` przechodzi sanitizację (dziś by wypadło).
- [ ] **Step 2: Uruchom** → FAIL.
- [ ] **Step 3: Implementacja**: usuń `title` z `Quest` i `newQuest`; `quest()` w sanitize nie wymaga i nie przepisuje `title`; panel: `{questTitle(q)}`. Oczekiwania fixtures (Task 1 i test „prawdziwe zapisy v1”): `quests: fixture.quests.map(({ title: _, ...q }) => q)` z komentarzem „L9: tytuł zlecenia nie jest już częścią stanu”.
- [ ] **Step 4: Uruchom** `npm test` → PASS.
- [ ] **Step 5: Commit** `fix(sim): tytuł zlecenia liczony przy wyświetlaniu, a nie trzymany w stanie (L9), stare zapisy tracą tylko tytuł`

### Task 6: `layoutFor` w symulacji i prawdziwa wersja gry w zapisie

**Files:**
- Create: `src/sim/store/layoutFor.ts`, `src/game/version.ts`, `src/game/version.test.ts`
- Modify: `src/game/session.ts` (usuń `layoutFor`, import z symulacji; `GAME_VERSION` z `version.ts` zamiast `package.json`), `src/game/session.test.ts`, `src/game/cashier.test.ts`, `src/sim/economy/storeInfo.test.ts` (importy), `vite.config.ts`, `src/vite-env.d.ts`

**Interfaces:**
- Produces: `layoutFor(seed: string, level: number): StoreLayout` w `@/sim/store/layoutFor` (treść 1:1 z `session.ts:40-60`, z komentarzem); `GAME_VERSION: string` w `@/game/version`.

- [ ] **Step 1: Przeniesienie `layoutFor`** bez zmian w treści; `session.ts` importuje z `@/sim/store/layoutFor` i **nie** re-eksportuje (importy w testach poprawione). Test w `src/sim/store/layoutFor.test.ts`: `'poziom 0 to generateStore(seed)'` oraz `'poziomy 1..3: większy lokal, ten sam rodzaj, sloty z REMONTS'` (szerokość nie mniejsza niż bazowa, `lot.kind` ten sam, liczba slotów sprzętu ≥ 1).
- [ ] **Step 2: Wersja gry** — `vite.config.ts` przechodzi na postać funkcji `defineConfig(({ mode }) => …)` i dodaje `define: { __GAME_VERSION__: JSON.stringify(version) }`, gdzie `version` = `'test'` gdy `mode === 'test'` (Vitest), inaczej `` `${pkg.version}+${sha}` `` z `sha` = pierwsze 12 znaków `process.env.VERCEL_GIT_COMMIT_SHA`, a bez niej `git rev-parse --short=12 HEAD` (`execSync` w `try`), a bez gita `'dev'`. `src/vite-env.d.ts`: `declare const __GAME_VERSION__: string;`. `src/game/version.ts`: `export const GAME_VERSION: string = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev';` z komentarzem (L7: wersja w kopercie zapisu i w `RunRecord`; serwer trzyma pakiet odtwarzania na sezon pod tą wersją; funkcje serwerowe bez Vite dostają `'dev'`).
- [ ] **Step 3: Testy**: `version.test.ts`: `GAME_VERSION === 'test'`; w `session.test.ts` istniejący test koperty sprawdza `gameVersion === 'test'` (zamiast wersji z `package.json`).
- [ ] **Step 4: Uruchom** `npm test`, `npm run typecheck`, `npm run build`, potem `grep -ho '0\.0\.0+[0-9a-f]\{12\}' dist/assets/*.js | head -1` → jedna linia z wersją.
- [ ] **Step 5: Commit** `refactor(sim): layoutFor w symulacji (L7) i wersja gry z commita w kopercie zapisu`

### Task 7: Combo i okna paczek w stanie gry (L1, L3), bez zmiany zachowania `main.ts`

`main.ts` dalej woła `tapPallet(…, combo)`, `tapTill(…, combo)` i `claimGift` po staremu (kamień 1 go nie dotyka). Nowe zachowanie działa na ścieżce poleceń (Task 8); stare funkcje zachowują sygnatury.

**Files:**
- Modify: `src/sim/economy/economy.ts`, `src/sim/economy/catalog.ts` (stałe), `src/sim/economy/sanitize.ts`, testy fixtures (oczekiwania), `src/sim/economy/economy.test.ts`
- Create: `src/sim/economy/tapGift.test.ts`

**Interfaces:**
- Produces (pola `EconomyState`): `tapStreak: number` (stuknięcia w serii, 0 = brak), `lastTapAt: number` (minuta ostatniego udanego stuknięcia; nowa gra `-1e9`), `giftAt: number` (minuta otwarcia bieżącego albo następnego okna paczki).
- Produces (stałe w `catalog.ts`): `COMBO_WINDOW = 15` (minut gry między stuknięciami, ≈ 0,75 s przy ×1 w godzinach otwarcia; dziś 650 ms), `GIFT_FIRST = 480`, `GIFT_GAP_MIN = 900`, `GIFT_GAP_SPREAD = 1200`, `GIFT_OPEN = 180` (≈ 9 s przy ×1, jak dziś).
- Produces (funkcje w `economy.ts`): `comboMult(streak: number): number` = `Math.min(5, 1 + Math.floor(streak / 4))`; `nextTapStreak(s): number` (seria, jaką da stuknięcie teraz: `s.minute - s.lastTapAt <= COMBO_WINDOW ? s.tapStreak + 1 : 1`); `commitTap(s): void` (zapisuje `tapStreak = nextTapStreak(s)`, `lastTapAt = s.minute`); `tapCombo(s): { count: number; mult: number }` (do interfejsu: `{0, 1}` gdy seria wygasła); `giftOpen(s): boolean` (`s.giftAt <= s.minute && s.minute < s.giftAt + GIFT_OPEN && !s.gameOver`); `scheduleGift(s): void` (następne okno: `from = s.minute + GIFT_GAP_MIN + Math.floor(rand01(s.seedHash, s.giftAt, 30) * GIFT_GAP_SPREAD)`, przesunięte w godziny otwarcia: gdy minuta dnia < `OPEN_FROM` → `OPEN_FROM` tego dnia, gdy > `OPEN_TO - GIFT_OPEN` → `OPEN_FROM` następnego dnia).

- [ ] **Step 1: Testy** w `tapGift.test.ts`:
  - `'combo: 1..3 stuknięcie ×1, 4. ×2, 8. ×3, 16. i dalej ×5; przerwa > COMBO_WINDOW zaczyna od 1'` (przez `nextTapStreak`/`commitTap` i przesuwanie `s.minute`).
  - `'tapCombo wygasa po COMBO_WINDOW minutach'`.
  - `'nowa gra: pierwsze okno paczki w GIFT_FIRST od startu, w godzinach otwarcia'`.
  - `'okno bez odbioru wygasa w stepMinute i następne otwiera się 900–2100 minut później, zawsze w godzinach otwarcia'` (1000 seedów: każde `giftAt` ma minutę dnia w `[OPEN_FROM, OPEN_TO - GIFT_OPEN]`).
  - `'okna są deterministyczne: ten sam seed, te same okna'`.
  - `'stary zapis bez pól: tapStreak 0, lastTapAt -1e9, giftAt = minuta zapisu + GIFT_FIRST'` (przez `sanitizeEconomy` fixture v1 i v2).
  - `'zapis i wczytanie w trakcie okna: okno zostaje'` (sanitize zachowuje `giftAt` z zakresu `[0, minute + 2 · 1440]`).
- [ ] **Step 2: Uruchom** → FAIL.
- [ ] **Step 3: Implementacja**: pola w `EconomyState` i `createEconomy` (`giftAt = OPEN_FROM + GIFT_FIRST`, czyli minuta startu + `GIFT_FIRST`); `stepMinute` na początku (po `gameOver`) robi `if (s.minute >= s.giftAt + GIFT_OPEN) scheduleGift(s)`; sanitize trzech pól z zakresami jak wyżej. `tapPallet`, `tapTill`, `claimGift` bez zmian w tym zadaniu.
- [ ] **Step 4: Oczekiwania fixtures** (Task 1, Task 5, test „prawdziwe zapisy v1”): dopisz nowe pola z wartościami z migracji, z komentarzem.
- [ ] **Step 5: Uruchom** `npm test` → PASS (testy ekonomii porównujące przebiegi muszą wyjść tak samo poza nowymi polami).
- [ ] **Step 6: Commit** `feat(sim): combo z czasu gry i okna paczki od Centrali w stanie gry (L1, L3)`

### Task 8: `commands.ts`: polecenia i `applyCommand`

**Files:**
- Create: `src/sim/economy/commands.ts`, `src/sim/economy/commands.test.ts`
- Modify: `src/sim/economy/economy.ts` (`tapPallet` przyjmuje opcjonalne `out: EconEvent[]` jako piąty parametr, do którego trafia zdarzenie złotej palety; reszta bez zmian)

**Interfaces:**
- Consumes: Task 6 `layoutFor`; Task 7 `nextTapStreak`, `commitTap`, `comboMult`, `giftOpen`, `scheduleGift`.
- Produces:
  - `Command` — unia dokładnie z §2 kontraktów (14 typów: `tapPallet {palletId?}`, `tapTill`, `claimQuest {questId}`, `claimGift`, `movePallet {palletId, loc}`, `returnPallet {palletId}`, `setOrder {auto, manual?}`, `hire`, `fire`, `setPriority {priority}`, `buyUpgrade {id}`, `buyEquipment {id, slotId?}`, `startRemont`, `campaign`, `rushRemont`).
  - `COMMAND_TYPES: readonly Command['type'][]`.
  - `isCommand(x: unknown): x is Command` — kształt i typy pól: liczby skończone i całkowite dla `palletId`/`questId`, `loc` z trzech, `priority` z kluczy `PRIORITY_LABEL`, `id` z `UPGRADE_BY_ID`/`EQUIPMENT_BY_ID` (przez `Object.hasOwn`), `slotId` napis, `auto` boolean, `manual` skończona liczba; zbędne klucze dozwolone.
  - `interface CommandOutcome { result: CommandResult; events: EconEvent[]; layoutChanged: boolean; layout?: StoreLayout; info?: StoreInfo }` (`layout`/`info` są wtedy, gdy `layoutChanged`: wołający podmienia u siebie układ bez drugiego generowania).
  - `applyCommand(state: EconomyState, info: StoreInfo, cmd: Command): CommandOutcome`.

Zachowanie `applyCommand` (decyzje):
1. `!isCommand(cmd)` → `{ ok: false, text: 'Nieznane polecenie.' }`, stan nietknięty, bez `processLevels`.
2. `state.gameOver` → `{ ok: false, text: 'Gra skończona: Centrala wypowiedziała umowę.' }`, stan nietknięty.
3. `tapPallet`/`tapTill`: `combo = comboMult(nextTapStreak(state))`, wywołanie starej funkcji z tym `combo`; gdy `result.ok` → `commitTap(state)`. Zdarzenie złotej palety idzie do `events` (nie w `result.text`).
4. `claimGift`: `!giftOpen(state)` → `{ ok: false, text: 'Paczki od Centrali już nie ma.' }` bez zmian stanu; inaczej `claimGift`, potem `scheduleGift(state)` (jedno okno = jeden odbiór).
5. `setOrder`, `setPriority` → `{ ok: true }`.
6. Pozostałe: wywołanie funkcji z `economy.ts` 1:1.
7. Po każdym przyjętym poleceniu (także nieudanym w punkcie 3–6): `processLevels(state, events)` (H1); gdy `state.remontLevel` różni się od wartości sprzed polecenia: `layout = layoutFor(state.seed, state.remontLevel)`, `info = computeStoreInfo(layout)`, `relayout(state, info)` (H2), `layoutChanged: true`.

- [ ] **Step 1: Testy** w `commands.test.ts` (każdy na świeżym `createEconomy(seed, computeStoreInfo(layoutFor(seed, 0)))`):
  - `'każdy typ polecenia daje ten sam stan co dzisiejsza ścieżka main.ts'` — `it.each(COMMAND_TYPES)`: stan A przez `applyCommand`, stan B przez funkcję z `economy.ts` + `processLevels` (+ `relayout` z `layoutFor` przy remoncie); `JSON.stringify(A) === JSON.stringify(B)` (dla stuknięć B dostaje `combo` 1 i ręcznie `commitTap` — porównanie dotyczy pierwszego stuknięcia). Stan przygotuj tak, by polecenie się udało (gotówka, poziom, paleta, gotowe zlecenie, otwarte okno paczki, remont w toku dla `rushRemont`).
  - `'stuknięcia w serii: 4. stuknięcie rozładowuje 2× tyle co 1.'`; `'nieudane stuknięcie nie liczy się do serii'`.
  - `'paczka: poza oknem odmowa bez zmiany stanu; w oknie raz, drugi odbiór w tym samym oknie odmowa'`.
  - `'XP z polecenia od razu podnosi poziom (processLevels) i zdarzenie levelup jest w events'`.
  - `'remont: layoutChanged, nowy układ = layoutFor(seed, 1), palety i sprzęt mają miejsca w nowym układzie'` (sprawdź `outcome.info.spots[p.loc][p.spot]` dla każdej palety).
  - `'zepsute polecenia: odmowa bez zmiany stanu i bez wyjątku'` — `it.each` z: `{type: 'nuke'}`, `{type: 'buyUpgrade', id: 'toString'}`, `{type: 'buyUpgrade', id: '__proto__'}`, `{type: 'buyEquipment', id: 'x'}`, `{type: 'movePallet', palletId: 1, loc: 'roof'}`, `{type: 'setPriority', priority: 'all'}`, `{type: 'setOrder', auto: 'yes'}`, `{type: 'setOrder', auto: true, manual: NaN}`, `{type: 'claimQuest', questId: '1'}`, `{type: 'tapPallet', palletId: 1.5}`, `null`, `'tapTill'`, `[]`.
  - `'po końcu gry każde polecenie jest odrzucane'`.
- [ ] **Step 2: Uruchom** → FAIL.
- [ ] **Step 3: Implementacja** wg decyzji wyżej; plik zaczyna komentarz: jedyne miejsce zmiany stanu w odpowiedzi na gracza (§14.1, I5), czyste, bez zegara.
- [ ] **Step 4: Uruchom** `npx vitest run src/sim/economy/commands.test.ts`, potem `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(sim): polecenia gracza jako obiekty i jedno applyCommand z poziomami i przebudową po remoncie (I5)`

### Task 9: `run.ts`: dziennik i odtwarzanie biegu

**Files:**
- Create: `src/sim/run.ts`, `src/sim/run.test.ts`

**Interfaces:**
- Consumes: Task 8 `applyCommand`, `isCommand`; Task 6 `layoutFor`; `GENERATOR_VERSION`.
- Produces:
  - `LogEntry`, `RunRecord` dokładnie z §2.
  - `freshRun(seed: string): { state: EconomyState; layout: StoreLayout; info: StoreInfo }` — `layoutFor(seed, 0)`, `computeStoreInfo`, `createEconomy(seed, info)` (partner 0).
  - `replayRun(run: RunRecord, untilMinute: number): EconomyState`.

Zachowanie `replayRun` (decyzje): rzuca `Error`, gdy `run.generatorVersion !== GENERATOR_VERSION` (inny generator = inny sklep, odtworzenie nie byłoby wiernym). Dziennik: kopia posortowana stabilnie po `(minute, seq)`. Pętla: najpierw wszystkie wpisy z `minute <= state.minute` (każdy przez `applyCommand`; `info` podmienione, gdy `layoutChanged`), potem stop gdy `state.minute >= untilMinute` albo `state.gameOver`, inaczej `stepMinute`. Wpisy z minutą po `untilMinute` są pomijane; wpisy sprzed startu trafiają na start. Zdarzenia odrzucane (tablica czyszczona co krok). `gameVersion` i `mode` są tylko przenoszone (sprawdza je serwer B).

- [ ] **Step 1: Testy** w `run.test.ts`. Pomocnik w teście: `playLive(seed, days)` — „żywa gra” jak przyszłe `actions.ts`: `freshRun(seed)`, dla każdej minuty: bot wydaje 0..n poleceń (wybór z `rand01(hashString(seed + ':bot'), minute, k)`): w godzinach otwarcia stuknięcia (`tapTill` gdy kolejka, `tapPallet` z `palletId` albo bez), `claimQuest` gotowych zleceń, `claimGift` gdy `giftOpen`, co godzinę próba `buyUpgrade`/`buyEquipment` losowego `id`, `hire` przy kolejce > 6, `startRemont` gdy przejdzie, czasem `rushRemont`, `campaign`, `movePallet` z chodnika na zaplecze, `returnPallet`, `setOrder`, `setPriority`, `fire`; co ~500 minut polecenie zepsute (np. `{type: 'buyUpgrade', id: 'nope'}`). Każde polecenie: `log.push({ minute: state.minute, seq: seq++, cmd })`, `applyCommand`, podmiana `info` przy `layoutChanged`. Potem `stepMinute`. Zwraca `{ state, record }` z `gameVersion: 'test'`, `mode: 'ranked'`.
  - `'odtworzenie z (seed, dziennik) daje bajt w bajt ten sam stan: 12 seedów × 90 dni'` — `JSON.stringify(replayRun(JSON.parse(JSON.stringify(record)), live.state.minute)) === JSON.stringify(live.state)`; w tym samym teście `expect(seedów z remontLevel ≥ 1).toBeGreaterThanOrEqual(3)` (jeśli bot nie dobija remontów, popraw bota, np. mniej zakupów ulepszeń przed remontem).
  - `'odtworzenie do minuty pośredniej = stan żywej gry w tej minucie'` (zapamiętaj `JSON` stanu w kilku minutach w trakcie żywej gry).
  - `'stan nie zależy od toLocaleString ani Intl'` — ten sam bieg z podmienionym `Number.prototype.toLocaleString` (zwraca `'X'`) i przywróconym w `finally`: ten sam JSON.
  - `'zepsuty dziennik nie rzuca i nie psuje stanu'`: dziennik z wpisami nieposortowanymi, zdublowanym `seq`, `minute` ujemną i po końcu, polecenia z Review Focus 2 → `replayRun` nie rzuca, liczby w stanie skończone, a dziennik posortowany daje ten sam stan co nieposortowany.
  - `'bankructwo w środku biegu: odtworzenie się kończy, polecenia po końcu nie zmieniają stanu'` (seed + dziennik, który co godzinę kupuje `hire` i nic nie sprzedaje, `untilMinute` = 400 dni).
  - `'inna wersja generatora: odtworzenie odmawia'`.
  - `'freshRun to ten sam stan co createSession dla nowej gry bez premii'`.
  - Czas całego pliku < 15 s (inaczej zmniejsz liczbę seedów do 8, dni do 75).
- [ ] **Step 2: Uruchom** → FAIL; **Step 3: Implementacja**; **Step 4: Uruchom** `npm test`, `npm run typecheck`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(sim): dziennik poleceń i odtwarzanie biegu z seeda (replayRun), dowód bajt w bajt na wielu seedach`

### Task 10: Raport kamienia 1

- [ ] Plik `/Users/mpawelczuk/ZabkaTycone/.superpowers/sdd/etap-2/A-raport.md`: commity, liczba testów przed/po, co B i C mogą już brać (importy i sygnatury, kanał 30, pola stanu, `CommandOutcome.layout/info`, `freshRun`, `GAME_VERSION`), decyzje (kalendarz, `xpCurve` w BigInt, schemat zapisu bez zmiany, combo i paczka tylko na ścieżce poleceń do kamienia 2), pytania otwarte (limit stuknięć L2, dziennik w zapisie dla trybu rankingowego, premia partnera a `replayRun`).

---

# Kamień milowy 2 (rozbicie `main.ts`, interfejs na poleceniach)

Przed startem: `git merge main` w worktree (poprawki K3 koordynatora). Numery linii `main.ts` z inwentarza mogą się przesunąć — implementer czyta `main.ts` po scaleniu.

### Task 11: `actions.ts`: dyspozytor poleceń, dziennik w sesji, kroki po poleceniu

**Files:**
- Create: `src/game/actions.ts`, `src/game/actions.test.ts`
- Modify: `src/game/session.ts` (pole `run: RunLog | null` w `GameSession`; nowa gra: `{ record: { seed, gameVersion: GAME_VERSION, generatorVersion: GENERATOR_VERSION, mode: 'casual', log: [] }, seq: 0 }`; sesja z zapisu: `null`, bo nie zaczyna się od świeżego sklepu)

**Interfaces:**
- Consumes: `applyCommand`, `Command`, `LogEntry`, `RunRecord`.
- Produces:
  - `interface RunLog { record: RunRecord; seq: number }`; `RUN_LOG_MAX = 100_000` (gra zwykła trzyma dziennik w pamięci i nie zapisuje go; po przekroczeniu albo po zmianie stanu spoza dziennika `session.run = null`).
  - `markOffLog(session: GameSession): void` — zmiana stanu spoza dziennika (nagroda powitalna, `skip`), bieg przestaje być odtwarzalny.
  - `interface CommandEffects { play(sfx: Sfx): void; buzz(pattern: number | number[]): void; toast(text: string, kind: ToastKind): void; confetti(x?: number, y?: number, count?: number): void; handleEvents(events: EconEvent[]): void; persist(): void; clearSelection(): void; rebuildScene(): void; notice(text: string): void; refresh(): void }`.
  - `AFTER: Record<Command['type'], { okToast: boolean; sfx?: Sfx; buzz?: number | number[]; confetti?: boolean; persist?: boolean; clearSelection?: 'before' | 'after' }>` — wartości przepisane z dzisiejszego `game` w `main.ts` (C1–C16 w inwentarzu).
  - `dispatchCommand(session: GameSession, cmd: Command, fx: CommandEffects): CommandResult` — kolejność: wpis do dziennika `{ minute: session.econ.minute, seq, cmd }` (także polecenia, które się nie udadzą: odtworzenie powtórzy tę samą odmowę), `applyCommand`, przy `layoutChanged`: `session.layout/info/layoutLevel` z wyniku, `fx.persist()` i `fx.rebuildScene()` w `try/catch` (błąd: `console.error`, `fx.notice('Nie udało się przebudować sklepu po remoncie. Postęp jest zapisany — odśwież stronę.')`, bez rzucania), potem `fx.handleEvents(events)`, toast i dźwięki wg `AFTER`, `fx.refresh()`.
- [ ] Testy (`actions.test.ts`, sesja z `createSession` na `memoryStorage`, `fx` jako atrapa zapisująca wywołania): `'polecenie trafia do dziennika z minutą i kolejnym seq'`; `'dziennik z dispatchCommand odtwarza się replayRun do tego samego stanu'` (kilka poleceń przeplecionych `stepMinute`); `'nieudane polecenie: toast error i dźwięk error, wpis w dzienniku'`; `'remont: układ sesji podmieniony, rebuildScene wołane raz, zapis'`; `'rebuildScene rzuca: wynik ok, komunikat, zapis, bez wyjątku'`; `'sesja z zapisu nie ma dziennika; markOffLog wyłącza dziennik'`; `'tabela AFTER: claimQuest daje coins, confetti i zapis; tapTill bez toastu ok'`.
- [ ] Commit `feat(gra): actions.ts — polecenia przez applyCommand, dziennik biegu i kroki po poleceniu z obsługą błędu przebudowy`

### Task 12: Interfejs wysyła polecenia; paczka i combo ze stanu

**Files:**
- Modify: `src/ui/state.ts` (`GameActions`: `dispatch(cmd: Command): CommandResult` zamiast 14 metod; zostają `claimWelcome`, `openNextStore`, `setSound`, `setVibration`, `restart`, `newStore`; sygnał `combo` usunięty), `src/ui/game/panels.tsx`, `src/ui/game/overlays.tsx` (`GiftDrop` pokazuje się, gdy `giftOpen(econ.value.s)`, pozycja losowana w interfejsie przy otwarciu okna; `ComboChip` czyta `tapCombo(econ.value.s)`), `src/ui/game/overlays.test.tsx`, `src/main.ts` (implementacja `game.dispatch` przez `dispatchCommand`, bez `nextCombo` i bez `afterAction`)
- [ ] Testy: `overlays.test.tsx` — `'paczka widoczna tylko w oknie z symulacji'`, `'combo chip z tapCombo stanu'`; wywołania w panelach budują poprawne `Command` (test na atrapie `dispatch`, np. przycisk „Kup” ulepszenia → `{ type: 'buyUpgrade', id }`).
- [ ] Commit `feat(ui): interfejs wysyła polecenia; paczka i combo pochodzą ze stanu symulacji (L1, L3)`

### Task 13: Rozbicie `main.ts` na `controls`, `scene`, `frame` i uchwyt debugowania

**Files:**
- Create: `src/game/controls.ts` (`bindControls`, `dragPan`, `isTyping`, `TAP_SLOP`, budowa `ui.Controls`), `src/game/scene.ts` (`load`/`unload`/`syncVisuals`/`publish` jako `createSceneHost(deps)`, scena testowa, `writeSeedToUrl`), `src/game/frame.ts` (pętla klatek; czysta `advanceSession(session: GameSession, realDt: number, speed: number, modal: boolean, out: EconEvent[]): number` i `isModalOpen(): boolean`), `src/game/frame.test.ts`, `src/game/controls.test.ts` (część czysta: mapa klawiszy, próg stuknięcia), `src/game/debug.ts` albo funkcja w `frame.ts`: `debugHandleEnabled(isDev: boolean, params: URLSearchParams): boolean` + instalacja uchwytu (M11: tylko `import.meta.env.DEV` albo `?debug=1`; `skip` woła `markOffLog`)
- Modify: `src/main.ts` (zostaje rozruch: parametry, ekran startowy, złożenie modułów; cel ≤ 250 linii)
- [ ] Testy: `advanceSession` — przy `speed 0` albo `modal` zero minut; zdarzenia trafiają do `out`; `skip` z uchwytu wyłącza dziennik; `debugHandleEnabled(false, ?debug=1) === true`, `(false, '') === false`, `(true, '') === true`.
- [ ] Sprawdzenie w przeglądarce: własny headless `playwright-core` + `vite --port 5191`: start gry, stuknięcie w kasę, zakup, paczka (przewinięcie `?debug=1` + `skip`), brak błędów w konsoli; potem zatrzymać vite.
- [ ] Commit `refactor(gra): main.ts rozbity na controls, scene, actions i frame; uchwyt debugowania tylko w dev albo z ?debug=1 (M11)`

### Task 14: Przegląd końcowy i raport kamienia 2

- [ ] Przegląd całej gałęzi (Opus), poprawki, raport w `A-raport.md` (sekcja kamienia 2), podsumowanie dla koordynatora.

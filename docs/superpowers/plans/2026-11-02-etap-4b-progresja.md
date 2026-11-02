# Etap 4b: progresja bez sufitu — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dać graczowi z 400 tys. zł na co wydawać aż do 2–3 mln, czyli:
- remonty 4–5, wyższe ulepszenia i badania Sieci;
- do 5 sklepów;
- 12 kart dnia i 13 celów;
- Galerię sław za pierwszy milion.

**Architecture:** liczby żyją w czystym `src/sim`.
- Remonty, ulepszenia, karty i cele sklepu siedzą w ekonomii, którą liczy też sędzia (stąd `SIM_VERSION` 7).
- Badania, limit sklepów, cele firmy i próg miliona siedzą w firmie (`src/sim/firm`). Do sklepów schodzą tylko przez `StoreInfo.site` (`SiteMods.net`, kanibalizacja w `siteFor`), więc gra jednym sklepem i ranking ich nie widzą.
- Galeria to osobny endpoint w `src/server` pod prefiksem `tr:fame:`.

**Tech Stack:** TypeScript 7, Vitest 5, Preact 11 + signals, three.js 0.186, Vite 8, Vercel functions + Upstash, headless Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-11-02-etap-4b-progresja-design.md` (dalej „spec”; §-y odnoszą się do niego). Kod bazowy to `main` po scaleniu części A 4a.2 (`claude/miasto-4a2-a56360`, 9802658). Jeśli `main` jej jeszcze nie ma, najpierw `git merge claude/miasto-4a2-a56360`.

## Global Constraints

- Kolejność bramek: `npm run build` (build:judge + tsc + vite build) **przed** `npm test`. Stary, git-ignorowany `src/server/judgeBundle.js` daje 503 w `api.test.ts`.
- `src/sim` bez `Math.random`, `Date`, `Math.hypot` i `**`; arytmetyka jak w `traffic.ts` (pętle zamiast potęg).
- Sędzia nie dostaje miasta ani firmy: `src/sim/run.ts`, `src/sim/ranked.ts` i `scripts/judge-entry.ts` nie importują `src/sim/city` ani `src/sim/firm` (`tests/architecture.test.ts`).
- `SIM_VERSION` 6 → 7 (Task 1). Każdy kolejny task, który zmienia wynik symulacji, nadpisuje wpis `GOLDEN[7]` tym, co drukuje `tests/simGolden.test.ts`. Wpis 7 nie jest jeszcze wydany.
- `GENERATOR_VERSION` 1 i `CITY_GENERATOR_VERSION` 1 bez zmian. `LAYOUTS_GOLDEN` i `CITY_GOLDEN` bez zmian.
- `FIRM_SAVE_SCHEMA` 3 → 4 (Task 3). Wczytują się wszystkie pliki `src/game/fixtures/*.json`. Paczka „Wyślij zapis” ≤ 65 536 B.
- i18n: każdy nowy polski napis ma wpis w `EN_UI`, `EN_RENDER`, `EN_CARDS`, `EN_PLURALS` albo w tabelach `src/i18n/en/content.ts` (`EN_UPGRADES`, `EN_REMONTS`, `EN_MILESTONES`). `tests/i18n.test.ts` przechodzi.
- Balans 4a.1 bez zmian: `DISTRICTS`, `RIVAL_FACTOR` 0.8, `RIVAL_RADIUS_M` 150, `PARTNER_MONTHS` 2, `PARTNER_TRUST` 75, `RELET_SHARE` 0.3.
- Neutralność: brak `info.site` albo brak `site.net` daje grę co do bitu jak dziś. Nowe modyfikatory stoją za gałęzią (`if (net)`), nigdy jako mnożenie przez 1.
- Bez nowych zmiennych środowiskowych i bez czytania env poza `src/server/env.ts`. Galeria jest za `route()` (`RANKING_ENABLED`).
- Smoke:
  - tylko headless: `PLAYWRIGHT_ROOT=/Users/mpawelczuk/Dev/ochronairz-rotator/node_modules/playwright-core npm run city:smoke`;
  - `locale: 'pl-PL'`;
  - zawsze `page.route('**/api/**', r => r.abort())`;
  - przed ładowaniem `localStorage['traszka:tutorial'] = '{"v":1,"tour":"skipped","seen":[],"tips":false}'`;
  - nigdy nie wysyłamy biegów ani wpisów Galerii na produkcję.
- `scripts/tutorial-smoke.mjs` nadpisuje `docs/superpowers/reports/2026-10-30-samouczek/`. Po nim `git checkout` i `git clean` tego folderu.
- Repo jest publiczne: bez sekretów i bez prawdziwych marek kart kolekcjonerskich (parodia to wyłącznie „Traszkomony”). Nie ruszać nieśledzonego `docs/superpowers/specs/2026-10-29-promo-reddit-design.md`.
- Komunikaty commitów po polsku, w stylu repo (`feat(…)`, `fix(…)`, `test(…)`), zakończone linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Zapis schematu 3 z `reopened` i portfelem ≥ 1 mln** (`save-v3-po-traszce.json` z podbitym `person.wallet`). Oczekiwanie: wczytuje się z `research {}`, `storeLimit 3`, a pierwszy krok minuty daje dokładnie jedno `million` i cele `cash250k…cash1m` w `ready`, nie w `claimed`. Test: Task 5, „schemat 3 po Traszce z milionem”.
2. **Powrót z 2 sklepów do 1** (wypowiedzenie drugiego) po kupnie badań. Sklep startowy znów nie ma `site`, a jego krok jest bitowo równy ekonomii bez firmy; badania zostają w `research`. Test: Task 4, „jeden sklep po badaniach gra jak bez Sieci”.
3. **Remont 5, gdy generator nie złoży układu.** Sklep nie maleje: szerokość ≥ szerokości poziomu 4, a sloty ≥ slotom poziomu 3. Test: Task 1 (200 seedów, wszystkie rodzaje lokalu).
4. **Galeria przy zablokowanym API i podwójnym wpisie.** UI pokazuje „Galeria jest teraz nieczynna”, gra idzie dalej, przycisk „Wyślij mój wpis” zostaje. Drugi POST tego samego nicka zwraca `first: false` i pierwszy `at`. Testy: Task 6 („drugi wpis tego nicka”) i Task 8 („lista przy błędzie sieci”).
5. **Bieg rankingowy.** Nigdy nie dostaje `research`, `unlock`, `goal` ani `million`, a polecenia `research` i `claimGoal` dają odmowę `ranked`. Test: Task 5, „ranked bez Sieci, celów firmy i Galerii”.

---

### Task 1: Remonty 4–5, ulepszenia późnej gry, cele sklepu, `SIM_VERSION` 7 — **P1**, model: sonnet

**Files:**
- Modify: `src/sim/economy/upgrades.ts` (`UpgradeId`, `UPGRADES`, `REMONTS`, nowa `remontTrafficMult`)
- Modify: `src/sim/economy/economy.ts` (`effects()`, `Effects.theft`, `sell()`, `startRemont`)
- Modify: `src/sim/economy/milestones.ts` (3 cele na końcu)
- Modify: `src/sim/store/layoutFor.ts` (fallback dla poziomu ≥ 4)
- Modify: `src/sim/simVersion.ts` (`SIM_VERSION = 7`), `tests/simGolden.test.ts` (wpis `GOLDEN[7]`)
- Modify: `src/i18n/en/content.ts` (`EN_UPGRADES` dla 5 nowych id i nowych nazw poziomów, `EN_REMONTS` 4 i 5, `EN_MILESTONES` 3 nowe), `src/i18n/en/sim.ts` (tekst „Traszka Max Pro Ultra”)
- Modify: `src/ui/game/panels.tsx:455` (tekst po ostatnim remoncie)
- Test: `src/sim/store/layoutFor.test.ts`, `src/sim/economy/economy.test.ts`, `src/sim/economy/upgrades.test.ts` (Create)

**Interfaces:**
- Produces: `remontTrafficMult(level: number): number`
- Produces: `UpgradeId` + `'kasaEkspres' | 'ekrany' | 'barHot' | 'magazynWys' | 'dron'`
- Produces: `REMONTS[3..4]` (spec §5.1)
- Produces: `Effects.theft?: number`
- Produces: `MILESTONES` + `remont4`, `remont5`, `earned1m`

- [ ] **Step 1: Write failing tests**

```ts
// src/sim/economy/upgrades.test.ts
it('REMONTS: ceny 35k/100k/200k/450k/900k, poziomy 1–3 bez zmian poza ceną', () => {
  expect(REMONTS.map((r) => r.cost)).toEqual([35_000, 100_000, 200_000, 450_000, 900_000]);
  expect(REMONTS.map((r) => [r.grow, r.slots, r.minLevel, r.days])).toEqual([
    [[4, 2, 1], 4, 8, 2], [[8, 4, 2], 5, 14, 3], [[12, 6, 3], 7, 20, 4], [[14, 7, 4], 8, 28, 5], [[16, 8, 4], 9, 34, 6]]);
});
it('remontTrafficMult: 0–3 bit w bit jak 1 + 0.1 × poziom, potem 1.45 i 1.6', () => {
  for (const l of [0, 1, 2, 3]) expect(Object.is(remontTrafficMult(l), 1 + 0.1 * l)).toBe(true);
  expect(remontTrafficMult(4)).toBeCloseTo(1.45, 12); expect(remontTrafficMult(5)).toBeCloseTo(1.6, 12);
});
it('maxLevel: szkolenie 8, klima 3, scoSoft 5, wozek 5, regaly 5, ulotki 8, kawa 5, traszkapka 5, tasmociag 5, wykladacz 5', …);
it('nowe ulepszenia z tabeli §5.2: grupa, maxLevel, baseCost, costMult, requires', …);   // 5 wierszy literalnie z tabeli
it('koszt rośnie szybciej niż efekt: upgradeCost(def, l + 1) / upgradeCost(def, l) ≥ 1.8 dla każdego l < maxLevel − 1', …);
it('każde UPGRADES.names ma co najmniej tyle wpisów co maxLevel', …);
```

```ts
// src/sim/store/layoutFor.test.ts
it('poziomy 4 i 5 na 200 seedach (pickLot i trzy rodzaje LotSpec): bez wyjątku, szerokość L5 ≥ L4 ≥ L3, sloty sprzętu L4 i L5 ≥ L3', …);
it('poziomy 1–3 jak przed etapem: skrót JSON layoutFor(seed, l) dla 10 seedów × l ∈ {1, 2, 3} równy tablicy wpisanej do testu', …);
// tablicę skrótów policz w tym kroku na kodzie bazowym (przed zmianą REMONTS); ten test przechodzi przed i po zmianie
// i pilnuje, że GENERATOR_VERSION może zostać
```

```ts
// src/sim/economy/economy.test.ts
it('effects: kasaEkspres 2 → tillSpeed 1 + 0.15 × szkolenie + 0.2; ekrany 3 → traffic sum + 0.18; barHot 1 → hotMult + 0.25', …);
it('effects: magazynWys 2 → backroomCap = round(info.backroomCap × (1 + 0.5 × regaly + 0.8))', …);
it('dron 2 bez dzielnicy: fx.theft = 0.76; bez drona i bez dzielnicy fx.theft undefined (wutFromSales dostaje undefined)', …);
it('startRemont na poziomie 5: odmowa „Większego sklepu już nie będzie. To jest Traszka Max Pro Ultra.”', …);
it('cele remont4, remont5, earned1m spełniają się przy remontLevel 4, 5 i total.margin 1 000 000', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/economy/upgrades.test.ts src/sim/store/layoutFor.test.ts src/sim/economy/economy.test.ts`
Expected: FAIL (brak `remontTrafficMult`, `REMONTS.length` 3, brak id ulepszeń).

- [ ] **Step 3: Implementacja**
  - `REMONTS` i nazwy według §5.1. `remontTrafficMult(level) = 1 + 0.1 * Math.min(level, 3) + 0.15 * Math.max(0, level - 3)`. W `effects()` zamień `(1 + 0.1 * s.remontLevel)` na `remontTrafficMult(s.remontLevel)`.
  - Nowe ulepszenia według §5.2:
    - `tillSpeed: 1 + 0.15 * szkolenie + 0.1 * kasaEkspres`;
    - `+ 0.06 * level(s, 'ekrany')` w sumie ruchu;
    - `hotMult + 0.25 * barHot`;
    - `backroomCap: Math.round(info.backroomCap * (1 + 0.5 * regaly + 0.4 * magazynWys))`;
    - `fx.theft = dron > 0 ? (site?.theft ?? 1) * (1 - 0.12 * dron) : site?.theft`.
    W `sell()` `wutFromSales` i `wutFromSco` dostają `fx.theft` zamiast `fx.site?.theft`.
  - `layoutFor`: gdy `level ≥ 4` i wszystkie próby zawiodą, zwraca `layoutFor(seed, level - 1, lot)`. Poziomy 1–3 zostają przy `base`.
  - `SIM_VERSION = 7`. Uruchom `npx vitest run tests/simGolden.test.ts` i wpisz wydrukowany wpis `GOLDEN[7]`.
  - Tłumaczenia: EN dla każdej nowej nazwy, efektu i flavor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/economy src/sim/store tests/simGolden.test.ts tests/i18n.test.ts tests/architecture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(ekonomia): remonty 4–5, ulepszenia późnej gry i cele sklepu (SIM 7)`

---

### Task 2: Dwanaście kart dnia — **P1**, model: sonnet

**Files:**
- Modify: `src/sim/economy/tycoon/deck.ts` (pomocnik `byDistrict`, 12 kart na końcu `DECK`)
- Modify: `src/i18n/en/cards.ts` (12 wpisów `EN_CARDS`)
- Modify: `tests/simGolden.test.ts` (`GOLDEN[7]` i lista odpowiedzi kart: `GOLDEN_CARDS=1 npx vitest run tests/simGolden.test.ts -t 'nowa lista'`)
- Test: `src/sim/economy/tycoon/newCards.test.ts` (Create)

**Interfaces:**
- Produces: `byDistrict(w: { none: number; osiedle: number; srodmiescie: number; dworzec: number; biurowce: number }): (c: CardContext) => number`
- Produces: `NEW_CARD_IDS_4B` (readonly tuple 12 id ze spec §5.5)

- [ ] **Step 1: Write failing tests**

```ts
it('12 nowych kart na końcu DECK, w kolejności NEW_CARD_IDS_4B, każda z EN_CARDS', () => {
  expect(DECK.slice(-12).map((d) => d.id)).toEqual([...NEW_CARD_IDS_4B]);
  for (const id of NEW_CARD_IDS_4B) expect(EN_CARDS[id]).toBeDefined();
});
it('byDistrict: kontekst bez district → none; dworzec → dworzec', …);
it('wagi z tabeli §5.5 (5 kontekstów × 12 kart)', …);
it('karty-zrzut, odpowiedź 0: cardModifiers.traffic = 1.9 o 9:00 i 1 o 12:01 tego dnia; odpowiedź 1: 2.6 o 7:00, 1 o 10:01', …);
it('karty-zrzut wypada z odpowiedzią domyślną 0, ma at 6:00 i cooldown 18', …);
it('koncert, kibice, wybory: modyfikator ruchu startuje o from (18:00, 16:00, 7:00), nie od decyzji', …);
it('karty-zrzut: tytuł i tekst mówią o „Traszkomonach” (parodia własna gry), EN: „Traszkomon”', …);
it('determinizm: drawDayCards na 3 seedach × 120 dni daje ten sam ciąg id przy dwóch uruchomieniach', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/economy/tycoon/newCards.test.ts`
Expected: FAIL (`NEW_CARD_IDS_4B` nie istnieje).

- [ ] **Step 3: Implementacja kart według tabeli §5.5.**
  - Parametry `{n}` i `{v}` tak jak w istniejących kartach (`zl`, `k`).
  - Ryzyko w formacie `risk: { chance, delta, text }`.
  - Polskie teksty to satyra na Centralę, nie na klientów.
  - Tytuły dokładnie jak w tabeli.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/economy tests/simGolden.test.ts tests/i18n.test.ts tests/districtBalance.test.ts`
Expected: PASS. `districtBalance` przechodzi bez zmiany progów. Jeśli któryś cel §8.4 4a.1 padnie, zatrzymaj się i obniż wagę karty, która go psuje. Nie zmieniaj progów.

- [ ] **Step 5: Commit** — `feat(karty): dwanaście kart dnia, w tym zrzut Traszkomonów`

---

### Task 3: Firma do 5 sklepów: limit, odblokowanie obrotem, kanibalizacja, zapis schematu 4 — **P1**, model: opus

**Files:**
- Modify: `src/sim/firm/types.ts`
  - `MAX_STORES = 5`, `BASE_STORE_LIMIT = 3`, `STORE_UNLOCK_TURNOVER`;
  - `FirmState` dostaje `research`, `storeLimit`, `goals` i `fame`;
  - `FirmEventKind` dostaje `'unlock' | 'research' | 'goal' | 'million'`;
  - `FirmRefusal` dostaje `'siec' | 'max' | 'goal'`.
- Create: `src/sim/firm/research.ts` (tu tylko `ResearchId`, `RESEARCH_IDS`; definicje w Task 4)
- Modify: `src/sim/firm/firm.ts` (`createFirm`, `refreshSites`, `siteOf` z własnymi lokalami, odblokowanie w `stepFirmMinute`)
- Modify: `src/sim/firm/commands.ts` (`rentRefusal`: `f.storeLimit` zamiast `MAX_STORES`)
- Modify: `src/sim/city/traffic.ts` (`OWN_RADIUS_M`, `OWN_FACTOR`, `ownNear`, parametr `own` w `siteFor` i `lotEstimate`)
- Modify: `src/game/firmSave.ts` (`FIRM_SAVE_SCHEMA = 4`, zapis i odczyt nowych pól, migracja 1–3)
- Modify: `src/ui/ranking/saveTransfer.ts` (`compactForTransfer`)
- Test: `src/sim/city/traffic.test.ts`, `src/sim/firm/firm.test.ts`, `src/sim/firm/commands.test.ts`, `src/game/firmSave.test.ts`, `src/ui/ranking/saveTransfer.test.ts`

**Interfaces:**
- Produces: `MAX_STORES = 5`, `BASE_STORE_LIMIT = 3`, `STORE_UNLOCK_TURNOVER: Readonly<Record<number, number>> = { 3: 1_000_000, 4: 1_600_000 }`
- Produces: `FirmState.research: Partial<Record<ResearchId, number>>`, `storeLimit: number`, `goals: { ready: string[]; claimed: string[] }`, `fame: { day: number; cash: number } | null`
- Produces: `OWN_RADIUS_M = 150`, `OWN_FACTOR = 0.9`, `ownNear(city: CityState, lotId: number, own: readonly number[]): { lotId: number; meters: number }[]`
- Produces: `siteFor(city, lotId, flags: SiteFlags, own?: readonly number[]): SiteMods`, `lotEstimate(seed, city, lotId, relet?, own?: readonly number[]): LotEstimate`
- Produces: `ownLotsOf(f: FirmState, exceptId?: number): number[]` (lokale otwartych sklepów rosnąco po `id`), `networkTurnover(reports: readonly MonthReport[]): number`
- Produces: `compactForTransfer(env: FirmSaveEnvelope): FirmSaveEnvelope` (spec §5.8 Ruling)
- Consumes: nic z innych tasków.

- [ ] **Step 1: Write failing tests**

```ts
// traffic.test.ts
it('ownNear: własne lokale bliżej niż 150 m, od najbliższego, bez siebie', …);
it('siteFor z own: traffic = bez own × 0.9^k (k własnych w promieniu), weekendTraffic tak samo; lokal startowy dalej NEUTRAL_SITE', …);
it('siteFor bez own ≡ dzisiejszy wynik co do bitu (Object.is na traffic)', …);
it('lotEstimate z own: trueDaily mniejsze niż bez own, gdy własny sklep jest w promieniu', …);
// firm.test.ts
it('createFirm: research {}, storeLimit 3, goals puste, fame null', …);
it('refreshSites przekazuje lokale innych otwartych sklepów: sklep niestartowy 100 m od innego własnego ma traffic × 0.9', …);
it('network-report z obrotem 1 000 000 podnosi storeLimit 3 → 4 i daje zdarzenie unlock {limit: 4, turnover}; 999 999 nie', …);
it('jeden miesiąc podnosi limit najwyżej o 1, a storeLimit nigdy nie przekracza 5', …);
// commands.test.ts
it('rentRefusal: limit przy open + builds ≥ storeLimit; przy storeLimit 4 czwarty lokal przechodzi, piąty nie', …);
// firmSave.test.ts
it('FIRM_SAVE_SCHEMA = 4; koperta niesie research, storeLimit, goals, fame', …);
it('każdy plik src/game/fixtures/*.json wczytuje się (ok) z research {}, storeLimit 3, goals puste, fame null', …);
it('save-v3-po-traszce.json: #2 zamknięty, #3 reopened bez zmian, storeLimit 3', …);
it('sanityzacja: research {dostawy: 99} → maxLevel; storeLimit 9 → 5; storeLimit 3 przy 4 sklepach w zapisie → 4; fame {day: "x"} → null', …);
it('research i storeLimit czytane przed refreshSites (site.net istnieje od razu po odczycie, Task 4 dopisze asercję net)', …);
it('isNewerSave({schema: 5}) true, {schema: 4} false', …);
// saveTransfer.test.ts
it('pięć otwartych sklepów (dwa po remoncie 3, jeden po 5), 24 miesiące prawdziwych kroków: paczka po compactForTransfer ≤ 65 536 B i wraca ok', …);
it('compactForTransfer: lastReport null poza aktywnym, history ≤ 12, inbox ≤ 10; zapis lokalny (firmEnvelopeOf) bez zmian', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/city/traffic.test.ts src/sim/firm src/game/firmSave.test.ts src/ui/ranking/saveTransfer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementacja**
  - `siteOf` przekazuje `ownLotsOf(f, id)`.
  - Kanibalizacja w `lotFactor`: druga pętla po własnych lokalach w promieniu. Ten sam wzór `dist2 < R²` co dla rywali.
  - Odblokowanie w kroku 6 `stepFirmMinute` (tam, gdzie powstaje `network-report`), tylko gdy `!f.ranked`.
  - `restoreEnvelope` czyta `research` i `storeLimit` przed `refreshSites`. `goals` czyta na razie jako tablice tekstów (≤ 20 wpisów); filtr id dokłada Task 5.
  - Gdy `storeLimit` jest mniejsze niż liczba otwartych sklepów plus budowy z koperty, podnieś go do tej liczby (≤ 5).
  - `compactForTransfer` wołaj w `saveTransfer.ts` przed zbudowaniem paczki.
  - Teksty UI odmowy `limit` dochodzą w Task 7.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim src/game src/ui/ranking tests/architecture.test.ts tests/districtBalance.test.ts`
Expected: PASS. `districtBalance` bez zmian, bo bez własnych sklepów w promieniu nic się nie zmienia.

- [ ] **Step 5: Commit** — `feat(firma): do pięciu sklepów z odblokowaniem obrotem sieci, kanibalizacja własnych sklepów i zapis schematu 4`

---

### Task 4: Badania Sieci — **P1**, model: sonnet

**Files:**
- Modify: `src/sim/firm/research.ts` (definicje, ceny, `netMods`)
- Modify: `src/sim/economy/site.ts` (`NetMods`, `SiteMods.net?`)
- Modify: `src/sim/economy/economy.ts` (6 haków, spec §5.3)
- Modify: `src/sim/firm/firm.ts` (`refreshSites` ustawia `site.net`), `src/sim/firm/commands.ts` (polecenie `research`)
- Modify: `src/game/firmSave.ts` (przycinanie poziomów do `maxLevel`)
- Modify: `src/i18n/en/ui/firm.ts` (nazwy, efekty i flavor badań)
- Test: `src/sim/firm/research.test.ts` (Create), `src/sim/economy/site.test.ts`, `src/sim/firm/commands.test.ts`

**Interfaces:**
- Consumes: `FirmState.research`, `RESEARCH_IDS` (Task 3)
- Produces: `interface NetMods { traffic: number; basket: number; wages: number; media: number; logistics: number; backroom: number }`
- Produces: `interface ResearchDef { id: ResearchId; name: string; effect: string; flavor: string; field: keyof NetMods; sign: 1 | -1; perLevel: number; cap: number; maxLevel: number; baseCost: number; costMult: number }`
- Produces: `RESEARCH: readonly ResearchDef[]`, `RESEARCH_BY_ID`
- Produces: `NET_SCALE = [0, 0, 1, 1.5, 1.8, 2] as const`, `netScale(open: number): number`
- Produces: `researchCost(def: ResearchDef, level: number): number`, `coordinationFee(cost: number): number`
- Produces: `netMods(research: FirmState['research'], open: number): NetMods | null`
- Produces: `researchRefusal(f: FirmState, id: ResearchId): FirmRefusal | null`
- Produces: `FirmCommand` + `{ type: 'research'; id: ResearchId }`, zdarzenie `{ kind: 'research', params: { id, level, price } }`

- [ ] **Step 1: Write failing tests**

```ts
it('RESEARCH: 6 wierszy dokładnie z tabeli §5.3 (id, pole, znak, perLevel, cap, maxLevel, baseCost, costMult)', …);
it('researchCost (powInt z exactMath): obsada 60 000, 120 000, 240 000, 480 000; lojalnosc poziom 4 = 1 042 600', …);
it('coordinationFee(120 000) = 24 000', …);
it('netScale: 0→0, 1→0, 2→1, 3→1.5, 4→1.8, 5→2, 7→2', …);
it('netMods: null przy open < 2 albo samych zerach; marketing 3 przy 3 sklepach → traffic 1 + 0.025 × 3 × 1.5; obsada 4 przy 5 sklepach → wages 0.75 (cap)', …);
it('research: odmowy ranked, siec (1 otwarty sklep), max, gotowka; sukces zdejmuje cenę z portfela, dodaje do monthInvest i podnosi poziom', …);
it('haki: z site.net {traffic 1.1} arrivalRate × 1.1; basket 1.05 → obrót i marża × 1.05; wages 0.9 → płace dnia × 0.9; media, logistics, backroom analogicznie', …);
it('neutralność: sklep z site bez net ma stan po 3 dniach identyczny (JSON) jak przed etapem dla tego samego site', …);
it('jeden sklep po badaniach gra jak bez Sieci: kupione badania, wypowiedzenie #2, po zamknięciu #2 sklep #1 bez site i krok bitowo równy createEconomy bez firmy', …);
it('odczyt zapisu: research z koperty daje site.net od pierwszej minuty', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/firm/research.test.ts src/sim/economy/site.test.ts src/sim/firm/commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementacja**
  - Haki w `economy.ts` stoją za `const net = info.site?.net` / `fx.net`:
    - `effects()`: `traffic`, `backroomCap`, `fx.net = net`;
    - `sell()`: `basket` (obrót i marża, obok `fx.site.basket`);
    - `closeDay`: `wages`, `media`;
    - `placeOrder`: `logistics`.
  - Polecenie `research` płaci tylko gotówką.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim src/game tests/simGolden.test.ts tests/districtBalance.test.ts tests/i18n.test.ts`
Expected: PASS. `GOLDEN[7]` bez zmian, bo jeden sklep nie ma `net`.

- [ ] **Step 5: Commit** — `feat(siec): badania Sieci na poziomie firmy przez SiteMods.net`

---

### Task 5: Cele firmy i próg miliona — **P1**, model: sonnet

**Files:**
- Create: `src/sim/firm/goals.ts`
- Modify: `src/sim/firm/firm.ts` (`checkFirmGoals` i `checkFame` na końcu `stepFirmMinute`, przed `syncWallet`), `src/sim/firm/commands.ts` (`claimGoal`)
- Modify: `src/game/firmSave.ts` (filtr id celów)
- Modify: `src/i18n/en/ui/firm.ts` (nazwy celów firmy)
- Test: `src/sim/firm/goals.test.ts` (Create), `src/game/firmSave.test.ts`

**Interfaces:**
- Consumes: `FirmState.goals`, `FirmState.fame`, `FirmState.research` (Task 3), `RESEARCH` (Task 4)
- Produces: `interface FirmGoal { id: string; label: string; hint: string; reward: number; done(f: FirmState): boolean }`
- Produces: `FIRM_GOALS: readonly FirmGoal[]` (10 wierszy §5.6), `FAME_CASH = 1_000_000`
- Produces: `checkFirmGoals(f: FirmState, out: FirmStepOut): void`, `checkFame(f: FirmState, out: FirmStepOut): void`
- Produces: `FirmCommand` + `{ type: 'claimGoal'; id: string }`
- Produces: zdarzenia `{ kind: 'goal', params: { id } }` i `{ kind: 'million', params: { day, cash } }`

- [ ] **Step 1: Write failing tests**

```ts
it('FIRM_GOALS: 10 id, nagrody i progi z tabeli §5.6', …);
it('wallet 250 000 → cash250k w ready i jedno zdarzenie goal; drugi krok nie dubluje', …);
it('claimGoal: +30 Ogonków do person.ogonki, id z ready do claimed; drugi raz odmowa goal; nieznany id odmowa goal', …);
it('checkFame: wallet 999 999 nic; 1 000 000 → fame {day: dayOf(minute), cash: 1 000 000} i jedno million; spadek i powrót nie daje drugiego', …);
it('ranked bez Sieci, celów firmy i Galerii: firma ranked z wallet 2 mln po 10 krokach ma goals puste, fame null; research i claimGoal → ranked', …);
it('schemat 3 po Traszce z milionem: save-v3-po-traszce z person.wallet 1 200 000 → po 1 kroku jedno million, ready ⊇ [cash250k, cash500k, cash1m], claimed []', …);
it('odczyt: goals.ready z nieznanym id i duplikatem → przefiltrowane, bez duplikatów', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/firm/goals.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementacja**
  - Oba sprawdzenia tylko przy `!f.ranked && f.over === null`.
  - `claimGoal` dopisuje Ogonki do `person.ogonki`, a potem woła `syncWallet`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/firm src/game tests/architecture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(firma): cele sieci i próg pierwszego miliona`

---

### Task 6: Galeria sław — serwer — **P1**, model: sonnet

**Files:**
- Create: `src/server/fame.ts`, `api/fame/list.ts`, `api/fame/submit.ts`
- Modify: `src/server/keys.ts` (`KEYS.fameList = 'tr:fame:list'`, `KEYS.fameEntry(nickKey) = 'tr:fame:e:{nickKey}'`, opis w komentarzu)
- Modify: `src/server/config.ts`
  - `RateAction` dostaje `'fame'`, `RATE_LIMITS.fame = { window: 3600, perKey: 5, perAddress: 20 }`;
  - `FAME_DAILY_BUDGET = 300`;
  - `FAME_DAY = [90, 36_500]`, `FAME_CASH = [1_000_000, 1e12]`, `FAME_SIM = [7, 999]`;
  - `FAME_LIST_MAX = 100`.
- Modify: `src/server/errors.ts` (`'fame-invalid'` 422 „Centrala nie wierzy w ten milion. Wpis nie przeszedł kontroli.”, `'fame-budget'` 429 „Galeria sław jest na dziś pełna. Wpisz się jutro.”)
- Modify: `src/server/http.ts` (`handleFameList`, `handleFameSubmit`)
- Modify: `src/server/memoryRedis.ts` (`ZRANGE` z `WITHSCORES`), `src/i18n/en/api.ts`
- Modify: `scripts/check-vercel-build.mjs` (dwie funkcje w liście i w opisie: „siedem funkcji”)
- Test: `src/server/fame.test.ts` (Create), `src/server/memoryRedis.test.ts`, `src/server/api.test.ts`, `src/server/runtimeImports.test.ts` (nowe pliki `api/` z importami `.js`)

**Interfaces:**
- Produces: `interface FameEntry { nick: string; seed: string; day: number; cash: number; simVersion: number; at: number }`
- Produces: `parseFameSubmission(body: unknown): Checked<{ key: string; nick: string; nickKey: string; seed: string; day: number; cash: number; simVersion: number }>`
- Produces: `recordFame(redis: RedisExec, nickKey: string, e: FameEntry): Promise<{ first: boolean; entry: FameEntry }>`
- Produces: `readFame(redis: RedisExec): Promise<{ total: number; rows: { place: number; nick: string; at: number }[] }>`
- Produces: `POST /api/fame/submit` → `{ ok: true, first, entry: { nick, at } }`; `GET /api/fame/list` → `{ ok: true, total, rows }`

- [ ] **Step 1: Write failing tests**

```ts
it('MemoryRedis ZRANGE 0 1 WITHSCORES: rosnąco po wyniku, remis po członku', …);
it('submit: pierwszy wpis → 200 {first: true, entry.at = now}; ZSCORE tr:fame:list = at', …);
it('drugi wpis tego nicka (inny klucz, inna kwota) → {first: false, entry.at = pierwszy at}; wpis bez zmian', …);
it('list: trzy wpisy w kolejności at rosnąco, place 1..3, bez seed i cash w wierszu; inny parametr zapytania → 400', …);
it('wiarygodność: day 89, 36 501, 1.5; cash 999 999, NaN, 1e13; simVersion 6, 7.5; seed "" i 49 znaków → fame-invalid 422', …);
it('nick zarezerwowany przez innego właściciela → nick-taken 409; własny i wolny przechodzą; wolny NIE jest rezerwowany (tr:nick: bez wpisu)', …);
it('limit: szósty POST tego klucza w godzinie → 429 z retry-after; budżet 301. wpis w dobie → fame-budget', …);
it('wyłączony ranking (route bez env) → 503 not-configured dla obu ścieżek', …);
it('klucze galerii mają prefiks tr:fame: i nie zawierają SIM_VERSION', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/fame.test.ts src/server/memoryRedis.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementacja**
  - Handlery według spec §5.7. Kolejność sprawdzeń jak w `handleRuns`: limit przed nickiem.
  - `recordFame` robi `SET … NX`. Przy porażce czyta istniejący wpis i ponawia `ZADD NX` z jego `at`.
  - `api/*.ts` jak `api/save/upload.ts`: `export const POST = route(handleFameSubmit)` i `export const GET = route(handleFameList)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npx vitest run src/server tests/checkVercelBuild.test.ts tests/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(galeria): endpointy Galerii sław za bramką rankingu`

---

### Task 7: UI firmy: badania, cele sieci, limit sklepów, karta lokalu — **P1**, model: sonnet

**Files:**
- Create: `src/ui/city/ResearchSection.tsx`
- Modify: `src/ui/city/CityPanel.tsx` (sekcja badań), `src/ui/city/cityModel.ts` (`own` do `lotEstimate`, `ownNear` na karcie), `src/ui/city/LotCard.tsx`
- Modify: `src/ui/city/firmText.ts`
  - teksty zdarzeń `unlock`, `research`, `goal`, `million`;
  - odmowy `siec`, `max`, `goal`;
  - `limitText(f)`.
- Modify: `src/ui/game/panels.tsx` (`ShopPanel`: podpowiedź o badaniach przy ≥ 2 sklepach; `GoalsPanel`: sekcja „Sieć”)
- Modify: `src/i18n/en/ui/firm.ts`, `src/i18n/en/ui/city.ts`, `src/i18n/en/ui/game.ts`
- Test: `src/ui/city/ResearchSection.test.tsx` (Create), `src/ui/city/firmText.test.ts`, `src/ui/city/CityPanel.test.tsx`, `src/ui/game/panels.test.tsx`

**Interfaces:**
- Consumes: `RESEARCH`, `researchCost`, `coordinationFee`, `netMods`, `researchRefusal` (Task 4); `FIRM_GOALS` (Task 5); `ownNear`, `STORE_UNLOCK_TURNOVER` (Task 3); `game.firm(cmd)` (`src/ui/state.ts`)
- Produces: `limitText(f: FirmState): string`
  - przy `storeLimit < 5`: „Centrala zgodzi się na kolejną placówkę, gdy obrót sieci w miesiącu przekroczy {próg}.”;
  - przy 5: „Pięć placówek to wszystko, na co Centrala jest gotowa się zgodzić w tym mieście.”
- Produces: `researchRow(f: FirmState, id: ResearchId): { level: number; max: number; price: number | null; fee: number | null; effectNow: string; blocked: FirmRefusal | null }`

- [ ] **Step 1: Write failing tests**

```ts
it('ResearchSection przy jednym sklepie: 6 wierszy z „Działa od 2 sklepów”, przyciski wyłączone', …);
it('przy 3 sklepach: wiersz obsada pokazuje „60 000 zł”, „w tym opłata koordynacyjna Centrali: 12 000 zł” i efekt „płace −4,5%”; klik woła game.firm({type: "research", id: "obsada"})', …);
it('poziom max: ✓ i „4/4”, bez przycisku', …);
it('limitText: storeLimit 3 → próg „1 000 000 zł”; 4 → „1 600 000 zł”; 5 → tekst o pięciu placówkach', …);
it('firmEventText: unlock {limit: 4, turnover: 1 012 345} ma „czwartą placówkę” i kwotę; million ma „Milion”', …);
it('LotCard: własny sklep 120 m → „Twoja Traszka 120 m stąd: −10% ruchu”', …);
it('GoalsPanel: sekcja „Sieć” z gotowym celem i przyciskiem „Odbierz”, który woła game.firm({type: "claimGoal", id})', …);
it('GoalsPanel w biegu rankingowym nie pokazuje sekcji „Sieć”', …);
it('EN: każdy nowy tekst ma tłumaczenie (i18n.test przechodzi)', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/city src/ui/game/panels.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementacja**
  - Wygląd sekcji jak w `ShopPanel` (`tt-item`, `Section`, `buyNotes`). Badania nie mają rat, więc jest tylko przycisk gotówki.
  - Efekt przy obecnej liczbie sklepów liczy `netMods` dla poziomu+1 wobec obecnego. Format „ruch +3,8%”.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui tests/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(ui): badania Sieci, cele sieci, limit placówek i kanibalizacja na karcie lokalu`

---

### Task 8: UI Galerii sław: gratulacje, lista, klient — **P1**, model: sonnet

**Files:**
- Modify: `src/ui/ranking/client.ts` (`fameList`, `fameSubmit`)
- Create: `src/ui/ranking/FameWindow.tsx`, `src/ui/ranking/fameModel.ts`
- Modify: `src/ui/ranking/RankingPanel.tsx` (zakładka „Galeria sław”), `src/ui/ranking/PanelHost.tsx` (montuje `FameWindow`)
- Modify: `src/ui/state.ts` (`fameOffer: Signal<{ seed: string; day: number; cash: number } | null>`)
- Modify: `src/game/actions.ts` (zdarzenie `million` ustawia `fameOffer`), `src/game/meta.ts` (`fameSent?: string[]`, sanityzacja: teksty, ≤ 50, bez duplikatów)
- Modify: `src/i18n/en/ui/ranking.ts`
- Test: `src/ui/ranking/FameWindow.test.tsx` (Create), `src/ui/ranking/client.test.ts`, `src/ui/ranking/RankingPanel.test.tsx`, `src/game/meta.test.ts`

**Interfaces:**
- Consumes: zdarzenie `million` (Task 5), API z Task 6
- Produces: `RankingClient.fameList(): Promise<ApiResult<{ total: number; rows: { place: number; nick: string; at: number }[] }>>`
- Produces: `RankingClient.fameSubmit(key: string, e: { nick: string; seed: string; day: number; cash: number; simVersion: number }): Promise<ApiResult<{ first: boolean; entry: { nick: string; at: number } }>>`
- Produces: `createFameModel(deps: { client: RankingClient; meta: () => Meta; saveMeta: (m: Meta) => void }): FameModel` z `submit(offer)`, `load()`, `pending(seed, firmFame)` i sygnałem `state: 'idle' | 'sending' | 'sent' | 'error'`

- [ ] **Step 1: Write failing tests**

```ts
it('client.fameSubmit wysyła POST /api/fame/submit z {key, nick, seed, day, cash, simVersion: SIM_VERSION}', …);
it('client.fameList: GET /api/fame/list; błąd sieci → {ok: false, message: NETWORK_ERROR}', …);
it('FameWindow: tekst „Milion!”, nick z mety, przycisk „Wpisz mnie do Galerii sław”; sukces → „Jesteś w Galerii sław Traszki (miejsce N)” i seed w meta.fameSent', …);
it('FameWindow: nick-taken → komunikat o zajętym nicku; błąd sieci → „Galeria jest teraz nieczynna. Wpis wyślesz później z panelu rankingu.”', …);
it('RankingPanel zakładka „Galeria sław”: wiersze „1. Nick — 2 listopada 2026” rosnąco po at', …);
it('lista przy błędzie sieci: „Galeria jest teraz nieczynna” i bez wyjątku; przycisk „Wyślij mój wpis” widoczny przy firm.fame i seed spoza fameSent', …);
it('meta.fameSent: sanityzacja zostawia teksty, ucina do 50, usuwa duplikaty; stara meta bez pola działa', …);
it('bieg rankingowy nie otwiera FameWindow (brak million)', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/ranking src/game/meta.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementacja**
  - Data w liście z `at`: `toLocaleDateString` w języku gry, czyli przez istniejący pomocnik dat UI rankingu.
  - `simVersion` z `@/sim/simVersion`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui src/game tests/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(galeria): gratulacje za milion i lista Galerii sław w panelu rankingu`

---

### Task 9: Render remontów 4–5 i maszyn — **P1**, model: sonnet

**Files:**
- Modify: `src/render/street/buildings.ts` (komentarze o kartce „do poziomu 4”; logika `remontLevel < REMONTS.length` zostaje)
- Modify: `src/render/robots/robotsView.ts` (`Math.min(level, 3) as MachineLevel` w `stand` dla taśmociągu i wykładacza)
- Modify: `src/render/cameraRig.ts` tylko jeśli test kadru padnie (granice z wymiarów układu)
- Test: `src/render/street/przejecie.test.ts`, `src/render/robots/robotsView.test.ts` (Create albo Modify), `src/render/street/buildStreet.test.ts`

**Interfaces:**
- Consumes: `REMONTS` z 5 poziomami, `layoutFor(seed, 4|5, lot)` (Task 1)

- [ ] **Step 1: Write failing tests**

```ts
it('poziomy 1–5: sąsiad po stronie przejęcia ma szerokość max(w0 − Δ, 4) i przylega; drugi z poziomu 0', …);   // rozszerzenie istniejącego testu 1–3
it('kartka DO WYNAJĘCIA jest na poziomach 0–4, nie ma jej na 5', …);   // zamiast „0–2, nie na 3”
it('buildStreet dla layoutFor(seed, 5) na 20 seedach (wszystkie rodzaje lokalu) bez wyjątku, bryła nad sklepem obejmuje sklep', …);
it('robotsView.sync z tasmociag 5 i wykladacz 5: createConveyor/createRestocker dostają poziom 3, bez wyjątku', …);
it('kamera: granice widoku zawierają cały obrys sklepu L5 największego pawilonu (26 + 16 kratek)', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/street src/render/robots src/render/cameraRig.test.ts`
Expected: FAIL (kartka na poziomie 3 i 4, poziom maszyny 5).

- [ ] **Step 3: Implementacja:** przycięcie poziomu maszyn. Popraw `cameraRig` tylko wtedy, gdy test kadru pada.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(render): ulica i maszyny po remontach 4–5`

---

### Task 10: Balans na botach, smoke, bramki i raport — **P1** (ostatnie P1), model: opus

**Files:**
- Create: `tests/measure/progresja.measure.test.ts` (strategie `jeden`, `trzy` i `siec` ze spec §5.10; bramki B1–B4 jako asercje)
- Create: `tests/progresjaBalance.test.ts` (szybka bramka w `npm test`, 2 seedy × 13 miesięcy `siec`: portfel w m. 13 ≥ 700 000 na obu seedach, zero końców gry)
- Modify (tylko gałki §5.10, w tej kolejności): `src/sim/firm/research.ts` (`perLevel`, `NET_SCALE`), `src/sim/city/traffic.ts` (`OWN_FACTOR`), `src/sim/firm/types.ts` (`STORE_UNLOCK_TURNOVER`), `src/sim/economy/upgrades.ts` (koszt remontów 4–5)
- Modify: `scripts/city-smoke.mjs`, `scripts/city-smoke.d.mts`, `tests/citySmoke.test.ts`
- Modify: `README.md` (do pięciu sklepów, badania Sieci, Galeria sław)
- Create: `docs/superpowers/reports/2026-11-02-progresja-4b.md` (+ zrzuty w `docs/superpowers/reports/2026-11-02-progresja-4b/`)

- [ ] **Step 1: Wartości bazowe.** Zmierz `mistrz`, `bierny` i `mistrzZakupy` (= `jeden`) w `tests/measure/miasto.measure.test.ts` na commicie bazowym etapu (rodzic pierwszego commitu Task 1), w osobnym `git worktree add` w scratchpadzie:
  - gotówka w m. 12;
  - średni wynik m. 13–24.

  Wpisz liczby do raportu i jako stałe `BASELINE_*` w `progresja.measure.test.ts`.

- [ ] **Step 2: Pomiar.** Uruchom `MONTHS=24 npx vitest run tests/measure/progresja.measure.test.ts --silent=false` i zapisz tabelę:
  - strategia;
  - gotówka w m. 12 i m. 24;
  - miesiąc pierwszego 1 mln i 2 mln;
  - liczba sklepów i miesiąc odblokowania 4. i 5.;
  - suma niekupionego przy 2 mln.

- [ ] **Step 3: Strojenie.** Gdy B1 albo B2 pada, zmieniaj gałki po kolei w granicach §5.10 i po każdej zmianie powtórz Step 2. B3, B4 i B5 nie mogą przy tym spaść. Każdą zmianę wpisz do raportu jako „było → jest, dlaczego”. Gdy żadna kombinacja gałek w granicach nie da B1, zostaw najlepszą, opisz w raporcie lukę i nie zmieniaj liczb 4a.1.

- [ ] **Step 4: Szybka bramka.** Ustaw próg w `tests/progresjaBalance.test.ts` na 90% najgorszego z dwóch seedów z ostatniego pomiaru (nie niżej niż 600 000). Uruchom `npx vitest run tests/progresjaBalance.test.ts`. Expected: PASS.

- [ ] **Step 5: Smoke.** W `scripts/city-smoke.mjs` dopisz kroki 4b na kopii fixture'a `save-v3-dwa-sklepy.json` (koperta modyfikowana w skrypcie, przed `addInitScript`), na telefonie 390×844 i komputerze 1440×900:
  - **a.** Sklep #1 z `remontLevel` 5 i `level` 34: ulica bez błędów w konsoli, zrzut `*-4b-01-remont5.jpg`.
  - **b.** Panel Miasto przy dwóch sklepach: sekcja „Sieć: badania” z sześcioma wierszami i opłatą koordynacyjną. Kup `dostawy`: portfel spada o 25 000. Zrzut `*-4b-02-badania.jpg`.
  - **c.** `storeLimit` 4 i portfel 400 000: wynajem 3. i 4. lokalu za gotówkę. Przewinięcie do otwarcia, lista chipa ma 4 sklepy. Zrzut `*-4b-03-cztery-sklepy.jpg`.
  - **d.** Portfel 999 500 i gra do przekroczenia miliona: okno „Milion!”. Przycisk wysyłki przy abortowanym `/api/**` pokazuje „Galeria jest teraz nieczynna…”, a gra idzie dalej. Zakładka „Galeria sław” w panelu rankingu pokazuje ten sam komunikat i „Wyślij mój wpis”. Zrzuty `*-4b-04-milion.jpg` i `*-4b-05-galeria.jpg`.
  - **e.** Wersja angielska kroku b. Zrzut `*-4b-06-angielski-badania.jpg`.

  Run: `PLAYWRIGHT_ROOT=/Users/mpawelczuk/Dev/ochronairz-rotator/node_modules/playwright-core npm run city:smoke`. Expected: wszystkie kroki OK, a w logu sieci żadnego żądania, które doszło do `/api/`.

- [ ] **Step 6: Bramki.**
  1. `npm run build`. Expected: OK.
  2. `npm test`. Expected: wszystkie pliki przechodzą, w tym `simGolden`, `i18n`, `architecture`, `judgeBundle`, `districtBalance`, `citySmoke`, `firmSave` i `progresjaBalance`.
  3. Jeśli uruchamiasz `scripts/tutorial-smoke.mjs`, potem `git checkout -- docs/superpowers/reports/2026-10-30-samouczek && git clean -fd docs/superpowers/reports/2026-10-30-samouczek`.

- [ ] **Step 7: Raport** `docs/superpowers/reports/2026-11-02-progresja-4b.md`:
  - wersje: SIM 7 (wpis `GOLDEN[7]`), `FIRM_SAVE_SCHEMA` 4, generatory bez zmian;
  - tabela pomiaru i wartości bazowe;
  - B1–B5: spełnione czy nie;
  - gałki „było → jest”;
  - rozmiar paczki przy 5 sklepach;
  - smoke krok po kroku ze zrzutami;
  - liczby `npm test`;
  - otwarte pytania do właściciela, bez pytań blokujących.

- [ ] **Step 8: Commit** — `test(balans): progresja 4b na botach, smoke i raport`

---

### Task 11: Tłum przed sklepem przy zrzucie kart — **P2 (do wycięcia)**, model: sonnet

**Files:**
- Modify: `src/render/crowdView.ts` (kolejka przed wejściem)
- Modify: `src/game/scene.ts` (przekazanie stanu karty)
- Test: `src/render/crowdView.test.ts`
- Stan symulacji bez zmian: render czyta tylko `cardModifiers(s.tycoon.cards, s.minute).traffic`, więc `GOLDEN` się nie rusza.

**Interfaces:**
- Consumes: `cardModifiers` (istniejące), karta `karty-zrzut` (Task 2)
- Produces: `queueOutside(layout: StoreLayout, count: number): Cell[]` (kratki chodnika przed `layout.entrance`, poza `palletZoneOutside`)

- [ ] **Step 1: Write failing tests**

```ts
it('queueOutside(layout, 8): 8 różnych kratek y ≤ FRONT_WALL_Y, poza strefą palet, najbliżej wejścia', …);
it('crowdView: gdy traffic z kart ≥ 1.8 między 6:00 a 12:00 → 6–12 postaci w kolejce; poza tym 0', …);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/crowdView.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implementacja:** postacie z istniejącej puli tłumu. Liczba to `min(12, 6 + floor((traffic − 1.8) × 10))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/render tests/simGolden.test.ts`. Expected: PASS, `GOLDEN` bez zmian.

- [ ] **Step 5: Smoke i commit.**
  - W `city-smoke.mjs` dodaj krok f: zrzut tłumu z wymuszoną kartą przez kopertę zapisu z aktywnym modyfikatorem. Uruchom `npm run build && npm test`.
  - Commit: `feat(render): kolejka przed sklepem przy zrzucie Traszkomonów`.

---

## Self-review (wykonany)

- **Pokrycie specu:**
  - §5.1 i §5.2: Task 1 i Task 9;
  - §5.3: Task 4 i Task 7;
  - §5.4: Task 3 i Task 7;
  - §5.5: Task 2;
  - §5.6: Task 1 (cele sklepu) i Task 5 (cele firmy);
  - §5.7: Task 5 (wyzwalacz), Task 6 (serwer) i Task 8 (UI);
  - §5.8: Task 3;
  - §5.9: Task 7, Task 8 i Task 9;
  - §5.10: Task 10;
  - §6: Task 11. Reszta P2 (karty, słowniczek) zostaje poza planem.
- **Typy:**
  - `ResearchId` powstaje w Task 3, a definicje w Task 4;
  - `FirmRefusal` `'siec' | 'max' | 'goal'` i `FirmEventKind` `'unlock' | 'research' | 'goal' | 'million'` powstają w Task 3, używają ich Taski 4, 5, 7 i 8;
  - `siteFor(…, own?)` i `lotEstimate(…, own?)` powstają w Task 3, używa ich Task 7.
- **Zależności:**
  - Taski 1, 2 i 6 są niezależne;
  - Task 3 → 4 → 5 → 7 i 8;
  - Task 1 → 9;
  - wszystkie → 10.

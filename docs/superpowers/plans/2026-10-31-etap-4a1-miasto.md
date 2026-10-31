# Etap 4a.1: miasto i drugi sklep — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** gracz ma mapę miasta w widoku warstw. Po dwóch dobrych miesiącach dostaje status Partnera Strategicznego, bierze jeden lokal z pakietem otwarcia i prowadzi dwa sklepy z jednej gotówki, z osobnym wyciągiem każdego sklepu.

**Architektura:** wszystko, co liczy, siedzi w czystym `src/sim`.
- `src/sim/city`: generator miasta, ruch, dzielnice i widełki.
- `src/sim/economy/site.ts`: dzielnica i flagi dodatkowego sklepu wchodzą do ekonomii przez opcjonalne pole `StoreInfo.site`. Pole nie trafia do `EconomyState`, a brak pola to dzisiejsza gra co do bitu.
- `src/sim/firm`: firma nad listą sklepów.
  - Gotówka i Ogonki należą do osoby (`person`). Firma wpisuje je do `econ` przed krokiem i poleceniem sklepu, a po nich odbiera.
  - `session.econ`, `session.info` i `session.layout` wskazują zawsze aktywny sklep, więc dzisiejszy render i UI działają bez zmian.
  - Bieg rankingowy też ma firmę (`ranked: true`, jeden sklep, bez statusu). Sędzia (`run.ts`, `ranked.ts`) nie importuje ani miasta, ani firmy.
- Ekran Miasta to płaska scena three.js (widok warstw) w tym samym kontekście renderera co sklep, z pinezkami w nakładce HTML.

**Technologie:** TypeScript, Vitest 5, three.js 0.186, Preact + @preact/signals, Vite 8, headless Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-10-31-etap-4a-miasto-design.md` (zatwierdzony 2026-10-31, odpowiedzi 1a, 2a, 3a, 4a). Plan obejmuje część 4a.1: §5, §6, §20 „4a.1”, kolejność z §23. Numery „§” niżej odnoszą się do tego specu.

**Podstawa:** stary plan `git show 5dd6f3a:docs/superpowers/plans/2026-10-29-etap-4a-miasto.md` (sekcja niżej mówi, co z niego zostało).

**Poza zakresem:**
- 4a.2: makieta 3D z autami i presetami, trzeci sklep, profile godzin, karty dzielnic, ponowny wynajem „po Traszce”;
- rogalik: przejęcie w sztafecie, cel 1 mln zł w trybach.

## Global Constraints
- `SIM_VERSION` zostaje 6, `GOLDEN` i `tests/simGolden.test.ts` bez zmian, `GENERATOR_VERSION` zostaje 1. Gracz bez ekspansji i bieg rankingowy grają bit w bit jak dziś.
- Kształt `EconomyState` się nie zmienia: żadnych nowych pól, także opcjonalnych i w obiektach zagnieżdżonych (`MonthReport`, `TycoonMonthReport`, `CardsState`).
- Dotychczasowe wywołania `freshRun`, `replayRun`, `createEconomy(seed, info)`, `layoutFor(seed, level)` i `applyCommand` dają ten sam wynik co do bitu.
- „Brak pola to dzisiejsza gra co do bitu. Modyfikator pomija się gałęzią, a nie mnoży przez 1.” Sklep z jawną neutralną dzielnicą daje ten sam skrót co sklep bez pola.
- „Tryb rankingowy zostaje na jednym sklepie, bez ekspansji”: mapę widać, statusu nie ma, wynajem jest odrzucany.
- Sędzia nie dostaje miasta ani firmy:
  - `src/sim/run.ts`, `src/sim/ranked.ts` i `scripts/judge-entry.ts` nie sięgają, także przechodnio, do `src/sim/city` ani `src/sim/firm`;
  - nie ruszamy `src/server/**`, `src/sim/ranked.ts`, `src/game/rankedRun.ts`, zapisu `traszka:ranked` ani `SAVE_SCHEMA` 2.
- Determinizm i czystość `src/sim`:
  - bez three.js, `Math.random` i `Date` (pilnuje `tests/architecture.test.ts`);
  - miasto z `createRng(subSeed(seed, 'city'))` i `CITY_GENERATOR_VERSION` 1, a sklep w lokalu ma seed `subSeed(seed, 'store:' + lotId)`;
  - sklepy liczą się w kolejności `id`;
  - ten sam seed i ten sam dziennik poleceń dają ten sam stan miasta i wszystkich sklepów.
- Polecenia firmy (przełączenie, wynajem, wypowiedzenie) to osobny typ `FirmCommand`. `Command`, `COMMAND_TYPES` i `AFTER` się nie zmieniają, a pola poleceń zostają płaskie.
- Tłumaczenie:
  - każdy nowy tekst UI i w scenie ma wersję angielską (`t`/`tr`, `EN_UI`, `EN_RENDER`, `EN_PLURALS`);
  - `tests/i18n.test.ts` przechodzi bez nowych pozycji w `SKIP` poza nazwami własnymi (nazwa miasta, ulice z polskich członów, Szop 24h, Kawka Express), każda z powodem;
  - zdarzenia i odmowy firmy to identyfikator i parametry, a tekst składa UI (adres też: „ul. Lipowa 3” i „3 Lipowa St.”);
  - teksty Centrali z §10 bez skracania, angielski w tonie `docs/i18n/glossary-en.md`.
- Zapis zwykłej gry to koperta `FIRM_SAVE_SCHEMA = 3` pod `traszka:save:<seed>`:
  - schemat 1 i 2 (każda wersja SIM, fixtures w `src/game/fixtures/`) wczytuje się bez straty jako firma z jednym sklepem;
  - miasta nie zapisujemy, bo to czysta funkcja seeda (§7.4);
  - paczka „Wyślij zapis” w najgorszym przypadku 4a.1 ma ≤ 64 KB (`SAVE_MAX_BYTES`).
  - Po wdrożeniu zadania 9 nie wolno cofać produkcji przed ten commit (uwaga do opisu PR).
- Liczby z projektu:
  - najwyżej 2 sklepy, wliczając budowę;
  - pakiet otwarcia ok. 35–85 tys. zł, na raty 12 rat z opłatą 15% z przelewów nowego sklepu, rata w limicie 8750 zł;
  - budowa 5–8 dni;
  - status: dwa ostatnie zamknięte miesiące z `history.profit > 0` w sklepie startowym i zaufanie ≥ 75 przy zamknięciu miesiąca;
  - debet −100 tys. zł i ostrzeżenie od −50 tys. zł dotyczą całej gotówki.
- Telefon 390 px bez poziomego przewijania. Nowe okna mają dymki „pierwszy raz” z §17.
- Smoke w headless Playwright, bez panelu: każdy kontekst z `locale: 'pl-PL'`, rozmiary 390×844 (dotyk) i 1280×800.
- Gdyby któreś ograniczenie okazało się niemożliwe do spełnienia, wykonawca staje i pyta koordynatora. `SIM_VERSION` nie podbija sam.
- Bramki: `npm run build` przed `npm test` (inaczej stary `src/server/judgeBundle.js` daje fałszywe 503 w `api.test.ts`), potem `npm run check:vercel-build`. Commity w stylu repo (`feat(miasto): …`).

## Review Focus
1. **Koniec sklepu albo gry wywołany nie przez aktywny sklep.**
   - Zaufanie 0 albo koniec wypowiedzenia w aktywnym sklepie, gdy drugi działa: gra przełącza się na drugi sklep i nie pokazuje ekranu końca gry.
   - Debet wywołany przez sklep w tle kończy grę widocznie na aktywnym (`session.econ.gameOver`).

   Testy: Zadania 4, 6 i 10.
2. **Przełączenie w złym momencie.** Przy karcie aktywnego sklepu, w pauzie i przy otwartym oknie miesiąca gra nie staje na zawsze.
   - Porzuconą kartę rozstrzyga w następnej minucie zastępca, z wpisem w skrzynce.
   - Karta, która pokazuje się w tle w minucie przełączenia, czeka na gracza.

   Testy: Zadania 4 i 10.
3. **Sklep #2 po remoncie i po przeładowaniu strony.**
   - Układ powstaje z lokalu miasta, a `site` wraca do nowego `StoreInfo`.
   - Ulica ma szerokość z lokalu miasta, a nie z `pickLot(seed sklepu)`.
   - Budowa otwiera się w dniu z zapisu, a aktywny sklep wraca.

   Testy: Zadania 3, 9 i 10.
4. **Pieniądze spoza poleceń i granice wydatków.**
   - Premia dzienna, zarobek offline i nagroda za poziom w tle wpadają do gotówki raz.
   - Pakiet za gotówkę przy gotówce równej cenie zostawia 0 zł.
   - Drugi wynajem w trakcie budowy dostaje tekst limitu.
   - Raty w sklepie w okresie wypowiedzenia są odrzucane.

   Testy: Zadania 4, 5, 6 i 10.
5. **Stary zapis schematu 2 po dwóch remontach, z premią partnera.** Wczytuje się jako firma z jednym sklepem bez straty, premia sieci działa jak dziś, a pierwszy zapis ma schemat 3. Test: Zadanie 9.

## Co przejęte ze starego planu (29.10), co zmienione, co wycięte

| Stare | Co | Los | Gdzie teraz i co inaczej |
|---|---|---|---|
| 1 | Typy miasta, dzielnice, generator | przejęte, zmienione | Zad. 1:<br>• bez `rent`/`fitout`, za to `package` z widełek dzielnicy (pakiet otwarcia, §10.3);<br>• adres jako ulica i numer (tłumaczenie);<br>• lokal obok przez `takeoverSide` (§7.2);<br>• bez `hourCurve` i `difficultCards` (4a.2) |
| 2 | Ruch, mnożnik lokalu, widełki | przejęte | Zad. 2:<br>• skala widełek z SIM 6 (ok. 300–350 klientów, nie 400–700);<br>• bez profilu godzinowego na karcie (4a.2);<br>• `siteFor` dostaje flagi |
| 3 | Dzielnica w ekonomii, test neutralności | przejęte, zmienione | Zad. 3:<br>• `expectations` rozbite na `patience` i `repPenalty` (§8.1);<br>• kradzieże także na SCO;<br>• doszły flagi `extra`, `ownCosts`, `firmDebt` (§11.2, §11.4) |
| 4 | Karty dzielnic | wycięte | 4a.2 |
| 5 | Czynsz w wyniku miesiąca | wycięte, zastąpione | SIM 6 nie ma czynszu. Zamiast niego:<br>• pakiet otwarcia za gotówkę albo na raty (Zad. 5);<br>• brak gwarancji i ZUS raz (Zad. 3–4);<br>• osobny wyciąg na sklep (Zad. 13) |
| 6 | Firma, portfel, sklep w tle, koniec gry | przejęte, zmienione | Zad. 4:<br>• warstwa `person` (rogalik);<br>• debet przez flagę `firmDebt` zamiast kontroli w sklepie;<br>• zdarzenia jako identyfikatory (tłumaczenie);<br>• `MAX_STORES` 2;<br>• rozliczenie końcowe przeniesione do Zad. 6 |
| 7 | Status, wynajem, budowa, otwarcie, przełączanie | przejęte, zmienione | Zad. 5:<br>• zapłata gotówką albo ratami;<br>• odmowy jako `FirmRefusal`, a teksty `CENTRALA` w UI;<br>• limit 2;<br>• nowy sklep bez gwarancji, z wiedzą o limicie ubytków |
| 8 | Dziennik firmy i odtworzenie | przejęte | Zad. 7, bez zmian w zasadzie; wpisy niosą też wypowiedzenie |
| 9 | Zapis schematu 3 z migracją | przejęte, zmienione | Zad. 9:<br>• bez miasta w kopercie (§7.4);<br>• najgorszy przypadek to 2 sklepy, nie 3;<br>• fixture `save-v3-dwa-sklepy.json` |
| 10 | Sesja na firmie | przejęte | Zad. 10:<br>• `handleFirmEvents` z tabelą tras;<br>• zarobek offline jako suma po sklepach;<br>• ulica sklepu #2 z `baseLot` |
| 11 | Render miasta | zmienione | Zad. 11: tylko widok warstw (niskie bryły, ulice wg ruchu, tło dzielnic, < 60 draw calli) i wspólna kartka „DO WYNAJĘCIA”. Makieta, auta, presety i benchmark trafiają do 4a.2 |
| 12 | Ekran Miasta | przejęte, zmienione | Zad. 12:<br>• warstwy tylko „Ruch / Dzielnice”;<br>• przycisk „Biorę lokal” z wyborem zapłaty;<br>• pakiet zamiast czynszu;<br>• dymki i angielski |
| 13 | Przełącznik, sklep w tle, raport sieci, prestiż | przejęte, zmienione | Zad. 13:<br>• okno miesiąca z „Sieć” i osobnym wyciągiem każdego sklepu;<br>• pasek i podgląd sieci (nowe Zad. 8);<br>• wypowiedzenie;<br>• wiersz „Z poprzednich gier” |
| 14 | Balans na botach | przejęte, zmienione | Zad. 15:<br>• cele §8.4 z remanentem SIM 6;<br>• tempo statusu tylko w raporcie (próg to decyzja właściciela, a zaufanie to ekonomia SIM 6);<br>• strategia „mistrz z ekspansją” |
| 15 | Smoke bez okna i przegląd | przejęte, zmienione | Zad. 16:<br>• scenariusz 4a.1 z wypowiedzeniem i angielskim na 390 px;<br>• `locale: 'pl-PL'`;<br>• benchmark miasta w 4a.2;<br>• przegląd zleca koordynator |

Nowe względem starego planu:
- prognoza i podgląd sieci (Zad. 8);
- zamknięcie, wypowiedzenie i rozliczenie końcowe (Zad. 6);
- dymki „pierwszy raz” i słowniczek (Zad. 14);
- `takeoverSide` i lokal obok (Zad. 1).

## Zależności między zadaniami
- 1 → 2 → 3 → 4 → 5 → 6 → 7 → 9 → 10 → (12, 13) → 14 → 16.
- 8 zależy od 4 i musi wejść przed 13.
- 11 zależy tylko od 1 i może iść równolegle z 3–10.
- 15 zależy od 2–6.
- Zadania 3, 5 i 6 dotykają `economy.ts`, `commands.ts` albo `firm.ts` w różnych miejscach, więc idą po kolei, a nie równolegle.

---

### Zadanie 1: typy miasta, dzielnice, generator i lokal obok

**Pliki:**
- Utwórz: `src/sim/city/types.ts`, `src/sim/city/districts.ts`, `src/sim/city/names.ts`, `src/sim/city/generateCity.ts`, `src/sim/store/takeover.ts`
- Zmień: `src/render/street/buildings.ts` (`cornerSide` z sim, `takenSideOf` zastąpione przez `takeoverSide`), `tests/architecture.test.ts`
- Testy: `src/sim/city/generateCity.test.ts`, `src/render/street/przejecie.test.ts` (dopisek)

**Interfejsy:**
- Wymaga: `createRng`, `subSeed` (`src/sim/rng.ts`); `pickLot`, `LOT_RANGES`, `LotSpec`, `LotKind`, `generateStore`, `StoreLayout`.
- Daje w `types.ts`:
```ts
export const CITY_GENERATOR_VERSION = 1;
export const CITY_SIZE = 6;                       // 6×6 kwartałów
export type DistrictId = 'osiedle' | 'srodmiescie' | 'dworzec' | 'biurowce' | 'park';
export type StoreDistrict = Exclude<DistrictId, 'park'>;
export type LotState = 'zajety' | 'wolny' | 'konkurencja' | 'twoj' | 'obok' | 'budowa' | 'po-traszce';
export type RivalBrand = 'szop' | 'kawka';        // „Szop 24h”, „Kawka Express”
export type SourceKind = 'przystanek' | 'szkola' | 'uczelnia' | 'biurowiec' | 'dworzec' | 'osiedle';
export interface CityLot {
  id: number; bx: number; by: number;             // kwartał
  x: number; y: number;                           // wejście w metrach, liczby całkowite
  street: string; number: number;                 // adres składa UI
  spec: LotSpec; district: StoreDistrict;
  state: 'zajety' | 'wolny' | 'konkurencja' | 'twoj' | 'obok';   // stan z generatora; stan w grze daje `lotState` (Zad. 5)
  brand: RivalBrand | null;
  package: number; buildDays: number;             // pakiet otwarcia (zł, co 100) i dni budowy
}
export interface TrafficSource { kind: SourceKind; x: number; y: number; weight: number }
export interface StreetSegment { id: number; name: string; ax: number; ay: number; bx: number; by: number; hourly: number[] }
export interface CityState {
  version: number; name: string;
  blocks: DistrictId[];                           // CITY_SIZE², wierszami (by * CITY_SIZE + bx)
  streets: StreetSegment[]; sources: TrafficSource[];
  lots: CityLot[]; startLotId: number; neighbourLotId: number | null;
}
```
- Daje w `districts.ts`:
  - `BLOCK_M = 110` (kwartał z ulicą, w metrach);
  - `DistrictDef { lotKind: LotKind; traffic: number; weekendTraffic: number | null; basket: number; patience: number; repPenalty: number; theft: number; package: readonly [number, number]; buildDays: readonly [number, number] }`;
  - `DISTRICTS: Record<StoreDistrict, DistrictDef>`, liczby [C] z §8.1 i §10.3 (stroi je Zadanie 15):

| | osiedle | srodmiescie | dworzec | biurowce |
|---|---|---|---|---|
| `lotKind` | `blok` | `kamienica` | `pawilon` | `blok` |
| `traffic` / `weekendTraffic` | 1 / null | 1,1 / null | 1,4 / null | 1,2 / 0,5 |
| `basket` | 1 | 1,35 | 0,8 | 1,1 |
| `patience` / `repPenalty` | 0 / 1 | −2 / 1,5 | +1 / 1 | 0 / 1 |
| `theft` | 1 | 0,6 | 1,8 | 0,8 |
| `package` (zł) | 45 000–55 000 | 65 000–85 000 | 35 000–42 000 | 50 000–60 000 |
| `buildDays` | 5–6 | 7–8 | 5–6 | 6–7 |

- Daje w pozostałych plikach:
  - `generateCity.ts`: `generateCity(seed: string): CityState`, `lotById(city: CityState, id: number): CityLot`;
  - `takeover.ts`: `cornerSide(layout: StoreLayout): 'minX' | 'maxX' | null` (przeniesione z render; `buildings.ts` je reeksportuje) i `takeoverSide(layout: StoreLayout, seed: string): 'minX' | 'maxX' | null`. Odtwarza zużycie losowań `planRow`: kamienica nienarożna to dwa `next()`, a potem `chance(0.5)` daje stronę bramy; blok i pawilon to zawsze `'maxX'`; narożnik daje `null`.

- [ ] **Krok 1: testy.**
  - `przejecie.test.ts`: dla 200 seedów (wszystkie rodzaje, narożniki) `takeoverSide(layoutFor(seed, 0), seed)` równa się stronie sąsiada z `rentSign` w `planRow(layout, seed, 0)`, a `null` wypada dokładnie wtedy, gdy takiego sąsiada nie ma.
  - `generateCity.test.ts`, wzór ze starego planu, 43 seedy:
```ts
it('ten sam seed daje ten sam CityState (złoty skrót dla kiełbasa-42)', () => {
  expect(generateCity('kiełbasa-42')).toEqual(generateCity('kiełbasa-42'));
  expect(sha256(JSON.stringify(generateCity('kiełbasa-42')))).toBe(CITY_GOLDEN);   // wpis z pierwszego przebiegu
});
it.each(SEEDS)('niezmienniki §20.3 dla %s', (seed) => {
  const c = generateCity(seed);
  const start = lotById(c, c.startLotId);
  expect(start.district).toBe('osiedle'); expect(start.state).toBe('twoj');
  expect(start.spec).toEqual(generateStore(seed).lot);
  const free = c.lots.filter((l) => l.state === 'wolny');
  expect(free.length).toBeGreaterThanOrEqual(5); expect(free.length).toBeLessThanOrEqual(8);
  for (const d of ['srodmiescie', 'dworzec', 'biurowce'] as const) expect(free.some((l) => l.district === d)).toBe(true);
  // konkurencja 3–5, nie na wolnym, ≥ 2 kwartały od startu; każdy lokal od ulicy; dzielnica lokalu = dzielnica kwartału;
  // każdy wolny lokal buduje sklep: generateStore(subSeed(seed, 'store:' + l.id), l.spec) nie rzuca
});
```
  - Dalsze przypadki:
    - lokal obok: `neighbourLotId` ma stan `obok`, leży po stronie `takeoverSide(generateStore(seed), seed)` i jest `null` tylko przy narożniku;
    - żaden wolny lokal nie sąsiaduje w rzędzie z innym wolnym ani ze startowym;
    - dzielnice to spójne obszary kwartałów, a park nie ma lokali;
    - format lokalu zgadza się z `lotKind` dzielnicy, a wymiary mieszczą się w `LOT_RANGES`;
    - `package` w widełkach dzielnicy i wielokrotnością 100 zł, najwyższy dla narożnej kamienicy; `buildDays` w widełkach;
    - `generateCity` nie zmienia sklepu: skrót `freshRun(seed)` przed i po wywołaniu jest ten sam.
  - `architecture.test.ts`: zbiór plików osiągalnych importami z `src/sim/run.ts`, `src/sim/ranked.ts` i `scripts/judge-entry.ts` nie zawiera nic z `src/sim/city/` ani `src/sim/firm/`. Używa istniejących `scanCode` i `resolveTarget`.
- [ ] **Krok 2:** `npx vitest run src/sim/city src/render/street/przejecie.test.ts tests/architecture.test.ts` → FAIL (brak modułów).
- [ ] **Krok 3: implementacja** w jednym strumieniu `createRng(subSeed(seed, 'city'))`.
  - Osiedle zawiera kwartał lokalu startowego, a park zajmuje 1–3 kwartały.
  - `spec` startowego to `pickLot(seed)`; pozostałe lokale z `LOT_RANGES` dla `lotKind`.
  - Nazwy miasta i ulic z polskich członów (`names.ts`).
  - `package` rośnie z metrażem (`interiorWidth × salesDepth`) w widełkach dzielnicy; narożna kamienica dostaje górną granicę.
  - `hourly` w tym zadaniu mogą być zerami (wypełnia je Zadanie 2).
- [ ] **Krok 4:** to samo polecenie → PASS; wpisz `CITY_GOLDEN` z komentarzem, że zmiana skrótu wymaga podbicia `CITY_GENERATOR_VERSION`. `npx tsc --noEmit`. Commit `feat(miasto): generator miasta 6×6 z dzielnicami, lokalami, konkurencją i lokalem obok`.

### Zadanie 2: ruch w mieście, mnożnik lokalu i widełki na karcie

**Pliki:**
- Utwórz: `src/sim/city/traffic.ts`
- Zmień: `src/sim/city/generateCity.ts` (wypełnia `hourly` i `sources`)
- Testy: `src/sim/city/traffic.test.ts`

**Interfejsy:**
- Wymaga: `CityState`, `CityLot`, `DISTRICTS`, `BLOCK_M` (Zadanie 1); `SiteMods`, `NEUTRAL_SITE` (Zadanie 3; jeśli Zadanie 3 jeszcze nie weszło, to zadanie tworzy `src/sim/economy/site.ts` z samym typem); `layoutFor`, `computeStoreInfo`, `createEconomy`, `expectedDailyCustomers`.
- Daje:
```ts
export const RIVAL_RADIUS_M = 250;
export const RIVAL_FACTOR = 0.8;
export const LOCAL_RANGE = [0.85, 1.15] as const;
export const ESTIMATE_SPREAD = 0.25;            // widełki ±25%
export const ESTIMATE_SHIFT = 0.15;             // środek przesunięty o ≤ 15% (deterministycznie)
export function sourceProfile(kind: SourceKind, hour: number, weekend: boolean): number;
export function lotLocalFactor(city: CityState, lotId: number): number;          // w LOCAL_RANGE; startowy: 1
export function rivalsNear(city: CityState, lotId: number): { lot: CityLot; meters: number }[];
export function lotTrafficMult(city: CityState, lotId: number): number;          // DISTRICTS[d].traffic × local × 0,8^n
export function storeSeedFor(seed: string, lotId: number): string;              // subSeed(seed, 'store:' + lotId)
export type SiteFlags = Pick<SiteMods, 'extra' | 'ownCosts' | 'firmDebt' | 'weatherHash'>;
export function siteFor(city: CityState, lotId: number, flags: SiteFlags): SiteMods;   // startowy: { ...NEUTRAL_SITE, ...flags }
export interface LotEstimate { lo: number; hi: number; trueDaily: number; who: SourceKind[] }
export function lotEstimate(seed: string, city: CityState, lotId: number): LotEstimate;
```
- [ ] **Krok 1: testy** (`traffic.test.ts`):
  - natężenie ulic: 24 liczby całkowite 0–255, a odcinki przy biurowcach puste w weekend po południu;
  - `lotLocalFactor` zawsze w `[0,85; 1,15]`, a dla lokalu startowego dokładnie 1;
  - rywal w 200 m daje ×0,8, dwóch ×0,64, a rywal w 300 m nic nie zmienia (miasto z ręcznie wstawionymi lokalami);
  - `lotTrafficMult = DISTRICTS[d].traffic × lotLocalFactor × 0,8^n`;
  - `siteFor` lokalu z Dworca: `district: 'dworzec'`, `theft` 1,8, `basket` 0,8, `lot === lot.spec`, flagi przepisane;
  - `lotEstimate`:
    - prawdziwa liczba zawsze w `[lo, hi]`, a `hi / lo` to 1,25 / 0,75;
    - na 40 seedach co najmniej połowa estymat ma środek dalej niż 2% od `trueDaily`;
    - lokal o mnożniku 1 daje `trueDaily` 250–450 (skala SIM 6, komentarz przy `TRAFFIC_BASE`).
- [ ] **Krok 2:** `npx vitest run src/sim/city/traffic.test.ts` → FAIL.
- [ ] **Krok 3: implementacja.**
  - Natężenie odcinka w godzinie *h*: suma `weight × sourceProfile(kind, h, weekend) / (1 + (d / 120 m)²)` po punktach, przeskalowana do 0–255.
  - `lotLocalFactor`: średnia doba natężenia przy wejściu lokalu względem średniej lokali dzielnicy, liniowo do `LOCAL_RANGE`.
  - `lotEstimate`:
    - sklep `layoutFor(storeSeedFor(seed, id), 0, lot.spec)` i `computeStoreInfo` z `site: siteFor(…, { extra: true, ownCosts: false, firmDebt: true, weatherHash: null })`;
    - `trueDaily` to `expectedDailyCustomers(createEconomy(...))`;
    - przesunięcie środka `(2u − 1) × ESTIMATE_SHIFT`, gdzie `u` z `createRng(subSeed(seed, 'estimate:' + id))`;
    - granice zaokrąglone do dziesiątek;
    - `who` to dwa najbliższe rodzaje punktów ruchu (słowa daje UI).
- [ ] **Krok 4:** `npx vitest run src/sim/city` → PASS. Złoty skrót z Zadania 1 zmienia się tu raz, bo wypełniły się `hourly`. Commit `feat(miasto): natężenie ulic, mnożnik lokalu z konkurencją i widełki klientów`.

### Zadanie 3: dzielnica i flagi w ekonomii (`StoreInfo.site`), test neutralności

**Pliki:**
- Utwórz: `src/sim/economy/site.ts`
- Zmień:
  - ekonomia: `src/sim/economy/storeInfo.ts`, `src/sim/economy/economy.ts`, `src/sim/economy/franchisee.ts`, `src/sim/economy/tycoon/wut.ts`, `src/sim/economy/commands.ts`, `src/sim/economy/forecast.ts`;
  - generator: `src/sim/store/layoutFor.ts`
- Testy: `src/sim/economy/site.test.ts`

**Interfejsy:**
- Daje w `site.ts` (bez importów z `src/sim/city`):
```ts
export interface SiteMods {
  district: 'osiedle' | 'srodmiescie' | 'dworzec' | 'biurowce';
  traffic: number;                  // dni robocze: dzielnica × natężenie lokalne × konkurencja
  weekendTraffic: number | null;    // sobota i niedziela zamiast `traffic` i bez premii niedzieli (Biurowce)
  basket: number;                   // obrót i marża z klienta (poziom cen; zużycie towaru bez zmian)
  patience: number;                 // osoby w kolejce (+/−)
  repPenalty: number;               // mnożnik ujemnych zmian reputacji
  theft: number;                    // mnożnik kradzieży: WUT `kradziez` i ubytek na SCO
  lot: LotSpec | null;              // lokal dla `layoutFor` po remoncie; null = pickLot(seed)
  weatherHash: number | null;       // pogoda miasta (seedHash sklepu #1); null = własny seedHash
  extra: boolean;                   // dodatkowy sklep: bez gwarancji (§11.2)
  ownCosts: boolean;                // ten sklep płaci ZUS i księgową (§11.2)
  firmDebt: boolean;                // debet sprawdza firma, nie sklep (§11.4)
}
export const NEUTRAL_SITE: SiteMods;   // osiedle, 1, null, 1, 0, 1, 1, null, null, false, true, false
export function activeSite(info: StoreInfo): SiteMods | null;   // null: brak site albo pola dzielnicy, `lot` i `weatherHash` neutralne
export function siteDayTraffic(site: SiteMods, day: number): number;
```
- Pozostałe zmiany interfejsów:
  - `StoreInfo.site?: SiteMods`; `computeStoreInfo` go nie ustawia.
  - `createEconomy(seed, info, partner?, startMinute: number = OPEN_FROM)`: sklep otwierany w środku gry. Literał stanu bez zmian.
  - `layoutFor(seed, level, lot?: LotSpec)`: bez `lot` jak dziś, z `lot` bazą jest `generateStore(seed, lot)`.
  - `wutFromSales(w, revenue, theftMult?)`, `wutFromSco(w, scoRevenue, mult, theftMult?)`.
  - `StatementInput.ownCosts?: boolean`: `false` daje ZUS i księgową 0.
  - `Effects.site?: SiteMods`: tylko przy `activeSite`.
- Gdzie wchodzi `site`. Modyfikatory dzielnicy stoją za `const site = activeSite(info); if (site) …`, a flagi czyta się wprost z `info.site?.…`.

| Miejsce | Zmiana |
|---|---|
| `arrivalRate`, `expectedDailyCustomers` | `siteDayTraffic` zamiast `dayTrafficMult` i `× traffic` |
| `sell` | przychód i marża z półek i hot `× basket`; kara za braki `× repPenalty`; `theftMult` do WUT |
| `effects` / `patienceOf` | `+ patience` |
| `arrive`, brud (`repPerCustomer < 0`), kolejka w `runStaff` | ujemne zmiany reputacji `× repPenalty` |
| `stepMinute` i `createEconomy` | `rollWeather(site?.weatherHash ?? s.seedHash, …)` |
| `stepMinute` i `applyCommand` | `checkDebt` pominięty przy `firmDebt` |
| `closeDay` | woła `closeMonth(s, info, day, out)` |
| `closeMonth` | `guaranteeTopUp` zwraca 0 przy `extra`; do `buildStatement` idzie `ownCosts: info.site?.ownCosts ?? true` |
| `applyCommand` po remoncie | `layoutFor(state.seed, level, info.site?.lot ?? undefined)`, a nowy `StoreInfo` dostaje z powrotem `site: info.site` |
| `forecastMonth` | gwarancja i koszty własne jak w `closeMonth` |

- [ ] **Krok 1: testy** (`site.test.ts`).
```ts
it('neutralność §8.3: brak site, NEUTRAL_SITE i NEUTRAL_SITE z firmDebt dają ten sam skrót po 61 dniach (3 seedy, remont 1)', () => {
  for (const seed of ['traszka-1', 'kiełbasa-42', 'makieta']) {
    const plain = hashOf(run(seed, undefined, 61));
    expect(hashOf(run(seed, NEUTRAL_SITE, 61))).toBe(plain);
    expect(hashOf(run(seed, { ...NEUTRAL_SITE, firmDebt: true }, 61))).toBe(plain);
  }
});
```
  - Bit w bit dla starych wywołań: `createEconomy(seed, info)` i `createEconomy(seed, info, undefined, OPEN_FROM)` dają ten sam stan, a `layoutFor(seed, 2)` ten sam układ co `layoutFor(seed, 2, undefined)`.
  - Kierunki, 30 dni:
    - Śródmieście ma większy obrót na klienta niż Osiedle;
    - Dworzec ma `tycoon.wut.month.kradziez` na złotówkę obrotu ≥ 1,5× Osiedla, także przez SCO;
    - Biurowce mają w niedzielę mniej niż 0,6 klientów dnia roboczego;
    - przy tej samej kolejce Śródmieście traci więcej reputacji.
  - Flagi:
    - `extra`: `statement.guarantee === 0` w trzech pierwszych miesiącach;
    - `ownCosts: false`: `zus === 0` i `accounting === 0`;
    - `firmDebt`: gotówka poniżej `DEBT_LIMIT` nie daje `gameOver` ani w kroku, ani w poleceniu.
  - Pogoda: sklep z `weatherHash = h` ma każdego dnia tę samą pogodę co sklep o `seedHash` równym `h`.
  - Review Focus 3, remont w sklepie z lokalu miasta: seed blokowy z `site.lot` kamienicy, `startRemont` i przewinięcie do końca. Wtedy `out.layout.lot.kind === 'kamienica'` i `out.info.site` to ten sam obiekt.
  - Sklep otwarty w dniu 40 (`startMinute = 40 dni + OPEN_FROM`) dochodzi do raportu miesiąca bez wyjątków. KPI kończy się w najbliższą niedzielę, a remanent wypada tego samego dnia co w sklepie z dnia 0.
  - `forecastMonth` z `extra` nie liczy gwarancji.
- [ ] **Krok 2:** `npx vitest run src/sim/economy/site.test.ts` → FAIL.
- [ ] **Krok 3: implementacja** według tabeli. W gałęzi bez `site` kolejność działań się nie zmienia.
- [ ] **Krok 4:** `npm run build && npm test` → PASS, w tym `tests/simGolden.test.ts` bez zmian w `GOLDEN`, `tests/rankedSeason.test.ts`, `tests/judgeBundle.test.ts` i `src/sim/run.test.ts`. Commit `feat(ekonomia): dzielnica i flagi dodatkowego sklepu przez StoreInfo.site, neutralna nic nie zmienia`.

### Zadanie 4: firma: lista sklepów, wspólna gotówka, sklep w tle, debet firmy

**Pliki:**
- Utwórz: `src/sim/firm/types.ts`, `src/sim/firm/firm.ts`
- Testy: `src/sim/firm/firm.test.ts`

**Interfejsy:**
- Wymaga:
  - z Zadań 1–2: `generateCity`, `CityState`, `lotById`, `siteFor`, `storeSeedFor`;
  - z Zadania 3: `createEconomy(…, startMinute)`, `layoutFor(…, lot)`;
  - z ekonomii: `stepMinute`, `applyCommand`, `answerCard`, `awaitingDecision`, `visibleCards`, `DEBT_LIMIT`, `DEBT_WARN`, `EconClock`, `gameMinutesPerSecond` i `MAX_MINUTES_PER_ADVANCE` (z `clock.ts`; wyeksportuj, jeśli prywatne).
- Daje w `types.ts`:
```ts
export const MAX_STORES = 2;                      // 4a.1 (§10.2); 4a.2: 3
export const INBOX_MAX = 30;
export interface FirmStore { id: number; lotId: number; econ: EconomyState; layout: StoreLayout; info: StoreInfo; closed: boolean; notice: { endDay: number } | null }
export interface FirmBuild { lotId: number; readyDay: number; price: number; pay: 'gotowka' | 'raty' }
export interface PersonState { wallet: number; ogonki: number; partner: boolean; remanentKnown: boolean }   // warstwa osoby (§14.1)
export interface FirmNote { day: number; storeId: number; card: string; answer: number }                // „zastępca wybrał”
export interface FirmState {
  seed: string; ranked: boolean; city: CityState;   // `city` i `FirmStore.info` nie trafiają do zapisu
  person: PersonState; stores: FirmStore[];         // rosnąco po id
  activeId: number; builds: FirmBuild[]; monthInvest: number; inbox: FirmNote[];
  weatherHash: number; over: null | 'debt' | 'closed';
}
export interface BackgroundEvent { storeId: number; event: EconEvent; important: boolean }
export type FirmEventKind = 'partner' | 'build' | 'opened' | 'deputy' | 'notice' | 'settlement' | 'closed' | 'network-report' | 'debt' | 'gameover';
export interface FirmEvent { kind: FirmEventKind; storeId?: number; params?: Record<string, number | string>; summary?: NetworkSummary }
export interface NetworkSummary { label: string; wallet: number; stores: { id: number; profit: number; net: number }[]; invest: number; total: number }
export interface FirmStepOut { active: EconEvent[]; background: BackgroundEvent[]; firm: FirmEvent[] }
export type FirmRefusal = 'ranked' | 'status' | 'limit' | 'lot' | 'gotowka' | 'raty' | 'store' | 'single' | 'over';
```
- Daje w `firm.ts`:
```ts
export function createFirm(seed: string, start: { econ: EconomyState; layout: StoreLayout; info: StoreInfo }, opts: { ranked: boolean }): FirmState;
export function activeStore(f: FirmState): FirmStore;
export const openStores = (f: FirmState): FirmStore[];
export function refreshSites(f: FirmState): void;               // flagi z §11.2 i §11.4 po każdej zmianie składu
export function setPartner(f: FirmState, partner: EconomyState['partner']): void;   // networkIncome tylko najniższe otwarte id
export function openStoreAt(f: FirmState, lotId: number, minute: number): FirmStore;
export function stepFirmMinute(f: FirmState, out: FirmStepOut): void;
export function advanceFirm(f: FirmState, clock: EconClock, seconds: number, out: FirmStepOut, stopAt?: number): number;
export function applyStoreCommand(f: FirmState, cmd: Command): CommandOutcome;   // aktywny sklep
export function syncWallet(f: FirmState): void;                 // cash i ogonki każdego otwartego sklepu := person
export function grantToFirm(f: FirmState, grant: (s: EconomyState) => void): void;   // premia i zarobek offline przez aktywny sklep
export const emptyStepOut = (): FirmStepOut => ({ active: [], background: [], firm: [] });
```
- Zasady:
  - **`refreshSites`:**
    - jeden otwarty sklep, startowy: `info.site` usunięte;
    - inaczej `siteFor(city, lotId, flags)` z `extra` dla sklepu niestartowego, `ownCosts` dla najniższego otwartego `id`, `firmDebt` przy ≥ 2 otwartych i `weatherHash: f.weatherHash` dla niestartowych.
  - **`stepFirmMinute`, w tej kolejności** (kolejność to część determinizmu):
    1. haki Zadań 5 i 6: otwarcie budów o `OPEN_FROM`;
    2. dla każdego otwartego sklepu po `id`:
       - sklep w tle, który `awaitingDecision`: `answerCard` z `defaultAnswer` dla każdej widocznej karty, wpis do `inbox` (najwyżej `INBOX_MAX`) i `FirmEvent` `deputy`;
       - `econ.cash = wallet`, `econ.ogonki = ogonki`, `stepMinute`, potem odbiór do `person`;
    3. zdarzenia:
       - aktywnego sklepu idą do `out.active` bez zmian;
       - sklepów w tle do `out.background`, z `important: true` dla `month`, `remanent`, `trust-tier` i `gameover`;
    4. przy ≥ 2 otwartych sklepach kontrola debetu firmy:
       - poniżej `DEBT_LIMIT`: `over = 'debt'`, każdy otwarty sklep `gameOver`, `FirmEvent` `gameover` `{ reason: 'debt' }`;
       - przejście `DEBT_WARN`: `FirmEvent` `debt`;
    5. haki Zadania 6 (zamknięcia) i Zadania 5 (status po `month` sklepu startowego);
    6. przy ≥ 2 sklepach w miesiącu `FirmEvent` `network-report` z `NetworkSummary` (`invest` = `monthInvest`, potem zero);
    7. pierwszy remanent któregokolwiek sklepu ustawia `person.remanentKnown`;
    8. `syncWallet`.
  - **`advanceFirm`:** zasady `advanceEconomy`, ale staje na karcie aktywnego sklepu, na `stopAt` i na `over`.
  - **`openStoreAt`:**
    - `layoutFor(storeSeedFor(seed, lotId), 0, lot.spec)`;
    - `createEconomy(storeSeed, info, { ...partner sklepu #1, networkIncome: 0 }, minute)`;
    - `econ.cash = wallet`, `econ.ogonki = ogonki`, `franchisee.remanent.known = person.remanentKnown`;
    - na koniec `refreshSites`.
- [ ] **Krok 1: testy** (`firm.test.ts`; pomocnik `twoStoreFirm(seed, day)` woła `openStoreAt` na pierwszym wolnym lokalu).
```ts
it('§20.2: firma z jednym sklepem daje po 61 dniach ten sam skrót EconomyState co bezpośredni stepMinute (karty: defaultAnswer)', ...);
it('applyStoreCommand w firmie z jednym sklepem == applyCommand (skrót po poleceniach z simGolden: zakupy, raty, remont)', ...);
it('gotówka bez dublowania: dwa sklepy, wallet − start == suma zmian cash sklepów minuta po minucie; po każdej minucie cash i ogonki == person', ...);
it('§11.4: zamknięcie miesiąca −60 tys. w #1 i +30 tys. w #2 przy gotówce −50 tys. nie kończy gry (naliczenia ustawione w franchisee.month)', ...);
it('Review Focus 1: debet ze sklepu w tle kończy grę, a aktywny sklep ma gameOver === true i jest jedno zdarzenie gameover', ...);
it('karta sklepu w tle dostaje defaultAnswer przed jego krokiem, inbox ma wpis, out.firm ma deputy', ...);
it('Review Focus 2: karta, która pojawia się w tle w minucie przełączenia, po przełączeniu czeka na gracza', ...);
it('Review Focus 4: nagroda za poziom w sklepie w tle wpada do gotówki raz', ...);
it('wspólne: pogoda równa w obu sklepach przez 10 dni; networkIncome 300 wpływa raz dziennie; ZUS i księgowa raz w miesiącu', ...);
it('nowy sklep: guarantee 0 w pierwszym wyciągu, remanent tego samego dnia co #1, remanent.known z person', ...);
it('network-report przy dwóch sklepach: profit i net każdego, invest, total == suma', ...);
```
- [ ] **Krok 2:** `npx vitest run src/sim/firm` → FAIL.
- [ ] **Krok 3: implementacja** `types.ts` i `firm.ts` według Zasad.
- [ ] **Krok 4:** `npx vitest run src/sim tests/architecture.test.ts tests/simGolden.test.ts` → PASS; commit `feat(firma): sklepy na wspólnej gotówce, sklep w tle, zastępca od kart i debet firmy`.

### Zadanie 5: status Partnera, pakiet otwarcia, budowa, otwarcie i przełączanie

**Pliki:**
- Utwórz: `src/sim/firm/commands.ts`
- Zmień: `src/sim/firm/firm.ts` (haki statusu i budów), `src/i18n/en/sim.ts` (reguła etykiety raty)
- Testy: `src/sim/firm/commands.test.ts`

**Interfejsy:**
- Wymaga: `lotById`, `storeSeedFor`, `takeoverSide` (Zadania 1–2); `openStoreAt`, `refreshSites`, `FirmRefusal` (Zadanie 4); `planFor`, `installmentLimit`, `TRUST`.
- Daje:
```ts
export type FirmCommand =
  | { type: 'rentLot'; lotId: number; pay: 'gotowka' | 'raty' }
  | { type: 'switchStore'; storeId: number };            // Zadanie 6 dokłada terminateStore
export const FIRM_COMMAND_TYPES: readonly FirmCommand['type'][];
export function isFirmCommand(x: unknown): x is FirmCommand;
export type FirmCommandResult = { ok: true } | { ok: false; reason: FirmRefusal };
export function applyFirmCommand(f: FirmState, cmd: FirmCommand, out: FirmStepOut): FirmCommandResult;
export type PartnerProgress =
  | { kind: 'granted' } | { kind: 'ranked' }
  | { kind: 'missing'; profitMonthsNeeded: number; trust: number; trustNeeded: 75 };
export function partnerProgress(f: FirmState): PartnerProgress;
export function rentRefusal(f: FirmState, lotId: number, pay: 'gotowka' | 'raty'): FirmRefusal | null;
export function lotState(f: FirmState, lotId: number): LotState;
export function grantPartnerIfDue(f: FirmState, out: FirmStepOut): void;   // hak po `month` sklepu startowego
export function openDueBuilds(f: FirmState, out: FirmStepOut): void;       // hak o OPEN_FROM
```
- Zasady:
  - **Status:** dwa ostatnie wpisy `history` sklepu startowego mają `profit > 0`, a `tycoon.trust.value >= 75` w chwili zamknięcia. Status zostaje na stałe, w `ranked` nie przychodzi nigdy. Nadanie to `FirmEvent` `partner`.
  - **`rentRefusal`**, po kolei:
    1. `'over'`: gra skończona;
    2. `'ranked'`;
    3. `'status'`: brak statusu;
    4. `'limit'`: otwarte sklepy plus budowy ≥ `MAX_STORES`;
    5. `'lot'`: lokal nie jest wolny;
    6. `'gotowka'`: `wallet − package < 0`;
    7. `'raty'`: `planFor(package).monthly > installmentLimit([], TRUST.start)`.
  - **Wynajem:**
    - za gotówkę `wallet −= package` i `monthInvest += package`;
    - w obu przypadkach `builds.push({ lotId, readyDay: dzień + buildDays, price, pay })`, `FirmEvent` `build`, `syncWallet`.
  - **Otwarcie** w minucie `readyDay × MINUTES_PER_DAY + OPEN_FROM`:
    - `openStoreAt`;
    - przy ratach w `franchisee.installments` nowego sklepu ląduje rata z planu `planFor(price)` i etykietą `'Adaptacja lokalu: ul. ' + ulica + ' ' + numer`;
    - `FirmEvent` `opened`.
  - **`switchStore`:** natychmiastowe, także w pauzie i przy karcie. `tycoon.fatigue` nowego aktywnego to `structuredClone` z poprzedniego. Zamknięty albo nieznany sklep: `'store'`.
  - **`lotState`:**
    - własny sklep: `twoj`;
    - jego sąsiad (`neighbourLotId` dla startowego, sąsiad po `takeoverSide` dla innych) ma `obok` przy `remontLevel < 1`, a potem `twoj`;
    - budowa: `budowa`; zamknięty sklep: `po-traszce`;
    - reszta: stan z generatora.
- [ ] **Krok 1: testy** (`commands.test.ts`):
  - status:
    - przychodzi po dwóch miesiącach z zyskiem i przy zaufaniu ≥ 75 w chwili zamknięcia, nie wcześniej;
    - zostaje po stratnym miesiącu;
    - `partnerProgress` daje liczby do paska;
  - ranked: przy spełnionym warunku status nie przychodzi, a `rentLot` dostaje `'ranked'`;
  - każdy powód odmowy osobno, a stan bez zmian;
  - Review Focus 4: gotówka równa cenie przechodzi i zostawia `wallet === 0`, a drugi wynajem w trakcie budowy dostaje `'limit'`;
  - budowa:
    - za gotówkę `wallet` spada od razu, a `monthInvest` rośnie;
    - po `buildDays` sklep jest otwarty o 6:00: gotówka równa `wallet` (bez `START_CASH`), zaufanie 65, poziom 1, półki 80%, 2 palety;
  - raty pakietu:
    - etykieta i plan 12 × z opłatą 15%, rata ≤ 8750 zł dla każdego wolnego lokalu w 10 miastach;
    - pierwszy wyciąg sklepu #2 ma `installments === plan.monthly`;
  - sklep #2 ma układ z lokalu miasta (`layout.lot.kind === lot.spec.kind`) i `info.site.district === lot.district`;
  - `switchStore` przenosi `fatigue`, a zamknięty sklep dostaje `'store'`;
  - `lotState` w każdym stanie, także `obok` przed remontem i po nim.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja; reguła EN dla `'Adaptacja lokalu: {}'` („Premises fit-out: …”). **Krok 4:** `npx vitest run src/sim tests/i18n.test.ts` → PASS; commit `feat(firma): status Partnera, pakiet otwarcia, budowa, otwarcie i przełączanie sklepów`.

### Zadanie 6: zamknięcie sklepu, wypowiedzenie i rozliczenie końcowe

**Pliki:**
- Utwórz: `src/sim/firm/closure.ts`
- Zmień: `src/sim/firm/firm.ts` (hak zamknięć), `src/sim/firm/commands.ts` (`terminateStore`, odmowa rat), `src/i18n/en/sim.ts`
- Testy: `src/sim/firm/closure.test.ts`

**Interfejsy:**
- Wymaga: `outstandingDebt`, `wutTotal`, `WUT`, `isLastDayOfMonth`; `refreshSites`, `setPartner`, `applyStoreCommand` (Zadanie 4).
- Daje:
```ts
export interface FinalSettlement { storeId: number; remanent: RemanentProtocol; installments: number; pending: number; total: number }
export function finalSettlement(st: FirmStore, day: number): FinalSettlement;   // czysta: remanent od remanent.fromDay, raty total − paid, pending
export function closeStore(f: FirmState, id: number, reason: 'trust' | 'notice', out: FirmStepOut): void;
// FirmCommand += { type: 'terminateStore'; storeId: number }
export const NOTICE_NO_CREDIT = 'Centrala nie finansuje rat placówki w okresie wypowiedzenia.';   // z regułą EN
```
- Zasady:
  - **Zamknięcie, gdy zostaje inny otwarty sklep:**
    - gotówka spada o `total` jednym ruchem, `FirmEvent` `settlement` niesie kwoty;
    - sklep dostaje `closed = true`, a jego lokal `po-traszce` (wyposażenie zostaje w `econ` i `layout` zamkniętego sklepu);
    - aktywny przechodzi na najniższe otwarte `id`, razem z pulą sił;
    - `refreshSites` i `setPartner`, więc ZUS i dochód sieci przechodzą na pozostały sklep;
    - `FirmEvent` `closed` z `reason`.
  - **Zamknięcie ostatniego sklepu** kończy grę jak dziś, bez rozliczenia:
    - przy zaufaniu `over = 'closed'`, a zdarzenie `gameover` sklepu przechodzi bez zmian;
    - przy końcu wypowiedzenia `econ.gameOver = true` i `FirmEvent` `gameover` `{ reason: 'notice' }`.
  - **Zaufanie 0 przy ≥ 2 otwartych sklepach:** `gameover` sklepu z zamknięcia miesiąca nie idzie do `out.active` ani do `out.background`; po minucie biegnie `closeStore(…, 'trust')`.
  - **`terminateStore`:**
    - przy jednym otwartym sklepie `'single'`, a dla sklepu nieznanego albo już wypowiedzianego `'store'`;
    - w przeciwnym razie `notice.endDay` to ostatni dzień następnego miesiąca i `FirmEvent` `notice`;
    - po zamknięciu miesiąca w `endDay` biegnie `closeStore(…, 'notice')`;
    - w okresie wypowiedzenia `applyStoreCommand` odrzuca polecenia z `raty: true` tekstem `NOTICE_NO_CREDIT`.
- [ ] **Krok 1: testy** (`closure.test.ts`):
  - rozliczenie: sklep #2 z pakietem na raty, SCO na raty i ubytkami ponad limit:
    - `total` = raty do spłaty + `pending` + nadwyżka;
    - gotówka spada o `total` w tej minucie;
    - lokal ma stan `po-traszce`;
  - Review Focus 1:
    - zaufanie 0 w aktywnym #2 przy zamknięciu miesiąca: aktywny staje się #1, w `out.active` nie ma `gameover`, `over === null`;
    - w następnym miesiącu #1 płaci `OWN_COSTS.zus`;
  - wypowiedzenie:
    - `'single'` przy jednym sklepie;
    - przy dwóch sklep działa do końca następnego miesiąca, potem przychodzi rozliczenie;
    - Review Focus 4: raty w okresie wypowiedzenia są odrzucane;
  - koniec gry:
    - ostatni sklep z zaufaniem 0: `over === 'closed'`, bez rozliczenia, a stan sklepu taki sam jak w samym `replayRun` z tym dziennikiem;
    - koniec wypowiedzenia ostatniego sklepu daje `gameover` z `notice`.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/sim tests/i18n.test.ts` → PASS; commit `feat(firma): zamknięcie sklepu, wypowiedzenie i rozliczenie końcowe`.

### Zadanie 7: dziennik firmy i odtworzenie

**Pliki:**
- Utwórz: `src/sim/firm/replay.ts`
- Testy: `src/sim/firm/replay.test.ts`

**Interfejsy:**
- Wymaga: `createFirm`, `stepFirmMinute`, `applyStoreCommand`, `applyFirmCommand`, `isFirmCommand`; `freshRun`, `isCommand`.
- Daje:
```ts
export type FirmLogEntry =
  | { minute: number; seq: number; store: number; cmd: Command }
  | { minute: number; seq: number; firm: FirmCommand };
export interface FirmRecord { seed: string; gameVersion: string; cityGeneratorVersion: number; log: FirmLogEntry[] }
export function replayFirm(rec: FirmRecord, untilMinute: number): FirmState;
```
  - Start od `createFirm(seed, freshRun(seed), { ranked: false })`, potem pętla `replayRun`:
    1. polecenia z minuty M po `(minute, seq)`;
    2. domyślna odpowiedź na kartę aktywnego sklepu;
    3. `stepFirmMinute`.
  - Polecenie sklepu działa tylko wtedy, gdy jego `store` jest aktywny; inaczej jest pomijane.
  - Inna `cityGeneratorVersion` rzuca błąd.
- [ ] **Krok 1: testy:**
  - §3.2: ten sam seed i dziennik dają ten sam `FirmState` (skrót) w dwóch przebiegach;
  - żywa firma po scenariuszu (status, `rentLot` na raty, budowa, `switchStore`, polecenia w obu sklepach, `terminateStore`) równa się `replayFirm` z jej dziennika;
  - same polecenia sklepu nr 1 dają sklep 1 o skrócie równym `replayRun` z tego samego dziennika.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/sim/firm` → PASS; commit `feat(firma): dziennik poleceń firmy i odtworzenie`.

### Zadanie 8: prognoza i podgląd końca miesiąca dla sieci

**Pliki:**
- Utwórz: `src/sim/firm/forecast.ts`, `src/sim/firm/preview.ts`
- Testy: `src/sim/firm/preview.test.ts`

**Interfejsy:**
- Wymaga: `forecastMonth`, `MonthForecast`, `startMonthPreview`, `MonthPreview`, `PreviewProgress`; `stepFirmMinute`, `refreshSites` (Zadanie 4).
- Daje:
```ts
export interface FirmForecast extends MonthForecast { stores: { id: number; f: MonthForecast }[] }   // sumy; cashAfter = wallet + Σ net
export function forecastFirm(f: FirmState): FirmForecast;           // jeden sklep: forecastMonth tego sklepu
export interface FirmPreview {
  label: string; cashNow: number; cashAfter: number; lowestCash: number;
  stores: { id: number; preview: MonthPreview }[]; invest: number; gameOver: 'debt' | 'trust' | null; endedEarly: boolean;
}
export function startFirmMonthPreview(f: FirmState): { step(maxMinutes: number): boolean; progress(): PreviewProgress; result(): FirmPreview | null };
```
  Kopia firmy przez `structuredClone` stanu bez `city`, z tym samym `city` i z `refreshSites`. Karty aktywnego sklepu dostają odpowiedź domyślną.
- [ ] **Krok 1: testy:**
  - §11.3: dwa sklepy od dnia 10; podgląd z dnia 12 i prawdziwa gra bez poleceń do zamknięcia dają ten sam `statement` każdego sklepu (co do złotówki) i to samo `cashAfter`;
  - firma z jednym sklepem: `stores[0].preview` równa się `startMonthPreview`;
  - podgląd nie zmienia firmy (skrót przed i po);
  - `forecastFirm(f).cashAfter === wallet + Σ net`.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** PASS; commit `feat(firma): prognoza i podgląd końca miesiąca dla sieci`.

### Zadanie 9: zapis schematu 3 z migracją

**Pliki:**
- Utwórz: `src/game/firmSave.ts`, `src/game/firmSave.test.ts`, fixture `src/game/fixtures/save-v3-dwa-sklepy.json` (z testu)
- Zmień: `src/game/session.ts` (gałąź schematu 3 przy odczycie; `isNewerSchema` dla zwykłej gry porównuje z `FIRM_SAVE_SCHEMA`), `src/ui/ranking/saveTransfer.ts` (porównanie z `FIRM_SAVE_SCHEMA` zamiast `SAVE_SCHEMA`)
- Testy: także `src/ui/ranking/saveTransfer.test.ts`

**Interfejsy:**
- Wymaga: `FirmState`, `createFirm`, `refreshSites`, `setPartner` (Zadanie 4); `restoreSessionFrom`, `sanitizeEconomy`, `sanitizeLayout`, `generateCity`.
- Daje:
```ts
export const FIRM_SAVE_SCHEMA = 3;
export const SAVE_TRANSFER_MAX_BYTES = 64 * 1024;    // tyle przyjmuje serwer (src/server/config.ts: SAVE_MAX_BYTES)
export interface SavedStore { id: number; lotId: number; generatorVersion: number; layout: StoreLayout; econ: EconomyState; closed: boolean; notice: { endDay: number } | null }
export interface FirmSaveEnvelope {
  schema: typeof FIRM_SAVE_SCHEMA; gameVersion: string; cityGeneratorVersion: number; seed: string;
  firm: Omit<FirmState, 'stores' | 'city' | 'seed' | 'ranked'>; stores: SavedStore[];
}
export function firmEnvelopeOf(f: FirmState): FirmSaveEnvelope;
export type FirmOpened = { ok: true; firm: FirmState } | { ok: false; reason: 'invalid' | 'unbuildable' };
export function restoreFirmFrom(data: unknown, seed: string, partner?: EconomyState['partner']): FirmOpened;
```
- Odczyt:
  - **Schemat 1 i 2:** `restoreSessionFrom` jak dziś, potem `createFirm(seed, { econ, layout, info }, { ranked: false })`.
  - **Schemat 3:**
    - miasto z `generateCity(seed)`;
    - każdy sklep przez `sanitizeLayout` i `sanitizeEconomy` (domyślne z `createEconomy(storeSeed, info, partner, minute)`);
    - `info` od nowa, potem `refreshSites`;
    - premia `partner` przez `setPartner`;
    - `activeId` istnieje, `builds` tylko dla wolnych lokali miasta, `wallet` w `LIMITS.money`.
  - **`cityGeneratorVersion` wyższa niż w kodzie:** traktujemy jak „zapis z nowszej wersji”.
- [ ] **Krok 1: testy:**
  - `save-v1-blok-dzien40`, `save-v2-dzien30`, `save-v2-remont2`, `save-sim4-palety` i `save-sim5-polowa-miesiaca` wczytują się jako firma z jednym sklepem, a `econ` równa się `restoreSessionFrom`;
  - Review Focus 5: `save-v2-remont2` z premią `{ points: 3, networkIncome: 200, stores: 2 }` daje sklep 1 z tą premią i układem po 2 remontach, a pierwszy zapis ma schemat 3;
  - Review Focus 3: obieg schematu 3 (dwa sklepy, budowa w toku, aktywny #2 po remoncie, wypowiedzenie na #1):
    - po zapisie i odczycie oba stany przechodzą 1000 kroków `stepFirmMinute` z tym samym skrótem;
    - `activeId` i `readyDay` zostają;
    - zapis staje się fixture `save-v3-dwa-sklepy.json`;
  - schemat 4 i `cityGeneratorVersion` 2: `NEWER_SAVE_NOTICE`, zapis nienadpisany; zepsuty schemat 3 idzie do `:broken`;
  - rozmiar: paczka przeniesienia `{ format, version: 1, seed, meta, save: firmEnvelopeOf(f) }` dla dwóch sklepów, każdy po dwóch remontach, na koniec roku (365 dni prawdziwych kroków, timeout 60 s) ma `TextEncoder` ≤ `SAVE_TRANSFER_MAX_BYTES`; test drukuje rozmiar;
  - `saveTransfer` przyjmuje schemat 3 i odrzuca 4;
  - zapis biegu rankingowego (`traszka:ranked`) dalej ma schemat 2 i wczytuje się bez zmian.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. Gdy test rozmiaru nie przechodzi, zatrzymaj się i zgłoś pomiar koordynatorowi. Limitu nie podnoś. **Krok 4:** `npx vitest run src/game src/ui/ranking src/sim` → PASS; commit `feat(zapis): koperta firmy w schemacie 3, migracja ze schematów 1 i 2`.

### Zadanie 10: sesja gry na firmie

**Pliki:**
- Utwórz: `src/ui/city/firmText.ts`, `src/i18n/en/ui/firm.ts`
- Zmień:
  - warstwa gry: `src/game/session.ts` (`firm`, `firmOf`, `firmRun`, zapis), `src/game/actions.ts` (`dispatchCommand`, `dispatchFirm`, `handleFirmEvents`, `skip`, `claimWelcome`), `src/game/frame.ts` (`advanceSession`), `src/game/meta.ts` (`welcomeOffer`), `src/game/scene.ts` (`baseLot` dla ulicy), `src/main.ts`;
  - ulica: `src/render/street/buildStreet.ts`, `src/render/street/buildings.ts`;
  - interfejs: `src/ui/state.ts`, `src/i18n/en/ui.ts`
- Testy: `src/game/session.test.ts`, `src/game/actions.test.ts`, `src/game/frame.test.ts`, `src/game/meta.test.ts`, `src/render/street/przejecie.test.ts`, `src/ui/state.test.ts`

**Interfejsy:**
- Wymaga: wszystkiego z Zadań 4–9.
- Daje w sesji i powłoce gry:
  - `GameSession.firm?: FirmState` i `firmOf(session: GameSession): FirmState`:
    - firma powstaje leniwie przy pierwszym użyciu (krok, polecenie, zapis) z bieżącego `econ`, `layout` i `info`;
    - `firmOf` za każdym razem ustawia `firm.ranked = session.mode === 'ranked'`, więc `src/game/rankedRun.ts` zostaje bez zmian;
    - schemat 3 ustawia `firm` od razu.
  - `GameSession.firmRun?: { record: FirmRecord; seq: number } | null`: działa jak `run`, z tym samym `RUN_LOG_MAX` i tymi samymi warunkami `null`. `run` (RunRecord) zapisuje się dalej, dopóki firma ma jeden sklep i nie było polecenia firmy; pierwsze polecenie firmy ustawia `run = null`.
  - **Niezmiennik:** `session.econ`, `session.info` i `session.layout` to `activeStore(firm).econ`, `.info` i `.layout`. Pilnuje go `pointAtActive(session)`.
  - `dispatchFirm(session, cmd: FirmCommand, fx): FirmCommandResult`. Po `switchStore` i po zamknięciu aktywnego: `pointAtActive` i `scene.load(activeStore.econ.seed, session)` (ta sama droga co `rebuildScene`, z tym samym komunikatem porażki).
  - `GameActions.firm(cmd: FirmCommand): FirmCommandResult`.
  - `advanceSession(session, realDt, speed, modal, out: FirmStepOut)` liczy przez `advanceFirm`. `out.active` idzie dzisiejszym `handleEvents`, a `out.background` i `out.firm` nowym `handleFirmEvents`.
- Daje w `ui/state.ts`:
  - `firm: Signal<FirmView | null>`, `FirmView { f: FirmState; v: number }` (jak `EconView`);
  - `networkReport: Signal<NetworkReportView | null>`, `NetworkReportView { summary: NetworkSummary; reports: { storeId: number; report: MonthReport }[] }`; jest w `isWindowOpen`;
  - `RemanentView.stores?: { storeId: number; protocol: RemanentProtocol; text: string }[]`.
- Daje dalej:
  - `welcomeOffer(meta, s, now, others: readonly EconomyState[] = [])`: zarobek offline to suma po otwartych sklepach;
  - `buildStreet(layout, seed, load, remontLevel, baseLot?: LotSpec)`, `planRow(…, baseLot?)`, `grownWidth(layout, seed, baseLot?)`, domyślnie `pickLot(seed)`;
  - `firmText.ts`: `storeName(f, id): string` („Traszka #2, Lipowa”), `firmEventText(f, e: FirmEvent): { title: string; text: string }` (m.in. „Po wnikliwej analizie i z pewnymi oporami nadajemy Panu/Pani status Partnera Strategicznego.”), `addressText(street: string, n: number)` („ul. Lipowa 3” / „3 Lipowa St.”).

| Źródło | Rodzaj | Dokąd |
|---|---|---|
| aktywny sklep | wszystkie | `handleEvents` jak dziś; przy ≥ 2 sklepach `month` idzie do `networkReport` |
| sklep w tle, ważne | `month` | `networkReport.reports` |
| sklep w tle, ważne | `remanent` | `RemanentView.stores` |
| sklep w tle, ważne | `trust-tier`, `gameover` | `pushStory` z nazwą sklepu |
| sklep w tle | drobne | pomijane (stan widać na chipie) |
| firma | `partner`, `opened`, `notice`, `settlement`, `closed`, `debt`, `gameover` | `pushStory(firmEventText)` |
| firma | `network-report` | `networkReport.summary` |
| firma | `deputy`, `build` | toast i odświeżenie (wpis zastępcy zostaje w `inbox`) |

- [ ] **Krok 1: testy.**
  - Nowa gra zwykła: `firm` ma jeden sklep, `session.econ === firm.stores[0].econ`, a skrót po 3 dniach równa się dzisiejszej sesji.
  - Bieg rankingowy:
    - `firm.ranked === true`;
    - dziennik `RunRecord` i wynik sezonu bez zmian, a `tests/rankedSeason.test.ts` i testy `rankedRun` zielone;
    - `game.firm({ type: 'rentLot', … })` daje `'ranked'`.
  - `switchStore`:
    - zmienia `session.econ`, `info` i `layout` i woła `scene.load` z seedem nowego sklepu;
    - działa przy prędkości 0;
    - polecenie sklepu po nim trafia do nowego aktywnego, a `firmRun` ma `store: 2`.
  - Review Focus 2: karta aktywnego, przełączenie, następna minuta: zastępca odpowiada w #1, jest toast i wpis w `inbox`, a gra nie stoi.
  - Review Focus 1: zamknięcie aktywnego sklepu przez Centralę przeładowuje scenę na drugi i nie daje ekranu końca gry.
  - Trasy z tabeli:
    - `trust-tier` z tła daje wpis z nazwą sklepu;
    - dwa `month` z jednej minuty dają jedno `networkReport` z dwoma raportami;
    - dwa `remanent` dają `RemanentView.stores`.
  - Review Focus 4: premia dzienna i zarobek offline przy dwóch sklepach wpływają do `wallet` raz, a zarobek to suma obu.
  - `skip` przesuwa oba sklepy o tyle samo minut.
  - Review Focus 3:
    - `grownWidth(layoutFor(storeSeed, 1, lot), storeSeed, lot)` to przyrost remontu (z domyślnym `pickLot` wychodzi inaczej);
    - sesja z zapisu z aktywnym #2 ładuje ulicę z `baseLot`.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. `main.ts` składa `FirmStepOut` i woła `handleFirmEvents`. `session.econ` przed wyświetleniem nie potrzebuje kopii portfela, bo `syncWallet` trzyma `cash` aktywnego sklepu równym portfelowi. **Krok 4:** `npm run build && npm test` → PASS; commit `feat(sesja): gra prowadzi firmę, session.econ wskazuje aktywny sklep`.

### Zadanie 11: widok warstw miasta i wspólna kartka „DO WYNAJĘCIA”

**Pliki:**
- Utwórz: `src/render/rentPoster.ts`, `src/render/city/buildCity.ts`, `src/render/city/cityPins.ts`
- Zmień: `src/render/street/facadeAtlas.ts` (kartka z `rentPoster.ts`), `src/game/scene.ts` (`showCity`, `hideCity`), `src/i18n/en/render.ts`, `src/ui/ui.css`
- Testy: `src/render/city/buildCity.test.ts`, `src/render/rentPoster.test.ts`

**Interfejsy:**
- Wymaga: `CityState`, `CITY_SIZE`, `BLOCK_M`, `LotState` (Zadania 1, 5); `style.ts`; wzór nakładki z `src/ui/worldOverlay.ts`.
- Daje:
```ts
export function drawRentPoster(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, note: string | null): void;
export type CityLayer = 'ruch' | 'dzielnice';
export const CITY_UNIT_M = 30;                    // jednostka sceny: całe miasto mieści się w VIEW_SIZE_MAX kamery
export interface CityView {
  root: THREE.Group;
  setLayer(layer: CityLayer): void;
  setLots(states: Record<number, LotState>): void;
  pinAnchors(): { lotId: number; world: THREE.Vector3 }[];
  pickLot(ray: THREE.Raycaster): number | null;
  dispose(): void;
}
export function buildCity(city: CityState, states: Record<number, LotState>): CityView;
export function countDrawCalls(root: THREE.Object3D): number;
export function createCityPins(parent: HTMLElement): { set(pins: CityPin[]): void; update(camera: THREE.Camera): void; onTap(cb: (lotId: number) => void): void; dispose(): void };
export interface CityPin { lotId: number; kind: 'twoj' | 'szop' | 'kawka' | 'wolny' | 'budowa' | 'po-traszce'; label: string; world: THREE.Vector3 }
// SceneHost: showCity(city: CityState, states: Record<number, LotState>, layer: CityLayer): void; hideCity(): void; readonly cityShown: boolean
```
- Wygląd i scena (§9.1, §9.2, §19):
  - budynki to niskie, wybielone bryły z obrysu, sklejone w jedną geometrię na chunk 2×2 kwartały;
  - ulice mają kolory wierzchołków od żółtego do czerwonego według średniej doby `hourly`, a tło kwartałów kolor dzielnicy;
  - bez cieni i bez aut;
  - pinezki:
    - własny sklep zielony, Szop pomarańczowy, Kawka fioletowa;
    - wolny lokal to kartka `drawRentPoster` z numerem;
    - budowa to rusztowanie z licznikiem dni;
    - „po Traszce” to kartka z dopiskiem;
  - przy pokazanym mieście sklep i ulica są ukryte, a granice i zoom kamery wracają po `hideCity`;
  - na presecie `niska` scena miasta zwalnia się po wyjściu.
- [ ] **Krok 1: testy:**
  - `countDrawCalls(buildCity(...).root) < 60` dla 10 seedów;
  - kolor najruchliwszego odcinka ma większe R−G niż najcichszego;
  - `setLayer` zmienia kolory kwartałów, a geometria zostaje ta sama;
  - `pinAnchors` leżą w granicach miasta, a `pickLot` promieniem z góry nad kotwicą trafia jej lokal;
  - `dispose` zwalnia geometrie i materiały (licznik);
  - skan źródeł: `facadeAtlas.ts` i `cityPins.ts` importują `drawRentPoster`, a `facadeAtlas.ts` nie rysuje już kartki sam;
  - `rentPoster.test.ts` na atrapie kontekstu: napisy z `tr('DO')`, `tr('WYNAJĘCIA')` i dopisek;
  - `EN_RENDER` ma „po Traszce”, a `tests/i18n.test.ts` zielony.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/render tests/i18n.test.ts` → PASS; commit `feat(render): widok warstw miasta poniżej 60 draw calli i wspólna kartka „DO WYNAJĘCIA”`.

### Zadanie 12: ekran Miasta: zakładka, warstwy, lista i karta lokalu

**Pliki:**
- Utwórz: `src/ui/city/cityModel.ts` (czyste funkcje), `src/ui/city/cityText.ts`, `src/ui/city/CityPanel.tsx`, `src/ui/city/LotCard.tsx`, `src/ui/city/city.css`, `src/i18n/en/ui/city.ts`
- Zmień: `src/ui/state.ts` (`TabId` + `'miasto'`, `cityLayer: Signal<CityLayer>`, `selectedLot: Signal<number | null>`, `lotPay: Signal<'gotowka' | 'raty'>`), `src/ui/game/panels.tsx` (`TABS`, `Sheet`), `src/main.ts` (zakładka ↔ `showCity`/`hideCity`, stuknięcie w pinezkę), `src/i18n/en/ui.ts`
- Testy: `src/ui/city/cityModel.test.ts`, `src/ui/city/CityPanel.test.tsx`, `src/ui/game/panels.test.tsx`

**Interfejsy:**
- Wymaga: `lotEstimate`, `rivalsNear` (Zadanie 2); `partnerProgress`, `rentRefusal`, `lotState` (Zadanie 5); `buildCity` (Zadanie 11); `ui.firm`, `GameActions.firm`, `addressText` (Zadanie 10).
- Daje:
```ts
export type Level = 'niskie' | 'srednie' | 'wysokie';
export interface LotRow { lotId: number; no: number; street: string; number: number; district: StoreDistrict; kind: LotKind; corner: boolean; area: number; lo: number; hi: number; price: number }
export function freeLotRows(seed: string, f: FirmState): LotRow[];             // estymaty raz na seed, w pamięci podręcznej
export interface LotCardModel {
  row: LotRow; who: SourceKind[]; basket: Level; expectations: Level; theft: Level;
  rivals: { brand: RivalBrand; meters: number }[]; price: number; plan: InstallmentPlan; buildDays: number;
  action: { enabled: true } | { enabled: false; reason: FirmRefusal };
}
export function lotCardModel(seed: string, f: FirmState, lotId: number, pay: 'gotowka' | 'raty'): LotCardModel;
// cityText.ts: districtName, lotKindName, lotStateName, sourceText, levelText, refusalText(r: FirmRefusal), progressText(p: PartnerProgress)
```
- Teksty i progi:
  - `refusalText` daje teksty Centrali z §10 dosłownie, w tym:
    - „W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.”;
    - „Dwie placówki to na tym etapie partnerstwa wszystko, na co Centrala jest gotowa się zgodzić.”;
  - `progressText` daje np. „jeszcze 1 miesiąc z zyskiem · zaufanie 68/75”;
  - karta lokalu obok: „Ten lokal zajmiesz remontem „Dokupienie lokalu obok”” z przyciskiem do Ulepszeń;
  - granice poziomów:
    - koszyk ≤ 0,9 to `niskie`, ≥ 1,2 to `wysokie`;
    - oczekiwania `wysokie` przy `patience < 0` albo `repPenalty > 1`, `niskie` przy `patience > 0`;
    - kradzieże ≥ 1,3 to `wysokie`, ≤ 0,7 to `niskie`.
- [ ] **Krok 1: testy:**
  - lista: tylko lokale `wolny`, z numerem, adresem, dzielnicą, formatem, metrażem, widełkami i pakietem;
  - karta:
    - pakiet „za gotówkę X zł” i „na raty Y zł × 12 z przelewów tego sklepu” w `data-tut="lot-price"`;
    - ostrzeżenie „kradzieże: wysokie, zobaczysz je przy remanencie” na Dworcu;
    - konkurencja z marką i odległością;
  - przycisk „Biorę lokal” zablokowany tekstem dla `status`, `ranked`, `limit`, `gotowka` i `raty`; kliknięcie wysyła `{ type: 'rentLot', lotId, pay }`;
  - pasek miasta (`data-tut="city-status"`) w trzech stanach: postęp, status, ranking;
  - przełącznik „Ruch / Dzielnice” zmienia `cityLayer`, a ‹ › i przesunięcie palcem idą po wolnych lokalach w kółko;
  - `TabBar` ma 6 przycisków;
  - angielski: `addressText('Ogrodowa', 12) === '12 Ogrodowa St.'`, a nazwy dzielnic i stanów nie mają polskich liter.
- [ ] **Krok 2:** FAIL. **Krok 3: implementacja.** Desktop: pasek miasta, mapa, lista z prawej, karta. Telefon: mapa u góry, karta wysuwana od dołu. Kamera ma rzut izometryczny, obrót co 90°, zoom i przesuwanie. Czas płynie. Stuknięcie w pinezkę własnego sklepu wysyła `switchStore`. Gdy smoke (Zadanie 16) pokaże ucięte zakładki na 390 px, wchodzi wariant z §9.1: miasto otwiera chip sklepu. **Krok 4:** `npx vitest run src/ui tests/i18n.test.ts` → PASS; commit `feat(ui): ekran Miasta z warstwami, listą wolnych lokali i kartą lokalu`.

### Zadanie 13: przełącznik sklepów, pasek i okno miesiąca sieci, wypowiedzenie, prestiż

**Pliki:**
- Utwórz: `src/ui/city/StoreSwitcher.tsx`, `src/ui/city/storeSwitcherModel.ts`, `src/ui/city/NetworkReport.tsx`, testy obok
- Zmień:
  - pasek i panele: `src/ui/game/Hud.tsx` (chip, „sieć” w pasku), `src/ui/game/spend.tsx`, `src/ui/game/panels.tsx` (wypowiedzenie w Sklepie, „Ten miesiąc”, „Twoja sieć Traszek”);
  - okna: `src/ui/game/overlays.tsx` (`ReportModal` z siecią, `RemanentModal` z zakładkami, bez `PrestigeModal`, `terminationReason`), `src/ui/game/monthPreview.tsx`, `src/ui/game/monthPreviewRun.ts`, `src/ui/App.tsx`;
  - stan i gra: `src/ui/state.ts` (bez `showPrestige`), `src/game/actions.ts` (bez `openNextStore`);
  - tłumaczenia: `src/i18n/en/ui/*.ts` (usunięte i nowe wpisy)
- Testy: `src/ui/city/*.test.tsx`, `src/ui/game/panels.test.tsx`, `src/ui/game/overlays.test.tsx`, `src/ui/game/spend.test.tsx`, `src/ui/game/monthPreview.test.tsx`, `src/game/actions.test.ts`

**Interfejsy:**
- Wymaga: `ui.firm`, `ui.networkReport`, `RemanentView.stores`, `storeName` (Zadanie 10); `forecastFirm`, `startFirmMonthPreview` (Zadanie 8).
- Daje:
```ts
export interface StoreMini { id: number; number: number; street: string; todayProfit: number; net: number; trust: number;
  warnings: ('paleta' | 'polka' | 'zastepca')[]; active: boolean; closed: boolean; notice: boolean }
export function storeMinis(f: FirmState): StoreMini[];          // 'zastepca' przy wpisie w inbox z dziś
export function networkRow(meta: MetaView): string | null;     // „Z poprzednich gier: N sklepów, X zł dziennie, P Punktów Partnera” albo null
export function forecastNow(view: EconView, firm: FirmView | null): MonthForecast;   // ≥ 2 sklepy: forecastFirm, inaczej forecastMonth
```
- Zasady:
  - **Chip** (`data-tut="store-switch"`, „Traszka #1, Ogrodowa”) jest w górnym pasku tylko przy ≥ 2 sklepach. Otwiera listę z mini-stanem i skrzynką (`inbox`).
  - **Pasek pod gotówką:** `forecastNow` z dopiskiem „sieć”. Kolor „Zostanie” i ostrzeżenia w `spend.tsx` liczą prognozę całej sieci.
  - **Okno miesiąca z `networkReport`:** przełącznik segmentowy.
    - „Sieć” (`data-tut="network-summary"`) pokazuje „Zostaje Ci” każdego sklepu i razem, pakiety za gotówkę, gotówkę po zamknięciu i wynik każdego sklepu;
    - dalej zakładka na każdy sklep z `statementView`.
  - **Remanent:** okno z zakładkami sklepów.
  - **Podgląd końca miesiąca** liczy `startFirmMonthPreview`, z częścią na każdy sklep.
  - **Panel Sklep:**
    - „Wypowiedz umowę”, tylko przy > 1 otwartym sklepie, z potwierdzeniem jak `RESTART_CONFIRM`;
    - potem wiersz „Umowa wygasa {data}”;
    - `terminationReason` zna koniec po wypowiedzeniu.
  - **Prestiż (§15):**
    - przycisk i okno „Otwórz kolejną Traszkę” znikają;
    - „Twoja sieć Traszek” listuje sklepy tego miasta, a pod nimi `networkRow`;
    - `meta.network`, `meta.partnerPoints`, `partnerOf`, `prestigeReady` i `addToNetwork` zostają w `meta.ts` (4b).
- [ ] **Krok 1: testy:**
  - chip:
    - nie ma go przy jednym sklepie;
    - lista pokazuje mini-stan każdego sklepu i znak przy palecie w przejściu, pustej półce i karcie zastępcy;
    - przełączenie z listy wysyła `switchStore`, także w pauzie;
  - `ForecastChip` ma sumę sieci i „sieć”, a `spendCheck` z `forecastNow` widzi minus drugiego sklepu;
  - `ReportModal` z `networkReport`: zakładki, sumy, `data-tut="network-summary"`; `RemanentModal` z dwoma protokołami;
  - podgląd przy firmie woła `startFirmMonthPreview`;
  - wypowiedzenie: przycisk tylko przy dwóch sklepach, potwierdzenie wysyła `terminateStore`, a wiersz z datą wygaśnięcia się pokazuje;
  - prestiż:
    - brak przycisku „Otwórz kolejną Traszkę”;
    - `isWindowOpen` bez prestiżu;
    - `networkRow` tylko przy `stores > 0`;
    - istniejące testy prestiżu w `panels.test.tsx` sprawdzają, że przycisku nie ma;
  - po usunięciu prestiżu nie wisi żaden wpis `EN_UI`.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/ui src/game tests/i18n.test.ts` → PASS; commit `feat(ui): przełącznik sklepów, pasek i okno miesiąca sieci, wypowiedzenie i prestiż w mieście`.

### Zadanie 14: dymki „pierwszy raz” i słowniczek

**Pliki:**
- Utwórz: `src/ui/tutorial/city.ts`
- Zmień:
  - samouczek: `src/ui/tutorial/memory.ts` (`TIP_IDS`), `src/ui/tutorial/tips.ts` (`TipCtx`, lista), `src/ui/tutorial/Tutorial.tsx`, `src/ui/tutorial/steps.ts` (zdanie o drugiej Traszce);
  - „Jak grać”: `src/ui/howto/glossary.ts`, `src/ui/howto/howToText.test.ts`;
  - tłumaczenia: `src/i18n/en/glossary.ts`, `src/i18n/en/ui/tutorial.ts`;
  - `README.md`
- Testy: `src/ui/tutorial/tips.test.ts`, `src/ui/tutorial/steps.test.ts`, `src/ui/howto/glossary.test.ts`, `src/ui/howto/HowTo.test.tsx`

**Interfejsy:**
- Wymaga: `ui.firm`, `ui.networkReport`, `selectedLot`, `tab` (Zadania 10, 12); `GUARANTEE`, `planFor`.
- Daje:
  - `TIP_IDS` dostaje `'tip-miasto' | 'tip-lokal' | 'tip-sklepy' | 'tip-siec'`;
  - `TipCtx` dostaje `cityOpen`, `lotOpen`, `partner`, `ranked` (booleany), `stores: number` i `networkOpen: boolean`;
  - `CITY_TIPS: readonly TipDef[]` z warunkami, celami `data-tut` i tekstami z tabeli §17 dosłownie; liczby ze stałych (25 tys. zł z `GUARANTEE.income`, 12 rat z planu); `tip-siec` ma `inWindow: true`.
- [ ] **Krok 1: testy:**
  - każdy dymek w swoim warunku, a `tip-miasto` w trzech wariantach (bez statusu, ze statusem, w rankingu); raz na przeglądarkę, `tips: false` wyłącza;
  - krok przelotu mówi o statusie Partnera, a nie o 2. remoncie;
  - słowniczek ma hasła „Partner Strategiczny”, „Pakiet otwarcia”, „Zastępca”, „Dzielnica” i „Rozliczenie końcowe”, po angielsku z tą samą liczbą haseł;
  - limit słów „Jak grać” podniesiony do zmierzonej wartości, z komentarzem w teście.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. W README, w sekcji „Jak grać”: miasto i drugi sklep oraz notka, że „Otwórz kolejną Traszkę” zastąpiło miasto, a Punkty Partnera i dochód z sieci zostają. **Krok 4:** `npx vitest run src/ui tests/i18n.test.ts` → PASS; commit `feat(samouczek): dymki „pierwszy raz” miasta i słowniczek 4a`.

### Zadanie 15: balans dzielnic na botach

**Pliki:**
- Zmień: `src/sim/economy/tycoon/economyEnv.ts` (`playBot(name, seed, minutes, site?: SiteMods)`), `src/sim/city/districts.ts` (strojenie), `docs/superpowers/specs/2026-10-31-etap-4a-miasto-design.md` (tabela §8.1 po strojeniu)
- Utwórz: `tests/districtBalance.test.ts` (limit czasu jak w `tests/rankedSeason.test.ts`), `tests/measure/miasto.measure.test.ts`, `docs/superpowers/reports/2026-10-31-miasto-4a1.md`

**Interfejsy:**
- Wymaga: `playBot`, `measureBots`, `BOT_NAMES` (`economyEnv.ts`); `DISTRICTS`; `NEUTRAL_SITE`; firma z Zadań 4–6.
- Daje: `districtSite(d: StoreDistrict, lotKind?: LotKind): SiteMods` (środek widełek, natężenie 1, bez rywali, flagi drugiego sklepu).
- [ ] **Krok 1: testy celów §8.4** (8 seedów, 92 dni, czyli z remanentem 30 listopada):
```ts
it('mistrz i decydent zarabiają na drugim sklepie w każdej dzielnicy w ±30% wyniku z osiedla', ...);
it('bierny traci w srodmiesciu więcej niż na osiedlu', ...);
it('srodmiescie: obrót na klienta ≥ 1,25× osiedla; dworzec: klientów ≥ 1,3× osiedla', ...);
it('dworzec, bierny bez SCO: remanent kilka tysięcy zł; z SCO bez kamer wyraźnie więcej (≥ 3×)', ...);
it('rata pakietu każdego wolnego lokalu mieści się w limicie nowego sklepu', ...);
```
- [ ] **Krok 2:** `npx vitest run tests/districtBalance.test.ts`, strojenie `DISTRICTS` i widełek `package`, aż przejdzie. Każdą zmianę liczb wpisz w tabelę §8.1 specu w tym samym commicie. Progu statusu nie ruszamy, bo to decyzja właściciela.
- [ ] **Krok 3: pomiar** (`MEASURE=1 OUT=<plik> npx vitest run tests/measure/miasto.measure.test.ts`): strategia „mistrz z ekspansją” przez firmę, 24 miesiące × 5 seedów. Raport podaje:
  - miesiąc statusu;
  - wybrany lokal;
  - wyciągi obu sklepów;
  - miesiąc miliona z ekspansją i bez niej;
  - decyzje strojenia.

  Jeśli status przychodzi za łatwo albo za trudno, raport to mówi.
- [ ] **Krok 4:** `npm run build && npm test` → PASS (neutralność i `GOLDEN` bez zmian; złoty skrót miasta zmienia się tylko przy zmianie `package` albo `buildDays`, wtedy podbij `CITY_GENERATOR_VERSION`). Commit `test(balans): dzielnice na botach, ceny pakietów i raport ekspansji`.

### Zadanie 16: smoke w przeglądarce bez okna i bramki

**Pliki:**
- Utwórz: `scripts/city-smoke.mjs` (wzór: `scripts/tutorial-smoke.mjs` i `scripts/ranking-smoke.mjs`), `tests/citySmoke.test.ts` (pomocniki skryptu, jak `tests/rankingSmoke.test.ts`), fixture `src/game/fixtures/save-v3-przed-statusem.json` (generator w `src/game/firmSave.test.ts` pod `MAKE_FIXTURE=1`)
- Zmień: `package.json` (`"city:smoke": "node scripts/city-smoke.mjs"`)

**Interfejsy:**
- Wymaga: uchwytu `window.traszkaGame` pod `?debug=1` (`skip` liczy przez firmę, Zadanie 10) i headless Chromium z Playwrighta (`loadPlaywright`), bez panelu.
- [ ] **Krok 1: fixture.** Bot `mistrz` gra przez firmę do pierwszego zamknięcia miesiąca, które daje status. Zapis to koperta schematu 3 z minuty o 20 minut wcześniejszej. Test sprawdza, że po 20 minutach jest `partner`.
- [ ] **Krok 2: smoke** na `vite preview` zbudowanego `dist`, oba rozmiary, każdy kontekst z `locale: 'pl-PL'`:
  1. Stary zapis `save-v2-remont2.json` z metą gracza: jeden sklep, mapa i karta działają, a „Biorę lokal” jest zablokowany tekstem postępu.
  2. Fixture „przed statusem”, potem `skip(30)`: okno „OK” ze statusem Partnera.
  3. Wynajem:
     - Miasto, kartka wolnego lokalu, karta, zapłata, „Biorę lokal”;
     - 390 px płaci na raty;
     - desktop płaci gotówką: najpierw `skip` po miesiącu, aż gotówka ≥ najtańszy pakiet (najwyżej 6 miesięcy, inaczej FAIL);
     - pinezka budowy z licznikiem, a po `skip` do dnia otwarcia okno „Traszka #2 otwarta”.
  4. Chip: przełączenie na #2 (inny seed sceny) i z powrotem.
  5. `skip` do końca miesiąca: okno z „Sieć” i dwoma wyciągami.
  6. Desktop: „Wypowiedz umowę” na #2 i `skip` do końca następnego miesiąca: rozliczenie końcowe, jeden sklep.
  7. 390 px:
     - `document.documentElement.scrollWidth <= 390` na każdym ekranie i pasek zakładek bez ucinania;
     - przejście na angielski w ⚙: adres „St.”, karta i chip w szerokości;
     - FPS widoku warstw z licznika wydajności do raportu (orientacyjnie, cel ok. 30 na telefonie).
  8. Konsola i `pageerror` bez błędów. Zrzuty idą do katalogu wyjściowego skryptu (w `.gitignore`), a wybrane do `docs/superpowers/reports/2026-10-31-miasto-4a1/`.
- [ ] **Krok 3: bramki:**
  - `npm run build` → kod 0;
  - `npm test` → zielone, w tym `simGolden` (bez zmian), `i18n`, `architecture`, `judgeBundle`, `citySmoke`;
  - `npm run check:vercel-build` → kod 0 i lista PASS;
  - `npm run city:smoke` → wszystkie kroki „ok”;
  - `git diff main -- src/sim/simVersion.ts tests/simGolden.test.ts src/server src/sim/ranked.ts src/game/rankedRun.ts` → pusto.
- [ ] **Krok 4:** raport z Zadania 15 uzupełniony o wyniki komend i zrzuty; commit `test(miasto): smoke ekranu miasta, ekspansji i starego zapisu bez okna przeglądarki`.

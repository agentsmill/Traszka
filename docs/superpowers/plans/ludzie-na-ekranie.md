# Ludzie na ekranie (etap 1): plan

> **Dla agentów:** wykonanie przez superpowers:subagent-driven-development. Kroki w formacie `- [ ]`.

**Cel:** każda osoba na zmianie w sklepie jest widoczna jako postać i stoi tam, gdzie jest jej główne zadanie (kasa, rozładunek palet, wykładanie, sprzątanie albo „wolny” na zapleczu). Gracz od razu widzi wąskie gardło: kasjerka poszła do palet, a kolejka rośnie. Etap 2 (kartony w rękach, wykładanie na półki, miotła, worki niesione do wiaty) przyjdzie później.

**Architektura:** symulacja liczy, scena tylko odgrywa. Ranking odtwarza grę na serwerze z dziennika poleceń, więc chodzenie postaci niczego nie zmienia w wyniku. Warstwa ludzi to czysty teatr: dostaje wejście `{ id, task }[]` i listę palet (tylko do odczytu), nic nie zapisuje w `src/sim` ani w `EconomyState`.
- `src/game/staffAdapter.ts`: tymczasowy adapter ekonomia → `{ id, task }[]` (po etapie 2C2 wymieniony jedną zmianą na `staffOnShift` z `src/sim/economy/tycoon/staff.ts`).
- `src/render/staff/`: **czysta załoga** (bez three, testy w node): `types`, `staffNav` (siatka chodzenia), `targets` (cel dla zadania), `taskHold` (histereza na kwadrans), `walker` (marsz po A*), `crew` (cykl życia ludzi). Warstwa three: `staffView.ts`.
- Kasjer z ekranu startowego to pierwsza osoba na zmianie i **nie jest dublowany**: jego ciałem zostaje istniejący `CashierView`, który dostaje tylko dwie nowe możliwości (`setPose`, `setVisible`). Pozostałe osoby to postaci z tej samej fabryki w mundurze (`brand.green`).

**Stos:** three 0.186.1, Preact, Vite, TypeScript, Vitest (środowisko node).

**Spec:** `docs/superpowers/specs/2026-10-27-traszka-tycoon-design.md` §6.5 (praca ludzi), kontrakt etapu 2C2: `StaffTask = 'kasa' | 'rozladunek' | 'wykladanie' | 'sprzatanie'` i `staffOnShift(state): Array<{ id: number; task: StaffTask | 'wolny' }>`.

## Global Constraints

- **Granice plików.** Wolno: `src/render/**`, `src/game/scene.ts` (tylko wpięcie warstwy ludzi), nowy `src/game/staffAdapter.ts` (+ test), jednowierszowy getter w `src/game/frame.ts` (uchwyt debugowania). **Nie wolno ruszać:** `src/sim/**`, `src/ui/**`, `src/game/actions.ts`, `api/**`, `src/server/**`.
- **Czysty teatr.** Nic z widoku nie wraca do symulacji. Kod w `src/render/staff/**` nie mutuje obiektów z `src/sim` (układ, `StoreInfo`, stan ekonomii). `src/sim` nie importuje z `render`, `game` ani `ui` (pilnuje `tests/architecture.test.ts`, nie dotykaj go).
- **Wydajność na telefonie.** Najwyżej `STAFF_VIEW_MAX` (= `STAFF_MAX` z `@/sim/economy/catalog`) osób naraz. Postać pracownika kosztuje tyle co jeden klient: 1 draw call (+1 cień z mapy tylko na `wysoka`), ta sama fabryka postaci, cień pod stopami wyłącznie przez `BlobShadows.reserve/release`. Żadnych nowych materiałów, tekstur, siatek ani pętli po scenie na osobę.
- **Jedna nawigacja z klientami.** Marsz to `findPath` z `@/sim/nav/astar` na siatce układu sklepu; obrót tak jak w tłumie: `turnTowards` i `headingToYaw` z `@/render/crowdView`; tempo klipu chodu `walkTimeScale` z `@/render/characters/walkSpeed`.
- **Determinizm teatru.** Bez `Math.random` w `src/render/staff/**`; losowość tylko przez `createRng`/`subSeed` z `@/sim/rng`.
- **Styl.** Komentarze i teksty po polsku z polskimi znakami, w stylu sąsiednich plików (pełne zdania, które tłumaczą dlaczego). TypeScript strict. Importy przez `@/…`. Commity po polsku w konwencji `feat(render): …`, `test(render): …`, zakończone linią `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Zielone na koniec każdego zadania:** `npm test`, `npm run typecheck`. `npm run build` na końcu całości.
- Współrzędne: kratka `{x, y}` całkowita; położenie postaci w kratkach to środek kratki (`cell + 0.5`, jak `Agent.x/y`); kierunek `heading` w radianach, `0` = +x siatki (jak `Agent.heading`); na obrót obiektu `headingToYaw(heading)`; kratka na świat `cellToWorld(layout, x, y)` (przyjmuje środek kratki o indeksie całkowitym, więc dla położenia `x + 0.5` podaj `x`).

## Review Focus

1. Czy cokolwiek w `src/render/staff/**` albo w adapterze zapisuje do stanu symulacji albo uzależnia ją od widoku.
2. Szarpanie: zmiana zadania nie może następować częściej niż co kwadrans gry i nie częściej niż co `TASK_DWELL_S` sekund czasu widoku.
3. Cykl życia: zatrudnienie w trakcie gry (wchodzi z chodnika), zwolnienie i koniec zmiany (wychodzi i znika), przebudowa sceny po remoncie (nowa załoga bez zwolnionych zasobów), `dispose` zwalnia postacie i miejsca w plamach cienia.
4. Kasjer się nie dubluje i nie znika bez powodu; nigdy dwóch ludzi na tej samej kratce, gdy jest wolna.
5. Koszt na osobę: jedna `SkinnedMesh`, jedna plama; ani jedna dodatkowa pętla `traverse` na klatkę.

---

### Task 1: Typy wspólne, adapter ekonomii i miejsca palet

**Model:** Sonnet

**Pliki:** nowe `src/render/staff/types.ts`, `src/game/staffAdapter.ts`, `src/game/staffAdapter.test.ts`.

**Interfejsy** (dokładnie takie, kolejne zadania na nich polegają):

```ts
// src/render/staff/types.ts: bez importów wartości poza STAFF_MAX
import type { Cell } from '@/sim/grid';
import type { PalletLoc, PalletSpot } from '@/sim/economy/storeInfo';

/** Lustro kontraktu etapu 2C2 (`StaffTask` z src/sim/economy/tycoon/staff.ts). Po scaleniu C2 zamień na `import type` stamtąd. */
export type StaffTask = 'kasa' | 'rozladunek' | 'wykladanie' | 'sprzatanie';
export type StaffDuty = StaffTask | 'wolny';
export interface StaffAssignment { id: number; task: StaffDuty }
export const STAFF_TASKS: readonly StaffTask[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie'];
/** Najwięcej osób w widoku naraz: tyle, ile personelu w ogóle się mieści (STAFF_MAX). */
export const STAFF_VIEW_MAX: number = STAFF_MAX;
/** Miejsce postaci na planszy: kratka i kierunek patrzenia (rad, 0 = +x siatki). */
export interface StaffSpot { cell: Cell; heading: number }
/** Paleta tak, jak widzi ją warstwa ludzi: gdzie stoi (kwadrat 2×2) i od kiedy. */
export interface PalletRef { loc: PalletLoc; spot: PalletSpot; since: number }
```

```ts
// src/game/staffAdapter.ts
import type { EconomyState } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
/** Tymczasowy adapter: ekonomia sprzed etapu 2C2 → lista osób na zmianie. Po C2 zastąpi go `staffOnShift(state)`. */
export function staffFromEconomy(s: EconomyState, info: StoreInfo): StaffAssignment[];
/** Palety z niezerowym towarem, z miejscami z `info.spots` (palety bez znanego miejsca pomijamy). Tylko odczyt. */
export function palletRefsOf(s: EconomyState, info: StoreInfo): PalletRef[];
```

**Reguły `staffFromEconomy`** (odzwierciedlają `stepMinute`/`doWork` w `src/sim/economy/economy.ts`, ale nic w nim nie zmieniają):
- Poza godzinami pracy (`!isOpenAt(minuteOfDay(s.minute))`, funkcje z `@/sim/economy/calendar`) lista jest pusta: personel pracuje tylko w godzinach otwarcia (także w czasie remontu).
- Osób `n = clamp(floor(s.staff), 0, STAFF_MAX)`, identyfikatory `0 … n−1` (zatrudnienie dodaje największy, zwolnienie zabiera największy).
- Na kasie stoi `cashiers = clamp(s.lastCashiers, 0, n)` pierwszych osób (najmniejsze id): `'kasa'`. Pozostali to pracownicy `workers = n − cashiers`, w kolejności id.
- Pracownicy dostają zadania po kolei:
  1. Jeśli jest pilne wykładanie (jakaś kategoria `c` z `info.shelfCap[c] > 0`, `s.shelf[c] / info.shelfCap[c] < 0.5` i `s.backroom[c] > 0`): pierwszy pracownik → `'wykladanie'`.
  2. Kolejni pracownicy → `'rozladunek'`, dopóki liczba osób na rozładunku jest mniejsza niż liczba palet z `total > 0`.
  3. Reszta → `'wykladanie'`, jeśli jakaś kategoria ma `s.shelf[c] < info.shelfCap[c]` i `s.backroom[c] > 0`; inaczej `'wolny'`.
  (`'sprzatanie'` adapter nie zwraca: dopiero C2 ma śmieci i czystość. Widok je obsługuje.)

**Reguły `palletRefsOf`:** dla każdej `p` z `s.pallets` z `p.total > 0`: `spot = info.spots[p.loc][p.spot]`; brak miejsca → pomiń; wynik `{ loc: p.loc, spot, since: p.since }`. Kolejność jak w `s.pallets`.

- [ ] Testy w `src/game/staffAdapter.test.ts` (środowisko node, `createEconomy`/`createSession` z istniejących testów jako wzór; stan budujesz z `createEconomy(seed, info)` i ręcznie ustawiasz pola): poza godzinami → `[]`; `staff` 1…`STAFF_MAX` daje id `0…n−1` i nie więcej niż `STAFF_MAX`; `lastCashiers` wyznacza liczbę `'kasa'` (zawsze najmniejsze id); pilne wykładanie → pierwszy pracownik `'wykladanie'`; palety → `'rozladunek'` tylu osób, ile palet z towarem; pusty magazyn i pełne półki → `'wolny'`; remont (`lastCashiers = 0`) → wszyscy pracownicy; adapter nie zmienia `s` (głęboka kopia przed i po jest równa); `palletRefsOf` pomija palety z `total = 0` i zwraca kopie miejsc z `info.spots`.
- [ ] `npm test`, `npm run typecheck` zielone; commit.

---

### Task 2: Siatka chodzenia i cele dla zadań

**Model:** Sonnet

**Pliki:** nowe `src/render/staff/staffNav.ts`, `src/render/staff/targets.ts`, testy obok (`staffNav.test.ts`, `targets.test.ts`). Czyta `types.ts` z zadania 1.

**Interfejsy:**

```ts
// staffNav.ts
export interface StaffNav { readonly width: number; readonly depth: number; blocked(x: number, y: number): boolean }
/** Kratki, po których chodzi personel: jak klienci (chodnik od wiersza 1, wejście, podłoga sali) plus zaplecze i kratki drzwi na zaplecze (fixture `backroomDoor`). Wiersz 0 chodnika to meble uliczne: tam nikt nie wchodzi. Pas personelu za kasą jest dla personelu otwarty. */
export function staffWalkable(layout: StoreLayout, x: number, y: number): boolean;
/** Siatka do `findPath`: blokuje to, co niechodliwe, i kratki `obstacles` (palety). Poza siatką → zablokowane. */
export function buildStaffNav(layout: StoreLayout, obstacles: readonly Cell[]): StaffNav;
```

```ts
// targets.ts
/**
 * Gdzie ma stanąć każda z osób, żeby jej zadanie było widać. `crew`: osoby z zadaniami (kolejność dowolna, funkcja sortuje po id).
 * Zwraca spot dla każdego id. Czysta funkcja: zero losowości poza `createRng(subSeed(layout.seed, …))`, bez mutowania argumentów.
 */
export function pickStaffSpots(layout: StoreLayout, nav: StaffNav, pallets: readonly PalletRef[], crew: readonly StaffAssignment[], previous?: ReadonlyMap<number, StaffSpot>): Map<number, StaffSpot>;
```

**Reguły `pickStaffSpots`:**
- Kandydaci muszą być osiągalni: policz raz zbiór kratek osiągalnych przez przeszukiwanie wszerz po `nav` ze `layout.spawnPoints[0]` i odrzucaj kandydatów spoza niego. Dwie osoby nie dostają tej samej kratki, dopóki starcza innych kandydatów (zbiór zajętych; osoby w kolejności rosnącego id). Gdy lista kandydatów zadania się wyczerpie, spada się na ogólną listę zapasową (osiągalne kratki sali, najbliżej środka sali pierwsze), a gdy i ta jest pusta, na `layout.entrance[0]`. Funkcja nigdy nie rzuca i zawsze zwraca spot dla każdego id.
- Kierunek patrzenia `heading` liczysz od środka kratki postaci (`x + 0.5`, `y + 0.5`) do środka obiektu zadania (dla prostokąta kratek [x, x + w) × [y, y + d) to `(x + w/2, y + d/2)`): `Math.atan2(dy, dx)`, chyba że poniżej napisano inaczej.
- Porządek „najbliżej X”: rosnąco po odległości manhattan od X, remis: mniejsze `y`, potem mniejsze `x`.
- `'kasa'`: pierwsza osoba z tym zadaniem (najmniejsze id) staje na `cashierSpot(layout).cell` z `heading` z `cashierSpot` (`@/game/cashier`). Kolejne na kratkach pasa personelu (`staffStripCells(layout)` z `@/sim/crowd/crowd`) najbliżej tamtej kratki, patrzą w stronę kasy (środek mebla `checkout`). Gdy `cashierSpot` jest `null`: kandydaci to kratki pasa personelu, a gdy ich brak, kratka `layout.checkoutQueue[0]` (heading w stronę kasy).
- `'rozladunek'`: palety posortowane jak w `doWork` (`loc`: chodnik, sala, zaplecze; potem `since` rosnąco; potem indeks miejsca). Osoba nr `k` z tym zadaniem (k liczone od 0 w kolejności id) obsługuje paletę `k % liczba_palet`. Staje na jednej z kratek przylegających do jej kwadratu 2×2 (8 kratek po bokach, bez narożników), osiągalnej i wolnej, najbliżej `layout.entrance[0]` (dla palet na zapleczu najbliżej środka drzwi `backroomDoor`). Patrzy na środek palety. Bez palet: pierwsza wolna osiągalna kratka z `layout.palletZoneOutside`, patrzy w stronę wejścia.
- `'wykladanie'`: meble `gondola`, `wallShelf`, `fridge` w kolejności `layout.fixtures`, które mają choć jedną osiągalną kratkę dostępu (`accessCells` z `@/sim/store/validate`). Osoba nr `k` z tym zadaniem bierze mebel `k % liczba_mebli`, stoi na jego środkowej osiągalnej kratce dostępu (indeks `floor(len / 2)`); gdy zajęta, na następnej, a gdy wszystkie zajęte, przechodzi do następnego mebla. Patrzy na środek mebla. Bez takich mebli: ogólna lista zapasowa.
- `'sprzatanie'`: kratki sali (`y` od `FRONT_WALL_Y + 1` do `layout.midWallY − 1`), osiągalne, wolne, bez `layout.checkoutQueue` i bez pasa personelu; wybór: `createRng(subSeed(layout.seed, 'staff-clean:' + id))` i `rng.int` po liście posortowanej po (y, x); `heading` losowo spośród czterech kierunków osi (`rng.pick`). Wiatę śmietnikową na podwórku (poza siatką) zostawiamy etapowi 2.
- `'wolny'`: kratki zaplecza (`staffWalkable` i typ `backroom`), osiągalne, wolne, w odległości ≥ 2 od kratek drzwi, najbliższe środka drzwi pierwsze; kolejne osoby z odstępem co najmniej jednej kratki (kratki sąsiadujące z zajętą pomijaj, o ile starcza innych). Patrzy w stronę drzwi. Gdy układ nie ma zaplecza: lista zapasowa.

- [ ] Testy `staffNav.test.ts`: kratki zaplecza i drzwi chodliwe, wiersz 0 i ściany nie, kratki palet zablokowane, poza siatką zablokowane; na kilku seedach (`generateStore`, w tym kamienica, blok i pawilon) z chodnika (`layout.spawnPoints[0]`) da się dojść `findPath` do każdej kratki kasjera, zaplecza i każdego mebla z listy.
- [ ] Testy `targets.test.ts` na ≥ 6 seedach: dla każdego zadania i dla mieszanek (1, 3 i `STAFF_VIEW_MAX` osób) każdy spot jest osiągalny z chodnika, kratki są unikalne (przy starczających kandydatach), zadanie `kasa` pierwszej osoby = `cashierSpot`; rozładunek przy palecie stoi w sąsiedztwie jej kwadratu i patrzy w jej stronę (kąt między `heading` a kierunkiem na paletę < π/2); wykładanie stoi na kratce dostępu do mebla; wolny na zapleczu; funkcja deterministyczna (dwa wywołania równe) i nie mutuje argumentów (układ zamrożony głęboko `Object.freeze` nie powoduje wyjątku); bez palet rozładunek ma spot; pusty `crew` → pusta mapa.
- [ ] `npm test`, `npm run typecheck` zielone; commit.

---

### Task 3: Histereza zadań i marsz postaci (czyste, bez three)

**Model:** Sonnet

**Pliki:** nowe `src/render/staff/taskHold.ts`, `src/render/staff/walker.ts`, testy obok. Czyta `types.ts` (zad. 1) i `staffNav.ts` (zad. 2).

**Interfejsy:**

```ts
// taskHold.ts
/** Kwadrans gry w minutach: zadanie osoby zmienia się najwyżej na granicy kwadransa. */
export const QUARTER_MIN = 15;
/** Najkrócej tyle sekund czasu widoku (s, jak czas marszu) osoba trzyma zadanie, zanim je zmieni: musi zdążyć dojść i pokazać pracę. */
export const TASK_DWELL_S = 6;
export class TaskHold {
  /** `minute`: minuta gry, `clock`: czas widoku (s), `desired`: co ekonomia chce od każdej osoby teraz. */
  update(minute: number, clock: number, desired: readonly StaffAssignment[]): void;
  /** Zadanie, które osoba trzyma teraz (undefined: nie ma jej na zmianie). */
  get(id: number): StaffDuty | undefined;
  reset(): void;
}
```

**Reguły `TaskHold`:**
- Nowa osoba (nie było jej w poprzednim `update`) dostaje od razu to, czego ekonomia chce teraz, i licznik „od kiedy” = `clock`. Osoba, której nie ma w `desired`, jest zapominana od razu (po powrocie traktowana jak nowa).
- Co `update` do głosów osoby dolicza się `min(minute − poprzednia_minuta, QUARTER_MIN)` minut dla zadania `desired` (ujemny albo zerowy przyrost nie liczy się). Cofnięcie minuty (`minute` mniejsze od poprzedniej) czyści cały stan (nowa oś czasu, np. nowa gra).
- Gdy `floor(minute / 15)` jest inny niż w ostatnim ocenianym kwadransie (granica kwadransa; przy skoku przez wiele kwadransów liczy się jeden raz): dla każdej osoby wybierana jest „główne zadanie”: zadanie z największą sumą głosów z minionego okna (remis: zadanie trzymane dotąd, a gdy go nie ma w remisie, to według kolejności `['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny']`). Głosy zerujemy. Zmiana zadania następuje tylko wtedy, gdy wybrane różni się od trzymanego **i** minęło co najmniej `TASK_DWELL_S` od „od kiedy” (`clock − since ≥ TASK_DWELL_S`); wtedy „od kiedy” = `clock`. Inaczej osoba zostaje przy swoim zadaniu.
- Między granicami kwadransa zadanie osoby się nie zmienia, choćby ekonomia przestawiała je co minutę.

```ts
// walker.ts
/** Tempo marszu pracownika, kratek na sekundę czasu widoku (klienci: 2,2–3,0). */
export const STAFF_WALK_SPEED = 2.6;
export class StaffWalker {
  constructor(start: Cell, heading: number, speed?: number);
  /** Środek postaci w kratkach (kratka + 0.5, jak `Agent`). */
  x: number; y: number;
  /** Dokąd patrzy: w czasie marszu kierunek ruchu, po dojściu kierunek zadania. */
  heading: number;
  moving: boolean;
  readonly goal: Cell | null;
  /** Czy stoi na celu (i nie idzie). */
  get atGoal(): boolean;
  /** Cel i kierunek patrzenia po dojściu. Ten sam cel co dotąd nie planuje ścieżki od nowa (zmienia najwyżej kierunek). */
  setGoal(goal: Cell, facing: number, nav: StaffNav): void;
  /** Przenosi na środek kratki (pojawienie się od razu na miejscu) i zeruje marsz. */
  teleport(cell: Cell): void;
  /** Wymusza nowe planowanie ścieżki (siatka się zmieniła: pojawiła się paleta). */
  repath(): void;
  step(dt: number, nav: StaffNav): void;
}
```

**Reguły `StaffWalker`:**
- Ścieżka z `findPath(nav.width, nav.depth, nav.blocked, start, goal)` (start = kratka `floor(x), floor(y)`; sam start może być zablokowany). Brak ścieżki: stoi w miejscu (`moving = false`) i ponawia planowanie co 1 s czasu widoku (licznik w `step`).
- Ruch liniowy po środkach kratek ścieżki z prędkością `speed` kratek/s; `heading` w marszu = `Math.atan2(dy, dx)` aktualnego odcinka; po dojściu do celu `heading = facing` celu, `moving = false`, pozycja równa środkowi celu.
- Gdy następna kratka ścieżki zrobiła się zablokowana (`nav.blocked`), planuje od nowa z bieżącej kratki. `dt ≤ 0`, `NaN` i `Infinity` nic nie robią. Duże `dt` nie przeskakuje kratek poza ścieżkę (zużywa czas po odcinkach).

- [ ] Testy `taskHold.test.ts`: nowa osoba dostaje zadanie od razu; ekonomia przełącza zadanie co minutę, a trzymane zmienia się dopiero na granicy kwadransa i po `TASK_DWELL_S`; zadanie przeważające w oknie wygrywa z ostatnim; remis zostaje przy trzymanym; zwolniona osoba znika, wraca jako nowa; cofnięcie minuty czyści stan; przeskok o godzinę nie gubi głosów ani nie zmienia zadania więcej niż raz; niedopuszczalne wejścia (`NaN`) nie psują stanu.
- [ ] Testy `walker.test.ts` (siatka z `generateStore`): dochodzi do celu w czasie ≈ długość ścieżki / prędkość; `heading` w marszu zgodny z kierunkiem odcinka, po dojściu równy `facing`; ten sam cel nie planuje od nowa (licznik wywołań `findPath` przez opakowany `blocked` albo porównanie pozycji); nowa przeszkoda na ścieżce → obejście, a przy braku drogi stoi i po usunięciu przeszkody rusza; `teleport` ustawia środek kratki; wielkie `dt` kończy na celu bez wyjścia poza ścieżkę; `NaN` ignorowane.
- [ ] `npm test`, `npm run typecheck` zielone; commit.

---

### Task 4: Załoga: cykl życia ludzi (czyste, bez three)

**Model:** Sonnet

**Pliki:** nowy `src/render/staff/crew.ts`, `src/render/staff/crew.test.ts`. Używa `types`, `staffNav`, `targets`, `taskHold`, `walker` z zadań 1–3 (nie zmieniaj ich; zauważone błędy zgłoś).

**Interfejsy:**

```ts
export interface CrewInput {
  /** Osoby na zmianie z tym, czego chce ekonomia (adapter albo `staffOnShift`). */
  people: readonly StaffAssignment[];
  /** Minuta gry. */
  minute: number;
  /** Palety (przeszkody i cele rozładunku). */
  pallets: readonly PalletRef[];
}
export interface CrewMember {
  readonly id: number;
  /** Zadanie trzymane (po histerezie), nie chwilowe. */
  readonly task: StaffDuty;
  readonly walker: StaffWalker;
  /** Wychodzi ze sklepu (zwolniony albo koniec zmiany); znika po dojściu na chodnik. */
  readonly leaving: boolean;
  /** To ciało „kasjera z ekranu startowego” (wygląd gracza). */
  readonly isCashier: boolean;
}
export class StaffCrew {
  constructor(layout: StoreLayout);
  /** Ludzie w kolejności rosnącego id. */
  readonly members: readonly CrewMember[];
  /** Czas widoku (s): suma `dt` z `step`. */
  get clock(): number;
  /** Wywoływane co ~100 ms z ekonomii. */
  sync(input: CrewInput): void;
  /** Co klatkę: `dt` to czas gry w sekundach (rzeczywisty dt × prędkość; 0 przy pauzie). */
  step(dt: number): void;
}
```

**Reguły:**
- `sync`: ignoruj duplikaty id (pierwszy wygrywa) i wartości nie będące skończonymi liczbami całkowitymi ≥ 0; posortuj po id i weź najwyżej `STAFF_VIEW_MAX` pierwszych. Następnie `TaskHold.update(minute, clock, people)`. Osoba, której nie było w załodze, pojawia się: **przy pierwszym `sync` w ogóle** od razu na swoim miejscu (`teleport` do jej spotu), w kolejnych `sync` na chodniku, na punkcie `layout.spawnPoints` najbliższym wejścia (`layout.entrance[0]`), i idzie do środka. Osoba, której nie ma już w `people`, dostaje `leaving = true`, a jej cel to ten sam punkt na chodniku; po dojściu (albo po 20 s czasu widoku marszu) znika z `members`.
- `isCashier`: ciało kasjera dostaje osoba o najmniejszym id spośród osób, które pojawiły się w danym `sync`, o ile nikt nie jest teraz kasjerem. Przypisanie trzyma się do zniknięcia tej osoby z `members` (wtedy znów nikt nie jest kasjerem, aż pojawi się ktoś nowy). Nie przechodzi na inną osobę w trakcie marszu.
- Cele: gdy zmieni się „podpis” (zadania trzymane osób nie wychodzących, zbiór id, lista palet: loc, miejsce, `since` nieistotne) policz `pickStaffSpots` dla osób nie wychodzących i ustaw `walker.setGoal(spot.cell, spot.heading, nav)`. Stabilność: jako piąty argument (`previous`) podaj poprzednie spoty osób, których zadanie trzymane się nie zmieniło od ostatniego liczenia (funkcja zachowuje je dla wykładania, sprzątania i wolnego, jeśli kratka jest nadal wolna i osiągalna), żeby zmiana składu załogi albo pojawienie się palety nie przeganiały ludzi bez powodu. Podpis palet bez `since`. Gdy zmienia się zbiór kratek palet, przebuduj `nav` (`buildStaffNav` z kratkami wszystkich palet) i wywołaj `walker.repath()` u wszystkich.
- `step(dt)`: dopisz `dt` (skończone, ≥ 0) do zegara i przesuń marsz każdego (`walker.step`), usuń tych, którzy skończyli wychodzenie.
- Wejście tylko do odczytu: nic z `input`, `layout` ani palet nie jest mutowane ani przechowywane po referencji (kopiuj to, co trzeba).

- [ ] Testy `crew.test.ts` (układy z `generateStore`): pierwszy `sync` stawia ludzi na spotach bez marszu; liczby 1, 3 i `STAFF_VIEW_MAX` (powyżej limitu nadmiar jest ignorowany); zatrudnienie w trakcie wchodzi z chodnika i dochodzi na swój spot; zwolnienie wychodzi i znika po `step`; zmiana zadania przez ekonomię co minutę nie rusza celu przed granicą kwadransa (liczba wywołań `setGoal`/zmian celu); kasjer: najmniejsze id pierwszego `sync`, trzyma się mimo zmian zadań, po zniknięciu nikt nie przejmuje, nowy `sync` po nocy (lista pusta, potem znów pełna) daje kasjera najmniejszemu id; pojawienie się palety w drodze przebudowuje siatkę i marsz omija paletę; głęboko zamrożony układ i dane wejściowe nie powodują wyjątku; `NaN` w `dt` ignorowane.
- [ ] `npm test`, `npm run typecheck` zielone; commit.

---

### Task 5: `Gait` i most do `CashierView` (kasjer chodzi)

**Model:** Sonnet

**Pliki:** nowe `src/render/characters/gait.ts`, `src/render/characters/gait.test.ts`; zmiany: `src/render/cashierView.ts` (+ `cashierView.test.ts`), `src/render/crowdView.ts` (tylko eksport stałej `IDLE_DELAY_S`).

**Interfejsy:**

```ts
// gait.ts: wspólny dla pracowników i kasjera wybór klipu idle/walk
export class Gait {
  constructor(character: CharacterInstance, footSpeedMps: number, speedCellsPerSecond: number);
  /** Wybiera klip (chód od razu, postój po `IDLE_DELAY_S` bez ruchu) i woła `character.update`: w marszu z `animDt × walkTimeScale`. `frameDt` liczy postój, `animDt` napędza klip. */
  update(moving: boolean, frameDt: number, animDt: number): void;
}
// Logika jak w CrowdView.animate/spawn: walkTimeScale(footSpeedMps, speedCellsPerSecond * CELL_SIZE_M, character.object.scale.z).
```

```ts
// cashierView.ts: dwie nowe możliwości; domyślne zachowanie (stoi za kasą, obraca się do klienta, gest sprzedaży) zostaje bez zmian
export interface CashierPose { x: number; y: number; heading: number; moving: boolean }   // x, y w kratkach (środek = całkowita + 0.5)
class CashierView {
  /** Kasjer chodzi: pozycja, obrót i klip z `pose` zamiast stania za kasą. `null` przywraca zachowanie za ladą. */
  setPose(pose: CashierPose | null): void;
  /** Kasjer poza zmianą: postać i plama niewidoczne (`object.visible = false`, plama o zerowym promieniu), bez zwalniania. */
  setVisible(visible: boolean): void;
}
```
W `update` z `pose != null`: pozycja = `cellToWorld(layout, pose.x − 0.5, pose.y − 0.5)` (y = 0), obrót `turnTowards(yaw, headingToYaw(pose.heading), dt)`, brak gestu i ukłonu (`rotation.x = 0`, `position.y = 0`, `gestureT = null`), plama podąża za postacią co klatkę, klip przez `Gait` (`pose.moving`, prędkość `STAFF_WALK_SPEED` z `@/render/staff/walker`). Bez pozy (`null`) kasjer jak dotąd stoi na `spot`, ale klip przechodzi przez ten sam `Gait` (po powrocie za ladę wraca do `Idle`), a plama wraca na `spot`. Zmiana wyglądu (`build`) tworzy nowy `Gait`. Nowa pozycja nie może przerwać `request`/`setLook` ani dubluć postaci. `setVisible(false)` przed zbudowaniem postaci (strój specjalny jeszcze się wczytuje) ukrywa także postać, która dopiero powstanie; `true` ją pokazuje.

- [ ] Testy: `gait.test.ts` (idle→walk od razu, walk→idle po `IDLE_DELAY_S`, tempo klipu = `walkTimeScale`, `update` zawsze woła `character.update`); `cashierView.test.ts` dopisz: `setPose` przesuwa postać, obrót doganiany przez `turnTowards` (≤ `TURN_RATE_MAX`), brak gestu w marszu, `setPose(null)` wraca za ladę i do `Idle`, `setVisible(false)` chowa postać i plamę, a `true` przywraca, ukrycie przed zbudowaniem postaci; istniejące testy bez zmian.
- [ ] `npm test`, `npm run typecheck` zielone; commit.

---

### Task 6: `StaffView` (postacie załogi) i wpięcie w `Loaded`

**Model:** Sonnet

**Pliki:** nowy `src/render/staff/staffView.ts`, `src/render/staff/staffView.test.ts`; zmiany: `src/render/game/loadedStore.ts` (+ `loadedStore.test.ts`). Zależy od zadań 4 i 5.

**Interfejsy:**

```ts
// staffView.ts
export class StaffView {
  constructor(factory: CharacterFactory, layout: StoreLayout, parent: Object3D, blobs: BlobShadows | null, cashier: CashierView | null);
  readonly crew: StaffCrew;
  /** Liczba postaci pracowników w scenie, bez kasjera (diagnostyka i testy). */
  get size(): number;
  sync(input: CrewInput): void;                                   // deleguje do crew.sync
  update(dt: number, animDt: number, serving: Agent | null): void; // crew.step(dt), potem ciała
  setCharacterShadows(on: boolean): void;
  dispose(): void;
}
```

**Reguły `StaffView`:**
- Każdy `CrewMember` bez `isCashier` ma ciało: `createCashierCharacter(factory, { outfit, appearanceSeed: 'pracownik-' + id })` z `@/render/cashierView` (ten sam mundur `brand.green` co u kasjera), `outfit = id % 2 === 0 ? 'men-worker' : 'women-worker'`. Postać dodana do `parent`, z miejscem `blobs?.reserve()` (zwolnione razem z postacią) i cieniem z mapy zgodnie z `setCharacterShadows` (jak `CrowdView`; `setCharacterShadowCasting` z `characters/blobShadows`). Ciała powstają leniwie w `update` (gdy członek nie ma jeszcze ciała) i są zwalniane (`releaseCharacter` + `slot.release()`), gdy członek zniknął z `crew.members`. `crew.members` nigdy nie ma więcej niż `STAFF_VIEW_MAX` osób, więc ciał też.
- Co klatkę każde ciało: pozycja `cellToWorld(layout, walker.x − 0.5, walker.y − 0.5)`, obrót `turnTowards(yaw, headingToYaw(heading), dt)` (yaw zaczyna od `headingToYaw(walker.heading)`), klip przez `Gait` (`walker.moving`, `STAFF_WALK_SPEED`), plama `slot.set(x, z, rx, rz)` z `characterBlobRadii`. Gdy osoba stoi na celu `cashierSpot(layout).cell` (`walker.atGoal`) i `serving != null`, patrzy na klienta (`atan2` jak w `CashierView.headingTo`), inaczej na `walker.heading`.
- Ciało kasjera (`member.isCashier`) to `cashier` (jeśli nie `null`): gdy `walker.atGoal` i cel to `cashierSpot(layout).cell` → `cashier.setPose(null)`, inaczej `cashier.setPose({ x, y, heading, moving })` z walkera; `cashier.setVisible(true)`. Gdy w załodze nie ma kasjera → `cashier.setVisible(false)` i `setPose(null)`. `StaffView.update` wołamy **przed** `CashierView.update` w tej samej klatce.
- `dispose()` zwalnia wszystkie ciała i miejsca w plamach, jest idempotentne; po nim `sync`/`update` nic nie robią.

**Wpięcie w `Loaded`** (`src/render/game/loadedStore.ts`): pole `staffView: StaffView | null`; `attachCharacters` dokłada je po `cashierView` (`??=`, `new StaffView(src.factory, layout, src.crowdParent, src.blobs, loaded.cashierView)`); `loadStore` inicjuje pole na `null`; `unloadStore` zwalnia `staffView` **przed** `cashierView` (osobny `attempt`). Załoga trzyma kopię układu, więc nowy układ (remont) oznacza nowy `StaffView` (to zapewnia `loadStore` przy przebudowie sceny).

- [ ] Testy `staffView.test.ts` z fabryką-atrapą jak w `cashierView.test.ts` i prawdziwą (`createCharacterFactory(loadFromDisk)` z `characters/testAssets`) dla jednego testu zliczania siatek: 1, 3, `STAFF_VIEW_MAX` osób → tyle ciał, każde z jedną `SkinnedMesh` (koszt jak klient); zatrudnienie dodaje ciało, zwolnienie i koniec zmiany zwalniają je i miejsce w plamach (`reserve`/`release` zbilansowane, pojemność tłumu wraca); `dispose` idempotentne; kasjer nie jest dublowany (dokładnie jedna postać na `CashierView`, pracownicy tylko dla reszty); kasjer w marszu dostaje `setPose`, a po dojściu `null`; załoga bez kasjera ukrywa `CashierView`; plamy pracowników podążają za postaciami; stojący na kasie patrzy na obsługiwanego klienta. `loadedStore.test.ts` dopisz: `attachCharacters` tworzy `staffView` raz (bez dublowania), `unloadStore` zwalnia go przed kasjerem, pola puste po nieudanej budowie.
- [ ] `npm test`, `npm run typecheck` zielone; commit.

---

### Task 7: Wpięcie sceny gry i uchwyt debugowania

**Model:** Sonnet

**Pliki:** `src/game/scene.ts` (tylko wpięcie), `src/game/frame.ts` (jeden getter), testy (`src/game/frame.test.ts` jeśli sprawdza listę pól uchwytu). Zależy od zadań 1 i 6.

**Zmiany:**
- `syncVisuals` (co ~100 ms, po bloku tłumu): `loaded.staffView?.sync({ people: staffFromEconomy(s, info), minute: s.minute, pallets: palletRefsOf(s, info) })`. Wymiana na etap 2C2 ma być jedną zmianą: wywołanie `staffFromEconomy(s, info)` zamienia się na `staffOnShift(s)`, nic więcej (dodaj o tym jednozdaniowy komentarz przy wywołaniu).
- `animate`: gdy jest `staffView`: `staffView.setCharacterShadows(QUALITY[ctx.preset].characterShadows)` i `staffView.update(realDt * speed, animDt, cues.serving)`, **przed** `cashierView.update`. Zmienne `speed`, `animDt`, `cues` istnieją już w tej metodzie (przesuń obliczenie `cues`, jeśli trzeba, ale bez zmiany zachowania kasjera).
- `SceneHost.load`: nic dodatkowo (`loadStore` i `attachFactory` robią resztę przez `attachCharacters`); sprawdź, że po `load` (nowy sklep, remont przez `setSeed`/przebudowę) stary `staffView` nie zostaje (zwalnia go `unloadStore`).
- `debugHandleOf` w `frame.ts`: dodaj `get staffView() { return scene.loaded?.staffView ?? null; }` (jedna linia, obok `cashierView`).
- Zaktualizuj komentarz modułowy na górze `scene.ts` (jedno zdanie: scena trzyma też załogę).

- [ ] Test jednostkowy dla czystych kawałków, jeśli powstały (np. kolejność wywołań nie jest testowalna w node, więc tu wystarczy typecheck + istniejące testy sceny); `npm test`, `npm run typecheck`, `npm run build` zielone; commit.

---

### Task 8: Sprawdzenie w przeglądarce i raport

**Wykonuje kontroler** (nie subagent). Podgląd Vite na porcie 5195 (albo 5197), telefon 390 px i pulpit; 1 osoba, 3 osoby, maksymalna liczba; zatrudnienie i zwolnienie w trakcie gry; remont (przebudowa sceny); brak błędów w konsoli; liczba draw calli z `renderer.info`; zrzuty ekranu w `.superpowers/sdd/ludzie-na-ekranie/zrzuty/`. Raport `.superpowers/sdd/ludzie-na-ekranie/raport.md`.

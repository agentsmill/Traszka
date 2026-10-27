# Etap 1: fundament i pionowy wycinek wyglądu (plan implementacji)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Każde zadanie ma przypisany model (`Model:`). Uruchamiaj implementera dokładnie na tym modelu.**

**Goal:** Jeden sklep Traszki wygenerowany z seeda, ładnie wyrenderowany w stylu Two Point Hospital, z ulicą i chodzącymi klientami, kamerą izometryczną, presetami jakości i benchmarkiem. Wynik etapu idzie do akceptacji wyglądu przez użytkownika.

**Architecture:** `src/sim/` to czysty TypeScript bez three.js (PRNG, układ sklepu, A*, tłum), testowany w Vitest. `src/render/` czyta stan symulacji i buduje scenę three.js. `src/ui/` to nakładka Preact. `src/game/loop.ts` spina symulację w stałym kroku z renderem w każdej klatce.

**Tech Stack:** three 0.186.1, @types/three 0.186.0, Vite 8.3.5, TypeScript 7.0.2 (awaryjnie 6.0.3), Vitest 5.0.5, Preact 11.1.0, @preact/signals 2.11.4, postprocessing 6.39.5, n8ao 2.0.1, @gltf-transform/cli 4.5.1, meshoptimizer 1.3.0.

**Spec:** `docs/superpowers/specs/2026-10-27-traszka-tycoon-design.md` (§5.1, §5.2, §13, §14, §15). Roadmapa i przydział modeli: `docs/superpowers/plans/2026-10-27-traszka-roadmapa.md`.

## Global Constraints

- `src/sim/**` nie importuje `three` ani nie używa `Math.random`. Pilnuje tego test architektury z zadania 1.
- Losowość wyłącznie z `createRng(seed)`. Każdy podsystem ma własny strumień przez `subSeed(seed, etykieta)`.
- 1 kratka siatki = 0,5 m (`CELL_SIZE_M = 0.5`).
- Renderer: `WebGLRenderer` + `OrthographicCamera`, `PCFShadowMap` (nie `PCFSoftShadowMap`), tone mapping AgX lub Neutral, wyjście sRGB, pixelRatio ≤ 2.
- Presety jakości `niska | srednia | wysoka`. Niska: bez AO, cienie 1024. Średnia: AO halfRes, cienie 2048, pixelRatio ≤ 1,5. Wysoka: AO pełne, cienie 4096, pixelRatio ≤ 2.
- Cel wydajności: preset Średnia ~60 FPS (benchmark: średnio ≥ 55 FPS) przy 60 postaciach na MacBooku Air M1 / Iris Xe.
- Styl: Two Point Hospital, czyli stylizacja, ciepła nasycona paleta, fazowane krawędzie i dużo detalu. Bez prymitywnych „klocków”.
- Assety tylko CC0. Każdy plik w `public/assets/` ma wpis w `public/assets/LICENSES.md`.
- Bez prawdziwych marek, nazwisk i logo. Marka w grze to „Traszka”.
- Teksty UI po polsku.
- Komunikaty commitów kończą się linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Nietypowy seed** (pusty, 1000 znaków, emoji i polskie znaki): generator ma zwrócić poprawny układ, a nie wyjątek. Test w zadaniu 4.
2. **Duży skok czasu** (powrót do karty po minutach): krok symulacji jest przycięty, agenci nie przenikają ścian i nie teleportują się. Testy w zadaniach 5 i 13.
3. **Zmiana rozmiaru okna lub DPR:** obraz bez rozciągnięcia, frustum zgodne z proporcjami. Test w zadaniu 7.
4. **Brak WebGL2 albo błąd N8AO:** gra spada do presetu Niska z komunikatem, a nie pokazuje czarnego ekranu. Test w zadaniu 7.
5. **Brak pliku assetu (404):** postać zastępcza, gra działa dalej. Test w zadaniu 11.

---

### Task 1: Szkielet projektu

**Model:** Haiku

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `.gitignore`, `README.md`
- Test: `tests/architecture.test.ts`

**Interfaces:**
- Produces: skrypty `npm run dev | build | preview | test | typecheck`. Alias importu `@/` → `src/`.

- [ ] **Step 1: Repozytorium.** `git init`. `.gitignore`: `node_modules`, `dist`, `assets-src`, `.superpowers`, `.DS_Store`.
- [ ] **Step 2: `package.json` z dokładnymi wersjami** z sekcji Tech Stack (`"type": "module"`). Skrypty: `dev: vite`, `build: tsc --noEmit && vite build`, `preview: vite preview`, `test: vitest run`, `typecheck: tsc --noEmit`. Potem `npm install`. Jeśli `tsc` z TypeScript 7.0.2 zgłasza błędy w `@types/three`, przejdź na `typescript@6.0.3` i zapisz to w README.
- [ ] **Step 3: `tsconfig.json`** z `strict: true`, `jsx: react-jsx`, `jsxImportSource: preact`, `paths: { "@/*": ["src/*"] }`. **`vite.config.ts`** z aliasem `@` i `test: { environment: 'node' }`.
- [ ] **Step 4: Napisz test architektury** `tests/architecture.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architektura', () => {
  it('src/sim nie importuje three i nie używa Math.random', () => {
    const offenders = files('src/sim').filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /from ['"]three/.test(src) || /Math\.random/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 5:** Utwórz pusty katalog `src/sim/` z plikiem `src/sim/index.ts` (`export {};`), uruchom `npm test`. Oczekiwane: `1 passed`.
- [ ] **Step 6:** `index.html` z `<canvas id="scene">` i `<div id="ui">`. `src/main.ts` na razie tylko wypisuje do konsoli „Traszka Tycoon”. `npm run build` ma się zakończyć kodem 0.
- [ ] **Step 7: Commit** `chore: szkielet projektu (vite, ts, vitest, preact, three)`.

---

### Task 2: PRNG z seeda

**Model:** Haiku

**Files:**
- Create: `src/sim/rng.ts`
- Test: `src/sim/rng.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Rng {
  next(): number;                                  // [0, 1)
  int(min: number, maxExclusive: number): number;  // Math.floor(next() * (max - min)) + min
  range(min: number, max: number): number;         // float [min, max)
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;                      // next() < p
  shuffle<T>(items: readonly T[]): T[];            // nowa tablica, Fisher–Yates
}
export function hashString(s: string): number;     // pierwszy wynik xmur3(s)
export function createRng(seed: string): Rng;      // sfc32(4 × xmur3(seed)), pomija pierwsze 15 wyników
export function subSeed(seed: string, label: string): string; // `${seed}:${label}`
```

- [ ] **Step 1: Napisz testy z wartościami wzorcowymi**

```ts
import { describe, it, expect } from 'vitest';
import { createRng, hashString, subSeed } from './rng';

describe('rng', () => {
  it('hashString jest wzorcowy', () => {
    expect(hashString('kiełbasa-42')).toBe(2556296325);
    expect(hashString('')).toBe(167010153);
  });
  it('createRng daje wzorcowe wartości', () => {
    const r = createRng('kiełbasa-42');
    expect([r.next(), r.next(), r.next()]).toEqual([0.7423317739740014, 0.8871990016195923, 0.8230785729829222]);
    const t = createRng('traszka');
    expect(t.next()).toBe(0.8985555691178888);
  });
  it('int jest wzorcowy i w zakresie', () => {
    const r = createRng('kiełbasa-42');
    expect([0, 1, 2, 3, 4].map(() => r.int(0, 10))).toEqual([7, 8, 8, 7, 2]);
  });
  it('podstrumienie są niezależne', () => {
    expect(createRng(subSeed('a', 'city')).next()).not.toBe(createRng(subSeed('a', 'store')).next());
  });
  it('shuffle nie modyfikuje wejścia i zachowuje elementy', () => {
    const src = [1, 2, 3, 4, 5];
    const out = createRng('x').shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(src);
  });
});
```

- [ ] **Step 2:** `npm test -- src/sim/rng.test.ts`. Oczekiwane: FAIL (brak modułu).
- [ ] **Step 3:** Zaimplementuj `src/sim/rng.ts`. Algorytmy xmur3 i sfc32 według bryc/code `PRNGs.md`: arytmetyka 32-bitowa przez `Math.imul` oraz `| 0` i `>>> 0`, wynik sfc32 to `(t >>> 0) / 4294967296`.
- [ ] **Step 4:** `npm test`. Oczekiwane: PASS, wszystkie testy.
- [ ] **Step 5: Commit** `feat(sim): deterministyczny PRNG xmur3+sfc32`.

---

### Task 3: Typy sklepu, siatka, A*, walidacja układu

**Model:** Sonnet

**Files:**
- Create: `src/sim/grid.ts`, `src/sim/nav/astar.ts`, `src/sim/store/types.ts`, `src/sim/store/validate.ts`, `src/sim/store/ascii.ts`
- Test: `src/sim/nav/astar.test.ts`, `src/sim/store/validate.test.ts`, `src/sim/store/testLayouts.ts` (pomocnik do budowy układów w testach)

**Interfaces:**
- Consumes: nic.
- Produces:

```ts
// grid.ts
export interface Cell { x: number; y: number }
export const CELL_SIZE_M = 0.5;
export function manhattan(a: Cell, b: Cell): number;
export function cellKey(c: Cell): number;                    // c.x + c.y * 4096

// nav/astar.ts
export type BlockedFn = (x: number, y: number) => boolean;
/** 4-sąsiedztwo; ścieżka zawiera start i cel; null, gdy brak drogi; [start], gdy start == cel. */
export function findPath(width: number, height: number, blocked: BlockedFn, start: Cell, goal: Cell): Cell[] | null;

// store/types.ts
export type LotKind = 'blok' | 'kamienica' | 'pawilon';
export interface LotSpec { kind: LotKind; interiorWidth: number; salesDepth: number; backroomDepth: number; corner: boolean }
/** Kierunek frontu mebla (strona klienta): N = −y (do ulicy), S = +y (w głąb), W = −x, E = +x. */
export type Facing = 'N' | 'E' | 'S' | 'W';
export type FixtureKind = 'gondola' | 'wallShelf' | 'fridge' | 'checkout' | 'tobaccoShelf' | 'hotFood' | 'coffee'
  | 'selfCheckoutSlot' | 'equipmentSlot' | 'backroomDoor';
export interface Fixture { id: string; kind: FixtureKind; x: number; y: number; w: number; d: number; facing: Facing }
export type CellType = 'outside' | 'wall' | 'window' | 'entrance' | 'floor' | 'backroom' | 'fixture';
export const SIDEWALK_ROWS = 4;      // wiersze 0..3 to chodnik
export const FRONT_WALL_Y = 4;       // ściana frontowa z witryną i wejściem
export interface StoreLayout {
  generatorVersion: number; seed: string; lot: LotSpec;
  width: number;                     // interiorWidth + 2
  depth: number;                     // 4 + 1 + salesDepth + 1 + backroomDepth + 1
  midWallY: number;                  // 5 + salesDepth (ściana między salą a zapleczem)
  cells: CellType[];                 // cells[y * width + x]
  fixtures: Fixture[];
  entrance: Cell[];                  // 2 kratki w FRONT_WALL_Y
  checkoutQueue: Cell[];             // kolejka, [0] = miejsce przy kasie
  palletZoneOutside: Cell[];         // chodnik, gdzie kierowca zostawia palety
  spawnPoints: Cell[];               // (0,1) i (width-1,1)
}

// store/validate.ts
export interface ValidationResult { ok: boolean; errors: string[] }
export function isWalkable(layout: StoreLayout, x: number, y: number): boolean; // outside | entrance | floor
export function accessCells(layout: StoreLayout, f: Fixture): Cell[];          // kratki przed frontem mebla
export function validateLayout(layout: StoreLayout): ValidationResult;

// store/ascii.ts
/** Legenda: ',' chodnik, '#' ściana, 'W' witryna, 'D' wejście, '.' podłoga, 'b' zaplecze, 'q' kolejka,
 *  meble: G gondola, S wallShelf, F fridge, C checkout, T tobaccoShelf, H hotFood, K coffee,
 *  X selfCheckoutSlot, E equipmentSlot, B backroomDoor. Wiersze od y=0 (ulica) w dół. */
export function layoutToAscii(layout: StoreLayout): string;
```

Reguły `validateLayout` (kody błędów są częścią kontraktu):
| Kod | Reguła (spec §5.2) |
|---|---|
| `entrance-not-front` | wszystkie kratki `entrance` mają `y === FRONT_WALL_Y`, jest ich dokładnie 2 |
| `checkout-far` | kasa leży w pierwszych 6 wierszach sali (`y ≤ FRONT_WALL_Y + 6`), a jej najbliższa kratka jest w odległości manhattan ≤ 8 od wejścia |
| `tobacco-not-behind` | `tobaccoShelf` jest równoległy do kasy, po stronie przeciwnej do jej `facing`, z 1–2 kratkami wolnej przestrzeni dla personelu |
| `hot-far` | `hotFood` i `coffee` w odległości manhattan ≤ 8 od kasy |
| `fridge-not-back` | każda lodówka dotyka ściany środkowej (`y + d === midWallY`) i ma `facing === 'N'` |
| `aisle-narrow:<id>` | każdy regał gondolowy ma ≥ 2 kratki wolnej podłogi wzdłuż obu dłuższych boków |
| `fixture-overlap` | meble się nie nakładają i nie wchodzą w ściany |
| `unreachable:<id>` | co najmniej jedna kratka z `accessCells` jest osiągalna (A*) z wejścia (poza `backroomDoor`) |
| `queue-invalid` | kratki kolejki są chodliwe, różne i kolejno sąsiednie (manhattan 1), a `[0]` sąsiaduje z kasą od strony jej `facing` |
| `no-backroom-door` | dokładnie jeden `backroomDoor` w wierszu `midWallY` |

- [ ] **Step 1: Testy A*:** `findPath` dla prostej linii 5×1 daje 5 kratek; obejście przeszkody daje ścieżkę bez kratek zablokowanych i o długości 13 kratek (12 ruchów) dla scenariusza z testu (siatka 5×5, ściana w x=2 od y=0 do y=3, start (0,0), cel (4,0)); całkowicie zamknięty cel daje `null`; `start == goal` daje `[start]`.
- [ ] **Step 2: Testy walidacji.** W `testLayouts.ts` przygotuj `makeValidLayout()` ręcznie złożonego, poprawnego sklepu 16×12 (bez generatora) oraz funkcje psujące, każdą pod jeden kod błędu:
  - test „poprawny układ → `ok: true`, `errors: []`”,
  - test na każdy kod z tabeli: zepsuty układ → `errors` zawiera ten kod.
  `layoutToAscii(makeValidLayout())` porównaj ze snapshotem i obejrzyj go oczami.
- [ ] **Step 3:** `npm test`. Oczekiwane: FAIL.
- [ ] **Step 4:** Zaimplementuj `grid.ts`, `astar.ts` (kopiec binarny lub posortowana lista otwarta, heurystyka manhattan), `types.ts`, `validate.ts`, `ascii.ts`.
- [ ] **Step 5:** `npm test`. Oczekiwane: PASS.
- [ ] **Step 6: Commit** `feat(sim): typy sklepu, A* i walidacja układu`.

---

### Task 4: Generator sklepu z seeda

**Model:** Sonnet

**Files:**
- Create: `src/sim/store/lots.ts`, `src/sim/store/generateStore.ts`
- Test: `src/sim/store/generateStore.test.ts`

**Interfaces:**
- Consumes: `createRng`, `subSeed` (Task 2); typy, `validateLayout`, `layoutToAscii` (Task 3).
- Produces:

```ts
// lots.ts
export const LOT_RANGES: Record<LotKind, {
  interiorWidth: [number, number]; salesDepth: [number, number]; backroomDepth: [number, number]; cornerChance: number;
}> = {
  blok:      { interiorWidth: [16, 20], salesDepth: [12, 16], backroomDepth: [4, 6], cornerChance: 0 },
  kamienica: { interiorWidth: [12, 18], salesDepth: [12, 16], backroomDepth: [3, 4], cornerChance: 0.5 },
  pawilon:   { interiorWidth: [20, 26], salesDepth: [16, 20], backroomDepth: [6, 8], cornerChance: 0 },
}; // zakresy włącznie
export const LOT_WEIGHTS: Record<LotKind, number> = { blok: 0.45, kamienica: 0.35, pawilon: 0.2 };
export function pickLot(seed: string): LotSpec;  // używa subSeed(seed, 'lot'); rodzaj losowany wg LOT_WEIGHTS

// generateStore.ts
export const GENERATOR_VERSION = 1;
/** Bez `lot` wybiera lokal przez pickLot(seed). Do 10 prób z subSeed(seed, `store:try:${n}`);
 *  po 10 nieudanych rzuca Error('generateStore: brak poprawnego układu'). */
export function generateStore(seed: string, lot?: LotSpec): StoreLayout;
```

Kolejność budowy (spec §5.2, szkielet → wypełnienie):
1. Ściany, chodnik, zaplecze, wejście (2 kratki; w lokalu narożnym bliżej boku z witryną).
2. Kasa przy bocznej ścianie bliżej wejścia, front do wnętrza; za nią `tobaccoShelf` przy ścianie.
3. `hotFood` i `coffee` przy kasie.
4. Lodówki (moduły 2×2) wzdłuż ściany środkowej, poza drzwiami zaplecza.
5. Gondole w równoległych rzędach (kierunek z seeda): alejki docelowo 3 kratki, minimum 2.
6. `wallShelf` przy drugiej ścianie bocznej.
7. `selfCheckoutSlot` przy wejściu, gdy `interiorWidth ≥ 16`.
8. 1–3 sloty `equipmentSlot` (2×2) przy ścianach.
9. Kolejka 4–6 kratek.
10. `palletZoneOutside`: wiersze chodnika 1–2, bez pasa przed wejściem (x wejścia ±1).
11. `validateLayout`, a przy błędzie kolejna próba.

- [ ] **Step 1: Napisz testy**

```ts
describe('generateStore', () => {
  it('jest deterministyczny', () => {
    expect(generateStore('kiełbasa-42')).toEqual(generateStore('kiełbasa-42'));
  });
  it('złoty seed: snapshot ASCII', () => {
    expect(layoutToAscii(generateStore('kiełbasa-42'))).toMatchSnapshot();
  });
  it('200 seedów → każdy układ przechodzi walidację', () => {
    for (let i = 0; i < 200; i++) {
      const l = generateStore(`seed-${i}`);
      expect(validateLayout(l), `seed-${i}\n${layoutToAscii(l)}`).toEqual({ ok: true, errors: [] });
    }
  });
  it('rozmiary mieszczą się w LOT_RANGES dla wszystkich rodzajów', () => {
    for (const kind of ['blok', 'kamienica', 'pawilon'] as const) {
      for (let i = 0; i < 30; i++) {
        const l = generateStore(`${kind}-${i}`);
        const r = LOT_RANGES[l.lot.kind];
        expect(l.lot.interiorWidth).toBeGreaterThanOrEqual(r.interiorWidth[0]);
        expect(l.lot.interiorWidth).toBeLessThanOrEqual(r.interiorWidth[1]);
        expect(l.width).toBe(l.lot.interiorWidth + 2);
      }
    }
  });
  it('różne seedy dają różne sklepy (≥ 15 z 20 unikalnych)', () => {
    const set = new Set(Array.from({ length: 20 }, (_, i) => layoutToAscii(generateStore(`r-${i}`))));
    expect(set.size).toBeGreaterThanOrEqual(15);
  });
  it('wszystkie trzy rodzaje lokali występują wśród 60 seedów', () => {
    const kinds = new Set(Array.from({ length: 60 }, (_, i) => pickLot(`k-${i}`).kind));
    expect(kinds).toEqual(new Set(['blok', 'kamienica', 'pawilon']));
  });
  it('nietypowe seedy działają', () => {
    for (const s of ['', 'ąęółżźćń🦎', 'x'.repeat(1000)]) {
      expect(validateLayout(generateStore(s)).ok).toBe(true);
    }
  });
});
```

- [ ] **Step 2:** `npm test -- generateStore`. Oczekiwane: FAIL.
- [ ] **Step 3:** Zaimplementuj `lots.ts` i `generateStore.ts` według kolejności budowy powyżej.
- [ ] **Step 4:** `npm test`. Oczekiwane: PASS. Obejrzyj snapshot ASCII dla `kiełbasa-42` i wklej go do opisu commita.
- [ ] **Step 5: Commit** `feat(sim): generator sklepu z seeda (v1)`.

---

### Task 5: Tłum demonstracyjny

**Model:** Sonnet

**Files:**
- Create: `src/sim/crowd/crowd.ts`
- Test: `src/sim/crowd/crowd.test.ts`

**Interfaces:**
- Consumes: `generateStore`, `findPath`, `isWalkable`, `accessCells`, `createRng`, `subSeed`.
- Produces:

```ts
export const SIM_STEP = 1 / 30;     // s
export const MAX_DT = 0.25;         // s; większe dt jest przycinane
export type AgentState = 'entering' | 'browsing' | 'toQueue' | 'queueing' | 'paying' | 'leaving' | 'gone';
export interface Agent {
  id: number;
  x: number; y: number;             // pozycja w kratkach (float, środek kratki = całkowita + 0.5)
  heading: number;                  // radiany, 0 = +x
  state: AgentState;
  moving: boolean;                  // do wyboru animacji walk/idle
  appearanceSeed: string;           // subSeed(seed, `agent:${id}`)
  speed: number;                    // kratki/s, 2.2–3.0
}
export interface CrowdOptions { targetCount: number; spawnPerMinute: number }
export interface Crowd { seed: string; time: number; agents: Agent[]; /* + stan wewnętrzny */ }
export function createCrowd(layout: StoreLayout, seed: string, opts: CrowdOptions): Crowd;
/** Przycina dt do MAX_DT i wykonuje kroki SIM_STEP. Usuwa agentów 'gone'. */
export function stepCrowd(crowd: Crowd, layout: StoreLayout, dt: number): void;
```

Zachowanie (wersja demonstracyjna, w etapie 2 ją rozbudujemy):
- Spawn w `spawnPoints`, dopóki agentów jest mniej niż `targetCount`, w tempie `spawnPerMinute`.
- Droga: wejście → 1–3 losowe meble (kratka dostępu) → 2–5 s przy każdym → koniec kolejki → przesuwanie po zwolnieniu miejsca → płacenie 3–6 s na `[0]` → wyjście na drugi `spawnPoint` → `gone`.
- **Rezerwacja kratek:** agent wchodzi do następnej kratki tylko wtedy, gdy jest wolna. Po 2 s czekania wyznacza nową trasę z zajętymi kratkami jako przeszkodami. Po 5 s może przejść „na ducha”, żeby uniknąć zakleszczenia.

- [ ] **Step 1: Napisz testy**
  - `determinizm`: dwa tłumy z tym samym seedem po 600 wywołaniach `stepCrowd(c, l, SIM_STEP)` dają identyczny `JSON.stringify(c.agents)`.
  - `pełny cykl`: `targetCount: 1` → w ciągu 120 s symulacji agent przechodzi kolejno przez stany `entering → browsing → toQueue → queueing → paying → leaving → gone`; zapisuj sekwencję stanów.
  - `FIFO kolejki`: przy 5 agentach kolejność wejścia w `paying` zgadza się z kolejnością wejścia w `queueing`.
  - `brak kolizji`: przy 30 agentach i 60 s symulacji, w każdym kroku żadna kratka nie ma dwóch agentów, którzy nie są w trybie ducha.
  - `nie przenika ścian`: w każdym kroku `isWalkable(layout, floor(x), floor(y))` jest prawdą dla każdego agenta.
  - `skok czasu`: `stepCrowd(c, l, 30)` zwiększa `c.time` o dokładnie `MAX_DT` (z dokładnością do 1e-9).
  - `wydajność`: 60 agentów i 30 s symulacji w Node trwa < 200 ms.
- [ ] **Step 2:** `npm test -- crowd`. Oczekiwane: FAIL.
- [ ] **Step 3:** Zaimplementuj `crowd.ts` jako maszynę stanów na agenta. Ruch to interpolacja liniowa między środkami kratek ścieżki A*.
- [ ] **Step 4:** `npm test`. Oczekiwane: PASS.
- [ ] **Step 5: Commit** `feat(sim): demonstracyjny tłum klientów z kolejką`.

---

### Task 6: Styl wizualny w kodzie

**Model:** Opus

**Files:**
- Create: `src/render/style.ts`, `docs/style-guide.md`

**Interfaces:**
- Produces:

```ts
export const PALETTE: {
  brand: { green: string; greenDark: string; orange: string; cream: string };
  floor: string[]; wall: string[]; fixture: Record<'shelf' | 'fridgeFrame' | 'counter' | 'wood' | 'metal', string>;
  productCategory: Record<'napoje' | 'nabial' | 'slodycze' | 'przekaski' | 'pieczywo' | 'chemia' | 'alkohol', string[]>;
  skin: string[]; hair: string[]; clothes: string[];
  street: Record<'asphalt' | 'sidewalk' | 'curb' | 'blokPastel' | 'kamienicaPlaster', string[]>;
};
export const BEVEL: { small: number; medium: number };   // metry, do RoundedBoxGeometry
export function material(kind: 'plasticMatte' | 'plasticGloss' | 'metalPainted' | 'glass' | 'wood' | 'emissive' | 'fabric',
  color: string, opts?: { emissiveIntensity?: number; opacity?: number }): import('three').Material; // z cache
export const LIGHT_PRESETS: Record<'day' | 'night', { sun: { color: string; intensity: number; elevationDeg: number; azimuthDeg: number };
  hemi: { sky: string; ground: string; intensity: number }; envIntensity: number; exposure: number; bloomStrength: number }>;
export const CHARACTER_STYLE: { headScale: number; handScale: number; heightRange: [number, number]; widthRange: [number, number] };
```

- [ ] **Step 1:** Ustal paletę i materiały według §13 specu (Two Point: ciepło, nasycenie, czytelność z daleka; marka: zieleń + pomarańcz). `material()` cache'uje instancje po kluczu `kind:color:opts`.
- [ ] **Step 2:** `docs/style-guide.md`, maks. 1 strona: zasady proporcji (meble lekko przysadziste, grube blaty, fazowanie wszędzie), minimalna liczba detali na mebel (≥ 3 części składowe), zasady światła dzień/noc, zasady humoru w grafice (plakaty, cenówki z żartami). To kryteria, według których Sonnet buduje meble w zadaniach 8–12.
- [ ] **Step 3:** `npm run typecheck`. Oczekiwane: 0 błędów.
- [ ] **Step 4: Commit** `feat(render): styl wizualny i przewodnik`.

---

### Task 7: Renderer, kamera izometryczna, presety jakości, postprocessing

**Model:** Sonnet

**Files:**
- Create: `src/render/quality.ts`, `src/render/renderer.ts`, `src/render/cameraRig.ts`, `src/render/lighting.ts`, `src/render/post.ts`, `src/render/coords.ts`
- Test: `src/render/quality.test.ts`, `src/render/cameraRig.test.ts`, `src/render/coords.test.ts`

**Interfaces:**
- Consumes: `LIGHT_PRESETS`, `PALETTE` (Task 6); `StoreLayout`, `CELL_SIZE_M` (Task 3).
- Produces:

```ts
// quality.ts
export type QualityPresetId = 'niska' | 'srednia' | 'wysoka';
export interface QualitySettings { maxPixelRatio: number; shadowMapSize: number; ao: 'off' | 'half' | 'full'; bloom: boolean; smaa: boolean }
export const QUALITY: Record<QualityPresetId, QualitySettings>; // niska {1,1024,off,false,true}, srednia {1.5,2048,half,true,true}, wysoka {2,4096,full,true,true}
export interface DeviceCaps { webgl2: boolean; isMobile: boolean }
export function pickInitialPreset(caps: DeviceCaps): QualityPresetId; // !webgl2 || isMobile → 'niska', inaczej 'srednia'

// cameraRig.ts
export const ISO_PITCH_DEG = 35.264;
export function computeFrustum(aspect: number, viewSize: number): { left: number; right: number; top: number; bottom: number };
export class CameraRig {
  readonly camera: import('three').OrthographicCamera;
  yawIndex: 0 | 1 | 2 | 3;            // yaw = 45° + 90° · yawIndex
  constructor(aspect: number);
  rotate(dir: 1 | -1): void;
  zoomBy(factor: number): void;       // viewSize w [6, 30], domyślnie 14
  panBy(dx: number, dz: number): void;
  setBounds(minX: number, minZ: number, maxX: number, maxZ: number): void; // pan ograniczony + margines 4 m
  resize(aspect: number): void;
  onChange(cb: () => void): void;     // np. dla cutaway ścian
}

// coords.ts
export function cellToWorld(layout: StoreLayout, x: number, y: number): { x: number; z: number }; // środek sklepu w (0,0)

// renderer.ts
export interface RenderContext { renderer: import('three').WebGLRenderer; scene: import('three').Scene; rig: CameraRig;
  setPreset(id: QualityPresetId): void; setTimeOfDay(t: 'day' | 'night'): void; render(): void; dispose(): void }
export function createRenderContext(canvas: HTMLCanvasElement, preset: QualityPresetId): RenderContext;

// post.ts
export interface PostPipeline { render(): void; setSize(w: number, h: number): void; setPreset(q: QualitySettings): void; aoAvailable: boolean }
export function createPostPipeline(renderer: import('three').WebGLRenderer, scene: import('three').Scene,
  camera: import('three').Camera, q: QualitySettings): PostPipeline; // N8AO → EffectPass(SMAA, bloom, winieta)
```

- [ ] **Step 1: Testy czystych funkcji**
  - `computeFrustum(2, 10)` daje `{ left: -10, right: 10, top: 5, bottom: -5 }`; przy proporcjach 0,5 szerokość jest mniejsza od wysokości.
  - `pickInitialPreset({ webgl2: false, isMobile: false })` daje `'niska'`; `({ webgl2: true, isMobile: false })` daje `'srednia'`.
  - `CameraRig.rotate(1)` czterokrotnie wraca do `yawIndex` 0 i do tej samej pozycji kamery (z dokładnością do 1e-6).
  - `cellToWorld` dla środkowej kratki sklepu 18×28 daje wynik bliski (0, 0), a sąsiednie kratki są od siebie odległe o `CELL_SIZE_M`.
- [ ] **Step 2:** `npm test`. Oczekiwane: FAIL. Zaimplementuj moduły.
- [ ] **Step 3: Renderer**
  - `toneMapping` = AgX, `outputColorSpace` = sRGB, `shadowMap.type` = `PCFShadowMap`.
  - `RoomEnvironment` przez `PMREMGenerator` jako `scene.environment`.
  - `DirectionalLight` z kamerą cienia dopasowaną do granic sklepu i `HemisphereLight` z `LIGHT_PRESETS`.
  - `resize` na zdarzenie `resize` okna oraz przy zmianie `devicePixelRatio` (przez `matchMedia`).
- [ ] **Step 4: Fallback.**
  - Gdy `canvas.getContext('webgl2')` zwraca `null` albo `createPostPipeline` rzuci wyjątek, ustaw `aoAvailable = false`, przejdź na preset `niska` i wyślij zdarzenie `traszka:notice` z tekstem „Twoja przeglądarka nie obsługuje pełnej grafiki. Włączyliśmy tryb oszczędny.”
  - Test jednostkowy: `createPostPipeline` z atrapą, która rzuca w konstruktorze N8AO, zwraca pipeline z `aoAvailable === false`.
- [ ] **Step 5:** `npm test` daje PASS. Następnie `npm run dev` ze sceną testową (`?scene=test`: kilka zaokrąglonych brył na podłodze). Sprawdź: cienie i AO widoczne na presecie Średnia, zmiana rozmiaru okna bez rozciągania obrazu, obrót kamery co 90°. Zrzut: `docs/screens/etap1/t7-test-scene.png`.
- [ ] **Step 6: Commit** `feat(render): renderer, kamera izometryczna, presety i postprocessing`.

---

### Task 8: Bryła sklepu i meble proceduralne

**Model:** Sonnet

**Files:**
- Create: `src/render/store/buildStore.ts`, `src/render/store/shell.ts`, `src/render/store/signTexture.ts`, `src/render/store/fixtures/index.ts` oraz po jednym pliku na rodzaj mebla w `src/render/store/fixtures/` (`gondola.ts`, `wallShelf.ts`, `fridge.ts`, `checkout.ts`, `tobaccoShelf.ts`, `hotFood.ts`, `coffee.ts`, `selfCheckout.ts`, `slotMarker.ts`, `backroomDoor.ts`)
- Test: `src/render/store/buildStore.test.ts`

**Interfaces:**
- Consumes: `StoreLayout`, `Fixture` (Task 3), `cellToWorld` (Task 7), `PALETTE`, `material`, `BEVEL` (Task 6).
- Produces:

```ts
export type FixtureBuilder = (f: Fixture) => import('three').Object3D; // origin w lewym-przednim rogu footprintu, oś +x/+z
export const FIXTURE_BUILDERS: Record<FixtureKind, FixtureBuilder>;
export interface StoreView {
  root: import('three').Group;
  shelfSlots: { fixtureId: string; position: [number, number, number]; width: number; depth: number; levels: number }[]; // dla Task 9
  setCutaway(yawIndex: 0 | 1 | 2 | 3): void;   // ściany od strony kamery obniżone do 0,5 m
  setExteriorMode(on: boolean): void;          // pełne ściany i szyld (widok z zewnątrz)
  dispose(): void;
}
export function buildStore(layout: StoreLayout): StoreView;
export function makeSignTexture(text: string): import('three').CanvasTexture; // „TRASZKA” + traszka-logo
```

Minimalny detal (z `docs/style-guide.md`, kryterium odbioru):
- **gondola:** cokół, słupki, ≥ 4 półki z listwą cenową, nadstawka z tabliczką kategorii.
- **lodówka:** rama, szklane drzwi (`glass`), świecąca listwa w środku, półki.
- **kasa:** blat z zaokrągleniem, ekran, terminal płatniczy, koszyk na zdrapki.
- **tobaccoShelf:** zamykane fronty, podświetlenie.
- **hotFood:** rolki do hot-dogów z grzałką (emissive), szyba.
- **coffee:** ekspres z tacką i kubkami.
- **selfCheckout:** słupek z ekranem i półką.
- **sloty:** półprzezroczysty znacznik z ikoną „+”.
- **Wszystkie krawędzie** fazowane przez `RoundedBoxGeometry`.
- **Podłoga:** płytki z fugą (tekstura z canvasu). **Witryna:** szyby w ramach. **Drzwi:** wejście z matą. **Sufit:** lampy jako emissive na słupkach lub zawieszeniach, bez pełnego sufitu.

- [ ] **Step 1: Testy (Node + three bez WebGL):** `buildStore(generateStore('kiełbasa-42'))`
  - ma w `root` obiekt dla każdego `fixture.id` (nazwa obiektu = id),
  - `shelfSlots.length > 0`,
  - każdy `FIXTURE_BUILDERS[kind]` wywołany osobno (przed scaleniem geometrii w `buildStore`) zwraca obiekt z ≥ 3 siatkami, a `gondola` i `fridge` z ≥ 8 (miara „nie klocki”),
  - `setCutaway(0)` obniża co najmniej jedną ścianę do wysokości ≤ 0,5 m.
- [ ] **Step 2:** `npm test`. Oczekiwane: FAIL. Zaimplementuj.
- [ ] **Step 3:** `npm test` daje PASS. `npm run dev`, adres `?seed=kiełbasa-42`. Sprawdź: brak błędów w konsoli, `renderer.info.render.calls` < 300 (scal geometrie statyczne przez `mergeGeometries` per materiał). Zrzuty: `docs/screens/etap1/t8-<seed>.png` dla 3 seedów (po jednym na rodzaj lokalu; znajdź je przez `pickLot`).
- [ ] **Step 4: Commit** `feat(render): bryła sklepu i meble proceduralne`.

---

### Task 9: Towar na półkach

**Model:** Sonnet

**Files:**
- Create: `src/render/store/products.ts`
- Test: `src/render/store/products.test.ts`

**Interfaces:**
- Consumes: `StoreView.shelfSlots` (Task 8), `PALETTE.productCategory` (Task 6), `createRng`, `subSeed`.
- Produces: `export function fillShelves(view: StoreView, seed: string): import('three').Group;`. Grupa zawiera `InstancedMesh` po jednym na kształt: `box`, `bottle` (LatheGeometry), `can`, `bag`, `carton`, `jar`. Kolor per instancja przez `setColorAt`.

- [ ] **Step 1: Testy:** dla `kiełbasa-42`
  - liczba instancji ≥ 80% pojemności `shelfSlots` (pojemność = suma `floor(width / 0,12) × levels`),
  - liczba obiektów `InstancedMesh` ≤ 8,
  - ten sam seed daje identyczne macierze pierwszych 10 instancji.
- [ ] **Step 2:** FAIL, potem implementacja (kategoria per odcinek półki z seeda; lodówki: butelki i kartony; gondole: mieszanka; drobne losowe przesunięcia i obroty dla naturalności), potem PASS.
- [ ] **Step 3:** W `npm run dev` półki wyglądają na pełne, a draw calls rosną o ≤ 10. Zrzut `docs/screens/etap1/t9-polki.png`.
- [ ] **Step 4: Commit** `feat(render): instancjonowany towar na półkach`.

---

### Task 10: Pozyskanie assetów CC0 i pipeline

**Model:** Haiku. **Przed pobraniem zapytaj użytkownika o zgodę i podaj listę plików ze źródłami i rozmiarami.** Jeśli bezpośrednie linki nie działają (itch.io), poproś użytkownika o ręczne pobranie do `assets-src/`.

**Files:**
- Create: `scripts/process-assets.mjs`, `src/render/assets.ts`, `public/assets/LICENSES.md`, `public/assets/characters/*.glb`, `public/assets/props/*.glb`
- Modify: `tests/architecture.test.ts` (dodaj test licencji)

**Interfaces:**
- Produces:

```ts
export const ASSETS: {
  characters: { ubc: { male: string; female: string; hair: string[] }; modular: string[]; animations: string };
  props: Record<'tree1' | 'tree2' | 'bench' | 'bin' | 'lamp' | 'van', string>;
};
export function loadGLB(url: string): Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>; // z MeshoptDecoder, cache po url
```

Paczki:
- Quaternius Universal Base Characters (Standard),
- Quaternius Universal Animation Library (Standard),
- Quaternius Ultimate Modular Men i Women,
- Kenney Nature Kit, Car Kit i City Kit Roads (latarnie, ławki).

- [ ] **Step 1:** Zgoda użytkownika → pobranie do `assets-src/<paczka>/`. Zapisz w `LICENSES.md`: paczka, autor, licencja (CC0), URL, data pobrania. Sprawdź też licencję `n8ao` (README podaje CC0-1.0, npm ISC). Obie pozwalają na użycie, ale wpisz stan faktyczny z `node_modules/n8ao/package.json` i pliku LICENSE do sekcji „Biblioteki” w `LICENSES.md`.
- [ ] **Step 2:** `scripts/process-assets.mjs` (gltf-transform API): `dedup`, `weld`, `prune`; dla postaci `simplify` do ~3000 trójkątów (`meshoptimizer`), na końcu `meshopt` compress. Wyniki trafiają do `public/assets/...`. Wypisz tabelę: plik, trójkąty, KB.
- [ ] **Step 3: Test licencji** w `tests/architecture.test.ts`: każda nazwa pliku `.glb` z `public/assets/**` występuje w `public/assets/LICENSES.md`.
- [ ] **Step 4:** `node scripts/process-assets.mjs && npm test`. Oczekiwane: tabela plików, PASS.
- [ ] **Step 5: Commit** `feat(assets): assety CC0 i pipeline gltf-transform`. Bez `assets-src/`, który jest w `.gitignore`.

---

### Task 11: Postacie

**Model:** Sonnet

**Files:**
- Create: `src/render/characters/appearance.ts`, `src/render/characters/characterFactory.ts`, `src/render/characters/fallbackCharacter.ts`, `src/render/characters/charTestPage.ts`
- Test: `src/render/characters/appearance.test.ts`, `src/render/characters/characterFactory.test.ts`

**Interfaces:**
- Consumes: `loadGLB`, `ASSETS` (Task 10); `PALETTE`, `CHARACTER_STYLE` (Task 6); `createRng`.
- Produces:

```ts
// appearance.ts (czysta funkcja, bez three)
export interface Appearance { body: 'male' | 'female'; hairIndex: number; skin: string; hair: string; top: string; bottom: string;
  height: number; width: number; accessory: 'none' | 'backpack' | 'bag' | 'phone' }
export function pickAppearance(seed: string): Appearance;

// characterFactory.ts
export type CharacterPack = 'ubc' | 'modular';
export interface CharacterInstance { object: import('three').Object3D; setAnim(name: 'idle' | 'walk', fadeS?: number): void;
  update(dt: number): void; dispose(): void; readonly isFallback: boolean }
export interface CharacterFactory { create(appearanceSeed: string): CharacterInstance }
export function createCharacterFactory(pack: CharacterPack, load?: typeof loadGLB): Promise<CharacterFactory>;
```

- [ ] **Step 1: Testy**
  - `pickAppearance` jest deterministyczny.
  - 100 seedów daje ≥ 6 różnych par `skin + hair` i oba typy `body`.
  - `height` mieści się w `CHARACTER_STYLE.heightRange`.
  - `createCharacterFactory('ubc', () => Promise.reject(new Error('404')))` zwraca fabrykę, której `create('x').isFallback === true`, i nie rzuca (Review Focus 5).
- [ ] **Step 2:** FAIL, potem implementacja:
  - klon przez `SkeletonUtils.clone`,
  - kolory przez klonowane materiały per część (skóra, włosy, góra, dół),
  - skala z `Appearance` i przesada proporcji z `CHARACTER_STYLE.headScale` przez skalę kości głowy i dłoni,
  - akcesoria doczepione do kości kręgosłupa lub dłoni,
  - jeden `AnimationMixer` na postać, klipy `Idle_Loop` i `Walk_Loop` z UAL (gdy nazwy się różnią, dopasuj po `/idle/i` i `/walk/i`),
  - postać zastępcza: kapsuła + kula w kolorach z `Appearance`, z kiwaniem w chodzie.
  Potem PASS.
- [ ] **Step 3:** Strona porównawcza `?charTest=1`: 10 postaci `ubc` obok 10 `modular`, wszystkie w chodzie, z obracającą się kamerą. Zrzut `docs/screens/etap1/t11-porownanie.png`. Tę stronę ocenia Opus w zadaniu 16.
- [ ] **Step 4: Commit** `feat(render): postacie z wyglądem z seeda i animacjami`.

---

### Task 12: Ulica i otoczenie

**Model:** Sonnet

**Files:**
- Create: `src/render/street/buildStreet.ts`, `src/render/street/facadeAtlas.ts`, `src/render/street/buildings.ts`
- Test: `src/render/street/buildStreet.test.ts`

**Interfaces:**
- Consumes: `StoreLayout` (Task 3), `cellToWorld` (Task 7), `PALETTE`, `material` (Task 6), `loadGLB`, `ASSETS` (Task 10), `createRng`, `subSeed`.
- Produces:

```ts
export interface StreetView { root: import('three').Group; setBuildingCutaway(on: boolean): void; dispose(): void }
export function buildStreet(layout: StoreLayout, seed: string): Promise<StreetView>;
export function createFacadeAtlas(): { map: import('three').CanvasTexture; emissive: import('three').CanvasTexture;
  cell(name: 'okno' | 'loggia' | 'szewPlyty' | 'tynk' | 'witryna' | 'brama' | 'gzyms'): [number, number, number, number] };
```

Zakres:
- Chodnik z płyt (wiersze 0–3), krawężnik, jezdnia z pasami i przejściem dla pieszych.
- Budynek nad sklepem zależny od `lot.kind`:
  - **blok:** 5 kondygnacji, siatka paneli, loggie, pastelowe kolory,
  - **kamienica:** 3–4 kondygnacje, tynk, gzyms, brama obok sklepu,
  - **pawilon:** 1 kondygnacja, płaski dach, attyka z szyldem.
- Sąsiednie budynki po bokach w pełnej wysokości.
- Nad sklepem w trybie cutaway widać tylko strop z „przekrojem” (krawędź płyty). Pełny budynek pojawia się, gdy `setBuildingCutaway(false)`.
- 2–4 drzewa, 2 latarnie, ławka, kosz i zaparkowany dostawczak, rozmieszczone według seeda.
- Okna z tekstury emissive świecą nocą.

- [ ] **Step 1: Testy:** dla każdego rodzaju lokalu `buildStreet` zwraca `root` z obiektem `building:<kind>`; przy `setBuildingCutaway(true)` żaden mesh nad sklepem nie przekracza wysokości stropu (3,2 m); ten sam seed daje te same pozycje drzew.
- [ ] **Step 2:** FAIL, potem implementacja (budynki jako zmergowana geometria z UV do atlasu), potem PASS.
- [ ] **Step 3:** Zrzuty `docs/screens/etap1/t12-<kind>.png` dla bloku, kamienicy i pawilonu, w dzień i w nocy.
- [ ] **Step 4: Commit** `feat(render): ulica, budynki proceduralne i otoczenie`.

---

### Task 13: Pętla gry i połączenie tłumu z renderem

**Model:** Sonnet

**Files:**
- Create: `src/game/loop.ts`, `src/render/crowdView.ts`, `src/game/world.ts`
- Modify: `src/main.ts`
- Test: `src/game/loop.test.ts`

**Interfaces:**
- Consumes: `createCrowd`, `stepCrowd`, `SIM_STEP` (Task 5); `generateStore` (Task 4); `createRenderContext` (Task 7); `buildStore` (Task 8); `fillShelves` (Task 9); `createCharacterFactory` (Task 11); `buildStreet` (Task 12).
- Produces:

```ts
// loop.ts
export type Speed = 0 | 1 | 2 | 4 | 8;
export const MAX_FRAME_DT = 0.1;          // s
export const MAX_STEPS_PER_FRAME = 32;
/** Zwraca liczbę kroków SIM_STEP do wykonania; mutuje clock.acc. Porównanie acc ≥ SIM_STEP z tolerancją 1e-9. */
export function advanceClock(clock: { acc: number }, frameDt: number, speed: Speed): number;

// world.ts
export interface World { seed: string; layout: StoreLayout; crowd: Crowd; speed: Speed }
export function createWorld(seed: string): World;   // generateStore + createCrowd({ targetCount: 12, spawnPerMinute: 10 })

// crowdView.ts
export class CrowdView { constructor(factory: CharacterFactory, layout: StoreLayout, parent: import('three').Object3D);
  sync(crowd: Crowd, alpha: number, frameDt: number): void; dispose(): void }
```

- [ ] **Step 1: Testy `advanceClock`:**
  - `({acc:0}, 1/30, 1)` daje 1,
  - `({acc:0}, 5, 8)` daje 24 (dt przycięte do 0,1 s; Review Focus 2),
  - `({acc:0}, 0.05, 0)` daje 0 przy `acc` bez zmian,
  - wynik nigdy nie przekracza `MAX_STEPS_PER_FRAME`.
- [ ] **Step 2:** FAIL, potem implementacja, potem PASS.
- [ ] **Step 3: `CrowdView`:**
  - tworzy postać przy nowym `agent.id` i zwalnia ją przy zniknięciu agenta,
  - pozycja z `cellToWorld`, wygładzanie kierunku (slerp ≤ 10 rad/s),
  - animacja `walk`, gdy `agent.moving`, inaczej `idle`,
  - prędkość animacji chodu skalowana do `agent.speed`.
- [ ] **Step 4: `main.ts`:**
  - seed z `?seed=`, a bez niego czytelny losowy seed (`crypto.getRandomValues` → słowo z listy + liczba, np. „pierogi-731”; lista 50 słów w `src/game/seedWords.ts`) wpisany do adresu przez `history.replaceState`,
  - obsługa myszy: przeciąganie prawym przyciskiem = pan, kółko = zoom, Q/E = obrót.
- [ ] **Step 5:** `npm run dev`: klienci wchodzą, chodzą między półkami, stoją w kolejce i wychodzą, a chód zgadza się z ruchem (nogi się nie ślizgają).
- [ ] **Step 6: Commit** `feat(game): pętla gry i tłum w scenie`.

---

### Task 14: Powłoka UI

**Model:** Haiku

**Files:**
- Create: `src/ui/state.ts`, `src/ui/App.tsx`, `src/ui/TopBar.tsx`, `src/ui/PerfOverlay.tsx`, `src/ui/Notice.tsx`, `src/ui/ui.css`
- Modify: `src/main.ts` (montaż `App` w `#ui`, podpięcie sygnałów do `World` i `RenderContext`)

**Interfaces:**
- Consumes: `World`, `Speed` (Task 13); `RenderContext`, `QualityPresetId` (Task 7).
- Produces: sygnały w `state.ts`:

```ts
export const seed: Signal<string>; export const preset: Signal<QualityPresetId>; export const speed: Signal<Speed>;
export const timeOfDay: Signal<'day' | 'night'>; export const perf: Signal<{ fps: number; ms: number; calls: number; tris: number }>;
export const showPerf: Signal<boolean>; export const notice: Signal<string | null>;
```

Elementy (układ paska jak w szkicu `.superpowers/brainstorm/*/content/ekrany-gry.html`, klasa `.tt-hud`):
- znaczek „TRASZKA”,
- pole seeda z przyciskami „Generuj” i „Losuj”,
- prędkość (❚❚ ×1 ×2 ×4 ×8),
- obrót kamery (⟲ ⟳),
- przełącznik „Dzień / Noc”,
- wybór jakości (Niska / Średnia / Wysoka),
- nakładka wydajności (FPS, ms, draw calls, trójkąty) przełączana klawiszem F3 albo przez `?perf=1`,
- komunikat z `traszka:notice` jako pasek u góry.

Kolory z `PALETTE.brand`. Wszystkie teksty po polsku.

- [ ] **Step 1:** Implementacja komponentów i sygnałów. „Generuj” odtwarza świat (`createWorld`) bez przeładowania strony.
- [ ] **Step 2:** `npm run typecheck && npm run build` kończą się kodem 0.
- [ ] **Step 3:** `npm run dev`: każdy przycisk robi to, co opisuje. Zmiana jakości działa na żywo, a F3 pokazuje liczby. Zrzut `docs/screens/etap1/t14-ui.png`.
- [ ] **Step 4: Commit** `feat(ui): powłoka interfejsu`.

---

### Task 15: Benchmark

**Model:** Sonnet

**Files:**
- Create: `src/bench/bench.ts`, `docs/benchmarks/etap1.md`
- Modify: `src/main.ts` (tryb `?bench=1`)

**Interfaces:**
- Consumes: `createWorld` (Task 13), `RenderContext` (Task 7).
- Produces: `window.__benchResult: { preset: QualityPresetId; avgFps: number; p95FrameMs: number; calls: number; tris: number }[]`.

- [ ] **Step 1:** Implementacja `?bench=1`:
  - seed `bench`, tłum `targetCount: 60` z natychmiastowym spawnem,
  - dla każdego presetu: 5 s rozgrzewki i 20 s pomiaru,
  - na koniec tabela w konsoli i w nakładce oraz `window.__benchResult`.
- [ ] **Step 2:** Uruchom na Macu użytkownika (panel przeglądarki, `npm run preview`). Wyniki wpisz do `docs/benchmarks/etap1.md`. Kryterium: `srednia.avgFps ≥ 55`. Jeśli nie jest spełnione, zapisz, co zjada czas (AO? cienie? skinning?), i oddaj sprawę do zadania 16.
- [ ] **Step 3: Commit** `feat(bench): benchmark wydajności etapu 1`.

---

### Task 16: Art pass

**Model:** Opus

**Files:**
- Modify: `src/render/style.ts`, `src/render/lighting.ts`, `src/render/characters/characterFactory.ts` (domyślny pack i proporcje), wybrane pliki z `src/render/store/fixtures/`, `docs/style-guide.md`
- Create: `src/render/store/props.ts` (plakaty Centrali z żartobliwymi hasłami, roślina, stojak z gazetami, kosz, mata „Witamy w Traszce”, tabliczka „Tylko dla personelu”)

- [ ] **Step 1:** Na podstawie `?charTest=1` wybierz pack postaci bliższy Two Point i dostrój `CHARACTER_STYLE`. Decyzję wpisz do `docs/style-guide.md`.
- [ ] **Step 2:** Dostrój światło dzień/noc (noc: neon szyldu, światło z witryny, latarnie, bloom), materiały i kolory. Dodaj rekwizyty i plakaty, które niosą humor (teksty po polsku, bez prawdziwych marek).
- [ ] **Step 3:** Zrzuty końcowe: `docs/screens/etap1/final-<seed>-<day|night>.png` dla 3 seedów (blok, kamienica, pawilon).
- [ ] **Step 4:** Ponowny benchmark (`?bench=1`): `srednia.avgFps ≥ 55`. Aktualizacja `docs/benchmarks/etap1.md`.
- [ ] **Step 5: Commit** `style: art pass etapu 1`.

---

### Task 17: Przegląd etapu i brama wyglądu

**Model:** Opus (przegląd) + użytkownik (akceptacja)

- [ ] **Step 1:** Przegląd całej gałęzi względem specu (§5.1, §5.2, §13, §14) i Global Constraints. `npm test`, `npm run typecheck` i `npm run build` są zielone.
- [ ] **Step 2:** Pokaz dla użytkownika:
  - `npm run preview` w panelu przeglądarki,
  - zrzuty końcowe przez SendUserFile,
  - opcjonalnie publikacja buildu jako prywatnej strony claude.ai (do obejrzenia na telefonie), wyłącznie za zgodą użytkownika.
- [ ] **Step 3: Brama.** Zapisz decyzję użytkownika w `docs/style-guide.md` (sekcja „Akceptacja etapu 1”):
  - **akceptacja** odblokowuje zadania renderu etapu 2,
  - **uwagi** trafiają jako poprawki do zadania 16 i potem powtarzamy zadanie 17.
- [ ] **Step 4: Commit** `docs: akceptacja wyglądu etapu 1`.

import { generateStore } from '@/sim/store/generateStore';
import { SEED_NEIGHBOUR_MAX, SEED_TEXT_MAX, canonicalSeedText } from './seedText';
import { randomSeed } from './seedWords';
import { hasStoredSave } from './session';

/** Ile razy losujemy seed, zanim zaczniemy numerować ostatnie losowanie. Seedów jest 45 000, więc kolizja jest rzadka. */
const DRAWS = 20;

/** Najwyższy numer dopisywany do seeda. Prawdziwy magazyn ma skończenie wiele zapisów; ten limit tylko chroni przed zawieszeniem strony, gdyby `isTaken` kłamało. */
const MAX_NUMBER = 1000;

/**
 * Seed nowego sklepu, pod którym nic jeszcze nie leży: nowa gra (`fresh`) nie czyta zapisu, a pierwszy zapis po otwarciu
 * zastąpiłby cudzy, więc losowy seed nie może trafić w seed z zapisem (poprawnym, uszkodzonym ani z nowszej wersji gry).
 * Losuje do 20 razy; gdy każdy z 20 jest zajęty, dopisuje do ostatniego `·2`, `·3`… i bierze pierwszy wolny (po `MAX_NUMBER`
 * numerach oddaje ostatni, żeby nie zawiesić strony przy magazynie, który twierdzi, że zajęte jest wszystko).
 * `draw` to losowanie seeda (`randomSeed`), `isTaken` mówi, czy pod seedem leży zapis (`hasStoredSave`).
 */
export function freeSeed(draw: () => string, isTaken: (seed: string) => boolean): string {
  let last = '';
  for (let i = 0; i < DRAWS; i++) {
    last = draw();
    if (!isTaken(last)) return last;
  }
  let numbered = last;
  for (let n = 2; n <= MAX_NUMBER; n++) {
    numbered = `${last}·${n}`;
    if (!isTaken(numbered)) return numbered;
  }
  return numbered;
}

// --- Seed wpisany przez gracza (ekran startowy i ⚙) ---------------------------------------------------------------------

/** Najwięcej znaków (punktów kodowych, więc emoji liczy się za jeden) seeda po normalizacji. Definicja w `seedText.ts` (współdzieli ją serwer). */
export const SEED_MAX = SEED_TEXT_MAX;

export const NEIGHBOUR_STORE_NOTICE = 'Ten lokal się nie zmieścił, otwieramy sąsiedni';
export const EXISTING_STORE_NOTICE = 'Wczytujemy Twój sklep spod tego seeda';

/** Co seedy wiedzą o świecie wokół siebie: zapisy w przeglądarce, generator sklepu i losowanie. Do podmiany w testach. */
export interface SeedDeps {
  /** Czy pod seedem leży zapis (poprawny, uszkodzony albo z nowszej wersji gry): `hasStoredSave`. */
  hasSave: (seed: string) => boolean;
  /** Próba złożenia sklepu z seeda; rzuca, gdy generator go nie złoży. */
  build: (seed: string) => unknown;
  /** Losowanie seeda (słowo i liczba): `randomSeed`. */
  draw: () => string;
}

const REAL_DEPS: SeedDeps = { hasSave: hasStoredSave, build: (seed) => generateStore(seed), draw: () => randomSeed() };

/** Seed, z którego gra ma otworzyć sklep, i komunikat dla gracza, gdy to nie dokładnie ten, który wpisał (albo null). */
export interface ResolvedStore { seed: string; notice: string | null }

/**
 * Seed wpisany przez gracza w postaci, pod którą gra go zapamięta: NFC, przycięty, małymi literami, ze zwiniętymi spacjami, bez znaków
 * niewidocznych i do 40 znaków (czyszczenie to `canonicalSeedText` z `seedText.ts`, tę samą postać wymaga od seeda serwer rankingu:
 * `isCanonicalSeed`). Pusty tekst (też same spacje albo same znaki niewidoczne) to losowy seed z `draw` (domyślnie `randomSeed`).
 * Idempotentna. Jedyne miejsce, które mówi, jaki tekst jest seedem nowego sklepu: `chooseStore` używa jej, nie własnej kopii.
 */
export function normalizeSeed(raw: string, draw: () => string = randomSeed): string {
  return canonicalSeedText(raw) || draw();
}

/**
 * Wpis w polu „Seed sklepu” przycięty do `SEED_MAX` punktów kodowych (emoji to jeden znak, a nie dwie jednostki UTF-16, jak liczy
 * `maxLength`). To tylko limit pola: niczego więcej nie czyści (spacje, wielkość liter i znaki niewidoczne zostają do `normalizeSeed`),
 * i nigdy nie dzieli emoji na pojedynczy surogat.
 */
export function clipSeedInput(text: string): string {
  let count = 0;
  let end = 0;
  for (const c of text) {
    if (++count > SEED_MAX) break;
    end += c.length;
  }
  return end === text.length ? text : text.slice(0, end);
}

/** Seed, od którego zaczyna się wejście na stronę: `?seed=` z adresu, potem ostatnio grany sklep, potem losowy. */
export function entrySeed(fromUrl: string | null, lastSaved: string | null, draw: () => string = randomSeed): string {
  return fromUrl || lastSaved || draw();
}

const canBuild = (seed: string, build: SeedDeps['build']): boolean => {
  try {
    build(seed);
    return true;
  } catch {
    return false;
  }
};

/**
 * Wybiera seed NOWEGO sklepu przed jego otwarciem (samo otwarcie robi `openStore`). Gdy generator nie składa sklepu z `seed`,
 * próbuje po kolei `seed·1` … `seed·5` (deterministycznie: ten sam seed zawsze da ten sam lokal) i zwraca pierwszy, który
 * wstaje, z komunikatem o sąsiednim lokalu. Gdy żaden z sześciu nie wstaje, losowy seed bez zapisu pod spodem, z tym samym
 * komunikatem: ekran startowy zawsze dostaje sklep, z którego da się zagrać. Zapisów nie sprawdza (to robi `chooseStore`).
 */
export function resolveStore(seed: string, deps: Partial<SeedDeps> = {}): ResolvedStore {
  const d = { ...REAL_DEPS, ...deps };
  if (canBuild(seed, d.build)) return { seed, notice: null };
  for (let n = 1; n <= SEED_NEIGHBOUR_MAX; n++) {
    const next = `${seed}·${n}`;
    if (canBuild(next, d.build)) return { seed: next, notice: NEIGHBOUR_STORE_NOTICE };
  }
  return { seed: freeSeed(d.draw, d.hasSave), notice: NEIGHBOUR_STORE_NOTICE };
}

/**
 * Seed z pola „Seed sklepu” → sklep, który się otworzy. Zapis pod seedem wygrywa ze wszystkim: gracz dostaje swój sklep
 * („Wczytujemy Twój sklep spod tego seeda”) i nic go nie nadpisze (gra otwiera go bez `fresh`; od nowa zaczyna się tylko przez
 * ⚙ w tym sklepie). Zapisu szukamy po kolei pod tekstem wpisanym dosłownie, przyciętym i znormalizowanym: stare sklepy z wielkimi
 * literami albo ze spacją na brzegu (ręcznie edytowany adres `?seed=%20x`) powstały przed normalizacją i leżą pod swoim napisem.
 * Bez zapisu: seed znormalizowany przez `normalizeSeed` (jedna reguła dla pola, adresu i ⚙) idzie przez `resolveStore`. Pusty tekst
 * (też same spacje i znaki niewidoczne) to losowy seed spośród wolnych.
 */
export function chooseStore(raw: string, deps: Partial<SeedDeps> = {}): ResolvedStore {
  const d = { ...REAL_DEPS, ...deps };
  const seed = normalizeSeed(raw, () => freeSeed(d.draw, d.hasSave));
  for (const candidate of new Set([raw, raw.trim(), seed])) {
    if (candidate !== '' && d.hasSave(candidate)) return { seed: candidate, notice: EXISTING_STORE_NOTICE };
  }
  return resolveStore(seed, d);
}

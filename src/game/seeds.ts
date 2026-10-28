import { generateStore } from '@/sim/store/generateStore';
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

/** Najwięcej znaków (punktów kodowych, więc emoji liczy się za jeden) seeda po normalizacji. */
export const SEED_MAX = 40;

export const NEIGHBOUR_STORE_NOTICE = 'Ten lokal się nie zmieścił, otwieramy sąsiedni';
export const EXISTING_STORE_NOTICE = 'Wczytujemy Twój sklep spod tego seeda';

/** Ile sąsiednich lokali (`seed·1` … `seed·5`) próbujemy, gdy generator nie składa sklepu z samego seeda. */
const NEIGHBOURS = 5;

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
 * Tekst seeda po czyszczeniu (pusty, gdy nic nie zostało): NFC (ten sam napis to ten sam seed), znaki sterujące znikają
 * (tabulator i nowy wiersz to spacje), spacje zwinięte i przycięte, małe litery, najwyżej `SEED_MAX` znaków. Tnie po punktach
 * kodowych, więc emoji nie rozpada się na pojedynczy surogat, którego nie da się zapisać w adresie ani w kluczu.
 */
function cleanSeed(raw: string): string {
  const text = raw.normalize('NFC')
    .replace(/\p{Cc}/gu, (c) => (/\s/.test(c) ? ' ' : ''))
    .replace(/\s+/g, ' ').trim()
    .toLowerCase().normalize('NFC');
  return Array.from(text).slice(0, SEED_MAX).join('').trim();
}

/**
 * Seed wpisany przez gracza w postaci, pod którą gra go zapamięta: przycięty, małymi literami, ze zwiniętymi spacjami i do 40
 * znaków. Pusty tekst (też same spacje) to losowy seed z `draw` (domyślnie `randomSeed`). Idempotentna.
 */
export function normalizeSeed(raw: string, draw: () => string = randomSeed): string {
  return cleanSeed(raw) || draw();
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
  for (let n = 1; n <= NEIGHBOURS; n++) {
    const next = `${seed}·${n}`;
    if (canBuild(next, d.build)) return { seed: next, notice: NEIGHBOUR_STORE_NOTICE };
  }
  return { seed: freeSeed(d.draw, d.hasSave), notice: NEIGHBOUR_STORE_NOTICE };
}

/**
 * Seed z pola „Seed sklepu” → sklep, który się otworzy. Zapis pod seedem wygrywa ze wszystkim: gracz dostaje swój sklep
 * („Wczytujemy Twój sklep spod tego seeda”) i nic go nie nadpisze (gra otwiera go bez `fresh`; od nowa zaczyna się tylko przez
 * ⚙ w tym sklepie). Najpierw szukamy zapisu pod tekstem wpisanym dosłownie (stare sklepy z wielkimi literami powstały przed
 * normalizacją), potem pod znormalizowanym. Bez zapisu: znormalizowany seed przez `resolveStore`. Pusty tekst to losowy seed
 * spośród wolnych.
 */
export function chooseStore(raw: string, deps: Partial<SeedDeps> = {}): ResolvedStore {
  const d = { ...REAL_DEPS, ...deps };
  const cleaned = cleanSeed(raw);
  for (const candidate of new Set([raw.trim(), cleaned])) {
    if (candidate !== '' && d.hasSave(candidate)) return { seed: candidate, notice: EXISTING_STORE_NOTICE };
  }
  return resolveStore(cleaned || freeSeed(d.draw, d.hasSave), d);
}

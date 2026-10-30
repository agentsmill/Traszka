import { xpCurve } from './exactMath';

/**
 * Poziom gracza: doświadczenie (XP) z każdej czynności, nagroda za każdy poziom i rangi bez końca. Rangi to palety,
 * a nie osoby, więc nazwy nie mają rodzaju gramatycznego.
 */

/**
 * XP potrzebne, żeby z poziomu `level` wejść na następny. Rośnie wolniej niż wykładniczo: poziomy nie mają końca.
 * To `Math.round(120 * level ** 1.55)` liczone dokładnie (`xpCurve`), bo wynik `**` z ułamkiem zależy od silnika JS.
 */
export function xpToNext(level: number): number {
  return xpCurve(level);
}

/**
 * Gotówka za poziom: stała część plus kwota za każdy poziom (stała część wyrównuje małe i duże sklepy, balans: tycoon/balance.test.ts).
 * Od SIM_VERSION 5 (realny udział franczyzobiorcy w obrocie) to drobna nagroda: dawne 400 + 200 zł za poziom dawały biernemu ok.
 * 9 tys. zł miesięcznie, tyle co wcześniej wyrównywało mu opłatę Centrali.
 */
export const LEVEL_CASH = { base: 100, perLevel: 50 } as const;

/** Nagroda za wejście na poziom `level`. */
export function levelReward(level: number): { cash: number; ogonki: number } {
  return { cash: LEVEL_CASH.base + LEVEL_CASH.perLevel * level, ogonki: 2 + Math.floor(level / 2) };
}

/** XP za czynności (poza KPI tygodnia i kartami decyzji, które mają własną nagrodę). */
export const XP = {
  /** Za obsłużonego klienta: 1,3 od SIM_VERSION 5, bo klientów jest ok. 40% mniej (realny ruch), a poziomy mają przychodzić podobnie szybko. */
  customer: 1.3,
  /** Za rozładowaną paletę: 18 od SIM_VERSION 5 (paleta półtora raza większa, `PALLET_ITEMS`), na sztukę tyle co dawne 12. */
  pallet: 18,
  purchase: 20,
  golden: 40,
  milestonePerOgonek: 5,
} as const;

const RANKS: { from: number; name: string }[] = [
  { from: 1, name: 'Drewniana Paleta' },
  { from: 5, name: 'Paleta EURO' },
  { from: 10, name: 'Paleta w Folii' },
  { from: 15, name: 'Srebrna Paleta' },
  { from: 20, name: 'Złota Paleta' },
  { from: 30, name: 'Platynowa Paleta' },
  { from: 40, name: 'Diamentowa Paleta' },
  { from: 50, name: 'Legendarna Paleta' },
];

/** Ranga dla poziomu. Po 50. poziomie co 10 poziomów przybywa gwiazdka: rangi nie mają końca. */
export function rankFor(level: number): string {
  const rank = [...RANKS].reverse().find((r) => level >= r.from)!;
  if (level < 60) return rank.name;
  return `${rank.name} ${'★'.repeat(Math.min(5, Math.floor((level - 50) / 10)))}${level >= 110 ? ` +${Math.floor((level - 100) / 10)}` : ''}`;
}

/** Poziom, od którego zaczyna się następna ranga (do paska postępu rangi), albo null po ostatniej nazwanej. */
export function nextRankAt(level: number): number | null {
  return RANKS.find((r) => r.from > level)?.from ?? null;
}

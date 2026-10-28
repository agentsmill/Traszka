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

/** Nagroda za wejście na poziom `level`. */
export function levelReward(level: number): { cash: number; ogonki: number } {
  return { cash: 200 * level, ogonki: 2 + Math.floor(level / 2) };
}

/** XP za czynności (poza zleceniami, które mają własną nagrodę). */
export const XP = {
  customer: 1,
  pallet: 12,
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

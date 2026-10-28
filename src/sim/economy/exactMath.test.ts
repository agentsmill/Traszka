import { describe, expect, it } from 'vitest';
import { FINE_PALLET_POW, pow10Floor, powInt, xpCurve } from './exactMath';
import { niceRound } from './quests';
import { rand01 } from './rand';
import { EQUIPMENT, UPGRADES } from './upgrades';

/** Dawny wzór na największą potęgę dziesięciu ≤ n. */
const legacyPow10Floor = (n: number): number => 10 ** Math.floor(Math.log10(n));

/** `niceRound` sprzed zmiany (z `10 ** Math.floor(Math.log10(n))`). */
function legacyNiceRound(n: number): number {
  if (n <= 10) return Math.max(1, Math.round(n));
  const p = legacyPow10Floor(n);
  const m = n / p;
  const step = m < 2 ? 0.2 : m < 5 ? 0.5 : 1;
  return Math.round(m / step) * step * p;
}

/**
 * Dowody równoważności: wzory sprzed zmiany (`**`, `Math.log10`) liczone w V8 kontra dokładne odpowiedniki z `exactMath`.
 * Tu `**` i `Math.log10` wolno, bo test porównuje z dzisiejszymi liczbami gry; sam kod gry już ich nie używa.
 */
describe('exactMath', () => {
  it('powInt w cenach: każde ulepszenie i sprzęt, poziomy 0..maxLevel (sprzęt 0..50), ta sama cena co z **', () => {
    for (const def of UPGRADES) {
      for (let n = 0; n <= def.maxLevel; n++) {
        const exact = Math.round((def.baseCost * powInt(def.costMult, n)) / 50) * 50;
        const legacy = Math.round((def.baseCost * def.costMult ** n) / 50) * 50;
        expect(exact, `${def.id} poziom ${n}`).toBe(legacy);
      }
    }
    for (const def of EQUIPMENT) {
      for (let n = 0; n <= 50; n++) {
        const exact = Math.round((def.baseCost * powInt(def.costMult, n)) / 50) * 50;
        const legacy = Math.round((def.baseCost * def.costMult ** n) / 50) * 50;
        expect(exact, `${def.id} sztuka ${n}`).toBe(legacy);
      }
    }
  });

  it('powInt: potęgi zerowa i pierwsza oraz kilka ręcznie policzonych wartości', () => {
    expect(powInt(1.8, 0)).toBe(1);
    expect(powInt(1.8, 1)).toBe(1.8);
    expect(powInt(0, 0)).toBe(1);
    expect(powInt(0, 3)).toBe(0);
    expect(powInt(2, 10)).toBe(1024);
    expect(powInt(10, 15)).toBe(1e15);
  });

  it('FINE_PALLET_POW to n ** 1.4 co do bitu', () => {
    expect(FINE_PALLET_POW.length).toBe(41);
    for (let n = 0; n <= 40; n++) expect(FINE_PALLET_POW[n], `n = ${n}`).toBe(n ** 1.4);
  });

  it('pow10Floor jak 10 ** floor(log10 n)', () => {
    for (let n = 11; n <= 200_000; n++) expect(pow10Floor(n), `n = ${n}`).toBe(legacyPow10Floor(n));
    for (let e = 1; e <= 15; e++) {
      const p = 10 ** e;
      for (const n of [p, p * (1 + 2 ** -52)]) expect(pow10Floor(n), `n = ${n}`).toBe(legacyPow10Floor(n));
    }
    for (let i = 0; i < 10_000; i++) {
      const n = 11 + rand01(1, i) * 1e9;
      expect(pow10Floor(n), `n = ${n}`).toBe(legacyPow10Floor(n));
    }
  });

  /**
   * Tuż pod potęgą dziesięciu (p · (1 − 2^-52), p od 1e3) `Math.log10` w V8 zaokrągla w górę do całkowitego wykładnika, więc dawny
   * wzór dawał potęgę większą od `n` (np. 1000 dla 999,9999999999998), a dokładna odpowiedź to 100. To błąd dawnego wzoru, nie
   * `pow10Floor`, dlatego tu nie porównujemy `p` z dawnym, tylko sprawdzamy własność (największa potęga dziesięciu ≤ n) oraz
   * to, na czym polega gra: że `niceRound` daje te same liczby (p = 100 przy m ≈ 10 i p = 1000 przy m ≈ 1 kończą w tym samym punkcie).
   */
  it('pow10Floor tuż pod potęgą dziesięciu: własność największej potęgi, a niceRound bez zmian', () => {
    for (let e = 1; e <= 15; e++) {
      const n = 10 ** e * (1 - 2 ** -52);
      const p = pow10Floor(n);
      expect(p <= n && n < 10 * p, `n = ${n}, p = ${p}`).toBe(true);
      expect(niceRound(n), `n = ${n}`).toBe(legacyNiceRound(n));
    }
  });

  it('niceRound jak przed zmianą: liczby całkowite, potęgi dziesięciu z sąsiadami i losowe', () => {
    for (let n = 0; n <= 200_000; n++) expect(niceRound(n), `n = ${n}`).toBe(legacyNiceRound(n));
    for (let e = 1; e <= 15; e++) {
      const p = 10 ** e;
      for (const n of [p, p * (1 - 2 ** -52), p * (1 + 2 ** -52)]) expect(niceRound(n), `n = ${n}`).toBe(legacyNiceRound(n));
    }
    for (let i = 0; i < 10_000; i++) {
      const n = 11 + rand01(1, i) * 1e9;
      expect(niceRound(n), `n = ${n}`).toBe(legacyNiceRound(n));
    }
  });

  it('xpCurve jak Math.round(120 * level ** 1.55) dla poziomów 1..10 000', () => {
    for (let level = 1; level <= 10_000; level++) {
      expect(xpCurve(level), `poziom ${level}`).toBe(Math.round(120 * level ** 1.55));
    }
  });

  it('xpCurve: wartości przypięte na literałach, niezależnie od silnika', () => {
    // wartości z V8, a dokładny wynik w BigInt jest ten sam (patrz test wyżej)
    const pinned: [number, number][] = [[0, 0], [1, 120], [2, 351], [3, 659], [10, 4258], [50, 51_592], [100, 151_071], [500, 1_830_563],
      [1000, 5_360_203], [10_000, 190_187_183]];
    for (const [level, xp] of pinned) expect(xpCurve(level), `poziom ${level}`).toBe(xp);
  });
});

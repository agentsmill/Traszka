import { describe, expect, it } from 'vitest';
import { SEED_WORDS } from '@/game/seedWords';
import { generateStore } from '@/sim/store/generateStore';
import { isWeekSeed, weekOf } from './week';

const at = (y: number, m: number, d: number, h = 12): number => Date.UTC(y, m - 1, d, h);

describe('tydzień rankingu (tydzień ISO w UTC)', () => {
  it('numer tygodnia ISO: poniedziałek to początek, czwartek decyduje o roku', () => {
    expect(weekOf(at(2026, 10, 28)).id).toBe('2026-W44');
    expect(weekOf(at(2026, 10, 26, 0)).id).toBe('2026-W44');   // poniedziałek o północy
    expect(weekOf(at(2026, 10, 25, 23)).id).toBe('2026-W43');  // niedziela wieczorem
    expect(weekOf(at(2026, 12, 31)).id).toBe('2026-W53');
    expect(weekOf(at(2027, 1, 3)).id).toBe('2026-W53');        // niedziela 3 stycznia 2027 to jeszcze 53. tydzień 2026
    expect(weekOf(at(2027, 1, 4)).id).toBe('2027-W01');
    expect(weekOf(at(2025, 12, 29)).id).toBe('2026-W01');      // poniedziałek 29 grudnia 2025 zaczyna 1. tydzień 2026
  });

  it('początek i koniec tygodnia w ms (poniedziałek 00:00 UTC do następnego poniedziałku)', () => {
    const w = weekOf(at(2026, 10, 28));
    expect(w.startsAt).toBe(Date.UTC(2026, 9, 26));
    expect(w.endsAt).toBe(Date.UTC(2026, 10, 2));
  });

  it('seed tygodnia jest deterministyczny, w formacie losowych seedów gry (słowo i liczba 100–999), inny co tydzień', () => {
    const w = weekOf(at(2026, 10, 28));
    expect(weekOf(at(2026, 10, 30)).seed).toBe(w.seed);
    expect(w.seed).toMatch(/^[a-z]+-[1-9]\d\d$/);
    expect(SEED_WORDS).toContain(w.seed.split('-')[0]);
    const seeds = new Set(Array.from({ length: 52 }, (_, i) => weekOf(at(2026, 1, 5) + i * 7 * 86_400_000).seed));
    expect(seeds.size).toBeGreaterThan(45);
  });

  it('z seeda tygodnia generator składa sklep (kolejne pół roku); a gdyby nie złożył, liczy się sąsiedni lokal', () => {
    for (let i = 0; i < 26; i++) {
      const seed = weekOf(at(2026, 10, 28) + i * 7 * 86_400_000).seed;
      expect(() => generateStore(seed), seed).not.toThrow();
    }
    const w = weekOf(at(2026, 10, 28));
    expect(isWeekSeed(w.seed, w)).toBe(true);
    expect(isWeekSeed(`${w.seed}·2`, w)).toBe(true);
    expect(isWeekSeed(`${w.seed}2`, w)).toBe(false);
    expect(isWeekSeed('inny-123', w)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { SEED_WORDS } from '@/game/seedWords';
import { generateStore } from '@/sim/store/generateStore';
import { isWeekSeed, weekOf } from './week';

const at = (y: number, m: number, d: number, h = 12): number => Date.UTC(y, m - 1, d, h);

describe('tydzień rankingu (tydzień ISO w czasie polskim)', () => {
  it('numer tygodnia ISO: poniedziałek to początek, czwartek decyduje o roku', () => {
    expect(weekOf(at(2026, 10, 28)).id).toBe('2026-W44');
    expect(weekOf(at(2026, 12, 31)).id).toBe('2026-W53');
    expect(weekOf(at(2027, 1, 3)).id).toBe('2026-W53');        // niedziela 3 stycznia 2027 to jeszcze 53. tydzień 2026
    expect(weekOf(at(2027, 1, 4)).id).toBe('2027-W01');
    expect(weekOf(at(2025, 12, 29)).id).toBe('2026-W01');      // poniedziałek 29 grudnia 2025 zaczyna 1. tydzień 2026
  });

  it('tydzień zmienia się o północy w Polsce, nie w UTC (zimą to 23:00 UTC w niedzielę, latem 22:00)', () => {
    // 26 października 2026 (poniedziałek), już po zmianie na czas zimowy (UTC+1)
    expect(weekOf(Date.UTC(2026, 9, 25, 22, 59, 59)).id).toBe('2026-W43');
    expect(weekOf(Date.UTC(2026, 9, 25, 23, 0, 0)).id).toBe('2026-W44');
    // 3 sierpnia 2026 (poniedziałek), czas letni (UTC+2)
    expect(weekOf(Date.UTC(2026, 7, 2, 21, 59, 59)).id).toBe('2026-W31');
    expect(weekOf(Date.UTC(2026, 7, 2, 22, 0, 0)).id).toBe('2026-W32');
  });

  it('początek i koniec tygodnia to północ w poniedziałek w Polsce; tydzień ze zmianą czasu jest o godzinę krótszy albo dłuższy', () => {
    const w = weekOf(at(2026, 10, 28));
    expect(w.startsAt).toBe(Date.UTC(2026, 9, 25, 23));
    expect(w.endsAt).toBe(Date.UTC(2026, 10, 1, 23));
    // 25 października 2026: z czasu letniego na zimowy w niedzielę, więc ten tydzień ma 169 godzin
    const autumn = weekOf(at(2026, 10, 22));
    expect(autumn.startsAt).toBe(Date.UTC(2026, 9, 18, 22));
    expect(autumn.endsAt).toBe(Date.UTC(2026, 9, 25, 23));
    expect(autumn.endsAt).toBe(w.startsAt);
    // 28 marca 2027: z zimowego na letni, tydzień ma 167 godzin
    const spring = weekOf(at(2027, 3, 25));
    expect(spring.endsAt - spring.startsAt).toBe(167 * 3_600_000);
    expect(spring.endsAt).toBe(Date.UTC(2027, 2, 28, 22));
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

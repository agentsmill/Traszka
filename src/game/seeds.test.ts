import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './memoryStorage';
import { freeSeed } from './seeds';
import { randomSeed } from './seedWords';
import { hasStoredSave } from './session';

/** Losowanie, które oddaje kolejne seedy z listy (po ostatnim ciągle ostatni) i liczy wywołania. */
function draws(seeds: string[]): { draw: () => string; count: () => number } {
  let calls = 0;
  return { draw: () => seeds[Math.min(calls++, seeds.length - 1)]!, count: () => calls };
}

describe('freeSeed: seed bez zapisu pod spodem (nowy sklep nie może nadpisać cudzej gry)', () => {
  it('pierwsze losowanie wolne: jedno losowanie, jedno pytanie o zajętość', () => {
    const { draw, count } = draws(['bigos-101', 'kawa-200']);
    const asked: string[] = [];
    expect(freeSeed(draw, (s) => { asked.push(s); return false; })).toBe('bigos-101');
    expect(count()).toBe(1);
    expect(asked).toEqual(['bigos-101']);
  });

  it('zajęte losowania są odrzucane, pierwsze wolne wygrywa i dalej się nie losuje', () => {
    const { draw, count } = draws(['bigos-101', 'kawa-200', 'chleb-300', 'sernik-400', 'babka-500']);
    const taken = new Set(['bigos-101', 'kawa-200', 'chleb-300']);
    expect(freeSeed(draw, (s) => taken.has(s))).toBe('sernik-400');
    expect(count()).toBe(4);
  });

  it('dwudzieste losowanie jeszcze się liczy: wolne, to bez numeru', () => {
    const list = Array.from({ length: 20 }, (_, i) => `seed-${i + 1}`);
    const { draw, count } = draws(list);
    expect(freeSeed(draw, (s) => s !== 'seed-20')).toBe('seed-20');
    expect(count()).toBe(20);
  });

  it('dwadzieścia zajętych losowań: do ostatniego z nich dopisuje ·2, ·3… aż trafi na wolny seed, a losuje dokładnie 20 razy', () => {
    const list = Array.from({ length: 25 }, (_, i) => `seed-${i + 1}`);   // 21. i dalsze nie mogą się pojawić
    const { draw, count } = draws(list);
    const taken = new Set([...list, 'seed-20·2', 'seed-20·3']);
    expect(freeSeed(draw, (s) => taken.has(s))).toBe('seed-20·4');
    expect(count()).toBe(20);
  });

  it('dwadzieścia zajętych losowań i wolne ·2: numeracja zaczyna się od 2', () => {
    const { draw } = draws(['pierogi-100']);
    expect(freeSeed(draw, (s) => s === 'pierogi-100')).toBe('pierogi-100·2');
  });

  it('wszystko zajęte (magazyn, który tak twierdzi, kłamie): wynik jest, strona się nie zawiesza', () => {
    const { draw, count } = draws(['x-100']);
    const result = freeSeed(draw, () => true);
    expect(result).toMatch(/^x-100·\d+$/);
    expect(count()).toBe(20);
  });
});

describe('freeSeed z prawdziwym losowaniem i zapisami w przeglądarce (to samo złożenie, które woła main.ts)', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** `randomSeed` z podstawionym źródłem liczb: 0,0 daje „pierogi-100”, 1,1 daje „bigos-101”, 2,2 daje „zurek-102”. */
  const drawFrom = (numbers: number[]): (() => string) => {
    let i = 0;
    return () => randomSeed(() => numbers[i++ % numbers.length]!);
  };

  it('omija seed, pod którym leży zapis (poprawny, uszkodzony albo z nowszej wersji gry)', () => {
    storage.setItem('traszka:save:pierogi-100', '{"schema":2}');
    storage.setItem('traszka:save:bigos-101', '{"ucięty');
    storage.setItem('traszka:save:zurek-102', '{"schema":9}');
    expect(freeSeed(drawFrom([0, 0, 1, 1, 2, 2, 3, 3]), hasStoredSave)).toBe('kielbasa-103');
  });

  it('seed bez zapisu zostaje', () => {
    storage.setItem('traszka:save:bigos-101', '{"schema":2}');
    expect(freeSeed(drawFrom([0, 0, 1, 1]), hasStoredSave)).toBe('pierogi-100');
  });
});

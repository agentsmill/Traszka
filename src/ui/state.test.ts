import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HINT_MS, hints, nextHint, showHints } from './state';

beforeEach(() => {
  vi.useFakeTimers();
  showHints([]);
});
afterEach(() => {
  showHints([]);
  vi.useRealTimers();
});

describe('podpowiedzi pierwszego dnia (krótkie dymki zamiast okna „Witaj w Traszce”)', () => {
  it('pierwsza podpowiedź jest widoczna od razu, kolejne wchodzą same po HINT_MS, a po ostatniej lista jest pusta', () => {
    showHints(['a', 'b', 'c']);
    expect(hints.value).toEqual(['a', 'b', 'c']);
    vi.advanceTimersByTime(HINT_MS - 1);
    expect(hints.value[0]).toBe('a');
    vi.advanceTimersByTime(1);
    expect(hints.value).toEqual(['b', 'c']);
    vi.advanceTimersByTime(HINT_MS);
    expect(hints.value).toEqual(['c']);
    vi.advanceTimersByTime(HINT_MS);
    expect(hints.value).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);   // nic nie tyka dalej
  });

  it('nextHint („Dalej”) przeskakuje od razu i liczy czas następnej od nowa', () => {
    showHints(['a', 'b', 'c']);
    vi.advanceTimersByTime(HINT_MS - 100);
    nextHint();
    expect(hints.value).toEqual(['b', 'c']);
    vi.advanceTimersByTime(HINT_MS - 1);
    expect(hints.value).toEqual(['b', 'c']);      // zegar poszedł od nowa, a nie dokończył starego
    vi.advanceTimersByTime(1);
    expect(hints.value).toEqual(['c']);
  });

  it('nextHint na pustej liście niczego nie robi i nie zostawia zegara', () => {
    nextHint();
    expect(hints.value).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('nowa lista zastępuje starą, z jednym zegarem (nic się nie dubluje); pusta lista czyści i zatrzymuje zegar', () => {
    showHints(['a', 'b']);
    showHints(['x', 'y', 'z']);
    expect(vi.getTimerCount()).toBe(1);
    expect(hints.value).toEqual(['x', 'y', 'z']);
    showHints([]);
    expect(hints.value).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lista jest kopią: zmiana tablicy przekazanej do showHints nie rusza podpowiedzi', () => {
    const list = ['a', 'b'];
    showHints(list);
    list.push('c');
    expect(hints.value).toEqual(['a', 'b']);
  });
});

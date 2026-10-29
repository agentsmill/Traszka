import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_MAX_READ_MS, NOTICE_MIN_READ_MS, readMs } from '@/sim/economy/tycoon/notices';
import { HINT_MS, hints, nextHint, pushToast, showHints, toasts } from './state';

beforeEach(() => {
  vi.useFakeTimers();
  showHints([]);
  toasts.value = [];
});
afterEach(() => {
  showHints([]);
  toasts.value = [];
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

describe('toasty: czas na przeczytanie zależy od długości tekstu (bez migania)', () => {
  const long = 'x'.repeat(300);
  const visible = (): string[] => toasts.value.map((t) => t.text);

  it('toast o tekście 300 znaków trwa 12 000 ms, a nie 4000', () => {
    pushToast(long);
    vi.advanceTimersByTime(4000);
    expect(visible()).toEqual([long]);
    vi.advanceTimersByTime(NOTICE_MAX_READ_MS - 4000 - 1);
    expect(visible()).toEqual([long]);
    vi.advanceTimersByTime(1);
    expect(visible()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('krótki toast trwa najkrócej tyle, ile NOTICE_MIN_READ_MS, a średni tyle, ile readMs', () => {
    pushToast('ok');
    vi.advanceTimersByTime(NOTICE_MIN_READ_MS - 1);
    expect(visible()).toEqual(['ok']);
    vi.advanceTimersByTime(1);
    expect(visible()).toEqual([]);
    const medium = 'y'.repeat(100);
    expect(readMs(medium)).toBeGreaterThan(NOTICE_MIN_READ_MS);
    pushToast(medium);
    vi.advanceTimersByTime(readMs(medium) - 1);
    expect(visible()).toEqual([medium]);
    vi.advanceTimersByTime(1);
    expect(visible()).toEqual([]);
  });

  it('błąd znika po 2200 ms jak dotąd, także gdy tekst jest długi', () => {
    pushToast(long, 'error');
    vi.advanceTimersByTime(2199);
    expect(visible()).toEqual([long]);
    vi.advanceTimersByTime(1);
    expect(visible()).toEqual([]);
  });

  it('ten sam tekst nie dubluje się ani nie miga: zostaje ten sam toast, a czas liczy się od nowa', () => {
    pushToast(long);
    const first = toasts.value[0]!;
    vi.advanceTimersByTime(8000);
    pushToast(long);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]).toBe(first);   // ten sam węzeł, więc interfejs go nie montuje od nowa
    vi.advanceTimersByTime(8000);          // stary zegar już by go zdjął (16 s > 12 s)
    expect(visible()).toEqual([long]);
    vi.advanceTimersByTime(4000);
    expect(visible()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('najwyżej dwa toasty naraz: trzeci wypiera najstarszy, a zegar wypartego nie zdejmuje następnych', () => {
    pushToast('a');
    vi.advanceTimersByTime(3000);
    pushToast('b');
    pushToast('c');
    expect(visible()).toEqual(['b', 'c']);
    expect(vi.getTimerCount()).toBe(2);   // zegar wypartego „a” zdjęty
    vi.advanceTimersByTime(NOTICE_MIN_READ_MS);
    expect(visible()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEconomy, type MonthReport } from '@/sim/economy/economy';
import type { CardInstance } from '@/sim/economy/tycoon/cards';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { celebration, econ, pushStory, report, story, welcome, type Celebration } from '../state';
import { CelebrationBanner, windowBlocksBanner } from './overlays';
import { textOf, walk, type Vnode } from './vnodeTree';

// Baner ma `useEffect` (czasomierz zniknięcia). Poza renderem Preacta haków nie ma jak wołać, więc atrapa tylko zapamiętuje efekt:
// test wywołuje go sam, tak jak zrobiłby to Preact po wyrenderowaniu.
const effects = vi.hoisted(() => [] as (() => (() => void) | void)[]);
vi.mock('preact/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('preact/hooks')>()),
  useEffect: (fn: () => (() => void) | void) => { effects.push(fn); },
}));

const LEVEL_UP: Celebration = { title: 'POZIOM 5', subtitle: 'Kierownik zmiany', lines: ['Nagroda: +500 zł.', '🔓 Ulotki'] };

const answer = { delta: {}, mods: [], risk: null };
const card = (showAt: number): CardInstance => ({ seq: 1, id: 'fefo', day: 0, showAt, params: { n: 12, v: 1080 }, defaultAnswer: 0, answers: [answer, answer] });

/** Gra z kartą na biurku (minuta gry 1000), widoczną od `showAt`. */
function publishWithCard(showAt: number): void {
  const info = computeStoreInfo(layoutFor('baner', 0));
  const s = createEconomy('baner', info);
  s.minute = 1000;
  s.tycoon.cards.pending = [card(showAt)];
  econ.value = { s, info, v: 1 };
}

const reset = (): void => {
  celebration.value = null;
  econ.value = null;
  report.value = null;
  welcome.value = null;
  story.value = [];
};
beforeEach(() => { reset(); effects.length = 0; });
afterEach(() => { reset(); vi.useRealTimers(); });

describe('baner nagrody (nowy poziom)', () => {
  it('w zwykłej grze pokazuje poziom, rangę i nagrody', () => {
    celebration.value = LEVEL_UP;
    const tree = CelebrationBanner() as Vnode;
    expect(tree).not.toBeNull();
    expect(textOf(tree)).toContain('POZIOM 5');
    expect(textOf(tree)).toContain('Kierownik zmiany');
    expect(textOf(tree)).toContain('🔓 Ulotki');
    expect(walk(tree)[0]!.props.class).toBe('tt-celebrate');
  });

  it('bez nagrody nic nie widać', () => {
    expect(CelebrationBanner()).toBeNull();
  });

  it('grę z kartą, której godzina jeszcze nie nadeszła, baner nie omija: karta nie jest wtedy widoczna', () => {
    publishWithCard(1001);
    celebration.value = LEVEL_UP;
    expect(windowBlocksBanner()).toBe(false);
    expect(CelebrationBanner()).not.toBeNull();
  });

  it('nie zasłania raportu miesiąca: przycisk „Dalej” jest wolny', () => {
    celebration.value = LEVEL_UP;
    report.value = { label: 'wrzesień' } as unknown as MonthReport;
    expect(CelebrationBanner()).toBeNull();
    report.value = null;
    expect(CelebrationBanner()).not.toBeNull();
  });

  it('czas banera biegnie także pod oknem: po zamknięciu okna stary baner (z tym samym poziomem w oknie „Poziom N”) już nie wraca', () => {
    vi.useFakeTimers();
    celebration.value = LEVEL_UP;
    pushStory('Poziom 5', 'Nagroda: +500 zł.\n🔓 Ulotki');
    expect(CelebrationBanner()).toBeNull();
    expect(effects).toHaveLength(1);
    effects[0]!();   // Preact uruchamia efekt po renderze: czasomierz startuje, choć baner jest ukryty
    vi.advanceTimersByTime(3200);
    expect(celebration.value).toBeNull();
    story.value = [];
    expect(CelebrationBanner()).toBeNull();
  });

  it('nie zasłania okna ważnego zdarzenia: poziom z odblokowaniami ma własne okno „Poziom N”', () => {
    celebration.value = LEVEL_UP;
    pushStory('Poziom 5', 'Nagroda: +500 zł.\n🔓 Ulotki');
    expect(CelebrationBanner()).toBeNull();
    story.value = [];
    expect(CelebrationBanner()).not.toBeNull();
  });

  it('nie zasłania karty dnia (widocznej na biurku)', () => {
    publishWithCard(1000);
    celebration.value = LEVEL_UP;
    expect(windowBlocksBanner()).toBe(true);
    expect(CelebrationBanner()).toBeNull();
    econ.value!.s.tycoon.cards.pending = [];   // odpowiedź zaksięgowana
    expect(CelebrationBanner()).not.toBeNull();
  });

  it('nie zasłania powitania „Witaj z powrotem” ani okna końca gry', () => {
    celebration.value = LEVEL_UP;
    welcome.value = { hours: 2, offline: 100, streak: null, daily: null };
    expect(CelebrationBanner()).toBeNull();
    welcome.value = null;
    expect(CelebrationBanner()).not.toBeNull();
    publishWithCard(2000);
    econ.value!.s.gameOver = true;
    expect(CelebrationBanner()).toBeNull();
  });

  it('windowBlocksBanner: bez okien i bez gry jest fałszem', () => {
    expect(windowBlocksBanner()).toBe(false);
  });
});

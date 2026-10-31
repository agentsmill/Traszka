import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_MAX_READ_MS, NOTICE_MIN_READ_MS, readMs } from '@/sim/economy/tycoon/notices';
import { generateStore } from '@/sim/store/generateStore';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, createEconomy, stepMinute, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { MemoryStorage } from '@/game/memoryStorage';
import {
  closeFinish, closeHowTo, closePanel, dismissStory, econ, finish, howTo, isWindowOpen, offerTutorial, openHowTo, openPanel, openRanking,
  panel, pushStory, pushToast, ranked, report, showPrestige, start, story, toasts, tutorialOffer, welcome, type GameActions,
} from './state';
import { setTour } from './tutorial/memory';

/** Wszystko, co zatrzymuje grę, do stanu wyjściowego. */
const clearWindows = (): void => {
  howTo.value = false;
  report.value = null;
  welcome.value = null;
  showPrestige.value = false;
  start.value = null;
  econ.value = null;
  story.value = [];
  finish.value = null;
  ranked.value = null;
  panel.value = null;
  tutorialOffer.value = false;
};

beforeEach(() => {
  vi.useFakeTimers();
  clearWindows();
  toasts.value = [];
});
afterEach(() => {
  clearWindows();
  toasts.value = [];
  vi.useRealTimers();
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

describe('ważne zdarzenia czekające na „OK” (story)', () => {
  it('pushStory dokłada wpis na koniec kolejki z kolejnym id, dismissStory zdejmuje pierwszy', () => {
    expect(story.value).toEqual([]);
    pushStory('Remont zakończony', 'Sklep otwarty.');
    pushStory('Poziom 5', 'Nagroda\n🔓 Ulotki');
    expect(story.value.map((e) => [e.title, e.text])).toEqual([['Remont zakończony', 'Sklep otwarty.'], ['Poziom 5', 'Nagroda\n🔓 Ulotki']]);
    const [first, second] = story.value;
    expect(second!.id).toBeGreaterThan(first!.id);
    dismissStory();
    expect(story.value).toEqual([second]);
    dismissStory();
    expect(story.value).toEqual([]);
  });

  it('dismissStory na pustej kolejce niczego nie robi', () => {
    const before = story.value;
    dismissStory();
    expect(story.value).toBe(before);
  });

  it('ten sam tekst dwa razy to dwa wpisy (każdy wymaga własnego „OK”), z różnymi id', () => {
    pushStory('t', 'x');
    pushStory('t', 'x');
    expect(story.value).toHaveLength(2);
    expect(story.value[0]!.id).not.toBe(story.value[1]!.id);
  });
});

describe('okno wyboru samouczka (tutorialOffer)', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); tutorialOffer.value = false; });

  it('offerTutorial otwiera okno tylko graczowi, który jeszcze na nie nie odpowiedział', () => {
    offerTutorial();
    expect(tutorialOffer.value).toBe(true);
    tutorialOffer.value = false;
    for (const tour of ['started', 'skipped', 'done'] as const) {
      setTour(tour);
      offerTutorial();
      expect(tutorialOffer.value, tour).toBe(false);
    }
  });

  it('otwarte okno wyboru zatrzymuje grę jak każde inne okno', () => {
    expect(isWindowOpen()).toBe(false);
    tutorialOffer.value = true;
    expect(isWindowOpen()).toBe(true);
  });
});

describe('isWindowOpen: każde okno z sygnałem zatrzymuje grę, karta decyzji i koniec gry nie mają sygnału', () => {
  const INFO = computeStoreInfo(generateStore('traszka-okna'));
  const rep = {} as MonthReport;
  const cases: [string, () => void][] = [
    ['raport miesiąca', () => { report.value = rep; }],
    ['ważne zdarzenie czekające na „OK”', () => pushStory('Remont zakończony', 'Sklep otwarty.')],
    ['okno powitalne', () => { welcome.value = { hours: 2, offline: 0, streak: 1, daily: { cash: 0, ogonki: 2 } }; }],
    ['prestiż', () => { showPrestige.value = true; }],
    ['okno końca sezonu', () => { finish.value = { open: true }; }],
    ['ekran „Nowy sklep”', () => { start.value = {} as NonNullable<typeof start.value>; }],
    ['„Jak grać”', () => openHowTo()],
  ];
  for (const [name, open] of cases) {
    it(name, () => {
      expect(isWindowOpen()).toBe(false);
      open();
      expect(isWindowOpen()).toBe(true);
    });
  }

  it('karta decyzji trzyma grę w symulacji, a nie sygnałem okna', () => {
    const s = createEconomy('traszka-okna', INFO);
    for (let i = 0; i < 2000 && !awaitingDecision(s); i++) stepMinute(s, INFO, []);
    expect(awaitingDecision(s)).toBe(true);
    econ.value = { s, info: INFO, v: 1 };
    expect(isWindowOpen()).toBe(false);
    for (const c of visibleCards(s.tycoon.cards, s.minute)) applyCommand(s, INFO, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
    expect(awaitingDecision(s)).toBe(false);
  });

  it('„Zaczynamy” zamyka „Jak grać”', () => {
    openHowTo();
    closeHowTo();
    expect(isWindowOpen()).toBe(false);
  });
});

describe('closeFinish: zamknięcie okna końca sezonu', () => {
  const game = (): Pick<GameActions, 'leaveRanked'> => ({ leaveRanked: vi.fn() });

  it('zdejmuje sygnał, a gra przestaje stać pod oknem', () => {
    finish.value = { open: true };
    expect(isWindowOpen()).toBe(true);
    closeFinish(game());
    expect(finish.value).toBeNull();
    expect(isWindowOpen()).toBe(false);
  });

  it('w skończonym biegu rankingowym (faza „over”) wychodzi do zwykłej gry, w pozostałych przypadkach tylko zamyka', () => {
    ranked.value = { seed: 'x', day: 91, days: 91, phase: 'over' };
    finish.value = { open: true };
    const over = game();
    closeFinish(over);
    expect(over.leaveRanked).toHaveBeenCalledTimes(1);

    for (const view of [null, { seed: 'x', day: 5, days: 91, phase: 'playing' as const }]) {
      ranked.value = view;
      finish.value = { open: true };
      const other = game();
      closeFinish(other);
      expect(other.leaveRanked).not.toHaveBeenCalled();
    }
  });

  it('okno zamknięte przed wyjściem z biegu: sygnał jest już pusty, gdy gra przechodzi do zwykłego sklepu', () => {
    ranked.value = { seed: 'x', day: 91, days: 91, phase: 'over' };
    finish.value = { open: true };
    let seenWhenLeaving: unknown = 'nie wywołano';
    closeFinish({ leaveRanked: () => { seenWhenLeaving = finish.value; } });
    expect(seenWhenLeaving).toBeNull();
  });
});

describe('panele rankingu: sygnał panel', () => {
  it('openPanel ustawia panel (zakładka tylko, gdy podana), closePanel go czyści', () => {
    expect(panel.value).toBeNull();
    openPanel('recovery');
    expect(panel.value).toEqual({ id: 'recovery' });
    expect('tab' in panel.value!).toBe(false);
    openPanel('ranking', 'week');
    expect(panel.value).toEqual({ id: 'ranking', tab: 'week' });
    closePanel();
    expect(panel.value).toBeNull();
    closePanel();   // zamykanie zamkniętego niczego nie psuje
    expect(panel.value).toBeNull();
  });

  it('otwarcie tego samego panelu drugi raz to nowa wartość sygnału (host odświeża dane przy każdym otwarciu)', () => {
    openPanel('ranking', 'global');
    const first = panel.value;
    closePanel();
    openPanel('ranking', 'global');
    expect(panel.value).toEqual(first);
    expect(panel.value).not.toBe(first);
  });

  it('otwarty panel zatrzymuje grę (isWindowOpen), zamknięty nie', () => {
    expect(isWindowOpen()).toBe(false);
    openPanel('ranking', 'global');
    expect(isWindowOpen()).toBe(true);
    closePanel();
    expect(isWindowOpen()).toBe(false);
    openPanel('recovery');
    expect(isWindowOpen()).toBe(true);
  });

  it('openRanking: w biegu rankingowym zakładka „Ten seed”, w zwykłej grze „Globalny”', () => {
    openRanking();
    expect(panel.value).toEqual({ id: 'ranking', tab: 'global' });
    ranked.value = { seed: 'pierogi-731', day: 4, days: 91, phase: 'playing' };
    openRanking();
    expect(panel.value).toEqual({ id: 'ranking', tab: 'seed' });
    ranked.value = null;
    openRanking();
    expect(panel.value).toEqual({ id: 'ranking', tab: 'global' });
  });
});

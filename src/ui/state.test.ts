import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_MAX_READ_MS, NOTICE_MIN_READ_MS, readMs } from '@/sim/economy/tycoon/notices';
import { generateStore } from '@/sim/store/generateStore';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, createEconomy, stepMinute, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import {
  HINT_MS, closeFinish, closeHowTo, dismissStory, econ, finish, hints, howTo, isWindowOpen, nextHint, openHowTo, pushStory, pushToast, ranked,
  report, showHints, showPrestige, start, story, toasts, welcome, type GameActions,
} from './state';

/** Wszystko, co zatrzymuje grę albo dymki, do stanu wyjściowego. */
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
};

beforeEach(() => {
  vi.useFakeTimers();
  clearWindows();
  showHints([]);
  toasts.value = [];
});
afterEach(() => {
  clearWindows();
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

describe('podpowiedzi pierwszego dnia czekają pod oknem „Jak grać”', () => {
  it('lista pokazana przy otwartym oknie nie ma zegara: po minucie nadal pierwsza, a „Zaczynamy” daje jej pełny czas', () => {
    openHowTo();
    showHints(['a', 'b']);
    expect(hints.value).toEqual(['a', 'b']);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(HINT_MS * 10);
    expect(hints.value).toEqual(['a', 'b']);   // nikt tego nie zobaczył, więc nie wygasa

    closeHowTo();
    expect(howTo.value).toBe(false);
    vi.advanceTimersByTime(HINT_MS - 1);
    expect(hints.value).toEqual(['a', 'b']);
    vi.advanceTimersByTime(1);
    expect(hints.value).toEqual(['b']);
  });

  it('okno otwarte w trakcie zatrzymuje zegar, a po zamknięciu czas liczy się od nowa (nie z reszty)', () => {
    showHints(['a', 'b']);
    vi.advanceTimersByTime(HINT_MS - 100);
    openHowTo();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(HINT_MS * 5);
    expect(hints.value).toEqual(['a', 'b']);
    closeHowTo();
    vi.advanceTimersByTime(HINT_MS - 1);
    expect(hints.value).toEqual(['a', 'b']);
    vi.advanceTimersByTime(1);
    expect(hints.value).toEqual(['b']);
  });

  it('„Dalej” pod otwartym oknem też nie uruchamia zegara; bez podpowiedzi zamknięcie okna nie zostawia zegara', () => {
    openHowTo();
    showHints(['a', 'b', 'c']);
    nextHint();
    expect(hints.value).toEqual(['b', 'c']);
    expect(vi.getTimerCount()).toBe(0);
    showHints([]);
    closeHowTo();
    expect(vi.getTimerCount()).toBe(0);
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

describe('podpowiedzi pierwszego dnia czekają pod każdym oknem, które zatrzymuje grę', () => {
  const INFO = computeStoreInfo(generateStore('traszka-hints'));
  const view = (s: EconomyState, v = 1): NonNullable<typeof econ.value> => ({ s, info: INFO, v });
  /** Gra stojąca na karcie decyzji (dzień 0 zawsze ma kartę). */
  const onCard = (): EconomyState => {
    const s = createEconomy('traszka-hints', INFO);
    for (let i = 0; i < 2000 && !awaitingDecision(s); i++) stepMinute(s, INFO, []);
    expect(awaitingDecision(s)).toBe(true);
    return s;
  };
  const answerAll = (s: EconomyState): void => {
    for (const c of visibleCards(s.tycoon.cards, s.minute)) applyCommand(s, INFO, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
  };
  const rep = {} as MonthReport;

  /** Otwiera okno, sprawdza, że zegar stoi mimo długiego czekania, zamyka je i sprawdza, że dymek dostaje pełny czas od zamknięcia. */
  function holdsUntilClosed(open: () => void, close: () => void): void {
    showHints(['a', 'b']);
    vi.advanceTimersByTime(HINT_MS - 100);   // dymek jest już prawie na końcu czasu
    open();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(HINT_MS * 10);
    expect(hints.value).toEqual(['a', 'b']);   // pod oknem nic nie wygasa
    close();
    vi.advanceTimersByTime(HINT_MS - 1);
    expect(hints.value).toEqual(['a', 'b']);   // czas liczy się od zamknięcia, a nie z reszty sprzed okna
    vi.advanceTimersByTime(1);
    expect(hints.value).toEqual(['b']);
  }

  it('raport miesiąca', () => holdsUntilClosed(() => { report.value = rep; }, () => { report.value = null; }));
  it('ważne zdarzenie czekające na „OK”', () => holdsUntilClosed(() => pushStory('Remont zakończony', 'Sklep otwarty.'), () => dismissStory()));
  it('okno powitalne', () => holdsUntilClosed(
    () => { welcome.value = { hours: 2, offline: 0, streak: 1, daily: { cash: 0, ogonki: 2 } }; }, () => { welcome.value = null; },
  ));
  it('prestiż', () => holdsUntilClosed(() => { showPrestige.value = true; }, () => { showPrestige.value = false; }));
  it('okno końca sezonu rankingowego i ponownej wysyłki wyniku', () => holdsUntilClosed(
    () => { finish.value = { open: true }; }, () => { finish.value = null; },
  ));
  it('ekran „Nowy sklep”', () => holdsUntilClosed(
    () => { start.value = {} as NonNullable<typeof start.value>; }, () => { start.value = null; },
  ));

  it('karta decyzji, która trzyma grę: dymki czekają, choć żadne okno z sygnałem nie jest otwarte; po odpowiedzi dostają pełny czas', () => {
    const s = createEconomy('traszka-hints', INFO);
    econ.value = view(s);
    const stopped = onCard();
    holdsUntilClosed(() => { econ.value = view(stopped, 2); }, () => { answerAll(stopped); econ.value = view(stopped, 3); });
    expect(isWindowOpen()).toBe(false);   // to nie było okno z sygnałem, tylko stan gry
  });

  it('publikacja stanu (co 200 ms) pod kartą ani w grze bez karty nie przesuwa zegara dymka', () => {
    const s = createEconomy('traszka-hints', INFO);
    econ.value = view(s);
    showHints(['a', 'b']);
    for (let v = 2, t = 0; t < HINT_MS - 200; v++, t += 200) {
      vi.advanceTimersByTime(200);
      econ.value = view(s, v);
    }
    vi.advanceTimersByTime(200);
    expect(hints.value).toEqual(['b']);   // dymek zszedł o czasie, mimo kilkudziesięciu publikacji po drodze
  });

  it('koniec gry też wstrzymuje dymki (stoi wtedy okno końca współpracy)', () => {
    const s = createEconomy('traszka-hints', INFO);
    showHints(['a']);
    s.gameOver = true;
    econ.value = view(s);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(HINT_MS * 3);
    expect(hints.value).toEqual(['a']);
  });

  it('dwa okna jedno po drugim: zegar rusza dopiero po zamknięciu ostatniego', () => {
    showHints(['a', 'b']);
    report.value = rep;
    pushStory('Poziom 5', 'Nagroda');
    report.value = null;
    expect(vi.getTimerCount()).toBe(0);   // „OK” jeszcze czeka
    dismissStory();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(HINT_MS);
    expect(hints.value).toEqual(['b']);
  });

  it('lista pokazana przy otwartym oknie nie ma zegara, a pusta lista po zamknięciu nie zostawia go', () => {
    report.value = rep;
    showHints(['a']);
    expect(vi.getTimerCount()).toBe(0);
    showHints([]);
    report.value = null;
    expect(vi.getTimerCount()).toBe(0);
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { RANKED_KEYS, clearFinished, createRankedSession, saveFinished, saveRanked, type FinishedRun } from '@/game/rankedRun';
import { newRunLog } from '@/game/session';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { zl } from '../game/format';
import { ranked, unsent } from '../state';
import { rankedAskFacts, rankedAskText } from './rankedAsk';

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  clearFinished();
  ranked.value = null;
  unsent.value = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  ranked.value = null;
  unsent.value = null;
});

const drawerRun = (score = 12_345): FinishedRun => ({ v: 1, seed: 'stary-bieg', record: newRunLog('stary-bieg', 'ranked').record, score, finishedAt: 1_000 });

describe('rankedAskText: pytanie przed porzuceniem biegu', () => {
  it('niewysłany bieg: z wynikiem w złotych', () => {
    expect(rankedAskText('unsent', { score: 12_345, day: null, days: 91 }))
      .toBe(`Masz niewysłany bieg (wynik ${zl(12_345)}). Zacząć nowy i porzucić tamten?`);
  });

  it('trwający bieg: z dniem N z 91', () => {
    expect(rankedAskText('active', { score: null, day: 12, days: 91 }))
      .toBe('Masz rozpoczęty bieg rankingowy (dzień 12 z 91). Zacząć nowy i porzucić tamten?');
  });

  it('dwa warianty różnią się treścią, a fakty innego wariantu ich nie zmieniają', () => {
    const facts = { score: 500, day: 7, days: 91 };
    expect(rankedAskText('unsent', facts)).toContain('niewysłany bieg');
    expect(rankedAskText('unsent', facts)).not.toContain('dzień');
    expect(rankedAskText('active', facts)).toContain('dzień 7 z 91');
    expect(rankedAskText('active', facts)).not.toContain('wynik');
  });

  it('gdy faktu nie da się ustalić (bieg z innej wersji gry, nieczytelna szuflada), pytanie jest bez nawiasu', () => {
    expect(rankedAskText('unsent', { score: null, day: null, days: 91 })).toBe('Masz niewysłany bieg. Zacząć nowy i porzucić tamten?');
    expect(rankedAskText('active', { score: null, day: null, days: 91 })).toBe('Masz rozpoczęty bieg rankingowy. Zacząć nowy i porzucić tamten?');
  });

  it('wynik zero też jest wynikiem (nie znika jak brak)', () => {
    expect(rankedAskText('unsent', { score: 0, day: null, days: 91 })).toContain(`(wynik ${zl(0)})`);
  });
});

describe('rankedAskFacts: skąd pytanie bierze wynik i dzień', () => {
  it('wynik niewysłanego biegu: z sygnału `unsent` (powłoka go pilnuje)', () => {
    unsent.value = { seed: 'stary-bieg', score: 777 };
    expect(rankedAskFacts().score).toBe(777);
  });

  it('bez sygnału (ekran „pierwsze wejście”, powłoki jeszcze nie ma): z szuflady w przeglądarce', () => {
    saveFinished(drawerRun(4_321));
    expect(rankedAskFacts().score).toBe(4_321);
  });

  it('bez szuflady wynik jest nieznany', () => {
    expect(rankedAskFacts().score).toBeNull();
  });

  it('dzień trwającego biegu: z widoku `ranked`, gdy gracz jest w biegu', () => {
    ranked.value = { seed: 'kielbasa-42', day: 33, days: 91, phase: 'playing' };
    expect(rankedAskFacts()).toMatchObject({ day: 33, days: 91 });
  });

  it('gracz jest w zwykłym sklepie, a bieg czeka w zapisie: dzień z zapisu', () => {
    const session = createRankedSession('kielbasa-42');
    session.econ.minute = OPEN_FROM + 11 * MINUTES_PER_DAY;
    expect(saveRanked(session)).toBe(true);
    expect(rankedAskFacts()).toMatchObject({ day: 12, days: 91 });
  });

  it('zapis biegu z innej wersji gry: dzień nieznany, zapis nietknięty', () => {
    storage.setItem(RANKED_KEYS.active, JSON.stringify({ schema: 99 }));
    expect(rankedAskFacts().day).toBeNull();
    expect(storage.getItem(RANKED_KEYS.active)).toBe('{"schema":99}');
  });

  it('bez biegu: dzień nieznany, a liczba dni sezonu to 91', () => {
    expect(rankedAskFacts()).toEqual({ score: null, day: null, days: 91 });
  });
});

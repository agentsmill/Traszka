import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { TUTORIAL_KEY, TIP_IDS, loadTutorial, markSeen, saveTutorial, setTips, setTour, type TutorialMemory } from './memory';

const DEFAULTS: TutorialMemory = { v: 1, tour: null, seen: [], tips: true };

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('pamięć samouczka', () => {
  it('bez klucza daje wartości domyślne', () => {
    expect(loadTutorial()).toEqual(DEFAULTS);
  });

  it('zapis i odczyt pod kluczem traszka:tutorial', () => {
    saveTutorial({ v: 1, tour: 'done', seen: ['tip-cel'], tips: false });
    expect(TUTORIAL_KEY).toBe('traszka:tutorial');
    expect(JSON.parse(storage.getItem(TUTORIAL_KEY)!)).toEqual({ v: 1, tour: 'done', seen: ['tip-cel'], tips: false });
    expect(loadTutorial()).toEqual({ v: 1, tour: 'done', seen: ['tip-cel'], tips: false });
  });

  it('zły JSON albo nie-obiekt daje wartości domyślne', () => {
    for (const raw of ['{', 'null', '42', '"tak"', '[]']) {
      storage.setItem(TUTORIAL_KEY, raw);
      expect(loadTutorial(), raw).toEqual(DEFAULTS);
    }
  });

  it('obce pola, zły tour, nieznane i powtórzone seen są oczyszczane', () => {
    storage.setItem(TUTORIAL_KEY, JSON.stringify({ v: 7, tour: 'może', seen: ['tip-cel', 'tip-cel', 'obcy', 3, 'tip-karta'], tips: 'tak', extra: 1 }));
    expect(loadTutorial()).toEqual({ v: 1, tour: null, seen: ['tip-cel', 'tip-karta'], tips: true });
  });

  it('każdy poprawny stan przelotu przechodzi przez odczyt', () => {
    for (const tour of ['started', 'skipped', 'done'] as const) {
      saveTutorial({ ...DEFAULTS, tour });
      expect(loadTutorial().tour).toBe(tour);
    }
  });

  it('magazyn, który rzuca przy odczycie, daje wartości domyślne', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('zablokowane'); } });
    expect(loadTutorial()).toEqual(DEFAULTS);
  });

  it('brak localStorage (node, tryb prywatny bez magazynu) nie rzuca', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadTutorial()).toEqual(DEFAULTS);
    expect(() => saveTutorial(DEFAULTS)).not.toThrow();
  });

  it('błąd zapisu jest cichy, a pamięć zostaje bez zmian', () => {
    storage.failWrites = true;
    expect(() => setTour('skipped')).not.toThrow();
    expect(loadTutorial()).toEqual(DEFAULTS);
  });

  it('markSeen dopisuje znany dymek raz i nie przyjmuje obcych', () => {
    markSeen('tip-cel');
    markSeen('tip-cel');
    markSeen('tip-nieznany');
    expect(loadTutorial().seen).toEqual(['tip-cel']);
  });

  it('setTips przełącza podpowiedzi, reszta pamięci zostaje', () => {
    setTour('done');
    markSeen('tip-karta');
    setTips(false);
    expect(loadTutorial()).toEqual({ v: 1, tour: 'done', seen: ['tip-karta'], tips: false });
  });

  it('setTour: „skipped” nie nadpisuje „done”, a pozostałe przejścia się zapisują', () => {
    setTour('started');
    expect(loadTutorial().tour).toBe('started');
    setTour('done');
    setTour('skipped');
    expect(loadTutorial().tour).toBe('done');
  });

  it('lista dymków to dokładnie dymki ze specu', () => {
    expect([...TIP_IDS]).toEqual(['tip-cel', 'tip-przejscia', 'tip-karta', 'tip-wyciag', 'tip-remanent']);
  });
});

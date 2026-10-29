import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUALITY, type QualityPresetId } from '@/render/quality';
import { HOUR_CURVE, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import { expectedDailyCustomers, isOpenForCustomers, isStoreOpen } from '@/sim/economy/economy';
import { MemoryStorage } from './memoryStorage';
import { CROWD_MAX, clearSeedFromUrl, crowdRateFor, timeOfDayAt, trafficPerHour } from './scene';
import { createSession, type GameSession } from './session';

/*
 * Część sceny, którą da się sprawdzić bez WebGL: tempo napływu klientów z ekonomii i pora dnia z zegara gry.
 * `createSceneHost` rusza three.js i DOM, więc jego sprawdza przeglądarka (zadanie 15, krok „sprawdzenie w przeglądarce”).
 */

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

const PRESETS = Object.keys(QUALITY) as QualityPresetId[];

/** Świeża gra, ustawiona na godzinę `hour` pierwszego dnia (zegar gry w minutach od początku). */
function atHour(hour: number): GameSession {
  const s = createSession('traszka-scena', true);
  s.econ.minute = hour * 60;
  return s;
}

/** Ten sam sklep z ogromnym ruchem: zagęszcza tłum ponad każdy limit presetu. */
function busy(hour: number): GameSession {
  const s = atHour(hour);
  s.econ.reputation = 100;
  s.info = { ...s.info, shelfCapTotal: 1e6 };
  return s;
}

describe('timeOfDayAt: pora dnia z zegara gry', () => {
  it('20:00–6:00 to noc, reszta dzień', () => {
    const at = (h: number, m = 0): ReturnType<typeof timeOfDayAt> => timeOfDayAt(h * 60 + m);
    expect(at(0)).toBe('night');
    expect(at(5, 59)).toBe('night');
    expect(at(6)).toBe('day');
    expect(at(12)).toBe('day');
    expect(at(19, 59)).toBe('day');
    expect(at(20)).toBe('night');
    expect(at(23, 59)).toBe('night');
  });

  it('liczy godzinę doby, a nie minutę od początku gry: kolejne dni mają tę samą porę', () => {
    for (const day of [1, 2, 31]) {
      expect(timeOfDayAt(day * MINUTES_PER_DAY + 3 * 60)).toBe('night');
      expect(timeOfDayAt(day * MINUTES_PER_DAY + OPEN_FROM)).toBe('day');
      expect(timeOfDayAt(day * MINUTES_PER_DAY + 21 * 60)).toBe('night');
    }
  });

  it('sklep otwarty od 6:00 zaczyna dzień, a o 23:00 (zamknięcie) jest już noc', () => {
    expect(timeOfDayAt(OPEN_FROM)).toBe('day');
    expect(timeOfDayAt(OPEN_TO)).toBe('night');
  });
});

describe('crowdRateFor: gęstość tłumu z ekonomii', () => {
  it('sklep zamknięty (przed otwarciem, po zamknięciu) nie wpuszcza nikogo i wyprasza tych w środku (closing)', () => {
    for (const hour of [0, 3, 5, 23]) {
      for (const preset of PRESETS) expect(crowdRateFor(atHour(hour), preset)).toEqual({ targetCount: 0, spawnPerMinute: 0, closing: true });
    }
  });

  it('remont zamyka sklep także w godzinach otwarcia', () => {
    const s = atHour(12);
    expect(crowdRateFor(s, 'srednia').targetCount).toBeGreaterThan(0);
    s.econ.remontUntil = s.econ.minute + 120;
    expect(crowdRateFor(s, 'srednia')).toEqual({ targetCount: 0, spawnPerMinute: 0, closing: true });
    s.econ.minute += 120;   // remont się skończył
    expect(crowdRateFor(s, 'srednia').targetCount).toBeGreaterThan(0);
  });

  it('karta „zamknij na godzinę” też zamyka sklep dla tłumu, mimo że godziny i remont go nie zamykają', () => {
    const s = atHour(12);
    expect(crowdRateFor(s, 'srednia').targetCount).toBeGreaterThan(0);
    s.econ.tycoon.cards.active.push({ kind: 'closed', value: 1, from: s.econ.minute, until: s.econ.minute + 60, seq: 1 });
    expect(isStoreOpen(s.econ)).toBe(true);   // dla samej ekonomii (godziny, remont) sklep stoi otwarty
    expect(isOpenForCustomers(s.econ)).toBe(false);
    for (const preset of PRESETS) expect(crowdRateFor(s, preset)).toEqual({ targetCount: 0, spawnPerMinute: 0, closing: true });
    s.econ.minute += 60;   // efekt się skończył
    expect(crowdRateFor(s, 'srednia').targetCount).toBeGreaterThan(0);
  });

  it('liczy ruch z godziny: klientów na godzinę (dzień / 15,6 · krzywa) razy 0,35 w tłumie i 0,3 w napływie', () => {
    const s = atHour(8);
    const perHour = expectedDailyCustomers(s.econ, s.info) / 15.6 * HOUR_CURVE[8]!;
    const rate = crowdRateFor(s, 'wysoka');
    expect(rate.targetCount).toBe(Math.max(4, Math.min(CROWD_MAX.wysoka, Math.round(perHour * 0.35))));
    expect(rate.spawnPerMinute).toBeCloseTo(Math.max(3, Math.min(24, perHour * 0.3)), 12);
    // godzina szczytu (8:00, 1,3) ma gęstszy ruch niż spokojne przedpołudnie (10:00, 0,7)
    expect(crowdRateFor(s, 'wysoka').spawnPerMinute).toBeGreaterThan(crowdRateFor(atHour(10), 'wysoka').spawnPerMinute);
  });

  it('spokojny sklep ma dolną granicę: 4 postacie i 3 klientów na minutę', () => {
    const s = atHour(6);   // 6:00: krzywa 0,5, nowy sklep
    s.econ.reputation = 0;
    s.info = { ...s.info, shelfCapTotal: 0 };   // sam ruch z ulicy (TRAFFIC_BASE), bez klientów, których ściągają półki
    expect(trafficPerHour(s)).toBeLessThan(10);   // poniżej obu dolnych granic
    const rate = crowdRateFor(s, 'wysoka');
    expect(rate).toEqual({ targetCount: 4, spawnPerMinute: 3 });
  });

  it('duży ruch: tłum ogranicza preset grafiki, napływ 24 na minutę', () => {
    for (const preset of PRESETS) {
      const rate = crowdRateFor(busy(8), preset);
      expect(rate.targetCount).toBe(CROWD_MAX[preset]);
      expect(rate.spawnPerMinute).toBe(24);
    }
    expect(CROWD_MAX).toEqual({ niska: 10, srednia: 16, wysoka: 22 });
  });

  it('czyta tylko stan i opis sklepu, niczego nie zmienia', () => {
    const s = busy(17);
    const before = JSON.stringify([s.econ, s.info]);
    crowdRateFor(s, 'niska');
    expect(JSON.stringify([s.econ, s.info])).toBe(before);
  });
});

describe('clearSeedFromUrl: zdjęcie ?seed= z adresu', () => {
  /** Adres i historia przeglądarki z atrap: `replaceState` zapisuje nowy adres, który widać potem w `location.href`. */
  function browserAt(href: string): { replaced: string[]; current: () => string } {
    const replaced: string[] = [];
    const where = { href };
    vi.stubGlobal('location', where);
    vi.stubGlobal('history', { replaceState: (_state: unknown, _title: string, url: string | URL) => { replaced.push(String(url)); where.href = String(url); } });
    return { replaced, current: () => where.href };
  }

  it('zdejmuje tylko seed: pozostałe parametry (też `new=1`) i fragment adresu zostają', () => {
    const b = browserAt('http://127.0.0.1:5173/?debug=1&seed=kielbasa-42&new=1&yaw=2#sklep');
    clearSeedFromUrl();
    expect(b.replaced).toHaveLength(1);
    const url = new URL(b.current());
    expect([...url.searchParams.keys()]).toEqual(['debug', 'new', 'yaw']);
    expect(url.searchParams.get('debug')).toBe('1');
    expect(url.searchParams.get('yaw')).toBe('2');
    expect(url.hash).toBe('#sklep');
    expect(url.pathname).toBe('/');
  });

  it('adres z samym seedem traci znak zapytania; seed z polskimi znakami i spacją też znika', () => {
    const b = browserAt('http://127.0.0.1:5173/gra/?seed=kie%C5%82basa%2042');
    clearSeedFromUrl();
    expect(b.current()).toBe('http://127.0.0.1:5173/gra/');
  });

  it('bez ?seed= nic nie robi (historia nietknięta); wyjątek przeglądarki nie wychodzi na zewnątrz', () => {
    const b = browserAt('http://127.0.0.1:5173/?debug=1#x');
    clearSeedFromUrl();
    expect(b.replaced).toEqual([]);

    vi.stubGlobal('location', { href: 'http://127.0.0.1:5173/?seed=a' });
    vi.stubGlobal('history', { replaceState: () => { throw new DOMException('zablokowane', 'SecurityError'); } });
    expect(() => clearSeedFromUrl()).not.toThrow();
  });
});

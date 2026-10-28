import { describe, expect, it } from 'vitest';
import {
  MASTER_GAIN, MAX_VOICES, PITCH_SPREAD, SFX_GAIN, SFX_KINDS,
  activeVoices, leadSilence, parseManifest, pickVariant, pitchRate, planPlayback,
} from './sfxBank';

/** `rand` zwracający kolejne wartości z listy (i ostatnią w kółko). */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};
/** Wartości z [0, 1) co 0,01: pokrywają cały przedział, łącznie z zerem i końcem. */
const SWEEP = Array.from({ length: 100 }, (_, i) => i / 100).concat(0.9999999999);
const byValue = (a: number, b: number): number => a - b;

describe('SFX_KINDS', () => {
  it('to dokładnie dziesięć rodzajów, które zna gra (bez powtórzeń)', () => {
    expect([...SFX_KINDS]).toEqual(['tap', 'cash', 'coins', 'levelup', 'gift', 'pop', 'fine', 'golden', 'delivery', 'error']);
    expect(new Set(SFX_KINDS).size).toBe(SFX_KINDS.length);
  });
});

describe('pickVariant: wariant bez powtórzenia poprzedniego', () => {
  it('jeden wariant albo żaden: zawsze 0', () => {
    for (const r of SWEEP) {
      expect(pickVariant(1, 0, () => r)).toBe(0);
      expect(pickVariant(1, undefined, () => r)).toBe(0);
      expect(pickVariant(0, undefined, () => r)).toBe(0);
    }
  });

  it('przy kilku wariantach nigdy nie powtarza poprzedniego, dla każdego poprzedniego i każdej wartości losowej', () => {
    for (const count of [2, 3, 5, 6]) {
      for (let last = 0; last < count; last++) {
        for (const r of SWEEP) {
          const v = pickVariant(count, last, () => r);
          expect(v, `count ${count}, last ${last}, rand ${r}`).not.toBe(last);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(count);
        }
      }
    }
  });

  it('dwa warianty: zawsze ten drugi', () => {
    for (const r of SWEEP) {
      expect(pickVariant(2, 0, () => r)).toBe(1);
      expect(pickVariant(2, 1, () => r)).toBe(0);
    }
  });

  it('osiąga wszystkie pozostałe warianty, każdy tyle samo razy (rozkład równy, nie „do skutku”)', () => {
    const counts = new Map<number, number>();
    for (const r of SWEEP) {
      const v = pickVariant(6, 2, () => r);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect([...counts.keys()].sort(byValue)).toEqual([0, 1, 3, 4, 5]);
    // 101 wartości w równych odstępach na 5 wariantów: każdy dostaje 20 albo 21
    for (const n of counts.values()) expect(n).toBeGreaterThanOrEqual(20);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(21);
  });

  it('pierwszy dźwięk (brak poprzedniego) losuje spośród wszystkich wariantów', () => {
    const hit = new Set(SWEEP.map((r) => pickVariant(4, undefined, () => r)));
    expect([...hit].sort(byValue)).toEqual([0, 1, 2, 3]);
  });

  it('poprzedni spoza zakresu (np. po zmianie liczby wariantów) jest ignorowany', () => {
    for (const last of [-1, 4, 99, NaN]) {
      const hit = new Set(SWEEP.map((r) => pickVariant(4, last, () => r)));
      expect([...hit].sort(byValue)).toEqual([0, 1, 2, 3]);
    }
  });

  it('zła wartość z rand (NaN, ujemna, ≥ 1) nie wyprowadza indeksu poza zakres', () => {
    for (const bad of [NaN, -3, 1, 7, Infinity, -Infinity]) {
      const v = pickVariant(5, 1, () => bad);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(v).not.toBe(1);
    }
  });

  it('kolejne wywołania z poprzednim wynikiem jako „last” nie dają powtórzeń w długiej serii', () => {
    let state = 12345;
    const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
    let last: number | undefined;
    for (let i = 0; i < 2000; i++) {
      const v = pickVariant(6, last, rand);
      expect(v).not.toBe(last);
      last = v;
    }
  });
});

describe('pitchRate: rozrzut wysokości', () => {
  it('granice playbackRate: ±4% przy rozrzucie 0,04 (przedział prawostronnie otwarty)', () => {
    expect(pitchRate(0.04, () => 0)).toBeCloseTo(0.96, 12);
    expect(pitchRate(0.04, () => 0.5)).toBe(1);
    expect(pitchRate(0.04, () => 0.9999999999)).toBeLessThan(1.04);
    expect(pitchRate(0.04, () => 0.9999999999)).toBeCloseTo(1.04, 8);
  });

  it('dla każdej wartości losowej wynik mieści się w [1 − r, 1 + r], także przy złym rand', () => {
    for (const spread of [0.01, 0.04, 0.1]) {
      for (const r of [...SWEEP, NaN, -5, 5, Infinity]) {
        const rate = pitchRate(spread, () => r);
        expect(rate).toBeGreaterThanOrEqual(1 - spread - 1e-12);
        expect(rate).toBeLessThanOrEqual(1 + spread + 1e-12);
      }
    }
  });

  it('bez rozrzutu (dżingle) dokładnie 1 i nie zużywa losowości', () => {
    let calls = 0;
    const rand = () => { calls++; return 0.3; };
    expect(pitchRate(0, rand)).toBe(1);
    expect(pitchRate(-1, rand)).toBe(1);
    expect(calls).toBe(0);
  });

  it('jest rosnąca względem wartości losowej: wysokość zależy tylko od rand', () => {
    expect(pitchRate(0.04, () => 0.25)).toBeLessThan(pitchRate(0.04, () => 0.75));
  });
});

describe('tabele rodzajów', () => {
  it('częste dźwięki (tap, cash, coins) mają rozrzut wysokości w granicach ±4%, a dżingle (levelup, golden) grają bez zmiany wysokości', () => {
    for (const kind of ['tap', 'cash', 'coins'] as const) {
      expect(PITCH_SPREAD[kind], kind).toBeGreaterThan(0);
      expect(PITCH_SPREAD[kind], kind).toBeLessThanOrEqual(0.04);
    }
    expect(PITCH_SPREAD.levelup).toBe(0);
    expect(PITCH_SPREAD.golden).toBe(0);
    for (const kind of SFX_KINDS) expect(PITCH_SPREAD[kind], kind).toBeLessThanOrEqual(0.04);
  });

  it('głośności: każdy rodzaj ma wartość dodatnią, a razem z MASTER_GAIN nie przekracza 1 (pliki mają szczyty do −1 dBFS: zapas przed przesterowaniem)', () => {
    expect(MASTER_GAIN).toBeGreaterThan(0);
    for (const kind of SFX_KINDS) {
      expect(SFX_GAIN[kind], kind).toBeGreaterThan(0);
      expect(MASTER_GAIN * SFX_GAIN[kind], kind).toBeLessThanOrEqual(1);
    }
  });
});

describe('activeVoices: limit głosów liczy tylko te, które jeszcze grają', () => {
  it('odrzuca zakończone (koniec ≤ teraz) i zostawia grające w tej samej kolejności', () => {
    expect(activeVoices([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(activeVoices([5, 1, 9, 2], 2.5)).toEqual([5, 9]);
    expect(activeVoices([], 10)).toEqual([]);
    expect(activeVoices([1, 2], 10)).toEqual([]);
  });

  it('nie zmienia wejścia', () => {
    const ends = [1, 5];
    activeVoices(ends, 3);
    expect(ends).toEqual([1, 5]);
  });
});

describe('planPlayback: próbka, synteza albo porzucenie', () => {
  const base = { last: undefined, active: 0, spread: 0.04, rand: () => 0.5 };

  it('bez wczytanych próbek gra synteza', () => {
    expect(planPlayback({ ...base, variants: 0 })).toEqual({ how: 'synth' });
  });

  it('bez próbek synteza gra także przy pełnych głosach (nie zajmuje głosu, a brak dźwięku byłby gorszy)', () => {
    expect(planPlayback({ ...base, variants: 0, active: MAX_VOICES + 5 })).toEqual({ how: 'synth' });
  });

  it('z próbkami i wolnym głosem gra próbka: wariant z zakresu, wysokość w granicach rozrzutu', () => {
    const plan = planPlayback({ ...base, variants: 6, last: 3, rand: seq(0.4, 0.9) });
    expect(plan.how).toBe('sample');
    if (plan.how !== 'sample') return;
    expect(plan.variant).toBeGreaterThanOrEqual(0);
    expect(plan.variant).toBeLessThan(6);
    expect(plan.variant).not.toBe(3);
    expect(plan.rate).toBeGreaterThanOrEqual(0.96);
    expect(plan.rate).toBeLessThanOrEqual(1.04);
  });

  it('wysokość i wariant biorą osobne losowania (wariant z pierwszego, wysokość z drugiego)', () => {
    const low = planPlayback({ ...base, variants: 4, rand: seq(0, 0) });
    expect(low.how === 'sample' && low.variant).toBe(0);
    expect(low.how === 'sample' && low.rate).toBeCloseTo(0.96, 12);
    const high = planPlayback({ ...base, variants: 4, rand: seq(0.99, 0.999999) });
    expect(high.how === 'sample' && high.variant).toBe(3);
    expect(high.how === 'sample' && high.rate).toBeGreaterThan(1.039);
  });

  it('dźwięk bez rozrzutu (dżingle) gra dokładnie z rate 1', () => {
    const plan = planPlayback({ ...base, variants: 1, spread: 0 });
    expect(plan).toEqual({ how: 'sample', variant: 0, rate: 1 });
  });

  it('przy pełnym limicie głosów dźwięk z próbką przepada; jeden głos poniżej limitu jeszcze gra', () => {
    expect(planPlayback({ ...base, variants: 3, active: MAX_VOICES })).toEqual({ how: 'drop' });
    expect(planPlayback({ ...base, variants: 3, active: MAX_VOICES + 1 })).toEqual({ how: 'drop' });
    expect(planPlayback({ ...base, variants: 3, active: MAX_VOICES - 1 }).how).toBe('sample');
  });

  it('limit można podać; domyślnie to MAX_VOICES (8)', () => {
    expect(MAX_VOICES).toBe(8);
    expect(planPlayback({ ...base, variants: 3, active: 2, maxVoices: 2 })).toEqual({ how: 'drop' });
    expect(planPlayback({ ...base, variants: 3, active: 1, maxVoices: 2 }).how).toBe('sample');
  });

  it('nie losuje, gdy gra synteza albo dźwięk przepada', () => {
    let calls = 0;
    const rand = () => { calls++; return 0.5; };
    planPlayback({ ...base, variants: 0, rand });
    planPlayback({ ...base, variants: 3, active: 99, rand });
    expect(calls).toBe(0);
  });
});

describe('parseManifest: manifest z public/assets/audio', () => {
  it('poprawny manifest przechodzi bez zmian', () => {
    expect(parseManifest({ tap: ['tap-0.mp3', 'tap-1.mp3'], cash: ['cash-0.mp3'] })).toEqual({ tap: ['tap-0.mp3', 'tap-1.mp3'], cash: ['cash-0.mp3'] });
  });

  it('nieznane rodzaje są pomijane', () => {
    expect(parseManifest({ tap: ['tap-0.mp3'], boom: ['boom-0.mp3'] })).toEqual({ tap: ['tap-0.mp3'] });
  });

  it('pola dziedziczone z prototypu nie są częścią manifestu', () => {
    const inherited = Object.create({ pop: ['pop-0.mp3'] }) as Record<string, unknown>;
    inherited.tap = ['tap-0.mp3'];
    expect(parseManifest(inherited)).toEqual({ tap: ['tap-0.mp3'] });
  });

  it('nazwy plików spoza katalogu audio albo nie-mp3 są pomijane (manifest nie wskazuje obcych adresów)', () => {
    const out = parseManifest({ tap: ['../secret.mp3', 'a/b.mp3', 'https://evil.example/x.mp3', 'tap-0.wav', '', 'tap 1.mp3', 'tap-2.mp3', 7, null] });
    expect(out).toEqual({ tap: ['tap-2.mp3'] });
  });

  it('puste i błędne listy znikają, a nie-obiekty dają pusty wynik', () => {
    expect(parseManifest({ tap: [], cash: 'cash-0.mp3', coins: { 0: 'a.mp3' } })).toEqual({});
    for (const bad of [null, undefined, 'x', 3, [], [['tap-0.mp3']], true]) expect(parseManifest(bad)).toEqual({});
  });
});

describe('leadSilence: pominięcie ciszy przed atakiem', () => {
  const RATE = 44100;
  /** Bufor: `lead` próbek ciszy (lub szumu), potem dźwięk o amplitudzie `amp` przez `len` próbek. */
  const buffer = (lead: number, amp: number, len = 4410, noise = 0): Float32Array => {
    const x = new Float32Array(lead + len);
    for (let i = 0; i < lead; i++) x[i] = noise * (i % 2 ? 1 : -1);
    for (let i = 0; i < len; i++) x[lead + i] = amp * Math.sin(i * 0.3);
    x[lead + 3] = amp;   // pewny szczyt
    return x;
  };

  it('bufor zaczynający się od ataku (dekoder odciął opóźnienie) nie jest pomijany', () => {
    expect(leadSilence(buffer(0, 0.8), RATE)).toBe(0);
  });

  it('cisza z opóźnienia enkodera MP3 (1105 próbek ≈ 25 ms) jest pomijana z zapasem 1 ms przed atakiem', () => {
    const skip = leadSilence(buffer(1105, 0.8), RATE);
    expect(skip).toBeGreaterThan(0.022);
    expect(skip).toBeLessThan(1105 / RATE);
    // start w chwili `skip` wypada najwyżej 2 ms przed pierwszą próbką ataku
    expect(1105 / RATE - skip).toBeLessThan(0.002 + 0.0005);
  });

  it('ciche pre-echo przed atakiem nie jest uznawane za początek dźwięku', () => {
    // szum 0,01 (−40 dBFS) przez 20 ms, potem atak 0,8: próg względny (3% szczytu = 0,024) go omija
    const skip = leadSilence(buffer(1105, 0.8, 4410, 0.01), RATE);
    expect(skip).toBeGreaterThan(0.022);
  });

  it('pomija najwyżej 60 ms: dźwięk z miękkim początkiem (25 ms opóźnienia + kilkadziesiąt ms cichego wstępu) dostaje pełne pominięcie', () => {
    const skip = leadSilence(buffer(Math.round(0.055 * RATE), 0.8), RATE);   // 55 ms ciszy: w zasięgu
    expect(skip).toBeGreaterThan(0.053);
    expect(skip).toBeLessThan(0.055);
  });

  it('początek dalszy niż 60 ms (dźwięk, który tak zaczyna) gra od początku zamiast być obcinany', () => {
    expect(leadSilence(buffer(4410, 0.8), RATE)).toBe(0);   // 100 ms ciszy
    expect(leadSilence(buffer(Math.round(0.065 * RATE), 0.8), RATE)).toBe(0);
  });

  it('cichy bufor (poniżej progu bezwzględnego) i pusty nie są ruszane', () => {
    expect(leadSilence(buffer(500, 0.001), RATE)).toBe(0);
    expect(leadSilence(new Float32Array(0), RATE)).toBe(0);
    expect(leadSilence(new Float32Array(2000), RATE)).toBe(0);
  });

  it('próbki o ujemnym znaku liczą się tak samo (moduł)', () => {
    const x = buffer(900, 0.8);
    const flipped = x.map((v) => -v);
    expect(leadSilence(flipped, RATE)).toBeCloseTo(leadSilence(x, RATE), 12);
  });
});

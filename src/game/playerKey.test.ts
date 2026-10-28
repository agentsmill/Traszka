import { describe, expect, it } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from './cashier';
import type { Meta, Player } from './meta';
import {
  CROCKFORD, KEY_LENGTH, RECOVERY_ERRORS, adoptRecoveryCode, ensurePlayerKey, formatRecoveryCode, generatePlayerKey, keepPlayerKey,
  parseRecoveryCode,
} from './playerKey';

/** Bajty z tablicy (powtarzane w kółko): losowanie do testów, bez `crypto`. */
const bytes = (values: number[]) => (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => values[i % values.length]!);

const player = (over: Partial<Player> = {}): Player => ({
  nick: 'Mateusz', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true, ...over,
});
const meta = (over: Partial<Meta> = {}): Meta => ({
  version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true, ...over,
});

describe('klucz gracza: losowanie', () => {
  it('20 znaków Crockforda, czyli 100 bitów (5 bitów na znak, alfabet bez I, L, O, U)', () => {
    expect(KEY_LENGTH).toBe(20);
    expect(CROCKFORD).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(CROCKFORD).toHaveLength(32);
    const key = generatePlayerKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/);
  });

  it('bierze dolne 5 bitów każdego bajtu: każdy z 32 znaków jest osiągalny, a 256 to wielokrotność 32 (równe szanse)', () => {
    expect(generatePlayerKey(bytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])))
      .toBe('0123456789ABCDEFGHJK');
    expect(generatePlayerKey(bytes([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])))
      .toBe('MNPQRSTVWXYZMNPQRSTV');
    expect(generatePlayerKey(bytes([32, 255, 63, 224]))).toBe('0ZZ0'.repeat(5));
  });

  it('prawdziwe losowanie z crypto.getRandomValues daje za każdym razem inny klucz', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generatePlayerKey()));
    expect(keys.size).toBe(50);
  });
});

describe('kod odzyskiwania: zapis i odczyt', () => {
  const KEY = 'K7QX9MBD2HFAP3WN8RTE';

  it('pięć grup po cztery znaki, rozdzielonych łącznikiem', () => {
    expect(formatRecoveryCode(KEY)).toBe('K7QX-9MBD-2HFA-P3WN-8RTE');
  });

  it('odczyt wraca do klucza z dowolnie zapisanego kodu: wielkość liter, spacje i łączniki nie mają znaczenia', () => {
    expect(parseRecoveryCode('K7QX-9MBD-2HFA-P3WN-8RTE')).toBe(KEY);
    expect(parseRecoveryCode('k7qx 9mbd 2hfa p3wn 8rte')).toBe(KEY);
    expect(parseRecoveryCode('  k7qx9mbd-2hfa  p3wn8rte ')).toBe(KEY);
    expect(parseRecoveryCode(KEY)).toBe(KEY);
    expect(parseRecoveryCode(formatRecoveryCode(KEY))).toBe(KEY);
  });

  it('znaki podobne z alfabetu Crockforda: O to zero, I i L to jedynka', () => {
    expect(parseRecoveryCode('OOOO-IIII-LLLL-oooo-iill')).toBe('00001111111100001111');
  });

  it('łączniki z klawiatury telefonu (półpauza, minus) i znaki pełnej szerokości też przechodzą', () => {
    expect(parseRecoveryCode('K7QX–9MBD—2HFA−P3WN‐8RTE')).toBe(KEY);
    expect(parseRecoveryCode('Ｋ７ＱＸ９ＭＢＤ２ＨＦＡＰ３ＷＮ８ＲＴＥ')).toBe(KEY);
  });

  it('znaki niewidoczne dopisane przy wklejaniu (spacja zerowej szerokości, znaczniki kierunku, miękki łącznik, BOM…) nic nie znaczą', () => {
    const invisible: Record<string, string> = {
      'U+200B spacja zerowej szerokości': '\u200b', 'U+200E znacznik lewo-prawo': '\u200e', 'U+00AD miękki łącznik': '\u00ad',
      'U+200F znacznik prawo-lewo': '\u200f', 'U+2060 łącznik słów': '\u2060', 'U+FEFF BOM': '\ufeff', 'U+202E nadpisanie kierunku': '\u202e',
      'U+2066 izolat kierunku': '\u2066', 'U+200D spójnik zerowej szerokości': '\u200d', 'U+061C znak arabski': '\u061c',
    };
    for (const [name, c] of Object.entries(invisible)) {
      expect(parseRecoveryCode(`${c}K7QX-9MBD-2HFA-P3WN-8RTE`), `${name} na początku`).toBe(KEY);
      expect(parseRecoveryCode(`K7QX-9MBD-2HFA-P3WN-8RTE${c}`), `${name} na końcu`).toBe(KEY);
      expect(parseRecoveryCode(`K7QX${c}-9MBD-2HFA${c} P3WN-8${c}RTE`), `${name} w środku`).toBe(KEY);
      expect(parseRecoveryCode(`${c}K${c}7${c}Q${c}X${c}9MBD2HFAP3WN8RTE${c}`), `${name} między znakami`).toBe(KEY);
      expect(parseRecoveryCode(`k7qx ${c}9mbd${c}-2hfa ${c}${c} p3wn-8rte`), `${name} i małe litery`).toBe(KEY);
    }
    expect(parseRecoveryCode('\u200bK7QX\u200e-9MBD-\u00ad2HFA-P3WN-8RTE')).toBe(KEY);   // trzy naraz, tak jak z komunikatora
  });

  it('znaki niewidoczne nie robią z błędnego kodu poprawnego: zła długość, litera spoza alfabetu i limit długości wejścia dalej obowiązują', () => {
    expect(parseRecoveryCode('K7QX-9MBD-2HFA-P3WN-8RT\u200b')).toBeNull();            // 19 znaków
    expect(parseRecoveryCode('K7QX-9MBD-2HFA-P3WN-8RTE\u200b0')).toBeNull();          // 21 znaków
    expect(parseRecoveryCode('U7QX-9MBD-2HFA-P3WN-8RTE\u200b')).toBeNull();           // U poza alfabetem
    expect(parseRecoveryCode('K7QX-9MBD-2HFA-P3WN-8RT\u200b!')).toBeNull();
    expect(parseRecoveryCode('\u200b'.repeat(10_000) + KEY)).toBeNull();
    expect(parseRecoveryCode('\u200b\u200e\u00ad')).toBeNull();
  });

  it('za krótki, za długi, z literą spoza alfabetu (U) albo z innym znakiem: null', () => {
    expect(parseRecoveryCode('K7QX-9MBD-2HFA-P3WN')).toBeNull();
    expect(parseRecoveryCode(KEY + '0')).toBeNull();
    expect(parseRecoveryCode('U7QX-9MBD-2HFA-P3WN-8RTE')).toBeNull();
    expect(parseRecoveryCode('K7QX_9MBD_2HFA_P3WN_8RTE')).toBeNull();
    expect(parseRecoveryCode('K7QX-9MBD-2HFA-P3WN-8RT!')).toBeNull();
    expect(parseRecoveryCode('')).toBeNull();
  });

  it('nie-tekst i bardzo długi tekst: null (zapis i treść żądania są bez zaufania)', () => {
    for (const v of [null, undefined, 12345, {}, [KEY], true]) expect(parseRecoveryCode(v)).toBeNull();
    expect(parseRecoveryCode(' '.repeat(10_000) + KEY)).toBeNull();
  });
});

describe('klucz w mecie gracza', () => {
  const KEY = 'K7QX9MBD2HFAP3WN8RTE';

  it('gracz bez klucza dostaje nowy przy pierwszym wejściu; nowa meta, a stara zostaje bez zmian', () => {
    const before = meta({ player: player() });
    const after = ensurePlayerKey(before, () => KEY);
    expect(after).not.toBe(before);
    expect(after.player).toEqual({ ...player(), key: KEY });
    expect(before.player?.key).toBeUndefined();
  });

  it('poprawny zapisany klucz nigdy nie jest zastępowany (ta sama meta, losowanie nie jest wołane)', () => {
    const m = meta({ player: player({ key: KEY }) });
    let calls = 0;
    expect(ensurePlayerKey(m, () => { calls++; return 'ZZZZZZZZZZZZZZZZZZZZ'; })).toBe(m);
    expect(calls).toBe(0);
  });

  it('bez gracza (przed ekranem startowym) i w mecie z nowszej wersji gry klucz nie powstaje: nie byłoby go gdzie zapisać', () => {
    const none = meta();
    expect(ensurePlayerKey(none, () => KEY)).toBe(none);
    const readOnly = meta({ player: player(), readOnly: true });
    expect(ensurePlayerKey(readOnly, () => KEY)).toBe(readOnly);
  });

  it('nowy gracz z ekranu „Nowy sklep” zachowuje klucz poprzedniego (inaczej gracz traciłby nick w rankingu)', () => {
    const next = player({ nick: 'Kasia' });
    expect(keepPlayerKey(player({ key: KEY }), next)).toEqual({ ...next, key: KEY });
    expect(keepPlayerKey(undefined, next)).toEqual(next);
    expect(keepPlayerKey(player(), next)).toEqual(next);
    // wybór z klucz już ma (np. po wpisaniu kodu): ten wygrywa
    const other = 'ZZZZZZZZZZZZZZZZZZZZ';
    expect(keepPlayerKey(player({ key: KEY }), player({ key: other })).key).toBe(other);
  });

  it('wpisany kod zastępuje klucz na tym urządzeniu (tylko na wyraźne polecenie), reszta gracza zostaje', () => {
    const before = meta({ player: player({ key: 'ZZZZZZZZZZZZZZZZZZZZ' }), partnerPoints: 3 });
    const res = adoptRecoveryCode(before, 'k7qx-9mbd-2hfa-p3wn-8rte');
    expect(res).toEqual({ meta: { ...before, player: { ...player(), key: KEY } } });
    expect(before.player?.key).toBe('ZZZZZZZZZZZZZZZZZZZZ');
  });

  it('zły kod i brak gracza: komunikat, meta bez zmian', () => {
    expect(adoptRecoveryCode(meta({ player: player({ key: KEY }) }), 'abc')).toEqual({ error: RECOVERY_ERRORS.invalid });
    expect(adoptRecoveryCode(meta(), KEY)).toEqual({ error: RECOVERY_ERRORS.noPlayer });
    expect(adoptRecoveryCode(meta({ player: player(), readOnly: true }), KEY)).toEqual({ error: RECOVERY_ERRORS.readOnly });
  });
});

import { describe, expect, it } from 'vitest';
import { NICK_ERRORS } from '@/game/nick';
import { normalizeSeed } from '@/game/seeds';
import { KNOWN_GAME_VERSIONS, KNOWN_GENERATOR_VERSIONS, RUN_MAX_COMMAND_BYTES, RUN_MAX_LOG_ENTRIES, SEASON_END_MINUTE } from './config';
import { parseSubmission, type RunRecord } from './runs';

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const run = (over: Partial<Record<keyof RunRecord, unknown>> = {}): Record<string, unknown> => ({
  seed: 'pierogi-731', gameVersion: KNOWN_GAME_VERSIONS[0], generatorVersion: KNOWN_GENERATOR_VERSIONS[0], mode: 'ranked',
  log: [
    { minute: 360, seq: 0, cmd: { type: 'tapPallet', palletId: 3 } },
    { minute: 360, seq: 1, cmd: { type: 'tapTill' } },
    { minute: 700, seq: 2, cmd: { type: 'setOrder', auto: false, manual: 5 } },
  ],
  ...over,
});
const body = (over: Record<string, unknown> = {}, runOver: Partial<Record<keyof RunRecord, unknown>> = {}): unknown => ({
  key: 'k7qx-9mbd-2hfa-p3wn-8rte', nick: '  Mateusz ', run: run(runOver), ...over,
});

describe('zgłoszenie biegu: kształt i granice', () => {
  it('poprawne zgłoszenie: klucz kanoniczny, nick po normalizacji, czysty RunRecord bez obcych pól', () => {
    const res = parseSubmission(body({ extra: 1 }, { coś: 'obcego' } as never));
    expect(res).toEqual({
      ok: true,
      value: {
        key: KEY, nick: 'Mateusz', nickKey: 'mateusz',
        run: { seed: 'pierogi-731', gameVersion: KNOWN_GAME_VERSIONS[0], generatorVersion: KNOWN_GENERATOR_VERSIONS[0], mode: 'ranked', log: run().log },
      },
    });
  });

  it('pusty dziennik też jest biegiem (gracz bierny), a każde polecenie to osobna kopia', () => {
    const res = parseSubmission(body({}, { log: [] }));
    expect(res.ok && res.value.run.log).toEqual([]);
    const original = run();
    const parsed = parseSubmission({ key: KEY, nick: 'Ala', run: original });
    expect(parsed.ok && parsed.value.run.log[0]!.cmd).not.toBe((original.log as { cmd: unknown }[])[0]!.cmd);
  });

  it('nie obiekt, brak pól, złe typy: bad-request', () => {
    for (const b of [null, 'x', [], {}, { key: KEY, nick: 'Ala' }, { key: KEY, run: run() }, { nick: 'Ala', run: run() }, body({ run: 'bieg' })]) {
      expect(parseSubmission(b), JSON.stringify(b)?.slice(0, 60)).toMatchObject({ ok: false, error: 'bad-request' });
    }
  });

  it('zły klucz: bad-key', () => {
    for (const key of ['abc', 5, '', 'U'.repeat(20)]) expect(parseSubmission(body({ key }))).toMatchObject({ ok: false, error: 'bad-key' });
  });

  it('zły nick: bad-nick z komunikatem z reguł nicka (te same co na ekranie startowym)', () => {
    expect(parseSubmission(body({ nick: 'Mаteusz' }))).toEqual({ ok: false, error: 'bad-nick', message: NICK_ERRORS.chars });
    expect(parseSubmission(body({ nick: 'Centrala' }))).toEqual({ ok: false, error: 'bad-nick', message: NICK_ERRORS.reserved });
    expect(parseSubmission(body({ nick: 'x'.repeat(21) }))).toEqual({ ok: false, error: 'bad-nick', message: NICK_ERRORS.length });
    expect(parseSubmission(body({ nick: 7 }))).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('filtra słów nie ma (decyzja z 2026-10-28): wulgarny nick i „Traszka” w środku nicka przechodzą, jeśli spełniają reguły gry', () => {
    for (const nick of ['Kurwa_Mać', 'admin2', 'TraszkaFan', 'Centrala_Oficjalnie']) {
      expect(parseSubmission(body({ nick })), nick).toMatchObject({ ok: true, value: { nick } });
    }
  });

  it('nieznana wersja gry albo generatora: old-version; tryb zwykły: not-ranked', () => {
    expect(parseSubmission(body({}, { gameVersion: '9.9.9' }))).toMatchObject({ ok: false, error: 'old-version' });
    expect(parseSubmission(body({}, { generatorVersion: 99 }))).toMatchObject({ ok: false, error: 'old-version' });
    expect(parseSubmission(body({}, { gameVersion: 5 }))).toMatchObject({ ok: false, error: 'bad-request' });
    expect(parseSubmission(body({}, { mode: 'casual' }))).toMatchObject({ ok: false, error: 'not-ranked' });
    expect(parseSubmission(body({}, { mode: 'turbo' }))).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('seed: pusty, za długi, ze znakami sterującymi albo niewidocznymi (ranking widzą wszyscy): bad-seed', () => {
    for (const seed of ['', ' pierogi', 'pierogi ', 'x'.repeat(49), 'pie\nrogi', 'pie‮rogi', 'pie​rogi', 'pie﻿rogi', 'a b']) {
      expect(parseSubmission(body({}, { seed })), JSON.stringify(seed)).toMatchObject({ ok: false, error: 'bad-seed' });
    }
    // emoji ze spójnikiem, polskie litery i sąsiedni lokal są w porządku
    for (const seed of ['👩‍🍳 kuchnia', 'kiełbasa-42', 'pierogi-731·2', 'x'.repeat(48)]) {
      expect(parseSubmission(body({}, { seed })).ok, seed).toBe(true);
    }
  });

  it('seed z flagą Anglii, Szkocji albo Walii (cała sekwencja z Unicode) przechodzi, tak jak go przyjmuje gra', () => {
    const flag = (code: string): string => `\u{1f3f4}${Array.from(code, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')}\u{e007f}`;
    for (const seed of [flag('gbeng'), flag('gbsct'), flag('gbwls'), `moja ${flag('gbeng')} flaga`, `${flag('gbwls')}-7`]) {
      expect(parseSubmission(body({}, { seed })).ok, Array.from(seed).map((c) => c.codePointAt(0)!.toString(16)).join(' ')).toBe(true);
    }
  });

  it('seed z miękkim łącznikiem, obcą flagą, znacznikami bez flagi albo osamotnionym surogatem: bad-seed (nie da się go pokazać ani zapisać w adresie)', () => {
    const tags = (letters: string): string => Array.from(letters, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    const bad = [
      'pie\u{00ad}rogi', 'pie\u{061c}rogi', 'pie\u{180e}rogi', 'pie\u{2062}rogi', 'pie\u{fff9}rogi', 'pie\u{1d173}rogi',
      `\u{1f3f4}${tags('gbxxx')}\u{e007f}`, `\u{1f3f4}${tags('gbeng')}`, `${tags('gbeng')}\u{e007f}`, `hej${tags('tajne')}`, `a${tags('gbeng')}\u{e007f}`,
      'pie\ud83drogi', 'pie\ude00rogi', '\ud83d', '\ude00',
      'pie\u{200d}rogi', '\u{200d}pierogi', 'pierogi\u{200d}', '👩\u{200d}',
    ];
    for (const seed of bad) {
      expect(parseSubmission(body({}, { seed })), Array.from(seed).map((c) => c.codePointAt(0)!.toString(16)).join(' ')).toMatchObject({ ok: false, error: 'bad-seed' });
    }
  });

  it('seed, który gra zostawia po normalizacji, serwer zawsze przyjmuje (także gdy gracz wkleił niewidoczne znaki i flagi)', () => {
    const tags = (letters: string): string => Array.from(letters, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    const pasted = [
      'pie\u{00ad}rogi', `Moja \u{1f3f4}${tags('gbeng')}\u{e007f} FLAGA`, `\u{1f3f4}${tags('gbxxx')}\u{e007f}`, `${'a'.repeat(34)}\u{1f3f4}${tags('gbwls')}\u{e007f}`,
      'a\u{200d}b', '\ud83d\u{2062}\ude00', '  pie\trogi\n', 'x'.repeat(200),
    ];
    for (const raw of pasted) {
      const seed = normalizeSeed(raw, () => 'pierogi-731');
      expect(parseSubmission(body({}, { seed })).ok, Array.from(raw).map((c) => c.codePointAt(0)!.toString(16)).join(' ')).toBe(true);
    }
  });

  it('dziennik: minuty i numery całkowite, rosnąco po (minute, seq), przed końcem sezonu; polecenie z krótkim typem', () => {
    const entry = (minute: unknown, seq: unknown, cmd: unknown = { type: 'tapTill' }) => ({ minute, seq, cmd });
    const bad: unknown[][] = [
      [entry(-1, 0)], [entry(1.5, 0)], [entry(SEASON_END_MINUTE, 0)], [entry('360', 0)], [entry(360, -1)], [entry(360, 0.5)],
      [entry(360, 1), entry(360, 1)], [entry(360, 2), entry(360, 1)], [entry(400, 0), entry(399, 5)],
      [entry(360, 0, null)], [entry(360, 0, { type: '' })], [entry(360, 0, { type: 'x'.repeat(33) })], [entry(360, 0, { type: 'tap till' })],
      [entry(360, 0, { palletId: 1 })], [entry(360, 0, { type: 'tapPallet', blob: 'x'.repeat(RUN_MAX_COMMAND_BYTES) })], ['wpis'],
    ];
    for (const log of bad) expect(parseSubmission(body({}, { log })), JSON.stringify(log).slice(0, 80)).toMatchObject({ ok: false, error: 'bad-log' });
    expect(parseSubmission(body({}, { log: 'dziennik' }))).toMatchObject({ ok: false, error: 'bad-request' });
    expect(parseSubmission(body({}, { log: [entry(SEASON_END_MINUTE - 1, 0), entry(SEASON_END_MINUTE - 1, 7)] })).ok).toBe(true);
    expect(parseSubmission(body({}, { log: [entry(0, 5), entry(1, 0)] })).ok).toBe(true);
  });

  it('za długi dziennik: too-large', () => {
    const log = Array.from({ length: RUN_MAX_LOG_ENTRIES + 1 }, (_, i) => ({ minute: 360, seq: i, cmd: { type: 'tapTill' } }));
    expect(parseSubmission(body({}, { log }))).toMatchObject({ ok: false, error: 'too-large' });
    expect(parseSubmission(body({}, { log: log.slice(1) })).ok).toBe(true);
  });
});

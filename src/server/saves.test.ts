import { describe, expect, it } from 'vitest';
import { SAVE_BUNDLE_FORMAT, SAVE_BUNDLE_VERSION, SAVE_MAX_BYTES, SAVE_TTL } from './config';
import { KEYS } from './keys';
import { MemoryRedis } from './memoryRedis';
import { asString, run, type RedisCommand, type RedisExec } from './redis';
import { checkSave, getSave, putSave, savedAtOf } from './saves';
import { testBundle } from './testBundle';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const DAY_MS = 86_400_000;
const bytes = (text: string): number => new TextEncoder().encode(text).length;
/** Paczka z gry z nadpisanymi polami najwyższego poziomu (undefined wypada z tekstu JSON, więc pole znika). */
const bundle = (over: Record<string, unknown>): string => JSON.stringify({ ...(JSON.parse(testBundle()) as object), ...over });

describe('zapis gry w szufladzie Centrali: tylko paczka z gry (jedna kopia na klucz, do 64 KB)', () => {
  it('przechodzi paczka z gry: format, wersja 1, niepusty seed, meta i save jako obiekty', () => {
    expect(SAVE_BUNDLE_FORMAT).toBe('traszka-przeniesienie');
    expect(SAVE_BUNDLE_VERSION).toBe(1);
    expect(checkSave(testBundle())).toEqual({ ok: true, value: testBundle() });
    // pola wewnątrz meta i save to sprawa gry (sprawdza je przy wczytaniu), obce pola na wierzchu serwer zostawia
    expect(checkSave(bundle({ meta: {}, save: {}, dodatek: 1 })).ok).toBe(true);
  });

  it('wszystko inne to bad-save: nie tekst, nie JSON, nie obiekt, stary kształt zapisu, zły format albo wersja, brak seeda, meta albo save nie obiektem', () => {
    const bad: unknown[] = [
      5, null, undefined, true, { format: SAVE_BUNDLE_FORMAT }, ['x'],
      'nie json', '', '[1,2]', '"tekst"', 'null', '5', '{}', '[]', `[${testBundle()}]`,
      JSON.stringify({ schema: 2, seed: 'pierogi-731' }), JSON.stringify({ meta: { player: { nick: 'Ala' } } }),
      bundle({ format: 'inny' }), bundle({ format: undefined }), bundle({ format: 1 }),
      bundle({ version: 2 }), bundle({ version: '1' }), bundle({ version: 0 }), bundle({ version: undefined }), bundle({ version: 1.5 }),
      bundle({ seed: '' }), bundle({ seed: 5 }), bundle({ seed: null }), bundle({ seed: undefined }),
      bundle({ meta: [] }), bundle({ meta: null }), bundle({ meta: 'x' }), bundle({ meta: 5 }), bundle({ meta: undefined }),
      bundle({ save: [] }), bundle({ save: null }), bundle({ save: 'x' }), bundle({ save: 5 }), bundle({ save: undefined }),
    ];
    for (const x of bad) expect(checkSave(x), JSON.stringify(x)?.slice(0, 80)).toEqual({ ok: false, error: 'bad-save' });
  });

  it('64 KB liczone w bajtach UTF-8 (polskie litery to dwa bajty): granica przechodzi, bajt więcej już nie', () => {
    expect(bytes(testBundle({ bytes: SAVE_MAX_BYTES }))).toBe(SAVE_MAX_BYTES);
    expect(checkSave(testBundle({ bytes: SAVE_MAX_BYTES })).ok).toBe(true);
    expect(checkSave(testBundle({ bytes: SAVE_MAX_BYTES + 1 }))).toEqual({ ok: false, error: 'save-too-large' });
    expect(bytes(testBundle({ bytes: SAVE_MAX_BYTES, filler: 'ż' }))).toBe(SAVE_MAX_BYTES);
    expect(checkSave(testBundle({ bytes: SAVE_MAX_BYTES, filler: 'ż' })).ok).toBe(true);
    expect(checkSave(testBundle({ bytes: SAVE_MAX_BYTES + 2, filler: 'ż' }))).toEqual({ ok: false, error: 'save-too-large' });
  });

  it('wysłanie i pobranie: ten sam tekst i chwila wysłania; nowe wysłanie zastępuje stare; inny klucz ma swoją szufladę', async () => {
    const clock = { now: Date.UTC(2026, 9, 28) };
    const redis = new MemoryRedis(() => clock.now);
    const first = testBundle({ seed: 'pierogi-731' });
    const second = testBundle({ seed: 'bigos-111' });
    expect(await getSave(redis, A)).toBeNull();
    expect(await putSave(redis, A, first, clock.now)).toEqual({ bytes: bytes(first), savedAt: clock.now });
    expect(await getSave(redis, A)).toEqual({ save: first, savedAt: clock.now });
    clock.now += 1000;
    await putSave(redis, A, second, clock.now);
    expect(await getSave(redis, A)).toEqual({ save: second, savedAt: clock.now });
    expect(await getSave(redis, B)).toBeNull();
    expect(redis.keys()).toEqual([KEYS.save(A)]);
  });

  it('paczka leży w bazie bajt w bajt, a data wysłania w pierwszej linii: 64 KB zajmuje 64 KB, a nie 128 KB', async () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const redis = new MemoryRedis(() => now);
    // najgorszy przypadek: sam cudzysłów w polu, czyli w tekście JSON paczki same `\"` (kopertowanie w JSON-ie podwajałoby ucieczki)
    const save = testBundle({ bytes: SAVE_MAX_BYTES, filler: '"' });
    expect(save.split('\\"').length).toBeGreaterThan(20_000);
    expect(bytes(JSON.stringify({ savedAt: now, save }))).toBeGreaterThan(SAVE_MAX_BYTES * 1.4);   // tyle zajmowała dawna koperta
    await putSave(redis, A, save, now);
    const stored = asString(await run(redis, ['GET', KEYS.save(A)]))!;
    expect(stored).toBe(`${now}\n${save}`);
    expect(bytes(stored)).toBe(SAVE_MAX_BYTES + String(now).length + 1);
    expect(await getSave(redis, A)).toEqual({ save, savedAt: now });
  });

  it('zapis żyje 30 dni, a każde wysłanie odnawia ten czas', async () => {
    expect(SAVE_TTL).toBe(30 * 86_400);
    const clock = { now: Date.UTC(2026, 9, 28) };
    const redis = new MemoryRedis(() => clock.now);
    const save = testBundle();
    await putSave(redis, A, save, clock.now);
    expect(Number(await run(redis, ['PTTL', KEYS.save(A)]))).toBe(30 * DAY_MS);
    clock.now += 20 * DAY_MS;
    expect(Number(await run(redis, ['PTTL', KEYS.save(A)]))).toBe(10 * DAY_MS);
    await putSave(redis, A, save, clock.now);
    expect(Number(await run(redis, ['PTTL', KEYS.save(A)]))).toBe(30 * DAY_MS);
    clock.now += 29 * DAY_MS;
    expect(await getSave(redis, A)).not.toBeNull();
    clock.now += 2 * DAY_MS;
    expect(await getSave(redis, A)).toBeNull();
    expect(redis.keys()).toEqual([]);
  });

  it('uszkodzony wpis w bazie to brak zapisu (gra nie dostanie śmieci)', async () => {
    const redis = new MemoryRedis();
    const broken = [
      'nie json', '{"savedAt":1}', '{"save":5,"savedAt":1}', JSON.stringify({ savedAt: 1, save: testBundle() }),   // także dawna koperta
      '12\n', '\n{}', 'abc\n{}', '-5\n{}', '1.5\n{}', ` 12\n{}`, `${'9'.repeat(17)}\n{}`, '12{}',
    ];
    for (const raw of broken) {
      await run(redis, ['SET', KEYS.save(A), raw]);
      expect(await getSave(redis, A), JSON.stringify(raw)).toBeNull();
    }
    await run(redis, ['SET', KEYS.save(A), '12\n{}']);
    expect(await getSave(redis, A)).toEqual({ save: '{}', savedAt: 12 });
  });
});

describe('savedAtOf: chwila kopii na serwerze bez czytania całego zapisu', () => {
  it('pusta szuflada to null, po wysłaniu chwila wysłania, po kolejnym wysłaniu nowa chwila; inny klucz ma swoją szufladę', async () => {
    const clock = { now: Date.UTC(2026, 9, 28) };
    const redis = new MemoryRedis(() => clock.now);
    expect(await savedAtOf(redis, A)).toBeNull();
    await putSave(redis, A, testBundle(), clock.now);
    expect(await savedAtOf(redis, A)).toBe(clock.now);
    expect(await savedAtOf(redis, B)).toBeNull();
    const first = clock.now;
    clock.now += 1000;
    await putSave(redis, A, testBundle({ seed: 'bigos-111' }), clock.now);
    expect(await savedAtOf(redis, A)).toBe(first + 1000);
  });

  it('czyta tylko początek wpisu (GETRANGE 0 24), nigdy GET: zapis 64 KB nie jedzie przez sieć, a odpowiedź ma najwyżej 25 bajtów', async () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const redis = new MemoryRedis(() => now);
    const save = testBundle({ bytes: SAVE_MAX_BYTES });
    await putSave(redis, A, save, now);
    const seen: { commands: readonly RedisCommand[]; results: unknown[] }[] = [];
    const spy: RedisExec = {
      async exec(commands) {
        const results = await redis.exec(commands);
        seen.push({ commands, results });
        return results;
      },
    };
    expect(await savedAtOf(spy, A)).toBe(now);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.commands).toEqual([['GETRANGE', KEYS.save(A), 0, 24]]);
    expect(asString(seen[0]!.results[0])).toBe(`${now}\n${save}`.slice(0, 25));   // 25 bajtów: chwila (13 cyfr), nowa linia i początek paczki
  });

  it('zapis, który wygasł, to null (tak jak dla getSave)', async () => {
    const clock = { now: Date.UTC(2026, 9, 28) };
    const redis = new MemoryRedis(() => clock.now);
    await putSave(redis, A, testBundle(), clock.now);
    clock.now += 31 * DAY_MS;
    expect(await savedAtOf(redis, A)).toBeNull();
  });

  it('uszkodzony początek wpisu to null (brak liczby przed pierwszą linią, znak inny niż cyfra, za dużo cyfr), poprawny to liczba', async () => {
    const redis = new MemoryRedis();
    const broken = ['nie json', '{"savedAt":1}', '\n{}', 'abc\n{}', '-5\n{}', '1.5\n{}', ' 12\n{}', `${'9'.repeat(17)}\n{}`, '12{}', '12', ''];
    for (const raw of broken) {
      await run(redis, ['SET', KEYS.save(A), raw]);
      expect(await savedAtOf(redis, A), JSON.stringify(raw)).toBeNull();
    }
    await run(redis, ['SET', KEYS.save(A), '12\n{}']);
    expect(await savedAtOf(redis, A)).toBe(12);
  });
});

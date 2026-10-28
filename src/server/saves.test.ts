import { describe, expect, it } from 'vitest';
import { SAVE_MAX_BYTES, SAVE_TTL } from './config';
import { KEYS } from './keys';
import { MemoryRedis } from './memoryRedis';
import { run } from './redis';
import { checkSave, getSave, putSave } from './saves';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('zapis gry w szufladzie Centrali (jedna kopia na klucz, do 64 KB)', () => {
  it('zapis musi być tekstem JSON z obiektem', () => {
    expect(checkSave('{"schema":2,"seed":"pierogi-731"}')).toEqual({ ok: true, value: '{"schema":2,"seed":"pierogi-731"}' });
    for (const bad of [5, null, { schema: 2 }, 'nie json', '[1,2]', '"tekst"', 'null', '']) {
      expect(checkSave(bad), JSON.stringify(bad)).toMatchObject({ ok: false, error: 'bad-save' });
    }
  });

  it('64 KB liczone w bajtach UTF-8 (polskie litery to dwa bajty): granica przechodzi, bajt więcej już nie', () => {
    const pad = (bytes: number, ch: string, chBytes: number) => `{"x":"${ch.repeat((bytes - 8) / chBytes)}"}`;
    expect(new TextEncoder().encode(pad(SAVE_MAX_BYTES, 'a', 1)).length).toBe(SAVE_MAX_BYTES);
    expect(checkSave(pad(SAVE_MAX_BYTES, 'a', 1)).ok).toBe(true);
    expect(checkSave(pad(SAVE_MAX_BYTES + 2, 'ż', 2))).toMatchObject({ ok: false, error: 'save-too-large' });
    expect(checkSave(pad(SAVE_MAX_BYTES, 'ż', 2)).ok).toBe(true);
  });

  it('wysłanie i pobranie: ten sam tekst i chwila wysłania; nowe wysłanie zastępuje stare; inny klucz ma swoją szufladę', async () => {
    const clock = { now: Date.UTC(2026, 9, 28) };
    const redis = new MemoryRedis(() => clock.now);
    expect(await getSave(redis, A)).toBeNull();
    expect(await putSave(redis, A, '{"v":1}', clock.now)).toEqual({ bytes: 7, savedAt: clock.now });
    clock.now += 1000;
    await putSave(redis, A, '{"v":2}', clock.now);
    expect(await getSave(redis, A)).toEqual({ save: '{"v":2}', savedAt: clock.now });
    expect(await getSave(redis, B)).toBeNull();
    expect(Number(await run(redis, ['PTTL', KEYS.save(A)]))).toBe(SAVE_TTL * 1000);
    expect(redis.keys()).toEqual([KEYS.save(A)]);
  });

  it('uszkodzony wpis w bazie to brak zapisu (gra nie dostanie śmieci)', async () => {
    const redis = new MemoryRedis();
    for (const raw of ['nie json', '{"savedAt":1}', '{"save":5,"savedAt":1}']) {
      await run(redis, ['SET', KEYS.save(A), raw]);
      expect(await getSave(redis, A), raw).toBeNull();
    }
  });
});

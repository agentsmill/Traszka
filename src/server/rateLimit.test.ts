import { describe, expect, it } from 'vitest';
import { RATE_LIMITS } from './config';
import { MemoryRedis } from './memoryRedis';
import { checkRate } from './rateLimit';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ADDRESS = '203.0.113.7';

function setup() {
  const clock = { now: Date.UTC(2026, 9, 28, 12, 0, 0) };
  return { clock, redis: new MemoryRedis(() => clock.now) };
}

describe('limit zgłoszeń na klucz i na adres', () => {
  it('na klucz: po limicie odmowa z czasem do końca okna; nowe okno zaczyna od zera', async () => {
    const { redis, clock } = setup();
    const { perKey, window } = RATE_LIMITS.runs;
    for (let i = 0; i < perKey; i++) expect((await checkRate(redis, 'runs', { owner: OWNER, address: `10.0.0.${i}` }, clock.now)).ok).toBe(true);
    const denied = await checkRate(redis, 'runs', { owner: OWNER, address: '10.0.1.1' }, clock.now);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
    expect(denied.retryAfter).toBeLessThanOrEqual(window);
    expect((await checkRate(redis, 'runs', { owner: OTHER, address: '10.0.1.1' }, clock.now)).ok).toBe(true);
    clock.now += denied.retryAfter * 1000;
    expect((await checkRate(redis, 'runs', { owner: OWNER, address: '10.0.1.1' }, clock.now)).ok).toBe(true);
  });

  it('na adres: wiele kluczy z jednego adresu też trafia na limit; bez klucza liczy się sam adres', async () => {
    const { redis, clock } = setup();
    const { perAddress } = RATE_LIMITS.runs;
    for (let i = 0; i < perAddress; i++) {
      expect((await checkRate(redis, 'runs', { owner: i.toString(16).padStart(8, '0').padEnd(64, 'f'), address: ADDRESS }, clock.now)).ok).toBe(true);
    }
    expect((await checkRate(redis, 'runs', { owner: OTHER, address: ADDRESS }, clock.now)).ok).toBe(false);
    expect((await checkRate(redis, 'runs', { owner: null, address: ADDRESS }, clock.now)).ok).toBe(false);
    expect((await checkRate(redis, 'runs', { owner: null, address: '198.51.100.1' }, clock.now)).ok).toBe(true);
  });

  it('akcje mają osobne liczniki', async () => {
    const { redis, clock } = setup();
    for (let i = 0; i < RATE_LIMITS.runs.perKey; i++) await checkRate(redis, 'runs', { owner: OWNER, address: ADDRESS }, clock.now);
    expect((await checkRate(redis, 'runs', { owner: OWNER, address: ADDRESS }, clock.now)).ok).toBe(false);
    expect((await checkRate(redis, 'saveUp', { owner: OWNER, address: ADDRESS }, clock.now)).ok).toBe(true);
  });

  it('adres nie leży w bazie wprost, a skrót adresu i sól giną razem z końcem okna', async () => {
    const { redis, clock } = setup();
    await checkRate(redis, 'runs', { owner: OWNER, address: ADDRESS }, clock.now);
    const keys = redis.keys();
    expect(keys.join(' ')).not.toContain(ADDRESS);
    expect(keys.some((k) => k.startsWith('tr:salt:'))).toBe(true);
    expect(keys.some((k) => k.includes(':a:'))).toBe(true);
    const windowEnd = (Math.floor(clock.now / (RATE_LIMITS.runs.window * 1000)) + 1) * RATE_LIMITS.runs.window * 1000;
    for (const k of keys) expect(Number((await redis.exec([['PTTL', k]]))[0]), k).toBe(windowEnd - clock.now);
    clock.now = windowEnd;
    expect(redis.keys()).toEqual([]);
  });

  it('sól zmienia się z oknem: ten sam adres w kolejnym oknie ma inny skrót (nie da się połączyć okien)', async () => {
    const { redis, clock } = setup();
    let n = 0;
    const random = (len: number) => Uint8Array.from({ length: len }, () => n++ % 256);
    await checkRate(redis, 'runs', { owner: null, address: ADDRESS }, clock.now, random);
    const first = redis.keys().find((k) => k.includes(':a:'))!.split(':a:')[1];
    clock.now += RATE_LIMITS.runs.window * 1000;
    await checkRate(redis, 'runs', { owner: null, address: ADDRESS }, clock.now, random);
    const second = redis.keys().find((k) => k.includes(':a:'))!.split(':a:')[1];
    expect(second).not.toBe(first);
  });
});

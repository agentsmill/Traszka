import { describe, expect, it } from 'vitest';
import { BUDGET_TTL, RATE_LIMITS } from './config';
import { KEYS } from './keys';
import { MemoryRedis } from './memoryRedis';
import { checkBudget, checkRate, utcDay } from './rateLimit';
import { run } from './redis';

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

describe('doba UTC', () => {
  it('dzień jako RRRR-MM-DD i chwila jego końca (północ UTC), także na granicy dnia i w roku przestępnym', () => {
    expect(utcDay(Date.UTC(2026, 9, 28, 12))).toEqual({ id: '2026-10-28', end: Date.UTC(2026, 9, 29) });
    expect(utcDay(Date.UTC(2026, 9, 28, 23, 59, 59, 999))).toEqual({ id: '2026-10-28', end: Date.UTC(2026, 9, 29) });
    expect(utcDay(Date.UTC(2026, 9, 29))).toEqual({ id: '2026-10-29', end: Date.UTC(2026, 9, 30) });
    expect(utcDay(Date.UTC(2026, 11, 31, 23))).toEqual({ id: '2026-12-31', end: Date.UTC(2027, 0, 1) });
    expect(utcDay(Date.UTC(2028, 1, 29, 5))).toEqual({ id: '2028-02-29', end: Date.UTC(2028, 2, 1) });
  });
});

describe('globalny budżet dzienny (jeden licznik na dobę UTC, niezależny od klucza i adresu)', () => {
  const NOON = Date.UTC(2026, 9, 28, 12);

  it('do limitu włącznie przechodzi, ponad limit odmowa z czasem do północy UTC; licznik tylko rośnie', async () => {
    const redis = new MemoryRedis(() => NOON);
    for (let i = 0; i < 3; i++) expect(await checkBudget(redis, 'save', 3, NOON), `wysłanie ${i + 1}`).toEqual({ ok: true, retryAfter: 0 });
    expect(await checkBudget(redis, 'save', 3, NOON)).toEqual({ ok: false, retryAfter: 12 * 3600 });
    expect(await checkBudget(redis, 'save', 3, NOON + 3_600_000)).toMatchObject({ ok: false, retryAfter: 11 * 3600 });
    expect(await run(redis, ['GET', KEYS.budget('save', '2026-10-28')])).toBe('5');
  });

  it('czas do północy zaokrąglony w górę i nigdy mniejszy niż sekunda', async () => {
    const redis = new MemoryRedis(() => NOON);
    await run(redis, ['SET', KEYS.budget('save', '2026-10-28'), '10']);
    expect((await checkBudget(redis, 'save', 10, Date.UTC(2026, 9, 28, 23, 59, 58, 500))).retryAfter).toBe(2);
    expect((await checkBudget(redis, 'save', 10, Date.UTC(2026, 9, 28, 23, 59, 59, 999))).retryAfter).toBe(1);
  });

  it('licznik nazywa się tr:budget:{nazwa}:{dzień}, żyje dobę, a o północy UTC zaczyna się nowy od zera', async () => {
    const clock = { now: NOON };
    const redis = new MemoryRedis(() => clock.now);
    await checkBudget(redis, 'save', 1, clock.now);
    expect(redis.keys()).toEqual(['tr:budget:save:2026-10-28']);
    expect(BUDGET_TTL).toBe(86_400);
    expect(Number(await run(redis, ['PTTL', 'tr:budget:save:2026-10-28']))).toBe(BUDGET_TTL * 1000);
    expect((await checkBudget(redis, 'save', 1, clock.now)).ok).toBe(false);
    clock.now = Date.UTC(2026, 9, 29, 0, 0, 1);
    expect((await checkBudget(redis, 'save', 1, clock.now)).ok).toBe(true);
    expect(redis.keys()).toEqual(['tr:budget:save:2026-10-28', 'tr:budget:save:2026-10-29']);
    clock.now = Date.UTC(2026, 9, 29, 12);   // doba po założeniu starego licznika
    expect(redis.keys()).toEqual(['tr:budget:save:2026-10-29']);
  });

  it('osobne nazwy mają osobne liczniki, a jedno sprawdzenie to jedno zapytanie do bazy', async () => {
    const redis = new MemoryRedis(() => NOON);
    await checkBudget(redis, 'save', 1, NOON);
    expect((await checkBudget(redis, 'save', 1, NOON)).ok).toBe(false);
    expect((await checkBudget(redis, 'inne', 1, NOON)).ok).toBe(true);
    const before = redis.calls;
    await checkBudget(redis, 'save', 1, NOON);
    expect(redis.calls - before).toBe(1);
  });

  it('odpowiedź bazy bez liczby to odmowa, a nie przepuszczenie', async () => {
    const broken = { exec: async () => [null, null] };
    expect(await checkBudget(broken, 'save', 100, NOON)).toMatchObject({ ok: false });
  });
});

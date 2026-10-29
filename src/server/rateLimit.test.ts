import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUDGET_TTL, RATE_GATE_MAX_ENTRIES, RATE_LIMITS, RATE_SECRET_MIN_CHARS, type RateAction } from './config';
import { KEYS } from './keys';
import { MemoryRedis } from './memoryRedis';
import { addressBucket, checkBudget, checkRate, createRateGate, utcDay, type RateCheck } from './rateLimit';
import { RedisError, run, type RedisExec } from './redis';

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
    await checkRate(redis, 'runs', { owner: null, address: ADDRESS }, clock.now, { random });
    const first = redis.keys().find((k) => k.includes(':a:'))!.split(':a:')[1];
    clock.now += RATE_LIMITS.runs.window * 1000;
    await checkRate(redis, 'runs', { owner: null, address: ADDRESS }, clock.now, { random });
    const second = redis.keys().find((k) => k.includes(':a:'))!.split(':a:')[1];
    expect(second).not.toBe(first);
  });
});

/**
 * Czas życia kluczy limitu jest względny (`PX`, `PEXPIRE`: tyle ms, ile zostało do końca okna według zegara funkcji), a nie
 * bezwzględny (`PXAT`). Zegar bazy może wyprzedzać zegar funkcji (albo się spóźniać): klucz z bezwzględnym końcem okna powstałby
 * wtedy przeterminowany (`INCR` zakłada go po cichu bez czasu życia) albo żyłby za długo, i licznik przestawał liczyć w oknie.
 */
describe('czas życia kluczy limitu jest względny, więc nie zależy od zegara bazy', () => {
  const NOON = Date.UTC(2026, 9, 28, 12, 0, 0);
  const { window } = RATE_LIMITS.runs;
  const windowEnd = (Math.floor(NOON / (window * 1000)) + 1) * window * 1000;
  const who = { owner: OWNER, address: ADDRESS };

  async function ttls(redis: MemoryRedis): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const k of redis.keys()) out[k] = Number((await redis.exec([['PTTL', k]]))[0]);
    return out;
  }

  for (const [name, skew] of [['zegar bazy zgodny', 0], ['baza wyprzedza o godzinę', 3_600_000], ['baza wyprzedza o dobę', 86_400_000], ['baza spóźnia się o godzinę', -3_600_000]] as const) {
    it(`${name}: sól i oba liczniki żyją dokładnie do końca okna według zegara funkcji`, async () => {
      const redis = new MemoryRedis(() => NOON + skew);
      expect((await checkRate(redis, 'runs', who, NOON)).ok).toBe(true);
      const found = await ttls(redis);
      expect(Object.keys(found)).toHaveLength(3);   // sól, licznik adresu, licznik klucza
      for (const [k, ttl] of Object.entries(found)) expect(ttl, k).toBe(windowEnd - NOON);
    });

    it(`${name}: licznik naprawdę liczy w oknie (limit działa), a z końcem okna znika i okno zaczyna od zera`, async () => {
      const t = { fn: NOON };
      const redis = new MemoryRedis(() => t.fn + skew);
      for (let i = 0; i < RATE_LIMITS.runs.perKey; i++) expect((await checkRate(redis, 'runs', { owner: OWNER, address: `10.0.0.${i}` }, t.fn)).ok).toBe(true);
      expect((await checkRate(redis, 'runs', { owner: OWNER, address: '10.0.1.1' }, t.fn)).ok).toBe(false);
      t.fn = windowEnd - 1;
      expect(redis.keys().length).toBeGreaterThan(0);
      t.fn = windowEnd;
      expect(redis.keys()).toEqual([]);
      expect((await checkRate(redis, 'runs', { owner: OWNER, address: '10.0.1.1' }, t.fn)).ok).toBe(true);
    });
  }

  it('licznik bez czasu życia (np. po dawnym błędzie albo po wygaśnięciu klucza między poleceniami) dostaje go przy kolejnym żądaniu', async () => {
    const redis = new MemoryRedis(() => NOON);
    await checkRate(redis, 'runs', who, NOON);
    const counters = redis.keys().filter((k) => k.startsWith('tr:rl:'));
    expect(counters).toHaveLength(2);
    for (const k of counters) await run(redis, ['SET', k, '3']);   // SET bez opcji zrywa czas życia: licznik na zawsze
    expect(Object.values(await ttls(redis)).filter((t) => t === -1)).toHaveLength(2);
    await checkRate(redis, 'runs', who, NOON);
    for (const k of counters) {
      expect(await run(redis, ['GET', k]), k).toBe('4');
      expect(Number(await run(redis, ['PTTL', k])), k).toBe(windowEnd - NOON);
    }
  });

  it('żadne polecenie nie podaje bezwzględnego końca okna (PXAT, EXAT, PEXPIREAT)', async () => {
    const seen: string[] = [];
    const redis = new MemoryRedis(() => NOON);
    const spy: RedisExec = { exec: (commands) => { for (const c of commands) seen.push(c.map(String).join(' ')); return redis.exec(commands); } };
    await checkRate(spy, 'runs', who, NOON);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((c) => /\b(PXAT|EXAT|PEXPIREAT)\b/i.test(c))).toEqual([]);
  });

  it('ostatnia milisekunda okna: czas życia nie spada poniżej 1 ms (zero albo minus usunęłoby klucz od razu)', async () => {
    const redis = new MemoryRedis(() => NOON);
    await checkRate(redis, 'runs', who, windowEnd - 1);
    for (const [k, ttl] of Object.entries(await ttls(redis))) expect(ttl, k).toBe(1);
    expect(redis.keys()).toHaveLength(3);
  });
});

describe('sól okna w bazie jest wymagana', () => {
  const who = { owner: OWNER, address: ADDRESS };
  const NOON = Date.UTC(2026, 9, 28, 12, 0, 0);

  it('baza, która nie oddaje soli (GET daje null), to błąd, a nie skrót z pustą solą; liczniki nie powstają', async () => {
    const seen: string[] = [];
    const lost: RedisExec = { exec: async (commands) => { for (const c of commands) seen.push(String(c[0])); return commands.map(() => null); } };
    await expect(checkRate(lost, 'runs', who, NOON)).rejects.toBeInstanceOf(RedisError);
    expect(seen).toEqual(['SET', 'GET']);   // do liczników nie doszło
  });

  it('pusta sól to też błąd (skrót z pustą solą byłby tym samym skrótem u wszystkich)', async () => {
    const empty: RedisExec = { exec: async (commands) => commands.map((c) => (c[0] === 'GET' ? '' : 'OK')) };
    await expect(checkRate(empty, 'runs', who, NOON)).rejects.toBeInstanceOf(RedisError);
  });

  it('komunikat błędu nie zawiera adresu klienta', async () => {
    const lost: RedisExec = { exec: async (commands) => commands.map(() => null) };
    const err = await checkRate(lost, 'runs', who, NOON).catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain(ADDRESS);
  });
});

/**
 * Bramka w pamięci instancji. Zasada, którą pilnują poniższe testy: licznik w bramce to odczyt prawdziwego licznika z odpowiedzi
 * bazy (`INCR`), więc nigdy go nie przekracza (liczniki w oknie tylko rosną), a odmowa z pamięci (licznik już na limicie) nie
 * odrzuca niczego, czego baza by nie odrzuciła. Zapamiętana odmowa kosztuje 0 zapytań i 0 poleceń aż do końca okna.
 */
describe('bramka limitu w pamięci instancji (createRateGate)', () => {
  const NOON = Date.UTC(2026, 9, 28, 12, 0, 0);
  const owner = (i: number): string => i.toString(16).padStart(8, '0').padEnd(64, 'f');
  const windowEnd = (action: RateAction, now: number): number => (Math.floor(now / (RATE_LIMITS[action].window * 1000)) + 1) * RATE_LIMITS[action].window * 1000;
  const denial = (action: RateAction, now: number): RateCheck => ({ ok: false, retryAfter: Math.ceil((windowEnd(action, now) - now) / 1000) });
  const cost = async (redis: MemoryRedis, fn: () => Promise<unknown>): Promise<{ calls: number; commands: number }> => {
    const [calls, commands] = [redis.calls, redis.commands];
    await fn();
    return { calls: redis.calls - calls, commands: redis.commands - commands };
  };

  it('świeża bramka niczego nie odrzuca; licznik poniżej limitu też nie', async () => {
    const gate = createRateGate();
    const who = { owner: owner(1), address: ADDRESS };
    expect(await gate.peek('runs', who, NOON)).toBeNull();
    await gate.record('runs', who, NOON, { address: RATE_LIMITS.runs.perAddress - 1, key: RATE_LIMITS.runs.perKey - 1 });
    expect(await gate.peek('runs', who, NOON)).toBeNull();
  });

  it('licznik adresu na limicie: odmowa dla każdego klucza z tego adresu (też kubełek IPv6 /64), nie dla innego adresu', async () => {
    const gate = createRateGate();
    const { perAddress } = RATE_LIMITS.runs;
    await gate.record('runs', { owner: owner(1), address: '2001:db8:aaaa:bbbb::1' }, NOON, { address: perAddress, key: 1 });
    expect(await gate.peek('runs', { owner: owner(2), address: '2001:db8:aaaa:bbbb:ffff::9' }, NOON)).toEqual(denial('runs', NOON));
    expect(await gate.peek('runs', { owner: null, address: '2001:db8:aaaa:bbbb::7' }, NOON)).toEqual(denial('runs', NOON));
    expect(await gate.peek('runs', { owner: owner(1), address: '2001:db8:aaaa:bbbc::1' }, NOON)).toBeNull();   // inny prefiks
    expect(await gate.peek('runs', { owner: owner(1), address: '203.0.113.7' }, NOON)).toBeNull();
  });

  it('licznik klucza na limicie: odmowa dla tego klucza z dowolnego adresu, nie dla innego klucza', async () => {
    const gate = createRateGate();
    const { perKey } = RATE_LIMITS.runs;
    await gate.record('runs', { owner: owner(1), address: '10.0.0.1' }, NOON, { address: 1, key: perKey });
    expect(await gate.peek('runs', { owner: owner(1), address: '10.9.9.9' }, NOON)).toEqual(denial('runs', NOON));
    expect(await gate.peek('runs', { owner: owner(2), address: '10.0.0.1' }, NOON)).toBeNull();
    expect(await gate.peek('runs', { owner: null, address: '10.0.0.1' }, NOON)).toBeNull();   // sam adres (wczesna kontrola) klucza nie zna
  });

  it('limit jest dokładnie na progu: licznik równy limitowi odmawia (następny INCR dałby limit + 1), poniżej przepuszcza', async () => {
    const gate = createRateGate();
    const { perAddress } = RATE_LIMITS.player;
    await gate.record('player', { owner: null, address: '10.0.0.1' }, NOON, { address: perAddress - 1, key: null });
    expect(await gate.peek('player', { owner: null, address: '10.0.0.1' }, NOON)).toBeNull();
    await gate.record('player', { owner: null, address: '10.0.0.1' }, NOON, { address: perAddress, key: null });
    expect(await gate.peek('player', { owner: null, address: '10.0.0.1' }, NOON)).toMatchObject({ ok: false });
  });

  it('odczyt z odpowiedzi nie cofa zapamiętanej odmowy (odpowiedzi mogą wracać w odwrotnej kolejności)', async () => {
    const gate = createRateGate();
    const who = { owner: owner(1), address: ADDRESS };
    await gate.record('runs', who, NOON, { address: RATE_LIMITS.runs.perAddress + 5, key: 1 });
    await gate.record('runs', who, NOON, { address: 3, key: 1 });
    expect(await gate.peek('runs', who, NOON)).toMatchObject({ ok: false });
  });

  it('odmowa jest osobna dla każdej akcji', async () => {
    const gate = createRateGate();
    const who = { owner: owner(1), address: ADDRESS };
    await gate.record('runs', who, NOON, { address: RATE_LIMITS.runs.perAddress, key: 1 });
    expect(await gate.peek('runs', who, NOON)).toMatchObject({ ok: false });
    expect(await gate.peek('saveUp', who, NOON)).toBeNull();
    expect(await gate.peek('player', who, NOON)).toBeNull();
  });

  it('Retry-After to czas do końca okna, malejący z upływem okna, i zawsze co najmniej sekunda; w następnym oknie odmowy już nie ma', async () => {
    const gate = createRateGate();
    const who = { owner: owner(1), address: ADDRESS };
    await gate.record('runs', who, NOON, { address: RATE_LIMITS.runs.perAddress, key: 1 });
    const end = windowEnd('runs', NOON);
    expect(await gate.peek('runs', who, NOON)).toEqual({ ok: false, retryAfter: (end - NOON) / 1000 });
    expect(await gate.peek('runs', who, end - 1_500)).toEqual({ ok: false, retryAfter: 2 });
    expect(await gate.peek('runs', who, end - 1)).toEqual({ ok: false, retryAfter: 1 });
    expect(await gate.peek('runs', who, end)).toBeNull();
    expect(await gate.peek('runs', who, end + 3_600_000)).toBeNull();
  });

  it('w pamięci nie leży surowy adres ani prefiks IPv6, a skrót zależy od soli instancji (dwie bramki nazywają ten sam adres inaczej)', async () => {
    const [a, b] = [createRateGate(), createRateGate()];
    for (const address of [ADDRESS, '2001:db8:aaaa:bbbb::1', 'nieznany']) {
      await a.record('runs', { owner: null, address }, NOON, { address: 1, key: null });
      await b.record('runs', { owner: null, address }, NOON, { address: 1, key: null });
    }
    const names = a.keys().join(' ');
    for (const leak of [ADDRESS, '2001:db8', 'db8:aaaa', 'aaaa:bbbb', '/64', 'nieznany']) expect(names).not.toContain(leak);   // skrót jest szesnastkowy, więc bez dwukropków i liter spoza a-f
    expect(a.keys()).toHaveLength(3);
    expect(a.keys().some((k) => b.keys().includes(k))).toBe(false);
  });

  it('wpisy z minionych okien wypadają, gdy bramka zapisuje coś w następnym oknie', async () => {
    const gate = createRateGate();
    for (let i = 0; i < 20; i++) await gate.record('runs', { owner: owner(i), address: `10.0.0.${i}` }, NOON, { address: 1, key: 1 });
    for (let i = 0; i < 5; i++) await gate.record('player', { owner: null, address: `10.1.0.${i}` }, NOON, { address: 1, key: null });
    expect(gate.size).toBe(20 * 2 + 5);
    const end = windowEnd('player', NOON);   // krótsze okno (10 min) kończy się pierwsze
    await gate.record('runs', { owner: owner(99), address: '10.9.9.9' }, end, { address: 1, key: 1 });
    expect(gate.size).toBe(20 * 2 + 2);   // pięć wpisów okna „player” wypadło, bieżące zapisy dopisane
    const later = windowEnd('runs', NOON);
    await gate.record('runs', { owner: owner(100), address: '10.9.9.10' }, later, { address: 1, key: 1 });
    expect(gate.size).toBe(2);   // wszystko ze starych okien wypadło, zostały dwa wpisy nowego okna
  });

  it('pamięć jest ograniczona: po przepełnieniu najstarsze wpisy wypadają, najnowsze zostają', async () => {
    const gate = createRateGate({ maxEntries: 50 });
    const full = RATE_LIMITS.runs.perAddress;
    for (let i = 0; i < 500; i++) await gate.record('runs', { owner: null, address: `10.${i >> 8}.${i & 255}.1` }, NOON, { address: full, key: null });
    expect(gate.size).toBe(50);
    expect(await gate.peek('runs', { owner: null, address: '10.0.0.1' }, NOON)).toBeNull();   // dawna odmowa wypadła z pamięci
    expect(await gate.peek('runs', { owner: null, address: `10.${499 >> 8}.${499 & 255}.1` }, NOON)).toMatchObject({ ok: false });
  });

  it('wpis odświeżany częściej wypada później (aktywny adres nie ginie przed nieaktywnymi)', async () => {
    const gate = createRateGate({ maxEntries: 3 });
    const at = (n: number) => ({ owner: null, address: `10.0.0.${n}` });
    const seen = (address: number) => ({ address, key: null });
    await gate.record('runs', at(1), NOON, seen(1));
    await gate.record('runs', at(2), NOON, seen(1));
    await gate.record('runs', at(3), NOON, seen(1));
    await gate.record('runs', at(1), NOON, seen(RATE_LIMITS.runs.perAddress));   // odświeżony: najmłodszy
    await gate.record('runs', at(4), NOON, seen(1));   // przepełnienie: wypada najstarszy, czyli adres 2
    expect(gate.size).toBe(3);
    expect(await gate.peek('runs', at(1), NOON)).toMatchObject({ ok: false });
    await gate.record('runs', at(2), NOON, seen(RATE_LIMITS.runs.perAddress));   // adres 2 wraca jako nowy wpis, wypada 3
    expect(await gate.peek('runs', at(2), NOON)).toMatchObject({ ok: false });
  });

  it('domyślny limit pamięci to 10 000 wpisów', () => {
    expect(RATE_GATE_MAX_ENTRIES).toBe(10_000);
  });

  describe('razem z checkRate', () => {
    const who = (i: number, address = ADDRESS) => ({ owner: owner(i), address });

    it('żądanie odrzucone przez bazę zostaje zapamiętane: następne 100 z tego adresu kosztuje 0 zapytań i 0 poleceń, z tym samym wynikiem', async () => {
      const redis = new MemoryRedis(() => NOON);
      const gate = createRateGate();
      const { perAddress } = RATE_LIMITS.runs;
      for (let i = 0; i < perAddress; i++) expect((await checkRate(redis, 'runs', who(i), NOON, { gate })).ok).toBe(true);
      const first = await checkRate(redis, 'runs', who(1000), NOON, { gate });
      expect(first).toEqual(denial('runs', NOON));
      const spent = await cost(redis, async () => {
        for (let i = 0; i < 100; i++) expect(await checkRate(redis, 'runs', who(2000 + i), NOON, { gate })).toEqual(denial('runs', NOON));
      });
      expect(spent).toEqual({ calls: 0, commands: 0 });
    });

    it('to samo dla klucza: po odmowie na kluczu 100 następnych z różnych adresów kosztuje 0, a inny klucz przechodzi', async () => {
      const redis = new MemoryRedis(() => NOON);
      const gate = createRateGate();
      for (let i = 0; i < RATE_LIMITS.runs.perKey; i++) await checkRate(redis, 'runs', who(7, `10.0.0.${i}`), NOON, { gate });
      expect(await checkRate(redis, 'runs', who(7, '10.0.1.1'), NOON, { gate })).toEqual(denial('runs', NOON));
      const spent = await cost(redis, async () => {
        for (let i = 0; i < 100; i++) expect((await checkRate(redis, 'runs', who(7, `10.1.0.${i}`), NOON, { gate })).ok).toBe(false);
      });
      expect(spent).toEqual({ calls: 0, commands: 0 });
      expect((await checkRate(redis, 'runs', who(8, '10.1.1.1'), NOON, { gate })).ok).toBe(true);
    });

    it('odmowa na kluczu nie zużywa limitu adresu (odrzucone z pamięci nie dochodzi do bazy, więc nie liczy się nigdzie)', async () => {
      const redis = new MemoryRedis(() => NOON);
      const gate = createRateGate();
      for (let i = 0; i < RATE_LIMITS.runs.perKey; i++) await checkRate(redis, 'runs', who(7, `10.0.0.${i}`), NOON, { gate });
      for (let i = 0; i < 100; i++) await checkRate(redis, 'runs', who(7, '10.7.7.7'), NOON, { gate });   // odmowy z pamięci
      for (let i = 0; i < RATE_LIMITS.runs.perAddress; i++) expect((await checkRate(redis, 'runs', who(100 + i, '10.7.7.7'), NOON, { gate })).ok, `żądanie ${i + 1}`).toBe(true);
      expect((await checkRate(redis, 'runs', who(999, '10.7.7.7'), NOON, { gate })).ok).toBe(false);
    });

    it('odmowa zapamiętana z odpowiedzi bazy, której instancja sama nie spowodowała (liczniki innych instancji): pierwsze żądanie idzie do bazy, następne już nie', async () => {
      const redis = new MemoryRedis(() => NOON);
      const other = createRateGate();
      for (let i = 0; i < RATE_LIMITS.runs.perAddress; i++) await checkRate(redis, 'runs', who(i), NOON, { gate: other });
      const mine = createRateGate();   // druga instancja, ta sama baza, pusta pamięć
      expect(await cost(redis, () => checkRate(redis, 'runs', who(1000), NOON, { gate: mine }))).toEqual({ calls: 2, commands: 6 });
      expect(await cost(redis, async () => {
        for (let i = 0; i < 100; i++) await checkRate(redis, 'runs', who(2000 + i), NOON, { gate: mine });
      })).toEqual({ calls: 0, commands: 0 });
    });

    it('odmowa trwa do końca okna, a w następnym oknie żądanie znów dochodzi do bazy i przechodzi', async () => {
      const clock = { now: NOON };
      const redis = new MemoryRedis(() => clock.now);
      const gate = createRateGate();
      for (let i = 0; i <= RATE_LIMITS.runs.perAddress; i++) await checkRate(redis, 'runs', who(i), clock.now, { gate });
      const end = windowEnd('runs', NOON);
      for (const t of [NOON + 1, end - 1_000, end - 1]) {
        clock.now = t;
        expect(await cost(redis, () => checkRate(redis, 'runs', who(5000), clock.now, { gate })), `t=${t}`).toEqual({ calls: 0, commands: 0 });
      }
      clock.now = end;
      const next = await cost(redis, async () => expect((await checkRate(redis, 'runs', who(5000), clock.now, { gate })).ok).toBe(true));
      expect(next.calls).toBeGreaterThan(0);
    });

    it('błąd bazy nie zapisuje niczego w bramce (licznik w bramce nigdy nie przekracza prawdziwego)', async () => {
      const gate = createRateGate();
      const broken: RedisExec = { exec: async () => { throw new RedisError('Upstash: brak połączenia'); } };
      for (let i = 0; i < 3 * RATE_LIMITS.runs.perAddress; i++) await expect(checkRate(broken, 'runs', who(i), NOON, { gate })).rejects.toBeInstanceOf(RedisError);
      expect(gate.size).toBe(0);
      expect(await gate.peek('runs', who(1), NOON)).toBeNull();
    });

    it('równoległe żądania nie dostają odmowy na zapas: o przepuszczeniu decyduje baza, a potem bramka pamięta odmowę', async () => {
      const redis = new MemoryRedis(() => NOON);
      const gate = createRateGate();
      const { perAddress } = RATE_LIMITS.runs;
      const results = await Promise.all(Array.from({ length: perAddress + 20 }, (_, i) => checkRate(redis, 'runs', who(i), NOON, { gate })));
      expect(results.filter((r) => r.ok)).toHaveLength(perAddress);
      expect(await cost(redis, () => checkRate(redis, 'runs', who(9999), NOON, { gate }))).toEqual({ calls: 0, commands: 0 });
    });

    it('bez bramki każde żądanie idzie do bazy (zachowanie jak dotąd): 100 odmów kosztuje 200 zapytań i 600 poleceń', async () => {
      const redis = new MemoryRedis(() => NOON);
      for (let i = 0; i <= RATE_LIMITS.runs.perAddress; i++) await checkRate(redis, 'runs', who(i), NOON);
      expect(await cost(redis, async () => {
        for (let i = 0; i < 100; i++) await checkRate(redis, 'runs', who(2000 + i), NOON);
      })).toEqual({ calls: 200, commands: 600 });
    });
  });
});

/** Ziarnisty generator (mulberry32): testy losowe mają się powtarzać. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('własność: bramka nigdy nie odrzuca tego, czego sama baza nie odrzuciłaby', () => {
  const ACTIONS: RateAction[] = ['runs', 'player', 'saveUp', 'saveDown'];
  // Mało adresów i kluczy, żeby limity (12 do 120 na okno) naprawdę się przekraczały; dwa adresy IPv6 to jeden kubełek /64.
  const ADDRESSES = ['203.0.113.7', '198.51.100.1', '2001:db8:aaaa:bbbb::1', '2001:db8:aaaa:bbbb:ffff::2', 'nieznany'];
  const OWNERS = Array.from({ length: 3 }, (_, i) => i.toString(16).padStart(8, '0').padEnd(64, 'e'));

  for (const [name, secret] of [['sól okna w bazie', undefined], ['HMAC z RANKING_SALT', 'testowy-sekret-limitu-0123456789']] as const) {
    for (const seed of [1, 2, 3]) {
      it(`${name}, ziarno ${seed}: 4000 żądań z 3 instancji na wspólnej bazie; odmowa z pamięci ⇒ baza bez bramki też odmawia, z tym samym Retry-After`, async () => {
        const rand = seeded(seed);
        const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
        const clock = { now: Date.UTC(2026, 9, 28, 12) };
        const shared = new MemoryRedis(() => clock.now);       // baza z bramkami (3 instancje)
        const reference = new MemoryRedis(() => clock.now);    // ta sama historia żądań, bez bramek
        const gates = [createRateGate(), createRateGate(), createRateGate()];
        let local = 0;
        let windows = 0;
        let lastIndex = Math.floor(clock.now / 3_600_000);
        for (let step = 0; step < 4000; step++) {
          if (rand() < 0.01) clock.now += Math.floor(rand() * 2_400_000);   // rzadkie skoki: okna się zmieniają, ale limity są osiągane
          const index = Math.floor(clock.now / 3_600_000);
          if (index !== lastIndex) { windows++; lastIndex = index; }
          const action = pick(ACTIONS);
          const requester = { owner: rand() < 0.15 ? null : pick(OWNERS), address: pick(ADDRESSES) };
          const calls = shared.calls;
          const withGate = await checkRate(shared, action, requester, clock.now, { gate: pick(gates), secret });
          const denied = shared.calls === calls;
          const plain = await checkRate(reference, action, requester, clock.now, { secret });
          if (denied) {
            local++;
            expect(withGate, `krok ${step}`).toEqual({ ok: false, retryAfter: plain.retryAfter });
            expect(plain.ok, `krok ${step}: baza bez bramki przepuściłaby to, co bramka odrzuciła`).toBe(false);
          }
          if (plain.ok) expect(withGate.ok, `krok ${step}: bramka odrzuciła przepuszczone przez bazę`).toBe(true);
        }
        expect(local).toBeGreaterThan(300);   // test nie jest pusty: bramka naprawdę odrzucała
        expect(windows).toBeGreaterThan(2);   // i przeżyła zmiany okien
        expect(shared.calls).toBeLessThan(reference.calls);
        expect(shared.commands).toBeLessThan(reference.commands);
      });
    }
  }
});

/**
 * `RANKING_SALT`: skrót adresu to HMAC-SHA256 sekretu z oknem i akcją, więc nie trzeba czytać soli okna z bazy. Liczniki idą
 * w jednym zapytaniu zamiast dwóch, a w bazie nie ma ani adresu, ani sekretu, ani soli.
 */
describe('skrót adresu z sekretu RANKING_SALT (HMAC-SHA256, bez soli w bazie)', () => {
  const SECRET = 'sekret-limitu-0123456789abcdef';
  const NOON = Date.UTC(2026, 9, 28, 12, 0, 0);
  const who = { owner: OWNER, address: ADDRESS };
  const addressKeys = (redis: MemoryRedis): string[] => redis.keys().filter((k) => k.includes(':a:'));
  const hashOf = (redis: MemoryRedis): string => addressKeys(redis)[0]!.split(':a:')[1]!;
  const indexOf = (action: RateAction, now: number): number => Math.floor(now / (RATE_LIMITS[action].window * 1000));

  it('jedno zapytanie do bazy i cztery polecenia (bez klucza: dwa), bez klucza soli w bazie', async () => {
    const redis = new MemoryRedis(() => NOON);
    await checkRate(redis, 'runs', who, NOON, { secret: SECRET });
    expect([redis.calls, redis.commands]).toEqual([1, 4]);
    expect(redis.keys().some((k) => k.startsWith('tr:salt:'))).toBe(false);
    const alone = new MemoryRedis(() => NOON);
    await checkRate(alone, 'runs', { owner: null, address: ADDRESS }, NOON, { secret: SECRET });
    expect([alone.calls, alone.commands]).toEqual([1, 2]);
  });

  it('skrót to HMAC-SHA256(sekret, „traszka:limit:{akcja}:{okno}:{nr okna}:{kubełek adresu}”) skrócony do 32 znaków', async () => {
    const redis = new MemoryRedis(() => NOON);
    await checkRate(redis, 'runs', who, NOON, { secret: SECRET });
    const want = createHmac('sha256', SECRET).update(`traszka:limit:runs:3600:${indexOf('runs', NOON)}:${ADDRESS}`).digest('hex').slice(0, 32);
    expect(addressKeys(redis)).toEqual([`tr:rl:runs:${indexOf('runs', NOON)}:a:${want}`]);
    const v6 = new MemoryRedis(() => NOON);
    await checkRate(v6, 'player', { owner: null, address: '2001:db8:aaaa:bbbb::7' }, NOON, { secret: SECRET });
    const want6 = createHmac('sha256', SECRET).update(`traszka:limit:player:600:${indexOf('player', NOON)}:2001:db8:aaaa:bbbb/64`).digest('hex').slice(0, 32);
    expect(hashOf(v6)).toBe(want6);   // liczy się kubełek (prefiks /64), a nie pełny adres
  });

  it('ten sam adres, okno, akcja i sekret dają ten sam skrót (u każdej instancji i po restarcie), a kubełek IPv6 /64 jeden', async () => {
    const [a, b, c] = [new MemoryRedis(() => NOON), new MemoryRedis(() => NOON + 1_000), new MemoryRedis(() => NOON)];
    await checkRate(a, 'runs', who, NOON, { secret: SECRET });
    await checkRate(b, 'runs', { owner: null, address: ADDRESS }, NOON + 1_000, { secret: SECRET });
    expect(hashOf(a)).toBe(hashOf(b));
    await checkRate(c, 'runs', { owner: null, address: '2001:db8:aaaa:bbbb::1' }, NOON, { secret: SECRET });
    const d = new MemoryRedis(() => NOON);
    await checkRate(d, 'runs', { owner: null, address: '2001:db8:aaaa:bbbb:ffff::9' }, NOON, { secret: SECRET });
    expect(hashOf(c)).toBe(hashOf(d));
    expect(hashOf(c)).not.toBe(hashOf(a));
  });

  it('inne okno, inna akcja, inny sekret albo inny adres dają inny skrót (okien, akcji ani instalacji nie da się połączyć)', async () => {
    const hashes = new Map<string, string>();
    const hash = async (name: string, action: RateAction, now: number, address: string, secret: string): Promise<void> => {
      const redis = new MemoryRedis(() => now);
      await checkRate(redis, action, { owner: null, address }, now, { secret });
      hashes.set(name, hashOf(redis));
    };
    await hash('bazowy', 'runs', NOON, ADDRESS, SECRET);
    await hash('następne okno', 'runs', NOON + RATE_LIMITS.runs.window * 1000, ADDRESS, SECRET);
    await hash('inna akcja o tym samym oknie', 'saveUp', NOON, ADDRESS, SECRET);
    await hash('inny sekret', 'runs', NOON, ADDRESS, `${SECRET}!`);
    await hash('inny adres', 'runs', NOON, '203.0.113.8', SECRET);
    expect(RATE_LIMITS.saveUp.window).toBe(RATE_LIMITS.runs.window);   // to samo okno, a skrót i tak inny
    expect(hashes.size).toBe(5);
    expect(new Set(hashes.values()).size).toBe(5);
  });

  it('w bazie nie ma adresu, kubełka IPv6, sekretu ani jego fragmentu (ani w kluczach, ani w wartościach)', async () => {
    const redis = new MemoryRedis(() => NOON);
    for (const address of [ADDRESS, '2001:db8:aaaa:bbbb::1', 'nieznany']) await checkRate(redis, 'runs', { owner: OWNER, address }, NOON, { secret: SECRET });
    const values = await Promise.all(redis.keys().map(async (k) => String((await redis.exec([['GET', k]]))[0])));
    const everything = [...redis.keys(), ...values].join(' ');
    for (const leak of [ADDRESS, '2001:db8', 'db8:aaaa', 'aaaa:bbbb', '/64', 'nieznany', SECRET, 'sekret', 'limitu']) expect(everything, leak).not.toContain(leak);   // skrót jest szesnastkowy: bez dwukropków i liter spoza a-f
  });

  it('limit na klucz i na adres działa tak samo jak z solą z bazy, a nowe okno zaczyna od zera', async () => {
    const clock = { now: NOON };
    const redis = new MemoryRedis(() => clock.now);
    const opts = { secret: SECRET };
    const { perKey, perAddress } = RATE_LIMITS.runs;
    for (let i = 0; i < perKey; i++) expect((await checkRate(redis, 'runs', { owner: OWNER, address: `10.0.0.${i}` }, clock.now, opts)).ok).toBe(true);
    const denied = await checkRate(redis, 'runs', { owner: OWNER, address: '10.0.1.1' }, clock.now, opts);
    expect(denied).toEqual({ ok: false, retryAfter: 3600 });
    expect((await checkRate(redis, 'runs', { owner: OTHER, address: '10.0.1.1' }, clock.now, opts)).ok).toBe(true);
    for (let i = 0; i < perAddress; i++) await checkRate(redis, 'runs', { owner: null, address: '10.5.5.5' }, clock.now, opts);
    expect((await checkRate(redis, 'runs', { owner: null, address: '10.5.5.5' }, clock.now, opts)).ok).toBe(false);
    clock.now += denied.retryAfter * 1000;
    expect((await checkRate(redis, 'runs', { owner: OWNER, address: '10.5.5.5' }, clock.now, opts)).ok).toBe(true);
  });

  for (const skew of [0, 3_600_000, -3_600_000]) {
    it(`liczniki mają czas życia względny, także gdy zegar bazy jest przesunięty o ${skew / 3_600_000} h`, async () => {
      const redis = new MemoryRedis(() => NOON + skew);
      await checkRate(redis, 'runs', who, NOON, { secret: SECRET });
      const windowEnd = (indexOf('runs', NOON) + 1) * RATE_LIMITS.runs.window * 1000;
      expect(redis.keys()).toHaveLength(2);
      for (const k of redis.keys()) expect(Number((await redis.exec([['PTTL', k]]))[0]), k).toBe(windowEnd - NOON);
    });
  }

  it('zmiana sekretu zeruje liczniki adresu bieżących okien (skróty się zmieniają); liczniki klucza (bez adresu w nazwie) zostają', async () => {
    const redis = new MemoryRedis(() => NOON);
    const { perAddress, perKey } = RATE_LIMITS.runs;
    for (let i = 0; i < perAddress; i++) await checkRate(redis, 'runs', { owner: null, address: '10.5.5.5' }, NOON, { secret: SECRET });
    expect((await checkRate(redis, 'runs', { owner: null, address: '10.5.5.5' }, NOON, { secret: SECRET })).ok).toBe(false);
    expect((await checkRate(redis, 'runs', { owner: null, address: '10.5.5.5' }, NOON, { secret: `${SECRET}-nowy` })).ok).toBe(true);
    for (let i = 0; i < perKey; i++) await checkRate(redis, 'runs', { owner: OWNER, address: `10.0.0.${i}` }, NOON, { secret: SECRET });
    expect((await checkRate(redis, 'runs', { owner: OWNER, address: '10.0.9.9' }, NOON, { secret: `${SECRET}-nowy` })).ok).toBe(false);
  });

  it('sekret krótszy niż minimum to błąd (słaby sekret nie jest po cichu używany), a komunikat go nie zdradza', async () => {
    const weak = 'x'.repeat(RATE_SECRET_MIN_CHARS - 1);
    const redis = new MemoryRedis(() => NOON);
    const err = await checkRate(redis, 'runs', who, NOON, { secret: weak }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedisError);
    expect(String((err as Error).message)).not.toContain(weak);
    expect(redis.calls).toBe(0);
    expect(RATE_SECRET_MIN_CHARS).toBe(16);
    await expect(checkRate(redis, 'runs', who, NOON, { secret: '' })).rejects.toThrow();
    expect((await checkRate(redis, 'runs', who, NOON, { secret: 'x'.repeat(RATE_SECRET_MIN_CHARS) })).ok).toBe(true);
  });

  it('z bramką: odmowa bazy zapamiętana, a 100 następnych żądań kosztuje 0 zapytań (tak samo z sekretem i bez)', async () => {
    const redis = new MemoryRedis(() => NOON);
    const gate = createRateGate();
    for (let i = 0; i <= RATE_LIMITS.runs.perAddress; i++) await checkRate(redis, 'runs', { owner: `${i.toString(16).padStart(8, '0')}${'f'.repeat(56)}`, address: ADDRESS }, NOON, { secret: SECRET, gate });
    const [calls, commands] = [redis.calls, redis.commands];
    for (let i = 0; i < 100; i++) expect((await checkRate(redis, 'runs', { owner: OWNER, address: ADDRESS }, NOON, { secret: SECRET, gate })).ok).toBe(false);
    expect([redis.calls - calls, redis.commands - commands]).toEqual([0, 0]);
  });
});

/**
 * Koszt jednego sprawdzenia limitu w bazie (zapytania HTTP i polecenia), zmierzony na `MemoryRedis` z licznikiem. „Przed” (zmierzone
 * na kodzie sprzed zadania): przepuszczone 2 zapytania i 6 poleceń, odrzucone przez bazę 2 i 6, a 100 kolejnych odmów tego samego
 * adresu 200 zapytań i 600 poleceń. Testy zamrażają liczby „po”.
 */
describe('koszt sprawdzenia limitu w bazie (przed: 2 zapytania i 6 poleceń także dla odmowy, 100 odmów = 200 i 600)', () => {
  const NOON = Date.UTC(2026, 9, 28, 12, 0, 0);
  const SECRET = 'sekret-limitu-0123456789abcdef';
  const owner = (i: number): string => i.toString(16).padStart(8, '0').padEnd(64, 'f');
  const { perAddress, perKey } = RATE_LIMITS.runs;

  for (const [name, secret, pass] of [
    ['bez RANKING_SALT (sól okna w bazie)', undefined, { calls: 2, commands: 6 }],
    ['z RANKING_SALT (HMAC)', SECRET, { calls: 1, commands: 4 }],
  ] as const) {
    const measure = async (redis: MemoryRedis, fn: () => Promise<unknown>): Promise<{ calls: number; commands: number }> => {
      const [calls, commands] = [redis.calls, redis.commands];
      await fn();
      return { calls: redis.calls - calls, commands: redis.commands - commands };
    };

    it(`${name}: (a) przepuszczone ${pass.calls} zapytań i ${pass.commands} poleceń, (b) pierwsze odrzucone przez bazę tyle samo, (c) 100 następnych 0 i 0`, async () => {
      const redis = new MemoryRedis(() => NOON);
      for (let i = 0; i < perAddress; i++) await checkRate(redis, 'runs', { owner: owner(i), address: ADDRESS }, NOON, { secret });   // inne instancje wypełniły limit adresu
      const opts = { secret, gate: createRateGate() };   // ta instancja ma pustą pamięć
      let first: RateCheck | undefined;
      expect(await measure(redis, async () => { first = await checkRate(redis, 'runs', { owner: owner(1000), address: ADDRESS }, NOON, opts); })).toEqual(pass);
      expect(first).toMatchObject({ ok: false });
      expect(await measure(redis, async () => {
        for (let i = 0; i < 100; i++) await checkRate(redis, 'runs', { owner: owner(2000 + i), address: ADDRESS }, NOON, opts);
      })).toEqual({ calls: 0, commands: 0 });
    });

    it(`${name}: (a) pojedyncze przepuszczone żądanie ${pass.calls} zapytań i ${pass.commands} poleceń; ta sama instancja, która doprowadziła licznik do limitu, odmawia następnemu za 0`, async () => {
      const redis = new MemoryRedis(() => NOON);
      const opts = { secret, gate: createRateGate() };
      expect(await measure(redis, () => checkRate(redis, 'runs', { owner: owner(0), address: ADDRESS }, NOON, opts))).toEqual(pass);
      for (let i = 1; i < perAddress; i++) await checkRate(redis, 'runs', { owner: owner(i), address: ADDRESS }, NOON, opts);
      expect(await measure(redis, async () => {
        expect(await checkRate(redis, 'runs', { owner: owner(1000), address: ADDRESS }, NOON, opts)).toMatchObject({ ok: false });
      })).toEqual({ calls: 0, commands: 0 });   // limit osiągnięty żądaniem 30., więc 31. baza by odrzuciła na pewno
    });

    it(`${name}: to samo dla odmowy na kluczu (pierwsza kosztuje tyle co przepuszczenie, 100 następnych z różnych adresów 0 i 0)`, async () => {
      const redis = new MemoryRedis(() => NOON);
      for (let i = 0; i < perKey; i++) await checkRate(redis, 'runs', { owner: owner(7), address: `10.0.0.${i}` }, NOON, { secret });
      const opts = { secret, gate: createRateGate() };
      expect(await measure(redis, () => checkRate(redis, 'runs', { owner: owner(7), address: '10.0.1.1' }, NOON, opts))).toEqual(pass);
      expect(await measure(redis, async () => {
        for (let i = 0; i < 100; i++) await checkRate(redis, 'runs', { owner: owner(7), address: `10.1.0.${i}` }, NOON, opts);
      })).toEqual({ calls: 0, commands: 0 });
    });

    it(`${name}: bez bramki odmowa kosztuje tyle co przepuszczenie (${pass.calls} zapytań i ${pass.commands} poleceń), więc 100 odmów to ${100 * pass.calls} i ${100 * pass.commands}`, async () => {
      const redis = new MemoryRedis(() => NOON);
      for (let i = 0; i <= perAddress; i++) await checkRate(redis, 'runs', { owner: owner(i), address: ADDRESS }, NOON, { secret });
      expect(await measure(redis, async () => {
        for (let i = 0; i < 100; i++) expect((await checkRate(redis, 'runs', { owner: owner(2000 + i), address: ADDRESS }, NOON, { secret })).ok).toBe(false);
      })).toEqual({ calls: 100 * pass.calls, commands: 100 * pass.commands });
    });
  }
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

describe('adres IPv6 liczony po prefiksie /64', () => {
  const owner = (i: number): string => i.toString(16).padStart(8, '0').padEnd(64, 'f');

  it('IPv4 i tekst, który nie jest adresem, bez zmian; IPv6 to pierwsze 4 z 8 grup po rozwinięciu ::, zapisane jednolicie', () => {
    expect(addressBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('nieznany')).toBe('nieznany');
    expect(addressBucket('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3:8d3/64');
    expect(addressBucket('2001:db8::1')).toBe('2001:db8:0:0/64');
    expect(addressBucket('2001:0DB8:0000:0000:ABCD:0000:0000:0001')).toBe('2001:db8:0:0/64');
    expect(addressBucket('2001:db8:1:2::')).toBe('2001:db8:1:2/64');
    expect(addressBucket('1:2:3:4:5:6:7::')).toBe('1:2:3:4/64');   // :: za siódmą grupą to jedna grupa zer
    expect(addressBucket('::1')).toBe('0:0:0:0/64');
    expect(addressBucket('::')).toBe('0:0:0:0/64');
    expect(addressBucket('fe80::1%eth0')).toBe('fe80:0:0:0/64');
    expect(addressBucket('[2001:db8::1]')).toBe('2001:db8:0:0/64');
    expect(addressBucket('  2001:db8::1 ')).toBe('2001:db8:0:0/64');
  });

  it('ten sam prefiks to jeden kubełek niezależnie od końcówki i zapisu, inny prefiks to inny kubełek', () => {
    const same = ['2001:db8:aaaa:bbbb::1', '2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff', '2001:DB8:AAAA:BBBB:1:2:3:4', '2001:db8:aaaa:bbbb:0:0:0:0', '2001:db8:aaaa:bbbb::'];
    expect(new Set(same.map(addressBucket)).size).toBe(1);
    expect(addressBucket('2001:db8:aaaa:bbbc::1')).not.toBe(addressBucket(same[0]!));
    expect(addressBucket('2001:db8:aaab:bbbb::1')).not.toBe(addressBucket(same[0]!));
  });

  it('IPv4 zapisany jako IPv6 to ten sam kubełek co zwykły IPv4 (nie wspólny dla wszystkich takich klientów)', () => {
    for (const mapped of ['::ffff:203.0.113.7', '::FFFF:cb00:7107', '0:0:0:0:0:ffff:203.0.113.7', '::ffff:203.0.113.007']) {
      expect(addressBucket(mapped), mapped).toBe('203.0.113.7');
    }
    expect(addressBucket('::ffff:203.0.113.8')).not.toBe(addressBucket('::ffff:203.0.113.7'));
  });

  it('tekst, którego nie da się rozebrać na osiem grup szesnastkowych, zostaje bez zmian', () => {
    for (const odd of ['1:2:3', '1:2:3:4:5:6:7:8:9', '1::2::3', '12345::1', 'g::1', ':::', '1:2:3:4:5:6:7:8::', '::ffff:300.1.1.1', 'a:b', '1.2.3.4:80']) {
      expect(addressBucket(odd), odd).toBe(odd);
    }
  });

  it('limit na adres: wszystkie adresy z jednego prefiksu /64 dzielą jeden licznik, inny prefiks, IPv4 i adres bez prefiksu mają osobne', async () => {
    const { redis, clock } = setup();
    const { perAddress } = RATE_LIMITS.runs;
    for (let i = 0; i < perAddress; i++) {
      const address = `2001:db8:aaaa:bbbb:${i.toString(16)}:${i}::${i + 1}`;   // inna końcówka za każdym razem
      expect((await checkRate(redis, 'runs', { owner: owner(i), address }, clock.now)).ok, address).toBe(true);
    }
    const sameNet = { owner: owner(500), address: '2001:db8:aaaa:bbbb:dead:beef:0:1' };
    expect((await checkRate(redis, 'runs', sameNet, clock.now)).ok).toBe(false);
    expect((await checkRate(redis, 'runs', { owner: null, address: '2001:db8:aaaa:bbbb::9' }, clock.now)).ok).toBe(false);
    expect((await checkRate(redis, 'runs', { owner: owner(501), address: '2001:db8:aaaa:bbbc::1' }, clock.now)).ok).toBe(true);
    expect((await checkRate(redis, 'runs', { owner: owner(502), address: '203.0.113.7' }, clock.now)).ok).toBe(true);
    expect((await checkRate(redis, 'runs', { owner: owner(503), address: '::ffff:203.0.113.7' }, clock.now)).ok).toBe(true);
    expect((await checkRate(redis, 'runs', { owner: owner(504), address: '203.0.113.7' }, clock.now)).ok).toBe(true);
  });

  it('w bazie leży tylko skrót z solą, nie prefiks ani adres', async () => {
    const { redis, clock } = setup();
    await checkRate(redis, 'runs', { owner: owner(7), address: '2001:db8:aaaa:bbbb::1' }, clock.now);
    const keys = redis.keys().join(' ');
    for (const leak of ['2001:db8', 'db8:aaaa', ':bbbb', '/64']) expect(keys).not.toContain(leak);   // skrót jest szesnastkowy, bez dwukropków
    expect(keys).toContain(':a:');
  });
});

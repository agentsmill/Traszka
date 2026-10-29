import { describe, expect, it } from 'vitest';
import { NICK_TTL } from './config';
import { KEYS, ownerOf } from './keys';
import { MemoryRedis } from './memoryRedis';
import { claimNick, nickRecord, nickStatus, ownedNicks } from './nicks';
import { run } from './redis';

const DAY_MS = 86_400_000;
const KEY_A = 'K7QX9MBD2HFAP3WN8RTE';
const KEY_B = 'ZZZZZZZZZZZZZZZZZZZZ';

async function setup() {
  const clock = { now: Date.UTC(2026, 9, 28) };
  const redis = new MemoryRedis(() => clock.now);
  return { redis, clock, a: await ownerOf(KEY_A), b: await ownerOf(KEY_B) };
}

describe('właściciel nicka to skrót klucza', () => {
  it('SHA-256 (64 znaki szesnastkowe), ten sam klucz zawsze daje ten sam skrót, a samego klucza nie widać', async () => {
    const { a, b } = await setup();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ownerOf(KEY_A)).toBe(a);
    expect(a).not.toBe(b);
    expect(a).not.toContain(KEY_A.toLowerCase());
  });
});

describe('rezerwacja nicka', () => {
  it('pierwszy przyjęty wynik rezerwuje nick: w bazie jest skrót klucza, nie klucz', async () => {
    const { redis, clock, a } = await setup();
    expect(await nickStatus(redis, 'mateusz', a, clock.now)).toBe('free');
    expect(await claimNick(redis, 'Mateusz', 'mateusz', a, clock.now)).toBe('claimed');
    expect(await nickRecord(redis, 'mateusz')).toEqual({ nick: 'Mateusz', owner: a, since: clock.now, lastScoreAt: clock.now });
    const raw = String(await run(redis, ['GET', KEYS.nick('mateusz')]));
    expect(raw).not.toContain(KEY_A);
    expect(await nickStatus(redis, 'mateusz', a, clock.now)).toBe('mine');
  });

  it('inny klucz dostaje „zajęty”, ten sam odświeża rezerwację (i może zmienić wielkość liter wyświetlanego nicka)', async () => {
    const { redis, clock, a, b } = await setup();
    await claimNick(redis, 'Mateusz', 'mateusz', a, clock.now);
    expect(await nickStatus(redis, 'mateusz', b, clock.now)).toBe('taken');
    expect(await claimNick(redis, 'MATEUSZ', 'mateusz', b, clock.now)).toBe('taken');
    const since = clock.now;
    clock.now += 30 * DAY_MS;
    expect(await claimNick(redis, 'MaTeUsZ', 'mateusz', a, clock.now)).toBe('refreshed');
    expect(await nickRecord(redis, 'mateusz')).toEqual({ nick: 'MaTeUsZ', owner: a, since, lastScoreAt: clock.now });
  });

  it('rezerwacja bez nowego wyniku wygasa po 12 miesiącach; potem nick przejmuje ktoś inny', async () => {
    const { redis, clock, a, b } = await setup();
    await claimNick(redis, 'Mateusz', 'mateusz', a, clock.now);
    clock.now += NICK_TTL * 1000 - 1;
    expect(await nickStatus(redis, 'mateusz', b, clock.now)).toBe('taken');
    clock.now += 1;
    expect(await nickStatus(redis, 'mateusz', b, clock.now)).toBe('free');
    expect(await claimNick(redis, 'Mateusz', 'mateusz', b, clock.now)).toBe('claimed');
    expect(await nickStatus(redis, 'mateusz', a, clock.now)).toBe('taken');
  });

  it('każdy wynik odnawia rok: rezerwacja odświeżana co pół roku nie wygasa', async () => {
    const { redis, clock, a, b } = await setup();
    await claimNick(redis, 'Mateusz', 'mateusz', a, clock.now);
    for (let i = 0; i < 4; i++) {
      clock.now += 180 * DAY_MS;
      expect(await claimNick(redis, 'Mateusz', 'mateusz', a, clock.now)).toBe('refreshed');
    }
    clock.now += 364 * DAY_MS;
    expect(await nickStatus(redis, 'mateusz', b, clock.now)).toBe('taken');
  });

  it('rekord przeterminowany po dacie ostatniego wyniku (gdyby baza nie skasowała go sama) też jest wolny', async () => {
    const { redis, clock, a, b } = await setup();
    const old = { nick: 'Mateusz', owner: a, since: 0, lastScoreAt: clock.now - NICK_TTL * 1000 - 1 };
    await run(redis, ['SET', KEYS.nick('mateusz'), JSON.stringify(old)]);
    expect(await nickStatus(redis, 'mateusz', b, clock.now)).toBe('free');
    expect(await claimNick(redis, 'Mateusz', 'mateusz', b, clock.now)).toBe('claimed');
    expect((await nickRecord(redis, 'mateusz'))?.owner).toBe(b);
  });

  it('uszkodzony rekord w bazie traktujemy jak brak rezerwacji', async () => {
    const { redis, clock, a } = await setup();
    for (const raw of ['nie json', '{}', '{"nick":"x","owner":5}', 'null']) {
      await run(redis, ['SET', KEYS.nick('mateusz'), raw]);
      expect(await nickRecord(redis, 'mateusz'), raw).toBeNull();
      expect(await nickStatus(redis, 'mateusz', a, clock.now)).toBe('free');
    }
  });

  it('wyścig: ktoś zarezerwował nick między sprawdzeniem a zapisem, więc drugi dostaje „zajęty”', async () => {
    const { clock, a, b } = await setup();
    const inner = new MemoryRedis(() => clock.now);
    let raced = false;
    const racy = {
      async exec(commands: Parameters<MemoryRedis['exec']>[0]) {
        if (!raced && commands.some((c) => c[0] === 'SET' && c.includes('NX'))) {
          raced = true;
          await claimNick(inner, 'Mateusz', 'mateusz', b, clock.now);
        }
        return inner.exec(commands);
      },
    };
    expect(await claimNick(racy, 'Mateusz', 'mateusz', a, clock.now)).toBe('taken');
    expect((await nickRecord(inner, 'mateusz'))?.owner).toBe(b);
  });
});

describe('nicki gracza (po wpisaniu kodu na nowym urządzeniu)', () => {
  it('lista żywych nicków klucza w postaci do wyświetlania; nicki przejęte przez innych i wygasłe odpadają', async () => {
    const { redis, clock, a, b } = await setup();
    await claimNick(redis, 'Mateusz', 'mateusz', a, clock.now);
    await claimNick(redis, 'Kasjer Roku', 'kasjer roku', a, clock.now);
    expect(await ownedNicks(redis, a, clock.now)).toEqual(['Kasjer Roku', 'Mateusz']);
    expect(await ownedNicks(redis, b, clock.now)).toEqual([]);
    clock.now += NICK_TTL * 1000;
    await claimNick(redis, 'Mateusz', 'mateusz', b, clock.now);
    expect(await ownedNicks(redis, a, clock.now)).toEqual([]);
    expect(await ownedNicks(redis, b, clock.now)).toEqual(['Mateusz']);
  });
});

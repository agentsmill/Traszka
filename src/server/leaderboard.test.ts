import { describe, expect, it } from 'vitest';
import { BOARD_KEEP, NICK_TTL } from './config';
import { KEYS, memberOf, ownerOf, seedIdOf } from './keys';
import { readBoard, rankOf, recordScore, type ScoreEntry } from './leaderboard';
import { MemoryRedis } from './memoryRedis';
import { claimNick } from './nicks';
import { run } from './redis';

const T0 = Date.UTC(2026, 9, 28, 12);

/** Gracze z kluczami (indeks w kluczu, żeby każdy był inny). */
async function players(n: number) {
  return Promise.all(Array.from({ length: n }, async (_, i) => {
    const key = String(i).padStart(20, '0');
    return { key, owner: await ownerOf(key), nick: `Gracz${i}`, nickKey: `gracz${i}` };
  }));
}

async function setup() {
  const clock = { now: T0 };
  const redis = new MemoryRedis(() => clock.now);
  /** Przyjęty wynik: rezerwacja nicka i wpis do rankingów (tak jak robi to API po odtworzeniu biegu). */
  const accept = async (p: { owner: string; nick: string; nickKey: string }, score: number, seed = 'pierogi-731', more: Partial<ScoreEntry> = {}) => {
    expect(await claimNick(redis, p.nick, p.nickKey, p.owner, clock.now)).not.toBe('taken');
    return recordScore(redis, { owner: p.owner, nick: p.nick, nickKey: p.nickKey, seed, weekId: null, score, now: clock.now, ...more });
  };
  return { redis, clock, accept };
}

describe('wpis wyniku do rankingów', () => {
  it('ranking globalny trzyma najlepszy wynik gracza (nick), z seedem i datą tego biegu', async () => {
    const { redis, clock, accept } = await setup();
    const [a] = await players(1);
    expect(await accept(a!, 30_000, 'bigos-100')).toEqual({ improved: true, best: 30_000, ranks: { global: 1, seed: 1, week: null } });
    clock.now += 1000;
    expect(await accept(a!, 10_000, 'flaki-200')).toEqual({ improved: false, best: 30_000, ranks: { global: 1, seed: 1, week: null } });
    expect(await readBoard(redis, { board: 'global', limit: 10 })).toEqual([{ rank: 1, nick: 'Gracz0', score: 30_000, seed: 'bigos-100', at: T0 }]);
  });

  it('każdy seed ma własny ranking (także seed z wulgaryzmem: filtra słów nie ma), a gracz jest w nim raz', async () => {
    const { redis, accept } = await setup();
    const [a, b] = await players(2);
    await accept(a!, 30_000, 'bigos-100');
    await accept(a!, 10_000, 'flaki-200');
    await accept(b!, 20_000, 'flaki-200');
    await accept(a!, 15_000, 'flaki-200');
    await accept(b!, 5_000, 'kurwa-mać');
    expect(await readBoard(redis, { board: 'seed', seed: 'flaki-200', limit: 10 })).toEqual([
      { rank: 1, nick: 'Gracz1', score: 20_000 }, { rank: 2, nick: 'Gracz0', score: 15_000 },
    ]);
    expect(await readBoard(redis, { board: 'seed', seed: 'bigos-100', limit: 10 })).toEqual([{ rank: 1, nick: 'Gracz0', score: 30_000 }]);
    expect(await readBoard(redis, { board: 'seed', seed: 'kurwa-mać', limit: 10 })).toEqual([{ rank: 1, nick: 'Gracz1', score: 5_000 }]);
    expect(await readBoard(redis, { board: 'seed', seed: 'nikt-tu-nie-grał', limit: 10 })).toEqual([]);
  });

  it('ranking tygodnia dostaje wynik tylko wtedy, gdy API poda tydzień (bieg na seedzie tygodnia), i żyje dziewięć tygodni', async () => {
    const { redis, accept } = await setup();
    const [a, b] = await players(2);
    expect((await accept(a!, 5_000, 'zurek-321', { weekId: '2026-W44' })).ranks).toEqual({ global: 1, seed: 1, week: 1 });
    await accept(b!, 9_000, 'zurek-321');
    expect(await readBoard(redis, { board: 'week', weekId: '2026-W44', limit: 10 })).toEqual([{ rank: 1, nick: 'Gracz0', score: 5_000 }]);
    expect(Number(await run(redis, ['PTTL', KEYS.week('2026-W44')]))).toBe(63 * 86_400_000);
  });

  it('nick w rankingu w postaci z ostatniego zgłoszenia (zmiana wielkości liter dotyczy wszystkich rankingów gracza)', async () => {
    const { redis, accept } = await setup();
    const [a] = await players(1);
    await accept(a!, 30_000, 'bigos-100');
    await accept({ ...a!, nick: 'GRACZ0' }, 1_000, 'flaki-200');
    expect(await readBoard(redis, { board: 'global', limit: 10 })).toEqual([{ rank: 1, nick: 'GRACZ0', score: 30_000, seed: 'bigos-100', at: T0 }]);
    expect((await readBoard(redis, { board: 'seed', seed: 'bigos-100', limit: 10 }))[0]!.nick).toBe('GRACZ0');
  });

  it('miejsca: wyniki malejąco, remis to to samo miejsce (1, 2, 2, 4), a limit tnie listę', async () => {
    const { redis, accept } = await setup();
    const ps = await players(5);
    for (const [i, score] of [40, 30, 30, 10, -5].entries()) await accept(ps[i]!, score);
    const rows = await readBoard(redis, { board: 'global', limit: 10 });
    expect(rows.map((r) => [r.rank, r.score])).toEqual([[1, 40], [2, 30], [2, 30], [4, 10], [5, -5]]);
    expect(await readBoard(redis, { board: 'global', limit: 2 })).toHaveLength(2);
    expect(await rankOf(redis, KEYS.global, memberOf(ps[3]!.owner, ps[3]!.nickKey))).toEqual({ rank: 4, score: 10 });
    expect(await rankOf(redis, KEYS.global, memberOf(ps[2]!.owner, ps[2]!.nickKey))).toEqual({ rank: 2, score: 30 });
    expect(await rankOf(redis, KEYS.global, 'nikogo:tu')).toBeNull();
  });

  it('wyniki zostają po wygaśnięciu nicka; kto zarezerwuje go potem, ma osobny wpis i nie przejmuje cudzych wyników', async () => {
    const { redis, clock, accept } = await setup();
    const [a, , c] = await players(3);
    await accept(a!, 50_000);
    clock.now += NICK_TTL * 1000;
    expect(await readBoard(redis, { board: 'global', limit: 10 })).toEqual([{ rank: 1, nick: 'Gracz0', score: 50_000, seed: 'pierogi-731', at: T0 }]);
    const next = { ...c!, nick: 'Gracz0', nickKey: 'gracz0' };
    expect((await accept(next, 1_000)).improved).toBe(true);   // pierwszy wynik nowego właściciela, a nie „gorszy od cudzego rekordu”
    expect((await readBoard(redis, { board: 'global', limit: 10 })).map((r) => [r.nick, r.score])).toEqual([['Gracz0', 50_000], ['Gracz0', 1_000]]);
    expect(await rankOf(redis, KEYS.global, memberOf(next.owner, 'gracz0'))).toEqual({ rank: 2, score: 1_000 });
  });

  it('ranking trzyma najwyżej BOARD_KEEP miejsc: najsłabsze wypadają przy kolejnym wpisie', async () => {
    const { redis, accept } = await setup();
    const seeded = Array.from({ length: BOARD_KEEP }, (_, i) => [i + 10, `zzzzzzzzzzzzzzzz:stary${i}`] as const);
    await redis.exec([['ZADD', KEYS.global, ...seeded.flat()]]);
    const [a] = await players(1);
    const res = await accept(a!, 5);
    expect(res.ranks.global).toBeNull();   // za słaby na pierwsze 10 000 miejsc
    expect(Number(await run(redis, ['ZCARD', KEYS.global]))).toBe(BOARD_KEEP);
    expect((await accept(a!, 1e9)).ranks.global).toBe(1);
  });

  it('wpis bez danych (nie powinien się zdarzyć) pokazuje klucz nicka, bez seeda', async () => {
    const { redis } = await setup();
    await redis.exec([['ZADD', KEYS.global, 7, 'abcdabcdabcdabcd:sierota']]);
    expect(await readBoard(redis, { board: 'global', limit: 10 })).toEqual([{ rank: 1, nick: 'sierota', score: 7, seed: null }]);
  });

  it('w bazie nie ma klucza gracza ani adresu: tylko skrót, tag skrótu, nick i seed (ranking seeda pod skrótem seeda); dane wpisu bez czasu życia', async () => {
    const { redis, accept } = await setup();
    const [a] = await players(1);
    await accept(a!, 1, 'pierogi-731');
    const keys = redis.keys();
    expect(keys).toContain(KEYS.seed(await seedIdOf('pierogi-731')));
    expect(keys.join(' ')).not.toContain(a!.key);
    expect(Number(await run(redis, ['PTTL', KEYS.entry(memberOf(a!.owner, a!.nickKey))]))).toBe(-1);
  });
});

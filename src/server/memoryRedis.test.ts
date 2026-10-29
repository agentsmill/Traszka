import { describe, expect, it } from 'vitest';
import { MemoryRedis } from './memoryRedis';
import { RedisError, asNumber, asScored, asStrings, run } from './redis';

/** Atrapa bazy z ręcznym zegarem. */
function redisAt(start = 1_000_000) {
  const clock = { now: start };
  return { redis: new MemoryRedis(() => clock.now), clock };
}

describe('MemoryRedis: atrapa Upstash do testów (te same polecenia, te same kształty wyników)', () => {
  it('GET, SET, MGET i DEL; SET NX nie nadpisuje, XX nie tworzy', async () => {
    const { redis } = redisAt();
    expect(await redis.exec([
      ['SET', 'a', '1'], ['GET', 'a'], ['SET', 'a', '2', 'NX'], ['GET', 'a'], ['SET', 'b', '3', 'XX'], ['MGET', 'a', 'b'],
      ['SET', 'a', '4', 'XX'], ['DEL', 'a', 'b'], ['GET', 'a'],
    ])).toEqual(['OK', '1', null, '1', null, ['1', null], 'OK', 1, null]);
  });

  it('czas życia: EX, PX, PXAT i EXPIRE; klucz znika po czasie, a INCR go nie odnawia', async () => {
    const { redis, clock } = redisAt(0);
    await redis.exec([['SET', 'ex', 'x', 'EX', 10], ['SET', 'px', 'x', 'PX', 500], ['SET', 'at', 'x', 'PXAT', 2000], ['SET', 'n', '0', 'PXAT', 3000]]);
    await redis.exec([['SET', 'e', 'x'], ['EXPIRE', 'e', 1]]);
    expect(await run(redis, ['INCR', 'n'])).toBe(1);
    clock.now = 999;
    expect(await redis.exec([['GET', 'px'], ['GET', 'e'], ['GET', 'at'], ['PTTL', 'at'], ['PTTL', 'ex']])).toEqual([null, 'x', 'x', 1001, 9001]);
    clock.now = 2000;
    expect(await redis.exec([['GET', 'at'], ['GET', 'e'], ['GET', 'ex'], ['INCR', 'n']])).toEqual([null, null, 'x', 2]);
    clock.now = 3000;
    expect(await redis.exec([['GET', 'n'], ['INCR', 'n'], ['PTTL', 'n']])).toEqual([null, 1, -1]);
  });

  it('PEXPIRE: czas życia względny w ms od zegara bazy; brak klucza daje 0, czas minięty usuwa klucz, nowy czas zastępuje stary', async () => {
    const { redis, clock } = redisAt(5_000);
    expect(await run(redis, ['PEXPIRE', 'brak', 100])).toBe(0);
    await redis.exec([['SET', 'a', 'x'], ['SET', 'b', 'x', 'PX', 100]]);
    expect(await redis.exec([['PEXPIRE', 'a', 700], ['PTTL', 'a'], ['PEXPIRE', 'b', 2_000], ['PTTL', 'b']])).toEqual([1, 700, 1, 2_000]);
    clock.now = 5_600;
    expect(await redis.exec([['PTTL', 'a'], ['PEXPIRE', 'a', 700], ['PTTL', 'a']])).toEqual([100, 1, 700]);
    clock.now = 6_000;
    expect(await redis.exec([['PEXPIRE', 'a', 0], ['GET', 'a'], ['PTTL', 'b']])).toEqual([1, null, 1_000]);   // 0 usuwa klucz jak w Redisie
    await expect(run(redis, ['PEXPIRE', 'b', 'x'])).rejects.toBeInstanceOf(RedisError);
  });

  it('zbiór sortowany: ZADD GT CH podnosi tylko w górę, ZREVRANGE z wynikami jako tekst (jak Upstash)', async () => {
    const { redis } = redisAt();
    expect(await redis.exec([
      ['ZADD', 'z', 'GT', 'CH', 10, 'a'], ['ZADD', 'z', 'GT', 'CH', 5, 'a'], ['ZADD', 'z', 'GT', 'CH', 10, 'a'],
      ['ZADD', 'z', 'GT', 'CH', 20, 'a'], ['ZADD', 'z', 'GT', 'CH', -3, 'b'], ['ZADD', 'z', 15, 'c'],
      ['ZREVRANGE', 'z', 0, -1, 'WITHSCORES'], ['ZSCORE', 'z', 'a'], ['ZSCORE', 'z', 'x'], ['ZCARD', 'z'],
    ])).toEqual([1, 0, 0, 1, 1, 1, ['a', '20', 'c', '15', 'b', '-3'], '20', null, 3]);
  });

  it('ZREVRANGE bez wyników, z zakresem; ZREVRANK; ZCOUNT z przedziałem otwartym; ZREM; ZREMRANGEBYRANK zostawia najlepszych', async () => {
    const { redis } = redisAt();
    await redis.exec([['ZADD', 'z', 1, 'a'], ['ZADD', 'z', 2, 'b'], ['ZADD', 'z', 3, 'c'], ['ZADD', 'z', 3, 'd']]);
    expect(await redis.exec([
      ['ZREVRANGE', 'z', 1, 2], ['ZREVRANK', 'z', 'a'], ['ZREVRANK', 'z', 'x'], ['ZCOUNT', 'z', '(2', '+inf'], ['ZCOUNT', 'z', 2, '+inf'],
      ['ZCOUNT', 'z', '-inf', '+inf'],
    ])).toEqual([['c', 'b'], 3, null, 2, 3, 4]);
    // równe wyniki: kolejność odwrotna leksykograficzna (jak Redis), więc d przed c
    expect(asScored(await run(redis, ['ZREVRANGE', 'z', 0, 1, 'WITHSCORES']))).toEqual([{ member: 'd', score: 3 }, { member: 'c', score: 3 }]);
    expect(await redis.exec([['ZREMRANGEBYRANK', 'z', 0, -3], ['ZREVRANGE', 'z', 0, -1], ['ZREM', 'z', 'd', 'x'], ['ZCARD', 'z']]))
      .toEqual([2, ['d', 'c'], 1, 1]);
  });

  it('GETRANGE: przedział włącznie, ujemne indeksy od końca, koniec poza napisem przycięty, brak klucza i pusty przedział to pusty tekst', async () => {
    const { redis, clock } = redisAt(0);
    await redis.exec([['SET', 'k', '0123456789'], ['SET', 'ttl', 'abcdef', 'PX', 100]]);
    expect(await redis.exec([
      ['GETRANGE', 'k', 0, 2], ['GETRANGE', 'k', 3, 3], ['GETRANGE', 'k', 0, 24], ['GETRANGE', 'k', 0, -1], ['GETRANGE', 'k', -3, -1],
      ['GETRANGE', 'k', -100, 2], ['GETRANGE', 'k', 5, 2], ['GETRANGE', 'k', 20, 30], ['GETRANGE', 'nie-ma', 0, 24], ['GETRANGE', 'k', '1', '3'],
    ])).toEqual(['012', '3', '0123456789', '0123456789', '789', '012', '', '', '', '123']);
    clock.now = 100;
    expect(await run(redis, ['GETRANGE', 'ttl', 0, 2])).toBe('');   // wygasły klucz jak brak klucza
  });

  it('GETRANGE liczy bajty UTF-8, jak Redis (dwubajtowa litera zajmuje dwa miejsca), a na kluczu złego typu rzuca RedisError', async () => {
    const { redis } = redisAt();
    await redis.exec([['SET', 'pl', 'żółw'], ['ZADD', 'z', 1, 'a']]);
    expect(await redis.exec([['GETRANGE', 'pl', 0, 1], ['GETRANGE', 'pl', 2, 3], ['GETRANGE', 'pl', 0, -1]])).toEqual(['ż', 'ó', 'żółw']);
    await expect(run(redis, ['GETRANGE', 'z', 0, 1])).rejects.toBeInstanceOf(RedisError);
    await expect(run(redis, ['GETRANGE', 'pl', 'a', 1])).rejects.toBeInstanceOf(RedisError);
  });

  it('zbiory: SADD, SMEMBERS, SREM', async () => {
    const { redis } = redisAt();
    expect(await redis.exec([['SADD', 's', 'a', 'b'], ['SADD', 's', 'a'], ['SREM', 's', 'b', 'x'], ['SMEMBERS', 's'], ['SMEMBERS', 'nic']]))
      .toEqual([2, 0, 1, ['a'], []]);
  });

  it('polecenie spoza listy albo na kluczu złego typu rzuca RedisError (literówka w poleceniu nie przejdzie po cichu)', async () => {
    const { redis } = redisAt();
    await expect(redis.exec([['FLUSHALL']])).rejects.toBeInstanceOf(RedisError);
    await run(redis, ['SET', 'k', 'x']);
    await expect(run(redis, ['ZADD', 'k', 1, 'a'])).rejects.toBeInstanceOf(RedisError);
    await expect(run(redis, ['INCR', 'k'])).rejects.toBeInstanceOf(RedisError);
  });

  it('licznik poleceń (do testów, ile zapytań idzie do bazy)', async () => {
    const { redis } = redisAt();
    await redis.exec([['GET', 'a'], ['GET', 'b']]);
    await run(redis, ['GET', 'c']);
    expect(redis.calls).toBe(2);
    expect(redis.commands).toBe(3);
  });
});

describe('odczyt wyników', () => {
  it('liczby z tekstu i liczby; reszta to null', () => {
    expect([asNumber('12'), asNumber(7), asNumber('-3.5'), asNumber(''), asNumber(null), asNumber('x'), asNumber('inf')])
      .toEqual([12, 7, -3.5, null, null, null, null]);
  });

  it('listy tekstów i pary z wynikami odporne na zły kształt', () => {
    expect(asStrings(['a', null, 3])).toEqual(['a', null, null]);
    expect(asStrings('x')).toEqual([]);
    expect(asScored(['a', '1', 'b'])).toEqual([{ member: 'a', score: 1 }]);
    expect(asScored(null)).toEqual([]);
  });
});

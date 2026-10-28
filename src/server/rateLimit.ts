import { RATE_LIMITS, type RateAction } from './config.js';
import { cryptoBytes, randomHex, sha256Hex, type RandomBytes } from './hash.js';
import { KEYS } from './keys.js';
import { asNumber, asString, type RedisExec } from './redis.js';

/**
 * Limit zgłoszeń w stałych oknach czasu, osobno na klucz gracza i na adres klienta (spec §14.7). Adresu serwer nie przechowuje:
 * w bazie jest tylko jego skrót z solą tego okna, a sól i liczniki giną dokładnie z końcem okna (PXAT), więc po oknie nie da się
 * już powiedzieć, czyj to był skrót. Dwa zapytania do bazy: sól, potem liczniki.
 */
export interface RateCheck { ok: boolean; retryAfter: number }
export interface Requester { owner: string | null; address: string }

export async function checkRate(redis: RedisExec, action: RateAction, who: Requester, now: number, random: RandomBytes = cryptoBytes): Promise<RateCheck> {
  const { window, perKey, perAddress } = RATE_LIMITS[action];
  const index = Math.floor(now / (window * 1000));
  const end = (index + 1) * window * 1000;
  const saltKey = KEYS.salt(window, index);
  const [, saltRaw] = await redis.exec([['SET', saltKey, randomHex(16, random), 'NX', 'PXAT', end], ['GET', saltKey]]);
  const address = (await sha256Hex(`${asString(saltRaw) ?? ''}:${who.address}`)).slice(0, 32);

  const counters = [KEYS.rate(action, index, `a:${address}`)];
  if (who.owner !== null) counters.push(KEYS.rate(action, index, `k:${who.owner.slice(0, 32)}`));
  const results = await redis.exec(counters.flatMap((k) => [['SET', k, '0', 'NX', 'PXAT', end], ['INCR', k]]));
  const byAddress = asNumber(results[1]) ?? 0;
  const byKey = who.owner !== null ? asNumber(results[3]) ?? 0 : 0;
  const ok = byAddress <= perAddress && byKey <= perKey;
  return { ok, retryAfter: ok ? 0 : Math.max(1, Math.ceil((end - now) / 1000)) };
}

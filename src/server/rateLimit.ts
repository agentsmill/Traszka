import { BUDGET_TTL, RATE_LIMITS, type RateAction } from './config.js';
import { cryptoBytes, randomHex, sha256Hex, type RandomBytes } from './hash.js';
import { KEYS } from './keys.js';
import { asNumber, asString, type RedisExec } from './redis.js';

/**
 * Limit zgłoszeń w stałych oknach czasu, osobno na klucz gracza i na adres klienta (spec §14.7). Adresu serwer nie przechowuje:
 * w bazie jest tylko jego skrót z solą tego okna, a sól i liczniki giną dokładnie z końcem okna (PXAT), więc po oknie nie da się
 * już powiedzieć, czyj to był skrót. Dwa zapytania do bazy: sól, potem liczniki (drugiego nie da się dołączyć do pierwszego, bo
 * nazwy liczników zależą od soli). Na końcu pliku globalny budżet dzienny (`checkBudget`), niezależny od klucza i adresu.
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

const DAY_MS = 86_400_000;

/** Dzień UTC, w którym leży `now` (`2026-10-28`), i chwila jego końca (północ UTC, ms). */
export function utcDay(now: number): { id: string; end: number } {
  const start = Math.floor(now / DAY_MS) * DAY_MS;
  return { id: new Date(start).toISOString().slice(0, 10), end: start + DAY_MS };
}

/**
 * Globalny budżet dzienny: jeden licznik na nazwę i dobę UTC (`tr:budget:{nazwa}:{dzień}`), wspólny dla wszystkich kluczy i adresów.
 * Zatrzymuje to, czego limity na klucz i adres nie zatrzymają: klucz gracza jest za darmo, adresów (IPv6, serwery pośredniczące)
 * jest dużo. Każde sprawdzenie zużywa jedną sztukę (też to ponad limit, licznik tylko rośnie); ponad `limit` odmowa z czasem
 * do północy UTC. Jedno zapytanie do bazy: `SET NX EX` zakłada licznik z czasem życia, `INCR` liczy. Brak liczby w odpowiedzi
 * bazy to odmowa (ostatnia zapora nie ma przepuszczać na ślepo).
 */
export async function checkBudget(redis: RedisExec, name: string, limit: number, now: number): Promise<RateCheck> {
  const day = utcDay(now);
  const key = KEYS.budget(name, day.id);
  const [, used] = await redis.exec([['SET', key, '0', 'NX', 'EX', BUDGET_TTL], ['INCR', key]]);
  const count = asNumber(used);
  const ok = count !== null && count <= limit;
  return { ok, retryAfter: ok ? 0 : Math.max(1, Math.ceil((day.end - now) / 1000)) };
}

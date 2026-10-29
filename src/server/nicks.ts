import { isRec } from '../sim/guards.js';
import { NICK_TTL } from './config.js';
import { KEYS } from './keys.js';
import { asString, asStrings, run, type RedisExec } from './redis.js';

/**
 * Nick ma właściciela bez kont i haseł (spec §14.7): pierwszy przyjęty wynik z danym nickiem zapisuje parę „klucz nicka →
 * skrót klucza gracza”. Kolejne wyniki z tym nickiem przechodzą tylko z tym samym kluczem. Rezerwacja żyje rok od ostatniego
 * wyniku: baza kasuje rekord sama (EX), a gdyby nie zdążyła, `lastScoreAt` i tak mówi, że nick jest wolny.
 */
export interface NickRecord { nick: string; owner: string; since: number; lastScoreAt: number }
export type NickStatus = 'free' | 'mine' | 'taken';

const TTL_MS = NICK_TTL * 1000;

/** Rekord nicka z bazy (bez zaufania): uszkodzony to brak rezerwacji. */
export function parseNickRecord(raw: string | null): NickRecord | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRec(v) && typeof v.nick === 'string' && typeof v.owner === 'string' && Number.isFinite(v.since) && Number.isFinite(v.lastScoreAt)
    ? { nick: v.nick, owner: v.owner, since: v.since as number, lastScoreAt: v.lastScoreAt as number } : null;
}

/** Rezerwacja żyje, dopóki od ostatniego wyniku nie minął rok. */
export const isLive = (rec: NickRecord, now: number): boolean => now - rec.lastScoreAt < TTL_MS;

const statusOf = (rec: NickRecord | null, owner: string, now: number): NickStatus =>
  (rec === null || !isLive(rec, now) ? 'free' : rec.owner === owner ? 'mine' : 'taken');

export async function nickRecord(redis: RedisExec, nickKey: string): Promise<NickRecord | null> {
  return parseNickRecord(asString(await run(redis, ['GET', KEYS.nick(nickKey)])));
}

/** Czy nick jest wolny, mój (tego klucza) czy zajęty przez kogoś innego. */
export async function nickStatus(redis: RedisExec, nickKey: string, owner: string, now: number): Promise<NickStatus> {
  return statusOf(await nickRecord(redis, nickKey), owner, now);
}

/** Rekordy wielu nicków naraz (ranking: jeden MGET na stronę wyników). */
export async function nickRecords(redis: RedisExec, nickKeys: readonly string[]): Promise<(NickRecord | null)[]> {
  if (nickKeys.length === 0) return [];
  return asStrings(await run(redis, ['MGET', ...nickKeys.map(KEYS.nick)])).map(parseNickRecord);
}

/**
 * Po przyjętym wyniku: rezerwuje wolny nick (SET NX, więc z dwóch równoczesnych zgłoszeń wygrywa jedno), odświeża własny (nowa
 * data ostatniego wyniku i wyświetlana postać nicka) albo zwraca `taken`. Nick wygasły przejmuje nowy właściciel.
 */
export async function claimNick(redis: RedisExec, nick: string, nickKey: string, owner: string, now: number): Promise<'claimed' | 'refreshed' | 'taken'> {
  const key = KEYS.nick(nickKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    const rec = await nickRecord(redis, nickKey);
    const status = statusOf(rec, owner, now);
    if (status === 'taken') return 'taken';
    const value = JSON.stringify({ nick, owner, since: status === 'mine' ? rec!.since : now, lastScoreAt: now } satisfies NickRecord);
    const own: [string, ...(string | number)[]][] = [['SADD', KEYS.ownerNicks(owner), nickKey], ['EXPIRE', KEYS.ownerNicks(owner), NICK_TTL]];
    if (rec !== null) {
      // własny nick albo cudzy wygasły (rekord jeszcze leży w bazie): nadpisujemy
      await redis.exec([['SET', key, value, 'EX', NICK_TTL], ...own]);
      return status === 'mine' ? 'refreshed' : 'claimed';
    }
    const [set] = await redis.exec([['SET', key, value, 'NX', 'EX', NICK_TTL]]);
    if (set === 'OK') {
      await redis.exec(own);
      return 'claimed';
    }
    // ktoś zarezerwował nick między odczytem a zapisem: jeszcze raz od odczytu
  }
  return 'taken';
}

/** Żywe nicki tego klucza w postaci do wyświetlania (alfabetycznie). Wpisy nicków wygasłych albo przejętych znikają ze zbioru. */
export async function ownedNicks(redis: RedisExec, owner: string, now: number): Promise<string[]> {
  const nickKeys = asStrings(await run(redis, ['SMEMBERS', KEYS.ownerNicks(owner)])).filter((k): k is string => k !== null);
  const records = await nickRecords(redis, nickKeys);
  const stale = nickKeys.filter((_, i) => statusOf(records[i] ?? null, owner, now) !== 'mine');
  if (stale.length > 0) await run(redis, ['SREM', KEYS.ownerNicks(owner), ...stale]);
  return records.filter((r): r is NickRecord => r !== null && statusOf(r, owner, now) === 'mine').map((r) => r.nick).sort((x, y) => x.localeCompare(y, 'pl'));
}

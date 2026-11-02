import { isRec } from '../sim/guards.js';
import { FAME_CASH, FAME_DAY, FAME_LIST_MAX, FAME_SIM } from './config.js';
import { fail, type Checked } from './errors.js';
import { KEYS } from './keys.js';
import { asNumber, asScored, asString, asStrings, RedisError, run, type RedisExec } from './redis.js';
import { isShowableSeed, parseKeyAndNick } from './runs.js';

/**
 * Galeria sław (spec 4b §5.7): publiczna lista graczy, którzy pierwszy raz doszli do miliona gotówki firmy w zwykłej grze. Wpis
 * wysyła gra (nick, seed, dzień, gotówka, `SIM_VERSION`), a serwer niczego nie odtwarza: to świadoma decyzja
 * właściciela gry (spec 4b §7, ryzyka), więc wpis jest do sfałszowania, a granicą są sprawdzenia wiarygodności, limit zgłoszeń
 * i dzienny budżet wpisów.
 *
 * Układ w bazie (klucze w `keys.ts`): wpis `tr:fame:e:{nickKey}` powstaje raz (`SET NX`) i nigdy się nie zmienia, a zbiór sortowany
 * `tr:fame:list` ma za członka klucz nicka i za wynik chwilę serwera (ms) pierwszego wpisu, więc lista idzie od najwcześniejszego
 * (`ZRANGE`). Galeria nie ma sezonów i nie zna `SIM_VERSION` w kluczach, więc reset rankingu jej nie rusza.
 */

/** Wpis w bazie. `at` to chwila serwera (ms) pierwszego wpisu tego nicka; reszta pochodzi z gry. */
export interface FameEntry { nick: string; seed: string; day: number; cash: number; simVersion: number; at: number }

/** Zgłoszenie po sprawdzeniu: klucz w postaci kanonicznej, nick po `normalizeNick`, jego klucz porównań i pola wpisu. */
export interface FameSubmission { key: string; nick: string; nickKey: string; seed: string; day: number; cash: number; simVersion: number }

/** Wiersz listy: miejsce (od 1, w kolejności zapisu), nick do wyświetlania i chwila wpisu. Bez seeda i gotówki. */
export interface FameRow { place: number; nick: string; at: number }

const inRange = (v: unknown, [min, max]: readonly [number, number]): v is number => typeof v === 'number' && v >= min && v <= max;
const isWhole = (v: unknown, range: readonly [number, number]): v is number => inRange(v, range) && Number.isInteger(v);
const isFiniteIn = (v: unknown, range: readonly [number, number]): v is number => inRange(v, range) && Number.isFinite(v);

/**
 * Ciało `POST /api/fame/submit` (`{ key, nick, seed, day, cash, simVersion }`) bez zaufania → zgłoszenie albo błąd. Kolejność: kształt
 * ciała, klucz (`bad-key`), nick (`bad-nick`, reguły gry), potem wiarygodność (`fame-invalid`, 422): `seed` to tekst o 1–48 punktach
 * kodowych bez znaków niewidocznych (`isShowableSeed`), `day` liczba całkowita z `FAME_DAY`, `cash` skończona liczba z `FAME_CASH`,
 * `simVersion` liczba całkowita z `FAME_SIM`. Brak pola albo inny typ to też `fame-invalid` (nick i klucz mają własne kody). Pola
 * spoza kontraktu odpadają.
 */
export function parseFameSubmission(body: unknown): Checked<FameSubmission> {
  if (!isRec(body)) return fail('bad-request');
  const who = parseKeyAndNick(body.key, body.nick);
  if (!who.ok) return who;
  const { seed, day, cash, simVersion } = body;
  if (typeof seed !== 'string' || !isShowableSeed(seed) || !isWhole(day, FAME_DAY) || !isFiniteIn(cash, FAME_CASH) || !isWhole(simVersion, FAME_SIM)) {
    return fail('fame-invalid');
  }
  return { ok: true, value: { ...who.value, seed, day, cash, simVersion } };
}

/** Wpis z bazy (bez zaufania): uszkodzony albo niepełny to null. */
export function parseFameEntry(raw: string | null): FameEntry | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isRec(v) && typeof v.nick === 'string' && typeof v.seed === 'string'
      && Number.isFinite(v.day) && Number.isFinite(v.cash) && Number.isFinite(v.simVersion) && Number.isFinite(v.at)
      ? { nick: v.nick, seed: v.seed, day: v.day as number, cash: v.cash as number, simVersion: v.simVersion as number, at: v.at as number }
      : null;
  } catch {
    return null;
  }
}

/**
 * Wpisuje nick do Galerii. `SET NX` zapisuje wpis tylko wtedy, gdy tego nicka jeszcze w Galerii nie ma (`first: true`). Gdy już był,
 * wpis zostaje bez zmian (inny klucz gracza, inna kwota, nowsza chwila nic nie zmieniają), a `entry` to wpis z bazy (`first: false`).
 * Na końcu `ZADD NX` z chwilą `at` tego wpisu: przy pierwszym wpisie dopisuje go do listy, przy kolejnym naprawia listę, gdy
 * pierwsze zgłoszenie zdążyło zapisać wpis, a do listy nie dotarło (NX nie rusza wyniku, który już jest). W tym samym zapytaniu
 * `ZRANK` oddaje miejsce wpisu na liście: `place` = pozycja + 1, to samo liczenie co w `readFame`, więc zgodne z listą także
 * poza pierwszą setką; przy `first: false` to miejsce istniejącego wpisu tego nicka. Zapis i odczyt idą jednym zapytaniem
 * (`SET NX`, `GET`), a lista drugim, bo jej wynik zależy od tego, co zwróciła baza. Uszkodzony wpis w bazie to błąd bazy
 * (500): serwer niczego nie nadpisuje, a uszkodzenia sam nie wytwarza. Wpis, który zniknął między poleceniami, dostaje drugą próbę.
 */
export async function recordFame(redis: RedisExec, nickKey: string, e: FameEntry): Promise<{ first: boolean; entry: FameEntry; place: number }> {
  const key = KEYS.fameEntry(nickKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    const [set, current] = await redis.exec([['SET', key, JSON.stringify(e), 'NX'], ['GET', key]]);
    const first = set === 'OK';
    const stored = asString(current);
    const entry = first ? e : parseFameEntry(stored);
    if (entry === null) {
      if (stored === null) continue;
      throw new RedisError('Fame: wpis w bazie jest nieczytelny');
    }
    const [, rank] = await redis.exec([['ZADD', KEYS.fameList, 'NX', entry.at, nickKey], ['ZRANK', KEYS.fameList, nickKey]]);
    const index = asNumber(rank);
    if (index === null) throw new RedisError('Fame: wpisu nie ma na liście po zapisie');
    return { first, entry, place: index + 1 };
  }
  throw new RedisError('Fame: wpis zniknął z bazy podczas zapisu');
}

/**
 * Pierwsze `FAME_LIST_MAX` wpisów od najwcześniejszego (miejsca 1, 2, 3…; chwile serwera mogą się powtórzyć, wtedy miejsca idą po
 * kluczu nicka, a nie remisują) i liczba wszystkich wpisów. Dwa zapytania: zakres z liczbą, potem dane wpisów. Wpis bez danych
 * (nie powinien się zdarzyć) pokazuje klucz nicka, jak ranking.
 */
export async function readFame(redis: RedisExec): Promise<{ total: number; rows: FameRow[] }> {
  const [range, card] = await redis.exec([['ZRANGE', KEYS.fameList, 0, FAME_LIST_MAX - 1, 'WITHSCORES'], ['ZCARD', KEYS.fameList]]);
  const total = asNumber(card) ?? 0;
  const scored = asScored(range);
  if (scored.length === 0) return { total, rows: [] };
  const entries = asStrings(await run(redis, ['MGET', ...scored.map((s) => KEYS.fameEntry(s.member))])).map(parseFameEntry);
  return { total, rows: scored.map((s, i) => ({ place: i + 1, nick: entries[i]?.nick ?? s.member, at: s.score })) };
}

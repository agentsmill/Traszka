import { isRec } from '../sim/guards.js';
import { BOARD_KEEP, BOARD_LIMIT_MAX, SEED_BOARD_TTL, WEEK_BOARD_TTL } from './config.js';
import { KEYS, memberOf, parseMember, seedIdOf } from './keys.js';
import { asNumber, asScored, asString, asStrings, run, type RedisCommand, type RedisExec } from './redis.js';

/**
 * Rankingi w zbiorach sortowanych Upstash (spec §14.7): globalny ze wszystkich seedów, osobny dla każdego seeda i „seed tygodnia”.
 * W każdym rankingu gracz (nick z właścicielem) ma jedno miejsce z najlepszym wynikiem (ZADD GT). Wpis pamięta swój nick do
 * wyświetlania (`tr:entry:…`), więc wyniki zostają w rankingu także wtedy, gdy rezerwacja nicka wygaśnie (decyzja właściciela gry,
 * 2026-10-28), a gdy ten sam nick zarezerwuje potem ktoś inny, jego wyniki są osobnymi wpisami (członek zawiera tag właściciela).
 */

/** Przyjęty wynik do wpisania: kto (skrót klucza, nick do wyświetlania i jego klucz), na jakim seedzie, czy to bieg tygodnia. */
export interface ScoreEntry {
  owner: string; nick: string; nickKey: string; seed: string;
  /** Tydzień (`2026-W44`), gdy bieg grano na seedzie tygodnia w tym tygodniu, inaczej null. */
  weekId: string | null;
  score: number; now: number;
}

export interface Ranks { global: number | null; seed: number | null; week: number | null }
/** Wynik wpisu: czy pobił rekord gracza w globalnym, rekord gracza po wpisie i miejsca (null: poza rankingiem albo nie dotyczy). */
export interface RecordResult { improved: boolean; best: number; ranks: Ranks }

export interface BoardRow {
  rank: number; nick: string; score: number;
  /** Tylko w globalnym: seed najlepszego biegu i chwila jego zgłoszenia (ms); null i brak `at`, gdy wpis nie ma tych danych. */
  seed?: string | null; at?: number;
}

export type BoardRef = { board: 'global' } | { board: 'seed'; seed: string } | { board: 'week'; weekId: string };
export type BoardQuery = BoardRef & { limit: number };

/** Dane wpisu: nick do wyświetlania (ostatnia postać, w jakiej gracz go zgłosił) oraz seed i chwila najlepszego biegu w globalnym. */
interface EntryInfo { nick: string; seed: string; at: number }

function parseEntry(raw: string | null): EntryInfo | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isRec(v) && typeof v.nick === 'string' && typeof v.seed === 'string' && Number.isFinite(v.at)
      ? { nick: v.nick, seed: v.seed, at: v.at as number } : null;
  } catch {
    return null;
  }
}

/** Klucz zbioru sortowanego dla rankingu. */
export async function boardKey(ref: BoardRef): Promise<string> {
  return ref.board === 'global' ? KEYS.global : ref.board === 'seed' ? KEYS.seed(await seedIdOf(ref.seed)) : KEYS.week(ref.weekId);
}

/** Polecenia wpisu do jednego rankingu: najlepszy wynik, przycięcie do `BOARD_KEEP` miejsc, czas życia i odczyt wyniku po wpisie. */
const upsert = (key: string, member: string, score: number, ttl: number | null): RedisCommand[] => [
  ['ZADD', key, 'GT', 'CH', score, member],
  ['ZREMRANGEBYRANK', key, 0, -(BOARD_KEEP + 1)],
  ...(ttl === null ? [] : [['EXPIRE', key, ttl] as const]),
  ['ZSCORE', key, member],
];

/** Miejsce w rankingu przy danym wyniku: 1 + liczba lepszych wyników (remis to to samo miejsce). */
const rankCommand = (key: string, score: number): RedisCommand => ['ZCOUNT', key, `(${score}`, '+inf'];

/**
 * Wpisuje przyjęty (odtworzony przez serwer) wynik do rankingów: globalnego, seeda i tygodnia (gdy podano tydzień). Wpis zapamiętuje
 * nick w postaci z tego zgłoszenia, a przy nowym rekordzie globalnym także seed i chwilę biegu. Dwa zapytania do bazy.
 */
export async function recordScore(redis: RedisExec, e: ScoreEntry): Promise<RecordResult> {
  const member = memberOf(e.owner, e.nickKey);
  const boards: { name: keyof Ranks; key: string; ttl: number | null }[] = [
    { name: 'global', key: KEYS.global, ttl: null },
    { name: 'seed', key: KEYS.seed(await seedIdOf(e.seed)), ttl: SEED_BOARD_TTL },
  ];
  if (e.weekId !== null) boards.push({ name: 'week', key: KEYS.week(e.weekId), ttl: WEEK_BOARD_TTL });

  const perBoard = boards.map((b) => upsert(b.key, member, e.score, b.ttl));
  const [entryRaw, ...results] = await redis.exec([['GET', KEYS.entry(member)], ...perBoard.flat()]);
  const improved = results[0] === 1;
  // ZSCORE jest ostatnim poleceniem każdego rankingu: wynik gracza po wpisie (null, gdy wypadł poza BOARD_KEEP miejsc)
  let end = 0;
  const after = perBoard.map((cmds) => asNumber(results[(end += cmds.length) - 1]));

  const prev = parseEntry(asString(entryRaw));
  const entry: EntryInfo = improved || prev === null ? { nick: e.nick, seed: e.seed, at: e.now } : { ...prev, nick: e.nick };
  const followUp: RedisCommand[] = after.flatMap((score, i) => (score === null ? [] : [rankCommand(boards[i]!.key, score)]));
  followUp.push(['SET', KEYS.entry(member), JSON.stringify(entry)]);
  const counts = await redis.exec(followUp);

  const ranks: Ranks = { global: null, seed: null, week: null };
  let k = 0;
  after.forEach((score, i) => {
    if (score !== null) ranks[boards[i]!.name] = (asNumber(counts[k++]) ?? 0) + 1;
  });
  return { improved, best: after[0] ?? e.score, ranks };
}

/** Miejsce i wynik członka w rankingu albo null (nie ma go tam). */
export async function rankOf(redis: RedisExec, key: string, member: string): Promise<{ rank: number; score: number } | null> {
  const score = asNumber(await run(redis, ['ZSCORE', key, member]));
  if (score === null) return null;
  return { rank: (asNumber(await run(redis, rankCommand(key, score))) ?? 0) + 1, score };
}

/**
 * Pierwsze `limit` wierszy rankingu z nickami w postaci do wyświetlania (dwa polecenia: zakres i dane wpisów). Miejsca jak w sporcie:
 * remis to to samo miejsce, następne o tyle dalej (1, 2, 2, 4). Wpis bez danych (nie powinien się zdarzyć) pokazuje klucz nicka.
 */
export async function readBoard(redis: RedisExec, q: BoardQuery): Promise<BoardRow[]> {
  const limit = Math.max(1, Math.min(BOARD_LIMIT_MAX, Math.floor(q.limit)));
  const scored = asScored(await run(redis, ['ZREVRANGE', await boardKey(q), 0, limit - 1, 'WITHSCORES']));
  if (scored.length === 0) return [];
  const entries = asStrings(await run(redis, ['MGET', ...scored.map((s) => KEYS.entry(s.member))])).map(parseEntry);
  return scored.map((s, i) => {
    const entry = entries[i] ?? null;
    const rank = scored.findIndex((x) => x.score === s.score) + 1;
    const row: BoardRow = { rank, nick: entry?.nick ?? parseMember(s.member).nickKey, score: s.score };
    return q.board === 'global' ? { ...row, seed: entry?.seed ?? null, ...(entry ? { at: entry.at } : {}) } : row;
  });
}

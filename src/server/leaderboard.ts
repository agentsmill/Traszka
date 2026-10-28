import { isRec } from '../sim/guards.js';
import { BEST_TTL, BOARD_KEEP, BOARD_LIMIT_MAX, SEED_BOARD_TTL, WEEK_BOARD_TTL } from './config.js';
import { KEYS, memberOf, parseMember, seedIdOf, tagOf } from './keys.js';
import { isLive, parseNickRecord } from './nicks.js';
import { asNumber, asScored, asStrings, run, type RedisCommand, type RedisExec } from './redis.js';

/**
 * Rankingi w zbiorach sortowanych Upstash (spec §14.7): globalny ze wszystkich seedów, osobny dla każdego seeda i „seed tygodnia”.
 * W każdym rankingu gracz (nick z właścicielem) ma jedno miejsce z najlepszym wynikiem (ZADD GT). Wiersz pokazuje się tylko wtedy,
 * gdy nick wciąż należy do tego, kto zdobył wynik (`tag` w członku), więc wygasły albo przejęty nick nie ciągnie cudzych wyników.
 */

/** Przyjęty wynik do wpisania: kto (skrót klucza i nick), na jakim seedzie, czy seed wolno pokazać, czy to bieg tygodnia. */
export interface ScoreEntry {
  owner: string; nickKey: string; seed: string;
  /** false, gdy seed ma zakazane słowo: wynik idzie do globalnego bez seeda, a rankingu seeda nie zakładamy. */
  seedVisible: boolean;
  /** Tydzień (`2026-W44`), gdy bieg grano na seedzie tygodnia w tym tygodniu, inaczej null. */
  weekId: string | null;
  score: number; now: number;
}

export interface Ranks { global: number | null; seed: number | null; week: number | null }
/** Wynik wpisu: czy pobił rekord gracza w globalnym, rekord gracza po wpisie i miejsca (null: poza rankingiem albo nie dotyczy). */
export interface RecordResult { improved: boolean; best: number; ranks: Ranks }

export interface BoardRow {
  rank: number; nick: string; score: number;
  /** Tylko w globalnym: seed najlepszego biegu (null, gdy ocenzurowany) i chwila jego zgłoszenia (ms). */
  seed?: string | null; at?: number;
}

export type BoardRef = { board: 'global' } | { board: 'seed'; seed: string } | { board: 'week'; weekId: string };
export type BoardQuery = BoardRef & { limit: number; now: number };

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
 * Wpisuje przyjęty (odtworzony przez serwer) wynik do rankingów: globalnego, seeda (gdy seed wolno pokazać) i tygodnia (gdy
 * podano tydzień). Rekord globalny zapamiętuje seed i chwilę biegu. Dwa zapytania do bazy (wpisy, potem miejsca), trzy przy rekordzie.
 */
export async function recordScore(redis: RedisExec, e: ScoreEntry): Promise<RecordResult> {
  const member = memberOf(e.owner, e.nickKey);
  const boards: { name: keyof Ranks; key: string; ttl: number | null }[] = [{ name: 'global', key: KEYS.global, ttl: null }];
  if (e.seedVisible) boards.push({ name: 'seed', key: KEYS.seed(await seedIdOf(e.seed)), ttl: SEED_BOARD_TTL });
  if (e.weekId !== null) boards.push({ name: 'week', key: KEYS.week(e.weekId), ttl: WEEK_BOARD_TTL });

  const perBoard = boards.map((b) => upsert(b.key, member, e.score, b.ttl));
  const results = await redis.exec(perBoard.flat());
  const improved = results[0] === 1;
  // ZSCORE jest ostatnim poleceniem każdego rankingu: wynik gracza po wpisie (null, gdy wypadł poza BOARD_KEEP miejsc)
  let end = 0;
  const after = perBoard.map((cmds) => asNumber(results[(end += cmds.length) - 1]));

  const followUp: RedisCommand[] = after.flatMap((score, i) => (score === null ? [] : [rankCommand(boards[i]!.key, score)]));
  if (improved) followUp.push(['SET', KEYS.best(member), JSON.stringify({ seed: e.seedVisible ? e.seed : null, at: e.now }), 'EX', BEST_TTL]);
  else followUp.push(['EXPIRE', KEYS.best(member), BEST_TTL]);
  const counts = await redis.exec(followUp);

  const ranks: Ranks = { global: null, seed: null, week: null };
  let k = 0;
  after.forEach((score, i) => {
    if (score !== null) ranks[boards[i]!.name] = (asNumber(counts[k++]) ?? 0) + 1;
  });
  return { improved, best: after[0] ?? e.score, ranks };
}

/** Miejsce i wynik członka w rankingu albo null (nie ma go tam). Miejsce liczy też wpisy, których ranking już nie pokazuje. */
export async function rankOf(redis: RedisExec, key: string, member: string): Promise<{ rank: number; score: number } | null> {
  const score = asNumber(await run(redis, ['ZSCORE', key, member]));
  if (score === null) return null;
  return { rank: (asNumber(await run(redis, rankCommand(key, score))) ?? 0) + 1, score };
}

/** Ile razy dociągamy kolejną paczkę wierszy, gdy u góry są wpisy nicków wygasłych albo przejętych. */
const MAX_ROUNDS = 4;

function parseBest(raw: string | null): { seed: string | null; at: number } | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isRec(v) && (typeof v.seed === 'string' || v.seed === null) && Number.isFinite(v.at) ? { seed: v.seed as string | null, at: v.at as number } : null;
  } catch {
    return null;
  }
}

/**
 * Pierwsze `limit` wierszy rankingu, z nickami w postaci do wyświetlania. Wpisy, których nick wygasł albo należy już do kogoś
 * innego, pomija (i dociąga kolejne). Miejsca jak w sporcie: remis to to samo miejsce, następne o tyle dalej (1, 2, 2, 4).
 */
export async function readBoard(redis: RedisExec, q: BoardQuery): Promise<BoardRow[]> {
  const key = await boardKey(q);
  const limit = Math.max(1, Math.min(BOARD_LIMIT_MAX, Math.floor(q.limit)));
  const chunk = limit * 2;
  const rows: Omit<BoardRow, 'rank'>[] = [];
  for (let round = 0, offset = 0; round < MAX_ROUNDS && rows.length < limit; round++, offset += chunk) {
    const scored = asScored(await run(redis, ['ZREVRANGE', key, offset, offset + chunk - 1, 'WITHSCORES']));
    if (scored.length === 0) break;
    const members = scored.map((s) => parseMember(s.member));
    const commands: RedisCommand[] = [['MGET', ...members.map((m) => KEYS.nick(m.nickKey))]];
    if (q.board === 'global') commands.push(['MGET', ...scored.map((s) => KEYS.best(s.member))]);
    const [recordsRaw, bestRaw] = await redis.exec(commands);
    const records = asStrings(recordsRaw).map(parseNickRecord);
    const bests = asStrings(bestRaw);
    scored.forEach((s, i) => {
      const rec = records[i];
      if (!rec || !isLive(rec, q.now) || tagOf(rec.owner) !== members[i]!.tag) return;
      if (q.board !== 'global') {
        rows.push({ nick: rec.nick, score: s.score });
        return;
      }
      const best = parseBest(bests[i] ?? null);
      rows.push({ nick: rec.nick, score: s.score, seed: best?.seed ?? null, ...(best ? { at: best.at } : {}) });
    });
    if (scored.length < chunk) break;
  }
  return rows.slice(0, limit).map((r, i, all) => {
    const first = all.findIndex((x) => x.score === r.score);
    return { rank: first + 1, ...r };
  });
}

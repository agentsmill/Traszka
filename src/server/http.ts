import { nickKey as keyOfNick, normalizeNick } from '../game/nick.js';
import { parseRecoveryCode } from '../game/playerKey.js';
import { isRec } from '../sim/guards.js';
import {
  BOARD_CACHE, BOARD_LIMIT_DEFAULT, BOARD_LIMIT_MAX, RUN_MAX_BODY_BYTES, SAVE_BODY_BYTES, SMALL_BODY_BYTES, type RateAction,
} from './config.js';
import { API_ERRORS, fail, type ApiErrorCode, type ApiFailure, type Checked } from './errors.js';
import type { RandomBytes } from './hash.js';
import { KEYS, memberOf, ownerOf, seedIdOf } from './keys.js';
import { rankOf, readBoard, recordScore, type BoardRef } from './leaderboard.js';
import { claimNick, nickStatus, ownedNicks } from './nicks.js';
import { checkRate } from './rateLimit.js';
import type { RedisExec } from './redis.js';
import { isShowableSeed, parseSubmission } from './runs.js';
import { checkSave, getSave, putSave } from './saves.js';
import type { VerifyRun } from './verify.js';
import { isWeekSeed, weekOf } from './week.js';

/**
 * Obsługa żądań API rankingu na standardowych `Request` i `Response` (bez frameworka): pliki w `api/` tylko podpinają te funkcje
 * pod Vercela (`env.ts`), a testy wołają je wprost z atrapą bazy i sędziego. Każda odpowiedź to JSON: `{ ok: true, … }` albo
 * `{ ok: false, error, message }` z kodem z `errors.ts` i komunikatem dla gracza.
 */
export interface ServerDeps {
  /** Baza z prawem zapisu (zgłoszenia, rezerwacje, limity). */
  redis: RedisExec;
  /** Baza do czytania rankingu (token tylko do odczytu, gdy jest; inaczej ta sama co `redis`). */
  readRedis: RedisExec;
  verifyRun: VerifyRun;
  now: () => number;
  random?: RandomBytes;
}
export type Handler = (request: Request, deps: ServerDeps) => Promise<Response>;

const NO_STORE = { 'cache-control': 'no-store' };

export function json(body: unknown, status = 200, headers: Record<string, string> = NO_STORE): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

export function apiError(code: ApiErrorCode, message?: string, headers: Record<string, string> = {}): Response {
  return json({ ok: false, error: code, message: message ?? API_ERRORS[code].message }, API_ERRORS[code].status, { ...NO_STORE, ...headers });
}

const failure = (f: ApiFailure): Response => apiError(f.error, f.message);

const wrongMethod = (request: Request, allowed: string): Response | null =>
  (request.method === allowed ? null : apiError('method', undefined, { allow: allowed }));

/** Ciało żądania jako JSON, najwyżej `maxBytes` bajtów (nagłówek długości sprawdzany od razu, treść po odczycie). */
async function readJson(request: Request, maxBytes: number): Promise<Checked<unknown>> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return fail('too-large');
  let text: string;
  try {
    text = await request.text();
  } catch {
    return fail('bad-request');
  }
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) return fail('too-large');
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return fail('bad-request');
  }
}

/** Adres klienta z nagłówków Vercela (pierwszy na liście). Trafia do bazy tylko jako skrót z solą okna limitu. */
export function clientAddress(request: Request): string {
  const first = (name: string): string | null => request.headers.get(name)?.split(',')[0]?.trim() || null;
  return first('x-real-ip') ?? first('x-vercel-forwarded-for') ?? first('x-forwarded-for') ?? 'nieznany';
}

/** Limit zgłoszeń: null, gdy wolno, albo gotowa odpowiedź 429 z `Retry-After`. */
async function limited(request: Request, deps: ServerDeps, action: RateAction, owner: string | null): Promise<Response | null> {
  const r = await checkRate(deps.redis, action, { owner, address: clientAddress(request) }, deps.now(), deps.random);
  return r.ok ? null : apiError('rate-limited', undefined, { 'retry-after': String(r.retryAfter) });
}

/** Klucz gracza z ciała żądania → skrót właściciela. Brak pola to zły formularz, nieczytelny kod to `bad-key`. */
async function ownerFrom(body: unknown): Promise<Checked<{ body: Record<string, unknown>; owner: string }>> {
  if (!isRec(body) || body.key === undefined) return fail('bad-request');
  const key = parseRecoveryCode(body.key);
  if (key === null) return fail('bad-key');
  return { ok: true, value: { body, owner: await ownerOf(key) } };
}

function boardLimit(raw: string | null): number {
  const n = raw === null ? NaN : Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(BOARD_LIMIT_MAX, Math.max(1, n)) : BOARD_LIMIT_DEFAULT;
}

/** Seed z parametru albo z ciała, który wolno pokazać w rankingu (inaczej null). */
const showableSeed = (seed: unknown): string | null => (typeof seed === 'string' && isShowableSeed(seed) ? seed : null);

/**
 * `GET /api/leaderboard?board=global|seed|week&seed=…&limit=…`: wiersze rankingu (miejsce, nick, wynik; w globalnym też seed
 * i data) i bieżący seed tygodnia. Publiczne i jednakowe dla wszystkich, więc odpowiedź leży chwilę w pamięci podręcznej Vercela.
 */
export const handleLeaderboard: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'GET');
  if (bad) return bad;
  const url = new URL(request.url);
  const board = url.searchParams.get('board') ?? 'global';
  const now = deps.now();
  const week = weekOf(now);
  let ref: BoardRef;
  if (board === 'global') ref = { board };
  else if (board === 'week') ref = { board, weekId: week.id };
  else if (board === 'seed') {
    const seed = showableSeed(url.searchParams.get('seed'));
    if (seed === null) return apiError('bad-seed');
    ref = { board, seed };
  } else return apiError('bad-board');
  const rows = await readBoard(deps.readRedis, { ...ref, limit: boardLimit(url.searchParams.get('limit')) });
  const seed = ref.board === 'seed' ? { seed: ref.seed } : ref.board === 'week' ? { seed: week.seed } : {};
  return json({ ok: true, board, ...seed, week: { id: week.id, seed: week.seed, endsAt: week.endsAt }, rows }, 200, { 'cache-control': BOARD_CACHE });
};

/**
 * `POST /api/runs` z `{ key, nick, run }`: sprawdza zgłoszenie i limit, odrzuca cudzy nick, zanim sędzia odtworzy bieg, a wynik
 * policzony przez sędziego wpisuje do rankingów (globalnego, seeda i, dla seeda tygodnia, tygodnia) i rezerwuje nick.
 */
export const handleRuns: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'POST');
  if (bad) return bad;
  const body = await readJson(request, RUN_MAX_BODY_BYTES);
  if (!body.ok) return failure(body);
  const sub = parseSubmission(body.value);
  if (!sub.ok) return failure(sub);
  const { nick, nickKey, run } = sub.value;
  const owner = await ownerOf(sub.value.key);
  const limit = await limited(request, deps, 'runs', owner);
  if (limit) return limit;
  if (await nickStatus(deps.redis, nickKey, owner, deps.now()) === 'taken') return apiError('nick-taken');

  const verdict = await deps.verifyRun(run);
  if (!verdict.ok) return apiError(verdict.reason);

  const now = deps.now();
  if (await claimNick(deps.redis, nick, nickKey, owner, now) === 'taken') return apiError('nick-taken');
  const week = weekOf(now);
  const result = await recordScore(deps.redis, {
    owner, nick, nickKey, seed: run.seed, weekId: isWeekSeed(run.seed, week) ? week.id : null,
    score: verdict.score, now,
  });
  return json({ ok: true, nick, score: verdict.score, best: result.best, improved: result.improved, ranks: result.ranks });
};

/**
 * `POST /api/player` z `{ key, nick?, seed? }`: nicki tego klucza (np. po wpisaniu kodu na nowym urządzeniu), status wpisanego
 * nicka (`free`, `mine`, `taken`, `invalid`), a gdy nick jest mój, moje miejsca w globalnym, w rankingu seeda i tygodnia.
 */
export const handlePlayer: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'POST');
  if (bad) return bad;
  const body = await readJson(request, SMALL_BODY_BYTES);
  if (!body.ok) return failure(body);
  const who = await ownerFrom(body.value);
  if (!who.ok) return failure(who);
  const { owner } = who.value;
  const raw = who.value.body.nick;
  if (raw !== undefined && typeof raw !== 'string') return apiError('bad-request');
  const limit = await limited(request, deps, 'player', owner);
  if (limit) return limit;

  const now = deps.now();
  const nicks = await ownedNicks(deps.redis, owner, now);
  if (raw === undefined) return json({ ok: true, nicks });
  const n = normalizeNick(raw);
  if ('error' in n) return json({ ok: true, nicks, nick: { nick: raw, status: 'invalid', message: n.error } });
  const nickKey = keyOfNick(n.nick);
  const status = await nickStatus(deps.redis, nickKey, owner, now);
  if (status === 'taken') return json({ ok: true, nicks, nick: { nick: n.nick, status, message: API_ERRORS['nick-taken'].message } });
  if (status === 'free') return json({ ok: true, nicks, nick: { nick: n.nick, status } });

  const member = memberOf(owner, nickKey);
  const seed = showableSeed(who.value.body.seed);
  const [global, seedRank, week] = await Promise.all([
    rankOf(deps.redis, KEYS.global, member),
    seed === null ? null : seedIdOf(seed).then((id) => rankOf(deps.redis, KEYS.seed(id), member)),
    rankOf(deps.redis, KEYS.week(weekOf(now).id), member),
  ]);
  return json({ ok: true, nicks, nick: { nick: n.nick, status }, ranks: { global, seed: seedRank, week } });
};

/** `POST /api/save/upload` z `{ key, save }`: kładzie zapis gry (tekst JSON do 64 KB) do jedynej szuflady tego klucza. */
export const handleSaveUpload: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'POST');
  if (bad) return bad;
  const body = await readJson(request, SAVE_BODY_BYTES);
  if (!body.ok) return failure(body.error === 'too-large' ? fail('save-too-large') : body);
  const who = await ownerFrom(body.value);
  if (!who.ok) return failure(who);
  const save = checkSave(who.value.body.save);
  if (!save.ok) return failure(save);
  const limit = await limited(request, deps, 'saveUp', who.value.owner);
  if (limit) return limit;
  return json({ ok: true, ...(await putSave(deps.redis, who.value.owner, save.value, deps.now())) });
};

/** `POST /api/save/download` z `{ key }`: oddaje zapis z szuflady tego klucza (klucz w ciele, nigdy w adresie) albo 404. */
export const handleSaveDownload: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'POST');
  if (bad) return bad;
  const body = await readJson(request, SMALL_BODY_BYTES);
  if (!body.ok) return failure(body);
  const who = await ownerFrom(body.value);
  if (!who.ok) return failure(who);
  const limit = await limited(request, deps, 'saveDown', who.value.owner);
  if (limit) return limit;
  const save = await getSave(deps.redis, who.value.owner);
  return save === null ? apiError('no-save') : json({ ok: true, ...save });
};

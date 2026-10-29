import { nickKey as keyOfNick, normalizeNick } from '../game/nick.js';
import { parseRecoveryCode } from '../game/playerKey.js';
import { isRec } from '../sim/guards.js';
import {
  BOARD_CACHE, BOARD_LIMIT_DEFAULT, BOARD_LIMITS, RUN_MAX_BODY_BYTES, SAVE_BODY_BYTES, SAVE_DAILY_BUDGET, SMALL_BODY_BYTES, type RateAction,
} from './config.js';
import { API_ERRORS, fail, type ApiErrorCode, type ApiFailure, type Checked } from './errors.js';
import type { RandomBytes } from './hash.js';
import { KEYS, memberOf, ownerOf, seedIdOf } from './keys.js';
import { rankOf, readBoard, recordScore, type BoardRef } from './leaderboard.js';
import { claimNick, nickStatus, ownedNicks } from './nicks.js';
import { checkBudget, checkRate, type RateCheck, type RateGate } from './rateLimit.js';
import type { RedisExec } from './redis.js';
import { isShowableSeed, parseSubmission } from './runs.js';
import { checkSave, getSave, putSave, savedAtOf } from './saves.js';
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
  /**
   * Bramka limitu w pamięci instancji (`createRateGate`): odmawia bez pytania bazy temu, komu baza i tak by odmówiła. `route`
   * tworzy ją raz na instancję funkcji (nie na żądanie), bo jej pamięć ma przeżyć wiele żądań. Bez niej (testy handlerów)
   * każde żądanie idzie do bazy jak dotąd.
   */
  rateGate?: RateGate;
  /**
   * Sekret `RANKING_SALT` (co najmniej 16 znaków), z którego limit liczy HMAC skrótu adresu zamiast czytać sól okna z bazy (jedno
   * zapytanie zamiast dwóch). Sprawdza go `env.ts` (krótszy to 503 `not-configured`). Tylko do limitu: nigdy do odpowiedzi,
   * logów ani bazy. Bez niego (testy handlerów) sól okna leży w bazie jak dotąd.
   */
  rateSecret?: string;
}
export type Handler = (request: Request, deps: ServerDeps) => Promise<Response>;

const NO_STORE = { 'cache-control': 'no-store' };

export function json(body: unknown, status = 200, headers: Record<string, string> = NO_STORE): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

/** Odpowiedź błędu: `{ ok: false, error, message }`, a `extra` dokłada pola do ciała (np. `savedAt` przy `save-conflict`). */
export function apiError(code: ApiErrorCode, message?: string, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: code, message: message ?? API_ERRORS[code].message, ...extra }, API_ERRORS[code].status, { ...NO_STORE, ...headers });
}

const failure = (f: ApiFailure): Response => apiError(f.error, f.message);

const wrongMethod = (request: Request, allowed: string): Response | null =>
  (request.method === allowed ? null : apiError('method', undefined, { allow: allowed }));

/**
 * Ciało żądania jako JSON, najwyżej `maxBytes` bajtów. Nagłówek długości większy od limitu odrzuca od razu, bez czytania. Nagłówka
 * nie bierze za pewnik (może być mniejszy niż ciało albo go nie ma), więc ciało i tak czyta się strumieniem kawałek po kawałku
 * i liczy w bajtach: gdy suma przekroczy limit, strumień jest przerywany (`cancel`) i wraca `too-large`, więc ciało większe od
 * limitu nie jest czytane ani składane w całości. Pusty strumień i brak ciała to `bad-request`, tak jak JSON, który się nie parsuje.
 * Dekoder nie jest rygorystyczny: niepoprawny UTF-8 daje znaki zastępcze (\u{FFFD}), a nie wyjątek. Jeden dekoder na całe ciało
 * (`stream: true`) skleja znak wielobajtowy przecięty granicą kawałków.
 */
async function readJson(request: Request, maxBytes: number): Promise<Checked<unknown>> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return fail('too-large');
  if (request.body === null) return fail('bad-request');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let drained = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) return fail('too-large');
      text += decoder.decode(value, { stream: true });
    }
    drained = true;
    text += decoder.decode();
  } catch {
    return fail('bad-request');
  } finally {
    if (!drained) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return fail('bad-request');
  }
}

/** Adres klienta z nagłówków Vercela (pierwszy na liście). Trafia do bazy tylko jako skrót (z solą okna w bazie albo HMAC z `RANKING_SALT`), a do pamięci instancji jako skrót z solą bramki. */
export function clientAddress(request: Request): string {
  const first = (name: string): string | null => request.headers.get(name)?.split(',')[0]?.trim() || null;
  return first('x-real-ip') ?? first('x-vercel-forwarded-for') ?? first('x-forwarded-for') ?? 'nieznany';
}

/**
 * Limit zgłoszeń jednego żądania; adres czytany z nagłówków raz. Oba sprawdzenia zwracają null, gdy wolno, albo gotową odpowiedź
 * 429 z `Retry-After`.
 * - `early()`: wczesna kontrola przed odczytem ciała, tylko po adresie i tylko w pamięci instancji (bramka), więc odmowa nie kosztuje
 *   ani odczytu ciała, ani zapytania do bazy. Niczego nie liczy. Odrzuca wyłącznie adres, który w tym oknie ma już komplet
 *   żądań w bazie, więc wszystko, co od niego przyszłoby poprawne, baza i tak by odrzuciła; niepoprawne żądanie z takiego adresu
 *   dostaje 429 zamiast 400/413. Bez bramki zawsze null.
 * - `limited(owner)`: właściwy limit na adres i klucz gracza (bramka, potem baza). Licznik rośnie tylko tu, czyli dla żądań,
 *   które doszły do tego miejsca, tak samo jak licznik w bazie.
 */
interface RateLimiter {
  early(): Promise<Response | null>;
  limited(owner: string | null): Promise<Response | null>;
}

function rateLimiter(request: Request, deps: ServerDeps, action: RateAction): RateLimiter {
  const address = clientAddress(request);
  const tooMany = (r: RateCheck): Response => apiError('rate-limited', undefined, { 'retry-after': String(r.retryAfter) });
  return {
    async early() {
      const r = await deps.rateGate?.peek(action, { owner: null, address }, deps.now());
      return r ? tooMany(r) : null;
    },
    async limited(owner) {
      const r = await checkRate(deps.redis, action, { owner, address }, deps.now(), { random: deps.random, gate: deps.rateGate, secret: deps.rateSecret });
      return r.ok ? null : tooMany(r);
    },
  };
}

/** Klucz gracza z ciała żądania → skrót właściciela. Brak pola to zły formularz, nieczytelny kod to `bad-key`. */
async function ownerFrom(body: unknown): Promise<Checked<{ body: Record<string, unknown>; key: string; owner: string }>> {
  if (!isRec(body) || body.key === undefined) return fail('bad-request');
  const key = parseRecoveryCode(body.key);
  if (key === null) return fail('bad-key');
  return { ok: true, value: { body, key, owner: await ownerOf(key) } };
}

/** `limit` z zapytania: bez niego domyślne 20, inaczej dokładnie 10, 20, 50 albo 100 (zapis „010” czy „1e1” już nie), a reszta to null. */
function boardLimit(raw: string | null): number | null {
  return raw === null ? BOARD_LIMIT_DEFAULT : BOARD_LIMITS.find((l) => String(l) === raw) ?? null;
}

/** Parametry zapytania, jakie zna każdy ranking. `seed` ma sens tylko przy rankingu seeda (przy innych byłby kluczem pamięci podręcznej z niczego). */
const BOARD_PARAMS = new Map<string, readonly string[]>([
  ['global', ['board', 'limit']],
  ['week', ['board', 'limit']],
  ['seed', ['board', 'seed', 'limit']],
]);

/** Seed z parametru albo z ciała, który wolno pokazać w rankingu (inaczej null). */
const showableSeed = (seed: unknown): string | null => (typeof seed === 'string' && isShowableSeed(seed) ? seed : null);

/**
 * `GET /api/leaderboard?board=global|seed|week&seed=…&limit=…`: wiersze rankingu (miejsce, nick, wynik; w globalnym też seed
 * i data) i bieżący seed tygodnia. Publiczne i jednakowe dla wszystkich, więc odpowiedź leży chwilę w pamięci podręcznej Vercela.
 * Ta pamięć kluczuje adresem z zapytaniem, więc każdy nowy adres to osobny wpis i osobny odczyt z bazy. Dlatego nieznany albo
 * powtórzony parametr to 400 `bad-request`, `seed` jest tylko przy rankingu seeda, a `limit` to jedna z czterech wartości
 * (inna: 400). Odrzucenie nie sięga do bazy. Zostają warianty zapisu tego samego zapytania (kolejność, kodowanie procentowe,
 * puste segmenty `&&`), które domyka dopiero reguła w Vercel Firewall.
 */
export const handleLeaderboard: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'GET');
  if (bad) return bad;
  const url = new URL(request.url);
  const board = url.searchParams.get('board') ?? 'global';
  const allowed = BOARD_PARAMS.get(board);
  if (allowed === undefined) return apiError('bad-board');
  const names = [...url.searchParams.keys()];
  if (names.some((name) => !allowed.includes(name)) || new Set(names).size !== names.length) return apiError('bad-request');
  const limit = boardLimit(url.searchParams.get('limit'));
  if (limit === null) return apiError('bad-request');
  const now = deps.now();
  const week = weekOf(now);
  let ref: BoardRef;
  if (board === 'global') ref = { board };
  else if (board === 'week') ref = { board, weekId: week.id };
  else {
    const seed = showableSeed(url.searchParams.get('seed'));
    if (seed === null) return apiError('bad-seed');
    ref = { board: 'seed', seed };
  }
  const rows = await readBoard(deps.readRedis, { ...ref, limit });
  const seed = ref.board === 'seed' ? { seed: ref.seed } : ref.board === 'week' ? { seed: week.seed } : {};
  return json({ ok: true, board, ...seed, week: { id: week.id, seed: week.seed, endsAt: week.endsAt }, rows }, 200, { 'cache-control': BOARD_CACHE });
};

/**
 * `POST /api/runs` z `{ key, nick, run }`: sprawdza zgłoszenie i limit, odrzuca cudzy nick, zanim sędzia odtworzy bieg, a wynik
 * policzony przez sędziego wpisuje do rankingów (globalnego, seeda i, dla seeda tygodnia, tygodnia) i rezerwuje nick. Odmowa sędziego
 * (`old-version`: bieg z innej wersji symulacji, `replay-failed`, `season-bankrupt`: bieg zakończony bankructwem przed końcem
 * sezonu, `replay-unavailable`) wraca do gracza pod własnym kodem i statusem z `errors.ts`, a do bazy nie trafia nic: ani nick,
 * ani wynik.
 */
export const handleRuns: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'POST');
  if (bad) return bad;
  const rate = rateLimiter(request, deps, 'runs');
  const early = await rate.early();
  if (early) return early;
  const body = await readJson(request, RUN_MAX_BODY_BYTES);
  if (!body.ok) return failure(body);
  const sub = parseSubmission(body.value);
  if (!sub.ok) return failure(sub);
  const { nick, nickKey, run } = sub.value;
  const owner = await ownerOf(sub.value.key);
  const limit = await rate.limited(owner);
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
  const rate = rateLimiter(request, deps, 'player');
  const early = await rate.early();
  if (early) return early;
  const body = await readJson(request, SMALL_BODY_BYTES);
  if (!body.ok) return failure(body);
  const who = await ownerFrom(body.value);
  if (!who.ok) return failure(who);
  const { owner } = who.value;
  const raw = who.value.body.nick;
  if (raw !== undefined && typeof raw !== 'string') return apiError('bad-request');
  const limit = await rate.limited(owner);
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

/**
 * Warunek wysłania zapisu z ciała żądania: `expected` to brak pola, `null` (jeszcze żadnej kopii nie widziało) albo chwila kopii
 * (liczba całkowita nieujemna, bezpieczna w JSON-ie), `force` brak pola albo wartość logiczna. Cokolwiek innego to `bad-request`.
 */
function uploadCondition(body: Record<string, unknown>): Checked<{ expected: number | null; force: boolean }> {
  const { expected = null, force = false } = body;   // domyślne wartości tylko dla braku pola (undefined); null w `force` odpada niżej
  if (typeof force !== 'boolean') return fail('bad-request');
  if (expected !== null && !(typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= 0)) return fail('bad-request');
  return { ok: true, value: { expected, force } };
}

/**
 * `POST /api/save/upload` z `{ key, save, expected?, force? }`: kładzie paczkę zapisu z gry (tekst JSON do 64 KB, kształt
 * `TransferBundle`) do jedynej szuflady tego klucza na 30 dni. Zapis z samym kluczem gracza w środku odpada (gra wysyła paczkę bez
 * klucza), bo serwer kluczy nie przechowuje.
 *
 * Wysłanie jest warunkowe: `expected` to chwila kopii, którą to urządzenie ostatnio wysłało albo pobrało (brak pola i `null`: jeszcze
 * żadnej nie widziało). Gdy na serwerze leży kopia o innej chwili, a nie ma `force: true`, odpowiedź to 409 `save-conflict` z
 * `savedAt` tej kopii, bez zapisu i bez zużycia budżetu, żeby urządzenie nie nadpisało po cichu nowszej kopii z innego urządzenia.
 * Kontrola i zapis to dwa osobne zapytania (bez transakcji), więc dwa wysłania w tej samej chwili mogą się minąć; chroni to przed
 * pomyłką człowieka między urządzeniami, a nie przed wyścigiem w milisekundach.
 *
 * Kolejność kontroli: kształt ciała (`expected`, `force`, zapis), limit na klucz i adres, konflikt, na końcu globalny budżet dzienny
 * (429 do północy UTC): bez niego kto zmienia klucze i adresy, wypełniłby bazę, a limity na klucz i adres go nie zatrzymają. Budżet
 * idzie po limicie na adres, żeby jeden adres nie wypalił go w całości, i po konflikcie, bo odrzucone wysłanie niczego nie zajmuje.
 */
export const handleSaveUpload: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'POST');
  if (bad) return bad;
  const rate = rateLimiter(request, deps, 'saveUp');
  const early = await rate.early();
  if (early) return early;
  const body = await readJson(request, SAVE_BODY_BYTES);
  if (!body.ok) return failure(body.error === 'too-large' ? fail('save-too-large') : body);
  const who = await ownerFrom(body.value);
  if (!who.ok) return failure(who);
  const condition = uploadCondition(who.value.body);
  if (!condition.ok) return failure(condition);
  const save = checkSave(who.value.body.save);
  if (!save.ok) return failure(save);
  if (save.value.toUpperCase().replace(/-/g, '').includes(who.value.key)) return apiError('bad-save');
  const limit = await rate.limited(who.value.owner);
  if (limit) return limit;
  if (!condition.value.force) {
    const onServer = await savedAtOf(deps.redis, who.value.owner);
    if (onServer !== null && onServer !== condition.value.expected) return apiError('save-conflict', undefined, {}, { savedAt: onServer });
  }
  const now = deps.now();
  const budget = await checkBudget(deps.redis, 'save', SAVE_DAILY_BUDGET, now);
  if (!budget.ok) return apiError('save-budget', undefined, { 'retry-after': String(budget.retryAfter) });
  return json({ ok: true, ...(await putSave(deps.redis, who.value.owner, save.value, now)) });
};

/** `POST /api/save/download` z `{ key }`: oddaje zapis z szuflady tego klucza (klucz w ciele, nigdy w adresie) albo 404. */
export const handleSaveDownload: Handler = async (request, deps) => {
  const bad = wrongMethod(request, 'POST');
  if (bad) return bad;
  const rate = rateLimiter(request, deps, 'saveDown');
  const early = await rate.early();
  if (early) return early;
  const body = await readJson(request, SMALL_BODY_BYTES);
  if (!body.ok) return failure(body);
  const who = await ownerFrom(body.value);
  if (!who.ok) return failure(who);
  const limit = await rate.limited(who.value.owner);
  if (limit) return limit;
  const save = await getSave(deps.redis, who.value.owner);
  return save === null ? apiError('no-save') : json({ ok: true, ...save });
};

// Próba rankingu na prawdziwej bazie: po jednym wywołaniu każdego endpointu API, w kolejności, która ćwiczy polecenia Redisa bez
// pokrycia w testach na atrapie (rezerwacja nicka SET NX, ZADD GT CH, ZCOUNT, ZREVRANGE WITHSCORES, SET NX PX + INCR + PEXPIRE
// w limicie, MGET, SMEMBERS, SADD). Testy jednostkowe chodzą po `MemoryRedis`, który zna te polecenia z naszych założeń; dopiero
// ta próba sprawdza, czy prawdziwy Upstash rozumie je tak samo (kształty wyników, opcje GT i CH, czasy życia).
//
// Uruchamiana RĘCZNIE, na osobnej bazie testowej Upstash i jej wdrożeniu (podgląd z RANKING_ENABLED=1) albo na lokalnym serwerze:
//
//   node scripts/ranking-smoke.mjs <adres> [--write] [--sim-version <n>]
//
// Zabezpieczenia (obowiązkowe):
//  - bez `--write` skrypt tylko opisuje plan i kończy kodem 0, niczego nie wysyłając;
//  - odmawia (kod 2) dla traszka.vercel.app i każdej jej subdomeny, także z `--write`: próba zapisuje w bazie rezerwację nicka,
//    wynik w rankingach i zapis gry, a w produkcji tego nie chcemy. Host liczy się ze sparsowanego adresu, nie z tekstu;
//  - nick, seed i klucz gracza są losowane przy każdym uruchomieniu (`crypto.randomBytes`), w kodzie nie ma żadnych sekretów;
//  - `simVersion` biegu bierze z `src/sim/simVersion.ts` (czyta plik tekstem), `--sim-version` ją nadpisuje;
//  - nie zapisuje nic na dysku, a klucza gracza nie wypisuje (tylko ostatnie 4 znaki; reszta jest maskowana także w komunikatach serwera).
//
// Czysty ESM, tylko wbudowane moduły Node i globalny `fetch`: skrypt nie importuje niczego z gry (nie ma tu TypeScripta ani aliasu `@/`).
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIM_VERSION_FILE = resolve(HERE, '..', 'src', 'sim', 'simVersion.ts');
const GENERATOR_FILE = resolve(HERE, '..', 'src', 'sim', 'store', 'generateStore.ts');

/** Hosty produkcji: te i ich subdomeny są zablokowane bez względu na flagi. */
export const PROTECTED_HOSTS = ['traszka.vercel.app'];

/** Ile najwyżej czeka się na jedną odpowiedź (ms): sędzia odtwarza trzy miesiące gry, a zimny start funkcji bywa wolny. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Wersja gry wysyłana z biegiem (informacyjna: o przyjęciu decyduje `simVersion`). */
const GAME_VERSION = 'ranking-smoke';

/** Alfabet base32 Crockforda i długość klucza gracza: kopia z `src/game/playerKey.ts` (test pilnuje równości). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LENGTH = 20;

/** Błąd kroku: powód porażki do pokazania człowiekowi (bez klucza gracza). */
class StepError extends Error {}
const check = (condition, message) => {
  if (!condition) throw new StepError(message);
};

// ——— adres, wersje, identyfikatory ———

/**
 * Adres bazowy → `{ ok: true, origin }` albo `{ ok: false, error }`. Host bierze ze sparsowanego `URL` (wielkość liter, kropka na
 * końcu, port, `użytkownik@host`, zapis procentowy i pełnoszerokie litery rozstrzyga parser), a produkcję rozpoznaje po całych
 * etykietach (`nie-traszka.vercel.app` to nie ona). Komunikat nigdy nie powtarza adresu z wejścia, bo ten może nieść hasło.
 */
export function checkTarget(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl));
  } catch {
    return { ok: false, error: 'Odmowa: to nie jest adres. Podaj pełny adres wdrożenia, np. https://podglad-rankingu.vercel.app albo http://localhost:3000.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Odmowa: adres musi zaczynać się od http:// albo https://.' };
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  const protectedHost = PROTECTED_HOSTS.find((p) => host === p || host.endsWith(`.${p}`));
  if (protectedHost !== undefined) {
    return { ok: false, error: `Odmowa: ${host} to produkcja (${protectedHost}). Próba zapisuje w bazie nick, wynik i zapis gry, więc wolno ją puścić tylko na osobnej bazie testowej.` };
  }
  return { ok: true, origin: url.origin };
}

/** Liczba z `export const NAZWA = 7;` w pliku TypeScript (czyta tekst, niczego nie wykonuje). */
function numberFrom(text, name, file) {
  const match = new RegExp(`^export const ${name}\\s*(?::\\s*number\\s*)?=\\s*(\\d+)\\s*;`, 'm').exec(text);
  if (match === null) throw new Error(`W pliku ${file} nie znaleziono „export const ${name} = <liczba>;”.`);
  return Number(match[1]);
}
/** Wersja wyniku symulacji, jaką wysyła gra (`SIM_VERSION` z `src/sim/simVersion.ts`). */
export const readSimVersion = (file = SIM_VERSION_FILE) => numberFrom(readFileSync(file, 'utf8'), 'SIM_VERSION', file);
/** Wersja generatora sklepu (`GENERATOR_VERSION` z `src/sim/store/generateStore.ts`). */
export const readGeneratorVersion = (file = GENERATOR_FILE) => numberFrom(readFileSync(file, 'utf8'), 'GENERATOR_VERSION', file);

const defaultRandom = (n) => randomBytes(n);

/** Kod odzyskiwania z 20 losowych bajtów: z każdego dolne 5 bitów (jak `generatePlayerKey`), pięć grup po cztery znaki. */
function recoveryCode(random) {
  const chars = Array.from(random(KEY_LENGTH), (b) => CROCKFORD[b & 31]).join('');
  return chars.match(/.{4}/g).join('-');
}

/**
 * Dane próby, nowe przy każdym uruchomieniu: klucz gracza (format kodu odzyskiwania), drugi klucz (inny gracz, który będzie
 * próbował zająć cudzy nick), nick `Smoke` + 6 cyfr i seed `smoke-` + 8 znaków szesnastkowych. Losowość tylko z `random`.
 */
export function newIdentity(random = defaultRandom) {
  const key = recoveryCode(random);
  const otherKey = recoveryCode(random);
  const nick = `Smoke${Array.from(random(6), (b) => b % 10).join('')}`;
  const seed = `smoke-${Buffer.from(random(4)).toString('hex')}`;
  return { key, otherKey, nick, seed };
}

/** Maskowanie kluczy w każdej linii wyjścia (także w komunikatach serwera, który mógłby odesłać ciało żądania): zostają ostatnie 4 znaki. */
function redactor(keys) {
  const variants = keys.flatMap((key) => {
    const compact = key.replaceAll('-', '');
    return [key, compact].map((v) => ({ pattern: new RegExp(v, 'gi'), mask: `…${compact.slice(-4)}` }));
  });
  return (text) => variants.reduce((out, { pattern, mask }) => out.replace(pattern, mask), String(text));
}

// ——— dziennik biegu B i paczka zapisu ———

const at = (day, hour) => day * 1440 + hour * 60;
/**
 * Kilka poleceń rozłożonych na pierwsze dni sezonu (kształt wpisów jak w `RunRecord.log`: minuta, numer, polecenie). Wynik z nimi
 * różni się od biegu pustego (sprawdza to krok biegu B), więc próba widzi, że sędzia naprawdę odtwarza dziennik. Gdyby polecenia
 * w grze zmieniły nazwy, symulacja je odrzuci, wynik się zrówna z pustym i krok B zgłosi, że ten dziennik trzeba odświeżyć.
 */
export const SMOKE_LOG = [
  [at(0, 6), { type: 'setOrder', auto: true }],
  [at(1, 12), { type: 'buyUpgrade', id: 'szkolenie' }],
  [at(2, 9), { type: 'hire' }],
].map(([minute, cmd], seq) => ({ minute, seq, cmd }));

/** Paczka zapisu w kształcie z gry (`traszka-przeniesienie`, wersja 1); polskie litery sprawdzają drogę UTF-8 przez bazę. Bez klucza gracza. */
const saveBundle = (t) => JSON.stringify({
  format: 'traszka-przeniesienie', version: 1, seed: t.seed,
  meta: { version: 1, partnerPoints: 0 }, save: { schema: 2, probe: t.nick, note: 'próba rankingu: zażółć gęślą jaźń' },
});

// ——— żądania i sprawdzanie odpowiedzi ———

const isRec = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v) => {
  const text = v === undefined ? 'brak' : JSON.stringify(v);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
};

/** Równość strukturalna (kolejność pól w obiektach nie ma znaczenia). */
function isDeepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => isDeepEqual(v, b[i]));
  if (isRec(a) && isRec(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && isDeepEqual(a[k], b[k]));
  }
  return false;
}
const same = (actual, expected, what) => check(isDeepEqual(actual, expected), `${what}: oczekiwano ${show(expected)}, jest ${show(actual)}`);
const isRank = (v) => Number.isInteger(v) && v >= 1;

/** Jedno żądanie: odpowiedź jako `{ status, json, text, headers }` (json to null, gdy treść nie jest JSON-em). Przekierowanie to błąd. */
async function call(t, method, path, body) {
  let res;
  let text;
  try {
    res = await t.fetch(new URL(path, t.origin).href, {
      method,
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',   // klucz gracza jedzie w ciele: nie za przekierowaniem pod inny adres
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    const why = err instanceof Error ? `${err.name}: ${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ''}` : 'nieznany błąd';
    throw new StepError(`brak odpowiedzi od serwera (${method} ${path.split('?')[0]}): ${why}`);
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* treść nie jest JSON-em: zostaje null */ }
  return { status: res.status, json, text, headers: res.headers };
}

/** Odpowiedź w jednej linii do komunikatu: status, kod i komunikat błędu albo początek treści, która nie jest JSON-em. */
function summary(res) {
  if (isRec(res.json)) return `status ${res.status}, ok=${show(res.json.ok)}${res.json.error !== undefined ? `, error=${show(res.json.error)}, message=${show(res.json.message)}` : ''}`;
  const guard = res.status === 401 || res.status === 403
    ? ' (wdrożenia podglądu bywają za ochroną Vercela, Deployment Protection: użyj lokalnego `vercel dev` albo wdrożenia bez ochrony)' : '';
  return `status ${res.status}, treść nie jest obiektem JSON: ${show(res.text.slice(0, 120))}${guard}`;
}
const expectOk = (res, status = 200) => {
  check(res.status === status && isRec(res.json) && res.json.ok === true, `oczekiwano statusu ${status} i ok=true, jest ${summary(res)}`);
  return res.json;
};
const expectError = (res, status, code) => {
  check(res.status === status && isRec(res.json) && res.json.ok === false && res.json.error === code,
    `oczekiwano statusu ${status} i błędu ${show(code)}, jest ${summary(res)}`);
  return res.json;
};

/** Sprawdza część `week` odpowiedzi rankingu (id tygodnia ISO, seed tygodnia, koniec tygodnia) i oddaje ją. */
function checkWeek(week) {
  check(isRec(week) && typeof week.id === 'string' && /^\d{4}-W\d{2}$/.test(week.id) && typeof week.seed === 'string' && week.seed !== ''
    && Number.isFinite(week.endsAt) && week.endsAt > 0, `pole week ma zły kształt: ${show(week)}`);
  return week;
}

/**
 * Wiersze rankingu: kształt, malejące wyniki i miejsca jak w sporcie (remis to to samo miejsce, następne o tyle dalej: 1, 2, 2, 4).
 * Ranking globalny podaje też seed najlepszego biegu i chwilę jego zgłoszenia.
 */
function checkRows(rows, board, limit) {
  check(Array.isArray(rows), `rows nie jest tablicą: ${show(rows)}`);
  check(rows.length <= limit, `rows ma ${rows.length} wierszy, a limit to ${limit}`);
  rows.forEach((row, i) => {
    check(isRec(row) && isRank(row.rank) && typeof row.nick === 'string' && row.nick !== '' && Number.isFinite(row.score),
      `wiersz ${i + 1} ma zły kształt: ${show(row)}`);
    check(i === 0 || row.score <= rows[i - 1].score, `wyniki nie maleją od wiersza ${i} do ${i + 1}: ${row.score} po ${rows[i - 1]?.score}`);
    check(row.rank === rows.findIndex((r) => r.score === row.score) + 1, `wiersz ${i + 1} ma miejsce ${row.rank}, a przy wyniku ${row.score} powinno być ${rows.findIndex((r) => r.score === row.score) + 1}`);
    if (board === 'global') check((row.seed === null || typeof row.seed === 'string') && (row.at === undefined || Number.isFinite(row.at)), `wiersz ${i + 1} rankingu globalnego ma zły seed lub datę: ${show(row)}`);
  });
}

const boardPath = (board, seed, limit) => `/api/leaderboard?${new URLSearchParams({ board, ...(seed === undefined ? {} : { seed }), limit: String(limit) })}`;
/** Czy odpowiedź mogła przyjść z pamięci podręcznej Vercela (ranking leży w niej do 30 s + 30 s), a nie od funkcji. */
const cached = (res) => /^(HIT|STALE)/i.test(res.headers.get('x-vercel-cache') ?? '');

/**
 * Odczyt rankingu z kontrolą kształtu. Pamięć podręczna Vercela kluczuje adresem z zapytaniem, więc ten sam adres odczytany dwa razy
 * w minucie dałby stare wiersze: każdy odczyt idzie innym `limit` (jedna z czterech dozwolonych wartości), a gdy `sees` nie widzi
 * oczekiwanego wiersza i odpowiedź wygląda na z pamięci podręcznej, próbuje kolejnego `limit` z listy (np. poprzedni przebieg
 * sprzed chwili zapamiętał ten adres).
 */
async function readBoard(t, board, { seed, limits, sees = () => true }) {
  let out;
  for (const limit of limits) {
    const res = await t.get(boardPath(board, seed, limit));
    const body = expectOk(res);
    same(body.board, board, 'board');
    const week = checkWeek(body.week);
    if (board === 'seed') same(body.seed, seed, 'seed');
    if (board === 'week') same(body.seed, week.seed, 'seed tygodnia');
    checkRows(body.rows, board, limit);
    out = { rows: body.rows, week, limit };
    if (sees(body.rows, limit) || !cached(res)) break;
  }
  return out;
}

/** Zgłoszenie biegu (`POST /api/runs`) ze sprawdzeniem wspólnych pól odpowiedzi; oddaje ciało odpowiedzi. */
async function submit(t, { seed, log, key = t.key }) {
  const res = await t.post('/api/runs', { key, nick: t.nick, run: { seed, gameVersion: GAME_VERSION, generatorVersion: t.generatorVersion, simVersion: t.simVersion, mode: 'ranked', log } });
  const body = expectOk(res);
  same(body.nick, t.nick, 'nick w odpowiedzi');
  check(Number.isFinite(body.score), `score nie jest liczbą: ${show(body.score)}`);
  check(typeof body.improved === 'boolean', `improved nie jest wartością logiczną: ${show(body.improved)}`);
  check(isRec(body.ranks) && ['global', 'seed', 'week'].every((k) => body.ranks[k] === null || isRank(body.ranks[k])), `ranks ma zły kształt: ${show(body.ranks)}`);
  return body;
}

/** Miejsce gracza w jednym rankingu z `POST /api/player` (`{ rank, score }`) albo null. */
function checkPlace(place, what) {
  check(isRec(place) && isRank(place.rank) && Number.isFinite(place.score), `${what}: oczekiwano { rank, score }, jest ${show(place)}`);
  return place;
}

// ——— kroki próby ———

/**
 * Kroki w kolejności wykonania. `run(t)` rzuca `StepError` z powodem porażki; stan między krokami leży w `t` (m.in. wyniki biegów).
 * Nazwa kroku mówi, które polecenia Redisa ćwiczy, żeby przy porażce było wiadomo, na co patrzeć w bazie.
 */
export const STEPS = [
  {
    id: 'seed-pusty',
    name: 'ranking nowego seeda jest pusty (ZREVRANGE na nieistniejącym kluczu)',
    async run(t) {
      const { rows, week } = await readBoard(t, 'seed', { seed: t.seed, limits: [10] });
      same(rows, [], 'rows');
      t.week = week;
    },
  },
  {
    id: 'global-odczyt',
    name: 'ranking globalny: odczyt i kształt wierszy (ZREVRANGE WITHSCORES, MGET)',
    async run(t) {
      await readBoard(t, 'global', { limits: [10] });
    },
  },
  {
    id: 'tydzien-odczyt',
    name: 'ranking tygodnia: odczyt i seed tygodnia',
    async run(t) {
      const { week } = await readBoard(t, 'week', { limits: [10] });
      same(week.id, t.week.id, 'id tygodnia');
      same(week.seed, t.week.seed, 'seed tygodnia');
    },
  },
  {
    id: 'gracz-nowy',
    name: 'nowy klucz nie ma jeszcze nicków (SMEMBERS; limit: INCR + PEXPIRE, bez RANKING_SALT też SET NX PX soli okna)',
    async run(t) {
      const body = expectOk(await t.post('/api/player', { key: t.key }));
      same(body.nicks, [], 'nicks');
      check(!('nick' in body), `odpowiedź bez nicka w pytaniu ma pole nick: ${show(body.nick)}`);
    },
  },
  {
    id: 'nick-wolny',
    name: 'wylosowany nick jest wolny (GET rezerwacji)',
    async run(t) {
      const body = expectOk(await t.post('/api/player', { key: t.key, nick: t.nick }));
      same(body.nick, { nick: t.nick, status: 'free' }, 'nick');
      same(body.nicks, [], 'nicks');
    },
  },
  {
    id: 'bieg-a',
    name: 'bieg A bez poleceń: sędzia liczy wynik, nick zarezerwowany, wpis w rankingach (SET NX, ZADD GT CH, ZCOUNT)',
    async run(t) {
      const body = await submit(t, { seed: t.seed, log: [] });
      t.a = body.score;
      t.best = body.score;
      same(body.best, body.score, 'best (pierwszy wynik jest najlepszym)');
      same(body.improved, true, 'improved');
      check(isRank(body.ranks.global), `miejsce w rankingu globalnym: ${show(body.ranks.global)}`);
      same(body.ranks.seed, 1, 'miejsce w rankingu nowego seeda');
      same(body.ranks.week, null, 'miejsce w rankingu tygodnia (to nie seed tygodnia)');
    },
  },
  {
    id: 'seed-po-biegu-a',
    name: 'ranking seeda pokazuje wynik biegu A (ZREVRANGE WITHSCORES, MGET wpisu)',
    async run(t) {
      const { rows } = await readBoard(t, 'seed', { seed: t.seed, limits: [20] });
      same(rows, [{ rank: 1, nick: t.nick, score: t.a }], 'rows');
    },
  },
  {
    id: 'bieg-b',
    name: 'bieg B z kilkoma poleceniami: inny wynik, najlepszy zostaje lepszym z dwóch (ZADD GT)',
    async run(t) {
      const body = await submit(t, { seed: t.seed, log: SMOKE_LOG });
      t.b = body.score;
      check(t.b !== t.a, `bieg z poleceniami ma ten sam wynik (${t.b}) co pusty: sędzia nie odtwarza dziennika albo polecenia w SMOKE_LOG są nieaktualne`);
      t.best = Math.max(t.a, t.b);
      same(body.best, t.best, 'best');
      same(body.improved, t.b > t.a, 'improved');
      same(body.ranks.seed, 1, 'miejsce w rankingu seeda');
    },
  },
  {
    id: 'bieg-gorszy',
    name: 'ponowny gorszy bieg nie psuje najlepszego wyniku (ZADD GT nie obniża)',
    async run(t) {
      const worse = t.a <= t.b ? { log: [], score: t.a } : { log: SMOKE_LOG, score: t.b };
      const body = await submit(t, { seed: t.seed, log: worse.log });
      same(body.score, worse.score, 'wynik ponowionego biegu (odtwarzanie jest deterministyczne)');
      same(body.best, t.best, 'best po gorszym biegu');
      same(body.improved, false, 'improved');
      same(body.ranks.seed, 1, 'miejsce w rankingu seeda');
    },
  },
  {
    id: 'nick-cudzy-gracz',
    name: 'inny klucz widzi ten nick jako zajęty (rezerwacja z SET NX)',
    async run(t) {
      const body = expectOk(await t.post('/api/player', { key: t.otherKey, nick: t.nick }));
      same(body.nick?.nick, t.nick, 'nick');
      same(body.nick?.status, 'taken', 'status nicka');
      check(typeof body.nick?.message === 'string' && body.nick.message !== '', `brak komunikatu o zajętym nicku: ${show(body.nick)}`);
      same(body.nicks, [], 'nicki obcego klucza');
    },
  },
  {
    id: 'nick-cudzy-bieg',
    name: 'inny klucz nie zgłosi biegu pod cudzym nickiem (409 nick-taken, nic się nie zapisuje)',
    async run(t) {
      expectError(await t.post('/api/runs', {
        key: t.otherKey, nick: t.nick,
        run: { seed: t.seed, gameVersion: GAME_VERSION, generatorVersion: t.generatorVersion, simVersion: t.simVersion, mode: 'ranked', log: [] },
      }), 409, 'nick-taken');
    },
  },
  {
    id: 'seed-po-gorszym',
    name: 'ranking seeda nadal ma jeden wiersz z najlepszym wynikiem',
    async run(t) {
      const { rows } = await readBoard(t, 'seed', { seed: t.seed, limits: [50] });
      same(rows, [{ rank: 1, nick: t.nick, score: t.best }], 'rows');
    },
  },
  {
    id: 'gracz-moj',
    name: 'mój nick: lista nicków i miejsca w rankingach (SMEMBERS, MGET, ZSCORE, ZCOUNT)',
    async run(t) {
      const body = expectOk(await t.post('/api/player', { key: t.key, nick: t.nick, seed: t.seed }));
      same(body.nicks, [t.nick], 'nicks');
      same(body.nick, { nick: t.nick, status: 'mine' }, 'nick');
      check(isRec(body.ranks), `ranks ma zły kształt: ${show(body.ranks)}`);
      same(checkPlace(body.ranks.global, 'miejsce globalne').score, t.best, 'wynik w rankingu globalnym');
      same(body.ranks.seed, { rank: 1, score: t.best }, 'miejsce w rankingu seeda');
      same(body.ranks.week, null, 'miejsce w rankingu tygodnia (jeszcze bez biegu tygodnia)');
    },
  },
  {
    id: 'bieg-tygodnia',
    name: 'bieg na seedzie tygodnia trafia do rankingu tygodnia (ZADD GT CH + EXPIRE)',
    async run(t) {
      const body = await submit(t, { seed: t.week.seed, log: [] });
      t.w = body.score;
      same(body.best, Math.max(t.best, t.w), 'best (rekord globalny to lepszy z wyników)');
      same(body.improved, t.w > t.best, 'improved');
      t.bestSeed = t.w > t.best ? t.week.seed : t.seed;
      t.best = Math.max(t.best, t.w);
      for (const board of ['global', 'seed', 'week']) check(isRank(body.ranks[board]), `miejsce w rankingu ${board}: ${show(body.ranks[board])}`);
      t.weekRank = body.ranks.week;
      t.globalRank = body.ranks.global;
    },
  },
  {
    id: 'tydzien-po-biegu',
    name: 'ranking tygodnia pokazuje wynik biegu tygodnia',
    async run(t) {
      const { rows, limit, week } = await readBoard(t, 'week', { limits: [100, 50, 20], sees: (r) => r.some((x) => x.nick === t.nick && x.score === t.w) });
      same(week.id, t.week.id, 'id tygodnia');
      const mine = rows.find((r) => r.nick === t.nick);
      if (mine !== undefined) same(mine.score, t.w, 'wynik w rankingu tygodnia');
      else check(rows.length === limit && t.weekRank > limit, `w rankingu tygodnia nie ma wiersza ${t.nick} (miejsce ${t.weekRank}, wierszy ${rows.length} z ${limit})`);
    },
  },
  {
    id: 'global-po-biegach',
    name: 'ranking globalny pokazuje najlepszy wynik z seedem tego biegu',
    async run(t) {
      const { rows, limit } = await readBoard(t, 'global', { limits: [100, 50, 20], sees: (r) => r.some((x) => x.nick === t.nick && x.score === t.best) });
      const mine = rows.find((r) => r.nick === t.nick);
      if (mine !== undefined) {
        same(mine.score, t.best, 'najlepszy wynik w rankingu globalnym');
        same(mine.seed, t.bestSeed, 'seed najlepszego biegu');
        check(Number.isFinite(mine.at), `brak chwili zgłoszenia najlepszego biegu: ${show(mine)}`);
      } else {
        check(rows.length === limit && t.globalRank > limit, `w rankingu globalnym nie ma wiersza ${t.nick} (miejsce ${t.globalRank}, wierszy ${rows.length} z ${limit})`);
      }
    },
  },
  {
    id: 'gracz-po-tygodniu',
    name: 'mój nick po wszystkich biegach: miejsca w trzech rankingach (ZSCORE, ZCOUNT)',
    async run(t) {
      const body = expectOk(await t.post('/api/player', { key: t.key, nick: t.nick, seed: t.week.seed }));
      same(body.nicks, [t.nick], 'nicks');
      same(body.nick, { nick: t.nick, status: 'mine' }, 'nick');
      check(isRec(body.ranks), `ranks ma zły kształt: ${show(body.ranks)}`);
      same(checkPlace(body.ranks.global, 'miejsce globalne').score, t.best, 'wynik w rankingu globalnym');
      same(checkPlace(body.ranks.week, 'miejsce w tygodniu').score, t.w, 'wynik w rankingu tygodnia');
      same(checkPlace(body.ranks.seed, 'miejsce na seedzie tygodnia').score, t.w, 'wynik w rankingu seeda tygodnia');
    },
  },
  {
    id: 'zapis-wyslij',
    name: 'wysłanie zapisu gry (SET EX; budżet dzienny: SET NX EX + INCR)',
    async run(t) {
      t.save = saveBundle(t);
      const body = expectOk(await t.post('/api/save/upload', { key: t.key, save: t.save }));
      same(body.bytes, Buffer.byteLength(t.save, 'utf8'), 'bytes');
      check(Number.isSafeInteger(body.savedAt) && body.savedAt > 0, `savedAt nie jest chwilą: ${show(body.savedAt)}`);
      t.savedAt = body.savedAt;
    },
  },
  {
    id: 'zapis-pobierz',
    name: 'pobranie zapisu oddaje dokładnie to, co wysłano (GET)',
    async run(t) {
      const body = expectOk(await t.post('/api/save/download', { key: t.key }));
      check(body.save === t.save, `pobrany zapis różni się od wysłanego (${typeof body.save === 'string' ? body.save.length : show(body.save)} znaków wobec ${t.save.length})`);
      same(body.savedAt, t.savedAt, 'savedAt');
    },
  },
  {
    id: 'zapis-cudzy',
    name: 'inny klucz nie dostaje cudzego zapisu (404 no-save)',
    async run(t) {
      expectError(await t.post('/api/save/download', { key: t.otherKey }), 404, 'no-save');
    },
  },
];

// ——— przebieg ———

/** Plan próby do wypisania bez `--write`. */
function planLines(origin, simVersion) {
  return [
    `Próba rankingu na ${origin} (symulacja v${simVersion}).`,
    'Bez --write nic nie jest wysyłane: to tylko plan.',
    '',
    `Plan (${STEPS.length} kroków, po jednym wywołaniu każdego endpointu, w tej kolejności):`,
    ...STEPS.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s.name}`),
    '',
    'Próba zapisze w bazie wskazanego wdrożenia: rezerwację nicka „Smoke…”, wyniki w rankingach (globalnym, seeda próby i seeda tygodnia)',
    'i zapis gry (żyje 30 dni). Nic na dysku. Nick, seed i klucz gracza losują się przy każdym uruchomieniu; klucza skrypt nie wypisuje',
    '(tylko ostatnie 4 znaki). Zgłoszeń biegu jest 5, a limit biegów liczy się na adres w oknie godzinnym (RATE_LIMITS.runs w src/server/config.ts,',
    'obecnie 30), więc nie puszczaj próby w kółko.',
    'Puszczaj wyłącznie na osobnej bazie testowej. Produkcja (traszka.vercel.app) jest zablokowana.',
    'Żeby wykonać: node scripts/ranking-smoke.mjs <adres> --write',
  ];
}

/**
 * Cała próba. Bez `write` tylko wypisuje plan. Zwraca `{ ok, steps }` (`steps`: wykonane kroki do pierwszego błędu włącznie) albo,
 * gdy odmówiła przed pierwszym żądaniem, `{ ok: false, refused: true, error, steps: [] }`. Nie rzuca z powodu odpowiedzi serwera.
 */
export async function runSmoke({
  baseUrl, write = false, fetch: fetchFn = globalThis.fetch, log = console.log,
  simVersion, generatorVersion, random = defaultRandom,
} = {}) {
  const target = checkTarget(baseUrl);
  if (!target.ok) return { ok: false, refused: true, error: target.error, steps: [] };
  let sim = simVersion;
  let generator = generatorVersion;
  try {
    sim ??= readSimVersion();
    generator ??= readGeneratorVersion();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), steps: [] };
  }
  if (!Number.isSafeInteger(sim) || sim < 0) return { ok: false, error: 'simVersion musi być liczbą całkowitą nieujemną.', steps: [] };
  if (!write) {
    for (const line of planLines(target.origin, sim)) log(line);
    return { ok: true, dryRun: true, steps: [] };
  }

  const id = newIdentity(random);
  const say = (line) => log(redactor([id.key, id.otherKey])(line));
  const t = {
    ...id, origin: target.origin, fetch: fetchFn, simVersion: sim, generatorVersion: generator,
    get: (path) => call(t, 'GET', path),
    post: (path, body) => call(t, 'POST', path, body),
  };
  say(`Próba rankingu na ${target.origin} (symulacja v${sim}, generator v${generator}).`);
  say(`Klucz gracza: …${id.key.slice(-4)} (tylko ostatnie 4 znaki), nick: ${id.nick}, seed: ${id.seed}`);

  const steps = [];
  for (const [index, step] of STEPS.entries()) {
    const label = `${String(index + 1).padStart(2)}/${STEPS.length}  ${step.name}`;
    try {
      await step.run(t);
      steps.push({ id: step.id, name: step.name, ok: true });
      say(` PASS  ${label}`);
    } catch (err) {
      const error = redactor([id.key, id.otherKey])(err instanceof StepError ? err.message : `nieoczekiwany błąd: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      steps.push({ id: step.id, name: step.name, ok: false, error });
      say(` FAIL  ${label}`);
      say(`       ${error}`);
      say(`Zatrzymano na kroku ${index + 1} z ${STEPS.length}. Dane próby (nick ${id.nick}, seed ${id.seed}) mogły zostać w bazie testowej.`);
      return { ok: false, steps };
    }
  }
  say(`Wszystkie kroki (${STEPS.length}) przeszły. W bazie testowej zostały dane próby: nick ${id.nick}, seed ${id.seed}, zapis gry (30 dni).`);
  return { ok: true, steps };
}

// ——— wiersz poleceń ———

const USAGE = [
  'Użycie: node scripts/ranking-smoke.mjs <adres> [--write] [--sim-version <n>]',
  '  <adres>            adres wdrożenia z osobną bazą testową albo lokalnego serwera (np. http://localhost:3000)',
  '  --write            wykonaj próbę (bez tego tylko plan, nic nie jest wysyłane)',
  '  --sim-version <n>  wyślij biegi z tą wersją symulacji zamiast SIM_VERSION z src/sim/simVersion.ts',
  'Produkcja (traszka.vercel.app i subdomeny) jest zablokowana.',
].join('\n');

/** Argumenty wiersza poleceń → `{ baseUrl, write, simVersion, help }`; rzuca `Error` z opisem, gdy argumenty są złe. */
export function parseArgs(argv) {
  const args = { baseUrl: undefined, write: false, simVersion: undefined, help: false };
  const list = [...argv];
  while (list.length > 0) {
    const arg = list.shift();
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--sim-version' || arg.startsWith('--sim-version=')) {
      const raw = arg === '--sim-version' ? list.shift() : arg.slice('--sim-version='.length);
      if (raw === undefined || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Po --sim-version trzeba podać liczbę całkowitą nieujemną.');
      args.simVersion = Number(raw);
    } else if (arg.startsWith('-')) throw new Error(`Nieznana opcja: ${arg}`);
    else if (args.baseUrl === undefined) args.baseUrl = arg;
    else throw new Error('Podano więcej niż jeden adres.');
  }
  if (!args.help && args.baseUrl === undefined) throw new Error('Brakuje adresu.');
  return args;
}

/** Polecenie: kod wyjścia 0 (próba przeszła albo sam plan), 1 (porażka kroku), 2 (zły argument albo odmowa). */
export async function cli(argv, io = { out: console.log, err: console.error }) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.err(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    io.out(USAGE);
    return 0;
  }
  const result = await runSmoke({ ...args, log: io.out });
  if (result.error !== undefined) {
    io.err(result.error);
    return result.refused ? 2 : 1;
  }
  return result.ok ? 0 : 1;
}

/** Czy plik uruchomiono bezpośrednio (realpath po obu stronach: dowiązanie symboliczne nie może po cichu pominąć próby). */
function isMain() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMain()) process.exitCode = await cli(process.argv.slice(2));

import { BUDGET_TTL, RATE_GATE_MAX_ENTRIES, RATE_LIMITS, RATE_SECRET_MIN_CHARS, type RateAction } from './config.js';
import { hmacSha256Hex, randomHex, sha256Hex, type RandomBytes } from './hash.js';
import { KEYS } from './keys.js';
import { asNumber, asString, RedisError, type RedisExec } from './redis.js';

/**
 * Limit zgłoszeń w stałych oknach czasu, osobno na klucz gracza i na adres klienta (spec §14.7). Adresu serwer nie przechowuje:
 * w bazie jest tylko jego skrót z solą tego okna, a sól i liczniki giną z końcem okna (czas życia względny, patrz `checkRate`),
 * więc po oknie nie da się już powiedzieć, czyj to był skrót. Dwa zapytania do bazy: sól, potem liczniki (drugiego nie da się
 * dołączyć do pierwszego, bo nazwy liczników zależą od soli). Na końcu pliku globalny budżet dzienny (`checkBudget`), niezależny
 * od klucza i adresu.
 */
export interface RateCheck { ok: boolean; retryAfter: number }
export interface Requester { owner: string | null; address: string }

const HEX_GROUP = /^[0-9a-f]{1,4}$/;

/**
 * Kubełek limitu dla adresu klienta. IPv4 (i wszystko, co nie wygląda na IPv6, np. „nieznany”) liczy się wprost. IPv6: dostawca
 * daje klientowi cały prefiks /64, czyli 2^64 adresów, a zmiana końcówki jest za darmo, więc limit na pełny adres nie
 * ograniczałby nikogo; liczymy prefiks, czyli pierwsze 4 z 8 grup po rozwinięciu `::`, zapisane jednolicie (małe litery, bez
 * zer wiodących). Adres IPv4 zapisany w IPv6 (`::ffff:203.0.113.7`) wraca jako zwykły IPv4, żeby nie wpadł do wspólnego kubełka
 * wszystkich takich klientów (`0:0:0:0/64`). Strefa (`%eth0`) i nawiasy odpadają. Tekst, którego nie da się rozebrać, zostaje.
 */
export function addressBucket(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  if (!a.includes(':')) return address;
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);   // końcówka a.b.c.d to dwie grupy szesnastkowe
  if (dotted) {
    const [o1, o2, o3, o4] = dotted.slice(2).map(Number) as [number, number, number, number];
    if (Math.max(o1, o2, o3, o4) > 255) return address;
    a = `${dotted[1]}${((o1 << 8) | o2).toString(16)}:${((o3 << 8) | o4).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return address;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  let groups = head;
  if (halves.length === 2) {
    const tail = halves[1] === '' ? [] : halves[1]!.split(':');
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return address;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8 || !groups.every((g) => HEX_GROUP.test(g))) return address;
  const n = groups.map((g) => parseInt(g, 16)) as [number, number, number, number, number, number, number, number];
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
  return `${n.slice(0, 4).map((x) => x.toString(16)).join(':')}/64`;
}

/** Okno limitu, w którym leży `now`: numer, koniec (ms), ms do końca (dla czasu życia kluczy) i `Retry-After` w sekundach. */
function windowOf(action: RateAction, now: number): { window: number; index: number; end: number; left: number; retryAfter: number } {
  const { window } = RATE_LIMITS[action];
  const index = Math.floor(now / (window * 1000));
  const end = (index + 1) * window * 1000;
  return { window, index, end, left: Math.max(1, Math.ceil(end - now)), retryAfter: Math.max(1, Math.ceil((end - now) / 1000)) };
}

/** Co baza odpowiedziała na `INCR` liczników jednego żądania (klucz `null`, gdy żądanie nie ma klucza gracza). */
export interface RateSeen { address: number; key: number | null }

/**
 * Bramka limitu w pamięci jednej instancji funkcji (Fluid compute współdzieli instancję między wywołaniami). Odmawia tanio, bez
 * pytania bazy, temu, komu baza i tak by odmówiła; wszystko inne puszcza dalej, do bazy.
 *
 * Zasada: bramka trzyma dla (akcji, okna, kubełka adresu) i dla (akcji, okna, właściciela) największą liczbę, jaką baza oddała
 * jako wynik `INCR` tego licznika. Liczniki w oknie tylko rosną, więc to dolna granica prawdziwego licznika: nigdy go nie
 * przekracza, także gdy odpowiedzi wracają w odwrotnej kolejności albo licznik rośnie od żądań innych instancji. Odmowa z pamięci
 * (zapamiętana liczba już `>= limit`) znaczy więc, że następny `INCR` dałby więcej niż limit, czyli baza odrzuciłaby to żądanie
 * tak samo, z tym samym `Retry-After` (do końca okna). Odmowa z pamięci niczego nie liczy: nie dochodzi do bazy.
 * Do pamięci trafia tylko to, co baza faktycznie odpowiedziała (`record` po udanym `exec`), więc błąd bazy niczego nie psuje.
 *
 * Pamięć jest tylko przyspieszeniem i jest ograniczona (`maxEntries`): wpisy z minionych okien wypadają, przy przepełnieniu
 * wypada najstarszy (odświeżany wpis jest najmłodszy), a wypadnięty wpis oznacza jedno zapytanie do bazy więcej, nie inną decyzję.
 * Adresy nie leżą w pamięci wprost: nazwa wpisu to skrót `sha256` z losową solą instancji, wylosowaną przy tworzeniu bramki.
 */
export interface RateGate {
  /** Odmowa z pamięci (`ok: false`, `retryAfter` do końca okna) albo `null`: pytać bazę. Z `owner: null` sprawdza sam adres. */
  peek(action: RateAction, who: Requester, now: number): Promise<RateCheck | null>;
  /** Zapamiętuje liczniki odczytane z odpowiedzi bazy (po udanym `exec`). */
  record(action: RateAction, who: Requester, now: number, seen: RateSeen): Promise<void>;
  /** Ile wpisów leży teraz w pamięci i jak się nazywają (do testów). */
  readonly size: number;
  keys(): string[];
}

export interface RateGateOptions {
  /** Losowość do podmiany w testach (sól instancji). */
  random?: RandomBytes;
  /** Ile wpisów najwyżej (domyślnie `RATE_GATE_MAX_ENTRIES`). */
  maxEntries?: number;
}

export function createRateGate(opts: RateGateOptions = {}): RateGate {
  const salt = randomHex(16, opts.random);
  const max = Math.max(1, opts.maxEntries ?? RATE_GATE_MAX_ENTRIES);
  const slots = new Map<string, { seen: number; end: number }>();
  let earliestEnd = Infinity;   // najwcześniejszy koniec okna wśród wpisów: dopóki `now` go nie dogoni, nie ma czego wyrzucać

  const names = async (action: RateAction, who: Requester, index: number): Promise<{ address: string; key: string | null }> => {
    const hash = (await sha256Hex(`${salt}:${addressBucket(who.address)}`)).slice(0, 32);
    return { address: `${action}:${index}:a:${hash}`, key: who.owner === null ? null : `${action}:${index}:k:${who.owner.slice(0, 32)}` };
  };

  function purge(now: number): void {
    earliestEnd = Infinity;
    for (const [name, slot] of slots) {
      if (slot.end <= now) slots.delete(name);
      else earliestEnd = Math.min(earliestEnd, slot.end);
    }
  }

  function remember(name: string, seen: number, end: number, now: number): void {
    const previous = slots.get(name);
    if (previous) slots.delete(name);   // zapis odświeża kolejność: aktywny wpis wypada ostatni
    else {
      if (now >= earliestEnd) purge(now);
      while (slots.size >= max) slots.delete(slots.keys().next().value as string);
    }
    slots.set(name, { seen: Math.max(previous?.seen ?? 0, seen), end });
    earliestEnd = Math.min(earliestEnd, end);
  }

  return {
    async peek(action, who, now) {
      const { perKey, perAddress } = RATE_LIMITS[action];
      const w = windowOf(action, now);
      const n = await names(action, who, w.index);
      const full = (name: string | null, limit: number): boolean => name !== null && (slots.get(name)?.seen ?? 0) >= limit;
      return full(n.address, perAddress) || full(n.key, perKey) ? { ok: false, retryAfter: w.retryAfter } : null;
    },
    async record(action, who, now, seen) {
      const w = windowOf(action, now);
      const n = await names(action, who, w.index);
      remember(n.address, seen.address, w.end, now);
      if (n.key !== null && seen.key !== null) remember(n.key, seen.key, w.end, now);
    },
    get size() { return slots.size; },
    keys: () => [...slots.keys()],
  };
}

export interface RateOptions {
  /** Losowość do podmiany w testach (sól okna w bazie). */
  random?: RandomBytes;
  /** Bramka w pamięci instancji: odmawia bez pytania bazy temu, komu baza i tak by odmówiła (patrz `createRateGate`). */
  gate?: RateGate;
  /**
   * Sekret z `RANKING_SALT` (co najmniej `RATE_SECRET_MIN_CHARS` znaków): skrót adresu to HMAC-SHA256 tego sekretu, więc nie
   * trzeba czytać soli okna z bazy i liczniki idą w jednym zapytaniu. Bez niego sól okna leży w bazie. Wartość nigdy nie trafia
   * do bazy, odpowiedzi ani komunikatu błędu.
   */
  secret?: string;
}

/**
 * Jedno sprawdzenie limitu: `ok: false`, gdy licznik adresu albo klucza w tym oknie przekroczył limit. Najpierw bramka w pamięci
 * (jeśli jest): zapamiętana odmowa kosztuje 0 zapytań i 0 poleceń.
 *
 * Skrót adresu ma dwa tryby. Z sekretem: HMAC-SHA256(sekret, `traszka:limit:{akcja}:{okno}:{nr okna}:{kubełek adresu}`), skrócony
 * do 32 znaków szesnastkowych; wiadomość wiąże skrót z akcją i oknem (pola przed kubełkiem nie mają dwukropków, więc zapis jest
 * jednoznaczny), więc okien ani akcji nie da się połączyć, a jedno zapytanie do bazy robi same liczniki. Bez sekretu: sha256 z solą
 * okna, którą baza trzyma (`SET NX`, `GET`), czyli dwa zapytania (sól, potem liczniki). Sól, której baza nie oddała, to błąd: skrót
 * z pustą solą byłby tym samym skrótem u każdego klienta i w każdym oknie.
 *
 * Czas życia kluczy jest względny (`PX`, `PEXPIRE`: tyle ms, ile zostało do końca okna według zegara funkcji): zegar bazy może się
 * różnić od zegara funkcji, a klucz z bezwzględnym końcem okna (`PXAT`) powstałby wtedy przeterminowany albo żyłby za długo.
 * Licznik dostaje czas życia przy każdym żądaniu, więc nie zostaje nigdy bez niego, także gdy klucz wygasł między poleceniami
 * (`INCR` zakłada go wtedy od nowa, a `PEXPIRE` zaraz po nim ustawia czas). Błąd bazy wychodzi na zewnątrz i niczego nie zapisuje
 * w bramce.
 */
export async function checkRate(redis: RedisExec, action: RateAction, who: Requester, now: number, opts: RateOptions = {}): Promise<RateCheck> {
  const { perKey, perAddress } = RATE_LIMITS[action];
  const { window, index, left, retryAfter } = windowOf(action, now);
  if (opts.secret !== undefined && opts.secret.length < RATE_SECRET_MIN_CHARS) throw new RedisError('Limiter: sekret limitu jest za krótki');
  const local = await opts.gate?.peek(action, who, now);
  if (local) return local;

  const bucket = addressBucket(who.address);
  let address: string;
  if (opts.secret !== undefined) {
    address = (await hmacSha256Hex(opts.secret, `traszka:limit:${action}:${window}:${index}:${bucket}`)).slice(0, 32);
  } else {
    const saltKey = KEYS.salt(window, index);
    const [, saltRaw] = await redis.exec([['SET', saltKey, randomHex(16, opts.random), 'NX', 'PX', left], ['GET', saltKey]]);
    const salt = asString(saltRaw);
    if (!salt) throw new RedisError('Limiter: baza nie oddała soli okna');
    address = (await sha256Hex(`${salt}:${bucket}`)).slice(0, 32);
  }

  const counters = [KEYS.rate(action, index, `a:${address}`)];
  if (who.owner !== null) counters.push(KEYS.rate(action, index, `k:${who.owner.slice(0, 32)}`));
  const results = await redis.exec(counters.flatMap((k) => [['INCR', k], ['PEXPIRE', k, left]]));
  const byAddress = asNumber(results[0]) ?? 0;
  const byKey = who.owner !== null ? asNumber(results[2]) ?? 0 : null;
  await opts.gate?.record(action, who, now, { address: byAddress, key: byKey });
  const ok = byAddress <= perAddress && (byKey ?? 0) <= perKey;
  return { ok, retryAfter: ok ? 0 : retryAfter };
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

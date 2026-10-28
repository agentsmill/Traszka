import { RedisError, type RedisArg, type RedisCommand, type RedisExec } from './redis.js';

/**
 * Redis w pamięci: atrapa Upstash do testów (testy nigdy nie łączą się z siecią). Zna tylko polecenia, których używa ranking,
 * z tymi samymi kształtami wyników co Upstash REST (wyniki zbiorów sortowanych jako tekst, brak klucza to null). Polecenie spoza
 * listy albo klucz złego typu rzuca `RedisError`, tak jak prawdziwa baza, żeby literówka nie przeszła w testach po cichu.
 * Czas życia kluczy liczy z `now` (ms), więc testy przesuwają zegar ręcznie.
 */

type Value = { kind: 'string'; value: string } | { kind: 'zset'; value: Map<string, number> } | { kind: 'set'; value: Set<string> };
interface Entry { data: Value; expiresAt: number | null }

const text = (a: RedisArg | undefined): string => (a === undefined ? '' : String(a));

function int(a: RedisArg | undefined): number {
  const n = Number(a);
  if (!Number.isInteger(n)) throw new RedisError('ERR value is not an integer or out of range');
  return n;
}

/** Granica przedziału ZCOUNT: liczba, `(liczba` (otwarta), `-inf`, `+inf`. */
function bound(a: RedisArg | undefined): { value: number; open: boolean } {
  const s = text(a);
  const open = s.startsWith('(');
  const raw = open ? s.slice(1) : s;
  const value = raw === '+inf' || raw === 'inf' ? Infinity : raw === '-inf' ? -Infinity : Number(raw);
  if (Number.isNaN(value) || raw === '') throw new RedisError('ERR min or max is not a float');
  return { value, open };
}

/** Wynik liczbowy jako tekst, tak jak oddaje go Upstash. */
const scoreText = (n: number): string => (n === Infinity ? 'inf' : n === -Infinity ? '-inf' : String(n));

/** Zakres indeksów jak w Redisie (ujemne liczone od końca), przycięty do długości listy. */
function range(len: number, start: number, stop: number): [number, number] {
  const a = Math.max(0, start < 0 ? len + start : start);
  const b = Math.min(len - 1, stop < 0 ? len + stop : stop);
  return [a, b];
}

export class MemoryRedis implements RedisExec {
  private readonly store = new Map<string, Entry>();
  /** Ile razy wołano `exec` (zapytania HTTP w prawdziwej bazie) i ile poleceń przyszło razem. */
  calls = 0;
  commands = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async exec(commands: readonly RedisCommand[]): Promise<unknown[]> {
    this.calls++;
    this.commands += commands.length;
    return commands.map((c) => this.one(c));
  }

  /** Klucze, które żyją teraz (do testów: co zostaje w bazie). */
  keys(): string[] {
    return [...this.store.keys()].filter((k) => this.entry(k) !== null).sort();
  }

  private entry(key: string): Entry | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && this.now() >= e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return e;
  }

  private typed<K extends Value['kind']>(key: string, kind: K): Extract<Value, { kind: K }> | null {
    const e = this.entry(key);
    if (!e) return null;
    if (e.data.kind !== kind) throw new RedisError('WRONGTYPE Operation against a key holding the wrong kind of value');
    return e.data as Extract<Value, { kind: K }>;
  }

  /** Kolekcja pod kluczem: istniejąca albo nowa, bez czasu życia. */
  private collection<K extends 'zset' | 'set'>(key: string, kind: K): Extract<Value, { kind: K }> {
    const found = this.typed(key, kind);
    if (found) return found;
    const data = (kind === 'zset' ? { kind, value: new Map<string, number>() } : { kind, value: new Set<string>() }) as Extract<Value, { kind: K }>;
    this.store.set(key, { data, expiresAt: null });
    return data;
  }

  /** Pusta kolekcja znika z bazy, jak w Redisie. */
  private dropEmpty(key: string): void {
    const e = this.entry(key);
    if (e && e.data.kind !== 'string' && e.data.value.size === 0) this.store.delete(key);
  }

  private sortedDesc(z: Map<string, number>): [string, number][] {
    return [...z.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }

  private one(c: RedisCommand): unknown {
    const [name, ...args] = c;
    const key = text(args[0]);
    switch (text(name).toUpperCase()) {
      case 'GET': return this.typed(key, 'string')?.value ?? null;
      case 'MGET': return args.map((k) => {
        const e = this.entry(text(k));
        return e && e.data.kind === 'string' ? e.data.value : null;
      });
      case 'SET': return this.set(key, text(args[1]), args.slice(2).map(text));
      case 'DEL': return args.reduce<number>((n, k) => n + (this.entry(text(k)) && this.store.delete(text(k)) ? 1 : 0), 0);
      case 'EXISTS': return args.filter((k) => this.entry(text(k)) !== null).length;
      case 'INCR': {
        const e = this.entry(key);
        const cur = e ? this.typed(key, 'string')!.value : '0';
        const next = int(cur) + 1;
        this.store.set(key, { data: { kind: 'string', value: String(next) }, expiresAt: e?.expiresAt ?? null });
        return next;
      }
      case 'EXPIRE': return this.expireAt(key, this.now() + int(args[1]) * 1000);
      case 'PEXPIREAT': return this.expireAt(key, int(args[1]));
      case 'PTTL': {
        const e = this.entry(key);
        return e === null ? -2 : e.expiresAt === null ? -1 : e.expiresAt - this.now();
      }
      case 'ZADD': return this.zadd(key, args.slice(1));
      case 'ZSCORE': {
        const s = this.typed(key, 'zset')?.value.get(text(args[1]));
        return s === undefined ? null : scoreText(s);
      }
      case 'ZCARD': return this.typed(key, 'zset')?.value.size ?? 0;
      case 'ZREVRANGE': {
        const z = this.typed(key, 'zset');
        if (!z) return [];
        const sorted = this.sortedDesc(z.value);
        const [a, b] = range(sorted.length, int(args[1]), int(args[2]));
        const slice = sorted.slice(a, b + 1);
        return text(args[3]).toUpperCase() === 'WITHSCORES' ? slice.flatMap(([m, s]) => [m, scoreText(s)]) : slice.map(([m]) => m);
      }
      case 'ZREVRANK': {
        const z = this.typed(key, 'zset');
        const i = z ? this.sortedDesc(z.value).findIndex(([m]) => m === text(args[1])) : -1;
        return i < 0 ? null : i;
      }
      case 'ZCOUNT': {
        const z = this.typed(key, 'zset');
        if (!z) return 0;
        const lo = bound(args[1]);
        const hi = bound(args[2]);
        return [...z.value.values()].filter((s) => (lo.open ? s > lo.value : s >= lo.value) && (hi.open ? s < hi.value : s <= hi.value)).length;
      }
      case 'ZREM': {
        const z = this.typed(key, 'zset');
        const n = z ? args.slice(1).filter((m) => z.value.delete(text(m))).length : 0;
        this.dropEmpty(key);
        return n;
      }
      case 'ZREMRANGEBYRANK': {
        const z = this.typed(key, 'zset');
        if (!z) return 0;
        const asc = this.sortedDesc(z.value).reverse();
        const [a, b] = range(asc.length, int(args[1]), int(args[2]));
        const gone = asc.slice(a, b + 1);
        for (const [m] of gone) z.value.delete(m);
        this.dropEmpty(key);
        return gone.length;
      }
      case 'SADD': {
        const s = this.collection(key, 'set');
        return args.slice(1).filter((m) => !s.value.has(text(m)) && s.value.add(text(m))).length;
      }
      case 'SREM': {
        const s = this.typed(key, 'set');
        const n = s ? args.slice(1).filter((m) => s.value.delete(text(m))).length : 0;
        this.dropEmpty(key);
        return n;
      }
      case 'SMEMBERS': return [...(this.typed(key, 'set')?.value ?? [])].sort();
      default: throw new RedisError(`ERR unknown command '${text(name)}'`);
    }
  }

  private set(key: string, value: string, opts: string[]): string | null {
    let expiresAt: number | null = null;
    let nx = false;
    let xx = false;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i]!.toUpperCase();
      if (o === 'NX') nx = true;
      else if (o === 'XX') xx = true;
      else if (o === 'EX') expiresAt = this.now() + int(opts[++i]) * 1000;
      else if (o === 'PX') expiresAt = this.now() + int(opts[++i]);
      else if (o === 'EXAT') expiresAt = int(opts[++i]) * 1000;
      else if (o === 'PXAT') expiresAt = int(opts[++i]);
      else throw new RedisError(`ERR syntax error (SET ${o})`);
    }
    const exists = this.entry(key) !== null;
    if ((nx && exists) || (xx && !exists)) return null;
    this.store.set(key, { data: { kind: 'string', value }, expiresAt });
    return 'OK';
  }

  private expireAt(key: string, at: number): number {
    const e = this.entry(key);
    if (!e) return 0;
    e.expiresAt = at;
    this.entry(key);   // czas w przeszłości usuwa klucz od razu
    return 1;
  }

  private zadd(key: string, rest: readonly RedisArg[]): number {
    let i = 0;
    let gt = false;
    let ch = false;
    for (; i < rest.length; i++) {
      const o = text(rest[i]).toUpperCase();
      if (o === 'GT') gt = true;
      else if (o === 'CH') ch = true;
      else break;
    }
    const z = this.collection(key, 'zset');
    let changed = 0;
    for (; i + 1 < rest.length; i += 2) {
      const score = Number(rest[i]);
      if (Number.isNaN(score)) throw new RedisError('ERR value is not a valid float');
      const member = text(rest[i + 1]);
      const old = z.value.get(member);
      if (old === undefined) {
        z.value.set(member, score);
        changed++;
      } else if ((!gt || score > old) && score !== old) {
        z.value.set(member, score);
        if (ch) changed++;
      }
    }
    return changed;
  }
}

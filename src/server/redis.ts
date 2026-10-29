/**
 * Najmniejszy wspólny mianownik bazy rankingu: Redis jako lista poleceń. Upstash przyjmuje polecenia przez REST (`upstash.ts`),
 * a testy i tryb bez bazy używają `MemoryRedis` (`memoryRedis.ts`) z tymi samymi poleceniami i tymi samymi kształtami wyników.
 * Logika rankingu pisze polecenia wprost (`['ZADD', klucz, 'GT', 'CH', wynik, członek]`), bo każdy, kto zna Redisa, je przeczyta,
 * a jedno `exec` z kilkoma poleceniami to jedno zapytanie HTTP.
 *
 * Kod w `src/server` czyta funkcja serwerowa na Vercelu (Node, ESM): importy w czasie działania tylko względne, z rozszerzeniem
 * `.js`, i tylko z plików, które same nie mają innych importów (inaczej funkcja padnie przy starcie, choć build przejdzie).
 */

export type RedisArg = string | number;
export type RedisCommand = readonly RedisArg[];

/** Wykonuje polecenia po kolei i zwraca ich wyniki w tej samej kolejności. Błąd któregokolwiek polecenia rzuca `RedisError`. */
export interface RedisExec {
  exec(commands: readonly RedisCommand[]): Promise<unknown[]>;
}

/** Błąd bazy (zła odpowiedź, błąd polecenia, brak połączenia). Komunikat nigdy nie zawiera adresu ani tokenu bazy. */
export class RedisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisError';
  }
}

/** Jedno polecenie (wygodny skrót do `exec` z jednym elementem). */
export async function run(redis: RedisExec, command: RedisCommand): Promise<unknown> {
  const [result] = await redis.exec([command]);
  return result;
}

// --- Odczyt wyników (Upstash zwraca liczby z zbiorów sortowanych jako tekst) ---------------------------------------------

/** Tekst albo null (GET na brakującym kluczu). */
export const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Liczba z wyniku (INCR daje liczbę, ZSCORE tekst) albo null. */
export function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Lista tekstów (MGET, SMEMBERS); wszystko, co nie jest tekstem, to null. */
export const asStrings = (v: unknown): (string | null)[] => (Array.isArray(v) ? v.map(asString) : []);

export interface Scored { member: string; score: number }

/** Wynik `ZREVRANGE … WITHSCORES`: płaska lista [członek, wynik, członek, wynik…] → pary. */
export function asScored(v: unknown): Scored[] {
  if (!Array.isArray(v)) return [];
  const out: Scored[] = [];
  for (let i = 0; i + 1 < v.length; i += 2) {
    const member = asString(v[i]);
    const score = asNumber(v[i + 1]);
    if (member !== null && score !== null) out.push({ member, score });
  }
  return out;
}

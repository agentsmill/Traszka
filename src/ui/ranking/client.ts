import type { BoardRow, Ranks } from '@/server/leaderboard';
import type { NickStatus } from '@/server/nicks';
import type { RunRecord } from '@/sim/run';

/**
 * Klient API rankingu po stronie gry (spec §14.7). Klucz gracza wysyłamy tylko w ciele POST (nigdy w adresie, który ląduje w logach
 * i historii). Odpowiedź serwera przechodzi bez zmian: `{ ok: true, … }` albo `{ ok: false, error, message }`, a brak sieci
 * i odpowiedź, która nie jest JSON-em API (np. strona 404 na serwerze deweloperskim bez funkcji), dostają własne komunikaty.
 */
export type RankingTab = 'global' | 'seed' | 'week';
export interface WeekInfo { id: string; seed: string; endsAt: number }
export interface Place { rank: number; score: number }

export interface BoardResponse { board: RankingTab; seed?: string; week: WeekInfo; rows: BoardRow[] }
export interface PlayerResponse {
  nicks: string[];
  nick?: { nick: string; status: NickStatus | 'invalid'; message?: string };
  ranks?: Record<RankingTab, Place | null>;
}
/**
 * Odpowiedź na przyjęty bieg (`POST /api/runs`, `handleRuns`): nick, wynik policzony przez sędziego, najlepszy wynik tego nicka,
 * czy ten bieg go poprawił i miejsca w rankingach (globalnym, seeda, tygodnia). Miejsce to sama liczba (od 1) albo null, gdy bieg
 * w danym rankingu nie widnieje (inny seed niż seed tygodnia, wypadł poza listę); to nie `Place` z `/api/player`, który niesie też wynik.
 */
export interface RunAccepted { nick: string; score: number; best: number; improved: boolean; ranks: Ranks }
export interface SaveUploaded { bytes: number; savedAt: number }
export interface SaveDownloaded { save: string; savedAt: number }

export interface ApiError { ok: false; error: string; message: string }
/** `E` to pola, które błąd niesie poza `error` i `message` (domyślnie żadne). */
export type ApiResult<T, E extends object = object> = ({ ok: true } & T) | (ApiError & E);

/** Warunek wysłania zapisu: `expected` to chwila kopii, którą to urządzenie wysłało albo pobrało (`null`: jeszcze żadnej nie widziało), `force` wysyła mimo konfliktu. */
export interface SaveUploadOptions { expected?: number | null; force?: boolean }
/** Wysłanie zapisu: 409 `save-conflict` niesie `savedAt` kopii, która leży na serwerze. */
export type SaveUploadResult = ApiResult<SaveUploaded, { savedAt?: number }>;

export interface RankingClient {
  /** `limit` to 10, 20, 50 albo 100 wierszy (domyślnie 20): serwer odrzuca inne wartości, żeby pamięć podręczna Vercela miała mało kluczy. */
  board(tab: RankingTab, seed?: string, limit?: number): Promise<ApiResult<BoardResponse>>;
  player(key: string, nick?: string, seed?: string): Promise<ApiResult<PlayerResponse>>;
  /**
   * Bez `opts` serwer traktuje wysłanie jak `expected: null`: gdy na serwerze leży już kopia, odpowiada 409 `save-conflict` (z `savedAt`
   * tej kopii) i niczego nie zapisuje. Pola `expected` i `force` jadą w ciele tylko wtedy, gdy podane (`null` też jest wartością).
   */
  uploadSave(key: string, save: string, opts?: SaveUploadOptions): Promise<SaveUploadResult>;
  downloadSave(key: string): Promise<ApiResult<SaveDownloaded>>;
  /**
   * Wysyła skończony bieg rankingowy: serwer sam odtwarza go z dziennika i liczy wynik (nasz `score` do niego nie jedzie). Klucz i nick
   * idą w ciele razem z `run`. Błąd z serwera (`nick-taken`, `old-version`, `ranking-off`…) wraca jak przyszedł; brak sieci i odpowiedź
   * spoza API to `network` i `unavailable`, jak przy innych zapytaniach.
   */
  submitRun(key: string, nick: string, run: RunRecord): Promise<ApiResult<RunAccepted>>;
}

export const NETWORK_ERROR = 'Brak połączenia z Centralą. Sprawdź internet i spróbuj jeszcze raz.';
export const UNAVAILABLE_ERROR = 'Ranking jest teraz nieczynny. Centrala robi inwentaryzację, zajrzyj później.';

const DEFAULT_LIMIT = 20;

export function createRankingClient(fetchFn: typeof fetch = (input, init) => fetch(input, init), base = '/api'): RankingClient {
  async function call<T, E extends object = object>(path: string, init?: RequestInit): Promise<ApiResult<T, E>> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, init);
    } catch {
      return { ok: false, error: 'network', message: NETWORK_ERROR };
    }
    const data: unknown = await res.json().catch(() => null);
    if (typeof data !== 'object' || data === null || Array.isArray(data) || typeof (data as { ok?: unknown }).ok !== 'boolean') {
      return { ok: false, error: 'unavailable', message: UNAVAILABLE_ERROR };
    }
    return data as ApiResult<T, E>;
  }
  const post = <T, E extends object = object>(path: string, body: Record<string, unknown>): Promise<ApiResult<T, E>> =>
    call<T, E>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    board(tab, seed, limit = DEFAULT_LIMIT) {
      const q = new URLSearchParams({ board: tab, limit: String(limit) });
      if (seed !== undefined) q.set('seed', seed);
      return call<BoardResponse>(`/leaderboard?${q.toString().replace(/\+/g, '%20')}`);
    },
    player: (key, nick, seed) => post<PlayerResponse>('/player', { key, ...(nick !== undefined ? { nick } : {}), ...(seed !== undefined ? { seed } : {}) }),
    uploadSave: (key, save, opts) => post<SaveUploaded, { savedAt?: number }>('/save/upload', {
      key, save, ...(opts?.expected !== undefined ? { expected: opts.expected } : {}), ...(opts?.force !== undefined ? { force: opts.force } : {}),
    }),
    downloadSave: (key) => post<SaveDownloaded>('/save/download', { key }),
    submitRun: (key, nick, run) => post<RunAccepted>('/runs', { key, nick, run }),
  };
}

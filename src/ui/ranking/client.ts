import type { BoardRow } from '@/server/leaderboard';
import type { NickStatus } from '@/server/nicks';

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
export interface SaveUploaded { bytes: number; savedAt: number }
export interface SaveDownloaded { save: string; savedAt: number }

export interface ApiError { ok: false; error: string; message: string }
export type ApiResult<T> = ({ ok: true } & T) | ApiError;

export interface RankingClient {
  board(tab: RankingTab, seed?: string, limit?: number): Promise<ApiResult<BoardResponse>>;
  player(key: string, nick?: string, seed?: string): Promise<ApiResult<PlayerResponse>>;
  uploadSave(key: string, save: string): Promise<ApiResult<SaveUploaded>>;
  downloadSave(key: string): Promise<ApiResult<SaveDownloaded>>;
}

export const NETWORK_ERROR = 'Brak połączenia z Centralą. Sprawdź internet i spróbuj jeszcze raz.';
export const UNAVAILABLE_ERROR = 'Ranking jest teraz nieczynny. Centrala robi inwentaryzację, zajrzyj później.';

const DEFAULT_LIMIT = 20;

export function createRankingClient(fetchFn: typeof fetch = (input, init) => fetch(input, init), base = '/api'): RankingClient {
  async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
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
    return data as ApiResult<T>;
  }
  const post = <T>(path: string, body: Record<string, unknown>): Promise<ApiResult<T>> =>
    call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    board(tab, seed, limit = DEFAULT_LIMIT) {
      const q = new URLSearchParams({ board: tab, limit: String(limit) });
      if (seed !== undefined) q.set('seed', seed);
      return call<BoardResponse>(`/leaderboard?${q.toString().replace(/\+/g, '%20')}`);
    },
    player: (key, nick, seed) => post<PlayerResponse>('/player', { key, ...(nick !== undefined ? { nick } : {}), ...(seed !== undefined ? { seed } : {}) }),
    uploadSave: (key, save) => post<SaveUploaded>('/save/upload', { key, save }),
    downloadSave: (key) => post<SaveDownloaded>('/save/download', { key }),
  };
}

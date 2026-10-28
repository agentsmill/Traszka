import { signal, type ReadonlySignal } from '@preact/signals';
import { nickKey } from '@/game/nick';
import type { BoardRow } from '@/server/leaderboard';
import type { Place, RankingClient, RankingTab, WeekInfo } from './client';

/**
 * Stan panelu rankingu (bez DOM, do testów): wybrana zakładka, wiersze z serwera i moje miejsca. Zakładki to ranking globalny
 * (wszystkie seedy), „Ten seed” (seed otwartego sklepu) i seed tygodnia. Odpowiedź, która przyszła po zmianie zakładki, przepada.
 */
export const NO_SEED = 'Najpierw otwórz sklep: ranking „Ten seed” pokazuje wyniki z seeda Twojego sklepu.';

export interface RankingView {
  status: 'loading' | 'ready' | 'error';
  rows: BoardRow[];
  /** Seed rankingu: sklepu w „Ten seed”, tygodnia w „Seed tygodnia”, null w globalnym. */
  seed: string | null;
  week: WeekInfo | null;
  message: string | null;
}
export interface MyPlaces { nick: string; places: Record<RankingTab, Place | null> }

export interface RankingModel {
  tab: ReadonlySignal<RankingTab>;
  view: ReadonlySignal<RankingView>;
  /** Moje miejsca, gdy mój nick na serwerze jest naprawdę mój (inaczej null i żaden wiersz nie jest podświetlony). */
  me: ReadonlySignal<MyPlaces | null>;
  /** Czy gracz ma klucz i nick (bez nich nie ma czego szukać w rankingu). */
  hasPlayer: () => boolean;
  select(tab: RankingTab): Promise<void>;
  refresh(): Promise<void>;
  isMine(row: BoardRow): boolean;
}

export interface RankingDeps {
  client: RankingClient;
  /** Gracz z mety: klucz i nick (undefined przed ekranem startowym). */
  player: () => { key?: string; nick: string | null } | undefined;
  /** Seed otwartego sklepu (null, gdy żaden nie jest otwarty). */
  seed: () => string | null;
  now?: () => number;
}

const loading = (): RankingView => ({ status: 'loading', rows: [], seed: null, week: null, message: null });

export function createRankingModel(deps: RankingDeps): RankingModel {
  const tab = signal<RankingTab>('global');
  const view = signal<RankingView>(loading());
  const me = signal<MyPlaces | null>(null);
  let generation = 0;

  const who = (): { key: string; nick: string } | null => {
    const p = deps.player();
    return p?.key && p.nick ? { key: p.key, nick: p.nick } : null;
  };

  async function load(): Promise<void> {
    const gen = ++generation;
    const current = tab.value;
    view.value = loading();
    const seed = deps.seed();
    if (current === 'seed' && seed === null) {
      view.value = { ...loading(), status: 'error', message: NO_SEED };
      return;
    }
    const player = who();
    const [board, mine] = await Promise.all([
      current === 'seed' ? deps.client.board(current, seed!) : deps.client.board(current),
      player ? deps.client.player(player.key, player.nick, seed ?? undefined) : null,
    ]);
    if (gen !== generation) return;
    me.value = mine?.ok && mine.nick?.status === 'mine' && mine.ranks ? { nick: mine.nick.nick, places: mine.ranks } : null;
    view.value = board.ok
      ? { status: 'ready', rows: board.rows, seed: board.seed ?? null, week: board.week, message: null }
      : { ...loading(), status: 'error', message: board.message };
  }

  return {
    tab, view, me,
    hasPlayer: () => who() !== null,
    select(next) {
      tab.value = next;
      return load();
    },
    refresh: load,
    // ten sam nick może mieć dwa wiersze (wyniki poprzedniego właściciela zostają po wygaśnięciu rezerwacji), więc liczy się też miejsce i wynik
    isMine(row) {
      const place = me.value?.places[tab.value];
      return place != null && row.rank === place.rank && row.score === place.score && nickKey(row.nick) === nickKey(me.value!.nick);
    },
  };
}

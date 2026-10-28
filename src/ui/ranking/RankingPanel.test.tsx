import type { ComponentChild, VNode } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, BoardResponse, PlayerResponse, RankingClient, RankingTab } from './client';
import { EMPTY_BOARD, LOADING, NO_PLAYER, NO_SEED, RankingPanel, TAB_LABELS, weekLeft } from './RankingPanel';
import { createRankingModel, type RankingDeps } from './rankingModel';

// --- Drzewo vnode bez DOM (jak w overlays.test.tsx) ----------------------------------------------------------------------
function walk(node: ComponentChild, out: VNode<Record<string, unknown>>[] = []): VNode<Record<string, unknown>>[] {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  const vnode = node as VNode<Record<string, unknown>>;
  out.push(vnode);
  walk(vnode.props?.children as ComponentChild, out);
  return out;
}
function textOf(node: ComponentChild): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as VNode<Record<string, unknown>>).props?.children as ComponentChild);
}
const byClass = (tree: ComponentChild, cls: string) => walk(tree).filter((v) => String(v.props?.class ?? '').split(' ').includes(cls));
const buttons = (tree: ComponentChild) => walk(tree).filter((v) => v.type === 'button');
const click = (v: VNode<Record<string, unknown>>) => (v.props.onClick as () => void)();

// --- Atrapa klienta ---------------------------------------------------------------------------------------------------
const NOW = Date.UTC(2026, 9, 28, 12);
const WEEK = { id: '2026-W44', seed: 'babka-834', endsAt: Date.UTC(2026, 10, 2) };
const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const rows = (...list: [string, number][]) => list.map(([nick, score], i) => ({ rank: i + 1, nick, score }));

function fakeClient(boards: Partial<Record<RankingTab, ApiResult<BoardResponse>>>, me: ApiResult<PlayerResponse> = { ok: true, nicks: [] }) {
  const calls: { board: unknown[][]; player: unknown[][] } = { board: [], player: [] };
  const client: RankingClient = {
    board: vi.fn(async (tab: RankingTab, ...rest: unknown[]) => {
      calls.board.push([tab, ...rest]);
      return boards[tab] ?? ({ ok: true, board: tab, week: WEEK, rows: [] } satisfies ApiResult<BoardResponse>);
    }),
    player: vi.fn(async (...args: unknown[]) => {
      calls.player.push(args);
      return me;
    }),
    uploadSave: vi.fn(),
    downloadSave: vi.fn(),
  };
  return { client, calls };
}
const deps = (client: RankingClient, over: Partial<RankingDeps> = {}): RankingDeps => ({
  client, player: () => ({ key: KEY, nick: 'Mateusz' }), seed: () => 'pierogi-731', now: () => NOW, ...over,
});

describe('ranking: model', () => {
  it('start na rankingu globalnym; przełączenie zakładki pyta serwer o ten ranking (seed sklepu dla „Ten seed”)', async () => {
    const { client, calls } = fakeClient({ global: { ok: true, board: 'global', week: WEEK, rows: rows(['Ala', 50]) } });
    const model = createRankingModel(deps(client));
    expect(model.tab.value).toBe('global');
    expect(model.view.value.status).toBe('loading');
    await model.select('global');
    expect(model.view.value).toMatchObject({ status: 'ready', rows: rows(['Ala', 50]), week: WEEK });
    await model.select('seed');
    await model.select('week');
    expect(calls.board).toEqual([['global'], ['seed', 'pierogi-731'], ['week']]);
  });

  it('moje miejsca z /api/player (klucz i nick gracza, seed sklepu); bez klucza albo nicka nie pyta', async () => {
    const me: ApiResult<PlayerResponse> = {
      ok: true, nicks: ['Mateusz'], nick: { nick: 'Mateusz', status: 'mine' },
      ranks: { global: { rank: 140, score: 12 }, seed: { rank: 1, score: 12 }, week: null },
    };
    const { client, calls } = fakeClient({}, me);
    const model = createRankingModel(deps(client));
    await model.select('global');
    expect(calls.player).toEqual([[KEY, 'Mateusz', 'pierogi-731']]);
    expect(model.me.value).toEqual({ nick: 'Mateusz', places: me.ranks });
    const none = fakeClient({});
    const anonymous = createRankingModel(deps(none.client, { player: () => ({ nick: null }) }));
    await anonymous.select('global');
    expect(none.calls.player).toEqual([]);
    expect(anonymous.me.value).toBeNull();
  });

  it('nick, który na serwerze należy do kogoś innego, nie podświetla cudzego wiersza', async () => {
    const { client } = fakeClient(
      { global: { ok: true, board: 'global', week: WEEK, rows: rows(['Mateusz', 90]) } },
      { ok: true, nicks: [], nick: { nick: 'Mateusz', status: 'taken', message: 'Ten nick jest zajęty' } },
    );
    const model = createRankingModel(deps(client));
    await model.select('global');
    expect(model.me.value).toBeNull();
    expect(model.isMine(model.view.value.rows[0]!)).toBe(false);
  });

  it('własny wiersz rozpoznaje po kluczu nicka (wielkość liter i spacje nie mają znaczenia)', async () => {
    const { client } = fakeClient(
      { global: { ok: true, board: 'global', week: WEEK, rows: rows(['Ala', 90], ['MATEUSZ', 80]) } },
      { ok: true, nicks: ['MATEUSZ'], nick: { nick: 'Mateusz', status: 'mine' }, ranks: { global: { rank: 2, score: 80 }, seed: null, week: null } },
    );
    const model = createRankingModel(deps(client));
    await model.select('global');
    expect(model.view.value.rows.map((r) => model.isMine(r))).toEqual([false, true]);
  });

  it('ten sam nick w dwóch wierszach (stare wyniki poprzedniego właściciela): podświetlony tylko ten z moim miejscem i wynikiem', async () => {
    const { client } = fakeClient(
      { global: { ok: true, board: 'global', week: WEEK, rows: rows(['Mateusz', 90], ['Ala', 50], ['Mateusz', 10]) } },
      { ok: true, nicks: ['Mateusz'], nick: { nick: 'Mateusz', status: 'mine' }, ranks: { global: { rank: 3, score: 10 }, seed: null, week: null } },
    );
    const model = createRankingModel(deps(client));
    await model.select('global');
    expect(model.view.value.rows.map((r) => model.isMine(r))).toEqual([false, false, true]);
  });

  it('błąd serwera albo sieci: widok błędu z komunikatem; „Ten seed” bez otwartego sklepu nie pyta serwera', async () => {
    const { client, calls } = fakeClient({ global: { ok: false, error: 'network', message: 'Brak połączenia' } });
    const model = createRankingModel(deps(client, { seed: () => null }));
    await model.select('global');
    expect(model.view.value).toMatchObject({ status: 'error', message: 'Brak połączenia' });
    await model.select('seed');
    expect(model.view.value).toMatchObject({ status: 'error', message: NO_SEED });
    expect(calls.board).toEqual([['global']]);
  });

  it('spóźniona odpowiedź poprzedniej zakładki nie nadpisuje bieżącej', async () => {
    let release: (v: ApiResult<BoardResponse>) => void = () => undefined;
    const slow = new Promise<ApiResult<BoardResponse>>((r) => { release = r; });
    const { client } = fakeClient({ week: { ok: true, board: 'week', seed: WEEK.seed, week: WEEK, rows: rows(['Tydzień', 1]) } });
    (client.board as ReturnType<typeof vi.fn>).mockImplementationOnce(() => slow);
    const model = createRankingModel(deps(client));
    const first = model.select('global');
    await model.select('week');
    release({ ok: true, board: 'global', week: WEEK, rows: rows(['Stary', 9]) });
    await first;
    expect(model.tab.value).toBe('week');
    expect(model.view.value.rows.map((r) => r.nick)).toEqual(['Tydzień']);
  });
});

describe('ranking: panel', () => {
  const ready = async (boards: Parameters<typeof fakeClient>[0], me?: ApiResult<PlayerResponse>, over: Partial<RankingDeps> = {}, tab: RankingTab = 'global') => {
    const { client } = fakeClient(boards, me);
    const model = createRankingModel(deps(client, over));
    await model.select(tab);
    return model;
  };

  it('trzy zakładki (globalny, ten seed, seed tygodnia); kliknięcie przełącza, ✕ zamyka', async () => {
    const model = await ready({});
    const onClose = vi.fn();
    const select = vi.spyOn(model, 'select');
    const tree = RankingPanel({ model, onClose });
    const tabs = walk(tree).filter((v) => v.props?.role === 'tab');
    expect(tabs.map(textOf)).toEqual([TAB_LABELS.global, TAB_LABELS.seed, TAB_LABELS.week]);
    expect(tabs.map((t) => t.props['aria-selected'])).toEqual([true, false, false]);
    click(tabs[2]!);
    expect(select).toHaveBeenCalledWith('week');
    click(buttons(tree).find((b) => b.props['aria-label'] === 'Zamknij')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wiersze: miejsce, nick, seed (globalny), wynik w zł; własny wiersz podświetlony i oznaczony dla czytnika', async () => {
    const model = await ready(
      { global: { ok: true, board: 'global', week: WEEK, rows: [{ rank: 1, nick: 'Ala', score: 123_456, seed: 'bigos-100', at: 1 }, { rank: 2, nick: 'Mateusz', score: -50_000, seed: null, at: 2 }] } },
      { ok: true, nicks: ['Mateusz'], nick: { nick: 'Mateusz', status: 'mine' }, ranks: { global: { rank: 2, score: -50_000 }, seed: null, week: null } },
    );
    const tree = RankingPanel({ model, onClose: () => undefined });
    const items = byClass(tree, 'tt-rank-row');
    expect(items).toHaveLength(2);
    expect(textOf(items[0])).toContain('Ala');
    expect(textOf(items[0])).toContain('bigos-100');
    expect(textOf(items[0])).toMatch(/\+123\s456 zł/);
    expect(textOf(items[1])).toContain('seed nieznany');
    expect(textOf(items[1])).toMatch(/−50\s000 zł/);
    expect(items.map((i) => String(i.props.class).includes('me'))).toEqual([false, true]);
    expect(items[1]!.props['aria-current']).toBe('true');
    expect(byClass(tree, 'tt-rank-mine')).toHaveLength(0);   // własny wiersz jest na liście, osobna linijka niepotrzebna
  });

  it('moje miejsce poza pokazaną listą: osobna linijka pod rankingiem', async () => {
    const model = await ready(
      { global: { ok: true, board: 'global', week: WEEK, rows: rows(['Ala', 90]) } },
      { ok: true, nicks: ['Mateusz'], nick: { nick: 'Mateusz', status: 'mine' }, ranks: { global: { rank: 140, score: 12 }, seed: null, week: null } },
    );
    const line = byClass(RankingPanel({ model, onClose: () => undefined }), 'tt-rank-mine');
    expect(line).toHaveLength(1);
    expect(textOf(line[0])).toMatch(/Twoje miejsce: 140\..*\+12 zł/);
  });

  it('ładowanie, pusty ranking, błąd z przyciskiem ponowienia, gracz bez nicka: teksty dla gracza', async () => {
    const { client } = fakeClient({});
    const loading = createRankingModel(deps(client));
    expect(textOf(RankingPanel({ model: loading, onClose: () => undefined }))).toContain(LOADING);
    const empty = await ready({});
    expect(textOf(RankingPanel({ model: empty, onClose: () => undefined }))).toContain(EMPTY_BOARD);
    const broken = await ready({ global: { ok: false, error: 'server', message: 'Coś poszło nie tak' } });
    const tree = RankingPanel({ model: broken, onClose: () => undefined });
    expect(textOf(tree)).toContain('Coś poszło nie tak');
    const refresh = vi.spyOn(broken, 'refresh');
    click(buttons(tree).find((b) => textOf(b) === 'Spróbuj jeszcze raz')!);
    expect(refresh).toHaveBeenCalled();
    const anonymous = await ready({}, undefined, { player: () => undefined });
    expect(textOf(RankingPanel({ model: anonymous, onClose: () => undefined }))).toContain(NO_PLAYER);
  });

  it('podpisy zakładek: seed sklepu i seed tygodnia z czasem do końca tygodnia', async () => {
    const seedTab = await ready({ seed: { ok: true, board: 'seed', seed: 'pierogi-731', week: WEEK, rows: [] } }, undefined, {}, 'seed');
    expect(textOf(RankingPanel({ model: seedTab, onClose: () => undefined }))).toContain('pierogi-731');
    const weekTab = await ready({ week: { ok: true, board: 'week', seed: WEEK.seed, week: WEEK, rows: [] } }, undefined, {}, 'week');
    const text = textOf(RankingPanel({ model: weekTab, onClose: () => undefined }));
    expect(text).toContain('babka-834');
    expect(text).toContain(weekLeft(WEEK.endsAt, NOW));
  });

  it('czas do końca tygodnia po polsku', () => {
    const day = 86_400_000;
    expect(weekLeft(NOW + 5 * day, NOW)).toBe('zostało 5 dni');
    expect(weekLeft(NOW + 2 * day, NOW)).toBe('zostały 2 dni');
    expect(weekLeft(NOW + 2 * day - 1, NOW)).toBe('został 1 dzień');   // liczą się pełne doby
    expect(weekLeft(NOW + day, NOW)).toBe('został 1 dzień');
    expect(weekLeft(NOW + 3_600_000, NOW)).toBe('ostatnie godziny');
    expect(weekLeft(NOW - 1, NOW)).toBe('ostatnie godziny');
  });
});

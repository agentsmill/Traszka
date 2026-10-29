import { describe, expect, it, vi } from 'vitest';

// Testy działają bez DOM, więc podmieniamy tylko `render` z Preact: sprawdzamy, co i gdzie panel wstawia i jak go zdejmuje.
vi.mock('preact', async (importOriginal) => ({ ...(await importOriginal<typeof import('preact')>()), render: vi.fn() }));

const { render } = await import('preact');
const { RankingPanel, mountRankingPanel } = await import('./RankingPanel');
const { RecoveryPanel, mountRecoveryPanel } = await import('./RecoveryPanel');
const { createRankingModel } = await import('./rankingModel');
const { createRecoveryModel } = await import('./recoveryModel');

const client = {
  board: vi.fn(async () => ({ ok: true as const, board: 'global' as const, week: { id: '2026-W44', seed: 'babka-834', endsAt: 0 }, rows: [] })),
  player: vi.fn(), uploadSave: vi.fn(), downloadSave: vi.fn(),
};
const el = { nodeType: 1 } as unknown as Element;

describe('wstawianie paneli (mount)', () => {
  it('ranking: wstawia panel do elementu, od razu ładuje zakładkę, a funkcja zwrotna go zdejmuje', async () => {
    const model = createRankingModel({ client, player: () => undefined, seed: () => 'pierogi-731' });
    const select = vi.spyOn(model, 'select');
    const onClose = vi.fn();
    const unmount = mountRankingPanel(el, { model, onClose }, 'week');
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ type: RankingPanel, props: expect.objectContaining({ model, onClose }) }), el);
    expect(select).toHaveBeenCalledWith('week');
    unmount();
    expect(render).toHaveBeenLastCalledWith(null, el);
  });

  it('kod odzyskiwania: to samo, bez zapytań przy wstawieniu', () => {
    const model = createRecoveryModel({ client, key: () => null, adoptKey: () => null, exportSave: () => null, importSave: () => null });
    const unmount = mountRecoveryPanel(el, { model, onClose: () => undefined });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ type: RecoveryPanel }), el);
    expect(client.player).not.toHaveBeenCalled();
    unmount();
    expect(render).toHaveBeenLastCalledWith(null, el);
  });
});

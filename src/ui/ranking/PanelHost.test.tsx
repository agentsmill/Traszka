import type { VNode } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPanel, panel, unsent, type GameActions, type PanelState } from '../state';
import type { RankingClient } from './client';
import { PanelHost } from './PanelHost';
import { RankingPanel } from './RankingPanel';
import { RecoveryPanel } from './RecoveryPanel';
import { createRankingModel } from './rankingModel';
import { createRecoveryModel } from './recoveryModel';
import type { RankingServices } from './services';

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const WEEK = { id: '2026-W44', seed: 'babka-834', endsAt: Date.UTC(2026, 10, 2) };

const client = (): RankingClient => ({
  board: vi.fn(async (tab) => ({ ok: true as const, board: tab, week: WEEK, rows: [] })),
  player: vi.fn(async () => ({ ok: true as const, nicks: [] })),
  uploadSave: vi.fn(),
  downloadSave: vi.fn(),
  submitRun: vi.fn(),
});

/** Usługi, które liczą odczyty modeli: pokazują, który model dotknął host (w grze powstaje dopiero przy pierwszym odczycie). */
function countingServices() {
  const reads: string[] = [];
  const c = client();
  const ranking = createRankingModel({ client: c, player: () => ({ key: KEY, nick: 'Mateusz' }), seed: () => 'pierogi-731' });
  const recovery = createRecoveryModel({
    client: c, key: () => KEY, adoptKey: () => null, exportSave: () => null, stageSave: () => null, reload: () => undefined,
    sync: { get: () => null, set: () => undefined },
  });
  const services: RankingServices = {
    get rankingModel() { reads.push('ranking'); return ranking; },
    get recoveryModel() { reads.push('recovery'); return recovery; },
    dispose: () => undefined,
  };
  return { services, reads, ranking, recovery, client: c };
}

const game = (over: Partial<Pick<GameActions, 'openFinish'>> = {}): Pick<GameActions, 'openFinish'> => ({ openFinish: vi.fn(), ...over });
const vnode = (tree: unknown): VNode<Record<string, unknown>> => tree as VNode<Record<string, unknown>>;

beforeEach(() => {
  panel.value = null;
  unsent.value = null;
});
afterEach(() => {
  panel.value = null;
  unsent.value = null;
  vi.restoreAllMocks();
});

describe('PanelHost: który panel i z jakim modelem', () => {
  it('bez otwartego panelu albo bez usług (benchmark, brak powłoki) nie pokazuje nic', () => {
    const { services, reads } = countingServices();
    expect(PanelHost({ game: game(), services })).toBeNull();
    openPanel('ranking', 'global');
    expect(PanelHost({ game: game(), services: null })).toBeNull();
    expect(reads).toEqual([]);   // dopóki nic się nie pokazuje, modele nie są budowane
  });

  it('panel „ranking” to RankingPanel z modelem rankingu; modelu kodu odzyskiwania host nie rusza', () => {
    const { services, reads, ranking } = countingServices();
    openPanel('ranking', 'global');
    const tree = vnode(PanelHost({ game: game(), services }));
    expect(tree.type).toBe(RankingPanel);
    expect(tree.props.model).toBe(ranking);
    expect(reads).toEqual(['ranking']);
  });

  it('panel „recovery” to RecoveryPanel z modelem kodu odzyskiwania; modelu rankingu host nie rusza', () => {
    const { services, reads, recovery } = countingServices();
    openPanel('recovery');
    const tree = vnode(PanelHost({ game: game(), services }));
    expect(tree.type).toBe(RecoveryPanel);
    expect(tree.props.model).toBe(recovery);
    expect(reads).toEqual(['recovery']);
  });

  it('zamknięcie panelu (✕, tło) czyści sygnał, a host znów nic nie pokazuje', () => {
    const { services } = countingServices();
    for (const id of ['ranking', 'recovery'] as const) {
      openPanel(id, id === 'ranking' ? 'global' : undefined);
      const tree = vnode(PanelHost({ game: game(), services }));
      (tree.props.onClose as () => void)();
      expect(panel.value).toBeNull();
      expect(PanelHost({ game: game(), services })).toBeNull();
    }
  });
});

describe('PanelHost: niewysłany bieg w panelu rankingu', () => {
  it('bez niewysłanego biegu panel nie dostaje banera; z nim dostaje wynik i seed', () => {
    const { services } = countingServices();
    openPanel('ranking', 'global');
    expect(vnode(PanelHost({ game: game(), services })).props.unsent ?? null).toBeNull();
    unsent.value = { seed: 'pierogi-731', score: 12_345 };
    expect(vnode(PanelHost({ game: game(), services })).props.unsent).toEqual({ seed: 'pierogi-731', score: 12_345 });
  });

  it('„Wyślij” najpierw zamyka panel, potem otwiera okno wysyłki (okno końca sezonu leży nad panelem, ale panel nie zostaje pod nim)', () => {
    const { services } = countingServices();
    unsent.value = { seed: 'pierogi-731', score: 12_345 };
    openPanel('ranking', 'global');
    const seenByFinish: Array<PanelState | null> = [];
    const actions = game({ openFinish: vi.fn(() => { seenByFinish.push(panel.value); }) });
    const tree = vnode(PanelHost({ game: actions, services }));
    (tree.props.onSendUnsent as () => void)();
    expect(actions.openFinish).toHaveBeenCalledTimes(1);
    expect(seenByFinish).toEqual([null]);
    expect(panel.value).toBeNull();
  });
});

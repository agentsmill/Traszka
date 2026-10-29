import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRecoveryCode } from '@/game/playerKey';
import { closePanel, openPanel, panel, unsent, type GameActions, type PanelState } from '../state';
import type { RankingClient } from './client';
import { PanelHost, bindPanelOpen } from './PanelHost';
import { RankingPanel } from './RankingPanel';
import { RecoveryPanel } from './RecoveryPanel';
import { createRankingModel } from './rankingModel';
import { createRecoveryModel } from './recoveryModel';
import type { RankingServices } from './services';

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const OTHER = 'M2N3P4Q5R6S7T8V9W0XY';
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

describe('bindPanelOpen: dane przy każdym otwarciu panelu', () => {
  it('panel rankingu ładuje zakładkę z sygnału (domyślnie „Globalny”), także przy ponownym otwarciu', () => {
    const { services, ranking } = countingServices();
    const select = vi.spyOn(ranking, 'select');
    const stop = bindPanelOpen(services, panel);
    expect(select).not.toHaveBeenCalled();
    openPanel('ranking', 'seed');
    expect(select).toHaveBeenLastCalledWith('seed');
    closePanel();
    expect(select).toHaveBeenCalledTimes(1);
    openPanel('ranking');
    expect(select).toHaveBeenLastCalledWith('global');
    closePanel();
    openPanel('ranking', 'seed');
    expect(select).toHaveBeenCalledTimes(3);
    stop();
  });

  it('panel już otwarty w chwili podpięcia też się ładuje', () => {
    const { services, ranking } = countingServices();
    const select = vi.spyOn(ranking, 'select');
    openPanel('ranking', 'week');
    bindPanelOpen(services, panel)();
    expect(select).toHaveBeenCalledWith('week');
  });

  it('zmiana zakładki w otwartym panelu nie wywołuje ponownego ładowania z sygnału', async () => {
    const { services, ranking } = countingServices();
    const select = vi.spyOn(ranking, 'select');
    const stop = bindPanelOpen(services, panel);
    openPanel('ranking', 'global');
    await ranking.select('week');   // gracz klika zakładkę w panelu
    expect(select.mock.calls.map((c) => c[0])).toEqual(['global', 'week']);
    stop();
  });

  it('panel kodu odzyskiwania niczego nie pobiera, a wchodzi czysty: kod zakryty, pole puste, pytanie zdjęte', async () => {
    const { services, ranking, recovery, client: c } = countingServices();
    const select = vi.spyOn(ranking, 'select');
    const stop = bindPanelOpen(services, panel);
    recovery.toggleReveal();
    recovery.setInput(formatRecoveryCode(OTHER));
    await recovery.submitCode();
    expect(recovery.revealed.value).toBe(true);
    expect(recovery.confirm.value).toMatchObject({ kind: 'adopt' });
    openPanel('recovery');
    expect(recovery.revealed.value).toBe(false);
    expect(recovery.input.value).toBe('');
    expect(recovery.confirm.value).toBeNull();
    expect(select).not.toHaveBeenCalled();
    expect(c.board).not.toHaveBeenCalled();
    expect(c.player).not.toHaveBeenCalled();
    stop();
  });

  it('odpięty nasłuch przestaje reagować', () => {
    const { services, ranking } = countingServices();
    const select = vi.spyOn(ranking, 'select');
    bindPanelOpen(services, panel)();
    openPanel('ranking', 'global');
    expect(select).not.toHaveBeenCalled();
  });

  it('dowolny sygnał z panelem (nie tylko globalny) i modele tworzone leniwie: dotyka tylko otwartego', () => {
    const { services, reads } = countingServices();
    const own = signal<PanelState | null>(null);
    const stop = bindPanelOpen(services, own);
    expect(reads).toEqual([]);
    own.value = { id: 'recovery' };
    expect(reads).toEqual(['recovery']);
    own.value = { id: 'ranking', tab: 'global' };
    expect(reads).toEqual(['recovery', 'ranking']);
    stop();
  });
});

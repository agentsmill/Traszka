import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIORITY_LABEL, createEconomy, nextRemont, upgradeBlocker, type CommandResult, type EconomyState } from '@/sim/economy/economy';
import type { Command } from '@/sim/economy/commands';
import { questMetric } from '@/sim/economy/quests';
import { computeStoreInfo, type PalletLoc, type StoreInfo } from '@/sim/economy/storeInfo';
import { EQUIPMENT, UPGRADES } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import { metaView, type GameActions } from '../state';
import { GoalsPanel, PalletItem, PalletsPanel, PeoplePanel, ShopPanel } from './panels';
import { buttonAria, buttonLabelled, buttonsOf, click, labels, sectionTitled, textOf, walk } from './vnodeTree';

/** Atrapa `GameActions`: panele tylko wysyłają polecenia, więc liczy się wyłącznie `dispatch`. */
function fakeGame(): GameActions & { dispatch: ReturnType<typeof vi.fn<(cmd: Command) => CommandResult>> } {
  return {
    dispatch: vi.fn<(cmd: Command) => CommandResult>(() => ({ ok: true })),
    claimWelcome: vi.fn(), openNextStore: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
  };
}

/** Gra z pieniędzmi, poziomem i Ogonkami na wszystko, żeby żaden przycisk nie miał blokady z powodu stanu. */
function rich(): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor('panele', 0));
  const s = createEconomy('panele', info);
  s.cash = 1e7;
  s.level = 30;
  s.ogonki = 500;
  return { s, info };
}

afterEach(() => { metaView.value = { points: 0, stores: 0, networkIncome: 0, network: [], sound: true, vibration: true }; });

describe('panele wysyłają polecenia przez game.dispatch, a nie wołają symulacji', () => {
  it('paleta: „Rozładuj” wysyła tapPallet z id, przesunięcia movePallet z miejscem, „Odeślij” returnPallet', () => {
    const { s, info } = rich();
    const p = s.pallets[0]!;
    const game = fakeGame();
    const tree = PalletItem({ s, info, id: p.id, game });
    click(buttonLabelled(tree, 'Rozładuj'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'tapPallet', palletId: p.id });
    const moves: [string, PalletLoc][] = [['Na zaplecze', 'backroom'], ['Do sali', 'floor'], ['Pod sklep', 'sidewalk']];
    const offered = moves.filter(([, loc]) => loc !== p.loc);
    expect(offered).toHaveLength(2);   // każde miejsce poza obecnym
    for (const [label, loc] of offered) {
      click(buttonLabelled(tree, label));
      expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'movePallet', palletId: p.id, loc });
    }
    click(buttonLabelled(tree, 'Odeślij'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'returnPallet', palletId: p.id });
    expect(game.dispatch).toHaveBeenCalledTimes(4);
    expect(labels(PalletItem({ s, info, id: p.id, game, compact: true }))).not.toContain('Odeślij');   // karta zaznaczenia nie odsyła
  });

  it('zamówienie: asystent, ręcznie (z bieżącą liczbą) i krok − / + wysyłają setOrder', () => {
    const { s, info } = rich();
    const game = fakeGame();
    s.order = { auto: true, manual: 3 };
    const auto = PalletsPanel({ s, info, game, v: 1 });
    click(buttonLabelled(auto, 'Asystent Traszki'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'setOrder', auto: true });
    click(buttonLabelled(auto, 'Ręcznie'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'setOrder', auto: false, manual: 3 });
    s.order = { auto: false, manual: 3 };
    const manual = PalletsPanel({ s, info, game, v: 1 });
    click(buttonAria(manual, 'Mniej'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'setOrder', auto: false, manual: 2 });
    click(buttonAria(manual, 'Więcej'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'setOrder', auto: false, manual: 4 });
    expect(game.dispatch).toHaveBeenCalledTimes(4);
  });

  it('ludzie: zatrudnij, zwolnij i priorytet pracy', () => {
    const { s, info } = rich();
    const game = fakeGame();
    const tree = PeoplePanel({ s, info, game, v: 1 });
    click(buttonAria(tree, 'Zatrudnij'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'hire' });
    click(buttonAria(tree, 'Zwolnij'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'fire' });
    for (const priority of ['klienci', 'rowno', 'palety'] as const) {
      click(buttonLabelled(tree, PRIORITY_LABEL[priority]));
      expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'setPriority', priority });
    }
    expect(game.dispatch).toHaveBeenCalledTimes(5);
  });

  it('ulepszenia: przycisk „Kup” ulepszenia wysyła buyUpgrade z id', () => {
    const { s, info } = rich();
    const u = UPGRADES[0]!;
    expect(upgradeBlocker(s, u)).toBeNull();   // przycisk jest aktywny w tym stanie
    const game = fakeGame();
    const tree = ShopPanel({ s, info, game, v: 1 });
    const row = walk(tree).find((v) => v.key === u.id)!;
    click(buttonsOf(row)[0]!);
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'buyUpgrade', id: u.id });
  });

  it('ulepszenia: sprzęt bez slotu (buyEquipment), remont (startRemont) i kampania (campaign)', () => {
    const { s, info } = rich();
    const game = fakeGame();
    const tree = ShopPanel({ s, info, game, v: 1 });
    const equipment = EQUIPMENT[0]!;
    click(buttonsOf(sectionTitled(tree, 'Sprzęt do slotów'))[0]!);
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'buyEquipment', id: equipment.id });
    expect(Object.hasOwn(game.dispatch.mock.lastCall![0], 'slotId')).toBe(false);   // slot wybiera dopiero karta slotu
    expect(nextRemont(s)).not.toBeNull();
    click(buttonsOf(sectionTitled(tree, 'Remont generalny'))[0]!);
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'startRemont' });
    click(buttonLabelled(tree, '30 🦎'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'campaign' });
    expect(game.dispatch).toHaveBeenCalledTimes(3);
  });

  it('ulepszenia: w trakcie remontu przycisk „Przyspiesz o dzień” wysyła rushRemont', () => {
    const { s, info } = rich();
    s.remontUntil = s.minute + 1000;   // sklep zamknięty na remont
    const game = fakeGame();
    const tree = ShopPanel({ s, info, game, v: 1 });
    expect(textOf(sectionTitled(tree, 'Remont generalny'))).toContain('Remont trwa jeszcze');
    click(buttonLabelled(tree, 'Przyspiesz o dzień (40 🦎)'));
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'rushRemont' });
  });

  it('cele: „Odbierz!” wysyła claimQuest z id zlecenia', () => {
    const { s } = rich();
    const q = s.quests[0]!;
    q.start = questMetric(s, q.kind) - q.target - 1;   // cel już spełniony
    const game = fakeGame();
    const tree = GoalsPanel({ s, game, v: 1 });
    click(buttonLabelled(tree, 'Odbierz!'));
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'claimQuest', questId: q.id });
  });
});

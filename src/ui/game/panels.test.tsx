import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEconomy, nextRemont, upgradeBlocker, type CommandResult, type EconomyState } from '@/sim/economy/economy';
import type { Command } from '@/sim/economy/commands';
import { kpiTitle } from '@/sim/economy/tycoon/kpi';
import { PROFILE_HINT, PROFILE_LABEL, STAFF_PROFILES } from '@/sim/economy/tycoon/staff';
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

  it('ludzie: zatrudnij, zwolnij i profil pracy', () => {
    const { s, info } = rich();
    const game = fakeGame();
    const tree = PeoplePanel({ s, info, game, v: 1 });
    click(buttonAria(tree, 'Zatrudnij'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'hire' });
    click(buttonAria(tree, 'Zwolnij'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'fire' });
    for (const profile of STAFF_PROFILES) {
      click(buttonLabelled(tree, PROFILE_LABEL[profile]));
      expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'setStaffProfile', profile });
    }
    expect(game.dispatch).toHaveBeenCalledTimes(5);
  });

  it('ludzie: aktywny profil ma klasę on i swoją podpowiedź, własna kolejność nie zapala żadnego przycisku', () => {
    const { s, info } = rich();
    const game = fakeGame();
    for (const profile of STAFF_PROFILES) {
      s.tycoon.staff.profile = profile;
      const tree = PeoplePanel({ s, info, game, v: 1 });
      for (const other of STAFF_PROFILES) {
        const on = String(buttonLabelled(tree, PROFILE_LABEL[other]).props.class).split(' ').includes('on');
        expect(on, `${profile} / ${other}`).toBe(other === profile);
      }
      expect(textOf(tree)).toContain(PROFILE_HINT[profile]);
    }
    s.tycoon.staff.profile = 'wlasny';
    const own = PeoplePanel({ s, info, game, v: 1 });
    expect(buttonsOf(own).filter((b) => String(b.props.class).split(' ').includes('on'))).toHaveLength(0);
    expect(textOf(own)).toContain(PROFILE_LABEL.wlasny);
  });

  it('ludzie: automatyka z warsztatu widoczna po zakupie, a bez niej sekcji nie ma', () => {
    const { s, info } = rich();
    const game = fakeGame();
    expect(textOf(PeoplePanel({ s, info, game, v: 1 }))).not.toContain('Automatyka');
    s.upgrades.tasmociag = 2;
    const tree = PeoplePanel({ s, info, game, v: 1 });
    expect(textOf(tree)).toContain('Automatyka');
    expect(walk(tree).some((v) => v.props.label === 'Taśmociąg')).toBe(true);   // etykieta wiersza to prop, nie dziecko
  });

  it('palety: rozładunek teraz pokazuje pracę ludzi z ostatniej minuty i automatykę', () => {
    const { s, info } = rich();
    const game = fakeGame();
    s.shift = { staff: 2, human: { kasa: 0, rozladunek: 1.5, wykladanie: 0, sprzatanie: 0 } };
    expect(textOf(PalletsPanel({ s, info, game, v: 1 }))).toContain('~540 szt./h (1,5 os.)');
    s.upgrades.tasmociag = 1;
    expect(textOf(PalletsPanel({ s, info, game, v: 1 }))).toContain('+ automatyka');
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

  it('cele: KPI tygodnia pokazuje tytuł celu i postęp, a nie ma już zleceń do odbioru', () => {
    const { s } = rich();
    Object.assign(s.tycoon.kpi, { kind: 'klienci', target: 400, start: { ...s.tycoon.kpi.start, customers: s.total.customers - 100 } });
    const game = fakeGame();
    const tree = GoalsPanel({ s, game, v: 1 });
    const section = sectionTitled(tree, 'KPI tygodnia');
    const plain = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, ' ');
    expect(plain(textOf(section))).toContain(plain(kpiTitle('klienci', 400, (n) => Math.round(n).toLocaleString('pl-PL'))));
    expect(textOf(section)).toContain('25%');                       // 100 z 400 klientów
    expect(labels(tree)).not.toContain('Odbierz!');
    expect(() => sectionTitled(tree, 'Zlecenia Centrali')).toThrow();
    expect(game.dispatch).not.toHaveBeenCalled();
  });

  it('cele: premie Centrali wchodzą do marży i do wyniku miesiąca (osobny licznik bonus)', () => {
    const { s } = rich();
    Object.assign(s.today, { margin: 1000, other: 200, bonus: 300 });
    Object.assign(s.month, { margin: 10_000, other: 500, bonus: 700, wages: 2000, media: 600, fines: 100, logistics: 200, wut: 150 });
    const tree = GoalsPanel({ s, game: fakeGame(), v: 1 });
    const value = (section: string, label: string): string => {
      const row = walk(sectionTitled(tree, section)).find((v) => v.props.label === label);
      return textOf(row!).replace(/[\s\u00a0\u202f]/g, '');
    };
    expect(value('Dziś', 'Marża i premie (Twój przychód)')).toBe('1500zł');
    expect(value('Ten miesiąc', 'Marża i premie')).toBe('11200zł');
    expect(value('Ten miesiąc', 'WUT ponad próg')).toBe('−150zł');
    expect(value('Ten miesiąc', 'Wynik (przed opłatą franczyzową)')).toBe('+8150zł');
  });
});

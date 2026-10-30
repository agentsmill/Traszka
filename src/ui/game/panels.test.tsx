import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEBT_LIMIT, WAGE_PER_DAY } from '@/sim/economy/catalog';
import { DEBT_WARN, LOC_LABEL, createEconomy, debtWarningText, franchiseFee, freeSpots, kpiScaleOf, nextRemont, upgradeBlocker, type CommandResult, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import type { Command } from '@/sim/economy/commands';
import { KPI, KPI_FLAVOR, kpiTitle } from '@/sim/economy/tycoon/kpi';
import { dayOfMinute, roundNice } from '@/sim/economy/tycoon/time';
import { MILESTONES } from '@/sim/economy/milestones';
import { staffOnShift } from '@/sim/economy/tycoon/shift';
import { PROFILE_HINT, PROFILE_LABEL, STAFF_PROFILES, STAFF_TASKS, TASK_LABEL, type StaffTask } from '@/sim/economy/tycoon/staff';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { WUT, wutTotal } from '@/sim/economy/tycoon/wut';
import { WEATHER_LABEL } from '@/sim/economy/tycoon/cleanliness';
import { computeStoreInfo, type PalletLoc, type StoreInfo } from '@/sim/economy/storeInfo';
import { EQUIPMENT, UPGRADES } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import { econ, metaView, ranked, speed, tab, type GameActions } from '../state';
import { Bar, GoalsPanel, PalletItem, PalletsPanel, PeoplePanel, ShopPanel, StorePanel, TabBar } from './panels';
import { plural, zl } from './format';
import { buttonAria, buttonLabelled, buttonsOf, click, labels, sectionTitled, textOf, walk, type Vnode } from './vnodeTree';

/** Atrapa `GameActions`: panele tylko wysyłają polecenia, więc liczy się wyłącznie `dispatch`. */
function fakeGame(): GameActions & { dispatch: ReturnType<typeof vi.fn<(cmd: Command) => CommandResult>> } {
  return {
    dispatch: vi.fn<(cmd: Command) => CommandResult>(() => ({ ok: true })),
    claimWelcome: vi.fn(), openNextStore: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
    startRanked: vi.fn(() => false), resumeRanked: vi.fn(() => false), leaveRanked: vi.fn(), abandonRanked: vi.fn(),
    openFinish: vi.fn(), rememberNick: vi.fn(),
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

afterEach(() => {
  econ.value = null;
  tab.value = null;
  metaView.value = { points: 0, stores: 0, networkIncome: 0, network: [], sound: true, vibration: true };
  speed.value = 1;
  ranked.value = null;
});

describe('panele wysyłają polecenia przez game.dispatch, a nie wołają symulacji', () => {
  it('paleta: „Rozładuj” wysyła tapPallet z id, a przesunięcia movePallet z miejscem; „Odeślij” nie ma (palet nikt nie odsyła)', () => {
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
    expect(game.dispatch).toHaveBeenCalledTimes(3);
    for (const compact of [false, true]) {
      const buttons = labels(PalletItem({ s, info, id: p.id, game, compact }));
      expect(buttons, `compact ${compact}`).not.toContain('Odeślij');
      expect(buttons.join('|'), `compact ${compact}`).not.toMatch(/odeśl/i);
    }
    expect(game.dispatch.mock.calls.some(([cmd]) => cmd.type === 'returnPallet')).toBe(false);
  });

  describe('paleta w przejściu (nadmiar, który postawił kierowca)', () => {
    /** Paleta nr 0 postawiona w przejściu; reszta palet zostaje tam, gdzie była. */
    function inAisle(): { s: EconomyState; info: StoreInfo; id: number } {
      const { s, info } = rich();
      const p = s.pallets[0]!;
      Object.assign(p, { loc: 'aisle', spot: 0 });
      return { s, info, id: p.id };
    }

    it('przenosiny nigdy nie mają przejść za cel, ale paletę z przejścia da się przenieść na każde zwykłe miejsce', () => {
      const { s, info, id } = inAisle();
      const game = fakeGame();
      const target = { 'Na zaplecze': 'backroom', 'Do sali': 'floor', 'Pod sklep': 'sidewalk' } as const;
      for (const loc of ['sidewalk', 'backroom', 'floor', 'aisle'] as const) {
        s.pallets.find((x) => x.id === id)!.loc = loc;
        const moves = labels(PalletItem({ s, info, id, game })).filter((b) => b !== 'Rozładuj');
        expect(moves.sort(), loc).toEqual(Object.keys(target).filter((label) => target[label as keyof typeof target] !== loc).sort());   // wszystkie zwykłe miejsca poza obecnym
        expect(moves.join('|'), loc).not.toMatch(/przej/i);
      }
      s.pallets.find((x) => x.id === id)!.loc = 'aisle';
      const tree = PalletItem({ s, info, id, game });
      for (const [label, loc] of [['Na zaplecze', 'backroom'], ['Do sali', 'floor'], ['Pod sklep', 'sidewalk']] as const) {
        const button = buttonLabelled(tree, label);
        expect(button.props.disabled, label).toBe(freeSpots(s, info, loc) === 0);
        if (freeSpots(s, info, loc) > 0) {
          click(button);
          expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'movePallet', palletId: id, loc });
        }
      }
      expect(game.dispatch.mock.calls.every(([cmd]) => cmd.type === 'movePallet' && cmd.loc !== 'aisle')).toBe(true);
    });

    it('ma wyróżnienie ostrzegawcze z ⚠️ jak paleta pod sklepem, a zwykła paleta w sali go nie ma', () => {
      const { s, info, id } = inAisle();
      const game = fakeGame();
      const classes = (tree: Vnode): string[] => String(tree.props.class).split(' ');
      const aisle = PalletItem({ s, info, id, game }) as Vnode;
      expect(classes(aisle)).toContain('risk');
      expect(textOf(aisle)).toContain(`${LOC_LABEL.aisle} ⚠️`);
      expect(textOf(aisle)).toContain('potykają');   // krótkie wyjaśnienie, czemu to źle
      const compact = PalletItem({ s, info, id, game, compact: true }) as Vnode;
      expect(classes(compact)).toContain('risk');
      expect(textOf(compact)).toContain('⚠️');
      expect(textOf(compact)).not.toContain('potykają');   // karta zaznaczenia jest krótka

      s.pallets.find((x) => x.id === id)!.loc = 'sidewalk';
      expect(classes(PalletItem({ s, info, id, game }) as Vnode)).toContain('risk');
      s.pallets.find((x) => x.id === id)!.loc = 'floor';
      const hall = PalletItem({ s, info, id, game }) as Vnode;
      expect(classes(hall)).not.toContain('risk');
      expect(textOf(hall)).not.toContain('⚠️');
    });

    it('sekcja „Palety”: przy wolnych miejscach liczba palet w przejściach (tylko gdy są), a podpowiedź mówi o potykaniu', () => {
      const { s, info } = inAisle();
      const game = fakeGame();
      const spots = (): string => textOf(walk(PalletsPanel({ s, info, game, v: 1 })).find((v) => v.props.label === 'Wolne miejsca')!);
      expect(spots()).toContain('w przejściach 1 paleta');
      for (let i = 1; i <= 4; i++) s.pallets.push({ ...s.pallets[0]!, id: 900 + i, spot: i });
      expect(spots()).toContain('w przejściach 5 palet');
      for (const p of s.pallets) if (p.loc === 'aisle') p.loc = 'floor';
      expect(spots()).not.toContain('przejściach');
      const hint = textOf(sectionTitled(PalletsPanel({ s, info, game, v: 1 }), `Palety (${s.pallets.length})`));
      expect(hint).toContain('Nadmiar staje w przejściach, a klienci się o niego potykają');
      expect(hint).not.toMatch(/odeśl/i);
    });
  });

  it('znaczniki zakładek: Palety liczą palety pod sklepem i w przejściach, Cele kamienie milowe do odebrania', () => {
    const { s, info } = rich();
    s.pallets.length = 0;
    const pallet = (id: number, loc: PalletLoc): EconomyState['pallets'][number] => ({
      id, loc, spot: 0, items: { ...rich().s.pallets[0]!.items }, total: 10, initial: 10, since: s.minute,
    });
    s.pallets.push(pallet(1, 'sidewalk'), pallet(2, 'aisle'), pallet(3, 'aisle'), pallet(4, 'floor'), pallet(5, 'backroom'));
    s.milestonesReady = ['pallet1', 'cust500'];
    econ.value = { s, info, v: 1 };
    const badges = (): Record<string, string> => Object.fromEntries(
      walk(TabBar()).filter((v) => v.props.class === 'tt-tab').map((tab) => [textOf(walk(tab).find((v) => v.props.class === 'tt-tab-label')!), textOf(walk(tab).find((v) => v.props.class === 'tt-badge') ?? '')]),
    );
    expect(badges()).toMatchObject({ Palety: '3', Cele: '2' });
    s.pallets.length = 0;
    s.milestonesReady = [];
    expect(badges().Palety).toBe('');
    expect(badges().Cele).toBe('');
  });

  it('„Rozładuj” ma tę samą blokadę co przycisk klikera: brak sił, pauza i karta czekająca na odpowiedź', () => {
    const { s, info } = rich();
    const p = s.pallets[0]!;
    const unload = (): Vnode => buttonLabelled(PalletItem({ s, info, id: p.id, game: fakeGame() }), 'Rozładuj');
    expect(unload().props.disabled).toBe(false);   // pełne siły, gra idzie, brak karty
    expect(unload().props.title).toBeUndefined();

    s.tycoon.fatigue.energy = 1;   // paleta kosztuje 2,5
    expect(unload().props.disabled).toBe(true);
    expect(unload().props.title).toBe('Ręce odmawiają, odpocznij do jutra');
    s.tycoon.fatigue.energy = 100;

    speed.value = 0;
    expect(unload().props.disabled).toBe(true);
    expect(unload().props.title).toBe('Gra wstrzymana: wznów czas');
    speed.value = 1;

    s.tycoon.cards.pending.push({ seq: 1, id: 'fefo', day: 0, showAt: s.minute, params: {}, answers: [], defaultAnswer: 0 });
    expect(unload().props.disabled).toBe(true);
    expect(unload().props.title).toBe('Najpierw odpowiedz na kartę decyzji');
  });

  it('blokada „Rozładuj” nie rusza przycisków przenoszenia (to nie są stuknięcia)', () => {
    const { s, info } = rich();
    s.tycoon.fatigue.energy = 0;
    const p = s.pallets[0]!;
    const tree = PalletItem({ s, info, id: p.id, game: fakeGame() });
    expect(buttonLabelled(tree, 'Rozładuj').props.disabled).toBe(true);
    for (const [label, loc] of [['Na zaplecze', 'backroom'], ['Do sali', 'floor'], ['Pod sklep', 'sidewalk']] as const) {
      if (loc !== p.loc) expect(buttonLabelled(tree, label).props.disabled, label).toBe(freeSpots(s, info, loc) === 0);
    }
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
    s.shift = { staff: 2, human: { kasa: 0, rozladunek: 1.5, wykladanie: 0, sprzatanie: 0 }, people: ['rozladunek', 'rozladunek'] };
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
    const { s, info } = rich();
    Object.assign(s.tycoon.kpi, { kind: 'klienci', target: 400, start: { ...s.tycoon.kpi.start, customers: s.total.customers - 100 } });
    const game = fakeGame();
    const tree = GoalsPanel({ s, info, game, v: 1 });
    const section = sectionTitled(tree, 'KPI tygodnia');
    const plain = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, ' ');
    expect(plain(textOf(section))).toContain(plain(kpiTitle('klienci', 400, (n) => Math.round(n).toLocaleString('pl-PL'))));
    expect(textOf(section)).toContain('25%');                       // 100 z 400 klientów
    expect(labels(tree)).not.toContain('Odbierz!');
    expect(() => sectionTitled(tree, 'Zlecenia Centrali')).toThrow();
    expect(game.dispatch).not.toHaveBeenCalled();
  });

  describe('cele: KPI tygodnia, dni do niedzieli i nagroda', () => {
    const plain = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, ' ');
    const kpiSection = (daysLeft: number): { text: string; s: EconomyState; info: StoreInfo; section: Vnode } => {
      const { s, info } = rich();
      s.minute = 20 * 24 * 60 + 12 * 60;
      Object.assign(s.tycoon.kpi, { kind: 'kawy', target: 150, toDay: dayOfMinute(s.minute) + daysLeft });
      const section = sectionTitled(GoalsPanel({ s, info, game: fakeGame(), v: 1 }), 'KPI tygodnia');
      return { text: plain(textOf(section)), s, info, section };
    };

    it('tytuł celu, tekst Centrali i pasek postępu z kpiProgress', () => {
      const { text, section } = kpiSection(3);
      expect(text).toContain(plain(kpiTitle('kawy', 150, (n) => Math.round(n).toLocaleString('pl-PL'))));
      expect(text).toContain(KPI_FLAVOR.kawy);
      expect(walk(section).some((v) => v.type === Bar)).toBe(true);
    });

    it('„do niedzieli: N dni” liczy dni od dziś do ostatniego dnia tygodnia, z odmianą i dzisiejszą niedzielą', () => {
      expect(kpiSection(3).text).toContain('do niedzieli: 3 dni');
      expect(kpiSection(2).text).toContain('do niedzieli: 2 dni');
      expect(kpiSection(1).text).toContain('do niedzieli: 1 dzień');
      expect(kpiSection(0).text).toContain('do niedzieli: dziś');
      expect(kpiSection(5).text).toContain('do niedzieli: 5 dni');
    });

    it('nagroda: zaufanie +3, premia ok. (część marży dnia) i XP za poziom', () => {
      const { text, s, info } = kpiSection(3);
      const bonus = roundNice(KPI.bonusShare * kpiScaleOf(s, info).dailyMargin);
      expect(bonus).toBeGreaterThan(0);
      expect(text).toContain(`zaufanie +${KPI.trustHit}`);
      expect(text).toContain(`premia ok. ${plain(zl(bonus))}`);
      expect(text).toContain(`+${KPI.xpBase + KPI.xpPerLevel * s.level} XP`);   // poziom 30: 340
    });

    it('XP w nagrodzie idzie za poziom gracza', () => {
      const low = kpiSection(3);
      low.s.level = 2;
      const lowText = plain(textOf(sectionTitled(GoalsPanel({ s: low.s, info: low.info, game: fakeGame(), v: 1 }), 'KPI tygodnia')));
      expect(lowText).toContain(`+${KPI.xpBase + KPI.xpPerLevel * 2} XP`);
      expect(lowText).not.toContain(`+${KPI.xpBase + KPI.xpPerLevel * 30} XP`);
    });

    it('kara za nietrafiony cel jest w podpowiedzi, a rozliczenie w niedzielę', () => {
      const { text } = kpiSection(3);
      expect(text).toContain('niedzielę');
      expect(text).toContain(`zaufanie −${-KPI.trustMiss}`);
    });
  });

  it('cele: kamienie milowe zostają pod KPI i poziomem', () => {
    const { s, info } = rich();
    const titles = walk(GoalsPanel({ s, info, game: fakeGame(), v: 1 })).filter((v) => typeof v.props.title === 'string').map((v) => v.props.title);
    expect(titles.indexOf('KPI tygodnia')).toBe(0);
    expect(titles.indexOf('Kamienie milowe')).toBeGreaterThan(titles.indexOf('KPI tygodnia'));
  });

  describe('cele: kamienie milowe do odebrania (przycisk „Odbierz”)', () => {
    const ids = (list: readonly { id: string }[]): string[] => list.map((m) => m.id);
    const goalRows = (tree: Vnode): Vnode[] => walk(sectionTitled(tree, 'Kamienie milowe')).filter((v) => String(v.props.class).split(' ').includes('tt-goal'));

    it('spełnione cele są na górze z oznaczeniem „Do odebrania” i przyciskiem „Odbierz”, który wysyła claimMilestone z id', () => {
      const { s, info } = rich();
      s.milestonesReady = ['cust500', 'pallet1'];
      const game = fakeGame();
      const tree = GoalsPanel({ s, info, game, v: 1 }) as Vnode;
      const rows = goalRows(tree);
      expect(rows.slice(0, 2).map((r) => String(r.props.class).split(' ').includes('ready'))).toEqual([true, true]);
      expect(rows.slice(2).some((r) => String(r.props.class).split(' ').includes('ready'))).toBe(false);
      // kolejność listy celów (nie kolejność spełnienia), żeby panel nie skakał
      expect(rows.slice(0, 2).map((r) => textOf(r))).toEqual([
        expect.stringContaining(MILESTONES.find((m) => m.id === 'pallet1')!.label), expect.stringContaining(MILESTONES.find((m) => m.id === 'cust500')!.label),
      ]);
      for (const r of rows.slice(0, 2)) expect(textOf(r)).toContain('🎁 Do odebrania');
      expect(rows.slice(2).map((r) => textOf(r)).join('|')).not.toContain('Do odebrania');

      const claims = buttonsOf(tree).filter((b) => textOf(b) === 'Odbierz');
      expect(claims).toHaveLength(2);
      for (const id of ['pallet1', 'cust500']) {
        const label = MILESTONES.find((m) => m.id === id)!.label;
        click(buttonAria(tree, `Odbierz: ${label}`));
        expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'claimMilestone', id });
      }
      expect(game.dispatch).toHaveBeenCalledTimes(2);
    });

    it('lista następnych celów pomija i odebrane, i gotowe, a licznik „Zdobyte” liczy tylko odebrane', () => {
      const { s, info } = rich();
      s.milestones = ['pallet1'];
      s.milestonesReady = ['upgrade1', 'sco1'];
      const tree = GoalsPanel({ s, info, game: fakeGame(), v: 1 }) as Vnode;
      const rows = goalRows(tree);
      const upcoming = rows.filter((r) => !String(r.props.class).split(' ').includes('ready'));
      const expected = ids(MILESTONES).filter((id) => !s.milestones.includes(id) && !s.milestonesReady.includes(id)).slice(0, 3);
      expect(expected).toEqual(['cust500', 'staff3', 'earned10k']);
      expect(upcoming.map((r) => r.key)).toEqual(expected);
      expect(rows).toHaveLength(2 + 3);
      for (const id of ['pallet1', 'upgrade1', 'sco1']) {
        const label = MILESTONES.find((m) => m.id === id)!.label;
        expect(upcoming.map((r) => textOf(r)).join('|'), id).not.toContain(label);
      }
      expect(textOf(sectionTitled(tree, 'Kamienie milowe'))).toContain(`Zdobyte: 1 / ${MILESTONES.length}`);
    });

    it('bez celów do odebrania nie ma przycisku „Odbierz” ani oznaczenia, a trzy najbliższe cele są jak dotąd', () => {
      const { s, info } = rich();
      s.milestones = ['pallet1'];
      const tree = GoalsPanel({ s, info, game: fakeGame(), v: 1 }) as Vnode;
      expect(labels(tree)).not.toContain('Odbierz');
      expect(textOf(tree)).not.toContain('Do odebrania');
      expect(goalRows(tree).map((r) => r.key)).toEqual(['upgrade1', 'cust500', 'sco1']);
    });
  });

  it('cele: premie Centrali wchodzą do marży i do wyniku miesiąca (osobny licznik bonus)', () => {
    const { s, info } = rich();
    Object.assign(s.today, { margin: 1000, other: 200, bonus: 300 });
    Object.assign(s.month, { revenue: 90_000, margin: 10_000, other: 500, bonus: 700, wages: 2000, media: 600, fines: 100, logistics: 200, wut: 150 });
    const tree = GoalsPanel({ s, info, game: fakeGame(), v: 1 });
    const value = (section: string, label: string): string => {
      const row = walk(sectionTitled(tree, section)).find((v) => v.props.label === label);
      return textOf(row!).replace(/[\s\u00a0\u202f]/g, '');
    };
    expect(value('Dziś', 'Marża i premie (Twój przychód)')).toBe('1500zł');
    expect(value('Ten miesiąc', 'Marża i premie')).toBe('11200zł');
    expect(value('Ten miesiąc', 'Ubytki ponad limit Centrali')).toBe('−150zł');
  });

  describe('cele: opłata franczyzowa w trakcie miesiąca', () => {
    /** Panel „Ten miesiąc” dla miesiąca z obrotem `revenue` i wynikiem przed opłatą 8150 zł (11 200 − 3 050). */
    const month = (revenue: number): { value: (label: string) => string; text: string } => {
      const { s, info } = rich();
      Object.assign(s.month, { revenue, margin: 10_000, other: 500, bonus: 700, wages: 2000, media: 600, fines: 100, logistics: 200, wut: 150 });
      const section = sectionTitled(GoalsPanel({ s, info, game: fakeGame(), v: 1 }), 'Ten miesiąc');
      const value = (label: string): string => textOf(walk(section).find((v) => v.props.label === label)!).replace(/[\s\u00a0\u202f]/g, '');
      return { value, text: textOf(section) };
    };

    it('wiersz opłaty pokazuje franchiseFee od obrotu do dziś, a wynik jest już po opłacie', () => {
      const { value } = month(90_000);
      const fee = franchiseFee(90_000);
      expect(value('Opłata franczyzowa (naliczona do dziś)')).toBe(`−${fee}zł`);
      expect(value('Wynik po opłacie (do dziś)')).toBe(`${8150 - fee >= 0 ? '+' : '−'}${Math.abs(8150 - fee)}zł`);
    });

    it('opłata rośnie z obrotem, a przy zerowym obrocie to sama część stała', () => {
      expect(month(0).value('Opłata franczyzowa (naliczona do dziś)')).toBe(`−${franchiseFee(0)}zł`);
      expect(month(300_000).value('Opłata franczyzowa (naliczona do dziś)')).toBe(`−${franchiseFee(300_000)}zł`);
      expect(franchiseFee(300_000)).toBeGreaterThan(franchiseFee(90_000));
    });

    describe('ostrzeżenie o debecie (gotówka poniżej połowy granicy, za którą gra się kończy)', () => {
      const plain = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, ' ');
      const monthWith = (cash: number): { text: string; warn: Vnode[] } => {
        const { s, info } = rich();
        s.cash = cash;
        const section = sectionTitled(GoalsPanel({ s, info, game: fakeGame(), v: 1 }), 'Ten miesiąc');
        return { text: plain(textOf(section)), warn: walk(section).filter((v) => v.type === 'p' && String(v.props.class).includes('warn')) };
      };

      it('gotówka poniżej DEBT_WARN: wiersz ostrzeżenia z kwotą do granicy, w stylu innych ostrzeżeń (tt-hint warn)', () => {
        const cash = DEBT_WARN - 1200;
        const { text, warn } = monthWith(cash);
        expect(warn).toHaveLength(1);
        expect(plain(textOf(warn[0]))).toBe(plain(debtWarningText(cash)));
        expect(text).toContain(`zostało ${plain((cash - DEBT_LIMIT).toLocaleString('pl-PL'))} zł`);
        expect(warn[0].props.class).toBe('tt-hint warn');
      });

      it('gotówka równa progowi, powyżej niego albo dodatnia: bez ostrzeżenia', () => {
        for (const cash of [DEBT_WARN, DEBT_WARN + 1, 0, 250_000]) {
          const { text, warn } = monthWith(cash);
          expect(text, `gotówka ${cash}`).not.toContain('granicy debetu');
          expect(warn, `gotówka ${cash}`).toHaveLength(0);
        }
      });
    });

    it('stary napis „przed opłatą” zniknął, a podpowiedź każe zostawić gotówkę na opłatę', () => {
      const { text } = month(90_000);
      expect(text).not.toContain('przed opłatą');
      expect(text).toContain('Opłatę franczyzową, ubytki ponad limit Centrali i premię od obrotu Centrala rozlicza przy zamknięciu miesiąca. Zostaw gotówkę na opłaty.');
    });
  });
});

describe('panel Cele: sieć Traszek a bieg rankingowy', () => {
  const PRESTIGE = 'Otwórz kolejną Traszkę';
  const readyShop = (): { s: EconomyState; info: StoreInfo } => {
    const r = rich();
    r.s.remontLevel = 2;   // prestiż gotowy (prestigeReady)
    return r;
  };

  it('zwykły sklep gotowy do prestiżu ma przycisk „Otwórz kolejną Traszkę”', () => {
    const { s, info } = readyShop();
    const section = sectionTitled(GoalsPanel({ s, info, game: fakeGame(), v: 1 }), 'Twoja sieć Traszek');
    expect(labels(section)).toEqual([PRESTIGE]);
  });

  it('w biegu rankingowym przycisku prestiżu nie ma, a podpowiedź mówi, że sieci w tym biegu nie ma', () => {
    const { s, info } = readyShop();
    ranked.value = { seed: s.seed, day: 12, days: 91, phase: 'playing' };
    const section = sectionTitled(GoalsPanel({ s, info, game: fakeGame(), v: 1 }), 'Twoja sieć Traszek');
    expect(labels(section)).toEqual([]);
    expect(textOf(section)).toContain('W biegu rankingowym nie ma sieci sklepów');
    expect(textOf(section)).not.toContain('Po drugim remoncie');
  });

  it('w biegu rankingowym także sklep, który „już jest w sieci”, nie podsuwa otwierania innego seeda', () => {
    const { s, info } = readyShop();
    metaView.value = { ...metaView.value, network: [s.seed] };
    ranked.value = { seed: s.seed, day: 3, days: 91, phase: 'playing' };
    const text = textOf(sectionTitled(GoalsPanel({ s, info, game: fakeGame(), v: 1 }), 'Twoja sieć Traszek'));
    expect(text).toContain('W biegu rankingowym nie ma sieci sklepów');
    expect(text).not.toContain('Otwórz sklep z innym seedem');
  });
});

describe('panel Ludzie: kto co robi, przypięcia i podsumowanie dnia', () => {
  /** Zmiana czworga ludzi w środku dnia z przydziałem z ostatniej minuty: 2 na kasie, 1 przy paletach, 1 wolny. */
  function crew(): { s: EconomyState; info: StoreInfo } {
    const { s, info } = rich();
    s.staff = 4;
    s.minute = 12 * 60;
    s.shift = { staff: 4, human: { kasa: 2, rozladunek: 1, wykladanie: 0, sprzatanie: 0 }, people: ['kasa', 'kasa', 'rozladunek', 'wolny'] };
    return { s, info };
  }
  /** Wiersz zadania w sekcji „Kto co robi teraz” (etykieta wiersza to prop, nie dziecko). */
  const rowOf = (tree: ReturnType<typeof PeoplePanel>, section: string, label: string): Vnode => {
    const found = walk(sectionTitled(tree, section)).filter((v) => v.props.label === label);
    if (found.length !== 1) throw new Error(`Wierszy „${label}” w „${section}”: ${found.length}`);
    return found[0]!;
  };
  const NOW = 'Kto co robi teraz';

  it('sekcje w kolejności: Zmiana, Profil pracy, Kto co robi teraz, Dziś', () => {
    const { s, info } = crew();
    const titles = walk(PeoplePanel({ s, info, game: fakeGame(), v: 1 })).filter((v) => typeof v.props.title === 'string').map((v) => v.props.title);
    expect(titles).toEqual(['Zmiana', 'Profil pracy', NOW, 'Dziś']);
  });

  it('Zmiana: liczba osób, zatrudnij i zwolnij, płaca dzienna', () => {
    const { s, info } = crew();
    const game = fakeGame();
    const section = sectionTitled(PeoplePanel({ s, info, game, v: 1 }), 'Zmiana');
    expect(textOf(section)).toContain('4 osoby');
    expect(textOf(section).replace(/[\s\u00a0\u202f]/g, '')).toContain(zl(s.staff * WAGE_PER_DAY).replace(/[\s\u00a0\u202f]/g, ''));
    click(buttonAria(section, 'Zatrudnij'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'hire' });
    click(buttonAria(section, 'Zwolnij'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'fire' });
  });

  it('liczby osób przy zadaniach i wolnych zgadzają się ze staffOnShift', () => {
    const { s, info } = crew();
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    const on = staffOnShift(s);
    expect(on).toHaveLength(4);
    for (const t of STAFF_TASKS) {
      const expected = on.filter((x) => x.task === t).length;
      expect(textOf(rowOf(tree, NOW, TASK_LABEL[t])), t).toContain(`${expected} ${plural(expected, 'osoba', 'osoby', 'osób')}`);
    }
    const free = on.filter((x) => x.task === 'wolny').length;
    expect(textOf(rowOf(tree, NOW, 'Wolni'))).toContain(`${free} ${plural(free, 'osoba', 'osoby', 'osób')}`);
    // suma osób w wierszach to dokładnie zmiana
    const total = [...STAFF_TASKS.map((t) => TASK_LABEL[t]), 'Wolni']
      .reduce((n, label) => n + Number(/^(\d+)/.exec(textOf(rowOf(tree, NOW, label)))![1]), 0);
    expect(total).toBe(s.staff);
  });

  it('w nocy (nikogo na zmianie) wszystkie wiersze pokazują 0, a wolnych też nie ma', () => {
    const { s, info } = crew();
    s.minute = 3 * 60;
    expect(staffOnShift(s)).toHaveLength(0);
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    for (const label of [...STAFF_TASKS.map((t) => TASK_LABEL[t]), 'Wolni']) expect(textOf(rowOf(tree, NOW, label)), label).toMatch(/^0 osób/);
  });

  it('przycisk + przy kasie wysyła pinStaff z liczbą przypiętych + 1, a − z liczbą − 1', () => {
    const { s, info } = crew();
    s.tycoon.staff.pinned.kasa = 1;
    const game = fakeGame();
    const kasa = rowOf(PeoplePanel({ s, info, game, v: 1 }), NOW, TASK_LABEL.kasa);
    const [minus, plus] = buttonsOf(kasa);
    expect(textOf(minus!)).toBe('−');
    expect(textOf(plus!)).toBe('+');
    click(plus!);
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'pinStaff', task: 'kasa', count: 2 });
    click(minus!);
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'pinStaff', task: 'kasa', count: 0 });
    expect(game.dispatch).toHaveBeenCalledTimes(2);
  });

  it('każde zadanie przypina się samo: + przy sprzątaniu wysyła pinStaff dla sprzątania', () => {
    const { s, info } = crew();
    s.tycoon.staff.pinned.sprzatanie = 2;
    const game = fakeGame();
    const tree = PeoplePanel({ s, info, game, v: 1 });
    for (const t of STAFF_TASKS as readonly StaffTask[]) {
      const [, plus] = buttonsOf(rowOf(tree, NOW, TASK_LABEL[t]));
      click(plus!);
      expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'pinStaff', task: t, count: s.tycoon.staff.pinned[t] + 1 });
    }
  });

  it('− przy zerze przypiętych jest disabled, a przy dodatniej liczbie nie', () => {
    const { s, info } = crew();
    s.tycoon.staff.pinned.rozladunek = 1;
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    expect(buttonsOf(rowOf(tree, NOW, TASK_LABEL.kasa))[0]!.props.disabled).toBe(true);
    expect(buttonsOf(rowOf(tree, NOW, TASK_LABEL.rozladunek))[0]!.props.disabled).toBe(false);
  });

  it('+ jest disabled, gdy suma przypiętych równa się personelowi (we wszystkich wierszach), a przed tym aktywny', () => {
    const { s, info } = crew();
    s.tycoon.staff.pinned.kasa = 2;
    s.tycoon.staff.pinned.rozladunek = 1;
    let tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    for (const t of STAFF_TASKS) expect(buttonsOf(rowOf(tree, NOW, TASK_LABEL[t]))[1]!.props.disabled, `przed: ${t}`).toBe(false);
    s.tycoon.staff.pinned.wykladanie = 1;   // 2 + 1 + 1 = 4 = s.staff
    tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    for (const t of STAFF_TASKS) expect(buttonsOf(rowOf(tree, NOW, TASK_LABEL[t]))[1]!.props.disabled, `po: ${t}`).toBe(true);
    expect(buttonsOf(rowOf(tree, NOW, TASK_LABEL.kasa))[0]!.props.disabled).toBe(false);   // odpinać wolno zawsze
  });

  it('wiersz pokazuje, ile osób jest przypiętych do zadania', () => {
    const { s, info } = crew();
    s.tycoon.staff.pinned.kasa = 2;
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    expect(textOf(rowOf(tree, NOW, TASK_LABEL.kasa))).toContain('2');
    expect(textOf(rowOf(tree, NOW, TASK_LABEL.kasa))).toContain('📌');
  });

  it('Dziś: osobominuty wg zadania z day.worked, zaokrąglone', () => {
    const { s, info } = crew();
    Object.assign(s.tycoon.staff.day.worked, { kasa: 480.4, rozladunek: 95.6, wykladanie: 0, sprzatanie: 61 });
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    const text = (t: StaffTask): string => textOf(rowOf(tree, 'Dziś', TASK_LABEL[t])).replace(/[\s\u00a0\u202f]/g, ' ');
    expect(text('kasa')).toContain('480 osobomin');
    expect(text('rozladunek')).toContain('96 osobomin');
    expect(text('wykladanie')).toContain('0 osobomin');
    expect(text('sprzatanie')).toContain('61 osobomin');
  });

  it('Dziś: ostrzeżenie „czekało N min” dopiero powyżej 30 minut czekania i tylko przy tym zadaniu', () => {
    const { s, info } = crew();
    Object.assign(s.tycoon.staff.day.starved, { kasa: 30, rozladunek: 31, wykladanie: 95, sprzatanie: 0 });
    const section = sectionTitled(PeoplePanel({ s, info, game: fakeGame(), v: 1 }), 'Dziś');
    const warnings = walk(section).filter((v) => String(v.props.class).includes('warn')).map((v) => textOf(v));
    expect(warnings).toEqual(['czekało 31 min', 'czekało 95 min']);   // kasa na granicy 30 jeszcze nie ostrzega
    expect(textOf(section)).not.toContain('czekało 30');
  });

  it('Dziś: automatyka jest wymieniona osobno, gdy zadanie robiły też roboty', () => {
    const { s, info } = crew();
    Object.assign(s.tycoon.staff.day.worked, { rozladunek: 200 });
    Object.assign(s.tycoon.staff.day.robot, { rozladunek: 80 });
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    expect(textOf(rowOf(tree, 'Dziś', TASK_LABEL.rozladunek))).toContain('w tym automatyka 80');
    expect(textOf(rowOf(tree, 'Dziś', TASK_LABEL.kasa))).not.toContain('automatyka');
  });
});

describe('panel Sklep: zaufanie Centrali, ubytki w miesiącu i czystość sali', () => {
  it('zaufanie pokazuje próg (nazwę) i jego opis', () => {
    const { s, info } = rich();
    s.tycoon.trust.value = 45;
    const tree = StorePanel({ s, info, v: 1 });
    const tier = trustTier(45);
    const section = sectionTitled(tree, 'Opinia');
    expect(textOf(section)).toContain('45');
    expect(textOf(section)).toContain(tier.label);
    expect(textOf(section)).toContain(tier.flavor);
    s.tycoon.trust.value = 92;
    expect(textOf(sectionTitled(StorePanel({ s, info, v: 1 }), 'Opinia'))).toContain(trustTier(92).flavor);
  });

  it('Ubytki w tym miesiącu: suma ubytków wobec limitu Centrali (limit × obrót miesiąca), pasek ostrzega po przekroczeniu', () => {
    const { s, info } = rich();
    s.month.revenue = 50_000;
    s.tycoon.wut.month.kradziez = 200;
    s.tycoon.wut.month.termin = 100;
    const limit = WUT.threshold * 50_000;   // 600 zł
    const tree = StorePanel({ s, info, v: 1 });
    const section = sectionTitled(tree, 'Ubytki w tym miesiącu');
    const plain = (x: string): string => x.replace(/[\s\u00a0\u202f]/g, '');
    expect(plain(textOf(section))).toContain(plain(`${zl(wutTotal(s.tycoon.wut))} z ${zl(limit)}`));
    const bar = walk(section).find((v) => v.type === Bar)!;
    expect(bar.props.value).toBeCloseTo(300 / 600);
    expect(bar.props.warn).toBe(false);
    s.tycoon.wut.month.pomylki = 500;   // 800 > 600
    const over = sectionTitled(StorePanel({ s, info, v: 1 }), 'Ubytki w tym miesiącu');
    expect(walk(over).find((v) => v.type === Bar)!.props.warn).toBe(true);
    expect(plain(textOf(over))).toContain(plain(zl(200)));   // nadwyżka do zapłaty
  });

  it('nadwyżka ubytków ponad limit to stan „na dziś”: obrót jeszcze rośnie, więc to nie opłata ostateczna', () => {
    const { s, info } = rich();
    s.month.revenue = 50_000;
    s.tycoon.wut.month.pomylki = 800;   // 800 > 600
    const hint = textOf(sectionTitled(StorePanel({ s, info, v: 1 }), 'Ubytki w tym miesiącu'));
    expect(hint).toContain('na dziś');
    expect(hint).toContain('obrót jeszcze rośnie');
    expect(hint).not.toContain('Tyle zapłacisz');   // dawne brzmienie obiecywało kwotę, która do końca miesiąca się zmienia
  });

  it('ubytki na początku miesiąca (obrót 0, limit 0) nie dają NaN ani dzielenia przez zero', () => {
    const { s, info } = rich();
    s.month.revenue = 0;
    let section = sectionTitled(StorePanel({ s, info, v: 1 }), 'Ubytki w tym miesiącu');
    expect(walk(section).find((v) => v.type === Bar)!.props.value).toBe(0);
    expect(textOf(section)).not.toMatch(/NaN|Infinity/);
    s.tycoon.wut.month.termin = 10;   // ubytek bez obrotu: już ponad limitem
    section = sectionTitled(StorePanel({ s, info, v: 1 }), 'Ubytki w tym miesiącu');
    expect(walk(section).find((v) => v.type === Bar)!.props.value).toBe(1);
    expect(walk(section).find((v) => v.type === Bar)!.props.warn).toBe(true);
    expect(textOf(section)).not.toMatch(/NaN|Infinity/);
  });

  it('Czystość sali: zaokrąglony procent i pogoda', () => {
    const { s, info } = rich();
    s.tycoon.hall.cleanliness = 63.6;
    s.tycoon.hall.weather = 'deszcz';
    const section = sectionTitled(StorePanel({ s, info, v: 1 }), 'Czystość sali');
    expect(textOf(section)).toContain('64%');
    expect(textOf(section)).toContain(WEATHER_LABEL.deszcz);
    expect(walk(section).find((v) => v.type === Bar)!.props.warn).toBe(false);
    s.tycoon.hall.cleanliness = 22;
    s.tycoon.hall.weather = 'snieg';
    const dirty = sectionTitled(StorePanel({ s, info, v: 1 }), 'Czystość sali');
    expect(textOf(dirty)).toContain('22%');
    expect(textOf(dirty)).toContain(WEATHER_LABEL.snieg);
    expect(walk(dirty).find((v) => v.type === Bar)!.props.warn).toBe(true);
  });
});

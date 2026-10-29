import { afterEach, describe, expect, it, vi } from 'vitest';
import { BANKRUPTCY_AT, WAGE_PER_DAY } from '@/sim/economy/catalog';
import { createEconomy, franchiseFee, kpiScaleOf, nextRemont, upgradeBlocker, type CommandResult, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import type { Command } from '@/sim/economy/commands';
import { KPI, KPI_FLAVOR, kpiTitle } from '@/sim/economy/tycoon/kpi';
import { dayOfMinute, roundNice } from '@/sim/economy/tycoon/time';
import { staffOnShift } from '@/sim/economy/tycoon/shift';
import { PROFILE_HINT, PROFILE_LABEL, STAFF_PROFILES, STAFF_TASKS, TASK_LABEL, type StaffTask } from '@/sim/economy/tycoon/staff';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { WUT, wutTotal } from '@/sim/economy/tycoon/wut';
import { WEATHER_LABEL } from '@/sim/economy/tycoon/cleanliness';
import { computeStoreInfo, type PalletLoc, type StoreInfo } from '@/sim/economy/storeInfo';
import { EQUIPMENT, UPGRADES } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import { metaView, speed, type GameActions } from '../state';
import { Bar, GoalsPanel, PalletItem, PalletsPanel, PeoplePanel, ShopPanel, StorePanel } from './panels';
import { plural, zl } from './format';
import { buttonAria, buttonLabelled, buttonsOf, click, labels, sectionTitled, textOf, walk, type Vnode } from './vnodeTree';

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

afterEach(() => {
  metaView.value = { points: 0, stores: 0, networkIncome: 0, network: [], sound: true, vibration: true };
  speed.value = 1;
});

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

  it('blokada „Rozładuj” nie rusza przycisków przenoszenia i odsyłania (to nie są stuknięcia)', () => {
    const { s, info } = rich();
    s.tycoon.fatigue.energy = 0;
    const tree = PalletItem({ s, info, id: s.pallets[0]!.id, game: fakeGame() });
    expect(buttonLabelled(tree, 'Rozładuj').props.disabled).toBe(true);
    expect(buttonLabelled(tree, 'Odeślij').props.disabled).toBeUndefined();
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
    expect(value('Ten miesiąc', 'WUT ponad próg')).toBe('−150zł');
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

    describe('ostrzeżenie przed wypowiedzeniem umowy (ostatni raport zastał dług)', () => {
      const plain = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, ' ');
      const warning = `Poprzedni raport zastał Cię z gotówką poniżej ${plain(`−${zl(-BANKRUPTCY_AT)}`)}. Jeśli ten też, Centrala wypowie umowę.`;
      const monthWith = (lastCash: number | null): { text: string; warn: Vnode[] } => {
        const { s, info } = rich();
        s.lastReport = lastCash === null ? null : { label: 'wrzesień 2026', counters: s.month, profit: -1000, cash: lastCash, comment: '', detail: null } as MonthReport;
        const section = sectionTitled(GoalsPanel({ s, info, game: fakeGame(), v: 1 }), 'Ten miesiąc');
        return { text: plain(textOf(section)), warn: walk(section).filter((v) => v.type === 'p' && String(v.props.class).includes('warn')) };
      };

      it('ostatni raport poniżej BANKRUPTCY_AT: wiersz ostrzeżenia z kwotą ze stałej, w stylu innych ostrzeżeń (tt-hint warn)', () => {
        const { text, warn } = monthWith(BANKRUPTCY_AT - 1);
        expect(text).toContain(warning);
        expect(warn).toHaveLength(1);
        expect(plain(textOf(warn[0]))).toBe(warning);
        expect(warn[0].props.class).toBe('tt-hint warn');
      });

      it('gotówka równa granicy, powyżej niej albo brak raportu: bez ostrzeżenia', () => {
        for (const cash of [BANKRUPTCY_AT, 0, 250_000, null]) {
          const { text, warn } = monthWith(cash);
          expect(text, `ostatni raport: ${cash}`).not.toContain('Poprzedni raport');
          expect(warn, `ostatni raport: ${cash}`).toHaveLength(0);
        }
      });
    });

    it('stary napis „przed opłatą” zniknął, a podpowiedź każe zostawić gotówkę na opłatę', () => {
      const { text } = month(90_000);
      expect(text).not.toContain('przed opłatą');
      expect(text).toContain('Opłatę franczyzową, WUT ponad próg i premię od obrotu Centrala rozlicza przy zamknięciu miesiąca. Zostaw gotówkę na opłaty.');
    });
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

describe('panel Sklep: zaufanie Centrali, WUT w miesiącu i czystość sali', () => {
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

  it('WUT w tym miesiącu: suma ubytków wobec progu (próg × obrót miesiąca), pasek ostrzega po przekroczeniu', () => {
    const { s, info } = rich();
    s.month.revenue = 50_000;
    s.tycoon.wut.month.kradziez = 200;
    s.tycoon.wut.month.termin = 100;
    const limit = WUT.threshold * 50_000;   // 600 zł
    const tree = StorePanel({ s, info, v: 1 });
    const section = sectionTitled(tree, 'WUT w tym miesiącu');
    const plain = (x: string): string => x.replace(/[\s\u00a0\u202f]/g, '');
    expect(plain(textOf(section))).toContain(plain(`${zl(wutTotal(s.tycoon.wut))} z ${zl(limit)}`));
    const bar = walk(section).find((v) => v.type === Bar)!;
    expect(bar.props.value).toBeCloseTo(300 / 600);
    expect(bar.props.warn).toBe(false);
    s.tycoon.wut.month.pomylki = 500;   // 800 > 600
    const over = sectionTitled(StorePanel({ s, info, v: 1 }), 'WUT w tym miesiącu');
    expect(walk(over).find((v) => v.type === Bar)!.props.warn).toBe(true);
    expect(plain(textOf(over))).toContain(plain(zl(200)));   // nadwyżka do zapłaty
  });

  it('nadwyżka WUT to stan „na dziś”: obrót jeszcze rośnie, więc to nie opłata ostateczna', () => {
    const { s, info } = rich();
    s.month.revenue = 50_000;
    s.tycoon.wut.month.pomylki = 800;   // 800 > 600
    const hint = textOf(sectionTitled(StorePanel({ s, info, v: 1 }), 'WUT w tym miesiącu'));
    expect(hint).toContain('na dziś');
    expect(hint).toContain('obrót jeszcze rośnie');
    expect(hint).not.toContain('Tyle zapłacisz');   // dawne brzmienie obiecywało kwotę, która do końca miesiąca się zmienia
  });

  it('WUT na początku miesiąca (obrót 0, próg 0) nie daje NaN ani dzielenia przez zero', () => {
    const { s, info } = rich();
    s.month.revenue = 0;
    let section = sectionTitled(StorePanel({ s, info, v: 1 }), 'WUT w tym miesiącu');
    expect(walk(section).find((v) => v.type === Bar)!.props.value).toBe(0);
    expect(textOf(section)).not.toMatch(/NaN|Infinity/);
    s.tycoon.wut.month.termin = 10;   // ubytek bez obrotu: już ponad progiem
    section = sectionTitled(StorePanel({ s, info, v: 1 }), 'WUT w tym miesiącu');
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

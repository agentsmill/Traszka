import { afterEach, describe, expect, it } from 'vitest';
import { lang } from '@/i18n';
import { firmOf } from '@/game/session';
import { lotById } from '@/sim/city/generateCity';
import { dayOf } from '@/sim/economy/calendar';
import { CATS } from '@/sim/economy/catalog';
import { forecastMonth } from '@/sim/economy/forecast';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { forecastFirm } from '@/sim/firm/forecast';
import { openSecond, partnerSession } from '../../../tests/firmKit';
import { firm, type MetaView } from '../state';
import { BACKGROUND_TRUST_WARN_BELOW, forecastNow, isNetwork, networkOn, networkRow, shortStoreName, storeMinis } from './storeSwitcherModel';

/*
 * Model przełącznika sklepów (spec §9.4, §11.3): mini-stan każdego sklepu na liście chipa, wiersz sieci z poprzednich gier i prognoza paska
 * (cała sieć od dwóch otwartych sklepów). Czyste funkcje na prawdziwej firmie z kodu gry (`tests/firmKit.ts`).
 */

afterEach(() => { lang.value = 'pl'; firm.value = null; });

/** Firma z dwoma sklepami, otwartymi prawdziwymi poleceniami. */
function twoStores() {
  const session = partnerSession();
  openSecond(session);
  return { session, f: firmOf(session) };
}

describe('storeMinis: mini-stan sklepów', () => {
  it('jeden wiersz na sklep, rosnąco po id; adres, aktywność i flagi ze stanu firmy', () => {
    const { f } = twoStores();
    const minis = storeMinis(f);
    expect(minis.map((m) => m.id)).toEqual([1, 2]);
    for (const m of minis) {
      const st = f.stores.find((s) => s.id === m.id)!;
      const lot = lotById(f.city, st.lotId);
      expect(m.street).toBe(lot.street);
      expect(m.number).toBe(lot.number);
      expect(m.trust).toBe(st.econ.tycoon.trust.value);
      expect(m.closed).toBe(false);
      expect(m.notice).toBe(false);
      expect(m.warnings).toEqual([]);
    }
    expect(minis.map((m) => m.active)).toEqual([true, false]);
    f.activeId = 2;
    expect(storeMinis(f).map((m) => m.active)).toEqual([false, true]);
  });

  it('„Zostanie” sklepu to jego prognoza z forecastMonth, a dzisiejszy wynik to marża, premie i inne przychody minus mandaty i logistyka', () => {
    const { f } = twoStores();
    const second = f.stores[1]!;
    second.econ.today.margin = 900;
    second.econ.today.bonus = 150;
    second.econ.today.other = 50;
    second.econ.today.fines = 100;
    second.econ.today.logistics = 40;
    const mini = storeMinis(f)[1]!;
    expect(mini.todayProfit).toBe(900 + 150 + 50 - 100 - 40);
    expect(mini.net).toBe(forecastMonth(second.econ, second.info).net);
  });

  it('znak „paleta”: paleta w przejściu (nie pod sklepem ani na zapleczu)', () => {
    const { f } = twoStores();
    const second = f.stores[1]!;
    second.econ.pallets[0]!.loc = 'backroom';
    expect(storeMinis(f)[1]!.warnings).not.toContain('paleta');
    second.econ.pallets[0]!.loc = 'aisle';
    expect(storeMinis(f)[1]!.warnings).toEqual(['paleta']);
    expect(storeMinis(f)[0]!.warnings).toEqual([]);   // drugi sklep ma własne palety
  });

  it('znak „polka”: pusta półka w którejkolwiek kategorii; zapełniona nie ostrzega', () => {
    const { f } = twoStores();
    const second = f.stores[1]!;
    expect(CATS.every((c) => second.info.shelfCap[c] > 0)).toBe(true);
    second.econ.shelf[CATS[0]!] = 0;
    expect(storeMinis(f)[1]!.warnings).toEqual(['polka']);
    second.econ.shelf[CATS[0]!] = second.info.shelfCap[CATS[0]!];
    expect(storeMinis(f)[1]!.warnings).toEqual([]);
  });

  it('znak „zastepca”: wpis w skrzynce z dziś dla tego sklepu; wczorajszy ani cudzy nie liczą się', () => {
    const { f } = twoStores();
    const today = dayOf(f.stores[1]!.econ.minute);
    f.inbox.push({ day: today - 1, storeId: 2, card: 'x', answer: 0 });
    f.inbox.push({ day: today, storeId: 1, card: 'x', answer: 0 });
    expect(storeMinis(f).map((m) => m.warnings)).toEqual([['zastepca'], []]);   // wpis jest przy swoim sklepie, wczorajszy już nie świeci
    f.inbox.push({ day: today, storeId: 2, card: 'x', answer: 1 });
    expect(storeMinis(f).map((m) => m.warnings)).toEqual([['zastepca'], ['zastepca']]);
  });

  it('kilka znaków naraz zachowuje stałą kolejność: paleta, półka, zastępca', () => {
    const { f } = twoStores();
    const second = f.stores[1]!;
    f.inbox.push({ day: dayOf(second.econ.minute), storeId: 2, card: 'x', answer: 0 });
    second.econ.shelf[CATS[1]!] = 0;
    second.econ.pallets[0]!.loc = 'aisle';
    expect(storeMinis(f)[1]!.warnings).toEqual(['paleta', 'polka', 'zastepca']);
  });

  it('znak „zaufanie”: sklep w tle z zaufaniem poniżej 40 ma go, na 40 już nie; idzie ostatni, po zastępcy', () => {
    const { f } = twoStores();
    const second = f.stores[1]!;
    expect(BACKGROUND_TRUST_WARN_BELOW).toBe(40);
    // próg to dolna granica poziomu „Pod obserwacją” (`trust.ts`): niżej jest „Na cenzurowanym”
    expect(trustTier(BACKGROUND_TRUST_WARN_BELOW).id).toBe('obserwacja');
    expect(trustTier(BACKGROUND_TRUST_WARN_BELOW - 1).id).toBe('cenzura');
    second.econ.tycoon.trust.value = 39;
    expect(storeMinis(f)[1]!.warnings).toEqual(['zaufanie']);
    second.econ.tycoon.trust.value = 40;
    expect(storeMinis(f)[1]!.warnings).toEqual([]);
    second.econ.tycoon.trust.value = 32;
    second.econ.pallets[0]!.loc = 'aisle';
    f.inbox.push({ day: dayOf(second.econ.minute), storeId: 2, card: 'x', answer: 0 });
    expect(storeMinis(f)[1]!.warnings).toEqual(['paleta', 'zastepca', 'zaufanie']);
  });

  it('wypowiedziany i zamknięty sklep mają flagi; zamknięty zostaje na liście', () => {
    const { f } = twoStores();
    f.stores[1]!.notice = { endDay: 120 };
    expect(storeMinis(f)[1]).toMatchObject({ notice: true, closed: false });
    f.stores[1]!.closed = true;
    const mini = storeMinis(f)[1]!;
    expect(mini).toMatchObject({ closed: true, notice: true, warnings: [], net: 0 });
    expect(storeMinis(f)).toHaveLength(2);
  });
});

describe('shortStoreName: nazwa na zakładce', () => {
  it('„#2 Lipowa”: numer sklepu i ulica jego lokalu', () => {
    const { f } = twoStores();
    for (const st of f.stores) expect(shortStoreName(f, st.id)).toBe(`#${st.id} ${lotById(f.city, st.lotId).street}`);
    expect(shortStoreName(f, 9)).toBe('#9');
  });
});

describe('networkRow: sieć z poprzednich gier', () => {
  const meta = (over: Partial<MetaView> = {}): MetaView => ({ points: 0, stores: 0, networkIncome: 0, network: [], sound: true, vibration: true, ...over });
  const plain = (s: string | null): string | null => (s === null ? null : s.replace(/[\s  ]/g, ' '));

  it('bez sklepów z poprzednich gier wiersza nie ma', () => {
    expect(networkRow(meta())).toBeNull();
    expect(networkRow(meta({ points: 3, networkIncome: 500 }))).toBeNull();   // brak sklepów: nie ma czego wymieniać
  });

  it('ze sklepami: ile ich jest, dochód dzienny i Punkty Partnera, z odmianą', () => {
    expect(plain(networkRow(meta({ stores: 2, networkIncome: 12_000, points: 3 })))).toBe('Z poprzednich gier: 2 sklepy, 12 000 zł dziennie, 3 Punkty Partnera');
    expect(plain(networkRow(meta({ stores: 1, networkIncome: 500, points: 1 })))).toBe('Z poprzednich gier: 1 sklep, 500 zł dziennie, 1 Punkt Partnera');
    expect(plain(networkRow(meta({ stores: 5, networkIncome: 0, points: 5 })))).toBe('Z poprzednich gier: 5 sklepów, 0 zł dziennie, 5 Punktów Partnera');
  });

  it('po angielsku', () => {
    lang.value = 'en';
    expect(plain(networkRow(meta({ stores: 2, networkIncome: 12_000, points: 3 })))).toBe('From previous games: 2 shops, 12,000 zł a day, 3 Partner Points');
    expect(plain(networkRow(meta({ stores: 1, networkIncome: 500, points: 1 })))).toBe('From previous games: 1 shop, 500 zł a day, 1 Partner Point');
  });
});

describe('forecastNow: prognoza paska', () => {
  it('jeden otwarty sklep to forecastMonth tego sklepu, także z firmą w widoku', () => {
    const session = partnerSession();
    const f = firmOf(session);
    const view = { s: session.econ, info: session.info, v: 1 };
    expect(forecastNow(view, null)).toEqual(forecastMonth(session.econ, session.info));
    expect(forecastNow(view, { f, v: 1 })).toEqual(forecastMonth(session.econ, session.info));
    expect(isNetwork(f)).toBe(false);
  });

  it('od dwóch otwartych sklepów to prognoza całej sieci: suma „Zostaje Ci” i portfel', () => {
    const { session, f } = twoStores();
    const view = { s: session.econ, info: session.info, v: 1 };
    const now = forecastNow(view, { f, v: 1 });
    expect(isNetwork(f)).toBe(true);
    expect(now).toEqual(forecastFirm(f));
    const nets = f.stores.map((st) => forecastMonth(st.econ, st.info).net);
    expect(now.net).toBeCloseTo(nets[0]! + nets[1]!, 6);
    expect(now.cashAfter).toBeCloseTo(f.person.wallet + now.net, 6);
  });

  it('sklep zamknięty nie liczy się do sieci: jeden otwarty wraca do prognozy sklepu', () => {
    const { session, f } = twoStores();
    f.stores[0]!.closed = true;
    f.activeId = 2;
    const view = { s: f.stores[1]!.econ, info: f.stores[1]!.info, v: 1 };
    expect(isNetwork(f)).toBe(false);
    expect(forecastNow(view, { f, v: 1 })).toEqual(forecastMonth(view.s, view.info));
    void session;
  });

  it('isNetwork bez firmy to fałsz', () => {
    expect(isNetwork(null)).toBe(false);
  });
});

describe('networkOn: sygnał sieci dla układu paska', () => {
  it('fałsz bez firmy i z jednym sklepem, prawda od dwóch otwartych, a po zamknięciu drugiego znów fałsz', () => {
    expect(networkOn.value).toBe(false);
    const session = partnerSession();
    firm.value = { f: firmOf(session), v: 1 };
    expect(networkOn.value).toBe(false);
    openSecond(session);
    firm.value = { f: firmOf(session), v: 2 };
    expect(networkOn.value).toBe(true);
    firmOf(session).stores[1]!.closed = true;
    firm.value = { f: firmOf(session), v: 3 };
    expect(networkOn.value).toBe(false);
  });
});

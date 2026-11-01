import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { createSession, firmOf } from '@/game/session';
import { lang } from '@/i18n';
import { GUARANTEE, INSTALLMENTS } from '@/sim/economy/catalog';
import { createEconomy, stepMinute, type EconEvent, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { MILESTONES } from '@/sim/economy/milestones';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { layoutFor } from '@/sim/store/layoutFor';
import { openSecond, partnerSession, SEED as FIRM_SEED } from '../../../tests/firmKit';
import { cityFacts } from './city';
import { TIP_IDS, loadTutorial, type TipId, type TutorialMemory } from './memory';
import { dismissTip, settleTips, showTip, shownTip, tipsFor, type TipCtx } from './tips';

const SEED = 'dymki-1';
function game(seed = SEED): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor(seed, 0));
  return { s: createEconomy(seed, info), info };
}
const ctxOf = (s: EconomyState, over: Partial<TipCtx> = {}): TipCtx => ({
  s, tab: null, report: null, remanentOpen: false, storyOpen: false, windowOpen: false, offerOpen: false, tourVisible: false,
  cityOpen: false, lotOpen: false, partner: false, ranked: false, stores: 1, networkOpen: false, ...over,
});
const MEM: TutorialMemory = { v: 1, tour: 'done', seen: [], tips: true };
const ids = (ctx: TipCtx, mem: TutorialMemory = MEM): string[] => tipsFor(ctx, mem).map((t) => t.id);
const withReport = { statement: {} } as unknown as MonthReport;

/** Gra przewinięta do pierwszej widocznej karty decyzji (stepMinute nie staje na kartach, więc liczymy sami). */
function untilCard(g: { s: EconomyState; info: StoreInfo }): void {
  const events: EconEvent[] = [];
  for (let i = 0; i < 3 * 1440 && visibleCards(g.s.tycoon.cards, g.s.minute).length === 0; i++) stepMinute(g.s, g.info, events);
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); shownTip.value = null; });
afterEach(() => { vi.unstubAllGlobals(); shownTip.value = null; lang.value = 'pl'; });

describe('warunki dymków na prawdziwym stanie', () => {
  it('nowa gra o 6:00: żaden dymek', () => {
    expect(ids(ctxOf(game().s))).toEqual([]);
  });

  it('cel do odebrania: 🎁 w pasku, a przy otwartych Celach „Odbierz” (z zakładką jako zapasem)', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    const closed = tipsFor(ctxOf(s), MEM)[0]!;
    expect(closed).toMatchObject({ id: 'tip-cel', inWindow: false, targets: ['claim'] });
    expect(closed.text).toContain('🎁');
    const open = tipsFor(ctxOf(s, { tab: 'cele' }), MEM)[0]!;
    expect(open.targets).toEqual(['claim-btn', 'tab-cele']);
    expect(open.text).toContain('„Odbierz”');
  });

  it('paleta w przejściu: zakładka Palety, a przy otwartych Paletach sama paleta', () => {
    const { s } = game();
    s.pallets[0]!.loc = 'aisle';
    expect(tipsFor(ctxOf(s), MEM)[0]).toMatchObject({ id: 'tip-przejscia', targets: ['tab-palety'] });
    expect(tipsFor(ctxOf(s, { tab: 'palety' }), MEM)[0]!.targets).toEqual(['pallet-aisle', 'tab-palety']);
  });

  it('pierwsza karta w pierwszym miesiącu: dymek nad oknem karty', () => {
    const g = game();
    untilCard(g);
    expect(visibleCards(g.s.tycoon.cards, g.s.minute).length).toBeGreaterThan(0);
    expect(tipsFor(ctxOf(g.s), MEM)[0]).toMatchObject({ id: 'tip-karta', inWindow: true, targets: ['card'] });
  });

  it('karta po pierwszym miesiącu albo zasłonięta raportem, protokołem czy wpisem „OK”: bez dymka karty', () => {
    const g = game();
    untilCard(g);
    expect(ids(ctxOf(g.s, { storyOpen: true }))).not.toContain('tip-karta');
    expect(ids(ctxOf(g.s, { remanentOpen: true }))).not.toContain('tip-karta');
    expect(ids(ctxOf(g.s, { report: withReport }))).not.toContain('tip-karta');
    g.s.history.push({ label: 'wrzesień', profit: 0, revenue: 0 });
    expect(ids(ctxOf(g.s))).not.toContain('tip-karta');
  });

  it('wyciąg od Centrali: nad raportem z wyciągiem, wskazuje „Zostaje Ci”, a tytuł okna to zapas', () => {
    const { s } = game();
    expect(tipsFor(ctxOf(s, { report: withReport, windowOpen: true }), MEM)[0]).toMatchObject({ id: 'tip-wyciag', inWindow: true, targets: ['zostaje-ci', 'report'] });
    expect(ids(ctxOf(s, { report: { statement: null } as unknown as MonthReport, windowOpen: true }))).toEqual([]);   // stary raport bez wyciągu
    expect(ids(ctxOf(s, { report: withReport, remanentOpen: true, windowOpen: true }))).toEqual(['tip-remanent']);   // protokół leży nad raportem
  });

  it('remanent: nad protokołem, wskazuje zdanie o nadwyżce', () => {
    const { s } = game();
    expect(tipsFor(ctxOf(s, { remanentOpen: true, windowOpen: true }), MEM)[0]).toMatchObject({ id: 'tip-remanent', targets: ['remanent-verdict'] });
  });

  it('po końcu gry: żadnych dymków', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    s.gameOver = true;
    expect(ids(ctxOf(s, { report: withReport, remanentOpen: true }))).toEqual([]);
  });
});

describe('kolejność, pamięć i okna', () => {
  it('kilka naraz: w kolejności ze specu', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    s.pallets[0]!.loc = 'aisle';
    expect(ids(ctxOf(s))).toEqual(['tip-cel', 'tip-przejscia']);
  });

  it('dymek, który już był, nie wraca; wyłączone podpowiedzi to brak dymków', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    expect(ids(ctxOf(s), { ...MEM, seen: ['tip-cel'] })).toEqual([]);
    expect(ids(ctxOf(s), { ...MEM, tips: false })).toEqual([]);
  });

  it('pod oknem wyboru i przy widocznym przelocie: nic', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    expect(ids(ctxOf(s, { offerOpen: true }))).toEqual([]);
    expect(ids(ctxOf(s, { tourVisible: true }))).toEqual([]);
  });

  it('zwykły dymek czeka pod oknem gry i przy czekającej karcie, a dymek „w oknie” wtedy właśnie się pokazuje', () => {
    const g = game();
    g.s.milestonesReady.push(MILESTONES[0]!.id);
    expect(ids(ctxOf(g.s, { windowOpen: true }))).toEqual([]);
    untilCard(g);
    expect(ids(ctxOf(g.s))).toEqual(['tip-karta']);
  });
});

describe('dymek na ekranie', () => {
  it('„OK” zapisuje dymek jako widziany i go chowa', () => {
    showTip('tip-cel');
    dismissTip();
    expect(shownTip.value).toBeNull();
    expect(loadTutorial().seen).toEqual(['tip-cel']);
  });

  it('rozwiązane zdarzenie (dymek wypadł z kandydatów) też trafia do widzianych', () => {
    showTip('tip-przejscia');
    settleTips([{ id: 'tip-przejscia', inWindow: false, targets: [], text: '' }]);
    expect(shownTip.value).toBe('tip-przejscia');
    settleTips([]);
    expect(shownTip.value).toBeNull();
    expect(loadTutorial().seen).toEqual(['tip-przejscia']);
  });
});

describe('teksty dymków', () => {
  it('bez opłaty franczyzowej, „do oddania” i WUT', () => {
    const g = game();
    g.s.milestonesReady.push(MILESTONES[0]!.id);
    g.s.pallets[0]!.loc = 'aisle';
    const all = [
      ...tipsFor(ctxOf(g.s), MEM), ...tipsFor(ctxOf(g.s, { tab: 'cele' }), MEM), ...tipsFor(ctxOf(g.s, { tab: 'palety' }), MEM),
      ...tipsFor(ctxOf(g.s, { report: withReport, windowOpen: true }), MEM), ...tipsFor(ctxOf(g.s, { remanentOpen: true, windowOpen: true }), MEM),
    ].map((t) => t.text).join('\n').toLowerCase();
    expect(all).not.toContain('franczyzow');
    expect(all).not.toContain('do oddania');
    expect(all).not.toMatch(/\bwut\b/);
    expect(all).toContain('co 3 miesiące');
  });
});

// --- Miasto i drugi sklep (spec 4a, §17) ---------------------------------------------------------------------------

const CITY_IDS: TipId[] = ['tip-miasto', 'tip-lokal', 'tip-sklepy', 'tip-siec'];
const MIASTO_BEZ_STATUSU = 'Mapa miasta. Kartka „DO WYNAJĘCIA” to wolny lokal. Weźmiesz go, gdy Centrala nada Ci status Partnera: pasek mówi, czego brakuje.';
const MIASTO_ZE_STATUSEM = 'Masz status Partnera. Stuknij kartkę, żeby zobaczyć lokal. Liczby na karcie to widełki, nie obietnica.';
const MIASTO_RANKING = 'W sezonie rankingowym miasto tylko oglądasz.';
const LOKAL = 'Urządzenie lokalu płacisz od razu albo w 12 ratach z przelewów nowego sklepu. Nowy sklep nie ma gwarancji 25 tys. zł: na siebie zarabia sam.';
const SKLEPY = 'Tu przełączasz sklepy. Sklep w tle pracuje sam, a jego karty rozstrzyga zastępca: wybiera odpowiedź zaznaczoną z góry. Ręce masz tylko tam, gdzie jesteś.';
const SIEC = 'Każdy sklep ma swój wyciąg, ale gotówka jest jedna: minus w jednym sklepie zjada plus w drugim.';

describe('dymki miasta: warunki, cele i teksty', () => {
  it('id dymków miasta są w pamięci samouczka, po dymkach z pierwszej wersji, w kolejności ze specu', () => {
    expect(TIP_IDS.slice(-4)).toEqual(CITY_IDS);
  });

  it('tip-miasto: pierwsze otwarcie Miasta, wskazuje pasek statusu; bez statusu tłumaczy, czego brakuje', () => {
    const { s } = game();
    expect(ids(ctxOf(s))).toEqual([]);   // miasto zamknięte: nic
    const tip = tipsFor(ctxOf(s, { cityOpen: true }), MEM)[0]!;
    expect(tip).toMatchObject({ id: 'tip-miasto', inWindow: false, targets: ['city-status'], text: MIASTO_BEZ_STATUSU });
  });

  it('tip-miasto ze statusem Partnera: o kartkach i widełkach', () => {
    const { s } = game();
    expect(tipsFor(ctxOf(s, { cityOpen: true, partner: true }), MEM)[0]!.text).toBe(MIASTO_ZE_STATUSEM);
  });

  it('tip-miasto w rankingu: miasto tylko się ogląda, także gdyby status był ustawiony', () => {
    const { s } = game();
    expect(tipsFor(ctxOf(s, { cityOpen: true, ranked: true }), MEM)[0]!.text).toBe(MIASTO_RANKING);
    expect(tipsFor(ctxOf(s, { cityOpen: true, ranked: true, partner: true }), MEM)[0]!.text).toBe(MIASTO_RANKING);
  });

  it('tip-miasto znika, gdy gracz otworzy kartę wolnego lokalu (zrobił to, o czym dymek mówi); karta innego lokalu go nie rusza', () => {
    const { s } = game();
    expect(ids(ctxOf(s, { cityOpen: true, lotOpen: true }))).not.toContain('tip-miasto');
    expect(ids(ctxOf(s, { cityOpen: true, lotOpen: false }))).toContain('tip-miasto');
  });

  it('tip-lokal: pierwsza karta wolnego lokalu, gdy gracz ma status; wskazuje pakiet otwarcia', () => {
    const { s } = game();
    const tip = tipsFor(ctxOf(s, { cityOpen: true, lotOpen: true, partner: true }), MEM)[0]!;
    expect(tip).toMatchObject({ id: 'tip-lokal', inWindow: false, targets: ['lot-price'], text: LOKAL });
    expect(ids(ctxOf(s, { cityOpen: true, lotOpen: true }))).toEqual([]);                        // bez statusu karta nie ma czego tłumaczyć
    expect(ids(ctxOf(s, { cityOpen: true, lotOpen: false, partner: true }))).toEqual(['tip-miasto']);   // bez otwartej karty
    expect(ids(ctxOf(s, { cityOpen: false, lotOpen: true, partner: true }))).toEqual([]);         // karta bez Miasta (zakładka zamknięta)
  });

  it('tip-sklepy: dwa otwarte sklepy, wskazuje chip przełącznika', () => {
    const { s } = game();
    expect(ids(ctxOf(s, { stores: 1 }))).toEqual([]);
    expect(tipsFor(ctxOf(s, { stores: 2 }), MEM)[0]).toMatchObject({ id: 'tip-sklepy', inWindow: false, targets: ['store-switch'], text: SKLEPY });
  });

  it('tip-siec: w oknie końca miesiąca z dwoma sklepami, wskazuje podsumowanie sieci; pokazuje się nad oknem', () => {
    const { s } = game();
    expect(ids(ctxOf(s, { stores: 2, networkOpen: false, windowOpen: true }))).toEqual([]);
    // okno sieci wystarczy: drugi sklep mógł się zamknąć w minucie tego samego zamknięcia miesiąca
    expect(ids(ctxOf(s, { stores: 1, networkOpen: true, windowOpen: true }))).toEqual(['tip-siec']);
    expect(tipsFor(ctxOf(s, { stores: 2, networkOpen: true, windowOpen: true }), MEM)[0])
      .toMatchObject({ id: 'tip-siec', inWindow: true, targets: ['network-summary'], text: SIEC });
  });

  it('zwykłe dymki miasta czekają pod oknem gry i kartą decyzji, a tip-siec (w oknie) wtedy właśnie się pokazuje', () => {
    const { s } = game();
    const ctx = { cityOpen: true, lotOpen: false, partner: true, stores: 2, networkOpen: true, windowOpen: true };
    expect(ids(ctxOf(s, ctx))).toEqual(['tip-siec']);
    expect(ids(ctxOf(s, { ...ctx, windowOpen: false, networkOpen: false }))).toEqual(['tip-miasto', 'tip-sklepy']);
  });

  it('kilka naraz: kolejność ze specu (miasto, lokal, sklepy, sieć), po dymkach pierwszej wersji', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    expect(ids(ctxOf(s, { cityOpen: true, partner: true, stores: 2 }))).toEqual(['tip-cel', 'tip-miasto', 'tip-sklepy']);
    expect(ids(ctxOf(s, { cityOpen: true, lotOpen: true, partner: true, stores: 2, networkOpen: true }))).toEqual(['tip-cel', 'tip-lokal', 'tip-sklepy', 'tip-siec']);
  });

  it('każdy dymek miasta raz na przeglądarkę, a wyłączone podpowiedzi wyłączają je wszystkie', () => {
    const { s } = game();
    const ctx = ctxOf(s, { cityOpen: true, lotOpen: true, partner: true, stores: 2, networkOpen: true });
    expect(ids(ctx)).toEqual(['tip-lokal', 'tip-sklepy', 'tip-siec']);
    for (const id of CITY_IDS) expect(ids(ctxOf(s, { cityOpen: true, lotOpen: id === 'tip-lokal', partner: true, stores: 2, networkOpen: true }), { ...MEM, seen: [id] })).not.toContain(id);
    expect(ids(ctx, { ...MEM, tips: false })).toEqual([]);
    expect(ids(ctxOf(s, { cityOpen: true, partner: true }), { ...MEM, seen: ['tip-miasto'] })).toEqual([]);
  });

  it('pod oknem wyboru i przy widocznym przelocie: żadnego dymka miasta', () => {
    const { s } = game();
    const ctx = { cityOpen: true, partner: true, stores: 2, networkOpen: true };
    expect(ids(ctxOf(s, { ...ctx, offerOpen: true }))).toEqual([]);
    expect(ids(ctxOf(s, { ...ctx, tourVisible: true }))).toEqual([]);
  });

  it('liczby biorą się ze stałych: gwarancja z GUARANTEE.income, liczba rat z planu pakietu', () => {
    const { s } = game();
    const plan = INSTALLMENTS.plans[INSTALLMENTS.plans.length - 1] as { months: number };
    const income = GUARANTEE.income as number;
    const before = { months: plan.months, income };
    try {
      plan.months = 9;
      (GUARANTEE as { income: number }).income = 30_000;
      const text = tipsFor(ctxOf(s, { cityOpen: true, lotOpen: true, partner: true }), MEM)[0]!.text;
      expect(text).toContain('w 9 ratach');
      expect(text).toContain('30 tys. zł');
    } finally {
      plan.months = before.months;
      (GUARANTEE as { income: number }).income = before.income;
    }
  });

  it('po angielsku: każdy dymek ma wersję, bez polskich liter, z liczbami po angielsku', () => {
    const { s } = game();
    lang.value = 'en';
    const all = [
      ...tipsFor(ctxOf(s, { cityOpen: true }), MEM), ...tipsFor(ctxOf(s, { cityOpen: true, partner: true }), MEM),
      ...tipsFor(ctxOf(s, { cityOpen: true, ranked: true }), MEM), ...tipsFor(ctxOf(s, { cityOpen: true, lotOpen: true, partner: true }), MEM),
      ...tipsFor(ctxOf(s, { stores: 2, networkOpen: true }), MEM),
    ].map((x) => x.text);
    expect(all).toHaveLength(6);
    for (const text of all) expect(text.replace(/zł/g, ''), text).not.toMatch(/[ąćęłńóśźż]/i);   // „zł” zostaje jak w całej angielskiej wersji
    expect(all.find((x) => x.includes('instalments'))).toContain('25,000 zł');
    expect(all.find((x) => x.includes('instalments'))).toContain('12 instalments');
    expect(all.join('\n')).toContain('TO LET');
  });
});

describe('cityFacts: fakty o mieście i sklepach z prawdziwej firmy', () => {
  const view = (over: Partial<Parameters<typeof cityFacts>[1]> = {}) => ({ cityTab: true, selectedLot: null, networkOpen: false, ...over });
  const freeLot = (f: ReturnType<typeof firmOf>): number => f.city.lots.find((l) => l.state === 'wolny')!.id;

  it('bez firmy: nic nie jest otwarte', () => {
    expect(cityFacts(null, view({ selectedLot: 3, networkOpen: true }))).toEqual({
      cityOpen: false, lotOpen: false, partner: false, ranked: false, stores: 0, networkOpen: true,
    });
  });

  it('nowa gra: Miasto otwarte tylko przy zakładce, brak statusu, jeden sklep', () => {
    const f = firmOf(createSession(FIRM_SEED, true));
    expect(cityFacts(f, view())).toEqual({ cityOpen: true, lotOpen: false, partner: false, ranked: false, stores: 1, networkOpen: false });
    expect(cityFacts(f, view({ cityTab: false })).cityOpen).toBe(false);
  });

  it('karta lokalu: tylko wolny lokal i tylko przy otwartym Mieście; lokal obok, zajęty i obcy numer jej nie dają', () => {
    const f = firmOf(partnerSession());
    const free = freeLot(f);
    expect(cityFacts(f, view({ selectedLot: free })).lotOpen).toBe(true);
    expect(cityFacts(f, view({ selectedLot: free, cityTab: false })).lotOpen).toBe(false);
    expect(cityFacts(f, view({ selectedLot: null })).lotOpen).toBe(false);
    expect(cityFacts(f, view({ selectedLot: 99_999 })).lotOpen).toBe(false);
    const other = f.city.lots.find((l) => l.state !== 'wolny')!.id;
    expect(cityFacts(f, view({ selectedLot: other })).lotOpen).toBe(false);
    expect(cityFacts(f, view({ selectedLot: f.stores[0]!.lotId })).lotOpen).toBe(false);   // własny sklep: karta informacyjna
  });

  it('status Partnera, ranking i liczba otwartych sklepów (budowa i zamknięty sklep się nie liczą)', () => {
    const session = partnerSession();
    const f = firmOf(session);
    expect(cityFacts(f, view())).toMatchObject({ partner: true, ranked: false, stores: 1 });
    f.ranked = true;
    expect(cityFacts(f, view()).ranked).toBe(true);
    f.ranked = false;
    openSecond(session);
    expect(cityFacts(f, view()).stores).toBe(2);
    f.stores[1]!.closed = true;
    expect(cityFacts(f, view()).stores).toBe(1);
  });
});

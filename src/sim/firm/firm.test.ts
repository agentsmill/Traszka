import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateCity, lotById } from '@/sim/city/generateCity';
import { siteFor, storeSeedFor } from '@/sim/city/traffic';
import { DEBT_LIMIT, GUARANTEE, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, OWN_COSTS, REMANENT, START_CASH } from '@/sim/economy/catalog';
import { applyCommand, type Command, type CommandOutcome } from '@/sim/economy/commands';
import {
  DEBT_WARN, awaitingDecision, grantDaily, stepMinute, type EconEvent, type EconomyState, type MonthReport,
} from '@/sim/economy/economy';
import { advanceEconomy, type EconClock } from '@/sim/economy/clock';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { levelReward, xpToNext } from '@/sim/economy/progress';
import { NEUTRAL_SITE, activeSite } from '@/sim/economy/site';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { rollWeather } from '@/sim/economy/tycoon/cleanliness';
import { dateOfGameDay } from '@/sim/economy/tycoon/time';
import { freshRun } from '@/sim/run';
import { layoutFor } from '@/sim/store/layoutFor';
import {
  activeStore, advanceFirm, applyStoreCommand, createFirm, emptyStepOut, grantToFirm, openStoreAt, openStores, refreshSites, setPartner,
  stepFirmMinute, syncWallet,
} from './firm';
import { INBOX_MAX, type FirmState, type FirmStepOut } from './types';

/*
 * Firma: lista sklepów na wspólnej gotówce osoby, sklep w tle z zastępcą od kart i debet sprawdzany raz na firmę (spec §11, §12,
 * §14.1). Gracz bez ekspansji gra jak dziś co do bitu, więc pierwsze dwa testy porównują firmę z jednym sklepem z samą ekonomią.
 */

const SEED = 'kiełbasa-42';
const DAY = MINUTES_PER_DAY;
/** Minuta zamknięcia ostatniego dnia września (dzień 29): w tym kroku `closeDay` zamyka też miesiąc. */
const SEPT_CLOSE = 29 * DAY + OPEN_TO;

const hashOf = (s: EconomyState): string => createHash('sha256').update(JSON.stringify(s)).digest('hex');

const newFirm = (seed = SEED, ranked = false): FirmState => {
  const { state, layout, info } = freshRun(seed);
  return createFirm(seed, { econ: state, layout, info }, { ranked });
};
/** Pierwszy wolny lokal miasta (po id). */
const freeLot = (f: FirmState): number => f.city.lots.find((l) => l.state === 'wolny')!.id;
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;
type Store = FirmState['stores'][number];
/** Dwa otwarte sklepy firmy: #1 (aktywny na starcie) i #2. */
const pair = (f: FirmState): [Store, Store] => [f.stores[0]!, f.stores[1]!];
const ofKind = <T extends { kind: string }>(events: readonly T[], kind: string): T[] => events.filter((e) => e.kind === kind);

/** Gracz klika „OK” na kartach aktywnego sklepu (odpowiedź zaznaczona z góry). */
function answerActive(f: FirmState): void {
  const st = activeStore(f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    const r = applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
    expect(r.result.ok).toBe(true);
  }
}

/** Jedna minuta firmy: karty aktywnego sklepu dostają odpowiedź domyślną, potem krok. */
function tick(f: FirmState, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  answerActive(f);
  stepFirmMinute(f, out);
  return out;
}

function playTo(f: FirmState, minute: number, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  while (clockOf(f) < minute && f.over === null && !activeStore(f).econ.gameOver) tick(f, out);
  return out;
}

/** Firma z drugim sklepem otwartym o 6:00 dnia `day` w pierwszym wolnym lokalu. */
function twoStoreFirm(seed = SEED, day = 10): FirmState {
  const f = newFirm(seed);
  playTo(f, day * DAY + OPEN_FROM);
  openStoreAt(f, freeLot(f), clockOf(f));
  return f;
}

/** Wyciągi miesiąca z zebranych zdarzeń: sklep aktywny z `out.active`, pozostałe z `out.background`. */
function reportsOf(f: FirmState, out: FirmStepOut): Map<number, MonthReport> {
  const m = new Map<number, MonthReport>();
  for (const e of ofKind(out.active, 'month')) m.set(f.activeId, e.report!);
  for (const b of out.background) if (b.event.kind === 'month') m.set(b.storeId, b.event.report!);
  return m;
}

/** Sklep bez gwarancji Centrali: trzy zamknięte miesiące w historii (żeby wyciąg w teście nie dostawał dopłaty do 25 tys.). */
function pastGuarantee(econ: EconomyState): void {
  while (econ.history.length < GUARANTEE.months) econ.history.push({ label: 'x', profit: 0, revenue: 0, transfer: 0 });
}

/**
 * Ustawia gotówkę, naliczenia wyciągu (`franchisee.month`) i zaufanie sklepów tuż przed zamknięciem września (dzień 29, 23:00) i
 * wykonuje ten krok. Sklepy mają w historii trzy miesiące, więc nie dostają dopłaty z gwarancji.
 */
function closeSeptember(
  f: FirmState, wallet: number, accrued: Record<number, Partial<EconomyState['franchisee']['month']>>, trust: Record<number, number> = {},
): FirmStepOut {
  playTo(f, SEPT_CLOSE);
  f.person.wallet = wallet;
  syncWallet(f);
  for (const st of f.stores) {
    pastGuarantee(st.econ);
    st.econ.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 0, media: 0, ...accrued[st.id] };
    if (trust[st.id] !== undefined) st.econ.tycoon.trust.value = trust[st.id]!;
  }
  const out = emptyStepOut();
  tick(f, out);
  return out;
}

// --- Firma z jednym sklepem gra jak dziś ---------------------------------------------------------------------------

describe('firma z jednym sklepem', () => {
  it('createFirm: osoba z gotówką i Ogonkami sklepu, sklep startowy #1 w lokalu startowym, bez site', () => {
    const { state, layout, info } = freshRun(SEED);
    const f = createFirm(SEED, { econ: state, layout, info }, { ranked: true });
    expect(f.ranked).toBe(true);
    expect(f.city).toEqual(generateCity(SEED));
    expect(f.person).toEqual({ wallet: START_CASH, ogonki: 0, partner: false, remanentKnown: false });
    expect(f.stores).toHaveLength(1);
    const st = f.stores[0]!;
    expect({ id: st.id, lotId: st.lotId, closed: st.closed, notice: st.notice }).toEqual({ id: 1, lotId: f.city.startLotId, closed: false, notice: null });
    expect(st.econ).toBe(state);
    expect(st.layout).toBe(layout);
    expect(st.info.site).toBeUndefined();
    expect(f).toMatchObject({ activeId: 1, builds: [], monthInvest: 0, inbox: [], over: null, weatherHash: state.seedHash });
    expect(activeStore(f)).toBe(st);
    expect(openStores(f)).toEqual([st]);
  });

  it('§20.2: po 61 dniach ten sam skrót EconomyState co bezpośredni stepMinute (karty: defaultAnswer), bez zdarzeń firmy', () => {
    const end = OPEN_FROM + 61 * DAY;
    const { state, info } = freshRun(SEED);
    const events: EconEvent[] = [];
    while (state.minute < end) {
      for (const card of visibleCards(state.tycoon.cards, state.minute)) {
        applyCommand(state, info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
      }
      stepMinute(state, info, events);
    }
    expect(state.history).toHaveLength(2);   // dwa zamknięte miesiące, więc test obejmuje wyciąg i remanent miesiąca

    const f = newFirm();
    const out = playTo(f, end);
    const econ = activeStore(f).econ;
    expect(hashOf(econ)).toBe(hashOf(state));
    expect(out.active).toEqual(events);
    expect(out.background).toEqual([]);
    expect(out.firm).toEqual([]);
    expect(f.person.wallet).toBe(econ.cash);
    expect(f.over).toBeNull();
  });

  it('applyStoreCommand == applyCommand: skrót po zakupach, ratach i remoncie (polecenia jak w simGolden)', () => {
    // dzień, godzina, minuta, polecenie; dzień 12 dostaje poziom 8 i 50 tys. zł z góry (remont 1), tak samo po obu stronach
    const PLAN: readonly (readonly [number, number, number, Command])[] = [
      [0, 6, 0, { type: 'setOrder', auto: false, manual: 4 }],
      [0, 6, 0, { type: 'movePallet', palletId: 1, loc: 'backroom' }],
      [0, 6, 2, { type: 'setStaffProfile', profile: 'dostawa' }],
      [0, 6, 3, { type: 'tapPallet', palletId: 1 }],
      [0, 6, 4, { type: 'claimMilestone', id: 'pallet1' }],
      [1, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }],
      [2, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
      [3, 7, 0, { type: 'setOrder', auto: true }],
      [6, 12, 30, { type: 'setStaffProfile', profile: 'porzadek' }],
      [8, 12, 0, { type: 'buyEquipment', id: 'sco', raty: true }],
      [10, 12, 0, { type: 'buyUpgrade', id: 'wozek' }],
      [11, 12, 0, { type: 'hire' }],
      [13, 7, 0, { type: 'startRemont', raty: true }],
      [13, 7, 5, { type: 'rushRemont' }],
      [15, 12, 0, { type: 'buyEquipment', id: 'bankomat', raty: true }],
      [16, 12, 0, { type: 'campaign' }],
      [18, 12, 0, { type: 'pinStaff', task: 'kasa', count: 1 }],
      [19, 12, 0, { type: 'fire' }],
    ];
    const at = (day: number, hour: number, minute: number): number => day * DAY + hour * 60 + minute;
    const todo = new Map<number, Command[]>();
    const plan = (minute: number, cmd: Command): void => { todo.set(minute, [...(todo.get(minute) ?? []), cmd]); };
    for (const [d, h, m, cmd] of PLAN) plan(at(d, h, m), cmd);
    for (let d = 0; d < 20; d++) {
      for (let k = 0; k < 8; k++) plan(at(d, 7, 2 + k), { type: 'tapPallet' });
      for (let k = 0; k < 6; k++) plan(at(d, 8, 5 + k), { type: 'tapTill' });
    }
    const boostAt = at(12, 6, 0);
    const end = at(20, 0, 0);
    const trace = (list: unknown[], minute: number, o: CommandOutcome): void => { list.push([minute, o.result, o.events, o.layoutChanged]); };

    const direct = freshRun(SEED);
    let info = direct.info;
    const directTrace: unknown[] = [];
    while (direct.state.minute < end) {
      const m = direct.state.minute;
      if (m === boostAt) { direct.state.level = 8; direct.state.cash += 50_000; }
      for (const cmd of todo.get(m) ?? []) {
        const o = applyCommand(direct.state, info, cmd);
        if (o.layoutChanged && o.info) info = o.info;
        trace(directTrace, m, o);
      }
      for (const card of visibleCards(direct.state.tycoon.cards, m)) {
        applyCommand(direct.state, info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
      }
      stepMinute(direct.state, info, []);
    }

    const f = newFirm();
    const firmTrace: unknown[] = [];
    while (clockOf(f) < end) {
      const m = clockOf(f);
      if (m === boostAt) grantToFirm(f, (s) => { s.level = 8; s.cash += 50_000; });
      for (const cmd of todo.get(m) ?? []) trace(firmTrace, m, applyStoreCommand(f, cmd));
      answerActive(f);
      stepFirmMinute(f, emptyStepOut());
    }

    // test nie jest pusty: remont przeszedł, a raty trafiły do wyciągu
    expect(directTrace.some((t) => (t as [number, unknown, unknown, boolean])[3])).toBe(true);
    expect(direct.state.remontLevel).toBe(1);
    expect(direct.state.franchisee.installments.length).toBeGreaterThan(0);

    const st = activeStore(f);
    expect(firmTrace).toEqual(directTrace);
    expect(hashOf(st.econ)).toBe(hashOf(direct.state));
    expect(st.info).toEqual(info);
    expect(st.layout).toEqual(layoutFor(SEED, 1));
    expect(f.person.wallet).toBe(direct.state.cash);
  });

  it('advanceFirm == advanceEconomy: te same minuty, ten sam stan, zegar tam samo', () => {
    const direct = freshRun(SEED);
    const clockD: EconClock = { acc: 0 };
    const f = newFirm();
    const clockF: EconClock = { acc: 0 };
    const events: EconEvent[] = [];
    for (let frame = 0; frame < 4000 && direct.state.minute < OPEN_FROM + 4 * DAY; frame++) {
      const a = advanceEconomy(direct.state, direct.info, clockD, 1.7, events);
      const b = advanceFirm(f, clockF, 1.7, emptyStepOut());
      expect(b).toBe(a);
      expect(clockF.acc).toBe(clockD.acc);
      for (const card of visibleCards(direct.state.tycoon.cards, direct.state.minute)) {
        applyCommand(direct.state, direct.info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
      }
      answerActive(f);
    }
    expect(direct.state.minute).toBeGreaterThanOrEqual(OPEN_FROM + 4 * DAY);
    expect(hashOf(activeStore(f).econ)).toBe(hashOf(direct.state));
  });

  it('advanceFirm staje na karcie aktywnego sklepu, na stopAt i na over', () => {
    // karta: pętla staje w minucie karty i dalej nie rusza, dopóki gracz nie odpowie
    const f = newFirm();
    const clock: EconClock = { acc: 0 };
    const out = emptyStepOut();
    for (let i = 0; i < 3000 && !awaitingDecision(activeStore(f).econ); i++) advanceFirm(f, clock, 5, out);
    expect(awaitingDecision(activeStore(f).econ)).toBe(true);
    const minute = clockOf(f);
    expect(advanceFirm(f, clock, 100, out)).toBe(0);
    expect(clockOf(f)).toBe(minute);
    answerActive(f);
    expect(advanceFirm(f, clock, 3, out)).toBeGreaterThan(0);

    // stopAt: stan staje dokładnie na tej minucie, także przy dużym `seconds`, a dalej nie rusza ani o krok
    const g = newFirm();
    const stopAt = clockOf(g) + 50;
    expect(advanceFirm(g, { acc: 0 }, 1e6, emptyStepOut(), stopAt)).toBe(50);
    expect(clockOf(g)).toBe(stopAt);
    expect(advanceFirm(g, { acc: 0 }, 1e6, emptyStepOut(), stopAt)).toBe(0);

    // over: kontrola debetu firmy kończy grę po pierwszej minucie, a potem pętla stoi
    const h = twoStoreFirm(SEED, 3);
    answerActive(h);
    h.person.wallet = DEBT_LIMIT - 1;
    syncWallet(h);
    expect(advanceFirm(h, { acc: 0 }, 100, emptyStepOut())).toBe(1);
    expect(h.over).toBe('debt');
    expect(advanceFirm(h, { acc: 0 }, 100, emptyStepOut())).toBe(0);
  });
});

// --- Skład firmy: flagi sklepów, premia sieci, nowy sklep ---------------------------------------------------------

describe('openStoreAt, refreshSites, setPartner', () => {
  it('drugi sklep: seed i układ z lokalu miasta, flagi dodatkowego sklepu, gotówka z osoby, ten sam minutnik; #1 dostaje tylko firmDebt', () => {
    const f = newFirm();
    f.person.wallet = 12_345;
    f.person.ogonki = 7;
    f.person.remanentKnown = true;
    syncWallet(f);
    const lotId = freeLot(f);
    const lot = lotById(f.city, lotId);
    const first = f.stores[0]!;
    const st = openStoreAt(f, lotId, clockOf(f));

    expect(f.stores.map((s) => s.id)).toEqual([1, 2]);
    expect(st.lotId).toBe(lotId);
    expect(st.econ.seed).toBe(storeSeedFor(SEED, lotId));
    expect(st.layout).toEqual(layoutFor(storeSeedFor(SEED, lotId), 0, lot.spec));
    expect(st.layout.lot.kind).toBe(lot.spec.kind);
    expect(st.info).toEqual({ ...computeStoreInfo(st.layout), site: siteFor(f.city, lotId, { extra: true, ownCosts: false, firmDebt: true, weatherHash: f.weatherHash }) });
    expect(st.info.site!.district).toBe(lot.district);
    expect(st.info.site!.lot).toEqual(lot.spec);
    expect(st.econ.minute).toBe(first.econ.minute);
    expect(st.econ.cash).toBe(12_345);
    expect(st.econ.ogonki).toBe(7);
    expect(st.econ.franchisee.remanent.known).toBe(true);
    expect(st.econ.tycoon.hall.weather).toBe(first.econ.tycoon.hall.weather);
    expect(st.closed).toBe(false);
    expect(st.notice).toBeNull();

    // sklep startowy: tylko flagi firmy, żadnej dzielnicy, więc liczy się jak dziś
    expect(first.info.site).toEqual({ ...NEUTRAL_SITE, extra: false, ownCosts: true, firmDebt: true, weatherHash: null });
    expect(activeSite(first.info)).toBeNull();
  });

  it('refreshSites: jeden sklep startowy bez site; sam sklep niestartowy z extra i ownCosts, ale bez firmDebt; po zamknięciu #1 ZUS idzie do #2', () => {
    const f = twoStoreFirm(SEED, 2);
    const [a, b] = pair(f);
    expect(a.info.site?.firmDebt).toBe(true);
    expect(b.info.site).toMatchObject({ extra: true, ownCosts: false, firmDebt: true, weatherHash: f.weatherHash });

    b.closed = true;
    refreshSites(f);
    expect(a.info.site).toBeUndefined();   // jeden otwarty sklep, startowy

    b.closed = false;
    a.closed = true;
    refreshSites(f);
    expect(b.info.site).toMatchObject({ extra: true, ownCosts: true, firmDebt: false, weatherHash: f.weatherHash });
    expect(b.info.site!.district).toBe(lotById(f.city, b.lotId).district);
  });

  it('setPartner: networkIncome tylko w sklepie o najniższym otwartym id; nowy sklep dostaje punkty i zero dochodu', () => {
    const f = newFirm();
    setPartner(f, { points: 2, networkIncome: 300, stores: 3 });
    expect(f.stores[0]!.econ.partner).toEqual({ points: 2, networkIncome: 300, stores: 3 });
    const st = openStoreAt(f, freeLot(f), clockOf(f));
    expect(st.econ.partner).toEqual({ points: 2, networkIncome: 0, stores: 3 });
    f.stores[0]!.closed = true;
    setPartner(f, { points: 2, networkIncome: 300, stores: 3 });
    expect(st.econ.partner).toEqual({ points: 2, networkIncome: 300, stores: 3 });
    expect(f.stores[0]!.econ.partner.networkIncome).toBe(300);   // zamknięty sklep zostaje, jaki był
  });
});

// --- Wspólna gotówka ------------------------------------------------------------------------------------------------

describe('wspólna gotówka', () => {
  it('bez dublowania: wallet − start == suma zmian cash sklepów minuta po minucie; po każdej minucie cash i ogonki == person', () => {
    const f = twoStoreFirm(SEED, 27);
    const [a, b] = pair(f);
    // wyrocznia: dwa niezależne sklepy z tym samym stanem, każdy na swojej kasie od tej samej gotówki
    const oa = structuredClone(a.econ);
    const ob = structuredClone(b.econ);
    const [infoA, infoB] = [a.info, b.info];
    const w0 = f.person.wallet;
    const g0 = f.person.ogonki;
    const answer = (e: EconomyState, info: StoreInfo): void => {
      for (const card of visibleCards(e.tycoon.cards, e.minute)) applyCommand(e, info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
    };
    let cashMoved = 0;
    while (clockOf(f) < 30 * DAY) {
      answer(oa, infoA);
      answer(ob, infoB);
      stepMinute(oa, infoA, []);
      stepMinute(ob, infoB, []);
      tick(f);
      expect(f.person.wallet - w0).toBeCloseTo(oa.cash - w0 + (ob.cash - w0), 5);
      expect(f.person.ogonki - g0).toBe(oa.ogonki - g0 + (ob.ogonki - g0));
      for (const st of openStores(f)) {
        expect(st.econ.cash).toBe(f.person.wallet);
        expect(st.econ.ogonki).toBe(f.person.ogonki);
      }
      cashMoved = Math.max(cashMoved, Math.abs(f.person.wallet - w0));
    }
    expect(f.stores.map((s) => s.econ.history.length)).toEqual([1, 1]);   // okno objęło zamknięcie miesiąca obu sklepów
    expect(cashMoved).toBeGreaterThan(1000);
  });

  it('Review Focus 4: nagroda za poziom w sklepie w tle wpada do gotówki raz', () => {
    const f = twoStoreFirm(SEED, 5);
    const [a, b] = pair(f);
    expect(awaitingDecision(b.econ)).toBe(false);
    b.econ.xp = xpToNext(b.econ.level);   // najbliższy krok awansuje sklep w tle
    const w0 = f.person.wallet;
    const g0 = f.person.ogonki;
    const step = (e: EconomyState, info: StoreInfo, cash: number, ogonki: number): void => { e.cash = cash; e.ogonki = ogonki; stepMinute(e, info, []); };
    // ta sama minuta policzona ręcznie: #1, potem #2 na gotówce po #1; kontrola to #2 bez awansu
    const refA = structuredClone(a.econ);
    step(refA, a.info, w0, g0);
    const refB = structuredClone(b.econ);
    step(refB, b.info, refA.cash, refA.ogonki);
    const control = structuredClone(b.econ);
    control.xp = 0;
    step(control, b.info, refA.cash, refA.ogonki);

    stepFirmMinute(f, emptyStepOut());
    expect(b.econ.level).toBe(2);
    expect(f.person.wallet).toBe(refB.cash);
    expect(f.person.ogonki).toBe(refB.ogonki);
    expect(f.person.wallet - control.cash).toBe(levelReward(2).cash);   // dokładnie jedna nagroda, nie dwie
    expect(f.person.ogonki - control.ogonki).toBe(levelReward(2).ogonki);
  });

  it('premia dzienna i zarobek offline przez aktywny sklep wpadają do gotówki raz i do kasy każdego sklepu', () => {
    const f = twoStoreFirm(SEED, 2);
    const [a, b] = pair(f);
    const w0 = f.person.wallet;
    const g0 = f.person.ogonki;
    const [otherA, otherB] = [a.econ.total.other, b.econ.total.other];
    grantToFirm(f, (s) => grantDaily(s, 500, 3));
    expect(f.person.wallet).toBe(w0 + 500);
    expect(f.person.ogonki).toBe(g0 + 3);
    for (const st of openStores(f)) {
      expect(st.econ.cash).toBe(w0 + 500);
      expect(st.econ.ogonki).toBe(g0 + 3);
    }
    expect(a.econ.total.other - otherA).toBe(500);   // księgowane w aktywnym sklepie, w drugim nie
    expect(b.econ.total.other).toBe(otherB);
  });

  it('applyStoreCommand przy dwóch sklepach: debet sprawdza firma (poniżej limitu koniec gry we wszystkich), a nie sklep', () => {
    const f = twoStoreFirm(SEED, 2);
    f.person.wallet = DEBT_LIMIT - 5;
    syncWallet(f);
    const o = applyStoreCommand(f, { type: 'tapTill' });
    expect(ofKind(o.events, 'gameover')).toHaveLength(1);
    expect(f.over).toBe('debt');
    expect(f.stores.every((s) => s.econ.gameOver)).toBe(true);
    expect(applyStoreCommand(f, { type: 'tapTill' }).result.ok).toBe(false);   // po końcu gry polecenia odrzuca sama ekonomia
  });
});

// --- Debet firmy ------------------------------------------------------------------------------------------------------

describe('debet firmy', () => {
  it('§11.4: zamknięcie miesiąca −60 tys. w #1 i +30 tys. w #2 przy gotówce −50 tys. nie kończy gry', () => {
    const f = twoStoreFirm(SEED, 25);
    const out = closeSeptember(f, -50_000, { 1: { wages: 60_000 }, 2: { margin: 45_000 } });
    const reports = reportsOf(f, out);
    const n1 = reports.get(1)!.statement!.net;
    const n2 = reports.get(2)!.statement!.net;
    // gdyby debet sprawdzał sklep po swoim kroku, #1 skończyłby grę przed wpłatą z #2: o wyniku decydowałaby kolejność
    expect(-50_000 + n1).toBeLessThan(DEBT_LIMIT);
    expect(-50_000 + n1 + n2).toBeGreaterThan(DEBT_LIMIT);
    expect(f.person.wallet).toBeCloseTo(-50_000 + n1 + n2, 5);
    expect(f.over).toBeNull();
    expect(f.stores.some((s) => s.econ.gameOver)).toBe(false);
    expect(ofKind(out.active, 'gameover')).toEqual([]);
    expect(out.background.filter((b) => b.event.kind === 'gameover')).toEqual([]);
    expect(ofKind(out.firm, 'gameover')).toEqual([]);
    // ostrzeżenie: gotówka zeszła poniżej −50 tys. zł (przejście progu, jedno)
    expect(ofKind(out.firm, 'debt')).toEqual([{ kind: 'debt', params: { cash: f.person.wallet } }]);
    expect(f.person.wallet).toBeLessThan(DEBT_WARN);
    // kto wisi pod progiem, nie dostaje ostrzeżenia co minutę
    expect(ofKind(tick(f).firm, 'debt')).toEqual([]);
  });

  it('Review Focus 1: debet ze sklepu w tle kończy grę, a aktywny sklep ma gameOver === true i jest jedno zdarzenie gameover', () => {
    const f = twoStoreFirm(SEED, 25);
    expect(f.activeId).toBe(1);
    const out = closeSeptember(f, 0, { 2: { wages: 150_000 } });   // wyciąg sklepu #2 w tle (aktywny jest #1)
    expect(reportsOf(f, out).get(2)!.statement!.net).toBeLessThan(DEBT_LIMIT);
    expect(f.person.wallet).toBeLessThan(DEBT_LIMIT);
    expect(f.over).toBe('debt');
    expect(activeStore(f).econ.gameOver).toBe(true);
    expect(f.stores.map((s) => s.econ.gameOver)).toEqual([true, true]);
    const gameovers = [
      ...ofKind(out.active, 'gameover'), ...out.background.filter((b) => b.event.kind === 'gameover'), ...ofKind(out.firm, 'gameover'),
    ];
    expect(gameovers).toHaveLength(1);
    expect(out.firm.find((e) => e.kind === 'gameover')).toEqual({ kind: 'gameover', params: { reason: 'debt', cash: f.person.wallet } });
    // gra stoi: dalszy krok nic nie robi
    const minute = clockOf(f);
    stepFirmMinute(f, emptyStepOut());
    expect(clockOf(f)).toBe(minute);
  });
});

// --- Sklep w tle: zastępca ---------------------------------------------------------------------------------------------

describe('sklep w tle', () => {
  /** Kroki bez odpowiadania na karty do minuty, w której karta czeka tylko w aktywnym sklepie #1 (sklep #2 jest wtedy bez karty). */
  function untilActiveCard(f: FirmState): void {
    const [a, b] = pair(f);
    for (let i = 0; i < 20 * DAY; i++) {
      if (awaitingDecision(a.econ) && !awaitingDecision(b.econ)) return;
      stepFirmMinute(f, emptyStepOut());
    }
    throw new Error('karta się nie pojawiła');
  }

  it('karta sklepu w tle dostaje defaultAnswer przed jego krokiem, inbox ma wpis, out.firm ma deputy', () => {
    const f = twoStoreFirm(SEED, 3);
    const bg = f.stores[1]!;
    // aktywny #1 odpowiada sam, żeby stanęła tylko karta tła
    for (let i = 0; i < 20 * DAY && !awaitingDecision(bg.econ); i++) tick(f);
    expect(awaitingDecision(bg.econ)).toBe(true);
    const cards = visibleCards(bg.econ.tycoon.cards, bg.econ.minute);
    expect(cards.length).toBeGreaterThan(0);
    const minute = bg.econ.minute;
    const out = emptyStepOut();
    answerActive(f);
    stepFirmMinute(f, out);

    expect(bg.econ.minute).toBe(minute + 1);
    expect(visibleCards(bg.econ.tycoon.cards, minute)).toEqual([]);   // odpowiedź padła przed krokiem, więc karta nie zablokowała tej minuty
    for (const c of cards) {
      const entry = bg.econ.tycoon.cards.log.find((l) => l.seq === c.seq)!;
      expect(entry.answer).toBe(defaultAnswer(c));
      expect(f.inbox).toContainEqual({ day: Math.floor(minute / DAY), storeId: 2, card: c.id, answer: defaultAnswer(c) });
      expect(out.firm).toContainEqual({ kind: 'deputy', storeId: 2, params: { card: c.id, answer: defaultAnswer(c) } });
    }
    expect(ofKind(out.firm, 'deputy')).toHaveLength(cards.length);
  });

  it('skrzynka zastępcy trzyma najwyżej INBOX_MAX wpisów (najstarsze odpadają), zdarzenia idą dalej', () => {
    const f = twoStoreFirm(SEED, 3);
    f.inbox = Array.from({ length: INBOX_MAX }, (_, i) => ({ day: i, storeId: 2, card: 'stary', answer: 0 }));
    const bg = f.stores[1]!;
    for (let i = 0; i < 20 * DAY && !awaitingDecision(bg.econ); i++) tick(f);
    const out = emptyStepOut();
    answerActive(f);
    stepFirmMinute(f, out);
    expect(ofKind(out.firm, 'deputy').length).toBeGreaterThan(0);
    expect(f.inbox).toHaveLength(INBOX_MAX);
    expect(f.inbox[f.inbox.length - 1]!.card).not.toBe('stary');
    expect(f.inbox[0]!.day).toBeGreaterThan(0);
  });

  it('Review Focus 2: karta, która pojawia się w tle w minucie przełączenia, po przełączeniu czeka na gracza', () => {
    const f = twoStoreFirm(SEED, 3);
    // karta #2 pojawia się w tym kroku (aktywny #1 odpowiada na swoje)
    const bg = f.stores[1]!;
    for (let i = 0; i < 20 * DAY && !awaitingDecision(bg.econ); i++) tick(f);
    expect(awaitingDecision(bg.econ)).toBe(true);

    f.activeId = 2;   // przełączenie w tej samej minucie, zanim zastępca zdążył odpowiedzieć
    const out = emptyStepOut();
    const clock: EconClock = { acc: 0 };
    const minute = clockOf(f);
    expect(advanceFirm(f, clock, 100, out)).toBe(0);   // gra staje na karcie nowego aktywnego sklepu
    expect(clockOf(f)).toBe(minute);
    expect(awaitingDecision(activeStore(f).econ)).toBe(true);
    expect(f.inbox).toEqual([]);
    expect(ofKind(out.firm, 'deputy')).toEqual([]);

    answerActive(f);   // odpowiedź gracza
    expect(awaitingDecision(activeStore(f).econ)).toBe(false);
    expect(advanceFirm(f, clock, 100, out)).toBeGreaterThan(0);
  });

  it('porzucona karta aktywnego sklepu: po przełączeniu gra nie staje, a następna minuta oddaje ją zastępcy ze wpisem w skrzynce', () => {
    const f = twoStoreFirm(SEED, 3);
    const [first] = pair(f);
    untilActiveCard(f);
    const cards = visibleCards(first.econ.tycoon.cards, first.econ.minute);
    f.activeId = 2;   // gracz przełącza się i zostawia kartę na biurku

    const out = emptyStepOut();
    const steps = advanceFirm(f, { acc: 0 }, 100, out);
    expect(steps).toBeGreaterThan(0);   // gra się nie zawiesiła
    expect(awaitingDecision(first.econ)).toBe(false);
    for (const c of cards) {
      expect(f.inbox).toContainEqual({ day: Math.floor(first.econ.minute / DAY), storeId: 1, card: c.id, answer: defaultAnswer(c) });
      expect(out.firm).toContainEqual({ kind: 'deputy', storeId: 1, params: { card: c.id, answer: defaultAnswer(c) } });
    }
  });

  it('karta aktywnego sklepu zostaje graczowi: krok firmy jej nie rusza i zastępca za niego nie odpowiada', () => {
    const f = twoStoreFirm(SEED, 3);
    const [first] = pair(f);
    untilActiveCard(f);
    const seqs = visibleCards(first.econ.tycoon.cards, first.econ.minute).map((c) => c.seq);
    const out = emptyStepOut();
    stepFirmMinute(f, out);
    expect(visibleCards(first.econ.tycoon.cards, first.econ.minute).map((c) => c.seq)).toEqual(expect.arrayContaining(seqs));
    expect(f.inbox.filter((n) => n.storeId === 1)).toEqual([]);
    expect(out.firm.filter((e) => e.kind === 'deputy' && e.storeId === 1)).toEqual([]);
  });

  it('zdarzenia: aktywnego bez zmian do out.active, tła z flagą important tylko dla month, remanent, trust-tier i gameover', () => {
    const f = twoStoreFirm(SEED, 25);
    f.person.wallet += 50_000;   // żeby sam przebieg do końca miesiąca nie dotknął debetu
    syncWallet(f);
    const out = playTo(f, 30 * DAY);
    const bg = out.background;
    expect(bg.length).toBeGreaterThan(0);
    expect(bg.every((b) => b.storeId === 2)).toBe(true);
    for (const b of bg) {
      expect(b.important, b.event.kind).toBe(['month', 'remanent', 'trust-tier', 'gameover'].includes(b.event.kind));
    }
    expect(bg.filter((b) => b.event.kind === 'month')).toHaveLength(1);
    expect(bg.find((b) => b.event.kind === 'month')!.important).toBe(true);
    expect(ofKind(out.active, 'month')).toHaveLength(1);
    expect(bg.some((b) => !b.important)).toBe(true);   // np. koniec dnia
  });

  it('nowy próg zaufania ze sklepu w tle jest ważny i czeka na „OK”', () => {
    const f = twoStoreFirm(SEED, 25);
    // wyciąg ze stratą (−8) zrzuca zaufanie sklepu #2 z 61 poniżej progu 60
    const out = closeSeptember(f, 100_000, { 2: { wages: 20_000 } }, { 2: 61 });
    const tier = out.background.filter((b) => b.event.kind === 'trust-tier');
    expect(tier).toHaveLength(1);
    expect(tier[0]).toMatchObject({ storeId: 2, important: true });
  });
});

// --- Wspólne i osobne: pogoda, dochód z sieci, ZUS, gwarancja, remanent --------------------------------------------------

describe('wspólne i osobne', () => {
  it('pogoda równa w obu sklepach przez 10 dni; networkIncome 300 wpływa raz dziennie; ZUS i księgowa raz w miesiącu', () => {
    const run = (income: number): { f: FirmState; out: FirmStepOut; weather: [string, string][]; days: number[] } => {
      const f = twoStoreFirm(SEED, 18);
      if (income > 0) setPartner(f, { points: 0, networkIncome: income, stores: 0 });
      const weather: [string, string][] = [];
      const days: number[] = [];
      const out = emptyStepOut();
      for (let day = 18; day < 31; day++) {
        playTo(f, day * DAY + OPEN_FROM + 1, out);
        const [a, b] = f.stores;
        weather.push([a!.econ.tycoon.hall.weather, b!.econ.tycoon.hall.weather]);
        days.push(day);
      }
      return { f, out, weather, days };
    };
    const withIncome = run(300);
    const without = run(0);

    // pogoda: ta sama w #1 i #2 w każdym z 13 dni; własny skrót sklepu #2 dałby inną w którymś z nich (test nie jest pusty)
    expect(withIncome.weather.every(([x, y]) => x === y)).toBe(true);
    const own = withIncome.days.filter((d, i) => rollWeather(withIncome.f.stores[1]!.econ.seedHash, d, dateOfGameDay(d).month) !== withIncome.weather[i]![0]);
    expect(own.length).toBeGreaterThan(0);

    // dochód z sieci: 300 zł raz dziennie, tylko w sklepie #1, a reszta rozgrywki ta sama
    const closedDays = ofKind(withIncome.out.active, 'day').length;
    expect(closedDays).toBeGreaterThanOrEqual(12);
    expect(withIncome.f.person.wallet - without.f.person.wallet).toBeCloseTo(300 * closedDays, 5);
    expect(withIncome.f.stores[0]!.econ.total.other - without.f.stores[0]!.econ.total.other).toBeCloseTo(300 * closedDays, 5);
    expect(withIncome.f.stores[1]!.econ.total.other).toBe(without.f.stores[1]!.econ.total.other);

    // ZUS i księgowa: raz w miesiącu, płaci je sklep o najniższym id; #2 ma 0
    const reports = reportsOf(withIncome.f, withIncome.out);
    expect(reports.get(1)!.statement).toMatchObject({ zus: OWN_COSTS.zus, accounting: OWN_COSTS.accounting });
    expect(reports.get(2)!.statement).toMatchObject({ zus: 0, accounting: 0 });
  });

  it('nowy sklep: guarantee 0 w pierwszym wyciągu, a sklep nie jest pominięty w raporcie miesiąca', () => {
    const f = twoStoreFirm(SEED, 24);
    playTo(f, SEPT_CLOSE);
    const b = f.stores[1]!.econ;
    // bez flagi extra sklep dostałby dopłatę do 25 tys. zł: pierwszy miesiąc, zaufanie i brak mandatu
    expect(GUARANTEE.income - (b.month.margin + b.month.bonus)).toBeGreaterThan(0);
    expect(b.tycoon.trust.value).toBeGreaterThanOrEqual(GUARANTEE.minTrust);
    expect(b.month.fineCount).toBe(0);
    expect(b.history).toHaveLength(0);
    const out = emptyStepOut();
    tick(f, out);
    expect(reportsOf(f, out).get(2)!.statement!.guarantee).toBe(0);
  });

  it('remanent w całej sieci tego samego dnia; pierwszy remanent któregokolwiek sklepu ustawia person.remanentKnown, a nowy sklep to dziedziczy', () => {
    const f = twoStoreFirm(SEED, 10);
    f.person.wallet += 100_000;   // przebieg do końca listopada bez kłopotów z debetem
    syncWallet(f);
    const [a, b] = pair(f);
    expect(a.econ.franchisee.remanent.nextDay).toBe(b.econ.franchisee.remanent.nextDay);   // ten sam termin od otwarcia
    expect(f.person.remanentKnown).toBe(false);
    const due = a.econ.franchisee.remanent.nextDay;
    const out = playTo(f, due * DAY + REMANENT.at + 1);
    const protocols = [
      ...ofKind(out.active, 'remanent').map((e) => e.remanent!),
      ...out.background.filter((e) => e.event.kind === 'remanent').map((e) => e.event.remanent!),
    ];
    expect(protocols).toHaveLength(2);
    expect(protocols[0]!.day).toBe(due);
    expect(protocols[1]!.day).toBe(due);
    expect(out.background.find((e) => e.event.kind === 'remanent')!.important).toBe(true);
    expect(f.person.remanentKnown).toBe(true);

    const third = openStoreAt(f, f.city.lots.find((l) => l.state === 'wolny' && l.id !== b.lotId)!.id, clockOf(f));
    expect(third.econ.franchisee.remanent.known).toBe(true);
  });

  it('network-report przy dwóch sklepach: profit i net każdego, invest, total == suma; invest zerowany', () => {
    const f = twoStoreFirm(SEED, 24);
    f.monthInvest = 4_600;   // pakiet otwarcia zapłacony gotówką w tym miesiącu (dopisuje go wynajem z Zadania 5)
    const out = playTo(f, SEPT_CLOSE + 1);
    const reports = ofKind(out.firm, 'network-report');
    expect(reports).toHaveLength(1);
    const sum = reports[0]!.summary!;
    const rep = reportsOf(f, out);
    expect(sum.label).toBe(rep.get(1)!.label);
    expect(sum.stores).toEqual([1, 2].map((id) => ({ id, profit: rep.get(id)!.profit, net: rep.get(id)!.statement!.net })));
    expect(sum.invest).toBe(4_600);
    expect(sum.total).toBeCloseTo(sum.stores[0]!.net + sum.stores[1]!.net, 5);
    expect(sum.wallet).toBe(f.person.wallet);
    expect(f.monthInvest).toBe(0);
    expect(playTo(f, SEPT_CLOSE + 2 * DAY).firm.filter((e) => e.kind === 'network-report')).toEqual([]);   // raz w miesiącu
  });

  it('jeden sklep nie składa raportu sieci', () => {
    const f = newFirm();
    f.monthInvest = 100;
    const out = playTo(f, SEPT_CLOSE + 1);
    expect(ofKind(out.active, 'month')).toHaveLength(1);
    expect(ofKind(out.firm, 'network-report')).toEqual([]);
    expect(f.monthInvest).toBe(0);   // inwestycja miesiąca nie przechodzi na następny
  });

  it('ten sam seed i te same kroki dają ten sam stan obu sklepów', () => {
    const [x, y] = [twoStoreFirm(SEED, 4), twoStoreFirm(SEED, 4)];
    playTo(x, 6 * DAY);
    playTo(y, 6 * DAY);
    expect(x.stores.map((s) => hashOf(s.econ))).toEqual(y.stores.map((s) => hashOf(s.econ)));
    expect(hashOf(x.stores[0]!.econ)).not.toBe(hashOf(x.stores[1]!.econ));
  });
});

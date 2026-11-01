import { describe, expect, it, vi } from 'vitest';
import { DEBT_LIMIT, MINUTES_PER_DAY, OPEN_TO, OWN_COSTS } from '@/sim/economy/catalog';
import { awaitingDecision, type MonthReport } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import type { Statement } from '@/sim/economy/franchisee';
import { defaultAnswer, startMonthPreview } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { freshRun } from '@/sim/run';
import { closeStore } from './closure';
import { applyFirmCommand } from './commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, openStores, stepFirmMinute, syncWallet } from './firm';
import { forecastFirm } from './forecast';
import { startFirmMonthPreview, type FirmPreview } from './preview';
import type { FirmEvent, FirmState, FirmStepOut, NetworkSummary } from './types';

/*
 * Prognoza paska i podgląd końca miesiąca dla sieci (spec §11.3): liczą się na kopii firmy tym samym rdzeniem co gra
 * (`stepFirmMinute`), więc podgląd ma się zgadzać z prawdziwym zamknięciem miesiąca co do złotówki, a firma przed nim i po nim
 * ma być taka sama co do znaku.
 */

const SEED = 'kiełbasa-42';
const DAY = MINUTES_PER_DAY;
/** Dzień 12 w południe: sklep #2 działa od dnia 10, a miesiąc (wrzesień, 30 dni) zamyka się w dniu 29. */
const DAY_12 = 12 * DAY + 720;
const SEPT_CLOSE = 29 * DAY + OPEN_TO;
const WALLET = 200_000;

const digest = (f: FirmState): string => JSON.stringify(f);
const ofKind = (events: readonly FirmEvent[], kind: string): FirmEvent[] => events.filter((e) => e.kind === kind);
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;

const newFirm = (): FirmState => {
  const { state, layout, info } = freshRun(SEED);
  return createFirm(SEED, { econ: state, layout, info }, { ranked: false });
};
/** Firma ze statusem Partnera i gotówką na pakiet. */
function partnerFirm(wallet = WALLET): FirmState {
  const f = newFirm();
  f.person.partner = true;
  f.person.wallet = wallet;
  syncWallet(f);
  return f;
}

/** Gracz klika „OK” na kartach aktywnego sklepu (odpowiedź zaznaczona z góry). */
function answerActive(f: FirmState): void {
  const st = activeStore(f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    expect(applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
  }
}

function tick(f: FirmState, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  answerActive(f);
  stepFirmMinute(f, out);
  return out;
}

function playTo(f: FirmState, minute: number): void {
  while (clockOf(f) < minute && f.over === null && !activeStore(f).econ.gameOver) tick(f);
}

/** Wynajem w pierwszym wolnym lokalu zaraz po starcie; odbiór w dniu `readyDay` (nadpisany, żeby scenariusz nie zależał od lokalu). */
function rent(f: FirmState, pay: 'gotowka' | 'raty', readyDay: number): void {
  const lotId = f.city.lots.find((l) => l.state === 'wolny')!.id;
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay }, emptyStepOut())).toEqual({ ok: true });
  f.builds[f.builds.length - 1]!.readyDay = readyDay;
}

/** Dwa sklepy od dnia 10 (sklep #2 otwiera krok firmy, jak w grze); gra stoi w minucie `minute`. */
function twoStores(pay: 'gotowka' | 'raty' = 'raty', minute = DAY_12): FirmState {
  const f = partnerFirm();
  rent(f, pay, 10);
  playTo(f, minute);
  expect(openStores(f)).toHaveLength(2);
  return f;
}

/** Sklep, któremu Centrala wypowie umowę przy najbliższym zamknięciu miesiąca: zaufanie przy zerze i strata miesiąca. */
function loseTrust(f: FirmState, storeId: number): void {
  const s = f.stores.find((x) => x.id === storeId)!.econ;
  s.tycoon.trust.value = 3;
  s.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 40_000, media: 0 };
}

/** Podgląd do końca porcjami po `chunk` minut. */
function runPreview(f: FirmState, chunk = 100_000): FirmPreview | null {
  const job = startFirmMonthPreview(f);
  let guard = 0;
  while (!job.step(chunk)) if (++guard > 1e6) throw new Error('podgląd się nie kończy');
  return job.result();
}

interface Close { reports: Map<number, MonthReport>; wallet: number; summary: NetworkSummary | undefined; firm: FirmEvent[] }

/** Prawdziwa gra bez poleceń gracza do zamknięcia miesiąca (karty aktywnego sklepu: odpowiedź zaznaczona z góry); zbiera wyciągi. */
function playToClose(f: FirmState): Close {
  const reports = new Map<number, MonthReport>();
  let summary: NetworkSummary | undefined;
  const firm: FirmEvent[] = [];
  for (let guard = 0; guard < 40 * DAY; guard++) {
    const activeId = f.activeId;   // zdarzenia `active` należą do sklepu, który był aktywny przed krokiem (zamknięcie mogło przełączyć)
    const out = tick(f);
    for (const e of out.active) if (e.kind === 'month' && e.report) reports.set(activeId, e.report);
    for (const b of out.background) if (b.event.kind === 'month' && b.event.report) reports.set(b.storeId, b.event.report);
    for (const e of out.firm) {
      if (e.kind === 'network-report') summary = e.summary;
      firm.push(e);
    }
    if (reports.size > 0 || f.over !== null || activeStore(f).econ.gameOver) break;
  }
  return { reports, wallet: f.person.wallet, summary, firm };
}

/** Podgląd równa się zamknięciu: wyciąg, etykieta, gotówka po zamknięciu, wynik i liczniki każdego sklepu oraz gotówka firmy. */
function expectSameAsReal(preview: FirmPreview, real: Close): void {
  expect(preview.stores.map((s) => s.id)).toEqual([...real.reports.keys()].sort((a, b) => a - b));
  for (const { id, preview: p } of preview.stores) {
    const r = real.reports.get(id)!;
    expect(p.statement, `wyciąg sklepu ${id}`).toEqual(r.statement);
    expect(p.label, `etykieta sklepu ${id}`).toBe(r.label);
    expect(p.cashAfter, `gotówka po zamknięciu sklepu ${id}`).toBe(r.cash);
    expect(p.profit, `wynik sklepu ${id}`).toBe(r.profit);
    expect(p.revenue).toBe(r.counters.revenue);
    expect(p.customers).toBe(r.counters.customers);
    expect(p.endedEarly).toBe(false);
  }
  expect(preview.cashAfter).toBe(real.wallet);
}

const deepFreeze = <T>(x: T): T => {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
};

// --- Podgląd równy zamknięciu ---------------------------------------------------------------------------------------------

describe('podgląd końca miesiąca dla sieci: równy prawdziwemu zamknięciu', () => {
  it.each([1, 2])('§11.3: dwa sklepy od dnia 10, podgląd z dnia 12 (aktywny #%i) daje te same wyciągi i tę samą gotówkę co gra do zamknięcia', (active) => {
    const f = twoStores('raty');
    if (active === 2) expect(applyFirmCommand(f, { type: 'switchStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: true });
    const inboxBefore = f.inbox.length;
    const before = digest(f);
    const cashNow = f.person.wallet;

    const preview = runPreview(f)!;
    expect(preview).not.toBeNull();
    expect(digest(f)).toBe(before);   // podgląd nie rusza firmy

    const real = playToClose(f);
    expect(real.reports.size).toBe(2);
    expectSameAsReal(preview, real);
    expect(preview.cashNow).toBe(cashNow);
    expect(preview.label).toBe([...real.reports.values()][0]!.label);
    expect(preview.gameOver).toBeNull();
    expect(preview.endedEarly).toBe(false);
    expect(preview.lowestCash).toBeLessThanOrEqual(Math.min(preview.cashNow, preview.cashAfter));
    // w tym scenariuszu zastępca naprawdę odpowiadał w sklepie w tle, więc podgląd ćwiczy i tę ścieżkę
    expect(f.inbox.length).toBeGreaterThan(inboxBefore);
    // sklep #1 płaci ZUS i księgową, dodatkowy #2 nie (flagi z `refreshSites` na kopii)
    expect(preview.stores[0]!.preview.statement.zus).toBe(OWN_COSTS.zus);
    expect(preview.stores[1]!.preview.statement.zus).toBe(0);
  });

  it('karta aktywnego sklepu, która zatrzymuje grę w chwili podglądu, dostaje odpowiedź domyślną; prawdziwa karta zostaje bez odpowiedzi', () => {
    const f = twoStores('raty', 11 * DAY);
    const a = activeStore(f);
    for (let guard = 0; guard < 10 * DAY && !awaitingDecision(a.econ); guard++) stepFirmMinute(f, emptyStepOut());   // bez odpowiedzi
    expect(awaitingDecision(a.econ)).toBe(true);
    const before = digest(f);

    const preview = runPreview(f)!;
    expect(digest(f)).toBe(before);
    expect(awaitingDecision(a.econ)).toBe(true);
    expectSameAsReal(preview, playToClose(f));
  });

  it('wynik nie zależy od wielkości porcji', () => {
    const f = twoStores('raty');
    const whole = runPreview(f, 1_000_000);
    expect(runPreview(f, 60)).toEqual(whole);
    expect(runPreview(f, 777)).toEqual(whole);
  });

  it('pakiet za gotówkę: invest to pakiet z paska, a podgląd zgadza się z podsumowaniem sieci z zamknięcia', () => {
    const f = twoStores('gotowka');
    expect(f.monthInvest).toBeGreaterThan(0);
    const preview = runPreview(f)!;
    expect(preview.invest).toBe(f.monthInvest);

    const real = playToClose(f);
    expect(real.summary).toBeDefined();
    expect(preview.invest).toBe(real.summary!.invest);
    expect(preview.cashAfter).toBe(real.summary!.wallet);
    expect(preview.stores.map((s) => s.preview.profit)).toEqual(real.summary!.stores.map((s) => s.profit));
    expect(preview.stores.map((s) => s.preview.statement.net)).toEqual(real.summary!.stores.map((s) => s.net));
    expectSameAsReal(preview, real);
  });

  it('budowa, która kończy się w trakcie podglądu, daje sklep #2 w podglądzie (jak w grze)', () => {
    const f = partnerFirm();
    rent(f, 'raty', 20);
    playTo(f, 3 * DAY);
    expect(openStores(f)).toHaveLength(1);
    const before = digest(f);

    const preview = runPreview(f)!;
    expect(digest(f)).toBe(before);
    expect(preview.stores.map((s) => s.id)).toEqual([1, 2]);
    expect(preview.stores[1]!.preview.statement.installments).toBeGreaterThan(0);   // pierwsza rata pakietu
    expectSameAsReal(preview, playToClose(f));
  });

  it('podgląd nie zmienia firmy ani miasta: skrót przed i po, miasto zamrożone, kopia bez miasta', () => {
    const f = twoStores('raty');
    const before = digest(f);
    const clones = vi.spyOn(globalThis, 'structuredClone');
    const job = startFirmMonthPreview(f);
    const cloned = clones.mock.calls.map((c) => c[0] as object);
    clones.mockRestore();
    expect(cloned.length).toBeGreaterThan(0);
    for (const c of cloned) expect(Object.hasOwn(c, 'city')).toBe(false);   // miasto jest wspólne, tylko do odczytu

    deepFreeze(f.city);
    while (!job.step(100_000)) { /* do końca */ }
    expect(job.result()).not.toBeNull();
    expect(digest(f)).toBe(before);
  });

  it('podgląd w połowie biegu nie zmienia dalszego przebiegu: z podglądem i bez to ten sam stan firmy', () => {
    const play = (withPreview: boolean): string => {
      const f = twoStores('raty', 11 * DAY);
      if (withPreview) {
        runPreview(f);
        playTo(f, DAY_12);
        runPreview(f);
      }
      playTo(f, 15 * DAY);
      return digest(f);
    };
    expect(play(true)).toBe(play(false));
  });
});

// --- Jeden sklep ---------------------------------------------------------------------------------------------------------

describe('podgląd końca miesiąca dla firmy z jednym sklepem', () => {
  it.each([0, 4, 17])('dzień %i miesiąca: stores[0].preview równa się startMonthPreview sklepu', (days) => {
    const f = newFirm();
    playTo(f, days * DAY + 600);
    const st = f.stores[0]!;
    const single = startMonthPreview(st.econ, st.info);
    while (!single.step(100_000)) { /* do końca */ }

    const preview = runPreview(f)!;
    expect(preview.stores).toHaveLength(1);
    expect(preview.stores[0]!.id).toBe(1);
    expect(preview.stores[0]!.preview).toEqual(single.result());
    expect(preview).toMatchObject({
      label: single.result()!.label, cashNow: single.result()!.cashNow, cashAfter: single.result()!.cashAfter,
      lowestCash: single.result()!.lowestCash, invest: 0, gameOver: null, endedEarly: false,
    });
  });

  it('postęp liczy dni od dziś do ostatniego dnia miesiąca jak podgląd sklepu', () => {
    const f = twoStores('raty');   // 13. września (dzień 12): do 30. września zostaje 18 dni
    const job = startFirmMonthPreview(f);
    const single = startMonthPreview(activeStore(f).econ, activeStore(f).info);
    expect(job.progress()).toEqual(single.progress());
    expect(job.progress()).toEqual({ day: 1, days: 18 });
    expect(job.result()).toBeNull();
    job.step(3 * DAY);
    expect(job.progress().day).toBeGreaterThanOrEqual(3);
    while (!job.step(DAY)) { /* do końca */ }
    expect(job.progress().day).toBe(18);
    expect(job.result()).not.toBeNull();
  });

  it('gra, która już się skończyła, nie ma podglądu', () => {
    const over = newFirm();
    over.over = 'closed';
    const a = startFirmMonthPreview(over);
    expect(a.step(DAY)).toBe(true);
    expect(a.result()).toBeNull();

    const dead = newFirm();
    activeStore(dead).econ.gameOver = true;
    const b = startFirmMonthPreview(dead);
    expect(b.step(DAY)).toBe(true);
    expect(b.result()).toBeNull();
  });
});

// --- Koniec gry w podglądzie ---------------------------------------------------------------------------------------------

describe('podgląd końca miesiąca dla sieci: koniec gry', () => {
  /** Potrącenie ponad dwie granice debetu przy pustej kasie: przelew kończy grę, ale miesiąc zdążył się zamknąć. */
  const ruin = (f: FirmState, storeId: number): void => {
    f.person.wallet = 0;
    f.stores.find((s) => s.id === storeId)!.econ.franchisee.remanent.pending = 2 * Math.abs(DEBT_LIMIT);
    syncWallet(f);
  };

  it('jeden sklep: debet przy zamknięciu miesiąca jak w podglądzie sklepu', () => {
    const f = newFirm();
    playTo(f, 3 * DAY);
    ruin(f, 1);
    const st = f.stores[0]!;
    const single = startMonthPreview(st.econ, st.info);
    while (!single.step(100_000)) { /* do końca */ }

    const preview = runPreview(f)!;
    expect(preview.gameOver).toBe('debt');
    expect(preview.cashAfter).toBeLessThan(DEBT_LIMIT);
    expect(preview.endedEarly).toBe(false);
    expect(preview.stores[0]!.preview).toEqual(single.result());
  });

  it('dwa sklepy: debet całej gotówki przy zamknięciu miesiąca; sklepy mają wyciągi, a firma mówi o debecie', () => {
    const f = twoStores('raty');
    ruin(f, 2);
    const before = digest(f);
    const preview = runPreview(f)!;
    expect(digest(f)).toBe(before);
    expect(preview.gameOver).toBe('debt');
    expect(preview.cashAfter).toBeLessThan(DEBT_LIMIT);
    expect(preview.endedEarly).toBe(false);
    expect(preview.lowestCash).toBeLessThanOrEqual(preview.cashAfter);
    expect(preview.stores.map((s) => s.id)).toEqual([1, 2]);

    const real = playToClose(f);
    expect(f.over).toBe('debt');
    expectSameAsReal(preview, real);
  });

  it('dwa sklepy: debet w środku miesiąca kończy podgląd przed zamknięciem, z naliczeniami do tej chwili', () => {
    const f = twoStores('raty');
    f.person.wallet = DEBT_LIMIT + 1;   // pierwszy wydatek z gotówki (mandat, koszt z karty) przekracza granicę
    syncWallet(f);
    const preview = runPreview(f)!;
    expect(preview).not.toBeNull();
    expect(preview.endedEarly).toBe(true);
    expect(preview.gameOver).toBe('debt');
    expect(preview.label).toBe('');
    expect(preview.cashAfter).toBeLessThan(DEBT_LIMIT);
    expect(preview.stores.map((s) => s.id)).toEqual([1, 2]);
    for (const { preview: p } of preview.stores) {
      expect(p.endedEarly).toBe(true);
      expect(p.gameOver).toBe('debt');
      expect(p.label).toBe('');
      expect(p.statement.guarantee).toBe(0);
      expect(p.statement.installments).toBe(0);
    }

    const real = playToClose(f);
    expect(real.reports.size).toBe(0);   // gra też skończyła się przed zamknięciem
    expect(f.over).toBe('debt');
    expect(preview.cashAfter).toBe(real.wallet);
  });

  it('jeden sklep, zaufanie 0 przy zamknięciu miesiąca: firma kończy grę i podgląd mówi o zaufaniu', () => {
    const f = newFirm();
    playTo(f, SEPT_CLOSE - 3 * DAY);
    loseTrust(f, 1);
    const st = f.stores[0]!;
    const single = startMonthPreview(st.econ, st.info);
    while (!single.step(100_000)) { /* do końca */ }

    const preview = runPreview(f)!;
    expect(single.result()!.gameOver).toBe('trust');
    expect(preview.gameOver).toBe('trust');
    expect(preview.stores[0]!.preview).toEqual(single.result());
    expect(playToClose(f).reports.size).toBe(1);
    expect(f.over).toBe('closed');
  });

  it('dwa sklepy, zaufanie 0 w #2: rozliczenie końcowe spycha gotówkę poniżej granicy, więc podgląd mówi o debecie (koniec ogłosi #1 w następnej minucie)', () => {
    const f = twoStores('raty');
    playTo(f, SEPT_CLOSE - DAY);
    loseTrust(f, 2);
    f.stores[1]!.econ.franchisee.installments.push({ id: 99, label: 'Dług', price: 300_000, fee: 0, total: 300_000, monthly: 1_000, paid: 0, months: 300 });
    f.person.wallet = 0;
    syncWallet(f);

    const preview = runPreview(f)!;
    expect(preview.gameOver).toBe('debt');
    expect(preview.cashAfter).toBeLessThan(DEBT_LIMIT);
    expect(preview.endedEarly).toBe(false);
    expect(preview.stores.find((s) => s.id === 2)!.preview.gameOver).toBe('trust');

    const real = playToClose(f);
    expectSameAsReal(preview, real);
    expect(f.over).toBeNull();   // w minucie zamknięcia gra jeszcze trwa, bo zamknięty sklep zostawił debet na portfelu
    tick(f);
    expect(activeStore(f).econ.gameOver).toBe(true);
  });

  it.each([1, 2])('dwa sklepy, zaufanie 0 w #%i: sklep traci umowę, firma gra dalej, więc gra się nie kończy', (lost) => {
    const f = twoStores('raty');
    playTo(f, SEPT_CLOSE - DAY);
    loseTrust(f, lost);
    const preview = runPreview(f)!;
    expect(preview.gameOver).toBeNull();
    expect(preview.endedEarly).toBe(false);
    expect(preview.stores.map((s) => s.id)).toEqual([1, 2]);
    expect(preview.stores.find((s) => s.id === lost)!.preview.gameOver).toBe('trust');
    expect(preview.stores.find((s) => s.id !== lost)!.preview.gameOver).toBeNull();

    const real = playToClose(f);
    expect(f.over).toBeNull();
    expect(f.stores.find((s) => s.id === lost)!.closed).toBe(true);
    expectSameAsReal(preview, real);
  });
});

// --- Koniec wypowiedzenia w podglądanym miesiącu ---------------------------------------------------------------------------

describe('podgląd końca miesiąca dla sieci: koniec okresu wypowiedzenia', () => {
  /** Dzień 59 w południe: wypowiedzenie złożone we wrześniu kończy się z zamknięciem października (dzień 60). */
  const BEFORE_OCT_CLOSE = 59 * DAY + 720;
  const terminate = (f: FirmState, storeId: number): void => {
    expect(applyFirmCommand(f, { type: 'terminateStore', storeId }, emptyStepOut())).toEqual({ ok: true });
    expect(f.stores.find((s) => s.id === storeId)!.notice).toEqual({ endDay: 60 });
  };

  it('ostatni sklep: #2 wypadł przez zaufanie, a wypowiedzenie #1 kończy się w podglądanym miesiącu, więc gra kończy się z powodu wypowiedzenia', () => {
    const f = twoStores('raty');
    terminate(f, 1);
    playTo(f, SEPT_CLOSE);
    loseTrust(f, 2);
    tick(f);   // wrzesień: #2 traci umowę, #1 zostaje sam z wypowiedzeniem
    expect(f.stores[1]!.closed).toBe(true);
    expect(f.over).toBeNull();
    playTo(f, BEFORE_OCT_CLOSE);

    const before = digest(f);
    const preview = runPreview(f)!;
    expect(digest(f)).toBe(before);
    expect(preview.gameOver).toBe('notice');
    expect(preview.endedEarly).toBe(false);
    expect(preview.stores.map((s) => s.id)).toEqual([1]);

    const real = playToClose(f);
    expect(f.over).toBe('closed');
    expect(ofKind(real.firm, 'gameover')).toEqual([{ kind: 'gameover', params: { reason: 'notice' } }]);
    expectSameAsReal(preview, real);
  });

  it('sklep w tle kończy wypowiedzenie, a #1 gra dalej: rozliczenie końcowe schodzi z gotówki firmy, gra się nie kończy', () => {
    const f = twoStores('raty');
    terminate(f, 2);
    playTo(f, BEFORE_OCT_CLOSE);
    // prognoza paska nie zna rozliczenia końcowego (ukryte ubytki ujawnia dopiero remanent): portfel plus suma „Zostaje Ci”
    const fc = forecastFirm(f);
    expect(fc.cashAfter).toBe(f.person.wallet + fc.stores.reduce((n, s) => n + s.f.net, 0));

    const before = digest(f);
    const preview = runPreview(f)!;
    expect(digest(f)).toBe(before);
    expect(preview.gameOver).toBeNull();
    expect(preview.endedEarly).toBe(false);
    expect(preview.stores.map((s) => s.id)).toEqual([1, 2]);

    const real = playToClose(f);
    expect(f.over).toBeNull();
    expect(f.stores[1]!.closed).toBe(true);
    expect(f.activeId).toBe(1);
    const settlement = ofKind(real.firm, 'settlement');
    expect(settlement).toHaveLength(1);
    const total = settlement[0]!.params!.total as number;
    expect(total).toBeGreaterThan(0);   // niespłacone raty pakietu
    expectSameAsReal(preview, real);
    // podgląd pokazuje to samo rozliczenie co podsumowanie sieci z zamknięcia, więc jego liczby też się zgadzają
    expect(preview.settlement).toBe(total);
    expect(real.summary!.settlement).toBe(total);
    // gotówka firmy w podglądzie to wyciągi obu sklepów bez rozliczenia sklepu #2
    const last = preview.stores[1]!.preview;
    expect(last.cashAfter - total).toBeCloseTo(preview.cashAfter, 6);
    expect(preview.cashAfter).toBeLessThan(last.cashAfter);
  });
});

// --- Prognoza paska ------------------------------------------------------------------------------------------------------

describe('forecastFirm', () => {
  const NUMERIC: Exclude<keyof Statement, 'cashAfter' | 'partial'>[] = [
    'margin', 'bonus', 'guarantee', 'transfer', 'installments', 'pallets', 'remanent', 'deductions', 'wages', 'media', 'zus', 'vat',
    'accounting', 'costs', 'net', 'result', 'spent', 'fines', 'other',
  ];

  it('jeden sklep: prognoza tego sklepu (forecastMonth), z jedną pozycją w stores', () => {
    const f = newFirm();
    playTo(f, 6 * DAY + 300);
    const st = f.stores[0]!;
    const one = forecastMonth(st.econ, st.info);
    const before = digest(f);
    const fc = forecastFirm(f);
    expect(digest(f)).toBe(before);
    expect(fc).toEqual({ ...one, stores: [{ id: 1, f: one }] });
  });

  it('dwa sklepy: cashAfter to portfel plus suma „Zostaje Ci”, a sumy są sumami sklepów w kolejności id', () => {
    const f = twoStores('raty');
    const before = digest(f);
    const fc = forecastFirm(f);
    expect(digest(f)).toBe(before);

    expect(fc.stores.map((s) => s.id)).toEqual([1, 2]);
    for (const { id, f: one } of fc.stores) {
      const st = f.stores.find((s) => s.id === id)!;
      expect(one).toEqual(forecastMonth(st.econ, st.info));
    }
    const net = fc.stores.reduce((n, s) => n + s.f.net, 0);
    expect(fc.net).toBe(net);
    expect(fc.cashAfter).toBe(f.person.wallet + net);
    expect(fc.statement.cashAfter).toBe(fc.cashAfter);
    expect(fc.saldo).toBe(fc.stores.reduce((n, s) => n + s.f.saldo, 0));
    expect(fc.installments).toBe(fc.stores.reduce((n, s) => n + s.f.installments, 0));
    expect(fc.installments).toBeGreaterThan(0);   // rata pakietu sklepu #2
    for (const k of NUMERIC) expect(fc.statement[k], k).toBe(fc.stores.reduce((n, s) => n + s.f.statement[k], 0));
    // żadnego pola wyciągu nie pominięto w sumowaniu
    expect(Object.keys(fc.statement).filter((k) => k !== 'cashAfter' && k !== 'partial').sort()).toEqual([...NUMERIC].sort());
    expect(fc.statement.partial).toBe(false);
    // ZUS i księgową płaci tylko sklep #1
    expect(fc.statement.zus).toBe(OWN_COSTS.zus);
    expect(fc.statement.accounting).toBe(OWN_COSTS.accounting);
  });

  it('sklep zamknięty nie liczy się do prognozy', () => {
    const f = twoStores('raty');
    closeStore(f, 2, 'notice', emptyStepOut());
    const st = f.stores[0]!;
    const fc = forecastFirm(f);
    expect(fc.stores.map((s) => s.id)).toEqual([1]);
    expect(fc).toEqual({ ...forecastMonth(st.econ, st.info), stores: [{ id: 1, f: forecastMonth(st.econ, st.info) }] });
  });
});

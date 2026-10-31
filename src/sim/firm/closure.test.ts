import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dayOf } from '@/sim/economy/calendar';
import { DEBT_LIMIT, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, OWN_COSTS } from '@/sim/economy/catalog';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type EconEvent, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { WUT } from '@/sim/economy/tycoon/wut';
import { freshRun, replayRun, type LogEntry } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { applyFirmCommand, lotState, openDueBuilds, type FirmCommand } from './commands';
import { NOTICE_NO_CREDIT, closeStore, finalSettlement } from './closure';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, openStores, setPartner, stepFirmMinute, syncWallet } from './firm';
import type { FirmBuild, FirmEvent, FirmRefusal, FirmState, FirmStepOut, FirmStore } from './types';

/*
 * Zamknięcie sklepu (spec §13): zaufanie 0 przy zamknięciu miesiąca albo koniec wypowiedzenia gracza. Przy drugim otwartym sklepie
 * rozliczenie końcowe schodzi z portfela jednym ruchem, a gra idzie dalej na pozostałym; zamknięcie ostatniego sklepu kończy grę
 * jak dziś.
 */

const SEED = 'kiełbasa-42';
const DAY = MINUTES_PER_DAY;
/** Minuty zamknięcia września (dzień 29), października (dzień 60) i listopada (dzień 90): w tym kroku `closeDay` zamyka też miesiąc. */
const SEPT_CLOSE = 29 * DAY + OPEN_TO;
const OCT_CLOSE = 60 * DAY + OPEN_TO;
const WALLET = 200_000;

const hashOf = (s: EconomyState): string => createHash('sha256').update(JSON.stringify(s)).digest('hex');
const digest = (f: FirmState): string => JSON.stringify(f);
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;
const ofKind = <T extends { kind: string }>(events: readonly T[], kind: string): T[] => events.filter((e) => e.kind === kind);
const owed = (s: EconomyState): number => s.franchisee.installments.reduce((n, i) => n + i.total - i.paid, 0);
const num = (e: FirmEvent, key: string): number => e.params![key] as number;
const gameoversOf = (out: FirmStepOut): number =>
  ofKind(out.active, 'gameover').length + out.background.filter((b) => b.event.kind === 'gameover').length;

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

function playTo(f: FirmState, minute: number, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  while (clockOf(f) < minute && f.over === null && !activeStore(f).econ.gameOver) tick(f, out);
  return out;
}

/** Sklep #2 w pierwszym wolnym lokalu: wynajem, budowa i otwarcie o 6:00 w dniu odbioru (krok sklepów jeszcze nie poszedł). */
function rentAndOpen(f: FirmState, pay: 'gotowka' | 'raty' = 'raty'): FirmStore {
  const lotId = f.city.lots.find((l) => l.state === 'wolny')!.id;
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay }, emptyStepOut())).toEqual({ ok: true });
  const b: FirmBuild = f.builds[f.builds.length - 1]!;
  playTo(f, b.readyDay * DAY + OPEN_FROM);
  openDueBuilds(f, emptyStepOut());
  return f.stores[f.stores.length - 1]!;
}

/** Sklep, któremu Centrala wypowie umowę przy najbliższym zamknięciu miesiąca: zaufanie przy zerze i strata miesiąca (−8 z wyniku). */
function loseTrust(s: EconomyState): void {
  s.tycoon.trust.value = 3;
  s.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 40_000, media: 0 };
}

/** „Zostaje Ci” z wyciągów miesiąca, które sklepy zamknęły w tej minucie (aktywny z `out.active`, reszta z `out.background`). */
function netsOf(out: FirmStepOut, activeId: number): Map<number, MonthReport> {
  const m = new Map<number, MonthReport>();
  for (const e of ofKind(out.active, 'month')) m.set(activeId, e.report!);
  for (const b of out.background) if (b.event.kind === 'month') m.set(b.storeId, b.event.report!);
  return m;
}
const netTotal = (reports: Map<number, MonthReport>): number => [...reports.values()].reduce((n, r) => n + r.statement!.net, 0);

// --- Rozliczenie końcowe: czysta funkcja ---------------------------------------------------------------------------------

describe('finalSettlement', () => {
  it('raty total − paid, pending i nadwyżka ubytków ponad limit od remanent.fromDay; niczego nie rusza', () => {
    const f = partnerFirm();
    const st = rentAndOpen(f);
    const fr = st.econ.franchisee;
    fr.installments = [
      { id: 1, label: 'a', price: 1000, fee: 100, total: 1100, monthly: 100, paid: 400, months: 11 },
      { id: 2, label: 'b', price: 500, fee: 0, total: 500, monthly: 100, paid: 0, months: 5 },
    ];
    fr.remanent.pending = 250;
    fr.remanent.revenue = 100_000;
    fr.remanent.fromDay = 3;
    st.econ.tycoon.wut.month = { termin: 500, kradziez: 2000, pomylki: 400, karty: 300 };   // razem 3200, limit 1200
    const before = JSON.stringify(st);

    const s = finalSettlement(st, 17);
    expect(JSON.stringify(st)).toBe(before);
    expect(s).toMatchObject({ storeId: st.id, installments: 1200, pending: 250 });
    expect(s.remanent).toMatchObject({
      day: 17, fromDay: 3, revenue: 100_000, total: 3200, charge: 2000, first: true,
      byReason: { termin: 500, kradziez: 2000, pomylki: 400, karty: 300 },
    });
    expect(s.remanent.limit).toBeCloseTo(WUT.threshold * 100_000, 9);
    expect(s.total).toBe(1200 + 250 + 2000);
  });

  it('ubytki w limicie nic nie dokładają, a sklep bez rat i bez pending rozlicza się na zero', () => {
    const f = partnerFirm();
    const st = rentAndOpen(f, 'gotowka');
    st.econ.franchisee.remanent.revenue = 200_000;
    st.econ.tycoon.wut.month = { termin: 100, kradziez: 100, pomylki: 100, karty: 0 };
    expect(finalSettlement(st, 12)).toMatchObject({ installments: 0, pending: 0, remanent: { charge: 0 }, total: 0 });
  });
});

// --- Zamknięcie przy innym otwartym sklepie ------------------------------------------------------------------------------

describe('zaufanie 0 przy dwóch sklepach', () => {
  it('sklep w tle: rozliczenie schodzi z portfela jednym ruchem, lokal po Traszce, wyposażenie zostaje, gra idzie dalej na #1', () => {
    const f = partnerFirm();
    const st2 = rentAndOpen(f, 'raty');
    // SCO na raty w #2 (obok pakietu otwarcia na raty)
    f.activeId = 2;
    activeStore(f).econ.level = 8;
    expect(applyStoreCommand(f, { type: 'buyEquipment', id: 'sco', raty: true }).result.ok).toBe(true);
    f.activeId = 1;
    expect(st2.econ.franchisee.installments).toHaveLength(2);
    expect(st2.econ.equipment.some((u) => u.id === 'sco')).toBe(true);

    playTo(f, SEPT_CLOSE);
    loseTrust(st2.econ);
    st2.econ.tycoon.wut.month.kradziez += 20_000;   // ubytki ponad limit
    const owedBefore = owed(st2.econ);
    const equipment = JSON.stringify(st2.econ.equipment);
    const layout = st2.layout;
    const walletBefore = f.person.wallet;

    const out = tick(f);
    const reports = netsOf(out, 1);
    expect(reports.size).toBe(2);   // wyciąg zamykanego sklepu też przyszedł
    const stmt2 = reports.get(2)!.statement!;
    const settlement = ofKind(out.firm, 'settlement');
    expect(settlement).toHaveLength(1);
    expect(settlement[0]!.storeId).toBe(2);
    // total = raty do spłaty po wyciągu + pending (wyciąg zjadł je wcześniej) + nadwyżka ubytków ponad limit
    expect(num(settlement[0]!, 'installments')).toBeCloseTo(owedBefore - stmt2.installments, 6);
    expect(num(settlement[0]!, 'pending')).toBe(0);
    expect(num(settlement[0]!, 'remanent')).toBe(Math.max(0, Math.round(num(settlement[0]!, 'shrinkage') - num(settlement[0]!, 'limit'))));
    expect(num(settlement[0]!, 'remanent')).toBeGreaterThanOrEqual(19_000);
    expect(num(settlement[0]!, 'total')).toBeCloseTo(num(settlement[0]!, 'installments') + num(settlement[0]!, 'remanent'), 6);
    // gotówka spadła o total w tej minucie (obok przelewów obu wyciągów)
    expect(f.person.wallet).toBeCloseTo(walletBefore + netTotal(reports) - num(settlement[0]!, 'total'), 6);
    expect(openStores(f)[0]!.econ.cash).toBe(f.person.wallet);

    expect(ofKind(out.firm, 'closed')).toEqual([{ kind: 'closed', storeId: 2, params: { reason: 'trust' } }]);
    expect(st2.closed).toBe(true);
    expect(lotState(f, st2.lotId)).toBe('po-traszce');
    expect(JSON.stringify(st2.econ.equipment)).toBe(equipment);
    expect(st2.layout).toBe(layout);
    expect(st2.econ.franchisee.installments).toEqual([]);   // rozliczone, nic nie wisi na zamkniętym sklepie
    // ekran końca gry się nie pojawia: żadnego gameover, gra trwa na #1
    expect(gameoversOf(out)).toBe(0);
    expect(ofKind(out.firm, 'gameover')).toEqual([]);
    expect(f.over).toBeNull();
    expect(f.activeId).toBe(1);
    expect(activeStore(f).econ.gameOver).toBe(false);
    expect(openStores(f)).toHaveLength(1);
    expect(activeStore(f).info.site).toBeUndefined();   // jeden otwarty sklep startowy to sklep jak dziś

    // dalej: #1 liczy się sam, bez drugiego rozliczenia
    const next = playTo(f, OCT_CLOSE);
    tick(f, next);
    expect(ofKind(next.firm, 'settlement')).toEqual([]);
    expect(ofKind(next.active, 'month')).toHaveLength(1);
    expect(f.over).toBeNull();
  });

  it('Review Focus 1: zaufanie 0 w aktywnym #2 przełącza grę na #1 z pulą sił, bez gameover, a #1 płaci ZUS', () => {
    const f = partnerFirm();
    const st2 = rentAndOpen(f, 'gotowka');
    expect(applyFirmCommand(f, { type: 'switchStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: true });
    playTo(f, SEPT_CLOSE);
    st2.econ.tycoon.fatigue.energy = 11;
    st2.econ.tycoon.fatigue.exhaustedDays = 2;
    loseTrust(st2.econ);

    const out = tick(f);
    expect(gameoversOf(out)).toBe(0);
    expect(ofKind(out.firm, 'gameover')).toEqual([]);
    expect(f.over).toBeNull();
    expect(st2.closed).toBe(true);
    expect(f.activeId).toBe(1);
    const a = activeStore(f);
    expect(a.id).toBe(1);
    expect(a.econ.gameOver).toBe(false);
    expect(a.econ.tycoon.fatigue).toEqual(st2.econ.tycoon.fatigue);   // siły franczyzobiorcy idą za nim
    expect(a.econ.tycoon.fatigue).not.toBe(st2.econ.tycoon.fatigue);
    expect(ofKind(out.firm, 'closed')[0]).toEqual({ kind: 'closed', storeId: 2, params: { reason: 'trust' } });
    // zamknięty #2 nie liczy minut, #1 gra dalej i w następnym miesiącu płaci własne koszty
    const frozen = st2.econ.minute;
    const next = playTo(f, OCT_CLOSE);
    tick(f, next);
    expect(st2.econ.minute).toBe(frozen);
    const stmt = ofKind(next.active, 'month')[0]!.report!.statement!;
    expect(stmt.zus).toBe(OWN_COSTS.zus);
    expect(stmt.accounting).toBe(OWN_COSTS.accounting);
  });

  it('zamknięcie sklepu #1: ZUS, księgowa i dochód z sieci przechodzą na #2, aktywny staje się #2', () => {
    const f = partnerFirm();
    const st1 = f.stores[0]!;
    const st2 = rentAndOpen(f, 'gotowka');
    setPartner(f, { points: 2, networkIncome: 30, stores: 1 });
    expect(st1.econ.partner.networkIncome).toBe(30);
    expect(st2.econ.partner).toEqual({ points: 2, networkIncome: 0, stores: 1 });

    playTo(f, SEPT_CLOSE);
    loseTrust(st1.econ);
    const sept = tick(f);
    expect(netsOf(sept, 1).get(2)!.statement!.zus).toBe(0);   // dopóki żyje #1, to on płaci ZUS
    expect(st1.closed).toBe(true);
    expect(f.activeId).toBe(2);
    expect(f.over).toBeNull();
    expect(st2.econ.partner).toEqual({ points: 2, networkIncome: 30, stores: 1 });
    expect(st2.info.site).toMatchObject({ ownCosts: true, firmDebt: false });
    expect(gameoversOf(sept)).toBe(0);

    const next = playTo(f, OCT_CLOSE);
    tick(f, next);
    const stmt = ofKind(next.active, 'month')[0]!.report!.statement!;
    expect(stmt.zus).toBe(OWN_COSTS.zus);
    expect(stmt.accounting).toBe(OWN_COSTS.accounting);
  });

  it('zamknięcie sklepu #2 nie odbiera #1 dochodu z sieci (dochód ma najniższy otwarty sklep)', () => {
    const f = partnerFirm();
    const st1 = f.stores[0]!;
    const st2 = rentAndOpen(f, 'gotowka');
    setPartner(f, { points: 2, networkIncome: 30, stores: 1 });
    playTo(f, SEPT_CLOSE);
    loseTrust(st2.econ);
    tick(f);
    expect(st2.closed).toBe(true);
    expect(f.activeId).toBe(1);   // aktywny #1 zostaje, bez przełączenia
    expect(st1.econ.partner).toEqual({ points: 2, networkIncome: 30, stores: 1 });
  });

  it('zaufanie 0 w środku miesiąca to tylko ostrzeżenie: sklep zamyka dopiero zamknięcie miesiąca', () => {
    const f = partnerFirm();
    const st2 = rentAndOpen(f, 'gotowka');
    st2.econ.tycoon.trust.value = 0;
    playTo(f, clockOf(f) + 3 * DAY);
    expect(st2.closed).toBe(false);
    expect(f.over).toBeNull();
    expect(st2.econ.gameOver).toBe(false);
  });

  it('rozliczenie przekracza próg ostrzeżenia o debecie: jedno ostrzeżenie firmy; poniżej granicy sklep kończy grę sam w następnej minucie', () => {
    const warn = partnerFirm();
    const warnStore = rentAndOpen(warn, 'raty');
    const total = finalSettlement(warnStore, dayOf(clockOf(warn))).total;
    warn.person.wallet = total - 60_000;   // przed rozliczeniem ponad progiem ostrzeżenia, po nim 60 tys. zł pod zerem
    syncWallet(warn);
    const out = emptyStepOut();
    closeStore(warn, 2, 'trust', out);
    expect(warn.person.wallet).toBeCloseTo(-60_000, 6);
    expect(ofKind(out.firm, 'debt')).toEqual([{ kind: 'debt', params: { cash: warn.person.wallet } }]);
    expect(warn.over).toBeNull();

    const ruin = partnerFirm();
    const ruinStore = rentAndOpen(ruin, 'raty');
    ruinStore.econ.franchisee.remanent.pending = 120_000;
    ruin.person.wallet = -40_000;
    syncWallet(ruin);
    closeStore(ruin, 2, 'trust', emptyStepOut());
    expect(ruin.person.wallet).toBeLessThan(DEBT_LIMIT);
    expect(ruin.over).toBeNull();
    const next = tick(ruin);
    expect(activeStore(ruin).econ.gameOver).toBe(true);
    expect(ofKind(next.active, 'gameover')).toHaveLength(1);
  });
});

// --- Wypowiedzenie przez gracza ------------------------------------------------------------------------------------------

describe('terminateStore', () => {
  const terminate = (f: FirmState, storeId: number, out: FirmStepOut = emptyStepOut()): ReturnType<typeof applyFirmCommand> =>
    applyFirmCommand(f, { type: 'terminateStore', storeId }, out);

  function refused(f: FirmState, storeId: number, reason: FirmRefusal): void {
    const before = digest(f);
    const out = emptyStepOut();
    expect(terminate(f, storeId, out)).toEqual({ ok: false, reason });
    expect(digest(f)).toBe(before);
    expect(out).toEqual(emptyStepOut());
  }

  it('przy jednym otwartym sklepie single; sklep nieznany, zamknięty albo już wypowiedziany to store', () => {
    const f = newFirm();
    refused(f, 1, 'single');
    refused(f, 99, 'store');
    const g = partnerFirm();
    const st2 = rentAndOpen(g, 'gotowka');
    refused(g, 99, 'store');
    refused(g, 0, 'store');
    const out = emptyStepOut();
    expect(terminate(g, 2, out)).toEqual({ ok: true });
    expect(st2.notice).not.toBeNull();
    refused(g, 2, 'store');   // już wypowiedziany
    refused(g, 1, 'single');  // drugi sklep ma wypowiedzenie, więc #1 byłby ostatnim
    g.stores[0]!.closed = true;
    refused(g, 1, 'store');   // zamknięty
  });

  it('wypowiedzenie ostatniego dnia następnego miesiąca: ze środka, z ostatniego dnia i z pierwszego dnia miesiąca', () => {
    const f = partnerFirm();
    const st2 = rentAndOpen(f, 'gotowka');
    const out = emptyStepOut();
    expect(terminate(f, 2, out)).toEqual({ ok: true });
    expect(dayOf(clockOf(f))).toBeLessThan(29);   // wrzesień: następny miesiąc to październik, ostatni dzień 60
    expect(st2.notice).toEqual({ endDay: 60 });
    expect(out.firm).toEqual([{ kind: 'notice', storeId: 2, params: { endDay: 60 } }]);

    const g = partnerFirm();
    const st = rentAndOpen(g, 'gotowka');
    playTo(g, 29 * DAY + OPEN_FROM);   // 30 września, ostatni dzień miesiąca: wypowiedzenie liczy się do końca października
    expect(terminate(g, 2)).toEqual({ ok: true });
    expect(st.notice).toEqual({ endDay: 60 });

    const h = partnerFirm();
    const st3 = rentAndOpen(h, 'gotowka');
    playTo(h, 30 * DAY + OPEN_FROM);   // 1 października: do końca listopada
    expect(terminate(h, 2)).toEqual({ ok: true });
    expect(st3.notice).toEqual({ endDay: 90 });
  });

  it('sklep działa do końca następnego miesiąca, potem przychodzi to samo rozliczenie; raty w okresie wypowiedzenia są odrzucane', () => {
    const f = partnerFirm();
    const st2 = rentAndOpen(f, 'raty');
    expect(terminate(f, 2)).toEqual({ ok: true });
    f.activeId = 2;

    // Review Focus 4: Centrala nie finansuje rat wypowiedzianego sklepu; za gotówkę wolno
    activeStore(f).econ.level = 8;
    const before = digest(f);
    for (const cmd of [
      { type: 'buyEquipment', id: 'sco', raty: true }, { type: 'buyUpgrade', id: 'szkolenie', raty: true }, { type: 'startRemont', raty: true },
    ] as const) {
      const r = applyStoreCommand(f, cmd);
      expect(r.result).toEqual({ ok: false, text: NOTICE_NO_CREDIT });
      expect(r.events).toEqual([]);
      expect(r.layoutChanged).toBe(false);
    }
    expect(digest(f)).toBe(before);
    expect(applyStoreCommand(f, { type: 'buyUpgrade', id: 'szkolenie' }).result.ok).toBe(true);
    // drugi sklep nie ma wypowiedzenia: tam raty przechodzą jak zwykle
    f.activeId = 1;
    f.stores[0]!.econ.level = 8;
    const other = applyStoreCommand(f, { type: 'buyUpgrade', id: 'wozek', raty: true }).result;
    expect(other.ok === false ? other.text : '').not.toBe(NOTICE_NO_CREDIT);

    // wrzesień: sklep zamyka miesiąc, ale umowa trwa; październik: koniec wypowiedzenia
    f.activeId = 2;
    const sept = playTo(f, SEPT_CLOSE);
    tick(f, sept);
    expect(ofKind(sept.active, 'month')).toHaveLength(1);
    expect(st2.closed).toBe(false);
    expect(ofKind(sept.firm, 'settlement')).toEqual([]);
    expect(f.activeId).toBe(2);

    const walletBefore = (): number => f.person.wallet;
    const oct = playTo(f, OCT_CLOSE);
    const w = walletBefore();
    const owedBefore = owed(st2.econ);
    tick(f, oct);
    const stmt2 = netsOf(oct, 2).get(2)!.statement!;
    const settlement = ofKind(oct.firm, 'settlement')[0]!;
    expect(settlement.storeId).toBe(2);
    expect(num(settlement, 'installments')).toBeCloseTo(owedBefore - stmt2.installments, 6);
    expect(num(settlement, 'total')).toBeCloseTo(num(settlement, 'installments') + num(settlement, 'pending') + num(settlement, 'remanent'), 6);
    expect(f.person.wallet).toBeCloseTo(w + netTotal(netsOf(oct, 2)) - num(settlement, 'total'), 6);
    expect(ofKind(oct.firm, 'closed')).toEqual([{ kind: 'closed', storeId: 2, params: { reason: 'notice' } }]);
    expect(st2.closed).toBe(true);
    expect(lotState(f, st2.lotId)).toBe('po-traszce');
    // aktywny #2 wygasł, więc gra przechodzi na #1 i nie pokazuje ekranu końca gry
    expect(f.activeId).toBe(1);
    expect(f.over).toBeNull();
    expect(gameoversOf(oct)).toBe(0);
    expect(ofKind(oct.firm, 'gameover')).toEqual([]);
  });

  it('isFirmCommand i polecenie o złym kształcie: terminateStore bez storeId odmawia', () => {
    const f = partnerFirm();
    rentAndOpen(f, 'gotowka');
    const before = digest(f);
    const out = emptyStepOut();
    expect(applyFirmCommand(f, { type: 'terminateStore' } as unknown as FirmCommand, out)).toEqual({ ok: false, reason: 'store' });
    expect(applyFirmCommand(f, { type: 'terminateStore', storeId: '2' } as unknown as FirmCommand, out)).toEqual({ ok: false, reason: 'store' });
    expect(digest(f)).toBe(before);
    expect(out).toEqual(emptyStepOut());
  });
});

// --- Koniec gry ----------------------------------------------------------------------------------------------------------

describe('zamknięcie ostatniego sklepu kończy grę', () => {
  it('zaufanie 0 w jedynym sklepie: over closed, bez rozliczenia i zdarzeń firmy, stan jak w samym replayRun z tym dziennikiem', () => {
    const LOG: LogEntry[] = [
      { minute: OPEN_FROM, seq: 0, cmd: { type: 'setOrder', auto: false, manual: 4 } },
      { minute: OPEN_FROM + 2, seq: 1, cmd: { type: 'setStaffProfile', profile: 'dostawa' } },
      { minute: DAY + 12 * 60, seq: 2, cmd: { type: 'buyUpgrade', id: 'szkolenie' } },
      { minute: 2 * DAY + 12 * 60, seq: 3, cmd: { type: 'buyUpgrade', id: 'ulotki' } },
      { minute: 3 * DAY + 7 * 60, seq: 4, cmd: { type: 'setOrder', auto: true } },
      { minute: 11 * DAY + 12 * 60, seq: 5, cmd: { type: 'hire' } },
    ];
    const run = { seed: SEED, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'casual' as const, log: LOG };

    // ten sam dziennik w firmie z jednym sklepem i w samym replayRun: do zamknięcia września stan jest ten sam
    const f = newFirm();
    let next = 0;
    while (clockOf(f) < SEPT_CLOSE) {
      while (next < LOG.length && LOG[next]!.minute <= clockOf(f)) applyStoreCommand(f, LOG[next++]!.cmd);
      tick(f);
    }
    const replayed = replayRun(run, SEPT_CLOSE);
    expect(hashOf(activeStore(f).econ)).toBe(hashOf(replayed));

    // ten sam los zaufania po obu stronach (replayRun nie ma jak go ustawić), potem krok zamykający miesiąc
    const plain = structuredClone(replayed);
    const { info } = freshRun(SEED);
    loseTrust(plain);
    loseTrust(f.stores[0]!.econ);
    for (const card of visibleCards(plain.tycoon.cards, plain.minute)) {
      applyCommand(plain, info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
    }
    const plainEvents: EconEvent[] = [];
    stepMinute(plain, info, plainEvents);
    expect(plain.gameOver).toBe(true);

    const out = tick(f);
    expect(hashOf(activeStore(f).econ)).toBe(hashOf(plain));
    expect(out.active).toEqual(plainEvents);   // zdarzenie gameover sklepu przechodzi bez zmian
    expect(ofKind(out.active, 'gameover')).toHaveLength(1);
    expect(out.background).toEqual([]);
    expect(out.firm).toEqual([]);
    expect(f.over).toBe('closed');
    expect(f.person.wallet).toBe(plain.cash);   // bez rozliczenia
    expect(f.stores[0]!.closed).toBe(false);
    // po końcu gry minuty nie biegną
    const minute = clockOf(f);
    stepFirmMinute(f, emptyStepOut());
    expect(clockOf(f)).toBe(minute);
  });

  it('koniec wypowiedzenia ostatniego sklepu: gameOver, over closed, gameover z notice, bez rozliczenia', () => {
    const f = partnerFirm();
    const st1 = f.stores[0]!;
    const st2 = rentAndOpen(f, 'raty');
    expect(applyFirmCommand(f, { type: 'terminateStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: true });
    // we wrześniu Centrala zamyka #1 (zaufanie 0): #2 zostaje sam, nadal z wypowiedzeniem
    playTo(f, SEPT_CLOSE);
    loseTrust(st1.econ);
    const sept = tick(f);
    expect(st1.closed).toBe(true);
    expect(ofKind(sept.firm, 'settlement')).toHaveLength(1);
    expect(f.activeId).toBe(2);
    expect(f.over).toBeNull();
    expect(applyFirmCommand(f, { type: 'terminateStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: false, reason: 'single' });

    const wallet = (): number => f.person.wallet;
    const oct = playTo(f, OCT_CLOSE);
    const w = wallet();
    tick(f, oct);
    const stmt = ofKind(oct.active, 'month')[0]!.report!.statement!;
    expect(f.over).toBe('closed');
    expect(st2.econ.gameOver).toBe(true);
    expect(st2.closed).toBe(false);
    expect(ofKind(oct.firm, 'gameover')).toEqual([{ kind: 'gameover', params: { reason: 'notice' } }]);
    expect(ofKind(oct.firm, 'settlement')).toEqual([]);
    expect(ofKind(oct.firm, 'closed')).toEqual([]);
    expect(f.person.wallet).toBeCloseTo(w + stmt.net, 6);   // tylko wyciąg miesiąca, żadnego rozliczenia końcowego
    // po końcu gry polecenia firmy odmawiają
    expect(applyFirmCommand(f, { type: 'switchStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: false, reason: 'over' });
  });

  it('zaufanie 0 w obu sklepach w tej samej minucie to koniec gry bez rozliczenia, z oboma gameover', () => {
    const f = partnerFirm();
    const st2 = rentAndOpen(f, 'raty');
    playTo(f, SEPT_CLOSE);
    loseTrust(f.stores[0]!.econ);
    loseTrust(st2.econ);
    const walletBefore = f.person.wallet;
    const out = tick(f);
    const reports = netsOf(out, 1);
    expect(f.over).toBe('closed');
    expect(gameoversOf(out)).toBe(2);
    expect(ofKind(out.firm, 'settlement')).toEqual([]);
    expect(ofKind(out.firm, 'closed')).toEqual([]);
    expect(f.stores.every((s) => s.econ.gameOver && !s.closed)).toBe(true);
    expect(f.person.wallet).toBeCloseTo(walletBefore + netTotal(reports), 6);
  });
});

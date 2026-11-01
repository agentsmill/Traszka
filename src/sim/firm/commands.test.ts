import { describe, expect, it } from 'vitest';
import { generateCity, lotById, lotNeighbour } from '@/sim/city/generateCity';
import { storeSeedFor } from '@/sim/city/traffic';
import type { LotState } from '@/sim/city/types';
import { minuteOfDay } from '@/sim/economy/calendar';
import { CATS, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, START_CASH } from '@/sim/economy/catalog';
import { awaitingDecision, type MonthReport } from '@/sim/economy/economy';
import { installmentLimit, planFor } from '@/sim/economy/franchisee';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { freshRun } from '@/sim/run';
import { layoutFor } from '@/sim/store/layoutFor';
import { takeoverSide } from '@/sim/store/takeover';
import {
  FIRM_COMMAND_TYPES, applyFirmCommand, grantPartnerIfDue, isFirmCommand, lotState, openDueBuilds, partnerProgress, rentRefusal,
  type FirmCommand,
} from './commands';
import {
  activeStore, applyStoreCommand, createFirm, emptyStepOut, openStoreAt, openStores, stepFirmMinute, syncWallet,
} from './firm';
import { MAX_STORES, type FirmBuild, type FirmRefusal, type FirmState, type FirmStepOut, type FirmStore } from './types';

/*
 * Polecenia firmy (spec §10, §12): status Partnera Strategicznego, wynajem lokalu z pakietem otwarcia (gotówka albo 12 rat), budowa,
 * otwarcie sklepu #2 o 6:00 i przełączanie aktywnego sklepu.
 */

const SEED = 'kiełbasa-42';
const DAY = MINUTES_PER_DAY;
/** Minuty zamknięcia września (dzień 29) i października (dzień 60): w tym kroku `closeDay` zamyka też miesiąc. */
const SEPT_CLOSE = 29 * DAY + OPEN_TO;
const OCT_CLOSE = 60 * DAY + OPEN_TO;
const NOV_CLOSE = 90 * DAY + OPEN_TO;
const WALLET = 200_000;

const newFirm = (seed = SEED, ranked = false): FirmState => {
  const { state, layout, info } = freshRun(seed);
  return createFirm(seed, { econ: state, layout, info }, { ranked });
};
/** Firma ze statusem Partnera i gotówką na pakiet. */
function partnerFirm(seed = SEED, wallet = WALLET): FirmState {
  const f = newFirm(seed);
  f.person.partner = true;
  f.person.wallet = wallet;
  syncWallet(f);
  return f;
}
const freeLots = (f: FirmState): number[] => f.city.lots.filter((l) => l.state === 'wolny').map((l) => l.id);
const freeLot = (f: FirmState): number => freeLots(f)[0]!;
/** Lokale, które wynajem dziś przyjmuje (po `lotState`: bez własnych, budów i lokali po Traszce). */
const rentable = (f: FirmState): number[] => freeLots(f).filter((id) => lotState(f, id) === 'wolny');
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;
const ofKind = <T extends { kind: string }>(events: readonly T[], kind: string): T[] => events.filter((e) => e.kind === kind);
const digest = (f: FirmState): string => JSON.stringify(f);
const startEcon = (f: FirmState): FirmStore['econ'] => f.stores[0]!.econ;
const profitEntry = (profit: number): { label: string; profit: number; revenue: number; transfer: number } => ({ label: 'x', profit, revenue: 0, transfer: 0 });
const openMinute = (b: FirmBuild): number => b.readyDay * DAY + OPEN_FROM;

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

/** Wynajem zakończony powodzeniem; zwraca nową budowę. */
function rent(f: FirmState, lotId: number, pay: 'gotowka' | 'raty' = 'gotowka', out: FirmStepOut = emptyStepOut()): FirmBuild {
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay }, out)).toEqual({ ok: true });
  return f.builds[f.builds.length - 1]!;
}

/** Wynajem i otwarcie w pierwszym wolnym lokalu: sklep #2 stoi o 6:00 dnia otwarcia (krok sklepów jeszcze nie poszedł). */
function rentAndOpen(f: FirmState, pay: 'gotowka' | 'raty' = 'gotowka', lotId = freeLot(f)): FirmStore {
  const b = rent(f, lotId, pay);
  playTo(f, openMinute(b));
  openDueBuilds(f, emptyStepOut());
  return f.stores[f.stores.length - 1]!;
}

function reportsOf(f: FirmState, out: FirmStepOut): Map<number, MonthReport> {
  const m = new Map<number, MonthReport>();
  for (const e of ofKind(out.active, 'month')) m.set(f.activeId, e.report!);
  for (const b of out.background) if (b.event.kind === 'month') m.set(b.storeId, b.event.report!);
  return m;
}

function refused(f: FirmState, cmd: FirmCommand, reason: FirmRefusal): void {
  const before = digest(f);
  const out = emptyStepOut();
  expect(applyFirmCommand(f, cmd, out)).toEqual({ ok: false, reason });
  expect(digest(f)).toBe(before);   // odmowa nie rusza stanu
  expect(out).toEqual(emptyStepOut());
}

// --- Status Partnera Strategicznego -----------------------------------------------------------------------------------

describe('status Partnera Strategicznego', () => {
  it('przychodzi przy zamknięciu drugiego miesiąca z zyskiem, gdy zaufanie ≥ 75, a nie wcześniej', () => {
    const f = newFirm();
    const a = startEcon(f);
    const out = playTo(f, SEPT_CLOSE);
    a.tycoon.trust.value = 80;
    tick(f, out);   // zamknięcie września
    expect(a.history.map((h) => h.profit > 0)).toEqual([true]);
    expect(a.tycoon.trust.value).toBeGreaterThanOrEqual(75);
    expect(f.person.partner).toBe(false);   // jeden miesiąc to za mało
    expect(partnerProgress(f)).toEqual({ kind: 'missing', profitMonthsNeeded: 1, trust: a.tycoon.trust.value, trustNeeded: 75 });

    playTo(f, OCT_CLOSE, out);
    a.tycoon.trust.value = 80;
    expect(f.person.partner).toBe(false);   // zaufanie jest wysokie, ale status przychodzi dopiero z zamknięciem miesiąca
    expect(ofKind(out.firm, 'partner')).toEqual([]);
    tick(f, out);   // zamknięcie października
    expect(a.history.map((h) => h.profit > 0)).toEqual([true, true]);
    expect(f.person.partner).toBe(true);
    expect(ofKind(out.firm, 'partner')).toEqual([{ kind: 'partner' }]);
    expect(partnerProgress(f)).toEqual({ kind: 'granted' });
  });

  it('zaufanie poniżej 75 przy zamknięciu: bez statusu, a wysokie zaufanie po zamknięciu go nie nadaje', () => {
    const f = newFirm();
    const a = startEcon(f);
    a.history.push(profitEntry(1000));   // poprzedni miesiąc z zyskiem, więc wrzesień będzie drugim
    const out = playTo(f, SEPT_CLOSE);
    a.tycoon.trust.value = 60;
    tick(f, out);
    expect(a.history.map((h) => h.profit > 0)).toEqual([true, true]);
    expect(a.tycoon.trust.value).toBeLessThan(75);
    expect(f.person.partner).toBe(false);
    expect(partnerProgress(f)).toEqual({ kind: 'missing', profitMonthsNeeded: 0, trust: a.tycoon.trust.value, trustNeeded: 75 });

    a.tycoon.trust.value = 95;
    playTo(f, SEPT_CLOSE + 3 * DAY, out);
    expect(f.person.partner).toBe(false);
    expect(ofKind(out.firm, 'partner')).toEqual([]);
  });

  it.each([[69, false], [70, true]])('granica: zaufanie %s przed zamknięciem miesiąca daje status: %s (liczy się wartość po zamknięciu, próg 75)', (before, granted) => {
    const f = newFirm();
    const a = startEcon(f);
    a.history.push(profitEntry(1000));
    const out = playTo(f, SEPT_CLOSE);
    a.tycoon.trust.value = before;
    tick(f, out);
    expect(a.history).toHaveLength(2);
    expect(a.history[1]!.profit).toBeGreaterThan(0);
    expect(a.tycoon.trust.value >= 75).toBe(granted);
    expect(f.person.partner).toBe(granted);
  });

  it('status zostaje po stratnym miesiącu i nie przychodzi drugi raz', () => {
    const f = newFirm();
    const a = startEcon(f);
    a.history.push(profitEntry(1000), profitEntry(2000));
    a.tycoon.trust.value = 80;
    const out = emptyStepOut();
    grantPartnerIfDue(f, out);
    expect(f.person.partner).toBe(true);
    expect(ofKind(out.firm, 'partner')).toHaveLength(1);

    a.history.push(profitEntry(-5000));
    a.tycoon.trust.value = 10;
    grantPartnerIfDue(f, out);
    expect(f.person.partner).toBe(true);
    expect(out.firm).toHaveLength(1);
    expect(partnerProgress(f)).toEqual({ kind: 'granted' });
  });

  it('status przychodzi przez krok firmy i zostaje po rzeczywistym stratnym miesiącu (listopad)', () => {
    const f = newFirm();
    const a = startEcon(f);
    const out = playTo(f, SEPT_CLOSE);
    a.tycoon.trust.value = 80;
    tick(f, out);
    playTo(f, OCT_CLOSE, out);
    a.tycoon.trust.value = 80;
    tick(f, out);
    expect(f.person.partner).toBe(true);

    f.person.wallet += WALLET;   // listopad ze stratą: płace ponad przelew, bez debetu
    syncWallet(f);
    playTo(f, NOV_CLOSE, out);
    a.franchisee.month.wages = 120_000;
    a.tycoon.trust.value = 90;
    tick(f, out);
    expect(f.over).toBeNull();
    expect(a.history.length).toBeGreaterThanOrEqual(3);
    expect(a.history[a.history.length - 1]!.profit).toBeLessThan(0);
    expect(f.person.partner).toBe(true);
    expect(ofKind(out.firm, 'partner')).toHaveLength(1);
  });

  it.each([
    [[], 2],
    [[1], 1],
    [[1, 1], 0],
    [[-1, 1], 1],
    [[1, -1], 2],
    [[1, 0], 2],
    [[1, 1, -1], 2],
    [[-1, 1, 1], 0],
  ] as [number[], number][])('partnerProgress: historia wyników %j → do zdobycia jeszcze %s mies. z zyskiem', (profits, needed) => {
    const f = newFirm();
    const a = startEcon(f);
    a.history.push(...profits.map(profitEntry));
    a.tycoon.trust.value = 71.5;
    expect(partnerProgress(f)).toEqual({ kind: 'missing', profitMonthsNeeded: needed, trust: 71.5, trustNeeded: 75 });
  });

  it('partnerProgress czyta sklep startowy, nawet gdy aktywny jest inny', () => {
    const f = partnerFirm();
    rentAndOpen(f);
    f.person.partner = false;
    f.activeId = 2;
    f.stores[1]!.econ.tycoon.trust.value = 99;
    f.stores[0]!.econ.tycoon.trust.value = 66;
    expect(partnerProgress(f)).toMatchObject({ kind: 'missing', trust: 66 });
  });

  it('ranked: status nie przychodzi mimo spełnionego warunku, pasek mówi ranked, a wynajem dostaje ranked', () => {
    const f = newFirm(SEED, true);
    const a = startEcon(f);
    a.history.push(profitEntry(1000), profitEntry(2000));
    a.tycoon.trust.value = 85;
    const out = emptyStepOut();
    grantPartnerIfDue(f, out);
    expect(f.person.partner).toBe(false);
    expect(out.firm).toEqual([]);
    expect(partnerProgress(f)).toEqual({ kind: 'ranked' });

    // ten sam warunek przez krok firmy: drugi miesiąc z zyskiem i zaufanie 85 przy zamknięciu września
    const g = newFirm(SEED, true);
    const b = startEcon(g);
    b.history.push(profitEntry(1000));
    const out2 = playTo(g, SEPT_CLOSE);
    b.tycoon.trust.value = 85;
    tick(g, out2);
    expect(b.history.map((h) => h.profit > 0)).toEqual([true, true]);
    expect(g.person.partner).toBe(false);
    expect(ofKind(out2.firm, 'partner')).toEqual([]);

    g.person.wallet = WALLET;
    syncWallet(g);
    refused(g, { type: 'rentLot', lotId: freeLot(g), pay: 'gotowka' }, 'ranked');
    g.person.partner = true;   // nawet gdyby status jakoś był
    refused(g, { type: 'rentLot', lotId: freeLot(g), pay: 'gotowka' }, 'ranked');
  });
});

// --- Odmowy wynajmu ---------------------------------------------------------------------------------------------------

describe('rentRefusal i applyFirmCommand rentLot: każdy powód osobno, stan bez zmian', () => {
  const rentCmd = (f: FirmState, pay: 'gotowka' | 'raty' = 'gotowka'): FirmCommand => ({ type: 'rentLot', lotId: freeLot(f), pay });

  it('over: gra skończona (firma albo aktywny sklep)', () => {
    const f = partnerFirm();
    f.over = 'debt';
    refused(f, rentCmd(f), 'over');
    f.over = null;
    activeStore(f).econ.gameOver = true;
    refused(f, rentCmd(f), 'over');
    expect(rentRefusal(f, freeLot(f), 'raty')).toBe('over');
  });

  it('ranked: bieg rankingowy zostaje na jednym sklepie', () => {
    const f = newFirm(SEED, true);
    f.person.partner = true;
    f.person.wallet = WALLET;
    syncWallet(f);
    refused(f, rentCmd(f), 'ranked');
  });

  it('status: bez Partnera Strategicznego nie ma wynajmu', () => {
    const f = partnerFirm();
    f.person.partner = false;
    refused(f, rentCmd(f), 'status');
  });

  it('limit: dwa otwarte sklepy bez budowy to jeszcze nie komplet, wynajem przechodzi', () => {
    const f = partnerFirm();
    openStoreAt(f, freeLot(f), clockOf(f));
    expect(openStores(f)).toHaveLength(2);
    expect(f.builds).toEqual([]);
    expect(rentRefusal(f, rentable(f)[0]!, 'gotowka')).toBeNull();
    expect(rentRefusal(f, rentable(f)[0]!, 'raty')).toBeNull();
  });

  it('limit: dwa otwarte sklepy i budowa to komplet (budowa liczy się do trzech)', () => {
    const f = partnerFirm();
    openStoreAt(f, freeLot(f), clockOf(f));
    rent(f, rentable(f)[0]!);
    refused(f, { type: 'rentLot', lotId: rentable(f)[0]!, pay: 'raty' }, 'limit');
    refused(f, { type: 'rentLot', lotId: rentable(f)[0]!, pay: 'gotowka' }, 'limit');
    expect(openStores(f).length + f.builds.length).toBe(MAX_STORES);
  });

  it('limit: trzy otwarte sklepy to komplet, także bez budowy', () => {
    const f = partnerFirm();
    openStoreAt(f, freeLot(f), clockOf(f));
    openStoreAt(f, rentable(f)[0]!, clockOf(f));
    expect(openStores(f)).toHaveLength(MAX_STORES);
    expect(f.builds).toEqual([]);
    refused(f, { type: 'rentLot', lotId: rentable(f)[0]!, pay: 'gotowka' }, 'limit');
    refused(f, { type: 'rentLot', lotId: rentable(f)[0]!, pay: 'raty' }, 'limit');
  });

  it('limit: zamknięty sklep nie liczy się do trzech, więc po zamknięciu jednego z trzech wynajem znów przechodzi', () => {
    const f = partnerFirm();
    openStoreAt(f, freeLot(f), clockOf(f));
    openStoreAt(f, rentable(f)[0]!, clockOf(f)).closed = true;
    syncWallet(f);
    expect(rentRefusal(f, rentable(f)[0]!, 'gotowka')).toBeNull();
  });

  it('lot: zajęty, konkurencja, własny, obok i nieistniejący nie są do wynajęcia; lokal po Traszce tak (cena i budowa: relet.test.ts)', () => {
    const seed = Array.from({ length: 10 }, (_, i) => `miasto-${i}`).find((s) => generateCity(s).neighbourLotId !== null)!;
    const f = partnerFirm(seed);
    const lots = f.city.lots;
    const taken = lots.find((l) => l.state === 'zajety')!.id;
    const rival = lots.find((l) => l.state === 'konkurencja')!.id;
    for (const lotId of [taken, rival, f.city.startLotId, f.city.neighbourLotId!, -1, 1.5, lots.length, Number.NaN]) {
      refused(f, { type: 'rentLot', lotId, pay: 'gotowka' }, 'lot');
    }
    // lokal po Traszce (zamknięty sklep) nie jest wolny, ale od 4a.2 wynajem go przyjmuje (ponowny wynajem z wyposażeniem)
    const gone = openStoreAt(f, freeLot(f), clockOf(f));
    gone.closed = true;
    syncWallet(f);
    expect(lotState(f, gone.lotId)).toBe('po-traszce');
    expect(rentRefusal(f, gone.lotId, 'raty')).toBeNull();
    expect(rentRefusal(f, gone.lotId, 'gotowka')).toBeNull();
  });

  it('gotowka: po zapłacie gotówka zeszłaby poniżej zera (nie budujesz na debecie)', () => {
    const f = partnerFirm();
    const lot = lotById(f.city, freeLot(f));
    f.person.wallet = lot.package - 1;
    syncWallet(f);
    refused(f, rentCmd(f), 'gotowka');
    expect(rentRefusal(f, lot.id, 'raty')).toBeNull();   // ratami to samo konto nie przeszkadza
  });

  it('raty: rata ponad limit nowego sklepu (35% × 25 tys. zł × zaufanie 65) jest odrzucona, a gotówka przechodzi', () => {
    const f = partnerFirm();
    const lot = lotById(f.city, freeLot(f));
    expect(installmentLimit([], TRUST.start)).toBe(8750);
    lot.package = 100_000;   // 12 rat z opłatą 15%: ok. 9170 zł miesięcznie
    expect(planFor(100_000).monthly).toBeGreaterThan(8750);
    refused(f, rentCmd(f, 'raty'), 'raty');
    expect(rentRefusal(f, lot.id, 'gotowka')).toBeNull();
  });

  it('kolejność powodów: over, ranked, status, limit, lot, gotowka', () => {
    const f = newFirm(SEED, true);   // ranked, bez statusu, przy tym zajęty lokal i pusta gotówka
    const taken = f.city.lots.find((l) => l.state === 'zajety')!.id;
    f.person.wallet = 0;
    syncWallet(f);
    f.over = 'closed';
    expect(rentRefusal(f, taken, 'gotowka')).toBe('over');
    f.over = null;
    expect(rentRefusal(f, taken, 'gotowka')).toBe('ranked');
    f.ranked = false;
    expect(rentRefusal(f, taken, 'gotowka')).toBe('status');
    f.person.partner = true;
    openStoreAt(f, freeLot(f), clockOf(f));
    expect(rentRefusal(f, taken, 'gotowka')).toBe('lot');   // dwa otwarte sklepy to jeszcze nie komplet
    openStoreAt(f, rentable(f)[0]!, clockOf(f));
    expect(rentRefusal(f, taken, 'gotowka')).toBe('limit');
    f.stores[1]!.closed = true;
    expect(rentRefusal(f, taken, 'gotowka')).toBe('lot');
    expect(rentRefusal(f, rentable(f)[0]!, 'gotowka')).toBe('gotowka');
  });
});

// --- Wynajem, budowa i otwarcie ---------------------------------------------------------------------------------------

describe('wynajem i budowa', () => {
  it('Review Focus 4: gotówka równa cenie przechodzi i zostawia 0 zł, a trzeci wynajem w trakcie dwóch budów dostaje limit', () => {
    const f = partnerFirm();
    const lot = lotById(f.city, freeLot(f));
    f.person.wallet = lot.package;
    syncWallet(f);
    rent(f, lot.id);
    expect(f.person.wallet).toBe(0);
    expect(f.stores[0]!.econ.cash).toBe(0);
    expect(f.monthInvest).toBe(lot.package);
    rent(f, freeLots(f)[1]!, 'raty');   // druga budowa: raty nie ruszają gotówki, a limit trzech jeszcze nie zapełniony
    refused(f, { type: 'rentLot', lotId: freeLots(f)[2]!, pay: 'raty' }, 'limit');
    refused(f, { type: 'rentLot', lotId: freeLots(f)[2]!, pay: 'gotowka' }, 'limit');
  });

  it('za gotówkę: wallet spada od razu, monthInvest rośnie, budowa i zdarzenie build; sklep nie istnieje do dnia otwarcia', () => {
    const f = partnerFirm();
    playTo(f, 3 * DAY + OPEN_FROM + 90);
    const lot = lotById(f.city, freeLot(f));
    const wallet = f.person.wallet;
    const out = emptyStepOut();
    const b = rent(f, lot.id, 'gotowka', out);

    expect(b).toEqual({ lotId: lot.id, readyDay: 3 + lot.buildDays, price: lot.package, pay: 'gotowka' });
    expect(lot.buildDays).toBeGreaterThanOrEqual(5);
    expect(lot.buildDays).toBeLessThanOrEqual(8);
    expect(f.person.wallet).toBe(wallet - lot.package);
    expect(f.monthInvest).toBe(lot.package);
    expect(f.stores[0]!.econ.cash).toBe(f.person.wallet);   // kasa sklepu to odbicie portfela
    expect(f.builds).toEqual([b]);
    expect(out.firm).toEqual([{ kind: 'build', params: { lotId: lot.id, readyDay: b.readyDay, price: lot.package, pay: 'gotowka' } }]);
    expect(lotState(f, lot.id)).toBe('budowa');

    playTo(f, openMinute(b) - 1);
    expect(f.stores).toHaveLength(1);
    expect(f.builds).toHaveLength(1);
    expect(lotState(f, lot.id)).toBe('budowa');
  });

  it('na raty: gotówka i monthInvest bez zmian, budowa niesie pay raty', () => {
    const f = partnerFirm();
    const lot = lotById(f.city, freeLot(f));
    const out = emptyStepOut();
    const b = rent(f, lot.id, 'raty', out);
    expect(f.person.wallet).toBe(WALLET);
    expect(f.monthInvest).toBe(0);
    expect(b.pay).toBe('raty');
    expect(out.firm).toEqual([{ kind: 'build', params: { lotId: lot.id, readyDay: b.readyDay, price: lot.package, pay: 'raty' } }]);
  });

  it('stepFirmMinute otwiera budowę w minucie dnia odbioru o 6:00: nie wcześniej, jeden raz, zdarzenie opened', () => {
    const f = partnerFirm();
    playTo(f, 2 * DAY + OPEN_FROM);
    const lot = lotById(f.city, freeLot(f));
    const b = rent(f, lot.id);
    const due = openMinute(b);
    expect(minuteOfDay(due)).toBe(OPEN_FROM);
    const out = playTo(f, due);
    expect(f.stores).toHaveLength(1);   // minuta `due` jeszcze nie poszła
    expect(ofKind(out.firm, 'opened')).toEqual([]);

    tick(f, out);   // krok minuty `due`
    expect(f.stores).toHaveLength(2);
    expect(f.builds).toEqual([]);
    expect(ofKind(out.firm, 'opened')).toEqual([{ kind: 'opened', storeId: 2, params: { lotId: lot.id } }]);
    expect(f.stores[1]!.econ.minute).toBe(due + 1);
    expect(f.stores[1]!.econ.minute).toBe(f.stores[0]!.econ.minute);
    expect(lotState(f, lot.id)).toBe('twoj');

    playTo(f, due + 2 * DAY, out);
    expect(f.stores).toHaveLength(2);
    expect(ofKind(out.firm, 'opened')).toHaveLength(1);
  });

  it('nowy sklep po otwarciu: gotówka równa portfelowi (bez gotówki startowej), zaufanie 65, poziom 1, półki 80%, 2 palety, start o 6:00', () => {
    const f = partnerFirm();
    playTo(f, 4 * DAY + OPEN_FROM);
    const b = rent(f, freeLot(f));
    playTo(f, openMinute(b));
    const wallet = f.person.wallet;
    openDueBuilds(f, emptyStepOut());
    const st = f.stores[1]!;
    const e = st.econ;
    expect(e.cash).toBe(wallet);
    expect(e.cash).toBe(f.person.wallet);
    expect(e.cash).not.toBe(START_CASH);
    expect(e.tycoon.trust.value).toBe(65);
    expect(e.level).toBe(1);
    expect(e.xp).toBe(0);
    expect(e.minute).toBe(openMinute(b));
    expect(minuteOfDay(e.minute)).toBe(OPEN_FROM);
    for (const c of CATS) expect(e.shelf[c]).toBe(Math.round(st.info.shelfCap[c] * 0.8));
    expect(e.pallets).toHaveLength(2);
    expect(e.history).toEqual([]);
    expect(e.franchisee.installments).toEqual([]);   // za gotówkę nie ma rat
    expect(f.stores[0]!.econ.cash).toBe(e.cash);
  });

  it('sklep #2 ma układ i dzielnicę z lokalu miasta', () => {
    const f = partnerFirm();
    const lot = lotById(f.city, freeLot(f));
    const st = rentAndOpen(f);
    expect(st.lotId).toBe(lot.id);
    expect(st.layout.lot.kind).toBe(lot.spec.kind);
    expect(st.layout).toEqual(layoutFor(storeSeedFor(SEED, lot.id), 0, lot.spec));
    expect(st.info.site!.district).toBe(lot.district);
    expect(st.econ.seed).toBe(storeSeedFor(SEED, lot.id));
  });

  it('ten sam seed i te same polecenia dają ten sam stan', () => {
    const run = (): string[] => {
      const f = partnerFirm();
      playTo(f, 2 * DAY + OPEN_FROM);
      rentAndOpen(f, 'raty');
      playTo(f, 12 * DAY);
      return f.stores.map((s) => JSON.stringify(s.econ));
    };
    expect(run()).toEqual(run());
  });
});

describe('pakiet na raty', () => {
  it('rata z planu 12 × z opłatą 15% z etykietą adaptacji lokalu ląduje w nowym sklepie, nie w pierwszym', () => {
    const f = partnerFirm();
    const lot = lotById(f.city, freeLot(f));
    const st = rentAndOpen(f, 'raty');
    const plan = planFor(lot.package);
    expect(plan).toMatchObject({ months: 12, feeShare: 0.15 });
    expect(plan.fee).toBe(Math.round(lot.package * 0.15));
    expect(st.econ.franchisee.installments).toEqual([{
      id: 1, label: `Adaptacja lokalu: ul. ${lot.street} ${lot.number}`, price: lot.package, fee: plan.fee, total: plan.total,
      monthly: plan.monthly, paid: 0, months: 12,
    }]);
    expect(st.econ.franchisee.nextInstallmentId).toBe(2);
    expect(f.stores[0]!.econ.franchisee.installments).toEqual([]);
    expect(f.person.wallet).toBeGreaterThan(WALLET - 1);   // pakiet nie zszedł z gotówki
    expect(f.monthInvest).toBe(0);
  });

  it('rata mieści się w limicie nowego sklepu (8750 zł) dla każdego wolnego lokalu w 10 miastach', () => {
    const limit = installmentLimit([], TRUST.start);
    expect(limit).toBe(8750);
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const f = partnerFirm(`miasto-${i}`);
      for (const id of freeLots(f)) {
        const lot = lotById(f.city, id);
        const plan = planFor(lot.package);
        expect(plan.months, `${i}/${id}`).toBe(12);
        expect(plan.feeShare, `${i}/${id}`).toBe(0.15);
        expect(plan.monthly, `${i}/${id}`).toBeLessThanOrEqual(limit);
        expect(rentRefusal(f, id, 'raty'), `${i}/${id}`).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(50);
  });

  it('pierwszy wyciąg sklepu #2 potrąca ratę pakietu: installments == plan.monthly', () => {
    const f = partnerFirm();
    playTo(f, 2 * DAY + OPEN_FROM);
    const lot = lotById(f.city, freeLot(f));
    const b = rent(f, lot.id, 'raty');
    const out = playTo(f, SEPT_CLOSE + 1);
    expect(clockOf(f)).toBeGreaterThan(openMinute(b));
    const report = reportsOf(f, out).get(2)!;
    const plan = planFor(lot.package);
    expect(report.statement!.installments).toBe(plan.monthly);
    expect(f.stores[1]!.econ.franchisee.installments[0]!.paid).toBe(plan.monthly);
    expect(reportsOf(f, out).get(1)!.statement!.installments).toBe(0);
  });
});

// --- Przełączanie sklepów -----------------------------------------------------------------------------------------------

describe('switchStore', () => {
  it('przełącza natychmiast, a zmęczenie franczyzobiorcy idzie za nim (kopia, nie ta sama referencja)', () => {
    const f = partnerFirm();
    rentAndOpen(f);
    const [a, b] = f.stores as [FirmStore, FirmStore];
    a.econ.tycoon.fatigue.energy = 12;
    a.econ.tycoon.fatigue.carried = 31;
    a.econ.tycoon.fatigue.exhaustedDays = 4;
    expect(b.econ.tycoon.fatigue).not.toEqual(a.econ.tycoon.fatigue);

    expect(applyFirmCommand(f, { type: 'switchStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: true });
    expect(f.activeId).toBe(2);
    expect(activeStore(f)).toBe(b);
    expect(b.econ.tycoon.fatigue).toEqual(a.econ.tycoon.fatigue);
    expect(b.econ.tycoon.fatigue).not.toBe(a.econ.tycoon.fatigue);
    b.econ.tycoon.fatigue.energy = 1;
    expect(a.econ.tycoon.fatigue.energy).toBe(12);   // kopie żyją osobno

    // i z powrotem: siły z drugiego sklepu wracają do pierwszego
    expect(applyFirmCommand(f, { type: 'switchStore', storeId: 1 }, emptyStepOut())).toEqual({ ok: true });
    expect(f.activeId).toBe(1);
    expect(a.econ.tycoon.fatigue.energy).toBe(1);
  });

  it('przełączenie na aktywny sklep nic nie zmienia, a przy karcie i w pauzie działa od ręki', () => {
    const f = partnerFirm();
    rentAndOpen(f);
    const before = digest(f);
    expect(applyFirmCommand(f, { type: 'switchStore', storeId: 1 }, emptyStepOut())).toEqual({ ok: true });
    expect(digest(f)).toBe(before);

    // karta czeka na biurku sklepu #1 (sklep w tle odpowiada przez zastępcę): przełączenie nie rusza zegara ani karty
    for (let i = 0; i < 20 * DAY && !(awaitingDecision(f.stores[0]!.econ) && !awaitingDecision(f.stores[1]!.econ)); i++) stepFirmMinute(f, emptyStepOut());
    expect(awaitingDecision(f.stores[0]!.econ)).toBe(true);
    const minute = clockOf(f);
    expect(applyFirmCommand(f, { type: 'switchStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: true });
    expect(f.activeId).toBe(2);
    expect(f.stores[0]!.econ.minute).toBe(minute);
    expect(awaitingDecision(f.stores[0]!.econ)).toBe(true);
  });

  it('zamknięty albo nieznany sklep dostaje store, a koniec gry over; stan bez zmian', () => {
    const f = partnerFirm();
    const st = rentAndOpen(f);
    st.closed = true;
    refused(f, { type: 'switchStore', storeId: 2 }, 'store');
    refused(f, { type: 'switchStore', storeId: 99 }, 'store');
    refused(f, { type: 'switchStore', storeId: 0 }, 'store');
    st.closed = false;
    f.over = 'debt';
    refused(f, { type: 'switchStore', storeId: 2 }, 'over');
  });
});

// --- Stan lokalu na mapie -----------------------------------------------------------------------------------------------

describe('lotState', () => {
  const SEEDS = Array.from({ length: 10 }, (_, i) => `miasto-${i}`);

  it('na starcie: własny sklep, lokal obok i reszta ze stanu z generatora', () => {
    for (const seed of SEEDS) {
      const f = newFirm(seed);
      for (const lot of f.city.lots) {
        const want: LotState = lot.id === f.city.startLotId ? 'twoj' : lot.state;
        expect(lotState(f, lot.id), `${seed}/${lot.id}`).toBe(want);
      }
      if (f.city.neighbourLotId !== null) expect(lotState(f, f.city.neighbourLotId)).toBe('obok');
    }
    expect(SEEDS.some((s) => generateCity(s).neighbourLotId !== null)).toBe(true);
    expect(SEEDS.some((s) => generateCity(s).neighbourLotId === null)).toBe(true);
  });

  it('lokal obok sklepu startowego: obok przed remontem, twój po pierwszym remoncie', () => {
    const seed = SEEDS.find((s) => generateCity(s).neighbourLotId !== null)!;
    const f = newFirm(seed);
    const n = f.city.neighbourLotId!;
    expect(lotState(f, n)).toBe('obok');
    startEcon(f).remontLevel = 1;
    expect(lotState(f, n)).toBe('twoj');
    startEcon(f).remontLevel = 2;
    expect(lotState(f, n)).toBe('twoj');
  });

  it('budowa: lokal w budowie, potem twój sklep; zamknięty sklep to po-traszce', () => {
    const f = partnerFirm();
    const id = freeLot(f);
    const b = rent(f, id);
    expect(lotState(f, id)).toBe('budowa');
    playTo(f, openMinute(b));
    openDueBuilds(f, emptyStepOut());
    expect(lotState(f, id)).toBe('twoj');
    f.stores[1]!.closed = true;
    expect(lotState(f, id)).toBe('po-traszce');
    // własny lokal startowy też, gdy sklep zamknięto
    f.stores[0]!.closed = true;
    expect(lotState(f, f.city.startLotId)).toBe('po-traszce');
  });

  it('sąsiad sklepu niestartowego liczy się z układu poziomu 0 i strony przejęcia (takeoverSide): obok, potem twój', () => {
    let found = 0;
    for (const seed of SEEDS) {
      const base = newFirm(seed);
      for (const id of freeLots(base)) {
        const f = partnerFirm(seed);
        const st = openStoreAt(f, id, clockOf(f));
        const storeSeed = storeSeedFor(seed, id);
        const lot = lotById(f.city, id);
        const side = takeoverSide(layoutFor(storeSeed, 0, lot.spec), storeSeed);
        const neighbour = side === null ? null : lotNeighbour(f.city, id, side)?.id ?? null;
        if (neighbour === null) continue;
        found++;
        st.layout = layoutFor(storeSeed, 1, lot.spec);   // układ po remoncie: strona przejęcia i tak liczy się z poziomu 0
        expect(lotState(f, neighbour), `${seed}/${id}`).toBe('obok');
        st.econ.remontLevel = 1;
        expect(lotState(f, neighbour), `${seed}/${id}`).toBe('twoj');
        // inne lokale bez zmian względem generatora
        for (const other of f.city.lots) {
          if ([id, neighbour, f.city.startLotId, f.city.neighbourLotId].includes(other.id)) continue;
          expect(lotState(f, other.id)).toBe(other.state);
        }
        f.stores[1]!.closed = true;   // zamknięty sklep nie ma już lokalu obok
        expect(lotState(f, neighbour)).toBe(f.city.lots[neighbour]!.state === 'obok' ? 'zajety' : f.city.lots[neighbour]!.state);
        break;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('sąsiad zamkniętego sklepu startowego nie jest już lokalem obok', () => {
    const seed = SEEDS.find((s) => generateCity(s).neighbourLotId !== null)!;
    const f = partnerFirm(seed);
    rentAndOpen(f);
    f.stores[0]!.closed = true;
    expect(lotState(f, f.city.neighbourLotId!)).toBe('zajety');
  });
});

// --- Kształt poleceń --------------------------------------------------------------------------------------------------

describe('FirmCommand', () => {
  it('FIRM_COMMAND_TYPES to rentLot, switchStore i terminateStore', () => {
    expect([...FIRM_COMMAND_TYPES]).toEqual(['rentLot', 'switchStore', 'terminateStore']);
  });

  it('isFirmCommand: poprawne kształty przechodzą', () => {
    expect(isFirmCommand({ type: 'rentLot', lotId: 12, pay: 'gotowka' })).toBe(true);
    expect(isFirmCommand({ type: 'rentLot', lotId: 0, pay: 'raty', extra: 1 })).toBe(true);
    expect(isFirmCommand({ type: 'switchStore', storeId: 2 })).toBe(true);
    expect(isFirmCommand({ type: 'terminateStore', storeId: 2 })).toBe(true);
  });

  it.each([
    null, undefined, 3, 'rentLot', [], {}, { type: 'x' }, { type: 'toString' }, { type: '__proto__' }, { type: 'constructor' },
    { type: 'rentLot' }, { type: 'rentLot', lotId: 1 }, { type: 'rentLot', pay: 'gotowka' },
    { type: 'rentLot', lotId: 1.5, pay: 'gotowka' }, { type: 'rentLot', lotId: '1', pay: 'gotowka' }, { type: 'rentLot', lotId: Number.NaN, pay: 'gotowka' },
    { type: 'rentLot', lotId: 1, pay: 'karta' }, { type: 'rentLot', lotId: 1, pay: true }, { type: 'rentLot', lotId: 1, pay: ['raty'] },
    { type: 'switchStore' }, { type: 'switchStore', storeId: '2' }, { type: 'switchStore', storeId: 2.5 }, { type: 'switchStore', storeId: null },
    { type: 'terminateStore' }, { type: 'terminateStore', storeId: '2' }, { type: 'terminateStore', storeId: 2.5 }, { type: 'terminateStore', storeId: null },
  ])('isFirmCommand: %j nie przechodzi', (x) => {
    expect(isFirmCommand(x)).toBe(false);
  });

  it('applyFirmCommand: polecenie o złym kształcie odmawia bez ruszania stanu, nie rzuca', () => {
    const f = partnerFirm();
    rentAndOpen(f);
    const before = digest(f);
    const out = emptyStepOut();
    expect(applyFirmCommand(f, { type: 'rentLot', lotId: 1, pay: 'karta' } as unknown as FirmCommand, out)).toEqual({ ok: false, reason: 'lot' });
    expect(applyFirmCommand(f, { type: 'switchStore' } as unknown as FirmCommand, out)).toEqual({ ok: false, reason: 'store' });
    expect(applyFirmCommand(f, null as unknown as FirmCommand, out)).toEqual({ ok: false, reason: 'store' });
    expect(digest(f)).toBe(before);
    expect(out).toEqual(emptyStepOut());
  });
});

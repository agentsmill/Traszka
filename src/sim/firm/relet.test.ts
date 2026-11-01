import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateCity, lotById, lotNeighbour } from '@/sim/city/generateCity';
import { storeSeedFor } from '@/sim/city/traffic';
import { dayOf, isLastDayOfMonth } from '@/sim/economy/calendar';
import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import {
  awaitingDecision, createEconomy, kpiMetricsOf, kpiScaleOf, type EconomyState, type MonthReport, type StoreFittings,
} from '@/sim/economy/economy';
import { installmentLimit, planFor } from '@/sim/economy/franchisee';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { newKpiWeek } from '@/sim/economy/tycoon/kpi';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { freshRun } from '@/sim/run';
import { layoutFor } from '@/sim/store/layoutFor';
import { takeoverSide } from '@/sim/store/takeover';
import { closeStore } from './closure';
import {
  RELET_BUILD_DAYS, RELET_SHARE, applyFirmCommand, lotRentable, lotState, openDueBuilds, rentBuildDays, rentPrice, rentRefusal, type FirmCommand,
} from './commands';
import {
  activeStore, applyStoreCommand, createFirm, emptyStepOut, grantToFirm, openStoreAt, openStores, refreshSites, setPartner, stepFirmMinute,
  storeSeedOf, syncWallet,
} from './firm';
import type { FirmBuild, FirmRefusal, FirmState, FirmStepOut, FirmStore } from './types';

/*
 * Ponowny wynajem lokalu „po Traszce” (spec §13.3, plan 4a.2 Zadanie 4): zamknięty sklep zostawia w lokalu wyposażenie, a gracz może wziąć
 * lokal znów za 30% pakietu i dwa dni budowy. Sklep wraca pod tym samym `id`, w tym samym lokalu i z tym samym układem, ale jak nowy
 * franczyzobiorca z Centralą: poziom 1, reputacja 50, zaufanie 65, pusta historia, i bez gwarancji (to też sklep #1).
 */

const SEED = 'kiełbasa-42';
const DAY = MINUTES_PER_DAY;
/** Minuty zamknięcia września (dzień 29) i października (dzień 60): w tym kroku sklepy zamykają też miesiąc. */
const SEPT_CLOSE = 29 * DAY + OPEN_TO;
const OCT_CLOSE = 60 * DAY + OPEN_TO;
const WALLET = 200_000;

const newFirm = (seed = SEED): FirmState => {
  const { state, layout, info } = freshRun(seed);
  return createFirm(seed, { econ: state, layout, info }, { ranked: false });
};
/** Firma ze statusem Partnera i gotówką na pakiet. */
function partnerFirm(seed = SEED, wallet = WALLET): FirmState {
  const f = newFirm(seed);
  f.person.partner = true;
  f.person.wallet = wallet;
  syncWallet(f);
  return f;
}
const hashOf = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const digest = (f: FirmState): string => JSON.stringify(f);
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;
const ofKind = <T extends { kind: string }>(events: readonly T[], kind: string): T[] => events.filter((e) => e.kind === kind);
const freeLot = (f: FirmState, skip = 0): number => f.city.lots.filter((l) => lotState(f, l.id) === 'wolny')[skip]!.id;

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
function rent(f: FirmState, lotId: number, pay: 'gotowka' | 'raty' = 'gotowka'): FirmBuild {
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay }, emptyStepOut())).toEqual({ ok: true });
  return f.builds[f.builds.length - 1]!;
}

/** Dzień odbioru budowy: gra do 6:00 (krok sklepów jeszcze nie poszedł), potem firma otwiera budowę; zdarzenia otwarcia w wyniku. */
function openBuild(f: FirmState, b: FirmBuild): FirmStepOut {
  playTo(f, b.readyDay * DAY + OPEN_FROM);
  const out = emptyStepOut();
  openDueBuilds(f, out);
  return out;
}

/** Nowy sklep w wolnym lokalu: wynajem, budowa i otwarcie o 6:00 w dniu odbioru. */
function rentAndOpen(f: FirmState, lotId = freeLot(f), pay: 'gotowka' | 'raty' = 'gotowka'): FirmStore {
  openBuild(f, rent(f, lotId, pay));
  return f.stores.find((s) => s.lotId === lotId)!;
}

/** Wyposażenie aktywnego sklepu prawdziwymi zakupami i remont do poziomu 1 (ulepszenia, kasa samoobsługowa; zostają w lokalu, §13.3). */
function fit(f: FirmState): void {
  grantToFirm(f, (s) => { s.level = 14; s.cash += 300_000; });
  for (const cmd of [{ type: 'buyUpgrade', id: 'szkolenie' }, { type: 'buyUpgrade', id: 'wozek' }, { type: 'buyEquipment', id: 'sco' }, { type: 'startRemont' }] as const) {
    expect(applyStoreCommand(f, cmd).result.ok, JSON.stringify(cmd)).toBe(true);
  }
}

/** Sklep, któremu Centrala wypowie umowę przy najbliższym zamknięciu miesiąca: zaufanie przy zerze i strata miesiąca. */
function loseTrust(s: EconomyState): void {
  s.tycoon.trust.value = 3;
  s.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 40_000, media: 0 };
}

/** Miesiąc bez marży i obrotu przy dobrym zaufaniu i bez mandatu: sklep bez flagi `extra` dostałby dopłatę z gwarancji do 25 tys. zł. */
function weakMonth(s: EconomyState): void {
  s.month.margin = 0;
  s.month.bonus = 0;
  s.month.revenue = 0;
  s.month.fineCount = 0;
  s.tycoon.trust.value = TRUST.start;
}

/** Wyciąg miesiąca, który sklep `id` zamknął w tej minucie (aktywny z `out.active`, reszta z `out.background`). */
function statementOf(f: FirmState, out: FirmStepOut, id: number): NonNullable<MonthReport['statement']> {
  const events = id === f.activeId ? out.active : out.background.filter((b) => b.storeId === id).map((b) => b.event);
  return ofKind(events, 'month')[0]!.report!.statement!;
}

function refused(f: FirmState, cmd: FirmCommand, reason: FirmRefusal): void {
  const before = digest(f);
  const out = emptyStepOut();
  expect(applyFirmCommand(f, cmd, out)).toEqual({ ok: false, reason });
  expect(digest(f)).toBe(before);   // odmowa nie rusza stanu
  expect(out).toEqual(emptyStepOut());
}

/** Najbliższe zamknięcie miesiąca (22:00 ostatniego dnia miesiąca) po minucie `from`. */
function nextMonthClose(from: number): number {
  let day = dayOf(from);
  while (!isLastDayOfMonth(day) || day * DAY + OPEN_TO <= from) day++;
  return day * DAY + OPEN_TO;
}

/**
 * Firma, w której sklep #2 (aktywny, z wyposażeniem i remontem kupionymi przed wypowiedzeniem) wypowiedział umowę i po okresie wypowiedzenia
 * został zamknięty; lokal wraca jako „po Traszce”, a aktywny jest #1.
 */
function closedSecond(): { f: FirmState; closed: FirmStore; lotId: number } {
  const f = partnerFirm();
  const st2 = rentAndOpen(f);
  expect(applyFirmCommand(f, { type: 'switchStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: true });
  fit(f);
  expect(applyFirmCommand(f, { type: 'terminateStore', storeId: 2 }, emptyStepOut())).toEqual({ ok: true });
  expect(st2.notice).not.toBeNull();
  for (let guard = 0; !st2.closed && guard < 90 * DAY; guard++) tick(f);
  expect(st2.closed).toBe(true);
  expect(st2.notice).not.toBeNull();   // zamknięty sklep zostaje z wypowiedzeniem; ponowny wynajem je zdejmuje
  expect(f.activeId).toBe(1);
  expect(f.over).toBeNull();
  return { f, closed: st2, lotId: st2.lotId };
}

// --- Cena i czas ---------------------------------------------------------------------------------------------------------

describe('cena i czas ponownego wynajmu', () => {
  it('stałe z projektu: 30% pakietu i dwa dni budowy', () => {
    expect(RELET_SHARE).toBe(0.3);
    expect(RELET_BUILD_DAYS).toBe(2);
  });

  it('rentPrice lokalu „po Traszce” to 30% pakietu zaokrąglone do 100 zł, a wolnego pełny pakiet; rentBuildDays: 2 dni zamiast dni lokalu', () => {
    const { f, lotId } = closedSecond();
    const lot = lotById(f.city, lotId);
    const price = rentPrice(f, lotId);
    expect(price).toBe(Math.round(lot.package * 0.3 / 100) * 100);
    expect(price % 100).toBe(0);
    expect(price).toBeLessThan(lot.package);
    expect(Math.abs(price - lot.package * 0.3)).toBeLessThanOrEqual(50);
    expect(rentBuildDays(f, lotId)).toBe(RELET_BUILD_DAYS);

    for (const free of f.city.lots.filter((l) => lotState(f, l.id) === 'wolny')) {
      expect(rentPrice(f, free.id), `lokal ${free.id}`).toBe(free.package);
      expect(rentBuildDays(f, free.id), `lokal ${free.id}`).toBe(free.buildDays);
      expect(free.buildDays).toBeGreaterThan(RELET_BUILD_DAYS);
    }
    // lokal startowy po zamknięciu #1 liczy się tak samo
    const g = partnerFirm();
    rentAndOpen(g);
    closeStore(g, 1, 'trust', emptyStepOut());
    const start = lotById(g.city, g.city.startLotId);
    expect(lotState(g, start.id)).toBe('po-traszce');
    expect(rentPrice(g, start.id)).toBe(Math.round(start.package * 0.3 / 100) * 100);
    expect(rentBuildDays(g, start.id)).toBe(RELET_BUILD_DAYS);
  }, 60_000);

  it('rentLot za gotówkę: pakiet po Traszce schodzi z portfela i idzie do monthInvest, budowa trwa 2 dni, a lokal ma stan budowa', () => {
    const { f, lotId } = closedSecond();
    const price = rentPrice(f, lotId);
    const wallet = f.person.wallet;
    const invested = f.monthInvest;
    const out = emptyStepOut();
    expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay: 'gotowka' }, out)).toEqual({ ok: true });
    const day = dayOf(clockOf(f)) + RELET_BUILD_DAYS;
    expect(f.builds).toEqual([{ lotId, readyDay: day, price, pay: 'gotowka' }]);
    expect(f.person.wallet).toBe(wallet - price);
    expect(f.monthInvest).toBe(invested + price);
    expect(out.firm).toEqual([{ kind: 'build', params: { lotId, readyDay: day, price, pay: 'gotowka' } }]);
    // Review Focus 2: budowa wygrywa z zamkniętym sklepem w tym samym lokalu
    expect(lotState(f, lotId)).toBe('budowa');
    for (const pay of ['gotowka', 'raty'] as const) refused(f, { type: 'rentLot', lotId, pay }, 'lot');
  }, 60_000);

  it('rentLot na raty: gotówka i monthInvest bez zmian, budowa niesie cenę po Traszce i pay raty', () => {
    const { f, lotId } = closedSecond();
    const price = rentPrice(f, lotId);
    const wallet = f.person.wallet;
    const invested = f.monthInvest;
    const b = rent(f, lotId, 'raty');
    expect(b).toEqual({ lotId, readyDay: dayOf(clockOf(f)) + RELET_BUILD_DAYS, price, pay: 'raty' });
    expect(f.person.wallet).toBe(wallet);
    expect(f.monthInvest).toBe(invested);
  }, 60_000);

  it('gotowka i raty liczą z ceny po Traszce: portfel równy cenie przechodzi, o złotówkę mniej dostaje gotowka', () => {
    const { f, lotId } = closedSecond();
    const price = rentPrice(f, lotId);
    f.person.wallet = price;
    syncWallet(f);
    expect(rentRefusal(f, lotId, 'gotowka')).toBeNull();
    f.person.wallet = price - 1;
    syncWallet(f);
    refused(f, { type: 'rentLot', lotId, pay: 'gotowka' }, 'gotowka');
  }, 60_000);

  it('raty liczą z ceny po Traszce, a nie z pakietu: pakiet ponad limit nowego sklepu odrzuca wolny lokal, a po Traszce przechodzi', () => {
    const { f, lotId } = closedSecond();
    const limit = installmentLimit([], TRUST.start);
    expect(limit).toBe(8750);
    lotById(f.city, lotId).package = 100_000;   // jak w teście 4a.1: 12 rat z opłatą 15% to ok. 9170 zł miesięcznie
    expect(planFor(100_000).monthly).toBeGreaterThan(limit);
    expect(planFor(rentPrice(f, lotId)).monthly).toBeLessThanOrEqual(limit);   // 30 tys. zł: rata ok. 2900 zł
    expect(rentRefusal(f, lotId, 'raty')).toBeNull();
    const free = lotById(f.city, freeLot(f));
    free.package = 100_000;   // kontrola: wolny lokal z tym samym pakietem jest odrzucony
    refused(f, { type: 'rentLot', lotId: free.id, pay: 'raty' }, 'raty');
    expect(rentRefusal(f, free.id, 'gotowka')).toBeNull();
    expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
    expect(f.builds[0]!.price).toBe(30_000);
  }, 60_000);

  it('lot: zajęty, konkurencja, własny (otwarty) i lokal w budowie nie przechodzą; „po Traszce” przechodzi', () => {
    const { f, lotId } = closedSecond();
    const lots = f.city.lots;
    const taken = lots.find((l) => l.state === 'zajety')!.id;
    const rival = lots.find((l) => l.state === 'konkurencja')!.id;
    const own = f.stores[0]!.lotId;   // otwarty #1 w lokalu startowym
    expect(lotState(f, own)).toBe('twoj');
    expect(lotState(f, taken)).toBe('zajety');
    expect(lotState(f, rival)).toBe('konkurencja');
    for (const id of [taken, rival, own, -1, lots.length]) refused(f, { type: 'rentLot', lotId: id, pay: 'gotowka' }, 'lot');
    expect(rentRefusal(f, lotId, 'gotowka')).toBeNull();
    rent(f, lotId, 'gotowka');
    expect(lotState(f, lotId)).toBe('budowa');
    expect(rentRefusal(f, lotId, 'raty')).toBe('lot');
  }, 60_000);

  it('limit: trzy otwarte sklepy, a także dwa otwarte i budowa, nie wynajmą lokalu „po Traszce”; zamknięty sklep się nie liczy', () => {
    const { f, lotId } = closedSecond();
    expect(rentRefusal(f, lotId, 'gotowka')).toBeNull();   // otwarty tylko #1

    const three = structuredClone(f);
    openStoreAt(three, freeLot(three), clockOf(three));
    openStoreAt(three, freeLot(three), clockOf(three));
    syncWallet(three);
    expect(openStores(three)).toHaveLength(3);
    expect(lotState(three, lotId)).toBe('po-traszce');
    refused(three, { type: 'rentLot', lotId, pay: 'gotowka' }, 'limit');
    refused(three, { type: 'rentLot', lotId, pay: 'raty' }, 'limit');

    const building = structuredClone(f);
    openStoreAt(building, freeLot(building), clockOf(building));
    syncWallet(building);
    rent(building, freeLot(building), 'gotowka');
    expect(openStores(building).length + building.builds.length).toBe(3);
    refused(building, { type: 'rentLot', lotId, pay: 'gotowka' }, 'limit');
  }, 60_000);
});

// --- Ponowne otwarcie sklepu #2 --------------------------------------------------------------------------------------------

describe('ponowne otwarcie sklepu #2 po zamknięciu', () => {
  it('ten sam wpis (id, lokal, seed sceny, układ), wyposażenie z lokalu, a Centrala zaczyna od nowa: poziom 1, reputacja 50, zaufanie 65, pusta historia', () => {
    const { f, closed, lotId } = closedSecond();
    const lot = lotById(f.city, lotId);
    const layout = closed.layout;
    const dead = closed.econ;
    expect(dead).toMatchObject({ remontLevel: 1 });
    expect(dead.level).toBeGreaterThan(1);
    expect(dead.history.length).toBeGreaterThan(0);   // pierwszy miesiąc #2 zamknięty: z tej historii nic nie wraca
    dead.reputation = 80;
    const upgrades = structuredClone(dead.upgrades);
    const equipment = structuredClone(dead.equipment);
    expect(upgrades).toEqual({ szkolenie: 1, wozek: 1 });
    expect(equipment.map((u) => u.id)).toEqual(['sco']);
    f.person.ogonki = 7;
    syncWallet(f);

    const price = rentPrice(f, lotId);
    const b = rent(f, lotId, 'raty');
    const out = openBuild(f, b);
    expect(ofKind(out.firm, 'opened')).toEqual([{ kind: 'opened', storeId: 2, params: { lotId, reopened: 1 } }]);

    expect(f.stores.map((s) => ({ id: s.id, lotId: s.lotId, closed: s.closed }))).toEqual([
      { id: 1, lotId: f.city.startLotId, closed: false }, { id: 2, lotId, closed: false },
    ]);   // ten sam wpis w miejscu na liście, bez nowego id
    const st = f.stores[1]!;
    expect(st).toMatchObject({ closed: false, notice: null, reopened: true });
    expect(st.layout).toBe(layout);
    expect(st.econ.seed).toBe(storeSeedFor(SEED, lotId));
    expect(st.info).toMatchObject({ site: { extra: true, district: lot.district, lot: lot.spec } });
    expect(st.info.slots.length).toBe(computeStoreInfo(layout).slots.length);

    expect(st.econ).not.toBe(dead);
    expect(st.econ.upgrades).toEqual(upgrades);
    expect(st.econ.equipment).toEqual(equipment);
    expect(st.econ.remontLevel).toBe(1);
    expect(st.econ.upgrades).not.toBe(dead.upgrades);   // kopie, nie te same referencje
    expect(st.econ.equipment).not.toBe(dead.equipment);
    expect(st.econ.equipment[0]).not.toBe(dead.equipment[0]);

    expect(st.econ).toMatchObject({ level: 1, reputation: 50, gameOver: false, minute: b.readyDay * DAY + OPEN_FROM, history: [], xp: 0 });
    expect(st.econ.tycoon.trust.value).toBe(TRUST.start);
    expect(st.econ.cash).toBe(f.person.wallet);
    expect(st.econ.ogonki).toBe(f.person.ogonki);   // Ogonki to portfel osoby (wpadają w czasie budowy), a nie zero nowego sklepu
    expect(f.person.ogonki).toBeGreaterThanOrEqual(7);
    expect(st.econ.franchisee.remanent.known).toBe(f.person.remanentKnown);

    // pakiet na raty: jedyna rata w rozliczeniu to pakiet z planu ceny po Traszce, z etykietą adaptacji lokalu
    const plan = planFor(price);
    expect(plan.months).toBeLessThanOrEqual(12);
    expect(st.econ.franchisee.installments).toHaveLength(1);
    expect(st.econ.franchisee.installments[0]).toMatchObject({
      label: `Adaptacja lokalu: ul. ${lot.street} ${lot.number}`, price, fee: plan.fee, total: plan.total, monthly: plan.monthly, paid: 0, months: plan.months,
    });
    expect(lotState(f, lotId)).toBe('twoj');
  }, 120_000);

  it('pierwszy wyciąg po ponownym otwarciu: bez gwarancji, z ratą pakietu z planu ceny po Traszce', () => {
    const { f, lotId } = closedSecond();
    const plan = planFor(rentPrice(f, lotId));
    openBuild(f, rent(f, lotId, 'raty'));
    expect(f.activeId).toBe(1);
    playTo(f, nextMonthClose(clockOf(f)));
    const out = tick(f);
    const stmt = statementOf(f, out, 2);
    expect(stmt.guarantee).toBe(0);
    expect(stmt.installments).toBe(plan.monthly);
  }, 180_000);

  it('za gotówkę: pakiet po Traszce schodzi z portfela przy wynajmie, więc sklep otwiera się bez rat, z gotówką równą portfelowi', () => {
    const { f, lotId } = closedSecond();
    const price = rentPrice(f, lotId);
    const wallet = f.person.wallet;
    const b = rent(f, lotId, 'gotowka');
    expect(f.person.wallet).toBe(wallet - price);
    openBuild(f, b);
    const st = f.stores[1]!;
    expect(st.reopened).toBe(true);
    expect(st.econ.franchisee.installments).toEqual([]);
    expect(st.econ.cash).toBe(f.person.wallet);
  }, 60_000);

  it('Review Focus 2: budowa jest w stanie budowa przez cały czas, a sklep otwiera się dokładnie w dniu odbioru, o 6:00', () => {
    const { f, lotId } = closedSecond();
    const b = rent(f, lotId, 'raty');
    expect(b.readyDay - dayOf(clockOf(f))).toBe(RELET_BUILD_DAYS);
    const ready = b.readyDay * DAY + OPEN_FROM;
    playTo(f, ready - 1);
    openDueBuilds(f, emptyStepOut());
    expect(f.stores[1]!.closed).toBe(true);
    expect(lotState(f, lotId)).toBe('budowa');
    playTo(f, ready);
    openDueBuilds(f, emptyStepOut());
    expect(f.stores[1]!.closed).toBe(false);
    expect(f.builds).toEqual([]);
    expect(f.stores[1]!.econ.minute).toBe(ready);
  }, 120_000);
});

// --- Lokal obok: dwa sklepy nie dzielą lokalu -----------------------------------------------------------------------------

/**
 * Para lokali S i Y: Y leży po stronie przejęcia sklepu w wolnym lokalu S (remont poziomu 1 dokupuje Y, §7.2), a generator zbuduje sklep w obu.
 * Generator nie stawia wolnych lokali obok siebie (każdy wolny w innym kwartale), więc w teście Y trzeba oznaczyć jako wolny.
 */
function neighbourPair(): { seed: string; s: number; y: number } {
  for (const seed of [SEED, ...Array.from({ length: 10 }, (_, i) => `miasto-${i}`)]) {
    const city = generateCity(seed);
    for (const lot of city.lots.filter((l) => l.state === 'wolny')) {
      const storeSeed = storeSeedFor(seed, lot.id);
      const side = takeoverSide(layoutFor(storeSeed, 0, lot.spec), storeSeed);
      const y = side === null ? null : lotNeighbour(city, lot.id, side);
      if (y === null || y.state !== 'zajety') continue;
      try {
        layoutFor(storeSeedFor(seed, y.id), 0, y.spec);
      } catch {
        continue;   // generator sklepu bywa bezradny wobec rzadkiej kombinacji wymiarów
      }
      return { seed, s: lot.id, y: y.id };
    }
  }
  throw new Error('żaden seed nie ma pary sąsiednich lokali do zbudowania');
}

/** Remont aktywnego sklepu do poziomu 1: poziom gracza i gotówka z góry, potem prawdziwe polecenie. */
function remont(f: FirmState): void {
  grantToFirm(f, (s) => { s.level = 14; s.cash += 100_000; });
  expect(applyStoreCommand(f, { type: 'startRemont' }).result.ok).toBe(true);
}

/**
 * Firma z zamkniętym sklepem w lokalu S (remont poziomu `level`) i wolnym sąsiadem Y; aktywny jest #1. Zamknięcie schodzi z portfela
 * jak zwykle (`closeStore`).
 */
function neighbourWorld(level: 0 | 1): { f: FirmState; closed: FirmStore; y: number } {
  const { seed, s, y } = neighbourPair();
  const f = partnerFirm(seed);
  f.city.lots[y]!.state = 'wolny';
  const closed = rentAndOpen(f, s);
  if (level === 1) {
    expect(applyFirmCommand(f, { type: 'switchStore', storeId: closed.id }, emptyStepOut())).toEqual({ ok: true });
    remont(f);
    expect(closed.econ.remontLevel).toBe(1);
    expect(lotState(f, y)).toBe('twoj');   // sąsiad jest w układzie otwartego sklepu
  } else {
    expect(lotState(f, y)).toBe('obok');
  }
  closeStore(f, closed.id, 'trust', emptyStepOut());
  expect(f.activeId).toBe(1);
  expect(lotState(f, s)).toBe('po-traszce');
  expect(lotState(f, y)).toBe('wolny');   // po zamknięciu sąsiad wraca do stanu z generatora i można go wynająć osobno
  return { f, closed, y };
}

describe('lokal obok zamkniętego sklepu (układ po remoncie zajmuje sąsiada)', () => {
  it('sąsiad jest Twoim otwartym sklepem: ponowny wynajem odmówiony z lot; wynajem sąsiada przy zamkniętym sklepie przechodzi, a po jego zamknięciu ponowny wynajem wraca', () => {
    const { f, closed, y } = neighbourWorld(1);
    expect(lotRentable(f, closed.lotId)).toBe(true);   // sąsiad jeszcze nie jest Twój
    expect(rentRefusal(f, closed.lotId, 'gotowka')).toBeNull();
    expect(rentRefusal(f, y, 'gotowka')).toBeNull();

    const next = rentAndOpen(f, y);
    expect(lotState(f, y)).toBe('twoj');
    expect(lotRentable(f, closed.lotId)).toBe(false);
    expect(rentRefusal(f, closed.lotId, 'gotowka')).toBe('lot');
    for (const pay of ['gotowka', 'raty'] as const) refused(f, { type: 'rentLot', lotId: closed.lotId, pay }, 'lot');
    expect(lotState(f, closed.lotId)).toBe('po-traszce');   // odmowa nie zmienia stanu lokalu

    closeStore(f, next.id, 'trust', emptyStepOut());
    expect(lotState(f, y)).toBe('po-traszce');
    expect(lotRentable(f, closed.lotId)).toBe(true);
    expect(rentRefusal(f, closed.lotId, 'gotowka')).toBeNull();
    openBuild(f, rent(f, closed.lotId, 'gotowka'));
    expect(f.stores.find((st) => st.lotId === closed.lotId)).toMatchObject({ closed: false, reopened: true });
  }, 120_000);

  it('sąsiad w budowie też jest Twój: ponowny wynajem odmówiony z lot, a po otwarciu sąsiada nadal', () => {
    const { f, closed, y } = neighbourWorld(1);
    const build = rent(f, y, 'gotowka');
    expect(lotState(f, y)).toBe('budowa');
    expect(lotRentable(f, closed.lotId)).toBe(false);
    for (const pay of ['gotowka', 'raty'] as const) refused(f, { type: 'rentLot', lotId: closed.lotId, pay }, 'lot');
    openBuild(f, build);
    expect(lotState(f, y)).toBe('twoj');
    refused(f, { type: 'rentLot', lotId: closed.lotId, pay: 'gotowka' }, 'lot');
  }, 120_000);

  it('sklep zamknięty bez remontu (poziom 0) nie zajmuje sąsiada układem, więc ponowny wynajem przechodzi mimo Twojego sklepu obok', () => {
    const { f, closed, y } = neighbourWorld(0);
    expect(closed.econ.remontLevel).toBe(0);
    rentAndOpen(f, y);
    expect(lotState(f, y)).toBe('twoj');
    expect(lotRentable(f, closed.lotId)).toBe(true);
    expect(rentRefusal(f, closed.lotId, 'gotowka')).toBeNull();
    openBuild(f, rent(f, closed.lotId, 'gotowka'));
    expect(f.stores.find((st) => st.lotId === closed.lotId)).toMatchObject({ closed: false, reopened: true });
  }, 120_000);

  it('lotRentable: wolny tak, zajęty, konkurencja, własny, lokal w budowie i nieistniejący nie', () => {
    const { f, closed, y } = neighbourWorld(1);
    expect(lotRentable(f, y)).toBe(true);
    expect(lotRentable(f, closed.lotId)).toBe(true);
    expect(lotRentable(f, f.city.startLotId)).toBe(false);   // otwarty #1
    expect(lotRentable(f, f.city.lots.find((l) => l.state === 'zajety' && l.id !== y)!.id)).toBe(false);
    expect(lotRentable(f, f.city.lots.find((l) => l.state === 'konkurencja')!.id)).toBe(false);
    for (const id of [-1, 1.5, f.city.lots.length, Number.NaN]) expect(lotRentable(f, id)).toBe(false);
    rent(f, y, 'gotowka');
    expect(lotRentable(f, y)).toBe(false);   // w budowie
  }, 120_000);
});

// --- Review Focus 1: lokal startowy ----------------------------------------------------------------------------------------

describe('Review Focus 1: ponowny wynajem lokalu startowego', () => {
  it('#1 zamknięty przez zaufanie 0 przy działającym #2 i wzięty znów: pierwsze miejsce, seed gry, układ po remoncie, dochód z sieci, bez gwarancji także jako jedyny sklep', () => {
    const f = partnerFirm();
    const st1 = f.stores[0]!;
    fit(f);   // #1: wyposażenie i remont do poziomu 1 jeszcze przed drugim sklepem
    const st2 = rentAndOpen(f);
    setPartner(f, { points: 2, networkIncome: 30, stores: 1 });
    playTo(f, SEPT_CLOSE);
    loseTrust(st1.econ);
    tick(f);
    expect(st1.closed).toBe(true);
    expect(f.activeId).toBe(2);
    expect(st2.econ.partner.networkIncome).toBe(30);   // dochód z sieci przeszedł na #2

    const start = f.city.startLotId;
    const layout = st1.layout;
    const upgrades = structuredClone(st1.econ.upgrades);
    const equipment = structuredClone(st1.econ.equipment);
    expect(st1.econ.remontLevel).toBe(1);
    expect(lotState(f, start)).toBe('po-traszce');
    expect(rentRefusal(f, start, 'gotowka')).toBeNull();
    expect(storeSeedOf(SEED, f.city, start)).toBe(SEED);
    expect(storeSeedOf(SEED, f.city, st2.lotId)).toBe(storeSeedFor(SEED, st2.lotId));

    openBuild(f, rent(f, start, 'gotowka'));
    expect(f.stores.map((s) => s.id)).toEqual([1, 2]);
    expect(openStores(f).map((s) => s.id)).toEqual([1, 2]);   // #1 znów na pierwszym miejscu listy
    const back = f.stores[0]!;
    expect(back).toMatchObject({ id: 1, lotId: start, closed: false, notice: null, reopened: true });
    expect(back.layout).toBe(layout);
    expect(back.econ.seed).toBe(SEED);   // seed sceny to seed gry
    expect(back.econ.upgrades).toEqual(upgrades);
    expect(back.econ.equipment).toEqual(equipment);
    expect(back.econ.remontLevel).toBe(1);
    expect(back.econ).toMatchObject({ level: 1, reputation: 50, history: [], gameOver: false });
    expect(back.econ.tycoon.trust.value).toBe(TRUST.start);
    expect(back.info.site).toMatchObject({ extra: true, ownCosts: true, firmDebt: true });
    expect(f.stores[1]!.info.site).toMatchObject({ extra: true, ownCosts: false, firmDebt: true });   // ZUS i księgowa wróciły do #1
    // dochód z sieci wraca do najniższego otwartego sklepu
    expect(back.econ.partner).toEqual({ points: 2, networkIncome: 30, stores: 1 });
    expect(f.stores[1]!.econ.partner).toEqual({ points: 2, networkIncome: 0, stores: 1 });

    // #2 kończy umowę: #1 zostaje jedynym sklepem i nadal ma flagę dodatkowego (bez gwarancji), a nie „sklep jak dziś”
    closeStore(f, 2, 'trust', emptyStepOut());
    expect(f.activeId).toBe(1);
    expect(openStores(f)).toEqual([back]);
    expect(back.info.site).toMatchObject({ extra: true, ownCosts: true, firmDebt: false });
    expect(back.econ.partner.networkIncome).toBe(30);

    playTo(f, OCT_CLOSE);
    const control = structuredClone(f);
    delete control.stores[0]!.reopened;
    refreshSites(control);
    expect(control.stores[0]!.info.site).toBeUndefined();   // kontrola: bez flagi #1 jest znów „sklepem jak dziś”
    const guarantee = (g: FirmState): number => {
      weakMonth(activeStore(g).econ);
      return statementOf(g, tick(g), 1).guarantee;
    };
    expect(guarantee(control)).toBeGreaterThan(0);   // taki miesiąc bez flagi dostaje dopłatę, więc zero poniżej coś znaczy
    expect(guarantee(f)).toBe(0);
  }, 240_000);

  it('sklep startowy bez zamknięcia dalej nie ma `reopened`, a jedyny sklep startowy gra bez `site` (jak dziś)', () => {
    const f = partnerFirm();
    expect(f.stores[0]!.reopened).toBeUndefined();
    expect(f.stores[0]!.info.site).toBeUndefined();
    const st2 = rentAndOpen(f);
    expect(st2.reopened).toBeUndefined();
    expect(f.stores[0]!.info.site).toMatchObject({ extra: false });
    closeStore(f, 2, 'trust', emptyStepOut());
    expect(f.stores[0]!.info.site).toBeUndefined();
    expect('reopened' in f.stores[0]!).toBe(false);
  }, 60_000);
});

// --- Determinizm i neutralność -------------------------------------------------------------------------------------------------

describe('createEconomy z wyposażeniem', () => {
  const { info } = freshRun(SEED);

  it('bez wyposażenia stan jest co do bitu ten sam: brak argumentu i jawne undefined dają ten sam skrót', () => {
    const plain = createEconomy(SEED, info);
    expect(hashOf(createEconomy(SEED, info, undefined, OPEN_FROM, undefined))).toBe(hashOf(plain));
    expect(hashOf(createEconomy(SEED, info, undefined, OPEN_FROM))).toBe(hashOf(plain));
    // neutralne wyposażenie (puste) niczego nie zmienia poza tym, co ustawia
    const empty: StoreFittings = { upgrades: {}, equipment: [], remontLevel: 0 };
    expect(hashOf(createEconomy(SEED, info, undefined, OPEN_FROM, empty))).toBe(hashOf(plain));
  });

  it('wyposażenie wchodzi kopią, przed celem KPI: skala sklepu liczy się z ulepszeń od pierwszej minuty', () => {
    const info1 = computeStoreInfo(layoutFor(SEED, 1));
    const fittings: StoreFittings = { upgrades: { ulotki: 4, szkolenie: 1 }, equipment: [{ id: 'sco', slot: null }], remontLevel: 1 };
    const econ = createEconomy(SEED, info1, undefined, OPEN_FROM, fittings);
    expect(econ.upgrades).toEqual({ ulotki: 4, szkolenie: 1 });
    expect(econ.equipment).toEqual([{ id: 'sco', slot: null }]);
    expect(econ.remontLevel).toBe(1);
    expect(econ.upgrades).not.toBe(fittings.upgrades);
    expect(econ.equipment).not.toBe(fittings.equipment);
    expect(econ.equipment[0]).not.toBe(fittings.equipment[0]);
    fittings.upgrades.ulotki = 0;
    fittings.equipment[0]!.slot = 'x';
    expect(econ.upgrades.ulotki).toBe(4);   // zmiana źródła nie dochodzi do sklepu
    expect(econ.equipment[0]!.slot).toBeNull();

    const bare = createEconomy(SEED, info1, undefined, OPEN_FROM);
    expect(kpiScaleOf(econ, info1).dailyCustomers).toBeGreaterThan(kpiScaleOf(bare, info1).dailyCustomers);
    expect(econ.tycoon.kpi).toEqual(newKpiWeek(econ.seedHash, 1, dayOf(econ.minute), kpiMetricsOf(econ), kpiScaleOf(econ, info1)));
    expect(JSON.stringify(econ.tycoon.kpi)).not.toBe(JSON.stringify(bare.tycoon.kpi));   // cel tygodnia liczy się ze skali z wyposażeniem
  });
});

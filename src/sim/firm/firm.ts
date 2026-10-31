import { generateCity, lotById } from '@/sim/city/generateCity';
import { siteFor, storeSeedFor } from '@/sim/city/traffic';
import { dayOf } from '@/sim/economy/calendar';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { MAX_MINUTES_PER_ADVANCE, gameMinutesPerSecond, type EconClock } from '@/sim/economy/clock';
import { applyCommand, type Command, type CommandOutcome } from '@/sim/economy/commands';
import {
  DEBT_WARN, awaitingDecision, checkDebt, createEconomy, stepMinute, type EconEvent, type EconEventKind, type EconomyState,
} from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import type { SiteMods } from '@/sim/economy/site';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { layoutFor } from '@/sim/store/layoutFor';
import type { StoreLayout } from '@/sim/store/types';
import { INBOX_MAX, type FirmState, type FirmStepOut, type FirmStore } from './types';

/*
 * Firma (spec §11, §12, §14.1). Gotówka i Ogonki należą do osoby (`person`), a nie do sklepu: przed krokiem sklepu i przed każdym jego
 * poleceniem firma wpisuje je do `econ`, po nim odbiera, więc sklepy liczą się pełną ekonomią, a pieniądze nie dublują się i nie giną.
 * Sklepy liczą się w kolejności `id`, razem z aktywnym, minuta po minucie (kolejność jest częścią determinizmu). Firma z jednym
 * sklepem startowym gra jak sama ekonomia co do bitu: bez `site`, bez zdarzeń firmy.
 */

/** Zdarzenia sklepu w tle, które czekają na „OK” z nazwą sklepu (§12); reszta zamyka się sama. */
const IMPORTANT: readonly EconEventKind[] = ['month', 'remanent', 'trust-tier', 'gameover'];

/** Firma z jednym sklepem: startowym (#1, w lokalu startowym miasta), na gotówce i Ogonkach tego sklepu. Miasto liczy się z seeda. */
export function createFirm(
  seed: string, start: { econ: EconomyState; layout: StoreLayout; info: StoreInfo }, opts: { ranked: boolean },
): FirmState {
  const city = generateCity(seed);
  const { econ } = start;
  const f: FirmState = {
    seed, ranked: opts.ranked, city,
    person: { wallet: econ.cash, ogonki: econ.ogonki, partner: false, remanentKnown: econ.franchisee.remanent.known },
    stores: [{ id: 1, lotId: city.startLotId, econ, layout: start.layout, info: start.info, closed: false, notice: null }],
    activeId: 1, builds: [], monthInvest: 0, inbox: [],
    weatherHash: econ.seedHash, over: null,
  };
  refreshSites(f);
  return f;
}

export function activeStore(f: FirmState): FirmStore {
  const st = f.stores.find((s) => s.id === f.activeId);
  if (!st) throw new RangeError(`aktywny sklep ${f.activeId} nie istnieje`);
  return st;
}

export const openStores = (f: FirmState): FirmStore[] => f.stores.filter((s) => !s.closed);

// --- Portfel osoby i kasy sklepów -------------------------------------------------------------------------------

const load = (f: FirmState, st: FirmStore): void => {
  st.econ.cash = f.person.wallet;
  st.econ.ogonki = f.person.ogonki;
};

const take = (f: FirmState, st: FirmStore): void => {
  f.person.wallet = st.econ.cash;
  f.person.ogonki = st.econ.ogonki;
};

/** Cash i ogonki każdego otwartego sklepu := portfel osoby. */
export function syncWallet(f: FirmState): void {
  for (const st of openStores(f)) load(f, st);
}

/** Premia dzienna, zarobek offline i inne wpływy spoza poleceń: wpadają do gotówki raz, przez aktywny sklep. */
export function grantToFirm(f: FirmState, grant: (s: EconomyState) => void): void {
  const st = activeStore(f);
  load(f, st);
  grant(st.econ);
  take(f, st);
  syncWallet(f);
}

// --- Skład: flagi sklepów i premia sieci ------------------------------------------------------------------------

/**
 * Dzielnica i flagi sklepu w mieście (§11.2, §11.4). `openIds` to otwarte sklepy (rosnąco) razem z tym: ZUS i księgową płaci
 * najniższe `id`, debet sprawdza firma od dwóch sklepów, pogodę miasta losuje sklep startowy.
 */
function siteOf(f: FirmState, lotId: number, id: number, openIds: readonly number[]): SiteMods {
  const start = lotId === f.city.startLotId;
  return siteFor(f.city, lotId, { extra: !start, ownCosts: id === openIds[0], firmDebt: openIds.length >= 2, weatherHash: start ? null : f.weatherHash });
}

/** Flagi z §11.2 i §11.4 po każdej zmianie składu. Jeden sklep startowy to sklep jak dziś: bez `site`. */
export function refreshSites(f: FirmState): void {
  const open = openStores(f);
  const ids = open.map((s) => s.id);
  for (const st of open) {
    if (open.length === 1 && st.lotId === f.city.startLotId) {
      if (st.info.site) {
        const info = { ...st.info };
        delete info.site;
        st.info = info;
      }
      continue;
    }
    st.info = { ...st.info, site: siteOf(f, st.lotId, st.id, ids) };
  }
}

/** Premia sieci z poprzednich gier: punkty w każdym sklepie, dochód z sieci (raz dziennie) tylko w sklepie o najniższym otwartym `id`. */
export function setPartner(f: FirmState, partner: EconomyState['partner']): void {
  const open = openStores(f);
  for (const st of open) st.econ.partner = { ...partner, networkIncome: st === open[0] ? partner.networkIncome : 0 };
}

/**
 * Otwiera sklep w lokalu miasta w minucie `minute` (ta sama co minuta pozostałych sklepów): układ i seed z lokalu, dzielnica z `siteFor`
 * już w `StoreInfo`, z którego powstaje ekonomia (pogoda i cel KPI liczą się z dzielnicy). Gotówka i Ogonki to portfel osoby, a wiedza
 * o limicie ubytków idzie z osoby; premia sieci tylko punkty, bo dochód z sieci ma sklep o najniższym `id`.
 */
export function openStoreAt(f: FirmState, lotId: number, minute: number): FirmStore {
  const lot = lotById(f.city, lotId);
  const id = f.stores.reduce((n, s) => Math.max(n, s.id), 0) + 1;
  const seed = storeSeedFor(f.seed, lotId);
  const layout = layoutFor(seed, 0, lot.spec);
  const info: StoreInfo = { ...computeStoreInfo(layout), site: siteOf(f, lotId, id, [...openStores(f).map((s) => s.id), id]) };
  const base = (openStores(f)[0] ?? f.stores[0]!).econ.partner;
  const econ = createEconomy(seed, info, { ...base, networkIncome: 0 }, minute);
  econ.cash = f.person.wallet;
  econ.ogonki = f.person.ogonki;
  econ.franchisee.remanent.known = f.person.remanentKnown;
  const st: FirmStore = { id, lotId, econ, layout, info, closed: false, notice: null };
  f.stores.push(st);
  refreshSites(f);
  return st;
}

// --- Minuta -----------------------------------------------------------------------------------------------------

export const emptyStepOut = (): FirmStepOut => ({ active: [], background: [], firm: [] });

/** Koniec gry z debetu całej gotówki: każdy otwarty sklep dostaje `gameOver`, więc ekran końca pokazuje aktywny. */
function endByDebt(f: FirmState): void {
  f.over = 'debt';
  for (const st of openStores(f)) st.econ.gameOver = true;
}

/**
 * Zastępca w sklepie w tle: każda widoczna karta dostaje odpowiedź zaznaczoną z góry (jak w `replayRun`), a wpis ląduje w skrzynce
 * (najwyżej `INBOX_MAX`). Zdarzenia z odpowiedzi (wynik karty, awans) idą do zdarzeń tego sklepu w tej minucie.
 */
function deputy(f: FirmState, st: FirmStore, events: EconEvent[], out: FirmStepOut): void {
  const day = dayOf(st.econ.minute);
  for (const card of visibleCards(st.econ.tycoon.cards, st.econ.minute)) {
    const answer = defaultAnswer(card);
    const done = applyCommand(st.econ, st.info, { type: 'answerCard', seq: card.seq, answer });
    events.push(...done.events);
    if (!done.result.ok) continue;
    f.inbox.push({ day, storeId: st.id, card: card.id, answer });
    out.firm.push({ kind: 'deputy', storeId: st.id, params: { card: card.id, answer } });
  }
  if (f.inbox.length > INBOX_MAX) f.inbox.splice(0, f.inbox.length - INBOX_MAX);
}

/**
 * Jedna minuta firmy. Kolejność kroków jest częścią determinizmu:
 * 1. (Zadanie 5) tu wchodzi otwarcie budów o `OPEN_FROM`, przed krokiem sklepów;
 * 2. sklepy po `id`: zastępca w tle, potem krok na portfelu osoby;
 * 3. zdarzenia: aktywnego bez zmian, tła z ważnością;
 * 4. debet całej gotówki raz po minucie wszystkich sklepów (§11.4), od dwóch sklepów;
 * 5. (Zadania 5 i 6) tu wchodzą zamknięcia sklepów i status Partnera po `month` sklepu startowego;
 * 6. raport sieci przy zamknięciu miesiąca w kilku sklepach;
 * 7. pierwszy remanent któregokolwiek sklepu to wiedza osoby;
 * 8. portfel do kas wszystkich sklepów.
 */
export function stepFirmMinute(f: FirmState, out: FirmStepOut): void {
  if (f.over !== null) return;
  const walletBefore = f.person.wallet;

  // 1. (Zadanie 5): openDueBuilds(f, out)

  const stepped: { st: FirmStore; events: EconEvent[] }[] = [];
  for (const st of openStores(f)) {
    const events: EconEvent[] = [];
    load(f, st);
    if (st.id !== f.activeId && awaitingDecision(st.econ)) deputy(f, st, events, out);
    stepMinute(st.econ, st.info, events);
    take(f, st);
    stepped.push({ st, events });
  }

  for (const { st, events } of stepped) {
    if (st.id === f.activeId) out.active.push(...events);
    else for (const event of events) out.background.push({ storeId: st.id, event, important: IMPORTANT.includes(event.kind) });
  }

  if (openStores(f).length >= 2) {
    const cash = f.person.wallet;
    if (cash < DEBT_LIMIT) {
      endByDebt(f);
      out.firm.push({ kind: 'gameover', params: { reason: 'debt', cash } });
    } else if (cash < DEBT_WARN && walletBefore >= DEBT_WARN) {
      out.firm.push({ kind: 'debt', params: { cash } });
    }
  }

  // 5. (Zadanie 6): zamknięcia sklepów; (Zadanie 5): grantPartnerIfDue(f, out) po `month` sklepu startowego

  const months = stepped.flatMap(({ st, events }) => events.filter((e) => e.kind === 'month' && e.report).map((e) => ({ id: st.id, report: e.report! })));
  if (months.length > 0) {
    if (months.length >= 2) {
      const stores = months.map(({ id, report }) => ({ id, profit: report.profit, net: report.statement?.net ?? 0 }));
      out.firm.push({
        kind: 'network-report',
        summary: {
          label: months[0]!.report.label, wallet: f.person.wallet, stores, invest: f.monthInvest, total: stores.reduce((n, s) => n + s.net, 0),
        },
      });
    }
    f.monthInvest = 0;   // pakiety otwarcia liczą się w miesiącu, w którym je zapłacono
  }

  if (!f.person.remanentKnown && stepped.some(({ st }) => st.econ.franchisee.remanent.known)) f.person.remanentKnown = true;

  syncWallet(f);
}

/**
 * Czas gry firmy: zasady `advanceEconomy` na zegarze aktywnego sklepu (wszystkie otwarte sklepy stoją w tej samej minucie), ale pętla
 * staje też na `over`. Karta aktywnego sklepu zatrzymuje grę, karta sklepu w tle nie: odpowiada na nią zastępca w następnej minucie.
 */
export function advanceFirm(f: FirmState, clock: EconClock, seconds: number, out: FirmStepOut, stopAt?: number): number {
  if (!(seconds > 0)) return 0;
  let budget = seconds;
  let steps = 0;
  while (steps < MAX_MINUTES_PER_ADVANCE) {
    const s = activeStore(f).econ;
    if (f.over !== null || s.gameOver || awaitingDecision(s)) break;
    if (stopAt !== undefined && s.minute >= stopAt) break;
    const rate = gameMinutesPerSecond(s.minute);
    const need = (1 - clock.acc) / rate;
    if (budget < need) { clock.acc += budget * rate; break; }
    budget -= need;
    clock.acc = 0;
    stepFirmMinute(f, out);
    steps++;
  }
  return steps;
}

/**
 * Polecenie gracza w aktywnym sklepie na portfelu osoby. Przy dwóch sklepach i więcej debet sprawdza firma (sklep ma flagę
 * `firmDebt`), więc po poleceniu to samo sprawdza tu: koniec gry we wszystkich sklepach, zdarzenia w wyniku polecenia jak przy jednym.
 */
export function applyStoreCommand(f: FirmState, cmd: Command): CommandOutcome {
  const st = activeStore(f);
  const before = f.person.wallet;
  load(f, st);
  const outcome = applyCommand(st.econ, st.info, cmd);
  if (outcome.layoutChanged && outcome.layout && outcome.info) {
    st.layout = outcome.layout;
    st.info = outcome.info;
  }
  take(f, st);
  if (openStores(f).length >= 2 && !st.econ.gameOver) {
    checkDebt(st.econ, before, outcome.events);
    if (st.econ.gameOver) endByDebt(f);
  }
  syncWallet(f);
  return outcome;
}

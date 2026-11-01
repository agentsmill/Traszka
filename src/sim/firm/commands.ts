import { lotById, lotNeighbour } from '@/sim/city/generateCity';
import { storeSeedFor } from '@/sim/city/traffic';
import type { CityState, LotState } from '@/sim/city/types';
import { dayOf } from '@/sim/economy/calendar';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { installmentLimit, planFor } from '@/sim/economy/franchisee';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { layoutFor } from '@/sim/store/layoutFor';
import { takeoverSide } from '@/sim/store/takeover';
import { noticeEndDay } from './closure';
import { activeStore, openStoreAt, openStores, syncWallet } from './firm';
import { MAX_STORES, type FirmRefusal, type FirmState, type FirmStepOut, type FirmStore } from './types';

/*
 * Polecenia firmy (spec §10, §12, §13): status Partnera Strategicznego, wynajem lokalu z pakietem otwarcia (gotówka albo 12 rat), budowa,
 * otwarcie sklepu o `OPEN_FROM` w dniu odbioru, przełączanie aktywnego sklepu i wypowiedzenie umowy sklepu. To osobny typ od `Command`
 * ze sklepu: `Command`, `COMMAND_TYPES` i `AFTER` się nie zmieniają, a pola zostają płaskie. Polskich zdań stąd nie ma: zdarzenia
 * i odmowy to identyfikatory i parametry, tekst składa interfejs (wyjątek: etykieta raty „Adaptacja lokalu: ul. …”, bo żyje
 * w `EconomyState` jak każda rata).
 */

export type FirmCommand =
  | { type: 'rentLot'; lotId: number; pay: 'gotowka' | 'raty' }
  | { type: 'switchStore'; storeId: number }
  | { type: 'terminateStore'; storeId: number };

export const FIRM_COMMAND_TYPES: readonly FirmCommand['type'][] = ['rentLot', 'switchStore', 'terminateStore'];

const PAYS: readonly string[] = ['gotowka', 'raty'];
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

type Fields = Record<string, unknown>;
/** Walidatory pól po typie polecenia; `satisfies` wymusza wpis dla każdego typu z `FirmCommand`. */
const VALID = {
  rentLot: (c) => isInt(c.lotId) && typeof c.pay === 'string' && PAYS.includes(c.pay),
  switchStore: (c) => isInt(c.storeId),
  terminateStore: (c) => isInt(c.storeId),
} satisfies Record<FirmCommand['type'], (c: Fields) => boolean>;

/** Czy `x` ma kształt polecenia firmy. Zbędne klucze są dozwolone; `Object.hasOwn`, bo `in` przepuszczałby `toString` i `__proto__`. */
export function isFirmCommand(x: unknown): x is FirmCommand {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const c = x as Fields;
  const type = c.type;   // raz: obiekt z getterem nie da innego `type` przy sprawdzeniu i przy wyborze walidatora
  return typeof type === 'string' && Object.hasOwn(VALID, type) && VALID[type as FirmCommand['type']](c);
}

export type FirmCommandResult = { ok: true } | { ok: false; reason: FirmRefusal };

const refuse = (reason: FirmRefusal): FirmCommandResult => ({ ok: false, reason });

// --- Status Partnera Strategicznego (§10.1) ----------------------------------------------------------------------

/** Tyle ostatnich zamkniętych miesięcy z rzędu musi mieć dodatni wynik w sklepie startowym. */
export const PARTNER_MONTHS = 2;
/** Zaufanie Centrali, które trzeba mieć przy zamknięciu miesiąca („Zaufany partner”). */
export const PARTNER_TRUST = 75;

/** Sklep startowy: najniższe `id` (#1), nigdy nie znika z listy, nawet po zamknięciu. */
const startStore = (f: FirmState): FirmStore => f.stores[0]!;

/** Ile ostatnich miesięcy z rzędu ma `profit > 0` (liczone najwyżej do `PARTNER_MONTHS`). */
function profitStreak(history: readonly { profit: number }[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && n < PARTNER_MONTHS && history[i]!.profit > 0; i--) n++;
  return n;
}

export type PartnerProgress =
  | { kind: 'granted' } | { kind: 'ranked' }
  | { kind: 'missing'; profitMonthsNeeded: number; trust: number; trustNeeded: 75 };

/** Liczby do paska statusu: ile miesięcy z zyskiem jeszcze brakuje i jakie jest zaufanie w sklepie startowym. */
export function partnerProgress(f: FirmState): PartnerProgress {
  if (f.person.partner) return { kind: 'granted' };
  if (f.ranked) return { kind: 'ranked' };
  const s = startStore(f).econ;
  return { kind: 'missing', profitMonthsNeeded: PARTNER_MONTHS - profitStreak(s.history), trust: s.tycoon.trust.value, trustNeeded: PARTNER_TRUST };
}

/**
 * Nadaje status, gdy dwa ostatnie zamknięte miesiące sklepu startowego mają zysk, a zaufanie jest co najmniej 75. Hak w
 * `stepFirmMinute` woła ją tylko w minucie, w której sklep startowy zamknął miesiąc, więc zaufanie liczy się „przy zamknięciu”.
 * Status zostaje na stałe; w biegu rankingowym nie przychodzi nigdy.
 */
export function grantPartnerIfDue(f: FirmState, out: FirmStepOut): void {
  if (f.ranked || f.person.partner || f.over !== null) return;
  const s = startStore(f).econ;
  if (profitStreak(s.history) < PARTNER_MONTHS || s.tycoon.trust.value < PARTNER_TRUST) return;
  f.person.partner = true;
  out.firm.push({ kind: 'partner' });
}

// --- Stan lokalu na mapie ----------------------------------------------------------------------------------------

/** Lokal obok sklepu niestartowego zależy tylko od seeda i lokalu, więc liczy się raz na miasto (UI pyta o każdy lokal). */
const neighbours = new WeakMap<CityState, Map<number, number | null>>();

/**
 * Lokal, który sklep zajmie remontem „dokupienie lokalu obok” (§7.2). Sklep startowy: `neighbourLotId` miasta. Pozostałe: sąsiad po
 * stronie z `takeoverSide` układu poziomu 0 (po remoncie układ jest większy, a miasto ma tę samą stronę).
 */
function neighbourOf(f: FirmState, st: FirmStore): number | null {
  if (st.lotId === f.city.startLotId) return f.city.neighbourLotId;
  let byLot = neighbours.get(f.city);
  if (!byLot) neighbours.set(f.city, byLot = new Map());
  if (!byLot.has(st.lotId)) {
    const seed = storeSeedFor(f.seed, st.lotId);
    const side = takeoverSide(layoutFor(seed, 0, lotById(f.city, st.lotId).spec), seed);
    byLot.set(st.lotId, side === null ? null : lotNeighbour(f.city, st.lotId, side)?.id ?? null);
  }
  return byLot.get(st.lotId) ?? null;
}

/**
 * Stan lokalu w grze: własny sklep `twoj` (zamknięty `po-traszce`), budowa `budowa`, lokal obok otwartego sklepu `obok` do pierwszego
 * remontu, a potem `twoj`; reszta ze stanu z generatora. Generator oznacza `obok` i `twoj` względem sklepu startowego, więc gdy
 * ten sklep jest zamknięty, jego sąsiad wraca do `zajety`.
 */
export function lotState(f: FirmState, lotId: number): LotState {
  const own = f.stores.find((s) => s.lotId === lotId);
  if (own) return own.closed ? 'po-traszce' : 'twoj';
  if (f.builds.some((b) => b.lotId === lotId)) return 'budowa';
  for (const st of openStores(f)) {
    if (neighbourOf(f, st) === lotId) return st.econ.remontLevel < 1 ? 'obok' : 'twoj';
  }
  const generated = lotById(f.city, lotId).state;
  return generated === 'obok' || generated === 'twoj' ? 'zajety' : generated;
}

// --- Wynajem lokalu ----------------------------------------------------------------------------------------------

/**
 * Powód odmowy wynajmu albo null, po kolei: koniec gry, ranked, brak statusu, limit sklepów (otwarte plus budowy), lokal niewolny,
 * gotówka (po zapłacie nie mniej niż zero), rata ponad limit nowego sklepu (bez historii, zaufanie startowe: 35% × 25 tys. zł).
 */
export function rentRefusal(f: FirmState, lotId: number, pay: 'gotowka' | 'raty'): FirmRefusal | null {
  if (f.over !== null || activeStore(f).econ.gameOver) return 'over';
  if (f.ranked) return 'ranked';
  if (!f.person.partner) return 'status';
  if (openStores(f).length + f.builds.length >= MAX_STORES) return 'limit';
  const lot = f.city.lots[lotId];
  if (!lot || lot.id !== lotId || lotState(f, lotId) !== 'wolny') return 'lot';
  if (pay === 'gotowka' && f.person.wallet - lot.package < 0) return 'gotowka';
  if (pay === 'raty' && planFor(lot.package).monthly > installmentLimit([], TRUST.start)) return 'raty';
  return null;
}

/** Wynajem: za gotówkę pakiet schodzi z portfela od razu (i idzie do podsumowania sieci), na raty dopiero przy otwarciu sklepu. */
function rentLot(f: FirmState, lotId: number, pay: 'gotowka' | 'raty', out: FirmStepOut): FirmCommandResult {
  const reason = rentRefusal(f, lotId, pay);
  if (reason !== null) return refuse(reason);
  const lot = lotById(f.city, lotId);
  const readyDay = dayOf(activeStore(f).econ.minute) + lot.buildDays;
  if (pay === 'gotowka') {
    f.person.wallet -= lot.package;
    f.monthInvest += lot.package;
  }
  f.builds.push({ lotId, readyDay, price: lot.package, pay });
  out.firm.push({ kind: 'build', params: { lotId, readyDay, price: lot.package, pay } });
  syncWallet(f);
  return { ok: true };
}

/**
 * Otwiera budowy, których dzień odbioru już wybił `OPEN_FROM` (hak na początku minuty firmy, przed krokiem sklepów, więc nowy sklep
 * liczy się od tej samej minuty co reszta). Rata pakietu ląduje w rozliczeniu nowego sklepu, jak każda rata w SIM 6.
 */
export function openDueBuilds(f: FirmState, out: FirmStepOut): void {
  if (f.builds.length === 0) return;
  const minute = activeStore(f).econ.minute;
  const due = f.builds.filter((b) => b.readyDay * MINUTES_PER_DAY + OPEN_FROM <= minute);
  if (due.length === 0) return;
  f.builds = f.builds.filter((b) => !due.includes(b));
  for (const b of due) {
    const st = openStoreAt(f, b.lotId, minute);
    if (b.pay === 'raty') {
      const lot = lotById(f.city, b.lotId);
      const plan = planFor(b.price);
      const fr = st.econ.franchisee;
      fr.installments.push({
        id: fr.nextInstallmentId++, label: `Adaptacja lokalu: ul. ${lot.street} ${lot.number}`, price: b.price, fee: plan.fee,
        total: plan.total, monthly: plan.monthly, paid: 0, months: plan.months,
      });
    }
    out.firm.push({ kind: 'opened', storeId: st.id, params: { lotId: b.lotId } });
  }
}

// --- Przełączanie ------------------------------------------------------------------------------------------------

/** Natychmiastowe, także w pauzie i przy karcie. Siły franczyzobiorcy idą za nim: nowy aktywny sklep dostaje kopię zmęczenia poprzedniego. */
export function switchStore(f: FirmState, storeId: number): FirmCommandResult {
  if (f.over !== null) return refuse('over');
  const to = f.stores.find((s) => s.id === storeId);
  if (!to || to.closed) return refuse('store');
  if (to.id === f.activeId) return { ok: true };
  to.econ.tycoon.fatigue = structuredClone(activeStore(f).econ.tycoon.fatigue);
  f.activeId = to.id;
  return { ok: true };
}

// --- Wypowiedzenie -----------------------------------------------------------------------------------------------

/**
 * Wypowiedzenie umowy sklepu przez gracza (§13.2): sklep działa do końca następnego miesiąca, potem rozliczenie końcowe (`closeStore`).
 * Bez innego otwartego sklepu bez wypowiedzenia nie ma czego wypowiadać (`single`); sklep nieznany, zamknięty albo już wypowiedziany
 * to `store`.
 */
function terminateStore(f: FirmState, storeId: number, out: FirmStepOut): FirmCommandResult {
  if (f.over !== null || activeStore(f).econ.gameOver) return refuse('over');
  const st = f.stores.find((s) => s.id === storeId);
  if (!st || st.closed) return refuse('store');
  // musi zostać choć jeden otwarty sklep bez wypowiedzenia: dwa wypowiedzenia naraz kończyłyby grę rozliczeniem, którego §13.4 nie zna
  if (!openStores(f).some((s) => s.id !== storeId && s.notice === null)) return refuse('single');
  if (st.notice !== null) return refuse('store');
  const endDay = noticeEndDay(dayOf(activeStore(f).econ.minute));
  st.notice = { endDay };
  out.firm.push({ kind: 'notice', storeId, params: { endDay } });
  return { ok: true };
}

/**
 * Polecenie gracza na poziomie firmy. Odmowa nie rusza stanu i nie rzuca; zdarzenia firmy trafiają do `out.firm`. Polecenie jest
 * kopiowane raz na początku (obiekt z getterem nie da innego `type` przy walidacji i w gałęzi). Zły kształt dostaje `lot` (wynajem)
 * albo `store`: `FirmRefusal` nie ma osobnego powodu, a przez typowany interfejs taki kształt nie przejdzie.
 */
export function applyFirmCommand(f: FirmState, cmd: FirmCommand, out: FirmStepOut): FirmCommandResult {
  const c: unknown = typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) ? { ...cmd } : cmd;
  if (!isFirmCommand(c)) return refuse((c as Fields | null)?.type === 'rentLot' ? 'lot' : 'store');
  switch (c.type) {
    case 'rentLot': return rentLot(f, c.lotId, c.pay, out);
    case 'switchStore': return switchStore(f, c.storeId);
    case 'terminateStore': return terminateStore(f, c.storeId, out);
    default: {
      const unreachable: never = c;
      void unreachable;
      return refuse('store');
    }
  }
}

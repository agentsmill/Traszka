import { isRec, num, whole } from '@/sim/guards';
import { GUARANTEE, INSTALLMENTS, OWN_COSTS, REMANENT } from './catalog';
import { isLastDayOfMonth } from './calendar';
import { monthIndexOf } from './tycoon/time';
import { WUT_REASONS, type WutReason } from './tycoon/wut';

/*
 * Rozliczenie franczyzobiorcy z Centralą (SIM_VERSION 6, spec „prawdziwy model rozliczeń”): trzy kieszenie. Marża i premie Centrali
 * narastają na saldzie, które przychodzi przelewem przy zamknięciu miesiąca; z przelewu Centrala potrąca raty, palety i nadwyżkę
 * z remanentu, a franczyzobiorca płaci z niego własne koszty (płace, media, ZUS, VAT, księgowa). Gotówka to jego pieniądze.
 *
 * Wszystko w tym bloku należy do osoby, a nie do sklepu: ulepszenia zostają w sklepie, raty i rozliczenie remanentu idą za
 * franczyzobiorcą (`outstandingDebt` czeka na rozliczenie końcowe przyszłego rogalika). Moduł ma same czyste funkcje i typy; zmiany
 * stanu w minucie gry robi `economy.ts`.
 */

/** Naliczenia bieżącego miesiąca do wyciągu (zł). Saldo u Centrali to `margin + bonus`. */
export interface SettleMonth {
  /** Marża ze sprzedaży (półki i strefa hot). */
  margin: number;
  /** Premie Centrali: KPI tygodnia, złote palety, premie z kart, premia od obrotu (dopisana przy zamknięciu). */
  bonus: number;
  /** Opłaty za palety ponad darmowe i koszty logistyki z kart (potrącenie). */
  pallets: number;
  /** Płace i media naliczone co wieczór, płacone przy zamknięciu. */
  wages: number;
  media: number;
}

/** Ulepszenie, sprzęt albo remont kupiony na raty: Centrala potrąca `monthly` z kolejnych przelewów, aż spłaci `total`. */
export interface Installment {
  id: number;
  /** Co kupiono (nazwa do wyciągu i paska). */
  label: string;
  /** Cena za gotówkę i opłata za finansowanie (zł). */
  price: number;
  fee: number;
  /** Do spłaty razem (`price + fee`), rata miesięczna i ile już potrącono. */
  total: number;
  monthly: number;
  paid: number;
  months: number;
}

/** Protokół remanentu: ubytki z okresu wg przyczyn, limit Centrali i nadwyżka do potrącenia. */
export interface RemanentProtocol {
  /** Dzień remanentu i dzień, od którego liczył się okres (poprzedni remanent albo start gry). */
  day: number;
  fromDay: number;
  /** Obrót w okresie (zł): od niego liczy się limit. */
  revenue: number;
  byReason: Record<WutReason, number>;
  total: number;
  limit: number;
  /** Nadwyżka ponad limit, potrącana z najbliższego przelewu (zaokrąglona do złotówki). */
  charge: number;
  /** Pierwszy remanent franczyzobiorcy: wtedy poznaje limit. */
  first: boolean;
}

export interface RemanentState {
  /** Obrót od ostatniego remanentu. */
  revenue: number;
  /** Dzień, od którego liczy się bieżący okres. */
  fromDay: number;
  /** Dzień następnego remanentu (o `REMANENT.at`). */
  nextDay: number;
  /** Czy franczyzobiorca zna już limit Centrali (po pierwszym remanencie). */
  known: boolean;
  /** Nadwyżka z remanentu, która czeka na najbliższy przelew. */
  pending: number;
  last: RemanentProtocol | null;
}

export interface FranchiseeState {
  month: SettleMonth;
  installments: Installment[];
  nextInstallmentId: number;
  remanent: RemanentState;
}

/** Wyciąg od Centrali za miesiąc: przelew, potrącenia, koszty franczyzobiorcy i co z tego zostaje. Kwoty w zł. */
export interface Statement {
  margin: number;
  bonus: number;
  guarantee: number;
  transfer: number;
  installments: number;
  pallets: number;
  remanent: number;
  deductions: number;
  wages: number;
  media: number;
  zus: number;
  vat: number;
  accounting: number;
  costs: number;
  /** „Zostaje Ci”: przelew minus potrącenia minus koszty. Tyle wchodzi do gotówki przy zamknięciu (może być ujemne). */
  net: number;
  /** Wynik miesiąca bez rat (inwestycja, jak zakup za gotówkę): do historii, komentarza i rankingu. */
  result: number;
  /** Gotówka w miesiącu poza wyciągiem: zakupy za gotówkę i rekrutacja, mandaty, inne przychody i koszty (ze znakiem). */
  spent: number;
  fines: number;
  other: number;
  /** Gotówka po zamknięciu. */
  cashAfter: number;
  /** Miesiąc wejścia nowych zasad (zapis sprzed SIM_VERSION 6): przelew i naliczenia tylko od chwili migracji. */
  partial: boolean;
}

export const emptySettleMonth = (): SettleMonth => ({ margin: 0, bonus: 0, pallets: 0, wages: 0, media: 0 });

/** Saldo u Centrali: marża i premie naliczone w tym miesiącu (przyjdą przelewem przy zamknięciu). */
export const saldoOf = (f: FranchiseeState): number => f.month.margin + f.month.bonus;

/**
 * Dzień najbliższego remanentu od dnia `day` (`afterAt`: czy godzina remanentu tego dnia już minęła). Remanent wypada ostatniego dnia
 * co trzeciego miesiąca gry (listopad, luty, maj, sierpień…), pierwszy przy końcu gwarancji. Pętla po dniach: najwyżej ok. 92 kroki.
 */
export function remanentDayFrom(day: number, afterAt: boolean): number {
  for (let d = afterAt ? day + 1 : day; ; d++) {
    if (isLastDayOfMonth(d) && (monthIndexOf(d) + 1) % REMANENT.everyMonths === 0 && monthIndexOf(d) + 1 >= GUARANTEE.months) return d;
  }
}

export function createFranchisee(minute: number, revenueSoFar = 0): FranchiseeState {
  const day = Math.floor(minute / 1440);
  return {
    month: emptySettleMonth(),
    installments: [],
    nextInstallmentId: 1,
    remanent: {
      revenue: revenueSoFar, fromDay: day, nextDay: remanentDayFrom(day, minute - day * 1440 > REMANENT.at), known: false, pending: 0, last: null,
    },
  };
}

// --- Raty -------------------------------------------------------------------------------------------------

export interface InstallmentPlan { months: number; feeShare: number; fee: number; total: number; monthly: number }

/** Plan rat dla ceny `price`: liczba rat i opłata z `INSTALLMENTS.plans`, rata zaokrąglona w górę (ostatnia wyrównuje resztę). */
export function planFor(price: number): InstallmentPlan {
  const p = INSTALLMENTS.plans.find((x) => price <= x.upTo) ?? INSTALLMENTS.plans[INSTALLMENTS.plans.length - 1]!;
  const fee = Math.round(price * p.fee);
  const total = price + fee;
  return { months: p.months, feeShare: p.fee, fee, total, monthly: Math.ceil(total / p.months) };
}

/** Rata do potrącenia w najbliższym przelewie (ostatnia jest mniejsza o zaokrąglenia). */
export const dueOf = (r: Installment): number => Math.max(0, Math.min(r.monthly, r.total - r.paid));

/** Suma rat w najbliższym przelewie. */
export const installmentsDue = (f: FranchiseeState): number => f.installments.reduce((n, r) => n + dueOf(r), 0);

/** Mnożnik limitu rat z zaufania Centrali (`INSTALLMENTS.trust`): poniżej 25 Centrala nie finansuje. */
export const trustCreditMult = (trust: number): number => (INSTALLMENTS.trust.find((t) => trust >= t.from) ?? { mult: 0 }).mult;

/**
 * Limit rat (suma rat w miesiącu): `limitShare` przelewu bazowego razy mnożnik zaufania. Przelew bazowy to średni przelew z ostatnich
 * (najwyżej trzech) zamkniętych miesięcy z przelewem w historii; bez nich przychód gwarantowany („Centrala liczy limit od gwarancji”).
 */
export function installmentLimit(history: readonly { transfer?: number }[], trust: number): number {
  const recent = history.filter((h) => typeof h.transfer === 'number').slice(-3);
  const base = recent.length > 0 ? recent.reduce((n, h) => n + h.transfer!, 0) / recent.length : GUARANTEE.income;
  return Math.floor(INSTALLMENTS.limitShare * Math.max(0, base) * trustCreditMult(trust));
}

/** Potrąca raty z przelewu: każda spłaca swoją ratę, spłacone wypadają z listy. Zwraca sumę potrąceń. */
export function payInstallments(f: FranchiseeState): number {
  let sum = 0;
  for (const r of f.installments) {
    const due = dueOf(r);
    r.paid += due;
    sum += due;
  }
  f.installments = f.installments.filter((r) => r.paid < r.total);
  return sum;
}

/** Ile franczyzobiorca wisi Centrali poza bieżącym miesiącem: niespłacone raty i nadwyżka z remanentu (do rozliczenia końcowego). */
export const outstandingDebt = (f: FranchiseeState): number =>
  f.installments.reduce((n, r) => n + r.total - r.paid, 0) + f.remanent.pending;

// --- Wyciąg ----------------------------------------------------------------------------------------------

/** VAT od przelewu (`OWN_COSTS.vatShare`, uproszczenie: kwota jak w relacjach franczyzobiorców, bez mechanizmu rozliczenia). */
export const vatOf = (transfer: number): number => Math.round(OWN_COSTS.vatShare * Math.max(0, transfer));

export interface StatementInput {
  month: SettleMonth;
  guarantee: number;
  installments: number;
  remanent: number;
  /** Gotówka w miesiącu poza wyciągiem (liczniki miesiąca): inwestycje za gotówkę, mandaty, inne ze znakiem. */
  spent: number;
  fines: number;
  other: number;
  /** Gotówka tuż przed przelewem. */
  cashBefore: number;
  partial: boolean;
}

/** Wyciąg z naliczeń miesiąca. Jedno miejsce tej arytmetyki: zamknięcie miesiąca, prognoza paska i podgląd liczą przez nie. */
export function buildStatement(i: StatementInput): Statement {
  const m = i.month;
  const transfer = m.margin + m.bonus + i.guarantee;
  const deductions = i.installments + m.pallets + i.remanent;
  const vat = vatOf(transfer);
  const costs = m.wages + m.media + OWN_COSTS.zus + OWN_COSTS.accounting + vat;
  const net = transfer - deductions - costs;
  return {
    margin: m.margin, bonus: m.bonus, guarantee: i.guarantee, transfer,
    installments: i.installments, pallets: m.pallets, remanent: i.remanent, deductions,
    wages: m.wages, media: m.media, zus: OWN_COSTS.zus, vat, accounting: OWN_COSTS.accounting, costs,
    net, result: net + i.installments + i.other - i.fines,
    spent: i.spent, fines: i.fines, other: i.other, cashAfter: i.cashBefore + net, partial: i.partial,
  };
}

// --- Zapis -----------------------------------------------------------------------------------------------

const MAX_MONEY = 1e12;
const money = (v: unknown, fallback = 0): number => num(v, fallback, -MAX_MONEY, MAX_MONEY);
const plus = (v: unknown): number => num(v, 0, 0, MAX_MONEY);

function installment(raw: unknown): Installment | null {
  if (!isRec(raw)) return null;
  const total = plus(raw.total);
  const monthly = plus(raw.monthly);
  if (!(total > 0) || !(monthly > 0)) return null;
  return {
    id: whole(raw.id, 0, 0, 1e9), label: typeof raw.label === 'string' ? raw.label.slice(0, 80) : 'Raty', price: plus(raw.price),
    fee: plus(raw.fee), total, monthly, paid: num(raw.paid, 0, 0, total), months: whole(raw.months, 1, 1, 120),
  };
}

function protocol(raw: unknown): RemanentProtocol | null {
  if (!isRec(raw)) return null;
  const by = isRec(raw.byReason) ? raw.byReason : {};
  const byReason = Object.fromEntries(WUT_REASONS.map((r) => [r, plus(by[r])])) as Record<WutReason, number>;
  return {
    day: whole(raw.day, 0, 0, 1e7), fromDay: whole(raw.fromDay, 0, 0, 1e7), revenue: plus(raw.revenue), byReason, total: plus(raw.total),
    limit: plus(raw.limit), charge: plus(raw.charge), first: raw.first === true,
  };
}

/**
 * Blok franczyzobiorcy z zapisu. Zapis sprzed SIM_VERSION 6 nie ma go wcale: wtedy saldo i naliczenia są zerowe (marża, płace i media
 * sprzed migracji przeszły już przez gotówkę), rat nie ma, a okres remanentu zaczyna się od obrotu bieżącego miesiąca (jego ubytki
 * już są w liczniku).
 */
export function sanitizeFranchisee(raw: unknown, minute: number, monthRevenue: number): FranchiseeState {
  const fresh = createFranchisee(minute, monthRevenue);
  if (!isRec(raw)) return fresh;
  const m = isRec(raw.month) ? raw.month : {};
  const r = isRec(raw.remanent) ? raw.remanent : {};
  const installments = Array.isArray(raw.installments)
    ? raw.installments.map(installment).filter((x): x is Installment => x !== null).slice(0, 64)
    : [];
  const day = Math.floor(minute / 1440);
  return {
    month: { margin: money(m.margin), bonus: money(m.bonus), pallets: money(m.pallets), wages: plus(m.wages), media: plus(m.media) },
    installments,
    nextInstallmentId: Math.max(whole(raw.nextInstallmentId, 1, 1, 1e9), 1 + Math.max(0, ...installments.map((x) => x.id))),
    remanent: {
      revenue: plus(r.revenue),
      fromDay: whole(r.fromDay, fresh.remanent.fromDay, 0, day),
      nextDay: whole(r.nextDay, fresh.remanent.nextDay, day, day + 400),
      known: r.known === true,
      pending: plus(r.pending),
      last: protocol(r.last),
    },
  };
}

const STATEMENT_FIELDS = [
  'margin', 'bonus', 'guarantee', 'transfer', 'installments', 'pallets', 'remanent', 'deductions', 'wages', 'media', 'zus', 'vat',
  'accounting', 'costs', 'net', 'result', 'spent', 'fines', 'other', 'cashAfter',
] as const satisfies readonly (keyof Statement)[];

/** Wyciąg z zapisu (raport miesiąca). Raporty sprzed SIM_VERSION 6 go nie mają: `null`. */
export function sanitizeStatement(raw: unknown): Statement | null {
  if (!isRec(raw)) return null;
  // kolejność pól jak w `buildStatement`, żeby raport wracał z zapisu bajt w bajt
  const out = {} as Statement;
  for (const k of STATEMENT_FIELDS) out[k] = money(raw[k]);
  out.partial = raw.partial === true;
  return out;
}

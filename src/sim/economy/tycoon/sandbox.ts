import { hashString } from '@/sim/rng';
import {
  CAT_INFO, DELIVERY_AT, FINE_BASE, FINE_PER_PALLET, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HOT, HOT_MARGIN_PER_CUSTOMER,
  HOT_REVENUE_PER_CUSTOMER, HOUR_CURVE, ITEMS_PER_CUSTOMER, MARGIN_PER_CUSTOMER, MEDIA_PER_DAY, MINUTES_PER_DAY, OPEN_FROM,
  OPEN_TO, PALLET_ITEMS, PATIENCE, RESTOCK_RATE, REVENUE_PER_CUSTOMER, SCO_ACCEPT, SCO_RATE, SHELF_MARGIN_PER_CUSTOMER,
  SHELF_REVENUE_PER_CUSTOMER, TILL_RATE, UNLOAD_AT, UNLOAD_RATE, WAGE_PER_DAY,
} from '../catalog';
import { rand01 } from '../rand';
import type { BotCommand, BotEnv, BotView } from './bots';
import {
  cardsBlocking, closeCardsMonth, cardModifiers, drawDayCards, pruneCardMods, resolveCard, visibleCards, type CardContext,
  type CardOutcome,
} from './cards';
import { CH } from './channels';
import {
  cleanHall, cleaningDemand, cleanlinessEffects, closeHallMonth, rollWeather, sampleHall, soilHall,
} from './cleanliness';
import { closeFatigueMonth, fatigueNight, tap, tapCost, tapItems } from './fatigue';
import { closeKpiMonth, closeKpiWeek, type KpiMetrics, type KpiScale } from './kpi';
import { buildMonthReport, type TycoonMonthReport } from './report';
import {
  NO_ROBOTS, closeStaffDay, closeStaffMonth, restockDemand, serveTill, setStaffProfile, stepStaff, tillDemand, unloadDemand,
  zeroTasks, type RobotFleet,
} from './staff';
import { applyCardOutcome, createTycoon, type TycoonState } from './state';
import { TRUST, addTrust, closeTrustMonth, trustTerminates, turnoverBonusShare } from './trust';
import {
  dateOfGameDay, dayOfMinute, daysLeftInMonth, isMonthEnd, isOpenMinute, minuteInDay, monthIndexOf, weekdayOf,
} from './time';
import { dayTrafficMult } from './sunday';
import { addWaste, closeWasteMonth, hallObstacle, palletBags, removeWaste, settleWaste, wasteDemand, wasteMinute, wasteSpots } from './waste';
import { closeWutMonth, wutFromSales, wutFromSco, wutSlack } from './wut';

/**
 * Makieta sklepu: najprostszy sklep, w którym da się puścić wszystkie moduły tycoona naraz i porównać boty, zanim
 * część 2 podepnie je do `economy.ts`. Liczby bierze z `catalog.ts` (kasa, rozładunek, wykładanie, koszyk, koszty), ale
 * towar jest jedną pulą sztuk, a nie siedmioma kategoriami, i nie ma zamówień, ulepszeń ani remontów. To nie jest
 * druga ekonomia gry: służy do testów modułów i jest wzorcem kolejności wywołań w minucie dla integracji.
 */

export interface SandboxConfig {
  seed: string;
  /** Klientów na godzinę przy krzywej 1 i reputacji 50. */
  baseTraffic: number;
  staff: number;
  tills: number;
  sco: number;
  shelfCap: number;
  backroomCap: number;
  /** Miejsca na palety na zapleczu (wspólne z workami śmieci). */
  backroomSpots: number;
  robots: RobotFleet;
}

export const SANDBOX_DEFAULT: SandboxConfig = {
  seed: 'makieta', baseTraffic: 30, staff: 2, tills: 1, sco: 0, shelfCap: 2250, backroomCap: 1500, backroomSpots: 3,
  robots: NO_ROBOTS,
};

const CURVE_SUM = Object.values(HOUR_CURVE).reduce((n, v) => n + v, 0);

/** Typowy dzień sklepu o danym ruchu (skala kart i KPI). */
export function sandboxScale(cfg: SandboxConfig): KpiScale & { dailyRevenue: number } {
  const dailyCustomers = cfg.baseTraffic * CURVE_SUM;
  return { dailyCustomers, dailyMargin: dailyCustomers * MARGIN_PER_CUSTOMER, dailyRevenue: dailyCustomers * REVENUE_PER_CUSTOMER };
}

interface SbPallet { id: number; items: number; loc: 'sidewalk' | 'backroom'; since: number; bags: number }

interface SbMonth {
  revenue: number; margin: number; bonuses: number; other: number; wages: number; media: number; fee: number; fines: number;
  wut: number; logistics: number; customers: number; lost: number;
}
const emptyMonth = (): SbMonth => ({
  revenue: 0, margin: 0, bonuses: 0, other: 0, wages: 0, media: 0, fee: 0, fines: 0, wut: 0, logistics: 0, customers: 0, lost: 0,
});

export interface SandboxState {
  cfg: SandboxConfig;
  seedHash: number;
  minute: number;
  cash: number;
  reputation: number;
  ogonki: number;
  queue: number;
  arrivalAcc: number;
  shelf: number;
  backroom: number;
  pallets: SbPallet[];
  nextPalletId: number;
  lastFineAt: number;
  month: SbMonth;
  /** Liczniki narastające (KPI tygodnia liczy z nich postęp). */
  total: { customers: number; hotSold: number; lost: number; fines: number };
  tycoon: TycoonState;
  reports: TycoonMonthReport[];
  /** Skutki kart do wglądu w testach (najnowsze na końcu, najwyżej 200). */
  outcomes: CardOutcome[];
  /** XP z kart i KPI (makieta nie ma poziomów, tylko liczy). */
  xp: number;
  /** Centrala wypowiedziała umowę (zaufanie na zerze przy zamknięciu miesiąca). */
  terminated: boolean;
}

const repFactor = (rep: number): number => 0.6 + 0.8 * (rep / 100);

function metrics(s: SandboxState): KpiMetrics {
  return { ...s.total, cleanSum: s.tycoon.hall.totalSum, cleanMinutes: s.tycoon.hall.totalMinutes };
}

export function createSandbox(cfg: Partial<SandboxConfig> = {}): SandboxState {
  const c = { ...SANDBOX_DEFAULT, ...cfg };
  const seedHash = hashString(`${c.seed}:tycoon`);
  const scale = sandboxScale(c);
  const total = { customers: 0, hotSold: 0, lost: 0, fines: 0 };
  const s: SandboxState = {
    cfg: c, seedHash, minute: OPEN_FROM, cash: 2000, reputation: 50, ogonki: 0, queue: 0, arrivalAcc: 0,
    shelf: Math.round(c.shelfCap * 0.8), backroom: Math.round(c.backroomCap * 0.35), pallets: [], nextPalletId: 1,
    lastFineAt: -1e9, month: emptyMonth(), total,
    tycoon: createTycoon({
      day: 0, seedHash, weather: rollWeather(seedHash, 0, dateOfGameDay(0).month),
      metrics: { ...total, cleanSum: 0, cleanMinutes: 0 }, scale,
    }),
    reports: [], outcomes: [], xp: 0, terminated: false,
  };
  deliver(s, 2);
  drawCards(s);
  return s;
}

// --- Pieniądze --------------------------------------------------------------------------------------

function book(s: SandboxState, line: keyof SbMonth, amount: number): void {
  s.month[line] += amount;
}

/** Skutek karty: część tycoona księguje `applyCardOutcome`, gotówkę, reputację i Ogonki makieta. */
function applyOutcome(s: SandboxState, o: CardOutcome): void {
  const e = applyCardOutcome(s.tycoon, o);
  s.cash += e.other + e.bonus + e.fine + e.logistics;
  book(s, 'other', e.other);
  book(s, 'bonuses', e.bonus);
  book(s, 'fines', -e.fine);
  book(s, 'logistics', -e.logistics);
  if (e.fine < 0) s.total.fines++;
  s.reputation = Math.min(100, Math.max(0, s.reputation + e.reputation));
  s.ogonki += e.ogonki;
  s.xp += e.xp;
  s.outcomes.push(o);
  if (s.outcomes.length > 200) s.outcomes.splice(0, s.outcomes.length - 200);
}

// --- Towar ------------------------------------------------------------------------------------------

/**
 * Sprzedaż `served` klientów: koszyk z półek (brak to niższa marża i reputacja), strefa hot, WUT od obrotu. `scoShare` to
 * część klientów z kas samoobsługowych: ich „zapomniane” skany idą do WUT (kradzieże), nie obcinają marży od razu.
 */
function sell(s: SandboxState, served: number, scoShare = 0): void {
  if (served <= 0) return;
  const want = served * ITEMS_PER_CUSTOMER;
  const got = Math.min(want, s.shelf);
  s.shelf -= got;
  const share = want > 0 ? got / want : 1;
  const mods = cardModifiers(s.tycoon.cards, s.minute);
  const margin = served * (SHELF_MARGIN_PER_CUSTOMER * share + HOT_MARGIN_PER_CUSTOMER) * mods.margin;
  const revenue = served * (SHELF_REVENUE_PER_CUSTOMER * share + HOT_REVENUE_PER_CUSTOMER);
  s.cash += margin;
  book(s, 'margin', margin);
  book(s, 'revenue', revenue);
  book(s, 'customers', served);
  s.total.customers += served;
  s.total.hotSold += served * HOT.chance;
  wutFromSales(s.tycoon.wut, revenue);
  wutFromSco(s.tycoon.wut, revenue * scoShare);
  const clean = cleanlinessEffects(s.tycoon.hall.cleanliness);
  s.reputation += served * (0.0025 * share - 0.02 * (1 - share) + clean.repPerCustomer);
  s.reputation = Math.min(100, Math.max(0, s.reputation));
}

/** Zdejmuje z palety do `items` sztuk: na zaplecze, a gdy pełne, na półki. Rozładowana paleta zostawia worki. */
function unload(s: SandboxState, p: SbPallet, items: number): number {
  const room = Math.max(0, s.cfg.backroomCap - s.backroom) + Math.max(0, s.cfg.shelfCap - s.shelf);
  const n = Math.max(0, Math.min(items, p.items, room));
  const toBack = Math.min(n, Math.max(0, s.cfg.backroomCap - s.backroom));
  s.backroom += toBack;
  s.shelf += n - toBack;
  p.items -= n;
  if (p.items < 0.5) {
    s.pallets = s.pallets.filter((x) => x !== p);
    addWaste(s.tycoon.waste, p.bags, wasteRoom(s));
  }
  return n;
}

/** Miejsca na zapleczu, których nie zajmują palety (worki dzielą je z paletami). */
const wasteRoom = (s: SandboxState): number => s.cfg.backroomSpots - s.pallets.filter((p) => p.loc === 'backroom').length;

const unloadRate = (p: SbPallet): number => UNLOAD_RATE * UNLOAD_AT[p.loc];
/** Kolejność rozładunku: najpierw chodnik (mandat), potem zaplecze; starsze najpierw. */
const unloadOrder = (s: SandboxState): SbPallet[] =>
  [...s.pallets].sort((a, b) => (a.loc === b.loc ? a.since - b.since || a.id - b.id : a.loc === 'sidewalk' ? -1 : 1));

function deliver(s: SandboxState, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = s.nextPalletId++;
    // co trzecia paleta to głównie napoje w folii zgrzewek: dwa worki
    const drinks = id % 3 === 0 ? 0.5 : CAT_INFO.napoje.basket;
    const bags = palletBags({ napoje: drinks * PALLET_ITEMS, nabial: (1 - drinks) * PALLET_ITEMS });
    const free = wasteRoom(s) - wasteSpots(s.tycoon.waste);
    s.pallets.push({ id, items: PALLET_ITEMS, loc: free > 0 ? 'backroom' : 'sidewalk', since: s.minute, bags });
  }
  settleWaste(s.tycoon.waste, wasteRoom(s));
}

/** Dostawa uzupełnia sklep do ~95% pojemności (półki i zaplecze), bez zamówień i asystenta. */
function morningDelivery(s: SandboxState): void {
  const stock = s.shelf + s.backroom + s.pallets.reduce((n, p) => n + p.items, 0);
  deliver(s, Math.max(0, Math.round((0.95 * (s.cfg.shelfCap + s.cfg.backroomCap) - stock) / PALLET_ITEMS)));
}

// --- Karty ------------------------------------------------------------------------------------------

function cardContext(s: SandboxState): CardContext {
  const day = dayOfMinute(s.minute);
  const scale = sandboxScale(s.cfg);
  return {
    day, now: s.minute, weekday: weekdayOf(day), deliveryToday: true,
    palletsToday: Math.max(1, Math.round(scale.dailyCustomers * ITEMS_PER_CUSTOMER / PALLET_ITEMS)),
    staff: s.cfg.staff, trust: s.tycoon.trust.value, cleanliness: s.tycoon.hall.cleanliness,
    sidewalkPallets: s.pallets.filter((p) => p.loc === 'sidewalk').length, weather: s.tycoon.hall.weather,
    dailyMargin: scale.dailyMargin, dailyRevenue: scale.dailyRevenue,
  };
}

function drawCards(s: SandboxState): void {
  drawDayCards(s.tycoon.cards, cardContext(s), s.seedHash);
}

// --- Minuta -----------------------------------------------------------------------------------------

const patienceOf = (s: SandboxState): number =>
  PATIENCE + cleanlinessEffects(s.tycoon.hall.cleanliness).patience - hallObstacle(s.tycoon.waste);

/**
 * Jedna minuta makiety: kolejność wywołań to wzorzec dla `stepMinute` w części 2 (INTEGRATION.md). Gdy na biurku leży
 * widoczna karta decyzji, gra stoi: minuta nie mija i funkcja zwraca false (jak pętla gry w części 2).
 */
export function stepSandbox(s: SandboxState): boolean {
  const t = s.tycoon;
  if (cardsBlocking(t.cards, s.minute)) return false;
  const mod = minuteInDay(s.minute);
  const day = dayOfMinute(s.minute);

  // 1. nowy dzień: pogoda i karty dnia (karty czekają na odpowiedź gracza); 2. efekty kart po czasie znikają
  if (mod === 0) {
    t.hall.weather = rollWeather(s.seedHash, day, dateOfGameDay(day).month);
    drawCards(s);
  }
  pruneCardMods(t.cards, s.minute);
  if (mod === DELIVERY_AT) morningDelivery(s);

  // 3. klienci (w niedzielę więcej: duże sklepy zamknięte)
  const mods = cardModifiers(t.cards, s.minute);
  const shift = isOpenMinute(mod);
  const open = shift && !mods.closed;
  let arrivals = 0;
  if (open) {
    const lambda = (s.cfg.baseTraffic * (HOUR_CURVE[Math.floor(mod / 60)] ?? 0) / 60) * repFactor(s.reputation) * mods.traffic
      * dayTrafficMult(day);
    s.arrivalAcc += lambda * (0.75 + 0.5 * rand01(s.seedHash, s.minute, CH.sandboxArrivals));
    arrivals = Math.floor(s.arrivalAcc);
    s.arrivalAcc -= arrivals;
    const over = s.queue - Math.max(1, patienceOf(s));
    const lost = arrivals * (over < 0 ? 0 : Math.min(1, 0.35 * (over + 1)));
    s.queue += arrivals - lost;
    if (lost > 0) {
      s.reputation = Math.max(0, s.reputation - lost * 0.03);
      book(s, 'lost', lost);
      s.total.lost += lost;
    }
  } else {
    s.queue = 0;
  }

  // 4. pula ludzi: zapotrzebowanie czterech zadań, przydział, praca
  const till = tillDemand({ queue: open ? s.queue : 0, tills: s.cfg.tills, tillRate: TILL_RATE, sco: s.cfg.sco, scoRate: SCO_RATE, scoAccept: SCO_ACCEPT });
  const room = Math.max(0, s.cfg.backroomCap - s.backroom) + Math.max(0, s.cfg.shelfCap - s.shelf);
  const press = s.cfg.robots.prasa > 0;
  const demand = zeroTasks();
  demand.kasa = till.demand;
  demand.rozladunek = Math.min(unloadDemand(s.pallets.map((p) => ({ items: p.items, rate: unloadRate(p) }))), room / UNLOAD_RATE);
  demand.wykladanie = restockDemand(Math.min(s.cfg.shelfCap - s.shelf, s.backroom), RESTOCK_RATE);
  demand.sprzatanie = wasteDemand(t.waste, press) + cleaningDemand(t.hall);
  const staff = shift ? Math.max(0, s.cfg.staff + mods.staff) : 0;
  const alloc = stepStaff(t.staff, { staff, demand, robots: s.cfg.robots, scoFreed: till.freed });

  // potwierdzenia wieku na SCO biorą minuty z kasy; klient bez potwierdzenia zostaje w kolejce
  const served = serveTill(till, alloc.total.kasa, TILL_RATE);
  s.queue = Math.max(0, s.queue - served.total);
  sell(s, served.total, served.total > 0 ? served.sco / served.total : 0);

  let unloadMin = alloc.total.rozladunek;
  for (const p of unloadOrder(s)) {
    if (unloadMin <= 1e-9) break;
    const use = Math.min(unloadMin, 2, p.items / unloadRate(p));
    unload(s, p, use * unloadRate(p));
    unloadMin -= use;
  }
  const restock = Math.min(alloc.total.wykladanie * RESTOCK_RATE, s.backroom, s.cfg.shelfCap - s.shelf);
  if (restock > 0) { s.backroom -= restock; s.shelf += restock; }
  const sweep = alloc.total.sprzatanie;
  cleanHall(t.hall, sweep - removeWaste(t.waste, sweep, press));

  // 5. brud, śmieci w sali, średnie
  soilHall(t.hall, arrivals, t.waste.hall);
  wasteMinute(t.waste);
  if (open) sampleHall(t.hall);

  // 6. Straż Miejska: palety na chodniku po godzinie tolerancji
  if (mod >= 8 * 60 && mod < 20 * 60) checkFine(s);
  if (mod === OPEN_TO) closeDay(s, day);
  s.minute++;
  return true;
}

/** Zatwierdza odpowiedzi zaznaczone z góry na wszystkich widocznych kartach (bierny gracz; do testów bez bota). */
export function confirmDefaults(s: SandboxState): void {
  for (const c of visibleCards(s.tycoon.cards, s.minute)) applySandboxCommand(s, { type: 'card.answer', seq: c.seq, answer: c.defaultAnswer });
}

/** Minuta makiety z biernym graczem przy kartach: najpierw zatwierdza domyślne, potem minuta mija. */
export function stepPassive(s: SandboxState): void {
  confirmDefaults(s);
  stepSandbox(s);
}

function checkFine(s: SandboxState): void {
  const outside = s.pallets.filter((p) => p.loc === 'sidewalk');
  if (outside.length === 0 || s.minute - s.lastFineAt < 180) return;
  const hours = (s.minute - Math.min(...outside.map((p) => p.since))) / 60;
  if (hours < 1) return;
  if (rand01(s.seedHash, s.minute, CH.sandboxFine) >= 0.0005 * outside.length * (1 + 0.2 * (hours - 1))) return;
  const fine = FINE_BASE + FINE_PER_PALLET * (outside.length - 1);
  s.cash -= fine;
  book(s, 'fines', fine);
  s.total.fines++;
  s.lastFineAt = s.minute;
  s.reputation = Math.max(0, s.reputation - 2);
  addTrust(s.tycoon.trust, 'mandaty', TRUST.fine);
}

function closeDay(s: SandboxState, day: number): void {
  const t = s.tycoon;
  const wages = s.cfg.staff * WAGE_PER_DAY;
  s.cash -= wages + MEDIA_PER_DAY;
  book(s, 'wages', wages);
  book(s, 'media', MEDIA_PER_DAY);
  fatigueNight(t.fatigue);
  closeStaffDay(t.staff);
  if (day === t.kpi.toDay) {
    const r = closeKpiWeek(t.kpi, metrics(s), s.seedHash, day + 1, sandboxScale(s.cfg));
    addTrust(t.trust, 'kpi', r.trust);
    s.cash += r.bonus;
    book(s, 'bonuses', r.bonus);
    s.xp += r.xp;
  }
  if (isMonthEnd(day)) closeMonth(s, day);
}

function closeMonth(s: SandboxState, day: number): void {
  const t = s.tycoon;
  const m = s.month;
  const fee = Math.round(FRANCHISE_FEE_FIXED + FRANCHISE_FEE_SHARE * m.revenue);
  const bonus = Math.round(turnoverBonusShare(t.trust.value) * m.revenue);
  const wut = closeWutMonth(t.wut, m.revenue);
  s.cash += bonus - fee - wut.charge;
  book(s, 'fee', fee);
  book(s, 'bonuses', bonus);
  book(s, 'wut', wut.charge);
  const result = m.margin + m.bonuses + m.other - m.wages - m.media - m.fee - m.fines - m.wut - m.logistics;
  addTrust(t.trust, 'wynik', result > 0 ? TRUST.monthProfit : TRUST.monthLoss);
  // wypowiedzenie dopiero przy zamknięciu miesiąca, po wyniku (decyzja użytkownika): w trakcie miesiąca da się odbić
  if (trustTerminates(t.trust.value)) s.terminated = true;
  const report = buildMonthReport({
    monthIndex: monthIndexOf(day),
    figures: { ...m },
    trust: closeTrustMonth(t.trust),
    cleanlinessAvg: closeHallMonth(t.hall),
    staff: closeStaffMonth(t.staff),
    days: dateOfGameDay(day).date,
    staffCount: s.cfg.staff,
    exhaustedDays: closeFatigueMonth(t.fatigue).exhaustedDays,
    kpi: closeKpiMonth(t.kpi),
    cards: (({ answered, defaults }) => ({ answered, defaults }))(closeCardsMonth(t.cards)),
    marginPerCustomer: MARGIN_PER_CUSTOMER,
  }, s.seedHash);
  closeWasteMonth(t.waste);
  s.reports.push(report);
  s.month = emptyMonth();
}

// --- Polecenia (jak z interfejsu) --------------------------------------------------------------------

export function applySandboxCommand(s: SandboxState, cmd: BotCommand): boolean {
  const t = s.tycoon;
  switch (cmd.type) {
    case 'card.answer': {
      const r = resolveCard(t.cards, cmd.seq, cmd.answer, s.minute, s.seedHash);
      if (r.ok) applyOutcome(s, r.outcome);
      return r.ok;
    }
    case 'staff.profile': return setStaffProfile(t.staff, cmd.profile).ok;
    case 'tap.till': {
      if (!isOpenMinute(minuteInDay(s.minute)) || cardModifiers(t.cards, s.minute).closed || s.queue < 1) return false;
      const r = tap(t.fatigue, 'kasa', cmd.combo);
      if (!r.ok) return false;
      const n = Math.min(s.queue, r.power);
      s.queue -= n;
      sell(s, n);
      return true;
    }
    case 'tap.pallet': {
      const p = unloadOrder(s)[0];
      const room = Math.max(0, s.cfg.backroomCap - s.backroom) + Math.max(0, s.cfg.shelfCap - s.shelf);
      if (!p || room < 1) return false;
      const r = tap(t.fatigue, 'paleta', cmd.combo);
      if (!r.ok) return false;
      unload(s, p, tapItems(r.power));
      return true;
    }
  }
}

export function sandboxView(s: SandboxState): BotView {
  const t = s.tycoon;
  const mod = minuteInDay(s.minute);
  // obrót miesiąca do końca: dotychczasowy plus typowy dzień razy dni, które zostały
  const daysLeft = daysLeftInMonth(dayOfMinute(s.minute)) - mod / MINUTES_PER_DAY;
  const projected = s.month.revenue + sandboxScale(s.cfg).dailyRevenue * daysLeft;
  return {
    minute: s.minute,
    mod,
    open: isOpenMinute(mod) && !cardModifiers(t.cards, s.minute).closed,
    queue: s.queue,
    patience: patienceOf(s),
    sidewalkPallets: s.pallets.filter((p) => p.loc === 'sidewalk').length,
    pallets: s.pallets.length,
    cleanliness: t.hall.cleanliness,
    hallBags: t.waste.hall,
    backroomBags: t.waste.backroom,
    energy: t.fatigue.energy,
    spentToday: t.fatigue.spentToday,
    tapCost: { kasa: tapCost('kasa'), paleta: tapCost('paleta') },
    profile: t.staff.profile,
    cards: visibleCards(t.cards, s.minute),
    wutSlack: wutSlack(t.wut, s.month.revenue, projected),
    trust: t.trust.value,
  };
}

export function sandboxEnv(s: SandboxState): BotEnv {
  return { view: () => sandboxView(s), apply: (cmd) => applySandboxCommand(s, cmd), step: () => stepSandbox(s) };
}

/** Wynik przebiegu do porównań botów. */
export interface SandboxSummary {
  results: number[];
  total: number;
  cash: number;
  trust: number;
  customers: number;
  lost: number;
  fines: number;
  cleanliness: number[];
  hints: string[];
}

export function summarize(s: SandboxState): SandboxSummary {
  return {
    results: s.reports.map((r) => Math.round(r.result)),
    total: Math.round(s.reports.reduce((n, r) => n + r.result, 0)),
    cash: Math.round(s.cash),
    trust: Math.round(s.tycoon.trust.value * 10) / 10,
    customers: Math.round(s.total.customers),
    lost: Math.round(s.total.lost),
    fines: s.total.fines,
    cleanliness: s.reports.map((r) => Math.round(r.cleanlinessAvg)),
    hints: s.reports.map((r) => r.hint.id),
  };
}

/** Pierwsze dwa miesiące gry (wrzesień i październik 2026) od 6:00 pierwszego dnia do raportu za październik. */
export const TWO_MONTHS = 61 * MINUTES_PER_DAY - OPEN_FROM;

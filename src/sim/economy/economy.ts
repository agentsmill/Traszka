import { hashString } from '@/sim/rng';
import {
  BANKRUPTCY_AT, CATS, CAT_INFO, COMBO_WINDOW, CREDIT_LIMIT, DELIVERY_AT, DELIVERY_AT_AFTERNOON, DELIVERY_AT_NIGHT,
  FINE_BASE, FINE_PER_PALLET, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE,
  HIRE_COST, HOT, HOUR_CURVE, ITEMS_PER_CUSTOMER,
  LOT_TRAFFIC, MEDIA_PER_DAY, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, ORDER_DEADLINE, PALLET_FEE, PALLET_ITEMS, PALLETS_FREE, PATIENCE,
  RESTOCK_RATE, RETURN_FEE, SCO_ACCEPT, SCO_RATE, STAFF_MAX, STAFF_START, START_CASH, TILL_RATE, TRAFFIC_PER_SHELF_ITEM,
  TRAFFIC_RANGE, UNLOAD_AT, UNLOAD_RATE, WAGE_PER_DAY, type Cat,
} from './catalog';
import { dayOf, formatMonth, isLastDayOfMonth, isOpenAt, minuteOfDay } from './calendar';
import { FINE_PALLET_POW } from './exactMath';
import { rand01 } from './rand';
import type { PalletLoc, StoreInfo } from './storeInfo';
import {
  EQUIPMENT_BY_ID, REMONTS, UPGRADE_BY_ID, WORKSHOP_LEVEL, equipmentCost, upgradeCost,
  type EquipmentId, type UpgradeDef, type UpgradeId,
} from './upgrades';
import { MILESTONES } from './milestones';
import { XP, levelReward, xpToNext } from './progress';
import {
  cardDef, cardModifiers, cardsBlocking, closeCardsMonth, drawDayCards, fillText, pruneCardMods, resolveCard, type CardContext,
} from './tycoon/cards';
import {
  cleaningDemand, cleanHall, cleanlinessEffects, closeHallMonth, rollWeather, sampleHall, soilHall, type HallState,
} from './tycoon/cleanliness';
import { closeFatigueMonth, fatigueEfficiency, fatigueNight, tap as fatigueTap, tapItems } from './tycoon/fatigue';
import { closeKpiMonth, closeKpiWeek, kpiTitle, type KpiMetrics, type KpiScale, type KpiWeekResult } from './tycoon/kpi';
import { buildMonthReport, reportCommentText, type MonthFigures, type TycoonMonthReport } from './tycoon/report';
import { createShift, peopleOnShift, type ShiftState } from './tycoon/shift';
import {
  PEOPLE_PER_PALLET, allocateStaff, closeStaffDay, closeStaffMonth, normalizePins, restockDemand, serveTill, stepStaff, tillDemand,
  unloadDemand, zeroTasks, type RobotFleet,
} from './tycoon/staff';
import { applyCardOutcome, createTycoon, type TycoonState } from './tycoon/state';
import { dayTrafficMult } from './tycoon/sunday';
import { dateOfGameDay, monthIndexOf, weekdayOf } from './tycoon/time';
import {
  TRUST, addTrust, closeTrustMonth, trustTerminates, trustTier, turnoverBonusShare, type TrustReason, type TrustTier,
} from './tycoon/trust';
import {
  addWaste, closeWasteMonth, hallObstacle, palletBags, removeWaste, settleWaste, wasteDemand, wasteSpots, wasteMinute,
} from './tycoon/waste';
import { closeWutMonth, wutFromSales, wutFromSco } from './tycoon/wut';

// Ekonomia jednego sklepu (spec §6–§8) jako czysta symulacja z krokiem jednej minuty gry. Klienci są modelowani
// zbiorczo (strumień przyjść, kolejka, przepustowość kas), a tłum w 3D to ich obraz, a nie źródło liczb.
// Stan jest zwykłym obiektem JSON, więc zapis gry to JSON.stringify.

export interface Pallet {
  id: number;
  loc: PalletLoc;
  /** Indeks miejsca w `StoreInfo.spots[loc]`. */
  spot: number;
  items: Record<Cat, number>;
  /** Ile sztuk zostało i ile było na początku. */
  total: number;
  initial: number;
  /** Minuta gry, od której paleta stoi w obecnym miejscu. */
  since: number;
  /** Złota paleta: po rozładunku premia (losowa nagroda w dostawie). */
  golden?: boolean;
  /** Worki śmieci po rozładunku (`palletBags` ze składu z dostawy). Palety ze starych zapisów nie mają pola: wtedy jeden worek. */
  bags?: number;
}

export interface Counters {
  customers: number;
  lost: number;
  revenue: number;      // obrót (wartość sprzedanego towaru)
  margin: number;       // przychód franczyzobiorcy z marży i strefy hot
  wages: number;
  media: number;
  fee: number;          // opłata franczyzowa
  fines: number;
  logistics: number;    // opłaty za palety ponad przydział i odesłane palety
  investments: number;  // ulepszenia, sprzęt, remont, rekrutacja
  other: number;        // inne przychody (najem bankomatu, sieć sklepów, nagrody)
  bonus: number;        // premie Centrali (od obrotu miesiąca)
  wut: number;          // opłata za WUT (ubytki) ponad próg
  fineCount: number;    // liczba mandatów (kwoty są w `fines`)
  missingItems: number;
  palletsUnloaded: number;
  taps: number;         // stuknięcia gracza w palety i kasę
  hotSold: number;      // hot-dogi i kawy
  purchases: number;    // kupione ulepszenia i sprzęt
}

export interface Delivery { at: number; count: number }
export interface EquipmentUnit { id: EquipmentId; slot: string | null }

export interface MonthReport {
  label: string;
  counters: Counters;
  profit: number;
  cash: number;
  /** Komentarz Centrali: tekst z `detail.commentId` (`reportCommentText`). Raport ze starego zapisu niesie własny tekst. */
  comment: string;
  /**
   * Szczegóły raportu tycoona (pozycje, zaufanie z przyczynami, czystość, KPI, wskazówka): liczby i identyfikatory, teksty
   * robi interfejs. `null` w raportach ze starych zapisów, sprzed raportu tycoona.
   */
  detail: TycoonMonthReport | null;
}

export interface EconomyState {
  version: 1;
  seed: string;
  seedHash: number;
  minute: number;
  cash: number;
  ogonki: number;
  ogonkiAcc: number;
  reputation: number;
  shelf: Record<Cat, number>;
  backroom: Record<Cat, number>;
  pallets: Pallet[];
  nextPalletId: number;
  order: { auto: boolean; manual: number };
  deliveries: Delivery[];
  staff: number;
  queue: number;
  arrivalAcc: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  equipment: EquipmentUnit[];
  remontLevel: number;
  remontUntil: number | null;
  boostUntil: number;
  lastFineAt: number;
  today: Counters;
  month: Counters;
  total: Counters;
  history: { label: string; profit: number; revenue: number }[];
  /** Ostatni raport miesięczny: okno końca gry (wypowiedzenie umowy) wraca po przeładowaniu strony razem z nim. */
  lastReport: MonthReport | null;
  milestones: string[];
  gameOver: boolean;
  /** Ostatni przydział ludzi w osobominutach (do interfejsu): na kasie, przy paletach, półkach i sprzątaniu. Z `shift.human`. */
  lastCashiers: number;
  lastWorkers: number;
  /** Zmiana w ostatniej wykonanej minucie (tycoon/shift.ts): ilu ludzi i co robili. Z tego `staffOnShift` pokazuje ludzi na ekranie. */
  shift: ShiftState;
  /** Poziom gracza i XP zebrane na obecnym poziomie (progress.ts). */
  level: number;
  xp: number;
  /** Combo stukania w czasie gry (nie zegarem przeglądarki): stuknięcia w serii (0 = brak) i minuta ostatniego udanego. */
  tapStreak: number;
  lastTapAt: number;
  lastDayProfit: number;
  bestDayProfit: number;
  /** Sieć sklepów z poprzednich rozgrywek: punkty partnera (trwała premia) i dochód z sieci na dzień. */
  partner: { points: number; networkIncome: number; stores: number };
  /** Mechaniki tycoona (ludzie, śmieci, czystość, siły, karty, KPI, WUT) i zaufanie Centrali (tycoon/state.ts). */
  tycoon: TycoonState;
}

export type EconEventKind = 'delivery' | 'order' | 'fine' | 'milestone' | 'day' | 'month' | 'remont' | 'info' | 'warning' | 'gameover'
  | 'levelup' | 'golden' | 'trust-tier' | 'card' | 'card-result' | 'kpi-week';
export interface EconEvent { kind: EconEventKind; text: string; report?: MonthReport; level?: number; unlocks?: string[] }

export const emptyCounters = (): Counters => ({
  customers: 0, lost: 0, revenue: 0, margin: 0, wages: 0, media: 0, fee: 0, fines: 0, logistics: 0, investments: 0, other: 0,
  bonus: 0, wut: 0, fineCount: 0, missingItems: 0, palletsUnloaded: 0, taps: 0, hotSold: 0, purchases: 0,
});

const perCat = (f: (c: Cat) => number): Record<Cat, number> => {
  const out = {} as Record<Cat, number>;
  for (const c of CATS) out[c] = f(c);
  return out;
};
const sum = (r: Record<Cat, number>): number => CATS.reduce((n, c) => n + r[c], 0);

// --- Efekty ulepszeń i sprzętu -----------------------------------------------------------------------

export const level = (s: EconomyState, id: UpgradeId): number => s.upgrades[id] ?? 0;

export interface Effects {
  tills: number;
  tillSpeed: number;
  sco: number;
  scoSpeed: number;
  scoAccept: number;
  patience: number;
  unloadMult: number;
  backroomCap: number;
  backroomSpots: number;
  overorder: number;
  deliveryAt: number;
  splitDelivery: boolean;
  rampa: boolean;
  traffic: number;
  hotMult: number;
  fineMult: number;
  humanoid: boolean;
  ogonkiMult: number;
  /** Mnożnik marży (punkty partnera z sieci sklepów). */
  marginMult: number;
}

export function activeEquipment(s: EconomyState, id: EquipmentId): number {
  return s.equipment.filter((e) => e.id === id && e.slot !== null).length;
}

export function effects(s: EconomyState, info: StoreInfo): Effects {
  const floorPallets = s.pallets.filter((p) => p.loc === 'floor').length;
  const regaly = level(s, 'regaly');
  const humanoid = level(s, 'humanoid') > 0;
  return {
    tills: 1 + level(s, 'drugaKasa'),
    tillSpeed: 1 + 0.15 * level(s, 'szkolenie'),
    sco: activeEquipment(s, 'sco'),
    scoSpeed: 1 + 0.15 * level(s, 'scoSoft'),
    scoAccept: Math.min(0.95, SCO_ACCEPT + 0.08 * level(s, 'scoSoft')),
    patience: PATIENCE + 2 * level(s, 'klima') - floorPallets,
    unloadMult: 1 + 0.4 * level(s, 'wozek'),
    backroomCap: Math.round(info.backroomCap * (1 + 0.5 * regaly)),
    backroomSpots: Math.min(info.spots.backroom.length, 2 + regaly + s.remontLevel),
    overorder: [1.3, 1.15, 1.02][level(s, 'asystent')] ?? 1.02,
    deliveryAt: level(s, 'nocne') > 0 ? DELIVERY_AT_NIGHT : DELIVERY_AT,
    splitDelivery: level(s, 'dostawy2') > 0,
    rampa: level(s, 'rampa') > 0,
    traffic: (1 + 0.1 * level(s, 'ulotki') + 0.12 * level(s, 'traszkapka') + 0.04 * activeEquipment(s, 'bankomat')
      + 0.07 * activeEquipment(s, 'paczkownik')) * (1 + 0.1 * s.remontLevel) * (1 + 0.03 * s.partner.points),
    hotMult: 1 + 0.3 * level(s, 'kawa') + 0.4 * activeEquipment(s, 'piec'),
    fineMult: 1 - 0.25 * level(s, 'kamery'),
    humanoid,
    ogonkiMult: 1 + 0.5 * level(s, 'traszkapka'),
    marginMult: 1 + 0.04 * s.partner.points,
  };
}

export const reputationFactor = (rep: number): number => 0.6 + 0.8 * (rep / 100);

/** Klientów na godzinę przy krzywej 1, reputacji 50 i bez marketingu (catalog.ts: TRAFFIC_PER_SHELF_ITEM). */
export function baseTraffic(info: StoreInfo): number {
  const [lo, hi] = TRAFFIC_RANGE;
  return Math.min(hi, Math.max(lo, info.shelfCapTotal * TRAFFIC_PER_SHELF_ITEM)) * LOT_TRAFFIC[info.lotKind];
}

// --- Zaufanie Centrali i liczniki KPI ----------------------------------------------------------------

const NO_KPI_METRICS: KpiMetrics = { customers: 0, hotSold: 0, lost: 0, fines: 0, cleanSum: 0, cleanMinutes: 0 };

/**
 * Zmiana zaufania Centrali z przyczyną (raport miesiąca pokaże, skąd wzrost i spadek). Gdy zmienia się próg, do `out`
 * trafia komunikat `trust-tier`. Zwraca zmianę po miękkich granicach i przycięciu do 0–100.
 */
export function changeTrust(s: EconomyState, reason: TrustReason, delta: number, out?: EconEvent[]): number {
  const before = trustTier(s.tycoon.trust.value);
  const applied = addTrust(s.tycoon.trust, reason, delta);
  announceTrustTier(s, before, out);
  return applied;
}

/** Komunikat `trust-tier`, gdy zaufanie przeszło do innego progu niż `before`. */
function announceTrustTier(s: EconomyState, before: TrustTier, out?: EconEvent[]): void {
  const after = trustTier(s.tycoon.trust.value);
  if (after.id !== before.id) out?.push({ kind: 'trust-tier', text: `Zaufanie Centrali: ${after.label}. ${after.flavor}` });
}

/** Liczniki narastające, od których KPI tygodnia liczy postęp: z liczników gry i z sumy czystości sali. */
export const kpiMetrics = (total: Counters, hall: HallState): KpiMetrics => ({
  customers: total.customers, hotSold: total.hotSold, lost: total.lost, fines: total.fineCount,
  cleanSum: hall.totalSum, cleanMinutes: hall.totalMinutes,
});
export const kpiMetricsOf = (s: EconomyState): KpiMetrics => kpiMetrics(s.total, s.tycoon.hall);

/** Skala sklepu do celów i nagród KPI: oczekiwany ruch, marża dnia i poziom gracza (XP za trafiony cel). */
export const kpiScaleOf = (s: EconomyState, info: StoreInfo): KpiScale => ({
  dailyCustomers: expectedDailyCustomers(s, info), dailyMargin: estimatedDailyMargin(s, info), level: s.level,
});

// --- Tworzenie ---------------------------------------------------------------------------------------

/** Nowa gra: sklep na kreskę (towar Centrali na półkach, 2 palety pod drzwiami), 1 września, 6:00. */
export function createEconomy(seed: string, info: StoreInfo, partner: EconomyState['partner'] = { points: 0, networkIncome: 0, stores: 0 }): EconomyState {
  const backroomStart = info.backroomCap * 0.35;
  const seedHash = hashString(`${seed}:economy`);
  const s: EconomyState = {
    version: 1,
    seed,
    seedHash,
    minute: OPEN_FROM,
    cash: START_CASH,
    ogonki: 0,
    ogonkiAcc: 0,
    reputation: 50,
    shelf: perCat((c) => Math.round(info.shelfCap[c] * 0.8)),
    backroom: perCat((c) => Math.round(backroomStart * CAT_INFO[c].basket)),
    pallets: [],
    nextPalletId: 1,
    order: { auto: true, manual: 4 },
    deliveries: [],
    staff: STAFF_START,
    queue: 0,
    arrivalAcc: 0,
    upgrades: {},
    equipment: [],
    remontLevel: 0,
    remontUntil: null,
    boostUntil: 0,
    lastFineAt: -1e9,
    today: emptyCounters(),
    month: emptyCounters(),
    total: emptyCounters(),
    history: [],
    lastReport: null,
    milestones: [],
    gameOver: false,
    lastCashiers: 1,
    lastWorkers: 1,
    shift: createShift(),
    level: 1,
    xp: 0,
    tapStreak: 0,
    lastTapAt: -1e9,
    lastDayProfit: 0,
    bestDayProfit: 0,
    partner: { ...partner },
    tycoon: createTycoon({ day: 0, seedHash, trust: TRUST.start, metrics: NO_KPI_METRICS, scale: { dailyCustomers: 0, dailyMargin: 0 } }),
  };
  // Cel KPI pierwszego tygodnia zależy od skali sklepu i liczników (kpiScaleOf, kpiMetricsOf czytają gotowy stan), więc
  // właściwy tycoon powstaje po obiekcie bazowym; ten z literału jest tylko zaślepką z czystą salą.
  const day = dayOf(s.minute);
  s.tycoon = createTycoon({
    day, seedHash, trust: TRUST.start, weather: rollWeather(seedHash, day, dateOfGameDay(day).month),
    metrics: kpiMetricsOf(s), scale: kpiScaleOf(s, info),
  });
  const ev: EconEvent[] = [];
  deliver(s, info, 2, ev);
  drawDayCards(s.tycoon.cards, cardContext(s, info), seedHash);   // karty dnia 0 (w stepMinute losują się o północy)
  return s;
}

// --- Krok ----------------------------------------------------------------------------------------------

export const isClosedForRemont = (s: EconomyState): boolean => s.remontUntil !== null && s.minute < s.remontUntil;
export const isStoreOpen = (s: EconomyState): boolean => isOpenAt(minuteOfDay(s.minute)) && !isClosedForRemont(s);
/** Czy do sklepu wolno teraz wejść klientowi: godziny i remont (`isStoreOpen`) oraz karta „zamknij na godzinę”. To rozstrzyga `stepMinute` i `tapTill`. */
export const isOpenForCustomers = (s: EconomyState): boolean => isStoreOpen(s) && !cardModifiers(s.tycoon.cards, s.minute).closed;

/**
 * Czy gra czeka na odpowiedź gracza: widoczna karta decyzji albo okólnik (decyzja użytkownika z 28.10.2026: gra stoi, aż
 * gracz wybierze, także przy ×8). `stepMinute` tego NIE sprawdza i zostaje całkowitą funkcją „minuta dalej” (pętle w testach
 * i narzędziach liczą nią minuty bez klikania w karty). Pauzę wymuszają wołający, każdy po swojemu: `advanceEconomy` (żywa
 * gra), `replayRun` (serwer: karta bez odpowiedzi w dzienniku dostaje zaznaczoną z góry), `skip` (debug) i boty.
 */
export const awaitingDecision = (s: EconomyState): boolean => !s.gameOver && cardsBlocking(s.tycoon.cards, s.minute);

/** Jedna minuta gry. Zdarzenia dla gracza (dostawa, mandat, raport…) trafiają do `out`. */
export function stepMinute(s: EconomyState, info: StoreInfo, out: EconEvent[]): void {
  if (s.gameOver) return;
  const mod = minuteOfDay(s.minute);
  // o północy pogoda dnia (zaczep: później ustawi ją system pogody) i karty dnia z jej wynikiem; dzień 0 ma jedno i drugie z `createEconomy`
  if (mod === 0) {
    s.tycoon.hall.weather = rollWeather(s.seedHash, dayOf(s.minute), dateOfGameDay(dayOf(s.minute)).month);
    drawDayCards(s.tycoon.cards, cardContext(s, info), s.seedHash);
  }
  pruneCardMods(s.tycoon.cards, s.minute);   // efekty kart po czasie znikają (ruch, marża i ludzie czytają je niżej)
  const fx = effects(s, info);
  const open = isOpenForCustomers(s);

  if (s.remontUntil !== null && s.minute >= s.remontUntil) {
    s.remontUntil = null;
    out.push({ kind: 'remont', text: 'Remont zakończony! Sklep otwarty, pachnie nową farbą i starym kurzem.' });
  }

  for (const d of s.deliveries.filter((x) => x.at <= s.minute)) deliver(s, info, d.count, out);
  s.deliveries = s.deliveries.filter((x) => x.at > s.minute);

  let arrivals = 0;
  if (open) arrivals = arrive(s, info, fx);
  else s.queue = 0;
  // ludzie pracują w godzinach otwarcia, także w czasie remontu (wtedy nikt nie stoi na kasie); automatyka całą dobę
  runStaff(s, info, fx, open, out);
  // brud z przyjść i worków w sali, licznik worków, średnia czystości z minut otwarcia
  soilHall(s.tycoon.hall, arrivals, s.tycoon.waste.hall);
  wasteMinute(s.tycoon.waste);
  if (open) sampleHall(s.tycoon.hall);
  if (mod >= 8 * 60 && mod < 20 * 60) checkFine(s, fx, out);
  if (mod === ORDER_DEADLINE) placeOrder(s, info, fx, out);
  if (mod === OPEN_TO) closeDay(s, info, out);
  if (mod % 60 === 0) checkMilestones(s, info, out);
  processLevels(s, out);

  s.minute++;
  // karta, której godzina właśnie nadeszła: gra staje na niej (wołający sprawdzają `awaitingDecision`), a interfejs dostaje sygnał
  for (const c of s.tycoon.cards.pending) if (c.showAt === s.minute) out.push({ kind: 'card', text: cardDef(c.id)?.title ?? '' });
}

/**
 * Oczekiwani klienci w tej minucie (lambda przed losowaniem): krzywa godzin, reputacja, marketing i remont, paczka „szał
 * zakupów”, przeszkody w sali (palety i worki śmieci), niedziela, kiedy duże sklepy stoją zamknięte (tycoon/sunday.ts), oraz
 * ruch z efektów kart (np. +30% przez dwie godziny).
 * Jedyne miejsce, gdzie liczy się ten wzór: korzysta z niego `stepMinute`, a testy i karty pytają o to samo.
 */
export function arrivalRate(s: EconomyState, info: StoreInfo, fx: Effects = effects(s, info)): number {
  const hour = Math.floor(minuteOfDay(s.minute) / 60);
  const floorPallets = s.pallets.filter((p) => p.loc === 'floor').length;
  const boost = s.minute < s.boostUntil ? 1.3 : 1;
  return (baseTraffic(info) * (HOUR_CURVE[hour] ?? 0) / 60) * reputationFactor(s.reputation)
    * fx.traffic * boost * Math.max(0.5, 1 - 0.08 * (floorPallets + hallObstacle(s.tycoon.waste))) * dayTrafficMult(dayOf(s.minute))
    * cardModifiers(s.tycoon.cards, s.minute).traffic;
}

/**
 * Przyjście klientów w jednej minucie; ci, którzy widzą długą kolejkę, rezygnują (spec §6.1). Obsługa idzie przez pulę ludzi
 * (`runStaff`). Zwraca liczbę przyjść z tej minuty (brud sali liczy się od przychodzących, nie od obsłużonych).
 */
function arrive(s: EconomyState, info: StoreInfo, fx: Effects): number {
  s.arrivalAcc += arrivalRate(s, info, fx) * (0.75 + 0.5 * rand01(s.seedHash, s.minute, 1));
  const arrivals = Math.floor(s.arrivalAcc);
  s.arrivalAcc -= arrivals;

  // cierpliwość: ulepszenia i palety w sali (fx), brud sali i worki w sali odejmują się dodatkowo
  const patience = fx.patience + cleanlinessEffects(s.tycoon.hall.cleanliness).patience - hallObstacle(s.tycoon.waste);
  const over = s.queue - Math.max(1, patience);
  const balk = over < 0 ? 0 : Math.min(1, 0.35 * (over + 1));
  const lost = arrivals * balk;
  s.queue += arrivals - lost;
  if (lost > 0) {
    s.reputation -= lost * 0.03;
    for (const c of [s.today, s.month, s.total]) c.lost += lost;
  }
  return arrivals;
}

/**
 * Sprzedaż `served` klientów: koszyk z półek, marża, strefa hot, ubytki (WUT), reputacja. `scoShare` to część obsłużonych przez
 * kasy samoobsługowe: ich „zapomniane” skany to ubytek w inwentaryzacji (WUT, kradzieże), a nie obcięta marża. Zwraca marżę.
 */
export function sell(s: EconomyState, fx: Effects, served: number, scoShare: number): number {
  let revenue = 0;
  let margin = 0;
  let want = 0;
  let got = 0;
  for (const c of CATS) {
    const w = served * ITEMS_PER_CUSTOMER * CAT_INFO[c].basket;
    const g = Math.min(w, s.shelf[c]);
    s.shelf[c] -= g;
    want += w;
    got += g;
    revenue += g * CAT_INFO[c].price;
    margin += g * CAT_INFO[c].price * CAT_INFO[c].margin;
  }
  const hot = served * HOT.chance * fx.hotMult;
  revenue += hot * HOT.price;
  margin += hot * HOT.price * HOT.margin;
  margin *= fx.marginMult * cardModifiers(s.tycoon.cards, s.minute).margin;   // partner i efekt karty (rabat z glitcha, promocja)
  s.xp += served * XP.customer;
  // ubytki towarowe: naturalne od obrotu i „zapomniane” skany na SCO (kamery zmniejszają); do progu płaci Centrala, nadwyżkę przy zamknięciu miesiąca franczyzobiorca
  wutFromSales(s.tycoon.wut, revenue);
  wutFromSco(s.tycoon.wut, revenue * scoShare, 1 - 0.4 * level(s, 'kamery'));

  const missing = want > 0 ? 1 - got / want : 0;
  s.reputation += served * (0.0025 * (1 - missing) - 0.02 * missing);
  s.reputation += served * cleanlinessEffects(s.tycoon.hall.cleanliness).repPerCustomer;   // brudna sala: do −0,003 na klienta
  s.cash += margin;
  s.ogonkiAcc += (served / 250) * fx.ogonkiMult;
  if (s.ogonkiAcc >= 1) { const n = Math.floor(s.ogonkiAcc); s.ogonki += n; s.ogonkiAcc -= n; }
  for (const k of [s.today, s.month, s.total]) {
    k.customers += served;
    k.revenue += revenue;
    k.margin += margin;
    k.missingItems += want - got;
    k.hotSold += hot;
  }
  return margin;
}

// --- Praca: palety i półki --------------------------------------------------------------------------------

const PALLET_ORDER: Record<PalletLoc, number> = { sidewalk: 0, floor: 1, backroom: 2 };

/**
 * Automatyka z warsztatu dla puli ludzi (tycoon/staff.ts): poziomy taśmociągu i wykładacza, prasa do kartonów (nie zastępuje
 * ludzi, tylko skraca wynoszenie worków) oraz eDward.
 */
export const robotFleet = (s: EconomyState): RobotFleet => ({
  tasmociag: level(s, 'tasmociag'), wykladacz: level(s, 'wykladacz'), prasa: level(s, 'prasa'), edward: level(s, 'humanoid') > 0 ? 1 : 0,
});

/**
 * Miejsca na zapleczu, których nie zajmują palety (te, które w ogóle zostają: rozładowana paleta odejdzie z końcem minuty).
 * Na tyle miejsc mieszczą się worki; reszta idzie do sali (waste.ts).
 */
const wasteRoom = (s: EconomyState, fx: Effects): number =>
  Math.max(0, fx.backroomSpots - s.pallets.filter((p) => p.loc === 'backroom' && p.total >= 0.5).length);

/** Wolne miejsce na towar: zaplecze i półki. Bez niego nie ma co rozładowywać. */
const stockRoom = (s: EconomyState, info: StoreInfo, fx: Effects): number =>
  Math.max(0, fx.backroomCap - sum(s.backroom)) + CATS.reduce((n, c) => n + Math.max(0, info.shelfCap[c] - s.shelf[c]), 0);

const unloadRate = (fx: Effects, p: Pallet): number => UNLOAD_RATE * fx.unloadMult * UNLOAD_AT[p.loc];

/**
 * Praca jednej minuty: zapotrzebowanie czterech zadań w osobominutach, przydział z puli ludzi i automatyki, a potem kasa,
 * rozładunek, wykładanie i sprzątanie z tym, co zadanie dostało. Kto stoi na kasie, to wynik przydziału (profil i przypięci
 * gracza), a nie osobna reguła. Sprzątanie to worki (najpierw z sali) i mycie podłogi (waste.ts, cleanliness.ts).
 */
function runStaff(s: EconomyState, info: StoreInfo, fx: Effects, open: boolean, out: EconEvent[]): void {
  const staff = peopleOnShift(s);
  const robots = robotFleet(s);
  const press = robots.prasa > 0;
  const { waste, hall } = s.tycoon;
  const tillRate = TILL_RATE * fx.tillSpeed;
  const till = tillDemand({
    queue: open ? s.queue : 0, tills: fx.tills, tillRate, sco: fx.sco, scoRate: SCO_RATE * fx.scoSpeed, scoAccept: fx.scoAccept,
  });
  const demand = zeroTasks();
  demand.kasa = till.demand;
  demand.rozladunek = Math.min(
    unloadDemand(s.pallets.map((p) => ({ items: p.total, rate: unloadRate(fx, p) }))),
    stockRoom(s, info, fx) / (UNLOAD_RATE * fx.unloadMult),
  );
  demand.wykladanie = restockDemand(
    CATS.reduce((n, c) => n + Math.max(0, Math.min(info.shelfCap[c] - s.shelf[c], s.backroom[c])), 0), RESTOCK_RATE,
  );
  demand.sprzatanie = wasteDemand(waste, press) + cleaningDemand(hall);
  const input = { staff, demand, robots, scoFreed: till.freed };
  // statystyki dnia i miesiąca liczą tylko minuty zmiany: nocą pracuje sama automatyka, a zadania bez ludzi (palety czekające do
  // rana) nie są niedoborem rąk, więc raport nie podpowiada fałszywych „braków”. Bez statystyk liczy czysty przydział.
  const alloc = isOpenAt(minuteOfDay(s.minute)) ? stepStaff(s.tycoon.staff, input) : allocateStaff(s.tycoon.staff, input);

  // kasa: najpierw potwierdzenia wieku na SCO, potem kolejka; klient SCO bez potwierdzenia zostaje w kolejce
  if (open) {
    const served = serveTill(till, alloc.total.kasa, tillRate);
    s.queue = Math.max(0, s.queue - served.total);
    if (served.total > 0) sell(s, fx, served.total, served.sco / served.total);
    if (s.queue > 4) s.reputation -= 0.002 * (s.queue - 4);
    s.reputation = Math.min(100, Math.max(0, s.reputation));
  }

  // rozładunek: najpierw chodnik (mandat), potem sala (korek), na końcu zaplecze; przy palecie najwyżej dwie osoby
  let minutes = alloc.total.rozladunek;
  for (const p of [...s.pallets].sort((a, b) => PALLET_ORDER[a.loc] - PALLET_ORDER[b.loc] || a.since - b.since)) {
    if (minutes <= 1e-9) break;
    const rate = unloadRate(fx, p);
    const use = Math.min(minutes, PEOPLE_PER_PALLET, p.total / rate);
    unloadPallet(s, info, fx, p, use * rate, out);
    minutes -= use;
  }
  restock(s, info, 1, alloc.total.wykladanie * RESTOCK_RATE);
  removeEmptyPallets(s);

  // sprzątanie: najpierw worki (z sali, potem z zaplecza), reszta minut na podłogę
  const sweep = alloc.total.sprzatanie;
  cleanHall(hall, sweep - removeWaste(waste, sweep, press));

  s.shift = { staff, human: alloc.human };
  s.lastCashiers = alloc.human.kasa;
  s.lastWorkers = alloc.human.rozladunek + alloc.human.wykladanie + alloc.human.sprzatanie;
}

/** Wykłada z zaplecza na półki do poziomu `fill` pojemności, najwyżej `budget` sztuk. Zwraca liczbę sztuk. */
function restock(s: EconomyState, info: StoreInfo, fill: number, budget: number): number {
  if (budget <= 0) return 0;
  const need = perCat((c) => Math.max(0, Math.min(info.shelfCap[c] * fill - s.shelf[c], s.backroom[c])));
  const total = sum(need);
  if (total <= 0) return 0;
  const k = Math.min(1, budget / total);
  for (const c of CATS) {
    const n = need[c] * k;
    s.shelf[c] += n;
    s.backroom[c] -= n;
  }
  return total * k;
}

/** Zdejmuje z palety do `maxItems` sztuk: na zaplecze, a gdy pełne, prosto na półki. Zwraca liczbę sztuk. */
function unloadPallet(s: EconomyState, info: StoreInfo, fx: Effects, p: Pallet, maxItems: number, out?: EconEvent[]): number {
  if (p.total <= 0 || maxItems <= 0) return 0;
  const before = p.total;
  const take = Math.min(maxItems, p.total);
  let backroomFree = Math.max(0, fx.backroomCap - sum(s.backroom));
  let moved = 0;
  for (const c of CATS) {
    if (p.items[c] <= 0) continue;
    let n = Math.min(p.items[c], take * (p.items[c] / p.total));
    const toBack = Math.min(n, backroomFree);
    backroomFree -= toBack;
    const toShelf = Math.min(n - toBack, Math.max(0, info.shelfCap[c] - s.shelf[c]));
    n = toBack + toShelf;
    s.backroom[c] += toBack;
    s.shelf[c] += toShelf;
    p.items[c] -= n;
    moved += n;
  }
  p.total = Math.max(0, sum(p.items));
  // Liczy się tylko przejście poniżej progu. Paleta z ułamkiem sztuki zostaje do końca minuty (`removeEmptyPallets`), więc
  // automatyka warsztatu odwiedza ją jeszcze raz i bez tego warunku premia i XP szłyby drugi raz.
  if (before >= 0.5 && p.total < 0.5 && moved > 0) {
    for (const k of [s.today, s.month, s.total]) k.palletsUnloaded++;
    s.xp += XP.pallet;
    addWaste(s.tycoon.waste, p.bags ?? 1, wasteRoom(s, fx));   // kartony i folia po palecie
    if (p.golden) {
      const prize = Math.round(Math.max(400, estimatedDailyMargin(s, info) * 0.4));
      bonus(s, prize);   // premia Centrali: raport pokazuje ją w „Premiach”, a nie w innych przychodach
      s.ogonki += 5;
      s.xp += XP.golden;
      out?.push({ kind: 'golden', text: `✨ Złota paleta rozładowana: +${fmt(prize)} zł i +5 Ogonków!` });
    }
  }
  return moved;
}

function removeEmptyPallets(s: EconomyState): void {
  s.pallets = s.pallets.filter((p) => p.total >= 0.5);
}

// --- Dostawy, zamówienia, mandaty -----------------------------------------------------------------------

/** Miejsca w lokalizacji; na zapleczu zajmują je też worki ze śmieciami (cztery worki to jedno miejsce). */
function spotLimit(s: EconomyState, info: StoreInfo, loc: PalletLoc): number {
  return loc === 'backroom' ? effects(s, info).backroomSpots : info.spots[loc].length;
}

function freeSpot(s: EconomyState, info: StoreInfo, loc: PalletLoc): number {
  const limit = spotLimit(s, info, loc);
  const there = s.pallets.filter((p) => p.loc === loc);
  // worki zajmują miejsca zaplecza, więc palet zmieści się o tyle mniej (liczy się liczba palet, a nie który indeks jest wolny)
  const bagSpots = loc === 'backroom' ? wasteSpots(s.tycoon.waste) : 0;
  if (bagSpots > 0 && there.length >= limit - bagSpots) return -1;
  const used = new Set(there.map((p) => p.spot));
  for (let i = 0; i < limit; i++) if (!used.has(i)) return i;
  return -1;
}

export function freeSpots(s: EconomyState, info: StoreInfo, loc: PalletLoc): number {
  const limit = spotLimit(s, info, loc) - (loc === 'backroom' ? wasteSpots(s.tycoon.waste) : 0);
  return Math.max(0, limit - s.pallets.filter((p) => p.loc === loc).length);
}

/**
 * Docelowy zapas kategorii: pełna półka plus część zaplecza w proporcji do sprzedaży (koszyka), a nie do wielkości półki.
 * Inaczej zaplecze zapychałby towar, który schodzi wolno, a palety z resztą czekałyby na chodniku.
 */
function stockTarget(info: StoreInfo, backroomCap: number, c: Cat): number {
  return info.shelfCap[c] + 0.6 * backroomCap * CAT_INFO[c].basket;
}

/** Skład palety: według braków do zapasu docelowego, każda kategoria choć trochę. */
function palletMix(s: EconomyState, info: StoreInfo): Record<Cat, number> {
  const backroomCap = effects(s, info).backroomCap;
  const deficit = perCat((c) => Math.max(0.03 * info.shelfCap[c], stockTarget(info, backroomCap, c) - s.shelf[c] - s.backroom[c]
    - s.pallets.reduce((n, p) => n + p.items[c], 0)));
  const total = sum(deficit);
  return perCat((c) => (PALLET_ITEMS * deficit[c]) / total);
}

function deliver(s: EconomyState, info: StoreInfo, count: number, out: EconEvent[]): void {
  if (count <= 0) return;
  const fx = effects(s, info);
  const order: PalletLoc[] = fx.rampa ? ['backroom', 'sidewalk', 'floor'] : ['sidewalk', 'floor'];
  let returned = 0;
  const placed: Record<PalletLoc, number> = { sidewalk: 0, backroom: 0, floor: 0 };
  for (let i = 0; i < count; i++) {
    const loc = order.find((l) => freeSpot(s, info, l) >= 0);
    if (!loc) { returned++; continue; }
    const items = palletMix(s, info);
    const id = s.nextPalletId++;
    const golden = s.total.customers > 0 && rand01(s.seedHash, id, 3) < GOLDEN_CHANCE;
    s.pallets.push({
      id, loc, spot: freeSpot(s, info, loc), items, total: sum(items), initial: sum(items), since: s.minute, golden, bags: palletBags(items),
    });
    placed[loc]++;
  }
  settleWaste(s.tycoon.waste, wasteRoom(s, fx));   // palety na zapleczu (rampa) mogły zająć miejsca worków
  const where = (['sidewalk', 'backroom', 'floor'] as const).filter((l) => placed[l] > 0)
    .map((l) => `${placed[l]} ${LOC_LABEL[l].toLowerCase()}`).join(', ');
  if (count - returned > 0) out.push({ kind: 'delivery', text: `Dostawa: ${count - returned} ${plPallets(count - returned)} (${where}).` });
  if (s.pallets.some((p) => p.golden && p.since === s.minute)) out.push({ kind: 'golden', text: '✨ W dostawie jest ZŁOTA PALETA! Rozładuj ją po premię.' });
  if (returned > 0) {
    const fee = returned * RETURN_FEE;
    charge(s, 'logistics', fee);
    changeTrust(s, 'palety', TRUST.driverReturned, out);
    out.push({ kind: 'warning', text: `Kierowca nie miał gdzie postawić ${returned} ${plPallets(returned)} i ${returned > 1 ? 'je zabrał' : 'ją zabrał'}. Opłata ${fee} zł.` });
  }
}

/** Szansa, że paleta z dostawy jest złota. */
export const GOLDEN_CHANCE = 0.08;

export const LOC_LABEL: Record<PalletLoc, string> = { sidewalk: 'Pod sklepem', backroom: 'Na zapleczu', floor: 'W sali' };

export function plPallets(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n === 1) return 'paleta';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'palety';
  return 'palet';
}

/** Ile klientów dziennie spodziewa się asystent (przy obecnej reputacji i marketingu). */
export function expectedDailyCustomers(s: EconomyState, info: StoreInfo): number {
  const curve = Object.values(HOUR_CURVE).reduce((n, v) => n + v, 0);
  return baseTraffic(info) * curve * reputationFactor(s.reputation) * effects(s, info).traffic;
}

const stockItems = (s: EconomyState): number => sum(s.shelf) + sum(s.backroom) + s.pallets.reduce((n, p) => n + p.total, 0);

/** Podpowiedź „Asystenta Traszki”: tyle palet, żeby jutro rano półki i pół zaplecza były pełne. Zawyżona o `overorder`. */
export function assistantSuggestion(s: EconomyState, info: StoreInfo): number {
  const fx = effects(s, info);
  const inTransit = s.deliveries.reduce((n, d) => n + d.count, 0) * PALLET_ITEMS;
  const target = CATS.reduce((n, c) => n + stockTarget(info, fx.backroomCap, c), 0);
  // od 11:00 do porannej dostawy sprzedaje się ok. 70% dziennego ruchu
  const consumption = 0.7 * expectedDailyCustomers(s, info) * ITEMS_PER_CUSTOMER;
  const need = Math.max(0, target - (stockItems(s) + inTransit - consumption));
  return Math.ceil((need / PALLET_ITEMS) * fx.overorder);
}

export function orderedPallets(s: EconomyState, info: StoreInfo): number {
  return s.order.auto ? assistantSuggestion(s, info) : s.order.manual;
}

const avgPrice = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].basket, 0);
export const creditLimit = (s: EconomyState): number => CREDIT_LIMIT * (1 + 0.5 * s.remontLevel);

function placeOrder(s: EconomyState, info: StoreInfo, fx: Effects, out: EconEvent[]): void {
  const tomorrow = (dayOf(s.minute) + 1) * MINUTES_PER_DAY;
  if (s.remontUntil !== null && s.remontUntil > tomorrow + fx.deliveryAt) {
    out.push({ kind: 'order', text: 'Remont trwa: Centrala wstrzymuje dostawy.' });
    return;
  }
  let count = orderedPallets(s, info);
  const room = Math.floor((creditLimit(s) - stockItems(s) * avgPrice) / (PALLET_ITEMS * avgPrice));
  if (count > room) {
    count = Math.max(0, room);
    out.push({ kind: 'warning', text: `Limit kredytu kupieckiego! Centrala przycięła zamówienie do ${count} ${plPallets(count)}.` });
  }
  if (count <= 0) {
    out.push({ kind: 'order', text: 'Zamówienie na jutro: 0 palet. Zaplecze odetchnie.' });
    return;
  }
  const fee = Math.max(0, count - PALLETS_FREE) * PALLET_FEE;
  if (fee > 0) charge(s, 'logistics', fee);
  if (fx.splitDelivery && count > 1) {
    s.deliveries.push({ at: tomorrow + fx.deliveryAt, count: Math.ceil(count / 2) });
    s.deliveries.push({ at: tomorrow + DELIVERY_AT_AFTERNOON, count: Math.floor(count / 2) });
  } else {
    s.deliveries.push({ at: tomorrow + fx.deliveryAt, count });
  }
  const who = s.order.auto ? 'Asystent Traszki zamówił' : 'Zamówienie ręczne:';
  out.push({ kind: 'order', text: `${who} ${count} ${plPallets(count)} na jutro${fee > 0 ? ` (opłata logistyczna ${fee} zł)` : ''}.` });
}

function checkFine(s: EconomyState, fx: Effects, out: EconEvent[]): void {
  const outside = s.pallets.filter((p) => p.loc === 'sidewalk');
  if (outside.length === 0 || s.minute - s.lastFineAt < 180) return;
  const oldest = Math.min(...outside.map((p) => p.since));
  const hours = (s.minute - oldest) / 60;
  if (hours < 1) return;   // godzina tolerancji po dostawie: „kierowca dopiero co odjechał”
  // outside.length ** 1.4 z tablicy (wynik `**` bywa różny między silnikami); chodnik mieści najwyżej kilkanaście palet, tablica sięga 40
  const p = 0.0003 * FINE_PALLET_POW[Math.min(outside.length, FINE_PALLET_POW.length - 1)] * (1 + 0.2 * (hours - 1)) * fx.fineMult;
  if (rand01(s.seedHash, s.minute, 7) >= p) return;
  const fine = FINE_BASE + FINE_PER_PALLET * (outside.length - 1);
  charge(s, 'fines', fine);
  for (const k of [s.today, s.month, s.total]) k.fineCount++;
  s.lastFineAt = s.minute;
  s.reputation = Math.max(0, s.reputation - 2);
  changeTrust(s, 'mandaty', TRUST.fine, out);
  out.push({ kind: 'fine', text: `Straż Miejska: mandat ${fine} zł za palety na chodniku. „Pan tu nie jest w hurtowni”.` });
}

function charge(s: EconomyState, field: 'wages' | 'media' | 'fee' | 'fines' | 'wut' | 'logistics' | 'investments' | 'other', amount: number): void {
  s.cash -= amount;
  // `other` jest ze znakiem (przychody dodatnie, w wyniku dnia i miesiąca dodawane), więc koszt z karty zmniejsza licznik
  const sign = field === 'other' ? -1 : 1;
  for (const k of [s.today, s.month, s.total]) k[field] += sign * amount;
}

function income(s: EconomyState, amount: number): void {
  s.cash += amount;
  for (const k of [s.today, s.month, s.total]) k.other += amount;
}

/** Premia Centrali: jak `income`, ale na własnym liczniku, bo raport pokazuje ją osobno. */
function bonus(s: EconomyState, amount: number): void {
  s.cash += amount;
  for (const k of [s.today, s.month, s.total]) k.bonus += amount;
}

// --- Koniec dnia i miesiąca -------------------------------------------------------------------------------

function closeDay(s: EconomyState, info: StoreInfo, out: EconEvent[]): void {
  const day = dayOf(s.minute);
  charge(s, 'wages', s.staff * WAGE_PER_DAY);
  charge(s, 'media', Math.round(MEDIA_PER_DAY * Math.max(0.6, info.salesCells / 260)));
  const rent = 25 * activeEquipment(s, 'bankomat');
  if (rent > 0) income(s, rent);
  if (s.partner.networkIncome > 0) income(s, s.partner.networkIncome);
  // KPI tygodnia kończy się w niedzielę o zamknięciu dnia. Premia należy do wyniku tego dnia, więc księguje się przed jego rachunkiem;
  // zdarzenia (wynik tygodnia, ewentualny nowy próg zaufania) idą do gracza po komunikacie o dniu
  const weekly: EconEvent[] = [];
  if (day === s.tycoon.kpi.toDay) {
    const r = closeKpiWeek(s.tycoon.kpi, kpiMetricsOf(s), s.seedHash, day + 1, kpiScaleOf(s, info));
    weekly.push({ kind: 'kpi-week', text: kpiWeekText(r) });
    changeTrust(s, 'kpi', r.trust, weekly);
    if (r.bonus > 0) bonus(s, r.bonus);
    s.xp += r.xp;
  }
  const t = s.today;
  // bez `fee`: opłata franczyzowa jest miesięczna (do dziennego `today` trafia tylko przez zamknięcie miesiąca po zerowaniu dnia)
  const profit = t.margin + t.bonus + t.other - t.wages - t.media - t.fines - t.logistics - t.wut;
  s.lastDayProfit = profit;
  s.bestDayProfit = Math.max(s.bestDayProfit, profit);
  out.push({ kind: 'day', text: `Dzień zamknięty: ${Math.round(t.customers)} klientów, obrót ${fmt(t.revenue)} zł, wynik dnia ${profit >= 0 ? '+' : ''}${fmt(profit)} zł.` });
  out.push(...weekly);
  s.today = emptyCounters();
  fatigueNight(s.tycoon.fatigue);   // noc oddaje część sił, reszta zmęczenia przechodzi na jutro
  closeStaffDay(s.tycoon.staff);    // statystyki dnia ludzi od zera (miesięczne zostają do raportu)

  if (isLastDayOfMonth(day)) closeMonth(s, day, out);
}

/** Tekst zdarzenia `kpi-week`: cel (z tytułu), wynik i skutki. Liczby formatuje `fmt` (polskie spacje tysięcy). */
function kpiWeekText(r: KpiWeekResult): string {
  const title = kpiTitle(r.kind, r.target, fmt);
  const trust = `${r.trust > 0 ? '+' : '−'}${Math.abs(r.trust)}`;
  return r.hit
    ? `KPI tygodnia trafione: ${title}. Wynik: ${fmt(r.value)}. Premia ${fmt(r.bonus)} zł, +${fmt(r.xp)} XP, zaufanie Centrali ${trust}.`
    : `KPI tygodnia nietrafione: ${title}. Wynik: ${fmt(r.value)}. Zaufanie Centrali ${trust}.`;
}

/** Liczniki miesiąca w kształcie raportu tycoona (`report.ts`): koszty jako kwoty dodatnie, `other` ze znakiem. */
const figuresOf = (m: Counters): MonthFigures => ({
  revenue: m.revenue, margin: m.margin, bonuses: m.bonus, other: m.other, wages: m.wages, media: m.media, fee: m.fee, fines: m.fines,
  wut: m.wut, logistics: m.logistics, customers: m.customers, lost: m.lost,
});

/** Średnia marża na klienta z katalogu: koszyk z półek i strefa hot (jak `MARGIN_PER_CUSTOMER` w makiecie). */
const CATALOG_MARGIN_PER_CUSTOMER = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].margin * CAT_INFO[c].basket, 0) * ITEMS_PER_CUSTOMER
  + HOT.chance * HOT.price * HOT.margin;

/** Marża z jednego klienta w miesiącu (do wyceny klientów odstraszonych kolejką w raporcie); bez klientów średnia z katalogu. */
const marginPerCustomer = (m: Counters): number => (m.customers > 0 ? m.margin / m.customers : CATALOG_MARGIN_PER_CUSTOMER);

function closeMonth(s: EconomyState, day: number, out: EconEvent[]): void {
  const m = s.month;
  const t = s.tycoon;
  const fee = Math.round(FRANCHISE_FEE_FIXED + FRANCHISE_FEE_SHARE * m.revenue);
  charge(s, 'fee', fee);
  bonus(s, Math.round(turnoverBonusShare(t.trust.value) * m.revenue));
  // WUT: ubytki miesiąca (naturalne, z SCO i z kart) do progu pokrywa Centrala, nadwyżkę płaci franczyzobiorca; ubytki liczą się od zera
  charge(s, 'wut', closeWutMonth(t.wut, m.revenue).charge);
  const profit = m.margin + m.bonus + m.other - m.wages - m.media - m.fee - m.fines - m.logistics - m.wut;
  changeTrust(s, 'wynik', profit > 0 ? TRUST.monthProfit : TRUST.monthLoss, out);
  // podsumowania modułów wchodzą do raportu raz każde i same zerują licznik miesiąca; zaufanie dopiero po zmianie z wyniku
  const detail = buildMonthReport({
    monthIndex: monthIndexOf(day),
    figures: figuresOf(m),
    trust: closeTrustMonth(t.trust),
    cleanlinessAvg: closeHallMonth(t.hall),
    staff: closeStaffMonth(t.staff),
    days: dateOfGameDay(day).date,
    staffCount: s.staff,
    exhaustedDays: closeFatigueMonth(t.fatigue).exhaustedDays,
    kpi: closeKpiMonth(t.kpi),
    cards: closeCardsMonth(t.cards),
    marginPerCustomer: marginPerCustomer(m),
  }, s.seedHash);
  closeWasteMonth(t.waste);
  const label = formatMonth(day);
  const report: MonthReport = { label, counters: { ...m }, profit, cash: s.cash, comment: reportCommentText(detail.commentId), detail };
  s.history.push({ label, profit, revenue: m.revenue });
  s.lastReport = report;
  out.push({ kind: 'month', text: `Raport za ${label}: wynik ${profit >= 0 ? '+' : ''}${fmt(profit)} zł.`, report });
  s.month = emptyCounters();
  if (s.cash < BANKRUPTCY_AT) {
    s.gameOver = true;
    out.push({ kind: 'gameover', text: 'Centrala wypowiada umowę franczyzową. Dziękujemy za współpracę.' });
  }
  // zero w środku miesiąca to tylko ostrzeżenie; umowę wypowiada się przy zamknięciu miesiąca
  if (!s.gameOver && trustTerminates(t.trust.value)) {
    s.gameOver = true;
    out.push({ kind: 'gameover', text: 'Centrala wypowiada umowę franczyzową: zaufanie spadło do zera. Dziękujemy za współpracę.' });
  }
}

const fmt = (n: number): string => Math.round(n).toLocaleString('pl-PL');

// --- Kamienie milowe ------------------------------------------------------------------------------------

function checkMilestones(s: EconomyState, info: StoreInfo, out: EconEvent[]): void {
  for (const m of MILESTONES) {
    if (s.milestones.includes(m.id) || !m.done(s, info)) continue;
    s.milestones.push(m.id);
    s.ogonki += m.reward;
    s.xp += m.reward * XP.milestonePerOgonek;
    out.push({ kind: 'milestone', text: `🏆 ${m.label} (+${m.reward} Ogonków)` });
  }
}

// --- Polecenia gracza -------------------------------------------------------------------------------------

export type CommandResult = { ok: true; text?: string; value?: number } | { ok: false; text: string };

// --- Combo stukania w czasie gry -----------------------------------------------------------------------------
// Dotąd combo mierzył zegar przeglądarki; serwer odtwarzający bieg go nie widzi. Żyje więc w stanie, w minutach gry.

/** Mnożnik za szybkie stukanie: ×1 do 3 stuknięć w serii, potem o 1 wyżej co 4, najwyżej ×5. */
export const comboMult = (streak: number): number => Math.min(5, 1 + Math.floor(streak / 4));

/** Seria, jaką da stuknięcie w tej minucie: podtrzymuje poprzednią, jeśli od ostatniego minęło najwyżej `COMBO_WINDOW`. */
export const nextTapStreak = (s: EconomyState): number => (s.minute - s.lastTapAt <= COMBO_WINDOW ? s.tapStreak + 1 : 1);

/** Zalicza udane stuknięcie: zapisuje serię i minutę. */
export function commitTap(s: EconomyState): void {
  s.tapStreak = nextTapStreak(s);
  s.lastTapAt = s.minute;
}

/** Combo do interfejsu: bieżąca seria i mnożnik, a po wygaśnięciu serii `{ count: 0, mult: 1 }`. */
export function tapCombo(s: EconomyState): { count: number; mult: number } {
  if (s.minute - s.lastTapAt > COMBO_WINDOW) return { count: 0, mult: 1 };
  return { count: s.tapStreak, mult: comboMult(s.tapStreak) };
}

/** Mniej miejsca niż pół sztuki to nie rozładunek (tyle samo, co próg pustej palety w `removeEmptyPallets`). */
const MIN_ROOM = 0.5;

/**
 * Ile sztuk z palety zmieści się teraz: wolne zaplecze plus, w każdej kategorii z palety, tyle, ile zmieści jej półka i ile
 * jej jest na palecie; nie więcej niż zostało na palecie. Bez miejsca stuknięcie jest odmową, zanim zużyje siły.
 */
function palletRoom(s: EconomyState, info: StoreInfo, fx: Effects, p: Pallet): number {
  let room = Math.max(0, fx.backroomCap - sum(s.backroom));
  for (const c of CATS) room += Math.min(Math.max(0, p.items[c]), Math.max(0, info.shelfCap[c] - s.shelf[c]));
  return Math.min(p.total, room);
}

/**
 * Combo przycięte do tego, co da się wykorzystać: stuknięcia ponad `needTaps` kosztowałyby siły za nic (combo mnoży koszt
 * i efekt po równo). Bzdura zamiast combo (NaN, nieskończoność) zostaje jednym stuknięciem, jak w `tycoon/fatigue.ts`.
 */
const usableCombo = (combo: number, needTaps: number): number => Math.min(Number.isFinite(combo) ? combo : 1, needTaps);

/**
 * Gracz stuka w paletę: franczyzobiorca sam rozładowuje kawałek. Bez `id` bierze najpilniejszą. `combo` to mnożnik za szybkie
 * stukanie (liczy go wołający); razem z nim rośnie koszt w siłach (tycoon/fatigue.ts), a zmęczenie z wczoraj zmniejsza moc.
 * Najpierw sprawdza paletę i miejsce, dopiero potem zużywa siły, więc odmowa „nie ma co ani gdzie” ich nie rusza; odmowa rąk
 * to pusta pula. Combo nie przekracza liczby stuknięć, jakiej potrzeba na to, co się zmieści. Wynik: rozładowane sztuki,
 * a przy złotej palecie także komunikat: w `text`, a gdy podano `events`, jako zdarzenie `golden` dopisane do tej tablicy
 * (wtedy `text` zostaje pusty).
 */
export function tapPallet(s: EconomyState, info: StoreInfo, id?: number, combo = 1, events?: EconEvent[]): CommandResult {
  const fx = effects(s, info);
  const p = id !== undefined ? s.pallets.find((x) => x.id === id)
    : [...s.pallets].sort((a, b) => Number(!!b.golden) - Number(!!a.golden) || PALLET_ORDER[a.loc] - PALLET_ORDER[b.loc] || a.since - b.since)[0];
  if (!p) return { ok: false, text: 'Brak palet do rozładunku.' };
  const room = palletRoom(s, info, fx, p);
  if (room < MIN_ROOM) return { ok: false, text: 'Zaplecze i półki pełne: nie ma gdzie wyłożyć towaru.' };
  const cart = 1 + 0.25 * level(s, 'wozek');
  const needTaps = Math.max(1, Math.ceil(room / (tapItems(fatigueEfficiency(s.tycoon.fatigue)) * cart) - 1e-9));
  const r = fatigueTap(s.tycoon.fatigue, 'paleta', usableCombo(combo, needTaps));
  if (!r.ok) return { ok: false, text: r.text ?? 'Ręce odmawiają.' };
  const out: EconEvent[] = [];
  const moved = unloadPallet(s, info, fx, p, tapItems(r.power) * cart, out);
  removeEmptyPallets(s);
  events?.push(...out);   // premia już wypłacona, więc zdarzenie nie przepada
  for (const k of [s.today, s.month, s.total]) k.taps++;
  return events ? { ok: true, value: moved } : { ok: true, value: moved, text: out[0]?.text };
}

/**
 * Gracz stuka w kasę: franczyzobiorca obsługuje klienta z kolejki (z combo kilku naraz, a zmęczenie obsługuje ułamek). Sklep
 * zamknięty albo pusta kolejka to odmowa bez zużycia sił, a combo nie przekracza liczby stuknięć, jakiej potrzeba na kolejkę.
 * Zwraca zarobioną marżę.
 */
export function tapTill(s: EconomyState, info: StoreInfo, combo = 1): CommandResult {
  if (!isOpenForCustomers(s)) return { ok: false, text: 'Sklep zamknięty.' };
  if (s.queue < 1) return { ok: false, text: 'Nikt nie czeka przy kasie.' };
  const needTaps = Math.max(1, Math.ceil(s.queue / fatigueEfficiency(s.tycoon.fatigue) - 1e-9));
  const r = fatigueTap(s.tycoon.fatigue, 'kasa', usableCombo(combo, needTaps));
  if (!r.ok) return { ok: false, text: r.text ?? 'Ręce odmawiają.' };
  const n = Math.min(s.queue, r.power);
  s.queue -= n;
  const margin = sell(s, effects(s, info), n, 0);
  for (const k of [s.today, s.month, s.total]) k.taps++;
  return { ok: true, value: margin };
}

export function movePallet(s: EconomyState, info: StoreInfo, id: number, loc: PalletLoc): CommandResult {
  const p = s.pallets.find((x) => x.id === id);
  if (!p) return { ok: false, text: 'Nie ma takiej palety.' };
  if (p.loc === loc) return { ok: false, text: 'Paleta już tam stoi.' };
  const spot = freeSpot(s, info, loc);
  if (spot < 0) return { ok: false, text: `${LOC_LABEL[loc]}: brak miejsca.` };
  p.loc = loc;
  p.spot = spot;
  p.since = s.minute;
  settleWaste(s.tycoon.waste, wasteRoom(s, effects(s, info)));
  return { ok: true };
}

export function returnPallet(s: EconomyState, id: number, out?: EconEvent[]): CommandResult {
  const p = s.pallets.find((x) => x.id === id);
  if (!p) return { ok: false, text: 'Nie ma takiej palety.' };
  s.pallets = s.pallets.filter((x) => x !== p);
  charge(s, 'logistics', RETURN_FEE);
  changeTrust(s, 'palety', TRUST.returnedPallet, out);
  return { ok: true, text: `Paleta odesłana do hurtowni. Opłata ${RETURN_FEE} zł, Centrala marszczy brwi.` };
}

export function setOrder(s: EconomyState, auto: boolean, manual?: number): void {
  s.order.auto = auto;
  if (manual !== undefined) s.order.manual = Math.max(0, Math.min(30, Math.round(manual)));
}

export function hire(s: EconomyState): CommandResult {
  if (s.staff >= STAFF_MAX) return { ok: false, text: `Więcej niż ${STAFF_MAX} osób na zmianie się nie zmieści.` };
  if (s.cash < HIRE_COST) return { ok: false, text: 'Za mało gotówki na rekrutację.' };
  charge(s, 'investments', HIRE_COST);
  s.staff++;
  return { ok: true };
}

export function fire(s: EconomyState): CommandResult {
  if (s.staff <= 1) return { ok: false, text: 'Ktoś musi stać na kasie.' };
  s.staff--;
  normalizePins(s.tycoon.staff, s.staff);   // przypięci ponad personel schodzą z posterunków
  return { ok: true };
}

export function workshopUnlocked(s: EconomyState): boolean {
  return s.level >= WORKSHOP_LEVEL || s.remontLevel >= 1;
}

/** Czy ulepszenie wolno kupić teraz (pomijając gotówkę). Zwraca powód blokady albo null. */
export function upgradeBlocker(s: EconomyState, def: UpgradeDef): string | null {
  if (level(s, def.id) >= def.maxLevel) return 'Maksymalny poziom';
  if (def.group === 'warsztat' && !workshopUnlocked(s)) return `Odblokujesz na ${WORKSHOP_LEVEL}. poziomie albo po remoncie`;
  const r = def.requires;
  if (r?.level && s.level < r.level) return `Odblokujesz na ${r.level}. poziomie`;
  if (r?.remont && s.remontLevel < r.remont) return `Wymaga remontu (poziom ${r.remont})`;
  if (r?.sco && s.equipment.filter((e) => e.id === 'sco').length < r.sco) return 'Wymaga kasy samoobsługowej';
  for (const [id, lvl] of r?.upgrade ?? []) {
    if (level(s, id) < lvl) return `Wymaga: ${UPGRADE_BY_ID[id].names[Math.min(lvl, UPGRADE_BY_ID[id].names.length) - 1]}`;
  }
  return null;
}

export function buyUpgrade(s: EconomyState, id: UpgradeId): CommandResult {
  const def = UPGRADE_BY_ID[id];
  const blocker = upgradeBlocker(s, def);
  if (blocker) return { ok: false, text: blocker };
  const cost = upgradeCost(def, level(s, id));
  if (s.cash < cost) return { ok: false, text: 'Za mało gotówki.' };
  charge(s, 'investments', cost);
  s.upgrades[id] = level(s, id) + 1;
  countPurchase(s);
  const name = def.names[Math.min(level(s, id), def.names.length) - 1]!;
  return { ok: true, text: `Kupione: ${name}` };
}

/** Zajętość slotów: id slotu → sprzęt w nim. */
export function slotUsage(s: EconomyState): Map<string, EquipmentId[]> {
  const out = new Map<string, EquipmentId[]>();
  for (const e of s.equipment) {
    if (e.slot === null) continue;
    const list = out.get(e.slot) ?? [];
    list.push(e.id);
    out.set(e.slot, list);
  }
  return out;
}

export function slotFree(s: EconomyState, info: StoreInfo, slotId: string): number {
  const slot = info.slots.find((x) => x.id === slotId);
  if (!slot) return 0;
  const used = (slotUsage(s).get(slotId) ?? []).reduce((n, id) => n + EQUIPMENT_BY_ID[id].size, 0);
  return slot.capacity - used;
}

/** Pierwszy slot, w którym zmieści się sprzęt o rozmiarze `size` (najpierw małe sloty dla małego sprzętu). */
export function findSlot(s: EconomyState, info: StoreInfo, size: number): string | null {
  const fits = info.slots.filter((x) => slotFree(s, info, x.id) >= size);
  fits.sort((a, b) => slotFree(s, info, a.id) - slotFree(s, info, b.id));
  return fits[0]?.id ?? null;
}

function countPurchase(s: EconomyState): void {
  for (const k of [s.today, s.month, s.total]) k.purchases++;
  s.xp += XP.purchase;
}

export function buyEquipment(s: EconomyState, info: StoreInfo, id: EquipmentId, slotId?: string): CommandResult {
  const def = EQUIPMENT_BY_ID[id];
  if (s.level < def.minLevel) return { ok: false, text: `Odblokujesz na ${def.minLevel}. poziomie.` };
  const slot = slotId ?? findSlot(s, info, def.size);
  if (!slot || slotFree(s, info, slot) < def.size) {
    return { ok: false, text: def.size === 2 ? 'Brak wolnego slotu 2×2. Remont da więcej miejsca.' : 'Brak wolnego slotu. Remont da więcej miejsca.' };
  }
  const cost = equipmentCost(def, s.equipment.filter((e) => e.id === id).length);
  if (s.cash < cost) return { ok: false, text: 'Za mało gotówki.' };
  charge(s, 'investments', cost);
  s.equipment.push({ id, slot });
  countPurchase(s);
  return { ok: true, text: `Kupione: ${def.name}` };
}

export function nextRemont(s: EconomyState): (typeof REMONTS)[number] | null {
  return REMONTS.find((r) => r.level === s.remontLevel + 1) ?? null;
}

/** Remont: zamyka sklep na kilka dni, a układ sklepu rośnie (nowy układ liczy warstwa gry, potem woła `relayout`). */
export function startRemont(s: EconomyState): CommandResult {
  const r = nextRemont(s);
  if (!r) return { ok: false, text: 'Większego sklepu już nie będzie. To jest Flagowiec.' };
  if (isClosedForRemont(s)) return { ok: false, text: 'Remont już trwa.' };
  if (s.level < r.minLevel) return { ok: false, text: `Remont odblokujesz na ${r.minLevel}. poziomie.` };
  if (s.cash < r.cost) return { ok: false, text: 'Za mało gotówki na remont.' };
  charge(s, 'investments', r.cost);
  s.remontLevel = r.level;
  s.remontUntil = s.minute + r.days * MINUTES_PER_DAY;
  s.queue = 0;
  return { ok: true, text: `${r.name}: sklep zamknięty na ${r.days} ${r.days === 1 ? 'dzień' : 'dni'}.` };
}

/** Po zmianie układu (remont): palety i sprzęt przenoszą się na miejsca w nowym sklepie. */
export function relayout(s: EconomyState, info: StoreInfo): void {
  const pallets = s.pallets;
  s.pallets = [];
  for (const p of pallets) {
    const loc = ([p.loc, 'backroom', 'sidewalk', 'floor'] as PalletLoc[]).find((l) => freeSpot(s, info, l) >= 0);
    if (!loc) continue;   // nie zmieściła się: przepada (rzadkie, nowy sklep jest większy)
    s.pallets.push({ ...p, loc, spot: freeSpot(s, info, loc) });
  }
  const units = [...s.equipment].sort((a, b) => EQUIPMENT_BY_ID[b.id].size - EQUIPMENT_BY_ID[a.id].size);
  s.equipment = [];
  for (const u of units) {
    s.equipment.push({ id: u.id, slot: null });
    const slot = findSlot(s, info, EQUIPMENT_BY_ID[u.id].size);
    s.equipment[s.equipment.length - 1]!.slot = slot;
  }
  const fx = effects(s, info);
  const back = sum(s.backroom);
  if (back > fx.backroomCap) for (const c of CATS) s.backroom[c] *= fx.backroomCap / back;
  for (const c of CATS) s.shelf[c] = Math.min(s.shelf[c], info.shelfCap[c]);
  settleWaste(s.tycoon.waste, wasteRoom(s, fx));
}

export function campaign(s: EconomyState): CommandResult {
  const cost = 30;
  if (s.ogonki < cost) return { ok: false, text: `Kampania kosztuje ${cost} Ogonków.` };
  s.ogonki -= cost;
  s.boostUntil = Math.max(s.minute, s.boostUntil) + MINUTES_PER_DAY;
  return { ok: true, text: 'Kampania w Traszkapce: +30% klientów przez dobę!' };
}

export function rushRemont(s: EconomyState): CommandResult {
  const cost = 40;
  if (!isClosedForRemont(s)) return { ok: false, text: 'Remont nie trwa.' };
  if (s.ogonki < cost) return { ok: false, text: `Przyspieszenie kosztuje ${cost} Ogonków.` };
  s.ogonki -= cost;
  s.remontUntil = Math.max(s.minute + 1, s.remontUntil! - MINUTES_PER_DAY);
  return { ok: true, text: 'Ekipa remontowa dostała premię w Ogonkach. Pracują szybciej (podobno).' };
}

// --- Karty decyzji i okólniki ----------------------------------------------------------------------------

/** Średni obrót na klienta: koszyk z półek i strefa hot (te same liczby co `REVENUE_PER_CUSTOMER` w makiecie, ale z katalogu). */
const REVENUE_PER_CUSTOMER = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].basket, 0) * ITEMS_PER_CUSTOMER + HOT.chance * HOT.price;

/**
 * Co karta wie o sklepie przy losowaniu (INTEGRATION.md, §5): dostawy w kolejce na dziś, personel, zaufanie, sala, pogoda i
 * skala sklepu (marża i obrót typowego dnia), z której karta liczy swoje kwoty.
 */
export function cardContext(s: EconomyState, info: StoreInfo): CardContext {
  const day = dayOf(s.minute);
  const dayStart = day * MINUTES_PER_DAY;
  const palletsToday = s.deliveries.filter((d) => d.at >= dayStart && d.at < dayStart + MINUTES_PER_DAY).reduce((n, d) => n + d.count, 0);
  return {
    day,
    now: s.minute,
    weekday: weekdayOf(day),
    deliveryToday: palletsToday > 0,
    palletsToday,
    staff: s.staff,
    trust: s.tycoon.trust.value,
    cleanliness: s.tycoon.hall.cleanliness,
    sidewalkPallets: s.pallets.filter((p) => p.loc === 'sidewalk').length,
    weather: s.tycoon.hall.weather,
    dailyMargin: estimatedDailyMargin(s, info),
    dailyRevenue: expectedDailyCustomers(s, info) * REVENUE_PER_CUSTOMER,
  };
}

/**
 * Odpowiedź gracza na kartę. `resolveCard` sprawdza kartę, godzinę i numer odpowiedzi (odmowa nie rusza stanu), potem
 * `applyCardOutcome` księguje to, co należy do tycoona (zaufanie, WUT, czas ludzi, siły), a tu reszta: gotówka w podziale na
 * pozycje raportu, reputacja, Ogonki i XP. Poziom z tego XP liczy `applyCommand`. Wynik odpowiedzi to zdarzenie `card-result`.
 */
export function answerCard(s: EconomyState, seq: number, answer: number, out: EconEvent[]): CommandResult {
  const r = resolveCard(s.tycoon.cards, seq, answer, s.minute, s.seedHash);
  if (!r.ok) return { ok: false, text: r.text };
  const o = r.outcome;
  const tierBefore = trustTier(s.tycoon.trust.value);
  const side = applyCardOutcome(s.tycoon, o);
  if (side.other > 0) income(s, side.other);
  else if (side.other < 0) charge(s, 'other', -side.other);   // koszt z karty obniża `other` (pozycja jest ze znakiem)
  if (side.bonus !== 0) bonus(s, side.bonus);
  if (side.fine !== 0) charge(s, 'fines', -side.fine);        // mandat z karty jest ujemny, licznik liczy kwotę dodatnią
  if (side.fine < 0) for (const k of [s.today, s.month, s.total]) k.fineCount++;
  if (side.logistics !== 0) charge(s, 'logistics', -side.logistics);
  s.reputation = Math.min(100, Math.max(0, s.reputation + side.reputation));
  s.ogonki = Math.max(0, s.ogonki + Math.round(side.ogonki));
  s.xp += side.xp;
  if (o.text) out.push({ kind: 'card-result', text: fillText(o.text, o.params, fmt) });
  announceTrustTier(s, tierBefore, out);
  return { ok: true };
}

// --- Poziomy i nagrody -----------------------------------------------------------------------------------

/** Marża, jakiej sklep spodziewa się w typowy dzień (do skali nagród). */
export function estimatedDailyMargin(s: EconomyState, info: StoreInfo): number {
  const avgMargin = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].margin * CAT_INFO[c].basket, 0) * ITEMS_PER_CUSTOMER;
  return expectedDailyCustomers(s, info) * avgMargin * effects(s, info).marginMult;
}

/** Wejście na kolejne poziomy: nagroda i odblokowania (komunikat `levelup` z listą). */
export function processLevels(s: EconomyState, out: EconEvent[]): void {
  while (s.xp >= xpToNext(s.level)) {
    s.xp -= xpToNext(s.level);
    s.level++;
    const reward = levelReward(s.level);
    income(s, reward.cash);
    s.ogonki += reward.ogonki;
    out.push({
      kind: 'levelup',
      level: s.level,
      unlocks: unlocksAt(s.level),
      text: `Poziom ${s.level}! Nagroda: +${fmt(reward.cash)} zł i +${reward.ogonki} Ogonków.`,
    });
  }
}

/** Co odblokowuje dany poziom (nazwy do komunikatu). */
export function unlocksAt(lvl: number): string[] {
  const out: string[] = [];
  for (const e of Object.values(EQUIPMENT_BY_ID)) if (e.minLevel === lvl && lvl > 1) out.push(e.name);
  for (const u of Object.values(UPGRADE_BY_ID)) if (u.requires?.level === lvl) out.push(u.names[0]!);
  for (const r of REMONTS) if (r.minLevel === lvl) out.push(r.name);
  if (lvl === WORKSHOP_LEVEL) out.push('Warsztat złotej rączki');
  return out;
}

/** Zarobek kierownika zmiany pod nieobecność gracza (liczy go warstwa gry z czasu rzeczywistego). */
export function grantOffline(s: EconomyState, amount: number): void {
  if (amount > 0) income(s, Math.round(amount));
}

/** Dzienna premia za serię dni gry. */
export function grantDaily(s: EconomyState, cash: number, ogonki: number): void {
  income(s, cash);
  s.ogonki += ogonki;
}

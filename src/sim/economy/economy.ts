import { hashString } from '@/sim/rng';
import {
  BANKRUPTCY_AT, CATS, CAT_INFO, CREDIT_LIMIT, DELIVERY_AT, DELIVERY_AT_AFTERNOON, DELIVERY_AT_NIGHT,
  FINE_BASE, FINE_PER_PALLET, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HIRE_COST, HOT, HOUR_CURVE, ITEMS_PER_CUSTOMER,
  LOT_TRAFFIC, MEDIA_PER_DAY, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, ORDER_DEADLINE, PALLET_FEE, PALLET_ITEMS, PALLETS_FREE, PATIENCE,
  RESTOCK_RATE, RETURN_FEE, SCO_ACCEPT, SCO_RATE, STAFF_MAX, STAFF_START, START_CASH, TAP_ITEMS, TILL_RATE, TRAFFIC_PER_SHELF_ITEM,
  TRAFFIC_RANGE, UNLOAD_AT, UNLOAD_RATE, WAGE_PER_DAY, type Cat,
} from './catalog';
import { dayOf, formatMonth, isLastDayOfMonth, isOpenAt, minuteOfDay } from './calendar';
import { rand01 } from './rand';
import type { PalletLoc, StoreInfo } from './storeInfo';
import {
  EQUIPMENT_BY_ID, REMONTS, UPGRADE_BY_ID, WORKSHOP_UNLOCK_EARNED, equipmentCost, upgradeCost,
  type EquipmentId, type UpgradeDef, type UpgradeId,
} from './upgrades';
import { MILESTONES } from './milestones';

// Ekonomia jednego sklepu (spec §6–§8) jako czysta symulacja z krokiem jednej minuty gry. Klienci są modelowani
// zbiorczo (strumień przyjść, kolejka, przepustowość kas), a tłum w 3D to ich obraz, a nie źródło liczb.
// Stan jest zwykłym obiektem JSON, więc zapis gry to JSON.stringify.

export type Priority = 'klienci' | 'rowno' | 'palety';
export const PRIORITY_LABEL: Record<Priority, string> = { klienci: 'Najpierw kasa', rowno: 'Po równo', palety: 'Najpierw palety' };

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
  other: number;        // inne przychody (najem bankomatu, premia Centrali)
  missingItems: number;
  palletsUnloaded: number;
}

export interface Delivery { at: number; count: number }
export interface EquipmentUnit { id: EquipmentId; slot: string | null }

export interface MonthReport {
  label: string;
  counters: Counters;
  profit: number;
  cash: number;
  comment: string;
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
  trust: number;
  shelf: Record<Cat, number>;
  backroom: Record<Cat, number>;
  pallets: Pallet[];
  nextPalletId: number;
  order: { auto: boolean; manual: number };
  deliveries: Delivery[];
  staff: number;
  priority: Priority;
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
  milestones: string[];
  gameOver: boolean;
  /** Ostatni przydział ludzi (do interfejsu): ilu na kasie, ilu przy paletach. */
  lastCashiers: number;
  lastWorkers: number;
}

export type EconEventKind = 'delivery' | 'order' | 'fine' | 'milestone' | 'day' | 'month' | 'remont' | 'info' | 'warning' | 'gameover';
export interface EconEvent { kind: EconEventKind; text: string; report?: MonthReport }

export const emptyCounters = (): Counters => ({
  customers: 0, lost: 0, revenue: 0, margin: 0, wages: 0, media: 0, fee: 0, fines: 0, logistics: 0, investments: 0, other: 0,
  missingItems: 0, palletsUnloaded: 0,
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
  shrink: number;
  fineMult: number;
  autoUnload: number;
  autoRestock: number;
  humanoid: boolean;
  ogonkiMult: number;
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
      + 0.07 * activeEquipment(s, 'paczkownik')) * (1 + 0.1 * s.remontLevel),
    hotMult: 1 + 0.3 * level(s, 'kawa') + 0.4 * activeEquipment(s, 'piec'),
    shrink: 0.03 * (1 - 0.4 * level(s, 'kamery')),
    fineMult: 1 - 0.25 * level(s, 'kamery'),
    autoUnload: 4 * level(s, 'tasmociag') + (humanoid ? 3 * UNLOAD_RATE : 0),
    autoRestock: 12 * level(s, 'wykladacz') + (humanoid ? RESTOCK_RATE : 0),
    humanoid,
    ogonkiMult: 1 + 0.5 * level(s, 'traszkapka'),
  };
}

export const reputationFactor = (rep: number): number => 0.6 + 0.8 * (rep / 100);

/** Klientów na godzinę przy krzywej 1, reputacji 50 i bez marketingu (catalog.ts: TRAFFIC_PER_SHELF_ITEM). */
export function baseTraffic(info: StoreInfo): number {
  const [lo, hi] = TRAFFIC_RANGE;
  return Math.min(hi, Math.max(lo, info.shelfCapTotal * TRAFFIC_PER_SHELF_ITEM)) * LOT_TRAFFIC[info.lotKind];
}

// --- Tworzenie ---------------------------------------------------------------------------------------

/** Nowa gra: sklep na kreskę (towar Centrali na półkach, 2 palety pod drzwiami), 1 września, 6:00. */
export function createEconomy(seed: string, info: StoreInfo): EconomyState {
  const backroomStart = info.backroomCap * 0.35;
  const s: EconomyState = {
    version: 1,
    seed,
    seedHash: hashString(`${seed}:economy`),
    minute: OPEN_FROM,
    cash: START_CASH,
    ogonki: 0,
    ogonkiAcc: 0,
    reputation: 50,
    trust: 60,
    shelf: perCat((c) => Math.round(info.shelfCap[c] * 0.8)),
    backroom: perCat((c) => Math.round(backroomStart * CAT_INFO[c].basket)),
    pallets: [],
    nextPalletId: 1,
    order: { auto: true, manual: 4 },
    deliveries: [],
    staff: STAFF_START,
    priority: 'rowno',
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
    milestones: [],
    gameOver: false,
    lastCashiers: 1,
    lastWorkers: 1,
  };
  const ev: EconEvent[] = [];
  deliver(s, info, 2, ev);
  return s;
}

// --- Krok ----------------------------------------------------------------------------------------------

export const isClosedForRemont = (s: EconomyState): boolean => s.remontUntil !== null && s.minute < s.remontUntil;
export const isStoreOpen = (s: EconomyState): boolean => isOpenAt(minuteOfDay(s.minute)) && !isClosedForRemont(s);

/** Jedna minuta gry. Zdarzenia dla gracza (dostawa, mandat, raport…) trafiają do `out`. */
export function stepMinute(s: EconomyState, info: StoreInfo, out: EconEvent[]): void {
  if (s.gameOver) return;
  const mod = minuteOfDay(s.minute);
  const fx = effects(s, info);
  const open = isStoreOpen(s);

  if (s.remontUntil !== null && s.minute >= s.remontUntil) {
    s.remontUntil = null;
    out.push({ kind: 'remont', text: 'Remont zakończony! Sklep otwarty, pachnie nową farbą i starym kurzem.' });
  }

  for (const d of s.deliveries.filter((x) => x.at <= s.minute)) deliver(s, info, d.count, out);
  s.deliveries = s.deliveries.filter((x) => x.at > s.minute);

  if (open) serveCustomers(s, info, fx, mod);
  else s.queue = 0;
  // personel pracuje w godzinach otwarcia, także w czasie remontu (wtedy nikt nie stoi na kasie)
  doWork(s, info, fx, isOpenAt(mod), open);
  if (mod >= 8 * 60 && mod < 20 * 60) checkFine(s, fx, out);
  if (mod === ORDER_DEADLINE) placeOrder(s, info, fx, out);
  if (mod === OPEN_TO) closeDay(s, info, out);
  if (mod % 60 === 0) checkMilestones(s, info, out);

  s.minute++;
}

function serveCustomers(s: EconomyState, info: StoreInfo, fx: Effects, mod: number): void {
  const hour = Math.floor(mod / 60);
  const floorPallets = s.pallets.filter((p) => p.loc === 'floor').length;
  const boost = s.minute < s.boostUntil ? 1.3 : 1;
  const lambda = (baseTraffic(info) * (HOUR_CURVE[hour] ?? 0) / 60) * reputationFactor(s.reputation)
    * fx.traffic * boost * Math.max(0.5, 1 - 0.08 * floorPallets);
  s.arrivalAcc += lambda * (0.75 + 0.5 * rand01(s.seedHash, s.minute, 1));
  const arrivals = Math.floor(s.arrivalAcc);
  s.arrivalAcc -= arrivals;

  // klienci, którzy widzą długą kolejkę, rezygnują (spec §6.1)
  const over = s.queue - Math.max(1, fx.patience);
  const balk = over < 0 ? 0 : Math.min(1, 0.35 * (over + 1));
  const lost = arrivals * balk;
  s.queue += arrivals - lost;
  if (lost > 0) {
    s.reputation -= lost * 0.03;
    for (const c of [s.today, s.month, s.total]) c.lost += lost;
  }

  const cashiers = allocateCashiers(s, fx, true);
  const capTill = cashiers * TILL_RATE * fx.tillSpeed;
  const capSco = fx.sco * SCO_RATE * fx.scoSpeed;
  const scoServed = Math.min(capSco, s.queue * fx.scoAccept);
  const tillServed = Math.min(capTill, s.queue - scoServed);
  const served = Math.max(0, scoServed + tillServed);
  s.queue = Math.max(0, s.queue - served);
  if (served > 0) sell(s, fx, served, scoServed / served);
  if (s.queue > 4) s.reputation -= 0.002 * (s.queue - 4);
  s.reputation = Math.min(100, Math.max(0, s.reputation));
}

/** Ilu ludzi stoi na kasie (reszta pracuje przy paletach i półkach). */
function allocateCashiers(s: EconomyState, fx: Effects, open: boolean): number {
  if (!open) return 0;
  const staff = s.staff;
  let want: number;
  switch (s.priority) {
    case 'klienci': want = s.queue > 0.3 ? fx.tills : 1; break;
    case 'rowno': want = Math.max(fx.sco > 0 && s.queue < 1.5 ? 0 : 1, Math.ceil(s.queue / 4)); break;
    case 'palety': want = s.queue > 5 ? 1 : fx.sco > 0 ? 0 : 1; break;
  }
  return Math.max(0, Math.min(staff, fx.tills, want));
}

/** Sprzedaż `served` klientów: koszyk z półek, marża, strefa hot, ubytki na SCO, reputacja. */
function sell(s: EconomyState, fx: Effects, served: number, scoShare: number): number {
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
  margin -= revenue * scoShare * fx.shrink;   // „zapomniane” skany na SCO

  const missing = want > 0 ? 1 - got / want : 0;
  s.reputation += served * (0.0025 * (1 - missing) - 0.02 * missing);
  s.cash += margin;
  s.ogonkiAcc += (served / 250) * fx.ogonkiMult;
  if (s.ogonkiAcc >= 1) { const n = Math.floor(s.ogonkiAcc); s.ogonki += n; s.ogonkiAcc -= n; }
  for (const k of [s.today, s.month, s.total]) {
    k.customers += served;
    k.revenue += revenue;
    k.margin += margin;
    k.missingItems += want - got;
  }
  return margin;
}

// --- Praca: palety i półki --------------------------------------------------------------------------------

const PALLET_ORDER: Record<PalletLoc, number> = { sidewalk: 0, floor: 1, backroom: 2 };

function doWork(s: EconomyState, info: StoreInfo, fx: Effects, shift: boolean, open: boolean): void {
  const cashiers = allocateCashiers(s, fx, open);
  const workers = shift ? Math.max(0, s.staff - cashiers) : 0;
  s.lastCashiers = cashiers;
  s.lastWorkers = workers;

  let time = workers;   // osobominuty
  // 1. pilne wykładanie: półki poniżej połowy
  time -= restock(s, info, 0.5, time * RESTOCK_RATE) / RESTOCK_RATE;
  // 2. rozładunek palet (najpierw chodnik: mandat; potem sala: korek; na końcu zaplecze)
  const pallets = [...s.pallets].sort((a, b) => PALLET_ORDER[a.loc] - PALLET_ORDER[b.loc] || a.since - b.since);
  for (const p of pallets) {
    if (time <= 1e-6) break;
    const rate = UNLOAD_RATE * fx.unloadMult * UNLOAD_AT[p.loc];
    time -= unloadPallet(s, info, fx, p, time * rate) / rate;
  }
  // 3. dokładanie do pełna
  if (time > 1e-6) restock(s, info, 1, time * RESTOCK_RATE);

  // automatyka z warsztatu działa całą dobę
  if (fx.autoUnload > 0) {
    let budget = fx.autoUnload;
    for (const p of [...s.pallets].sort((a, b) => PALLET_ORDER[b.loc] - PALLET_ORDER[a.loc])) {
      if (budget <= 1e-6) break;
      budget -= unloadPallet(s, info, fx, p, budget);
    }
  }
  if (fx.autoRestock > 0) restock(s, info, 1, fx.autoRestock);
  removeEmptyPallets(s);
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
function unloadPallet(s: EconomyState, info: StoreInfo, fx: Effects, p: Pallet, maxItems: number): number {
  if (p.total <= 0 || maxItems <= 0) return 0;
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
  if (p.total < 0.5) {
    for (const k of [s.today, s.month, s.total]) k.palletsUnloaded++;
  }
  return moved;
}

function removeEmptyPallets(s: EconomyState): void {
  s.pallets = s.pallets.filter((p) => p.total >= 0.5);
}

// --- Dostawy, zamówienia, mandaty -----------------------------------------------------------------------

function freeSpot(s: EconomyState, info: StoreInfo, loc: PalletLoc): number {
  const limit = loc === 'backroom' ? effects(s, info).backroomSpots : info.spots[loc].length;
  const used = new Set(s.pallets.filter((p) => p.loc === loc).map((p) => p.spot));
  for (let i = 0; i < limit; i++) if (!used.has(i)) return i;
  return -1;
}

export function freeSpots(s: EconomyState, info: StoreInfo, loc: PalletLoc): number {
  const limit = loc === 'backroom' ? effects(s, info).backroomSpots : info.spots[loc].length;
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
    s.pallets.push({ id: s.nextPalletId++, loc, spot: freeSpot(s, info, loc), items, total: sum(items), initial: sum(items), since: s.minute });
    placed[loc]++;
  }
  const where = (['sidewalk', 'backroom', 'floor'] as const).filter((l) => placed[l] > 0)
    .map((l) => `${placed[l]} ${LOC_LABEL[l].toLowerCase()}`).join(', ');
  if (count - returned > 0) out.push({ kind: 'delivery', text: `Dostawa: ${count - returned} ${plPallets(count - returned)} (${where}).` });
  if (returned > 0) {
    const fee = returned * RETURN_FEE;
    charge(s, 'logistics', fee);
    s.trust = Math.max(0, s.trust - 3);
    out.push({ kind: 'warning', text: `Kierowca nie miał gdzie postawić ${returned} ${plPallets(returned)} i ${returned > 1 ? 'je zabrał' : 'ją zabrał'}. Opłata ${fee} zł.` });
  }
}

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
  const p = 0.0003 * outside.length ** 1.4 * (1 + 0.2 * (hours - 1)) * fx.fineMult;
  if (rand01(s.seedHash, s.minute, 7) >= p) return;
  const fine = FINE_BASE + FINE_PER_PALLET * (outside.length - 1);
  charge(s, 'fines', fine);
  s.lastFineAt = s.minute;
  s.reputation = Math.max(0, s.reputation - 2);
  s.trust = Math.max(0, s.trust - 1);
  out.push({ kind: 'fine', text: `Straż Miejska: mandat ${fine} zł za palety na chodniku. „Pan tu nie jest w hurtowni”.` });
}

function charge(s: EconomyState, field: 'wages' | 'media' | 'fee' | 'fines' | 'logistics' | 'investments', amount: number): void {
  s.cash -= amount;
  for (const k of [s.today, s.month, s.total]) k[field] += amount;
}

function income(s: EconomyState, amount: number): void {
  s.cash += amount;
  for (const k of [s.today, s.month, s.total]) k.other += amount;
}

// --- Koniec dnia i miesiąca -------------------------------------------------------------------------------

function closeDay(s: EconomyState, info: StoreInfo, out: EconEvent[]): void {
  const day = dayOf(s.minute);
  charge(s, 'wages', s.staff * WAGE_PER_DAY);
  charge(s, 'media', Math.round(MEDIA_PER_DAY * Math.max(0.6, info.salesCells / 260)));
  const rent = 25 * activeEquipment(s, 'bankomat');
  if (rent > 0) income(s, rent);
  const t = s.today;
  const profit = t.margin + t.other - t.wages - t.media - t.fines - t.logistics;
  out.push({ kind: 'day', text: `Dzień zamknięty: ${Math.round(t.customers)} klientów, obrót ${fmt(t.revenue)} zł, wynik dnia ${profit >= 0 ? '+' : ''}${fmt(profit)} zł.` });
  s.today = emptyCounters();

  if (isLastDayOfMonth(day)) closeMonth(s, day, out);
}

function closeMonth(s: EconomyState, day: number, out: EconEvent[]): void {
  const m = s.month;
  const fee = Math.round(FRANCHISE_FEE_FIXED + FRANCHISE_FEE_SHARE * m.revenue);
  charge(s, 'fee', fee);
  if (s.trust >= 70) {
    const bonus = Math.round(0.01 * m.revenue);
    income(s, bonus);
  }
  const profit = m.margin + m.other - m.wages - m.media - m.fee - m.fines - m.logistics;
  s.trust = Math.min(100, Math.max(0, s.trust + (profit > 0 ? 5 : -8)));
  const label = formatMonth(day);
  const report: MonthReport = { label, counters: { ...m }, profit, cash: s.cash, comment: centralaComment(s, profit) };
  s.history.push({ label, profit, revenue: m.revenue });
  out.push({ kind: 'month', text: `Raport za ${label}: wynik ${profit >= 0 ? '+' : ''}${fmt(profit)} zł.`, report });
  s.month = emptyCounters();
  if (s.cash < BANKRUPTCY_AT) {
    s.gameOver = true;
    out.push({ kind: 'gameover', text: 'Centrala wypowiada umowę franczyzową. Dziękujemy za współpracę.' });
  }
}

function centralaComment(s: EconomyState, profit: number): string {
  if (s.cash < 0 && profit < 0) return 'Centrala z niepokojem obserwuje Twój wynik i przypomina, że wierzymy w Ciebie. Na razie.';
  if (profit < 0) return 'Miesiąc na minusie. Centrala proponuje szkolenie „Jak zarabiać więcej, wydając mniej” (płatne).';
  if (profit < 10_000) return 'Jest dodatnio! Centrala gratuluje i podnosi KPI na przyszły miesiąc.';
  if (profit < 50_000) return 'Świetny wynik. Centrala rozważa wspomnienie o Tobie w newsletterze (strona 14).';
  return 'Rekordowy miesiąc! Centrala przypisuje sukces nowej strategii Centrali.';
}

const fmt = (n: number): string => Math.round(n).toLocaleString('pl-PL');

// --- Kamienie milowe ------------------------------------------------------------------------------------

function checkMilestones(s: EconomyState, info: StoreInfo, out: EconEvent[]): void {
  for (const m of MILESTONES) {
    if (s.milestones.includes(m.id) || !m.done(s, info)) continue;
    s.milestones.push(m.id);
    s.ogonki += m.reward;
    out.push({ kind: 'milestone', text: `🏆 ${m.label} (+${m.reward} Ogonków)` });
  }
}

// --- Polecenia gracza -------------------------------------------------------------------------------------

export type CommandResult = { ok: true; text?: string; value?: number } | { ok: false; text: string };

/** Gracz stuka w paletę: franczyzobiorca sam rozładowuje kawałek. Bez `id` bierze najpilniejszą. */
export function tapPallet(s: EconomyState, info: StoreInfo, id?: number): CommandResult {
  const fx = effects(s, info);
  const p = id !== undefined ? s.pallets.find((x) => x.id === id)
    : [...s.pallets].sort((a, b) => PALLET_ORDER[a.loc] - PALLET_ORDER[b.loc] || a.since - b.since)[0];
  if (!p) return { ok: false, text: 'Brak palet do rozładunku.' };
  const moved = unloadPallet(s, info, fx, p, TAP_ITEMS * (1 + 0.25 * level(s, 'wozek')));
  removeEmptyPallets(s);
  if (moved <= 1e-6) return { ok: false, text: 'Zaplecze i półki pełne: nie ma gdzie wyłożyć towaru.' };
  return { ok: true, value: moved };
}

/** Gracz stuka w kasę: franczyzobiorca obsługuje jednego klienta z kolejki. Zwraca zarobioną marżę. */
export function tapTill(s: EconomyState, info: StoreInfo): CommandResult {
  if (!isStoreOpen(s)) return { ok: false, text: 'Sklep zamknięty.' };
  if (s.queue < 1) return { ok: false, text: 'Nikt nie czeka przy kasie.' };
  s.queue -= 1;
  const margin = sell(s, effects(s, info), 1, 0);
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
  return { ok: true };
}

export function returnPallet(s: EconomyState, id: number): CommandResult {
  const p = s.pallets.find((x) => x.id === id);
  if (!p) return { ok: false, text: 'Nie ma takiej palety.' };
  s.pallets = s.pallets.filter((x) => x !== p);
  charge(s, 'logistics', RETURN_FEE);
  s.trust = Math.max(0, s.trust - 4);
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
  return { ok: true };
}

export function setPriority(s: EconomyState, p: Priority): void {
  s.priority = p;
}

export function workshopUnlocked(s: EconomyState): boolean {
  return s.total.margin >= WORKSHOP_UNLOCK_EARNED || s.remontLevel >= 1;
}

/** Czy ulepszenie wolno kupić teraz (pomijając gotówkę). Zwraca powód blokady albo null. */
export function upgradeBlocker(s: EconomyState, def: UpgradeDef): string | null {
  if (level(s, def.id) >= def.maxLevel) return 'Maksymalny poziom';
  if (def.group === 'warsztat' && !workshopUnlocked(s)) return `Odblokujesz po zarobieniu ${fmt(WORKSHOP_UNLOCK_EARNED)} zł`;
  const r = def.requires;
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

export function buyEquipment(s: EconomyState, info: StoreInfo, id: EquipmentId, slotId?: string): CommandResult {
  const def = EQUIPMENT_BY_ID[id];
  const slot = slotId ?? findSlot(s, info, def.size);
  if (!slot || slotFree(s, info, slot) < def.size) {
    return { ok: false, text: def.size === 2 ? 'Brak wolnego slotu 2×2. Remont da więcej miejsca.' : 'Brak wolnego slotu. Remont da więcej miejsca.' };
  }
  const cost = equipmentCost(def, s.equipment.filter((e) => e.id === id).length);
  if (s.cash < cost) return { ok: false, text: 'Za mało gotówki.' };
  charge(s, 'investments', cost);
  s.equipment.push({ id, slot });
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

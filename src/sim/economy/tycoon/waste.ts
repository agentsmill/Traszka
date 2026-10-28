import { isRec, num, type Rec } from '@/sim/guards';
import type { Cat } from '../catalog';

/**
 * Śmieci z rozładunku (spec §6.5). Rozładowana paleta zostawia kartony i folię: jeden worek, a dwa, gdy to napoje
 * w folii. Worki trzeba złożyć i wynieść do wiaty śmietnikowej (zadanie „sprzątanie i śmieci” z puli ludzi). Niewyniesione
 * zajmują miejsca na zapleczu, te same co palety; przy pełnym zapleczu lądują w sali jako przeszkoda i brud.
 *
 * Worki są liczone zbiorczo (ułamek worka to worek w trakcie składania), interfejs pokazuje je w górę do całości.
 */

export interface WasteState {
  /** Worki czekające na zapleczu. */
  backroom: number;
  /** Worki, które nie zmieściły się na zapleczu i leżą w sali. */
  hall: number;
  /** Miesiąc: worki z rozładunku, wyniesione i „workominuty” w sali (do raportu i wskazówek). */
  month: { produced: number; removed: number; hallBagMinutes: number };
}

export const WASTE = {
  bagsPerPallet: 1,
  /** Paleta, w której napoje to co najmniej `foilDrinksShare` sztuk, jest owinięta folią zgrzewek: dwa worki. */
  bagsFoilDrinks: 2,
  foilDrinksShare: 0.4,
  /** Tyle worków zajmuje jedno miejsce na paletę (kwadrat 2×2 kratki). */
  bagsPerSpot: 4,
  /** Osobominuty na worek: złożyć kartony, zawiązać, zanieść do wiaty. Z prasą do kartonów krócej. */
  bagMinutes: 5,
  pressBagMinutes: 2,
  /** Przy śmieciach naraz najwyżej jedna osoba (wiata jest jedna, drzwi wąskie). */
  maxPeople: 1,
} as const;

export function createWaste(): WasteState {
  return { backroom: 0, hall: 0, month: { produced: 0, removed: 0, hallBagMinutes: 0 } };
}

/** Worki z jednej palety według jej składu z dostawy. */
export function palletBags(items: Partial<Record<Cat, number>>): number {
  const total = Object.values(items).reduce<number>((n, v) => n + Math.max(0, v ?? 0), 0);
  const drinks = Math.max(0, items.napoje ?? 0);
  return total > 0 && drinks / total >= WASTE.foilDrinksShare ? WASTE.bagsFoilDrinks : WASTE.bagsPerPallet;
}

/** Miejsca na palety, które zajmują worki na zapleczu. */
export const wasteSpots = (w: WasteState): number => Math.ceil(w.backroom / WASTE.bagsPerSpot - 1e-9);

/**
 * Nowe worki. `room` to miejsca na zapleczu, których nie zajmują palety (miejsca zaplecza minus palety na zapleczu).
 * Co się nie zmieści, idzie do sali. Zwraca, ile worków trafiło gdzie.
 */
export function addWaste(w: WasteState, bags: number, room: number): { backroom: number; hall: number } {
  if (!(bags > 0)) return { backroom: 0, hall: 0 };
  const capacity = Math.max(0, room) * WASTE.bagsPerSpot;
  const toBack = Math.max(0, Math.min(bags, capacity - w.backroom));
  w.backroom += toBack;
  w.hall += bags - toBack;
  w.month.produced += bags;
  return { backroom: toBack, hall: bags - toBack };
}

/** Palety zajęły miejsca na zapleczu: worki, które się już nie mieszczą, ktoś wystawia do sali. Zwraca liczbę worków. */
export function settleWaste(w: WasteState, room: number): number {
  const over = w.backroom - Math.max(0, room) * WASTE.bagsPerSpot;
  if (over <= 1e-9) return 0;
  w.backroom -= over;
  w.hall += over;
  return over;
}

export const bagMinutes = (press: boolean): number => (press ? WASTE.pressBagMinutes : WASTE.bagMinutes);

/** Osobominuty potrzebne, żeby wynieść wszystko. */
export const wasteWork = (w: WasteState, press: boolean): number => (w.backroom + w.hall) * bagMinutes(press);

/** Zapotrzebowanie zadania na tę minutę (część zadania „sprzątanie i śmieci”). */
export const wasteDemand = (w: WasteState, press: boolean): number => Math.min(WASTE.maxPeople, wasteWork(w, press));

/** Wynoszenie przez `minutes` osobominut: najpierw worki z sali (przeszkoda i brud), potem z zaplecza. Zwraca zużyte minuty. */
export function removeWaste(w: WasteState, minutes: number, press: boolean): number {
  if (!(minutes > 0)) return 0;
  const per = bagMinutes(press);
  let bags = minutes / per;
  const fromHall = Math.min(bags, w.hall);
  w.hall -= fromHall;
  bags -= fromHall;
  const fromBack = Math.min(bags, w.backroom);
  w.backroom -= fromBack;
  const removed = fromHall + fromBack;
  w.month.removed += removed;
  if (w.hall < 1e-9) w.hall = 0;
  if (w.backroom < 1e-9) w.backroom = 0;
  return removed * per;
}

/** Worki w sali jako przeszkoda, w przeliczeniu na palety w sali (cierpliwość i ruch liczą je jak paletę). */
export const hallObstacle = (w: WasteState): number => w.hall / WASTE.bagsPerSpot;

/** Minuta: licznik worków leżących w sali (do raportu). */
export function wasteMinute(w: WasteState): void {
  w.month.hallBagMinutes += w.hall;
}

export function closeWasteMonth(w: WasteState): WasteState['month'] {
  const out = w.month;
  w.month = { produced: 0, removed: 0, hallBagMinutes: 0 };
  return out;
}

/** Wczytanie z zapisu. Granica: zaplecze ma najwyżej 8 miejsc po 4 worki, sala przyjmie dowolnie dużo, ale z rozsądkiem. */
export function sanitizeWaste(raw: unknown): WasteState {
  const d = createWaste();
  if (!isRec(raw)) return d;
  const m: Rec = isRec(raw.month) ? raw.month : {};
  return {
    backroom: num(raw.backroom, 0, 0, 1000),
    hall: num(raw.hall, 0, 0, 10_000),
    month: {
      produced: num(m.produced, 0, 0, 1e9),
      removed: num(m.removed, 0, 0, 1e9),
      hallBagMinutes: num(m.hallBagMinutes, 0, 0, 1e12),
    },
  };
}

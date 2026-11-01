import { t } from '@/i18n';
import type { CityPinKind } from '@/render/city/cityPins';
import { DISTRICTS } from '@/sim/city/districts';
import { lotById } from '@/sim/city/generateCity';
import { lotEstimate, rivalsNear, type LotEstimate } from '@/sim/city/traffic';
import type { CityLot, CityState, LotState, RivalBrand, SourceKind, StoreDistrict } from '@/sim/city/types';
import { dayOf } from '@/sim/economy/calendar';
import { planFor, type InstallmentPlan } from '@/sim/economy/franchisee';
import { CELL_SIZE_M } from '@/sim/grid';
import { lotState, rentRefusal } from '@/sim/firm/commands';
import { activeStore } from '@/sim/firm/firm';
import type { FirmRefusal, FirmState } from '@/sim/firm/types';
import type { LotKind } from '@/sim/store/types';
import { plural } from '../game/format';
import { brandName } from './cityText';
import { addressText } from './firmText';

/*
 * Model ekranu Miasta (spec §9.3): wiersze listy wolnych lokali, karta lokalu, poziomy słowami, nawigacja po lokalach i pinezki dla
 * sceny miasta. Czyste funkcje firmy i miasta bez interfejsu; teksty składa `cityText.ts`, a komponenty `CityPanel.tsx` i `LotCard.tsx`.
 */

export type Level = 'niskie' | 'srednie' | 'wysokie';

/**
 * Wiersz listy wolnych lokali. `no` to numer lokalu na kartce i na liście: miejsce wśród wolnych lokali z generatora (od 1), więc po
 * wynajęciu jednego numery pozostałych zostają. `area` to sala sprzedaży w m² (`interiorWidth × salesDepth` kratek).
 */
export interface LotRow {
  lotId: number; no: number; street: string; number: number; district: StoreDistrict; kind: LotKind; corner: boolean;
  area: number; lo: number; hi: number; price: number;
}

// --- Poziomy słowami (§9.3) -----------------------------------------------------------------------------------------

/** Koszyk (mnożnik zł na klienta): ≤ 0,9 niski, ≥ 1,2 wysoki. */
export const basketLevel = (mult: number): Level => (mult <= 0.9 ? 'niskie' : mult >= 1.2 ? 'wysokie' : 'srednie');

/** Oczekiwania klientów: wysokie przy mniejszej cierpliwości albo wyższych karach reputacji, niskie przy większej cierpliwości. */
export function expectationsLevel(patience: number, repPenalty: number): Level {
  if (patience < 0 || repPenalty > 1) return 'wysokie';
  return patience > 0 ? 'niskie' : 'srednie';
}

/** Kradzieże (mnożnik): ≥ 1,3 wysokie, ≤ 0,7 niskie. */
export const theftLevel = (mult: number): Level => (mult >= 1.3 ? 'wysokie' : mult <= 0.7 ? 'niskie' : 'srednie');

// --- Lista wolnych lokali -------------------------------------------------------------------------------------------

/** Widełki klientów liczą się raz na miasto (`lotEstimate` buduje ekonomię sklepu w lokalu), a ekran pyta o nie przy każdym odświeżeniu. */
const estimates = new WeakMap<CityState, Map<string, LotEstimate>>();
function estimateOf(seed: string, city: CityState, lotId: number): LotEstimate {
  let bySeed = estimates.get(city);
  if (!bySeed) estimates.set(city, bySeed = new Map());
  const key = `${seed}:${lotId}`;
  let e = bySeed.get(key);
  if (!e) bySeed.set(key, e = lotEstimate(seed, city, lotId));
  return e;
}

/** Numery lokali z generatora (`state: 'wolny'` na starcie): stałe przez całą grę. */
const numbers = new WeakMap<CityState, Map<number, number>>();
function numberOf(city: CityState, lotId: number): number {
  let byLot = numbers.get(city);
  if (!byLot) {
    numbers.set(city, byLot = new Map());
    let n = 0;
    for (const l of city.lots) if (l.state === 'wolny') byLot.set(l.id, ++n);
  }
  return byLot.get(lotId) ?? 0;
}

function rowOf(seed: string, city: CityState, lot: CityLot): LotRow {
  const est = estimateOf(seed, city, lot.id);
  return {
    lotId: lot.id, no: numberOf(city, lot.id), street: lot.street, number: lot.number, district: lot.district, kind: lot.spec.kind,
    corner: lot.spec.corner, area: Math.round(lot.spec.interiorWidth * lot.spec.salesDepth * CELL_SIZE_M * CELL_SIZE_M),
    lo: est.lo, hi: est.hi, price: lot.package,
  };
}

/** Wolne lokale miasta (stan w grze `wolny`), rosnąco po numerze. Widełki w pamięci podręcznej miasta. */
export function freeLotRows(seed: string, f: FirmState): LotRow[] {
  return f.city.lots.filter((l) => lotState(f, l.id) === 'wolny').map((l) => rowOf(seed, f.city, l));
}

// --- Karta lokalu ---------------------------------------------------------------------------------------------------

export interface LotCardModel {
  row: LotRow;
  /** Dwa najbliższe rodzaje punktów ruchu (słowa daje `sourceText`). */
  who: SourceKind[];
  basket: Level; expectations: Level; theft: Level;
  /** Konkurencja bliżej niż `RIVAL_RADIUS_M`, od najbliższej; odległość w pełnych metrach. */
  rivals: { brand: RivalBrand; meters: number }[];
  price: number; plan: InstallmentPlan; buildDays: number;
  /** Czy „Biorę lokal” działa przy wybranym sposobie zapłaty; jeśli nie, powód odmowy Centrali. */
  action: { enabled: true } | { enabled: false; reason: FirmRefusal };
}

/** Karta lokalu `lotId` (też takiego, którego nie da się wynająć: wtedy `action` niesie powód `lot`). */
export function lotCardModel(seed: string, f: FirmState, lotId: number, pay: 'gotowka' | 'raty'): LotCardModel {
  const lot = lotById(f.city, lotId);
  const d = DISTRICTS[lot.district];
  const reason = rentRefusal(f, lotId, pay);
  return {
    row: rowOf(seed, f.city, lot),
    who: estimateOf(seed, f.city, lotId).who,
    basket: basketLevel(d.basket),
    expectations: expectationsLevel(d.patience, d.repPenalty),
    theft: theftLevel(d.theft),
    rivals: rivalsNear(f.city, lotId).flatMap((r) => (r.lot.brand ? [{ brand: r.lot.brand, meters: Math.round(r.meters) }] : [])),
    price: lot.package,
    plan: planFor(lot.package),
    buildDays: lot.buildDays,
    action: reason === null ? { enabled: true } : { enabled: false, reason },
  };
}

// --- Nawigacja ------------------------------------------------------------------------------------------------------

/** Następny (`dir` 1) albo poprzedni (−1) lokal z listy w kółko. Bez wyboru albo przy lokalu spoza listy: pierwszy (dalej) albo ostatni (wstecz). */
export function neighbourLot(rows: readonly { lotId: number }[], current: number | null, dir: 1 | -1): number | null {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.lotId === current);
  if (i < 0) return (dir === 1 ? rows[0]! : rows[rows.length - 1]!).lotId;
  return rows[(i + dir + rows.length) % rows.length]!.lotId;
}

/** Przesunięcie palcem (px), od którego karta zmienia lokal. */
export const SWIPE_MIN_PX = 48;

/** Kierunek przesunięcia palcem po karcie: w lewo to następny lokal (1), w prawo poprzedni (−1); krótkie albo bardziej pionowe niż poziome to null. */
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
  return dx < 0 ? 1 : -1;
}

// --- Scena miasta ---------------------------------------------------------------------------------------------------

/** Stany wszystkich lokali dla sceny (`SceneHost.showCity`): także te, które generator oznaczył inaczej niż jest teraz. */
export function cityLotStates(f: FirmState): Record<number, LotState> {
  const states: Record<number, LotState> = {};
  for (const l of f.city.lots) states[l.id] = lotState(f, l.id);
  return states;
}

export interface PinSpec { lotId: number; kind: CityPinKind; label: string }

/**
 * Pinezki mapy dla każdego lokalu poza zwykłym zajętym (tam, gdzie scena ma kotwice): własny sklep (zielony, z numerem), konkurencja z
 * marką, wolny lokal i lokal obok jako kartka z numerem (wybrany dopisuje adres), budowa z licznikiem dni, lokal po Traszce z dopiskiem
 * tekstem (na samej kartce jest za mały). Przedłużenie sklepu po remoncie ma pinezkę bez napisu. Napisy po stronie UI, scena ich nie zna.
 */
export function cityPinSpecs(seed: string, f: FirmState, selected: number | null): PinSpec[] {
  const today = dayOf(activeStore(f).econ.minute);
  const pins: PinSpec[] = [];
  for (const lot of f.city.lots) {
    const state = lotState(f, lot.id);
    switch (state) {
      case 'zajety':
        break;
      case 'twoj': {
        const own = f.stores.find((s) => s.lotId === lot.id);
        pins.push({ lotId: lot.id, kind: 'twoj', label: own ? `Traszka #${own.id}` : '' });
        break;
      }
      case 'konkurencja': {
        const brand = lot.brand ?? 'szop';
        pins.push({ lotId: lot.id, kind: brand, label: brandName(brand) });
        break;
      }
      case 'wolny': {
        const no = numberOf(f.city, lot.id);
        pins.push({ lotId: lot.id, kind: 'wolny', label: selected === lot.id ? `${no} · ${addressText(lot.street, lot.number)}` : String(no) });
        break;
      }
      case 'obok':
        pins.push({ lotId: lot.id, kind: 'wolny', label: t`lokal obok` });
        break;
      case 'budowa': {
        const left = (f.builds.find((b) => b.lotId === lot.id)?.readyDay ?? today) - today;
        pins.push({ lotId: lot.id, kind: 'budowa', label: left > 0 ? t`za ${left} ${plural(left, 'dzień', 'dni', 'dni')}` : t`otwarcie dziś` });
        break;
      }
      case 'po-traszce':
        pins.push({ lotId: lot.id, kind: 'po-traszce', label: t`po Traszce` });
        break;
    }
  }
  return pins;
}

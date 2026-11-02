import { t } from '@/i18n';
import type { CityPinKind } from '@/render/city/cityPins';
import { DISTRICTS } from '@/sim/city/districts';
import { lotById } from '@/sim/city/generateCity';
import { lotEstimate, ownNear, rivalsNear, siteFor, type LotEstimate } from '@/sim/city/traffic';
import type { CityLot, CityState, LotState, RivalBrand, SourceKind, StoreDistrict } from '@/sim/city/types';
import { dayOf } from '@/sim/economy/calendar';
import { HOUR_CURVE, OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import { planFor, type InstallmentPlan } from '@/sim/economy/franchisee';
import { CELL_SIZE_M } from '@/sim/grid';
import { closedStoreAt, lotRentable, lotState, rentBuildDays, rentPrice, rentRefusal } from '@/sim/firm/commands';
import { activeStore, ownLotsOf } from '@/sim/firm/firm';
import type { FirmRefusal, FirmState } from '@/sim/firm/types';
import type { LotKind, StoreLayout } from '@/sim/store/types';
import { plural } from '../game/format';
import { brandName } from './cityText';
import { addressText } from './firmText';

/*
 * Model ekranu Miasta (spec §9.3): wiersze listy wolnych lokali, karta lokalu, poziomy słowami, nawigacja po lokalach i pinezki dla
 * sceny miasta. Czyste funkcje firmy i miasta bez interfejsu; teksty składa `cityText.ts`, a komponenty `CityPanel.tsx` i `LotCard.tsx`.
 */

export type Level = 'niskie' | 'srednie' | 'wysokie';

/**
 * Wiersz listy lokali do wzięcia. `no` to numer lokalu na kartce i na liście: miejsce wśród wolnych lokali z generatora (od 1), więc po
 * wynajęciu jednego numery pozostałych zostają; lokal startowy „po Traszce” nie miał kartki, więc ma 0 (bez numeru). `area` to sala
 * sprzedaży w m² (`interiorWidth × salesDepth` kratek): lokalu wolnego z jego opisu, lokalu „po Traszce” z układu zamkniętego sklepu, który
 * po remontach jest większy niż lokal z poziomu 0 (ten układ otworzy ponowny wynajem). `price` to pakiet otwarcia z reguły wynajmu (`rentPrice`: lokal „po Traszce”
 * ma zniżkę), a `relet` jest ustawione tylko dla lokalu „po Traszce” (zwykły wolny lokal nie ma tego klucza).
 */
export interface LotRow {
  lotId: number; no: number; street: string; number: number; district: StoreDistrict; kind: LotKind; corner: boolean;
  area: number; lo: number; hi: number; price: number; relet?: true;
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

/**
 * Widełki klientów liczą się raz na miasto (`lotEstimate` buduje ekonomię sklepu w lokalu), a ekran pyta o nie przy każdym odświeżeniu.
 * Lokal „po Traszce” ma widełki z układu i wyposażenia zamkniętego sklepu (`ReletInput`, tak otwiera go ponowny wynajem), a to się zmienia
 * z historią lokalu (sklep zamyka się, otwiera znów i zamyka z inną zawartością), więc nie trafia pod klucz `seed:lokal` miasta: wpis
 * z czasów, gdy lokal był wolny, byłby nieaktualny. Ma osobną pamięć, kluczoną układem sklepu (nowy układ po remoncie to nowy obiekt)
 * i odciskiem wyposażenia.
 */
const estimates = new WeakMap<CityState, Map<string, LotEstimate>>();
const reletEstimates = new WeakMap<StoreLayout, Map<string, LotEstimate>>();

/**
 * Własne sklepy firmy, które podbierają klientów lokalowi `lotId` (4b §5.4): otwarte sklepy bliżej niż `OWN_RADIUS_M`, od najbliższego. Lokal
 * startowy nie traci ruchu przez własne sklepy (`siteFor` daje mu `NEUTRAL_SITE`, także po ponownym wynajmie), więc dla niego lista jest pusta
 * i karta nie obiecuje kary, której sim nie nałoży. Z tego samego składu liczy się `own` widełek (`estimateOf`) i wiersz karty (`ownNear`).
 */
export function ownNearLot(f: FirmState, lotId: number): { lotId: number; meters: number }[] {
  return lotId === f.city.startLotId ? [] : ownNear(f.city, lotId, ownLotsOf(f));
}

/**
 * Widełki lokalu `lotId` z kanibalizacją: klucz pamięci obejmuje własne sklepy w promieniu (`own`), bo otwarcie albo zamknięcie sklepu obok zmienia
 * ruch lokalu (i widełki z nim), a miasto zostaje to samo. Badania Sieci widełek nie zmieniają.
 */
function estimateOf(seed: string, f: FirmState, lotId: number): LotEstimate {
  const own = ownNearLot(f, lotId).map((o) => o.lotId);
  const closed = closedStoreAt(f, lotId);
  if (closed) {
    const { upgrades, equipment, remontLevel } = closed.econ;
    const key = `${seed}:${lotId}:${JSON.stringify([remontLevel, upgrades, equipment, own])}`;
    let byKey = reletEstimates.get(closed.layout);
    if (!byKey) reletEstimates.set(closed.layout, byKey = new Map());
    let e = byKey.get(key);
    if (!e) byKey.set(key, e = lotEstimate(seed, f.city, lotId, { layout: closed.layout, fittings: { upgrades, equipment, remontLevel } }, own));
    return e;
  }
  let bySeed = estimates.get(f.city);
  if (!bySeed) estimates.set(f.city, bySeed = new Map());
  const key = `${seed}:${lotId}:${own.join(',')}`;
  let e = bySeed.get(key);
  if (!e) bySeed.set(key, e = lotEstimate(seed, f.city, lotId, undefined, own));
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

function rowOf(seed: string, f: FirmState, lot: CityLot): LotRow {
  const est = estimateOf(seed, f, lot.id);
  const closed = closedStoreAt(f, lot.id);
  const hall = closed ? closed.layout.lot : lot.spec;
  const row: LotRow = {
    lotId: lot.id, no: numberOf(f.city, lot.id), street: lot.street, number: lot.number, district: lot.district, kind: lot.spec.kind,
    corner: lot.spec.corner, area: Math.round(hall.interiorWidth * hall.salesDepth * CELL_SIZE_M * CELL_SIZE_M),
    lo: est.lo, hi: est.hi, price: rentPrice(f, lot.id),
  };
  if (closed) row.relet = true;
  return row;
}

/** Lokale do wzięcia, rosnąco po `id` lokalu: wolne i „po Traszce” (`lotRentable`; jedna reguła wynajmu z firmą). Widełki w pamięci podręcznej miasta. */
export function freeLotRows(seed: string, f: FirmState): LotRow[] {
  return f.city.lots.filter((l) => lotRentable(f, l.id)).map((l) => rowOf(seed, f, l));
}

// --- Profil godzinowy -----------------------------------------------------------------------------------------------

/** Pierwsza i ostatnia godzina profilu z godzin otwarcia (jak w `districts.ts`): sklep sprzedaje 6:00–23:00, więc ostatnia godzina to 22:00 i jest 17 słupków. */
export const FIRST_HOUR = OPEN_FROM / 60;
export const LAST_HOUR = OPEN_TO / 60 - 1;
const HOUR_COUNT = LAST_HOUR - FIRST_HOUR + 1;

/** Klienci na godzinę (od 6 do 22, 17 liczb) w dzień roboczy i, gdy dzielnica ma osobny ruch weekendowy, w weekend (inaczej `null`). */
export interface HourBars { weekday: number[]; weekend: number[] | null }

/**
 * Profil godzinowy lokalu przy środku widełek z karty: kształt dnia z tego samego miejsca, z którego bierze go symulacja (`SiteMods.hours`
 * lokalu z `siteFor`, a bez niego `HOUR_CURVE`, jak `hourCurveOf`; lokal startowy ma `NEUTRAL_SITE`, więc zawsze `HOUR_CURVE`) rozłożony
 * tak, żeby suma godzin dawała środek widełek, więc profil mówi, kiedy klienci przyjdą, a nie ilu ich jest. Weekend to ten sam kształt razy
 * `weekendTraffic / traffic` (Biurowce); dzielnica bez ruchu weekendowego ma `weekend: null`.
 */
export function lotHours(seed: string, f: FirmState, lotId: number): HourBars {
  const lot = lotById(f.city, lotId);
  const d = DISTRICTS[lot.district];
  const est = estimateOf(seed, f, lotId);
  // te same flagi co w `lotEstimate`: godziny nie zależą od flag, ale lokal jest ten sam, co przy widełkach
  const curve = siteFor(f.city, lotId, { extra: true, ownCosts: false, firmDebt: true, weatherHash: null }).hours ?? HOUR_CURVE;
  const shape = Array.from({ length: HOUR_COUNT }, (_, i) => curve[FIRST_HOUR + i] ?? 0);
  const sum = shape.reduce((n, v) => n + v, 0);
  const weekday = shape.map((v) => (est.lo + est.hi) / 2 * v / sum);
  return { weekday, weekend: d.weekendTraffic === null ? null : weekday.map((v) => v * d.weekendTraffic! / d.traffic) };
}

// --- Karta lokalu ---------------------------------------------------------------------------------------------------

export interface LotCardModel {
  row: LotRow;
  /** Dwa najbliższe rodzaje punktów ruchu (słowa daje `sourceText`). */
  who: SourceKind[];
  basket: Level; expectations: Level; theft: Level;
  /** Konkurencja bliżej niż `RIVAL_RADIUS_M`, od najbliższej; odległość w pełnych metrach. */
  rivals: { brand: RivalBrand; meters: number }[];
  /** Własne otwarte sklepy bliżej niż `OWN_RADIUS_M` (4b): każdy zostawia lokalowi `OWN_FACTOR` ruchu. Od najbliższego, metry pełne; lokal startowy ma pustą listę. */
  ownNear: { lotId: number; meters: number }[];
  /** Pakiet otwarcia (`rentPrice`), plan rat z tej ceny (6 albo 12 rat) i dni budowy (`rentBuildDays`). */
  price: number; plan: InstallmentPlan; buildDays: number;
  /** Klienci na godzinę przy środku widełek (`lotHours`). */
  hours: HourBars;
  /** Wyposażenie, które zostało po zamkniętym sklepie (lokal „po Traszce”): poziom remontu, sztuki sprzętu i suma poziomów ulepszeń; wolny lokal ma null. */
  relet: { remontLevel: number; equipment: number; upgrades: number } | null;
  /** Czy „Biorę lokal” działa przy wybranym sposobie zapłaty; jeśli nie, powód odmowy Centrali. */
  action: { enabled: true } | { enabled: false; reason: FirmRefusal };
}

/** Karta lokalu `lotId` (też takiego, którego nie da się wynająć: wtedy `action` niesie powód `lot`). */
export function lotCardModel(seed: string, f: FirmState, lotId: number, pay: 'gotowka' | 'raty'): LotCardModel {
  const lot = lotById(f.city, lotId);
  const d = DISTRICTS[lot.district];
  const reason = rentRefusal(f, lotId, pay);
  const price = rentPrice(f, lotId);
  const closed = closedStoreAt(f, lotId);
  return {
    row: rowOf(seed, f, lot),
    who: estimateOf(seed, f, lotId).who,
    basket: basketLevel(d.basket),
    expectations: expectationsLevel(d.patience, d.repPenalty),
    theft: theftLevel(d.theft),
    rivals: rivalsNear(f.city, lotId).flatMap((r) => (r.lot.brand ? [{ brand: r.lot.brand, meters: Math.round(r.meters) }] : [])),
    ownNear: ownNearLot(f, lotId).map((o) => ({ lotId: o.lotId, meters: Math.round(o.meters) })),
    price,
    plan: planFor(price),
    buildDays: rentBuildDays(f, lotId),
    hours: lotHours(seed, f, lotId),
    relet: closed
      ? { remontLevel: closed.econ.remontLevel, equipment: closed.econ.equipment.length, upgrades: Object.values(closed.econ.upgrades).reduce((n, v) => n + (v ?? 0), 0) }
      : null,
    action: reason === null ? { enabled: true } : { enabled: false, reason },
  };
}

// --- Nawigacja ------------------------------------------------------------------------------------------------------

/** Wybrany lokal, o ile istnieje w tym mieście (id spoza zakresu, np. z poprzedniej gry, to brak wyboru). */
export const validLot = (f: FirmState, lotId: number | null): number | null =>
  lotId !== null && f.city.lots[lotId]?.id === lotId ? lotId : null;

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
 * marką, wolny lokal jako kartka z numerem (wybrany dopisuje adres), lokal obok jako kartka z napisem „lokal obok” (rodzaj `obok`),
 * budowa z licznikiem dni, lokal po Traszce z dopiskiem tekstem (na samej kartce jest za mały). Przedłużenie sklepu po remoncie ma
 * pinezkę bez napisu. Napisy po stronie UI, scena ich nie zna.
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
        pins.push({ lotId: lot.id, kind: 'obok', label: t`lokal obok` });
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

import { createEconomy, expectedDailyCustomers } from '@/sim/economy/economy';
import { NEUTRAL_SITE, type SiteMods } from '@/sim/economy/site';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { createRng, subSeed } from '@/sim/rng';
import { layoutFor } from '@/sim/store/layoutFor';
import { DISTRICTS } from './districts';
import type { CityLot, CityState, SourceKind, StoreDistrict, StreetSegment, TrafficSource } from './types';

/*
 * Ruch w mieście (spec §7.3). Punkty ruchu (`CityState.sources`) mają profil godzinowy i tygodniowy; natężenie odcinka ulicy to suma
 * ich wpływów malejących z odległością. Mnożnik ruchu lokalu to iloczyn trzech czynników i mnoży `baseTraffic(info)` (rodzaj i
 * wielkość lokalu już tam siedzą): dzielnica, natężenie przy wejściu względem średniej dzielnicy i konkurencja w promieniu.
 * `siteFor` składa z tego `SiteMods` sklepu w lokalu, a `lotEstimate` widełki klientów na karcie lokalu.
 *
 * Moduł nie importuje `generateCity.ts` (generator woła `streetIntensity`), więc lokal po id szuka sam. Arytmetyka tylko z
 * działań IEEE (+, −, ·, /, sqrt), bez `Math.hypot` i `**`: wynik wchodzi do ekonomii, a serwer i przeglądarka muszą liczyć to samo.
 */

export const RIVAL_RADIUS_M = 250;
export const RIVAL_FACTOR = 0.8;
export const LOCAL_RANGE = [0.85, 1.15] as const;
export const ESTIMATE_SPREAD = 0.25;            // widełki ±25%
export const ESTIMATE_SHIFT = 0.15;             // środek przesunięty o ≤ 15% (deterministycznie)

export const SOURCE_KINDS: readonly SourceKind[] = ['przystanek', 'szkola', 'uczelnia', 'biurowiec', 'dworzec', 'osiedle'];

/** Ulica jest „blisko” punktu ruchu w skali tylu metrów: wpływ spada jak 1 / (1 + (d / FALLOFF_M)²), czyli o połowę w tej odległości. */
const FALLOFF_M = 120;
/**
 * Suma wpływów (waga × profil × spadek) → 0–255. Stała skala, nie normalizacja po mieście, żeby „Ruch” znaczył to samo w każdym
 * mieście i w każdej godzinie. Najruchliwszy odcinek ma w mieście sumę 8–14 (zmierzone na 140 seedach), czyli 150–255; po zmianie wag
 * punktów albo profili trzeba skalę przestroić.
 */
const INTENSITY_SCALE = 18;
const HOURS = 24;

// --- Profile punktów ruchu ------------------------------------------------------------------------------------

type Day = readonly number[];   // 24 liczby z [0, 1]: godzina 0…23

/** Profil dnia roboczego i weekendu (sobota i niedziela razem) każdego rodzaju punktu; 1 = szczyt tego punktu. */
const PROFILES: Record<SourceKind, { weekday: Day; weekend: Day }> = {
  // dojazdy rano i po południu, między nimi spokojniej; w weekend płasko i mniej
  przystanek: {
    weekday: [0, 0, 0, 0, 0, 0.1, 0.5, 0.9, 1, 0.6, 0.4, 0.4, 0.5, 0.5, 0.6, 0.9, 1, 1, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05],
    weekend: [0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.4, 0.4, 0.3, 0.2, 0.1, 0.05],
  },
  // przyjście na 8:00, przerwy obiadowe i wyjście po 13:00; w weekend nikogo
  szkola: {
    weekday: [0, 0, 0, 0, 0, 0, 0, 0.8, 1, 0.1, 0.1, 0.2, 0.5, 0.9, 1, 0.6, 0.2, 0.1, 0, 0, 0, 0, 0, 0],
    weekend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // zajęcia cały dzień do wieczora, w weekend zaoczni
  uczelnia: {
    weekday: [0, 0, 0, 0, 0, 0, 0, 0.2, 0.7, 1, 0.9, 0.9, 1, 0.9, 0.9, 0.8, 0.7, 0.5, 0.4, 0.3, 0.15, 0, 0, 0],
    weekend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.25, 0.25, 0.25, 0.25, 0.15, 0.1, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // szczyty 7–9 i 12–14, pusto po 18; w weekend rano garstka, po południu nikogo
  biurowiec: {
    weekday: [0, 0, 0, 0, 0, 0, 0.2, 0.8, 1, 0.9, 0.5, 0.5, 0.9, 1, 0.8, 0.5, 0.5, 0.4, 0.1, 0, 0, 0, 0, 0],
    weekend: [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  // szczyty dojazdów, w nocy resztki, w weekend płasko przez cały dzień
  dworzec: {
    weekday: [0.05, 0.05, 0.05, 0.05, 0.05, 0.3, 0.7, 1, 1, 0.7, 0.5, 0.5, 0.6, 0.6, 0.6, 0.8, 1, 1, 1, 0.8, 0.6, 0.5, 0.4, 0.2],
    weekend: [0.05, 0.05, 0.05, 0.05, 0.05, 0.3, 0.55, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.55, 0.5, 0.4, 0.2],
  },
  // rano wyjścia do pracy, wieczorem powroty; w weekend południe i wieczór
  osiedle: {
    weekday: [0, 0, 0, 0, 0, 0.15, 0.4, 0.7, 0.6, 0.3, 0.3, 0.35, 0.4, 0.4, 0.4, 0.5, 0.7, 0.9, 1, 0.9, 0.7, 0.5, 0.3, 0.1],
    weekend: [0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8, 0.9, 1, 0.9, 0.8, 0.6, 0.4, 0.2, 0.1],
  },
};

/** Profil punktu w godzinie `hour` (0–23, poza zakresem liczy się modulo doby) w dniu roboczym albo w weekend; z [0, 1]. */
export function sourceProfile(kind: SourceKind, hour: number, weekend: boolean): number {
  const h = ((Math.floor(hour) % HOURS) + HOURS) % HOURS;
  return PROFILES[kind][weekend ? 'weekend' : 'weekday'][h]!;
}

/** Średni profil doby w tygodniu (5 dni roboczych, 2 weekendowe): z tego liczy się natężenie przy wejściu lokalu. */
const MEAN_PROFILE: Record<SourceKind, number> = (() => {
  const mean = (d: Day): number => d.reduce((n, v) => n + v, 0) / HOURS;
  const out = {} as Record<SourceKind, number>;
  for (const k of SOURCE_KINDS) out[k] = (5 * mean(PROFILES[k].weekday) + 2 * mean(PROFILES[k].weekend)) / 7;
  return out;
})();

// --- Natężenie ulic ----------------------------------------------------------------------------------------------

const falloff = (d2: number): number => 1 / (1 + d2 / (FALLOFF_M * FALLOFF_M));

/** Kwadrat odległości punktu od odcinka ulicy (m²). */
function segmentDist2(px: number, py: number, s: StreetSegment): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / (dx * dx + dy * dy)));
  const ex = px - (s.ax + t * dx);
  const ey = py - (s.ay + t * dy);
  return ex * ex + ey * ey;
}

/**
 * Natężenie odcinka w godzinie `hour` dnia roboczego albo weekendu, liczba całkowita z 0–255: suma po punktach ruchu
 * `weight × sourceProfile / (1 + (d / 120 m)²)`, gdzie d to odległość punktu od odcinka. `CityState.streets[i].hourly` to dzień roboczy;
 * weekend liczy się stąd z `weekend = true`.
 */
export function streetIntensity(sources: readonly TrafficSource[], segment: StreetSegment, hour: number, weekend: boolean): number {
  let raw = 0;
  for (const p of sources) {
    const profile = sourceProfile(p.kind, hour, weekend);
    if (profile > 0) raw += p.weight * profile * falloff(segmentDist2(p.x, p.y, segment));
  }
  return Math.min(255, Math.round(raw * INTENSITY_SCALE));
}

// --- Lokal -------------------------------------------------------------------------------------------------------

function lotOf(city: CityState, lotId: number): CityLot {
  const lot = city.lots[lotId];
  if (!lot || lot.id !== lotId) throw new RangeError(`lokal ${lotId} nie istnieje`);
  return lot;
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/** Średnia doba (tydzień) natężenia przy wejściu lokalu: suma po punktach `weight × średni profil × spadek z odległości`. */
function entranceIntensity(city: CityState, lot: CityLot): number {
  let sum = 0;
  for (const p of city.sources) sum += p.weight * MEAN_PROFILE[p.kind] * falloff(dist2(p, lot));
  return sum;
}

/**
 * Natężenie lokalne (0,85–1,15): średnia doba natężenia przy wejściu lokalu względem średniej lokali jego dzielnicy. Średni lokal
 * dzielnicy ma 1, najgorszy 0,85, najlepszy 1,15, pomiędzy liniowo. Lokal startowy to z definicji 1 (§8.3).
 */
export function lotLocalFactor(city: CityState, lotId: number): number {
  const lot = lotOf(city, lotId);
  if (lotId === city.startLotId) return 1;
  const peers = city.lots.filter((l) => l.district === lot.district).map((l) => entranceIntensity(city, l));
  const mean = peers.reduce((n, v) => n + v, 0) / peers.length;
  const v = entranceIntensity(city, lot);
  const [lo, hi] = LOCAL_RANGE;
  let f = 1;
  if (v > mean) {
    const max = Math.max(...peers);
    f = 1 + (hi - 1) * ((v - mean) / (max - mean));
  } else if (v < mean) {
    const min = Math.min(...peers);
    f = 1 - (1 - lo) * ((mean - v) / (mean - min));
  }
  return Math.min(hi, Math.max(lo, f));
}

/** Konkurencja bliżej niż `RIVAL_RADIUS_M` od wejścia lokalu, od najbliższej; lokal nie jest własnym rywalem. */
export function rivalsNear(city: CityState, lotId: number): { lot: CityLot; meters: number }[] {
  const lot = lotOf(city, lotId);
  const out: { lot: CityLot; meters: number }[] = [];
  for (const o of city.lots) {
    if (o.id === lotId || o.state !== 'konkurencja') continue;
    const d2 = dist2(o, lot);
    if (d2 < RIVAL_RADIUS_M * RIVAL_RADIUS_M) out.push({ lot: o, meters: Math.sqrt(d2) });
  }
  return out.sort((p, q) => p.meters - q.meters || p.lot.id - q.lot.id);
}

/** Natężenie lokalne razem z konkurencją, bez dzielnicy: czynnik, przez który `siteFor` mnoży ruch dzielnicy i jej ruch weekendowy. */
function lotFactor(city: CityState, lotId: number): number {
  let f = lotLocalFactor(city, lotId);
  for (let i = rivalsNear(city, lotId).length; i > 0; i--) f *= RIVAL_FACTOR;   // pętla zamiast `**`: ten sam wynik w każdym silniku
  return f;
}

/**
 * Mnożnik ruchu lokalu (dni robocze): ruch dzielnicy × natężenie lokalne × 0,8 za każdego rywala w promieniu. Mnoży
 * `baseTraffic(info)`. Lokal startowy to 1 (§8.3): sklep startowy gra bez `site`, więc rywal w pobliżu nie zmienia jego ruchu.
 */
export function lotTrafficMult(city: CityState, lotId: number): number {
  const lot = lotOf(city, lotId);
  if (lotId === city.startLotId) return 1;
  return DISTRICTS[lot.district].traffic * lotFactor(city, lotId);
}

/** Seed sklepu w lokalu miasta (sklep startowy ma seed gry). */
export function storeSeedFor(seed: string, lotId: number): string {
  return subSeed(seed, `store:${lotId}`);
}

// Ekonomia nie importuje miasta, więc `SiteMods.district` powtarza unię `StoreDistrict`; to niedopasowanie ma nie przejść kompilacji.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
export type SiteDistrictMatchesStoreDistrict = AssertTrue<Equal<SiteMods['district'], StoreDistrict>>;

export type SiteFlags = Pick<SiteMods, 'extra' | 'ownCosts' | 'firmDebt' | 'weatherHash'>;

/**
 * `SiteMods` sklepu w lokalu miasta: charakter dzielnicy z `DISTRICTS`, ruch z `lotTrafficMult` (w weekend Biurowców ruch
 * weekendowy dzielnicy z tym samym natężeniem lokalnym i konkurencją), układ z lokalu i flagi od firmy. Lokal startowy to
 * `NEUTRAL_SITE` z flagami: sklep startowy gra jak dziś.
 */
export function siteFor(city: CityState, lotId: number, flags: SiteFlags): SiteMods {
  const lot = lotOf(city, lotId);
  if (lotId === city.startLotId) return { ...NEUTRAL_SITE, ...flags };
  const d = DISTRICTS[lot.district];
  const factor = lotFactor(city, lotId);
  return {
    district: lot.district,
    traffic: d.traffic * factor,
    weekendTraffic: d.weekendTraffic === null ? null : d.weekendTraffic * factor,
    basket: d.basket, patience: d.patience, repPenalty: d.repPenalty, theft: d.theft,
    lot: lot.spec,
    ...flags,
  };
}

// --- Widełki klientów --------------------------------------------------------------------------------------------

export interface LotEstimate { lo: number; hi: number; trueDaily: number; who: SourceKind[] }

const TEN = 10;

/**
 * Widełki klientów dziennie na karcie lokalu. `trueDaily` to `expectedDailyCustomers` sklepu z tego lokalu (układ z lokalu, flagi
 * dodatkowego sklepu, ruch z `siteFor`): skala SIM 6, na start ok. 300–350. Środek widełek jest przesunięty o ≤ 15% (deterministycznie
 * z seeda i lokalu), żeby karta nie zdradzała liczby, a szerokość to ±25% od środka. Prawdziwa liczba zawsze mieści się w widełkach:
 * środek to 0,85…1,15 jej wartości, więc dolna granica jest najwyżej 0,8625 jej wartości, a górna co najmniej 1,0625; zaokrąglenie do
 * dziesiątek mógłby ten zapas zjeść poniżej ok. 80 klientów dziennie, więc granice nigdy nie przechodzą przez prawdziwą liczbę. `who` to dwa najbliższe rodzaje punktów ruchu (słowa daje UI).
 */
export function lotEstimate(seed: string, city: CityState, lotId: number): LotEstimate {
  const lot = lotOf(city, lotId);
  const storeSeed = lotId === city.startLotId ? seed : storeSeedFor(seed, lotId);
  const site = siteFor(city, lotId, { extra: true, ownCosts: false, firmDebt: true, weatherHash: null });
  const info: StoreInfo = { ...computeStoreInfo(layoutFor(storeSeed, 0, lot.spec)), site };
  const trueDaily = expectedDailyCustomers(createEconomy(storeSeed, info), info);

  const u = createRng(subSeed(seed, `estimate:${lotId}`)).next();
  const mid = trueDaily * (1 + (2 * u - 1) * ESTIMATE_SHIFT);

  const nearest = new Map<SourceKind, number>();
  for (const p of city.sources) {
    const d2 = dist2(p, lot);
    if (d2 < (nearest.get(p.kind) ?? Infinity)) nearest.set(p.kind, d2);
  }
  const who = SOURCE_KINDS.filter((k) => nearest.has(k)).sort((p, q) => nearest.get(p)! - nearest.get(q)!).slice(0, 2);

  return {
    lo: Math.min(Math.round(mid * (1 - ESTIMATE_SPREAD) / TEN), Math.floor(trueDaily / TEN)) * TEN,
    hi: Math.max(Math.round(mid * (1 + ESTIMATE_SPREAD) / TEN), Math.ceil(trueDaily / TEN)) * TEN,
    trueDaily, who,
  };
}

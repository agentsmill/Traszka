import { HOUR_CURVE } from '@/sim/economy/catalog';
import { NEUTRAL_SITE, type SiteMods } from '@/sim/economy/site';
import { LOT_RANGES } from '@/sim/store/lots';
import type { LotKind, LotSpec } from '@/sim/store/types';
import type { StoreDistrict } from './types';

/** Kwartał z ulicą, w metrach: ulica biegnie wzdłuż północnej i zachodniej krawędzi kwartału (osie siatki miasta co `BLOCK_M`). */
export const BLOCK_M = 110;

/**
 * Charakter dzielnicy (spec §8.1, pakiet i budowa §10.3). Liczby [C] po przeglądzie balansu na botach (`tests/districtBalance.test.ts`,
 * raport `docs/superpowers/reports/2026-10-31-miasto-4a1.md`); zmiana `package`, `buildDays` albo `rivals` zmienia złoty skrót miasta.
 * Mnożniki ekonomii (`traffic`, `basket`, `patience`, `repPenalty`, `theft`), profil dnia (`hours`) i trudni klienci (`difficult`) wchodzą do
 * ekonomii przez opcjonalne `StoreInfo.site`; dzielnica neutralna (Osiedle) to dokładnie dzisiejsza gra.
 */
export interface DistrictDef {
  /** Format lokalu w tej dzielnicy (spec §7.1): parter bloku, narożnik kamienicy, pawilon, parter biurowca. */
  lotKind: LotKind;
  /** Mnożnik ruchu w dni robocze; `weekendTraffic` w weekend (null = tak samo). */
  traffic: number;
  weekendTraffic: number | null;
  /** Mnożnik koszyka (zł na klienta). */
  basket: number;
  /** Zmiana cierpliwości klientów w osobach w kolejce (ujemna = wymagający). */
  patience: number;
  /** Mnożnik kar reputacji za pustą półkę, brud i kolejkę. */
  repPenalty: number;
  /** Mnożnik kradzieży (ukryty licznik ubytków). */
  theft: number;
  /** Czy generator stawia tu sklepy konkurencji (Szop 24h, Kawka Express; spec §7.1); ich bliskość daje czynnik `RIVAL_FACTOR` w ruchu lokalu. Osiedle ich nie ma. */
  rivals: boolean;
  /** Widełki pakietu otwarcia w zł i dni budowy (włącznie). */
  package: readonly [number, number];
  buildDays: readonly [number, number];
  /**
   * Profil dnia (§8.1, 4a.2): surowy kształt natężenia ruchu w godzinach 6–22 (17 liczb, tylko proporcje). `siteHours` normalizuje go do
   * sumy `HOUR_CURVE`, więc zmienia rozkład klientów w dobie, nie ich liczbę. Ten sam kształt w każdym dniu (weekend Biurowców to
   * ten kształt razy `weekendTraffic`). null = `HOUR_CURVE`, jak dziś. Liczby startowe [C], stroi je przegląd 4a.2; szczyt Biurowców
   * jest niższy niż w pierwszym szkicu (2 → 1,75), bo przy ostrzejszych kasy nie nadążały i decydent miał 0,62 wyniku Osiedla (cel ≥ 0,7).
   */
  hours: readonly number[] | null;
  /**
   * Trudni klienci (§8.1, 4a.2): mnożnik wagi karty `wiek` w talii sklepu (`difficultWeight`): Dworzec częściej, Śródmieście i Biurowce rzadziej,
   * Osiedle jak dziś (1). Dworzec ma poza tym trzy własne karty (`DWORZEC_CARD_IDS`). Liczby startowe [C], stroi je przegląd 4a.2.
   */
  difficult: number;
}

export const DISTRICTS: Record<StoreDistrict, DistrictDef> = {
  osiedle:     { lotKind: 'blok',      traffic: 1,   weekendTraffic: null, basket: 1,    patience: 0,  repPenalty: 1,   theft: 1,   rivals: false, package: [45_000, 55_000], buildDays: [5, 6], hours: null, difficult: 1 },
  srodmiescie: { lotKind: 'kamienica', traffic: 0.8, weekendTraffic: null, basket: 1.3,  patience: -4, repPenalty: 1.5, theft: 0.6, rivals: true,  package: [65_000, 85_000], buildDays: [7, 8], hours: [0.3, 0.8, 1, 0.8, 0.7, 0.8, 1, 1, 0.8, 0.9, 1.1, 1.4, 1.6, 1.6, 1.4, 1.1, 0.8], difficult: 0.6 },
  dworzec:     { lotKind: 'pawilon',   traffic: 1.4, weekendTraffic: null, basket: 0.8,  patience: 1,  repPenalty: 1,   theft: 2,   rivals: true,  package: [35_000, 42_000], buildDays: [5, 6], hours: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], difficult: 1.6 },
  biurowce:    { lotKind: 'blok',      traffic: 1.2, weekendTraffic: 0.5,  basket: 1.1,  patience: 0,  repPenalty: 1,   theft: 0.8, rivals: true,  package: [50_000, 60_000], buildDays: [6, 7], hours: [0.45, 1.45, 1.75, 1.45, 0.9, 0.95, 1.55, 1.55, 1.2, 0.9, 0.85, 0.8, 0.4, 0.15, 0.1, 0.1, 0.1], difficult: 0.7 },
};

const FIRST_HOUR = 6;
const LAST_HOUR = 22;

/** Profile dnia dzielnic po normalizacji (`SiteMods.hours`), liczone raz: 24 liczby, 0 poza 6–22, suma 6–22 jak `HOUR_CURVE`. */
const SITE_HOURS: Record<StoreDistrict, readonly number[] | null> = (() => {
  let curveSum = 0;
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) curveSum += HOUR_CURVE[h] ?? 0;
  const out = {} as Record<StoreDistrict, readonly number[] | null>;
  for (const id of Object.keys(DISTRICTS) as StoreDistrict[]) {
    const raw = DISTRICTS[id].hours;
    if (raw === null) { out[id] = null; continue; }
    const rawSum = raw.reduce((n, v) => n + v, 0);
    const day = new Array<number>(24).fill(0);
    raw.forEach((v, i) => { day[FIRST_HOUR + i] = v * curveSum / rawSum; });
    out[id] = Object.freeze(day);
  }
  return out;
})();

/**
 * Profil dnia dzielnicy dla `SiteMods.hours`: kształt `DISTRICTS[d].hours` w godzinach 0–23 (0 poza 6–22) przeskalowany tak, żeby suma
 * godzin 6–22 była sumą `HOUR_CURVE` (profil zmienia rozkład klientów, nie dobę; §8.1). null = `HOUR_CURVE` (Osiedle).
 * Zamrożona tablica, ta sama przy każdym wywołaniu.
 */
export function siteHours(d: StoreDistrict): readonly number[] | null {
  return SITE_HOURS[d];
}

const mid = ([lo, hi]: [number, number]): number => Math.round((lo + hi) / 2);

/**
 * `SiteMods` drugiego sklepu w dzielnicy na potrzeby balansu (spec §8.4): charakter dzielnicy z `DISTRICTS`, natężenie lokalne 1
 * i brak rywali (czyli sam ruch dzielnicy), lokal o wymiarach ze środka widełek `lotKind` (domyślnie format dzielnicy) i flagi
 * dodatkowego sklepu z firmy (§11.2, §11.4). Osiedle daje neutralne liczby z flagami; boty z `playBot` grają nim drugi sklep.
 */
export function districtSite(d: StoreDistrict, lotKind: LotKind = DISTRICTS[d].lotKind): SiteMods {
  const def = DISTRICTS[d];
  const r = LOT_RANGES[lotKind];
  const lot: LotSpec = {
    kind: lotKind, interiorWidth: mid(r.interiorWidth), salesDepth: mid(r.salesDepth), backroomDepth: mid(r.backroomDepth), corner: false,
  };
  return {
    ...NEUTRAL_SITE, district: d, traffic: def.traffic, weekendTraffic: def.weekendTraffic, basket: def.basket, patience: def.patience,
    repPenalty: def.repPenalty, theft: def.theft, lot, hours: siteHours(d), difficult: def.difficult, extra: true, ownCosts: false,
    firmDebt: true,
  };
}

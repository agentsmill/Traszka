import { NEUTRAL_SITE, type SiteMods } from '@/sim/economy/site';
import { LOT_RANGES } from '@/sim/store/lots';
import type { LotKind, LotSpec } from '@/sim/store/types';
import type { StoreDistrict } from './types';

/** Kwartał z ulicą, w metrach: ulica biegnie wzdłuż północnej i zachodniej krawędzi kwartału (osie siatki miasta co `BLOCK_M`). */
export const BLOCK_M = 110;

/**
 * Charakter dzielnicy (spec §8.1, pakiet i budowa §10.3). Liczby [C] po przeglądzie balansu na botach (`tests/districtBalance.test.ts`,
 * raport `docs/superpowers/reports/2026-10-31-miasto-4a1.md`); zmiana `package`, `buildDays` albo `rivals` zmienia złoty skrót miasta.
 * Mnożniki ekonomii (`traffic`, `basket`, `patience`, `repPenalty`, `theft`) wchodzą do ekonomii przez opcjonalne `StoreInfo.site`;
 * dzielnica neutralna (Osiedle) to dokładnie dzisiejsza gra.
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
  /** Czy generator stawia tu sklepy konkurencji (spec §7.1, „lokale z dużym ruchem”); ich bliskość daje czynnik `RIVAL_FACTOR` w ruchu lokalu. */
  rivals: boolean;
  /** Widełki pakietu otwarcia w zł i dni budowy (włącznie). */
  package: readonly [number, number];
  buildDays: readonly [number, number];
}

export const DISTRICTS: Record<StoreDistrict, DistrictDef> = {
  osiedle:     { lotKind: 'blok',      traffic: 1,   weekendTraffic: null, basket: 1,    patience: 0,  repPenalty: 1,   theft: 1,   rivals: false, package: [45_000, 55_000], buildDays: [5, 6] },
  srodmiescie: { lotKind: 'kamienica', traffic: 0.8, weekendTraffic: null, basket: 1.3,  patience: -4, repPenalty: 1.5, theft: 0.6, rivals: true,  package: [65_000, 85_000], buildDays: [7, 8] },
  dworzec:     { lotKind: 'pawilon',   traffic: 1.4, weekendTraffic: null, basket: 0.8,  patience: 1,  repPenalty: 1,   theft: 2,   rivals: true,  package: [35_000, 42_000], buildDays: [5, 6] },
  biurowce:    { lotKind: 'blok',      traffic: 1.2, weekendTraffic: 0.5,  basket: 1.1,  patience: 0,  repPenalty: 1,   theft: 0.8, rivals: true,  package: [50_000, 60_000], buildDays: [6, 7] },
};

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
    repPenalty: def.repPenalty, theft: def.theft, lot, extra: true, ownCosts: false, firmDebt: true,
  };
}

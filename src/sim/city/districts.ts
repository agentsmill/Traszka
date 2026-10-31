import type { LotKind } from '@/sim/store/types';
import type { StoreDistrict } from './types';

/** Kwartał z ulicą, w metrach: ulica biegnie wzdłuż północnej i zachodniej krawędzi kwartału (osie siatki miasta co `BLOCK_M`). */
export const BLOCK_M = 110;

/**
 * Charakter dzielnicy (spec §8.1, pakiet i budowa §10.3). Liczby [C], do strojenia w przeglądzie balansu (zmiana `package` i `buildDays`
 * zmienia złoty skrót miasta). Mnożniki ekonomii (`traffic`, `basket`, `patience`, `repPenalty`, `theft`) wchodzą do ekonomii przez
 * opcjonalne `StoreInfo.site`; dzielnica neutralna (Osiedle) to dokładnie dzisiejsza gra.
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
  /** Widełki pakietu otwarcia w zł i dni budowy (włącznie). */
  package: readonly [number, number];
  buildDays: readonly [number, number];
}

export const DISTRICTS: Record<StoreDistrict, DistrictDef> = {
  osiedle:     { lotKind: 'blok',      traffic: 1,   weekendTraffic: null, basket: 1,    patience: 0,  repPenalty: 1,   theft: 1,   package: [45_000, 55_000], buildDays: [5, 6] },
  srodmiescie: { lotKind: 'kamienica', traffic: 1.1, weekendTraffic: null, basket: 1.35, patience: -2, repPenalty: 1.5, theft: 0.6, package: [65_000, 85_000], buildDays: [7, 8] },
  dworzec:     { lotKind: 'pawilon',   traffic: 1.4, weekendTraffic: null, basket: 0.8,  patience: 1,  repPenalty: 1,   theft: 1.8, package: [35_000, 42_000], buildDays: [5, 6] },
  biurowce:    { lotKind: 'blok',      traffic: 1.2, weekendTraffic: 0.5,  basket: 1.1,  patience: 0,  repPenalty: 1,   theft: 0.8, package: [50_000, 60_000], buildDays: [6, 7] },
};

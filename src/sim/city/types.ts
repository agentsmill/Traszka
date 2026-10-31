import type { LotSpec } from '@/sim/store/types';

/**
 * Wersja algorytmu miasta. Miasto jest czystą funkcją (seed, wersja), więc zmiana wyglądu miasta dla tego samego seeda
 * (złoty skrót w `generateCity.test.ts`) wymaga jej podbicia. Zapis gry nie niesie miasta, tylko zmiany stanów lokali (§7.4).
 */
export const CITY_GENERATOR_VERSION = 1;
export const CITY_SIZE = 6;                       // 6×6 kwartałów

export type DistrictId = 'osiedle' | 'srodmiescie' | 'dworzec' | 'biurowce' | 'park';
/** Dzielnica z lokalami: park ich nie ma. */
export type StoreDistrict = Exclude<DistrictId, 'park'>;
/** Stan lokalu w grze (liczy go `lotState` z firmy); generator ustawia tylko pierwsze pięć (`CityLot.state`), budowę i „po Traszce” dopisuje gra. */
export type LotState = 'zajety' | 'wolny' | 'konkurencja' | 'twoj' | 'obok' | 'budowa' | 'po-traszce';
export type RivalBrand = 'szop' | 'kawka';        // „Szop 24h”, „Kawka Express”: tekst marki składa dopiero UI
export type SourceKind = 'przystanek' | 'szkola' | 'uczelnia' | 'biurowiec' | 'dworzec' | 'osiedle';

export interface CityLot {
  id: number; bx: number; by: number;             // kwartał
  x: number; y: number;                           // wejście w metrach, liczby całkowite
  street: string; number: number;                 // adres składa UI
  spec: LotSpec; district: StoreDistrict;
  state: 'zajety' | 'wolny' | 'konkurencja' | 'twoj' | 'obok';   // stan z generatora; stan w grze daje `lotState` (Zad. 5)
  brand: RivalBrand | null;
  package: number; buildDays: number;             // pakiet otwarcia (zł, co 100) i dni budowy
}

export interface TrafficSource { kind: SourceKind; x: number; y: number; weight: number }
/** `hourly`: natężenie dnia roboczego w godzinach 0–23, liczby całkowite 0–255 (`streetIntensity` w traffic.ts liczy też weekend). */
export interface StreetSegment { id: number; name: string; ax: number; ay: number; bx: number; by: number; hourly: number[] }

export interface CityState {
  version: number; name: string;
  blocks: DistrictId[];                           // CITY_SIZE², wierszami (by * CITY_SIZE + bx)
  streets: StreetSegment[]; sources: TrafficSource[];
  lots: CityLot[]; startLotId: number; neighbourLotId: number | null;
}

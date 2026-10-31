import type { LotSpec } from '@/sim/store/types';
import type { StoreInfo } from './storeInfo';
import { dayTrafficMult } from './tycoon/sunday';
import { weekdayOf } from './tycoon/time';

/*
 * Dzielnica i flagi dodatkowego sklepu (spec §8.3, §10.4, §11.2, §11.4) jako opcjonalne `StoreInfo.site`. `StoreInfo` nie jest częścią
 * stanu gry, więc pole nie zmienia kształtu `EconomyState`. Moduł nie zna miasta (`src/sim/city`): sędzia rankingu sięga do ekonomii,
 * a do miasta nie wolno mu sięgać. Miasto składa `SiteMods` ze swoich liczb (`siteFor`), a ekonomia je tylko czyta.
 *
 * Zasada neutralności: brak pola to dzisiejsza gra co do bitu. Modyfikatory dzielnicy stoją za gałęzią (`activeSite`), nigdy
 * jako mnożnik przez 1; flagi (`extra`, `ownCosts`, `firmDebt`) czyta się wprost z `info.site?.…`, bo ich wartość domyślna
 * to dzisiejsze zachowanie.
 */

export interface SiteMods {
  district: 'osiedle' | 'srodmiescie' | 'dworzec' | 'biurowce';
  /** Ruch w dni robocze: dzielnica × natężenie lokalne × konkurencja. */
  traffic: number;
  /** Sobota i niedziela zamiast `traffic` i bez premii niedzieli (Biurowce); null = jak w dni robocze, z premią niedzieli. */
  weekendTraffic: number | null;
  /** Obrót i marża z klienta (poziom cen); zużycie towaru bez zmian. */
  basket: number;
  /** Zmiana cierpliwości w osobach w kolejce. */
  patience: number;
  /** Mnożnik ujemnych zmian reputacji (puste półki, brud, kolejka). */
  repPenalty: number;
  /** Mnożnik kradzieży: WUT `kradziez` i ubytek na kasach samoobsługowych. */
  theft: number;
  /** Lokal dla `layoutFor` po remoncie; null = `pickLot(seed)`. */
  lot: LotSpec | null;
  /** Pogoda miasta (`seedHash` sklepu #1); null = własny `seedHash`. */
  weatherHash: number | null;
  /** Dodatkowy sklep: bez gwarancji (§11.2). */
  extra: boolean;
  /** Ten sklep płaci ZUS i księgową (§11.2). */
  ownCosts: boolean;
  /** Debet sprawdza firma, nie sklep (§11.4). */
  firmDebt: boolean;
}

/** Osiedle bez żadnego modyfikatora: gra jak dziś. */
export const NEUTRAL_SITE: SiteMods = {
  district: 'osiedle', traffic: 1, weekendTraffic: null, basket: 1, patience: 0, repPenalty: 1, theft: 1, lot: null, weatherHash: null,
  extra: false, ownCosts: true, firmDebt: false,
};

/**
 * Dzielnica sklepu, o ile zmienia on ekonomię: null przy braku `site` i przy polach dzielnicy, `lot` i `weatherHash` neutralnych
 * (same flagi nie włączają gałęzi dzielnicy). Wszystkie modyfikatory dzielnicy w `economy.ts` stoją za tym wynikiem.
 */
export function activeSite(info: StoreInfo): SiteMods | null {
  const s = info.site;
  if (!s) return null;
  const neutral = s.traffic === 1 && s.weekendTraffic === null && s.basket === 1 && s.patience === 0 && s.repPenalty === 1
    && s.theft === 1 && s.lot === null && s.weatherHash === null;
  return neutral ? null : s;
}

/**
 * Mnożnik ruchu w dniu `day`: ruch dzielnicy razem z premią niedzieli (`dayTrafficMult`); sobota i niedziela z `weekendTraffic`
 * (Biurowce) mają tylko ten mnożnik, bez premii.
 */
export function siteDayTraffic(site: SiteMods, day: number): number {
  const weekday = weekdayOf(day);
  if (site.weekendTraffic !== null && (weekday === 0 || weekday === 6)) return site.weekendTraffic;
  return site.traffic * dayTrafficMult(day);
}

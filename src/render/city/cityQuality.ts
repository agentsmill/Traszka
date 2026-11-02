import type { QualityPresetId } from '@/render/quality';
import type { CityDetail, CityLayer } from './buildCity';

/**
 * Profile jakości sceny miasta (spec §19, rozstrzygnięcia 10–12): co miasto dostaje na danym sprzęcie. Telefon wygrywa z presetem
 * (profil „telefon” to Niska w mieście także przy wybranej Wysokiej), bo budżet pamięci i rysowania zależy od urządzenia, a nie od
 * suwaka. Liczby progów (cienie i auta od Średniej, zwalnianie sceny tam, gdzie zaczynamy od prostej geometrii) stroi bramka z
 * prawdziwych urządzeń (`?bench=1`), a nie headless.
 */
export interface CityProfile {
  /** Czy w ogóle jest tryb „Makieta” (przycisk i pełna geometria). */
  mockup: boolean;
  /** Tryb mapy, w którym miasto otwiera się na starcie gry. */
  defaultLayer: CityLayer;
  /** Auta na ulicach makiety (tylko w makiecie). */
  cars: boolean;
  /** Cienie makiety: wyłączone albo jedna mapa odświeżana tylko przy zmianie sceny, pory dnia i presetu (`RenderContext.setStaticShadows`). */
  shadows: 'off' | 'static';
  /** Pierwsza geometria przy otwarciu miasta w warstwie: `prosty` oszczędza telefon, pełna powstaje dopiero po „Makieta”. */
  firstDetail: CityDetail;
  /** Scena miasta zwalnia się po wyjściu z zakładki (słaby sprzęt nie trzyma jej w pamięci). */
  releaseOnExit: boolean;
}

const profile = (p: CityProfile): CityProfile => Object.freeze(p);

export const CITY_PROFILES: Readonly<Record<QualityPresetId | 'telefon', CityProfile>> = Object.freeze({
  telefon: profile({ mockup: true, defaultLayer: 'ruch', cars: false, shadows: 'off', firstDetail: 'prosty', releaseOnExit: true }),
  niska: profile({ mockup: true, defaultLayer: 'ruch', cars: false, shadows: 'off', firstDetail: 'prosty', releaseOnExit: true }),
  srednia: profile({ mockup: true, defaultLayer: 'makieta', cars: true, shadows: 'static', firstDetail: 'pelny', releaseOnExit: false }),
  wysoka: profile({ mockup: true, defaultLayer: 'makieta', cars: true, shadows: 'static', firstDetail: 'pelny', releaseOnExit: false }),
});

/** Profil miasta dla presetu grafiki; `isMobile` (telefon, tablet) daje profil „telefon” bez względu na preset. */
export function cityProfile(preset: QualityPresetId, isMobile: boolean): CityProfile {
  return CITY_PROFILES[isMobile ? 'telefon' : preset];
}

import { t } from '@/i18n';
import { DISTRICTS } from '@/sim/city/districts';
import { GUARANTEE } from '@/sim/economy/catalog';
import { planFor, type InstallmentPlan } from '@/sim/economy/franchisee';
import { lotState } from '@/sim/firm/commands';
import { openStores } from '@/sim/firm/firm';
import type { FirmState } from '@/sim/firm/types';
import { validLot } from '../city/cityModel';
import type { TipCtx, TipDef } from './tips';

/*
 * Dymki „pierwszy raz” miasta i drugiego sklepu (spec 4a, §17) w jednym miejscu, jak `money.ts`: ekran Miasta, pierwsza karta wolnego
 * lokalu, przełącznik dwóch sklepów i podsumowanie sieci w oknie końca miesiąca. Działają też w rankingu, bo tylko coś pokazują.
 * Liczby biorą się ze stałych gry (gwarancja z `GUARANTEE`, liczba rat z planu pakietu otwarcia).
 */

/** Plan rat pakietu otwarcia. Najtańszy pakiet (Dworzec) leży już w ostatnim przedziale `INSTALLMENTS.plans`, więc ten plan mają wszystkie lokale. */
export function openingPlan(): InstallmentPlan {
  return planFor(Math.min(...Object.values(DISTRICTS).map((d) => d.package[0])));
}

/** Pola `TipCtx` o mieście i sklepach: składa je `cityFacts` z firmy i z sygnałów widoku. */
export type CityFacts = Pick<TipCtx, 'cityOpen' | 'lotOpen' | 'partner' | 'ranked' | 'stores' | 'networkOpen'>;

/**
 * Fakty o mieście dla dymków: czy Miasto jest otwarte, czy widać kartę wolnego lokalu, status Partnera, ranking, liczba otwartych sklepów
 * i okno sieci. `data-tut="lot-price"` ma tylko karta wolnego lokalu (`LotCard.tsx`), więc lokal obok, własny i zajęty nie liczą się jako
 * karta pakietu. Bez firmy (sklep jeszcze się nie otworzył) nic nie jest otwarte.
 */
export function cityFacts(f: FirmState | null, view: { cityTab: boolean; selectedLot: number | null; networkOpen: boolean }): CityFacts {
  if (!f) return { cityOpen: false, lotOpen: false, partner: false, ranked: false, stores: 0, networkOpen: view.networkOpen };
  const lot = view.cityTab ? validLot(f, view.selectedLot) : null;
  return {
    cityOpen: view.cityTab,
    lotOpen: lot !== null && lotState(f, lot) === 'wolny',
    partner: f.person.partner,
    ranked: f.ranked,
    stores: openStores(f).length,
    networkOpen: view.networkOpen,
  };
}

/**
 * Cztery dymki 4a. `tip-miasto` ustępuje, gdy gracz otworzy kartę wolnego lokalu (na telefonie karta chowa pasek statusu, który dymek
 * wskazuje, a stuknięcie w kartkę jest właśnie tym, o czym dymek mówi). `tip-siec` stoi nad oknem końca miesiąca, reszta czeka,
 * aż okna znikną.
 */
export const CITY_TIPS: readonly TipDef[] = [
  {
    id: 'tip-miasto',
    when: (ctx) => ctx.cityOpen && !ctx.lotOpen,
    targets: () => ['city-status'],
    text: (ctx) => {
      if (ctx.ranked) return t`W sezonie rankingowym miasto tylko oglądasz.`;
      if (ctx.partner) return t`Masz status Partnera. Stuknij kartkę, żeby zobaczyć lokal. Liczby na karcie to widełki, nie obietnica.`;
      return t`Mapa miasta. Kartka „DO WYNAJĘCIA” to wolny lokal. Weźmiesz go, gdy Centrala nada Ci status Partnera: pasek mówi, czego brakuje.`;
    },
  },
  {
    id: 'tip-lokal',
    when: (ctx) => ctx.cityOpen && ctx.lotOpen && ctx.partner,
    targets: () => ['lot-price'],
    text: () => t`Urządzenie lokalu płacisz od razu albo w ${openingPlan().months} ratach z przelewów nowego sklepu. `
      + t`Nowy sklep nie ma gwarancji ${GUARANTEE.income / 1000} tys. zł: na siebie zarabia sam.`,
  },
  {
    id: 'tip-sklepy',
    when: (ctx) => ctx.stores >= 2,
    targets: () => ['store-switch'],
    text: () => t`Tu przełączasz sklepy. Sklep w tle pracuje sam, a jego karty rozstrzyga zastępca: wybiera odpowiedź zaznaczoną z góry. Ręce masz tylko tam, gdzie jesteś.`,
  },
  {
    id: 'tip-siec',
    inWindow: true,
    when: (ctx) => ctx.networkOpen,   // okno sieci samo oznacza dwa sklepy (jeden mógł się zamknąć w tej samej minucie)
    targets: () => ['network-summary'],
    text: () => t`Każdy sklep ma swój wyciąg, ale gotówka jest jedna: minus w jednym sklepie zjada plus w drugim.`,
  },
];

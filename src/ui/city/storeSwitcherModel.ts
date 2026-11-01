import { computed, type ReadonlySignal } from '@preact/signals';
import { t } from '@/i18n';
import { lotById } from '@/sim/city/generateCity';
import { dayOf } from '@/sim/economy/calendar';
import { CATS } from '@/sim/economy/catalog';
import { aislePallets } from '@/sim/economy/economy';
import { forecastMonth, type MonthForecast } from '@/sim/economy/forecast';
import { forecastFirm } from '@/sim/firm/forecast';
import { openStores } from '@/sim/firm/firm';
import type { FirmState, FirmStore } from '@/sim/firm/types';
import { firm, type EconView, type FirmView, type MetaView } from '../state';
import { plural, zl } from '../game/format';

/*
 * Model przełącznika sklepów (spec §9.4, §11.3, §15): mini-stan sklepu na liście chipa, wiersz „Z poprzednich gier” i prognoza paska,
 * która od dwóch otwartych sklepów liczy całą sieć. Czyste funkcje bez interfejsu, więc testuje się je bez DOM.
 */

/** Znak ostrzegawczy przy sklepie: paleta w przejściu, pusta półka, karta rozstrzygnięta dziś przez zastępcę, niskie zaufanie (kolejność jest stała). */
export type StoreWarning = 'paleta' | 'polka' | 'zastepca' | 'zaufanie';

/** Zaufanie sklepu poniżej tej wartości daje znak „zaufanie”: sklep w tle może po cichu spaść do zera, a gracz nie zagląda do jego listy.
 * Inny próg niż `TRUST_WARN_BELOW` w `Hud.tsx` (30, chip aktywnego sklepu): tu ostrzegamy wcześniej, bo sklepu w tle nikt nie ogląda. */
export const TRUST_WARN_BELOW = 40;

/** Mini-stan sklepu na liście chipa. `number` to numer budynku z adresu lokalu („ul. Lipowa 3”), nie numer sklepu (`id`). */
export interface StoreMini {
  id: number;
  number: number;
  street: string;
  /** Dzisiejszy wynik: marża, premie i inne przychody dnia minus mandaty i palety ponad przydział (jak sekcja „Dziś” w Celach). */
  todayProfit: number;
  /** Prognoza „Zostaje Ci” sklepu na koniec miesiąca (0 dla zamkniętego). */
  net: number;
  trust: number;
  warnings: StoreWarning[];
  active: boolean;
  closed: boolean;
  /** Sklep ma wypowiedzenie (działa do końca okresu). */
  notice: boolean;
}

/** Półka jest „pusta”, gdy w kategorii, którą sklep ma, nie zostało nawet pełnej sztuki. */
const SHELF_EMPTY_BELOW = 1;

function warningsOf(f: FirmState, st: FirmStore): StoreWarning[] {
  const out: StoreWarning[] = [];
  if (aislePallets(st.econ) > 0) out.push('paleta');
  if (CATS.some((c) => st.info.shelfCap[c] > 0 && st.econ.shelf[c] < SHELF_EMPTY_BELOW)) out.push('polka');
  const today = dayOf(st.econ.minute);
  if (f.inbox.some((n) => n.storeId === st.id && n.day === today)) out.push('zastepca');
  if (st.econ.tycoon.trust.value < TRUST_WARN_BELOW) out.push('zaufanie');
  return out;
}

/** Mini-stan każdego sklepu firmy, rosnąco po `id`; zamknięte zostają na liście z flagą `closed` (bez ostrzeżeń i prognozy). */
export function storeMinis(f: FirmState): StoreMini[] {
  return f.stores.map((st) => {
    const lot = lotById(f.city, st.lotId);
    const c = st.econ.today;
    return {
      id: st.id, number: lot.number, street: lot.street,
      todayProfit: c.margin + c.bonus + c.other - c.fines - c.logistics,
      net: st.closed ? 0 : forecastMonth(st.econ, st.info).net,
      trust: st.econ.tycoon.trust.value,
      warnings: st.closed ? [] : warningsOf(f, st),
      active: st.id === f.activeId, closed: st.closed, notice: st.notice !== null,
    };
  });
}

/** „#2 Lipowa”: skrócona nazwa sklepu na zakładce (marka i ulica to nazwy własne, więc bez tłumaczenia). Nieznany sklep to samo „#n”. */
export function shortStoreName(f: FirmState, id: number): string {
  const st = f.stores.find((s) => s.id === id);
  return st ? `#${id} ${lotById(f.city, st.lotId).street}` : `#${id}`;
}

/** Czy firma ma sieć do pokazania: co najmniej dwa otwarte sklepy (jeden otwarty sklep nie ma dokąd się przełączać). */
export const isNetwork = (f: FirmState | null | undefined): boolean => !!f && openStores(f).length >= 2;

/**
 * Czy gra ma teraz sieć (co najmniej dwa otwarte sklepy). Sygnał zmienia wartość tylko przy zmianie składu, więc `App` (klasa `tt-net`
 * na `.tt-ui`, od której zależy układ paska i `--hud-h`) nie odświeża się przy każdej publikacji firmy.
 */
export const networkOn: ReadonlySignal<boolean> = computed(() => isNetwork(firm.value?.f));

/** „Z poprzednich gier: 2 sklepy, 1 200 zł dziennie, 3 Punkty Partnera” albo null, gdy gracz nie ma sklepów z sieci (spec §15). */
export function networkRow(meta: MetaView): string | null {
  if (meta.stores <= 0) return null;
  const n = meta.stores;
  const p = meta.points;
  return t`Z poprzednich gier: ${n} ${plural(n, 'sklep', 'sklepy', 'sklepów')}, ${zl(meta.networkIncome)} dziennie, ${p} ${plural(p, 'Punkt Partnera', 'Punkty Partnera', 'Punktów Partnera')}`;
}

/**
 * Prognoza paska i ostrzeżeń przy zakupach: od dwóch otwartych sklepów cała sieć (`forecastFirm`, bo debet dotyczy wspólnej gotówki),
 * inaczej prognoza aktywnego sklepu (`forecastMonth`) bez zmian względem gry z jednym sklepem.
 */
export function forecastNow(view: EconView, firm: FirmView | null): MonthForecast {
  return firm && isNetwork(firm.f) ? forecastFirm(firm.f) : forecastMonth(view.s, view.info);
}

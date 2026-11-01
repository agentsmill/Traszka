import { signal } from '@preact/signals';
import { t } from '@/i18n';
import type { FirmState } from '@/sim/firm/types';
import { storeName } from './firmText';
import { shortStoreName } from './storeSwitcherModel';

/*
 * Wybór zakładek sklepów (spec §11.5): ten sam przełącznik segmentowy „Sieć / #1 Ogrodowa / #2 Lipowa” ma okno końca miesiąca (`NetworkReport.tsx`),
 * protokół remanentu (`RemanentModal` w overlays.tsx) i podgląd końca miesiąca (`monthPreview.tsx`). Liść bez zależności od okien, żeby te
 * moduły mogły go czytać bez cykli importów; sam przełącznik to `StoreTabs.tsx`. Wybór zakładki trzyma sygnał przypięty do widoku okna.
 */

/** Zakładka okna kilku sklepów: podsumowanie sieci (`siec`) albo sklep o danym `id`. */
export type StoreTab = 'siec' | number;
export interface StoreTabDef { id: StoreTab; label: string }

/** Wybór zakładki przypięty do widoku okna (zob. `tabState`). */
export interface TabState<V extends object> {
  get(view: V, fallback: StoreTab): StoreTab;
  set(view: V, tab: StoreTab): void;
}

/**
 * Wybór zakładki przypięty do widoku okna (obiektu, który okno pokazuje): nowy widok, np. kolejny koniec miesiąca, zaczyna od zakładki
 * domyślnej, a nie od tej, którą gracz wybrał w poprzednim oknie. Zapisuje tylko kliknięcie, więc rysowanie niczego nie zmienia.
 */
export function tabState<V extends object>(): TabState<V> {
  const picked = signal<{ view: V; tab: StoreTab } | null>(null);
  return {
    get: (view, fallback) => (picked.value?.view === view ? picked.value.tab : fallback),
    set: (view, tab) => { picked.value = { view, tab }; },
  };
}

/** Nazwa sklepu w oknie: „Traszka #2, Lipowa”; bez firmy (okno bez gry) samo „Traszka #2”. */
export const nameOf = (f: FirmState | null, id: number): string => (f ? storeName(f, id) : `Traszka #${id}`);
/** Napis zakładki sklepu: „#2 Lipowa”. */
export const tabLabel = (f: FirmState | null, id: number): string => (f ? shortStoreName(f, id) : `#${id}`);

/** Zakładki okna: opcjonalnie „Sieć” na początku i po jednej na sklep (w kolejności `ids`). */
export function storeTabDefs(f: FirmState | null, ids: readonly number[], network = true): StoreTabDef[] {
  return [...(network ? [{ id: 'siec' as const, label: t`Sieć` }] : []), ...ids.map((id) => ({ id, label: tabLabel(f, id) }))];
}

/**
 * Zakładka do pokazania: wybór gracza dla tego widoku, o ile zakładka wciąż jest na liście (sklep mógł zniknąć z widoku), inaczej `fallback`
 * (domyślnie podsumowanie sieci).
 */
export function resolveTab<V extends object>(state: TabState<V>, view: V, tabs: readonly StoreTabDef[], fallback: StoreTab = 'siec'): StoreTab {
  const asked = state.get(view, fallback);
  return tabs.some((x) => x.id === asked) ? asked : fallback;
}

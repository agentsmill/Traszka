import { signal } from '@preact/signals';
import { t, tr } from '@/i18n';
import { DEBT_WARN, debtWarningText } from '@/sim/economy/economy';
import type { FirmState, NetworkSummary } from '@/sim/firm/types';
import { firm, type NetworkReportView } from '../state';
import { minusZl, money, signedZl } from '../game/format';
import { ReportBody } from '../game/overlays';
import { cashTone } from '../game/statement';
import { storeName } from './firmText';
import { shortStoreName } from './storeSwitcherModel';

/*
 * Okno końca miesiąca przy kilku sklepach (spec §11.5): przełącznik segmentowy „Sieć / #1 Ogrodowa / #2 Lipowa”. „Sieć” to podsumowanie
 * (`data-tut="network-summary"`): „Zostaje Ci” każdego sklepu i razem, pakiety otwarcia zapłacone gotówką, gotówka po zamknięciu i wynik
 * każdego sklepu. Dalej wyciąg każdego sklepu (ten sam widok co raport jednego sklepu). Te same zakładki ma protokół remanentu
 * (`RemanentModal`) i podgląd końca miesiąca (`MonthPreviewModal`). Komponenty bez haków: zakładkę trzyma sygnał przypięty do widoku okna.
 */

/** Zakładka okna kilku sklepów: podsumowanie sieci (`siec`) albo sklep o danym `id`. */
export type StoreTab = 'siec' | number;
export interface StoreTabDef { id: StoreTab; label: string }

/**
 * Wybór zakładki przypięty do widoku okna (obiektu, który okno pokazuje): nowy widok, np. kolejny koniec miesiąca, zaczyna od zakładki
 * domyślnej, a nie od tej, którą gracz wybrał w poprzednim oknie. Zapisuje tylko kliknięcie, więc rysowanie niczego nie zmienia.
 */
export function tabState<V extends object>() {
  const picked = signal<{ view: V; tab: StoreTab } | null>(null);
  return {
    get: (view: V, fallback: StoreTab): StoreTab => (picked.value?.view === view ? picked.value.tab : fallback),
    set: (view: V, tab: StoreTab): void => { picked.value = { view, tab }; },
  };
}

/** Przełącznik segmentowy zakładek; aktywna ma `aria-selected`. Zwykła funkcja, nie komponent: testy `vnodeTree` widzą wtedy jego przyciski w drzewie okna. */
export function StoreTabs({ tabs, active, onPick }: { tabs: StoreTabDef[]; active: StoreTab; onPick(id: StoreTab): void }) {
  return (
    <div class="tt-seg tt-storetabs" role="tablist" aria-label={t`Sklepy`}>
      {tabs.map((x) => (
        <button key={String(x.id)} type="button" role="tab" class={`tt-btn${x.id === active ? ' on' : ''}`} aria-selected={x.id === active} onClick={() => onPick(x.id)}>{x.label}</button>
      ))}
    </div>
  );
}

/** Nazwa sklepu w oknie: „Traszka #2, Lipowa”; bez firmy (okno bez gry) samo „Traszka #2”. */
export const nameOf = (f: FirmState | null, id: number): string => (f ? storeName(f, id) : `Traszka #${id}`);
/** Napis zakładki sklepu: „#2 Lipowa”. */
export const tabLabel = (f: FirmState | null, id: number): string => (f ? shortStoreName(f, id) : `#${id}`);

const row = (label: string, value: string, total = false) => (
  <div class={total ? 'tt-row total' : 'tt-row'}><span>{label}</span><span>{value}</span></div>
);

/**
 * Podsumowanie sieci: „Zostaje Ci” każdego sklepu i razem, pakiety otwarcia za gotówkę (gdy były), gotówka po zamknięciu z tonem z progów
 * debetu i wynik każdego sklepu. `tip`: czy blok ma być celem dymka „pierwszy raz” (podgląd końca miesiąca nim nie jest). Zwykła funkcja
 * wywoływana z komponentów, więc testy `vnodeTree` widzą jej wiersze.
 */
export function NetworkSummaryView({ summary, f, tip = true }: { summary: NetworkSummary; f: FirmState | null; tip?: boolean }) {
  return (
    <section class="tt-netsum" data-tut={tip ? 'network-summary' : undefined} aria-label={t`Podsumowanie sieci`}>
      <h3>{t`Zostaje Ci`}</h3>
      {summary.stores.map((s) => row(nameOf(f, s.id), signedZl(s.net)))}
      {row(t`Razem`, signedZl(summary.total), true)}
      {summary.invest > 0 && row(t`Pakiety otwarcia za gotówkę`, minusZl(summary.invest))}
      <div class="tt-row"><span>{t`Gotówka po zamknięciu`}</span><span class={`tt-free ${cashTone(summary.wallet)}`}>{money(summary.wallet)}</span></div>
      {summary.wallet < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(summary.wallet))}</p>}
      <h3>{t`Wynik miesiąca`}</h3>
      {summary.stores.map((s) => row(nameOf(f, s.id), signedZl(s.profit)))}
    </section>
  );
}

const picked = tabState<NetworkReportView>();

/**
 * Ciało okna końca miesiąca w kilku sklepach: przełącznik i, pod nim, podsumowanie sieci albo wyciąg wybranego sklepu. Okno otwiera się
 * na podsumowaniu; zakładka sklepu, który zniknął z widoku, wraca do niego.
 */
export function NetworkReportBody({ view }: { view: NetworkReportView }) {
  const f = firm.value?.f ?? null;
  const tabs: StoreTabDef[] = [{ id: 'siec', label: t`Sieć` }, ...view.reports.map((r) => ({ id: r.storeId, label: tabLabel(f, r.storeId) }))];
  const asked = picked.get(view, 'siec');
  const active = tabs.some((x) => x.id === asked) ? asked : 'siec';
  const shown = active === 'siec' ? null : view.reports.find((r) => r.storeId === active)!;
  return (
    <>
      {StoreTabs({ tabs, active, onPick: (id) => picked.set(view, id) })}
      {shown
        ? <section class="tt-storereport" aria-label={nameOf(f, shown.storeId)}><h3 class="tt-storetitle">{nameOf(f, shown.storeId)}</h3>{ReportBody({ r: shown.report })}</section>
        : NetworkSummaryView({ summary: view.summary, f })}
    </>
  );
}

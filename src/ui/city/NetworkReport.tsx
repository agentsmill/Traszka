import { t, tr } from '@/i18n';
import { DEBT_WARN, debtWarningText } from '@/sim/economy/economy';
import type { FirmState, NetworkSummary } from '@/sim/firm/types';
import { firm, type NetworkReportView } from '../state';
import { minusZl, money, signedZl } from '../game/format';
import { ReportBody } from '../game/reportBody';
import { cashTone } from '../game/statement';
import { StoreTabs } from './StoreTabs';
import { nameOf, resolveTab, storeTabDefs, tabState } from './tabState';

/*
 * Okno końca miesiąca przy kilku sklepach (spec §11.5): przełącznik segmentowy „Sieć / #1 Ogrodowa / #2 Lipowa”. „Sieć” to podsumowanie
 * (`data-tut="network-summary"`): „Zostaje Ci” każdego sklepu i razem, pakiety otwarcia zapłacone gotówką, gotówka po zamknięciu i wynik
 * każdego sklepu. Dalej wyciąg każdego sklepu (ten sam widok co raport jednego sklepu). Te same zakładki ma protokół remanentu
 * (`RemanentModal`) i podgląd końca miesiąca (`MonthPreviewModal`); przełącznik (`StoreTabs.tsx`) i wybór zakładki (`tabState.ts`) są osobno.
 */

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
  const tabs = storeTabDefs(f, view.reports.map((r) => r.storeId));
  const active = resolveTab(picked, view, tabs);
  const shown = view.reports.find((r) => r.storeId === active);
  return (
    <>
      {StoreTabs({ tabs, active, onPick: (id) => picked.set(view, id) })}
      {shown
        ? <section class="tt-storereport" aria-label={nameOf(f, shown.storeId)}><h3 class="tt-storetitle">{nameOf(f, shown.storeId)}</h3>{ReportBody({ r: shown.report })}</section>
        : NetworkSummaryView({ summary: view.summary, f })}
    </>
  );
}

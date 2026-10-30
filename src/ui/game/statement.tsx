import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { DEBT_WARN } from '@/sim/economy/economy';
import type { Statement } from '@/sim/economy/franchisee';
import { minusZl, money, signedZl, zl } from './format';

/*
 * Wyciąg od Centrali: trzy sekcje (przelew, potrącenia, Twoje koszty), pod nimi „Zostaje Ci”, gotówka po zamknięciu i wynik do
 * rankingu. Jeden widok dla raportu miesiąca (prawdziwy wyciąg z zamknięcia, `ReportBody`) i dla podglądu końca miesiąca (wyciąg
 * prognozowany, `MonthPreviewModal`), bo obie liczby biorą się z tego samego `Statement`. Zwykła funkcja, nie komponent: testy
 * `vnodeTree` widzą wtedy jego wiersze w drzewie okna.
 */

/** Jak mocno gotówka po zamknięciu zbliża się do granicy debetu: klasy `tt-free` w CSS (`warn`, `danger`) kolorują kwotę. */
export type CashTone = 'ok' | 'warn' | 'danger';

/** Ton gotówki po zamknięciu z progów gry (`DEBT_WARN`, `DEBT_LIMIT`); poniżej granicy gra się kończy. */
export const cashTone = (cashAfter: number): CashTone => (cashAfter < DEBT_LIMIT ? 'danger' : cashAfter < DEBT_WARN ? 'warn' : 'ok');

/** Ostrzeżenie pod wyciągiem pierwszego miesiąca po wejściu nowych zasad (zapis sprzed SIM_VERSION 6). */
export const PARTIAL_NOTE = 'Rozliczenie od wejścia nowych zasad: przelew i koszty liczone od chwili aktualizacji gry.';

const row = (label: string, value: string, total = false) => (
  <div class={total ? 'tt-row total' : 'tt-row'}><span>{label}</span><span>{value}</span></div>
);

/**
 * Wyciąg `st`. `tone`: ton gotówki po zamknięciu, gdy wywołujący wie więcej niż sama kwota (podgląd uwzględnia dołek w trakcie
 * miesiąca); domyślnie z progów gry. Kwoty odejmowane (potrącenia, koszty) mają „−”, żeby wiersze czytało się jak rachunek:
 * przelew minus potrącenia minus koszty to „Zostaje Ci”.
 */
export function statementView(st: Statement, tone: CashTone = cashTone(st.cashAfter)) {
  return (
    <section class="tt-statement" aria-label="Wyciąg od Centrali">
      <h3>Przelew od Centrali</h3>
      {row('Marża', zl(st.margin))}
      {row('Premie', zl(st.bonus))}
      {st.guarantee > 0 && row('Dopłata z gwarancji', zl(st.guarantee))}
      {row('Razem', zl(st.transfer), true)}
      <h3>Potrącenia</h3>
      {row('Raty', minusZl(st.installments))}
      {row('Palety ponad darmowe', minusZl(st.pallets))}
      {st.remanent > 0 && row('Remanent', minusZl(st.remanent))}
      {row('Razem', minusZl(st.deductions), true)}
      <h3>Twoje koszty</h3>
      {row('Pensje', minusZl(st.wages))}
      {row('ZUS', minusZl(st.zus))}
      {row('VAT', minusZl(st.vat))}
      {row('Księgowa', minusZl(st.accounting))}
      {row('Media', minusZl(st.media))}
      {row('Razem', minusZl(st.costs), true)}
      <div class={`tt-st-net ${st.net < 0 ? 'neg' : 'pos'}`} data-tut="zostaje-ci">
        <span>Zostaje Ci</span>
        <b>{signedZl(st.net)}</b>
      </div>
      <div class="tt-row"><span>Gotówka po zamknięciu</span><span class={`tt-free ${tone}`}>{money(st.cashAfter)}</span></div>
      <div class="tt-row tt-st-result"><span>Wynik miesiąca bez rat (do rankingu)</span><span>{signedZl(st.result)}</span></div>
      <details class="tt-st-cash">
        <summary>Gotówka w miesiącu</summary>
        {row('Zakupy za gotówkę', minusZl(st.spent))}
        {row('Mandaty', minusZl(st.fines))}
        {row('Inne przychody i koszty', signedZl(st.other))}
        <p class="tt-hint">Te pozycje ruszają gotówką od razu, poza wyciągiem.</p>
      </details>
      {st.partial && <p class="tt-hint" role="note">{PARTIAL_NOTE}</p>}
    </section>
  );
}

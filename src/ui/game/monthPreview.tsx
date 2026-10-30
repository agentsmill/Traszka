import type { ComponentChildren } from 'preact';
import { DEBT_LIMIT, GUARANTEE } from '@/sim/economy/catalog';
import { DEBT_WARN, debtWarningText } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import type { MonthPreview } from '@/sim/economy/monthPreview';
import { t, tr } from '@/i18n';
import { closeMonthPreview, econ, monthPreview } from '../state';
import { int, minusZl, money, pct, signedZl, zl } from './format';
import { runMonthPreview } from './monthPreviewRun';
import { cashTone as cashToneOf, statementView, type CashTone } from './statement';

/*
 * Okno „Wyciąg na koniec miesiąca”. Góra: prognoza na dziś (saldo u Centrali, raty, „Zostaje Ci” i gotówka po zamknięciu: szybki
 * szacunek z `forecastMonth`, ten sam co w pasku). Przycisk „Koniec miesiąca” liczy podgląd na kopii sklepu: prognozowany wyciąg
 * od Centrali za cały miesiąc (ten sam widok co w raporcie, `statementView`) i gotówka po zamknięciu, przy założeniu „nic nie robię”.
 * Pokazuje tylko sumy: bez kart, fal klientów i złotych palet z przyszłości.
 */

/** Założenie podglądu, powiedziane graczowi wprost. */
export const PREVIEW_ASSUMPTION =
  'Podgląd liczy kopia sklepu, prawdziwa gra się nie zmienia. Zakładam, że do końca miesiąca nic nie robisz: nie stukasz, nie kupujesz, a karty decyzji dostają odpowiedź domyślną.';

function Row({ label, children, strong = false }: { label: ComponentChildren; children: ComponentChildren; strong?: boolean }) {
  return <div class={`tt-row${strong ? ' total' : ''}`}><span>{label}</span><span>{children}</span></div>;
}

/** Czerwone ostrzeżenie o debecie na końcu podglądu albo `null`. Progi z `DEBT_WARN` i `DEBT_LIMIT`, nic na sztywno. */
export function previewWarning(r: MonthPreview): { level: 'warn' | 'danger'; text: string } | null {
  if (r.endedEarly) {
    return { level: 'danger', text: t`Gra skończyłaby się przed zamknięciem miesiąca: gotówka spadłaby poniżej granicy debetu (${signedZl(DEBT_LIMIT)}).` };
  }
  if (r.gameOver === 'debt') {
    return { level: 'danger', text: t`Centrala wypowie umowę: po zamknięciu miesiąca gotówka wyniesie ${signedZl(r.cashAfter)}, poniżej granicy debetu (${signedZl(DEBT_LIMIT)}).` };
  }
  if (r.gameOver === 'trust') return { level: 'danger', text: t`Centrala wypowie umowę: zaufanie spadnie do zera.` };
  if (r.cashAfter < DEBT_WARN) return { level: 'warn', text: tr(debtWarningText(r.cashAfter)) };
  if (r.lowestCash < DEBT_WARN) return { level: 'warn', text: t`W trakcie miesiąca gotówka spadnie do ${signedZl(r.lowestCash)}, poniżej progu ostrzeżenia (${signedZl(DEBT_WARN)}).` };
  return null;
}

function PreviewResult({ r }: { r: MonthPreview }) {
  const warning = previewWarning(r);
  const st = r.statement;
  return (
    <section class="tt-section tt-preview-result" aria-label={t`Wynik podglądu`}>
      <h3>{t`Jeśli nic nie zrobisz`}{r.label ? `: ${tr(r.label)}` : ''}</h3>
      <Row label={t`Obrót`}>{zl(r.revenue)}</Row>
      <Row label={t`Klienci`}>{int(r.customers)}</Row>
      {st.guarantee > 0 && <p class="tt-hint">{t`Centrala dopłaca do ${zl(GUARANTEE.income)} przychodu w pierwszych ${GUARANTEE.months} miesiącach, o ile nie będzie mandatu i zaufanie nie spadnie poniżej ${GUARANTEE.minTrust}. „Wierzymy w Ciebie. Do odwołania.”`}</p>}
      {r.endedEarly && <p class="tt-hint">{t`To naliczenia do chwili końca gry: bez rat, dopłaty z gwarancji i premii od obrotu.`}</p>}
      {statementView(st, warning ? warning.level : 'ok')}
      <Row label={t`Gotówka teraz`}>{money(r.cashNow)}</Row>
      {warning && <p class={`tt-hint warn tt-preview-warn ${warning.level}`} role="alert">{warning.text}</p>}
    </section>
  );
}

/** Okno wyciągu i podglądu; zamknięte nic nie rysuje. Gra stoi, dopóki jest otwarte (`isWindowOpen`). */
export function MonthPreviewModal() {
  const view = monthPreview.value;
  const game = econ.value;
  if (!view || !game) return null;
  const f = forecastMonth(game.s, game.info);
  const tone: CashTone = cashToneOf(f.cashAfter);
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-preview" role="dialog" aria-modal="true" aria-label={t`Wyciąg na koniec miesiąca`}>
        <h2>{t`Wyciąg na koniec miesiąca`}</h2>
        <section class="tt-section" aria-label={t`Prognoza na dziś`}>
          <h3>{t`Na dziś`}</h3>
          <Row label={t`Saldo u Centrali`}>{zl(f.saldo)}</Row>
          <Row label={t`Raty w tym przelewie`}>{minusZl(f.installments)}</Row>
          <Row label={t`Zostaje Ci po zamknięciu (prognoza)`} strong>{signedZl(f.net)}</Row>
          <Row label={t`Gotówka teraz`}>{money(game.s.cash)}</Row>
          <Row label={t`Gotówka po zamknięciu`} strong><span class={`tt-free ${tone}`}>{money(f.cashAfter)}</span></Row>
          <p class="tt-hint">{t`Saldo to marża i premie z tego miesiąca. Centrala przeleje je przy zamknięciu, potrąci raty i palety, a Ty zapłacisz pensje, media, ZUS, VAT i księgową. Prognoza liczy resztę miesiąca z dotychczasowego obrotu.`}</p>
        </section>
        {view.phase === 'idle' && (
          <>
            <p class="tt-hint">{tr(PREVIEW_ASSUMPTION)}</p>
            <button type="button" class="tt-btn tt-primary big" onClick={() => runMonthPreview(econ.value)}>{t`Koniec miesiąca: policz podgląd`}</button>
          </>
        )}
        {view.phase === 'running' && (
          <div class="tt-preview-progress" role="status" aria-live="polite">
            <span class="tt-bar" role="presentation"><span style={{ width: pct(view.day / view.days) }} /></span>
            <span class="tt-hint">{t`Liczę: dzień ${view.day} z ${view.days}…`}</span>
          </div>
        )}
        {view.phase === 'none' && <p class="tt-hint">{t`Nie ma czego liczyć: gra już się skończyła.`}</p>}
        {view.phase === 'done' && (
          <>
            <PreviewResult r={view.result} />
            <p class="tt-hint" data-ms={Math.round(view.ms)}>{tr(PREVIEW_ASSUMPTION)}</p>
          </>
        )}
        <div class="tt-modal-foot">
          <button type="button" class="tt-btn big" onClick={closeMonthPreview}>{t`Zamknij`}</button>
        </div>
      </div>
    </div>
  );
}

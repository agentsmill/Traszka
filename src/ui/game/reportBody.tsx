import { hintTextOf, t, tr } from '@/i18n';
import { DEBT_WARN, debtWarningText, type MonthReport } from '@/sim/economy/economy';
import { REPORT_LINE_LABEL, reportCommentText } from '@/sim/economy/tycoon/report';
import { TRUST_REASON_LABEL } from '@/sim/economy/tycoon/trust';
import { int, signedPts, signedZl, zl } from './format';
import { statementView } from './statement';

/*
 * Treść raportu miesięcznego jednego sklepu (`ReportBody`) i cytat Centrali (`centralaQuote`). Liść bez zależności od okien: raport
 * rysuje okno `ReportModal` (overlays.tsx), a przy kilku sklepach także zakładka sklepu w oknie sieci (`city/NetworkReport.tsx`),
 * więc oba moduły czytają go stąd i nie importują się nawzajem. `overlays.tsx` eksportuje `ReportBody` dalej pod starą nazwą.
 */

/** Ile przyczyn zmiany zaufania mieści raport (od największej co do wartości; sim sortuje je w `closeTrustMonth`). */
const REPORT_TRUST_REASONS = 4;

/** Kwota pozycji raportu: koszty (ujemne) ze znakiem minus, przychody bez. Zaokrąglone do złotych; zero zostaje „0 zł” (nie „−0”). */
const lineAmount = (amount: number): string => {
  const r = Math.round(amount);
  return r < 0 ? `−${zl(-r)}` : zl(Math.abs(r));
};

/** Komentarz Centrali (zwykła funkcja, nie komponent: testy `vnodeTree` widzą wtedy jego tekst). */
export const centralaQuote = (text: string) => <p class="tt-quote">{t`„${tr(text)}”`}<br /><span class="tt-muted">{t`— Centrala`}</span></p>;

/**
 * Treść raportu miesięcznego. Z wyciągiem (`statement`, od SIM_VERSION 6): na górze wyciąg od Centrali (`statementView`: przelew,
 * potrącenia, Twoje koszty, „Zostaje Ci”), pod nim obrót i klienci, a dalej reszta raportu tycoona (zaufanie, komentarz, wskazówka, KPI).
 * Bez wyciągu, z danymi tycoona (`detail`): wynik dużą liczbą i pozycje z `REPORT_LINE_LABEL` (koszty ze znakiem minus). Raport ze starego
 * zapisu (`detail` równe null, bez wyciągu) zostaje dawnym widokiem: marża i inne przychody, premie Centrali (osobny licznik) i koszty
 * (z opłatą i ubytkami ponad limit Centrali) sumują się do wyniku miesiąca. `closing` zastępuje komentarz Centrali (wypowiedzenie umowy
 * przy końcu gry). `noGuarantee`: sklep dodatkowy w oknie gwarancji (`city/firmText.noGuarantee`), więc wyciąg mówi tekstem Centrali, że
 * gwarancji nie ma.
 */
export function ReportBody({ r, closing, noGuarantee = false }: { r: MonthReport; closing?: string; noGuarantee?: boolean }) {
  const c = r.counters;
  const d = r.detail;
  const st = r.statement;
  if (!d) {
    if (st) {
      return (
        <>
          {statementView(st, undefined, noGuarantee)}
          <p class="tt-muted tt-st-meta">{t`Obrót ${zl(c.revenue)} · klienci ${int(c.customers)} (utraceni: ${int(c.lost)})`}</p>
          {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
          {centralaQuote(closing ?? r.comment)}
        </>
      );
    }
    return (
      <>
        <div class="tt-row"><span>{t`Klienci`}</span><span>{t`${int(c.customers)} (utraceni: ${int(c.lost)})`}</span></div>
        <div class="tt-row"><span>{t`Obrót`}</span><span>{zl(c.revenue)}</span></div>
        <div class="tt-row"><span>{t`Marża i inne przychody`}</span><span>{zl(c.margin + c.other)}</span></div>
        <div class="tt-row"><span>{t`Premie Centrali`}</span><span>{zl(c.bonus)}</span></div>
        <div class="tt-row"><span>{t`Płace`}</span><span>−{zl(c.wages)}</span></div>
        <div class="tt-row"><span>{t`Media`}</span><span>−{zl(c.media)}</span></div>
        <div class="tt-row"><span>{t`Opłata franczyzowa`}</span><span>−{zl(c.fee)}</span></div>
        <div class="tt-row"><span>{t`Mandaty`}</span><span>−{zl(c.fines)}</span></div>
        <div class="tt-row"><span>{t`Ubytki ponad limit Centrali`}</span><span>−{zl(c.wut)}</span></div>
        <div class="tt-row"><span>{t`Logistyka`}</span><span>−{zl(c.logistics)}</span></div>
        <div class="tt-row total"><span>{t`Wynik miesiąca`}</span><span>{signedZl(r.profit)}</span></div>
        <div class="tt-row"><span>{t`Inwestycje`}</span><span>{zl(c.investments)}</span></div>
        <div class="tt-row"><span>{t`Gotówka na koniec`}</span><span>{zl(r.cash)}</span></div>
        {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
        {centralaQuote(closing ?? r.comment)}
      </>
    );
  }
  // wynik w nagłówku to suma pozycji tak, jak je widać (każda zaokrąglona do złotych): zaokrąglenie samej sumy bywa o 1 zł obok
  const result = d.lines.reduce((n, l) => n + Math.round(l.amount), 0);
  const trust = d.trust;
  const kpiWeeks = d.kpi.hit + d.kpi.miss;
  return (
    <>
      {st
        ? (
          <>
            {statementView(st, undefined, noGuarantee)}
            <p class="tt-muted tt-st-meta">{t`Obrót ${zl(d.revenue)} · klienci ${int(c.customers)} (utraceni: ${int(c.lost)})`}</p>
            {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
          </>
        )
        : (
          <>
            <div class="tt-report-head">
              <span class="tt-muted">{t`Wynik miesiąca`}</span>
              <b class={`tt-report-result ${result < 0 ? 'neg' : 'pos'}`}>{signedZl(result)}</b>
              <span class="tt-muted">{t`Obrót ${zl(d.revenue)} · klienci ${int(c.customers)} (utraceni: ${int(c.lost)})`}</span>
              <span class="tt-muted">{t`Gotówka na koniec: ${zl(r.cash)} · inwestycje: ${zl(c.investments)}`}</span>
            </div>
            {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
            <div class="tt-report-lines">
              {d.lines.map((l) => (
                <div key={l.key} class="tt-row"><span>{tr(REPORT_LINE_LABEL[l.key])}</span><span class={Math.round(l.amount) < 0 ? 'tt-neg' : undefined}>{lineAmount(l.amount)}</span></div>
              ))}
            </div>
          </>
        )}
      <div class="tt-report-trust">
        <div class="tt-row"><b>{t`Zaufanie Centrali: ${int(trust.start)} → ${int(trust.end)}`}</b><span class={trust.delta < 0 ? 'tt-neg' : undefined}>{t`${signedPts(trust.delta)} pkt`}</span></div>
        {trust.reasons.slice(0, REPORT_TRUST_REASONS).map(([reason, v]) => (
          <div key={reason} class="tt-row tt-reason"><span>{tr(TRUST_REASON_LABEL[reason])}</span><span class={v < 0 ? 'tt-neg' : 'tt-pos'}>{signedPts(v)}</span></div>
        ))}
        {trust.reasons.length === 0 && <p class="tt-hint">{t`Bez zmian w tym miesiącu.`}</p>}
      </div>
      {centralaQuote(closing ?? (reportCommentText(d.commentId) || r.comment))}
      <div class="tt-report-hint" role="note">
        <b>{t`Wskazówka`}</b>
        <span>{hintTextOf(d.hint, int)}</span>
      </div>
      <p class="tt-report-kpi">
        {kpiWeeks > 0 ? t`KPI tygodnia w miesiącu: ${d.kpi.hit} trafione, ${d.kpi.miss} nietrafione` : t`KPI tygodnia w miesiącu: żaden tydzień nie został jeszcze rozliczony`}
      </p>
    </>
  );
}

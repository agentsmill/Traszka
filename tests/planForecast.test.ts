import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY as DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type EconEvent, type EconomyState } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { defaultAnswer, gameOverReason, lastDayOfMonthFrom, startMonthPreview } from '@/sim/economy/monthPreview';
import { dayOf } from '@/sim/economy/calendar';
import { freshRun } from '@/sim/run';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';

/*
 * Bramka P7 (etap 5a, Task 4): żadna kara planu nie przychodzi niespodzianką. Bot bez zakupów (karty z odpowiedzią domyślną) gra od
 * początku umowy; rano ostatniego dnia każdego miesiąca z planem uruchamiamy podgląd miesiąca i porównujemy go z prawdziwym zamknięciem.
 * Bezczynny sklep na prawdziwym planie wpada od kilku miesięcy po starcie planu i po trzeciej wpadce z rzędu traci umowę (stopień 3 nie
 * niesie kary pieniężnej), więc „8 miesięcy z planem” bywa nieosiągalne: bieg kończy się końcem gry albo ósmym miesiącem planu, zależnie co wcześniej.
 */

const SEEDS = ['kiełbasa-42', 'żabka-7'];
const PLAN_MONTHS = 8;

function runTo(s: EconomyState, info: StoreInfo, minute: number): EconEvent[] {
  const events: EconEvent[] = [];
  while (s.minute < minute && !s.gameOver) {
    if (awaitingDecision(s)) {
      const card = visibleCards(s.tycoon.cards, s.minute)[0]!;
      expect(applyCommand(s, info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
      continue;
    }
    stepMinute(s, info, events);
  }
  return events;
}

describe('plan Centrali: prognoza i podgląd miesiąca (P7)', () => {
  it.each(SEEDS)('seed %s: każda kara z zamknięcia miesiąca była w podglądzie uruchomionym rano ostatniego dnia', (seed) => {
    const run = freshRun(seed);
    const { info, state: s } = run;
    let planMonths = 0;
    let fined = 0;
    let terminatedBy: string | null = null;
    while (!s.gameOver && planMonths < PLAN_MONTHS) {
      const last = lastDayOfMonthFrom(dayOf(s.minute));
      runTo(s, info, last * DAY + OPEN_FROM);
      if (s.gameOver) break;
      const forecast = forecastMonth(s, info);   // pasek rano ostatniego dnia
      const job = startMonthPreview(s, info);
      while (!job.step(5_000)) { /* porcjami do końca miesiąca */ }
      const preview = job.result()!;
      expect(preview).not.toBeNull();
      const month = runTo(s, info, (last + 1) * DAY).find((e) => e.kind === 'month');
      const report = month?.report;
      expect(report).toBeDefined();
      expect(preview.statement.plan).toBe(report!.statement!.plan);   // też gdy obie strony nie mają klucza
      expect(preview.statement.net).toBe(report!.statement!.net);
      if (report!.plan) planMonths++;
      if (report!.plan && report!.plan.fine > 0) {
        fined++;
        expect(preview.statement.plan).toBe(report!.plan.fine);
        expect(forecast.plan).toMatchObject({ verdict: 'miss' });   // pasek też pokazuje wpadkę, ze stopniem po rozliczeniu
        expect(forecast.plan!.stageAfter).toBe(report!.plan.stage);
        expect(forecast.statement.plan).toBeGreaterThan(0);
      }
      if (s.gameOver) {
        terminatedBy = gameOverReason(s);
        expect(preview.gameOver).toBe(terminatedBy);
      }
    }
    expect(planMonths).toBeGreaterThan(0);
    expect(fined).toBeGreaterThan(0);   // test nie przechodzi na pusto
    expect(terminatedBy).toBe('plan');   // koniec umowy za plan też był w podglądzie
  }, 300_000);
});

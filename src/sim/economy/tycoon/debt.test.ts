import { describe, expect, it } from 'vitest';
import { freshRun } from '@/sim/run';
import { DEBT_LIMIT, MINUTES_PER_DAY } from '../catalog';
import { applyCommand } from '../commands';
import { DEBT_WARN, cardContext, type EconEvent } from '../economy';
import { BOTS, runBot } from './bots';
import { cardDef, type CardInstance } from './cards';
import { MINOR_SALE_FINE } from './deck';
import { economyEnv } from './economyEnv';

/**
 * Granica debetu na biernym graczu. Duży koszt to mandat z ryzyka karty „Nastolatek po energetyka” (`minorSaleFine`: dwie typowe
 * marże dnia, nie mniej niż 4000 zł; w tym sklepie ok. 4,5 tys. zł), wymuszony tą samą drogą co odpowiedź na kartę (`applyCommand`,
 * `answerCard`): skutek ryzyka z definicji karty trafia do odpowiedzi, którą test wybiera.
 * Do SIM_VERSION 4 granica stała na −10 000 zł i trzy takie mandaty kończyły grę. Od SIM_VERSION 5 stoi na −100 000 zł (decyzja
 * właściciela z 30.10.2026: „zwiększ możliwy debet do 100k”), a mandatu nie przestrajano: trzy to dziś zwykły zły tydzień,
 * ostrzeżenie (−50 000 zł) przychodzi przy kilkunastu, a koniec gry dopiero przy ponad dwudziestu w dwa miesiące.
 */
const SEED = 'makieta';
const DAYS = 61;
/** `n` dni z dużym kosztem (o 14:30), równo od 3. do 55. dnia: liczy się dołek po opłacie na koniec miesiąca. */
const hitDays = (n: number): number[] => Array.from({ length: n }, (_, i) => Math.floor(3 + (i * 52) / n));

interface PassiveRun { minCash: number; gameOver: boolean; endDay: number; warnings: number; costs: number[] }

function passiveWith(hits: number): PassiveRun {
  const run = freshRun(SEED);
  const events: EconEvent[] = [];
  const env = economyEnv(run, (e) => events.push(e));
  const s = run.state;
  const at = new Set(hitDays(hits).map((d) => d * MINUTES_PER_DAY + 14 * 60 + 30));
  const costs: number[] = [];
  let minCash = s.cash;
  while (s.minute < DAYS * MINUTES_PER_DAY && !s.gameOver) {
    if (at.has(s.minute)) {
      const delta = cardDef('wiek')!.answers[1]!.risk!.delta(cardContext(s, run.info), {});   // „Sprzedaję”, kontrola weszła
      costs.push(-(delta.fine ?? 0));
      const card: CardInstance = {
        seq: s.tycoon.cards.seq++, id: 'wiek', day: Math.floor(s.minute / MINUTES_PER_DAY), showAt: s.minute, params: {},
        answers: [{ delta, mods: [], risk: null }], defaultAnswer: 0,
      };
      s.tycoon.cards.pending.push(card);
      events.push(...applyCommand(s, run.info, { type: 'answerCard', seq: card.seq, answer: 0 }).events);
    }
    runBot(BOTS.bierny, env, 1);
    minCash = Math.min(minCash, s.cash);
  }
  return { minCash, gameOver: s.gameOver, endDay: Math.floor(s.minute / MINUTES_PER_DAY), warnings: events.filter((e) => e.kind === 'debt').length, costs };
}

describe('granica debetu na biernym graczu (dwa miesiące, wymuszone duże koszty)', () => {
  it('bez pecha: dołek po opłacie na koniec miesiąca daleko od progu ostrzeżenia, gra trwa', () => {
    const r = passiveWith(0);
    expect(r.gameOver).toBe(false);
    expect(r.warnings).toBe(0);
    expect(r.minCash).toBeGreaterThan(DEBT_WARN);
  });

  it('trzy duże koszty (do SIM_VERSION 4 koniec gry): gra trwa, gotówka daleko od progu ostrzeżenia', () => {
    const r = passiveWith(3);
    expect(r.costs).toHaveLength(3);
    for (const c of r.costs) expect(c).toBeGreaterThanOrEqual(MINOR_SALE_FINE.min);
    expect(r.gameOver).toBe(false);
    expect(r.warnings).toBe(0);
    expect(r.minCash).toBeGreaterThan(DEBT_WARN);
  }, 60_000);

  it('piętnaście dużych kosztów: gotówka w strefie ostrzeżenia (50–90% granicy), ostrzeżenie, gra trwa', () => {
    const r = passiveWith(15);
    expect(r.gameOver).toBe(false);
    expect(r.warnings).toBeGreaterThanOrEqual(1);
    expect(r.minCash / DEBT_LIMIT).toBeGreaterThanOrEqual(0.5);
    expect(r.minCash / DEBT_LIMIT).toBeLessThanOrEqual(0.9);
  }, 60_000);

  it('dwadzieścia sześć dużych kosztów: koniec gry w dwa miesiące, gotówka poniżej granicy w chwili końca', () => {
    const r = passiveWith(26);
    expect(r.gameOver).toBe(true);
    expect(r.endDay).toBeLessThan(DAYS);
    expect(r.minCash).toBeLessThan(DEBT_LIMIT);
  }, 60_000);
});

import { describe, expect, it } from 'vitest';
import { freshRun } from '@/sim/run';
import { DEBT_LIMIT, MINUTES_PER_DAY } from '../catalog';
import { applyCommand } from '../commands';
import { DEBT_WARN, cardContext, type EconEvent } from '../economy';
import { BOTS, runBot } from './bots';
import type { CardInstance } from './cards';
import { economyEnv } from './economyEnv';

/**
 * Granica debetu na biernym graczu (decyzja właściciela z 29.10.2026): bierny bez pecha przeżywa dwa miesiące, dwa duże koszty to
 * spory problem (gotówka w strefie ostrzeżenia), trzy to koniec gry. Duży koszt to tu mandat w wysokości dwóch typowych marż dnia
 * (nie mniej niż 4000 zł), wymuszony tą samą drogą co odpowiedź na kartę (`applyCommand`, `answerCard`). Dziś żaden pojedynczy
 * koszt w grze nie jest tak duży (największy to mandat z ryzyka karty „Nastolatek po energetyka”, ok. 1,1 tys. zł); test pilnuje
 * granicy i ostrzeżenia, a nie konkretnej karty.
 */
const SEED = 'makieta';
const DAYS = 61;
/** Dni, w których Centrala wystawia duży koszt (o 14:30, w środku miesiąca: liczy się dołek po opłacie na koniec miesiąca). */
const HIT_DAYS = [12, 25, 44];

interface PassiveRun { minCash: number; gameOver: boolean; endDay: number; warnings: number; costs: number[] }

function passiveWith(hits: number): PassiveRun {
  const run = freshRun(SEED);
  const events: EconEvent[] = [];
  const env = economyEnv(run, (e) => events.push(e));
  const s = run.state;
  const at = new Set(HIT_DAYS.slice(0, hits).map((d) => d * MINUTES_PER_DAY + 14 * 60 + 30));
  const costs: number[] = [];
  let minCash = s.cash;
  while (s.minute < DAYS * MINUTES_PER_DAY && !s.gameOver) {
    if (at.has(s.minute)) {
      const cost = Math.max(4000, 2 * cardContext(s, run.info).dailyMargin);
      costs.push(cost);
      const card: CardInstance = {
        seq: s.tycoon.cards.seq++, id: 'wiek', day: Math.floor(s.minute / MINUTES_PER_DAY), showAt: s.minute, params: {},
        answers: [{ delta: { fine: -cost, trust: -2 }, mods: [], risk: null }], defaultAnswer: 0,
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

  it('dwa duże koszty: gotówka w strefie ostrzeżenia (60–90% granicy), jedno ostrzeżenie, gra trwa', () => {
    const r = passiveWith(2);
    expect(r.costs).toHaveLength(2);
    for (const c of r.costs) expect(c).toBeGreaterThanOrEqual(4000);
    expect(r.gameOver).toBe(false);
    expect(r.warnings).toBeGreaterThanOrEqual(1);
    expect(r.minCash / DEBT_LIMIT).toBeGreaterThanOrEqual(0.6);
    expect(r.minCash / DEBT_LIMIT).toBeLessThanOrEqual(0.9);
  }, 60_000);

  it('trzy duże koszty: koniec gry w dwa miesiące, gotówka poniżej granicy w chwili końca', () => {
    const r = passiveWith(3);
    expect(r.gameOver).toBe(true);
    expect(r.endDay).toBeLessThan(DAYS);
    expect(r.minCash).toBeLessThan(DEBT_LIMIT);
  }, 60_000);
});

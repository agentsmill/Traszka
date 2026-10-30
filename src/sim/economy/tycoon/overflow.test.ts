import { beforeAll, describe, expect, it } from 'vitest';
import { freshRun } from '@/sim/run';
import { MINUTES_PER_DAY, OPEN_TO } from '../catalog';
import { applyCommand } from '../commands';
import { aislePallets, type EconEvent } from '../economy';
import { minuteOfDay } from '../calendar';
import { BOTS, runBot } from './bots';
import { economyEnv } from './economyEnv';

/**
 * Nadmiar palet (decyzja właściciela z 30.10.2026: palet nikt nie odsyła, nadmiar „zasrywa” sklep): aktywny gracz (bot `decydent`)
 * przez dziesięć dni zamawia ręcznie 12 palet dziennie, czyli około trzy razy tyle, ile sklep sprzedaje, a potem wraca do asystenta.
 * Żadna paleta nie znika, nadmiar stoi w przejściach (kierowca stawia go tam sam, a palety spod sklepu bez miejsca na towar wciąga
 * załoga), klienci odchodzą, reputacja spada, a po powrocie do asystenta przejścia pustoszeją, bo sklep dalej sprzedaje. Ten sam
 * gracz bez nadmiaru (sam asystent) to punkt odniesienia. Liczby z tego biegu są w raporcie z 30.10.2026 (`OVERFLOW_REPORT=1`).
 * `kopytka-541` to mały sklep (6 miejsc pod sklepem, 3 w sali): kredyt kupiecki wpuszcza do niego więcej palet, niż mają miejsca.
 */
const SEED = 'kopytka-541';
const OVER_FROM = 3;
const OVER_DAYS = 10;
const DAYS = 45;

interface Day { customers: number; lost: number; aisle: number; reputation: number; delivered: number; unloaded: number }

let days: Day[] = [];
let events: EconEvent[] = [];
let profits: number[] = [];
/** Ten sam gracz bez nadmiaru: klienci dzień po dniu i wynik września. */
let baseline: { customers: number[]; september: number } = { customers: [], september: 0 };

beforeAll(() => {
  const ref = freshRun(SEED);
  const refEnv = economyEnv(ref);
  const refCustomers: number[] = [];
  for (let d = 0; d < DAYS; d++) {
    const before = ref.state.total.customers;
    runBot(BOTS.decydent, refEnv, MINUTES_PER_DAY);
    refCustomers.push(ref.state.total.customers - before);
  }
  baseline = { customers: refCustomers, september: ref.state.history[0]!.profit };

  const run = freshRun(SEED);
  const s = run.state;
  events = [];
  const env = economyEnv(run, (e) => events.push(e));
  let delivered = 2;   // dwie palety ze startu gry
  let peakAisle = 0;
  for (let d = 0; d < DAYS; d++) {
    if (d === OVER_FROM) applyCommand(s, run.info, { type: 'setOrder', auto: false, manual: 12 });
    if (d === OVER_FROM + OVER_DAYS) applyCommand(s, run.info, { type: 'setOrder', auto: true });
    const before = { customers: s.total.customers, lost: s.total.lost, unloaded: s.total.palletsUnloaded };
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const seen = events.length;
      runBot(BOTS.decydent, env, 1);
      for (const e of events.slice(seen)) if (e.kind === 'delivery') delivered += Number(/Dostawa: (\d+)/.exec(e.text)![1]);
      if (minuteOfDay(s.minute) === OPEN_TO) peakAisle = Math.max(peakAisle, aislePallets(s));
    }
    days.push({
      customers: s.total.customers - before.customers, lost: s.total.lost - before.lost, aisle: Math.max(peakAisle, aislePallets(s)),
      reputation: s.reputation, delivered, unloaded: s.total.palletsUnloaded - before.unloaded,
    });
    peakAisle = 0;
    // bilans palet: każda dostarczona jest rozładowana albo dalej stoi w sklepie
    expect(s.total.palletsUnloaded + s.pallets.length, `dzień ${d}`).toBe(delivered);
  }
  profits = s.history.map((h) => h.profit);
}, 120_000);

const mean = (xs: number[]): number => xs.reduce((n, x) => n + x, 0) / xs.length;

describe('nadmiar palet: zamówienie ręczne ponad sprzedaż, potem powrót do asystenta', () => {
  it('żadna paleta nie znika i nikt jej nie zabiera', () => {
    expect(events.some((e) => e.text.includes('zabrał'))).toBe(false);
    expect(events.some((e) => e.kind === 'warning' && e.text.includes('w przejściach'))).toBe(true);
  });

  it('nadmiar stoi w przejściach: około dziesięciu palet w szczycie', () => {
    const peak = Math.max(...days.map((d) => d.aisle));
    expect(peak).toBeGreaterThanOrEqual(8);
    expect(days.slice(0, OVER_FROM).every((d) => d.aisle === 0)).toBe(true);   // asystent sam przejść nie zagraca
  });

  it('zagracony sklep traci klientów i reputację, ale sprzedaje dalej (ruch nie spada do zera)', () => {
    const cluttered = days.flatMap((d, i) => (d.aisle >= 6 ? [i] : []));
    expect(cluttered.length).toBeGreaterThanOrEqual(5);
    const during = mean(cluttered.map((i) => days[i]!.customers));
    const same = mean(cluttered.map((i) => baseline.customers[i]!));
    expect(during).toBeLessThan(0.75 * same);
    expect(during).toBeGreaterThan(0.25 * same);
    expect(Math.min(...days.map((d) => d.reputation))).toBeLessThan(days[OVER_FROM - 1]!.reputation - 15);
  });

  it('po powrocie do asystenta przejścia pustoszeją w ciągu trzech tygodni, a ruch wraca', () => {
    const back = OVER_FROM + OVER_DAYS;
    const clearDay = days.findIndex((d, i) => i >= back && d.aisle === 0);
    expect(clearDay, `przejścia puste od dnia ${clearDay}`).toBeGreaterThan(back);
    expect(clearDay - back).toBeLessThanOrEqual(21);
    expect(days.slice(-5).every((d) => d.aisle === 0)).toBe(true);
    const cluttered = mean(days.filter((d) => d.aisle >= 6).map((d) => d.customers));
    expect(mean(days.slice(-5).map((d) => d.customers))).toBeGreaterThan(1.3 * cluttered);
  });

  it('nadmiar kosztuje: wrzesień wychodzi gorzej niż ten sam gracz bez nadmiaru, ale bez mandatów i bez końca gry', () => {
    if (process.env.OVERFLOW_REPORT) {
      console.log(JSON.stringify({ profits: profits.map(Math.round), baseline: { september: Math.round(baseline.september), customers: baseline.customers.map(Math.round) }, days: days.map((d) => ({ ...d, customers: Math.round(d.customers), lost: Math.round(d.lost), reputation: Math.round(d.reputation) })) }));
    }
    expect(profits.length).toBeGreaterThanOrEqual(1);
    expect(profits[0]!).toBeLessThan(baseline.september - 5000);
    expect(events.some((e) => e.kind === 'fine')).toBe(false);
    expect(events.some((e) => e.kind === 'gameover')).toBe(false);
  });
});

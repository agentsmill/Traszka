import { describe, expect, it } from 'vitest';
import {
  createPlan, firstPlanPreview, planBase, planDue, planGrowth, planOutlook, planTarget,
  planTerminates, rollPlan, sanitizePlan, settlePlan, type PlanState,
} from './plan';

describe('plan sprzedaży Centrali', () => {
  it('wzrost: 1% bez serii, +0,25 pp za trafienie, sufit 3%', () => {
    expect(planGrowth(0)).toBeCloseTo(0.01); expect(planGrowth(3)).toBeCloseTo(0.0175); expect(planGrowth(40)).toBeCloseTo(0.03);
  });
  it('baza: średnia z trzech miesięcy, ale nie mniej niż 95% poprzedniej', () => {
    expect(planBase([10_000, 11_000, 12_000], 0)).toBe(11_000);
    expect(planBase([5_000, 5_000, 5_000], 10_000)).toBe(9_500);
  });
  it('pierwszy plan: aktywny tylko pierwszego dnia czwartego miesiąca', () => {
    const h = [{ revenue: 300_000 }, { revenue: 310_000 }, { revenue: 300_000 }];   // wrzesień, październik, listopad
    expect(createPlan(h, 91).target).toBeGreaterThan(0);        // 1 grudnia
    expect(createPlan(h, 95).target).toBe(0);                   // zapis wczytany w środku miesiąca
    expect(createPlan([...h, { revenue: 1 }], 121).target).toBe(0);   // dłuższa historia = stary zapis
    expect(firstPlanPreview(h, 91)).toBe(createPlan(h, 91).target);
  });
  it('trafienie: premia 1% obrotu, seria +1, stopień w dół', () => {
    const p: PlanState = { target: 400_000, base: 12_900, recent: [12_000, 12_500, 13_000], streak: 2, stage: 1, openDays: 31, topUp: false };
    const r = settlePlan(p, { revenue: 410_000, monthDays: 31, nextMonthDays: 30, cash: 0, debtWarn: -50_000 })!;
    expect(r).toMatchObject({ hit: true, bonus: 4_100, fine: 0, trust: 2, stage: 0, stageBefore: 1, streak: 3, bought: 0 });
    expect(p.openDays).toBe(0); expect(p.target).toBe(r.nextTarget);
  });
  it('wpadki: 10% i 20% brakującego obrotu, trzecia kończy umowę bez kary', () => {
    const p: PlanState = { target: 400_000, base: 12_900, recent: [], streak: 5, stage: 0, openDays: 30, topUp: false };
    const i = { revenue: 300_000, monthDays: 30, nextMonthDays: 30, cash: 0, debtWarn: -50_000 };
    expect(settlePlan(p, i)).toMatchObject({ hit: false, fine: 10_000, stage: 1, stageBefore: 0, streak: 0, trust: -2 });
    p.target = 400_000; p.openDays = 30;
    expect(settlePlan(p, i)).toMatchObject({ fine: 20_000, stage: 2, stageBefore: 1 });
    p.target = 400_000; p.openDays = 30;
    expect(settlePlan(p, i)).toMatchObject({ fine: 0, stage: 3, stageBefore: 2 });
    expect(planTerminates(p)).toBe(true);
  });
  it('raport: obrót w pełnych złotych, wykonanie do 4 miejsc, ale trafienie i kara z liczb bez zaokrągleń', () => {
    const mk = (): PlanState => ({ target: 300_000, base: 10_000, recent: [], streak: 0, stage: 0, openDays: 30, topUp: false });
    const i = { monthDays: 30, nextMonthDays: 30, cash: 0, debtWarn: -50_000 };
    const r = settlePlan(mk(), { ...i, revenue: 299_999.6 })!;
    expect(r).toMatchObject({ turnover: 300_000, share: 0.9999, hit: false, fine: 0 });   // 0,4 zł brakuje: wpadka, kara 10% z 0,4 zł = 0, ale wykonanie nie może wyglądać na 100%
    const q = settlePlan(mk(), { ...i, revenue: 212_345.678_9 })!;
    expect(q.turnover).toBe(212_346);
    expect(q.share).toBe(0.7078);
    expect(q.fine).toBe(Math.round(0.1 * (300_000 - 212_345.678_9)));
  });
  it('baza po wpadce spada najwyżej o 5%', () => {
    const p: PlanState = { target: 400_000, base: 13_000, recent: [13_000, 13_000, 13_000], streak: 0, stage: 0, openDays: 30, topUp: false };
    settlePlan(p, { revenue: 30_000, monthDays: 30, nextMonthDays: 30, cash: 0, debtWarn: -50_000 });
    expect(p.base).toBe(12_350);
  });
  it('dobicie: 92% wykonania i włączony przełącznik = trafienie bez premii, koszt 83% brakującego obrotu', () => {
    const p: PlanState = { target: 400_000, base: 12_900, recent: [], streak: 0, stage: 1, openDays: 30, topUp: true };
    const r = settlePlan(p, { revenue: 368_000, monthDays: 30, nextMonthDays: 30, cash: 100_000, debtWarn: -50_000 })!;
    expect(r).toMatchObject({ hit: true, bought: 32_000, cost: 26_560, bonus: 0, stage: 0, stageBefore: 1, streak: 1 });
    expect(p.recent.at(-1)).toBe(Math.round(400_000 / 30));     // dokupiony obrót podnosi bazę
  });
  it('dobicia nie ma poniżej 90%, przy wyłączonym przełączniku i gdy portfel spadłby poniżej progu ostrzeżenia', () => {
    const mk = (topUp: boolean): PlanState => ({ target: 400_000, base: 12_900, recent: [], streak: 0, stage: 0, openDays: 30, topUp });
    const i = { monthDays: 30, nextMonthDays: 30, debtWarn: -50_000 };
    expect(settlePlan(mk(true), { ...i, revenue: 350_000, cash: 1e6 })!.hit).toBe(false);
    expect(settlePlan(mk(false), { ...i, revenue: 380_000, cash: 1e6 })!.hit).toBe(false);
    expect(settlePlan(mk(true), { ...i, revenue: 380_000, cash: -40_000 })!.hit).toBe(false);
  });
  it('remont: plan proporcjonalny do dni otwartych, zero dni = brak rozliczenia', () => {
    const p: PlanState = { target: 300_000, base: 10_000, recent: [10_000], streak: 1, stage: 1, openDays: 24, topUp: false };
    expect(planDue(p, 30)).toBe(240_000);
    p.openDays = 0;
    expect(settlePlan(p, { revenue: 0, monthDays: 30, nextMonthDays: 30, cash: 0, debtWarn: 0 })).toBeNull();
    expect(p).toMatchObject({ target: 300_000, stage: 1, streak: 1 });
  });
  it('miesiąc zapowiedzi: bez rozliczenia, potem plan z historii', () => {
    const h = [{ revenue: 300_000 }, { revenue: 310_000 }, { revenue: 300_000 }, { revenue: 310_000 }];
    const p = createPlan(h.slice(0, 3), 95);
    expect(settlePlan(p, { revenue: 1, monthDays: 31, nextMonthDays: 31, cash: 0, debtWarn: 0 })).toBeNull();
    rollPlan(p, h, 121);                                         // 31 grudnia
    expect(p.target).toBeGreaterThan(0); expect(Number.isFinite(p.base)).toBe(true);
  });
  it('prognoza mówi to samo, co rozliczenie', () => {
    const p: PlanState = { target: 400_000, base: 12_900, recent: [], streak: 0, stage: 1, openDays: 20, topUp: false };
    const o = planOutlook(p, { revenue: 200_000, forecastRevenue: 300_000, monthDays: 30, openDaysAhead: 10, cash: 0, debtWarn: -50_000 })!;
    expect(o).toMatchObject({ verdict: 'miss', fine: 20_000, stage: 1, stageAfter: 2 });
  });
  it('zapis: śmieci nie przechodzą, poprawny blok wraca bajt w bajt', () => {
    expect(sanitizePlan(null)).toBeUndefined();
    expect(sanitizePlan({ target: NaN, stage: 9, recent: [1, 2, 3, 4, 'x'] })).toMatchObject({ target: 0, stage: 3, recent: [2, 3, 4] });
    const p: PlanState = { target: 400_000, base: 12_900, recent: [1, 2, 3], streak: 2, stage: 1, openDays: 7, topUp: true };
    expect(JSON.stringify(sanitizePlan(JSON.parse(JSON.stringify(p))))).toBe(JSON.stringify(p));
  });
});

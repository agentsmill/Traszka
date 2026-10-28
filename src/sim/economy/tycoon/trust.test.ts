import { describe, expect, it } from 'vitest';
import {
  TRUST, addTrust, auditWeight, closeTrustMonth, createTrust, sanitizeTrust, trustTerminates, trustTier, turnoverBonusShare,
  viralShare, type TrustState,
} from './trust';
import { WUT, addWut, closeWutMonth, createWut, sanitizeWut, wutCharge, wutFromSales, wutSlack, wutTotal, type WutState } from './wut';
import {
  KPI, closeKpiMonth, closeKpiWeek, kpiHit, kpiProgress, kpiTitle, kpiValue, newKpiWeek, sanitizeKpi, weekEnd, type KpiMetrics,
  type KpiState,
} from './kpi';
import { weekdayOf } from './time';

describe('zaufanie Centrali', () => {
  it('start 60 („W porządku”), widoczne od pierwszego dnia', () => {
    const t = createTrust();
    expect(t.value).toBe(TRUST.start);
    expect(trustTier(t.value).label).toBe('W porządku');
  });

  it('zmiany mają przyczynę; raport miesiąca zbiera je od największej', () => {
    const t = createTrust();
    addTrust(t, 'mandaty', TRUST.fine);
    addTrust(t, 'mandaty', TRUST.fine);
    addTrust(t, 'kpi', TRUST.kpiHit);
    addTrust(t, 'palety', TRUST.returnedPallet);
    const m = closeTrustMonth(t);
    expect(m).toEqual({ start: 60, end: 57, delta: -3, reasons: [['palety', -4], ['kpi', 3], ['mandaty', -2]] });
    expect(t.monthStart).toBe(57);
    expect(t.month).toEqual({});
  });

  it('miękkie granice: wysoko zyski liczą się w połowie, nisko straty też; raport widzi zmianę po przycięciu', () => {
    const high = createTrust(80);
    expect(addTrust(high, 'kpi', 4)).toBe(2);
    expect(addTrust(high, 'mandaty', -4)).toBe(-4);
    const low = createTrust(25);
    expect(addTrust(low, 'mandaty', -4)).toBe(-2);
    expect(addTrust(low, 'kpi', 4)).toBe(4);
    const t = createTrust(98);
    expect(addTrust(t, 'wynik', 5)).toBe(2);
    expect(addTrust(t, 'inne', -500)).toBe(-100);
    expect(t.value).toBe(0);
    expect(trustTerminates(t.value)).toBe(true);
    expect(addTrust(t, 'inne', Number.NaN)).toBe(0);
  });

  it('wysokie zaufanie: większy przydział wiralowy, premia od obrotu, rzadsze audyty', () => {
    expect(viralShare(10)).toBe(0);
    expect(viralShare(55)).toBeCloseTo(0.5);
    expect(viralShare(95)).toBe(1);
    expect(turnoverBonusShare(60)).toBe(0);
    expect(turnoverBonusShare(70)).toBe(0.01);
    expect(turnoverBonusShare(90)).toBe(0.015);
    expect(auditWeight(30)).toBeGreaterThan(auditWeight(80));
    expect(auditWeight(80)).toBe(1);
    expect(trustTier(5).label).toBe('Na wylocie');
    expect(trustTier(95).label).toBe('Ulubieniec Centrali');
  });

  it('zapis: JSON w obie strony; stary zapis bierze zaufanie z EconomyState.trust', () => {
    const t = createTrust(72);
    addTrust(t, 'karty', -3);
    expect(sanitizeTrust(JSON.parse(JSON.stringify(t)) as TrustState)).toEqual(t);
    expect(sanitizeTrust(undefined, 44)).toEqual(createTrust(44));
    expect(sanitizeTrust({ value: 'x', month: { kpi: 1e9, nieznane: 4 } }).month).toEqual({ kpi: 100 });
  });
});

describe('WUT', () => {
  it('naturalne ubytki od obrotu mieszczą się pod progiem, decyzje mogą go przebić', () => {
    const w = createWut();
    wutFromSales(w, 300_000);
    expect(wutTotal(w)).toBeCloseTo(2700);
    expect(wutCharge(w, 300_000)).toBe(0);
    addWut(w, 'karty', 1500);
    expect(wutCharge(w, 300_000)).toBeCloseTo(4200 - WUT.threshold * 300_000);
  });

  it('luz pod progiem liczy też ubytki, które jeszcze przyjdą z obrotu', () => {
    const w = createWut();
    wutFromSales(w, 100_000);
    const slack = wutSlack(w, 100_000, 300_000);
    expect(slack).toBeCloseTo(0.012 * 300_000 - 0.009 * 300_000);
    addWut(w, 'karty', slack + 100);
    wutFromSales(w, 200_000);
    expect(wutCharge(w, 300_000)).toBeCloseTo(100);
  });

  it('program refundacyjny odpisuje, ale nie poniżej zera; koniec miesiąca zeruje', () => {
    const w = createWut();
    addWut(w, 'karty', 300);
    addWut(w, 'karty', -500);
    expect(w.month.karty).toBe(0);
    addWut(w, 'termin', 4000);
    expect(closeWutMonth(w, 100_000)).toEqual({ total: 4000, charge: 2800, byReason: { termin: 4000, kradziez: 0, pomylki: 0, karty: 0 } });
    expect(wutTotal(w)).toBe(0);
  });

  it('zapis', () => {
    const w = createWut();
    addWut(w, 'kradziez', 123.5);
    expect(sanitizeWut(JSON.parse(JSON.stringify(w)) as WutState)).toEqual(w);
    expect(sanitizeWut({ month: { termin: -5, karty: 'x' } })).toEqual(createWut());
  });
});

const M0: KpiMetrics = { customers: 0, hotSold: 0, lost: 0, fines: 0, cleanSum: 0, cleanMinutes: 0 };
const SCALE = { dailyCustomers: 470, dailyMargin: 2000 };

describe('KPI tygodnia', () => {
  it('tydzień kończy się w niedzielę; start gry we wtorek daje krótszy tydzień', () => {
    expect(weekEnd(0)).toBe(5);
    expect(weekdayOf(weekEnd(0))).toBe(0);
    expect(weekEnd(5)).toBe(12);
    expect(weekEnd(6)).toBe(12);
  });

  it('cel zależy od wielkości sklepu i długości tygodnia; rodzaj z seeda, inny niż poprzedni', () => {
    const k = newKpiWeek(7, 1, 6, M0, SCALE);
    const again = newKpiWeek(7, 1, 6, M0, SCALE);
    expect(again).toEqual(k);
    const kinds = new Set<string>();
    let prev = k.kind;
    for (let seq = 2; seq < 40; seq++) {
      const next = newKpiWeek(7, seq, 6, M0, SCALE, prev);
      expect(next.kind).not.toBe(prev);
      kinds.add(next.kind);
      prev = next.kind;
    }
    expect(kinds.size).toBe(5);
  });

  it('„kawy”: cel z zapasem ponad typowy tydzień, postęp z różnicy liczników', () => {
    const k: KpiState = { ...newKpiWeek(1, 1, 6, M0, SCALE), kind: 'kawy', target: 150 };
    const now = { ...M0, hotSold: 90 };
    expect(kpiValue(k, now)).toBe(90);
    expect(kpiProgress(k, now)).toBeCloseTo(0.6);
    expect(kpiHit(k, now)).toBe(false);
    expect(kpiHit(k, { ...now, hotSold: 151 })).toBe(true);
    expect(kpiTitle('kawy', 150)).toBe('Sprzedaj 150 kaw i hot-dogów do niedzieli');
  });

  it('limity: „bez mandatu” pęka przy pierwszym mandacie, „kolejka” liczy odstraszonych', () => {
    const fines: KpiState = { ...newKpiWeek(1, 1, 6, M0, SCALE), kind: 'bezMandatu', target: 0 };
    expect(kpiHit(fines, M0)).toBe(true);
    expect(kpiProgress(fines, { ...M0, fines: 1 })).toBe(0);
    expect(kpiHit(fines, { ...M0, fines: 1 })).toBe(false);
    const lost: KpiState = { ...fines, kind: 'kolejka', target: 60 };
    expect(kpiHit(lost, { ...M0, lost: 59 })).toBe(true);
    expect(kpiProgress(lost, { ...M0, lost: 30 })).toBeCloseTo(0.5);
    expect(kpiHit(lost, { ...M0, lost: 61 })).toBe(false);
  });

  it('„czystość”: średnia z minut otwarcia w tygodniu', () => {
    const k: KpiState = { ...newKpiWeek(1, 1, 6, { ...M0, cleanSum: 5000, cleanMinutes: 100 }, SCALE), kind: 'czystosc', target: 75 };
    expect(kpiValue(k, k.start)).toBe(100);
    expect(kpiValue(k, { ...M0, cleanSum: 5000 + 70 * 50, cleanMinutes: 150 })).toBe(70);
    expect(kpiHit(k, { ...M0, cleanSum: 5000 + 80 * 50, cleanMinutes: 150 })).toBe(true);
  });

  it('zamknięcie tygodnia: zaufanie i premia za trafiony, kara za nietrafiony, nowy tydzień od poniedziałku', () => {
    const k: KpiState = { ...newKpiWeek(1, 1, 6, M0, SCALE), kind: 'klienci', target: 3000 };
    const hit = closeKpiWeek(k, { ...M0, customers: 3100 }, 1, 13, SCALE);
    expect(hit).toEqual({ kind: 'klienci', target: 3000, value: 3100, hit: true, trust: KPI.trustHit, bonus: 600 });
    expect(k.seq).toBe(2);
    expect(k.fromDay).toBe(13);
    expect(k.toDay).toBe(19);
    expect(k.start.customers).toBe(3100);
    expect(k.kind).not.toBe('klienci');
    const miss = closeKpiWeek({ ...k, kind: 'kawy', target: 1e6 }, { ...M0, customers: 3100 }, 1, 20, SCALE);
    expect(miss.trust).toBe(KPI.trustMiss);
    expect(miss.bonus).toBe(0);
    expect(closeKpiMonth(k)).toEqual({ hit: 1, miss: 0 });
  });

  it('zapis: JSON w obie strony, uszkodzony KPI zaczyna tydzień od nowa', () => {
    const k = newKpiWeek(3, 4, 6, { ...M0, customers: 77 }, SCALE);
    const fresh = newKpiWeek(3, 9, 20, M0, SCALE);
    expect(sanitizeKpi(JSON.parse(JSON.stringify(k)) as KpiState, fresh)).toEqual(k);
    expect(sanitizeKpi({ kind: 'nieznany' }, fresh)).toBe(fresh);
    expect(sanitizeKpi({ ...k, toDay: 1e9, target: -5 }, fresh).toDay).toBe(k.fromDay + 7);
  });
});

import { describe, expect, it } from 'vitest';
import {
  COMMENTS, HINT_IDS, buildMonthReport, commentPool, hintText, pickHint, reportCommentText, sanitizeReport, type MonthFigures,
  type ReportInput, type TycoonMonthReport,
} from './report';
import { emptyStaffStats } from './staff';

const FIG: MonthFigures = {
  revenue: 300_000, margin: 60_000, bonuses: 1200, other: -300, wages: 20_400, media: 4200, fee: 13_500, fines: 0, wut: 0,
  logistics: 0, customers: 14_000, lost: 0,
};

function input(over: Partial<ReportInput> = {}, fig: Partial<MonthFigures> = {}): ReportInput {
  return {
    monthIndex: 0,
    figures: { ...FIG, ...fig },
    trust: { start: 60, end: 64, delta: 4, reasons: [['kpi', 6], ['mandaty', -2]] },
    cleanlinessAvg: 85,
    staff: emptyStaffStats(),
    days: 30,
    staffCount: 2,
    exhaustedDays: 0,
    kpi: { hit: 3, miss: 1 },
    cards: { answered: 40, defaults: 10 },
    marginPerCustomer: 4.2,
    ...over,
  };
}

describe('raport miesięczny', () => {
  it('wynik po pozycjach: przychody na plus, koszty na minus, suma to wynik', () => {
    const r = buildMonthReport(input({}, { fines: 1500, wut: 400, logistics: 120 }), 1);
    expect(r.lines.map((l) => l.key)).toEqual(['marza', 'premie', 'inne', 'place', 'media', 'oplata', 'mandaty', 'wut', 'logistyka']);
    expect(r.lines.find((l) => l.key === 'mandaty')!.amount).toBe(-1500);
    expect(r.result).toBe(60_000 + 1200 - 300 - 20_400 - 4200 - 13_500 - 1500 - 400 - 120);
    expect(r.trust.delta).toBe(4);
  });

  it('komentarz Centrali pasuje do wyniku i jest deterministyczny', () => {
    expect(commentPool(-1)).toBe('strata');
    expect(commentPool(0)).toBe('zero');
    expect(commentPool(12_000)).toBe('plus');
    expect(commentPool(45_000)).toBe('rekord');
    const a = buildMonthReport(input(), 7);
    expect(buildMonthReport(input(), 7).commentId).toBe(a.commentId);
    expect(a.commentId.startsWith('plus-') || a.commentId.startsWith('rekord-') || a.commentId.startsWith('zero-')).toBe(true);
    expect(reportCommentText(a.commentId).length).toBeGreaterThan(20);
    const loss = buildMonthReport(input({}, { margin: 10_000 }), 7);
    expect(loss.commentId.startsWith('strata-')).toBe(true);
    const ids = new Set<string>();
    for (let m = 0; m < 30; m++) ids.add(buildMonthReport(input({ monthIndex: m }), 7).commentId);
    expect(ids.size).toBe(COMMENTS.plus.length);
  });

  it('jedna wskazówka: sprawa, która kosztowała najwięcej', () => {
    expect(pickHint(input({}, { fines: 3000, wut: 500 })).id).toBe('mandaty');
    expect(pickHint(input({}, { fines: 1000, lost: 500 })).id).toBe('kolejka');
    expect(pickHint(input({ cleanlinessAvg: 30 })).id).toBe('czystosc');
    expect(pickHint(input({ trust: { start: 60, end: 48, delta: -12, reasons: [] } })).id).toBe('zaufanie');
    expect(pickHint(input({ cards: { answered: 45, defaults: 40 } })).id).toBe('karty');
    expect(pickHint(input()).id).toBe('brawo');
  });

  it('wskazówka o ludziach: palety i półki bez rąk, bezczynność', () => {
    const busy = emptyStaffStats();
    busy.starved.rozladunek = 6000;
    busy.starved.wykladanie = 3000;
    busy.starved.sprzatanie = 50_000;   // sprzątanie ma własną wskazówkę (czystość), tu się nie liczy
    busy.worked.kasa = 30_000;
    expect(pickHint(input({ staff: busy }))).toMatchObject({ id: 'braki', value: 150 });
    const onlySweep = emptyStaffStats();
    onlySweep.starved.sprzatanie = 50_000;
    expect(pickHint(input({ staff: onlySweep })).id).toBe('brawo');
    const idle = emptyStaffStats();
    idle.worked.kasa = 20_000;
    idle.idle = 40_000;
    expect(pickHint(input({ staff: idle })).id).toBe('bezczynnosc');
  });

  it('teksty wskazówek po polsku, z liczbą w środku; formatowanie robi interfejs', () => {
    for (const id of HINT_IDS) {
      const t = hintText({ id, value: 1234.4 });
      expect(t.length, id).toBeGreaterThan(30);
      if (id !== 'brawo') expect(t, id).toContain('1234');
    }
    expect(hintText({ id: 'mandaty', value: 1500 }, (n) => `${n / 1000} tys.`)).toContain('1.5 tys. zł');
  });

  it('raport w stanie gry to liczby i identyfikatory (bez gotowych tekstów); zapis w obie strony', () => {
    const r = buildMonthReport(input({}, { fines: 900 }), 3);
    const json = JSON.stringify(r);
    expect(json).not.toContain('zł');
    expect(sanitizeReport(JSON.parse(json) as TycoonMonthReport)).toEqual(r);
    expect(sanitizeReport({ lines: 'nie' })).toBeNull();
    const bad = sanitizeReport({ lines: [{ key: 'marza', amount: 5 }, { key: 'łapówki', amount: 9 }], commentId: 'x-9', hint: { id: '?' } })!;
    expect(bad.lines).toEqual([{ key: 'marza', amount: 5 }]);
    expect(bad.result).toBe(5);
    expect(bad.commentId).toBe('zero-0');
    expect(bad.hint.id).toBe('brawo');
  });
});

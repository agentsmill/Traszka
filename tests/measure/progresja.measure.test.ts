import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROG_STRATEGIES, playProgresja, type ProgResult, type ProgStrategy } from '../progresjaPlay';

/*
 * Pomiar progresji etapu 4b (spec §5.10, plan Zadanie 10): strategie `bierny`, `mistrz`, `jeden`, `trzy` i `siec` (`tests/progresjaPlay.ts`)
 * na pięciu seedach raportu 4a.1 przez 24 miesiące, tabela do raportu i bramki B1–B4 jako asercje. Nie jest testem bramkowym `npm test`:
 * biegnie tylko z `MEASURE=1`, a wynik zapisuje do `OUT` (JSON).
 *   MEASURE=1 MONTHS=24 OUT=/tmp/progresja.json npx vitest run tests/measure/progresja.measure.test.ts --reporter=verbose
 * Zmienne: SEEDS (lista po przecinku), MONTHS (domyślnie 24), STRATEGIES. Bramki sprawdzają się tylko na pełnym zestawie (24 miesiące, pięć seedów).
 *
 * Wartości bazowe (`BASELINE_*`) zmierzył `tests/measure/miasto.measure.test.ts` (strategie `bierny`, `mistrz`, `mistrzZakupy` = `jeden`, 24 miesiące)
 * na commicie bazowym etapu 562a49e (rodzic pierwszego commitu Zadania 1), w osobnym worktree. „Wynik” to „Zostaje Ci” z wyciągu Centrali,
 * razem we wszystkich sklepach, średnio na miesiąc 13–24, potem średnio po seedach (ta sama definicja co w pomiarze miasta).
 */

const SEEDS = (process.env.SEEDS ?? 'traszka-1,kopytka-541,makieta,lublin-9,seed-3').split(',');
const MONTHS = Number(process.env.MONTHS ?? 24);
const STRATEGIES = (process.env.STRATEGIES ? process.env.STRATEGIES.split(',') : PROG_STRATEGIES) as ProgStrategy[];

/** Gotówka po zamknięciu m. 12 (wrzesień = 1) na commicie bazowym, po seedach w kolejności `SEEDS`, i średnio. */
export const BASELINE_CASH_M12: Record<'bierny' | 'mistrz' | 'jeden', { seeds: number[]; mean: number }> = {
  bierny: { seeds: [171_375, 95_349, 132_490, 108_237, 142_549], mean: 130_000 },
  mistrz: { seeds: [230_894, 145_340, 173_574, 170_746, 210_009], mean: 186_113 },
  jeden: { seeds: [328_196, 279_684, 287_588, 290_953, 332_355], mean: 303_755 },
};
/** Średnie „Zostaje Ci” (po ratach, razem) m. 13–24 na commicie bazowym, po seedach i średnio: liczba, którą pomiar miasta nazywa „wynikiem”. */
export const BASELINE_NET_13_24: Record<'bierny' | 'mistrz' | 'jeden', { seeds: number[]; mean: number }> = {
  bierny: { seeds: [14_454, 7_656, 9_893, 9_050, 12_719], mean: 10_754 },
  mistrz: { seeds: [19_744, 12_492, 14_147, 13_142, 17_186], mean: 15_342 },
  jeden: { seeds: [80_877, 80_881, 81_214, 76_209, 85_435], mean: 80_923 },
};
/** Średni wynik bez rat (wynik miesiąca z historii i rankingu, `MonthReport.profit`) m. 13–24 na commicie bazowym, po seedach i średnio. */
export const BASELINE_RESULT_13_24: Record<'bierny' | 'mistrz' | 'jeden', { seeds: number[]; mean: number }> = {
  bierny: { seeds: [14_552, 7_118, 9_763, 9_041, 12_905], mean: 10_676 },
  mistrz: { seeds: [19_771, 12_573, 14_102, 13_011, 17_207], mean: 15_333 },
  jeden: { seeds: [115_816, 123_334, 121_830, 119_939, 121_182], mean: 120_420 },
};
/** Pierwszy milion na commicie bazowym (`mistrzZakupy`, jeden sklep): miesiąc po seedach. */
export const BASELINE_MILLION_JEDEN = [22, 22, 22, 22, 21];

const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const k = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? '-' : String(Math.round(x / 1000)));
const walletAt = (r: ProgResult, m: number): number | null => r.months[m - 1]?.wallet ?? null;
/** Pierwszy miesiąc, w którym suma „Zostaje Ci” od startu przekracza milion (ile gra dała zarobić, bez względu na wydatki gracza). */
const earnedMillion = (r: ProgResult): number | null => {
  let sum = 0;
  for (const m of r.months) if ((sum += m.net) >= 1_000_000) return m.month;
  return null;
};
const net1324 = (r: ProgResult): number => avg(r.months.slice(12, 24).map((m) => m.net));
const result1324 = (r: ProgResult): number => avg(r.months.slice(12, 24).map((m) => m.result));

describe.skipIf(!process.env.MEASURE)('pomiar progresji 4b', () => {
  it('strategie na seedach, bramki B1–B4', () => {
    const out: ProgResult[] = [];
    for (const strategy of STRATEGIES) for (const seed of SEEDS) out.push(playProgresja(strategy, seed, MONTHS));
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out));
    const of = (s: ProgStrategy): ProgResult[] => out.filter((r) => r.strategy === s);

    for (const strategy of STRATEGIES) {
      const runs = of(strategy);
      console.log(
        strategy.padEnd(7), '| gotówka tys. m.12:', runs.map((r) => k(walletAt(r, 12))).join(' '), 'm.24:', runs.map((r) => k(walletAt(r, 24))).join(' '),
        '| 1 mln (mies.):', runs.map((r) => r.millionMonth ?? '-').join(' '), '| 2 mln:', runs.map((r) => r.twoMillionMonth ?? '-').join(' '),
        '| sklepy na końcu:', runs.map((r) => r.remontsEnd.length).join(' '),
        '| odblokowanie 4./5. (mies.):', runs.map((r) => r.unlocks.map((u) => u.month).join('/') || '-').join(' '),
        '| niekupione przy 2 mln tys.:', runs.map((r) => k(r.unboughtAt2m?.total)).join(' '), '(na końcu', runs.map((r) => k(r.unboughtEnd.total)).join(' ') + ')',
        '| śr. wynik bez rat m.13–24:', Math.round(avg(runs.map(result1324))), '(', runs.map((r) => Math.round(result1324(r))).join(' '), ')',
        '| śr. „Zostaje Ci” m.13–24:', Math.round(avg(runs.map(net1324))), '(', runs.map((r) => Math.round(net1324(r))).join(' '), ')',
        '| koniec:', runs.map((r) => r.over ?? '-').join(' '), '| debet:', runs.map((r) => r.debtWarnings).join(' '),
      );
      if (runs.some((r) => r.opens.length > 0)) {
        console.log(
          ' '.repeat(7), '| otwarcia (mies./dzień):', runs.map((r) => r.opens.map((o) => `${o.month}/${o.day}`).join('+') || '-').join(' '),
          '| badania: poziomów', runs.map((r) => r.researchLevels).join(' '), 'wydane tys.', runs.map((r) => k(r.researchSpent)).join(' '),
          '| remonty na końcu:', runs.map((r) => r.remontsEnd.join('')).join(' '), '| sklepy przy 1 mln:', runs.map((r) => r.storesAtMillion ?? '-').join(' '),
        );
      }
      console.log(
        ' '.repeat(7), '| poziomy sklepów na końcu:', runs.map((r) => r.levelsEnd.join(',')).join(' '),
        '| zakupy tys. (remonty/ulepszenia/sprzęt, na raty szt.):', runs.map((r) => `${k(r.bought.remont)}/${k(r.bought.upgrade)}/${k(r.bought.equipment)},${r.bought.raty}`).join(' '),
        '| suma „Zostaje Ci” ≥ 1 mln (mies.):', runs.map((r) => earnedMillion(r) ?? '-').join(' '),
        '| poziom 28/34 (mies.):', runs.map((r) => `${r.level28Month ?? '-'}/${r.level34Month ?? '-'}`).join(' '),
      );
    }

    // bramki liczą się tylko na pełnym zestawie: krótszy bieg albo inne seedy to pomiar do oględzin
    if (MONTHS < 24 || SEEDS.join(',') !== 'traszka-1,kopytka-541,makieta,lublin-9,seed-3') return;
    const verdicts: { gate: string; ok: boolean; detail: string }[] = [];
    if (STRATEGIES.includes('siec')) {
      const siec = of('siec');
      const months = siec.map((r) => r.millionMonth ?? Infinity);
      const med = median(months);
      verdicts.push({ gate: 'B1', ok: med >= 10 && med <= 15 && Math.max(...months) <= 18, detail: `siec: mediana 1 mln ${med}, najgorszy ${Math.max(...months)} (wymagane [10, 15] i ≤ 18)` });
      const at2 = siec.map((r) => r.unboughtAt2m?.total ?? null);
      verdicts.push({
        gate: 'B2', ok: at2.every((x) => x === null || x >= 1_000_000),
        detail: `siec: niekupione przy 2 mln ${at2.map((x) => (x === null ? 'brak 2 mln' : `${k(x)} tys.`)).join(', ')} (wymagane ≥ 1 000 tys.)`,
      });
    }
    if (STRATEGIES.includes('jeden')) {
      const jeden = of('jeden');
      const res = avg(jeden.map(result1324));
      const ends = jeden.filter((r) => r.over !== null).length;
      const debts = jeden.reduce((n, r) => n + r.debtWarnings, 0);
      verdicts.push({
        gate: 'B3', ok: ends === 0 && debts === 0 && res >= 0.95 * BASELINE_RESULT_13_24.jeden.mean,
        detail: `jeden: końce gry ${ends}, ostrzeżenia o debecie ${debts}, śr. wynik bez rat m.13–24 ${Math.round(res)} wobec bazowego ${BASELINE_RESULT_13_24.jeden.mean} (${(res / BASELINE_RESULT_13_24.jeden.mean * 100).toFixed(1)}%, wymagane ≥ 95%)`,
      });
    }
    for (const s of ['mistrz', 'bierny'] as const) {
      if (!STRATEGIES.includes(s)) continue;
      const c12 = avg(of(s).map((r) => walletAt(r, 12) ?? 0));
      const base = BASELINE_CASH_M12[s].mean;
      verdicts.push({ gate: 'B4', ok: Math.abs(c12 / base - 1) <= 0.08, detail: `${s}: gotówka m.12 średnio ${Math.round(c12)} wobec bazowej ${base} (${((c12 / base - 1) * 100).toFixed(1)}%, wymagane ±8%)` });
    }
    for (const v of verdicts) console.log(`${v.gate} ${v.ok ? 'OK ' : 'PADA'} ${v.detail}`);
    if (process.env.OUT) writeFileSync(`${process.env.OUT}.gates.json`, JSON.stringify(verdicts));
    expect(verdicts.filter((v) => !v.ok).map((v) => `${v.gate}: ${v.detail}`)).toEqual([]);
  }, 7_200_000);
});

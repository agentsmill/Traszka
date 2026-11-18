import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { playProgresja, type ProgResult, type ProgStrategy } from '../progresjaPlay';

/*
 * Pomiar planu sprzedaży Centrali (etap 5a, spec §6.7, plan Zadanie 6): boty `mistrz`, `jeden`, `siec12` i `rozsadny` (`tests/progresjaPlay.ts`)
 * grają przeciw prawdziwemu planowi na pięciu seedach raportu 4b przez 24 miesiące; tabela do raportu i bramki P3–P6 jako asercje. Nie jest
 * testem bramkowym `npm test`: biegnie tylko z `MEASURE=1`. Szybka bramka w `npm test` to `tests/planBalance.test.ts`.
 *   MEASURE=1 OUT=/tmp/plan.json npx vitest run tests/measure/plan.measure.test.ts
 * Zmienne: SEEDS (lista po przecinku), MONTHS (domyślnie 24), STRATEGIES, OUT (wyniki jako JSON), MERGE (pliki JSON z innych biegów, po
 * przecinku: bramki liczą się z sumy, więc strategie można puścić w osobnych procesach równolegle). Bramki sprawdzają się tylko wtedy, gdy
 * suma ma wszystkie cztery strategie na pięciu seedach i 24 miesiące.
 */

const ALL_SEEDS = ['traszka-1', 'kopytka-541', 'makieta', 'lublin-9', 'seed-3'];
const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',') : ALL_SEEDS;
const MONTHS = Number(process.env.MONTHS ?? 24);
const PLAN_STRATEGIES: readonly ProgStrategy[] = ['mistrz', 'jeden', 'siec12', 'rozsadny'];
/** `STRATEGIES=none`: nic nie gra, tylko liczy bramki z plików `MERGE`. */
const STRATEGIES = (process.env.STRATEGIES ? process.env.STRATEGIES.split(',').filter((s) => s !== 'none') : PLAN_STRATEGIES) as ProgStrategy[];
/** Sklep startowy firmy (`createFirm`). */
const START_ID = 1;

/** Zamknięty miesiąc pierwszej wpadki któregokolwiek sklepu albo null. */
export const firstMiss = (r: ProgResult): number | null => r.months.find((m) => m.plans.some((p) => !p.hit))?.month ?? null;
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const k = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? '-' : String(Math.round(x / 1000)));
const show = (x: number | null): string => (x === null || !Number.isFinite(x) ? '-' : String(x));

describe.skipIf(!process.env.MEASURE)('pomiar planu Centrali 5a', () => {
  it('boty przeciw planowi, bramki P3–P6', () => {
    const played: ProgResult[] = [];
    for (const strategy of STRATEGIES) for (const seed of SEEDS) played.push(playProgresja(strategy, seed, MONTHS));
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(played));
    const merged = (process.env.MERGE ? process.env.MERGE.split(',') : []).flatMap((p) => JSON.parse(readFileSync(p, 'utf8')) as ProgResult[]);
    const all = [...merged, ...played];
    const of = (s: ProgStrategy): ProgResult[] => ALL_SEEDS.map((seed) => all.find((r) => r.strategy === s && r.seed === seed)).filter((r): r is ProgResult => !!r);

    for (const strategy of PLAN_STRATEGIES) {
      const runs = of(strategy);
      if (runs.length === 0) continue;
      console.log(`== ${strategy} (seedy: ${runs.map((r) => r.seed).join(' ')})`);
      for (const r of runs) {
        const misses = r.months.filter((m) => m.plans.some((p) => !p.hit)).map((m) => m.month);
        const shares = r.months.filter((m) => m.plans.length > 0).map((m) => `${m.month}:${m.plans.map((p) => `${Math.floor(p.share * 100)}${p.hit ? '' : '!'}`).join('/')}`);
        console.log(
          `${r.seed.padEnd(11)} | 1. wpadka: ${show(firstMiss(r))} | wpadki: ${misses.join(',') || '-'} | zamknięte planem: ${r.closedByPlan.map((c) => `#${c.storeId}@${c.month}`).join(' ') || '-'}`,
          `| 1 mln: ${show(r.millionMonth)} | sklepy na końcu: ${r.remontsEnd.length} | koniec: ${r.over ?? '-'}${r.overMonth ? `@${r.overMonth}` : ''} | miesięcy: ${r.months.length}`,
          `| portfel tys. m.12/m.24/koniec: ${k(r.months[11]?.wallet)}/${k(r.months[23]?.wallet)}/${k(r.finalWallet)} | debet: ${r.debtWarnings}`,
        );
        console.log(`${' '.repeat(11)} | wykonanie % (! = wpadka): ${shares.join(' ')}`);
      }
    }

    const complete = MONTHS >= 24 && PLAN_STRATEGIES.every((s) => of(s).length === ALL_SEEDS.length && of(s).every((r) => r.months.length >= 24 || r.over !== null));
    if (!complete) return;
    const verdicts: { gate: string; ok: boolean; detail: string }[] = [];
    {
      const runs = of('mistrz');
      const first = runs.map(firstMiss);
      const closed = runs.map((r) => r.closedByPlan.find((c) => c.storeId === START_ID)?.month ?? null);
      verdicts.push({
        gate: 'P3', ok: first.every((m) => m !== null && m >= 5 && m <= 9) && closed.every((m) => m !== null && m <= 18),
        detail: `mistrz: 1. wpadka ${first.map(show).join(', ')} (wymagane 5–9), utrata sklepu ${closed.map(show).join(', ')} (wymagane ≤ 18)`,
      });
    }
    {
      const first = of('jeden').map((r) => firstMiss(r) ?? Infinity);
      const med = median(first);
      verdicts.push({ gate: 'P4', ok: med >= 12, detail: `jeden: 1. wpadka ${first.map((m) => (Number.isFinite(m) ? m : 'brak')).join(', ')}, mediana ${Number.isFinite(med) ? med : 'brak'} (wymagane ≥ 12)` });
    }
    {
      const first = of('siec12').map(firstMiss);
      verdicts.push({ gate: 'P5', ok: first.every((m) => m !== null && m >= 13 && m <= 16), detail: `siec12: 1. wpadka ${first.map(show).join(', ')} (wymagane 13–16 na każdym seedzie)` });
    }
    {
      const runs = of('rozsadny');
      const million = runs.map((r) => r.millionMonth);
      const inWindow = million.filter((m) => m !== null && m >= 14 && m <= 22).length;
      const lost = runs.filter((r) => r.closedByPlan.some((c) => c.storeId === START_ID)).map((r) => r.seed);
      verdicts.push({
        gate: 'P6', ok: inWindow >= 3 && lost.length === 0,
        detail: `rozsadny: 1 mln w m. ${million.map(show).join(', ')} (w 14–22: ${inWindow} z 5, wymagane ≥ 3), sklep startowy stracony: ${lost.join(', ') || 'nigdzie'}`,
      });
    }
    for (const v of verdicts) console.log(`${v.gate} ${v.ok ? 'OK ' : 'PADA'} ${v.detail}`);
    if (process.env.OUT) writeFileSync(`${process.env.OUT}.gates.json`, JSON.stringify(verdicts));
    expect(verdicts.filter((v) => !v.ok).map((v) => `${v.gate}: ${v.detail}`)).toEqual([]);
  }, 14_400_000);
});

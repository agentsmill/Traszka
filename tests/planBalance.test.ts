import { describe, expect, it } from 'vitest';
import { playProgresja } from './progresjaPlay';

/*
 * Szybka bramka planu Centrali (etap 5a, plan Zadanie 6, Step 4) w `npm test`: boty `mistrz` (jeden sklep, nic nie kupuje) i `rozsadny`
 * (sieć, kupuje, gdy prognoza planu spada poniżej 105%) przez 13 miesięcy na dwóch seedach, przeciw prawdziwemu planowi. Pełny pomiar
 * z bramkami P3–P6 na pięciu seedach i 24 miesiącach to `tests/measure/plan.measure.test.ts` (tylko z `MEASURE=1`).
 */

const START_ID = 1;

describe('plan Centrali na botach przez 13 miesięcy', () => {
  for (const seed of ['traszka-1', 'kopytka-541']) {
    it(`${seed}: mistrz wpada do 9. miesiąca, rozsądny nie traci sklepu startowego, bez debetu, każda kara w wyciągu`, () => {
      const mistrz = playProgresja('mistrz', seed, 13);
      const rozsadny = playProgresja('rozsadny', seed, 13);
      const firstMiss = mistrz.months.find((m) => m.plans.some((p) => !p.hit))?.month ?? null;
      expect(firstMiss).not.toBeNull();
      expect(firstMiss!).toBeLessThanOrEqual(9);
      expect(rozsadny.closedByPlan.some((c) => c.storeId === START_ID)).toBe(false);
      for (const r of [mistrz, rozsadny]) {
        expect(r.over).not.toBe('debt');
        for (const m of r.months) for (const p of m.plans) if (p.fine > 0) expect(p.charged).toBe(p.fine);
      }
      // kara rzeczywiście się zdarza (inaczej ostatnia asercja niczego nie sprawdza)
      expect(mistrz.months.some((m) => m.plans.some((p) => p.fine > 0 && p.charged > 0))).toBe(true);
    }, 240_000);
  }
});

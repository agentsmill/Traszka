import { describe, expect, it } from 'vitest';
import { playProgresja } from './progresjaPlay';

/*
 * Szybka bramka progresji 4b w `npm test` (plan Zadanie 10, Step 4): strategia `siec` (`tests/progresjaPlay.ts`) na dwóch seedach przez
 * 13 miesięcy. Pełny pomiar z bramkami B1–B4 to `tests/measure/progresja.measure.test.ts` (tylko z `MEASURE=1`).
 *
 * Ruling (Zadanie 10): bramka nie patrzy na portfel w m. 13, tylko na sumę „Zostaje Ci” m. 1–13 (wszystko, co sieć przelała graczowi; tyle
 * miałby w portfelu, gdyby niczego nie kupował poza ratami). Bot `siec` wydaje co miesiąc prawie cały przelew (ulepszenia, badania, raty),
 * więc jego portfel w m. 13 to 146–324 tys. zł i mówi o tym, ile bot zostawił, a nie o sile sieci; próg z planu (≥ 700 000, nie niżej niż
 * 600 000) był liczony przy założeniu B1 (milion w portfelu w m. 10–15), którego ten bot nie spełnia (raport etapu). Próg to 90% gorszego
 * z dwóch seedów z ostatniego pomiaru, nie niżej niż 600 000 (Step 4).
 */

/** Suma „Zostaje Ci” m. 1–13 z pomiaru (2026-11-02, gałki 4b bez zmian): traszka-1 1 767 200, kopytka-541 662 578; 90% gorszego to 596 320. */
export const EARNED_13_MIN = 600_000;

describe('progresja 4b: sieć botów przez 13 miesięcy', () => {
  for (const seed of ['traszka-1', 'kopytka-541']) {
    it(`${seed}: pięć sklepów, bez końca gry, suma „Zostaje Ci” m. 1–13 ≥ ${EARNED_13_MIN}`, () => {
      const r = playProgresja('siec', seed, 13);
      expect(r.months.length).toBe(13);
      expect(r.over).toBeNull();
      expect(r.debtWarnings).toBe(0);
      expect(r.months[12]!.stores).toBe(5);
      expect(r.unlocks.map((u) => u.limit)).toEqual([4, 5]);
      expect(r.researchLevels).toBeGreaterThan(0);
      const earned = r.months.reduce((n, m) => n + m.net, 0);
      expect(earned).toBeGreaterThanOrEqual(EARNED_13_MIN);
    }, 240_000);
  }
});

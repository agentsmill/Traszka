import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, OPEN_TO } from './economy/catalog';
import { dateOfDay, dayOf, isLastDayOfMonth, minuteOfDay } from './economy/calendar';
import { createEconomy, stepMinute, type EconEvent, type EconomyState } from './economy/economy';
import { computeStoreInfo } from './economy/storeInfo';
import { generateStore } from './store/generateStore';
import { RANKED_SEASON_END_MINUTE, RANKED_SEASON_MONTHS, seasonScore } from './ranked';

const history = (...profits: number[]): Pick<EconomyState, 'history'> => ({
  history: profits.map((profit, i) => ({ label: `miesiąc ${i + 1}`, profit, revenue: 100_000 })),
});

describe('sezon rankingowy: wrzesień–listopad', () => {
  it('trzy raporty miesięczne', () => {
    expect(RANKED_SEASON_MONTHS).toBe(3);
  });

  it('kończy się minutę po zamknięciu 30 listopada (23:00 ostatniego dnia sezonu, raport listopada już jest)', () => {
    const lastStep = RANKED_SEASON_END_MINUTE - 1;
    const day = dayOf(lastStep);
    expect(dateOfDay(day)).toMatchObject({ year: 2026, month: 10, date: 30 });
    expect(isLastDayOfMonth(day)).toBe(true);
    expect(minuteOfDay(lastStep)).toBe(OPEN_TO);
    // dzień 90 to trzeci koniec miesiąca od 1 września (dzień 0)
    expect(Array.from({ length: day + 1 }, (_, d) => d).filter(isLastDayOfMonth)).toHaveLength(3);
    expect(RANKED_SEASON_END_MINUTE).toBe(90 * MINUTES_PER_DAY + OPEN_TO + 1);
  });

  it('prawdziwa symulacja: przed ostatnią minutą są dwa raporty, po niej trzy, a wynik to suma ich zysków', () => {
    const seed = 'kiełbasa-42';
    const info = computeStoreInfo(generateStore(seed));
    const s = createEconomy(seed, info);
    const events: EconEvent[] = [];
    while (s.minute < RANKED_SEASON_END_MINUTE - 1 && !s.gameOver) stepMinute(s, info, events);
    expect(s.history).toHaveLength(2);
    stepMinute(s, info, events);
    expect(s.minute).toBe(RANKED_SEASON_END_MINUTE);
    expect(s.history.map((h) => h.label)).toEqual(['wrzesień 2026', 'październik 2026', 'listopad 2026']);
    expect(seasonScore(s)).toBe(Math.round(s.history[0]!.profit + s.history[1]!.profit + s.history[2]!.profit));
  });
});

describe('wynik sezonu', () => {
  it('suma zysków trzech raportów, w pełnych złotych', () => {
    expect(seasonScore(history(10_000, -2_500, 40_000))).toBe(47_500);
    expect(seasonScore(history(1000.4, 1000.4, 1000.4))).toBe(3001);
    expect(seasonScore(history(-5000, -5000, -5000))).toBe(-15_000);
  });

  it('liczą się tylko raporty sezonu: grudzień (gdyby odtworzenie poszło dalej) nic nie zmienia', () => {
    expect(seasonScore(history(1, 2, 3, 1_000_000))).toBe(6);
  });

  it('wypowiedzenie umowy przed końcem sezonu: suma raportów, które powstały', () => {
    expect(seasonScore(history(1, 2))).toBe(3);
    expect(seasonScore(history(-40_000))).toBe(-40_000);
  });

  it('-0 i liczby ujemne zaokrąglone do zera dają zwykłe 0 (wynik idzie do JSON i do Redisa)', () => {
    expect(Object.is(seasonScore(history(-0.2, 0, 0)), 0)).toBe(true);
    expect(Object.is(seasonScore(history()), 0)).toBe(true);
  });
});

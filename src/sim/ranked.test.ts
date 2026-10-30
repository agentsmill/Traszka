import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, OPEN_TO } from './economy/catalog';
import { dateOfDay, dayOf, isLastDayOfMonth, minuteOfDay } from './economy/calendar';
import { createEconomy, stepMinute, type EconEvent, type EconomyState } from './economy/economy';
import { computeStoreInfo } from './economy/storeInfo';
import { GENERATOR_VERSION, generateStore } from './store/generateStore';
import { RANKED_SEASON_END_MINUTE, RANKED_SEASON_MONTHS, seasonBankrupt, seasonScore } from './ranked';
import { replayRun, type LogEntry, type RunRecord } from './run';
import { SIM_VERSION } from './simVersion';

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

/**
 * Bieg, który kończy grę dokładnie przy zamknięciu 30 listopada: od 25 października (dzień 55, 9:00) 30 palet dziennie, a od 26 października
 * (dzień 56, 9:00) sześć osób więcej. Strojone pod `kiełbasa-42` przy SIM_VERSION 5 po urealnieniu ekonomii (zapas ok. 500 zł: każda zmiana
 * ekonomii może to przesunąć, a test powie to wprost).
 */
const ORDER_FROM = 55 * MINUTES_PER_DAY + 9 * 60;
const HIRE_FROM = 56 * MINUTES_PER_DAY + 9 * 60;

describe('seasonBankrupt: koniec gry przed ostatnim raportem', () => {
  const state = (gameOver: boolean, reports: number): Pick<EconomyState, 'gameOver' | 'history'> => ({ gameOver, ...history(...Array<number>(reports).fill(1000)) });

  it('gra, która się nie skończyła, nie jest bankrutem, ile by raportów nie miała', () => {
    for (const n of [0, 1, 2, 3]) expect(seasonBankrupt(state(false, n)), `${n} raportów`).toBe(false);
  });

  it('koniec gry przy zero, jednym albo dwóch raportach to bankrut (wynik z wcześniejszych miesięcy nie może zostać zamrożony)', () => {
    for (const n of [0, 1, 2]) expect(seasonBankrupt(state(true, n)), `${n} raportów`).toBe(true);
  });

  it('koniec gry z trzema raportami nie jest bankrutem: bieg dotrwał do końca, a ostatnia strata jest już w wyniku', () => {
    expect(seasonBankrupt(state(true, RANKED_SEASON_MONTHS))).toBe(false);
  });

  it('prawdziwa symulacja: sklep kiełbasa-42 z ośmioma osobami i 30 paletami dziennie od końca października kończy grę dopiero przy zamknięciu 30 listopada, z trzema raportami, a strata listopada jest w wyniku', () => {
    // od SIM_VERSION 5 (granica debetu −100 000 zł) bierny sezon nie kończy się debetem: dopiero 30 palet dziennie i sześć etatów więcej
    // (pensje, opłata logistyczna, przejścia zasypane paletami) dają dołek, który przekracza granicę przy zamknięciu 30 listopada
    const log: LogEntry[] = [
      { minute: ORDER_FROM, seq: 0, cmd: { type: 'setOrder', auto: false, manual: 30 } },
      ...Array.from({ length: 6 }, (_, i): LogEntry => ({ minute: HIRE_FROM + i, seq: 1 + i, cmd: { type: 'hire' } })),
    ];
    const run: RunRecord = { seed: 'kiełbasa-42', gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log };
    const s = replayRun(run, RANKED_SEASON_END_MINUTE);
    // gdyby przestrojenie ekonomii zmieniło ten sklep, test musi to powiedzieć wprost, a nie przejść po cichu
    expect(s.gameOver, 'ostatnie zamknięcie spycha ten sklep poniżej granicy debetu').toBe(true);
    expect(s.minute, 'koniec gry przy samym zamknięciu sezonu').toBe(RANKED_SEASON_END_MINUTE);
    expect(s.history, 'raport listopada powstał razem z końcem gry').toHaveLength(RANKED_SEASON_MONTHS);
    expect(s.history[2]!.profit, 'listopad kończy się stratą').toBeLessThan(0);
    expect(seasonBankrupt(s)).toBe(false);
    expect(seasonScore(s)).toBe(Math.round(s.history[0]!.profit + s.history[1]!.profit + s.history[2]!.profit));
    expect(seasonScore(s)).toBeLessThan(Math.round(s.history[0]!.profit + s.history[1]!.profit));
  });
});

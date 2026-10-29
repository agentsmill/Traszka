import { describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES, COMMANDS, LOG_ENTRIES, SEED, worstCaseRuns, type WorstCaseRun } from '../scripts/judge-worst-case.mjs';
import { COMMAND_TYPES, isCommand } from '@/sim/economy/commands';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { replayRun, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { RUN_MAX_BODY_BYTES, RUN_MAX_LOG_ENTRIES } from '../src/server/config';
import { parseSubmission } from '../src/server/runs';

/**
 * Scenariusze pomiaru najgorszego przypadku (scripts/judge-worst-case.mjs, uruchamianego ręcznie na zbudowanym bundlu) mają być
 * naprawdę najgorsze, a nie odrzucone przez parser: pełny dziennik, zgodny z regułami zgłoszenia, z poleceniami, które dochodzą do
 * logiki ekonomii. Samego pomiaru czasu tu nie ma (trwa dłużej niż test powinien); liczby z niego idą do raportu zadania.
 */
const KEY = 'K7QX-9MBD-2HFA-P3WN-8RTE';
const opts = { generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, endMinute: RANKED_SEASON_END_MINUTE };

/**
 * Pierwsze `count` scenariuszy, bez rozwijania reszty: `worstCaseRuns` to generator, bo każdy dziennik to 100 000 obiektów, a całych
 * dziewiętnaście naraz to ok. 160 MB. `break` zamyka generator, więc kolejne scenariusze w ogóle nie powstają.
 */
function firstScenarios(count: number): { name: string; run: WorstCaseRun }[] {
  const taken: { name: string; run: WorstCaseRun }[] = [];
  for (const scenario of worstCaseRuns(opts)) {
    taken.push(scenario);
    if (taken.length === count) break;
  }
  return taken;
}

describe('pomiar najgorszego przypadku (scripts/judge-worst-case.mjs): scenariusze zgodne z parserem', () => {
  it('limity w skrypcie to limity serwera (liczba wpisów dziennika i rozmiar ciała żądania)', () => {
    expect(LOG_ENTRIES).toBe(RUN_MAX_LOG_ENTRIES);
    expect(BODY_LIMIT_BYTES).toBe(RUN_MAX_BODY_BYTES);
  });

  it('każdy typ polecenia z symulacji ma w skrypcie polecenie do obciążenia (nowy typ w Command wymaga dopisania go tam)', () => {
    const types = new Set(Object.values(COMMANDS).flatMap((make) => [make(0).type, make(1).type]));
    expect([...types].sort()).toEqual([...COMMAND_TYPES].sort());
    for (const make of Object.values(COMMANDS)) {
      for (let i = 0; i < 50; i++) expect(isCommand(make(i)), JSON.stringify(make(i))).toBe(true);
    }
  });

  it('każdy scenariusz: pełny dziennik (100 000 wpisów), który parser przyjmuje bez zmian; bieg bierny ma pusty', () => {
    const names: string[] = [];
    for (const { name, run } of worstCaseRuns(opts)) {
      names.push(name);
      const res = parseSubmission({ key: KEY, nick: 'Mateusz', run });
      expect(res.ok, `${name}: ${JSON.stringify(res.ok ? '' : res)}`).toBe(true);
      expect(run.log.length, name).toBe(name === 'bieg bierny' ? 0 : RUN_MAX_LOG_ENTRIES);
      if (res.ok) expect(res.value.run.log.length, name).toBe(run.log.length);
    }
    expect(names).toEqual(['bieg bierny', 'mieszanka z planem', 'jedna minuta', ...Object.keys(COMMANDS).map((n) => `tylko ${n}`)]);
  }, 30_000);

  it('mieszanka z planem zawiera ruchy palet, zakupy (odrzucane przez ekonomię) i decyzje, rozłożone na cały sezon; „jedna minuta” trzyma wszystko w jednej', () => {
    const [, mix, burst] = firstScenarios(3);
    const count = (type: string): number => mix!.run.log.filter((e) => e.cmd.type === type).length;
    for (const type of ['rushRemont', 'movePallet', 'buyUpgrade', 'buyEquipment', 'answerCard', 'pinStaff', 'setStaffProfile', 'setOrder', 'campaign', 'tapTill']) {
      expect(count(type), type).toBeGreaterThan(0);
    }
    // polecenia, które w tym sklepie kończą grę przy tysiącach powtórzeń, są poza wypełniaczem (zostają w scenariuszach „tylko …”)
    for (const type of ['hire', 'startRemont', 'returnPallet']) expect(count(type), type).toBe(0);
    expect(mix!.run.log.at(-1)!.minute).toBeGreaterThan(RANKED_SEASON_END_MINUTE - 1_000);
    expect(new Set(burst!.run.log.map((e) => e.minute)).size).toBe(1);
  }, 30_000);
});

describe('pomiar najgorszego przypadku: scenariusze przeżywają sezon (bankrut sędzia odrzuca, a jego odtwarzanie staje przed końcem)', () => {
  it('w każdym scenariuszu gra trwa do końca sezonu (gameOver false w ostatniej minucie), więc odtwarzanie jest pełne', () => {
    for (const { name, run } of worstCaseRuns(opts)) {
      const state = replayRun(run as RunRecord, RANKED_SEASON_END_MINUTE);
      expect(state.gameOver, `${name}: bankructwo w minucie ${state.minute}`).toBe(false);
      expect(state.minute, name).toBe(RANKED_SEASON_END_MINUTE);
      expect(state.history, name).toHaveLength(3);
    }
  }, 120_000);

  it('kontrola: zatrudnianie od początku sezonu kończy grę przed jego końcem, dlatego scenariusz „tylko hire” idzie w ostatnich dniach', () => {
    const log = Array.from({ length: 200 }, (_, i) => ({ minute: i, seq: i, cmd: COMMANDS.hire!(i) }));
    const state = replayRun({ seed: SEED, gameVersion: 'x', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log } as RunRecord, RANKED_SEASON_END_MINUTE);
    expect(state.gameOver).toBe(true);
    expect(state.minute).toBeLessThan(RANKED_SEASON_END_MINUTE);
  }, 60_000);
});

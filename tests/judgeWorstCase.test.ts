import { describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES, BUDGET_MS, COMMANDS, LOG_ENTRIES, worstCaseRuns } from '../scripts/judge-worst-case.mjs';
import { COMMAND_TYPES, isCommand } from '@/sim/economy/commands';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
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

describe('pomiar najgorszego przypadku (scripts/judge-worst-case.mjs): scenariusze zgodne z parserem', () => {
  it('limity w skrypcie to limity serwera (liczba wpisów dziennika i rozmiar ciała żądania)', () => {
    expect(LOG_ENTRIES).toBe(RUN_MAX_LOG_ENTRIES);
    expect(BODY_LIMIT_BYTES).toBe(RUN_MAX_BODY_BYTES);
    expect(BUDGET_MS).toBe(8_000);
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

  it('mieszanka z planem zawiera remonty, ruchy palet i zakupy, rozłożone na cały sezon; „jedna minuta” trzyma wszystko w jednej', () => {
    const [, mix, burst] = [...worstCaseRuns(opts)].slice(0, 3);
    const count = (type: string): number => mix!.run.log.filter((e) => e.cmd.type === type).length;
    for (const type of ['startRemont', 'rushRemont', 'movePallet', 'returnPallet', 'buyUpgrade', 'buyEquipment', 'claimQuest', 'tapTill']) {
      expect(count(type), type).toBeGreaterThan(0);
    }
    expect(mix!.run.log.at(-1)!.minute).toBeGreaterThan(RANKED_SEASON_END_MINUTE - 1_000);
    expect(new Set(burst!.run.log.map((e) => e.minute)).size).toBe(1);
  }, 30_000);
});

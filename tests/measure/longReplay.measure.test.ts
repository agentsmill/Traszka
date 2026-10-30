import { it } from 'vitest';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';

/** Dwa lata gry z zakupami na raty co miesiąc: czas odtworzenia i determinizm (dwa odtworzenia, ten sam JSON). */
it.skipIf(!process.env.MEASURE)('długie odtworzenie (24 miesiące)', () => {
  const ids = ['ulotki', 'szkolenie', 'wozek', 'regaly', 'kawa', 'asystent', 'klima', 'kamery', 'scoSoft', 'drugaKasa', 'nocne', 'rampa'];
  const log: LogEntry[] = [];
  for (let m = 0; m < 24; m++) {
    const cmd = { type: 'buyUpgrade', id: ids[m % ids.length], raty: true } as Command;
    log.push({ minute: (m * 30 + 2) * MINUTES_PER_DAY + 9 * 60, seq: log.length, cmd });
    if (m % 3 === 1) log.push({ minute: (m * 30 + 3) * MINUTES_PER_DAY + 9 * 60, seq: log.length, cmd: { type: 'startRemont', raty: true } });
  }
  const run: RunRecord = { seed: 'szarlotka-380', gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'casual', log };
  const until = 731 * MINUTES_PER_DAY;
  const t0 = performance.now();
  const a = replayRun(run, until);
  const t1 = performance.now();
  const b = replayRun(run, until);
  const t2 = performance.now();
  console.log('24 mies.:', Math.round(t1 - t0), 'ms i', Math.round(t2 - t1), 'ms; ten sam stan:', JSON.stringify(a) === JSON.stringify(b),
    'raporty', a.history.length, 'remanenty', a.franchisee.remanent.last?.day, 'remont', a.remontLevel, 'gotówka', Math.round(a.cash), 'koniec gry', a.gameOver);
}, 600_000);

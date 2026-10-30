import { it } from 'vitest';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';

it.skipIf(!process.env.MEASURE)('szukanie scenariusza bankructwa przy ostatnim zamknięciu', () => {
  const seed = process.env.SEED ?? 'kiełbasa-42';
  for (const orderDay of [40, 45, 50, 55, 60, 65]) for (const manual of [12, 20, 30]) for (const hires of [0, 3, 6]) {
    const log: LogEntry[] = [
      { minute: orderDay * MINUTES_PER_DAY + 9 * 60, seq: 0, cmd: { type: 'setOrder', auto: false, manual } },
      ...Array.from({ length: hires }, (_, i): LogEntry => ({ minute: (orderDay + 1) * MINUTES_PER_DAY + 9 * 60 + i, seq: 1 + i, cmd: { type: 'hire' } })),
    ];
    const run: RunRecord = { seed, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log };
    const s = replayRun(run, RANKED_SEASON_END_MINUTE);
    const ok = s.gameOver && s.history.length === 3 && s.minute === RANKED_SEASON_END_MINUTE;
    console.log(orderDay, manual, hires, ok ? 'TRAF' : '', 'gameOver', s.gameOver, 'hist', s.history.length, 'cash', Math.round(s.cash), 'profits', s.history.map((h) => Math.round(h.profit)).join(' '));
  }
}, 900_000);

import { it } from 'vitest';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { applyCommand, type Command } from '@/sim/economy/commands';
import { installmentRoom, stepMinute, awaitingDecision, type EconEvent } from '@/sim/economy/economy';
import { planFor } from '@/sim/economy/franchisee';
import { UPGRADE_BY_ID, upgradeCost, type UpgradeId } from '@/sim/economy/upgrades';
import { upgradeBlocker } from '@/sim/economy/economy';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { freshRun, replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';

const at = (day: number, hour: number, minute = 0): number => day * MINUTES_PER_DAY + hour * 60 + minute;
it.skipIf(!process.env.MEASURE)('bankructwo przy zamknięciu października', () => {
  for (const seed of ['szarlotka-380', 'kopytka-541', 'traszka-1', 'lublin-9', 'makieta', 'seed-3', 'kiełbasa-42']) {
    const r = freshRun(seed);
    const log: LogEntry[] = [];
    const issue = (cmd: Command): boolean => { log.push({ minute: r.state.minute, seq: log.length, cmd }); return applyCommand(r.state, r.info, cmd).result.ok; };
    const out: EconEvent[] = [];
    while (r.state.minute < RANKED_SEASON_END_MINUTE && !r.state.gameOver) {
      const m = r.state.minute;
      if (m >= at(29, 18) && m < at(29, 18) + 6) issue({ type: 'hire' });
      if (m === at(29, 18, 10)) issue({ type: 'setOrder', auto: false, manual: 30 });
      if (m === at(30, 10)) {
        for (let k = 0; k < 40; k++) {
          const ids = (Object.keys(UPGRADE_BY_ID) as UpgradeId[]).filter((id) => !upgradeBlocker(r.state, UPGRADE_BY_ID[id]))
            .sort((a, b) => upgradeCost(UPGRADE_BY_ID[b], r.state.upgrades[b] ?? 0) - upgradeCost(UPGRADE_BY_ID[a], r.state.upgrades[a] ?? 0));
          const id = ids.find((x) => planFor(upgradeCost(UPGRADE_BY_ID[x], r.state.upgrades[x] ?? 0)).monthly <= installmentRoom(r.state).free);
          if (!id) break;
          issue({ type: 'buyUpgrade', id, raty: true });
        }
      }
      if (awaitingDecision(r.state)) { const c = visibleCards(r.state.tycoon.cards, m)[0]!; issue({ type: 'answerCard', seq: c.seq, answer: c.defaultAnswer }); continue; }
      stepMinute(r.state, r.info, out);
    }
    const run: RunRecord = { seed, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log };
    const s = replayRun(run, RANKED_SEASON_END_MINUTE);
    const hit = s.gameOver && s.history.length < 3 && s.history.length > 0 && s.history[0]!.profit > 0;
    console.log(seed, hit ? 'TRAF' : '', 'over', s.gameOver, 'dzień', Math.floor(s.minute / 1440), 'hist', s.history.length, 'cash', Math.round(s.cash), 'raty', s.total.installments, s.history.map((h) => Math.round(h.profit)).join(' '), 'wpisy', log.length);
  }
}, 900_000);

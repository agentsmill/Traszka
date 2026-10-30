import { it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { MINUTES_PER_DAY, OPEN_TO } from '@/sim/economy/catalog';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, createEconomy, stepMinute, type EconEvent } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';

/** Trafność prognozy paska: „Zostanie” w kolejnych dniach września i października wobec prawdziwego zamknięcia, na kilku sklepach. */
it.skipIf(!process.env.MEASURE)('trafność prognozy paska', () => {
  for (const seed of ['kiełbasa-42', 'kopytka-541', 'traszka-1', 'seed-3']) {
    const info = computeStoreInfo(generateStore(seed));
    const s = createEconomy(seed, info);
    const out: EconEvent[] = [];
    const rows: string[] = [];
    let forecasts: number[] = [];
    while (s.history.length < 2) {
      if (awaitingDecision(s)) { const c = visibleCards(s.tycoon.cards, s.minute)[0]!; applyCommand(s, info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer }); continue; }
      if (s.minute % MINUTES_PER_DAY === 12 * 60 && Math.floor(s.minute / MINUTES_PER_DAY) % 5 === 0) forecasts.push(forecastMonth(s, info).net);
      const before = s.history.length;
      stepMinute(s, info, out);
      if (s.history.length > before) {
        const net = s.lastReport!.statement!.net;
        rows.push(`${s.lastReport!.label}: zamknięcie ${Math.round(net)}, prognozy ${forecasts.map((x) => Math.round(x - net)).join(' ')}`);
        forecasts = [];
      }
    }
    console.log(seed, '|', rows.join(' | '));
  }
}, 600_000);

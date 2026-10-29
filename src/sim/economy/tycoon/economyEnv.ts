import { freshRun } from '@/sim/run';
import { MINUTES_PER_DAY } from '../catalog';
import { applyCommand, type Command } from '../commands';
import {
  awaitingDecision, effects, estimatedDailyRevenue, isOpenForCustomers, patienceOf, stepMinute, type EconEvent, type EconomyState,
  type MonthReport,
} from '../economy';
import type { StoreInfo } from '../storeInfo';
import { BOTS, BOT_NAMES, runBot, type BotCommand, type BotEnv, type BotName, type BotView } from './bots';
import { visibleCards } from './cards';
import { tapCost } from './fatigue';
import { dayOfMinute, daysLeftInMonth, minuteInDay } from './time';
import { wutSlack } from './wut';

/**
 * Boty (`bots.ts`) na prawdziwej ekonomii: to samo, co robi `sandboxEnv` dla makiety, ale widok liczy się z `EconomyState`,
 * polecenia idą przez `applyCommand` (jak z interfejsu), a minutę robi `stepMinute`. Plik stoi nad `economy.ts` (nikt z ekonomii
 * go nie importuje), więc wolno mu brać jej wartości, w przeciwieństwie do reszty modułów tycoona.
 */

/** Bieg w toku: stan i `StoreInfo` (zmienia się po remoncie; boty remontu nie zlecają, ale `applyCommand` mógłby go zwrócić). */
export interface EconomyRun {
  state: EconomyState;
  info: StoreInfo;
}

/**
 * Widok bota: to, co widzi gracz. Pola jak w `sandboxView`; cierpliwość, otwarcie sklepu i obrót typowego dnia pochodzą z tych
 * samych funkcji, których używa symulacja (`patienceOf`, `isOpenForCustomers`, `estimatedDailyRevenue`).
 */
export function economyView(s: EconomyState, info: StoreInfo): BotView {
  const t = s.tycoon;
  const mod = minuteInDay(s.minute);
  // obrót miesiąca do końca: dotychczasowy plus typowy dzień razy dni, które zostały
  const daysLeft = daysLeftInMonth(dayOfMinute(s.minute)) - mod / MINUTES_PER_DAY;
  const projected = s.month.revenue + estimatedDailyRevenue(s, info) * daysLeft;
  return {
    minute: s.minute,
    mod,
    open: isOpenForCustomers(s),
    queue: s.queue,
    patience: patienceOf(s, effects(s, info)),
    sidewalkPallets: s.pallets.filter((p) => p.loc === 'sidewalk').length,
    pallets: s.pallets.length,
    cleanliness: t.hall.cleanliness,
    hallBags: t.waste.hall,
    backroomBags: t.waste.backroom,
    energy: t.fatigue.energy,
    spentToday: t.fatigue.spentToday,
    tapCost: { kasa: tapCost('kasa'), paleta: tapCost('paleta') },
    profile: t.staff.profile,
    cards: visibleCards(t.cards, s.minute),
    wutSlack: wutSlack(t.wut, s.month.revenue, projected),
    trust: t.trust.value,
  };
}

/** Polecenie bota jako polecenie gry. Combo z `BotCommand` pomijamy: ekonomia liczy je sama z serii stuknięć (`comboMult`). */
function toCommand(cmd: BotCommand): Command {
  switch (cmd.type) {
    case 'card.answer': return { type: 'answerCard', seq: cmd.seq, answer: cmd.answer };
    case 'staff.profile': return { type: 'setStaffProfile', profile: cmd.profile };
    case 'tap.till': return { type: 'tapTill' };
    case 'tap.pallet': return { type: 'tapPallet' };
  }
}

/**
 * Środowisko botów na prawdziwej ekonomii. `step()` stoi (false), dopóki gra czeka na odpowiedź na kartę (`awaitingDecision`),
 * a poza tym robi jedną minutę (`stepMinute`). Zdarzenia z poleceń i z minuty trafiają do `onEvent` (np. raporty miesięczne).
 */
export function economyEnv(run: EconomyRun, onEvent?: (e: EconEvent) => void): BotEnv {
  const events: EconEvent[] = [];
  const flush = (): void => {
    if (onEvent) for (const e of events) onEvent(e);
    events.length = 0;
  };
  return {
    view: () => economyView(run.state, run.info),
    apply: (cmd) => {
      const outcome = applyCommand(run.state, run.info, toCommand(cmd));
      if (outcome.layoutChanged && outcome.info) run.info = outcome.info;
      events.push(...outcome.events);
      flush();
      return outcome.result.ok;
    },
    step: () => {
      if (awaitingDecision(run.state)) return false;
      stepMinute(run.state, run.info, events);
      flush();
      return true;
    },
  };
}

/** Przebieg bota: stan końcowy i raporty miesięczne po kolei (z nich hint i pozycje). */
export interface BotPlay {
  state: EconomyState;
  reports: MonthReport[];
}

/** Puszcza bota na `minutes` minut prawdziwej gry od `freshRun(seed)`. */
export function playBot(name: BotName, seed: string, minutes: number): BotPlay {
  const run = freshRun(seed);
  const reports: MonthReport[] = [];
  runBot(BOTS[name], economyEnv(run, (e) => { if (e.kind === 'month' && e.report) reports.push(e.report); }), minutes);
  return { state: run.state, reports };
}

/** Suma wyników miesięcy (`history[].profit`) każdego bota na każdym seedzie, w kolejności `seeds`. */
export function measureBots(seeds: readonly string[], minutes: number): Record<BotName, number[]> {
  const out = {} as Record<BotName, number[]>;
  for (const name of BOT_NAMES) {
    out[name] = seeds.map((seed) => playBot(name, seed, minutes).state.history.reduce((n, h) => n + h.profit, 0));
  }
  return out;
}

import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { ITEMS_PER_CUSTOMER, MINUTES_PER_DAY, PALLET_ITEMS } from '@/sim/economy/catalog';
import { applyCommand, type Command } from '@/sim/economy/commands';
import {
  expectedDailyCustomers, findSlot, installmentRoom, nextRemont, upgradeBlocker, type EconEvent, type EconomyState, type MonthReport,
} from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { planFor } from '@/sim/economy/franchisee';
import { minuteOfDay } from '@/sim/economy/calendar';
import { BOTS, runBot, type BotName } from '@/sim/economy/tycoon/bots';
import { economyEnv, type EconomyRun } from '@/sim/economy/tycoon/economyEnv';
import { freshRun } from '@/sim/run';
import { EQUIPMENT_BY_ID, UPGRADE_BY_ID, equipmentCost, upgradeCost, type EquipmentId, type UpgradeId } from '@/sim/economy/upgrades';

/*
 * Analiza SIM 6 (trzy kieszenie) przed wypchnięciem: strategie graczy przez 12–24 miesiące na kilku sklepach, tabela miesięczna
 * z wyciągów od Centrali. Nie jest testem bramkowym: biegnie tylko z `MEASURE=1`, a wynik zapisuje do `OUT` (JSON).
 *   MEASURE=1 OUT=/tmp/analiza.json MONTHS=24 npx vitest run tests/measure/trzyKieszenie.measure.test.ts
 */

const SEEDS = (process.env.SEEDS ?? 'traszka-1,kopytka-541,makieta,lublin-9,seed-3').split(',');
const MONTHS = Number(process.env.MONTHS ?? 24);

type Strategy = 'bierny' | 'normalny' | 'mistrz' | 'mistrzZakupy' | 'raty' | 'nadmiar' | 'nadmiarLekki' | 'nadmiarMiesiac'
  | 'ratyDzien1' | 'ratyDzien1Tanie' | 'mistrzRatyDzien1';
const STRATEGIES = (process.env.STRATEGIES ?? 'bierny,normalny,mistrz,mistrzZakupy,raty,nadmiar,nadmiarLekki,nadmiarMiesiac').split(',') as Strategy[];

/** Rzecz do kupienia teraz: polecenie (bez `raty`) i cena za gotówkę. */
interface Offer { cmd: Command; price: number; label: string }

/** Wszystko, co da się teraz kupić (ulepszenia bez blokady, sprzęt z wolnym slotem, następny remont), od najtańszego. */
function offers(r: EconomyRun): Offer[] {
  const s = r.state;
  const out: Offer[] = [];
  for (const id of Object.keys(UPGRADE_BY_ID) as UpgradeId[]) {
    const def = UPGRADE_BY_ID[id];
    if (upgradeBlocker(s, def)) continue;
    out.push({ cmd: { type: 'buyUpgrade', id }, price: upgradeCost(def, s.upgrades[id] ?? 0), label: id });
  }
  for (const id of Object.keys(EQUIPMENT_BY_ID) as EquipmentId[]) {
    const def = EQUIPMENT_BY_ID[id];
    if (s.level < def.minLevel || !findSlot(s, r.info, def.size)) continue;
    if (s.equipment.filter((e) => e.id === id).length >= 3) continue;   // trzy sztuki jednego sprzętu wystarczą
    out.push({ cmd: { type: 'buyEquipment', id }, price: equipmentCost(def, s.equipment.filter((e) => e.id === id).length), label: id });
  }
  const rem = nextRemont(s);
  if (rem && s.level >= rem.minLevel && s.remontUntil === null) out.push({ cmd: { type: 'startRemont' }, price: rem.cost, label: `remont${rem.level}` });
  return out.sort((a, b) => a.price - b.price);
}

const withCredit = (c: Command): Command => ({ ...c, raty: true } as Command);

/**
 * Zakupy raz dziennie o 9:00: `cash` za gotówkę z zapasem, `mixed` gotówka albo raty, gdy prognoza to zniesie (od najtańszego),
 * `credit` agresywnie: zawsze na raty, do limitu, od najdroższej rzeczy, która się zmieści.
 */
function buyer(mode: 'cash' | 'credit' | 'mixed', log: string[]) {
  return (r: EconomyRun): void => {
    const s = r.state;
    if (minuteOfDay(s.minute) !== 9 * 60 || s.gameOver) return;
    for (let guard = 0; guard < 6; guard++) {
      const list = mode === 'credit' ? offers(r).reverse() : offers(r);
      const f = forecastMonth(s, r.info);
      let bought = false;
      for (const o of list) {
        let cmd: Command | null = null;
        if (mode !== 'credit' && s.cash - o.price >= 3000 && f.cashAfter - o.price >= 5000) cmd = o.cmd;
        else if (mode !== 'cash') {
          const plan = planFor(o.price);
          const room = installmentRoom(s);
          const safe = mode === 'credit' || f.cashAfter - plan.monthly >= 0;
          if (plan.monthly <= room.free && safe) cmd = withCredit(o.cmd);
        }
        if (!cmd) continue;
        const res = applyCommand(s, r.info, cmd);
        if (res.layoutChanged && res.info) r.info = res.info;
        if (res.result.ok) { log.push(`d${Math.floor(s.minute / MINUTES_PER_DAY)} ${o.label}${'raty' in cmd && cmd.raty ? ' (raty)' : ''}`); bought = true; break; }
      }
      if (!bought) return;
    }
  };
}

/**
 * Nadmierne zamawianie: o 10:00 ręcznie dwa razy tyle palet, ile sklep sprzedaje dziennie (z przewidywanych klientów), bez względu na
 * zapas. Nie „dwa razy asystent”: asystent przy pełnym sklepie proponuje zero, więc taka strategia sama by się wyrównywała.
 */
const overOrder = (factor: number, untilDay = Infinity) => (r: EconomyRun): void => {
  const s = r.state;
  if (minuteOfDay(s.minute) !== 10 * 60) return;
  if (s.minute >= untilDay * MINUTES_PER_DAY) {   // gracz zauważył zagracenie: wraca do asystenta
    if (!s.order.auto) applyCommand(s, r.info, { type: 'setOrder', auto: true });
    return;
  }
  const perDay = (expectedDailyCustomers(s, r.info) * ITEMS_PER_CUSTOMER) / PALLET_ITEMS;
  applyCommand(s, r.info, { type: 'setOrder', auto: false, manual: Math.ceil(factor * perDay) });
};

/**
 * Maksimum rat pierwszego dnia (pytanie koordynatora): 1 września o 6:00 gracz bierze na raty wszystko, na co pozwala limit przed pierwszym
 * przelewem (35% gwarancji, 8750 zł miesięcznie) i progi poziomów (poziom 1). `desc`: od najdroższej rzeczy, która się zmieści, `asc`: od najtańszej.
 * Potem już nic nie kupuje.
 */
const dayOneCredit = (order: 'asc' | 'desc', log: string[]) => (r: EconomyRun): void => {
  const s = r.state;
  if (s.minute !== 6 * 60 + 1) return;
  for (let guard = 0; guard < 60; guard++) {
    const list = order === 'desc' ? offers(r).reverse() : offers(r);
    const room = installmentRoom(s).free;
    const o = list.find((x) => planFor(x.price).monthly <= room);
    if (!o) return;
    const res = applyCommand(s, r.info, withCredit(o.cmd));
    if (res.layoutChanged && res.info) r.info = res.info;
    if (!res.result.ok) return;
    log.push(`d0 ${o.label} ${o.price} zł (raty ${planFor(o.price).months} × ${planFor(o.price).monthly})`);
  }
};

const BASE: Record<Strategy, BotName> = {
  bierny: 'bierny', normalny: 'bierny', mistrz: 'mistrz', mistrzZakupy: 'mistrz', raty: 'bierny', nadmiar: 'bierny', nadmiarLekki: 'bierny',
  nadmiarMiesiac: 'bierny', ratyDzien1: 'bierny', ratyDzien1Tanie: 'bierny', mistrzRatyDzien1: 'mistrz',
};

export interface MonthRow {
  month: number; label: string; revenue: number; transfer: number; deductions: number; installments: number; remanent: number; guarantee: number;
  costs: number; net: number; result: number; cash: number; share: number; level: number; remont: number;
}
export interface RunResult { strategy: Strategy; seed: string; months: MonthRow[]; bankruptMonth: number | null; purchases: string[]; finalCash: number }

function play(strategy: Strategy, seed: string): RunResult {
  const run = freshRun(seed);
  const reports: MonthReport[] = [];
  let bankruptMonth: number | null = null;
  const env = economyEnv(run, (e: EconEvent) => { if (e.kind === 'month' && e.report) reports.push(e.report); });
  const log: string[] = [];
  const extra = strategy === 'normalny' ? buyer('cash', log) : strategy === 'mistrzZakupy' ? buyer('mixed', log)
    : strategy === 'raty' ? buyer('credit', log) : strategy === 'nadmiar' ? overOrder(2) : strategy === 'nadmiarLekki' ? overOrder(1.4)
    : strategy === 'nadmiarMiesiac' ? overOrder(1.5, 30)
    : strategy === 'ratyDzien1' || strategy === 'mistrzRatyDzien1' ? dayOneCredit('desc', log)
    : strategy === 'ratyDzien1Tanie' ? dayOneCredit('asc', log) : null;
  const bot = BOTS[BASE[strategy]];
  const end = MONTHS * 30.44 * MINUTES_PER_DAY;
  while (run.state.minute < end && reports.length < MONTHS) {
    if (run.state.gameOver) { bankruptMonth = reports.length + 1; break; }
    extra?.(run);
    runBot(bot, env, 1);
  }
  const months = reports.map((r, i): MonthRow => {
    const st = r.statement!;
    return {
      month: i + 1, label: r.label, revenue: Math.round(r.counters.revenue), transfer: Math.round(st.transfer), deductions: Math.round(st.deductions),
      installments: Math.round(st.installments), remanent: Math.round(st.remanent), guarantee: Math.round(st.guarantee), costs: Math.round(st.costs), net: Math.round(st.net),
      result: Math.round(st.result), cash: Math.round(r.cash), share: r.counters.revenue > 0 ? st.transfer / r.counters.revenue : 0,
      level: 0, remont: 0,
    };
  });
  if (run.state.gameOver && bankruptMonth === null) bankruptMonth = reports.length + (reports.length < MONTHS ? 1 : 0);
  return { strategy, seed, months, bankruptMonth, purchases: log, finalCash: Math.round(run.state.cash) };
}

describe.skipIf(!process.env.MEASURE)('analiza trzech kieszeni', () => {
  it('strategie na seedach', () => {
    const out: RunResult[] = [];
    for (const strategy of STRATEGIES) for (const seed of SEEDS) out.push(play(strategy, seed));
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out));
    for (const strategy of STRATEGIES) {
      const runs = out.filter((r) => r.strategy === strategy);
      const avg = (f: (m: MonthRow) => number, months = 2): number => {
        const xs = runs.flatMap((r) => r.months.slice(0, months).map(f));
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
      };
      console.log(strategy.padEnd(13), 'udział', (avg((m) => m.share, 12) * 100).toFixed(2) + '%', 'wynik/mies (2 mies.)', Math.round(avg((m) => m.result)),
        'zostaje/mies (12)', Math.round(avg((m) => m.net, 12)), 'gotówka koniec', runs.map((r) => r.finalCash).join(' '),
        'bankructwa', runs.map((r) => r.bankruptMonth ?? '-').join(' '));
    }
  }, 1_800_000);
});

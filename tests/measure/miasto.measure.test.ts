import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { DISTRICTS } from '@/sim/city/districts';
import { lotById } from '@/sim/city/generateCity';
import { RIVAL_RADIUS_M, lotEstimate } from '@/sim/city/traffic';
import type { StoreDistrict } from '@/sim/city/types';
import { minuteOfDay } from '@/sim/economy/calendar';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { type Command } from '@/sim/economy/commands';
import { awaitingDecision, findSlot, installmentRoom, nextRemont, upgradeBlocker, type EconEvent, type MonthReport } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { planFor } from '@/sim/economy/franchisee';
import { BOTS, runBot, type BotEnv, type BotName } from '@/sim/economy/tycoon/bots';
import { economyView, toCommand } from '@/sim/economy/tycoon/economyEnv';
import { EQUIPMENT_BY_ID, UPGRADE_BY_ID, equipmentCost, upgradeCost, type EquipmentId, type UpgradeId } from '@/sim/economy/upgrades';
import { applyFirmCommand, lotState, rentRefusal } from '@/sim/firm/commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, openStores, stepFirmMinute } from '@/sim/firm/firm';
import type { FirmState, FirmStepOut } from '@/sim/firm/types';
import { freshRun } from '@/sim/run';

/*
 * Pomiar ekspansji (spec §8.4, §14.3, plan 4a.1 Zadanie 15): strategia „mistrz z ekspansją” przez prawdziwą firmę. Bot „mistrz” gra aktywny
 * sklep, a gdy Centrala nada status Partnera Strategicznego, gracz wynajmuje najlepiej wyglądający wolny lokal (na raty). Sklep w tle prowadzi
 * zastępca (odpowiedzi zaznaczone z góry). Nie jest testem bramkowym: biegnie tylko z `MEASURE=1`, a wynik zapisuje do `OUT` (JSON).
 *   MEASURE=1 OUT=/tmp/miasto.json npx vitest run tests/measure/miasto.measure.test.ts
 * Zmienne: SEEDS (lista po przecinku), MONTHS (domyślnie 24), STRATEGIES.
 */

const SEEDS = (process.env.SEEDS ?? 'traszka-1,kopytka-541,makieta,lublin-9,seed-3').split(',');
const MONTHS = Number(process.env.MONTHS ?? 24);

type Strategy =
  | 'bierny' | 'decydent' | 'mistrz' | 'mistrzZakupy'
  | 'mistrzEkspansja' | 'mistrzEkspansjaRotacja' | 'mistrzZakupyEkspansja' | 'mistrzZakupyEkspansjaRotacja'
  | 'ekspansja:srodmiescie' | 'ekspansja:dworzec' | 'ekspansja:biurowce';
const ALL: Strategy[] = [
  'bierny', 'decydent', 'mistrz', 'mistrzZakupy', 'mistrzEkspansja', 'mistrzEkspansjaRotacja', 'mistrzZakupyEkspansja', 'mistrzZakupyEkspansjaRotacja',
  'ekspansja:srodmiescie', 'ekspansja:dworzec', 'ekspansja:biurowce',
];
const STRATEGIES = (process.env.STRATEGIES ? process.env.STRATEGIES.split(',') : ALL) as Strategy[];

interface Setup { bot: BotName; buy: boolean; expand: boolean; rotate: boolean; only: StoreDistrict | null }
function setupOf(s: Strategy): Setup {
  const base = { bot: 'mistrz' as BotName, buy: false, expand: false, rotate: false, only: null as StoreDistrict | null };
  switch (s) {
    case 'bierny': return { ...base, bot: 'bierny' };
    case 'decydent': return { ...base, bot: 'decydent' };
    case 'mistrz': return base;
    case 'mistrzZakupy': return { ...base, buy: true };
    case 'mistrzEkspansja': return { ...base, expand: true };
    case 'mistrzEkspansjaRotacja': return { ...base, expand: true, rotate: true };
    case 'mistrzZakupyEkspansja': return { ...base, buy: true, expand: true };
    case 'mistrzZakupyEkspansjaRotacja': return { ...base, buy: true, expand: true, rotate: true };
    default: return { ...base, expand: true, only: s.split(':')[1] as StoreDistrict };
  }
}

// --- Zakupy (jak `buyer('mixed')` z analizy SIM 6, ale przez polecenia firmy na aktywnym sklepie) ----------------------------

interface Offer { cmd: Command; price: number }

function offers(f: FirmState): Offer[] {
  const { econ: s, info } = activeStore(f);
  const out: Offer[] = [];
  for (const id of Object.keys(UPGRADE_BY_ID) as UpgradeId[]) {
    const def = UPGRADE_BY_ID[id];
    if (upgradeBlocker(s, def)) continue;
    out.push({ cmd: { type: 'buyUpgrade', id }, price: upgradeCost(def, s.upgrades[id] ?? 0) });
  }
  for (const id of Object.keys(EQUIPMENT_BY_ID) as EquipmentId[]) {
    const def = EQUIPMENT_BY_ID[id];
    if (s.level < def.minLevel || !findSlot(s, info, def.size)) continue;
    if (s.equipment.filter((e) => e.id === id).length >= 3) continue;
    out.push({ cmd: { type: 'buyEquipment', id }, price: equipmentCost(def, s.equipment.filter((e) => e.id === id).length) });
  }
  const rem = nextRemont(s);
  if (rem && s.level >= rem.minLevel && s.remontUntil === null) out.push({ cmd: { type: 'startRemont' }, price: rem.cost });
  return out.sort((a, b) => a.price - b.price);
}

/** Raz dziennie o 9:00: gotówka albo raty, gdy prognoza to zniesie (od najtańszej rzeczy), do sześciu zakupów. */
function buyMixed(f: FirmState): void {
  const st = activeStore(f);
  if (minuteOfDay(st.econ.minute) !== 9 * 60 || st.econ.gameOver || st.notice !== null) return;
  for (let guard = 0; guard < 6; guard++) {
    const { econ: s, info } = activeStore(f);
    const fc = forecastMonth(s, info);
    let bought = false;
    for (const o of offers(f)) {
      let cmd: Command | null = null;
      if (s.cash - o.price >= 3000 && fc.cashAfter - o.price >= 5000) cmd = o.cmd;
      else {
        const plan = planFor(o.price);
        if (plan.monthly <= installmentRoom(s).free && fc.cashAfter - plan.monthly >= 0) cmd = { ...o.cmd, raty: true } as Command;
      }
      if (cmd && applyStoreCommand(f, cmd).result.ok) { bought = true; break; }
    }
    if (!bought) return;
  }
}

// --- Ekspansja ---------------------------------------------------------------------------------------------------------------

export interface Chosen {
  lotId: number; district: StoreDistrict; street: string; number: number; kind: string; corner: boolean; area: number;
  package: number; monthly: number; buildDays: number; lo: number; hi: number; trueDaily: number; traffic: number; rivals: number;
}

/** Najlepszy wolny lokal po tym, co widać na karcie: środek widełek klientów razy koszyk dzielnicy; remis rozstrzyga niższa cena. */
function pickLot(f: FirmState, only: StoreDistrict | null): Chosen | null {
  let best: { score: number; chosen: Chosen } | null = null;
  for (const lot of f.city.lots) {
    if (lotState(f, lot.id) !== 'wolny' || rentRefusal(f, lot.id, 'raty') !== null) continue;
    if (only && lot.district !== only) continue;
    const est = lotEstimate(f.seed, f.city, lot.id);
    const score = ((est.lo + est.hi) / 2) * DISTRICTS[lot.district].basket - lot.package / 1e6;
    if (best && score <= best.score) continue;
    best = {
      score,
      chosen: {
        lotId: lot.id, district: lot.district, street: lot.street, number: lot.number, kind: lot.spec.kind, corner: lot.spec.corner,
        area: lot.spec.interiorWidth * lot.spec.salesDepth, package: lot.package, monthly: planFor(lot.package).monthly, buildDays: lot.buildDays,
        lo: est.lo, hi: est.hi, trueDaily: Math.round(est.trueDaily), traffic: 0, rivals: 0,
      },
    };
  }
  return best?.chosen ?? null;
}

// --- Bieg firmy ---------------------------------------------------------------------------------------------------------------

export interface StoreRow {
  id: number; revenue: number; transfer: number; deductions: number; installments: number; remanent: number; guarantee: number;
  costs: number; net: number; profit: number; customers: number; trust: number;
}
export interface MonthRow { month: number; label: string; wallet: number; stores: StoreRow[]; invest: number }
export interface FirmResult {
  strategy: Strategy; seed: string; months: MonthRow[];
  /** Miesiąc (1 = wrzesień), przy którego zamknięciu przyszedł status Partnera. */
  partnerMonth: number | null;
  rentDay: number | null; openDay: number | null; chosen: Chosen | null;
  /** Pierwszy miesiąc z gotówką ≥ 1 mln zł (wprost z biegu) albo ekstrapolacja z tempa ostatnich 6 miesięcy. */
  millionMonth: number | null; millionProjected: number | null;
  over: null | 'debt' | 'closed' | 'trust'; overMonth: number | null; finalWallet: number;
}

const rowOf = (id: number, r: MonthReport, trust: number): StoreRow => {
  const st = r.statement!;
  return {
    id, revenue: Math.round(r.counters.revenue), transfer: Math.round(st.transfer), deductions: Math.round(st.deductions), installments: Math.round(st.installments),
    remanent: Math.round(st.remanent), guarantee: Math.round(st.guarantee), costs: Math.round(st.costs), net: Math.round(st.net), profit: Math.round(r.profit),
    customers: Math.round(r.counters.customers), trust,
  };
};

function play(strategy: Strategy, seed: string): FirmResult {
  const setup = setupOf(strategy);
  const run = freshRun(seed);
  const f = createFirm(seed, { econ: run.state, layout: run.layout, info: run.info }, { ranked: false });
  const result: FirmResult = {
    strategy, seed, months: [], partnerMonth: null, rentDay: null, openDay: null, chosen: null, millionMonth: null, millionProjected: null,
    over: null, overMonth: null, finalWallet: 0,
  };
  const closing = new Map<number, StoreRow>();
  const onStep = (out: FirmStepOut): void => {
    const seen: { id: number; event: EconEvent }[] = [...out.active.map((event) => ({ id: f.activeId, event })), ...out.background.map((b) => ({ id: b.storeId, event: b.event }))];
    for (const { id, event } of seen) {
      if (event.kind === 'month' && event.report?.statement) {
        const st = f.stores.find((x) => x.id === id)!;
        closing.set(id, rowOf(id, event.report, st.econ.tycoon.trust.value));
      }
    }
    if (closing.size > 0) {
      const label = (seen.find((x) => x.event.kind === 'month')!.event.report!).label;
      result.months.push({
        month: result.months.length + 1, label, wallet: Math.round(f.person.wallet), stores: [...closing.values()].sort((a, b) => a.id - b.id),
        invest: out.firm.find((e) => e.kind === 'network-report')?.summary?.invest ?? 0,
      });
      closing.clear();
    }
    for (const e of out.firm) {
      if (e.kind === 'partner') result.partnerMonth = result.months.length;
      if (e.kind === 'opened') result.openDay = Math.floor(activeStore(f).econ.minute / MINUTES_PER_DAY);
    }
  };
  const env: BotEnv = {
    view: () => { const st = activeStore(f); return economyView(st.econ, st.info); },
    apply: (cmd) => applyStoreCommand(f, toCommand(cmd)).result.ok,
    step: () => {
      if (awaitingDecision(activeStore(f).econ)) return false;
      const out = emptyStepOut();
      stepFirmMinute(f, out);
      onStep(out);
      return true;
    },
  };
  const bot = BOTS[setup.bot];
  const end = (MONTHS + 1) * 31 * MINUTES_PER_DAY;   // zapas na zamknięcie ostatniego miesiąca; kończy ją licznik zamknięć
  let rented = false;
  while (activeStore(f).econ.minute < end && result.months.length < MONTHS) {
    if (f.over !== null || activeStore(f).econ.gameOver) break;
    const st = activeStore(f);
    if (setup.buy) buyMixed(f);
    if (setup.expand && !rented && f.person.partner) {
      const chosen = pickLot(f, setup.only);
      if (chosen) {
        const out = emptyStepOut();
        if (applyFirmCommand(f, { type: 'rentLot', lotId: chosen.lotId, pay: 'raty' }, out).ok) {
          rented = true;
          result.chosen = chosen;
          result.rentDay = Math.floor(st.econ.minute / MINUTES_PER_DAY);
        }
      }
    }
    // rotacja: o 6:00 każdego dnia gracz przechodzi do drugiego sklepu (jeśli działa)
    if (setup.rotate && minuteOfDay(st.econ.minute) === 6 * 60 && openStores(f).length === 2) {
      const other = openStores(f).find((x) => x.id !== f.activeId)!;
      applyFirmCommand(f, { type: 'switchStore', storeId: other.id }, emptyStepOut());
    }
    runBot(bot, env, 1);
  }
  if (f.over !== null) { result.over = f.over; result.overMonth = result.months.length + 1; }
  else if (activeStore(f).econ.gameOver) { result.over = 'trust'; result.overMonth = result.months.length + 1; }
  result.finalWallet = Math.round(f.person.wallet);

  const hit = result.months.find((m) => m.wallet >= 1_000_000);
  result.millionMonth = hit ? hit.month : null;
  if (!hit && result.months.length >= 12) {
    const last = result.months.slice(-6);
    const rate = (last[last.length - 1]!.wallet - last[0]!.wallet) / (last.length - 1);
    if (rate > 0) result.millionProjected = Math.round((result.months.length + (1_000_000 - result.finalWallet) / rate) * 10) / 10;
  }
  // ruch lokalu i rywale wybranego lokalu (do raportu)
  if (result.chosen) {
    const lot = lotById(f.city, result.chosen.lotId);
    const st = f.stores.find((x) => x.lotId === lot.id);
    if (st?.info.site) result.chosen.traffic = Math.round(st.info.site.traffic * 100) / 100;
    result.chosen.rivals = f.city.lots.filter((l) => l.state === 'konkurencja' && Math.hypot(l.x - lot.x, l.y - lot.y) < RIVAL_RADIUS_M).length;
  }
  return result;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

describe.skipIf(!process.env.MEASURE)('pomiar ekspansji (miasto 4a.1)', () => {
  it('strategie na seedach', () => {
    const out: FirmResult[] = [];
    for (const strategy of STRATEGIES) for (const seed of SEEDS) out.push(play(strategy, seed));
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out));
    for (const strategy of STRATEGIES) {
      const runs = out.filter((r) => r.strategy === strategy);
      const wallet = (m: number): string => runs.map((r) => (r.months[m - 1] ? Math.round(r.months[m - 1]!.wallet / 1000) : '-')).join(' ');
      console.log(
        strategy.padEnd(30), 'status m.', runs.map((r) => r.partnerMonth ?? '-').join(' '), '| wybrane', runs.map((r) => (r.chosen ? `${r.chosen.district}#${r.chosen.lotId}` : '-')).join(' '),
        '| gotówka tys. m.12:', wallet(12), 'm.24:', wallet(24), '| milion', runs.map((r) => r.millionMonth ?? (r.millionProjected !== null ? `~${r.millionProjected}` : '-')).join(' '),
        '| koniec', runs.map((r) => r.over ?? '-').join(' '), '| śr. wynik m.13-24 (zostaje Ci, razem)',
        Math.round(avg(runs.map((r) => avg(r.months.slice(12).map((m) => m.stores.reduce((n, s) => n + s.net, 0)))))),
      );
    }
  }, 3_600_000);
});

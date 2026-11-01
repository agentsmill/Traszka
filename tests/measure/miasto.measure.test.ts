import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { DISTRICTS, districtSite } from '@/sim/city/districts';
import { lotById } from '@/sim/city/generateCity';
import { RIVAL_RADIUS_M, lotEstimate } from '@/sim/city/traffic';
import type { StoreDistrict } from '@/sim/city/types';
import { minuteOfDay } from '@/sim/economy/calendar';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand, type Command } from '@/sim/economy/commands';
import {
  awaitingDecision, createEconomy, findSlot, installmentRoom, nextRemont, upgradeBlocker, type EconEvent, type EconomyState, type MonthReport,
} from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { planFor } from '@/sim/economy/franchisee';
import type { SiteMods } from '@/sim/economy/site';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { BOTS, runBot, type BotEnv, type BotName } from '@/sim/economy/tycoon/bots';
import { DECK, DWORZEC_CARD_IDS } from '@/sim/economy/tycoon/deck';
import { economyEnv, economyView, toCommand, type EconomyRun } from '@/sim/economy/tycoon/economyEnv';
import { EQUIPMENT_BY_ID, UPGRADE_BY_ID, equipmentCost, upgradeCost, type EquipmentId, type UpgradeId } from '@/sim/economy/upgrades';
import { RELET_SHARE, applyFirmCommand, lotState, rentPrice, rentRefusal } from '@/sim/firm/commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, openStores, stepFirmMinute } from '@/sim/firm/firm';
import type { FirmState, FirmStepOut } from '@/sim/firm/types';
import { freshRun } from '@/sim/run';
import { layoutFor } from '@/sim/store/layoutFor';

/*
 * Pomiar ekspansji (spec §8.4, §14.3, plan 4a.1 Zadanie 15 i 4a.2 Zadanie 8): strategia „mistrz z ekspansją” przez prawdziwą firmę. Bot „mistrz”
 * gra aktywny sklep, a gdy Centrala nada status Partnera Strategicznego, gracz wynajmuje najlepiej wyglądający wolny lokal (na raty, a gdy rata
 * nie mieści się w limicie, za gotówkę). Sklepy w tle prowadzi zastępca (odpowiedzi zaznaczone z góry). Nie jest testem bramkowym: biegnie tylko
 * z `MEASURE=1`, a wynik zapisuje do `OUT` (JSON).
 *   MEASURE=1 OUT=/tmp/miasto.json npx vitest run tests/measure/miasto.measure.test.ts
 * Zmienne: SEEDS (lista po przecinku), MONTHS (domyślnie 24), STRATEGIES.
 * 4a.2: strategia `trzy` (ekspansja do trzech sklepów) i `relet` (wypowiedzenie sklepu w tle z zaufaniem poniżej 40 i ponowny wynajem jego
 * lokalu „po Traszce”); osobne pomiary `pomiar dzielnic` (cele §8.4 z profilem i kartami, straty po godzinach, karty Dworca) oraz `lokal po
 * Traszce wobec świeżego lokalu` (te same przebiegi co w `tests/districtBalance.test.ts`, ale z liczbami do raportu). Konsolę przechodzących
 * testów drukuje dopiero `--reporter=verbose`; JSON zapisuje się zawsze (`OUT`, `OUT.relet.json`, `OUT.districts.json`, `OUT.relet-lokal.json`).
 */

const SEEDS = (process.env.SEEDS ?? 'traszka-1,kopytka-541,makieta,lublin-9,seed-3').split(',');
const MONTHS = Number(process.env.MONTHS ?? 24);

type Strategy =
  | 'bierny' | 'decydent' | 'mistrz' | 'mistrzZakupy'
  | 'mistrzEkspansja' | 'mistrzEkspansjaRotacja' | 'mistrzZakupyEkspansja' | 'mistrzZakupyEkspansjaRotacja'
  | 'ekspansja:srodmiescie' | 'ekspansja:dworzec' | 'ekspansja:biurowce'
  /** 4a.2: mistrz z trzema sklepami (drugi i trzeci wynajmuje, gdy tylko rata mieści się w limicie albo gotówka wystarcza). */
  | 'trzy'
  /** 4a.2: mistrz z dwoma sklepami, który wypowiada sklep w tle z zaufaniem poniżej `RELET_BELOW` i po rozliczeniu bierze jego lokal znów. */
  | 'relet';
const ALL: Strategy[] = [
  'bierny', 'decydent', 'mistrz', 'mistrzZakupy', 'mistrzEkspansja', 'mistrzEkspansjaRotacja', 'mistrzZakupyEkspansja', 'mistrzZakupyEkspansjaRotacja',
  'ekspansja:srodmiescie', 'ekspansja:dworzec', 'ekspansja:biurowce', 'trzy', 'relet',
];
const STRATEGIES = (process.env.STRATEGIES ? process.env.STRATEGIES.split(',') : ALL) as Strategy[];

/** Zaufanie sklepu w tle, poniżej którego strategia `relet` wypowiada mu umowę (próg „Pod obserwacją”, ten sam co ostrzeżenie na chipie). */
const RELET_BELOW = 40;

/** `extras`: ile sklepów ponad startowy wynajmuje gracz (0 = nie rozbudowuje się, 1 = drugi, 2 = drugi i trzeci). */
interface Setup { bot: BotName; buy: boolean; extras: 0 | 1 | 2; rotate: boolean; only: StoreDistrict | null; relet: boolean }
function setupOf(s: Strategy): Setup {
  const base = { bot: 'mistrz' as BotName, buy: false, extras: 0 as 0 | 1 | 2, rotate: false, only: null as StoreDistrict | null, relet: false };
  switch (s) {
    case 'bierny': return { ...base, bot: 'bierny' };
    case 'decydent': return { ...base, bot: 'decydent' };
    case 'mistrz': return base;
    case 'mistrzZakupy': return { ...base, buy: true };
    case 'mistrzEkspansja': return { ...base, extras: 1 };
    case 'mistrzEkspansjaRotacja': return { ...base, extras: 1, rotate: true };
    case 'mistrzZakupyEkspansja': return { ...base, buy: true, extras: 1 };
    case 'mistrzZakupyEkspansjaRotacja': return { ...base, buy: true, extras: 1, rotate: true };
    case 'trzy': return { ...base, extras: 2 };
    case 'relet': return { ...base, extras: 1, relet: true };
    default: return { ...base, extras: 1, only: s.split(':')[1] as StoreDistrict };
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
  /** Jak gracz płaci pakiet: na raty, a gdy rata nie mieści się w limicie nowego sklepu, gotówką (jeśli ją ma). */
  pay: 'raty' | 'gotowka';
}

/** Sposób zapłaty pakietu lokalu: raty, gdy mieszczą się w limicie, inaczej gotówka, gdy wystarcza; null, gdy wynajem jest odmówiony. */
function payFor(f: FirmState, lotId: number): 'raty' | 'gotowka' | null {
  if (rentRefusal(f, lotId, 'raty') === null) return 'raty';
  return rentRefusal(f, lotId, 'gotowka') === null ? 'gotowka' : null;
}

/** Najlepszy wolny lokal po tym, co widać na karcie: środek widełek klientów razy koszyk dzielnicy; remis rozstrzyga niższa cena. */
function pickLot(f: FirmState, only: StoreDistrict | null): Chosen | null {
  let best: { score: number; chosen: Chosen } | null = null;
  for (const lot of f.city.lots) {
    if (lotState(f, lot.id) !== 'wolny') continue;
    const pay = payFor(f, lot.id);
    if (pay === null) continue;
    if (only && lot.district !== only) continue;
    const est = lotEstimate(f.seed, f.city, lot.id);
    const score = ((est.lo + est.hi) / 2) * DISTRICTS[lot.district].basket - lot.package / 1e6;
    if (best && score <= best.score) continue;
    best = {
      score,
      chosen: {
        lotId: lot.id, district: lot.district, street: lot.street, number: lot.number, kind: lot.spec.kind, corner: lot.spec.corner,
        area: lot.spec.interiorWidth * lot.spec.salesDepth, package: lot.package, monthly: planFor(lot.package).monthly, buildDays: lot.buildDays,
        lo: est.lo, hi: est.hi, trueDaily: Math.round(est.trueDaily), traffic: 0, rivals: 0, pay,
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
/** Sklep otwarty w biegu (poza startowym): dzień gry, miesiąc (1 = wrzesień, liczony jako zamknięte miesiące + 1) i czy to ponowny wynajem. */
export interface OpenRow { storeId: number; lotId: number; day: number; month: number; reopened: boolean }
/** Cykl „wypowiedz i weź znów” jednego sklepu: wypowiedzenie, rozliczenie końcowe i ponowny wynajem lokalu (pola puste, dopóki etap się nie zdarzył). */
export interface Cycle {
  storeId: number; lotId: number;
  /** Dzień wypowiedzenia przez gracza (null: zamknęła go Centrala), zaufanie i poziom sklepu w tej chwili. */
  noticeDay: number | null; trust: number; level: number;
  closeDay: number | null; closeReason: string | null;
  /** Rozliczenie końcowe zeszło z portfela (razem) i jego części: niespłacone raty, nadwyżka czekająca na przelew i remanent ponad limit. */
  settlement: number | null; settlementParts: { installments: number; pending: number; remanent: number } | null;
  reletDay: number | null; reletPrice: number | null; reletPay: 'raty' | 'gotowka' | null; reopenDay: number | null;
}
export interface FirmResult {
  strategy: Strategy; seed: string; months: MonthRow[];
  /** Miesiąc (1 = wrzesień), przy którego zamknięciu przyszedł status Partnera. */
  partnerMonth: number | null;
  /** Pierwszy wynajęty lokal (drugi sklep): dzień wynajmu, otwarcia i wybór; `chosenAll` to wszystkie wybrane lokale po kolei (trzeci sklep: drugi element). */
  rentDay: number | null; openDay: number | null; chosen: Chosen | null; chosenAll: Chosen[];
  opens: OpenRow[]; cycles: Cycle[];
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
    strategy, seed, months: [], partnerMonth: null, rentDay: null, openDay: null, chosen: null, chosenAll: [], opens: [], cycles: [],
    millionMonth: null, millionProjected: null, over: null, overMonth: null, finalWallet: 0,
  };
  const dayNow = (): number => Math.floor(activeStore(f).econ.minute / MINUTES_PER_DAY);
  /** Ostatni cykl sklepu `id`, który jeszcze nie doszedł do ponownego otwarcia (wypowiedzenie, zamknięcie przez Centralę albo oczekiwanie na wynajem). */
  const openCycle = (id: number): Cycle | undefined => [...result.cycles].reverse().find((c) => c.storeId === id && c.reopenDay === null);
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
      if (e.kind === 'opened') {
        const reopened = e.params?.reopened === 1;
        result.opens.push({ storeId: e.storeId!, lotId: Number(e.params?.lotId), day: dayNow(), month: result.months.length + 1, reopened });
        if (reopened) {
          const c = openCycle(e.storeId!);
          if (c) c.reopenDay = dayNow();
        } else if (result.openDay === null) result.openDay = dayNow();
      }
      if (e.kind === 'settlement') {
        const c = openCycle(e.storeId!);
        if (c) {
          c.settlement = Number(e.params?.total);
          c.settlementParts = { installments: Number(e.params?.installments), pending: Number(e.params?.pending), remanent: Number(e.params?.remanent) };
        }
      }
      if (e.kind === 'closed') {
        let c = openCycle(e.storeId!);
        if (!c) {   // zamknęła go Centrala (zaufanie 0), bez wypowiedzenia gracza
          const st = f.stores.find((x) => x.id === e.storeId)!;
          c = { storeId: st.id, lotId: st.lotId, noticeDay: null, trust: 0, level: st.econ.level, closeDay: null, closeReason: null, settlement: null, settlementParts: null, reletDay: null, reletPrice: null, reletPay: null, reopenDay: null };
          result.cycles.push(c);
        }
        c.closeDay = dayNow();
        c.closeReason = String(e.params?.reason);
      }
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
  let rented = 0;
  while (activeStore(f).econ.minute < end && result.months.length < MONTHS) {
    if (f.over !== null || activeStore(f).econ.gameOver) break;
    const st = activeStore(f);
    if (setup.buy) buyMixed(f);
    if (rented < setup.extras && f.person.partner) {
      const chosen = pickLot(f, setup.only);
      if (chosen) {
        const out = emptyStepOut();
        if (applyFirmCommand(f, { type: 'rentLot', lotId: chosen.lotId, pay: chosen.pay }, out).ok) {
          rented++;
          result.chosenAll.push(chosen);
          if (result.chosen === null) {
            result.chosen = chosen;
            result.rentDay = Math.floor(st.econ.minute / MINUTES_PER_DAY);
          }
        }
      }
    }
    // relet: o 6:00 sklep w tle z zaufaniem poniżej progu dostaje wypowiedzenie, a lokal każdego zamkniętego sklepu (po rozliczeniu) bot bierze znów
    if (setup.relet && minuteOfDay(st.econ.minute) === 6 * 60) {
      for (const s of openStores(f)) {
        if (s.id === f.activeId || s.notice !== null || s.econ.tycoon.trust.value >= RELET_BELOW) continue;
        if (applyFirmCommand(f, { type: 'terminateStore', storeId: s.id }, emptyStepOut()).ok) {
          result.cycles.push({
            storeId: s.id, lotId: s.lotId, noticeDay: dayNow(), trust: Math.round(s.econ.tycoon.trust.value), level: s.econ.level,
            closeDay: null, closeReason: null, settlement: null, settlementParts: null, reletDay: null, reletPrice: null, reletPay: null, reopenDay: null,
          });
        }
      }
      for (const s of f.stores.filter((x) => x.closed)) {
        const cycle = openCycle(s.id);
        if (!cycle || cycle.reletDay !== null) continue;   // brak cyklu to sklep zamknięty przed biegiem; budowa w toku to cykl z `reletDay`
        const pay = payFor(f, s.lotId);
        if (pay === null) continue;
        const price = rentPrice(f, s.lotId);
        if (applyFirmCommand(f, { type: 'rentLot', lotId: s.lotId, pay }, emptyStepOut()).ok) {
          cycle.reletDay = dayNow();
          cycle.reletPrice = price;
          cycle.reletPay = pay;
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
  // ruch lokalu i rywale wybranych lokali (do raportu)
  for (const chosen of result.chosenAll) {
    const lot = lotById(f.city, chosen.lotId);
    const st = f.stores.find((x) => x.lotId === lot.id);
    if (st?.info.site) chosen.traffic = Math.round(st.info.site.traffic * 100) / 100;
    chosen.rivals = f.city.lots.filter((l) => l.state === 'konkurencja' && Math.hypot(l.x - lot.x, l.y - lot.y) < RIVAL_RADIUS_M).length;
  }
  return result;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const fix = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : '-');

/** Szereg `key` sklepu `id` w miesiącach `from`..`from + n − 1` (1 = wrzesień); brakujące miesiące dają null (sklep zamknięty albo bieg krótszy). */
function series(r: FirmResult, id: number, from: number, n: number, key: 'trust' | 'net'): (number | null)[] {
  return Array.from({ length: n }, (_, k) => r.months[from - 1 + k]?.stores.find((s) => s.id === id)?.[key] ?? null);
}

/** Podsumowanie cykli „wypowiedz i weź znów” wobec tych samych seedów bez cyklu (`mistrzEkspansja`): koszt, odbudowane zaufanie, różnica w gotówce. */
function reletReport(out: FirmResult[]): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  for (const r of out.filter((x) => x.strategy === 'relet')) {
    const base = out.find((x) => x.strategy === 'mistrzEkspansja' && x.seed === r.seed);
    const wallet = (x: FirmResult | undefined, m: number): number | null => (x?.months[m - 1] ? Math.round(x.months[m - 1]!.wallet / 1000) : null);
    const rows = r.cycles.map((c) => {
      const reopen = r.opens.find((o) => o.reopened && o.storeId === c.storeId && o.day === c.reopenDay);
      const m = reopen?.month ?? null;
      return {
        ...c, reopenMonth: m,
        trustAfter: m ? series(r, c.storeId, m, 12, 'trust') : null,
        netAfter: m ? series(r, c.storeId, m, 12, 'net') : null,
        trustWithout: m && base ? series(base, c.storeId, m, 12, 'trust') : null,
        netWithout: m && base ? series(base, c.storeId, m, 12, 'net') : null,
        levelEnd: null as number | null,
      };
    });
    detail[r.seed] = { cycles: rows, walletRelet: [wallet(r, 12), wallet(r, 24)], walletWithout: [wallet(base, 12), wallet(base, 24)], over: r.over };
    console.log(
      `RELET ${r.seed}: cykli ${r.cycles.length}, gotówka tys. m.12/m.24: ${wallet(r, 12)}/${wallet(r, 24)} wobec ${wallet(base, 12)}/${wallet(base, 24)} bez cyklu, koniec ${r.over ?? '-'}`,
    );
    for (const c of rows) {
      const nets = (xs: (number | null)[] | null): string => (xs ? fix(avg(xs.filter((v): v is number => v !== null)) / 1000) : '-');
      console.log(
        `  #${c.storeId} lokal ${c.lotId}: wypowiedzenie dzień ${c.noticeDay ?? 'Centrala'} (zaufanie ${c.trust}, poziom ${c.level}), zamknięcie dzień ${c.closeDay} (${c.closeReason}), rozliczenie ${c.settlement} zł,`,
        `wynajem dzień ${c.reletDay} za ${c.reletPrice} zł (${c.reletPay}), otwarcie dzień ${c.reopenDay} (m. ${c.reopenMonth});`,
        `zaufanie po 12 mies.: ${c.trustAfter?.join(' ') ?? '-'} | bez cyklu: ${c.trustWithout?.join(' ') ?? '-'}; „Zostaje Ci” śr. tys./mies.: ${nets(c.netAfter)} | bez cyklu: ${nets(c.netWithout)}`,
      );
    }
  }
  return detail;
}

describe.skipIf(!process.env.MEASURE)('pomiar ekspansji (miasto 4a.1 i 4a.2)', () => {
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
      // 4a.2: miesiące otwarcia sklepów ponad startowy (pierwsze otwarcia po kolei; „+” rozdziela drugi i trzeci) i wybrane lokale trzeciego sklepu
      if (runs.some((r) => r.opens.length > 0)) {
        console.log(
          ' '.repeat(30), 'otwarcia (miesiąc, dzień)', runs.map((r) => r.opens.filter((o) => !o.reopened).map((o) => `${o.month}/${o.day}`).join('+') || '-').join(' '),
          '| wybrane lokale', runs.map((r) => r.chosenAll.map((c) => `${c.district}#${c.lotId}(${c.pay})`).join('+') || '-').join(' '),
        );
      }
    }
    if (STRATEGIES.includes('relet')) {
      const detail = reletReport(out);
      if (process.env.OUT) writeFileSync(`${process.env.OUT}.relet.json`, JSON.stringify(detail));
    }
  }, 3_600_000);
});

// --- Dzielnice: liczby do raportu 4a.2 (cele §8.4 z profilem i kartami, wpływ profilu dnia, karty Dworca, lokal po Traszce) ------------------

const D4: StoreDistrict[] = ['osiedle', 'srodmiescie', 'dworzec', 'biurowce'];
const DISTRICT_SEEDS = (process.env.DSEEDS ?? 'traszka-1,kopytka-541,makieta,lublin-9,seed-3,kiełbasa-42,warszawa-7,poznan-12').split(',');
const DAYS = 92;
const TITLE_TO_ID = new Map(DECK.map((c) => [c.title, c.id]));

/** To samo co `startRun` w `economyEnv`: sklep w dzielnicy od 1 września (układ z lokalu `site.lot`, `site` w `StoreInfo`). */
function startRun(seed: string, site: SiteMods): EconomyRun {
  const info: StoreInfo = { ...computeStoreInfo(layoutFor(seed, 0, site.lot ?? undefined)), site };
  return { state: createEconomy(seed, info), info };
}

interface DistrictPlay {
  state: EconomyState;
  reports: MonthReport[];
  /** Obsłużeni klienci i ci, którzy odeszli z kolejki, po godzinach doby 0–23. */
  customers: number[];
  lost: number[];
  /** Ile razy karta o danym `id` pokazała się graczowi (okólniki pod nazwą `circ:<tytuł>`). */
  cards: Record<string, number>;
}

/** Bot w sklepie w dzielnicy jak `playBot` (ten sam bieg), z podziałem klientów i strat na godziny i z liczeniem kart. */
function playDistrict(bot: BotName, seed: string, site: SiteMods, days: number, setup?: (run: EconomyRun) => void): DistrictPlay {
  const run = startRun(seed, site);
  setup?.(run);
  const reports: MonthReport[] = [];
  const cards: Record<string, number> = {};
  const customers = new Array<number>(24).fill(0);
  const lost = new Array<number>(24).fill(0);
  const env = economyEnv(run, (e) => {
    if (e.kind === 'month' && e.report) reports.push(e.report);
    if (e.kind === 'card') {
      const id = TITLE_TO_ID.get(e.text) ?? `circ:${e.text}`;
      cards[id] = (cards[id] ?? 0) + 1;
    }
  });
  const step = env.step;
  runBot(BOTS[bot], {
    ...env,
    step: () => {
      const s = run.state;
      const [c0, l0, hour] = [s.total.customers, s.total.lost, Math.floor(minuteOfDay(s.minute) / 60)];
      const ran = step();
      customers[hour]! += run.state.total.customers - c0;
      lost[hour]! += run.state.total.lost - l0;
      return ran;
    },
  }, days * MINUTES_PER_DAY);
  return { state: run.state, reports, customers, lost, cards };
}

const profitOf = (s: EconomyState): number => s.history.reduce((n, h) => n + h.profit, 0);

interface Agg {
  profit: number; customers: number; lost: number; revenue: number; remanent: number;
  hoursCustomers: number[]; hoursLost: number[]; cards: Record<string, number>;
  /** Karty Dworca na seedzie (suma wystąpień), po kolei. */
  dworzecPerSeed: number[];
}
const addTo = (xs: number[], ys: readonly number[]): void => ys.forEach((v, i) => { xs[i] = (xs[i] ?? 0) + v; });

/** Bot w dzielnicy na wszystkich seedach, zsumowany. `siteOf` przerabia `districtSite` (wyłączone oczekiwania, bez profilu…). */
function aggregate(bot: BotName, district: StoreDistrict, siteOf: (s: SiteMods) => SiteMods = (s) => s, setup?: (run: EconomyRun) => void, days = DAYS, seeds = DISTRICT_SEEDS): Agg {
  const a: Agg = { profit: 0, customers: 0, lost: 0, revenue: 0, remanent: 0, hoursCustomers: new Array<number>(24).fill(0), hoursLost: new Array<number>(24).fill(0), cards: {}, dworzecPerSeed: [] };
  for (const seed of seeds) {
    const p = playDistrict(bot, seed, siteOf(districtSite(district)), days, setup);
    a.profit += profitOf(p.state);
    a.customers += p.state.total.customers;
    a.lost += p.state.total.lost;
    a.revenue += p.state.total.revenue;
    a.remanent += p.reports.reduce((n, r) => n + (r.statement?.remanent ?? 0), 0);
    addTo(a.hoursCustomers, p.customers);
    addTo(a.hoursLost, p.lost);
    for (const [id, n] of Object.entries(p.cards)) a.cards[id] = (a.cards[id] ?? 0) + n;
    a.dworzecPerSeed.push(sumOf(DWORZEC_CARD_IDS.map((id) => p.cards[id] ?? 0)));
  }
  return a;
}

/** Wyłącza profil dnia i trudnych klientów (dzielnica bez 4a.2: ruch doby ten sam, rozkład z `HOUR_CURVE`, karta `wiek` z wagą 1). */
const without42 = (s: SiteMods): SiteMods => ({ ...s, hours: null, difficult: 1 });

describe.skipIf(!process.env.MEASURE)('pomiar dzielnic (miasto 4a.2)', () => {
  it('cele §8.4 z profilem i kartami, wpływ profilu dnia, karty Dworca', () => {
    const bots: BotName[] = ['bierny', 'decydent', 'mistrz'];
    const goals: Record<string, Agg> = {};
    const plain: Record<string, Agg> = {};
    for (const bot of bots) {
      for (const d of D4) {
        goals[`${bot}:${d}`] = aggregate(bot, d);
        plain[`${bot}:${d}`] = aggregate(bot, d, without42);
      }
    }
    // koszt oczekiwań w Śródmieściu i remanent Dworca z kasą samoobsługową (cele 2, 4 i 5 z §8.4)
    const calm = (s: SiteMods): SiteMods => ({ ...s, patience: 0, repPenalty: 1 });
    const buySco = (run: EconomyRun): void => { applyCommand(run.state, run.info, { type: 'buyEquipment', id: 'sco' }); };
    const extra: Record<string, Agg> = {
      'bierny:srodmiescie:calm': aggregate('bierny', 'srodmiescie', calm),
      'mistrz:srodmiescie:calm': aggregate('mistrz', 'srodmiescie', calm),
      'bierny:dworzec:sco': aggregate('bierny', 'dworzec', (s) => s, buySco),
      'bierny:osiedle:sco': aggregate('bierny', 'osiedle', (s) => s, buySco),
      // Dworzec bez własnych kart (dzielnica udaje Osiedle tylko przy losowaniu talii): ile kosztują i dają trzy karty Dworca
      'bierny:dworzec:bez-kart': aggregate('bierny', 'dworzec', (s) => ({ ...s, district: 'osiedle' })),
      'mistrz:dworzec:bez-kart': aggregate('mistrz', 'dworzec', (s) => ({ ...s, district: 'osiedle' })),
    };
    // częstość kart Dworca w długim biegu (24 miesiące, pięć seedów raportu 4a.1)
    const long = aggregate('mistrz', 'dworzec', (s) => s, undefined, 24 * 30, ['traszka-1', 'kopytka-541', 'makieta', 'lublin-9', 'seed-3']);
    const result = { goals, plain, extra, long };
    if (process.env.OUT) writeFileSync(`${process.env.OUT}.districts.json`, JSON.stringify(result));

    const k = (x: number): string => fix(x / 1000);
    for (const bot of bots) {
      const base = goals[`${bot}:osiedle`]!.profit;
      for (const d of D4) {
        const g = goals[`${bot}:${d}`]!;
        const p = plain[`${bot}:${d}`]!;
        const walked = (x: Agg): string => fix((100 * x.lost) / (x.customers + x.lost), 2);
        console.log(
          `CEL ${bot.padEnd(8)} ${d.padEnd(11)} wynik/seed ${k(g.profit / DISTRICT_SEEDS.length)} tys. (${fix((100 * g.profit) / base, 0)}% Osiedla), bez profilu ${k(p.profit / DISTRICT_SEEDS.length)} tys.`,
          `| odeszło z kolejki ${walked(g)}% (bez profilu ${walked(p)}%) | obsłużeni ${Math.round(g.customers)}, obrót/klient ${fix(g.revenue / g.customers, 2)} zł | remanent/seed ${k(g.remanent / DISTRICT_SEEDS.length)} tys.`,
        );
      }
    }
    for (const [key, a] of Object.entries(extra)) {
      console.log(`DODATEK ${key.padEnd(26)} wynik/seed ${k(a.profit / DISTRICT_SEEDS.length)} tys., remanent/seed ${k(a.remanent / DISTRICT_SEEDS.length)} tys., odeszło ${a.lost.toFixed(0)}, obsłużeni ${Math.round(a.customers)}`);
    }
    const hours = (x: Agg, key: 'hoursCustomers' | 'hoursLost'): string => Array.from({ length: 17 }, (_, i) => Math.round(x[key][6 + i]!)).join(' ');
    for (const [bot, d] of [['mistrz', 'biurowce'], ['mistrz', 'srodmiescie'], ['mistrz', 'dworzec'], ['bierny', 'biurowce']] as const) {
      console.log(`GODZINY ${bot} ${d} (6–22) z profilem  klienci: ${hours(goals[`${bot}:${d}`]!, 'hoursCustomers')}`);
      console.log(`GODZINY ${bot} ${d} (6–22) z profilem  straty: ${hours(goals[`${bot}:${d}`]!, 'hoursLost')}`);
      console.log(`GODZINY ${bot} ${d} (6–22) bez profilu klienci: ${hours(plain[`${bot}:${d}`]!, 'hoursCustomers')}`);
      console.log(`GODZINY ${bot} ${d} (6–22) bez profilu straty: ${hours(plain[`${bot}:${d}`]!, 'hoursLost')}`);
    }
    const cardsTotal = (a: Agg): number => sumOf(Object.values(a.cards));
    for (const d of D4) {
      const g = goals[`mistrz:${d}`]!;
      console.log(`KARTY mistrz ${d.padEnd(11)} pokazane ${cardsTotal(g)}, „wiek” ${g.cards['wiek'] ?? 0} (bez trudnych klientów ${plain[`mistrz:${d}`]!.cards['wiek'] ?? 0}), Dworca na seed ${g.dworzecPerSeed.join(' ')}`);
    }
    console.log(
      `KARTY Dworca, 24 mies. × ${long.dworzecPerSeed.length} seedów: na seed ${long.dworzecPerSeed.join(' ')}, wszystkich kart ${cardsTotal(long)};`,
      DWORZEC_CARD_IDS.map((id) => `${id} ${long.cards[id] ?? 0}`).join(', '),
    );
  }, 3_600_000);

  it('lokal po Traszce wobec świeżego lokalu (remont 1, pakiet RELET_SHARE)', () => {
    const mid = (d: StoreDistrict): number => Math.round((DISTRICTS[d].package[0] + DISTRICTS[d].package[1]) / 2);
    type Variant = 'swiezy' | 'relet' | 'relet-wyposazony';
    const result: Record<string, { net: number[]; profit: number; price: number }> = {};
    for (const bot of ['mistrz', 'bierny'] as const) {
      for (const d of D4) {
        for (const variant of ['swiezy', 'relet', 'relet-wyposazony'] as Variant[]) {
          const price = variant === 'swiezy' ? mid(d) : Math.round((mid(d) * RELET_SHARE) / 100) * 100;
          const net: number[] = [];
          let profit = 0;
          for (const seed of DISTRICT_SEEDS) {
            const setup = (run: EconomyRun): void => {
              if (variant !== 'swiezy') {
                const closed = createEconomy(seed, run.info);
                closed.level = 20;
                closed.cash = 600_000;
                const remont = applyCommand(closed, run.info, { type: 'startRemont' });
                run.info = remont.info!;
                if (variant === 'relet-wyposazony') {
                  // wyposażenie z `fitStore` (tests/firmKit.ts): ulotki na 3. poziom, szkolenie i dwie kasy samoobsługowe
                  const buy: Command[] = [
                    { type: 'buyUpgrade', id: 'ulotki' }, { type: 'buyUpgrade', id: 'ulotki' }, { type: 'buyUpgrade', id: 'ulotki' }, { type: 'buyUpgrade', id: 'szkolenie' },
                    { type: 'buyEquipment', id: 'sco' }, { type: 'buyEquipment', id: 'sco' },
                  ];
                  for (const cmd of buy) applyCommand(closed, run.info, cmd);
                }
                run.state = createEconomy(seed, run.info, undefined, OPEN_FROM, { upgrades: closed.upgrades, equipment: closed.equipment, remontLevel: closed.remontLevel });
              }
              const plan = planFor(price);
              const fr = run.state.franchisee;
              fr.installments.push({ id: fr.nextInstallmentId++, label: 'Adaptacja lokalu', price, fee: plan.fee, total: plan.total, monthly: plan.monthly, paid: 0, months: plan.months });
            };
            const p = playDistrict(bot, seed, districtSite(d), DAYS, setup);
            net.push(p.reports.reduce((n, r) => n + (r.statement?.net ?? 0), 0));
            profit += profitOf(p.state);
          }
          result[`${bot}:${d}:${variant}`] = { net, profit, price };
        }
        const [a, b, c] = (['swiezy', 'relet', 'relet-wyposazony'] as Variant[]).map((v) => result[`${bot}:${d}:${v}`]!);
        const per = (x: { net: number[] }): number => sumOf(x.net) / x.net.length;
        console.log(
          `RELET ${bot.padEnd(7)} ${d.padEnd(11)} „Zostaje Ci” w 3 mies./seed: świeży ${fix(per(a!) / 1000)} tys. (pakiet ${a!.price}), po Traszce ${fix(per(b!) / 1000)} tys. (pakiet ${b!.price}, ${fix(per(b!) / per(a!), 2)}×),`,
          `z wyposażeniem (remont, ulotki, szkolenie, 2 SCO) ${fix(per(c!) / 1000)} tys. (${fix(per(c!) / per(a!), 2)}×); wynik bez rat/seed: ${fix(a!.profit / DISTRICT_SEEDS.length / 1000)} / ${fix(b!.profit / DISTRICT_SEEDS.length / 1000)} / ${fix(c!.profit / DISTRICT_SEEDS.length / 1000)} tys.`,
        );
      }
    }
    if (process.env.OUT) writeFileSync(`${process.env.OUT}.relet-lokal.json`, JSON.stringify(result));
  }, 3_600_000);
});

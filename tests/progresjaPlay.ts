import { DISTRICTS } from '@/sim/city/districts';
import { lotEstimate } from '@/sim/city/traffic';
import { minuteOfDay } from '@/sim/economy/calendar';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { awaitingDecision, findSlot, installmentRoom, nextRemont, upgradeBlocker, type EconEvent } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { planFor } from '@/sim/economy/franchisee';
import { planTerminates } from '@/sim/economy/plan';
import { trustTerminates } from '@/sim/economy/tycoon/trust';
import { BOTS, runBot, type BotEnv, type BotName } from '@/sim/economy/tycoon/bots';
import { economyView, toCommand } from '@/sim/economy/tycoon/economyEnv';
import { EQUIPMENT_BY_ID, REMONTS, UPGRADES, UPGRADE_BY_ID, equipmentCost, upgradeCost, type EquipmentId, type UpgradeId } from '@/sim/economy/upgrades';
import { applyFirmCommand, lotState, rentRefusal } from '@/sim/firm/commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, openStores, ownLotsOf, stepFirmMinute } from '@/sim/firm/firm';
import { RESEARCH, RESEARCH_IDS, researchCost, researchRefusal } from '@/sim/firm/research';
import type { FirmState, FirmStepOut } from '@/sim/firm/types';
import { freshRun } from '@/sim/run';
import { keepPlansEasy } from './firmKit';

/*
 * Strategie botów etapu 4b (spec §5.10, plan Zadanie 10) przez prawdziwą firmę: wspólne dla pomiaru (`tests/measure/progresja.measure.test.ts`)
 * i szybkiej bramki w `npm test` (`tests/progresjaBalance.test.ts`). Zakupy i wybór lokalu jak w `tests/measure/miasto.measure.test.ts`
 * (te same reguły, żeby liczby dało się porównać z raportami 4a.1 i 4a.2), do tego strategia `siec`:
 *   - `bierny`, `mistrz`: jeden sklep, sam bot (bramka B4: gotówka m. 12 jak przed etapem);
 *   - `jeden`: mistrz z zakupami w jednym sklepie (= `mistrzZakupy` z pomiaru miasta; bramka B3);
 *   - `trzy`: mistrz z trzema sklepami jak w 4a.2 (drugi i trzeci wynajmuje, gdy rata albo gotówka pozwala), bez zakupów i rotacji;
 *   - `siec`: mistrz z zakupami i rotacją po wszystkich otwartych sklepach, który wynajmuje sklepy do limitu Centrali, gdy rata albo gotówka
 *     pozwala, i raz dziennie (8:00) kupuje najtańsze dostępne badanie Sieci, gdy po zakupie zostaje ≥ 50 000 zł (bramki B1 i B2);
 *   - `siec12` (do raportu, bez bramki): `siec` przez pierwsze 12 miesięcy, potem już nic nie kupuje (ani w sklepach, ani badań, ani lokali),
 *     tylko gra i krąży po sklepach: kiedy przychodzi milion graczowi, który rok rozbudowuje sieć, a potem zbiera;
 *   - `rozsadny` (etap 5a, bramka P6): `siec`, ale zakupy w sklepie i badania Sieci tylko wtedy, gdy prognoza planu Centrali któregoś otwartego
 *     sklepu (`forecastMonth(...).plan.forecastShare`) jest poniżej `PRUDENT_SHARE`; poza tym oszczędza (bez planu, czyli w m. 1–3, też).
 *     Sklepy wynajmuje jak `siec`. Przełącznika dobicia z kieszeni nie włącza.
 */

export type ProgStrategy = 'bierny' | 'mistrz' | 'jeden' | 'trzy' | 'siec' | 'siec12' | 'rozsadny';
export const PROG_STRATEGIES: readonly ProgStrategy[] = ['bierny', 'mistrz', 'jeden', 'trzy', 'siec', 'siec12', 'rozsadny'];

/** `rozsadny` kupuje, gdy prognoza planu któregoś sklepu spada poniżej tylu (spec 5a §6.7: 105%). */
export const PRUDENT_SHARE = 1.05;

/** Badanie Sieci kupuje `siec` tylko wtedy, gdy po zakupie w portfelu zostaje co najmniej tyle (spec §5.10). */
export const RESEARCH_RESERVE = 50_000;

/**
 * `stopAfter`: po tylu zamkniętych miesiącach gracz przestaje kupować (sklepy, badania, lokale); Infinity, gdy nie przestaje. `planGated`: zakupy
 * w sklepie i badania tylko przy prognozie planu któregoś sklepu poniżej `PRUDENT_SHARE` (`rozsadny`).
 */
interface Setup { bot: BotName; buy: boolean; extras: number; rotate: boolean; research: boolean; stopAfter: number; planGated: boolean }
function setupOf(s: ProgStrategy): Setup {
  const base: Setup = { bot: 'mistrz', buy: false, extras: 0, rotate: false, research: false, stopAfter: Infinity, planGated: false };
  switch (s) {
    case 'bierny': return { ...base, bot: 'bierny' };
    case 'mistrz': return base;
    case 'jeden': return { ...base, buy: true };
    case 'trzy': return { ...base, extras: 2 };
    case 'siec': return { ...base, buy: true, extras: Infinity, rotate: true, research: true };
    case 'siec12': return { ...base, buy: true, extras: Infinity, rotate: true, research: true, stopAfter: 12 };
    case 'rozsadny': return { ...base, buy: true, extras: Infinity, rotate: true, research: true, planGated: true };
  }
}

/** Czy któryś otwarty sklep ma plan Centrali z prognozą wykonania poniżej `PRUDENT_SHARE` (warunek zakupów `rozsadny`). */
function planNeedsHelp(f: FirmState): boolean {
  return openStores(f).some((st) => {
    const o = forecastMonth(st.econ, st.info).plan;
    return o !== null && o.forecastShare < PRUDENT_SHARE;
  });
}

// --- Zakupy w aktywnym sklepie (jak `buyMixed` z pomiaru miasta) ----------------------------------------------------------------

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

/** Raz dziennie o 9:00: gotówka albo raty, gdy prognoza to zniesie (od najtańszej rzeczy), do sześciu zakupów; `tally` liczy zakupy. */
function buyMixed(f: FirmState, tally: ProgResult['bought']): void {
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
      if (cmd && applyStoreCommand(f, cmd).result.ok) {
        const kind = o.cmd.type === 'startRemont' ? 'remont' : o.cmd.type === 'buyUpgrade' ? 'upgrade' : 'equipment';
        tally[kind] += o.price;
        if ((cmd as { raty?: boolean }).raty) tally.raty++;
        bought = true;
        break;
      }
    }
    if (!bought) return;
  }
}

/** Najtańsze badanie, które Centrala teraz sprzeda, jeśli po zapłacie zostaje `RESEARCH_RESERVE`; zwraca cenę albo null. */
function buyCheapestResearch(f: FirmState): number | null {
  let best: { id: (typeof RESEARCH_IDS)[number]; price: number } | null = null;
  for (const id of RESEARCH_IDS) {
    if (researchRefusal(f, id) !== null) continue;
    const def = RESEARCH.find((d) => d.id === id)!;
    const price = researchCost(def, f.research[id] ?? 0);
    if (best === null || price < best.price) best = { id, price };
  }
  if (best === null || f.person.wallet - best.price < RESEARCH_RESERVE) return null;
  return applyFirmCommand(f, { type: 'research', id: best.id }, emptyStepOut()).ok ? best.price : null;
}

// --- Ekspansja (jak `pickLot` z pomiaru miasta, z kanibalizacją na karcie lokalu) --------------------------------------------------

function payFor(f: FirmState, lotId: number): 'raty' | 'gotowka' | null {
  if (rentRefusal(f, lotId, 'raty') === null) return 'raty';
  return rentRefusal(f, lotId, 'gotowka') === null ? 'gotowka' : null;
}

/** Najlepszy wolny lokal po tym, co widać na karcie (z własnymi sklepami w promieniu): środek widełek razy koszyk dzielnicy. */
function pickLot(f: FirmState): { lotId: number; pay: 'raty' | 'gotowka' } | null {
  let best: { score: number; lotId: number; pay: 'raty' | 'gotowka' } | null = null;
  const own = ownLotsOf(f);
  for (const lot of f.city.lots) {
    if (lotState(f, lot.id) !== 'wolny') continue;
    const pay = payFor(f, lot.id);
    if (pay === null) continue;
    const est = lotEstimate(f.seed, f.city, lot.id, undefined, own);
    const score = ((est.lo + est.hi) / 2) * DISTRICTS[lot.district].basket - lot.package / 1e6;
    if (best && score <= best.score) continue;
    best = { score, lotId: lot.id, pay };
  }
  return best;
}

// --- Co jeszcze da się kupić (bramka B2) ------------------------------------------------------------------------------------------

/**
 * Suma cen rzeczy jeszcze niekupionych w chwili pomiaru (spec §5.10, B2): w każdym otwartym sklepie remonty ponad obecny poziom i ulepszenia
 * do `maxLevel` (każdy brakujący poziom po swojej cenie, bez względu na blokady), do tego brakujące poziomy badań Sieci. Bez sprzętu.
 */
export function unboughtTotal(f: FirmState): { remonts: number; upgrades: number; research: number; total: number } {
  let remonts = 0;
  let upgrades = 0;
  for (const st of openStores(f)) {
    for (const r of REMONTS) if (r.level > st.econ.remontLevel) remonts += r.cost;
    for (const def of UPGRADES) for (let lv = st.econ.upgrades[def.id] ?? 0; lv < def.maxLevel; lv++) upgrades += upgradeCost(def, lv);
  }
  let research = 0;
  for (const def of RESEARCH) for (let lv = f.research[def.id] ?? 0; lv < def.maxLevel; lv++) research += researchCost(def, lv);
  return { remonts, upgrades, research, total: remonts + upgrades + research };
}

// --- Bieg firmy ---------------------------------------------------------------------------------------------------------------------

/**
 * Zamknięcie miesiąca: numer (1 = wrzesień), gotówka po zamknięciu, otwarte sklepy i wydatki sieci (pakiety, badania), a z wyciągów razem
 * we wszystkich sklepach: „Zostaje Ci” (`net`, po ratach), wynik bez rat (`result`, jak historia i ranking) i raty.
 */
export interface ProgMonth {
  month: number; label: string; wallet: number; net: number; result: number; installments: number; stores: number; invest: number;
  /** Rozliczenia planu Centrali z raportów tego zamknięcia, po sklepach (`hit` fałsz = wpadka; przy stopniu 3 kary nie ma, jest koniec umowy). */
  /** `charged`: kara planu w wyciągu tego sklepu (`statement.plan`, 0 bez wiersza): każda kara z rozliczenia ma tam swój wiersz. */
  plans: { storeId: number; share: number; stage: number; fine: number; hit: boolean; charged: number }[];
}

export interface ProgResult {
  strategy: ProgStrategy; seed: string; months: ProgMonth[];
  /** Miesiąc (zamknięty), przy którego zamknięciu przyszedł status Partnera. */
  partnerMonth: number | null;
  /** Otwarcia sklepów ponad startowy: miesiąc w toku (1 = wrzesień) i dzień gry. */
  opens: { storeId: number; month: number; day: number }[];
  /** Odblokowania kolejnej placówki: nowy limit i zamknięty miesiąc, który go dał (obrót sieci). */
  unlocks: { limit: number; month: number; turnover: number }[];
  /** Pierwszy milion (zdarzenie `million`, ta sama chwila co wpis do Galerii): miesiąc w toku i dzień gry; null, gdy nie przyszedł. */
  millionMonth: number | null; millionDay: number | null; storesAtMillion: number | null;
  /** Pierwsze 2 mln w portfelu (sprawdzane po każdej minucie): miesiąc w toku i suma niekupionego w tej chwili (B2). */
  twoMillionMonth: number | null; unboughtAt2m: ReturnType<typeof unboughtTotal> | null;
  /** To samo na końcu biegu (gdy 2 mln nie przyszło, mówi, ile jeszcze było do wydania). */
  unboughtEnd: ReturnType<typeof unboughtTotal>;
  /** Pierwszy zamknięty miesiąc, w którym któryś otwarty sklep ma poziom ≥ 28 (próg remontu 4) i ≥ 34 (remontu 5). */
  level28Month: number | null; level34Month: number | null;
  /** Wydane na badania Sieci, suma poziomów badań, poziomy remontu i poziomy sklepów (otwartych) na końcu biegu. */
  researchSpent: number; researchLevels: number; remontsEnd: number[]; levelsEnd: number[];
  /** Zakupy bota w sklepach (cena za gotówkę, także kupione na raty): remonty, ulepszenia, sprzęt; `raty` to liczba zakupów na raty. */
  bought: { remont: number; upgrade: number; equipment: number; raty: number };
  over: null | 'debt' | 'closed' | 'trust'; overMonth: number | null;
  /** Sklepy, którym Centrala wypowiedziała umowę za trzecią wpadkę planu: `id` i zamknięty miesiąc z tą wpadką (także ostatni sklep, który kończy grę). */
  closedByPlan: { storeId: number; month: number }[];
  /** Ostrzeżenia o debecie (sklepu przy jednym sklepie, firmy od dwóch). */
  debtWarnings: number;
  finalWallet: number;
}

/**
 * Bieg strategii na seedzie przez `months` zamkniętych miesięcy (albo do końca gry). `easyPlans`: co dobę plan Centrali każdego sklepu
 * dostaje łatwy cel (`keepPlansEasy`); domyślnie `false`, czyli prawdziwy plan.
 */
export function playProgresja(strategy: ProgStrategy, seed: string, months: number, opts: { easyPlans?: boolean } = {}): ProgResult {
  const setup = setupOf(strategy);
  const run = freshRun(seed);
  const f = createFirm(seed, { econ: run.state, layout: run.layout, info: run.info }, { ranked: false });
  const r: ProgResult = {
    strategy, seed, months: [], partnerMonth: null, opens: [], unlocks: [], millionMonth: null, millionDay: null, storesAtMillion: null,
    twoMillionMonth: null, unboughtAt2m: null, unboughtEnd: unboughtTotal(f), researchSpent: 0, researchLevels: 0, remontsEnd: [], levelsEnd: [],
    bought: { remont: 0, upgrade: 0, equipment: 0, raty: 0 }, level28Month: null, level34Month: null, over: null, overMonth: null, closedByPlan: [],
    debtWarnings: 0, finalWallet: 0,
  };
  const dayNow = (): number => Math.floor(activeStore(f).econ.minute / MINUTES_PER_DAY);
  const statements = new Map<number, { net: number; result: number; installments: number }>();
  const plans: ProgMonth['plans'] = [];
  const onStep = (out: FirmStepOut): void => {
    const seen: EconEvent[] = [...out.active, ...out.background.map((b) => b.event)];
    let label: string | null = null;
    for (const [i, event] of seen.entries()) {
      if (event.kind === 'debt') r.debtWarnings++;
      if (event.kind === 'month' && event.report?.statement) {
        const id = i < out.active.length ? f.activeId : out.background[i - out.active.length]!.storeId;
        const st = event.report.statement;
        statements.set(id, { net: st.net, result: st.result, installments: st.installments });
        const p = event.report.plan;
        if (p) plans.push({ storeId: id, share: p.share, stage: p.stage, fine: p.fine, hit: p.hit, charged: st.plan ?? 0 });
        label = event.report.label;
      }
    }
    if (label !== null) {
      const sum = (key: 'net' | 'result' | 'installments'): number => Math.round([...statements.values()].reduce((a, x) => a + x[key], 0));
      r.months.push({
        month: r.months.length + 1, label, wallet: Math.round(f.person.wallet), net: sum('net'), result: sum('result'), installments: sum('installments'),
        stores: openStores(f).length, invest: out.firm.find((e) => e.kind === 'network-report')?.summary?.invest ?? 0,
        plans: plans.splice(0).sort((a, b) => a.storeId - b.storeId),
      });
      statements.clear();
      const top = Math.max(...openStores(f).map((x) => x.econ.level));
      if (r.level28Month === null && top >= 28) r.level28Month = r.months.length;
      if (r.level34Month === null && top >= 34) r.level34Month = r.months.length;
    }
    for (const e of out.firm) {
      if (e.kind === 'debt') r.debtWarnings++;
      if (e.kind === 'partner') r.partnerMonth = r.months.length;
      if (e.kind === 'closed' && e.params?.reason === 'plan') r.closedByPlan.push({ storeId: e.storeId!, month: r.months.length });
      if (e.kind === 'opened' && e.params?.reopened !== 1) r.opens.push({ storeId: e.storeId!, month: r.months.length + 1, day: dayNow() });
      if (e.kind === 'unlock') r.unlocks.push({ limit: Number(e.params?.limit), month: r.months.length, turnover: Math.round(Number(e.params?.turnover)) });
      if (e.kind === 'million' && r.millionMonth === null) {
        r.millionMonth = r.months.length + 1;
        r.millionDay = dayNow();
        r.storesAtMillion = openStores(f).length;
      }
    }
    if (r.twoMillionMonth === null && f.person.wallet >= 2_000_000) {
      r.twoMillionMonth = r.months.length + 1;
      r.unboughtAt2m = unboughtTotal(f);
    }
  };
  const env: BotEnv = {
    view: () => { const st = activeStore(f); return economyView(st.econ, st.info); },
    apply: (cmd) => applyStoreCommand(f, toCommand(cmd)).result.ok,
    step: () => {
      if (awaitingDecision(activeStore(f).econ)) return false;
      const out = emptyStepOut();
      if (opts.easyPlans && activeStore(f).econ.minute % MINUTES_PER_DAY === 0) keepPlansEasy(f);
      stepFirmMinute(f, out);
      onStep(out);
      return true;
    },
  };
  const bot = BOTS[setup.bot];
  const end = (months + 1) * 31 * MINUTES_PER_DAY;   // zapas na zamknięcie ostatniego miesiąca; kończy ją licznik zamknięć
  let rented = 0;
  while (activeStore(f).econ.minute < end && r.months.length < months) {
    if (f.over !== null || activeStore(f).econ.gameOver) break;
    const mod = minuteOfDay(activeStore(f).econ.minute);
    const buying = r.months.length < setup.stopAfter;
    // `rozsadny`: o 8:00 i 9:00 (badania, zakupy) najpierw pyta prognozę planu; poza tymi chwilami nie liczy jej co minutę
    const allowed = !setup.planGated || ((mod === 8 * 60 || mod === 9 * 60) && planNeedsHelp(f));
    if (setup.research && buying && allowed && mod === 8 * 60) {
      const price = buyCheapestResearch(f);
      if (price !== null) r.researchSpent += price;
    }
    if (setup.buy && buying && allowed) buyMixed(f, r.bought);
    if (buying && rented < setup.extras && f.person.partner && openStores(f).length + f.builds.length < f.storeLimit) {
      const chosen = pickLot(f);
      if (chosen && applyFirmCommand(f, { type: 'rentLot', lotId: chosen.lotId, pay: chosen.pay }, emptyStepOut()).ok) rented++;
    }
    // rotacja: o 6:00 gracz przechodzi do następnego otwartego sklepu (po `id`, w kółko)
    if (setup.rotate && mod === 6 * 60 && openStores(f).length >= 2) {
      const open = openStores(f);
      const next = open.find((x) => x.id > f.activeId) ?? open[0]!;
      applyFirmCommand(f, { type: 'switchStore', storeId: next.id }, emptyStepOut());
    }
    runBot(bot, env, 1);
  }
  if (f.over !== null) { r.over = f.over; r.overMonth = r.months.length + 1; }
  else if (activeStore(f).econ.gameOver) { r.over = 'trust'; r.overMonth = r.months.length + 1; }
  // ostatni sklep nie dostaje zdarzenia `closed`: trzecia wpadka kończy grę (zaufanie zero ma pierwszeństwo, wtedy to nie plan)
  const last = activeStore(f);
  if (r.over !== null && planTerminates(last.econ.franchisee.plan) && !trustTerminates(last.econ.tycoon.trust.value)
    && !r.closedByPlan.some((c) => c.storeId === last.id)) r.closedByPlan.push({ storeId: last.id, month: r.months.length });
  r.finalWallet = Math.round(f.person.wallet);
  r.unboughtEnd = unboughtTotal(f);
  r.researchLevels = RESEARCH_IDS.reduce((n, id) => n + (f.research[id] ?? 0), 0);
  r.remontsEnd = openStores(f).map((s) => s.econ.remontLevel);
  r.levelsEnd = openStores(f).map((s) => s.econ.level);
  return r;
}

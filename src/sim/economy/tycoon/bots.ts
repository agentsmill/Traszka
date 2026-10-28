import { bestAnswer, type CardInstance, type Valuation } from './cards';
import { FATIGUE, type TapKind } from './fatigue';
import type { StaffProfile } from './staff';

/**
 * Boty do sprawdzania balansu (spec §7.5): bierny gracz, „stukanie bez decyzji”, „decyzje bez stukania” i gracz, który
 * robi jedno i drugie. Bot widzi tylko to, co widzi gracz (`BotView`), i wydaje te same polecenia, co interfejs
 * (`BotCommand`, w kształcie poleceń z warstwy komend strumienia A). Środowisko (`BotEnv`) to dziś makieta sklepu
 * (`sandbox.ts`), a w części 2 prawdziwa ekonomia: boty się nie zmienią.
 */

export type BotName = 'bierny' | 'stukacz' | 'decydent' | 'mistrz';
export const BOT_NAMES: readonly BotName[] = ['bierny', 'stukacz', 'decydent', 'mistrz'];

export interface BotView {
  minute: number;
  /** Minuta dnia. */
  mod: number;
  open: boolean;
  queue: number;
  /** Ilu ludzi w kolejce klient jeszcze toleruje (z czystością i przeszkodami). */
  patience: number;
  sidewalkPallets: number;
  pallets: number;
  cleanliness: number;
  hallBags: number;
  backroomBags: number;
  energy: number;
  spentToday: number;
  tapCost: Record<TapKind, number>;
  profile: StaffProfile | 'wlasny';
  /** Karty widoczne teraz. */
  cards: CardInstance[];
  /** Luz pod progiem WUT do końca miesiąca (zł). */
  wutSlack: number;
  trust: number;
}

export type BotCommand =
  | { type: 'card.answer'; seq: number; answer: number }
  | { type: 'staff.profile'; profile: StaffProfile }
  | { type: 'tap.till'; combo: number }
  | { type: 'tap.pallet'; combo: number };

export interface Bot { name: BotName; label: string; act(v: BotView): BotCommand[] }

export interface BotEnv {
  view(): BotView;
  /** Wykonuje polecenie; false, gdy się nie udało (jak `CommandResult.ok`). */
  apply(cmd: BotCommand): boolean;
  /** Jedna minuta gry. */
  step(): void;
}

/** Wycena zasobów, którą boty porównują odpowiedzi na kartach (zł za punkt zaufania, złotówkę WUT, osobominutę…). */
export const BOT_VALUATION: Valuation = { trust: 120, wut: 1, staffMinute: 0.6, energy: 3, reputation: 100, ogonki: 2 };

/** Gdy pod progiem WUT jest luz, ubytek do końca miesiąca prawie nic nie kosztuje. */
export function valuationFor(v: BotView, energy: number): Valuation {
  return { ...BOT_VALUATION, wut: v.wutSlack > 300 ? 0.15 : 1, energy };
}

const answerAll = (v: BotView, val: Valuation): BotCommand[] =>
  v.cards.map((c): BotCommand => ({ type: 'card.answer', seq: c.seq, answer: bestAnswer(c, val) }));

/** Profil ludzi na tę chwilę: kolejka, gdy klienci zaczynają odchodzić, palety z chodnika, gdy jest spokojnie, potem porządek. */
export function chooseProfile(v: BotView): StaffProfile {
  if (!v.open) return v.pallets > 0 ? 'dostawa' : 'porzadek';
  if (v.queue >= Math.max(1, v.patience - 2)) return 'kolejka';
  if (v.sidewalkPallets > 0 && v.queue < 2) return 'dostawa';
  if ((v.cleanliness < 75 || v.hallBags > 0) && v.queue < 2) return 'porzadek';
  return 'kolejka';
}

const profileCmd = (v: BotView): BotCommand[] => {
  const p = chooseProfile(v);
  return p === v.profile ? [] : [{ type: 'staff.profile', profile: p }];
};

/** Stuka, kiedy tylko może: w kasę, gdy ktoś czeka, w paletę, gdy kasa pusta. Do dna puli, codziennie. */
function greedyTap(v: BotView): BotCommand[] {
  if (!v.open) return [];
  if (v.queue >= 1 && v.energy >= v.tapCost.kasa) return [{ type: 'tap.till', combo: Math.min(FATIGUE.maxCombo, Math.floor(v.queue)) }];
  if (v.pallets > 0 && v.energy >= v.tapCost.paleta) return [{ type: 'tap.pallet', combo: 3 }];
  return [];
}

/** Siły, które rozsądny gracz zostawia na wieczorne karty (sejf, szkolenie z okólnika). */
const EVENING_RESERVE = 20;

/**
 * Stuka tylko tam, gdzie to coś zmienia: kasa, gdy klienci zaraz zaczną odchodzić, palety na chodniku w godzinach Straży
 * Miejskiej. Wydaje dziennie tyle, ile noc odda, minus zapas na wieczorne karty, więc rzadko przenosi zmęczenie na jutro.
 */
function smartTap(v: BotView): BotCommand[] {
  if (!v.open) return [];
  const budget = FATIGUE.nightRecovery - EVENING_RESERVE - v.spentToday;
  const over = v.queue - (v.patience - 2);
  if (over > 0 && v.queue >= 1 && budget >= v.tapCost.kasa) {
    const combo = Math.min(FATIGUE.maxCombo, Math.ceil(over), Math.floor(budget / v.tapCost.kasa));
    return [{ type: 'tap.till', combo }];
  }
  if (v.sidewalkPallets > 0 && v.mod >= 7 * 60 && v.mod < 20 * 60 && budget >= 3 * v.tapCost.paleta) return [{ type: 'tap.pallet', combo: 3 }];
  return [];
}

export const BOTS: Record<BotName, Bot> = {
  bierny: { name: 'bierny', label: 'Bierny gracz', act: () => [] },
  stukacz: { name: 'stukacz', label: 'Stukanie bez decyzji', act: greedyTap },
  decydent: {
    name: 'decydent',
    label: 'Decyzje bez stukania',
    // nie stuka, więc siły ma tylko na karty („stanę za niego sam”)
    act: (v) => [...answerAll(v, valuationFor(v, 0)), ...profileCmd(v)],
  },
  mistrz: {
    name: 'mistrz',
    label: 'Decyzje i stukanie',
    act: (v) => [...answerAll(v, valuationFor(v, BOT_VALUATION.energy)), ...profileCmd(v), ...smartTap(v)],
  },
};

/** Puszcza bota w środowisku na `minutes` minut gry: co minutę bot patrzy i wydaje polecenia, potem minuta mija. */
export function runBot(bot: Bot, env: BotEnv, minutes: number): void {
  for (let i = 0; i < minutes; i++) {
    for (const cmd of bot.act(env.view())) env.apply(cmd);
    env.step();
  }
}

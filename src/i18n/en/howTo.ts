import {
  ASSISTANT_UNLOAD_MIN, CATS, CAT_INFO, DEBT_LIMIT, DELIVERY_AT, GUARANTEE, HOT, INSTALLMENTS, OPEN_FROM, OPEN_TO, ORDER_DEADLINE, OWN_COSTS,
  PALLETS_FREE, PALLET_FEE, REMANENT, STAFF_MAX, STRAZ, TILL_TAP_QUEUE_MIN, type Cat,
} from '@/sim/economy/catalog';
import { KPI } from '@/sim/economy/tycoon/kpi';
import { PROFILE_ORDER, STAFF_PROFILES, type StaffTask } from '@/sim/economy/tycoon/staff';
import { SUNDAY_TRAFFIC } from '@/sim/economy/tycoon/sunday';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { signedPts, signedZl, zl } from '@/ui/game/format';
import { SPEEDS } from '@/ui/game/Hud';
import { ENERGY_TITLE } from '@/ui/game/tapBlock';
import { dayLengthText, finalRank, hourOf, trustBonusSteps, type HowToSection } from '@/ui/howto/howToText';
import { enNum, enPlural } from '../num';
import { tr } from '../t';
import { rankText } from '../index';
import { EN_CATS, EN_PROFILE_LABEL } from './content';

/*
 * „Jak grać” po angielsku: ten sam układ co `howToText.ts` (punkty „co robić” i zwinięte szczegóły, tyle samo sekcji) i te same
 * stałe gry, więc liczby zmieniają się razem z balansem. Polskie funkcje zostają bez zmian; `HowTo.tsx` wybiera wersję po języku.
 */

const percent = (share: number): string => `${enNum(Math.round(share * 1000) / 10, 1)}%`;
const hours = (n: number): string => `${enNum(n)} ${enPlural(n, 'hour', 'hours')}`;
const months = (n: number): string => `${n} ${enPlural(n, 'month', 'months')}`;
const list = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

/** Co ludzie robią najpierw w profilu pracy (pierwsze zadanie z kolejki profilu). */
const FIRST_TASK: Record<StaffTask, string> = { kasa: 'the till', rozladunek: 'pallets', wykladanie: 'shelves', sprzatanie: 'cleaning' };

function marginRange(): { low: { label: string; margin: number }; high: { label: string; margin: number } } {
  const sorted = [...CATS].sort((a, b) => CAT_INFO[a].margin - CAT_INFO[b].margin);
  const pick = (c: Cat) => ({ label: EN_CATS[c].toLowerCase(), margin: CAT_INFO[c].margin });
  return { low: pick(sorted[0]!), high: pick(sorted[sorted.length - 1]!) };
}

export function howToPointsEn(): string[] {
  const running = SPEEDS.filter((s) => s.value > 0);
  const slowest = running[0]!;
  const fastest = running[running.length - 1]!;
  const profiles = STAFF_PROFILES.map((p) => `“${EN_PROFILE_LABEL[p]}”: ${FIRST_TASK[PROFILE_ORDER[p][0]!]}`).join(', ');
  return [
    `Goal: reach the rank of “${rankText(finalRank().level)}” without losing your agreement. Head Office terminates it if your trust hits zero.`,
    'When a decision card appears, pick an answer: the game waits, and the costs and gains are shown on the buttons.',
    'After a delivery, move pallets from the pavement to the stockroom (Pallets tab, “To stockroom” button) before the City Wardens come back.',
    `In the Staff tab, set the work profile, i.e. what your staff do first: ${profiles}.`,
    'When the queue grows, buy a self-checkout or a second till (Upgrades tab): you have as many cashiers as till stations.',
    'Your margin goes to your Head Office balance, and your cash only moves when the month closes; the bar shows what you’ll keep (Goals tab, “This month” section).',
    `Change the speed at the top (${slowest.label}–${fastest.label}); Space pauses.`,
  ];
}

export function howToDetailsEn(): HowToSection[] {
  const slowest = SPEEDS.filter((s) => s.value > 0)[0]!;
  const margins = marginRange();
  const steps = trustBonusSteps();
  const bonus = steps.length === 0 ? [] : [`${steps.map((x, i) => (i === 0
    ? `From ${x.from} points Head Office pays you a turnover bonus: ${percent(x.share)}` : `from ${x.from} points ${percent(x.share)}`)).join(', ')}.`];
  const plans = INSTALLMENTS.plans;

  return [
    {
      title: 'Money and the stocktake',
      paragraphs: [
        `You earn margin, not turnover: from ${percent(margins.low.margin)} (${margins.low.label}) to ${percent(margins.high.margin)} (${margins.high.label}) of the price, and hot dogs and coffee give you ${percent(HOT.margin)}.`,
        'Margin and bonuses go to your Head Office balance; when the month closes, the transfer minus instalments, pallets and costs gives you “You keep”.',
        `Your costs are wages, utilities, ZUS (Polish social security, ${zl(OWN_COSTS.zus)}), the accountant (${zl(OWN_COSTS.accounting)}) and VAT (${percent(OWN_COSTS.vatShare)} of the transfer).`,
        `Instalments for upgrades, equipment and refits: ${list(plans.map((p) => String(p.months)))} months, fee ${list(plans.map((p) => percent(p.fee)))}, up to ${percent(INSTALLMENTS.limitShare)} of the transfer per month in total.`,
        `Every ${months(REMANENT.everyMonths)} a stocktake counts your shrinkage (Shop tab); you only learn Head Office’s limit at the first one, and the excess comes off the transfer.`,
        `For the first ${months(GUARANTEE.months)} Head Office tops your income up to ${zl(GUARANTEE.income)} (trust of at least ${GUARANTEE.minTrust}, no fines).`,
      ],
    },
    {
      title: 'Pallets and deliveries',
      paragraphs: [
        `Orders for tomorrow close at ${hourOf(ORDER_DEADLINE)}, and the delivery usually arrives at ${hourOf(DELIVERY_AT)}. By default the Traszka Assistant does the ordering; you can order by hand in the Pallets tab.`,
        `The Assistant orders at most as many pallets as your staff (apart from the till) can unload in ${hours(ASSISTANT_UNLOAD_MIN / 60)}: more staff, more stock.`,
        `The City Wardens come by from ${hourOf(STRAZ.from)} when pallets have been on the pavement for more than ${hours(STRAZ.graceMin / 60)}: first a warning, then a fine.`,
        `Pallets above ${PALLETS_FREE} per order cost ${zl(PALLET_FEE)} each, and nobody takes the excess back.`,
        'A pallet moved “To shop floor” and overflow in the aisles put customers off and damage your reputation. Rubbish bags from unloading have to be taken out, or they fill up the stockroom.',
      ],
    },
    {
      title: 'Your hands',
      paragraphs: [
        tr(ENERGY_TITLE),
        `You tap the till when nobody’s on it or the queue would wait more than ${enNum(TILL_TAP_QUEUE_MIN)} minutes.`,
      ],
    },
    {
      title: 'Staff',
      paragraphs: [
        `You can hire at most ${STAFF_MAX} people. You can pin a person to a task, and “Who’s doing what now” shows who’s where.`,
      ],
    },
    {
      title: 'Head Office’s trust',
      paragraphs: [
        `Trust starts at ${enNum(TRUST.start)} points, goes up for a weekly KPI hit (${signedPts(KPI.trustHit)}) and a month in the black (${signedPts(TRUST.monthProfit)}), and goes down for a fine (${signedPts(TRUST.fine)}) and a month in the red (${signedPts(TRUST.monthLoss)}).`,
        ...bonus,
        `You lose your agreement if trust is at zero at the end of a month, or straight away if your cash drops below ${signedZl(DEBT_LIMIT)}.`,
      ],
    },
    {
      title: 'Time and goals',
      paragraphs: [
        `A day lasts about ${dayLengthText()} at ${slowest.label}, and the shop is open from ${hourOf(OPEN_FROM)} to ${hourOf(OPEN_TO)}. On Sundays footfall goes up ×${enNum(SUNDAY_TRAFFIC)}.`,
        `In the Goals tab there’s a goal to hit by Sunday: hitting it gives you a bonus, trust and XP, and missing it costs you trust (${signedPts(KPI.trustMiss)}). Milestone rewards: “Claim”.`,
      ],
    },
  ];
}

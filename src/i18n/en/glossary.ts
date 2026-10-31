import { GUARANTEE, INSTALLMENTS, OWN_COSTS, REMANENT } from '@/sim/economy/catalog';
import { zl } from '@/ui/game/format';
import type { GlossaryEntry } from '@/ui/howto/glossary';
import { hourOf } from '@/ui/howto/howToText';
import { enNum, enPlural } from '../num';

/*
 * Słowniczek „Jak grać” po angielsku: te same hasła w tej samej kolejności co `ui/howto/glossary.ts` i te same stałe gry, więc
 * liczby idą razem z balansem. Terminy jak w `docs/i18n/glossary-en.md`. Limitu ubytków też nie zdradza.
 */

const percent = (share: number): string => `${enNum(Math.round(share * 1000) / 10, 1)}%`;
const months = (n: number): string => `${n} ${enPlural(n, 'month', 'months')}`;
/** „3, 6 or 12”: elementy po przecinku, ostatni po „or”. */
const either = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

export function glossaryEn(): GlossaryEntry[] {
  const plans = INSTALLMENTS.plans;
  return [
    {
      term: 'Head Office balance',
      text: 'The sales margin and bonuses earned this month. You can see it on the bar, but you can’t spend it: it arrives as a transfer when the month closes.',
    },
    {
      term: 'Transfer',
      text: `What Head Office pays you when the month closes: margin, bonuses and, for the first ${months(GUARANTEE.months)}, a guarantee top-up to ${zl(GUARANTEE.income)}. `
        + 'Deductions and your own costs come out of the transfer.',
    },
    {
      term: 'Statement',
      text: 'Head Office’s settlement for the month: the transfer, deductions (instalments, pallets, stocktake), your costs and “You keep”. It arrives when the month closes, '
        + 'and tapping the bar under your cash shows a forecast.',
    },
    {
      term: 'Instalments',
      text: `An upgrade, equipment or a refit right away, paid off in ${either(plans.map((p) => String(p.months)))} instalments with a fee of ${either(plans.map((p) => percent(p.fee)))}. `
        + 'Head Office deducts an instalment from every transfer. Your instalment limit depends on trust. Cash is always cheaper.',
    },
    {
      term: 'Stocktake',
      text: `Counting the stock every ${months(REMANENT.everyMonths)}, on the last day of the month at ${hourOf(REMANENT.at)}. Shrinkage over Head Office’s limit comes out of that day’s transfer.`,
    },
    {
      term: 'Shrinkage',
      text: 'Out-of-date stock, theft, “forgotten” scans, mistakes and the effects of the day’s decisions. You can’t see it as it happens: the bill comes at the stocktake. '
        + 'Head Office covers part of it and tells you the limit at your first stocktake.',
    },
    {
      term: '“You keep”',
      text: 'The transfer minus deductions minus your costs. This amount, even a negative one, goes into your cash when the month closes. On the bar, its estimate is “keep”.',
    },
    {
      term: 'ZUS',
      text: `Poland’s social insurance institution. Your contributions as a business owner: ${zl(OWN_COSTS.zus)} a month, paid when the month closes, even in a weak month.`,
    },
    {
      term: 'Accountant',
      text: `Keeps your paperwork in order for ${zl(OWN_COSTS.accounting)} a month. Works out how much you owe everyone else.`,
    },
  ];
}

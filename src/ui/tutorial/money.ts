import { t } from '@/i18n';
import { DEBT_LIMIT, HIRE_COST, REMANENT, WAGE_PER_DAY } from '@/sim/economy/catalog';
import { DEBT_WARN } from '@/sim/economy/economy';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { money, plural, zl } from '../game/format';
import type { TourStep } from './steps';
import type { TipDef } from './tips';

/*
 * Wszystko, co samouczek mówi o pieniądzach, zaufaniu Centrali i ratach (spec samouczka, §7), w jednym miejscu: przy następnej
 * zmianie ekonomii przepisuje się tylko ten plik. Teksty są pod model SIM 6 („trzy kieszenie”): gotówka, saldo u Centrali, raty,
 * „Zostaje Ci”, wyciąg i remanent. Opłaty franczyzowej i „Do oddania Centrali” już nie ma, więc o nich nie mówimy.
 */

/** Kroki 2–5 przelotu: gotówka, saldo u Centrali, raty i „Zostanie”, zaufanie. Wskazują pasek gry (`Hud.tsx`). */
export function moneySteps(): TourStep[] {
  return [
    {
      id: 'gotowka', target: 'cash',
      title: t`Gotówka`,
      text: t`Twoje pieniądze na zakupy, rekrutację i mandaty. W trakcie miesiąca rusza się mało, bo marża tu nie wpada. `
        + t`Od ${money(DEBT_WARN)} Centrala ostrzega, a przy ${money(DEBT_LIMIT)} kończy współpracę.`,
    },
    {
      id: 'saldo', target: 'saldo',
      title: t`Saldo u Centrali`,
      text: t`Tu wpada marża ze sprzedaży i premie. Widać je, ale go nie wydasz: Centrala odda je przelewem przy zamknięciu miesiąca.`,
    },
    {
      id: 'zostanie', target: 'due',
      title: t`Raty i „Zostanie”`,
      text: t`Przy zamknięciu Centrala potrąca z przelewu raty i palety, a Ty płacisz pensje, media, ZUS, VAT i księgową. `
        + t`Reszta to „Zostaje Ci” i wpada do gotówki. Stuknięcie w ten pasek pokaże wyciąg.`,
    },
    {
      id: 'zaufanie', target: 'trust',
      title: t`Zaufanie Centrali`,
      text: t`Od 0 do 100, na start ${TRUST.start}. Od niego zależą premia od obrotu i limit rat. Przy zerze na koniec miesiąca umowa się kończy.`,
    },
  ];
}

/** Zdania o pieniądzach wstawiane w ogólne kroki przelotu (`steps.ts`). */
export const MONEY_NOTES = {
  palety: (): string => t`Nadmiar towaru się przeterminuje, a rachunek przyjdzie przy remanencie.`,
  ludzie: (): string => t`Rekrutacja to ${zl(HIRE_COST)} z gotówki, a każda osoba na zmianie kosztuje ${zl(WAGE_PER_DAY)} dziennie, płatne przy zamknięciu miesiąca.`,
  ulepszenia: (): string => t`Płacisz gotówką albo na raty: Centrala potrąci je z kolejnych przelewów. Za gotówkę zawsze taniej.`,
  kpi: (): string => t`premię na saldo i zaufanie Centrali`,
} as const;

/** Dymki „pierwszy raz” o pieniądzach: pierwszy wyciąg od Centrali i pierwszy protokół remanentu (oba nad swoim oknem). */
export const MONEY_TIPS: readonly TipDef[] = [
  {
    id: 'tip-wyciag',
    inWindow: true,
    // protokół remanentu leży nad raportem: dymek wyciągu czeka, aż gracz go zamknie
    when: (ctx) => !!ctx.report?.statement && !ctx.remanentOpen && !ctx.s.gameOver,
    targets: () => ['zostaje-ci', 'report'],
    text: () => t`Wyciąg od Centrali. Przelew (marża, premie) minus potrącenia (raty, palety) minus Twoje koszty daje „Zostaje Ci”: `
      + t`tyle właśnie wpadło do gotówki. Słowniczek: „?”.`,
  },
  {
    id: 'tip-remanent',
    inWindow: true,
    when: (ctx) => ctx.remanentOpen && !ctx.s.gameOver,
    targets: () => ['remanent-verdict'],
    text: () => t`Remanent. Co ${REMANENT.everyMonths} ${plural(REMANENT.everyMonths, 'miesiąc', 'miesiące', 'miesięcy')} Centrala liczy ubytki: `
      + t`przeterminowany towar, kradzieże, pomyłki. Ponad limit płacisz Ty, z dzisiejszego przelewu.`,
  },
];

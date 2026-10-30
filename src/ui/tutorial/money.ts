import { DEBT_LIMIT, HIRE_COST, WAGE_PER_DAY } from '@/sim/economy/catalog';
import { DEBT_WARN } from '@/sim/economy/economy';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { money, zl } from '../game/format';
import type { TourStep } from './steps';

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
      title: 'Gotówka',
      text: `Twoje pieniądze na zakupy, rekrutację i mandaty. W trakcie miesiąca rusza się mało, bo marża tu nie wpada. `
        + `Od ${money(DEBT_WARN)} Centrala ostrzega, a przy ${money(DEBT_LIMIT)} kończy współpracę.`,
    },
    {
      id: 'saldo', target: 'saldo',
      title: 'Saldo u Centrali',
      text: 'Tu wpada marża ze sprzedaży i premie. Widać je, ale go nie wydasz: Centrala odda je przelewem przy zamknięciu miesiąca.',
    },
    {
      id: 'zostanie', target: 'due',
      title: 'Raty i „Zostanie”',
      text: 'Przy zamknięciu Centrala potrąca z przelewu raty i palety, a Ty płacisz pensje, media, ZUS, VAT i księgową. '
        + 'Reszta to „Zostaje Ci” i wpada do gotówki. Stuknięcie w ten pasek pokaże wyciąg.',
    },
    {
      id: 'zaufanie', target: 'trust',
      title: 'Zaufanie Centrali',
      text: `Od 0 do 100, na start ${TRUST.start}. Od niego zależą premia od obrotu i limit rat. Przy zerze na koniec miesiąca umowa się kończy.`,
    },
  ];
}

/** Zdania o pieniądzach wstawiane w ogólne kroki przelotu (`steps.ts`). */
export const MONEY_NOTES = {
  palety: (): string => 'Nadmiar towaru się przeterminuje, a rachunek przyjdzie przy remanencie.',
  ludzie: (): string => `Rekrutacja to ${zl(HIRE_COST)} z gotówki, a każda osoba na zmianie kosztuje ${zl(WAGE_PER_DAY)} dziennie, płatne przy zamknięciu miesiąca.`,
  ulepszenia: (): string => 'Płacisz gotówką albo na raty: Centrala potrąci je z kolejnych przelewów. Za gotówkę zawsze taniej.',
  kpi: (): string => 'premię na saldo i zaufanie Centrali',
} as const;

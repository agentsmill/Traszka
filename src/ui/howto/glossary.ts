import { GUARANTEE, INSTALLMENTS, OWN_COSTS, REMANENT } from '@/sim/economy/catalog';
import { plural, zl } from '../game/format';
import { hourOf, percent } from './howToText';

/*
 * Słowniczek w oknie „Jak grać” (spec samouczka, §6): pojęcia pieniędzy z SIM 6 („trzy kieszenie”) jednym, dwoma zdaniami.
 * Liczby ze stałych gry. Limitu ubytków nie zdradza: gracz poznaje go dopiero przy pierwszym remanencie, jak w panelu Sklep.
 */

export interface GlossaryEntry { term: string; text: string }

const months = (n: number): string => `${n} ${plural(n, 'miesiąc', 'miesiące', 'miesięcy')}`;
/** „3, 6 albo 12”: elementy po przecinku, ostatni po „albo”. */
const either = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} albo ${items[items.length - 1]}`);

export function glossary(): GlossaryEntry[] {
  const plans = INSTALLMENTS.plans;
  return [
    {
      term: 'Saldo u Centrali',
      text: 'Marża ze sprzedaży i premie naliczone w tym miesiącu. Widać je na pasku, ale nie da się go wydać: przychodzi przelewem przy zamknięciu miesiąca.',
    },
    {
      term: 'Przelew',
      text: `To, co Centrala przelewa Ci przy zamknięciu miesiąca: marża, premie, a przez pierwsze ${months(GUARANTEE.months)} dopłata z gwarancji do ${zl(GUARANTEE.income)}. `
        + 'Z przelewu schodzą potrącenia i Twoje koszty.',
    },
    {
      term: 'Wyciąg',
      text: 'Rozliczenie miesiąca od Centrali: przelew, potrącenia (raty, palety, remanent), Twoje koszty i „Zostaje Ci”. Przychodzi przy zamknięciu miesiąca, '
        + 'a prognozę pokazuje stuknięcie w pasek pod gotówką.',
    },
    {
      term: 'Raty',
      text: `Ulepszenie, sprzęt albo remont od razu, a zapłata w ${either(plans.map((p) => String(p.months)))} ratach z opłatą ${either(plans.map((p) => percent(p.fee)))}. `
        + 'Centrala potrąca ratę z każdego przelewu. Limit rat zależy od zaufania. Za gotówkę zawsze taniej.',
    },
    {
      term: 'Remanent',
      text: `Liczenie towaru co ${months(REMANENT.everyMonths)}, ostatniego dnia miesiąca o ${hourOf(REMANENT.at)}. Ubytki ponad limit Centrali schodzą z przelewu tego samego dnia.`,
    },
    {
      term: 'Ubytki',
      text: 'Przeterminowany towar, kradzieże, „zapomniane” skany, pomyłki i skutki decyzji dnia. Nie widać ich na bieżąco: rachunek przychodzi przy remanencie. '
        + 'Część pokrywa Centrala, a limit poda przy pierwszym remanencie.',
    },
    {
      term: '„Zostaje Ci”',
      text: 'Przelew minus potrącenia minus Twoje koszty. Ta kwota, także ujemna, wpada do gotówki przy zamknięciu miesiąca. Na pasku jej szacunek to „Zostanie”.',
    },
    {
      term: 'ZUS',
      text: `Zakład Ubezpieczeń Społecznych. Twoje składki jako przedsiębiorcy: ${zl(OWN_COSTS.zus)} miesięcznie, płatne przy zamknięciu miesiąca, także w słabym miesiącu.`,
    },
    {
      term: 'Księgowa',
      text: `Prowadzi Twoje papiery za ${zl(OWN_COSTS.accounting)} miesięcznie. Liczy, ile jesteś winien wszystkim innym.`,
    },
  ];
}

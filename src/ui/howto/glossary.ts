import { GUARANTEE, INSTALLMENTS, OWN_COSTS, REMANENT } from '@/sim/economy/catalog';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { PARTNER_MONTHS, PARTNER_TRUST, RELET_BUILD_DAYS, RELET_SHARE } from '@/sim/firm/commands';
import { plural, zl } from '../game/format';
import { openingPlan, reletPlan } from '../tutorial/city';
import { hourOf, percent } from './howToText';

/*
 * Słowniczek w oknie „Jak grać” (spec samouczka, §6): pojęcia pieniędzy z SIM 6 („trzy kieszenie”) i pojęcia miasta z 4a (spec §17)
 * jednym, dwoma zdaniami. Liczby ze stałych gry. Limitu ubytków nie zdradza: gracz poznaje go dopiero przy pierwszym remanencie,
 * jak w panelu Sklep.
 */

export interface GlossaryEntry { term: string; text: string }

const months = (n: number): string => `${n} ${plural(n, 'miesiąc', 'miesiące', 'miesięcy')}`;
/** „3, 6 albo 12”: elementy po przecinku, ostatni po „albo”. */
const either = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} albo ${items[items.length - 1]}`);

export function glossary(): GlossaryEntry[] {
  const plans = INSTALLMENTS.plans;
  const opening = openingPlan();
  const relet = reletPlan();
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
    {
      term: 'Partner Strategiczny',
      text: `Status od Centrali, który pozwala wynająć kolejny lokal w Mieście. Przychodzi, gdy sklep startowy ma zysk ${months(PARTNER_MONTHS)} z rzędu, `
        + `a zaufanie przy zamknięciu miesiąca wynosi co najmniej ${PARTNER_TRUST}. Raz nadany zostaje; w sezonie rankingowym nie przychodzi.`,
    },
    {
      term: 'Pakiet otwarcia',
      text: `Cena urządzenia nowego lokalu zamiast czynszu. Płacisz od razu z gotówki (po zapłacie musi zostać co najmniej 0 zł) albo w ${opening.months} ratach `
        + `z opłatą ${percent(opening.feeShare)} z przelewów nowego sklepu. Pakiet lokalu po Traszce jest tańszy, więc rat jest zwykle ${relet.months} `
        + `(opłata ${percent(relet.feeShare)}). Nowy sklep nie ma gwarancji ${zl(GUARANTEE.income)}: na siebie zarabia sam.`,
    },
    {
      term: 'Lokal po Traszce',
      text: `Lokal po zamkniętym sklepie. Pakiet kosztuje ${percent(RELET_SHARE)} ceny, a budowa trwa ${RELET_BUILD_DAYS} ${plural(RELET_BUILD_DAYS, 'dzień', 'dni', 'dni')}, `
        + 'bo urządzenie lokalu zostało. Wyposażenie zostaje: remont, sprzęt i ulepszenia. Poziom i zaufanie Centrali zaczynasz od nowa '
        + `(zaufanie ${TRUST.start}). Taki sklep nigdy nie ma gwarancji ${zl(GUARANTEE.income)}.`,
    },
    {
      term: 'Zastępca',
      text: 'Rozstrzyga karty decyzji w sklepie, w którym Cię nie ma: wybiera odpowiedź zaznaczoną z góry. Co wybrał, widać w skrzynce zastępcy na liście sklepów. '
        + 'Ręce masz tylko tam, gdzie jesteś.',
    },
    {
      term: 'Dzielnica',
      text: 'Część miasta, w której leży lokal: Osiedle, Śródmieście, Dworzec albo Biurowce. Od niej zależą ruch, koszyk klienta, oczekiwania, kradzieże '
        + 'i cena pakietu otwarcia. Dzielnica ma też rytm dnia: Biurowce tłoczą rano i w porze lunchu, a wieczorem pustoszeją, Śródmieście jest '
        + 'najgęstsze wieczorem, Dworzec równy cały dzień. Rytm zmienia, kiedy klienci przychodzą, a nie ilu ich jest. Trudni klienci (spory przy kasie, '
        + 'kontrola wieku) trafiają się najczęściej na Dworcu. Warstwa „Dzielnice” koloruje mapę.',
    },
    {
      term: 'Rozliczenie końcowe',
      text: 'Rachunek przy zamknięciu sklepu: przez Centralę albo po Twoim wypowiedzeniu (sklep pracuje wtedy jeszcze miesiąc). Niespłacone raty tej umowy '
        + 'i ubytki od ostatniego remanentu ponad limit schodzą z gotówki jednym ruchem, więc zamknięcie sklepu nie jest ucieczką od rat.',
    },
  ];
}

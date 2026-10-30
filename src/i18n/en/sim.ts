import { LOC_LABEL } from '@/sim/economy/economy';
import { MONTH_NAME } from '@/sim/economy/calendar';
import type { PalletLoc } from '@/sim/economy/storeInfo';
import { enPlural, plNum, plValue } from '../num';
import { EN_HINTS, EN_KPI_TITLE, EN_LOC_LABEL, EN_MONTH_NAME } from './content';
import type { Rule } from '../dict';

/*
 * Zdania, które składa symulacja (`src/sim/economy`): zdarzenia (toasty, okna „OK”), odmowy poleceń, tytuł wyciągu, protokół
 * remanentu. `pl` to polski szablon dokładnie tak, jak stoi w źródle (każde `${…}` to `{}`); test zgodności kluczy porównuje te
 * klucze z literałami ze `src/sim`, więc nowe zdanie bez angielskiej wersji wychodzi w teście. `fragment`: kawałek, który nie jest
 * całym zdaniem (wartość wstawiana w inne zdanie), tłumaczony w regule tego zdania. `re`: własne wyrażenie, gdy samo `{}` nie
 * wystarcza (kilka pól obok siebie, część opcjonalna).
 * Liczby przychodzą w polskim zapisie (`plNum` przekłada je na angielski), a polskie wstawki (etykiety, nazwy) przez `sub`.
 */

/** Paleta po angielsku z liczby w polskim zapisie: „1 pallet”, „3 pallets”. */
const pallets = (count: string): string => `${plNum(count)} ${enPlural(plValue(count), 'pallet', 'pallets')}`;

/** „2 pod sklepem, 1 na zapleczu” (lista z `deliver`, etykiety `LOC_LABEL` małą literą) → „2 on the pavement, 1 in the stockroom”. */
function whereEn(where: string): string {
  const byPl = new Map<string, string>();
  for (const loc of Object.keys(LOC_LABEL) as PalletLoc[]) byPl.set(LOC_LABEL[loc].toLowerCase(), EN_LOC_LABEL[loc].toLowerCase());
  return where.split(', ').map((part) => {
    const m = /^(\S+) (.+)$/.exec(part);
    return m ? `${plNum(m[1]!)} ${byPl.get(m[2]!) ?? m[2]}` : part;
  }).join(', ');
}

/** Zmiana zaufania z `trustDeltaText`: „+1,5”, „−2” albo „bez zmian”. */
const trustDelta = (s: string): string => (s === 'bez zmian' ? 'unchanged' : plNum(s));

/** „wrzesień 2026” (`formatMonth`) → „September 2026”. */
export function monthLabel(label: string): string {
  const m = /^(\S+) (\d+)$/.exec(label);
  const i = m ? MONTH_NAME.indexOf(m[1] as (typeof MONTH_NAME)[number]) : -1;
  return i >= 0 ? `${EN_MONTH_NAME[i]} ${m![2]}` : label;
}

/** „ na raty: 6 × 4 500 zł” (dopisek `pay` do wyniku zakupu) albo pusty. */
const ratyEn = (months: string | undefined, monthly: string | undefined): string =>
  months ? ` in instalments: ${months} × ${plNum(monthly ?? '')} zł` : '';

export function simRules(sub: (pl: string) => string): Rule[] {
  return [
    // --- economy.ts: zdarzenia dnia ---
    { pl: 'Zaufanie Centrali: {}. {}', en: (label, flavor) => `Head Office’s trust: ${sub(label!)}. ${sub(flavor!)}` },
    { pl: 'Remont zakończony! Sklep otwarty, pachnie nową farbą i starym kurzem.', en: 'Refit finished! The shop is open again and smells of fresh paint and old dust.' },
    {
      pl: 'Półki i zaplecze pełne: załoga wciągnęła spod sklepu w przejścia {} {}. Klienci się potykają. Zamów mniej.',
      en: (n) => `Shelves and stockroom full: the crew dragged ${pallets(n!)} in from the pavement into the aisles. Customers are tripping over them. Order less.`,
    },
    { pl: '✨ Złota paleta rozładowana: +{} zł i +5 Ogonków!', en: (x) => `✨ Golden pallet unloaded: +${plNum(x!)} zł and +5 Ogonki!` },
    { pl: '✨ W dostawie jest ZŁOTA PALETA! Rozładuj ją po premię.', en: '✨ There’s a GOLDEN PALLET in the delivery! Unload it for a bonus.' },
    {
      pl: 'Zabrakło miejsca, {} {} w przejściach! Klienci się potykają i odchodzą, a reputacja spada, dopóki ich nie rozładujesz. Zamów mniej.',
      en: (n) => `Out of space: ${pallets(n!)} in the aisles! Customers trip over them and walk out, and your reputation drops until you unload them. Order less.`,
    },
    { pl: 'Dostawa: {} {} ({}).', en: (n, _w, where) => `Delivery: ${pallets(n!)} (${whereEn(where!)}).` },
    { pl: 'Remont trwa: Centrala wstrzymuje dostawy.', en: 'Refit under way: Head Office has put deliveries on hold.' },
    { pl: 'Limit kredytu kupieckiego! Centrala przycięła zamówienie do {} {}.', en: (n) => `Trade credit limit reached! Head Office cut your order to ${pallets(n!)}.` },
    { pl: 'Zamówienie na jutro: 0 palet. Zaplecze odetchnie.', en: 'Order for tomorrow: 0 pallets. The stockroom can breathe again.' },
    {
      pl: '{} {} {} na jutro{}.',
      re: /^(Asystent Traszki zamówił|Zamówienie ręczne:) (\S+) \S+ na jutro(?: \(opłata logistyczna (.+) zł\))?\.$/,
      en: (who, n, fee) => `${who === 'Zamówienie ręczne:' ? `Manual order: ${pallets(n!)} for tomorrow` : `The Traszka Assistant ordered ${pallets(n!)} for tomorrow`}`
        + `${fee ? ` (logistics fee ${plNum(fee)} zł)` : ''}.`,
    },
    { pl: 'Asystent Traszki zamówił', fragment: true },
    { pl: 'Zamówienie ręczne:', fragment: true },
    { pl: ' (opłata logistyczna {} zł)', fragment: true },
    {
      pl: 'Straż Miejska: upomnienie za {} pod sklepem. Przy następnym obchodzie mandat.',
      en: (what) => `City Wardens: a warning about ${what === 'paletę' ? 'a pallet' : pallets(what!.split(' ')[0]!)} on the pavement. Next round, it’s a fine.`,
    },
    { pl: 'paletę', fragment: true },
    { pl: 'paleta', fragment: true },
    { pl: 'palety', fragment: true },
    { pl: 'palet', fragment: true },
    {
      pl: 'Straż Miejska: mandat {} zł za palety na chodniku. „Pan tu nie jest w hurtowni”.',
      en: (x) => `City Wardens: a ${plNum(x!)} zł fine for pallets on the pavement. “This isn’t a warehouse, you know.”`,
    },
    {
      pl: 'Dzień zamknięty: {} klientów, obrót {} zł, wynik dnia {}{} zł.',
      en: (c, rev, sign, p) => `Day closed: ${plNum(c!)} customers, turnover ${plNum(rev!)} zł, day’s result ${sign}${plNum(p!)} zł.`,
    },
    {
      pl: 'KPI tygodnia trafione: {}. Wynik: {}. Premia {} zł, +{} XP, zaufanie Centrali {}.',
      en: (title, v, b, xp, trust) => `Weekly KPI hit: ${sub(title!)}. Result: ${plNum(v!)}. Bonus ${plNum(b!)} zł, +${plNum(xp!)} XP, Head Office’s trust ${trustDelta(trust!)}.`,
    },
    {
      pl: 'KPI tygodnia nietrafione: {}. Wynik: {}. Zaufanie Centrali {}.',
      en: (title, v, trust) => `Weekly KPI missed: ${sub(title!)}. Result: ${plNum(v!)}. Head Office’s trust ${trustDelta(trust!)}.`,
    },
    { pl: 'bez zmian', fragment: true },
    {
      pl: 'Przychód gwarantowany: Centrala nie dopłaci {} zł, bo {}. Regulamin, punkt 7.3.b, przypis drobnym drukiem.',
      en: (x, why) => {
        const m = /^zaufanie poniżej (.+)$/.exec(why!);
        const reason = why === 'w miesiącu był mandat' ? 'you got a fine this month' : m ? `your trust is below ${plNum(m[1]!)}` : why;
        return `Guaranteed income: Head Office won’t top you up by ${plNum(x!)} zł, because ${reason}. Rulebook, clause 7.3.b, footnote in small print.`;
      },
    },
    { pl: 'w miesiącu był mandat', fragment: true },
    { pl: 'zaufanie poniżej {}', fragment: true },
    {
      pl: 'Przychód gwarantowany: Centrala dopłaca {} zł do {} zł. „Wierzymy w Ciebie. Do odwołania.”',
      en: (a, b) => `Guaranteed income: Head Office tops you up by ${plNum(a!)} zł to ${plNum(b!)} zł. “We believe in you. Until further notice.”`,
    },
    { pl: 'Wyciąg od Centrali za {}: zostaje {}{} zł.', en: (label, sign, v) => `Head Office statement for ${monthLabel(label!)}: you keep ${sign}${plNum(v!)} zł.` },
    { pl: '{} {}', re: /^(styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień|wrzesień|październik|listopad|grudzień) (\d+)$/, en: (m, y) => monthLabel(`${m} ${y}`) },
    {
      pl: 'Centrala wypowiada umowę franczyzową: zaufanie spadło do zera. Dziękujemy za współpracę.',
      en: 'Head Office is terminating your franchise agreement: trust has fallen to zero. Thank you for your cooperation.',
    },
    // --- remanent (SIM 6) ---
    { pl: 'Centrala dziękuje za rzetelne liczenie. Rzetelność Centrali nie podlega liczeniu.', en: 'Head Office thanks you for counting so thoroughly. Head Office’s own thoroughness is not subject to counting.' },
    { pl: 'Towar nie ginie, tylko zmienia właściciela. Na Ciebie.', en: 'Stock never goes missing. It just changes owner. To you.' },
    { pl: 'Limit ubytków ustalono w trosce o Twoją motywację. Szczegóły w aneksie, którego jeszcze nie ma.', en: 'The shrinkage limit was set with your motivation in mind. Details in an annex that doesn’t exist yet.' },
    {
      pl: 'Remanent: ubytki {} zł, limit Centrali {} zł. Nadwyżka {} zł zejdzie z dzisiejszego przelewu. {}',
      en: (a, b, c, comment) => `Stocktake: shrinkage ${plNum(a!)} zł, Head Office’s limit ${plNum(b!)} zł. The excess of ${plNum(c!)} zł comes off today’s transfer. ${sub(comment!)}`,
    },
    {
      pl: 'Remanent: ubytki {} zł mieszczą się w limicie Centrali ({} zł). {}',
      en: (a, b, comment) => `Stocktake: shrinkage of ${plNum(a!)} zł is within Head Office’s limit (${plNum(b!)} zł). ${sub(comment!)}`,
    },
    // --- debet i koniec gry ---
    {
      pl: 'Gotówka {} zł. Do granicy debetu ({} zł) zostało {} zł: poniżej niej Centrala od razu wypowiada umowę.',
      en: (a, b, c) => `Cash ${plNum(a!)} zł. ${plNum(c!)} zł left before the debt limit (${plNum(b!)} zł): below it, Head Office terminates your agreement on the spot.`,
    },
    {
      pl: 'Gotówka {} zł, poniżej granicy debetu {} zł: Centrala wypowiada umowę franczyzową. Dziękujemy za współpracę.',
      en: (a, b) => `Cash ${plNum(a!)} zł, below the debt limit of ${plNum(b!)} zł: Head Office is terminating your franchise agreement. Thank you for your cooperation.`,
    },
    // --- cele ---
    { pl: '🏆 Cel osiągnięty: {}. Odbierz +{} Ogonków w zakładce Cele.', en: (label, r) => `🏆 Goal reached: ${sub(label!)}. Claim +${plNum(r!)} Ogonki in the Goals tab.` },
    { pl: 'Nie ma takiego celu.', en: 'No such goal.' },
    { pl: 'Ten cel jest już odebrany.', en: 'You’ve already claimed this goal.' },
    { pl: 'Ten cel jeszcze nie jest spełniony.', en: 'This goal isn’t complete yet.' },
    { pl: '🏆 {}: +{} Ogonków', en: (label, r) => `🏆 ${sub(label!)}: +${plNum(r!)} Ogonki` },
    // --- polecenia: palety, kasa, ludzie ---
    { pl: 'Brak palet do rozładunku.', en: 'No pallets to unload.' },
    { pl: 'Zaplecze i półki pełne: nie ma gdzie wyłożyć towaru.', en: 'Stockroom and shelves are full: there’s nowhere to put the stock.' },
    { pl: 'Ręce odmawiają.', en: 'Your hands refuse.' },
    { pl: 'Sklep zamknięty.', en: 'The shop is closed.' },
    { pl: 'Nikt nie czeka przy kasie.', en: 'Nobody is waiting at the till.' },
    { pl: 'Kasjer nadąża z kolejką.', en: 'The cashier is keeping up with the queue.' },
    { pl: 'Nie ma takiej palety.', en: 'No such pallet.' },
    { pl: 'Paleta już tam stoi.', en: 'The pallet is already there.' },
    { pl: 'W przejściach stawia tylko kierowca, kiedy brakuje miejsc.', en: 'Only the driver puts pallets in the aisles, when there’s no room left.' },
    { pl: '{}: brak miejsca.', en: (loc) => `${sub(loc!)}: no room.` },
    { pl: 'Więcej niż {} osób na zmianie się nie zmieści.', en: (x) => `You can’t fit more than ${plNum(x!)} people on a shift.` },
    { pl: 'Za mało gotówki na rekrutację.', en: 'Not enough cash to hire anyone.' },
    { pl: 'Ktoś musi stać na kasie.', en: 'Someone has to stay on the till.' },
    // --- zakupy, raty, remont ---
    { pl: 'Maksymalny poziom', en: 'Maximum level' },
    { pl: 'Odblokujesz na {}. poziomie albo po remoncie', en: (x) => `Unlocks at level ${plNum(x!)} or after a refit` },
    { pl: 'Odblokujesz na {}. poziomie', en: (x) => `Unlocks at level ${plNum(x!)}` },
    { pl: 'Wymaga remontu (poziom {})', en: (x) => `Requires a refit (level ${plNum(x!)})` },
    { pl: 'Wymaga kasy samoobsługowej', en: 'Requires a self-checkout' },
    { pl: 'Wymaga: {}', en: (name) => `Requires: ${sub(name!)}` },
    { pl: 'Za mało gotówki.', en: 'Not enough cash.' },
    { pl: 'Centrala nie finansuje zakupów przy tak niskim zaufaniu.', en: 'Head Office doesn’t finance purchases when your trust is this low.' },
    {
      pl: 'Rata {} zł przekracza wolny limit rat ({} z {} zł miesięcznie).',
      en: (a, b, c) => `An instalment of ${plNum(a!)} zł exceeds your free instalment limit (${plNum(b!)} of ${plNum(c!)} zł a month).`,
    },
    { pl: ' na raty: {} × {} zł', fragment: true },
    {
      pl: 'Kupione: {}{}',
      re: /^Kupione: (.+?)(?: na raty: (\d+) × (.+) zł)?$/,
      en: (name, months, monthly) => `Bought: ${sub(name!)}${ratyEn(months, monthly)}`,
    },
    { pl: 'Odblokujesz na {}. poziomie.', en: (x) => `Unlocks at level ${plNum(x!)}.` },
    { pl: 'Brak wolnego slotu 2×2. Remont da więcej miejsca.', en: 'No free 2×2 slot. A refit will give you more room.' },
    { pl: 'Brak wolnego slotu. Remont da więcej miejsca.', en: 'No free slot. A refit will give you more room.' },
    { pl: 'Większego sklepu już nie będzie. To jest Flagowiec.', en: 'The shop won’t get any bigger than this. This is the Flagship.' },
    { pl: 'Remont już trwa.', en: 'A refit is already under way.' },
    { pl: 'Remont odblokujesz na {}. poziomie.', en: (x) => `The refit unlocks at level ${plNum(x!)}.` },
    { pl: 'Za mało gotówki na remont.', en: 'Not enough cash for the refit.' },
    {
      pl: '{}: sklep zamknięty na {} {}.{}',
      re: /^(.+?): sklep zamknięty na (\d+) (?:dzień|dni)\.(?: na raty: (\d+) × (.+) zł)?$/,
      en: (name, days, months, monthly) => `${sub(name!)}: shop closed for ${days} ${enPlural(Number(days), 'day', 'days')}.`
        + `${months ? ` In instalments: ${months} × ${plNum(monthly ?? '')} zł` : ''}`,
    },
    { pl: 'dzień', fragment: true },
    { pl: 'Kampania kosztuje {} Ogonków.', en: (x) => `The campaign costs ${plNum(x!)} Ogonki.` },
    { pl: 'Kampania w Traszkapce: +30% klientów przez dobę!', en: 'Traszkapp campaign: +30% customers for 24 hours!' },
    { pl: 'Remont nie trwa.', en: 'There’s no refit under way.' },
    { pl: 'Przyspieszenie kosztuje {} Ogonków.', en: (x) => `Speeding it up costs ${plNum(x!)} Ogonki.` },
    { pl: 'Ekipa remontowa dostała premię w Ogonkach. Pracują szybciej (podobno).', en: 'The refit crew got a bonus in Ogonki. They’re working faster (apparently).' },
    { pl: 'Poziom {}! Nagroda: +{} zł i +{} Ogonków.', en: (lvl, c, o) => `Level ${plNum(lvl!)}! Reward: +${plNum(c!)} zł and +${plNum(o!)} Ogonki.` },
    // --- commands.ts, cards.ts, fatigue.ts, staff.ts, franchisee.ts ---
    { pl: 'Centrala nie przyjmuje zwrotów: każda paleta zostaje w sklepie.', en: 'Head Office doesn’t accept returns: every pallet stays in the shop.' },
    { pl: 'Najpierw karta na biurku.', en: 'Deal with the card on your desk first.' },
    { pl: 'Nieznane polecenie.', en: 'Unknown command.' },
    { pl: 'Gra skończona: Centrala wypowiedziała umowę.', en: 'Game over: Head Office has terminated your agreement.' },
    { pl: 'Tej karty już nie ma na biurku.', en: 'That card is no longer on your desk.' },
    { pl: 'Na tę kartę jeszcze za wcześnie.', en: 'It’s too early for that card.' },
    { pl: 'Nie ma takiej odpowiedzi.', en: 'No such answer.' },
    { pl: 'Ręce odmawiają. Franczyzobiorca też człowiek, nawet jeśli Centrala ma inne zdanie.', en: 'Your hands refuse. Franchisees are human too, whatever Head Office may think.' },
    { pl: 'Nie ma takiego profilu.', en: 'No such profile.' },
    { pl: 'Profil „{}”. {}', en: (label, hint) => `Profile “${sub(label!)}”. ${sub(hint!)}` },
    { pl: 'Kolejność musi zawierać każde z czterech zadań dokładnie raz.', en: 'The order must include each of the four tasks exactly once.' },
    { pl: 'Nie ma takiego zadania.', en: 'No such task.' },
    { pl: 'Podaj liczbę osób.', en: 'Enter a number of people.' },
    {
      pl: 'Na zmianie {}: więcej się nie przydzieli.',
      en: (who) => {
        const n = plValue(/(\d[\d\s ]*)/.exec(who!)?.[1] ?? '');
        return `There ${n === 1 ? 'is 1 person' : `are ${plNum(String(n))} people`} on shift: you can’t assign any more.`;
      },
    },
    { pl: 'jest 1 osoba', fragment: true },
    { pl: 'są {} osoby', fragment: true },
    { pl: 'jest {} osób', fragment: true },
    { pl: 'Raty', en: 'Instalments' },
    // --- kpi.ts: cel tygodnia (też wewnątrz zdania o rozliczeniu KPI) ---
    { pl: 'Sprzedaj {} kaw i hot-dogów do niedzieli', en: (x) => EN_KPI_TITLE.kawy(plNum(x!)) },
    { pl: 'Obsłuż {} klientów do niedzieli', en: (x) => EN_KPI_TITLE.klienci(plNum(x!)) },
    { pl: 'Do niedzieli najwyżej {} klientów odstraszonych kolejką', en: (x) => EN_KPI_TITLE.kolejka(plNum(x!)) },
    { pl: 'Średnia czystość sali co najmniej {}% do niedzieli', en: (x) => EN_KPI_TITLE.czystosc(plNum(x!)) },
    { pl: 'Tydzień bez mandatu: palety nie nocują na chodniku', en: EN_KPI_TITLE.bezMandatu('') },
    // --- report.ts: wskazówka raportu (interfejs bierze ją wprost z `EN_HINTS`; tu dla zdań, które przyszły jako gotowy tekst) ---
    { pl: 'Mandaty kosztowały {} zł. Rano ustaw profil „Dostawa”, żeby palety nie stały na chodniku po godzinie tolerancji.', en: (v) => EN_HINTS.mandaty(plNum(v!)) },
    { pl: 'Remanent: ubytki ponad limit Centrali {} zł. Zamawiaj tyle, ile schodzi, a o 18:00 przeceniaj kanapki (FEFO), zanim trafią do kosza.', en: (v) => EN_HINTS.wut(plNum(v!)) },
    { pl: 'Palety ponad darmowe: {} zł potrącone z przelewu. Asystent przesadza z zamówieniem; spróbuj zamawiać ręcznie.', en: (v) => EN_HINTS.logistyka(plNum(v!)) },
    { pl: 'Kolejka odstraszyła {} klientów. W szczycie ustaw profil „Kolejka” albo postaw kasę samoobsługową.', en: (v) => EN_HINTS.kolejka(plNum(v!)) },
    {
      pl: 'Średnia czystość sali: {}%. Ustaw profil „Porządek” albo przypnij kogoś do sprzątania, zanim przyjdzie audyt albo tajemniczy klient.',
      en: (v) => EN_HINTS.czystosc(plNum(v!)),
    },
    { pl: 'Ludzie stali bez zadania przez {} godz. Może jedna osoba mniej na zmianie?', en: (v) => EN_HINTS.bezczynnosc(plNum(v!)) },
    { pl: 'Zadania czekały na ludzi przez {} godz. Zatrudnij kogoś albo kup automatykę z warsztatu.', en: (v) => EN_HINTS.braki(plNum(v!)) },
    { pl: 'Ręce odmówiły posłuszeństwa w {} dni. Noc odnawia tylko część sił: odpuść stukanie choć dzień w tygodniu.', en: (v) => EN_HINTS.zmeczenie(plNum(v!)) },
    { pl: 'Zaufanie Centrali spadło o {} pkt. KPI tygodnia i odpowiedzi na okólniki to najtańszy sposób, żeby je odbudować.', en: (v) => EN_HINTS.zaufanie(plNum(v!)) },
    { pl: '{} razy zatwierdzona odpowiedź zaznaczona z góry. Rzadko jest najlepsza: przeczytaj kartę, zanim klikniesz.', en: (v) => EN_HINTS.karty(plNum(v!)) },
    { pl: 'Nietrafione KPI tygodnia: {}. Sprawdzaj cel w poniedziałek, zanim tydzień ucieknie.', en: (v) => EN_HINTS.kpi(plNum(v!)) },
    { pl: 'Wszystko gra. Centrala i tak podniesie KPI, ale to już jej problem.', en: EN_HINTS.brawo('') },
  ];
}

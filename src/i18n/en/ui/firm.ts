import type { Dict, Plurals } from '../ui';

/*
 * Teksty firmy po angielsku (`ui/city/firmText.ts`): adres lokalu, nazwy zdarzeń Centrali (status Partnera, budowa, otwarcie, zastępca,
 * wypowiedzenie, rozliczenie końcowe, zamknięcie, debet, koniec współpracy) i odmowy poleceń firmy; do tego chip sklepów z listą i skrzynką
 * zastępcy (`StoreSwitcher.tsx`) oraz okno końca miesiąca w kilku sklepach (`NetworkReport.tsx`). Symulacja nie zna tych zdań:
 * niesie identyfikatory i parametry (spec §18). Ton jak w `docs/i18n/glossary-en.md`: Head Office, „branch” dla placówki.
 */

export const FIRM_UI: Dict = {
  // stan sklepu na liście (`storeStateText`) i w sieci w Celach
  'zamknięta': 'closed',
  'umowa wygasa {0}': 'agreement ends {0}',
  'aktywna': 'active',
  'w tle': 'in the background',
  // adres: numer przed ulicą i „St.”; ulica to nazwa własna i zostaje po polsku
  'ul. {0} {1}': (street: string, n: number) => `${n} ${street} St.`,
  // status Partnera Strategicznego (§10.1)
  'Status Partnera Strategicznego': 'Strategic Partner status',
  'Po wnikliwej analizie i z pewnymi oporami nadajemy Panu/Pani status Partnera Strategicznego.':
    'After careful analysis, and with some reluctance, we hereby grant you Strategic Partner status.',
  'Wolne lokale czekają w zakładce Miasto. Prosimy nie traktować tego jako zachęty.':
    'Free premises are waiting in the City tab. Please do not take this as encouragement.',
  // budowa i otwarcie (§10.4)
  'Budowa lokalu': 'Premises under construction',
  'Pakiet otwarcia zapłacony z gotówki: {0}. Lokal przy {1} jest w budowie. Otwarcie: {2}.':
    'Opening package paid in cash: {0}. The unit at {1} is under construction. Opening: {2}.',
  'Pakiet otwarcia na raty: {0}. Lokal przy {1} jest w budowie. Otwarcie: {2}.':
    'Opening package in instalments: {0}. The unit at {1} is under construction. Opening: {2}.',
  'Traszka #{0} otwarta': 'Traszka #{0} is open',
  '{0} przyjmuje pierwszych klientów ({1}). Przełączysz się na nią w górnym pasku. Sklep w tle pracuje sam, a jego karty rozstrzyga zastępca.':
    '{0} is serving its first customers ({1}). Switch to it in the top bar. A shop in the background runs on its own, and your deputy settles its cards.',
  // ponowne otwarcie lokalu „po Traszce” (§13.3, 4a.2): wyposażenie zostało, Centrala zaczyna znajomość od nowa
  'Traszka #{0} znów otwarta': 'Traszka #{0} is open again',
  '{0} znów przyjmuje klientów ({1}). Wyposażenie zostało, ale Centrala zaczyna znajomość od nowa: poziom 1, zaufanie {2}.':
    '{0} is serving customers again ({1}). The fittings stayed, but Head Office is starting the relationship afresh: level 1, trust {2}.',
  // zastępca (§12)
  'Zastępca': 'Deputy',
  '{0}: zastępca wybrał: {1}': '{0}: the deputy chose: {1}',
  'odpowiedź {0}': 'answer {0}',
  // wypowiedzenie, rozliczenie końcowe i zamknięcie (§13)
  'Wypowiedzenie umowy': 'Notice of termination',
  'Umowa {0} wygasa {1}. Do tego dnia sklep działa normalnie, ale Centrala nie finansuje w nim nowych rat. Potem następuje rozliczenie końcowe.':
    'The agreement for {0} ends on {1}. Until then the shop runs as usual, but Head Office will not finance new instalments there. A final settlement follows.',
  'Rozliczenie końcowe: {0}': 'Final settlement: {0}',
  'Ubytki od ostatniego remanentu: {0}, limit Centrali {1}, do zapłaty {2}.':
    'Shrinkage since the last stocktake: {0}, Head Office’s limit {1}, to pay {2}.',
  'Niespłacone raty: {0}.': 'Unpaid instalments: {0}.',
  'Nadwyżka czekająca na przelew: {0}.': 'Excess waiting for the transfer: {0}.',
  'Z gotówki zeszło razem {0}.': 'In total {0} came out of your cash.',
  'Umowa zakończona: {0}': 'Agreement ended: {0}',
  'Umowa {0} wygasła. Lokal wraca na mapę jako „po Traszce”, z wyposażeniem. Pozostałe placówki działają dalej.':
    'The agreement for {0} has expired. The unit goes back on the map as “ex-Traszka”, fittings included. Your other branches carry on.',
  'Zaufanie Centrali do {0} spadło do zera, więc Centrala wypowiedziała umowę. Lokal wraca na mapę jako „po Traszce”, z wyposażeniem. Pozostałe placówki działają dalej.':
    'Head Office’s trust in {0} has fallen to zero, so Head Office has terminated the agreement. The unit goes back on the map as “ex-Traszka”, fittings included. Your other branches carry on.',
  'Umowa ostatniej placówki wygasła. Centrala dziękuje za współpracę.':
    'The agreement for your last branch has expired. Head Office thanks you for your cooperation.',
  // debet całej gotówki (§11.4)
  'Gotówka {0}, poniżej granicy debetu {1}: Centrala wypowiada umowy wszystkim placówkom. Dziękujemy za współpracę.':
    'Cash {0}, below the debt limit of {1}: Head Office is terminating the agreements for all your branches. Thank you for your cooperation.',
  'Podsumowanie sieci': 'Network summary',
  'Zdarzenie firmy': 'Firm event',
  // etap 4b: kolejna placówka z obrotu sieci, badania Sieci, cele sieci i pierwszy milion (teksty na start)
  'Kolejna placówka': 'Another branch',
  'Centrala zgadza się na czwartą placówkę. Obrót sieci {0} przekonał Dział Ekspansji, który zaraz potem wyszedł na lunch.':
    'Head Office agrees to a fourth branch. A network turnover of {0} convinced the Expansion Department, which promptly went to lunch.',
  'Centrala zgadza się na piątą placówkę. Obrót sieci {0} przekonał Dział Ekspansji, który zaraz potem wyszedł na lunch.':
    'Head Office agrees to a fifth branch. A network turnover of {0} convinced the Expansion Department, which promptly went to lunch.',
  // badania Sieci (4b §5.3): nazwy, efekty i teksty z tabeli `RESEARCH` (sim/firm/research.ts); UI podaje je do `tr`
  'Wspólne dostawy': 'Shared deliveries',
  'Niższa opłata za palety ponad przydział we wszystkich sklepach': 'A lower fee for pallets over the free allowance in every shop',
  'Jeden kierowca, pięć sklepów i ani jednej palety więcej, niż trzeba. Centrala dziwi się, że to w ogóle możliwe.':
    'One driver, five shops and not a single pallet more than needed. Head Office is amazed that this is even possible.',
  'Wspólna obsada (grafik sieci)': 'Shared staffing (network rota)',
  'Niższe płace dnia we wszystkich sklepach': 'Lower daily wages in every shop',
  'Grafik sieci przesuwa ludzi tam, gdzie akurat brakuje rąk. Ludzie dowiadują się o tym w drodze do pracy.':
    'The network rota moves people to wherever hands are short. They find out on the way to work.',
  'Wspólny marketing': 'Shared marketing',
  'Więcej klientów we wszystkich sklepach': 'More customers in every shop',
  'Jedna ulotka na pięć sklepów, bo drukarnia daje rabat od nakładu. Hasło brzmi: „Traszka jest wszędzie”.':
    'One flyer for five shops, because the printer gives a discount on volume. The slogan: “Traszka is everywhere”.',
  'Centralny magazyn': 'Central warehouse',
  'Większe zaplecze we wszystkich sklepach': 'A bigger back room in every shop',
  'To, co nie zmieściło się na zapleczu, leży teraz w hali na obrzeżach miasta. Nikt nie wie, gdzie dokładnie.':
    'Whatever did not fit in the back room now sits in a hall on the edge of town. Nobody knows exactly where.',
  'Program lojalnościowy „Traszka+”': 'Loyalty scheme “Traszka+”',
  'Większy koszyk: obrót i marża z klienta we wszystkich sklepach': 'A bigger basket: turnover and margin per customer in every shop',
  'Każdy zakup to punkt, a punkty wymienia się na kolejne zakupy. Centrala nazywa to „mechaniką zaangażowania”.':
    'Every purchase is a point, and points are exchanged for further purchases. Head Office calls this “engagement mechanics”.',
  'Grupa zakupowa prądu': 'Electricity buying group',
  'Niższe rachunki za media we wszystkich sklepach': 'Lower utility bills in every shop',
  'Jeden sklep nie ma siły przebicia u dostawcy prądu, pięć już się liczy. Dostawca też liczy, tylko inaczej.':
    'One shop has no clout with the electricity supplier; five do. The supplier counts too, just differently.',
  // cele firmy (4b §5.6): nazwy i podpowiedzi z tabeli `FIRM_GOALS` (sim/firm/goals.ts); UI podaje je do `tr`
  'Ćwierć bańki na koncie': 'A quarter of a million in the bank',
  'Miej na koncie 250 000 zł': 'Hold 250,000 zł in your account',
  'Pół bańki': 'Half a million',
  'Miej na koncie 500 000 zł': 'Hold 500,000 zł in your account',
  'Milioner spod znaku Traszki': 'A Traszka-branded millionaire',
  'Miej na koncie 1 000 000 zł': 'Hold 1,000,000 zł in your account',
  'Dwa miliony (Centrala pyta, czy nie za dużo)': 'Two million (Head Office asks whether that is a bit much)',
  'Miej na koncie 2 000 000 zł': 'Hold 2,000,000 zł in your account',
  'Trzy placówki': 'Three branches',
  'Miej jednocześnie trzy otwarte sklepy': 'Have three shops open at the same time',
  'Czwarta placówka': 'A fourth branch',
  'Miej jednocześnie cztery otwarte sklepy': 'Have four shops open at the same time',
  'Sieć pełna: pięć Traszek': 'A full network: five Traszkas',
  'Miej jednocześnie pięć otwartych sklepów': 'Have five shops open at the same time',
  'Pierwsze badanie Sieci': 'First network research',
  'Kup dowolne badanie Sieci w panelu Miasto': 'Buy any network research in the City panel',
  'Dziesięć poziomów badań': 'Ten levels of research',
  'Kup łącznie dziesięć poziomów badań Sieci': 'Buy ten levels of network research in total',
  'Wszystkie badania Sieci': 'All network research',
  'Kup każde badanie Sieci przynajmniej raz': 'Buy every network research at least once',
  'Badania Sieci': 'Network research',
  'Badanie Sieci na poziomie {0}. Centrala pobrała {1}.': 'Network research at level {0}. Head Office has taken {1}.',
  'Cel sieci': 'Network goal',
  'Cel sieci spełniony. Nagroda czeka na odbiór w Celach.': 'Network goal reached. The reward is waiting for you in Goals.',
  'Cel sieci spełniony: {0}. Nagroda czeka na odbiór w Celach.': 'Network goal reached: {0}. The reward is waiting for you in Goals.',
  'Cele sieci do odebrania: {0}. Nagrody czekają w Celach.': 'Network goals ready to claim: {0}. The rewards are waiting for you in Goals.',
  '{0}: poziom {1}. Centrala pobrała {2}, w tym opłatę koordynacyjną {3}.': '{0}: level {1}. Head Office has taken {2}, including a coordination fee of {3}.',
  // limit placówek: ile obrotu sieci odblokuje kolejną (`limitText`) i panel badań Sieci (`ResearchSection.tsx`)
  'Pięć placówek to wszystko, na co Centrala jest gotowa się zgodzić w tym mieście.': 'Five branches is all Head Office is prepared to agree to in this city.',
  'Centrala zgodzi się na kolejną placówkę, gdy obrót sieci w miesiącu przekroczy {0}.': 'Head Office will agree to another branch once the network’s monthly turnover exceeds {0}.',
  'Centrala nie zgadza się teraz na kolejną placówkę. Limit rośnie wraz z obrotem sieci.': 'Head Office will not agree to another branch right now. The limit grows with the network’s turnover.',
  'Sieć: badania': 'Network: research',
  'poziomy {0}/{1}': 'levels {0}/{1}',
  'Badania działają we wszystkich sklepach naraz, ale dopiero od dwóch otwartych. Płacisz gotówką z portfela, poziom zostaje na zawsze, a im więcej sklepów, tym mocniejszy efekt.':
    'Research works in every shop at once, but only from two open shops up. You pay cash from your wallet, a level stays for good, and the more shops you have, the stronger the effect.',
  'Działa od 2 sklepów': 'Works from 2 shops',
  'Za mało gotówki na badanie: po zapłacie musi zostać co najmniej 0 zł.': 'Not enough cash for this research: at least 0 zł must be left after you pay.',
  'Teraz: {0}': 'Now: {0}',
  'Kolejny poziom: {0}': 'Next level: {0}',
  'w tym opłata koordynacyjna Centrali: {0}': 'including Head Office’s coordination fee: {0}',
  'Najwyższy poziom': 'Top level',
  'Kup: {0}, poziom {1}': 'Buy: {0}, level {1}',
  'ruch {0}': 'footfall {0}',
  'koszyk {0}': 'basket {0}',
  'płace {0}': 'wages {0}',
  'media {0}': 'utilities {0}',
  'opłata za palety {0}': 'pallet fee {0}',
  'zaplecze {0}': 'back room {0}',
  'Milion!': 'A million!',
  'Centrala jest w szoku, księgowa w euforii.': 'Head Office is in shock, the accountant in raptures.',
  // odmowy poleceń firmy (§10.1, §10.2, §10.3)
  'W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.':
    'During a ranked season Head Office reviews a single branch. Please come back after the season.',
  'Centrala rozważy kolejną placówkę, gdy nada Panu/Pani status Partnera Strategicznego.':
    'Head Office will consider another branch once it has granted you Strategic Partner status.',
  'Ten lokal nie jest do wzięcia.': 'This unit is not available.',
  'Po zapłaceniu pakietu gotówka musi zostać nie mniejsza od zera: Centrala nie finansuje budów na debecie.':
    'After you pay the package your cash must not drop below zero: Head Office does not finance fit-outs on overdraft.',
  'Rata pakietu przekracza limit rat nowej placówki. Prosimy o gotówkę albo o tańszy lokal.':
    'The package instalment is over the new branch’s instalment limit. Please pay in cash or choose a cheaper unit.',
  'Nie ma takiej placówki albo już nie działa.': 'There is no such branch, or it has stopped trading.',
  'Centrala nie przyjmie wypowiedzenia, jeśli nie zostaje inna działająca placówka.':
    'Head Office will not accept a notice if no other branch is left trading.',
  'Gra skończona: Centrala wypowiedziała umowę.': 'Game over: Head Office has terminated your agreement.',
  'Badania Sieci działają od dwóch placówek. Jeden sklep to dla Centrali jeszcze nie sieć.':
    'Network research works from two branches up. To Head Office, one shop is not a network yet.',
  'To badanie jest już na najwyższym poziomie. Centrala nie ma czego więcej badać.':
    'This research is already at the top level. Head Office has nothing left to research.',
  'Tego celu nie da się teraz odebrać.': 'This goal cannot be claimed right now.',
  'Centrala odmawia.': 'Head Office declines.',
  // dodatkowy sklep nie ma gwarancji (§11.2): tekst Centrali w wyciągu i w podglądzie miesiąca
  'Gwarancja przysługuje nowym partnerom. Pan/Pani jest już strategiczny/a.':
    'The guarantee is reserved for new partners. You are already a Strategic Partner.',
  // chip sklepów w pasku, lista sklepów i skrzynka zastępcy (`ui/city/StoreSwitcher.tsx`)
  'Przełącz sklep': 'Switch shop',
  'Sklep w tle wymaga uwagi': 'A shop in the background needs attention',
  'Sklepy': 'Shops',
  'Dziś {0}': 'Today {0}',
  'Zostanie {0}': 'You’ll keep {0}',
  'paleta w przejściu': 'pallet in the aisle',
  'pusta półka': 'empty shelf',
  'zastępca odpowiedział na kartę': 'the deputy answered a card',
  'zaufanie {0} ({1})': 'trust {0} ({1})',
  'Skrzynka zastępcy': 'Deputy’s inbox',
  'Zastępca jeszcze niczego nie rozstrzygał.': 'The deputy has not settled anything yet.',
  // okno końca miesiąca w kilku sklepach i wiersz sieci z poprzednich gier (`NetworkReport.tsx`, `storeSwitcherModel.ts`)
  'Sieć': 'Network',
  'Pakiety otwarcia i badania za gotówkę': 'Opening packages and research paid in cash',
  'Rozliczenie końcowe zamkniętej placówki': 'Final settlement for the closed branch',
  'Z poprzednich gier: {0} {1}, {2} dziennie, {3} {4}': (n: number, shops: string, income: string, p: number, points: string) =>
    `From previous games: ${n} ${shops}, ${income} a day, ${p} ${points}`,
};

export const FIRM_PLURALS: Plurals = {
  'sklep|sklepy|sklepów': ['shop', 'shops'],
  'Punkt Partnera|Punkty Partnera|Punktów Partnera': ['Partner Point', 'Partner Points'],
};

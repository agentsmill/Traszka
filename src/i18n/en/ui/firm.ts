import type { Dict, Plurals } from '../ui';

/*
 * Teksty firmy po angielsku (`ui/city/firmText.ts`): adres lokalu, nazwy zdarzeń Centrali (status Partnera, budowa, otwarcie, zastępca,
 * wypowiedzenie, rozliczenie końcowe, zamknięcie, debet, koniec współpracy) i odmowy poleceń firmy. Symulacja nie zna tych zdań:
 * niesie identyfikatory i parametry (spec §18). Ton jak w `docs/i18n/glossary-en.md`: Head Office, „branch” dla placówki.
 */

export const FIRM_UI: Dict = {
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
  // odmowy poleceń firmy (§10.1, §10.2, §10.3)
  'W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.':
    'During a ranked season Head Office reviews a single branch. Please come back after the season.',
  'Centrala rozważy kolejną placówkę, gdy nada Panu/Pani status Partnera Strategicznego.':
    'Head Office will consider another branch once it has granted you Strategic Partner status.',
  'Dwie placówki to na tym etapie partnerstwa wszystko, na co Centrala jest gotowa się zgodzić.':
    'Two branches is, at this stage of the partnership, all Head Office is prepared to agree to.',
  'Ten lokal nie jest do wzięcia.': 'This unit is not available.',
  'Po zapłaceniu pakietu gotówka musi zostać nie mniejsza od zera: Centrala nie finansuje budów na debecie.':
    'After you pay the package your cash must not drop below zero: Head Office does not finance fit-outs on overdraft.',
  'Rata pakietu przekracza limit rat nowej placówki. Prosimy o gotówkę albo o tańszy lokal.':
    'The package instalment is over the new branch’s instalment limit. Please pay in cash or choose a cheaper unit.',
  'Nie ma takiej placówki albo już nie działa.': 'There is no such branch, or it has stopped trading.',
  'Centrala nie przyjmie wypowiedzenia, jeśli nie zostaje inna działająca placówka.':
    'Head Office will not accept a notice if no other branch is left trading.',
  'Gra skończona: Centrala wypowiedziała umowę.': 'Game over: Head Office has terminated your agreement.',
  'Centrala odmawia.': 'Head Office declines.',
};

export const FIRM_PLURALS: Plurals = {};

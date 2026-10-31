/*
 * Napisy w scenie 3D po angielsku: plakaty Centrali, mata przy wejściu, tabliczki, hasła na pasie marki, gazety, potykacz, szyldy
 * na fasadach i tabliczki przy meblach (`plateTexture`). Kluczem jest polski napis z `src/render`. Marka (TRASZKA, SZOP 24h, SCO,
 * ceny) zostaje bez zmian i nie ma tu wpisu. Potykacz ma kilka wierszy: klucz i wartość to wiersze sklejone znakiem `|`.
 * Napisy są na teksturach z płótna, więc wymiana języka w trakcie gry przeładowuje stronę (`setLanguage` w ⚙).
 */

export const EN_RENDER: Record<string, string> = {
  // plakaty Centrali (props.ts)
  'KPI to stan umysłu.': 'KPIs are a state of mind.',
  '— Centrala': '— Head Office',
  'Promocja: 3 w cenie 3!': 'Special offer: pay 3, get 3!',
  'Tylko w Traszce': 'Only at Traszka',
  'Nadgodziny budują charakter.': 'Overtime builds character.',
  'Ogonki: chrupią, więc zdrowe.': 'Ogonki: crunchy, so healthy.',
  'Ogonki. Chrup i wróć': 'Ogonki. Crunch and come back',
  'Uśmiech to też procedura.': 'Smiling is a procedure too.',
  '— Dział Procedur': '— Procedures Dept.',
  'Nowy regulamin! Stary też obowiązuje.': 'New rulebook! The old one still applies.',
  // mata i tabliczka zaplecza
  'WITAMY': 'WELCOME',
  'W TRASZCE': 'TO TRASZKA',
  'Centrala widzi, że wchodzisz': 'Head Office sees you come in',
  '(i liczy to jako wizytę)': '(and counts it as a visit)',
  'TYLKO DLA': 'STAFF',
  'PERSONELU': 'ONLY',
  'i dla kontroli z Centrali': 'and Head Office inspectors',
  // hasła na pasie marki
  'CENTRALA CZUWA 24/7 (W GODZ. 9–15)': 'HEAD OFFICE IS WATCHING 24/7 (9:00–15:00)',
  'KPI TO STAN UMYSŁU': 'KPIs ARE A STATE OF MIND',
  'NOWOŚĆ! STARA CENA W NOWYM KOLORZE': 'NEW! OLD PRICE IN A NEW COLOUR',
  'CENTRALA: BLISKO TABELKI': 'HEAD OFFICE: CLOSE TO THE SPREADSHEET',
  'PROMOCJA: 3 W CENIE 3!': 'OFFER: PAY 3, GET 3!',
  'TU MIAŁA BYĆ PODWYŻKA': 'YOUR PAY RISE WAS MEANT TO GO HERE',
  'OGONKI: TERAZ 10% WIĘCEJ OGONKA': 'OGONKI: NOW WITH 10% MORE TAIL',
  'ZAWSZE OTWARTE. JAK PROCEDURY': 'ALWAYS OPEN. LIKE AN INVESTIGATION',
  // gazety
  'GŁOS OSIEDLA': 'ESTATE VOICE',
  'CENTRALA: REKORDOWY KWARTAŁ': 'HEAD OFFICE: RECORD QUARTER',
  'KURIER': 'COURIER',
  'OGONKI DROŻSZE O 0,01': 'OGONKI UP BY 0.01',
  'PLOTKA DNIA': 'DAILY GOSSIP',
  'NAUKOWCY: PONIEDZIAŁEK ISTNIEJE': 'SCIENTISTS: MONDAY IS REAL',
  // potykacz (wiersze sklejone `|`)
  'HOT-DOG|DNIA:|TEN SAM|CO WCZORAJ': 'HOT DOG|OF THE DAY:|SAME AS|YESTERDAY',
  'OTWARTE!|CENTRALA|KAZAŁA': 'OPEN!|HEAD OFFICE|SAID SO',
  'KAWA|+ DROŻDŻÓWKA|= SENS|ŻYCIA': 'COFFEE|+ A BUN|= THE MEANING|OF LIFE',
  'DZIŚ|PROMOCJA:|3 W CENIE 3': 'TODAY|OFFER:|PAY 3,|GET 3',
  // gwiazda promocji w witrynie (shell.ts)
  '3 W CENIE 3!': 'PAY 3 GET 3!',
  'PROMOCJA': 'SPECIAL OFFER',
  // fasady sąsiednich budynków (facadeAtlas.ts)
  'CENTRALA': 'HEAD OFFICE',
  'MYŚLI ZA CIEBIE': 'THINKS FOR YOU',
  'Ty tylko uzupełnij tabelkę.': 'You just fill in the spreadsheet.',
  'TRASZKA · ZAWSZE BLISKO': 'TRASZKA · ALWAYS NEARBY',
  'OTWARTE, GDY TRASZKA ŚPI': 'OPEN WHILE TRASZKA SLEEPS',
  '* Traszka nie śpi. Sprawdzaliśmy.': '* Traszka never sleeps. We checked.',
  // kartka w witrynie lokalu do wynajęcia obok sklepu (facadeAtlas.ts: komórka 'witrynaWynajem'): „DO” nad „WYNAJĘCIA”, po angielsku „TO” nad „LET”
  'DO': 'TO',
  'WYNAJĘCIA': 'LET',
  'pytać w Centrali': 'ask Head Office',
  // tabliczki przy meblach (plateTexture) i nadstawki kategorii (CATEGORY_LABEL)
  'SAMOOBSŁUGA': 'SELF-CHECKOUT',
  'TRASZDOG 4,99': 'TRASZDOG 4.99',
  'Kawa 3 zł\nKubek 4 zł': 'Coffee 3 zł\nCup 4 zł',
  'PROSIMY O DOWÓD\nI CIERPLIWOŚĆ': 'ID AND PATIENCE\nPLEASE',
  'ZAPLECZE\nPremii tu nie ma': 'STOCKROOM\nNo bonuses in here',
  'BANKOMAT': 'CASH MACHINE',
  'PACZKOWNIK 24h': 'PARCEL LOCKER 24h',
  'PIZZA Z PIECA': 'OVEN-BAKED PIZZA',
  'Reklamówka 0,20 zł\nCentrala dziękuje': 'Carrier bag 0.20 zł\nHead Office thanks you',
  'NAPOJE': 'DRINKS',
  'NABIAŁ': 'DAIRY',
  'SŁODYCZE': 'SWEETS',
  'PRZEKĄSKI': 'SNACKS',
  'PIECZYWO': 'BREAD',
  'CHEMIA': 'HOUSEHOLD',
  'ALKOHOL': 'ALCOHOL',
  // nad kasą w świecie (scene.ts: sklep zamknięty)
  'REMONT': 'REFIT',
  'ZAMKNIĘTE': 'CLOSED',
};

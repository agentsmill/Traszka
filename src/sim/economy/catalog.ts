/**
 * Liczby ekonomii jednego sklepu (spec §6–§8, uproszczone). Wszystko w złotówkach, sztukach i minutach gry.
 * Rzędy wielkości z §7.1: obrót ~150–300 tys. zł/mies., przychód franczyzobiorcy to marża od sprzedaży.
 */

/** Kategorie towaru: te same, co na nadstawkach regałów (render/store/parts.ts), więc półki w 3D pokazują stan zapasu. */
export type Cat = 'napoje' | 'nabial' | 'slodycze' | 'przekaski' | 'pieczywo' | 'chemia' | 'alkohol';
export const CATS: readonly Cat[] = ['napoje', 'nabial', 'slodycze', 'przekaski', 'pieczywo', 'chemia', 'alkohol'];

export interface CatInfo {
  label: string;
  /** Średnia cena sztuki (zł). */
  price: number;
  /**
   * Marża franczyzobiorcy (udział w cenie), już po udziale Centrali: od SIM_VERSION 6 nie ma osobnej opłaty franczyzowej, a stawki
   * są o 1/5 niższe niż marża sklepu z SIM 5 (ok. 15,3% obrotu zamiast 19,1%). Z premiami daje to przelew ok. 16,5–16,7% obrotu.
   */
  margin: number;
  /** Udział w koszyku (sztuki). Suma = 1. */
  basket: number;
  /** Udział w pojemności lodówek i regałów (suma w każdej kolumnie = 1). */
  fridge: number;
  dry: number;
}

export const CAT_INFO: Record<Cat, CatInfo> = {
  napoje:    { label: 'Napoje',    price: 5.2,  margin: 0.136, basket: 0.26, fridge: 0.6, dry: 0.15 },
  nabial:    { label: 'Nabiał',    price: 4.6,  margin: 0.12,  basket: 0.12, fridge: 0.4, dry: 0 },
  slodycze:  { label: 'Słodycze',  price: 4.1,  margin: 0.176, basket: 0.15, fridge: 0,   dry: 0.2 },
  przekaski: { label: 'Przekąski', price: 6.3,  margin: 0.168, basket: 0.15, fridge: 0,   dry: 0.2 },
  pieczywo:  { label: 'Pieczywo',  price: 3.6,  margin: 0.16,  basket: 0.14, fridge: 0,   dry: 0.15 },
  chemia:    { label: 'Chemia',    price: 9.5,  margin: 0.16,  basket: 0.05, fridge: 0,   dry: 0.1 },
  alkohol:   { label: 'Alkohol',   price: 11.8, margin: 0.096, basket: 0.13, fridge: 0,   dry: 0.2 },
};

/** Sztuk w koszyku przeciętnego klienta. */
export const ITEMS_PER_CUSTOMER = 3.4;

/** Hot-dog albo kawa „przy okazji”: szansa na klienta, cena i marża. Bez zapasu (strefa hot jest w każdym sklepie). */
export const HOT = { chance: 0.18, price: 8.5, margin: 0.36 } as const;

/**
 * Przeciętny klient w złotówkach (jedno miejsce, z którego liczą ekonomia, karty, KPI i makieta): koszyk z półek (sztuki
 * z `ITEMS_PER_CUSTOMER` w proporcjach `basket`) i strefa hot. Marża to przychód franczyzobiorcy, obrót to wartość sprzedanego towaru.
 */
export const SHELF_MARGIN_PER_CUSTOMER = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].margin * CAT_INFO[c].basket, 0) * ITEMS_PER_CUSTOMER;
export const SHELF_REVENUE_PER_CUSTOMER = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].basket, 0) * ITEMS_PER_CUSTOMER;
export const HOT_MARGIN_PER_CUSTOMER = HOT.chance * HOT.price * HOT.margin;
export const HOT_REVENUE_PER_CUSTOMER = HOT.chance * HOT.price;
export const MARGIN_PER_CUSTOMER = SHELF_MARGIN_PER_CUSTOMER + HOT_MARGIN_PER_CUSTOMER;
export const REVENUE_PER_CUSTOMER = SHELF_REVENUE_PER_CUSTOMER + HOT_REVENUE_PER_CUSTOMER;

/** Pojemność mebli (sztuk na kratkę obrysu) i zaplecza (sztuk na kratkę podłogi zaplecza). */
export const CAPACITY = { gondola: 36, wallShelf: 45, fridge: 35, backroom: 18 } as const;

/**
 * Sztuk na palecie. 480 od SIM_VERSION 5 (dawniej 320): ten sam towar przychodzi na mniejszej liczbie palet, ok. 3,5–4,5 dziennie
 * zamiast 5–7 (decyzja właściciela z 30.10.2026: „Palety są za często”). Stałe liczone na paletę (opłata, mandat, złota paleta,
 * XP, worki) są przeskalowane razem z nią, więc na sztukę towaru kosztują i dają tyle samo co wcześniej.
 */
export const PALLET_ITEMS = 480;

// --- Czas ------------------------------------------------------------------------------------------

export const MINUTES_PER_DAY = 24 * 60;
export const OPEN_FROM = 6 * 60;
export const OPEN_TO = 23 * 60;
/**
 * Minuty gry na sekundę przy ×1: dzień sklepu (17 h) w 2 min 50 s, noc (7 h) w 30 s, doba w ~3 min 20 s (decyzja
 * właściciela z 29.10.2026: kalendarz nie pędzi w późne lata). Noc 30 s czasu widoku przy każdej prędkości (widok ludzi
 * dostaje czas razy prędkość), więc zmiana zdąża wyjść na chodnik, zanim sklep znów się otworzy.
 */
export const MINUTES_PER_SECOND_OPEN = 6;
export const MINUTES_PER_SECOND_CLOSED = 14;
export const ORDER_DEADLINE = 11 * 60;
export const DELIVERY_AT = 7 * 60;
export const DELIVERY_AT_NIGHT = 5 * 60;
export const DELIVERY_AT_AFTERNOON = 15 * 60;

/** Natężenie ruchu wg godziny (6:00–22:00), 1 = typowa godzina. Szczyty: rano do pracy, popołudnie, wieczór. */
export const HOUR_CURVE: Record<number, number> = {
  6: 0.5, 7: 1.1, 8: 1.3, 9: 0.9, 10: 0.7, 11: 0.7, 12: 0.9, 13: 0.9, 14: 0.8,
  15: 0.9, 16: 1.1, 17: 1.3, 18: 1.3, 19: 1.1, 20: 0.9, 21: 0.7, 22: 0.5,
};

/**
 * Klientów na godzinę przy krzywej 1, reputacji 50 i bez marketingu: stały ruch z ulicy (`TRAFFIC_BASE`) plus tyle, ile
 * ściągną półki (pojemność / 300), razy położenie lokalu (kamienica w śródmieściu ma więcej przechodniów). Sklep na start
 * (1200–2100 sztuk na półkach) ma tak ok. 300–350 klientów dziennie, czyli obrót ok. 6,5–7,5 tys. zł, mniej więcej tyle co
 * przeciętny prawdziwy sklep convenience w Polsce (2,4–2,7 mln zł obrotu rocznie, dane sieci z 2025). Większy sklep po remoncie
 * sam ściąga ludzi, a marketing, kampanie i reputacja dokładają swoje. Do SIM_VERSION 5 było 23 + pojemność / 180 (450–550 klientów).
 */
export const TRAFFIC_BASE = 13;
export const TRAFFIC_PER_SHELF_ITEM = 1 / 320;
export const TRAFFIC_RANGE: [number, number] = [7, 34];
/**
 * Fale klientów (autobus, przerwa w szkole): godzina dzieli się na bloki po `block` minut i w bloku z szansą `chance` przez
 * `length` minut przychodzi ich więcej, a w pozostałych minutach bloku o `depth` mniej. Średnia bloku zostaje równa
 * `arrivalRate`, więc dzień ma tylu klientów co bez fal, tylko kolejka rośnie w falach i schodzi między nimi.
 */
export const WAVES = { block: 20, length: 5, chance: 0.75, depth: 0.35 } as const;
export const LOT_TRAFFIC: Record<'blok' | 'kamienica' | 'pawilon', number> = { blok: 1, kamienica: 1.15, pawilon: 0.95 };

// --- Ludzie i kasy ----------------------------------------------------------------------------------

/** Klientów na minutę: kasjer i kasa samoobsługowa (SCO). */
export const TILL_RATE = 0.7;
/** Stukanie w kasę pomaga, gdy kolejka czekałaby na kasjerów dłużej niż tyle minut (`tillTapBlock`). */
export const TILL_TAP_QUEUE_MIN = 3;
export const SCO_RATE = 0.4;
/** Udział klientów, którzy w ogóle podejdą do SCO (reszta woli człowieka). */
export const SCO_ACCEPT = 0.65;
/** Sztuk na minutę na pracownika: rozładunek palety i wykładanie z zaplecza na półki. */
export const UNLOAD_RATE = 6;
export const RESTOCK_RATE = 20;
/** Rozładunek wg miejsca palety: z chodnika trzeba nosić przez salę. */
export const UNLOAD_AT = { sidewalk: 0.75, floor: 1, aisle: 1, backroom: 1.15 } as const;
/** Sztuk na jedno stuknięcie gracza w paletę (franczyzobiorca pomaga). */
export const TAP_ITEMS = 8;
/**
 * Combo stukania liczone w minutach gry, a nie zegarem przeglądarki (serwer odtwarzający bieg nie widzi zegara):
 * odstęp między stuknięciami, który jeszcze podtrzymuje serię. 5 minut to ok. 0,8 s przy ×1 w godzinach otwarcia
 * (`MINUTES_PER_SECOND_OPEN`), czyli mniej więcej tyle co dawne 650 ms.
 */
export const COMBO_WINDOW = 5;
/**
 * Koszt jednej osoby na zmianie za dzień otwarcia (17 h), naliczany co wieczór i płacony przy zamknięciu miesiąca z przelewu. Część
 * godzin pokrywa sam franczyzobiorca z rodziną, więc to koszt godzin najętych, a nie pełny etat razy 17 h. SIM 5 miał 500 zł, bo płaca
 * niosła w sobie ZUS, VAT i księgową; od SIM_VERSION 6 są osobnymi kosztami (`OWN_COSTS`, ok. 9–10 tys. zł miesięcznie, czyli ok. 165 zł
 * na osobę na zmianie dziennie przy dwóch osobach).
 */
export const WAGE_PER_DAY = 340;
export const HIRE_COST = 300;
export const STAFF_MAX = 8;
export const STAFF_START = 2;

// --- Koszty i kary ------------------------------------------------------------------------------------

export const MEDIA_PER_DAY = 140;
/**
 * Koszty własne franczyzobiorcy płacone przy zamknięciu miesiąca z przelewu od Centrali (obok płac i mediów): ZUS i księgowa co miesiąc
 * tyle samo, VAT jako udział przelewu. Proporcje z relacji franczyzobiorczyni z Opola (Bankier, 12.11.2024): przelew ok. 25 tys. zł,
 * VAT 3,9–4,5 tys., ZUS 2–2,5 tys., księgowa ok. 1 tys. VAT to uproszczenie: gra pokazuje kwotę, nie mechanizm rozliczenia, który
 * w relacjach jest sporny. Opłaty franczyzowej na koniec miesiąca nie ma (do SIM_VERSION 6 była: 1000 zł plus 3,4% obrotu), bo żadne
 * źródło jej nie potwierdza: udział Centrali jest w stawce marży (`CAT_INFO`).
 */
export const OWN_COSTS = { zus: 2200, accounting: 1000, vatShare: 0.17 } as const;
/**
 * Raty u Centrali: ulepszenie, sprzęt albo remont od razu, a Centrala potrąca raty z kolejnych przelewów (jak sprzęt na start
 * finansowany przez sieć). Plan zależy od ceny (`upTo`), opłata za finansowanie to udział ceny, więc zakup za gotówkę zawsze kosztuje
 * mniej. Suma rat w miesiącu nie przekroczy `limitShare` przelewu bazowego razy mnożnik zaufania (`trust`, od najwyższego progu).
 */
export const INSTALLMENTS = {
  plans: [
    { upTo: 5_000, months: 3, fee: 0.04 },
    { upTo: 25_000, months: 6, fee: 0.08 },
    { upTo: Infinity, months: 12, fee: 0.15 },
  ],
  limitShare: 0.35,
  trust: [
    { from: 85, mult: 1.5 },
    { from: 70, mult: 1.25 },
    { from: 40, mult: 1 },
    { from: 25, mult: 0.5 },
  ],
} as const;
/**
 * Remanent: ostatniego dnia co `everyMonths` miesięcy gry o `at` (przed otwarciem). Pierwszy wypada przy końcu gwarancji. Ubytki od
 * ostatniego remanentu ponad limit Centrali (`WUT.threshold` obrotu z okresu) schodzą z przelewu tego samego wieczoru.
 */
export const REMANENT = { everyMonths: 3, at: 5 * 60 } as const;
/**
 * Przeterminowania z nadmiaru zapasu: co wieczór towar ponad `coverDays` dni sprzedaży (wartość zapasu w sklepie po cenach sklepu minus
 * tyle dni przewidywanego obrotu) traci `rate` swojej wartości. Trafia do ubytków (przyczyna „przeterminowane”) i wychodzi przy remanencie.
 */
export const EXPIRY = { coverDays: 3, rate: 0.01 } as const;
/**
 * Przychód gwarantowany nowego franczyzobiorcy (prawdziwe sieci: 25 tys. zł miesięcznie w latach 2023–2025, „pod szeregiem
 * warunków”): przez pierwsze `months` miesięcy gry Centrala przy zamknięciu miesiąca dopłaca do przelewu, żeby przychód (marża plus
 * premie Centrali, przed potrąceniami i kosztami własnymi) wyniósł `income`, o ile zaufanie jest co najmniej `minTrust` i w miesiącu
 * nie było mandatu. Trzy miesiące to kwartał wdrożenia i zarazem cały sezon rankingowy; przy jego końcu wypada pierwszy remanent.
 */
export const GUARANTEE = { income: 25_000, months: 3, minTrust: 40 } as const;
/** Palet w dostawie bez opłaty logistycznej; każda kolejna kosztuje (na sztukę towaru tyle co dawne 6 palet po 60 zł). */
export const PALLETS_FREE = 4;
export const PALLET_FEE = 90;
export const FINE_BASE = 800;
export const FINE_PER_PALLET = 150;
/**
 * Zagracenie sali (decyzja właściciela z 30.10.2026: palet nikt nie odsyła, nadmiar „zasrywa” sklep). Liczą się palety w sali
 * i w przejściach: ruch spada o `trafficPerPallet` za każdą (razem z workami w sali, nie niżej niż `trafficFloor`), cierpliwość
 * w kolejce o jedną osobę za paletę, najwyżej o `patienceMax`, a palety w przejściach co minutę otwarcia obniżają reputację
 * o `repPerMinute`, liczone najwyżej do `repPalletsMax` palet i nie niżej niż do `repFloor`. Dolne granice zostawiają sklepowi połowę
 * ruchu i reputację, przy której klienci dalej przychodzą: towar schodzi z półek, więc palety da się rozładować i z zagracenia wyjść.
 * Paletę spod sklepu, której towaru nie ma gdzie wyłożyć, załoga po `pullInMin` minutach wciąga w przejścia (zamiast czekać na
 * mandaty Straży Miejskiej, które przy takiej palecie szłyby codziennie aż do bankructwa).
 */
export const CLUTTER = {
  trafficPerPallet: 0.08, trafficFloor: 0.5, patienceMax: 3, repPerMinute: 0.0006, repPalletsMax: 8, repFloor: 25, pullInMin: 120,
} as const;
/**
 * Asystent Traszki nie zamawia więcej palet, niż zmiana rozładuje w tyle minut po dostawie (`crewPalletCap`): przy dwóch osobach
 * to 4 palety, mniej więcej tyle, ile sprzeda sklep na start przy 450–550 klientach dziennie.
 */
export const ASSISTANT_UNLOAD_MIN = 450;
/**
 * Straż Miejska (decyzja właściciela z 29.10.2026: mandat to rzadkość i skutek zaniedbania, a nie codzienność). Patrol zagląda
 * od `from` do `to`; palety spod sklepu obchodzą go dopiero, gdy najstarsza stoi `graceMin`: mniej więcej tyle dwuosobowa zmiana
 * rozładowuje pełną dostawę asystenta (4 palety, kasjer dorzuca ręce między falami klientów), więc mandat dostaje sklep, w którym
 * palet nikt nie rusza (np. dzień z chorym pracownikiem, kiedy jedyna osoba stoi przy kasie).
 * Pierwszy obchód dnia z takimi paletami to upomnienie bez kary; mandat dopiero przy kolejnym obchodzie tego samego dnia, co
 * najmniej `warnGapMin` po upomnieniu, i nie częściej niż co `fineGapMin`. Szansa obchodu na minutę: `patrol` razy
 * (1 + `perPallet` × liczba palet ponad jedną) razy (1 + `perHour` × godziny ponad tolerancję), razy kamery (`fineMult`).
 */
export const STRAZ = {
  from: 9 * 60,
  to: 20 * 60,
  graceMin: 360,
  warnGapMin: 60,
  fineGapMin: 180,
  patrol: 0.002,
  perPallet: 0.375,
  perHour: 0.2,
} as const;
/** Kredyt kupiecki: wartość towaru w sklepie i w drodze (półki, zaplecze, palety, dostawy) ponad limit wstrzymuje zamówienie. */
export const CREDIT_LIMIT = 70_000;
/**
 * Granica debetu (decyzja właściciela z 29.10.2026: „za duży debet to koniec gry”): gotówka poniżej niej kończy grę od razu, także
 * w środku miesiąca. Przelew od Centrali z potrąceniami i kosztami własnymi przychodzi na koniec miesiąca, więc wtedy gotówka skacze; słaby
 * miesiąc robi dziurę (balans: tycoon/balance.test.ts), a granica stoi na tyle daleko, żeby sam jeden słaby miesiąc gry nie kończył. Od
 * `DEBT_WARN_SHARE` granicy Centrala ostrzega, ile zostało do końca. −100 000 od SIM_VERSION 5 (decyzja właściciela z 30.10.2026:
 * „zwiększ możliwy debet do 100k”; w playteście dołek po opłacie za duży sklep sięgał ok. −100 tys.).
 */
export const DEBT_LIMIT = -100_000;
export const DEBT_WARN_SHARE = 0.5;
/** Gotówka na start: ok. 5000 zł, tyle co wkład własny w prawdziwej franczyzie convenience (kasa fiskalna, koncesja). */
export const START_CASH = 5000;

/** Cierpliwość: ilu ludzi w kolejce klient jeszcze toleruje. */
export const PATIENCE = 6;

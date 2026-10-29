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
  /** Marża franczyzobiorcy (udział w cenie). */
  margin: number;
  /** Udział w koszyku (sztuki). Suma = 1. */
  basket: number;
  /** Udział w pojemności lodówek i regałów (suma w każdej kolumnie = 1). */
  fridge: number;
  dry: number;
}

export const CAT_INFO: Record<Cat, CatInfo> = {
  napoje:    { label: 'Napoje',    price: 5.2,  margin: 0.17, basket: 0.26, fridge: 0.6, dry: 0.15 },
  nabial:    { label: 'Nabiał',    price: 4.6,  margin: 0.15, basket: 0.12, fridge: 0.4, dry: 0 },
  slodycze:  { label: 'Słodycze',  price: 4.1,  margin: 0.22, basket: 0.15, fridge: 0,   dry: 0.2 },
  przekaski: { label: 'Przekąski', price: 6.3,  margin: 0.21, basket: 0.15, fridge: 0,   dry: 0.2 },
  pieczywo:  { label: 'Pieczywo',  price: 3.6,  margin: 0.2,  basket: 0.14, fridge: 0,   dry: 0.15 },
  chemia:    { label: 'Chemia',    price: 9.5,  margin: 0.2,  basket: 0.05, fridge: 0,   dry: 0.1 },
  alkohol:   { label: 'Alkohol',   price: 11.8, margin: 0.12, basket: 0.13, fridge: 0,   dry: 0.2 },
};

/** Sztuk w koszyku przeciętnego klienta. */
export const ITEMS_PER_CUSTOMER = 3.4;

/** Hot-dog albo kawa „przy okazji”: szansa na klienta, cena i marża. Bez zapasu (strefa hot jest w każdym sklepie). */
export const HOT = { chance: 0.18, price: 8.5, margin: 0.45 } as const;

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

/** Sztuk na palecie. */
export const PALLET_ITEMS = 320;

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
 * ściągną półki (pojemność / 180), razy położenie lokalu (kamienica w śródmieściu ma więcej przechodniów). Sklep na start
 * (1200–2100 sztuk na półkach) ma tak 450–550 klientów dziennie, a większy po remoncie sam ściąga ludzi.
 */
export const TRAFFIC_BASE = 23;
export const TRAFFIC_PER_SHELF_ITEM = 1 / 180;
export const TRAFFIC_RANGE: [number, number] = [12, 60];
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
export const UNLOAD_AT = { sidewalk: 0.75, floor: 1, backroom: 1.15 } as const;
/** Sztuk na jedno stuknięcie gracza w paletę (franczyzobiorca pomaga). */
export const TAP_ITEMS = 8;
/**
 * Combo stukania liczone w minutach gry, a nie zegarem przeglądarki (serwer odtwarzający bieg nie widzi zegara):
 * odstęp między stuknięciami, który jeszcze podtrzymuje serię. 5 minut to ok. 0,8 s przy ×1 w godzinach otwarcia
 * (`MINUTES_PER_SECOND_OPEN`), czyli mniej więcej tyle co dawne 650 ms.
 */
export const COMBO_WINDOW = 5;
export const WAGE_PER_DAY = 340;
export const HIRE_COST = 300;
export const STAFF_MAX = 8;
export const STAFF_START = 2;

// --- Koszty i kary ------------------------------------------------------------------------------------

export const MEDIA_PER_DAY = 140;
/**
 * Opłata franczyzowa na koniec miesiąca: stała część plus udział w obrocie. Centrala bierze swoje (satyra ze specu), a udział
 * rośnie z wielkością sklepu, więc wyrównuje seedy: dwuosobowa zmiana bez decyzji kończy dwa miesiące w okolicy zera, i to
 * w budce, i w flagowcu (balans: tycoon/balance.test.ts). Zaufana Centrali część wraca jako premia od obrotu (trust.ts).
 */
export const FRANCHISE_FEE_FIXED = 2000;
export const FRANCHISE_FEE_SHARE = 0.151;
/** Palet w dostawie bez opłaty logistycznej; każda kolejna kosztuje. */
export const PALLETS_FREE = 6;
export const PALLET_FEE = 60;
export const RETURN_FEE = 150;
export const FINE_BASE = 800;
export const FINE_PER_PALLET = 100;
/**
 * Asystent Traszki nie zamawia więcej palet, niż zmiana rozładuje w tyle minut po dostawie (`crewPalletCap`): przy dwóch osobach
 * to 6 palet, mniej więcej tyle, ile sprzeda sklep na start przy 450–550 klientach dziennie.
 */
export const ASSISTANT_UNLOAD_MIN = 450;
/**
 * Straż Miejska (decyzja właściciela z 29.10.2026: mandat to rzadkość i skutek zaniedbania, a nie codzienność). Patrol zagląda
 * od `from` do `to`; palety spod sklepu obchodzą go dopiero, gdy najstarsza stoi `graceMin`: mniej więcej tyle dwuosobowa zmiana
 * rozładowuje pełną dostawę asystenta (6 palet, kasjer dorzuca ręce między falami klientów), więc mandat dostaje sklep, w którym
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
  perPallet: 0.25,
  perHour: 0.2,
} as const;
/** Kredyt kupiecki: wartość towaru w sklepie (półki, zaplecze, palety) ponad limit wstrzymuje zamówienie. */
export const CREDIT_LIMIT = 70_000;
/** Gotówka poniżej tego przy zamknięciu miesiąca to miesiąc bez opłacenia Centrali; drugi taki z rzędu kończy umowę (spec §10). */
/**
 * Granica debetu (decyzja właściciela z 29.10.2026: „za duży debet to koniec gry”): gotówka poniżej niej kończy grę od razu, także
 * w środku miesiąca. Opłata franczyzowa schodzi na koniec miesiąca, więc wtedy gotówka ma dołek; bierny gracz bez pecha kończy go
 * w okolicy zera (balans: tycoon/balance.test.ts), a granica stoi na tyle daleko, żeby sam ten dołek gry nie kończył. Od
 * `DEBT_WARN_SHARE` granicy Centrala ostrzega, ile zostało do końca.
 */
export const DEBT_LIMIT = -10_000;
export const DEBT_WARN_SHARE = 0.5;
export const START_CASH = 2000;

/** Cierpliwość: ilu ludzi w kolejce klient jeszcze toleruje. */
export const PATIENCE = 6;

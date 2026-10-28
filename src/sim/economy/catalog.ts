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

/** Pojemność mebli (sztuk na kratkę obrysu) i zaplecza (sztuk na kratkę podłogi zaplecza). */
export const CAPACITY = { gondola: 36, wallShelf: 45, fridge: 35, backroom: 18 } as const;

/** Sztuk na palecie. */
export const PALLET_ITEMS = 320;

// --- Czas ------------------------------------------------------------------------------------------

export const MINUTES_PER_DAY = 24 * 60;
export const OPEN_FROM = 6 * 60;
export const OPEN_TO = 23 * 60;
/** Minuty gry na sekundę przy ×1: dzień sklepu (17 h) w ~51 s, noc (7 h) w ~5 s. */
export const MINUTES_PER_SECOND_OPEN = 20;
export const MINUTES_PER_SECOND_CLOSED = 84;
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
 * Klientów na godzinę przy krzywej 1, reputacji 50 i bez marketingu: tylu, ilu obsłużą półki sklepu (pojemność / 75),
 * razy położenie lokalu (kamienica w śródmieściu ma więcej przechodniów). Większy sklep po remoncie sam ściąga ludzi.
 */
export const TRAFFIC_PER_SHELF_ITEM = 1 / 75;
export const TRAFFIC_RANGE: [number, number] = [12, 60];
export const LOT_TRAFFIC: Record<'blok' | 'kamienica' | 'pawilon', number> = { blok: 1, kamienica: 1.15, pawilon: 0.95 };

// --- Ludzie i kasy ----------------------------------------------------------------------------------

/** Klientów na minutę: kasjer i kasa samoobsługowa (SCO). */
export const TILL_RATE = 0.7;
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

export const WAGE_PER_DAY = 340;
export const HIRE_COST = 300;
export const STAFF_MAX = 8;
export const STAFF_START = 2;

// --- Koszty i kary ------------------------------------------------------------------------------------

export const MEDIA_PER_DAY = 140;
export const FRANCHISE_FEE_FIXED = 4500;
export const FRANCHISE_FEE_SHARE = 0.03;
/** Palet w dostawie bez opłaty logistycznej; każda kolejna kosztuje. */
export const PALLETS_FREE = 6;
export const PALLET_FEE = 60;
export const RETURN_FEE = 150;
export const FINE_BASE = 500;
export const FINE_PER_PALLET = 150;
/** Kredyt kupiecki: wartość towaru w sklepie (półki, zaplecze, palety) ponad limit wstrzymuje zamówienie. */
export const CREDIT_LIMIT = 70_000;
/** Na koniec miesiąca z gotówką poniżej tego Centrala wypowiada umowę. */
export const BANKRUPTCY_AT = -30_000;
export const START_CASH = 2000;

/** Cierpliwość: ilu ludzi w kolejce klient jeszcze toleruje. */
export const PATIENCE = 6;

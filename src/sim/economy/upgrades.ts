import { powInt } from './exactMath';

/**
 * Sklep z ulepszeniami w stylu klikera: każdy zakup to kolejny poziom, a cena rośnie geometrycznie. Część rzeczy
 * odblokowuje poziom gracza (odblokowanie to też nagroda). Gałąź „Warsztat złotej rączki” (automatyka DIY, na końcu
 * humanoid eDward) odsłania się dopiero po pierwszych sukcesach, żeby początek gry nie przytłaczał wyborem.
 */

export type UpgradeGroup = 'kasa' | 'palety' | 'klienci' | 'warsztat';

export const GROUP_LABEL: Record<UpgradeGroup, string> = {
  kasa: 'Kasa',
  palety: 'Palety i zaplecze',
  klienci: 'Klienci',
  warsztat: 'Warsztat złotej rączki',
};

export type UpgradeId =
  | 'szkolenie' | 'drugaKasa' | 'scoSoft' | 'klima'
  | 'wozek' | 'regaly' | 'asystent' | 'nocne' | 'rampa' | 'dostawy2'
  | 'ulotki' | 'kawa' | 'traszkapka' | 'kamery'
  | 'tasmociag' | 'wykladacz' | 'prasa' | 'humanoid';

export interface UpgradeDef {
  id: UpgradeId;
  group: UpgradeGroup;
  /** Nazwy kolejnych poziomów (ostatnia powtarza się, gdy poziomów jest więcej). */
  names: string[];
  /** Co daje jeden poziom: krótko, po polsku. */
  effect: string;
  /** Żart w duchu Centrali. */
  flavor: string;
  maxLevel: number;
  baseCost: number;
  costMult: number;
  /** Wymagania: inne ulepszenia, poziom remontu, posiadane kasy samoobsługowe, poziom gracza. */
  requires?: { upgrade?: [UpgradeId, number][]; remont?: number; sco?: number; level?: number };
}

export const UPGRADES: readonly UpgradeDef[] = [
  // --- Kasa ---
  { id: 'szkolenie', group: 'kasa', names: ['Szkolenie „Uśmiech to procedura”', 'Szkolenie „Skanuj z biodra”', 'Kurs „Reszta w 2 sekundy”', 'Mistrzostwa Traszki w kasowaniu', 'Kasjer-ninja'],
    effect: 'Kasa obsługuje o 15% szybciej', flavor: 'Certyfikat ważny do następnej zmiany regulaminu.', maxLevel: 5, baseCost: 1200, costMult: 1.8 },
  { id: 'drugaKasa', group: 'kasa', names: ['Druga kasa', 'Trzecia kasa'],
    effect: '+1 stanowisko kasowe (potrzebuje kasjera)', flavor: 'Centrala: „Dwie kasy? A kto za to zapłaci? A, Ty”.', maxLevel: 2, baseCost: 6000, costMult: 4,
    requires: { upgrade: [['szkolenie', 1]], level: 5 } },
  { id: 'scoSoft', group: 'kasa', names: ['SCO 2.0: mniej „nieoczekiwanych przedmiotów”', 'SCO 3.0: waga rozumie banany', 'SCO 4.0: przeprasza po polsku'],
    effect: 'Kasy samoobsługowe: +15% tempa i +8% klientów chętnych', flavor: 'Proszę odłożyć produkt w strefie pakowania. Albo nie.', maxLevel: 3, baseCost: 3000, costMult: 2.2,
    requires: { sco: 1 } },
  { id: 'klima', group: 'kasa', names: ['Klimatyzacja', 'Radio Traszka FM'],
    effect: 'Klienci czekają w kolejce dłużej (+2 osoby)', flavor: 'Nikt nie ucieka z kolejki, gdy leci „Zawsze pod ręką (remix)”.', maxLevel: 2, baseCost: 3500, costMult: 2,
    requires: { level: 3 } },

  // --- Palety i zaplecze ---
  { id: 'wozek', group: 'palety', names: ['Wózek paletowy', 'Wózek elektryczny', 'Wózek z turbo'],
    effect: 'Rozładunek palet o 40% szybszy', flavor: 'Pierwszy wózek w historii sklepu, który ma wszystkie kółka.', maxLevel: 3, baseCost: 1500, costMult: 3 },
  { id: 'regaly', group: 'palety', names: ['Regały magazynowe', 'Antresola na zapleczu', 'Tetris-mistrz zaplecza'],
    effect: 'Zaplecze mieści o 50% więcej towaru i +1 paletę', flavor: 'Wreszcie widać podłogę. Prawie.', maxLevel: 3, baseCost: 2000, costMult: 2.5 },
  { id: 'asystent', group: 'palety', names: ['Asystent Traszki: tryb „rozsądny”', 'Asystent Traszki: tryb „księgowa”'],
    effect: 'Asystent mniej przesadza z zamówieniem', flavor: '„40 hot-dogów? Klienci to kochają” — już nie.', maxLevel: 2, baseCost: 1500, costMult: 2 },
  { id: 'nocne', group: 'palety', names: ['Okno dostaw nocnych'],
    effect: 'Dostawa o 5:00 zamiast 7:00, przed porannym szczytem', flavor: 'Kierowca też nie śpi. Nikt tu nie śpi.', maxLevel: 1, baseCost: 4000, costMult: 1,
    requires: { upgrade: [['wozek', 1]], level: 4 } },
  { id: 'rampa', group: 'palety', names: ['Rampa i drzwi od zaplecza'],
    effect: 'Palety trafiają prosto na zaplecze (gdy jest miejsce)', flavor: 'Chodnik znów należy do pieszych. Straż Miejska w żałobie.', maxLevel: 1, baseCost: 9000, costMult: 1,
    requires: { upgrade: [['regaly', 1]], level: 6 } },
  { id: 'dostawy2', group: 'palety', names: ['Druga dostawa (popołudniowa)'],
    effect: 'Zamówienie przyjeżdża w dwóch turach: rano i o 15:00', flavor: 'Dwa razy więcej podpisów na dokumencie WZ.', maxLevel: 1, baseCost: 12000, costMult: 1,
    requires: { upgrade: [['rampa', 1]], level: 10 } },

  // --- Klienci ---
  { id: 'ulotki', group: 'klienci', names: ['Ulotki na osiedlu', 'Plakaty na przystanku', 'Gazetka w skrzynkach', 'Billboard „Zawsze pod ręką”', 'Reklama w radiu osiedlowym'],
    effect: 'Ruch w sklepie +10%', flavor: '90% ulotek trafia do kosza. 10% do lodówki jako magnes.', maxLevel: 5, baseCost: 800, costMult: 1.9 },
  { id: 'kawa', group: 'klienci', names: ['Ekspres premium', 'Barista-automat', 'Kawa z pianką w kształcie traszki'],
    effect: 'Częściej kupują kawę i hot-doga (+30% sprzedaży hot)', flavor: 'Flat white dla ludzi, którzy nie wiedzą, co to flat white.', maxLevel: 3, baseCost: 2000, costMult: 2.2 },
  { id: 'traszkapka', group: 'klienci', names: ['Kampania w Traszkapce', 'Kupony dnia', 'Ogonki x2 w czwartki'],
    effect: 'Ruch +12% i więcej Ogonków', flavor: 'Powiadomienie push o 6:02. Wszyscy kochają powiadomienia o 6:02.', maxLevel: 3, baseCost: 5000, costMult: 2.5,
    requires: { upgrade: [['ulotki', 2]], level: 6 } },
  { id: 'kamery', group: 'klienci', names: ['Kamery', 'Kamery z AI (liczą też koty)'],
    effect: 'Mniej „zapomnianych” skanów na SCO i mniej mandatów', flavor: 'Kot w Nano policzony jako 3 batony. Reklamacja w toku.', maxLevel: 2, baseCost: 2500, costMult: 2,
    requires: { sco: 1 } },

  // --- Warsztat złotej rączki (automatyka DIY) ---
  { id: 'tasmociag', group: 'warsztat', names: ['Taśmociąg z bieżni do biegania', 'Taśmociąg z napędem od pralki', 'Taśmociąg przemysłowy „od szwagra”'],
    effect: 'Rozładowuje palety sam, także nocą (+4 szt./min)', flavor: 'Bieżnia i tak stała nieużywana od stycznia.', maxLevel: 3, baseCost: 12000, costMult: 2.4 },
  { id: 'wykladacz', group: 'warsztat', names: ['Wykładacz z drukarki 3D', 'Ramię robota z wyprzedaży', 'Wykładacz z czujnikiem pustej półki'],
    effect: 'Sam wykłada towar z zaplecza na półki, także nocą (+12 szt./min)', flavor: 'Wydrukowany w 37 godzin. Działa w 3 na 4 przypadkach.', maxLevel: 3, baseCost: 15000, costMult: 2.4,
    requires: { upgrade: [['tasmociag', 1]] } },
  { id: 'prasa', group: 'warsztat', names: ['Prasa do kartonów z imadła po dziadku'],
    effect: 'Worek śmieci wynosi się w 2 osobominuty zamiast 5', flavor: 'Imadło wreszcie się przydało. Dziadek byłby dumny, Centrala mniej.', maxLevel: 1, baseCost: 6000, costMult: 1 },
  { id: 'humanoid', group: 'warsztat', names: ['Humanoid eDward'],
    effect: 'eDward pracuje za trzech, 24 h na dobę, bez pensji', flavor: 'Złożony z odkurzacza, wycieraczek i starego laptopa. Mówi „dzień dobry” o każdej porze.', maxLevel: 1, baseCost: 220_000, costMult: 1,
    requires: { upgrade: [['tasmociag', 3], ['wykladacz', 2]], remont: 2, level: 25 } },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

/** Warsztat odsłania się na tym poziomie gracza albo po pierwszym remoncie. */
export const WORKSHOP_LEVEL = 10;

/** Cena następnego poziomu (zaokrąglona do 50 zł). */
export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.round((def.baseCost * powInt(def.costMult, level)) / 50) * 50;
}

// --- Sprzęt do slotów ------------------------------------------------------------------------------

export type EquipmentId = 'sco' | 'bankomat' | 'paczkownik' | 'piec';

export interface EquipmentDef {
  id: EquipmentId;
  name: string;
  effect: string;
  /** Ile miejsca zajmuje: slot kasy samoobsługowej ma 1, slot sprzętu 2×2 ma 2. */
  size: 1 | 2;
  baseCost: number;
  /** Każda kolejna sztuka tego sprzętu drożeje o tyle razy. */
  costMult: number;
  /** Od którego poziomu gracza można kupić. */
  minLevel: number;
}

export const EQUIPMENT: readonly EquipmentDef[] = [
  { id: 'sco', name: 'Kasa samoobsługowa', effect: 'Obsługuje klientów bez kasjera', size: 1, baseCost: 3500, costMult: 1.25, minLevel: 1 },
  { id: 'bankomat', name: 'Bankomat', effect: 'Ruch +4% i 25 zł dziennie za najem', size: 1, baseCost: 4000, costMult: 1.6, minLevel: 3 },
  { id: 'paczkownik', name: 'Paczkownik 24h', effect: 'Ruch +7%: odbiór paczki to zawsze „jeszcze coś”', size: 2, baseCost: 6500, costMult: 1.6, minLevel: 6 },
  { id: 'piec', name: 'Piec do pizzy', effect: 'Sprzedaż hot +40%', size: 2, baseCost: 7000, costMult: 1.6, minLevel: 4 },
];

export const EQUIPMENT_BY_ID: Record<EquipmentId, EquipmentDef> = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e])) as Record<EquipmentId, EquipmentDef>;

export function equipmentCost(def: EquipmentDef, owned: number): number {
  return Math.round((def.baseCost * powInt(def.costMult, owned)) / 50) * 50;
}

// --- Remont generalny --------------------------------------------------------------------------------

export interface RemontDef {
  level: number;
  name: string;
  cost: number;
  /** Dni zamknięcia sklepu. */
  days: number;
  /** O ile kratek rośnie lokal: szerokość, głębokość sali, głębokość zaplecza. */
  grow: [number, number, number];
  /** Ile slotów sprzętu 2×2 próbuje postawić generator. */
  slots: number;
  /** Od którego poziomu gracza. */
  minLevel: number;
}

export const REMONTS: readonly RemontDef[] = [
  { level: 1, name: 'Remont: dokupienie lokalu obok', cost: 25_000, days: 2, grow: [4, 2, 1], slots: 4, minLevel: 8 },
  { level: 2, name: 'Remont: wersja Premium', cost: 80_000, days: 3, grow: [8, 4, 2], slots: 5, minLevel: 14 },
  { level: 3, name: 'Remont: Flagowiec', cost: 200_000, days: 4, grow: [12, 6, 3], slots: 7, minLevel: 20 },
];

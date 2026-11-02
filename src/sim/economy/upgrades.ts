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
  | 'tasmociag' | 'wykladacz' | 'prasa' | 'humanoid'
  | 'kasaEkspres' | 'ekrany' | 'barHot' | 'magazynWys' | 'dron';

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
  { id: 'szkolenie', group: 'kasa', names: ['Szkolenie „Uśmiech to procedura”', 'Szkolenie „Skanuj z biodra”', 'Kurs „Reszta w 2 sekundy”', 'Mistrzostwa Traszki w kasowaniu', 'Kasjer-ninja',
    'Kasjer-ninja: czarny pas', 'Kasjer-ninja: sensei', 'Kasjer, który skanuje wzrokiem'],
    effect: 'Kasa obsługuje o 15% szybciej', flavor: 'Certyfikat ważny do następnej zmiany regulaminu.', maxLevel: 8, baseCost: 1200, costMult: 1.8 },
  { id: 'drugaKasa', group: 'kasa', names: ['Druga kasa', 'Trzecia kasa'],
    effect: '+1 stanowisko kasowe (potrzebuje kasjera)', flavor: 'Centrala: „Dwie kasy? A kto za to zapłaci? A, Ty”.', maxLevel: 2, baseCost: 6000, costMult: 4,
    requires: { upgrade: [['szkolenie', 1]], level: 5 } },
  { id: 'scoSoft', group: 'kasa', names: ['SCO 2.0: mniej „nieoczekiwanych przedmiotów”', 'SCO 3.0: waga rozumie banany', 'SCO 4.0: przeprasza po polsku',
    'SCO 5.0: pamięta Twoje imię', 'SCO 6.0: sama się przeprasza'],
    effect: 'Kasy samoobsługowe: +15% tempa i +8% klientów chętnych', flavor: 'Proszę odłożyć produkt w strefie pakowania. Albo nie.', maxLevel: 5, baseCost: 3000, costMult: 2.2,
    requires: { sco: 1 } },
  { id: 'klima', group: 'kasa', names: ['Klimatyzacja', 'Radio Traszka FM', 'Klimatyzacja z zapachem świeżych bułek'],
    effect: 'Klienci czekają w kolejce dłużej (+2 osoby)', flavor: 'Nikt nie ucieka z kolejki, gdy leci „Zawsze pod ręką (remix)”.', maxLevel: 3, baseCost: 3500, costMult: 2,
    requires: { level: 3 } },

  // --- Palety i zaplecze ---
  { id: 'wozek', group: 'palety', names: ['Wózek paletowy', 'Wózek elektryczny', 'Wózek z turbo',
    'Wózek autonomiczny (czasem jedzie do konkurencji)', 'Wózek z napędem rakietowym'],
    effect: 'Rozładunek palet o 40% szybszy', flavor: 'Pierwszy wózek w historii sklepu, który ma wszystkie kółka.', maxLevel: 5, baseCost: 1500, costMult: 3 },
  { id: 'regaly', group: 'palety', names: ['Regały magazynowe', 'Antresola na zapleczu', 'Tetris-mistrz zaplecza',
    'Regały wysokiego składowania', 'Zaplecze w czwartym wymiarze'],
    effect: 'Zaplecze mieści o 50% więcej towaru i +1 paletę', flavor: 'Wreszcie widać podłogę. Prawie.', maxLevel: 5, baseCost: 2000, costMult: 2.5 },
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
  { id: 'ulotki', group: 'klienci', names: ['Ulotki na osiedlu', 'Plakaty na przystanku', 'Gazetka w skrzynkach', 'Billboard „Zawsze pod ręką”', 'Reklama w radiu osiedlowym',
    'Dron z banerem nad osiedlem', 'Reklama na tramwaju', 'Neon widoczny z kosmosu'],
    effect: 'Ruch w sklepie +10%', flavor: '90% ulotek trafia do kosza. 10% do lodówki jako magnes.', maxLevel: 8, baseCost: 800, costMult: 1.9 },
  { id: 'kawa', group: 'klienci', names: ['Ekspres premium', 'Barista-automat', 'Kawa z pianką w kształcie traszki',
    'Kawa speciality z ziaren Centrali', 'Barista-robot z dyplomem'],
    effect: 'Częściej kupują kawę i hot-doga (+30% sprzedaży hot)', flavor: 'Flat white dla ludzi, którzy nie wiedzą, co to flat white.', maxLevel: 5, baseCost: 2000, costMult: 2.2 },
  { id: 'traszkapka', group: 'klienci', names: ['Kampania w Traszkapce', 'Kupony dnia', 'Ogonki x2 w czwartki',
    'Program „Traszka Gold”', 'Powiadomienia push o 4:58'],
    effect: 'Ruch +12% i więcej Ogonków', flavor: 'Powiadomienie push o 6:02. Wszyscy kochają powiadomienia o 6:02.', maxLevel: 5, baseCost: 5000, costMult: 2.5,
    requires: { upgrade: [['ulotki', 2]], level: 6 } },
  { id: 'kamery', group: 'klienci', names: ['Kamery', 'Kamery z AI (liczą też koty)'],
    effect: 'Mniej „zapomnianych” skanów na SCO i mniej mandatów', flavor: 'Kot w Nano policzony jako 3 batony. Reklamacja w toku.', maxLevel: 2, baseCost: 2500, costMult: 2,
    requires: { sco: 1 } },

  // --- Warsztat złotej rączki (automatyka DIY) ---
  { id: 'tasmociag', group: 'warsztat', names: ['Taśmociąg z bieżni do biegania', 'Taśmociąg z napędem od pralki', 'Taśmociąg przemysłowy „od szwagra”',
    'Taśmociąg z lotniska (po przetargu)', 'Taśmociąg magnetyczny z demobilu'],
    effect: 'Rozładowuje palety sam, także nocą (+4 szt./min)', flavor: 'Bieżnia i tak stała nieużywana od stycznia.', maxLevel: 5, baseCost: 12000, costMult: 2.4 },
  { id: 'wykladacz', group: 'warsztat', names: ['Wykładacz z drukarki 3D', 'Ramię robota z wyprzedaży', 'Wykładacz z czujnikiem pustej półki',
    'Wykładacz z AI (układa według feng shui)', 'Wykładacz, który przeprasza klientów'],
    effect: 'Sam wykłada towar z zaplecza na półki, także nocą (+12 szt./min)', flavor: 'Wydrukowany w 37 godzin. Działa w 3 na 4 przypadkach.', maxLevel: 5, baseCost: 15000, costMult: 2.4,
    requires: { upgrade: [['tasmociag', 1]] } },
  { id: 'prasa', group: 'warsztat', names: ['Prasa do kartonów z imadła po dziadku'],
    effect: 'Worek śmieci wynosi się w 2 osobominuty zamiast 5', flavor: 'Imadło wreszcie się przydało. Dziadek byłby dumny, Centrala mniej.', maxLevel: 1, baseCost: 6000, costMult: 1 },
  { id: 'humanoid', group: 'warsztat', names: ['Humanoid eDward'],
    effect: 'eDward pracuje za trzech, 24 h na dobę, bez pensji', flavor: 'Złożony z odkurzacza, wycieraczek i starego laptopa. Mówi „dzień dobry” o każdej porze.', maxLevel: 1, baseCost: 220_000, costMult: 1,
    requires: { upgrade: [['tasmociag', 3], ['wykladacz', 2]], remont: 2, level: 25 } },

  // --- Późna gra (etap 4b): od remontu 3, ceny rosną szybciej niż efekt ---
  { id: 'kasaEkspres', group: 'kasa',
    names: ['Kasa ekspresowa „do 5 produktów” (nikt nie liczy)', 'Kasa ekspresowa „do 10 produktów” (nadal nikt nie liczy)', 'Kasa ekspresowa „do 20 produktów” (liczy tylko Centrala)'],
    effect: 'Kasa obsługuje o kolejne 10% szybciej', flavor: 'Pan przed Tobą ma 23 produkty. Nikt nic nie mówi.', maxLevel: 3, baseCost: 45_000, costMult: 2.4,
    requires: { remont: 3, upgrade: [['szkolenie', 5]] } },
  { id: 'ekrany', group: 'klienci',
    names: ['Ekrany z reklamą Centrali (Ty płacisz za prąd)', 'Ekrany w każdym rogu (prąd dalej Twój)', 'Ekrany, które patrzą na klienta (i na Ciebie)',
      'Ekran w witrynie widoczny z drugiej strony ulicy', 'Ściana wideo: Centrala dziękuje za prąd'],
    effect: 'Ruch w sklepie +6%', flavor: 'Reklama Centrali leci w pętli. Rachunek za prąd też.', maxLevel: 5, baseCost: 60_000, costMult: 2.1,
    requires: { remont: 3 } },
  { id: 'barHot', group: 'klienci',
    names: ['Bar hot-food ze stołkami', 'Bar hot-food z menu na tablicy', 'Bar hot-food czynny do 22', 'Bar hot-food „Traszka Grill”'],
    effect: 'Częściej kupują hot-food (+25% sprzedaży hot)', flavor: 'Stołki są przykręcone. Klienci prawie też.', maxLevel: 4, baseCost: 50_000, costMult: 2.3,
    requires: { remont: 3, upgrade: [['kawa', 3]] } },
  { id: 'magazynWys', group: 'palety',
    names: ['Magazyn wysokiego składowania', 'Magazyn wysokiego składowania: drabina z certyfikatem', 'Magazyn wysokiego składowania: wózek widłowy w sklepie osiedlowym'],
    effect: 'Zaplecze mieści o 40% więcej towaru (obok regałów)', flavor: 'Sufit się skończył, więc budujemy w górę. Bez pozwolenia.', maxLevel: 3, baseCost: 80_000, costMult: 2.5,
    requires: { remont: 4, upgrade: [['regaly', 3]] } },
  { id: 'dron', group: 'warsztat',
    names: ['Dron-inwentaryzator z odkurzacza', 'Dron-inwentaryzator z kamerą z telefonu', 'Dron-inwentaryzator z lornetką po dziadku'],
    effect: 'Kradzieże (także na SCO) o 12% mniejsze', flavor: 'Liczy puszki z lotu ptaka. Czasem zgubi się w nawiasach.', maxLevel: 3, baseCost: 70_000, costMult: 2.4,
    requires: { remont: 3, upgrade: [['wykladacz', 2]] } },
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
  { level: 1, name: 'Remont: dokupienie lokalu obok', cost: 35_000, days: 2, grow: [4, 2, 1], slots: 4, minLevel: 8 },
  { level: 2, name: 'Remont: wersja Premium', cost: 100_000, days: 3, grow: [8, 4, 2], slots: 5, minLevel: 14 },
  { level: 3, name: 'Remont: Flagowiec', cost: 200_000, days: 4, grow: [12, 6, 3], slots: 7, minLevel: 20 },
  { level: 4, name: 'Remont: Flagowiec Plus', cost: 450_000, days: 5, grow: [14, 7, 4], slots: 8, minLevel: 28 },
  { level: 5, name: 'Remont: Traszka Max Pro Ultra', cost: 900_000, days: 6, grow: [16, 8, 4], slots: 9, minLevel: 34 },
];

/**
 * Mnożnik ruchu z remontu: +10 pkt proc. na poziom do trzeciego (jak dotąd, `1 + 0.1 × poziom` co do bitu), potem +15 pkt proc.
 * na poziom (×1,45 po czwartym, ×1,6 po piątym). Zapis `1 + 0.1 × a + 0.15 × b` dla b = 0 dodaje dokładne zero, więc poziomy 0–3
 * dają te same bity co przed etapem 4b.
 */
export function remontTrafficMult(level: number): number {
  return 1 + 0.1 * Math.min(level, 3) + 0.15 * Math.max(0, level - 3);
}

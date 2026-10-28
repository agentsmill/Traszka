/**
 * Liczby serwera rankingu w jednym miejscu: wersje gry, które serwer umie sprawdzić, granice rozmiarów, czasy życia w bazie
 * i limity zgłoszeń. Wszystkie czasy w sekundach (Redis), chyba że nazwa mówi inaczej.
 */

/**
 * Wersje gry, których biegi serwer przyjmuje: tylko te, które odtworzy ta sama symulacja co w grze (wynik liczy serwer, więc bieg
 * z innej wersji dałby inny wynik). Test pilnuje, żeby lista miała bieżącą wersję z `package.json` (podbicie wersji bez dopisania
 * jej tutaj nie przejdzie testów).
 */
export const KNOWN_GAME_VERSIONS: readonly string[] = ['0.0.0'];
/** Wersje generatora sklepu (`GENERATOR_VERSION`), z których serwer odtworzy sklep. */
export const KNOWN_GENERATOR_VERSIONS: readonly number[] = [1];

/**
 * Pierwsza minuta po sezonie rankingowym (`RANKED_SEASON_END_MINUTE` z `src/sim/ranked.ts`, test pilnuje równości). Kopia, bo
 * symulacja importuje się aliasem `@/`, którego funkcja serwerowa na Vercelu nie rozwiąże (patrz `redis.ts`).
 */
export const SEASON_END_MINUTE = 130_981;

const DAY = 86_400;

/** Rezerwacja nicka bez nowego wyniku wygasa po 12 miesiącach (spec §14.7). */
export const NICK_TTL = 365 * DAY;
/**
 * Jeden zapis gry na klucz, do 64 KB (spec §14.7). To przenosiny między urządzeniami, a nie kopia zapasowa, więc zapis żyje 30 dni
 * od ostatniego wysłania (każde wysłanie odnawia czas). Krótki czas życia ogranicza też, ile śmieci zostanie w bazie po nadużyciu.
 */
export const SAVE_MAX_BYTES = 64 * 1024;
export const SAVE_TTL = 30 * DAY;
/**
 * Tylko paczka z gry trafia do szuflady: `TransferBundle` z `src/ui/ranking/saveTransfer.ts` (format, wersja 1, seed, meta i save
 * jako obiekty). Kopia stałych, bo plik gry importuje się aliasem `@/`, którego funkcja serwerowa nie rozwiąże; test pilnuje równości.
 */
export const SAVE_BUNDLE_FORMAT = 'traszka-przeniesienie';
export const SAVE_BUNDLE_VERSION = 1;
/**
 * Globalny budżet wysyłania zapisów na dobę UTC, wspólny dla wszystkich kluczy i adresów (ponad niego 429 do północy UTC). Klucz
 * gracza nic nie kosztuje, więc limity na klucz i adres nie zatrzymają kogoś, kto je zmienia; ten licznik zatrzymuje. Zapis z gry
 * waży ok. 10 KB, ale w najgorszym razie 2000 wysłań po 64 KB to ok. 125 MB na dobę: tyle najwyżej doleje się do bazy.
 */
export const SAVE_DAILY_BUDGET = 2_000;
/** Licznik budżetu dziennego żyje dobę od pierwszego wysłania (nazwa klucza ma dzień, więc stary licznik nikomu nie przeszkadza). */
export const BUDGET_TTL = DAY;
/** Ranking seeda żyje ponad rok od ostatniego wyniku, a ranking tygodnia dziewięć tygodni (bieżący i dwa miesiące wstecz). */
export const SEED_BOARD_TTL = 400 * DAY;
export const WEEK_BOARD_TTL = 63 * DAY;

/** Ile miejsc trzyma każdy ranking (reszta wypada przy kolejnym wpisie) i ile wierszy oddaje jedno zapytanie. */
export const BOARD_KEEP = 10_000;
export const BOARD_LIMIT_DEFAULT = 20;
export const BOARD_LIMIT_MAX = 100;

/** Granice zgłoszenia biegu: ciało żądania (Vercel i tak tnie przy 4,5 MB), liczba poleceń w dzienniku i rozmiar jednego polecenia. */
export const RUN_MAX_BODY_BYTES = 4_000_000;
export const RUN_MAX_LOG_ENTRIES = 100_000;
export const RUN_MAX_COMMAND_BYTES = 512;
/** Najdłuższy seed (punkty kodowe): 40 z pola na ekranie startowym i zapas na sąsiedni lokal (`seed·5`). */
export const RUN_MAX_SEED_CHARS = 48;
/** Ciało pozostałych żądań (klucz, nick, seed; zapis gry ma własny limit plus zapas na kopertę JSON). */
export const SMALL_BODY_BYTES = 4_096;
export const SAVE_BODY_BYTES = SAVE_MAX_BYTES * 2 + 1_024;

/** Okno limitu i liczba zgłoszeń w oknie: na klucz gracza i na adres (adres jako skrót z solą, która ginie razem z oknem). */
export interface RateLimit { window: number; perKey: number; perAddress: number }
export type RateAction = 'runs' | 'player' | 'saveUp' | 'saveDown';
export const RATE_LIMITS: Readonly<Record<RateAction, RateLimit>> = {
  runs: { window: 3_600, perKey: 12, perAddress: 30 },
  player: { window: 600, perKey: 60, perAddress: 120 },
  saveUp: { window: 3_600, perKey: 12, perAddress: 30 },
  saveDown: { window: 3_600, perKey: 30, perAddress: 60 },
};

/** Odpowiedź z rankingiem może poleżeć w pamięci podręcznej Vercela (wszyscy widzą to samo), zgłoszenia nigdy. */
export const BOARD_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=30';

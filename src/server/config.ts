/**
 * Liczby serwera rankingu w jednym miejscu: wersja generatora, którą serwer rozpoznaje, granice rozmiarów, czasy życia w bazie
 * i limity zgłoszeń. Wszystkie czasy w sekundach (Redis), chyba że nazwa mówi inaczej.
 */
import { SEED_NEIGHBOUR_MAX } from '../game/seedText.js';

/**
 * Wersje generatora sklepu (`GENERATOR_VERSION`), które serwer rozpoznaje przy zgłoszeniu: tani wczesny odrzut, zanim ruszy sędzia.
 * Sędzia i tak odtwarza bieg generatorem ze swojego bundla i rzuca przy innej wersji (`replay-failed`).
 *
 * Listy wersji gry tu nie ma. `gameVersion` z gry (`<package.json>+<12 znaków commita>`) zmienia się przy każdym wdrożeniu, więc
 * nie może decydować o przyjęciu biegu. Decyduje `simVersion` biegu: sędzia (`verify.ts`) przyjmuje go tylko wtedy, gdy równa się
 * `SIM_VERSION` z jego bundla, bo wtedy odtworzenie daje ten sam stan co w grze. Parser (`runs.ts`) tylko sprawdza kształt pola.
 */
export const KNOWN_GENERATOR_VERSIONS: readonly number[] = [1];

/**
 * Pierwsza minuta po sezonie rankingowym (`RANKED_SEASON_END_MINUTE` z `src/sim/ranked.ts`, test pilnuje równości). Kopia, bo
 * symulacja importuje się aliasem `@/`, którego funkcja serwerowa na Vercelu nie rozwiąże (patrz `redis.ts`).
 */
export const SEASON_END_MINUTE = 130_981;

/**
 * Ile sąsiednich lokali (`seed·1` … `seed·5`) gra próbuje, gdy generator nie składa sklepu z samego seeda (`resolveStore` w
 * `src/game/seeds.ts`). Tylko takie seedy gra produkuje z seeda tygodnia, więc tylko one liczą się do rankingu tygodnia.
 * Ta sama stała co w grze: `SEED_NEIGHBOUR_MAX` z `src/game/seedText.ts` (plik bez importów, więc funkcja Vercela go załaduje);
 * test pilnuje, że `resolveStore` próbuje dokładnie tyle sąsiadów.
 */
export const SEED_NEIGHBOURS = SEED_NEIGHBOUR_MAX;

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
 * waży ok. 10 KB, ale w najgorszym razie 300 wysłań po 64 KB to ok. 19,7 MB na dobę. Przy czasie życia zapisu 30 dni ciągłe
 * nadużycie wypełniłoby darmowe 256 MB Upstash w ok. 13 dni (stan ustalony ok. 590 MB), więc to wartość do przemyślenia przez
 * właściciela razem z alertem zużycia w Upstash (tańsze ryzyko: niższy budżet).
 */
export const SAVE_DAILY_BUDGET = 300;
/** Licznik budżetu dziennego żyje dobę od pierwszego wysłania (nazwa klucza ma dzień, więc stary licznik nikomu nie przeszkadza). */
export const BUDGET_TTL = DAY;
/** Ranking seeda żyje ponad rok od ostatniego wyniku, a ranking tygodnia dziewięć tygodni (bieżący i dwa miesiące wstecz). */
export const SEED_BOARD_TTL = 400 * DAY;
export const WEEK_BOARD_TTL = 63 * DAY;

/**
 * Ile miejsc trzyma każdy ranking (reszta wypada przy kolejnym wpisie) i ile wierszy oddaje jedno zapytanie. `limit` w zapytaniu
 * to dokładnie jedna z `BOARD_LIMITS`: pamięć podręczna Vercela kluczuje adresem z zapytaniem, więc każda inna liczba byłaby
 * osobnym wpisem, a atakujący miałby ich nieskończenie wiele i każdy szedłby do bazy.
 */
export const BOARD_KEEP = 10_000;
export const BOARD_LIMITS: readonly number[] = [10, 20, 50, 100];
export const BOARD_LIMIT_DEFAULT = 20;
export const BOARD_LIMIT_MAX = Math.max(...BOARD_LIMITS);

/** Granice zgłoszenia biegu: ciało żądania (Vercel i tak tnie przy 4,5 MB), liczba poleceń w dzienniku i rozmiar jednego polecenia. */
export const RUN_MAX_BODY_BYTES = 4_000_000;
export const RUN_MAX_LOG_ENTRIES = 100_000;
export const RUN_MAX_COMMAND_BYTES = 512;
/** Najdłuższa `gameVersion` (jednostki UTF-16, jak `String.length`): informacyjna, jedzie z biegiem, więc ma tylko rozsądną granicę (prawdziwa ma kilkanaście znaków). */
export const RUN_MAX_GAME_VERSION_CHARS = 100;
/** Najdłuższy seed (punkty kodowe): 40 z pola na ekranie startowym i zapas na sąsiedni lokal (`seed·5`). */
export const RUN_MAX_SEED_CHARS = 48;
/** Ciało pozostałych żądań (klucz, nick, seed; zapis gry ma własny limit plus zapas na kopertę JSON). */
export const SMALL_BODY_BYTES = 4_096;
export const SAVE_BODY_BYTES = SAVE_MAX_BYTES * 2 + 1_024;

/** Ile najwyżej czeka się na odpowiedź Upstash (ms): zawieszona baza nie ma trzymać funkcji do limitu platformy. */
export const UPSTASH_TIMEOUT_MS = 5_000;

/** Okno limitu i liczba zgłoszeń w oknie: na klucz gracza i na adres (adres jako skrót z solą, która ginie razem z oknem). */
export interface RateLimit { window: number; perKey: number; perAddress: number }
export type RateAction = 'runs' | 'player' | 'saveUp' | 'saveDown';
export const RATE_LIMITS: Readonly<Record<RateAction, RateLimit>> = {
  runs: { window: 3_600, perKey: 12, perAddress: 30 },
  player: { window: 600, perKey: 60, perAddress: 120 },
  saveUp: { window: 3_600, perKey: 12, perAddress: 30 },
  saveDown: { window: 3_600, perKey: 30, perAddress: 60 },
};

/**
 * Ile liczników najwyżej trzyma w pamięci jednej instancji bramka limitu (`createRateGate`); po przepełnieniu wypadają najstarsze.
 * Pamięć jest tylko przyspieszeniem: wypadnięty wpis oznacza jedno zapytanie do bazy więcej, a nie inną decyzję.
 */
export const RATE_GATE_MAX_ENTRIES = 10_000;

/**
 * Najkrótszy dopuszczalny sekret `RANKING_SALT` (znaki, jednostki UTF-16). Z sekretu liczy się HMAC skrótu adresu w limicie, a baza
 * (z liczbą skrótów adresów) jest w rękach osób trzecich, gdy wycieknie token: krótki sekret dałoby się odgadnąć razem z całą
 * przestrzenią adresów IPv4. Krótszy niż minimum to błąd konfiguracji (503), a nie ciche użycie słabego sekretu.
 */
export const RATE_SECRET_MIN_CHARS = 16;

/** Odpowiedź z rankingiem może poleżeć w pamięci podręcznej Vercela (wszyscy widzą to samo), zgłoszenia nigdy. */
export const BOARD_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=30';

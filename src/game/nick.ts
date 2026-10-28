/**
 * Nazwa gracza (spec §14.7). Czysta funkcja bez DOM i bez three: ekran startowy sprawdza nią to samo, co później serwer
 * rankingu, więc obie strony zgadzają się, co jest poprawnym nickiem. Nick ma przetrwać NFKC (pełnoszerokie „Ｍ” to „M”),
 * składa się wyłącznie z liter łacińskich z polskimi, cyfr, spacji i `_ - .` (cyrylickie „а” w „Mateusz” nie podszyje się
 * pod oryginał), ma od 1 do 20 znaków po normalizacji i nie jest nazwą zarezerwowaną.
 */

export const NICK_MAX = 20;

/** Komunikaty pod polem nazwy. */
export const NICK_ERRORS = {
  length: 'Nazwa może mieć od 1 do 20 znaków',
  chars: 'Dozwolone są litery, cyfry, spacja i znaki _ - .',
  reserved: 'Ta nazwa jest zarezerwowana',
} as const;

/** Nazwy zarezerwowane, bez względu na wielkość liter (porównanie po `nickKey`). */
export const RESERVED_NICKS: readonly string[] = ['centrala', 'traszka', 'admin', 'administrator', 'moderator', 'system'];

const ALLOWED = /^[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9 _.-]+$/;

export type NickResult = { nick: string } | { error: string };

/** Nick po przycięciu, NFKC i zwinięciu spacji (jeszcze niesprawdzony). */
const cleanNick = (raw: string): string => raw.normalize('NFKC').replace(/\s+/g, ' ').trim();

/**
 * Klucz porównań nicków: małe litery po NFKC i zwiniętych spacjach. Wielkość liter zostaje do wyświetlania, a dwa nicki
 * różniące się tylko nią to jeden nick (serwer rezerwuje klucz, nie zapis).
 */
export const nickKey = (nick: string): string => cleanNick(nick).toLowerCase();

/**
 * Sprawdza i normalizuje nick wpisany przez gracza. Zwraca `{ nick }` (przycięty, NFKC, zwinięte spacje, wielkość liter bez
 * zmian) albo `{ error }` z komunikatem dla gracza. Kolejność kontroli: pusty, niedozwolone znaki, za długi, zarezerwowany;
 * znaki idą przed długością, żeby 25 liter z emoji na końcu dostało wskazówkę o znakach, a nie o długości.
 */
export function normalizeNick(raw: string): NickResult {
  const nick = cleanNick(raw);
  if (nick.length === 0) return { error: NICK_ERRORS.length };
  if (!ALLOWED.test(nick)) return { error: NICK_ERRORS.chars };
  if (nick.length > NICK_MAX) return { error: NICK_ERRORS.length };
  if (RESERVED_NICKS.includes(nick.toLowerCase())) return { error: NICK_ERRORS.reserved };
  return { nick };
}

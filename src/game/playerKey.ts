import type { Meta, Player } from './meta';

/**
 * Klucz gracza (spec §14.7): tajne 100 bitów, które przeglądarka losuje raz i trzyma w mecie (`player.key`). Serwer rankingu
 * przechowuje tylko jego skrót SHA-256 i po nim poznaje właściciela nicka, więc gracz nie ma konta ani hasła. Ten sam klucz to
 * kod odzyskiwania: 20 znaków base32 Crockforda w pięciu grupach (`K7QX-9MBD-2HFA-P3WN-8RTE`), który przenosi nick i zapis na
 * inne urządzenie.
 *
 * Plik czyta także funkcja serwerowa (Vercel), więc importy w czasie działania są tylko względne z rozszerzeniem `.js`
 * (tu żadnych: z mety bierzemy same typy).
 */

/** Długość klucza w znakach: 20 znaków po 5 bitów to 100 bitów. */
export const KEY_LENGTH = 20;

/** Alfabet base32 Crockforda: cyfry i wielkie litery bez I, L, O, U (nie mylą się z 1, 0 ani ze sobą). */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Komunikaty panelu „Kod odzyskiwania”. */
export const RECOVERY_ERRORS = {
  invalid: 'To nie jest kod odzyskiwania: 20 liter i cyfr, np. K7QX-9MBD-2HFA-P3WN-8RTE',
  noPlayer: 'Najpierw otwórz sklep: kod przypisujemy do kasjera',
  readOnly: 'Ta karta ma metę z nowszej wersji gry, więc kodu tu nie zapiszemy. Odśwież stronę.',
} as const;

/** Losowe bajty (do podmiany w testach). */
export type RandomBytes = (n: number) => Uint8Array;
const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/**
 * Nowy klucz: 20 bajtów z `crypto.getRandomValues`, z każdego dolne 5 bitów (256 to wielokrotność 32, więc każdy znak ma te same
 * szanse). Postać kanoniczna: 20 znaków z `CROCKFORD`, bez łączników.
 */
export function generatePlayerKey(random: RandomBytes = cryptoBytes): string {
  return Array.from(random(KEY_LENGTH), (b) => CROCKFORD[b & 31]).join('');
}

/** Najdłuższy tekst, który w ogóle próbujemy czytać jako kod (z odstępami i łącznikami z zapasem). */
const MAX_INPUT = 64;
/** Spacje i łączniki dowolnego rodzaju (z klawiatury telefonu przychodzą półpauza i minus) nic nie znaczą. */
const SEPARATORS = /[\s\-‐-―−]/g;
/** Znaki podobne z alfabetu Crockforda: O to zero, I i L to jedynka. */
const LOOKALIKE: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };

/**
 * Kod odzyskiwania wpisany przez gracza (albo klucz z zapisu, albo pole z żądania do serwera) → klucz w postaci kanonicznej albo
 * null. Wielkość liter, spacje i łączniki nie mają znaczenia, znaki pełnej szerokości przechodzą przez NFKC, a O, I i L
 * czytamy jak 0, 1 i 1. Litera spoza alfabetu (U) albo zła długość to null.
 */
export function parseRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_INPUT) return null;
  const chars = Array.from(raw.normalize('NFKC').replace(SEPARATORS, '').toUpperCase(), (c) => LOOKALIKE[c] ?? c);
  if (chars.length !== KEY_LENGTH || !chars.every((c) => CROCKFORD.includes(c))) return null;
  return chars.join('');
}

/** Klucz jako kod do zapisania: pięć grup po cztery znaki („K7QX-9MBD-2HFA-P3WN-8RTE”). */
export function formatRecoveryCode(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') ?? key;
}

/**
 * Klucz dla gracza, który go jeszcze nie ma (pierwsze wejście albo meta sprzed rankingu). Zwraca nową metę z kluczem, a gdy nie
 * ma czego dodać, tę samą (wołający porównuje i zapisuje): poprawny zapisany klucz nigdy nie jest zastępowany, bez gracza nie ma
 * go gdzie trzymać, a meta z nowszej wersji gry i tak się nie zapisze, więc klucz zginąłby po odświeżeniu.
 */
export function ensurePlayerKey(meta: Meta, generate: () => string = generatePlayerKey): Meta {
  if (meta.readOnly || !meta.player || meta.player.key !== undefined) return meta;
  return { ...meta, player: { ...meta.player, key: generate() } };
}

/**
 * Gracz z ekranu „Nowy sklep” (`playerOf` nie zna klucza) z kluczem poprzedniego gracza: bez tego zmiana nicka albo kasjera
 * zgubiłaby klucz, a z nim wszystkie nicki gracza w rankingu. Klucz z wyboru (np. po wpisaniu kodu) wygrywa.
 */
export function keepPlayerKey(prev: Player | undefined, next: Player): Player {
  return next.key === undefined && prev?.key !== undefined ? { ...next, key: prev.key } : next;
}

/** Wynik wpisania kodu: nowa meta (wołający zapisuje) albo komunikat dla gracza. */
export type AdoptResult = { meta: Meta } | { error: string };

/**
 * Kod odzyskiwania wpisany na tym urządzeniu zastępuje tutejszy klucz (tylko na wyraźne polecenie z panelu, po potwierdzeniu):
 * od teraz to urządzenie jest właścicielem nicków tamtego klucza. Nick, kasjer i reszta mety zostają.
 */
export function adoptRecoveryCode(meta: Meta, code: string): AdoptResult {
  const key = parseRecoveryCode(code);
  if (key === null) return { error: RECOVERY_ERRORS.invalid };
  if (meta.readOnly) return { error: RECOVERY_ERRORS.readOnly };
  if (!meta.player) return { error: RECOVERY_ERRORS.noPlayer };
  return { meta: { ...meta, player: { ...meta.player, key } } };
}

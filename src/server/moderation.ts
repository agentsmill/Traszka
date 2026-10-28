import { BANNED_ROOTS } from './bannedWords.js';

/**
 * Filtr zakazanych słów dla nicków i seedów. Działa na szkielecie tekstu, żeby „K.u-r_w a”, „Kurvа” czy „qrwa” nie przeszły
 * obok listy: NFKD bez znaków diakrytycznych (i „ł” jako „l”), małe litery, cyfry i znaki „leet” jako litery, bez wszystkiego,
 * co nie jest literą. Rdzeń pasuje, gdy jest fragmentem szkieletu albo (gdy sam nie ma podwójnych liter) szkieletu ze zwiniętymi
 * powtórzeniami („kuuurwa”); rdzeń z podwójną literą zwinięty zmieniłby się w inne słowo („nigger” w nazwę państwa).
 * Reguły samego nicka (znaki, długość, nazwy zarezerwowane) sprawdza `normalizeNick` z gry, przed tym filtrem.
 */

/** Cyfry i znaki udające litery. `v` to `w` („kurva”), cyrylica podobna do łaciny wraca do łaciny. */
const LEET: Readonly<Record<string, string>> = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', v: 'w',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
};

/** Tekst sprowadzony do liter łacińskich bez znaków diakrytycznych, do porównań z listą. */
export function skeleton(text: string): string {
  return Array.from(text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/ł/g, 'l'), (c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}

const collapse = (s: string): string => s.replace(/(.)\1+/g, '$1');

/** Czy tekst (nick albo seed) zawiera zakazane słowo. */
export function isBanned(text: string, roots: readonly string[] = BANNED_ROOTS): boolean {
  const plain = skeleton(text);
  const squeezed = collapse(plain);
  return roots.some((r) => plain.includes(r) || (r === collapse(r) && squeezed.includes(r)));
}

import { exactEntries, patternRules, type Rule } from './dict';

/*
 * Tłumacz gotowych zdań na angielski. Symulacja (`src/sim`, nietykalna: sędzia rankingu odtwarza ją bit w bit) i warstwa gry
 * składają komunikaty po polsku, z liczbami w środku („Dzień zamknięty: 312 klientów…”). Tu rozpoznajemy je przy wyświetlaniu:
 * najpierw dokładny napis (stałe, nazwy z danych gry), potem wzorce zbudowane z polskich szablonów, w których każde `{}` to
 * przechwycony kawałek. Angielska funkcja wzorca dostaje te kawałki jako napisy (liczby w polskim zapisie, polskie słowa) i sama
 * je przekłada (`plNum`, `tr`). Tekst kilkuwierszowy tłumaczy się wiersz po wierszu. Wynik `null`: nie znamy tego zdania.
 */

interface Compiled { re: RegExp; rule: Rule }

let compiled: Compiled[] | null = null;
const cache = new Map<string, string | null>();
const CACHE_MAX = 2000;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wyrażenie z polskiego szablonu: `{}` łapie dowolny (także pusty) kawałek, reszta dosłownie, od początku do końca napisu. */
export function patternOf(pl: string): RegExp {
  return new RegExp(`^${escape(pl).replace(/\\\{\\\}/g, '(.*?)')}$`, 's');
}

function rules(): Compiled[] {
  return compiled ??= patternRules((pl) => localizeEn(pl) ?? pl).map((rule) => ({ re: rule.re ?? patternOf(rule.pl), rule }));
}

function translateLine(text: string): string | null {
  const exact = exactEntries().get(text);
  if (exact !== undefined) return exact;
  for (const { re, rule } of rules()) {
    const m = re.exec(text);
    if (!m) continue;
    const parts = m.slice(1);
    if (typeof rule.en === 'function') return rule.en(...parts);
    let k = 0;
    return (rule.en ?? text).replace(/\{\}/g, () => parts[k++] ?? '');
  }
  return null;
}

/** Angielska wersja polskiego zdania albo null, gdy go nie znamy. */
export function localizeEn(text: string): string | null {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let out = translateLine(text);
  if (out === null && text.includes('\n')) {
    const lines = text.split('\n').map((l) => ({ l, en: translateLine(l) }));
    if (lines.some((x) => x.en !== null)) out = lines.map((x) => x.en ?? x.l).join('\n');
  }
  if (out === null) {
    // emoji albo znak na początku („🔓 Kasa samoobsługowa”, „⚠ …”): tłumaczymy resztę
    const m = /^(\p{Extended_Pictographic}️?\s+)(.+)$/u.exec(text);
    const rest = m ? translateLine(m[2]!) : null;
    if (rest !== null) out = m![1] + rest;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, out);
  return out;
}

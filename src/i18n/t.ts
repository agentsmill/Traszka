import { lang } from './lang';
import { EN_UI, type Entry } from './en/ui';
import { localizeEn } from './messages';

/*
 * Tłumaczenie tekstów wpisanych w komponenty. Kluczem jest polski tekst (jak `msgid` w gettext): polski kod zostaje czytelny,
 * a wersja polska to dokładnie ten sam napis co przed tłumaczeniem. Szablon `t\`Dzień ${d}\`` ma klucz „Dzień {0}”; angielski wpis
 * to napis z `{0}`, `{1}`… albo funkcja wartości (odmiana, inny szyk zdania). Białe znaki na początku i końcu szablonu nie należą do
 * klucza: wraca je wynik, więc fragmenty tekstu między znacznikami JSX sklejają się tak samo w obu językach.
 * Klucze bez angielskiego wpisu zostają po polsku; test zgodności kluczy (`tests/i18n.test.ts`) pilnuje, żeby takich nie było.
 */

interface TemplateKey { key: string; lead: string; trail: string }

const keys = new WeakMap<TemplateStringsArray, TemplateKey>();

/** Klucz szablonu: kawałki tekstu z `{0}`, `{1}`… w miejscu wartości, bez białych znaków na brzegach. */
export function templateKey(strings: readonly string[]): TemplateKey {
  const joined = strings.reduce((acc, s, i) => (i === 0 ? s : `${acc}{${i - 1}}${s}`), '');
  const lead = /^\s*/.exec(joined)![0];
  const trail = joined.length > lead.length ? /\s*$/.exec(joined)![0] : '';
  return { key: joined.slice(lead.length, joined.length - trail.length), lead, trail };
}

function keyOf(strings: TemplateStringsArray): TemplateKey {
  let k = keys.get(strings);
  if (!k) keys.set(strings, k = templateKey(strings));
  return k;
}

/** Wpis słownika zastosowany do wartości: funkcja dostaje wartości tak, jak stoją w szablonie; napis ma je w `{0}`, `{1}`… */
export function applyEntry(entry: Entry, values: readonly unknown[]): string {
  if (typeof entry === 'function') return entry(...values);
  return values.length === 0 ? entry : entry.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < values.length ? String(values[Number(i)]) : m));
}

/** Szablon po polsku, tak jak zwykły szablon JS (wartości przez `String`). */
const plain = (strings: readonly string[], values: readonly unknown[]): string =>
  strings.reduce((acc, s, i) => (i === 0 ? s : acc + String(values[i - 1]) + s), '');

/** Tłumaczy szablon tekstu z interfejsu na bieżący język (w polskim zwraca dokładnie to, co dałby zwykły szablon). */
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  if (lang.value === 'pl') return plain(strings, values);
  const { key, lead, trail } = keyOf(strings);
  const entry = EN_UI[key];
  if (entry === undefined) return plain(strings, values);
  return lead + applyEntry(entry, values) + trail;
}

/**
 * Gotowy polski napis w bieżącym języku: stałe interfejsu (`EPHEMERAL_NOTE`…), nazwy z danych gry (karty, ulepszenia, cele…)
 * i zdania, które składa symulacja albo warstwa gry (toasty, okna „OK”, komunikaty). W polskim zwraca napis bez zmian; napis bez
 * tłumaczenia też zostaje, jaki był.
 */
export function tr(text: string): string;
export function tr(text: string | null): string | null;
export function tr(text: string | undefined): string | undefined;
export function tr(text: string | null | undefined): string | null | undefined {
  if (lang.value === 'pl' || !text) return text;
  return localizeEn(text) ?? text;
}

import { signal, type Signal } from '@preact/signals';

/*
 * Język interfejsu. Polski jest językiem źródłowym gry: teksty zostają tam, gdzie były (symulacja, komponenty), a angielski to
 * nakładka (`src/i18n/en/*`), z której warstwa interfejsu bierze tekst przy wyświetlaniu. Język NIE jest częścią zapisu gry ani
 * dziennika biegu rankingowego: zmienia tylko to, co widać na ekranie, więc odtworzenie biegu na serwerze daje ten sam wynik.
 */

export type Lang = 'pl' | 'en';
export const LANGS: readonly Lang[] = ['pl', 'en'];

/** Klucz w `localStorage`. Osobny od kluczy zapisu (`traszka:save:*`, `traszka:meta`…), więc nie jedzie z kodem odzyskiwania. */
export const LANG_KEY = 'traszka:lang';

/**
 * Bieżący język. Startuje jako polski: testy i kod bez `initLang` widzą grę dokładnie taką jak przed tłumaczeniem. Komponenty, które
 * czytają tekst przez `t`/`tr`, czytają też ten sygnał, więc przełącznik odświeża je sam.
 */
export const lang: Signal<Lang> = signal<Lang>('pl');

/** Czy wyświetlamy angielski (skrót do warunków w komponentach). */
export const isEn = (): boolean => lang.value === 'en';

/** Locale do `toLocaleString` i `Intl`: polski zapis (spacja tysięcy, przecinek) albo brytyjski (przecinek tysięcy, kropka). */
export const numberLocale = (): string => (lang.value === 'en' ? 'en-GB' : 'pl-PL');

/** Język z ustawień przeglądarki: pierwszy preferowany zaczyna się od `pl` → polski, każdy inny → angielski, brak danych → polski. */
export function detectLang(languages: readonly string[] | undefined | null): Lang {
  const first = languages?.find((l) => typeof l === 'string' && l !== '');
  if (!first) return 'pl';
  return first.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

const isLang = (v: unknown): v is Lang => v === 'pl' || v === 'en';

/** Zapamiętany wybór gracza albo null (brak, inna wartość, zablokowany `localStorage`). */
export function storedLang(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Lang | null {
  try {
    const v = storage?.getItem(LANG_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  const list = Array.isArray(navigator.languages) ? navigator.languages : [];
  return list.length > 0 ? list : navigator.language ? [navigator.language] : [];
}

/** Opis strony dla wyszukiwarek i podglądu linku (meta `description`) w obu językach. */
export const PAGE_DESCRIPTION: Record<Lang, string> = {
  pl: 'Satyryczny tycoon sklepu convenience w przeglądarce: palety, kolejki, kasy samoobsługowe i Centrala.',
  en: 'A satirical convenience-shop tycoon in your browser: pallets, queues, self-checkouts and Head Office.',
};

/** `lang` na `<html>` i opis strony: czytniki ekranu i tłumacze przeglądarki wiedzą, w jakim języku jest tekst. */
function applyToDocument(next: Lang): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = next;
  document.querySelector('meta[name="description"]')?.setAttribute('content', PAGE_DESCRIPTION[next]);
}

/** Rozruch: zapamiętany wybór, a bez niego język przeglądarki. Woła to main.ts przed pierwszym rysowaniem nakładki. */
export function initLang(): Lang {
  const next = storedLang() ?? detectLang(browserLanguages());
  lang.value = next;
  applyToDocument(next);
  return next;
}

/** Wybór gracza (przełącznik na ekranie startowym i w ⚙): sygnał, dokument i `localStorage`. */
export function setLang(next: Lang): void {
  lang.value = next;
  applyToDocument(next);
  try {
    safeStorage()?.setItem(LANG_KEY, next);
  } catch {
    // tryb prywatny albo brak miejsca: wybór działa do zamknięcia karty
  }
}

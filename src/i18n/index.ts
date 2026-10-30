import { dateOfDay, formatDate, formatMonth } from '@/sim/economy/calendar';
import { rankFor } from '@/sim/economy/progress';
import { hintText, type ReportHint } from '@/sim/economy/tycoon/report';
import { kpiTitle, type KpiKind } from '@/sim/economy/tycoon/kpi';
import { EN_HINTS, EN_KPI_TITLE, EN_MONTH_NAME, EN_RANKS, EN_WEEKDAY_SHORT } from './en/content';
import { EN_PLURALS } from './en/ui';
import { lang } from './lang';

/*
 * Wejście do tłumaczenia dla reszty gry. Polski jest językiem źródłowym: każda funkcja tutaj w polskim zwraca dokładnie to, co
 * dawał kod przed tłumaczeniem (te same funkcje symulacji, ten sam zapis liczb), a w angielskim tekst z nakładki `src/i18n/en`.
 */

export { LANGS, LANG_KEY, detectLang, initLang, isEn, lang, numberLocale, setLang, type Lang } from './lang';
export { t, tr } from './t';

/** Data dnia gry: „wt 1 września” albo „Tue 1 September”. */
export function dateText(day: number): string {
  if (lang.value === 'pl') return formatDate(day);
  const d = dateOfDay(day);
  return `${EN_WEEKDAY_SHORT[d.weekday]} ${d.date} ${EN_MONTH_NAME[d.month]}`;
}

/** Miesiąc gry: „wrzesień 2026” albo „September 2026”. */
export function monthText(day: number): string {
  if (lang.value === 'pl') return formatMonth(day);
  const d = dateOfDay(day);
  return `${EN_MONTH_NAME[d.month]} ${d.year}`;
}

/** Ranga gracza (`rankFor`): nazwa palety z gwiazdkami i „+N” po 60. poziomie zostają, tłumaczy się sama nazwa. */
export function rankText(level: number): string {
  const pl = rankFor(level);
  if (lang.value === 'pl') return pl;
  let best = '';
  let en = '';
  for (const [from, name] of Object.entries(EN_RANKS)) {
    const base = rankFor(Number(from));
    if (pl.startsWith(base) && base.length > best.length) { best = base; en = name; }
  }
  return best ? en + pl.slice(best.length) : pl;
}

/** Cel KPI tygodnia (`kpiTitle`); `fmt` formatuje cel (w interfejsie: liczba w zapisie bieżącego języka). */
export function kpiTitleText(kind: KpiKind, target: number, fmt: (n: number) => string): string {
  return lang.value === 'pl' ? kpiTitle(kind, target, fmt) : EN_KPI_TITLE[kind](fmt(target));
}

/** Wskazówka raportu miesiąca (`hintText`). */
export function hintTextOf(h: Pick<ReportHint, 'id' | 'value'>, fmt: (n: number) => string): string {
  return lang.value === 'pl' ? hintText(h, fmt) : EN_HINTS[h.id](fmt(h.value));
}

/**
 * Odmiana do `plural` z `ui/game/format.ts`: po angielsku liczba pojedyncza dla 1, mnoga dla reszty, z tabeli `EN_PLURALS` pod
 * kluczem z trzech polskich form („osoba|osoby|osób”). Brak wpisu: null (wtedy zostaje polska odmiana).
 */
export function enPluralOf(n: number, one: string, few: string, many: string): string | null {
  if (lang.value === 'pl') return null;
  const forms = EN_PLURALS[`${one}|${few}|${many}`];
  return forms ? (Math.abs(n) === 1 ? forms[0] : forms[1]) : null;
}

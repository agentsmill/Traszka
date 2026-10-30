import { isRec, num, whole, type Rec } from '@/sim/guards';
import { WAGE_PER_DAY } from '../catalog';
import { rand01 } from '../rand';
import { CH } from './channels';
import { STAFF_TASKS, type StaffStats } from './staff';
import { TRUST_REASONS, type TrustMonth, type TrustReason } from './trust';
import { OPEN_MINUTES } from './time';

/**
 * Raport miesięczny jako puls gry (spec §7.5): wynik po pozycjach (marża, premie, płace, media, ZUS, VAT, księgowa, mandaty,
 * palety, remanent i inne; wynik bez rat, jak w wyciągu od Centrali; raporty sprzed SIM_VERSION 6 mają opłatę i miesięczne ubytki), zmiana zaufania z przyczynami,
 * komentarz Centrali i jedna wskazówka, co poprawić. Raport w stanie gry to same liczby i identyfikatory: teksty
 * i formatowanie liczb robi interfejs (`reportCommentText`, `hintText`).
 */

export type ReportLineKey = 'marza' | 'premie' | 'gwarancja' | 'inne' | 'place' | 'media' | 'zus' | 'vat' | 'ksiegowa' | 'oplata' | 'mandaty'
  | 'wut' | 'logistyka' | 'remanent';
export const REPORT_LINES: readonly ReportLineKey[] = ['marza', 'premie', 'gwarancja', 'inne', 'place', 'media', 'zus', 'vat', 'ksiegowa', 'oplata',
  'mandaty', 'wut', 'logistyka', 'remanent'];
export const REPORT_LINE_LABEL: Record<ReportLineKey, string> = {
  marza: 'Marża ze sprzedaży',
  premie: 'Premie Centrali',
  gwarancja: 'Dopłata do przychodu gwarantowanego',
  inne: 'Inne przychody i koszty',
  place: 'Płace',
  media: 'Media',
  zus: 'ZUS',
  vat: 'VAT',
  ksiegowa: 'Księgowa',
  oplata: 'Opłata franczyzowa',
  mandaty: 'Mandaty i kary',
  wut: 'Ubytki ponad limit Centrali',
  logistyka: 'Palety ponad darmowe',
  remanent: 'Remanent: ubytki ponad limit',
};

/** Liczby miesiąca. Koszty jako kwoty dodatnie, `other` ze znakiem (inne przychody minus inne koszty). */
export interface MonthFigures {
  revenue: number;
  margin: number;
  /** Premie Centrali razem z dopłatą do gwarancji (licznik `bonus`). */
  bonuses: number;
  /** W tym dopłata do przychodu gwarantowanego (osobna pozycja raportu, gdy jest). Brak pola: 0. */
  guarantee?: number;
  other: number;
  wages: number;
  media: number;
  /** Koszty własne franczyzobiorcy (od SIM_VERSION 6; brak pola w raportach sprzed: 0). */
  zus?: number;
  vat?: number;
  accounting?: number;
  /** Opłata franczyzowa i miesięczne ubytki ponad limit: tylko raporty sprzed SIM_VERSION 6 (od niej 0). */
  fee: number;
  fines: number;
  wut: number;
  logistics: number;
  /** Nadwyżka z remanentu potrącona w tym miesiącu (od SIM_VERSION 6). */
  remanent?: number;
  customers: number;
  lost: number;
}

export interface ReportInput {
  /** Numer miesiąca gry (0 = wrzesień 2026): do wyboru komentarza. */
  monthIndex: number;
  figures: MonthFigures;
  trust: TrustMonth;
  cleanlinessAvg: number;
  staff: StaffStats;
  /** Dni w miesiącu i średnia liczba osób na zmianie (do oceny bezczynności). */
  days: number;
  staffCount: number;
  exhaustedDays: number;
  kpi: { hit: number; miss: number };
  /** Karty: odpowiedzi w miesiącu, w tym zatwierdzone odpowiedzi domyślne. */
  cards: { answered: number; defaults: number };
  /** Marża z jednego klienta (do wyceny klientów odstraszonych kolejką). */
  marginPerCustomer: number;
}

export type HintId = 'mandaty' | 'wut' | 'logistyka' | 'kolejka' | 'czystosc' | 'bezczynnosc' | 'braki' | 'zmeczenie'
  | 'zaufanie' | 'karty' | 'kpi' | 'brawo';
export const HINT_IDS: readonly HintId[] = ['mandaty', 'wut', 'logistyka', 'kolejka', 'czystosc', 'bezczynnosc', 'braki', 'zmeczenie',
  'zaufanie', 'karty', 'kpi', 'brawo'];

export interface ReportHint {
  id: HintId;
  /** Liczba do tekstu (zł, klienci, godziny, punkty, dni), zależnie od wskazówki. */
  value: number;
  /** Ile ta sprawa kosztowała w miesiącu (zł, szacunek): po tym wybieramy jedną wskazówkę. */
  impact: number;
}

export type CommentPool = 'strata' | 'zero' | 'plus' | 'rekord';

export interface TycoonMonthReport {
  monthIndex: number;
  lines: { key: ReportLineKey; amount: number }[];
  result: number;
  revenue: number;
  trust: TrustMonth;
  cleanlinessAvg: number;
  kpi: { hit: number; miss: number };
  commentId: string;
  hint: ReportHint;
}

/** Progi puli komentarza (zł wyniku miesiąca). */
export const COMMENT_THRESHOLDS = { zero: 0, plus: 5000, rekord: 30_000 } as const;

export const COMMENTS: Record<CommentPool, readonly string[]> = {
  strata: [
    'Miesiąc na minusie. Centrala proponuje szkolenie „Jak zarabiać więcej, wydając mniej” (płatne).',
    'Centrala z niepokojem obserwuje Twój wynik i przypomina, że wierzymy w Ciebie. Na razie.',
    'Wynik ujemny to też wynik. Centrala pokaże go w prezentacji „Wyzwania sieci” na slajdzie 47.',
  ],
  zero: [
    'Wyszło na zero. Centrala nazywa to „stabilnością” i podnosi KPI na przyszły miesiąc.',
    'Ani zysk, ani strata. Centrala gratuluje równowagi jak w jodze. Księgowa też chce swoje.',
    'Prawie na plusie. Centrala sugeruje, żeby „prawie” zamienić na „bardziej”.',
  ],
  plus: [
    'Jest dodatnio! Centrala gratuluje i podnosi KPI na przyszły miesiąc.',
    'Dobry miesiąc. Centrala rozważa wspomnienie o Tobie w newsletterze (strona 14).',
    'Wynik na plusie. Centrala przypisuje to swojej nowej strategii, ale Ty wiesz swoje.',
  ],
  rekord: [
    'Rekordowy miesiąc! Centrala przypisuje sukces nowej strategii Centrali.',
    'Świetny wynik. Centrala pyta, czy nie chcesz otworzyć drugiej Traszki naprzeciwko pierwszej.',
    'Imponujące. Centrala przesyła dyplom w PDF i ankietę satysfakcji na 40 pytań.',
  ],
};

export function commentPool(result: number): CommentPool {
  if (result < COMMENT_THRESHOLDS.zero) return 'strata';
  if (result < COMMENT_THRESHOLDS.plus) return 'zero';
  if (result < COMMENT_THRESHOLDS.rekord) return 'plus';
  return 'rekord';
}

/** Tekst komentarza po identyfikatorze `pula-numer` (nieznany identyfikator: pusty tekst). */
export function reportCommentText(id: string): string {
  const [pool, i] = id.split('-');
  return COMMENTS[pool as CommentPool]?.[Number(i)] ?? '';
}

const WAGE_PER_MINUTE = WAGE_PER_DAY / OPEN_MINUTES;

/** Kandydaci na wskazówkę z oszacowanym kosztem w zł; wygrywa największy (przy remisie wcześniejszy). */
export function hintCandidates(r: ReportInput): ReportHint[] {
  const f = r.figures;
  const sum = (x: Record<string, number>): number => STAFF_TASKS.reduce((n, t) => n + (x[t] ?? 0), 0);
  const worked = sum(r.staff.worked) - sum(r.staff.robot);
  const paid = worked + r.staff.idle + r.staff.chores;
  // kasa ma własną wskazówkę („kolejka”), a sprzątanie swoją („czystość”): tu tylko towar, który czekał na ręce
  const starved = r.staff.starved.rozladunek + r.staff.starved.wykladanie;
  const out: ReportHint[] = [
    { id: 'mandaty', value: f.fines, impact: f.fines },
    { id: 'wut', value: f.wut + (f.remanent ?? 0), impact: f.wut + (f.remanent ?? 0) },
    { id: 'logistyka', value: f.logistics, impact: f.logistics },
    { id: 'kolejka', value: f.lost, impact: f.lost * r.marginPerCustomer },
    { id: 'czystosc', value: r.cleanlinessAvg, impact: Math.max(0, 70 - r.cleanlinessAvg) * 0.001 * f.margin },
    // bezczynność ponad ćwierć opłaconego czasu to pieniądze za stanie
    { id: 'bezczynnosc', value: r.staff.idle / 60, impact: paid > 0 && r.staff.idle > 0.4 * paid ? (r.staff.idle - 0.25 * paid) * WAGE_PER_MINUTE : 0 },
    // minuty, w których palety albo półki nie dostały nikogo: ćwierć płacy za te minuty (szkoda jest głównie w mandatach
    // i pustych półkach, które mają własne pozycje, więc to wskazówka „na drugim miejscu”)
    { id: 'braki', value: starved / 60, impact: starved * WAGE_PER_MINUTE * 0.25 },
    { id: 'zmeczenie', value: r.exhaustedDays, impact: r.exhaustedDays >= 5 ? r.exhaustedDays * 40 : 0 },
    { id: 'zaufanie', value: -r.trust.delta, impact: r.trust.delta < -3 ? -r.trust.delta * 150 : 0 },
    // odpowiedź zaznaczona z góry to zwykle „nic nie robię”: rzadko najlepsza
    { id: 'karty', value: r.cards.defaults, impact: r.cards.defaults > r.cards.answered / 2 ? r.cards.defaults * 60 : 0 },
    { id: 'kpi', value: r.kpi.miss, impact: r.kpi.miss >= 2 && r.kpi.hit === 0 ? r.kpi.miss * 200 : 0 },
  ];
  return out;
}

/** Jedna wskazówka: sprawa, która w tym miesiącu kosztowała najwięcej; gdy nic nie boli (mniej niż 300 zł), „brawo”. */
export function pickHint(r: ReportInput): ReportHint {
  let best: ReportHint = { id: 'brawo', value: 0, impact: 300 };
  for (const c of hintCandidates(r)) if (c.impact > best.impact) best = c;
  return best;
}

export function buildMonthReport(r: ReportInput, seedHash: number): TycoonMonthReport {
  const f = r.figures;
  // koszty jako 0 − x, a nie −x: −0 nie przeżywa JSON-a, a raport ma wracać z zapisu bez zmian
  // pozycje zerowe z innej wersji symulacji (opłata i miesięczne ubytki sprzed SIM_VERSION 6, koszty własne i remanent od niej) się nie pokazują
  const optional = (key: ReportLineKey, amount: number): TycoonMonthReport['lines'] => (amount !== 0 ? [{ key, amount: 0 - amount }] : []);
  const lines: TycoonMonthReport['lines'] = [
    { key: 'marza', amount: f.margin },
    { key: 'premie', amount: f.bonuses - (f.guarantee ?? 0) },
    ...((f.guarantee ?? 0) > 0 ? [{ key: 'gwarancja' as const, amount: f.guarantee! }] : []),
    { key: 'inne', amount: f.other },
    { key: 'place', amount: 0 - f.wages },
    { key: 'media', amount: 0 - f.media },
    ...optional('zus', f.zus ?? 0),
    ...optional('vat', f.vat ?? 0),
    ...optional('ksiegowa', f.accounting ?? 0),
    ...optional('oplata', f.fee),
    { key: 'mandaty', amount: 0 - f.fines },
    ...optional('wut', f.wut),
    { key: 'logistyka', amount: 0 - f.logistics },
    ...optional('remanent', f.remanent ?? 0),
  ];
  const result = lines.reduce((n, l) => n + l.amount, 0);
  const pool = commentPool(result);
  const i = Math.floor(rand01(seedHash, r.monthIndex, CH.comment) * COMMENTS[pool].length);
  return {
    monthIndex: r.monthIndex,
    lines,
    result,
    revenue: f.revenue,
    trust: r.trust,
    cleanlinessAvg: r.cleanlinessAvg,
    kpi: { ...r.kpi },
    commentId: `${pool}-${i}`,
    hint: pickHint(r),
  };
}

/** Tekst wskazówki; `fmt` formatuje liczby (interfejs podaje polskie formatowanie). */
export function hintText(h: Pick<ReportHint, 'id' | 'value'>, fmt: (n: number) => string = (n) => String(Math.round(n))): string {
  const v = fmt(h.value);
  switch (h.id) {
    case 'mandaty': return `Mandaty kosztowały ${v} zł. Rano ustaw profil „Dostawa”, żeby palety nie stały na chodniku po godzinie tolerancji.`;
    case 'wut': return `Remanent: ubytki ponad limit Centrali ${v} zł. Zamawiaj tyle, ile schodzi, a o 18:00 przeceniaj kanapki (FEFO), zanim trafią do kosza.`;
    case 'logistyka': return `Palety ponad darmowe: ${v} zł potrącone z przelewu. Asystent przesadza z zamówieniem; spróbuj zamawiać ręcznie.`;
    case 'kolejka': return `Kolejka odstraszyła ${v} klientów. W szczycie ustaw profil „Kolejka” albo postaw kasę samoobsługową.`;
    case 'czystosc': return `Średnia czystość sali: ${v}%. Ustaw profil „Porządek” albo przypnij kogoś do sprzątania, zanim przyjdzie audyt albo tajemniczy klient.`;
    case 'bezczynnosc': return `Ludzie stali bez zadania przez ${v} godz. Może jedna osoba mniej na zmianie?`;
    case 'braki': return `Zadania czekały na ludzi przez ${v} godz. Zatrudnij kogoś albo kup automatykę z warsztatu.`;
    case 'zmeczenie': return `Ręce odmówiły posłuszeństwa w ${v} dni. Noc odnawia tylko część sił: odpuść stukanie choć dzień w tygodniu.`;
    case 'zaufanie': return `Zaufanie Centrali spadło o ${v} pkt. KPI tygodnia i odpowiedzi na okólniki to najtańszy sposób, żeby je odbudować.`;
    case 'karty': return `${v} razy zatwierdzona odpowiedź zaznaczona z góry. Rzadko jest najlepsza: przeczytaj kartę, zanim klikniesz.`;
    case 'kpi': return `Nietrafione KPI tygodnia: ${v}. Sprawdzaj cel w poniedziałek, zanim tydzień ucieknie.`;
    case 'brawo': return 'Wszystko gra. Centrala i tak podniesie KPI, ale to już jej problem.';
  }
}

// --- Zapis -------------------------------------------------------------------------------------------

/** Wczytanie raportu z zapisu (np. ostatni raport w stanie gry). Uszkodzony raport to null. */
export function sanitizeReport(raw: unknown): TycoonMonthReport | null {
  if (!isRec(raw) || !Array.isArray(raw.lines)) return null;
  const lines = raw.lines.filter(isRec).filter((l) => REPORT_LINES.includes(l.key as ReportLineKey))
    .map((l) => ({ key: l.key as ReportLineKey, amount: num(l.amount, 0, -1e60, 1e60) }));
  const t: Rec = isRec(raw.trust) ? raw.trust : {};
  const h: Rec = isRec(raw.hint) ? raw.hint : {};
  const k: Rec = isRec(raw.kpi) ? raw.kpi : {};
  // zmiana zaufania z jednej przyczyny mieści się w ±100, jak w `TrustState.month` (zapis ręcznie zmieniony nie przeniesie 1e308 dalej)
  const reasons = Array.isArray(t.reasons) ? t.reasons.filter((x): x is [TrustReason, number] => Array.isArray(x)
    && TRUST_REASONS.includes(x[0] as TrustReason) && typeof x[1] === 'number' && Number.isFinite(x[1]))
    .map(([r, v]): [TrustReason, number] => [r, num(v, 0, -100, 100)]) : [];
  return {
    monthIndex: whole(raw.monthIndex, 0, 0, 12_000),
    lines,
    result: lines.reduce((n, l) => n + l.amount, 0),
    revenue: num(raw.revenue, 0, 0, 1e60),
    trust: { start: num(t.start, 0, 0, 100), end: num(t.end, 0, 0, 100), delta: num(t.delta, 0, -100, 100), reasons },
    cleanlinessAvg: num(raw.cleanlinessAvg, 100, 0, 100),
    kpi: { hit: whole(k.hit, 0, 0, 10), miss: whole(k.miss, 0, 0, 10) },
    commentId: typeof raw.commentId === 'string' && reportCommentText(raw.commentId) !== '' ? raw.commentId : 'zero-0',
    hint: {
      id: HINT_IDS.includes(h.id as HintId) ? h.id as HintId : 'brawo',
      value: num(h.value, 0, -1e60, 1e60),
      impact: num(h.impact, 0, 0, 1e60),
    },
  };
}

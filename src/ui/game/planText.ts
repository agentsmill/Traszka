import { t, tr } from '@/i18n';
import { dayOf } from '@/sim/economy/calendar';
import { planOf, type EconomyState, type PlanEvent } from '@/sim/economy/economy';
import { PLAN, firstPlanPreview, planTarget, type PlanMonth, type PlanOutlook, type PlanState } from '@/sim/economy/plan';
import { money, percentOf, zl } from './format';

/*
 * Wszystkie zdania o planie sprzedaży Centrali: pasek w HUD (`plan.tsx`), podgląd miesiąca, raport, okna zdarzeń i koniec gry.
 * Same funkcje tekstowe, bez interfejsu, więc testy i słownik angielski mają jedno miejsce. Zdania zdarzeń planu z symulacji
 * (`start`, `announce`, `short`) są w `economy.ts` i w `i18n/en/sim.ts`: tu tylko ich tytuły.
 */

/** Nazwy stopni drabiny wpadek (indeks = stopień). Polskie napisy do `tr(…)`. */
export const STAGE_NAME: readonly string[] = ['W planie', 'Rozmowa z partnerem regionalnym', 'Program naprawczy', 'Wypowiedzenie placówki'];

/** Procent w dół do pełnej liczby: 99,6% to jeszcze „99%”, bo plan jest zrobiony dopiero od 100%. */
const pctOf = (share: number): string => `${Math.floor(share * 100 + 1e-9)}%`;

const stageName = (stage: number): string => tr(STAGE_NAME[Math.max(0, Math.min(PLAN.stageMax, stage))]!);

export type PlanTone = 'ok' | 'warn' | 'danger';

/**
 * Prognoza trafienia poniżej `1 + TIGHT_MARGIN` to „plan na styk”: pasek (`forecastMonth`) jest szacunkiem, a miesiąc kończący się przy 99–101%
 * potrafi wypaść po drugiej stronie kreski. Wtedy pasek nie obiecuje trafienia, tylko ostrzega przed karą.
 */
export const TIGHT_MARGIN = 0.03;

/**
 * Trzy zdania paska planu i jego ton: `danger` przy stopniu po wpadce ≥ 2, `warn` przy dobiciu albo wpadce, inaczej `ok`. Trafienie „na styk”
 * (prognoza poniżej `1 + TIGHT_MARGIN`) ma ton `warn`, a `danger`, gdy wpadka z obecnego stopnia dałaby stopień ≥ 2.
 */
export function planLines(o: PlanOutlook): { head: string; progress: string; verdict: string; tone: PlanTone } {
  const tight = o.verdict === 'hit' && o.forecastShare < 1 + TIGHT_MARGIN;
  let verdict: string;
  if (tight && o.stage + 1 >= PLAN.stageMax) verdict = t`Prognoza: plan na styk. Jeśli zabraknie choć trochę, Centrala wypowie umowę na tę placówkę.`;
  else if (tight) verdict = t`Prognoza: plan na styk. Jeśli zabraknie choć trochę, będzie kara.`;
  else if (o.verdict === 'hit') verdict = t`Prognoza: plan zrobiony.`;
  else if (o.verdict === 'topup') verdict = t`Jeśli nic się nie zmieni: dobicie z kieszeni ok. ${zl(o.cost)}.`;
  else if (o.stageAfter >= PLAN.stageMax) verdict = t`Jeśli nic się nie zmieni: Centrala wypowie umowę na tę placówkę.`;
  else verdict = t`Jeśli nic się nie zmieni: kara ${zl(o.fine)}, stopień ${o.stageAfter} (${stageName(o.stageAfter)}).`;
  const tone: PlanTone = tight ? (o.stage + 1 >= 2 ? 'danger' : 'warn') : o.stageAfter >= 2 ? 'danger' : o.verdict === 'hit' ? 'ok' : 'warn';
  return {
    head: t`Plan Centrali: ${zl(o.target)} · seria: ${o.streak} mies.`,
    progress: t`wykonane ${pctOf(o.share)} · prognoza ${pctOf(o.forecastShare)}`,
    verdict,
    tone,
  };
}

/** Pierwszy plan jeszcze przed rozliczeniem: dziś zaczyna się czwarty miesiąc umowy. */
export const planFirstText = (first: number): string => t`Od dziś obowiązuje plan Centrali: ${zl(first)} w tym miesiącu.`;

/** Przełącznik „dobij z własnej kieszeni”: napis i dopisek (próg z `PLAN.topUpFrom`). */
export const topUpLabel = (): string => t`Dobij plan z własnej kieszeni, jeśli zabraknie do ${pctOf(1 - PLAN.topUpFrom)}`;
export const topUpNote = (): string => t`Kupujesz brakujący towar sam. Miesiąc jest zaliczony, ale następny plan rośnie.`;

/** Tytuł okna „OK” dla zdarzenia planu z symulacji (`start`: koniec gwarancji, `announce`: zapowiedź, `short`: brakuje do progu). */
export function planEventTitle(e: PlanEvent | undefined): string {
  if (e?.reason === 'start') return 'Koniec okresu wdrożenia';
  if (e?.reason === 'short') return 'Plan: brakuje do progu';
  return 'Plan sprzedaży Centrali';
}

/** Wynik planu jednego sklepu zdaniem (raport miesiąca i podgląd końca miesiąca). */
export function planResultText(p: PlanMonth): string {
  if (p.hit) {
    return p.bought > 0
      ? t`Plan zaliczony z dobiciem z kieszeni: towar za ${zl(p.bought)}, koszt ${zl(p.cost)}.`
      : t`Plan wykonany: ${pctOf(p.share)} z ${zl(p.due)}.`;
  }
  return p.stage >= PLAN.stageMax
    ? t`Plan niewykonany (${pctOf(p.share)}): Centrala wypowie umowę na tę placówkę.`
    : t`Plan niewykonany (${pctOf(p.share)}): kara ${zl(p.fine)}, stopień ${p.stage} (${stageName(p.stage)}).`;
}

/** Ostrzeżenia podglądu miesiąca: koniec umowy za trzecią wpadkę (cała gra i jeden sklep sieci). */
export const planGameOverWarning = (): string => t`Centrala wypowie umowę: trzeci miesiąc z rzędu bez planu sprzedaży.`;
export const planStoreEndWarning = (): string => t`Centrala wypowie umowę tej placówce: trzeci miesiąc z rzędu bez planu sprzedaży. Pozostałe działają dalej.`;

/** Dane stanu sklepu, z których raport składa zdania o planie (historia i dzień zamknięcia, plan po rozliczeniu, czy gra się skończyła). */
export interface PlanCtx { history: readonly { revenue: number }[]; day: number; plan?: PlanState; over?: boolean; ranked?: boolean }
/** `ranked`: bieg rankingowy (sezon 3 miesięcy): raport trzeciego miesiąca zamyka sezon, więc planu nie będzie. */
export const planCtxOf = (s: EconomyState, ranked = false): PlanCtx => ({ history: s.history, day: dayOf(s.minute), plan: planOf(s), over: s.gameOver, ranked });

/** List partnera regionalnego dokładnie wtedy, gdy stopień drabiny się zmienił (`stage` po rozliczeniu, `stageBefore` przed): w górę ostrzeżenie, w dół podziękowanie. */
export function planLetter(p: PlanMonth): string | null {
  if (p.stage > p.stageBefore) return t`Partner regionalny: „Widzimy spadek zaangażowania. Od dziś: ${stageName(p.stage)}.”`;
  if (p.stage < p.stageBefore) return t`Partner regionalny: „Dziękujemy za powrót do standardu. Na razie.”`;
  return null;
}

/** Ile dni miał miesiąc nowego planu: ten, dla którego `planTarget` daje zapisany cel (raport nie niesie liczby dni). */
function nextMonthDays(p: PlanMonth): number {
  let best = 31;
  let gap = Infinity;
  for (const d of [31, 30, 29, 28]) {
    const g = Math.abs(planTarget(p.nextBase, d, p.streak) - p.nextTarget);
    if (g < gap) { gap = g; best = d; }
  }
  return best;
}

/** „Dlaczego tyle”: skąd wzięła się nowa kwota planu. Zapadka bazy (−5%) po tym, jak średnia z trzech miesięcy wypadła niżej niż baza. */
export function planReasonText(p: PlanMonth, state?: PlanState): string {
  const days = nextMonthDays(p);
  const growth = percentOf(p.nextGrowth);
  const tail = p.streak <= 0 ? t`wzrostu` : p.streak === 1 ? t`za pierwsze trafienie` : t`za serię ${p.streak} trafień`;
  const mean = state && state.recent.length > 0 ? Math.round(state.recent.reduce((s, v) => s + v, 0) / state.recent.length) : p.nextBase;
  if (p.nextBase > mean) {
    return t`Nowy plan: ${zl(p.nextTarget)}. Centrala łaskawie obniża bazę o ${percentOf(1 - PLAN.baseFloor)}: ${zl(p.nextBase)} dziennie × ${days} dni, plus ${growth} ${tail}.`;
  }
  return t`Nowy plan: ${zl(p.nextTarget)}. Średni obrót dzienny z trzech miesięcy ${zl(p.nextBase)} × ${days} dni, plus ${growth} ${tail}.`;
}

/**
 * Raport trzeciego miesiąca umowy: pierwszy plan od jutra albo `null` (to nie ten miesiąc albo gra się skończyła i planu nie będzie).
 * Drugie podejście (`ctx.day`) nie jest martwe: po przewinięciu dni (`skip`) raport zamknięcia pokazuje się już pierwszego dnia
 * nowego miesiąca, a wtedy `ctx.day + 1` to drugi dzień.
 */
export function planStartText(ctx: PlanCtx): string | null {
  if (ctx.over || ctx.ranked) return null;   // gra skończona albo sezon rankingowy: bieg kończy się z tym raportem
  const first = firstPlanPreview(ctx.history, ctx.day + 1) ?? firstPlanPreview(ctx.history, ctx.day);
  return first === null ? null : t`Koniec okresu wdrożenia. Od jutra obowiązuje plan sprzedaży Centrali: ${zl(first)}.`;
}

/** Powód końca gry za plan (okno końca współpracy). */
export const planOverReason = (): string => t`Powód: trzeci miesiąc z rzędu bez planu sprzedaży.`;

/** Dwa wiersze ekranu końca gry za plan: przeżyte miesiące z gotówką oraz ostatni plan z wykonaniem (gdy zapis niesie jego raport). */
export function planOverLines(s: EconomyState): string[] {
  const last = s.lastReport?.plan;
  return [
    t`Przeżyte miesiące: ${s.history.length} · gotówka: ${money(s.cash)}`,
    ...(last ? [t`Ostatni plan: ${zl(last.target)}, wykonane ${pctOf(last.share)}.`] : []),
  ];
}

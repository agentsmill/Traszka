import { forecastMonth, spendCheck, type SpendLevel } from '@/sim/economy/forecast';
import type { EconomyState } from '@/sim/economy/economy';
import type { AnswerInstance } from '@/sim/economy/tycoon/cards';
import { spendWarningText } from './forecastText';

/*
 * Ostrzeżenie przy wydatku z gotówki: gracz widzi, ile wyjdzie po rozliczeniu miesiąca, zanim kliknie. Tylko ostrzega:
 * przycisk zakupu zostaje włączony, bo decyzja jest jego. Gdy zakupu i tak nie da się zrobić (`price` ponad gotówką),
 * nie dokładamy drugiego komunikatu do „za mało gotówki”.
 */

/**
 * Ile gotówki od razu zabierze odpowiedź na kartę (zł, dodatnie to koszt; 0, gdy zyskuje albo nic nie kosztuje): suma pewnych
 * pozycji pieniężnych, tych samych, które `answerCard` księguje w gotówce. Ryzyko i efekty na czas (szacunek `mods`) nie wchodzą.
 */
export function answerCashCost(a: Pick<AnswerInstance, 'delta'>): number {
  const d = a.delta;
  return Math.max(0, -((d.cash ?? 0) + (d.bonus ?? 0) + (d.fine ?? 0) + (d.logistics ?? 0)));
}

/** Czy wydatek `price` w ogóle trzeba oceniać: ma cenę i, o ile nie jest „zawsze” (karta księguje się bez względu na gotówkę), mieści się w gotówce. */
const assessable = (s: EconomyState, price: number, always: boolean): boolean => price > 0 && (always || price <= s.cash);

/** Poziom wydatku `price` na tle prognozy; `ok` dla zakupu poza zasięgiem gotówki albo bez ceny. */
export function spendLevel(s: EconomyState, price: number, always = false): SpendLevel {
  return assessable(s, price, always) ? spendCheck(forecastMonth(s), price).level : 'ok';
}

/** Atrybut `data-risk` przycisku zakupu: `warn` i `danger` zmieniają jego kolor (CSS), `ok` i `tight` zostawiają zwykły. */
export const spendRisk = (s: EconomyState, price: number): SpendLevel | undefined => {
  const level = spendLevel(s, price);
  return level === 'warn' || level === 'danger' ? level : undefined;
};

/**
 * Wiersz pod opisem zakupu o cenie `price`; nic, gdy zakup mieści się w wolnych środkach. `always`: odpowiedź na kartę decyzji
 * księguje się także wtedy, gdy kosztuje więcej niż gotówka (debet), więc ostrzega zawsze. To `span` (blokowy w CSS), bo stoi też
 * w przycisku odpowiedzi, gdzie `div` byłby niedozwolony.
 */
export function SpendNote({ s, price, always = false }: { s: EconomyState; price: number; always?: boolean }) {
  if (!assessable(s, price, always)) return null;
  const check = spendCheck(forecastMonth(s), price);
  const text = spendWarningText(check);
  return text ? <span class={`tt-spend ${check.level}`} role="note">{text}</span> : null;
}

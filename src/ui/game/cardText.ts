import type { AnswerInstance, CardDelta } from '@/sim/economy/tycoon/cards';
import { duration, plural } from './format';

/*
 * Napisy na odpowiedziach karty decyzji: krótkie skutki do pokazania przy przycisku, zanim gracz wybierze. Funkcje są czyste
 * (liczby formatuje podana funkcja, w grze po polsku), więc testuje się je bez interfejsu.
 */

type Fmt = (n: number) => string;

const MINUS = '−';   // U+2212, jak w reszcie interfejsu (`signedZl`)
const sign = (n: number): string => (n < 0 ? MINUS : '+');
const signed = (n: number, fmt: Fmt): string => `${sign(n)}${fmt(Math.abs(n))}`;
const zl = (n: number, fmt: Fmt): string => `${signed(n, fmt)} zł`;
/** Zero (i brak) nic nie mówi graczowi, więc takiego pola nie pokazujemy. */
const has = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n !== 0;

/** Wiersze skutków pewnych (też skutku ryzyka): pieniądze, potem zaufanie, WUT, czas ludzi, siły, reputacja, Ogonki. */
function certainLines(d: CardDelta, fmt: Fmt): string[] {
  const out: string[] = [];
  if (has(d.cash)) out.push(zl(d.cash, fmt));
  if (has(d.bonus)) out.push(zl(d.bonus, fmt));
  if (has(d.fine)) out.push(zl(d.fine, fmt));
  if (has(d.logistics)) out.push(zl(d.logistics, fmt));
  if (has(d.trust)) out.push(`zaufanie ${signed(d.trust, fmt)}`);
  if (has(d.wut)) out.push(`WUT ${zl(d.wut, fmt)}`);
  if (has(d.staffMinutes)) out.push(`czas ludzi ${d.staffMinutes < 0 ? MINUS : ''}${fmt(Math.abs(d.staffMinutes))} min`);
  if (has(d.energy)) out.push(`siły ${signed(d.energy, fmt)}`);
  if (has(d.reputation)) out.push(`reputacja ${signed(d.reputation, fmt)}`);
  if (has(d.ogonki)) out.push(`Ogonki ${signed(d.ogonki, fmt)}`);
  return out;
}

/**
 * Skutki odpowiedzi jako krótkie wiersze: pieniądze (cash, premia, mandat, logistyka ze znakiem i „zł”), „zaufanie ±n”,
 * „WUT +n zł”, „czas ludzi n min”, „siły −n”, „reputacja ±n”, „Ogonki +n”. Potem efekty na czas: „sklep zamknięty N h”,
 * „±N osoba na zmianie” i jeden wspólny szacunek „ok. ±n zł” z `mods[].estimate`. Na końcu ryzyko: „ryzyko n%: skutki”.
 * `fmt` formatuje liczbę bez znaku i bez jednostki (w grze: polski zapis z jednym miejscem po przecinku).
 */
export function deltaLines(a: AnswerInstance, fmt: Fmt): string[] {
  const out = certainLines(a.delta, fmt);
  for (const m of a.mods) {
    if (m.kind === 'closed') out.push(`sklep zamknięty ${duration(m.minutes)}`);
    else if (m.kind === 'staff' && m.value !== 0) out.push(`${signed(m.value, fmt)} ${plural(Math.abs(m.value), 'osoba', 'osoby', 'osób')} na zmianie`);
  }
  const estimate = a.mods.reduce((n, m) => n + (Number.isFinite(m.estimate) ? m.estimate : 0), 0);
  if (Math.abs(estimate) >= 0.5) out.push(`ok. ${zl(estimate, fmt)}`);
  if (a.risk && a.risk.chance > 0) {
    const percent = Math.max(1, Math.round(a.risk.chance * 100));   // szansa choćby niewielka nie może wyglądać jak „0%”
    const effects = certainLines(a.risk.delta, fmt);
    out.push(effects.length > 0 ? `ryzyko ${percent}%: ${effects.join(', ')}` : `ryzyko ${percent}%`);
  }
  return out;
}

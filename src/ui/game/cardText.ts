import type { AnswerInstance, CardDelta } from '@/sim/economy/tycoon/cards';
import { duration, plural } from './format';

/*
 * Napisy na odpowiedziach karty decyzji: krótkie skutki do pokazania przy przycisku, zanim gracz wybierze. Funkcje są czyste
 * (liczby formatuje podana funkcja, w grze po polsku), więc testuje się je bez interfejsu.
 */

type Fmt = (n: number) => string;

/** Kolor wiersza w oknie karty: koszt (czerwień), zysk (zieleń) albo bez oceny. */
export type Tone = 'cost' | 'gain' | 'neutral';
/** Jeden skutek odpowiedzi: napis i to, czy gracz na nim traci, czy zyskuje. */
export interface DeltaLine { text: string; tone: Tone }

const MINUS = '−';   // U+2212, jak w reszcie interfejsu (`signedZl`)
const sign = (n: number): string => (n < 0 ? MINUS : '+');
const signed = (n: number, fmt: Fmt): string => `${sign(n)}${fmt(Math.abs(n))}`;
const zl = (n: number, fmt: Fmt): string => `${signed(n, fmt)} zł`;
/** Zero (i brak) nic nie mówi graczowi, więc takiego pola nie pokazujemy. */
const has = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n !== 0;
/** Ocena po znaku: ujemne to strata, dodatnie to zysk, zero bez oceny. Wielkości, które rosną ze szkodą dla gracza (WUT, czas ludzi), podajemy ze znakiem odwróconym. */
const toneOf = (n: number): Tone => (n < 0 ? 'cost' : n > 0 ? 'gain' : 'neutral');

/**
 * Wiersze skutków pewnych (też skutku ryzyka): pieniądze, potem zaufanie, WUT, czas ludzi, siły, reputacja, Ogonki.
 * Pieniądze, zaufanie, siły, reputacja i Ogonki są zyskiem, gdy rosną; WUT (dopisany do podatku) i czas ludzi (zabrany pracy
 * w sklepie) są kosztem, gdy rosną, a odpis z WUT i uwolniony czas to zysk.
 */
function certainLines(d: CardDelta, fmt: Fmt): DeltaLine[] {
  const out: DeltaLine[] = [];
  if (has(d.cash)) out.push({ text: zl(d.cash, fmt), tone: toneOf(d.cash) });
  if (has(d.bonus)) out.push({ text: zl(d.bonus, fmt), tone: toneOf(d.bonus) });
  if (has(d.fine)) out.push({ text: zl(d.fine, fmt), tone: toneOf(d.fine) });
  if (has(d.logistics)) out.push({ text: zl(d.logistics, fmt), tone: toneOf(d.logistics) });
  if (has(d.trust)) out.push({ text: `zaufanie ${signed(d.trust, fmt)}`, tone: toneOf(d.trust) });
  if (has(d.wut)) out.push({ text: `WUT ${zl(d.wut, fmt)}`, tone: toneOf(-d.wut) });
  if (has(d.staffMinutes)) out.push({ text: `czas ludzi ${d.staffMinutes < 0 ? MINUS : ''}${fmt(Math.abs(d.staffMinutes))} min`, tone: toneOf(-d.staffMinutes) });
  if (has(d.energy)) out.push({ text: `siły ${signed(d.energy, fmt)}`, tone: toneOf(d.energy) });
  if (has(d.reputation)) out.push({ text: `reputacja ${signed(d.reputation, fmt)}`, tone: toneOf(d.reputation) });
  if (has(d.ogonki)) out.push({ text: `Ogonki ${signed(d.ogonki, fmt)}`, tone: toneOf(d.ogonki) });
  return out;
}

/**
 * Skutki odpowiedzi jako krótkie wiersze (napis i ocena): pieniądze (cash, premia, mandat, logistyka ze znakiem i „zł”),
 * „zaufanie ±n”, „WUT +n zł”, „czas ludzi n min”, „siły −n”, „reputacja ±n”, „Ogonki +n”. Potem efekty na czas: „sklep zamknięty N h”
 * (koszt), „±N osoba na zmianie” (mniej osób to koszt, więcej to zysk) i jeden wspólny szacunek „ok. ±n zł” z `mods[].estimate`
 * (oceniany po znaku). Na końcu ryzyko: „ryzyko n%: skutki”, zawsze jako koszt (to szansa na stratę).
 * `fmt` formatuje liczbę bez znaku i bez jednostki (w grze: polski zapis z jednym miejscem po przecinku).
 */
export function deltaLines(a: AnswerInstance, fmt: Fmt): DeltaLine[] {
  const out = certainLines(a.delta, fmt);
  for (const m of a.mods) {
    if (m.kind === 'closed') out.push({ text: `sklep zamknięty ${duration(m.minutes)}`, tone: 'cost' });
    else if (m.kind === 'staff' && m.value !== 0) {
      out.push({ text: `${signed(m.value, fmt)} ${plural(Math.abs(m.value), 'osoba', 'osoby', 'osób')} na zmianie`, tone: toneOf(m.value) });
    }
  }
  const estimate = a.mods.reduce((n, m) => n + (Number.isFinite(m.estimate) ? m.estimate : 0), 0);
  if (Math.abs(estimate) >= 0.5) out.push({ text: `ok. ${zl(estimate, fmt)}`, tone: toneOf(estimate) });
  if (a.risk && a.risk.chance > 0) {
    const percent = Math.max(1, Math.round(a.risk.chance * 100));   // szansa choćby niewielka nie może wyglądać jak „0%”
    const effects = certainLines(a.risk.delta, fmt).map((l) => l.text);
    out.push({ text: effects.length > 0 ? `ryzyko ${percent}%: ${effects.join(', ')}` : `ryzyko ${percent}%`, tone: 'cost' });
  }
  return out;
}

import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { MINUTES_PER_DAY, OPEN_FROM } from './catalog';
import { advanceEconomy, gameMinutesPerSecond, type EconClock } from './clock';
import { awaitingDecision, createEconomy, stepMinute, type EconEvent, type EconomyState } from './economy';
import { applyCommand } from './commands';
import { computeStoreInfo } from './storeInfo';
import { cardDef, visibleCards } from './tycoon/cards';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));

/** Najwcześniejsza karta na biurku: na niej gra ma stanąć. */
const firstCard = (s: EconomyState) => [...s.tycoon.cards.pending].sort((a, b) => a.showAt - b.showAt || a.seq - b.seq)[0]!;

/** Gra z ×8 w kawałkach, jak klatki pętli, aż stanie na karcie (albo skończy się czas). */
function playUntilCard(s: EconomyState, clock: EconClock, out: EconEvent[], frames = 10_000): void {
  for (let i = 0; i < frames && !awaitingDecision(s); i++) advanceEconomy(s, info, clock, 0.1 * 8, out);
}

describe('advanceEconomy: karta decyzji zatrzymuje zegar', () => {
  it('karta zatrzymuje zegar dokładnie na showAt, a drugie wywołanie nic nie robi i nie rusza ułamka minuty', () => {
    const s = createEconomy(SEED, info);
    const clock: EconClock = { acc: 0 };
    const out: EconEvent[] = [];
    const first = firstCard(s);
    expect(first.showAt).toBeGreaterThan(s.minute);   // dzień 0 zaczyna się od 6:00 bez karty na biurku

    // 10 000 s czasu gry naraz (bezpiecznik 240 minut na wywołanie odcina po kawałku), aż do karty
    for (let i = 0; i < 400 && !awaitingDecision(s); i++) advanceEconomy(s, info, clock, 10_000, out);
    expect(awaitingDecision(s)).toBe(true);
    expect(s.minute).toBe(first.showAt);

    const acc = clock.acc;
    const before = JSON.stringify(s);
    expect(advanceEconomy(s, info, clock, 10_000, out)).toBe(0);
    expect(clock.acc).toBe(acc);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('×8 i karta w środku klatki: gra staje na minucie showAt, reszta czasu klatki nie zbiera się w zegarze', () => {
    const s = createEconomy(SEED, info);
    const clock: EconClock = { acc: 0 };
    const first = firstCard(s);
    // klatka kończy się daleko za kartą: do showAt brakuje mniej niż klatka, ale zegar ma zostać na zerze
    const need = (first.showAt - s.minute) / gameMinutesPerSecond(OPEN_FROM);
    expect(need).toBeLessThan(200);
    let done = 0;
    for (let i = 0; i < 20 && !awaitingDecision(s); i++) done += advanceEconomy(s, info, clock, need + 500, []);
    expect(s.minute).toBe(first.showAt);
    expect(done).toBe(first.showAt - OPEN_FROM);
    expect(clock.acc).toBe(0);
  });

  it('zdarzenie card z tytułem karty pojawia się w minucie showAt, nie wcześniej', () => {
    const s = createEconomy(SEED, info);
    const out: EconEvent[] = [];
    const first = firstCard(s);
    playUntilCard(s, { acc: 0 }, out);
    const cards = out.filter((e) => e.kind === 'card');
    expect(cards.map((e) => e.text)).toEqual(
      s.tycoon.cards.pending.filter((c) => c.showAt === first.showAt).map((c) => cardDef(c.id)!.title),
    );
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(out.at(-1)!.kind).not.toBe('gameover');
  });

  it('odpowiedź wznawia grę: karta znika, a advanceEconomy znów wykonuje minuty', () => {
    const s = createEconomy(SEED, info);
    const clock: EconClock = { acc: 0 };
    playUntilCard(s, clock, []);
    const card = visibleCards(s.tycoon.cards, s.minute)[0]!;
    const stoppedAt = s.minute;

    const r = applyCommand(s, info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
    expect(r.result.ok).toBe(true);
    expect(s.tycoon.cards.pending.some((c) => c.seq === card.seq)).toBe(false);
    // inne karty tej samej minuty mogą jeszcze czekać: odpowiadamy na wszystkie
    for (const c of visibleCards(s.tycoon.cards, s.minute)) applyCommand(s, info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
    expect(awaitingDecision(s)).toBe(false);
    expect(advanceEconomy(s, info, clock, 1, [])).toBeGreaterThan(0);
    expect(s.minute).toBeGreaterThan(stoppedAt);
  });

  it('awaitingDecision: po końcu gry karta nie zatrzymuje (nikt na nią nie odpowie)', () => {
    const s = createEconomy(SEED, info);
    s.tycoon.cards.pending[0]!.showAt = s.minute;
    expect(awaitingDecision(s)).toBe(true);
    s.gameOver = true;
    expect(awaitingDecision(s)).toBe(false);
  });

  it('stepMinute jest całkowitą funkcją „minuta dalej”: nie sprawdza karty, to robią wołający', () => {
    const s = createEconomy(SEED, info);
    s.tycoon.cards.pending[0]!.showAt = s.minute;
    expect(awaitingDecision(s)).toBe(true);
    stepMinute(s, info, []);
    expect(s.minute).toBe(OPEN_FROM + 1);
    expect(awaitingDecision(s)).toBe(true);
  });

  it('trzy doby z odpowiedziami domyślnymi: gra przechodzi dalej, a karta przychodzi każdego dnia', () => {
    const s = createEconomy(SEED, info);
    const clock: EconClock = { acc: 0 };
    const out: EconEvent[] = [];
    const end = 3 * MINUTES_PER_DAY;
    const days = new Set<number>();
    for (let i = 0; i < 200_000 && s.minute < end; i++) {
      for (const c of visibleCards(s.tycoon.cards, s.minute)) {
        applyCommand(s, info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
        days.add(c.day);
      }
      advanceEconomy(s, info, clock, 0.8, out);
    }
    expect(s.minute).toBeGreaterThanOrEqual(end);
    expect([...days].sort()).toEqual([0, 1, 2]);
  });
});

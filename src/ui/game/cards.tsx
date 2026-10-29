import { signal, type Signal } from '@preact/signals';
import { cardDef, fillText, visibleCards } from '@/sim/economy/tycoon/cards';
import { econ, report, type GameActions } from '../state';
import { deltaLines } from './cardText';
import { int, people } from './format';

/**
 * Wybór gracza na wyświetlonej karcie: numer karty i zaznaczona odpowiedź. Wybór dotyczy jednej karty (`seq`), więc kolejna
 * karta zaczyna od własnej odpowiedzi domyślnej, a po zatwierdzeniu stan się czyści. Zwykły sygnał, jak reszta stanu okien,
 * dzięki czemu okno nie ma haków i da się je testować `vnodeTree`.
 */
export const picked: Signal<{ seq: number; answer: number } | null> = signal(null);

export const OKOLNIK_BADGE = 'Okólnik Centrali';

/**
 * Okno karty decyzji (spec §7.5): pokazuje się, gdy na biurku leży widoczna karta, i trzyma grę (symulacja stoi na minucie
 * karty, `cardsBlocking`), aż gracz wybierze. Nie ma krzyżyka ani zamykania tłem: karta czeka na odpowiedź. Pokazuje
 * najstarszą widoczną kartę, po odpowiedzi wchodzi następna. Odpowiedź domyślna jest zaznaczona z góry, więc gracz, który
 * nie czyta, naciska samo „Zatwierdź”. Raport miesiąca (i koniec gry) mają pierwszeństwo: karta czeka za nimi.
 * Wynik odpowiedzi to toast ze zdarzenia `card-result` (`handleEvents`), tu go nie dublujemy.
 */
export function CardDesk({ game }: { game: GameActions }) {
  const view = econ.value;
  if (!view || report.value || view.s.gameOver) return null;
  const cards = visibleCards(view.s.tycoon.cards, view.s.minute);
  const card = cards[0];
  if (!card) return null;
  const def = cardDef(card.id);
  const title = def?.title ?? 'Decyzja';
  const chosen = picked.value?.seq === card.seq ? picked.value.answer : card.defaultAnswer;
  const confirm = (): void => {
    // powłoka mogła już zaksięgować odpowiedź, a okno jeszcze się nie odświeżyło: drugie stuknięcie nic nie wysyła
    const now = econ.value;
    if (!now || visibleCards(now.s.tycoon.cards, now.s.minute)[0]?.seq !== card.seq) return;
    const result = game.dispatch({ type: 'answerCard', seq: card.seq, answer: chosen });
    if (result.ok) picked.value = null;
  };
  return (
    <div class="tt-modal-wrap tt-deck-wrap">
      <div class="tt-modal tt-deck" role="dialog" aria-modal="true" aria-label={`Karta dnia: ${title}`}>
        <div class="tt-deck-head">
          <span class="tt-deck-count">Karta 1 z {cards.length}</span>
          {def?.kind === 'okolnik' && <span class="tt-deck-badge">{OKOLNIK_BADGE}</span>}
        </div>
        <h2>{title}</h2>
        {def && <p class="tt-deck-text">{fillText(def.text, card.params, int)}</p>}
        <div class="tt-answers" role="radiogroup" aria-label="Odpowiedzi">
          {card.answers.map((a, i) => {
            const lines = deltaLines(a, people);
            const on = i === chosen;
            return (
              <button key={i} type="button" role="radio" aria-checked={on} class={`tt-answer${on ? ' on' : ''}`}
                onClick={() => { picked.value = { seq: card.seq, answer: i }; }}>
                <span class="tt-answer-label">{def?.answers[i]?.label ?? `Odpowiedź ${i + 1}`}</span>
                <span class="tt-answer-fx">
                  {lines.length > 0 ? lines.map((l) => <span key={l} class="tt-chip">{l}</span>) : <span class="tt-chip none">bez skutków</span>}
                  {i === card.defaultAnswer && <span class="tt-chip tag">domyślnie</span>}
                </span>
              </button>
            );
          })}
        </div>
        <p class="tt-hint">Gra czeka na Twoją decyzję.</p>
        <button type="button" class="tt-btn tt-primary big" onClick={confirm}>Zatwierdź</button>
      </div>
    </div>
  );
}

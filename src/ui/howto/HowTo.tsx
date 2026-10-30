import { closeHowTo, howTo } from '../state';
import { requestTour } from '../tutorial/tour';
import { glossary } from './glossary';
import { howToDetails, howToPoints } from './howToText';

/**
 * Okno „Jak grać”: wstaje z ⚙ i z przycisku „?” w pasku gry, a dopóki jest otwarte, gra stoi (`isModalOpen`; `openHowTo` / `closeHowTo`
 * w state.ts). Treść i liczby składa `howToText.ts`, a słowniczek `glossary.ts`; tu tylko układ: tytuł, punkty „co robić” (mieszczą się
 * na jednym ekranie telefonu), zwinięte szczegóły (`<details>`), na końcu zwinięty słowniczek, oraz przyciski „Samouczek” (zamyka okno
 * i uruchamia przelot; w biegu rankingowym tylko komunikat) i „Zaczynamy”. Okno ma `max-height` i przewija się dopiero po rozwinięciu
 * szczegółów, a `tt-modal-foot` trzyma przyciski przy dolnej krawędzi.
 */
export function HowTo() {
  if (!howTo.value) return null;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-howto" role="dialog" aria-modal="true" aria-label="Jak grać">
        <h2>Jak grać</h2>
        <ul class="tt-list tt-howto-points">
          {howToPoints().map((point) => <li key={point}>{point}</li>)}
        </ul>
        {howToDetails().map((section) => (
          <details key={section.title}>
            <summary>{section.title}</summary>
            {section.paragraphs.map((p) => <p key={p}>{p}</p>)}
          </details>
        ))}
        <details class="tt-glossary">
          <summary>Słowniczek</summary>
          <dl>
            {glossary().map((e) => [<dt key={`t-${e.term}`}>{e.term}</dt>, <dd key={`d-${e.term}`}>{e.text}</dd>])}
          </dl>
        </details>
        <div class="tt-modal-foot">
          <button type="button" class="tt-btn big" onClick={() => { closeHowTo(); requestTour(); }}>Samouczek</button>
          <button type="button" class="tt-btn tt-primary big" onClick={closeHowTo}>Zaczynamy</button>
        </div>
      </div>
    </div>
  );
}

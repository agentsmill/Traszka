import { closeHowTo, howTo } from '../state';
import { howToSections } from './howToText';

/**
 * Okno „Jak grać”: wstaje po ekranie startowym (`openChosenStore` i `open` w game/actions.ts) i z ⚙, a dopóki jest otwarte,
 * gra stoi (`isModalOpen`), a podpowiedzi pierwszego dnia czekają (`openHowTo` / `closeHowTo` w state.ts). Treść i liczby składa `howToText.ts`; tu tylko układ: tytuł, treść i przycisk „Zaczynamy”. Okno ma
 * `max-height` i przewija się (na telefonie 390 px nie wychodzi poza ekran), a `tt-modal-foot` trzyma przycisk przy dolnej krawędzi.
 */
export function HowTo() {
  if (!howTo.value) return null;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-howto" role="dialog" aria-modal="true" aria-label="Jak grać">
        <h2>Jak grać</h2>
        {howToSections().map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            {section.list
              ? <ul class="tt-list">{section.paragraphs.map((p) => <li key={p}>{p}</li>)}</ul>
              : section.paragraphs.map((p) => <p key={p}>{p}</p>)}
          </section>
        ))}
        <div class="tt-modal-foot">
          <button type="button" class="tt-btn tt-primary big" onClick={closeHowTo}>Zaczynamy</button>
        </div>
      </div>
    </div>
  );
}

import { NICK_MAX } from '@/game/nick';
import { t, tr } from '@/i18n';
import { zl } from '../game/format';
import type { FameOffer } from '../state';
import type { FameModel } from './fameModel';
import './ranking.css';

/**
 * Gratulacje za pierwszy milion i wpis do Galerii sław (4b §5.7). Pokazuje się, gdy firma pierwszy raz ma milion w portfelu w zwykłej
 * grze (zdarzenie `million`), i ze strony Galerii przyciskiem „Wyślij mój wpis”. Gracz może zmienić nick (domyślnie jego nick z mety),
 * bo nick zarezerwowany w rankingu przez kogoś innego (`nick-taken`) nie przejdzie. Komunikat, miejsce i odmowy leżą w jednym regionie
 * `aria-live`. Gdy wpisu nie da się wysłać (seed spoza reguł serwera), okno daje same gratulacje. Układ to kolumna z przyciskami
 * na całą szerokość (działa w 390 px). Okno nie zamyka się kliknięciem w tło: milion zdarza się raz. Komponent bez hooków: cały stan jest
 * w modelu (`createFameModel`), więc testy wołają go jak zwykłą funkcję.
 */
export interface FameWindowProps {
  model: FameModel;
  offer: FameOffer;
  onClose: () => void;
  /** „Zobacz Galerię” po przyjęciu wpisu: zamyka okno i otwiera zakładkę Galerii. */
  onOpenGallery: () => void;
}

export function FameWindow({ model, offer, onClose, onOpenGallery }: FameWindowProps) {
  const state = model.state.value;
  const placed = model.placed.value;
  const sending = state === 'sending';
  const done = state === 'sent';
  const canSend = model.sendable(offer);
  const send = (): void => { void model.submit(offer); };
  const text = placed
    ? (placed.first
      ? t`Jesteś w Galerii sław Traszki (miejsce ${placed.place}).`
      : t`Ten nick już jest w Galerii sław Traszki (miejsce ${placed.place}). Mógł go wpisać ktoś inny: jeśli to nie Ty, wpisz się pod innym nickiem.`)
    : tr(model.message.value ?? '');

  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-finish tt-fame" role="dialog" aria-modal="true" aria-label={t`Milion!`}>
        <h2>{t`Milion!`}</h2>
        <p>{t`Centrala jest w szoku, księgowa w euforii.`}</p>
        <p class="tt-fame-cash">{t`Na koncie: `}<b>{zl(offer.cash)}</b></p>
        {canSend && !done && <p class="tt-hint">{t`Wpisz się do Galerii sław Traszki: lista graczy, którzy doszli do pierwszego miliona.`}</p>}

        <div class={text !== '' ? 'tt-finish-status' : undefined} id="tt-fame-status" aria-live="polite">
          {text !== '' && <p class={done ? 'tt-finish-ok' : 'tt-finish-msg'}>{text}</p>}
        </div>

        {canSend && !done && (
          <form class="tt-finish-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label for="tt-fame-nick">{t`Nick w Galerii`}</label>
            <input
              id="tt-fame-nick" class="tt-input" type="text" value={model.nick.value} maxLength={NICK_MAX} disabled={sending}
              autocomplete="off" spellcheck={false} aria-describedby="tt-fame-status"
              onInput={(e) => model.setNick((e.currentTarget as HTMLInputElement).value)}
            />
          </form>
        )}

        <div class="tt-finish-actions">
          {canSend && !done && <button type="button" class="tt-btn tt-primary big" disabled={sending} onClick={send}>{t`Wpisz mnie do Galerii sław`}</button>}
          {done && <button type="button" class="tt-btn tt-primary big" onClick={onOpenGallery}>{t`Zobacz Galerię`}</button>}
          <button type="button" class="tt-btn" onClick={onClose}>{t`Zamknij`}</button>
        </div>
      </div>
    </div>
  );
}

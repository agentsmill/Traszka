import { NICK_MAX } from '@/game/nick';
import { t, tr } from '@/i18n';
import { zl } from '../game/format';
import { closeFinish, finish, type GameActions } from '../state';
import { NOTHING_TO_SEND_TEXT, type FinishModel } from './finishModel';
import './ranking.css';

/**
 * Okno końca sezonu rankingowego i ponownej wysyłki wyniku (spec §14.7). Pokazuje wynik policzony lokalnie, pole nicka i przyciski
 * dobrane do fazy wysyłki (`FinishModel.phase`); sam komunikat, miejsca i rekord leżą w jednym regionie `aria-live`, żeby czytnik
 * ekranu odczytał odpowiedź serwera. Komponent bez hooków: cały stan jest w modelu, więc testy wołają go jak zwykłą funkcję. Układ to
 * kolumna z przyciskami na całą szerokość (działa w 375 px). Okno nie zamyka się kliknięciem w tło: to jedyny moment, w którym wynik
 * całego sezonu czeka na decyzję gracza.
 */
export const FINISH_TITLE = 'Koniec sezonu';
export const DISCARD_QUESTION = 'Odrzucić ten bieg? Wyniku z tego sezonu nie da się potem odzyskać.';

export interface FinishWindowProps {
  model: FinishModel;
  onClose: () => void;
}

export function FinishWindow({ model, onClose }: FinishWindowProps) {
  const phase = model.phase.value;
  const score = model.score.value;
  const seed = model.seed.value;
  const result = model.accepted.value;
  const places = model.places.value;
  const hasRun = score !== null;
  const sending = phase === 'sending';
  const send = (): void => { void model.send(); };

  if (model.confirming.value) {
    return (
      <div class="tt-modal-wrap">
        <div class="tt-modal tt-finish" role="alertdialog" aria-modal="true" aria-label={t`Odrzucenie biegu`}>
          <h2>{tr(FINISH_TITLE)}</h2>
          <p role="alert">{tr(DISCARD_QUESTION)}</p>
          <div class="tt-finish-actions">
            <button type="button" class="tt-btn tt-primary big" onClick={() => { model.discard(); onClose(); }}>{t`Tak, odrzuć`}</button>
            <button type="button" class="tt-btn" onClick={() => model.cancelDiscard()}>{t`Wróć`}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-finish" role="dialog" aria-modal="true" aria-label={tr(FINISH_TITLE)}>
        <h2>{tr(FINISH_TITLE)}</h2>
        {hasRun && <p class="tt-finish-score">{t`Wynik sezonu: `}<b>{zl(score)}</b></p>}
        {hasRun && seed !== null && <p class="tt-hint">{t`Seed sezonu: ${seed}`}</p>}

        <div class="tt-finish-status" id="tt-finish-status" aria-live="polite">
          <p class={phase === 'accepted' ? 'tt-finish-ok' : 'tt-finish-msg'}>{tr(model.message.value ?? NOTHING_TO_SEND_TEXT)}</p>
          {result && places && (
            <ul class="tt-finish-places">
              {places.global !== null && <li>{t`Miejsce w rankingu globalnym: ${places.global}`}</li>}
              {places.seed !== null && seed !== null && <li>{t`Miejsce na seedzie „${seed}”: ${places.seed}`}</li>}
              {places.week !== null && <li>{t`Miejsce w rankingu tygodnia: ${places.week}`}</li>}
              {places.global === null && places.seed === null && places.week === null && <li>{t`Tym razem poza listami rankingu.`}</li>}
              <li class={result.improved ? 'tt-finish-record' : undefined}>
                {result.improved ? t`Nowy rekord życiowy` : t`Twój najlepszy wynik: ${zl(result.best)}`}
              </li>
            </ul>
          )}
        </div>

        {hasRun && phase !== 'accepted' && phase !== 'old-version' && (
          <form class="tt-finish-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label for="tt-finish-nick">{t`Nick w rankingu`}</label>
            <input
              id="tt-finish-nick" class="tt-input" type="text" value={model.nick.value} maxLength={NICK_MAX} disabled={sending}
              autocomplete="off" spellcheck={false} aria-describedby="tt-finish-status"
              onInput={(e) => model.setNick((e.currentTarget as HTMLInputElement).value)}
            />
          </form>
        )}

        <div class="tt-finish-actions">
          {hasRun && (phase === 'ready' || phase === 'sending' || phase === 'nick-taken') && (
            <button type="button" class="tt-btn tt-primary big" disabled={sending} onClick={send}>{t`Wyślij do rankingu`}</button>
          )}
          {hasRun && (phase === 'later' || phase === 'rejected') && (
            <button type="button" class="tt-btn tt-primary big" onClick={send}>{t`Spróbuj jeszcze raz`}</button>
          )}
          {hasRun && (phase === 'rejected' || phase === 'old-version') && (
            <button type="button" class="tt-btn" onClick={() => model.askDiscard()}>{t`Odrzuć bieg`}</button>
          )}
          <button type="button" class={`tt-btn${hasRun && phase !== 'accepted' ? '' : ' tt-primary big'}`} onClick={onClose}>{t`Zamknij`}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Okno w aplikacji: widoczne, gdy sygnał `finish` ma wartość (otwiera go powłoka gry po końcu sezonu albo `openFinish`). Zamknięcie to
 * `closeFinish`: w skończonym biegu rankingowym wychodzi też do zwykłej gry. Bez modelu (nakładka bez gry) nie pokazuje nic.
 */
export function FinishHost({ game, model }: { game: GameActions; model: FinishModel | null }) {
  if (!finish.value || !model) return null;
  return <FinishWindow model={model} onClose={() => closeFinish(game)} />;
}

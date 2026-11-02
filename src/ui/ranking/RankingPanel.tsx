import { render } from 'preact';
import { isEn, t, tr } from '@/i18n';
import { plural, signedZl, zl } from '../game/format';
import type { FameOffer } from '../state';
import type { RankingTab } from './client';
import { fameDate, type FameModel } from './fameModel';
import { NO_SEED, type RankingModel } from './rankingModel';
import './ranking.css';

export { NO_SEED };

/**
 * Panel rankingu (spec §14.7): ranking globalny, „Ten seed” i seed tygodnia, z własnym wierszem podświetlonym. Komponent bez
 * hooków: cały stan jest w modelu (`createRankingModel`), więc testy wołają go jak zwykłą funkcję. W grze pokazuje go `PanelHost`
 * (przycisk 🏆 w HUD-zie i ⚙); `mountRankingPanel` wstawia go poza aplikacją. Z modelem Galerii sław (`fame`) panel ma czwartą zakładkę „Galeria sław”:
 * listę „miejsce, nick, data” graczy po pierwszym milionie i, gdy wpis czeka, „Wyślij mój wpis”. Gdy ranking jest wyłączony albo serwer nie odpowiada,
 * w widoku stoi komunikat modelu i „Spróbuj jeszcze raz”, a panel zamyka się jak zawsze.
 */
export const TAB_LABELS: Record<RankingTab, string> = { global: 'Globalny', seed: 'Ten seed', week: 'Seed tygodnia' };
const TABS: RankingTab[] = ['global', 'seed', 'week'];
/** Czwarta zakładka: Galeria sław (4b §5.7), lista graczy, którzy doszli do pierwszego miliona. Ma własny model (`FameModel`). */
export const FAME_TAB_LABEL = 'Galeria sław';
export const FAME_NOTE = 'Galeria sław Traszki: gracze, którzy w zwykłej grze doszli do pierwszego miliona. Lista idzie od najwcześniejszego wpisu.';
export const FAME_EMPTY = 'Galeria czeka na pierwszego milionera.';

export const LOADING = 'Centrala liczy słupki…';
export const EMPTY_BOARD = 'Nikt jeszcze nie oddał raportu. Pierwsze miejsce czeka, razem z dyplomem z drukarki Centrali.';
export const NO_PLAYER = 'Wyniki trafiają tu z trybu rankingowego: trzy miesiące na jednym seedzie, bez premii z sieci sklepów.';
const GLOBAL_NOTE = 'Wszystkie seedy. Wynik to suma trzech raportów miesięcznych, wrzesień–listopad.';

/** „zostało 5 dni”, „został 1 dzień”, a w ostatniej dobie „ostatnie godziny”. */
export function weekLeft(endsAt: number, now: number): string {
  const days = Math.floor((endsAt - now) / 86_400_000);
  if (days < 1) return t`ostatnie godziny`;
  if (isEn()) return `${days} ${days === 1 ? 'day' : 'days'} left`;
  return `${plural(days, 'został', 'zostały', 'zostało')} ${days} ${plural(days, 'dzień', 'dni', 'dni')}`;
}

export interface RankingPanelProps {
  model: RankingModel;
  onClose: () => void;
  /** Do podpisu „Seed tygodnia” (domyślnie zegar przeglądarki). */
  now?: () => number;
  /** Bieg, który skończył sezon i czeka na wysłanie (`ui.unsent`); z nim panel ma u góry baner z przyciskiem „Wyślij”. */
  unsent?: { score: number; seed: string } | null;
  /** „Wyślij” w banerze niewysłanego biegu (gra zamyka panel i otwiera okno wysyłki). Bez niej baner nie ma przycisku. */
  onSendUnsent?: () => void;
  /** Model Galerii sław: z nim panel ma czwartą zakładkę. Bez niego (testy, nakładka bez gry) są trzy rankingi jak dotąd. */
  fame?: FameModel;
  /**
   * Milion tej firmy (seed, dzień i gotówka z chwili przekroczenia) albo null, gdy firma go jeszcze nie ma. Gdy wpisu nie ma w `meta.fameSent`,
   * zakładka Galerii pokazuje „Wyślij mój wpis”.
   */
  fameEntry?: FameOffer | null;
  /** „Wyślij mój wpis”: gra zamyka panel i otwiera okno gratulacji, w którym wpis się wysyła (tam można zmienić nick). */
  onSendFame?: () => void;
}

function subtitle(model: RankingModel, now: number): string {
  const v = model.view.value;
  switch (model.tab.value) {
    case 'global': return tr(GLOBAL_NOTE);
    case 'seed': return v.seed ? t`Seed sklepu: ${v.seed}` : tr(NO_SEED);
    case 'week': return v.week ? t`Seed tygodnia: ${v.week.seed} · ${weekLeft(v.week.endsAt, now)}` : t`Seed tygodnia`;
  }
}

/** Lista Galerii sław: „1. Nick — 2 listopada 2026” od najwcześniejszego wpisu, komunikat, gdy Galeria nie odpowiada, i „Wyślij mój wpis”. */
function FameBoard({ fame, entry, onSend }: { fame: FameModel; entry: FameOffer | null; onSend?: () => void }) {
  const v = fame.list.value;
  const pending = entry !== null && fame.pending(entry.seed, entry);
  return (
    <>
      <p class="tt-hint">{tr(FAME_NOTE)}</p>
      {pending && onSend && (
        <div class="tt-rank-unsent" role="status">
          <p>{t`Masz milion, ale Twojego wpisu nie ma jeszcze w Galerii.`}</p>
          <button type="button" class="tt-btn tt-primary" onClick={onSend}>{t`Wyślij mój wpis`}</button>
        </div>
      )}
      {v.status === 'loading' && <p class="tt-muted">{tr(LOADING)}</p>}
      {v.status === 'error' && (
        <div class="tt-rank-error">
          <p class="tt-hint warn">{tr(v.message ?? '')}</p>
          <button type="button" class="tt-btn" onClick={() => { void fame.load(); }}>{t`Spróbuj jeszcze raz`}</button>
        </div>
      )}
      {v.status === 'ready' && v.rows.length === 0 && <p class="tt-muted">{tr(FAME_EMPTY)}</p>}
      {v.status === 'ready' && v.rows.length > 0 && (
        <ol class="tt-rank-list tt-fame-list">
          {v.rows.map((r) => (
            <li key={`${r.place}:${r.nick}`} class="tt-fame-row">
              <span class="tt-rank-pos">{r.place}.</span>{' '}
              <span class="tt-fame-nick">{r.nick}</span>{' '}
              <span class="tt-fame-when">{'— '}<time dateTime={Number.isFinite(r.at) ? new Date(r.at).toISOString().slice(0, 10) : undefined}>{fameDate(r.at)}</time></span>
            </li>
          ))}
        </ol>
      )}
      {v.status === 'ready' && v.total > v.rows.length && <p class="tt-hint">{t`Na liście pierwsze ${v.rows.length} z ${v.total} wpisów.`}</p>}
    </>
  );
}

export function RankingPanel({ model, onClose, now = Date.now, unsent = null, onSendUnsent, fame, fameEntry = null, onSendFame }: RankingPanelProps) {
  const onFame = !!fame && fame.shown.value;
  const v = model.view.value;
  const tab = model.tab.value;
  const mine = model.me.value?.places[tab] ?? null;
  const mineShown = v.rows.some((r) => model.isMine(r));
  return (
    <div class="tt-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="tt-modal tt-ranking" role="dialog" aria-label={t`Ranking`}>
        <button type="button" class="tt-iconbtn tt-card-close" aria-label={t`Zamknij`} onClick={onClose}>✕</button>
        <h2>{t`Ranking`}</h2>
        {unsent && (
          <div class="tt-rank-unsent" role="status">
            <p>{t`Masz niewysłany bieg (wynik ${zl(unsent.score)}).`}</p>
            {onSendUnsent && <button type="button" class="tt-btn tt-primary" onClick={onSendUnsent}>{t`Wyślij`}</button>}
          </div>
        )}
        <div class="tt-seg tt-rank-tabs" role="tablist" aria-label={t`Rodzaj rankingu`}>
          {TABS.map((tabId) => (
            <button
              key={tabId} type="button" role="tab" aria-selected={!onFame && tab === tabId} class={`tt-btn${!onFame && tab === tabId ? ' on' : ''}`}
              onClick={() => { fame?.hide(); void model.select(tabId); }}
            >
              {tr(TAB_LABELS[tabId])}
            </button>
          ))}
          {fame && (
            <button type="button" role="tab" aria-selected={onFame} class={`tt-btn${onFame ? ' on' : ''}`} onClick={() => { void fame.show(); }}>
              {tr(FAME_TAB_LABEL)}
            </button>
          )}
        </div>
        {fame && onFame ? FameBoard({ fame, entry: fameEntry, onSend: onSendFame }) : (
          <>
            <p class="tt-hint">{subtitle(model, now())}</p>
            {v.status === 'loading' && <p class="tt-muted">{tr(LOADING)}</p>}
            {v.status === 'error' && (
              <div class="tt-rank-error">
                <p class="tt-hint warn">{tr(v.message)}</p>
                {v.message !== NO_SEED && <button type="button" class="tt-btn" onClick={() => { void model.refresh(); }}>{t`Spróbuj jeszcze raz`}</button>}
              </div>
            )}
            {v.status === 'ready' && v.rows.length === 0 && <p class="tt-muted">{tr(EMPTY_BOARD)}</p>}
            {v.status === 'ready' && v.rows.length > 0 && (
              <ol class="tt-rank-list">
                {v.rows.map((r) => {
                  const me = model.isMine(r);
                  return (
                    <li key={`${r.rank}:${r.nick}`} class={`tt-rank-row${me ? ' me' : ''}`} aria-current={me ? 'true' : undefined}>
                      <span class="tt-rank-pos">{r.rank}.</span>
                      <span class="tt-rank-nick">{r.nick}{me ? t` (Ty)` : ''}</span>
                      {tab === 'global' && <span class="tt-rank-seed">{r.seed ?? t`seed nieznany`}</span>}
                      <span class="tt-rank-score">{signedZl(r.score)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {v.status === 'ready' && mine && !mineShown && (
              <p class="tt-rank-mine">{t`Twoje miejsce: ${mine.rank}. (${signedZl(mine.score)})`}</p>
            )}
            {!model.hasPlayer() && <p class="tt-hint">{tr(NO_PLAYER)}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Wstawia panel do `el` i od razu ładuje wybraną zakładkę. Zwraca funkcję, która go zdejmuje. Signals odświeżają panel same, gdy
 * przychodzą dane albo gracz zmienia zakładkę.
 */
export function mountRankingPanel(el: Element, props: RankingPanelProps, tab: RankingTab = 'global'): () => void {
  render(<RankingPanel {...props} />, el);
  void props.model.select(tab);
  return () => render(null, el);
}

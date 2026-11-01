import { signal } from '@preact/signals';
import { dateText, t } from '@/i18n';
import type { FirmState } from '@/sim/firm/types';
import { firm, type GameActions } from '../state';
import { signedZl } from '../game/format';
import { firmEventText, storeName, storeStateText } from './firmText';
import { isNetwork, storeMinis, type StoreMini, type StoreWarning } from './storeSwitcherModel';

/*
 * Chip sklepu w górnym pasku (spec §9.4): „Traszka #1, Ogrodowa” z listą sklepów po stuknięciu. Jest tylko przy dwóch otwartych sklepach.
 * Lista pokazuje mini-stan każdego sklepu (dzisiejszy wynik, „Zostanie”, zaufanie, znaki ostrzegawcze) i skrzynkę zastępcy; wiersz
 * przełącza sklep (`switchStore`, także w pauzie). Lista nie jest oknem: gra się nie zatrzymuje. Komponent bez haków, otwarcie listy trzyma
 * sygnał.
 */

/** Czy lista sklepów jest otwarta. Nie jest częścią zapisu i nie zatrzymuje gry (`isWindowOpen` jej nie liczy). */
export const storeList = signal(false);

/** Tyle najnowszych wpisów skrzynki zastępcy mieści lista (cała skrzynka ma ich do 30, `INBOX_MAX`). */
const INBOX_SHOWN = 5;

const WARNING_TEXT: Record<StoreWarning, () => string> = {
  paleta: () => t`paleta w przejściu`,
  polka: () => t`pusta półka`,
  zastepca: () => t`zastępca odpowiedział na kartę`,
};

const close = (): void => { storeList.value = false; };

/** Wiersz sklepu na liście (zwykła funkcja, nie komponent: testy `vnodeTree` widzą wtedy jego przycisk w drzewie chipa). */
function storeRow(f: FirmState, m: StoreMini, game: GameActions) {
  const pick = (): void => {
    if (m.closed) return;
    if (!m.active) game.firm({ type: 'switchStore', storeId: m.id });
    close();
  };
  return (
    <button key={m.id} type="button" class={`tt-store-row${m.active ? ' on' : ''}${m.closed ? ' closed' : ''}`} aria-current={m.active ? 'true' : undefined} disabled={m.closed} onClick={pick}>
      <span class="tt-store-name"><b>{storeName(f, m.id)}</b><span class="tt-muted">{storeStateText(f, f.stores.find((st) => st.id === m.id)!)}</span></span>
      {!m.closed && (
        <span class="tt-store-stats">{`${t`Dziś ${signedZl(m.todayProfit)}`} · ${t`Zostanie ${signedZl(m.net)}`} · 🤝 ${Math.round(m.trust)}`}</span>
      )}
      {m.warnings.map((w) => <span key={w} class="tt-store-warn" data-warn={w}>{`⚠ ${WARNING_TEXT[w]()}`}</span>)}
    </button>
  );
}

/** Skrzynka zastępcy: najnowsze odpowiedzi na karty sklepów w tle, najnowsza pierwsza (zwykła funkcja z tego samego powodu co `storeRow`). */
function inbox(f: FirmState) {
  const notes = f.inbox.slice(-INBOX_SHOWN).reverse();
  return (
    <section class="tt-inbox" aria-label={t`Skrzynka zastępcy`}>
      <h3>{t`Skrzynka zastępcy`}</h3>
      {notes.length === 0 && <p class="tt-hint">{t`Zastępca jeszcze niczego nie rozstrzygał.`}</p>}
      {notes.map((n, i) => (
        <div key={`${n.day}-${n.storeId}-${n.card}-${i}`} class="tt-inbox-row">
          <span class="tt-muted">{dateText(n.day)}</span>
          <span>{firmEventText(f, { kind: 'deputy', storeId: n.storeId, params: { card: n.card, answer: n.answer } }).text}</span>
        </div>
      ))}
    </section>
  );
}

/** Rząd paska z chipem aktywnego sklepu i, po stuknięciu, listą sklepów. Przy jednym otwartym sklepie albo bez firmy nic nie rysuje. */
export function StoreSwitcher({ game }: { game: GameActions }) {
  const view = firm.value;
  if (!view || !isNetwork(view.f)) {
    if (storeList.peek()) queueMicrotask(close);   // chip zniknął przy otwartej liście: nie wraca ona otwarta, gdy drugi sklep znów się otworzy
    return null;
  }
  const { f } = view;
  const open = storeList.value;
  const minis = storeMinis(f);
  const alert = minis.some((m) => !m.active && m.warnings.length > 0);   // sklep w tle woła o uwagę, a aktywny widać na ekranie
  return (
    <div class="tt-hud-row tt-hud-stores">
      <button type="button" class={`tt-stores-chip${open ? ' open' : ''}`} data-tut="store-switch" aria-haspopup="true" aria-expanded={open}
        title={t`Przełącz sklep`} onClick={() => { storeList.value = !open; }}>
        <span class="tt-stores-name">{storeName(f, f.activeId)}</span>
        {alert && <span class="tt-stores-alert" role="img" aria-label={t`Sklep w tle wymaga uwagi`}>⚠</span>}
        <span class="tt-stores-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <div class="tt-stores-backdrop" onClick={close} />
          <div class="tt-stores-pop" role="group" aria-label={t`Sklepy`}>
            {minis.map((m) => storeRow(f, m, game))}
            {inbox(f)}
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import { RETURN_FEE } from '@/sim/economy/catalog';
import { effects, giftOpen, isStoreOpen, slotFree, slotUsage, tapCombo, type MonthReport } from '@/sim/economy/economy';
import { EQUIPMENT, EQUIPMENT_BY_ID, equipmentCost } from '@/sim/economy/upgrades';
import type { QualityPresetId } from '@/render/quality';
import { networkIncomeOf, prestigePoints } from '@/game/meta';
import {
  celebration, ephemeral, econ, hints, metaView, nextHint, preset, report, selection, seed, showPerf, showPrestige, showSettings,
  start, tab, toasts, welcome, type Controls, type GameActions,
} from '../state';
import { int, plural, signedZl, zl } from './format';
import { PalletItem } from './panels';

export const DISCLAIMER = 'Wszystkie firmy, postacie i zdarzenia są fikcyjne.';

/** Karta zaznaczonego obiektu (paleta, slot, kasa) nad dolnym paskiem. */
export function SelectionCard({ game }: { game: GameActions }) {
  const view = econ.value;
  const sel = selection.value;
  if (!view || !sel || tab.value) return null;
  const { s, info } = view;
  const close = (): void => { selection.value = null; };
  let body;
  if (sel.kind === 'pallet') {
    body = (
      <>
        <h3>Paleta</h3>
        <PalletItem s={s} info={info} id={sel.id} game={game} compact />
        <p class="tt-hint">Stukaj w paletę w sklepie, żeby rozładowywać. Odesłanie ({RETURN_FEE} zł): zakładka Palety.</p>
      </>
    );
  } else if (sel.kind === 'till') {
    const fx = effects(s, info);
    body = (
      <>
        <h3>Kasa</h3>
        <p>Kolejka: <b>{int(s.queue)}</b> · na kasie: {s.lastCashiers} {plural(s.lastCashiers, 'osoba', 'osoby', 'osób')} · SCO: {fx.sco}</p>
        <button type="button" class="tt-btn tt-primary big" disabled={!isStoreOpen(s) || s.queue < 1} onClick={() => game.dispatch({ type: 'tapTill' })}>Obsłuż klienta</button>
        <p class="tt-hint">Stuknięcie w kasę w sklepie też obsługuje klienta. Ty też umiesz kasować.</p>
      </>
    );
  } else {
    const slot = info.slots.find((x) => x.id === sel.slotId);
    if (!slot) return null;
    const free = slotFree(s, info, slot.id);
    const items = slotUsage(s).get(slot.id) ?? [];
    body = (
      <>
        <h3>Slot {slot.capacity === 2 ? '2×2' : '2×1'}</h3>
        <p>{items.length ? `Stoi tu: ${items.map((id) => EQUIPMENT_BY_ID[id].name).join(', ')}.` : 'Pusty slot.'} Wolne miejsce: {free}.</p>
        {free > 0
          ? EQUIPMENT.filter((e) => e.size <= free).map((e) => {
            const cost = equipmentCost(e, s.equipment.filter((x) => x.id === e.id).length);
            return (
              <div key={e.id} class="tt-item">
                <div><b>{e.name}</b><div class="tt-muted">{e.effect}</div></div>
                <button type="button" class="tt-btn tt-buy" disabled={cost > s.cash} onClick={() => game.dispatch({ type: 'buyEquipment', id: e.id, slotId: slot.id })}>{zl(cost)}</button>
              </div>
            );
          })
          : <p class="tt-hint">Slot pełny. Więcej slotów da remont (Ulepszenia → Remont).</p>}
      </>
    );
  }
  return (
    <div class="tt-card" role="dialog" aria-label="Zaznaczony obiekt">
      <button type="button" class="tt-iconbtn tt-card-close" aria-label="Zamknij" onClick={close}>✕</button>
      {body}
    </div>
  );
}

/** Duże przyciski klikera nad dolnym paskiem: rozładuj najpilniejszą paletę, obsłuż klienta. */
export function ClickerBar({ game, onFloat }: { game: GameActions; onFloat: (x: number, y: number, text: string, kind: 'money' | 'work') => void }) {
  const view = econ.value;
  if (!view || tab.value || selection.value) return null;
  const { s } = view;
  const pallets = s.pallets.length;
  const q = Math.round(s.queue);
  const at = (e: MouseEvent): [number, number] => [e.clientX || window.innerWidth - 60, e.clientY || window.innerHeight - 140];
  return (
    <div class="tt-clicker">
      <button type="button" class="tt-fab" disabled={pallets === 0} aria-label={`Rozładuj paletę (${pallets})`}
        onClick={(e) => { const r = game.dispatch({ type: 'tapPallet' }); if (r.ok) onFloat(...at(e), `+${Math.round(r.value ?? 0)} szt.`, 'work'); }}>
        <span aria-hidden="true">📦</span>{pallets > 0 && <span class="tt-badge">{pallets}</span>}
      </button>
      <button type="button" class="tt-fab" disabled={q < 1 || !isStoreOpen(s)} aria-label={`Obsłuż klienta (${q} w kolejce)`}
        onClick={(e) => { const r = game.dispatch({ type: 'tapTill' }); if (r.ok) onFloat(...at(e), `+${(r.value ?? 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`, 'money'); }}>
        <span aria-hidden="true">🧾</span>{q > 0 && <span class="tt-badge">{q}</span>}
      </button>
    </div>
  );
}

export function RotateButtons({ controls }: { controls: Controls }) {
  if (tab.value) return null;
  return (
    <div class="tt-rotate">
      <button type="button" class="tt-iconbtn" aria-label="Obróć w lewo (Q)" onClick={() => controls.rotate(-1)}>⟲</button>
      <button type="button" class="tt-iconbtn" aria-label="Obróć w prawo (E)" onClick={() => controls.rotate(1)}>⟳</button>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="tt-toasts" aria-live="polite">
      {toasts.value.map((t) => <div key={t.id} class={`tt-toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

function ReportBody({ r }: { r: MonthReport }) {
  const c = r.counters;
  return (
    <>
      <div class="tt-row"><span>Klienci</span><span>{int(c.customers)} (utraceni: {int(c.lost)})</span></div>
      <div class="tt-row"><span>Obrót</span><span>{zl(c.revenue)}</span></div>
      <div class="tt-row"><span>Marża i inne przychody</span><span>{zl(c.margin + c.other)}</span></div>
      <div class="tt-row"><span>Płace</span><span>−{zl(c.wages)}</span></div>
      <div class="tt-row"><span>Media</span><span>−{zl(c.media)}</span></div>
      <div class="tt-row"><span>Opłata franczyzowa</span><span>−{zl(c.fee)}</span></div>
      <div class="tt-row"><span>Mandaty</span><span>−{zl(c.fines)}</span></div>
      <div class="tt-row"><span>Logistyka</span><span>−{zl(c.logistics)}</span></div>
      <div class="tt-row total"><span>Wynik miesiąca</span><span>{signedZl(r.profit)}</span></div>
      <div class="tt-row"><span>Inwestycje</span><span>{zl(c.investments)}</span></div>
      <div class="tt-row"><span>Gotówka na koniec</span><span>{zl(r.cash)}</span></div>
    </>
  );
}

/**
 * Raport miesięczny (pauzuje grę). Przy wypowiedzeniu umowy: koniec gry i nowy start. Okno końca gry wynika ze stanu
 * (`gameOver` i ostatni raport w zapisie), więc wraca po przeładowaniu strony; zapis sprzed tej poprawki nie ma raportu
 * i pokazuje samo wypowiedzenie.
 */
export function ReportModal({ game }: { game: GameActions }) {
  const view = econ.value;
  const over = !!view?.s.gameOver;
  const r = report.value ?? (over ? view?.s.lastReport ?? null : null);
  if (!r && !over) return null;
  const title = over ? 'Koniec współpracy' : `Raport: ${r!.label}`;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {r && <ReportBody r={r} />}
        <p class="tt-quote">„{over ? 'Centrala dziękuje za współpracę. Rozliczenie końcowe: inwentaryzacja jutro o 6:00.' : r!.comment}”<br /><span class="tt-muted">— Centrala</span></p>
        {over
          ? <button type="button" class="tt-btn tt-primary big" onClick={() => game.restart()}>Zacznij od nowa</button>
          : <button type="button" class="tt-btn tt-primary big" onClick={() => { report.value = null; }}>Dalej</button>}
      </div>
    </div>
  );
}

/**
 * Podpowiedzi pierwszego dnia nowej gry: krótkie dymki zamiast dawnego okna „Witaj w Traszce” (jego wskazówki, po jednej na
 * dymek). Nie pauzują gry. Zastrzeżenie o fikcji zostało na ekranie startowym i w ⚙.
 */
export const FIRST_DAY_HINTS: readonly string[] = [
  '🦎 Od dziś prowadzisz franczyzę Traszki. Cel: zbudować sieć Traszek i dojść do rangi Legendarnej Palety.',
  '📦 Palety przyjeżdżają pod sklep. Stukaj w nie, żeby rozładować, zanim przyjdzie Straż Miejska. Złota paleta to premia.',
  '🧾 Kolejka za długa? Klienci odchodzą. Stuknij w kasę, kup kasę samoobsługową albo zatrudnij pracownika.',
  '🎯 Zlecenia Centrali (zakładka Cele) dają nagrody, a poziomy odblokowują sprzęt, remonty i warsztat.',
  '🎁 Łap paczki od Centrali, gdy pojawią się nad sklepem.',
  '👆 Przeciągnij, żeby przesunąć widok, a szczypnięciem albo kółkiem myszy przybliżysz. Gra zapisuje się sama.',
];

/** Dymek z bieżącą podpowiedzią pierwszego dnia; „Dalej” przeskakuje, a kolejna wchodzi sama (`state.ts`). */
export function FirstDayHints() {
  const list = hints.value;
  if (list.length === 0) return null;
  return (
    <div class="tt-hintbubble" role="status">
      <span class="tt-hintbubble-text">{list[0]}</span>
      <button type="button" class="tt-btn tt-hintbubble-next" onClick={nextHint}>{list.length > 1 ? 'Dalej' : 'OK'}</button>
    </div>
  );
}

export const EPHEMERAL_BADGE = 'Sklep tymczasowy: postęp nie jest zapisywany';
export const EPHEMERAL_NOTE = 'Ten sklep jest tymczasowy: nic się w nim nie zapisuje, a ewentualny zapis pod jego seedem zostaje nietknięty.';
export const RESTART_CONFIRM = 'Zacząć od nowa w tym sklepie? Zapis zostanie usunięty.';

/** Stała plakietka na ekranie gry, gdy sklep jest tymczasowy (zapis się nie zbudował albo jest z nowszej wersji gry). */
export function StoreBadge() {
  if (!ephemeral.value) return null;
  return <div class="tt-ephemeral" role="status">{EPHEMERAL_BADGE}</div>;
}

/**
 * Przyciski sklepu w ⚙: „Nowy sklep” (ekran startowy) zawsze, „Zacznij od nowa” (kasuje zapis tego sklepu) tylko w zwykłym.
 * W sklepie tymczasowym nic nie jest zapisane ani kasowane, więc zamiast „Zacznij od nowa” jest wyjaśnienie, a zapis pod
 * tym seedem zostaje nietknięty.
 */
export function StoreActions({ ephemeral: temporary, onNewStore, onRestart }: { ephemeral: boolean; onNewStore: () => void; onRestart: () => void }) {
  return (
    <div class="tt-store-actions">
      <button type="button" class="tt-btn" onClick={onNewStore}>Nowy sklep</button>
      {temporary
        ? <p class="tt-hint">{EPHEMERAL_NOTE}</p>
        : <button type="button" class="tt-btn" onClick={onRestart}>Zacznij od nowa</button>}
    </div>
  );
}

const PRESETS: { value: QualityPresetId; label: string }[] = [
  { value: 'niska', label: 'Niska' },
  { value: 'srednia', label: 'Średnia' },
  { value: 'wysoka', label: 'Wysoka' },
];

/** Ustawienia: seed sklepu, nowy sklep i nowa gra, jakość grafiki, nakładka wydajności, zastrzeżenie. */
export function Settings({ controls, game }: { controls: Controls; game: GameActions }) {
  const [draft, setDraft] = useState(seed.value);
  useEffect(() => { setDraft(seed.value); }, [seed.value, showSettings.value]);
  if (!showSettings.value) return null;
  const close = (): void => { showSettings.value = false; };
  return (
    <div class="tt-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="tt-modal" role="dialog" aria-label="Ustawienia">
        <button type="button" class="tt-iconbtn tt-card-close" aria-label="Zamknij" onClick={close}>✕</button>
        <h2>Ustawienia</h2>
        <h3>Sklep (seed)</h3>
        <p class="tt-hint">Ten sam seed to ten sam sklep. Każdy seed ma własny zapis gry.</p>
        <form class="tt-seed" onSubmit={(e) => { e.preventDefault(); controls.generate(draft); close(); }}>
          <input class="tt-input" type="text" value={draft} aria-label="Seed sklepu" maxLength={64} spellcheck={false} autocomplete="off"
            onInput={(e) => setDraft(e.currentTarget.value)} />
          <button type="submit" class="tt-btn tt-primary">Otwórz</button>
          <button type="button" class="tt-btn" onClick={() => { controls.randomize(); close(); }}>Losuj</button>
        </form>
        <StoreActions ephemeral={ephemeral.value} onNewStore={() => { close(); game.newStore(); }}
          onRestart={() => { if (confirm(RESTART_CONFIRM)) { game.restart(); close(); } }} />
        <h3>Grafika</h3>
        <div class="tt-seg wide" role="group" aria-label="Jakość grafiki">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" class={`tt-btn${preset.value === p.value ? ' on' : ''}`} onClick={() => controls.setPreset(p.value)}>{p.label}</button>
          ))}
        </div>
        <h3>Dźwięk i wibracje</h3>
        <label class="tt-check-row"><input type="checkbox" checked={metaView.value.sound} onChange={(e) => game.setSound(e.currentTarget.checked)} /> Dźwięki</label>
        <label class="tt-check-row"><input type="checkbox" checked={metaView.value.vibration} onChange={(e) => game.setVibration(e.currentTarget.checked)} /> Wibracje (telefon)</label>
        <label class="tt-check-row"><input type="checkbox" checked={showPerf.value} onChange={(e) => { showPerf.value = e.currentTarget.checked; }} /> Licznik FPS (F3)</label>
        <p class="tt-hint">Klawisze: Q/E obrót, +/− zoom, strzałki przesuwanie, spacja pauza, X widok z zewnątrz.</p>
        <p class="tt-disclaimer2">{DISCLAIMER} Gra jest satyrą i nie ma związku z żadną prawdziwą siecią sklepów.</p>
      </div>
    </div>
  );
}

/** Wielki baner nagrody (nowy poziom): konfetti robi main.ts, baner znika sam albo po stuknięciu. */
export function CelebrationBanner() {
  const c = celebration.value;
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(() => { if (celebration.value === c) celebration.value = null; }, 3200);
    return () => clearTimeout(t);
  }, [c]);
  if (!c) return null;
  return (
    <div class="tt-celebrate" role="status" onClick={() => { celebration.value = null; }}>
      <div class="tt-celebrate-card">
        <div class="tt-celebrate-title">{c.title}</div>
        <div class="tt-celebrate-sub">{c.subtitle}</div>
        {c.lines.map((l) => <div key={l} class="tt-celebrate-line">{l}</div>)}
      </div>
    </div>
  );
}

/** „Witaj z powrotem”: zarobek kierownika zmiany pod nieobecność i premia za serię dni. */
export function WelcomeModal({ game }: { game: GameActions }) {
  const w = welcome.value;
  if (!w) return null;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-center" role="dialog" aria-label="Witaj z powrotem">
        <h2>Witaj z powrotem! 👋</h2>
        {w.offline > 0 && (
          <p>Przez {w.hours >= 1 ? `${Math.floor(w.hours)} h` : `${Math.max(1, Math.round(w.hours * 60))} min`} Twojej nieobecności kierownik zmiany zarobił
            <span class="tt-big-reward">+{zl(w.offline)}</span></p>
        )}
        {w.daily && w.streak !== null && (
          <>
            <p>Premia Centrali za {w.streak}. dzień z rzędu:</p>
            <div class="tt-streak">{Array.from({ length: 7 }, (_, i) => <span key={i} class={i < Math.min(7, w.streak!) ? 'on' : ''}>{i + 1}</span>)}</div>
            <span class="tt-big-reward">+{zl(w.daily.cash)} · +{w.daily.ogonki} 🦎</span>
            <p class="tt-hint">Wróć jutro: premia rośnie do 7. dnia.</p>
          </>
        )}
        <button type="button" class="tt-btn tt-primary big" onClick={() => game.claimWelcome()}>Odbierz!</button>
      </div>
    </div>
  );
}

/** Potwierdzenie: obecny sklep dołącza do sieci, zaczynasz nowy z premią. */
export function PrestigeModal({ game }: { game: GameActions }) {
  const view = econ.value;
  if (!showPrestige.value || !view) return null;
  const { s } = view;
  const meta = metaView.value;
  const points = meta.points + prestigePoints(s);
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal" role="dialog" aria-label="Otwórz kolejną Traszkę">
        <h2>Otwórz kolejną Traszkę 🏪</h2>
        <p>Ten sklep zostaje w Twojej sieci i od jutra zarabia na Ciebie <b>{zl(networkIncomeOf(s))} dziennie</b> w każdej kolejnej grze.</p>
        <p>Dostajesz <b>+{prestigePoints(s)} Punktów Partnera</b> (razem {points}): każdy to trwale +4% marży i +3% klientów.</p>
        <p>Nowy lokal startuje od zera: poziom 1, 2000 zł, nowe miasto z seeda. Tym razem pójdzie szybciej.</p>
        <p class="tt-hint">Centrala z wyraźną niechęcią nadaje Ci status Partnera Strategicznego.</p>
        <button type="button" class="tt-btn tt-primary big" onClick={() => { showPrestige.value = false; game.openNextStore(); }}>Otwieramy!</button>
        <button type="button" class="tt-btn big" onClick={() => { showPrestige.value = false; }}>Jeszcze nie</button>
      </div>
    </div>
  );
}

/** Miejsce paczki w oknie z `giftAt`: ułamki okna w procentach, losowane raz na okno (kolejne renderowanie tego samego okna je zachowuje). */
let giftSpot: { window: number; x: number; y: number } | null = null;
function spotFor(giftAt: number): { x: number; y: number } {
  if (giftSpot?.window === giftAt) return giftSpot;
  giftSpot = { window: giftAt, x: 20 + Math.random() * 60, y: 30 + Math.random() * 30 };
  return giftSpot;
}

/**
 * Paczka od Centrali. Okno paczki daje symulacja, nie timer interfejsu: `giftOpen` jest prawdą od minuty `giftAt` przez
 * `GIFT_OPEN` minut gry (ok. 9 s przy ×1, krócej przy większej prędkości), więc paczka stoi w pauzie, a po wczytaniu zapisu
 * wraca tam, gdzie była. Interfejs losuje tylko miejsce nad sceną, raz na okno (klucz `giftAt`; `Math.random` w `ui` jest
 * dozwolony, bo to nie symulacja). Odbiór to polecenie `claimGift`: symulacja zamyka okno i planuje następne. Nie pokazuje się
 * przy otwartym raporcie, ekranie startowym, powitaniu ani ustawieniach.
 */
export function GiftDrop({ game, onClaim }: { game: GameActions; onClaim: (x: number, y: number, text: string) => void }) {
  const view = econ.value;
  if (!view || !giftOpen(view.s) || report.value || start.value || welcome.value || showSettings.value) return null;
  const spot = spotFor(view.s.giftAt);
  return (
    <button type="button" class="tt-gift" style={{ left: `${spot.x}%`, top: `${spot.y}%` }} aria-label="Paczka od Centrali"
      onClick={() => {
        const r = game.dispatch({ type: 'claimGift' });
        if (r.ok) onClaim(window.innerWidth * spot.x / 100, window.innerHeight * spot.y / 100, r.text ?? '');
      }}>
      🎁
    </button>
  );
}

/** Licznik combo nad przyciskami klikera: seria szybkich stuknięć ze stanu symulacji (`tapCombo`), widoczna od 3 stuknięć. */
export function ComboChip() {
  const view = econ.value;
  if (!view) return null;
  const c = tapCombo(view.s);
  if (c.count < 3) return null;
  return <div class={`tt-combo m${Math.min(5, c.mult)}`} key={c.mult}>COMBO ×{c.mult}<small>{c.count} stuknięć</small></div>;
}

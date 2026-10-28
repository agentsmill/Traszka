import { useEffect, useState } from 'preact/hooks';
import { RETURN_FEE } from '@/sim/economy/catalog';
import { effects, isStoreOpen, slotFree, slotUsage, type MonthReport } from '@/sim/economy/economy';
import { EQUIPMENT, EQUIPMENT_BY_ID, equipmentCost } from '@/sim/economy/upgrades';
import type { QualityPresetId } from '@/render/quality';
import {
  econ, preset, report, selection, seed, showIntro, showSettings, showPerf, tab, toasts, type Controls, type GameActions,
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
        <button type="button" class="tt-btn tt-primary big" disabled={!isStoreOpen(s) || s.queue < 1} onClick={() => game.tapTill()}>Obsłuż klienta</button>
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
                <button type="button" class="tt-btn tt-buy" disabled={cost > s.cash} onClick={() => game.buyEquipment(e.id, slot.id)}>{zl(cost)}</button>
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
        onClick={(e) => { const r = game.tapPallet(); if (r.ok) onFloat(...at(e), `+${Math.round(r.value ?? 0)} szt.`, 'work'); }}>
        <span aria-hidden="true">📦</span>{pallets > 0 && <span class="tt-badge">{pallets}</span>}
      </button>
      <button type="button" class="tt-fab" disabled={q < 1 || !isStoreOpen(s)} aria-label={`Obsłuż klienta (${q} w kolejce)`}
        onClick={(e) => { const r = game.tapTill(); if (r.ok) onFloat(...at(e), `+${(r.value ?? 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`, 'money'); }}>
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

/** Raport miesięczny (pauzuje grę). Przy wypowiedzeniu umowy: koniec gry i nowy start. */
export function ReportModal({ game }: { game: GameActions }) {
  const r = report.value;
  const view = econ.value;
  if (!r) return null;
  const over = !!view?.s.gameOver;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal" role="dialog" aria-label={`Raport: ${r.label}`}>
        <h2>{over ? 'Koniec współpracy' : `Raport: ${r.label}`}</h2>
        <ReportBody r={r} />
        <p class="tt-quote">„{over ? 'Centrala dziękuje za współpracę. Rozliczenie końcowe: inwentaryzacja jutro o 6:00.' : r.comment}”<br /><span class="tt-muted">— Centrala</span></p>
        {over
          ? <button type="button" class="tt-btn tt-primary big" onClick={() => game.restart()}>Zacznij od nowa</button>
          : <button type="button" class="tt-btn tt-primary big" onClick={() => { report.value = null; }}>Dalej</button>}
      </div>
    </div>
  );
}

/** Ekran powitalny nowej gry: o co chodzi, sterowanie, zastrzeżenie. Pauzuje grę do „Otwieramy!”. */
export function Intro() {
  if (!showIntro.value) return null;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal" role="dialog" aria-label="Witaj w Traszce">
        <h2>Witaj w Traszce! 🦎</h2>
        <p>Od dziś prowadzisz franczyzę Traszki. Sklep jest pełen towaru Centrali, a w kasie {zl(2000)}. Cel: najwydajniejsza Traszka w mieście.</p>
        <ul class="tt-list">
          <li><b>Palety</b> przyjeżdżają co rano pod sklep. Stukaj w nie, żeby rozładować, zanim przyjdzie Straż Miejska.</li>
          <li><b>Kolejka</b> za długa? Klienci odchodzą. Stukaj w kasę, kupuj kasy samoobsługowe, zatrudniaj.</li>
          <li><b>Ulepszenia</b> kupujesz za zarobione pieniądze. Remont powiększa sklep, a warsztat złotej rączki da automatykę.</li>
        </ul>
        <p class="tt-hint">Przeciągnij, żeby przesunąć widok. Szczypnij albo kółkiem myszy, żeby przybliżyć. Gra zapisuje się sama.</p>
        <p class="tt-disclaimer2">{DISCLAIMER}</p>
        <button type="button" class="tt-btn tt-primary big" onClick={() => { showIntro.value = false; }}>Otwieramy sklep!</button>
      </div>
    </div>
  );
}

const PRESETS: { value: QualityPresetId; label: string }[] = [
  { value: 'niska', label: 'Niska' },
  { value: 'srednia', label: 'Średnia' },
  { value: 'wysoka', label: 'Wysoka' },
];

/** Ustawienia: seed sklepu, nowa gra, jakość grafiki, nakładka wydajności, zastrzeżenie. */
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
        <button type="button" class="tt-btn" onClick={() => { if (confirm('Zacząć od nowa w tym sklepie? Zapis zostanie usunięty.')) { game.restart(); close(); } }}>Zacznij od nowa</button>
        <h3>Grafika</h3>
        <div class="tt-seg wide" role="group" aria-label="Jakość grafiki">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" class={`tt-btn${preset.value === p.value ? ' on' : ''}`} onClick={() => controls.setPreset(p.value)}>{p.label}</button>
          ))}
        </div>
        <label class="tt-check-row"><input type="checkbox" checked={showPerf.value} onChange={(e) => { showPerf.value = e.currentTarget.checked; }} /> Licznik FPS (F3)</label>
        <p class="tt-hint">Klawisze: Q/E obrót, +/− zoom, strzałki przesuwanie, spacja pauza, X widok z zewnątrz.</p>
        <p class="tt-disclaimer2">{DISCLAIMER} Gra jest satyrą i nie ma związku z żadną prawdziwą siecią sklepów.</p>
      </div>
    </div>
  );
}

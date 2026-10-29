import { useEffect, useState } from 'preact/hooks';
import { DEBT_LIMIT, RETURN_FEE } from '@/sim/economy/catalog';
import {
  DEBT_WARN, debtWarningText, effects, slotFree, slotUsage, tapCombo, tillTapBlock, type EconomyState, type MonthReport,
} from '@/sim/economy/economy';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { FATIGUE } from '@/sim/economy/tycoon/fatigue';
import { REPORT_LINE_LABEL, hintText, reportCommentText } from '@/sim/economy/tycoon/report';
import { TRUST_REASON_LABEL, trustTerminates } from '@/sim/economy/tycoon/trust';
import { EQUIPMENT, EQUIPMENT_BY_ID, equipmentCost } from '@/sim/economy/upgrades';
import type { QualityPresetId } from '@/render/quality';
import { networkIncomeOf, prestigePoints } from '@/game/meta';
import {
  celebration, dismissStory, ephemeral, econ, hints, howTo, metaView, nextHint, openHowTo, preset, report, selection, seed, showPerf, showPrestige,
  showSettings, story, tab, toasts, welcome, type Controls, type GameActions,
} from '../state';
import { int, people, signedPts, signedZl, zl } from './format';
import { Bar, PalletItem } from './panels';
import { ENERGY_TITLE, NO_ENERGY_TITLE, tapBlock, tillReason } from './tapBlock';

export const DISCLAIMER = 'Wszystkie firmy, postacie i zdarzenia są fikcyjne.';

export { NO_ENERGY_TITLE, tapBlock };

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
        <p>Kolejka: <b>{int(s.queue)}</b> · na kasie: {people(s.lastCashiers)} os. · SCO: {fx.sco}</p>
        <button type="button" class="tt-btn tt-primary big" disabled={!!tillReason(s, info)} title={tillReason(s, info)}
          onClick={() => game.dispatch({ type: 'tapTill' })}>Obsłuż klienta</button>
        <p class="tt-hint">{tillTapBlock(s, info) ?? 'Kolejka przerasta kasjera: staniesz przy drugiej kasie.'} Stukanie pomaga tylko, gdy przy kasie nikogo nie ma albo kolejka rośnie.</p>
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

/** Poniżej tylu sił pasek klikera ostrzega (do końca puli zostaje kilkanaście stuknięć). */
export const LOW_ENERGY = 20;

/**
 * Duże przyciski klikera nad dolnym paskiem: rozładuj najpilniejszą paletę, obsłuż klienta; nad nimi pasek sił franczyzobiorcy.
 * Blokady stuknięcia opisuje `tapBlock`; kasa dodatkowo działa tylko wtedy, gdy pomaga (`tillTapBlock`: sklep otwarty, ktoś
 * czeka, a przy kasie nikogo nie ma albo kolejka przerasta kasjera), i wtedy przy przycisku stoi krótki powód.
 */
export function ClickerBar({ game, onFloat }: { game: GameActions; onFloat: (x: number, y: number, text: string, kind: 'money' | 'work') => void }) {
  const view = econ.value;
  if (!view || tab.value || selection.value) return null;
  const { s } = view;
  const pallets = s.pallets.length;
  const q = Math.round(s.queue);
  const energy = s.tycoon.fatigue.energy;
  const palletBlock = tapBlock(s, 'paleta');
  const tillBlock = tillReason(s, view.info);
  const tillNote = tillTapBlock(s, view.info)?.replace(/\.$/, '');
  const at = (e: MouseEvent): [number, number] => [e.clientX || window.innerWidth - 60, e.clientY || window.innerHeight - 140];
  return (
    <div class="tt-clicker">
      <div class="tt-energy" title={ENERGY_TITLE}>
        <span>Siły {int(energy)}/{FATIGUE.pool}</span>
        <Bar value={energy / FATIGUE.pool} warn={energy < LOW_ENERGY} />
      </div>
      <button type="button" class="tt-fab" disabled={pallets === 0 || !!palletBlock} title={palletBlock} aria-label={`Rozładuj paletę (${pallets})`}
        onClick={(e) => { const r = game.dispatch({ type: 'tapPallet' }); if (r.ok) onFloat(...at(e), `+${Math.round(r.value ?? 0)} szt.`, 'work'); }}>
        <span aria-hidden="true">📦</span>{pallets > 0 && <span class="tt-badge">{pallets}</span>}
      </button>
      <div class="tt-fab-slot">
        {tillNote && <span class="tt-fab-note">{tillNote}</span>}
        <button type="button" class="tt-fab" disabled={!!tillBlock} title={tillBlock} aria-label={`Obsłuż klienta (${q} w kolejce)`}
          onClick={(e) => { const r = game.dispatch({ type: 'tapTill' }); if (r.ok) onFloat(...at(e), `+${(r.value ?? 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`, 'money'); }}>
          <span aria-hidden="true">🧾</span>{q > 0 && <span class="tt-badge">{q}</span>}
        </button>
      </div>
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

/** Ile przyczyn zmiany zaufania mieści raport (od największej co do wartości; sim sortuje je w `closeTrustMonth`). */
const REPORT_TRUST_REASONS = 4;

/** Kwota pozycji raportu: koszty (ujemne) ze znakiem minus, przychody bez. Zaokrąglone do złotych; zero zostaje „0 zł” (nie „−0”). */
const lineAmount = (amount: number): string => {
  const r = Math.round(amount);
  return r < 0 ? `−${zl(-r)}` : zl(Math.abs(r));
};

/** Komentarz Centrali (zwykła funkcja, nie komponent: testy `vnodeTree` widzą wtedy jego tekst). */
const centralaQuote = (text: string) => <p class="tt-quote">„{text}”<br /><span class="tt-muted">— Centrala</span></p>;

/**
 * Treść raportu miesięcznego. Z danymi tycoona (`detail`): wynik dużą liczbą, pozycje z `REPORT_LINE_LABEL` (koszty ze znakiem
 * minus), zaufanie Centrali z przyczynami, komentarz, jedna wskazówka i KPI miesiąca. Raport ze starego zapisu (`detail` równe
 * null) zostaje dawnym widokiem: marża i inne przychody, premie Centrali (osobny licznik) i koszty (z ubytkami ponad limit Centrali) sumują się
 * do wyniku miesiąca. `closing` zastępuje komentarz Centrali (wypowiedzenie umowy przy końcu gry).
 */
export function ReportBody({ r, closing }: { r: MonthReport; closing?: string }) {
  const c = r.counters;
  const d = r.detail;
  if (!d) {
    return (
      <>
        <div class="tt-row"><span>Klienci</span><span>{int(c.customers)} (utraceni: {int(c.lost)})</span></div>
        <div class="tt-row"><span>Obrót</span><span>{zl(c.revenue)}</span></div>
        <div class="tt-row"><span>Marża i inne przychody</span><span>{zl(c.margin + c.other)}</span></div>
        <div class="tt-row"><span>Premie Centrali</span><span>{zl(c.bonus)}</span></div>
        <div class="tt-row"><span>Płace</span><span>−{zl(c.wages)}</span></div>
        <div class="tt-row"><span>Media</span><span>−{zl(c.media)}</span></div>
        <div class="tt-row"><span>Opłata franczyzowa</span><span>−{zl(c.fee)}</span></div>
        <div class="tt-row"><span>Mandaty</span><span>−{zl(c.fines)}</span></div>
        <div class="tt-row"><span>Ubytki ponad limit Centrali</span><span>−{zl(c.wut)}</span></div>
        <div class="tt-row"><span>Logistyka</span><span>−{zl(c.logistics)}</span></div>
        <div class="tt-row total"><span>Wynik miesiąca</span><span>{signedZl(r.profit)}</span></div>
        <div class="tt-row"><span>Inwestycje</span><span>{zl(c.investments)}</span></div>
        <div class="tt-row"><span>Gotówka na koniec</span><span>{zl(r.cash)}</span></div>
        {r.cash < DEBT_WARN && <p class="tt-hint warn">{debtWarningText(r.cash)}</p>}
        {centralaQuote(closing ?? r.comment)}
      </>
    );
  }
  // wynik w nagłówku to suma pozycji tak, jak je widać (każda zaokrąglona do złotych): zaokrąglenie samej sumy bywa o 1 zł obok
  const result = d.lines.reduce((n, l) => n + Math.round(l.amount), 0);
  const t = d.trust;
  const kpiWeeks = d.kpi.hit + d.kpi.miss;
  return (
    <>
      <div class="tt-report-head">
        <span class="tt-muted">Wynik miesiąca</span>
        <b class={`tt-report-result ${result < 0 ? 'neg' : 'pos'}`}>{signedZl(result)}</b>
        <span class="tt-muted">Obrót {zl(d.revenue)} · klienci {int(c.customers)} (utraceni: {int(c.lost)})</span>
        <span class="tt-muted">Gotówka na koniec: {zl(r.cash)} · inwestycje: {zl(c.investments)}</span>
      </div>
      {r.cash < DEBT_WARN && <p class="tt-hint warn">{debtWarningText(r.cash)}</p>}
      <div class="tt-report-lines">
        {d.lines.map((l) => (
          <div key={l.key} class="tt-row"><span>{REPORT_LINE_LABEL[l.key]}</span><span class={Math.round(l.amount) < 0 ? 'tt-neg' : undefined}>{lineAmount(l.amount)}</span></div>
        ))}
      </div>
      <div class="tt-report-trust">
        <div class="tt-row"><b>Zaufanie Centrali: {int(t.start)} → {int(t.end)}</b><span class={t.delta < 0 ? 'tt-neg' : undefined}>{signedPts(t.delta)} pkt</span></div>
        {t.reasons.slice(0, REPORT_TRUST_REASONS).map(([reason, v]) => (
          <div key={reason} class="tt-row tt-reason"><span>{TRUST_REASON_LABEL[reason]}</span><span class={v < 0 ? 'tt-neg' : 'tt-pos'}>{signedPts(v)}</span></div>
        ))}
        {t.reasons.length === 0 && <p class="tt-hint">Bez zmian w tym miesiącu.</p>}
      </div>
      {centralaQuote(closing ?? (reportCommentText(d.commentId) || r.comment))}
      <div class="tt-report-hint" role="note">
        <b>Wskazówka</b>
        <span>{hintText(d.hint, int)}</span>
      </div>
      <p class="tt-report-kpi">
        {kpiWeeks > 0 ? `KPI tygodnia w miesiącu: ${d.kpi.hit} trafione, ${d.kpi.miss} nietrafione` : 'KPI tygodnia w miesiącu: żaden tydzień nie został jeszcze rozliczony'}
      </p>
    </>
  );
}

const TERMINATION = 'Centrala dziękuje za współpracę. Rozliczenie końcowe: inwentaryzacja jutro o 6:00.';

/**
 * Dlaczego Centrala wypowiedziała umowę, odczytane ze stanu (okno wraca po przeładowaniu, a toast z powodem nie): za duży debet,
 * czyli gotówka poniżej `DEBT_LIMIT` (gra staje w tej minucie, więc gotówka w stanie to ta z chwili końca), albo zaufanie zero.
 * Gdy zachodzi jedno i drugie, nie zgadujemy, które rozstrzygnęło: tekst mówi o obu. Bez żadnego z nich (stary zapis) null.
 */
export function terminationReason(s: EconomyState): string | null {
  const debt = s.cash < DEBT_LIMIT;
  const distrust = trustTerminates(s.tycoon.trust.value);
  const floor = signedZl(DEBT_LIMIT);
  if (debt && distrust) return `Powód: zaufanie Centrali spadło do zera, a gotówka spadła poniżej granicy debetu ${floor}.`;
  if (debt) return `Powód: za duży debet. Gotówka spadła do ${signedZl(s.cash)}, poniżej granicy ${floor}, a wtedy Centrala od razu kończy współpracę.`;
  if (distrust) return 'Powód: zaufanie Centrali spadło do zera.';
  return null;
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
  const reason = over && view ? terminationReason(view.s) : null;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {reason && <p class="tt-end-reason" role="note"><b>{reason}</b></p>}
        {r ? <ReportBody r={r} closing={over ? TERMINATION : undefined} /> : centralaQuote(TERMINATION)}
        <div class="tt-modal-foot">
          {over
            ? <button type="button" class="tt-btn tt-primary big" onClick={() => game.restart()}>Zacznij od nowa</button>
            : <button type="button" class="tt-btn tt-primary big" onClick={() => { report.value = null; }}>Dalej</button>}
        </div>
      </div>
    </div>
  );
}

/** Tyle ms po pojawieniu się wpisu „OK” nic nie robi: podwójne stuknięcie nie może zdjąć następnego wpisu, zanim ktoś go przeczyta. */
export const STORY_GRACE_MS = 400;
/** Który wpis jest na ekranie i od kiedy (czas rzeczywisty; okno nie ma haków, więc stan trzyma moduł). Zero to „żaden”. */
let storyShown = { id: 0, at: 0 };

/**
 * Ważne zdarzenie, które czeka na „OK” (nowy próg zaufania, koniec remontu, poziom z odblokowaniami): pokazuje pierwszy wpis
 * kolejki `story`, a dopóki kolejka nie jest pusta, gra stoi (`isModalOpen`). Raport miesiąca i koniec gry mają pierwszeństwo
 * (własne okna), wpis czeka za nimi. Tekst może mieć kilka wierszy (lista odblokowań). Każdy wpis to osobne okno (`key`), a „OK”
 * w pierwszych `STORY_GRACE_MS` po jego pojawieniu się (także po zamknięciu raportu, który go zasłaniał) nic nie robi: drugie
 * stuknięcie w „Dalej” albo „OK” nie może od razu odrzucić wpisu, którego nikt nie zdążył zobaczyć.
 */
export function StoryModal() {
  const entry = story.value[0];
  if (!entry || report.value || econ.value?.s.gameOver) {
    storyShown = { id: 0, at: 0 };   // ukryte okno pokaże się potem od nowa, z własnym czasem karencji
    return null;
  }
  if (storyShown.id !== entry.id) storyShown = { id: entry.id, at: Date.now() };
  const ok = (): void => {
    if (story.value[0]?.id !== entry.id) return;   // spóźnione stuknięcie w okno poprzedniego wpisu
    if (Date.now() - storyShown.at < STORY_GRACE_MS) return;
    dismissStory();
  };
  return (
    <div class="tt-modal-wrap">
      <div key={entry.id} class="tt-modal tt-story" role="dialog" aria-modal="true" aria-label={entry.title}>
        <h2>{entry.title}</h2>
        <p class="tt-story-text">{entry.text}</p>
        <button type="button" class="tt-btn tt-primary big" onClick={ok}>OK</button>
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
  '📦 Palety pod sklepem grożą mandatem Straży: przenieś je „Na zaplecze” w zakładce Palety. Złota paleta to premia.',
  '🧾 Kolejka za długa? Klienci odchodzą. Stuknij w kasę albo kup kasę samoobsługową.',
  '🎯 Cele: KPI tygodnia od Centrali daje zaufanie, premię i XP, a poziomy odblokowują sprzęt i remonty.',
  '💪 Stukanie męczy: dzienna pula sił się kończy, a noc oddaje tylko część. Resztę robią pracownicy.',
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

/** Przycisk „Jak grać” w ⚙: zamyka ustawienia i otwiera okno z instrukcją (gra stoi, dopóki gracz nie kliknie „Zaczynamy”). */
export function HowToButton() {
  return (
    <button type="button" class="tt-btn" onClick={() => { showSettings.value = false; openHowTo(); }}>Jak grać</button>
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
        <h3>Pomoc</h3>
        <HowToButton />
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

/**
 * Czy jest otwarte okno, które baner nagrody (warstwa wyżej niż okna) zasłoniłby razem z jego przyciskami: raport miesiąca albo
 * koniec gry, ważne zdarzenie czekające na „OK”, karta decyzji na biurku, powitanie i „Jak grać”. Ten sam poziom z odblokowaniami ma
 * zresztą własne okno „Poziom N”, więc baner nie jest tam potrzebny.
 */
export function windowBlocksBanner(): boolean {
  const view = econ.value;
  return !!report.value || story.value.length > 0 || !!welcome.value || howTo.value || !!view?.s.gameOver
    || (!!view && visibleCards(view.s.tycoon.cards, view.s.minute).length > 0);
}

/**
 * Wielki baner nagrody (nowy poziom): konfetti robi main.ts, baner znika sam albo po stuknięciu. Nie pokazuje się nad
 * oknami (`windowBlocksBanner`); jego czas biegnie dalej, więc po ich zamknięciu stary baner już nie wraca.
 */
export function CelebrationBanner() {
  const c = celebration.value;
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(() => { if (celebration.value === c) celebration.value = null; }, 3200);
    return () => clearTimeout(t);
  }, [c]);
  if (!c || windowBlocksBanner()) return null;
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

/** „Witaj z powrotem”: zarobek kierownika zmiany pod nieobecność i premia za serię dni (same Ogonki; wiersz gotówki tylko, gdy jest ją za co dać). */
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
            <span class="tt-big-reward">{w.daily.cash > 0 && <>+{zl(w.daily.cash)} · </>}+{w.daily.ogonki} 🦎</span>
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

/** Licznik combo nad przyciskami klikera: seria szybkich stuknięć ze stanu symulacji (`tapCombo`), widoczna od 3 stuknięć. */
export function ComboChip() {
  const view = econ.value;
  if (!view) return null;
  const c = tapCombo(view.s);
  if (c.count < 3) return null;
  return <div class={`tt-combo m${Math.min(5, c.mult)}`} key={c.mult}>COMBO ×{c.mult}<small>{c.count} stuknięć</small></div>;
}

import { computed, signal, untracked, type ReadonlySignal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { dateText, hintTextOf, numberLocale, t, tr } from '@/i18n';
import {
  DEBT_WARN, debtWarningText, effects, slotFree, slotUsage, tapCombo, tillTapBlock, type EconomyState, type MonthReport,
} from '@/sim/economy/economy';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { FATIGUE } from '@/sim/economy/tycoon/fatigue';
import { REPORT_LINE_LABEL, reportCommentText } from '@/sim/economy/tycoon/report';
import { TRUST_REASON_LABEL, trustTerminates } from '@/sim/economy/tycoon/trust';
import { WUT, WUT_LABEL, WUT_REASONS } from '@/sim/economy/tycoon/wut';
import { EQUIPMENT, EQUIPMENT_BY_ID, equipmentCost } from '@/sim/economy/upgrades';
import type { QualityPresetId } from '@/render/quality';
import { networkIncomeOf, prestigePoints } from '@/game/meta';
import { seasonBankrupt } from '@/sim/ranked';
import { RANKED_BANKRUPT_TEXT, RANKED_DAYS, loadRanked, rankedDayOf, storedRankedBlock } from '@/game/rankedRun';
import {
  celebration, dismissStory, ephemeral, econ, hints, howTo, metaView, nextHint, openHowTo, openPanel, openRanking, preset, ranked, report, selection,
  seed, showPerf, showPrestige, showSettings, story, tab, toasts, unsent, welcome, closeRemanent, remanent, type Controls, type GameActions, type RankedView, type RemanentView,
} from '../state';
import { int, people, percentOf, signedPts, signedZl, zl } from './format';
import { Bar, PalletItem } from './panels';
import { LanguageSwitch, setLangAndReload } from '../LanguageSwitch';
import { buyButtons, buyNotes } from './spend';
import { statementView } from './statement';
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
        <h3>{t`Paleta`}</h3>
        <PalletItem s={s} info={info} id={sel.id} game={game} compact />
        <p class="tt-hint">{t`Stukaj w paletę w sklepie, żeby rozładowywać.`}</p>
      </>
    );
  } else if (sel.kind === 'till') {
    const fx = effects(s, info);
    body = (
      <>
        <h3>{t`Kasa`}</h3>
        <p>{t`Kolejka: `}<b>{int(s.queue)}</b>{t` · na kasie: ${people(s.lastCashiers)} os. · SCO: ${fx.sco}`}</p>
        <button type="button" class="tt-btn tt-primary big" disabled={!!tillReason(s, info)} title={tr(tillReason(s, info))}
          onClick={() => game.dispatch({ type: 'tapTill' })}>{t`Obsłuż klienta`}</button>
        <p class="tt-hint">{tr(tillTapBlock(s, info)) ?? t`Kolejka przerasta kasjera: staniesz przy drugiej kasie.`}{t` Stukanie pomaga tylko, gdy przy kasie nikogo nie ma albo kolejka rośnie.`}</p>
      </>
    );
  } else {
    const slot = info.slots.find((x) => x.id === sel.slotId);
    if (!slot) return null;
    const free = slotFree(s, info, slot.id);
    const items = slotUsage(s).get(slot.id) ?? [];
    body = (
      <>
        <h3>{t`Slot ${slot.capacity === 2 ? '2×2' : '2×1'}`}</h3>
        <p>{items.length ? t`Stoi tu: ${items.map((id) => tr(EQUIPMENT_BY_ID[id].name)).join(', ')}.` : t`Pusty slot.`}{t` Wolne miejsce: ${free}.`}</p>
        {free > 0
          ? EQUIPMENT.filter((e) => e.size <= free).map((e) => {
            const cost = equipmentCost(e, s.equipment.filter((x) => x.id === e.id).length);
            return (
              <div key={e.id} class="tt-item">
                <div><b>{tr(e.name)}</b><div class="tt-muted">{tr(e.effect)}</div>{buyNotes(s, info, cost, false)}</div>
                {buyButtons(s, info, cost, false, (raty) => game.dispatch(raty ? { type: 'buyEquipment', id: e.id, slotId: slot.id, raty: true } : { type: 'buyEquipment', id: e.id, slotId: slot.id }))}
              </div>
            );
          })
          : <p class="tt-hint">{t`Slot pełny. Więcej slotów da remont (Ulepszenia → Remont).`}</p>}
      </>
    );
  }
  return (
    <div class="tt-card" role="dialog" aria-label={t`Zaznaczony obiekt`}>
      <button type="button" class="tt-iconbtn tt-card-close" aria-label={t`Zamknij`} onClick={close}>✕</button>
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
  const tillNote = tr(tillTapBlock(s, view.info))?.replace(/\.$/, '');
  const at = (e: MouseEvent): [number, number] => [e.clientX || window.innerWidth - 60, e.clientY || window.innerHeight - 140];
  return (
    <div class="tt-clicker">
      <div class="tt-energy" title={tr(ENERGY_TITLE)}>
        <span>{t`Siły ${int(energy)}/${FATIGUE.pool}`}</span>
        <Bar value={energy / FATIGUE.pool} warn={energy < LOW_ENERGY} />
      </div>
      <button type="button" class="tt-fab" disabled={pallets === 0 || !!palletBlock} title={tr(palletBlock)} aria-label={t`Rozładuj paletę (${pallets})`}
        onClick={(e) => { const r = game.dispatch({ type: 'tapPallet' }); if (r.ok) onFloat(...at(e), t`+${Math.round(r.value ?? 0)} szt.`, 'work'); }}>
        <span aria-hidden="true">📦</span>{pallets > 0 && <span class="tt-badge">{pallets}</span>}
      </button>
      <div class="tt-fab-slot">
        {tillNote && <span class="tt-fab-note">{tillNote}</span>}
        <button type="button" class="tt-fab" disabled={!!tillBlock} title={tr(tillBlock)} aria-label={t`Obsłuż klienta (${q} w kolejce)`}
          onClick={(e) => { const r = game.dispatch({ type: 'tapTill' }); if (r.ok) onFloat(...at(e), `+${(r.value ?? 0).toLocaleString(numberLocale(), { maximumFractionDigits: 2 })} zł`, 'money'); }}>
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
      <button type="button" class="tt-iconbtn" aria-label={t`Obróć w lewo (Q)`} onClick={() => controls.rotate(-1)}>⟲</button>
      <button type="button" class="tt-iconbtn" aria-label={t`Obróć w prawo (E)`} onClick={() => controls.rotate(1)}>⟳</button>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="tt-toasts" aria-live="polite">
      {toasts.value.map((toast) => <div key={toast.id} class={`tt-toast ${toast.kind}`}>{tr(toast.text)}</div>)}
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
const centralaQuote = (text: string) => <p class="tt-quote">{t`„${tr(text)}”`}<br /><span class="tt-muted">{t`— Centrala`}</span></p>;

/**
 * Treść raportu miesięcznego. Z wyciągiem (`statement`, od SIM_VERSION 6): na górze wyciąg od Centrali (`statementView`: przelew,
 * potrącenia, Twoje koszty, „Zostaje Ci”), pod nim obrót i klienci, a dalej reszta raportu tycoona (zaufanie, komentarz, wskazówka, KPI).
 * Bez wyciągu, z danymi tycoona (`detail`): wynik dużą liczbą i pozycje z `REPORT_LINE_LABEL` (koszty ze znakiem minus). Raport ze starego
 * zapisu (`detail` równe null, bez wyciągu) zostaje dawnym widokiem: marża i inne przychody, premie Centrali (osobny licznik) i koszty
 * (z opłatą i ubytkami ponad limit Centrali) sumują się do wyniku miesiąca. `closing` zastępuje komentarz Centrali (wypowiedzenie umowy
 * przy końcu gry).
 */
export function ReportBody({ r, closing }: { r: MonthReport; closing?: string }) {
  const c = r.counters;
  const d = r.detail;
  const st = r.statement;
  if (!d) {
    if (st) {
      return (
        <>
          {statementView(st)}
          <p class="tt-muted tt-st-meta">{t`Obrót ${zl(c.revenue)} · klienci ${int(c.customers)} (utraceni: ${int(c.lost)})`}</p>
          {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
          {centralaQuote(closing ?? r.comment)}
        </>
      );
    }
    return (
      <>
        <div class="tt-row"><span>{t`Klienci`}</span><span>{t`${int(c.customers)} (utraceni: ${int(c.lost)})`}</span></div>
        <div class="tt-row"><span>{t`Obrót`}</span><span>{zl(c.revenue)}</span></div>
        <div class="tt-row"><span>{t`Marża i inne przychody`}</span><span>{zl(c.margin + c.other)}</span></div>
        <div class="tt-row"><span>{t`Premie Centrali`}</span><span>{zl(c.bonus)}</span></div>
        <div class="tt-row"><span>{t`Płace`}</span><span>−{zl(c.wages)}</span></div>
        <div class="tt-row"><span>{t`Media`}</span><span>−{zl(c.media)}</span></div>
        <div class="tt-row"><span>{t`Opłata franczyzowa`}</span><span>−{zl(c.fee)}</span></div>
        <div class="tt-row"><span>{t`Mandaty`}</span><span>−{zl(c.fines)}</span></div>
        <div class="tt-row"><span>{t`Ubytki ponad limit Centrali`}</span><span>−{zl(c.wut)}</span></div>
        <div class="tt-row"><span>{t`Logistyka`}</span><span>−{zl(c.logistics)}</span></div>
        <div class="tt-row total"><span>{t`Wynik miesiąca`}</span><span>{signedZl(r.profit)}</span></div>
        <div class="tt-row"><span>{t`Inwestycje`}</span><span>{zl(c.investments)}</span></div>
        <div class="tt-row"><span>{t`Gotówka na koniec`}</span><span>{zl(r.cash)}</span></div>
        {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
        {centralaQuote(closing ?? r.comment)}
      </>
    );
  }
  // wynik w nagłówku to suma pozycji tak, jak je widać (każda zaokrąglona do złotych): zaokrąglenie samej sumy bywa o 1 zł obok
  const result = d.lines.reduce((n, l) => n + Math.round(l.amount), 0);
  const trust = d.trust;
  const kpiWeeks = d.kpi.hit + d.kpi.miss;
  return (
    <>
      {st
        ? (
          <>
            {statementView(st)}
            <p class="tt-muted tt-st-meta">{t`Obrót ${zl(d.revenue)} · klienci ${int(c.customers)} (utraceni: ${int(c.lost)})`}</p>
            {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
          </>
        )
        : (
          <>
            <div class="tt-report-head">
              <span class="tt-muted">{t`Wynik miesiąca`}</span>
              <b class={`tt-report-result ${result < 0 ? 'neg' : 'pos'}`}>{signedZl(result)}</b>
              <span class="tt-muted">{t`Obrót ${zl(d.revenue)} · klienci ${int(c.customers)} (utraceni: ${int(c.lost)})`}</span>
              <span class="tt-muted">{t`Gotówka na koniec: ${zl(r.cash)} · inwestycje: ${zl(c.investments)}`}</span>
            </div>
            {r.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(r.cash))}</p>}
            <div class="tt-report-lines">
              {d.lines.map((l) => (
                <div key={l.key} class="tt-row"><span>{tr(REPORT_LINE_LABEL[l.key])}</span><span class={Math.round(l.amount) < 0 ? 'tt-neg' : undefined}>{lineAmount(l.amount)}</span></div>
              ))}
            </div>
          </>
        )}
      <div class="tt-report-trust">
        <div class="tt-row"><b>{t`Zaufanie Centrali: ${int(trust.start)} → ${int(trust.end)}`}</b><span class={trust.delta < 0 ? 'tt-neg' : undefined}>{t`${signedPts(trust.delta)} pkt`}</span></div>
        {trust.reasons.slice(0, REPORT_TRUST_REASONS).map(([reason, v]) => (
          <div key={reason} class="tt-row tt-reason"><span>{tr(TRUST_REASON_LABEL[reason])}</span><span class={v < 0 ? 'tt-neg' : 'tt-pos'}>{signedPts(v)}</span></div>
        ))}
        {trust.reasons.length === 0 && <p class="tt-hint">{t`Bez zmian w tym miesiącu.`}</p>}
      </div>
      {centralaQuote(closing ?? (reportCommentText(d.commentId) || r.comment))}
      <div class="tt-report-hint" role="note">
        <b>{t`Wskazówka`}</b>
        <span>{hintTextOf(d.hint, int)}</span>
      </div>
      <p class="tt-report-kpi">
        {kpiWeeks > 0 ? t`KPI tygodnia w miesiącu: ${d.kpi.hit} trafione, ${d.kpi.miss} nietrafione` : t`KPI tygodnia w miesiącu: żaden tydzień nie został jeszcze rozliczony`}
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
  if (debt && distrust) return t`Powód: zaufanie Centrali spadło do zera, a gotówka spadła poniżej granicy debetu ${floor}.`;
  if (debt) return t`Powód: za duży debet. Gotówka spadła do ${signedZl(s.cash)}, poniżej granicy ${floor}, a wtedy Centrala od razu kończy współpracę.`;
  if (distrust) return t`Powód: zaufanie Centrali spadło do zera.`;
  return null;
}

/**
 * Raport miesięczny, od SIM_VERSION 6 „Wyciąg od Centrali” (pauzuje grę). Raport za listopad kończy sezon rankingowy: jego „Dalej” otwiera okno z wynikiem sezonu (`openFinish`),
 * żeby okno nie zasłoniło raportu. Przy wypowiedzeniu umowy: koniec gry i nowy start (w biegu rankingowym wyjście do zwykłej gry; taki bieg
 * nie trafia do rankingu ani do szuflady niewysłanych, o czym mówi akapit pod powodem). Wyjątek: wypowiedzenie przy ostatnim zamknięciu
 * (trzy raporty, `seasonBankrupt` fałsz) kończy sezon doigrany, więc bieg ma wynik i „Dalej: wynik sezonu” otwiera okno z nim. Okno końca gry wynika ze stanu
 * (`gameOver` i ostatni raport w zapisie), więc wraca po przeładowaniu strony; zapis sprzed tej poprawki nie ma raportu
 * i pokazuje samo wypowiedzenie.
 */
export function ReportModal({ game }: { game: GameActions }) {
  const view = econ.value;
  const over = !!view?.s.gameOver;
  const r = report.value ?? (over ? view?.s.lastReport ?? null : null);
  if (!r && !over) return null;
  const title = over ? t`Koniec współpracy` : r!.statement ? t`Wyciąg od Centrali: ${tr(r!.label)}` : t`Raport: ${tr(r!.label)}`;
  const reason = over && view ? terminationReason(view.s) : null;
  const bankrupt = over && !!view && seasonBankrupt(view.s);   // koniec gry przed ostatnim raportem: poza rankingiem
  const seasonEnd = ranked.value?.phase === 'over' && !bankrupt;   // sezon doigrany (też z debetem z ostatniego zamknięcia): za raportem czeka okno z wynikiem
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {reason && <p class="tt-end-reason" role="note"><b>{reason}</b></p>}
        {bankrupt && ranked.value && <p class="tt-end-reason" role="note">{tr(RANKED_BANKRUPT_TEXT)}</p>}
        {r ? <ReportBody r={r} closing={over ? TERMINATION : undefined} /> : centralaQuote(TERMINATION)}
        <div class="tt-modal-foot">
          {over
            ? ranked.value
              // bieg rankingowy nie zaczyna się od nowa (`restart` odmawia): wyjście do zwykłej gry. Bankrut nie ma czego wysyłać; sezon doigrany
              // z debetem z ostatniego zamknięcia ma wynik w szufladzie, więc najpierw okno z wynikiem
              ? seasonEnd && unsent.value
                ? <button type="button" class="tt-btn tt-primary big" onClick={() => { report.value = null; game.openFinish(); }}>{t`Dalej: wynik sezonu`}</button>
                : <button type="button" class="tt-btn tt-primary big" onClick={() => game.leaveRanked()}>{t`Wróć do zwykłej gry`}</button>
              : <button type="button" class="tt-btn tt-primary big" onClick={() => game.restart()}>{t`Zacznij od nowa`}</button>
            : seasonEnd
              // raport za listopad zamyka sezon: „Dalej” zdejmuje raport i otwiera okno z wynikiem (`concludeSeason` nie otwiera go nad raportem)
              ? <button type="button" class="tt-btn tt-primary big" onClick={() => { report.value = null; game.openFinish(); }}>{unsent.value ? t`Dalej: wynik sezonu` : t`Dalej`}</button>
              : <button type="button" class="tt-btn tt-primary big" onClick={() => { report.value = null; }}>{t`Dalej`}</button>}
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
 * kolejki `story`, a dopóki kolejka nie jest pusta, gra stoi (`isModalOpen`). Raport miesiąca, protokół remanentu i koniec gry mają
 * pierwszeństwo (własne okna), wpis czeka za nimi. Tekst może mieć kilka wierszy (lista odblokowań). Każdy wpis to osobne okno (`key`), a „OK”
 * w pierwszych `STORY_GRACE_MS` po jego pojawieniu się (także po zamknięciu raportu, który go zasłaniał) nic nie robi: drugie
 * stuknięcie w „Dalej” albo „OK” nie może od razu odrzucić wpisu, którego nikt nie zdążył zobaczyć.
 */
export function StoryModal() {
  const entry = story.value[0];
  if (!entry || report.value || remanent.value || econ.value?.s.gameOver) {
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
      <div key={entry.id} class="tt-modal tt-story" role="dialog" aria-modal="true" aria-label={tr(entry.title)}>
        <h2>{tr(entry.title)}</h2>
        <p class="tt-story-text">{tr(entry.text)}</p>
        <button type="button" class="tt-btn tt-primary big" onClick={ok}>OK</button>
      </div>
    </div>
  );
}

/** Który protokół remanentu jest na ekranie i od kiedy (czas rzeczywisty, jak `storyShown`): „OK” w karencji nic nie robi. `null` to „żaden”. */
let remanentShown: { view: RemanentView | null; at: number } = { view: null, at: 0 };

/**
 * Protokół remanentu (spec SIM 6, §7): okno wstaje o 5:00 ostatniego dnia co trzeciego miesiąca i trzyma grę, aż gracz kliknie „OK”.
 * Okres, obrót, ubytki według przyczyn i razem, limit Centrali (przy pierwszym remanencie gracz poznaje go dopiero tu), nadwyżka
 * do potrącenia z dzisiejszego przelewu i komentarz Centrali z zdarzenia (`text`). Ma pierwszeństwo przed wpisami „OK” (`StoryModal`)
 * i kartą decyzji; po końcu gry nie rysuje się. „OK” w pierwszych `STORY_GRACE_MS` po pojawieniu się okna nic nie robi: stuknięcie
 * w kliker w chwili remanentu nie może zamknąć protokołu, zanim ktokolwiek go zobaczył.
 */
export function RemanentModal() {
  const view = remanent.value;
  if (!view || econ.value?.s.gameOver) {
    remanentShown = { view: null, at: 0 };   // ukryte okno pokaże się potem od nowa, z własnym czasem karencji
    return null;
  }
  const p = view.protocol;
  if (remanentShown.view !== view) remanentShown = { view, at: Date.now() };
  const ok = (): void => {
    if (remanent.value !== view) return;   // spóźnione stuknięcie w okno poprzedniego protokołu
    if (Date.now() - remanentShown.at < STORY_GRACE_MS) return;
    closeRemanent();
  };
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-remanent" role="dialog" aria-modal="true" aria-label={t`Protokół remanentu`}>
        <h2>{t`Protokół remanentu`}</h2>
        <p class="tt-muted">{t`Okres: ${dateText(p.fromDay)} – ${dateText(p.day)}`}</p>
        <div class="tt-row"><span>{t`Obrót w okresie`}</span><span>{zl(p.revenue)}</span></div>
        <h3>{t`Ubytki`}</h3>
        {WUT_REASONS.map((reason) => (
          <div key={reason} class="tt-row"><span>{tr(WUT_LABEL[reason])}</span><span>{zl(p.byReason[reason])}</span></div>
        ))}
        <div class="tt-row total"><span>{t`Ubytki razem`}</span><span>{zl(p.total)}</span></div>
        <div class="tt-row"><span>{t`Limit Centrali`}</span><span>{zl(p.limit)}</span></div>
        {p.first && <p class="tt-hint" role="note">{t`Limit poznajesz dopiero teraz: ${percentOf(WUT.threshold)} obrotu.`}</p>}
        <p class={`tt-remanent-verdict${p.charge > 0 ? ' over' : ''}`}>
          {p.charge > 0 ? t`Nadwyżka ${zl(p.charge)} zejdzie z dzisiejszego przelewu.` : t`Ubytki mieszczą się w limicie.`}
        </p>
        {centralaQuote(view.text)}
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
      <span class="tt-hintbubble-text">{tr(list[0]!)}</span>
      <button type="button" class="tt-btn tt-hintbubble-next" onClick={nextHint}>{list.length > 1 ? t`Dalej` : 'OK'}</button>
    </div>
  );
}

export const EPHEMERAL_BADGE = 'Sklep tymczasowy: postęp nie jest zapisywany';
export const EPHEMERAL_NOTE = 'Ten sklep jest tymczasowy: nic się w nim nie zapisuje, a ewentualny zapis pod jego seedem zostaje nietknięty.';
export const RESTART_CONFIRM = 'Zacząć od nowa w tym sklepie? Zapis zostanie usunięty.';
export const RANKED_NOTE = 'W biegu rankingowym nie zaczyna się od nowa: Centrala nie robi poprawek. Bieg możesz porzucić w ustawieniach.';

/** Napis plakietki biegu rankingowego: „Ranking · dzień 3/91”. */
export const rankedBadgeText = (run: Pick<RankedView, 'day' | 'days'>): string => t`Ranking · dzień ${run.day}/${run.days}`;

/**
 * Stałe plakietki na ekranie gry: bieg rankingowy („Ranking · dzień N/91”, jedna linia, bez przycisków) i sklep tymczasowy (zapis się nie
 * zbudował albo jest z nowszej wersji gry). Bieg rankingowy nigdy nie jest tymczasowy, więc zwykle świeci się najwyżej jedna.
 */
export function StoreBadge() {
  const run = ranked.value;
  const rankedBadge = run ? <div class="tt-ranked-badge" role="status">{rankedBadgeText(run)}</div> : null;
  const temporary = ephemeral.value ? <div class="tt-ephemeral" role="status">{tr(EPHEMERAL_BADGE)}</div> : null;
  if (rankedBadge && temporary) return <>{rankedBadge}{temporary}</>;
  return rankedBadge ?? temporary;
}

/**
 * Przyciski sklepu w ⚙: „Nowy sklep” (ekran startowy) zawsze, „Zacznij od nowa” (kasuje zapis tego sklepu) tylko w zwykłym.
 * W sklepie tymczasowym nic nie jest zapisane ani kasowane, więc zamiast „Zacznij od nowa” jest wyjaśnienie, a zapis pod
 * tym seedem zostaje nietknięty.
 */
export function StoreActions(
  { ephemeral: temporary, ranked: rankedRun = false, onNewStore, onRestart }: { ephemeral: boolean; ranked?: boolean; onNewStore: () => void; onRestart: () => void },
) {
  return (
    <div class="tt-store-actions">
      <button type="button" class="tt-btn" onClick={onNewStore}>{t`Nowy sklep`}</button>
      {rankedRun
        ? <p class="tt-hint">{tr(RANKED_NOTE)}</p>
        : temporary
        ? <p class="tt-hint">{tr(EPHEMERAL_NOTE)}</p>
        : <button type="button" class="tt-btn" onClick={onRestart}>{t`Zacznij od nowa`}</button>}
    </div>
  );
}

/** Przycisk „Jak grać” w ⚙: zamyka ustawienia i otwiera okno z instrukcją (gra stoi, dopóki gracz nie kliknie „Zaczynamy”). */
export function HowToButton() {
  return (
    <button type="button" class="tt-btn" onClick={() => { showSettings.value = false; openHowTo(); }}>{t`Jak grać`}</button>
  );
}

/**
 * Zapisany bieg rankingowy, do którego da się wrócić z ⚙, choć nie toczy się na ekranie (gracz wyszedł z niego do zwykłej gry albo odświeżył
 * stronę): `day` to dzień sezonu, w którym stoi, albo null, gdy zapis jest z innej wersji gry i dnia nie czytamy.
 */
export interface StoredRun { day: number | null }

/**
 * Czyta z przeglądarki, czy czeka aktywny bieg rankingowy (`storedRankedBlock`; niewysłany bieg w szufladzie to nie to: ma własny wiersz).
 * Kosztuje odczyt zapisu biegu, więc woła się to raz na otwarcie ustawień (`storedRun`), nie przy każdym rysowaniu.
 */
export function storedRunNow(): StoredRun | null {
  if (storedRankedBlock() !== 'active') return null;
  const loaded = loadRanked();
  return { day: loaded.status === 'ok' ? rankedDayOf(loaded.session.econ) : null };
}

const storedStamp = signal(0);
/** Czyta zapisany bieg jeszcze raz przy otwartych ustawieniach (po wznowieniu, które się nie udało: zapis mógł zniknąć). */
export function refreshStoredRun(): void {
  storedStamp.value += 1;
}
/**
 * Zapisany bieg rankingowy dla ⚙: liczy się raz, gdy ustawienia się otwierają (sygnał `showSettings`), i zostaje do zamknięcia; poza
 * ustawieniami i w trakcie biegu rankingowego (jest na ekranie) nie czyta przeglądarki wcale.
 */
export const storedRun: ReadonlySignal<StoredRun | null> = computed(() => {
  void storedStamp.value;
  if (!showSettings.value || untracked(() => ranked.value)) return null;
  return storedRunNow();
});

/** Pytanie przed porzuceniem biegu rankingowego (dwa kroki w ⚙ zamiast `window.confirm`); `day` null, gdy dnia zapisanego biegu nie znamy. */
export const abandonQuestion = (day: number | null): string =>
  t`Porzucić bieg rankingowy? ${day === null ? t`Zapisany bieg` : t`Dzień ${day} z ${RANKED_DAYS}`} przepadnie.`;

export interface RankingSettingsProps {
  game: Pick<GameActions, 'leaveRanked' | 'resumeRanked' | 'abandonRanked' | 'openFinish'>;
  /** Zapisany bieg, który nie toczy się na ekranie (`storedRun`), albo null. Bieg na ekranie (`ranked`) ma pierwszeństwo. */
  stored: StoredRun | null;
  /** Czy ⚙ pyta, czy na pewno porzucić bieg (stan trzyma `Settings`, zeruje się przy każdym otwarciu). */
  confirming: boolean;
  onConfirming(on: boolean): void;
  /** Po wznowieniu, które się nie udało: wiersz biegu trzeba odczytać od nowa. */
  onRefresh(): void;
  close(): void;
  /** Czy gra ma panele rankingu i kodu odzyskiwania (nakładka bez nich nie pokazuje ich przycisków). */
  panels?: boolean;
}

/**
 * Sekcja „Ranking” w ⚙: panel rankingu i panel kodu odzyskiwania (zamykają ustawienia i otwierają panel), wiersz niewysłanego biegu (gdy
 * szuflada coś trzyma) i wiersz biegu rankingowego: w biegu „Wróć do zwykłej gry” (zapisuje bieg) i „Porzuć bieg”, poza biegiem z zapisem
 * w przeglądarce „Kontynuuj bieg rankingowy” i „Porzuć bieg”. Porzucenie kasuje zapis, więc pyta jeszcze raz w tym samym miejscu.
 * Komponent bez hooków (stan pytania i odczyt zapisu daje `Settings`), więc testy wołają go jak funkcję.
 */
export function RankingSettings({ game, stored, confirming, onConfirming, onRefresh, close, panels = true }: RankingSettingsProps) {
  const run = ranked.value;
  const waiting = unsent.value;
  const day = run ? run.day : stored ? stored.day : null;
  const hasRun = !!run || !!stored;
  return (
    <>
      <h3>{t`Ranking`}</h3>
      {panels && (
        <div class="tt-store-actions">
          <button type="button" class="tt-btn" onClick={() => { close(); openRanking(); }}>{t`Ranking`}</button>
          <button type="button" class="tt-btn" onClick={() => { close(); openPanel('recovery'); }}>{t`Kod odzyskiwania i zapis`}</button>
        </div>
      )}
      {waiting && (
        <div class="tt-store-actions">
          <button type="button" class="tt-btn tt-primary" onClick={() => { close(); game.openFinish(); }}>
            {t`Wyślij niewysłany bieg (wynik ${zl(waiting.score)})`}
          </button>
        </div>
      )}
      {hasRun && confirming && (
        <div class="tt-ranked-ask">
          <p class="tt-ranked-ask-text" role="alert">{abandonQuestion(day)}</p>
          <div class="tt-store-actions">
            <button type="button" class="tt-btn" onClick={() => { onConfirming(false); game.abandonRanked(); close(); }}>{t`Porzuć`}</button>
            <button type="button" class="tt-btn tt-primary" onClick={() => onConfirming(false)}>{t`Anuluj`}</button>
          </div>
        </div>
      )}
      {hasRun && !confirming && (
        <div class="tt-store-actions">
          {run
            ? <button type="button" class="tt-btn tt-primary" onClick={() => { close(); game.leaveRanked(); }}>{t`Wróć do zwykłej gry`}</button>
            : <button type="button" class="tt-btn tt-primary" onClick={() => { if (game.resumeRanked()) close(); else onRefresh(); }}>{t`Kontynuuj bieg rankingowy`}</button>}
          <button type="button" class="tt-btn" onClick={() => onConfirming(true)}>{t`Porzuć bieg`}</button>
          <p class="tt-hint">{run ? t`Wyjście zapisuje bieg: wznowisz go stąd. Porzucenie kasuje zapis.` : t`W przeglądarce czeka zapisany bieg rankingowy. Porzucenie kasuje zapis.`}</p>
        </div>
      )}
    </>
  );
}

const PRESETS: { value: QualityPresetId; label: string }[] = [
  { value: 'niska', label: 'Niska' },
  { value: 'srednia', label: 'Średnia' },
  { value: 'wysoka', label: 'Wysoka' },
];

/**
 * Ustawienia: seed sklepu, nowy sklep i nowa gra, ranking i bieg rankingowy, jakość grafiki, nakładka wydajności, zastrzeżenie.
 * `panels`: czy gra ma panele rankingu i kodu odzyskiwania (bez nich ich przyciski się nie pokazują).
 */
export function Settings({ controls, game, panels = true }: { controls: Controls; game: GameActions; panels?: boolean }) {
  const [draft, setDraft] = useState(seed.value);
  const [asking, setAsking] = useState(false);
  useEffect(() => { setDraft(seed.value); }, [seed.value, showSettings.value]);
  useEffect(() => { setAsking(false); }, [showSettings.value]);   // pytanie o porzucenie biegu nie przeżywa zamknięcia ustawień
  if (!showSettings.value) return null;
  const close = (): void => { showSettings.value = false; };
  return (
    <div class="tt-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="tt-modal" role="dialog" aria-label={t`Ustawienia`}>
        <button type="button" class="tt-iconbtn tt-card-close" aria-label={t`Zamknij`} onClick={close}>✕</button>
        <h2>{t`Ustawienia`}</h2>
        <h3>{t`Język`}</h3>
        <LanguageSwitch onPick={setLangAndReload} />
        <p class="tt-hint">{t`Zmiana języka przeładowuje grę (zapis zostaje), żeby zmienić też napisy w sklepie.`}</p>
        <h3>{t`Sklep (seed)`}</h3>
        <p class="tt-hint">{t`Ten sam seed to ten sam sklep. Każdy seed ma własny zapis gry.`}</p>
        <form class="tt-seed" onSubmit={(e) => { e.preventDefault(); controls.generate(draft); close(); }}>
          <input class="tt-input" type="text" value={draft} aria-label={t`Seed sklepu`} maxLength={64} spellcheck={false} autocomplete="off"
            onInput={(e) => setDraft(e.currentTarget.value)} />
          <button type="submit" class="tt-btn tt-primary">{t`Otwórz`}</button>
          <button type="button" class="tt-btn" onClick={() => { controls.randomize(); close(); }}>{t`Losuj`}</button>
        </form>
        <StoreActions ephemeral={ephemeral.value} ranked={!!ranked.value} onNewStore={() => { close(); game.newStore(); }}
          onRestart={() => { if (confirm(tr(RESTART_CONFIRM))) { game.restart(); close(); } }} />
        <RankingSettings game={game} stored={storedRun.value} confirming={asking} onConfirming={setAsking} onRefresh={refreshStoredRun} close={close}
          panels={panels} />
        <h3>{t`Pomoc`}</h3>
        <HowToButton />
        <h3>{t`Grafika`}</h3>
        <div class="tt-seg wide" role="group" aria-label={t`Jakość grafiki`}>
          {PRESETS.map((p) => (
            <button key={p.value} type="button" class={`tt-btn${preset.value === p.value ? ' on' : ''}`} onClick={() => controls.setPreset(p.value)}>{tr(p.label)}</button>
          ))}
        </div>
        <h3>{t`Dźwięk i wibracje`}</h3>
        <label class="tt-check-row"><input type="checkbox" checked={metaView.value.sound} onChange={(e) => game.setSound(e.currentTarget.checked)} /> {t`Dźwięki`}</label>
        <label class="tt-check-row"><input type="checkbox" checked={metaView.value.vibration} onChange={(e) => game.setVibration(e.currentTarget.checked)} /> {t`Wibracje (telefon)`}</label>
        <label class="tt-check-row"><input type="checkbox" checked={showPerf.value} onChange={(e) => { showPerf.value = e.currentTarget.checked; }} /> {t`Licznik FPS (F3)`}</label>
        <p class="tt-hint">{t`Klawisze: Q/E obrót, +/− zoom, strzałki przesuwanie, spacja pauza, X widok z zewnątrz.`}</p>
        <p class="tt-disclaimer2">{tr(DISCLAIMER)}{t` Gra jest satyrą i nie ma związku z żadną prawdziwą siecią sklepów.`}</p>
      </div>
    </div>
  );
}

/**
 * Czy jest otwarte okno, które baner nagrody (warstwa wyżej niż okna) zasłoniłby razem z jego przyciskami: raport miesiąca albo
 * koniec gry, protokół remanentu, ważne zdarzenie czekające na „OK”, karta decyzji na biurku, powitanie i „Jak grać”. Ten sam poziom z odblokowaniami ma
 * zresztą własne okno „Poziom N”, więc baner nie jest tam potrzebny.
 */
export function windowBlocksBanner(): boolean {
  const view = econ.value;
  return !!report.value || story.value.length > 0 || !!remanent.value || !!welcome.value || howTo.value || !!view?.s.gameOver
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
        <div class="tt-celebrate-title">{tr(c.title)}</div>
        <div class="tt-celebrate-sub">{tr(c.subtitle)}</div>
        {c.lines.map((l) => <div key={l} class="tt-celebrate-line">{tr(l)}</div>)}
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
      <div class="tt-modal tt-center" role="dialog" aria-label={t`Witaj z powrotem`}>
        <h2>{t`Witaj z powrotem! 👋`}</h2>
        {w.offline > 0 && (
          <p>{t`Przez ${w.hours >= 1 ? `${Math.floor(w.hours)} h` : `${Math.max(1, Math.round(w.hours * 60))} min`} Twojej nieobecności kierownik zmiany zarobił`}
            <span class="tt-big-reward">+{zl(w.offline)}</span></p>
        )}
        {w.daily && w.streak !== null && (
          <>
            <p>{t`Premia Centrali za ${w.streak}. dzień z rzędu:`}</p>
            <div class="tt-streak">{Array.from({ length: 7 }, (_, i) => <span key={i} class={i < Math.min(7, w.streak!) ? 'on' : ''}>{i + 1}</span>)}</div>
            <span class="tt-big-reward">{w.daily.cash > 0 && <>+{zl(w.daily.cash)} · </>}+{w.daily.ogonki} 🦎</span>
            <p class="tt-hint">{t`Wróć jutro: premia rośnie do 7. dnia.`}</p>
          </>
        )}
        <button type="button" class="tt-btn tt-primary big" onClick={() => game.claimWelcome()}>{t`Odbierz!`}</button>
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
      <div class="tt-modal" role="dialog" aria-label={t`Otwórz kolejną Traszkę`}>
        <h2>{t`Otwórz kolejną Traszkę 🏪`}</h2>
        <p>{t`Ten sklep zostaje w Twojej sieci i od jutra zarabia na Ciebie `}<b>{t`${zl(networkIncomeOf(s))} dziennie`}</b>{t` w każdej kolejnej grze.`}</p>
        <p>{t`Dostajesz `}<b>{t`+${prestigePoints(s)} Punktów Partnera`}</b>{t` (razem ${points}): każdy to trwale +4% marży i +3% klientów.`}</p>
        <p>{t`Nowy lokal startuje od zera: poziom 1, 2000 zł, nowe miasto z seeda. Tym razem pójdzie szybciej.`}</p>
        <p class="tt-hint">{t`Centrala z wyraźną niechęcią nadaje Ci status Partnera Strategicznego.`}</p>
        <button type="button" class="tt-btn tt-primary big" onClick={() => { showPrestige.value = false; game.openNextStore(); }}>{t`Otwieramy!`}</button>
        <button type="button" class="tt-btn big" onClick={() => { showPrestige.value = false; }}>{t`Jeszcze nie`}</button>
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
  return <div class={`tt-combo m${Math.min(5, c.mult)}`} key={c.mult}>COMBO ×{c.mult}<small>{t`${c.count} stuknięć`}</small></div>;
}

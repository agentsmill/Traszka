import type { Ref } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { econ, remanent, report, showSettings, story, tab, tutorialOffer, isWindowOpen, type Controls } from '../state';
import { RING, blockersAround, clipRect, inflate, placeBubble, type Placement, type Rect, type Size } from './layout';
import { loadTutorial, type TipId } from './memory';
import { dismissTip, settleTips, showTip, shownTip, tipsFor, type TipCandidate, type TipCtx } from './tips';
import { acceptOffer, bindTourControls, declineOffer, nextStep, skipTour, tour, tourCtx, tourVisible } from './tour';
import './tutorial.css';

/*
 * Widok samouczka (spec samouczka, §3–§5, §11): okno wyboru, warstwa przelotu (przygaszenie, pierścień, blokady kliknięć, dymek)
 * i warstwa dymków „pierwszy raz”. Okno wyboru i dymki to komponenty bez haków (testy `vnodeTree`); warstwy mierzą elementy gry
 * w DOM co klatkę, więc sprawdza je smoke w przeglądarce. Polecenia gry wysyła tylko gracz: warstwy niczego nie klikają same.
 */

/** Okno „Pierwszy dzień w Traszce”: samouczek albo „Pomiń, znam grę”. Gra stoi, dopóki jest otwarte (`isWindowOpen`). */
export function TutorialOffer() {
  if (!tutorialOffer.value) return null;
  return (
    <div class="tt-modal-wrap">
      <div class="tt-modal tt-center tt-tut-offer" role="dialog" aria-modal="true" aria-label="Pierwszy dzień w Traszce">
        <h2>Pierwszy dzień w Traszce</h2>
        <p>Centrala przygotowała krótkie szkolenie: co jest na ekranie, palety, pieniądze, ludzie i rozwój. Czas w sklepie stoi, dopóki nie skończysz.</p>
        <div class="tt-tut-offer-actions">
          <button type="button" class="tt-btn tt-primary big" onClick={acceptOffer}>Samouczek (ok. 3 min)</button>
          <button type="button" class="tt-btn big" onClick={declineOffer}>Pomiń, znam grę</button>
        </div>
        <p class="tt-hint">Samouczek i słowniczek znajdziesz też pod „?”.</p>
      </div>
    </div>
  );
}

export interface BubbleProps {
  title: string;
  text: string;
  /** Numer kroku od 1 i liczba kroków (licznik „3 / 16”). */
  n: number;
  total: number;
  /** Wiersz zadania („👉 …”) albo nic w kroku bez zadania. */
  hint?: string;
  /** Zadanie zaliczone: zamiast wiersza zadania „✓ Zrobione”. */
  done?: boolean;
  /** Główny przycisk: „Dalej”, „Zakończ” albo nic (zadanie czeka na gracza). */
  primary: 'Dalej' | 'Zakończ' | null;
  /** Czy pokazać „Pomiń” (na ostatnim kroku już nie ma czego pomijać). */
  skip: boolean;
  place: Placement | null;
  compact?: boolean;
  bubbleRef?: Ref<HTMLDivElement>;
  onNext(): void;
  onSkip(): void;
}

/** Pozycja dymka jako styl (przed pierwszym pomiarem dymek stoi przezroczysty w rogu: da się go zmierzyć i przyjmuje fokus). */
function placeStyle(place: Placement | null): Record<string, string> {
  if (!place) return { left: '0px', top: '0px', opacity: '0' };
  return { left: `${Math.round(place.x)}px`, top: `${Math.round(place.y)}px`, '--arrow': `${Math.round(place.arrow)}px` };
}

/** Dymek przelotu (styl B): tytuł, licznik, tekst, wiersz zadania, „Pomiń” i „Dalej” albo „Zakończ”. */
export function Bubble(p: BubbleProps) {
  const side = p.place?.side ?? 'center';
  return (
    <div ref={p.bubbleRef} class={`tt-tut-bubble side-${side}${p.compact ? ' compact' : ''}`} style={placeStyle(p.place)} tabIndex={-1}
      role="dialog" aria-modal="true" aria-label={`Samouczek, krok ${p.n} z ${p.total}`}>
      <div class="tt-tut-head">
        <b class="tt-tut-title">{p.title}</b>
        <span class="tt-tut-count">{p.n} / {p.total}</span>
      </div>
      <p class="tt-tut-text">{p.text}</p>
      {p.hint && <p class={`tt-tut-task${p.done ? ' done' : ''}`}>{p.done ? '✓ Zrobione' : `👉 ${p.hint}`}</p>}
      <div class="tt-tut-foot">
        {p.skip && <button type="button" class="tt-btn tt-tut-skip" onClick={p.onSkip}>Pomiń</button>}
        {p.primary && <button type="button" class="tt-btn tt-primary tt-tut-next" onClick={p.onNext}>{p.primary}</button>}
      </div>
    </div>
  );
}

/** Dymek „pierwszy raz”: tekst ze strzałką przy elemencie i „OK”. Nie przygasza ekranu i nie zatrzymuje gry. */
export function TipBubble({ text, place, bubbleRef, onOk }: { text: string; place: Placement | null; bubbleRef?: Ref<HTMLDivElement>; onOk(): void }) {
  return (
    <div ref={bubbleRef} class={`tt-tut-bubble tt-tip-bubble side-${place?.side ?? 'center'}`} style={placeStyle(place)} role="status">
      <p class="tt-tut-text">{text}</p>
      <div class="tt-tut-foot">
        <button type="button" class="tt-btn tt-primary tt-tut-next" onClick={onOk}>OK</button>
      </div>
    </div>
  );
}

// --- Pomiar w DOM --------------------------------------------------------------------------------------------------------

const viewSize = (): Size => ({ w: window.innerWidth, h: window.innerHeight });
const rectOf = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

/** Prostokąt elementu przycięty do przewijanych przodków (arkusz zakładki, okno z paskiem przewijania); null, gdy nic nie widać. */
function visibleRect(el: Element): Rect | null {
  const clips: Rect[] = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(`${style.overflowX}${style.overflowY}`)) clips.push(rectOf(p));
  }
  const view = viewSize();
  clips.push({ x: 0, y: 0, w: view.w, h: view.h });
  return clipRect(rectOf(el), clips);
}

/** Pierwszy widoczny element `[data-tut=id]` (po przycięciu do przodków) z jego prostokątem. */
function findTarget(id: string): { el: HTMLElement; rect: Rect } | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tut="${id}"]`)) {
    const rect = visibleRect(el);
    if (rect) return { el, rect };
  }
  return null;
}

/** Arkusz zakładki, w którym leży cel (nie on sam): dymek staje wtedy przy arkuszu, a nie na jego treści. */
function containerOf(el: HTMLElement): Rect | null {
  const sheet = el.closest<HTMLElement>('[data-tut="sheet"]');
  return sheet && sheet !== el ? rectOf(sheet) : null;
}

const same = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

interface Geo { target: Rect | null; place: Placement; compact: boolean; view: Size }

/**
 * Pomiar co klatkę, póki `active`: cel (`measure` zwraca element albo null), wymiary dymka i miejsce dla niego. Stan zmienia się
 * tylko przy przesunięciu o ponad pół piksela. Dymek, który nigdzie się nie mieści, przechodzi w tryb zwarty i liczy się jeszcze raz.
 */
function useGeometry(active: boolean, key: string, measure: () => HTMLElement | null, bubble: { current: HTMLDivElement | null }): Geo | null {
  const [geo, setGeo] = useState<Geo | null>(null);
  const last = useRef<Geo | null>(null);
  const compact = useRef(false);
  useEffect(() => { compact.current = false; last.current = null; setGeo(null); }, [key]);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = measure();
      const target = el ? visibleRect(el) : null;
      const box = bubble.current;
      if (!box) return;
      const size: Size = { w: box.offsetWidth, h: box.offsetHeight };
      const view = viewSize();
      const place = placeBubble(target, size, view, el && target ? containerOf(el) : null);
      if (place.covers && !compact.current) compact.current = true;
      const next: Geo = { target, place, compact: compact.current, view };
      const prev = last.current;
      if (prev && same(prev.target, next.target) && Math.abs(prev.place.x - place.x) < 0.5 && Math.abs(prev.place.y - place.y) < 0.5
        && prev.place.side === place.side && Math.abs(prev.place.arrow - place.arrow) < 0.5 && prev.compact === next.compact
        && prev.view.w === view.w && prev.view.h === view.h) return;
      last.current = next;
      setGeo(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, key]);
  return active ? geo : null;
}

const boxStyle = (r: Rect): Record<string, string> => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${Math.max(0, r.w)}px`, height: `${Math.max(0, r.h)}px` });

/** Elementy, na które w kroku wolno przenieść fokus Tabem: przyciski dymka i, w zadaniu, element w dziurze. */
function focusables(root: Element | null): HTMLElement[] {
  if (!root) return [];
  const sel = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...(root.matches(sel) ? [root as HTMLElement] : []), ...root.querySelectorAll<HTMLElement>(sel)];
}

/**
 * Warstwa przelotu: przygaszenie z pierścieniem na celu, cztery blokady wokół „dziury” (w kroku informacyjnym piąta zamyka i ją),
 * dymek przy celu. Pod oknem gry (`tourSuspended`) jej nie ma. Esc to „Pomiń”, a Tab krąży tylko po dymku i elemencie zadania.
 */
export function TourLayer() {
  const run = tour.value;
  const visible = tourVisible.value;
  const bubble = useRef<HTMLDivElement>(null);
  const step = run ? run.steps[run.index] : undefined;
  const key = run && step ? `${run.index}:${step.id}` : '';
  void econ.value;   // `can` zadania czyta stan gry: warstwa odświeża się z każdą publikacją
  const geo = useGeometry(visible, key, () => (step?.target ? findTarget(step.target)?.el ?? null : null), bubble);
  const ctx = tourCtx();
  const targetShown = !!geo?.target;
  const taskLive = !!step?.task && !!ctx && (step.task.can ? step.task.can(ctx) : true) && (targetShown || !step.target);
  const holeOpen = taskLive && !run?.done && targetShown;

  // przewinięcie arkusza do celu i fokus przy każdym kroku (w zadaniu fokus na dymku, żeby Enter nie trafił w „Pomiń”)
  useEffect(() => {
    if (!visible || !step) return;
    const found = step.target ? findTarget(step.target) ?? document.querySelector(`[data-tut="${step.target}"]`) : null;
    const el = found && 'el' in found ? found.el : (found as Element | null);
    el?.scrollIntoView?.({ block: 'nearest' });
    const box = bubble.current;
    const next = box?.querySelector<HTMLElement>('.tt-tut-next');
    (taskLive || !next ? box : next)?.focus({ preventScroll: true });
  }, [visible, key]);

  // Esc to „Pomiń”; Tab krąży po dymku i (w zadaniu) po elemencie w dziurze, w fazie przechwytywania, przed skrótami gry
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skipTour(); return; }
      if (e.key !== 'Tab') return;
      const target = holeOpen && step?.target ? findTarget(step.target)?.el ?? null : null;
      const list = [...focusables(bubble.current), ...focusables(target)];
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      list[(at + (e.shiftKey ? -1 : 1) + list.length) % list.length]!.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [visible, key, holeOpen]);

  if (!run || !step || !visible) return null;
  const last = run.index === run.steps.length - 1;
  const view = geo?.view ?? { w: 0, h: 0 };
  const hole = geo?.target ? inflate(geo.target, RING) : null;
  const blockers = hole ? blockersAround(hole, view) : [{ x: 0, y: 0, w: view.w || 1e5, h: view.h || 1e5 }];
  if (hole && !holeOpen) blockers.push(hole);
  return (
    <div class="tt-tut-layer">
      {hole ? <div class="tt-tut-ring" style={boxStyle(hole)} /> : <div class="tt-tut-dim" />}
      {blockers.map((r, i) => <div key={i} class="tt-tut-block" style={boxStyle(r)} />)}
      <Bubble bubbleRef={bubble} title={step.title} text={step.text} n={run.index + 1} total={run.steps.length}
        hint={taskLive ? step.task!.hint : undefined} done={run.done}
        primary={last ? 'Zakończ' : taskLive ? null : 'Dalej'} skip={!last}
        place={geo?.place ?? null} compact={geo?.compact} onNext={nextStep} onSkip={skipTour} />
    </div>
  );
}

/** Kontekst dymków „pierwszy raz” z sygnałów interfejsu; null bez gry. */
function tipCtx(): TipCtx | null {
  const view = econ.value;
  if (!view) return null;
  return {
    s: view.s, tab: tab.value, report: report.value, remanentOpen: !!remanent.value, storyOpen: story.value.length > 0,
    windowOpen: isWindowOpen() || showSettings.value, offerOpen: tutorialOffer.value, tourVisible: tourVisible.value,
  };
}

/** Czy nic nie leży nad środkiem elementu (poza warstwami samouczka): zwykły dymek nie wskazuje rzeczy zasłoniętych oknem. */
function onTop(el: HTMLElement, r: Rect): boolean {
  const hit = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
  return !hit || el.contains(hit) || !!hit.closest('.tt-tip-layer, .tt-tut-layer');
}

/** Pierwszy kandydat, którego element jest na ekranie, z tym elementem. */
function pickTip(candidates: readonly TipCandidate[]): { tip: TipCandidate; el: HTMLElement } | null {
  for (const tip of candidates) {
    for (const id of tip.targets) {
      const found = findTarget(id);
      if (found && (tip.inWindow || onTop(found.el, found.rect))) return { tip, el: found.el };
    }
  }
  return null;
}

/**
 * Warstwa dymków „pierwszy raz”: pierścień na elemencie i dymek z „OK”, bez przygaszenia i blokad. Dymek karty zmniejsza na chwilę
 * wysokość jej okna na telefonie (`data-tut-tip` na `<html>`), żeby nad kartą zmieścił się dymek.
 */
export function TipLayer() {
  const ctx = tipCtx();
  const candidates = ctx ? tipsFor(ctx, loadTutorial()) : [];
  const ids = candidates.map((c) => `${c.id}:${c.targets.join(',')}`).join('|');
  const [picked, setPicked] = useState<{ id: TipId; text: string; target: string } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  // element dymka może pojawić się albo odsłonić bez zmiany kandydatów (okno zamknięte, arkusz przewinięty): szukamy go ok. raz na sekundę
  const beat = Math.floor((econ.value?.v ?? 0) / 5);

  useEffect(() => {
    settleTips(candidates);
    const pick = pickTip(candidates);
    if (pick) showTip(pick.tip.id);
    const target = pick?.el.dataset.tut ?? '';
    setPicked(pick ? { id: pick.tip.id, text: pick.tip.text, target } : null);
  }, [ids, shownTip.value, beat]);

  const shown = picked && shownTip.value === picked.id ? picked : null;
  useEffect(() => {
    const root = document.documentElement;
    if (shown?.id === 'tip-karta') root.dataset.tutTip = 'card';
    else delete root.dataset.tutTip;
  }, [shown?.id]);
  const geo = useGeometry(!!shown, shown ? `${shown.id}:${shown.target}` : '', () => (shown ? findTarget(shown.target)?.el ?? null : null), bubble);
  if (!shown) return null;
  const ring = geo?.target ? inflate(geo.target, RING) : null;
  return (
    <div class="tt-tip-layer">
      {ring && <div class="tt-tip-ring" style={boxStyle(ring)} />}
      <TipBubble bubbleRef={bubble} text={shown.text} place={geo?.place ?? null} onOk={dismissTip} />
    </div>
  );
}

/** Wszystkie warstwy samouczka; prędkość dostaje przelot przez `controls` (pauza i jej zdjęcie dotyczą też świata). */
export function TutorialHost({ controls }: { controls: Pick<Controls, 'setSpeed'> }) {
  bindTourControls(controls);
  return (
    <>
      <TutorialOffer />
      <TipLayer />
      <TourLayer />
    </>
  );
}

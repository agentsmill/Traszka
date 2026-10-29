import type { Ref } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { OUTFIT_ORDER, rollCashierLook, stepOutfit, type CashierLook } from '@/game/cashier';
import { NICK_MAX } from '@/game/nick';
import { clipSeedInput, freeSeed } from '@/game/seeds';
import { randomSeed } from '@/game/seedWords';
import { hasStoredSave } from '@/game/session';
import { submitStart } from '@/game/start';
import type { OutfitFile } from '@/render/characters/modularPack';
import { DISCLAIMER } from '../game/overlays';
import { confirmRankedStart, start, type StartRequest } from '../state';
import '../ranking/ranking.css';
import { createLauncher, type Launcher } from './launch';
import { createStartPreview, type StartPreview } from './preview';
import { rankedAskFacts, rankedAskText } from './rankedAsk';
import { WEEK_CHIP, WEEK_UNAVAILABLE, WEEK_WAITING, createWeekSeedPicker, type WeekSeedPicker } from './weekSeed';

/** Nazwy strojów pod podglądem (typ pilnuje, że każdy z 21 strojów ma nazwę). */
const OUTFIT_LABEL: Record<OutfitFile, string> = {
  'men-casual-hoodie': 'Bluza z kapturem',
  'men-casual-2': 'Koszulka i dżinsy',
  'men-suit': 'Garnitur',
  'men-worker': 'Kamizelka robocza',
  'men-farmer': 'Ogrodniczki',
  'men-beach': 'Strój plażowy',
  'men-punk': 'Punk',
  'women-casual': 'Codzienny strój',
  'women-suit': 'Garsonka',
  'women-formal': 'Sukienka',
  'women-worker': 'Strój roboczy',
  'women-punk': 'Punkówa',
  'special-men-spacesuit': 'Kosmonauta',
  'special-men-king': 'Król',
  'special-men-swat': 'Antyterrorysta',
  'special-men-adventurer': 'Poszukiwacz przygód',
  'special-women-scifi': 'Pilotka z przyszłości',
  'special-women-adventurer': 'Poszukiwaczka przygód',
  'special-women-witch': 'Czarownica',
  'special-women-medieval': 'Strój średniowieczny',
  'special-women-soldier': 'Żołnierka',
};

/** Po tylu ms oczekiwania na strój specjalny pokazujemy „Wczytuję strój…” (zwykły stoi od razu i nie migocze). */
const PENDING_NOTE_MS = 160;

/** Podpis pod „Start rankingowy”. */
export const RANKED_NOTE = 'Trzy miesiące na jednym seedzie, bez premii z sieci. Wynik wyślesz po sezonie; gdy ranking nie działa, bieg poczeka w przeglądarce. Bieg zakończony bankructwem nie trafia do rankingu.';

/**
 * Pytanie w ekranie startowym, gdy nowy bieg rankingowy porzuciłby coś, co jeszcze żyje (niewysłany bieg, trwający bieg): zamiast
 * dwóch przycisków startu. Komponent bez haków (tekst pytania i odpowiedzi daje ekran), więc testy wołają go jak zwykłą funkcję.
 * „Wróć” jest bezpieczną odpowiedzią i dostaje fokus; w trakcie startu po „Porzuć i zacznij” oba przyciski czekają.
 */
export function RankedConfirm({ question, busy, cancelRef, onReplace, onCancel }: {
  question: string;
  busy: boolean;
  cancelRef?: Ref<HTMLButtonElement>;
  onReplace: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="tt-ranked-ask">
      <p class="tt-ranked-ask-text" role="alert">{question}</p>
      <button type="button" class={`tt-btn big tt-ranked-go${busy ? ' is-working' : ''}`} disabled={busy} onClick={onReplace}>
        {busy ? 'Otwieramy…' : 'Porzuć i zacznij'}
      </button>
      <button ref={cancelRef} type="button" class="tt-btn big" disabled={busy} onClick={onCancel}>Wróć</button>
    </div>
  );
}

/** Numery egzemplarzy ekranu: jeden na obiekt prośby, na zawsze ten sam (klucz musi się nie zmieniać między renderami tej samej prośby). */
const screenKeys = new WeakMap<StartRequest, number>();
let lastScreenKey = 0;
const screenKey = (request: StartRequest): number => {
  let key = screenKeys.get(request);
  if (key === undefined) screenKeys.set(request, key = ++lastScreenKey);
  return key;
};

/**
 * Ekran startowy, gdy `start` jest ustawione (pierwsze wejście albo „Nowy sklep” z ⚙); inaczej nic. Każda prośba (obiekt) to osobny
 * egzemplarz ekranu (`key`): ekran trzyma stan, którego nie wolno odziedziczyć po poprzednim, czyli wyrzutnię startu (po starcie
 * zostaje „zajęta” na zawsze), „Otwieramy…” i zwolniony podgląd 3D. Gdy prośba zamienia się na nową w jednym kroku (ekran zamknięty
 * i od razu odtworzony, `openChosenStore`), render widzi tylko ostatnią wartość sygnału i bez klucza użyłby starego egzemplarza ponownie.
 */
export function StartHost() {
  const request = start.value;
  return request ? <StartScreen key={screenKey(request)} request={request} /> : null;
}

/**
 * „Twój kasjer”. Lewa strona: podgląd 3D kasjera na podeście (osobny, lekki renderer, `preview.ts`), 🎲 Losuj, strzałki ‹ › po
 * strojach (najpierw zwykłe, potem specjalne) i przełącznik strojów specjalnych w losowaniu. Prawa: nazwa gracza, seed sklepu
 * i duży przycisk „Otwieramy sklep!”, pod nim „Start rankingowy”. Chip „Seed tygodnia” obok kostki wpisuje w pole seed z serwera
 * rankingu. Gdy nowy bieg rankingowy porzuciłby niewysłany albo trwający bieg, pytanie (`RankedConfirm`) staje w miejscu przycisków
 * startu, a ekran (z podglądem) zostaje otwarty: pyta się przed zamknięciem, bo zamknięty podgląd oddaje kontekst WebGL bezpowrotnie.
 * Telefon (< 700 px): podgląd u góry, formularz pod spodem. Cała logika (nick, seed, zapisy) jest w `game/start.ts`; tu tylko pola
 * i podgląd. Podgląd zwalnia swój renderer, zanim ruszy gra.
 */
export function StartScreen({ request }: { request: StartRequest }) {
  const [nick, setNick] = useState(request.form.nick);
  const [seed, setSeed] = useState(request.form.seed);
  const [look, setLook] = useState<CashierLook>(request.form.look);
  const [special, setSpecial] = useState(request.form.specialOutfits);
  const [nickError, setNickError] = useState<string | null>(null);
  /** Podgląd 3D: `loading` do czasu fabryki postaci, `ready` gdy stoi, `none` gdy się nie udał (formularz działa i bez niego). */
  const [stage, setStage] = useState<'loading' | 'ready' | 'none'>('loading');
  const [pending, setPending] = useState(false);
  /** Start ruszył (który: zwykły czy rankingowy): przyciski są wyłączone, ten kliknięty z napisem „Otwieramy…”, a budowa świata czeka na namalowanie go. */
  const [busyKind, setBusyKind] = useState<'casual' | 'ranked' | null>(null);
  const busy = busyKind !== null;
  /** Licznik próśb o pokazanie pola z błędem (każda zła próba zatwierdzenia, także z tym samym komunikatem, przewija na nowo). */
  const [revealTick, setRevealTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nickRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<Launcher | null>(null);
  launcherRef.current ??= createLauncher();
  /** Chip „Seed tygodnia”: jest tylko wtedy, gdy wołający umie zapytać serwer (`weekSeed`). */
  const weekRef = useRef<WeekSeedPicker | null>(null);
  if (request.weekSeed) weekRef.current ??= createWeekSeedPicker(request.weekSeed, (picked) => setSeed(clipSeedInput(picked)));
  const week = weekRef.current;
  /** Pytanie o porzucenie biegu (ustawia je ekran po kliknięciu „Start rankingowy”, a `startRanked`, gdyby start nie wyszedł mimo sprawdzenia). */
  const asked = confirmRankedStart.value;
  const question = useMemo(() => (asked ? rankedAskText(asked.reason, rankedAskFacts()) : null), [asked]);
  const previewRef = useRef<StartPreview | null>(null);
  const lookRef = useRef(look);
  lookRef.current = look;
  const ticketRef = useRef(0);

  /** Pokazuje wygląd w podglądzie; „Wczytuję strój…” tylko gdy strój specjalny naprawdę trwa. */
  const showLook = (next: CashierLook): void => {
    const preview = previewRef.current;
    if (!preview) return;   // podgląd powstanie z bieżącym wyglądem, gdy fabryka postaci dojdzie
    const ticket = ++ticketRef.current;
    const timer = setTimeout(() => { if (ticket === ticketRef.current) setPending(true); }, PENDING_NOTE_MS);
    void preview.show(next).then(() => {
      clearTimeout(timer);
      if (ticket === ticketRef.current) setPending(false);
    });
  };

  useEffect(() => {
    let alive = true;
    void request.factory.then((factory) => {
      const canvas = canvasRef.current;
      if (!alive || !canvas) return;
      try {
        previewRef.current = createStartPreview(canvas, factory);
      } catch (error) {
        console.error('Nie udało się uruchomić podglądu kasjera.', error);
        setStage('none');
        return;
      }
      Object.assign(window, { traszkaStart: { get preview() { return previewRef.current; } } });   // uchwyt do ręcznych testów i zrzutów
      setStage('ready');
      showLook(lookRef.current);
    });
    return () => {
      alive = false;
      weekRef.current?.reset();   // spóźniona odpowiedź serwera nie dotyka ekranu, którego już nie ma
      previewRef.current?.dispose();
      previewRef.current = null;
      delete (window as { traszkaStart?: unknown }).traszkaStart;
    };
  }, []);

  useEffect(() => { showLook(look); }, [look]);

  /** Pytanie o bieg wchodzi w miejsce przycisków startu: fokus na bezpieczną odpowiedź, żeby klawiatura i czytnik ekranu go nie zgubiły. */
  useEffect(() => { if (asked) cancelRef.current?.focus(); }, [asked]);

  /** Zamyka ekran: najpierw podgląd oddaje renderer i kontekst WebGL, potem ekran znika (z nim pytanie o bieg), dopiero potem ruszają dalsze kroki. */
  const close = (then: () => void): void => {
    previewRef.current?.dispose();
    previewRef.current = null;
    start.value = null;
    confirmRankedStart.value = null;
    then();
  };
  const back = (): void => {
    if (launcherRef.current?.busy) return;   // „Otwieramy…” już ruszyło: nie ma powrotu
    close(() => request.onBack?.());
  };

  useEffect(() => {
    if (request.mode !== 'new') return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Przyklejony pasek z przyciskiem (telefon, niskie okno) zasłania dół okna, więc to, co ma być widać (pole z błędem, pole, na które
   * przeszło się klawiszem), musi zatrzymać się nad nim: wysokość paska idzie do `--tt-go-h`, a CSS robi z niej `scroll-padding-bottom`
   * okna ekranu (`ui.css`). Pasek bywa wyższy z „Wróć do gry”, ma też pas na dole ekranu telefonu, więc mierzymy go, a nie zgadujemy.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    const band = bandRef.current;
    if (!wrap || !band) return;
    const sync = (): void => { wrap.style.setProperty('--tt-go-h', `${band.offsetHeight}px`); };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(band);
    return () => observer.disconnect();
  }, []);

  /** Po złym zatwierdzeniu (już po narysowaniu komunikatu) pole nazwy wjeżdża nad pasek z przyciskiem, razem z błędem pod nim. */
  useEffect(() => {
    const input = nickRef.current;
    if (revealTick === 0 || !input) return;
    input.scrollIntoView({ block: 'center' });   // wnętrze okna bez paska (scroll-padding-bottom), więc błąd pod polem też jest widać
    input.focus({ preventScroll: true });
  }, [revealTick]);

  /**
   * Limit pola seeda liczy punkty kodowe (`SEED_MAX`: emoji to jeden znak), więc pilnuje go ten program, a nie `maxLength`, który
   * liczy jednostki UTF-16 i ucinałby po 20 emoji. Wklejony tekst też jest przycinany; kursor zostaje tam, gdzie był (albo na końcu).
   */
  const editSeed = (input: HTMLInputElement): void => {
    const clipped = clipSeedInput(input.value);
    if (clipped !== input.value) {
      const caret = Math.min(input.selectionStart ?? clipped.length, clipped.length);
      input.value = clipped;
      input.setSelectionRange(caret, caret);
    }
    setSeed(clipped);
    week?.reset();   // własny seed gracza wygrywa z chipem (także ze spóźnioną odpowiedzią serwera)
  };

  /**
   * „Otwieramy sklep!” (`ranked` false), „Start rankingowy” (`ranked` true) i „Porzuć i zacznij” (`replace`). Zły nick blokuje wszystkie
   * trzy. Start rankingowy pyta o porzucenie biegu (`rankedBlock`) przed zamknięciem czegokolwiek; pytanie jest w sygnale, ekran stoi.
   */
  const begin = (ranked: boolean, replace = false): void => {
    if (launcherRef.current?.busy) return;
    const result = submitStart({ nick, seed, look, specialOutfits: special }, undefined, ranked);
    if (!result.ok) {
      setNickError(result.nickError);
      setRevealTick((t) => t + 1);
      return;
    }
    const { choice } = result;
    if (ranked && !replace) {
      const reason = request.rankedBlock?.() ?? null;
      if (reason) {
        confirmRankedStart.value = { seed: choice.seed, reason };
        return;
      }
    }
    // odpowiedź od razu („Otwieramy…”), a ciężka budowa świata dopiero po jej namalowaniu (launch.ts)
    launcherRef.current?.launch(
      () => setBusyKind(ranked ? 'ranked' : 'casual'),
      () => close(() => (replace ? request.onStart(choice, { replace: true }) : request.onStart(choice))),
    );
  };
  const submit = (e: Event): void => {
    e.preventDefault();
    begin(false);
  };

  const weekWaiting = week?.status.value === 'loading';
  const label = OUTFIT_LABEL[look.outfit];
  const at = OUTFIT_ORDER.indexOf(look.outfit) + 1;
  return (
    <div ref={wrapRef} class="tt-modal-wrap tt-start-wrap">
      <div class="tt-modal tt-start" role="dialog" aria-modal="true" aria-labelledby="tt-start-title">
        <form class={`tt-start-grid${busy ? ' is-busy' : ''}`} noValidate aria-busy={busy} onSubmit={submit}>
          <header class="tt-start-head">
            <h2 id="tt-start-title">Twój kasjer</h2>
            <p class="tt-hint">Wybierz, kto stanie za ladą, wpisz nazwę i seed sklepu, i otwieramy.</p>
          </header>

          <section class="tt-start-cashier" aria-label="Wygląd kasjera">
            <div class="tt-stage">
              <canvas ref={canvasRef} class="tt-stage-canvas" role="img" aria-label={`Podgląd kasjera: ${label}`} />
              {stage === 'none' && <div class="tt-stage-note"><b>{label}</b>Podgląd 3D jest niedostępny na tym urządzeniu, kasjera zobaczysz w sklepie.</div>}
              {stage === 'loading' && <div class="tt-stage-note">Wczytuję kasjerów…</div>}
              {stage === 'ready' && pending && <div class="tt-stage-note small">Wczytuję strój…</div>}
            </div>
            <div class="tt-picker" role="group" aria-label="Strój kasjera">
              <button type="button" class="tt-btn tt-arrow" aria-label="Poprzedni strój" onClick={() => setLook((l) => stepOutfit(l, -1))}>‹</button>
              <div class="tt-outfit" aria-live="polite"><b>{label}</b><span>{at} / {OUTFIT_ORDER.length}</span></div>
              <button type="button" class="tt-btn tt-arrow" aria-label="Następny strój" onClick={() => setLook((l) => stepOutfit(l, 1))}>›</button>
            </div>
            <button type="button" class="tt-btn tt-roll" onClick={() => setLook(rollCashierLook(special))}>🎲 Losuj</button>
            <label class="tt-check-row">
              <input type="checkbox" checked={special} onChange={(e) => setSpecial(e.currentTarget.checked)} /> Stroje specjalne w losowaniu
            </label>
          </section>

          <section class="tt-start-form">
            <label class="tt-field-label" for="tt-nick">Nazwa gracza</label>
            <input id="tt-nick" ref={nickRef} class="tt-input" type="text" value={nick} maxLength={NICK_MAX} autocomplete="nickname"
              autocapitalize="words" spellcheck={false} placeholder="np. Mateusz" aria-invalid={nickError !== null} aria-describedby="tt-nick-error"
              onInput={(e) => { setNick(e.currentTarget.value); if (nickError !== null) setNickError(null); }} />
            <p id="tt-nick-error" class="tt-field-error" role="alert">{nickError}</p>

            <label class="tt-field-label" for="tt-seed">Seed sklepu</label>
            <div class="tt-seedrow">
              <input id="tt-seed" class="tt-input" type="text" value={seed} autocomplete="off" autocapitalize="off"
                spellcheck={false} placeholder="dowolny tekst" onInput={(e) => editSeed(e.currentTarget)} />
              {week && (
                <button type="button" class="tt-btn tt-weekseed" disabled={busy || weekWaiting} onClick={() => week.pick()}>
                  {weekWaiting ? WEEK_WAITING : WEEK_CHIP}
                </button>
              )}
              <button type="button" class="tt-btn tt-dice" aria-label="Wylosuj seed" title="Wylosuj seed"
                onClick={() => { setSeed(freeSeed(randomSeed, hasStoredSave)); week?.reset(); }}>🎲</button>
            </div>
            {week?.status.value === 'unavailable' && <p class="tt-hint warn" role="status">{WEEK_UNAVAILABLE}</p>}
            <p class="tt-hint">Dowolny tekst. Ten sam seed to ten sam sklep, a każdy seed ma własny zapis gry.</p>

            <div ref={bandRef} class="tt-start-go">
              {question !== null ? (
                <RankedConfirm question={question} busy={busy} cancelRef={cancelRef} onReplace={() => begin(true, true)}
                  onCancel={() => { confirmRankedStart.value = null; }} />
              ) : (
                <button type="submit" class="tt-btn tt-primary big" disabled={busy}>{busyKind === 'casual' ? 'Otwieramy…' : 'Otwieramy sklep!'}</button>
              )}
            </div>
            <div class="tt-start-more">
              {question === null && (
                <>
                  <button type="button" class={`tt-btn big tt-ranked-go${busyKind === 'ranked' ? ' is-working' : ''}`} aria-describedby="tt-ranked-note"
                    disabled={busy} onClick={() => begin(true)}>
                    {busyKind === 'ranked' ? 'Otwieramy…' : 'Start rankingowy'}
                  </button>
                  <p id="tt-ranked-note" class="tt-hint tt-ranked-note">{RANKED_NOTE}</p>
                </>
              )}
              {request.mode === 'new' && <button type="button" class="tt-btn big tt-back" disabled={busy} onClick={back}>Wróć do gry</button>}
            </div>
            <p class="tt-disclaimer2">{DISCLAIMER}</p>
          </section>
        </form>
      </div>
    </div>
  );
}

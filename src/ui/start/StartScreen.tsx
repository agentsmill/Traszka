import { useEffect, useRef, useState } from 'preact/hooks';
import { OUTFIT_ORDER, rollCashierLook, stepOutfit, type CashierLook } from '@/game/cashier';
import { NICK_MAX } from '@/game/nick';
import { SEED_MAX, freeSeed } from '@/game/seeds';
import { randomSeed } from '@/game/seedWords';
import { hasStoredSave } from '@/game/session';
import { submitStart } from '@/game/start';
import type { OutfitFile } from '@/render/characters/modularPack';
import { DISCLAIMER } from '../game/overlays';
import { start, type StartRequest } from '../state';
import { createStartPreview, type StartPreview } from './preview';

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

/** Ekran startowy, gdy `start` jest ustawione (pierwsze wejście albo „Nowy sklep” z ⚙); inaczej nic. */
export function StartHost() {
  const request = start.value;
  return request ? <StartScreen request={request} /> : null;
}

/**
 * „Twój kasjer”. Lewa strona: podgląd 3D kasjera na podeście (osobny, lekki renderer, `preview.ts`), 🎲 Losuj, strzałki ‹ › po
 * strojach (najpierw zwykłe, potem specjalne) i przełącznik strojów specjalnych w losowaniu. Prawa: nazwa gracza, seed sklepu
 * i duży przycisk „Otwieramy sklep!”. Telefon (< 700 px): podgląd u góry, formularz pod spodem. Cała logika (nick, seed, zapisy)
 * jest w `game/start.ts`; tu tylko pola i podgląd. Podgląd zwalnia swój renderer, zanim ruszy gra.
 */
function StartScreen({ request }: { request: StartRequest }) {
  const [nick, setNick] = useState(request.form.nick);
  const [seed, setSeed] = useState(request.form.seed);
  const [look, setLook] = useState<CashierLook>(request.form.look);
  const [special, setSpecial] = useState(request.form.specialOutfits);
  const [nickError, setNickError] = useState<string | null>(null);
  /** Podgląd 3D: `loading` do czasu fabryki postaci, `ready` gdy stoi, `none` gdy się nie udał (formularz działa i bez niego). */
  const [stage, setStage] = useState<'loading' | 'ready' | 'none'>('loading');
  const [pending, setPending] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nickRef = useRef<HTMLInputElement>(null);
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
      previewRef.current?.dispose();
      previewRef.current = null;
      delete (window as { traszkaStart?: unknown }).traszkaStart;
    };
  }, []);

  useEffect(() => { showLook(look); }, [look]);

  /** Zamyka ekran: najpierw podgląd oddaje renderer i kontekst WebGL, potem ekran znika, dopiero potem ruszają dalsze kroki. */
  const close = (then: () => void): void => {
    previewRef.current?.dispose();
    previewRef.current = null;
    start.value = null;
    then();
  };
  const back = (): void => close(() => request.onBack?.());

  useEffect(() => {
    if (request.mode !== 'new') return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: Event): void => {
    e.preventDefault();
    const result = submitStart({ nick, seed, look, specialOutfits: special });
    if (!result.ok) {
      setNickError(result.nickError);
      nickRef.current?.focus();
      return;
    }
    close(() => request.onStart(result.choice));
  };

  const label = OUTFIT_LABEL[look.outfit];
  const at = OUTFIT_ORDER.indexOf(look.outfit) + 1;
  return (
    <div class="tt-modal-wrap tt-start-wrap">
      <div class="tt-modal tt-start" role="dialog" aria-modal="true" aria-labelledby="tt-start-title">
        <form class="tt-start-grid" noValidate onSubmit={submit}>
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
              <input id="tt-seed" class="tt-input" type="text" value={seed} maxLength={SEED_MAX} autocomplete="off" autocapitalize="off"
                spellcheck={false} placeholder="dowolny tekst" onInput={(e) => setSeed(e.currentTarget.value)} />
              <button type="button" class="tt-btn tt-dice" aria-label="Wylosuj seed" title="Wylosuj seed"
                onClick={() => setSeed(freeSeed(randomSeed, hasStoredSave))}>🎲</button>
            </div>
            <p class="tt-hint">Dowolny tekst. Ten sam seed to ten sam sklep, a każdy seed ma własny zapis gry.</p>

            <div class="tt-start-go">
              <button type="submit" class="tt-btn tt-primary big">Otwieramy sklep!</button>
              {request.mode === 'new' && <button type="button" class="tt-btn big tt-back" onClick={back}>Wróć do gry</button>}
            </div>
            <p class="tt-disclaimer2">{DISCLAIMER}</p>
          </section>
        </form>
      </div>
    </div>
  );
}

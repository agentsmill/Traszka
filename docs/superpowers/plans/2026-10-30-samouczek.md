# Samouczek: plan

> Wykonanie: jedna sesja, TDD (Vitest). Kroki w formacie `- [ ]`. Każde zadanie kończy się zielonym `npx vitest run <pliki>` i commitem.

**Cel:** po ekranie startowym gracz dostaje propozycję samouczka. Przelot po prawdziwym sklepie ma 16 kroków (spotlight, dymek, zadania). Są też dymki „pierwszy raz” i słowniczek SIM 6 w „Jak grać”. Wszystko w warstwie widoku, bez `dispatch` i bez zmian w `src/sim/**`.

**Spec:** `docs/superpowers/specs/2026-10-30-samouczek-design.md` (zaakceptowany 2026-10-30; odpowiedzi właściciela w §14).

**Architektura:**
- Czyste funkcje (geometria, pamięć, kroki, dymki, słowniczek) w `src/ui/tutorial/` i `src/ui/howto/glossary.ts`, testowane w node.
- Stan przelotu to sygnał w `tour.ts`, bez DOM.
- Komponenty w `Tutorial.tsx`: część bez haków (`TutorialOffer`, `Bubble`, `TipBubble`) do testów `vnodeTree` oraz warstwy z pomiarem (`TourLayer`, `TipLayer`), które sprawdza smoke.

## Global Constraints
- Bez zmian w `src/sim/**`, `SIM_VERSION`, `GOLDEN`, `judgeBundle.js`. Samouczek nie zawiera `dispatch` (test źródła).
- W `Hud.tsx` (pasek pieniędzy), `statement.tsx`, `spend.tsx`, `monthPreview.tsx` i protokole remanentu tylko atrybuty `data-tut`.
- Teksty po polsku z polskimi znakami, liczby ze stałych gry, bez „opłata franczyzowa”, „do oddania” i „WUT”.
- `localStorage` tylko w `memory.ts`, zawsze w `try/catch`, czytany przy każdym wywołaniu.
- Bramki na końcu: `npm test` (poza znanym `exactMath.test.ts` z `main`), `npm run build`, `npm run check:vercel-build`, smoke.

## Review Focus
1. Bieg rankingowy: brak okna wyboru, brak „Jak grać”, toast przy „Samouczek”, dziennik bez poleceń od samouczka.
2. Dymek nigdy nie zasłania celu na 390×844 i 1280×800 (`placeBubble` i smoke).
3. Okno gry w trakcie przelotu (karta o 7:00 w kroku 15): wstrzymanie i powrót, bez zakleszczeń.
4. Prędkość: start, „Pomiń”, krok 15 i koniec.
5. Stary gracz (meta bez pamięci samouczka): brak okna przy wejściu, okno przy pierwszym zupełnie nowym sklepie.

---

### Zadanie S1: pamięć (`src/ui/tutorial/memory.ts`)
- [ ] Testy (`memory.test.ts`): brak klucza daje wartości domyślne; zły JSON, obce pola, zły `tour`, nieznane i powtórzone `seen` są oczyszczane; `failWrites` jest cichy; magazyn, który rzuca przy `getItem`, daje wartości domyślne; `markSeen` dopisuje raz; `setTips`; `answerOffer` (`started` / `skipped`, `done` wygrywa).
- [ ] Implementacja: `TutorialMemory`, `TIP_IDS`, `loadTutorial()`, `saveTutorial()`, `markSeen()`, `setTips()`, `setTour()`.

### Zadanie S2: geometria (`src/ui/tutorial/layout.ts`)
- [ ] Testy (`layout.test.ts`): układy z §11 specu (pasek → pod, zakładki i kliker → nad, cel w arkuszu telefonu → nad arkuszem, cel w panelu desktopu → po lewej panelu, cały arkusz → nad nim); wszystkie cztery strony; tryb zwarty i `covers`; strzałka docięta; `clipRect`; `blockersAround`; właściwość na 500 losowych celach.
- [ ] Implementacja: `Rect`, `intersects`, `clipRect`, `placeBubble`, `blockersAround`.

### Zadanie S3: kroki i lista pieniędzy (`steps.ts`, `money.ts`)
- [ ] Testy (`steps.test.ts`):
  - `buildTour` dla Asystenta (16 kroków) i ręcznego (15), z kolejnością identyfikatorów;
  - zaliczenia (`zakladki`, `reczne`, `asystent`, `start`) na stanach z `createEconomy`;
  - `can` dla `start` (pauza, brak palet);
  - każdy `target` ma `data-tut="…"` w źródłach `src/ui/**`;
  - kroki [$] pochodzą z `MONEY_STEPS`;
  - teksty bez zakazanych słów;
  - ostatni krok to `pomoc` z celem `help`.
- [ ] Implementacja: `TourCtx`, `TourMark`, `TourStep`, `buildTour`, `markOf`, teksty ze stałych; `PRESTIGE_LEVEL` i `PRESTIGE_REMONT` w `src/game/meta.ts`.

### Zadanie S4: dymki „pierwszy raz” (`tips.ts`)
- [ ] Testy (`tips.test.ts`):
  - każdy warunek z §5 na prawdziwym stanie (cel gotowy, paleta w przejściu, karta po przewinięciu minut, raport z wyciągiem, protokół remanentu);
  - kolejność;
  - pominięcie `seen`;
  - `tips: false`;
  - brak dymków przy widocznej warstwie przelotu i pod oknem wyboru;
  - dymek „w oknie” przy otwartym oknie, a zwykły nie;
  - cel zastępczy przy zakładce.
- [ ] Implementacja: `TIPS`, `MONEY_TIPS` (w `money.ts`), `tipsFor(ctx, memory)`, stan pokazanego dymku (`shownTip`, `settleTips`, `dismissTip`).

### Zadanie S5: słowniczek i „Jak grać”
- [ ] Testy (`glossary.test.ts`, `HowTo.test.tsx`):
  - dziewięć haseł właściciela;
  - rozwinięcie ZUS;
  - liczby ze stałych;
  - bez „opłata franczyzowa”, „do oddania” i procentu limitu ubytków;
  - sekcja „Słowniczek” w oknie (`<details>` z `<dl>`);
  - stopka „Samouczek” i „Zaczynamy”.
- [ ] Implementacja: `src/ui/howto/glossary.ts`, `HowTo.tsx`.

### Zadanie S6: okno wyboru, stan i powłoka
- [ ] Testy:
  - `state.test.ts`: `offerTutorial` tylko przy `tour === null`; `tutorialOffer` w `isWindowOpen`; testy dymków pierwszego dnia usunięte;
  - `actions.test.ts`: nowy zwykły sklep z ekranu startowego i z ⚙ daje okno wyboru, a nie „Jak grać”; sklep z zapisu i bieg rankingowy go nie dają; przy `tour !== null` okna nie ma; przeładowanie na 6:00 bez klientów daje je znowu; `enterRanked` zamyka okno;
  - `services.test.ts`: bez `firstDayHints`.
- [ ] Implementacja: `state.ts` (bez `hints`), `actions.ts`, `main.ts` (bez `FIRST_DAY_HINTS`, bez `openHowTo` w `onStarted`, `blocked` z przelotem), `overlays.tsx` (bez `FIRST_DAY_HINTS` i `FirstDayHints`), `App.tsx`, `ui.css` (bez `.tt-hintbubble*`).

### Zadanie S7: przelot (`tour.ts`)
- [ ] Testy (`tour.test.ts`):
  - `requestTour` w biegu rankingowym daje toast i nic więcej;
  - start pauzuje i zapamiętuje prędkość;
  - `nextStep` ustawia zakładkę i zaznaczenie z kroku;
  - krok 15 zdejmuje pauzę (`saved` albo ×1);
  - „Pomiń” przed krokiem 15 przywraca `saved`;
  - koniec zapisuje `done`;
  - zadanie zaliczone przechodzi dalej po 0,7 s (sztuczne zegary);
  - wstrzymanie przy oknie gry nie zmienia kroku;
  - `tourActive`.
- [ ] Implementacja: sygnał `tour`, `bindTourControls`, `requestTour`, `nextStep`, `skipTour`, `finishTour`, `syncTour`, `tourSuspended`, `tourActive`.

### Zadanie S8: komponenty, style i atrybuty
- [ ] Testy (`Tutorial.test.tsx`, dopisane do `panels.test.tsx` i `overlays.test.tsx`):
  - okno wyboru: teksty, przyciski, pamięć;
  - `Bubble`: licznik, „Dalej”, „Pomiń”, wiersz zadania, brak „Dalej” w aktywnym zadaniu, „Zakończ”;
  - `TipBubble`: „OK”;
  - ⚙: „Samouczek” i pole podpowiedzi;
  - atrybuty `data-tut` na elementach z §11.1;
  - `TutorialHost` w drzewie `App`.
- [ ] Implementacja: `Tutorial.tsx`, `tutorial.css`, `App.tsx`, atrybuty w `Hud.tsx`, `panels.tsx`, `overlays.tsx`, `cards.tsx`, `spend.tsx`, `statement.tsx`.

### Zadanie S9: smoke, README, raport, PR
- [ ] `scripts/tutorial-smoke.mjs`: scenariusze 1–8 z §13 specu, oba rozmiary, zrzuty JPEG do `docs/superpowers/reports/2026-10-30-samouczek/`, sprawdzanie dymek ∩ cel, konsola i sieć.
- [ ] README: zdanie o samouczku i słowniczku.
- [ ] Bramki: `npm test`, `npm run build`, `npm run check:vercel-build`.
- [ ] Raport `docs/superpowers/reports/2026-10-30-samouczek.md`: gałąź, wyniki komend, zrzuty, lista miejsc w `money.ts` do zmiany przy kolejnej ekonomii.
- [ ] Push `claude/samouczek` i PR do `main` (bez scalania).

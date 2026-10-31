# Samouczek: raport

Data: 2026-10-30/31 · Gałąź: **`claude/samouczek`** (od `main` 14541c8, SIM 6) · Spec: `docs/superpowers/specs/2026-10-30-samouczek-design.md` (zaakceptowany przez właściciela 2026-10-30) · Plan: `docs/superpowers/plans/2026-10-30-samouczek.md`

Samouczek jest wyłącznie warstwą widoku. `git diff origin/main -- src/sim src/server/judgeBundle.js` jest pusty, a `SIM_VERSION` (6) i `GOLDEN[6]` zostały bez zmian. Samouczek nie wysyła poleceń gry (`dispatch`), czego pilnuje test źródeł.

## 1. Stan na koniec

| Sprawdzenie | Wynik |
|---|---|
| `npm test` | 159 plików zielonych, 1 czerwony, 5 pominiętych; 4681 testów zielonych, **1 czerwony**, 7 pominiętych |
| ten jeden czerwony | `src/sim/economy/exactMath.test.ts` („FINE_PALLET_POW to n ** 1.4 co do bitu”). Pada tak samo na czystym `main` 14541c8 w tym kontenerze (Node 22.22: ostatni bit `n ** 1.4`). To test symulacji, której samouczek nie dotyka. CI na GitHubie biegnie na Node 24, jak Vercel. |
| `npx tsc --noEmit` | 0 błędów |
| `npm run build` | przechodzi (bundle sędziego 221,4 KB, `tsc`, `vite build`) |
| `npm run check:vercel-build` | **PASS** (25 sprawdzeń); odtworzenie 3 miesięcy w funkcji: zimny start 1143 ms, mediana ciepłych 970 ms |
| Smoke headless (`node scripts/tutorial-smoke.mjs`) | **przechodzi**: 0 niezaliczonych sprawdzeń, 0 `console.error`, 0 `pageerror`, 0 zapytań poza localhost, 0 zapytań do `/api/runs` (§3) |

## 2. Co weszło

**Przepływ:**
- Po ekranie „Twój kasjer” zupełnie nowy zwykły sklep dostaje okno „Pierwszy dzień w Traszce” z przyciskami „Samouczek (ok. 3 min)” i „Pomiń, znam grę”. Okno zastępuje samo otwierające się „Jak grać” i sześć dymków `FIRST_DAY_HINTS` (usunięte razem z mechanizmem w `state.ts`).
- Okno wstaje tylko wtedy, gdy gracz jeszcze nigdy na nie nie odpowiedział (`traszka:tutorial`). Wstaje też po przeładowaniu przy otwartym oknie, bo sklep stoi wtedy na 6:00 bez klientów.
- Start rankingowy niczego nie otwiera (decyzja właściciela).

**Przelot:**
- 16 kroków (15 przy zamówieniu ręcznym) w prawdziwym sklepie, w stylu B: przygaszenie, pierścień, dymek ze strzałką, licznik, „Dalej”, „Pomiń”, Esc.
- Zadania gracza: otwórz Palety, przełącz zamówienie na „Ręcznie” i z powrotem, stuknij 📦.
- Czas stoi na pauzie (`controls.setSpeed(0)`). Przedostatni krok zdejmuje pauzę, bo w pauzie 📦 jest wyłączony. Ostatni krok wskazuje „?” (decyzja właściciela).
- Okno gry w trakcie (np. karta o 7:00) wstrzymuje przelot, a po jego zamknięciu przelot wraca do tego samego kroku.

**Dymki „pierwszy raz”:** cel do odebrania, palety w przejściach, pierwsza karta, pierwszy wyciąg od Centrali, pierwszy remanent. Każdy pokazuje się raz, działa też w rankingu, a w ⚙ można je wyłączyć polem „Podpowiedzi przy pierwszych zdarzeniach”.

**Słowniczek** w „Jak grać”: saldo u Centrali, przelew, wyciąg, raty, remanent, ubytki, „Zostaje Ci”, ZUS (z rozwinięciem), księgowa. Liczby pochodzą ze stałych. Słowniczek nie mówi o opłacie franczyzowej ani o „Do oddania” i nie zdradza limitu ubytków przed pierwszym remanentem.

**Ponowne uruchomienie:** przycisk „Samouczek” w „Jak grać” i w ⚙. W biegu rankingowym daje tylko komunikat „Samouczek działa w zwykłym sklepie.”.

**Pliki:**
- **Nowe:** `src/ui/tutorial/` (`layout.ts`, `memory.ts`, `steps.ts`, `money.ts`, `tips.ts`, `tour.ts`, `Tutorial.tsx`, `tutorial.css`, testy), `src/ui/howto/glossary.ts`, `scripts/tutorial-smoke.mjs`.
- **Zmienione:** `state.ts`, `actions.ts`, `main.ts`, `App.tsx`, `HowTo.tsx`, `overlays.tsx`, `meta.ts` (stałe `PRESTIGE_LEVEL` i `PRESTIGE_REMONT`, wartości bez zmian) i `README.md`.
- **Tylko atrybuty `data-tut`:** `Hud.tsx` (pasek pieniędzy), `panels.tsx`, `cards.tsx`, `spend.tsx`, `statement.tsx`.

## 3. Smoke headless

`npm run build`, potem `node scripts/tutorial-smoke.mjs`:
- **Środowisko:** `vite preview` lokalnie w kontenerze, Chromium (Playwright z globalnej instalacji kontenera), swiftshader, `?q=niska`.
- **Rozmiary:** 390×844 z dotykiem i 1280×800.
- **Sieć:** wszystko poza localhost jest blokowane i liczone.
- **Czas:** cały przebieg trwał 21,5 min. Swiftshader rysuje scenę na procesorze, ok. 2 klatek na sekundę.

| Scenariusz | Telefon 390×844 | Desktop 1280×800 |
|---|---|---|
| 1. okno wyboru → „Samouczek” → wszystkie kroki | 16/16; dymek nie przecina celu w żadnym kroku, bez `covers`, w oknie | 16/16; tak samo |
| strony dymka | pasek: pod; zakładki i kliker: nad; arkusz i elementy w nim: nad arkuszem | pasek: pod; zakładki i kliker: nad; panel i elementy w nim: po lewej panelu |
| 2. po „Zakończ” | `tour: "done"`, czas ×1, warstwa znika | tak samo |
| 3. „?” → „Jak grać” → „Samouczek” → „Pomiń” | krok 1, pauza w trakcie, po „Pomiń” znowu ×1 | tak samo |
| 4. ⚙ → „Samouczek” → „Pomiń” | jak wyżej | jak wyżej |
| 5. „Pomiń, znam grę” | bez przelotu, `tour: "skipped"`, ×1 | tak samo |
| 6. dymek przy pierwszej karcie | nad kartą (karta na 60dvh), bez przecięcia | nad kartą |
| 6. dymek przy pierwszym wyciągu | nad wierszem „Zostaje Ci”, bez przecięcia | tak samo |
| 7. start rankingowy | bez okna wyboru, bez „Jak grać”; „Samouczek” daje komunikat | tak samo |
| 8. słowniczek | 9 haseł | 9 haseł |

Zrzuty (JPEG, jakość 80, razem 3,9 MB) i wyniki maszynowe (`smoke.json`) leżą w `docs/superpowers/reports/2026-10-30-samouczek/`:
- `{telefon,desktop}-00-okno-wyboru.jpg`;
- `-01-cel` … `-16-pomoc` (cały przelot);
- `-30-slowniczek`;
- `-41-ponownie-jak-grac`, `-42-ponownie-ustawienia`;
- `-50-pominiete`;
- `-60-dymek-karta`, `-61-dymek-wyciag`;
- `-70-ranking-komunikat`.

**Błędy znalezione przez smoke i poprawione przed tym przebiegiem:**
- Pierwszy pomiar robił się na dymku bez wiersza zadania. Dymek potem rósł, więc przez klatkę zachodził na zakładki.
- Ogólna reguła `.tt-btn:hover` z `ui.css` rozjaśniała „Dalej” pod kursorem do bieli na kremowym tle.

## 4. Kroki o pieniądzach (lista do poprawy po SIM 6)

SIM 6 był już na `main`, zanim powstał kod, więc lista pieniędzy jest od razu napisana pod trzy kieszenie. **Po wejściu SIM 6 nic nie czeka na poprawę.** Wszystko, co samouczek mówi o pieniądzach, leży w `src/ui/tutorial/money.ts`. Przy następnej zmianie ekonomii przepisuje się tylko ten plik i atrybuty `data-tut`:

| Element | Gdzie | Wskazuje (`data-tut`) | Co mówi |
|---|---|---|---|
| krok 2 `gotowka` | `moneySteps()` | `cash` (`Hud.tsx`) | gotówka na zakupy, rekrutację i mandaty; progi −50 000 / −100 000 zł |
| krok 3 `saldo` | `moneySteps()` | `saldo` (pierwsze pole `ForecastChip`) | saldo u Centrali: marża i premie, nie do wydania, przychodzi przelewem |
| krok 4 `zostanie` | `moneySteps()` | `due` (wiersz `ForecastChip`) | raty i palety z przelewu, Twoje koszty (pensje, media, ZUS, VAT, księgowa), „Zostaje Ci” |
| krok 5 `zaufanie` | `moneySteps()` | `trust` | premia od obrotu i limit rat, zero na koniec miesiąca kończy umowę |
| zdanie w kroku 10 | `MONEY_NOTES.palety` | — | nadmiar się przeterminuje, rachunek przy remanencie |
| zdanie w kroku 11 | `MONEY_NOTES.ludzie` | — | rekrutacja `HIRE_COST` z gotówki, `WAGE_PER_DAY` przy zamknięciu |
| zdanie w kroku 12 | `MONEY_NOTES.ulepszenia` (cel `buy` w `spend.tsx`) | `buy` | gotówka albo raty, za gotówkę taniej |
| zdanie w kroku 13 | `MONEY_NOTES.kpi` | — | premia na saldo i zaufanie |
| dymek `tip-wyciag` | `MONEY_TIPS` | `zostaje-ci` (`statement.tsx`), zapas `report` | przelew − potrącenia − koszty = „Zostaje Ci” |
| dymek `tip-remanent` | `MONEY_TIPS` | `remanent-verdict` (protokół w `overlays.tsx`) | co 3 miesiące ubytki, ponad limit z przelewu |

Słowniczek (`src/ui/howto/glossary.ts`) bierze liczby ze stałych (`GUARANTEE`, `INSTALLMENTS`, `REMANENT`, `OWN_COSTS`), więc zmiana stawek go nie rozjedzie. Zmiana pojęć wymaga jego przepisania.

## 5. Ograniczenia i uwagi

- **Remanent w smoke.** `tip-remanent` sprawdzają tylko testy jednostkowe. Pierwszy remanent wypada 90. dnia gry, a smoke przewija tylko do pierwszego wyciągu.
- **Telefon poziomo.** Nie jest mierzony (spec, §11): nad pełnoszerokim arkuszem zostaje ok. 88 px, więc dymek przejdzie w tryb zwarty albo zasłoni treść arkusza (nigdy cel, bo wtedy staje przy samym celu).
- **Dymek karty na desktopie** może przykryć część paska gry (nie cel). Na telefonie karta na czas dymka ma 60dvh wysokości.
- **Pomiar co klatkę.** Warstwy mierzą cel co klatkę tylko wtedy, gdy przelot albo dymek jest na ekranie. Poza tym `TipLayer` liczy kandydatów przy publikacji stanu (co 200 ms) i szuka elementu mniej więcej raz na sekundę.
- **README** opisywał jeszcze opłatę franczyzową i stare zasady upadku. Akapit „Jak grać” jest teraz zgodny z SIM 6 i wspomina samouczek i słowniczek.
- **Raport SIM 6.** Raportu `docs/superpowers/reports/2026-10-30-trzy-kieszenie.md` nie ma na `main` 14541c8. Teksty samouczka oparłem na specu SIM 6 (`docs/superpowers/specs/2026-10-30-prawdziwy-model-rozliczen-design.md`) i kodzie.

# Traszka Tycoon: roadmapa prac i podział na modele

**Spec:** `docs/superpowers/specs/2026-10-27-traszka-tycoon-design.md`
**Szczegółowy plan etapu 1:** `docs/superpowers/plans/2026-10-27-etap-1-wycinek-wygladu.md`

## Dlaczego szczegółowy plan jest tylko dla etapu 1

Spec obejmuje pięć podsystemów. Etapy 2–5 zależą od tego, co pokaże etap 1: wybranej paczki postaci, budżetu wydajności i kształtu typów `StoreLayout` i `Crowd`. Szczegółowe kroki TDD dla nich teraz byłyby zgadywaniem. Dlatego:
- etap 1 ma pełny plan krok po kroku,
- etapy 2–5 mają tu listę zadań z modelem, zależnościami i kryterium „zrobione”,
- szczegółowy plan etapu 2 powstaje, gdy ruszy wykonanie etapu 1. Etap 2 to czysta symulacja, więc może iść równolegle w czasie bramy wyglądu.

## Zasady przydziału modeli

| Model | Kiedy | Przykłady |
|---|---|---|
| **Haiku** | Zadania z jednoznaczną specyfikacją i testem wzorcowym, dane i treści, konfiguracja | szkielet projektu, PRNG z wartościami wzorcowymi, katalogi produktów i zdarzeń w JSON, panele UI bez logiki |
| **Sonnet** | Większość implementacji: logika z testami, generatory, systemy symulacji, render według gotowego stylu, UI z logiką | generator sklepu, A*, tłum, meble proceduralne, ekonomia, zapis gry |
| **Opus** | Decyzje, których test nie rozstrzygnie: styl i wygląd, architektura przekrojowa, balans, przeglądy etapów | `style.ts`, art pass, wybór paczki postaci, balans ekonomii, przegląd całej gałęzi na koniec etapu |

**Przeglądy:**
- Każde zadanie po implementacji sprawdza świeży recenzent na **Sonnecie**: zgodność ze specem i jakość kodu.
- Na koniec każdego etapu całą gałąź sprawdza **Opus**.

**Eskalacja:** dwie nieudane próby na Haiku przechodzą na Sonnet, a dwie nieudane na Sonnecie przechodzą na Opus.

**Szacowany podział zadań:** Haiku ~25%, Sonnet ~65%, Opus ~10%. Opus zostaje tam, gdzie jego ocena zmienia wynik.

**Twój wkład (tryb nauki, opcjonalnie):** zadania oznaczone 🧑‍💻 mają miejsce na 5–10 linii Twojego kodu w kluczowej regule gry. Plan przygotuje sygnaturę, testy i TODO.

## Etap 1: fundament i pionowy wycinek wyglądu (plan szczegółowy)

17 zadań: Haiku 4, Sonnet 10, Opus 3. Kończy się **twardą bramą**: akceptujesz wygląd, zanim ruszy reszta grafiki.

| # | Zadanie | Model | Zależy od |
|---|---|---|---|
| 1 | Szkielet projektu (Vite, TS, Vitest, Preact, three) + test architektury | Haiku | — |
| 2 | PRNG (xmur3 + sfc32) z wartościami wzorcowymi | Haiku | 1 |
| 3 | Typy sklepu, siatka, A*, walidacja układu | Sonnet | 2 |
| 4 | Generator sklepu z seeda + złote seedy | Sonnet | 3 |
| 5 | Tłum demonstracyjny (wejście, półki, kolejka, wyjście) | Sonnet | 4 |
| 6 | Styl wizualny w kodzie (`style.ts`) + krótki przewodnik | **Opus** | 1 |
| 7 | Renderer, kamera izometryczna, presety jakości, postprocessing | Sonnet | 6 |
| 8 | Bryła sklepu i meble proceduralne | Sonnet | 4, 7 |
| 9 | Towar na półkach (instancjonowany) | Sonnet | 8 |
| 10 | Pozyskanie assetów CC0 + pipeline gltf-transform (**wymaga Twojej zgody na pobranie**) | Haiku | 1 |
| 11 | Postacie: fabryka, wygląd z seeda, animacje, zastępstwo przy błędzie | Sonnet | 6, 10 |
| 12 | Ulica i otoczenie (chodnik, jezdnia, blok/kamienica/pawilon, drzewa, latarnie, dostawczak) | Sonnet | 7, 10 |
| 13 | Pętla gry (stały krok, prędkości) + połączenie tłumu z renderem | Sonnet | 5, 11 |
| 14 | Powłoka UI (seed, jakość, prędkość, obrót kamery, dzień/noc, wydajność) | Haiku | 13 |
| 15 | Benchmark (`?bench=1`, 60 postaci, wszystkie presety) | Sonnet | 13 |
| 16 | Art pass: światło, kolory, materiały, postacie à la Two Point, noc z neonem | **Opus** | 9, 12, 13, 15 |
| 17 | Przegląd etapu + pokaz dla Ciebie (brama) | **Opus** + Ty | 16 |

Ścieżki równoległe: symulacja (2→3→4→5), styl i render (6→7→8→9, 12), assety (10→11). Łączą się w zadaniu 13.

## Etap 2: pętla jednego sklepu

Rdzeń `sim/` może ruszyć w czasie bramy etapu 1. Zadania renderu i UI czekają na akceptację wyglądu.

| # | Zadanie | Model | Zrobione, gdy |
|---|---|---|---|
| 2.1 | Zegar i kalendarz: doba 60 s przy ×1, otwarcie 6:00–23:00, start 1 września, niedziele niehandlowe | Sonnet | testy kalendarza (niedziele, koniec miesiąca, zmiana roku) |
| 2.2 | Katalog kategorii i produktów: marże 5/10/15%+, popyt bazowy, termin, parodie nazw (JSON) | Haiku | walidacja schematu, brak prawdziwych marek (lista zakazanych słów w teście) |
| 2.3 | Zapasy: półka/zaplecze, planogram (kategoria → odcinek półki, strefa przy kasie), wykładanie | Sonnet | testy sprzedaży utraconej przy pustej półce i bonusu strefy impulsowej |
| 2.4 | Klienci: archetypy (dane: Haiku), spawn z krzywej dobowej, lista zakupów, cierpliwość, wyjście bez zakupów | Sonnet | test, że korek obniża cierpliwość i obrót |
| 2.5 | Kasa, kolejka, kasa samoobsługowa (archetypy jej unikają, „zapominanie” skanu) | Sonnet | test przepustowości kolejki przy 1 i 2 kasach |
| 2.6 | Personel: zadania, suwak priorytetów kasa ↔ palety, franczyzobiorca na sali ze zmęczeniem, grafik 17 h 🧑‍💻 (funkcja wyboru zadania) | Sonnet | testy przydziału zadań |
| 2.7 | Zamówienia CyberTraszka do 11:00 (asystent przesadza 🧑‍💻), dostawy, palety jako obiekty, rozładunek, straż miejska, odesłanie dostawy | Sonnet | testy kuli śnieżnej palet i ryzyka mandatu |
| 2.8 | Ekonomia miesiąca: marże, premie, koszty, opłata franczyzowa, WUT, limit kredytu, raport | Sonnet | testy rachunku na danych wzorcowych |
| 2.9 | Komendy gracza, zapis pełnego stanu z wersją, autosave, eksport/import | Sonnet | test zapis → odczyt → identyczny przebieg 1000 kroków |
| 2.10 | Render: przeciąganie palet, sloty sprzętu, dymki klientów | Sonnet | sprawdzenie w przeglądarce + zrzuty |
| 2.11 | UI: HUD ze szkicu, zakładki Dostawy / Półki / Ludzie, raport miesięczny | Sonnet (logika) / Haiku (panele statyczne) | sprawdzenie w przeglądarce |
| 2.12 | Przegląd etapu + pierwsza gra 20 minut | **Opus** | raport z grania, lista poprawek balansu |

## Etap 3: smak i treść

| # | Zadanie | Model |
|---|---|---|
| 3.1 | Silnik zdarzeń: karty, wybory, warunki, skutki, wyzwalacze kalendarzowe | Sonnet |
| 3.2 | Treść: talia zdarzeń z §11, komunikaty Centrali, radio sklepowe, nazwy produktów | Haiku (pisanie) → Opus (przegląd tonu) |
| 3.3 | Zaufanie Centrali, audyty, tajemniczy klient, programy refundacyjne WUT | Sonnet |
| 3.4 | Produkty wiralowe: dropy, przydział (zaufanie + Ogonki), krzywa hype'u 🧑‍💻, „polowanie” | Sonnet |
| 3.5 | Ogonki i giełda: kurs z pędem i skokami, prowizja, limit, reset 31.12 | Sonnet |
| 3.6 | Upgrade'y (dane: Haiku) i remont generalny (zamknięcie, regeneracja układu z większym budżetem) | Sonnet |
| 3.7 | Codzienność: FEFO i przecena o 18:00, glitch kasowy, niedziela „placówka pocztowa”, sejf | Sonnet |
| 3.8 | Emocje postaci w stylu Two Point (zniecierpliwienie, radość, złość) + dymki | Sonnet → Opus (art) |
| 3.9 | Przegląd etapu | **Opus** |

## Etap 4: miasto i ekspansja

| # | Zadanie | Model |
|---|---|---|
| 4.1 | Generator miasta: kwartały, dzielnice, ulice, lokale, punkty ruchu (szkic algorytmu: Opus) | Sonnet |
| 4.2 | Mapa natężenia ruchu z profilami godzinowymi | Sonnet |
| 4.3 | Budynki proceduralne: blok, kamienica, pawilon, atlas w canvasie, batching, chunki | Sonnet → Opus (art) |
| 4.4 | Render miasta: drogi, drzewa, auta, tłum (VAT/instancing) | Sonnet |
| 4.5 | Analizy (płatne warstwy mapy), wynajem, odkup i przejęcie lokali, budowa | Sonnet |
| 4.6 | Wiele sklepów: przełączanie ekranów, statystyczna symulacja nieaktywnych, kierownik | Sonnet |
| 4.7 | AI konkurencji, kanibalizacja Centrali, udział w rynku, wygrana i przegrana, rozliczenie końcowe | Sonnet → Opus (balans) |
| 4.8 | Nowe formaty w generatorze: okienko, flagowiec, Nanoo | Sonnet |
| 4.9 | Przegląd etapu | **Opus** |

## Etap 5: szlif i publikacja

| # | Zadanie | Model |
|---|---|---|
| 5.1 | Harness bez renderu: 200 seedów × 6 miesięcy, krzywe zysku | Sonnet |
| 5.2 | Balans ekonomii i tempa (pierwsze 20 minut, drugi sklep po 45–60 min) | **Opus** |
| 5.3 | Onboarding pierwszych 20 minut | Sonnet + Haiku (teksty) |
| 5.4 | Dźwięki CC0, pełny cykl dnia i nocy, efekty | Sonnet |
| 5.5 | Wydajność i presety na sprzęcie bazowym | Sonnet → Opus (przegląd) |
| 5.6 | Przegląd treści przed publikacją: zastrzeżenie, nazwy, ton | **Opus** |
| 5.7 | Wdrożenie statyczne (**wymaga Twojej zgody**) | Haiku |

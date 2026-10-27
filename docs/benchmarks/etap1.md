# Benchmark etapu 1

**Status: szablon.** Liczby wpisuje się po uruchomieniu na sprzęcie docelowym (Mac gracza). Pola `—` są puste celowo:
tu nie ma ani jednej wartości z biegu próbnego.

Kryterium z planu: preset **Średnia** daje średnio **≥ 55 FPS** przy 60 postaciach. Jeśli tak nie jest, ta strona ma
mówić, co zjada czas (AO, cienie, skórkowanie), i oddać sprawę do zadania 16.

## Jak uruchomić

1. `npm run build && npm run preview` (serwer na `http://localhost:4173`).
2. Otwórz `http://localhost:4173/?bench=1` w oknie przeglądarki na wierzchu, w docelowym rozmiarze (np. na cały ekran),
   przy podłączonym zasilaczu i bez innych ciężkich programów. Karta w tle zatrzymuje `requestAnimationFrame`, więc okno ma
   być widoczne przez cały bieg.
3. Bieg trwa około 2 minut (najwyżej 3). Nakładka w lewym dolnym rogu pokazuje postęp; na końcu pisze „Gotowe.” i podaje
   obie tabele. Nie dotykaj myszy ani klawiatury: sterowanie jest w tym trybie wyłączone, ale zasłonięcie okna psuje wynik.
4. Wyniki odczytasz z konsoli (`console.table`) albo z obiektów na stronie:
   - `window.__benchResult`: `{ preset, avgFps, p95FrameMs, calls, tris }[]` (tabela główna),
   - `window.__benchExtra`: środowisko (GPU, rozmiar okna, `devicePixelRatio`), próby, ostrzeżenia.
   Całość w jednym kawałku: `copy(JSON.stringify({ result: __benchResult, extra: __benchExtra }, null, 1))`.

Próbny bieg, który tylko sprawdza, że całość się kończy: `?bench=1&quick=1` (około 40 s). Liczby z niego niczego nie
mówią i nie wchodzą do tej strony.

## Co mierzy bieg

- Seed `bench`, tłum `targetCount 60`, `spawnPerMinute 1200` (napełnia sklep w kilkanaście sekund), prędkość ×1, dzień,
  kamera domyślna (yaw 0, zoom 14 m, cały sklep w kadrze), zwykła ścieżka rysowania gry (ten sam composer i
  postprocessing). Parametry `seed`, `yaw`, `zoom`, `night`, `ext` są w tym trybie ignorowane.
- Przed pierwszym presetem sklep jest raz napełniany (do 55 postaci, najwyżej 30 s). Potem dla każdego presetu po kolei
  (`niska`, `srednia`, `wysoka`): dopełnienie tłumu do ≥ 55 postaci (najwyżej 15 s), 5 s rozgrzewki, 20 s pomiaru.
- `avgFps` = liczba klatek / czas, z odstępów między klatkami `requestAnimationFrame`. `p95FrameMs` = 95. percentyl tych
  odstępów. `calls` i `tris` to średnia z klatki z `renderer.info.render`, czyli ze wszystkich przebiegów (cienie, AO,
  postprocessing).
- **Limit ekranu.** `requestAnimationFrame` idzie za odświeżaniem ekranu. Na 60 Hz nic nie przekroczy 60 FPS, na 120 Hz
  100 FPS jest możliwe. Gdy preset stoi na limicie, `avgFps` mówi tylko „mieści się”, a o zapasie mówi `JS ms` z prób
  (poniżej) i `p95FrameMs`.
- **Próby** (po pomiarze każdego presetu: 1 s ustalania, potem 4 s pomiaru; każda zmienia jedną rzecz):
  - `charShadowsOff`: postacie nie rzucają cienia (o tyle mniej wywołań rysowania, ile postaci w kadrze),
  - `crowdHidden` (tylko `srednia`): tłum niewidoczny. Różnica to cały koszt rysowania postaci: skórkowanie, przebieg
    główny i cień. Animacje po stronie CPU działają dalej, więc ich koszt zostaje w `JS ms`,
  - `aoOff` (tylko `srednia`): ten sam preset bez AO.
  `JS ms` to średni czas pracy wątku JS w klatce (symulacja, animacje, przygotowanie i wysłanie rysowania), bez czekania
  na GPU.

## Środowisko

| Pole | Wartość |
|---|---|
| Data | — |
| Commit | — |
| Maszyna (model, pamięć) | — |
| GPU (`__benchExtra.env.gpu`) | — |
| System | — |
| Przeglądarka i wersja | — |
| Okno (px) i `devicePixelRatio` | — |
| Odświeżanie ekranu (Hz) | — |
| Zasilanie | — |

## Wyniki

Oczekiwanie z kodu: każda postać to jeden `SkinnedMesh`, czyli 1 wywołanie w przebiegu głównym i 1 w cieniu, więc przy
60 postaciach liczba wywołań ma być blisko albo powyżej 300 (to nie błąd).

| Preset | avgFps | p95FrameMs | calls | tris |
|---|---|---|---|---|
| niska | — | — | — | — |
| srednia | — | — | — | — |
| wysoka | — | — | — | — |

**Kryterium `srednia.avgFps ≥ 55`:** — (spełnione / niespełnione)

Ostrzeżenia z biegu (`__benchExtra.warnings`): —

## Próby

| Preset | Próba | avgFps | p95FrameMs | calls | tris | JS ms |
|---|---|---|---|---|---|---|
| niska | charShadowsOff | — | — | — | — | — |
| srednia | charShadowsOff | — | — | — | — | — |
| srednia | crowdHidden | — | — | — | — | — |
| srednia | aoOff | — | — | — | — | — |
| wysoka | charShadowsOff | — | — | — | — | — |

## Co zjada czas

Wypełnić po biegu. Różnice liczy się względem wiersza głównego tego samego presetu (`srednia`).

| Składnik | Jak liczony | Δ wywołań | Δ trójkątów | Δ FPS | Δ JS ms |
|---|---|---|---|---|---|
| Cienie postaci | `srednia` − `srednia/charShadowsOff` | — | — | — | — |
| Postacie razem (skórkowanie, przebieg główny, cień) | `srednia` − `srednia/crowdHidden` | — | — | — | — |
| AO | `srednia` − `srednia/aoOff` | — | — | — | — |

Wniosek (jedno zdanie na składnik: AO, cienie, skórkowanie, reszta sceny): —

Gdy `srednia.avgFps < 55`: największy składnik i propozycja dla zadania 16 (np. mniej wywołań przez scalenie postaci,
tańszy cień postaci, AO w niższej jakości): —

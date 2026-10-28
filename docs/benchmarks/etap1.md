# Benchmark etapu 1

**Status: pierwszy bieg 2026-10-27 na Macu użytkownika (Apple M5).** To sprzęt dużo mocniejszy niż docelowe minimum
ze specu (M1 / Iris Xe), więc FPS mówi tu tylko „mieści się z zapasem”; o kosztach mówią wywołania, trójkąty i `JS ms`.

Kryterium z planu: preset **Średnia** daje średnio **≥ 55 FPS** przy 60 postaciach. Jeśli tak nie jest, ta strona ma
mówić, co zjada czas (AO, cienie, skórkowanie), i oddać sprawę do zadania 16.

## Jak uruchomić

1. `npm run build && npm run preview` (serwer na `http://localhost:4173`).
2. Otwórz `http://localhost:4173/?bench=1` w oknie przeglądarki na wierzchu, w docelowym rozmiarze (np. na cały ekran),
   przy podłączonym zasilaczu i bez innych ciężkich programów. Karta w tle zatrzymuje `requestAnimationFrame`, więc okno ma
   być widoczne przez cały bieg.
3. Bieg trwa około 2 minut (najwyżej około 3,5). Nakładka w lewym dolnym rogu pokazuje postęp; na końcu pisze „Gotowe.” i podaje
   obie tabele. Nie dotykaj myszy ani klawiatury: sterowanie jest w tym trybie wyłączone, ale zasłonięcie okna psuje wynik.
4. Wyniki odczytasz z konsoli (`console.table`) albo z obiektów na stronie:
   - `window.__benchResult`: `{ preset, avgFps, p95FrameMs, calls, tris }[]` (tabela główna),
   - `window.__benchExtra`: środowisko (GPU, rozmiar okna, `devicePixelRatio`), próby, ostrzeżenia.
   Całość w jednym kawałku: `copy(JSON.stringify({ result: __benchResult, extra: __benchExtra }, null, 1))`.

Próbny bieg, który tylko sprawdza, że całość się kończy: `?bench=1&quick=1` (około 35 s). Liczby z niego niczego nie
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
| Data | 2026-10-27 22:27 UTC |
| Commit | 4a963be |
| Maszyna (model, pamięć) | Mac17,2 (Apple M5), 32 GB |
| GPU (`__benchExtra.env.gpu`) | ANGLE (Apple, ANGLE Metal Renderer: Apple M5) |
| System | macOS 26.5 |
| Przeglądarka i wersja | Chrome 156 (Playwright, okno widoczne) |
| Okno (px) i `devicePixelRatio` | 1200 × 672, DPR 2 |
| Odświeżanie ekranu (Hz) | 120 |
| Zasilanie | zasilacz (bateria 100%) |

## Wyniki

Oczekiwanie z kodu: każda postać to jeden `SkinnedMesh`, czyli 1 wywołanie w przebiegu głównym i 1 w cieniu, więc przy
60 postaciach liczba wywołań ma być blisko albo powyżej 300 (to nie błąd).

| Preset | avgFps | p95FrameMs | calls | tris |
|---|---|---|---|---|
| niska | 120,0 | 8,9 | 287 | 912 418 |
| srednia | 120,0 | 8,8 | 316 | 915 095 |
| wysoka | 116,9 | 9,2 | 315 | 914 383 |

**Kryterium `srednia.avgFps ≥ 55`:** spełnione (120 FPS, limit ekranu). Na M5 nie mówi to nic o M1 / Iris Xe.

Ostrzeżenia z biegu (`__benchExtra.warnings`): brak. Każdy preset mierzony przy 60 postaciach. Ciągłość pomiaru:
2399 / 2399 / 2338 klatek w 20 s, najdłuższa klatka 9,4 / 9,4 / 17,6 ms, więc bieg nie miał przerw.

**Budżet 300 wywołań:** przekroczony przy 60 postaciach na `srednia` (316) i `wysoka` (315); spełniony na `niska`
(287) i w zwykłej grze (12 klientów, ~230). Sprawa dla zadania 16, patrz niżej.

## Próby

| Preset | Próba | avgFps | p95FrameMs | calls | tris | JS ms |
|---|---|---|---|---|---|---|
| niska | charShadowsOff | 120,0 | 8,9 | 227 | 740 174 | 2,3 |
| srednia | charShadowsOff | 120,0 | 8,8 | 256 | 742 303 | 3,5 |
| srednia | crowdHidden | 120,0 | 8,7 | 196 | 570 223 | 2,6 |
| srednia | aoOff | 120,0 | 8,9 | 303 | 912 106 | 2,5 |
| wysoka | charShadowsOff | 117,5 | 9,2 | 255 | 742 206 | 4,2 |

## Co zjada czas

Wypełnić po biegu. Różnice liczy się względem wiersza głównego tego samego presetu (`srednia`).

| Składnik | Jak liczony | Δ wywołań | Δ trójkątów | Δ FPS | Δ JS ms |
|---|---|---|---|---|---|
| Cienie postaci | `srednia` − `srednia/charShadowsOff` | +60 | +172 792 | 0 (limit) | +0,1 |
| Postacie razem (skórkowanie, przebieg główny, cień) | `srednia` − `srednia/crowdHidden` | +120 | +344 872 | 0 (limit) | +1,0 |
| AO | `srednia` − `srednia/aoOff` | +13 | +2 989 | 0 (limit) | +1,1 |

Wniosek:
- **Cienie postaci** kosztują dokładnie 1 wywołanie na postać (+60) i ~173 tys. trójkątów; to one wypychają `srednia` i
  `wysoka` ponad 300 wywołań (316 / 315). Bez nich jest 256 / 255.
- **Postacie razem** to +120 wywołań i ~345 tys. trójkątów (2 przebiegi × ~2,9 tys. trójkątów × 60), a po stronie CPU
  tylko ~1 ms na klatkę (animacje 60 mikserów).
- **AO** to tylko +13 wywołań, ale +1,1 ms JS na klatkę (przygotowanie przebiegów N8AO); na GPU koszt jest pewnie większy,
  czego `JS ms` nie widzi.
- **Reszta sceny** (sklep, towar, ulica): 196 wywołań i ~570 tys. trójkątów na `srednia`; z tego towar to ~140 tys.
- `JS ms` 2,4 / 3,6 / 4,3 ms na `niska` / `srednia` / `wysoka`: duży zapas do budżetu 16,7 ms przy 60 FPS.

Dla zadania 16 (FPS spełniony, limit 300 wywołań nie przy 60 postaciach na `srednia`/`wysoka`): największy składnik to
cienie postaci. Najtańsza zmiana to jedna instancjonowana plama cienia pod wszystkimi postaciami (1 wywołanie zamiast 60),
co daje ~257 wywołań przy 60 postaciach; prawdziwe cienie mogą zostać tylko na `wysoka`. W zwykłej grze (12 klientów)
wywołań jest ~230, więc to dotyczy tylko ciasnego sklepu.

## Bieg 2: po art passie (zadanie 16), 2026-10-28

Ten sam Mac (Apple M5, macOS 26.5, Chrome 156 przez Playwright, zasilacz), commit `cd8fc25`. **Inne okno niż w biegu 1:
1400 × 860 przy `devicePixelRatio` 1** (bieg 1: 1200 × 672 przy DPR 2), więc trójkąty i wywołania da się porównać,
a FPS i czasy klatki tylko orientacyjnie. Ostrzeżeń brak; 2400 / 2399 / 2400 klatek w 20 s, najdłuższa klatka 10,3–10,4 ms.

Polityka cieni po zadaniu 16: na `niska` i `srednia` postacie nie rzucają cienia z mapy cieni; pod każdą leży miękka
plama, a wszystkie plamy to jedno instancjonowane wywołanie. Prawdziwe cienie postaci zostały tylko na `wysoka`
(ruling R35). Dlatego próba `charShadowsOff` na `niska` i `srednia` niczego nie zmienia: tak ma być.

| Preset | avgFps | p95FrameMs | calls | tris | JS ms |
|---|---|---|---|---|---|
| niska | 120,0 | 9,7 | 244 | 785 364 | 2,3 |
| srednia | 120,0 | 9,8 | 273 | 787 848 | 3,0 |
| wysoka | 120,0 | 9,8 | 332 | 959 572 | 2,9 |

| Preset | Próba | avgFps | calls | tris | JS ms |
|---|---|---|---|---|---|
| niska | charShadowsOff | 120,0 | 244 | 785 364 | 2,4 |
| srednia | charShadowsOff | 120,0 | 273 | 787 493 | 3,1 |
| srednia | crowdHidden | 120,0 | 212 | 615 293 | 2,5 |
| srednia | aoOff | 120,0 | 260 | 785 216 | 2,2 |
| wysoka | charShadowsOff | 120,0 | 272 | 787 396 | 2,9 |

**Kryterium `srednia.avgFps ≥ 55`:** spełnione (limit ekranu).
**Budżet 300 wywołań przy 60 postaciach:** spełniony na `niska` (244) i `srednia` (273, wcześniej 316); przekroczony
tylko na `wysoka` (332) z wyboru (prawdziwe cienie postaci, R35). W zwykłej grze (12 klientów) wszystkie presety < 300.

Co się zmieniło względem biegu 1 (`srednia`):
- **Postacie:** +61 wywołań (60 + 1 plama) zamiast +120 i ~173 tys. trójkątów mniej, bo nie ma przebiegu cieni postaci.
- **Scena bez tłumu:** 212 wywołań zamiast 196 (+16: hasła na ścianach, tabliczka zaplecza, rekwizyty z napisami,
  plama); trójkąty +45 tys. (podwórko, fazowane gzymsy, drzewa proceduralne, rekwizyty). Tu najpierw ciąć, gdyby
  zabrakło budżetu: rekwizyty w wierszu 0 w jedną siatkę z atlasem i jeden atlas haseł zamiast tekstury na odcinek ściany.
- **AO:** +13 wywołań, jak wcześniej.
- **Otwarte (etap 5):** sześć świateł punktowych wnętrza jest teraz zawsze w shaderach (natężenie 0 w dzień), żeby
  przełączenie na noc nie kompilowało materiałów od nowa. Na M5 tego nie widać (limit ekranu); koszt na pikselu
  trzeba zmierzyć na M1 / Iris Xe (ruling R37).

## Bieg 3: po scaleniu z gałęzią z chmury, 2026-10-28

Commit `cc77e02` (scalona rozgrywka z sesji w chmurze; benchmark nie uruchamia ekonomii, więc mierzy ten sam render).
Okno jak w biegu 1: **1200 × 672 przy DPR 2**. Ostrzeżeń brak; 2399 / 2399 / 1899 klatek w 20 s.

| Preset | avgFps | p95FrameMs | calls | tris | JS ms |
|---|---|---|---|---|---|
| niska | 120,0 | 8,7 | 245 | 786 606 | 2,4 |
| srednia | 120,0 | 8,6 | 274 | 788 141 | 3,7 |
| wysoka | 95,0 | 16,9 | 333 | 960 651 | 5,1 |

Wywołania i trójkąty są takie jak w biegu 2 (±1), więc scalenie nie zmieniło kosztu sceny. `wysoka` przy DPR 2 spadła
z 116,9 FPS (bieg 1, przed art passem, to samo okno) do 95 FPS: renderuje w pełnej rozdzielczości Retiny z pełnym AO,
mapą cieni 4096 i prawdziwymi cieniami postaci. Kryterium (`srednia ≥ 55`) i tak spełnione z dużym zapasem.

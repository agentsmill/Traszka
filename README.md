# Traszka Tycoon

Przeglądarkowa gra ekonomiczna w izometrycznym widoku. Three.js + TypeScript. Działa na komputerze i na telefonie.

Prowadzisz franczyzę sklepu Traszka: rozładowujesz palety, zanim przyjdzie Straż Miejska, pilnujesz kolejki, kupujesz
kasy samoobsługowe i ulepszenia, a remont powiększa sklep. Później warsztat złotej rączki daje automatykę DIY,
a na końcu humanoida eDwarda. Wszystkie firmy, postacie i zdarzenia są fikcyjne.

## Jak grać

Przy pierwszym wejściu ekran **Twój kasjer** pyta o wygląd kasjera, nazwę gracza i seed sklepu; nowy sklep otwierasz potem z ⚙.
Prowadzisz franczyzę Traszki: zamawiasz i rozładowujesz palety, zanim przyjdzie Straż Miejska, pilnujesz kolejki, ludzi
i swoich sił, a każdego dnia odpowiadasz na karty decyzji od Centrali. Marża ze sprzedaży wpada na saldo u Centrali, a przy
zamknięciu miesiąca Centrala robi przelew: po potrąceniu rat i palet oraz Twoich kosztów (pensje, media, ZUS, VAT, księgowa) reszta
(„Zostaje Ci”) trafia do gotówki. Co trzy miesiące remanent rozlicza ubytki. Umowę kończy zaufanie Centrali na zerze przy zamknięciu
miesiąca albo gotówka poniżej −100 000 zł. Zarobek idzie w ulepszenia, sprzęt i remonty (za gotówkę albo na raty), a po drugim
remoncie albo na 20. poziomie otworzysz kolejną Traszkę. Po ekranie startowym gra proponuje krótki samouczek (ok. 3 min); pełna
instrukcja, słowniczek pojęć i ponowny samouczek są pod „?” w pasku gry i w ⚙.

Sterowanie: przeciąganie przesuwa widok, szczypanie albo kółko myszy przybliża, ⟲ ⟳ albo Q/E obraca kamerę.
Spacja pauzuje, F3 pokazuje licznik FPS. Model ekonomii i liczby: [docs/ekonomia.md](docs/ekonomia.md).

## Uruchomienie

Wymagany Node.js w wersji ^22.12, 24 lub >=26 (zgodnie z wymaganiami Vitest 5).

```bash
npm install
npm run dev        # serwer deweloperski (Vite)
npm run build      # typecheck + build produkcyjny
npm run preview    # podgląd zbudowanej wersji
npm test           # testy (Vitest)
npm run typecheck  # tsc --noEmit
```

Parametry adresu: `?seed=<tekst>` wybiera sklep (przy pierwszym wejściu wypełnia pole seeda na ekranie startowym), `new=1` zaczyna bez zapisu (tylko dla gracza, który ma już nazwę: ekran startowy nigdy nie zaczyna od nowa na seedzie z zapisem), `bench=1` uruchamia benchmark.

## Publikacja (GitHub Pages)

Build ma ścieżki względne (`base: './'`), więc działa z dowolnego katalogu. Workflow
`.github/workflows/pages.yml` po każdym pushu na `main` uruchamia testy, buduje grę i publikuje `dist/` na GitHub Pages.
Raz trzeba włączyć Pages w ustawieniach repozytorium: Settings → Pages → Source: **GitHub Actions**.
Pages dla repozytorium prywatnego wymaga płatnego planu GitHub; na darmowym planie repozytorium musi być publiczne.

## Stack

- three 0.186.1, @types/three 0.186.0
- Vite 8.3.5, TypeScript 7.0.2, Vitest 5.0.5
- UI: Preact 11.1.0 + @preact/signals 2.11.4
- Postprocessing: postprocessing 6.39.5, n8ao 2.0.1
- Pipeline assetów: @gltf-transform/cli 4.5.1, meshoptimizer 1.3.0

## Konwencje

- `src/sim/` to logika gry bez three.js i bez `Math.random`. Pilnuje tego `tests/architecture.test.ts`.
  Ekonomia sklepu jest w `src/sim/economy/` (czysta symulacja z krokiem minuty gry, testy obok).
- Alias `@/` wskazuje na `src/`.

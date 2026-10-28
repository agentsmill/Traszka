# Traszka Tycoon

Przeglądarkowa gra ekonomiczna w izometrycznym widoku. Three.js + TypeScript. Działa na komputerze i na telefonie.

Prowadzisz franczyzę sklepu Traszka: rozładowujesz palety, zanim przyjdzie Straż Miejska, pilnujesz kolejki, kupujesz
kasy samoobsługowe i ulepszenia, a remont powiększa sklep. Później warsztat złotej rączki daje automatykę DIY,
a na końcu humanoida eDwarda. Wszystkie firmy, postacie i zdarzenia są fikcyjne.

## Jak grać

- **Palety** przyjeżdżają co rano pod sklep. Stukaj w nie (albo w pomarańczowy przycisk 📦), żeby rozładować.
  Paletę można przestawić na zaplecze (bezpiecznie, mało miejsca) albo do sali (korek, mniej klientów).
- **Kolejka**: za długa odstrasza klientów. Stuknięcie w kasę (albo 🧾) obsługuje klienta.
- **Zamówienie** zamyka się o 11:00. Asystent Traszki zawsze trochę przesadza, więc nadmiar palet się kumuluje.
- **Ulepszenia** kupujesz za zarobione pieniądze. Sloty w sklepie przyjmują sprzęt; slot 2×2 mieści dwie kasy
  samoobsługowe. Remont generalny daje większy lokal i więcej slotów.
- Koniec miesiąca to raport i opłata dla Centrali. Gra zapisuje się sama (osobno dla każdego seeda).

Nagrody (🎯 Cele): szybkie stukanie daje combo do ×5, Zlecenia Centrali mają przycisk „Odbierz”, każdy poziom to
premia (rangi od Drewnianej do Legendarnej Palety), a poziomy odblokowują sprzęt, remonty i warsztat. Złote palety
i paczki od Centrali to losowe premie. Po powrocie czeka zarobek kierownika zmiany i premia za serię dni.
Po drugim remoncie albo na 20. poziomie można otworzyć kolejną Traszkę: stary sklep zostaje w sieci i co dzień
dokłada dochód, a Punkty Partnera trwale podnoszą marżę i ruch w każdym następnym sklepie.

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

Parametry adresu: `?seed=<tekst>` wybiera sklep, `new=1` zaczyna bez zapisu, `bench=1` uruchamia benchmark.

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

# Plan: trzy kieszenie (SIM_VERSION 6)

Spec: `docs/superpowers/specs/2026-10-30-prawdziwy-model-rozliczen-design.md`. Gałąź `claude/trzy-kieszenie`. Nic nie wypychamy.

Kolejność wynika z zależności: rdzeń symulacji jest najpierw, bo widok i analiza czytają jego API. Widok robi osobny wykonawca (Sonnet)
na gotowym API; rdzeń, kalibrację i analizę prowadzi sesja główna, bo wymagają decyzji.

| # | Zadanie | Pliki | Gotowe, gdy |
|---|---|---|---|
| 1 | Stałe i blok `franchisee`: plany rat, limit, termin remanentu, przeterminowania, koszty własne, wyciąg (czyste funkcje) | `catalog.ts`, nowy `franchisee.ts` | testy jednostkowe planów, limitu, terminu remanentu i sumowania wyciągu |
| 2 | Rdzeń: marża i premie na saldo, płace, media i palety jako naliczenia, zamknięcie miesiąca z wyciągiem, gwarancja od liczników, raty w zakupach, remanent o 5:00, przeterminowania z nadmiaru | `economy.ts`, `commands.ts` | §14 spec: saldo, zamknięcie, raty, remanent |
| 3 | Prognoza paska i podgląd końca miesiąca na wyciągu | `forecast.ts`, `monthPreview.ts` | podgląd = prawdziwe zamknięcie co do złotówki |
| 4 | Zapis i migracja: `sanitize`, fixtures SIM 5 i SIM 4 w połowie miesiąca, `SIM_VERSION` 6 | `sanitize.ts`, `simVersion.ts`, `src/game/fixtures` | brak podwójnej marży i płac, zapis w połowie miesiąca bez strat |
| 5 | Kalibracja: stawka marży, płaca, przeterminowania; boty: normalny, agresywne raty, nadmierne palety; analiza 24 miesiące × 5 seedów | `catalog.ts`, `tycoon/bots.ts`, test pomiarowy | cele z §11 spec |
| 6 | Widok: pasek trzech kieszeni, wyciąg w oknie raportu, przyciski rat i ostrzeżenia, okno remanentu, „Jak grać” | `src/ui/game/*`, `src/ui/howto/*`, `ui.css` | testy UI, 390 px w smoke |
| 7 | Testy całości: ekonomia, balans, ranking, sędzia, `GOLDEN[6]`, `judgeBundle.js`, skrypty smoke rankingu | `tests/*`, `src/**/*.test.ts`, `scripts/*` | pełne testy, `tsc`, build, `check:vercel-build` |
| 8 | Smoke headless 390 px (wyciąg, raty, remanent, stary zapis); smoke palet i opłaty dostosowane | skrypty w notatkach sesji | zrzuty i zero błędów w konsoli |
| 9 | Raport z analizą | `docs/superpowers/reports/2026-10-30-trzy-kieszenie.md` | tabela miesięczna, przypadki brzegowe, decyzje |

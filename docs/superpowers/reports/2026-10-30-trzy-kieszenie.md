# Raport: prawdziwy model rozliczeń, trzy kieszenie (SIM_VERSION 6)

30.10.2026. Gałąź `claude/trzy-kieszenie` (z `origin/main` 5bf6947). Nic nie wypchnięte ani scalone.
Spec: `docs/superpowers/specs/2026-10-30-prawdziwy-model-rozliczen-design.md`, plan: `docs/superpowers/plans/2026-10-30-trzy-kieszenie.md`.

## 1. Co jest zrobione

**Model.**
- Marża ze sprzedaży i premie Centrali idą na **saldo u Centrali**. Przy zamknięciu miesiąca przychodzi **wyciąg**:
  - przelew = marża + premie + dopłata z gwarancji;
  - minus potrącenia: raty, palety ponad darmowe, nadwyżka z remanentu;
  - minus koszty własne: pensje, media, ZUS, VAT, księgowa.

  Wynik to **„Zostaje Ci”** i ta kwota wchodzi do gotówki jednym ruchem.
- W ciągu miesiąca gotówkę ruszają tylko zakupy za gotówkę, mandaty, karty, najem bankomatu i nagrody.
- **Opłata franczyzowa znika.** Udział Centrali siedzi w stawce marży.
- **Raty** na ulepszenia, sprzęt i remont, z limitem od przelewu i zaufania.
- **Remanent** ostatniego dnia co trzeciego miesiąca. Ubytki zbierają się w ukrytym liczniku, dochodzą przeterminowania z nadmiaru zapasu, a nadwyżka ponad limit schodzi z przelewu.

**Widok.**
- Pasek z trzema polami: saldo, raty i prognoza „Zostanie”.
- Okno „Wyciąg od Centrali” na koniec miesiąca, a podgląd końca miesiąca jako prognozowany wyciąg.
- Przycisk „na raty: N × Y zł” przy każdym zakupie.
- Okno protokołu remanentu.
- Sekcja „Remanent” w panelu Sklep.
- „Jak grać” ma nowe części o pieniądzach.

**Zapis.**
- `SIM_VERSION` 6, `GOLDEN[6]`, przebudowany `judgeBundle.js`.
- Zapisy SIM 4 i SIM 5, także z połowy miesiąca, wczytują się bez podwójnej marży i płac (nowe fixture `save-sim5-polowa-miesiaca.json`).

**Commity.**

| Commit | Opis |
|---|---|
| 155def0 | spec |
| c65c186 | plan i fixture |
| 337e69f | rdzeń symulacji |
| 02a3f63 | testy, `GOLDEN[6]`, sędzia |
| fd420b9 | widok |
| 75e99dc | prognoza paska |

Ten raport jest osobnym commitem. Razem 55 plików, +4,9 tys. / −0,9 tys. wierszy.

## 2. Liczby modelu: SIM 5 → SIM 6

| Stała | SIM 5 | SIM 6 | Dlaczego |
|---|---|---|---|
| Opłata Centrali na koniec miesiąca | 1000 zł + 3,4% obrotu | brak | żadne źródło jej nie potwierdza; udział Centrali jest w stawce marży |
| Marża (`CAT_INFO`, strefa hot) | ok. 19,1% obrotu | ok. 15,3% obrotu (stawki × 0,8) | z premiami daje przelew 16,6% obrotu (cel 16,5–16,7%) |
| Płaca osoby na zmianie | 500 zł dziennie, co wieczór z gotówki | 340 zł dziennie, płacona przy zamknięciu | SIM 5 chował w płacy ZUS, VAT i księgową; teraz są osobno (ok. 165 zł na osobę dziennie przy 2 osobach) |
| ZUS | — | 2200 zł miesięcznie | relacja z Opola: 2–2,5 tys. |
| Księgowa | — | 1000 zł miesięcznie | relacja z Opola: ok. 1 tys. |
| VAT | — | 17% przelewu | Opole: 3,9–4,5 tys. przy przelewie 25 tys. (15,6–18%); uproszczenie, mechanizm sporny |
| Media | co wieczór z gotówki | ta sama kwota, płacona przy zamknięciu | — |
| Palety ponad darmowe | z gotówki przy zamówieniu | potrącenie z przelewu | Centrala potrąca, nie Ty płacisz |
| Ubytki ponad limit | co miesiąc z gotówki | przy remanencie, co 3 miesiące | rachunek przychodzi przy liczeniu (raport skarg) |
| Przeterminowania z nadmiaru | brak | towar ponad 3 dni sprzedaży traci 1% wartości dziennie | za dużo palet kosztuje przy remanencie |
| Raty | brak | 3 / 6 / 12 miesięcy (cena do 5 tys. / do 25 tys. / więcej), opłata 4% / 8% / 15%; limit 35% przelewu bazowego × mnożnik zaufania; przed pierwszym przelewem od gwarancji (8750 zł miesięcznie) | — |
| Gwarancja 25 tys. zł | dopłata do przychodu (marża − opłata + premie) | dopłata do przelewu, przed potrąceniami; przychód liczony z liczników całego miesiąca | ta sama zasada; liczniki chronią przed dopłatą za pół miesiąca po migracji |
| Granica debetu, ostrzeżenie | −100 tys. / −50 tys. | bez zmian | — |
| Wynik miesiąca (historia, ranking) | marża + premie + inne − koszty − opłata − ubytki | przelew − palety − remanent − koszty własne + inne − mandaty | raty, jak zakupy za gotówkę, są inwestycją i do wyniku nie wchodzą |

## 3. Kalibracja: cele i wyniki

| Cel (koordynator, właściciel) | Wynik SIM 6 |
|---|---|
| Przelew (marża z premiami) ok. 16,5–16,7% obrotu | **16,6%** u biernego (5 sklepów, 12 miesięcy); mistrz 18,0% (premie KPI), mistrz z zakupami 20,1% (premia od obrotu przy wysokim zaufaniu) |
| Słaby miesiąc w proporcjach z Opola: przelew ok. 25 tys., VAT 3,9–4,5 tys., ZUS 2–2,5 tys., księgowa ok. 1 tys., dwa etaty ponad 10 tys., wychodzi dziura | kopytka-541, wrzesień, bierny: przelew 30,0 tys., VAT 5,1 tys., ZUS 2,2, księgowa 1,0, pensje 20,4 (dwie osoby na zmianie, 17 h dziennie), media 3,3, **zostaje −2,0 tys.**; sklep z gwarancją (przelew dopełniony do 25,0 tys.): zostaje −6,2 tys. |
| Wynik netto blisko SIM 5: bierny +5,9 tys., mistrz +14,6 tys. miesięcznie | bierny **+5,8 tys.**, mistrz **+12,8 tys.** miesięcznie (wrzesień i październik); mistrz traci ok. 1,8 tys., bo jego premie KPI idą teraz przez przelew i płacą VAT |
| Realny dochód „kilka–kilkanaście tys. zł” miesięcznie | „Zostaje Ci” biernego średnio 9,9 tys. (miesiące 1–12) i 10,8 tys. (13–24), na sklepach od −2 do +17 tys. |

## 4. Analiza strategii (24 miesiące, 5 sklepów)

Strategie:

| Strategia | Co robi |
|---|---|
| bierny | asystent, karty domyślne, nic nie kupuje |
| normalny | bierny plus zakupy za gotówkę od najtańszej rzeczy, gdy po zakupie zostaje co najmniej 3 tys. zł gotówki i 5 tys. w prognozie po zamknięciu |
| mistrz | bot z balansu: najlepsze odpowiedzi, profile, stukanie; nic nie kupuje, jak w pomiarach SIM 5 |
| mistrz z zakupami | mistrz plus zakupy za gotówkę albo na raty, gdy prognoza to zniesie |
| agresywne raty | bierny plus codziennie na raty, do limitu, od najdroższej rzeczy, bez patrzenia na prognozę |
| nadmiar 2× i 1,4× | bierny, ale codziennie ręcznie zamawia 2× albo 1,4× tego, co sklep sprzedaje |
| nadmiar 1,5× przez miesiąc | tak samo przez wrzesień, potem wraca do asystenta |

Harness: `tests/measure/trzyKieszenie.measure.test.ts`. Uruchamia go tylko `MEASURE=1`, więc nie wchodzi do `npm test`.

| Strategia | Przelew / obrót | Wynik miesiąca, m. 1–2 | „Zostaje Ci” średnio, m. 1–12 | m. 13–24 | Gotówka po 12 mies. | po 24 mies. | Bankructwa |
|---|---|---|---|---|---|---|---|
| bierny | 16,6% | 5,8 tys. | 9,9 tys. | 10,8 tys. | 95,3–171,4 tys. | 172,7–332,6 tys. | brak |
| normalny (gotówka) | 17,9% | 12,0 tys. | 39,5 tys. | 97,3 tys. | 56,4–141,9 tys. | 248,9–751,1 tys. | brak |
| mistrz (bez zakupów) | 18,0% | 12,8 tys. | 14,5 tys. | 15,3 tys. | 145,3–230,9 tys. | 280,6–449,5 tys. | brak |
| mistrz z zakupami | 20,1% | 39,6 tys. | 29,3 tys. | 78,6 tys. | 279,7–332,4 tys. | 1,14–1,29 mln | brak |
| agresywne raty | 17,9% | 11,2 tys. | −4,4 tys. | 25,0 tys. | −79,7–19,2 tys. | 145,6–476,9 tys. | traszka-1: m. 16 |
| nadmiar 2× | 19,4% | −11,6 tys. | −23,3 tys. | — | — | — | traszka-1: m. 6; kopytka-541: m. 6; makieta: m. 6; lublin-9: m. 6; seed-3: m. 6 |
| nadmiar 1,4× | 19,0% | −11,6 tys. | −23,0 tys. | — | — | — | traszka-1: m. 6; kopytka-541: m. 6; makieta: m. 6; lublin-9: m. 6; seed-3: m. 6 |
| nadmiar 1,5× przez miesiąc | 17,3% | −10,3 tys. | 1,8 tys. | 11,0 tys. | 3,3–96,0 tys. | 97,5–260,4 tys. | brak |

Wnioski:

- **Bierny przeżywa** na wszystkich pięciu sklepach przez 24 miesiące: gotówka 173–333 tys. zł. Remanent go nie dotyka (raz 1,3 tys. zł w 18. miesiącu), bo asystent nie zamawia ponad potrzebę, a ubytki naturalne (0,9% obrotu) mieszczą się w limicie (1,2%).
- **Agresywne raty upadają czasem, nie zawsze.** Na jednym z pięciu sklepów (traszka-1) bankructwo przychodzi w 16. miesiącu, zaraz po remanencie. Gotówka jest pod zerem od pierwszego remanentu do końca, bo co kwartał przychodzi 21–43 tys. zł nadwyżki. Bierze się ona z „zapomnianych” skanów na kasach samoobsługowych, które ta strategia kupuje pierwszego dnia, a kamer nie bierze. Na pozostałych sklepach dołek po 12 miesiącach wynosi od −80 do +19 tys. zł, a po 24 miesiącach zakupy się zwracają (146–477 tys.).
- **Mistrz rośnie.** Z zakupami (gotówka albo raty, gdy prognoza je zniesie) dochodzi do 1,14–1,29 mln zł po 24 miesiącach przy obrocie ok. 1 mln zł miesięcznie.
- **Milion tylko przez rozwój.** Czas dojścia do miliona zł gotówki, wprost z biegu albo z tempa ostatnich 6 miesięcy:

  | Strategia | Milion |
  |---|---|
  | mistrz z zakupami | w 21.–22. miesiącu |
  | normalny (gotówka) | ok. 26–72 miesiące |
  | mistrz bez zakupów | 51–86 miesięcy |
  | bierny | 70–153 miesiące (6–13 lat) |
- **Nadmierne zamawianie jest śmiertelne, jeśli trwa.** Przy dwa razy albo 1,4 raza ponad sprzedaż każdy sklep bankrutuje w 6. miesiącu, przy drugim remanencie. Składają się na to:
  - zagracenie z SIM 5: ruch spada do połowy, reputacja do 25;
  - pierwszy remanent 30 listopada z 39–45 tys. zł przeterminowanego nadmiaru.

  Miesiąc nadmiaru (1,5× we wrześniu) sklep przeżyje. Remanent kosztuje go wtedy 17–20 tys. zł, a po 24 miesiącach ma ok. 75 tys. zł mniej niż bierny.

**bierny, kopytka-541**

| Mies. | Obrót | Przelew | Potrącenia (raty / remanent) | Koszty własne | Zostaje Ci | Gotówka | Udział |
|---|---|---|---|---|---|---|---|
| 1 | 195,5 | 30,0 | 0,0 (0,0 / 0,0) | 32,0 | −2,0 | 5,6 | 15,3% |
| 2 | 230,9 | 38,0 | 0,0 (0,0 / 0,0) | 34,2 | 3,8 | 9,3 | 16,5% |
| 3 | 252,1 | 41,8 | 0,0 (0,0 / 0,0) | 34,0 | 7,8 | 18,8 | 16,6% |
| 4 | 260,2 | 41,3 | 0,0 (0,0 / 0,0) | 34,7 | 6,6 | 27,2 | 15,9% |
| 5 | 262,8 | 42,1 | 0,0 (0,0 / 0,0) | 34,9 | 7,2 | 36,5 | 16,0% |
| 6 | 235,4 | 40,7 | 0,0 (0,0 / 0,0) | 32,3 | 8,5 | 45,7 | 17,3% |
| 12 | 262,9 | 45,7 | 0,0 (0,0 / 0,0) | 35,5 | 10,2 | 95,3 | 17,4% |
| 18 | 243,5 | 43,2 | 0,0 (0,0 / 0,0) | 33,5 | 9,7 | 142,7 | 17,7% |

**bierny, traszka-1**

| Mies. | Obrót | Przelew | Potrącenia (raty / remanent) | Koszty własne | Zostaje Ci | Gotówka | Udział |
|---|---|---|---|---|---|---|---|
| 1 | 260,6 | 45,0 | 0,0 (0,0 / 0,0) | 38,7 | 6,3 | 13,9 | 17,3% |
| 2 | 316,4 | 51,3 | 0,0 (0,0 / 0,0) | 40,7 | 10,6 | 25,7 | 16,2% |
| 3 | 332,4 | 57,9 | 0,0 (0,0 / 0,0) | 40,9 | 17,0 | 44,2 | 17,4% |
| 4 | 340,3 | 53,7 | 0,0 (0,0 / 0,0) | 41,1 | 12,6 | 58,4 | 15,8% |
| 5 | 341,9 | 57,3 | 0,0 (0,0 / 0,0) | 41,7 | 15,5 | 74,3 | 16,8% |
| 6 | 308,3 | 51,8 | 0,0 (0,0 / 0,0) | 38,0 | 13,8 | 88,2 | 16,8% |
| 12 | 343,4 | 54,2 | 0,0 (0,0 / 0,0) | 41,2 | 13,0 | 171,4 | 15,8% |
| 18 | 318,3 | 51,7 | 1,3 (0,0 / 1,3) | 38,9 | 11,5 | 261,0 | 16,3% |

**mistrz z zakupami, kopytka-541**

| Mies. | Obrót | Przelew | Potrącenia (raty / remanent) | Koszty własne | Zostaje Ci | Gotówka | Udział |
|---|---|---|---|---|---|---|---|
| 1 | 285,5 | 50,7 | 12,1 (12,1 / 0,0) | 35,5 | 3,1 | 7,5 | 17,8% |
| 2 | 438,8 | 81,6 | 27,0 (25,4 / 0,0) | 41,6 | 13,1 | 19,4 | 18,6% |
| 3 | 460,8 | 89,7 | 41,5 (33,2 / 5,9) | 42,2 | 6,0 | 9,7 | 19,5% |
| 4 | 500,8 | 93,7 | 41,5 (38,8 / 0,0) | 43,7 | 8,6 | 20,0 | 18,7% |
| 5 | 794,8 | 153,1 | 56,3 (44,6 / 0,0) | 55,2 | 41,6 | 53,0 | 19,3% |
| 6 | 751,4 | 149,4 | 74,1 (58,9 / 4,0) | 53,7 | 21,7 | 34,0 | 19,9% |
| 12 | 992,8 | 205,0 | 92,3 (68,6 / 9,5) | 67,9 | 44,9 | 279,7 | 20,7% |
| 18 | 927,1 | 192,2 | 68,6 (48,5 / 6,8) | 63,8 | 59,9 | 640,0 | 20,7% |

**agresywne raty, traszka-1** (bankructwo w miesiącu 16)

| Mies. | Obrót | Przelew | Potrącenia (raty / remanent) | Koszty własne | Zostaje Ci | Gotówka | Udział |
|---|---|---|---|---|---|---|---|
| 1 | 261,3 | 45,1 | 8,6 (8,6 / 0,0) | 38,7 | −2,2 | 5,4 | 17,3% |
| 2 | 385,9 | 62,9 | 15,7 (15,7 / 0,0) | 44,9 | 2,2 | 9,7 | 16,3% |
| 3 | 382,2 | 65,7 | 53,6 (18,8 / 34,8) | 44,4 | −32,3 | −21,4 | 17,2% |
| 4 | 404,8 | 68,8 | 20,1 (20,1 / 0,0) | 45,9 | 2,7 | −17,0 | 17,0% |
| 5 | 417,6 | 75,6 | 22,7 (22,7 / 0,0) | 47,1 | 5,8 | −8,9 | 18,1% |
| 6 | 384,4 | 69,3 | 66,8 (24,3 / 42,5) | 43,0 | −40,5 | −48,2 | 18,0% |
| 12 | 434,9 | 83,1 | 76,8 (34,1 / 42,7) | 48,4 | −42,1 | −79,7 | 19,1% |

**nadmiar 2×, kopytka-541** (bankructwo w miesiącu 6)

| Mies. | Obrót | Przelew | Potrącenia (raty / remanent) | Koszty własne | Zostaje Ci | Gotówka | Udział |
|---|---|---|---|---|---|---|---|
| 1 | 83,6 | 25,0 | 0,0 (0,0 / 0,0) | 31,2 | −6,2 | 0,8 | 29,9% |
| 2 | 73,2 | 11,6 | 0,0 (0,0 / 0,0) | 29,7 | −18,1 | −17,7 | 15,9% |
| 3 | 71,3 | 11,5 | 44,6 (0,0 / 44,6) | 28,9 | −62,0 | −79,2 | 16,1% |
| 4 | 74,0 | 12,5 | 0,0 (0,0 / 0,0) | 29,9 | −17,3 | −96,5 | 16,9% |
| 5 | 74,3 | 12,0 | 0,0 (0,0 / 0,0) | 29,8 | −17,8 | −113,6 | 16,1% |

**nadmiar 1,5× przez miesiąc, kopytka-541**

| Mies. | Obrót | Przelew | Potrącenia (raty / remanent) | Koszty własne | Zostaje Ci | Gotówka | Udział |
|---|---|---|---|---|---|---|---|
| 1 | 89,8 | 25,0 | 0,0 (0,0 / 0,0) | 31,2 | −6,2 | 0,5 | 27,8% |
| 2 | 91,7 | 14,4 | 0,0 (0,0 / 0,0) | 30,2 | −15,8 | −14,8 | 15,7% |
| 3 | 155,4 | 25,9 | 17,7 (0,0 / 17,7) | 31,3 | −23,1 | −37,5 | 16,7% |
| 4 | 181,7 | 30,7 | 0,0 (0,0 / 0,0) | 32,9 | −2,2 | −37,5 | 16,9% |
| 5 | 213,1 | 34,0 | 0,0 (0,0 / 0,0) | 33,5 | 0,5 | −36,5 | 16,0% |
| 6 | 214,9 | 34,3 | 0,0 (0,0 / 0,0) | 31,2 | 3,2 | −31,8 | 16,0% |
| 12 | 262,8 | 41,7 | 0,0 (0,0 / 0,0) | 34,8 | 6,9 | 15,5 | 15,9% |
| 18 | 243,7 | 39,6 | 0,0 (0,0 / 0,0) | 32,9 | 6,7 | 65,0 | 16,3% |

## 5. Przypadki brzegowe

| Przypadek | Wynik | Test |
|---|---|---|
| Remanent w dniu zamknięcia miesiąca | remanent o 5:00, przelew o 23:00 tego samego dnia potrąca nadwyżkę; ubytki z reszty dnia idą do następnego okresu | `economy.test.ts`, „pierwszy remanent 30 listopada…” |
| Gwarancja razem z ratami | dopłata do 25 tys. przed potrąceniami, raty schodzą normalnie | `franchisee.test.ts`, „gwarancja razem z ratami” |
| Zapis w połowie miesiąca | saldo, naliczenia, raty i remanent wracają z zapisu bajt w bajt | `franchisee.test.ts`, `sanitize.test.ts` |
| Migracja zapisu SIM 5 z połowy miesiąca | gotówka bez zmian, saldo od zera; pierwszy przelew liczy tylko dni od migracji (z notką); bez dopłaty z gwarancji za pół miesiąca | `session.test.ts` (fixture z 16.10, 14:00), smoke |
| Migracja zapisów SIM 4 i v1/v2 | wczytują się, blok franczyzobiorcy od zera | `session.test.ts`, `sanitize.test.ts`, smoke |
| Podgląd = prawdziwe zamknięcie | wyciąg z podglądu równa się wyciągowi z zamknięcia pozycja w pozycję (dni 0, 4, 17) i co do złotówki w przeglądarce (+5996 zł) | `monthPreview.test.ts`, smoke |
| Podgląd niczego nie zmienia | stan i dziennik co do bajtu | `monthPreview.test.ts`, smoke |
| Prognoza paska | czysta funkcja; w ostatniej minucie przed zamknięciem równa się wyciągowi | `forecast.test.ts` |
| Determinizm | 12 seedów × 90 dni z poleceniami `raty` w dzienniku: odtworzenie bajt w bajt; 24 miesiące dwa razy, ten sam stan | `run.test.ts`, `tests/measure/longReplay.measure.test.ts` |
| Ranking: zakup z `raty: true` w dzienniku | parsuje się i odtwarza; sezon złotego biegu kupuje sprzęt i remont na raty | `simGolden.test.ts`, `rankedSeason.test.ts` |

**Trafność prognozy na pasku.** Pomiar: `tests/measure/forecast.measure.test.ts`.
- Od kilku dni miesiąca prognoza trafia w zamknięcie z dokładnością ok. ±2–3 tys. zł.
- W pierwszym dniu miesiąca jest ostrożniejsza o 3–10 tys. zł, bo liczy z przewidywań sklepu, a te nie znają fal, rosnącej reputacji ani premii.
- Dokładną liczbę daje podgląd.

Smoke wyłapał, że pierwsza wersja paska była zaniżona przez cały miesiąc. Poprawka 75e99dc liczy resztę miesiąca w tempie od jego początku.

## 6. Sezon rankingowy i sędzia

**Bankructwo przed końcem sezonu jest w SIM 6 praktycznie nieosiągalne.**
- Gotówka zmienia się prawie wyłącznie przy przelewach, a granica stoi na −100 tys. zł.
- Szukałem dziennika, który zbankrutuje przy zamknięciu października, na 7 sklepach (`tests/measure/bankrupt.measure.test.ts`):

  | Próbowana dźwignia | Wariant |
  |---|---|
  | etaty | sześć więcej od 29–31 dnia |
  | palety | 30 dziennie od 15–31 dnia |
  | raty | do limitu, od najdroższej |
  | karty | najdroższe i najgorsze dla zaufania odpowiedzi |
  | załoga | przypięta do kasy |

  Najgłębszy dołek po październiku to ok. −90 tys. zł. Wszystkie bankructwa wypadają dopiero przy przelewie 30 listopada, czyli z trzema raportami: taki bieg ma wynik.
- Reguła `season-bankrupt` zostaje. Test sędziego sprawdza ją teraz na bundlu z podstawionym końcem gry po październiku.
- Do decyzji: czy to w porządku, że sezonu nie da się „zamrozić” bankructwem, bo zawsze trzeba dograć do listopada.

**Scenariusz „koniec gry dokładnie przy ostatnim zamknięciu”** w testach rankingu:
- 30 palet od 16 października i sześć etatów od 17 października;
- zapas do granicy ok. 14 tys. zł (w SIM 5 było ok. 500 zł).

**Czas sędziego** (`scripts/judge-worst-case.mjs` na bundlu SIM 6, 100 000 wpisów):
- najgorszy scenariusz 389 ms przy progu 8000 ms;
- `check:vercel-build`: odtworzenie sezonu w funkcji, zimny start 410 ms, ciepłe ok. 340 ms;
- 24 miesiące gry odtwarzają się w ok. 3,3 s, ale sędzia odtwarza tylko trzy.

### 30 listopada: koniec gwarancji, pierwszy remanent i koniec sezonu tego samego dnia

| Strategia | Wynik sezonu (3 raporty), średnio i zakres | Remanent 30.11 | Dopłata z gwarancji w listopadzie | Wynik sezonu bez remanentu | Co robi ten dzień |
|---|---|---|---|---|---|
| bierny | 24,3 tys. (13,8–39,2) | 0 | 0 | 24,3 tys. | nic |
| normalny | 49,1 tys. (27,8–75,1) | 1,3 tys. (0–3,8) | 0 | 50,4 tys. | zabiera 0–7% zarobku |
| mistrz | 41,7 tys. (30,4–53,3) | 0 | 0 | 41,7 tys. | nic |
| mistrz z zakupami | 131,6 tys. (101,0–170,5) | 5,6 tys. (3,6–7,9) | 0 | 137,2 tys. | zabiera 2–5% zarobku |
| agresywne raty | 18,0 tys. (−1,3–42,8) | 28,2 tys. (21,0–34,8) | 0 | 46,2 tys. | zabiera 34–107% zarobku (na jednym sklepie cały) |
| nadmiar 2× | −80,4 tys. (−84,6 do −71,7) | 42,8 tys. (39,6–44,6) | 0–12,3 tys. (śr. 2,5) | −37,6 tys. | odpowiada za ok. 53% straty |
| nadmiar 1,4× | −78,9 tys. (−83,0 do −69,4) | 41,3 tys. (38,8–43,1) | 0–12,4 tys. (śr. 2,5) | −37,6 tys. | ok. 52% straty |
| nadmiar 1,5× przez miesiąc | −43,5 tys. (−56,2 do −29,3) | 18,0 tys. (16,6–19,6) | 0 | −25,6 tys. | ok. 41% straty |

Wniosek:
- **Zwykłe strategie.** Dla biernego, mistrza i normalnego gracza 30 listopada nic nie rozstrzyga: remanent mieści się w limicie albo kosztuje kilka procent wyniku.
- **Gwarancja.** Jej koniec w sezonie nie ma znaczenia, bo przeciętny sklep ma przelew powyżej 25 tys. zł.
- **Kiedy ten dzień rozstrzyga.** Decyduje tylko o biegach, które nabrały ubytków: kasy samoobsługowe bez kamer albo zamawianie ponad sprzedaż. Takim biegom zabiera od jednej trzeciej do całości zarobku sezonu. To zamierzone: rachunek za te decyzje przychodzi przy liczeniu, a nie co miesiąc.
- **Uczciwość rankingu.** Jest zachowana: remanent jest w wyniku listopada, więc gracz, który nadrabia ubytkami, nie ucieka przed rachunkiem.

| Strategia | Rata miesięczna dnia 1 | Wynik sezonu (m. 1–3), mediana i zakres | Gotówka po 3 mies. | po 12 mies. | Lepiej niż bez rat (sklepy) | Bankructwa |
|---|---|---|---|---|---|---|
| bierny | 0,0–0,0 tys. | 27,6 tys. (13,8 do 39,2) | 32,6 tys. (18,8 do 44,2) | 137,4 tys. (95,3 do 196,7) | —/— | brak |
| max raty dnia 1 (od najdroższej) | 8,6–8,7 tys. | 1,9 tys. (−7,9 do 17,4) | −18,8 tys. (−28,5 do −3,8) | −9,4 tys. (−43,7 do 48,2) | 0/20 | brak |
| max raty dnia 1 (od najtańszej) | 8,5–8,5 tys. | 62,7 tys. (43,5 do 81,7) | 42,1 tys. (22,9 do 61,2) | 252,4 tys. (182,3 do 322,4) | 20/20 | brak |
| mistrz (bez zakupów) | 0,0–0,0 tys. | 42,5 tys. (30,4 do 55,5) | 47,5 tys. (35,4 do 60,5) | 195,2 tys. (145,3 do 242,4) | —/— | brak |
| mistrz + max raty dnia 1 | 8,6–8,7 tys. | 18,4 tys. (5,7 do 31,9) | −2,3 tys. (−15,0 do 10,7) | 46,4 tys. (4,3 do 95,0) | 0/20 | brak |

Wniosek:
- **Pewnego bankructwa nie ma.** W 12 miesiącach nie upadł żaden z 20 sklepów w żadnym wariancie.
- **Wariant od najtańszej to pewna przewaga.**
  - Lepszy od gry bez rat na wszystkich 20 sklepach: mediana wyniku sezonu 62,7 tys. zł wobec 27,6 tys., gotówka po roku 252 tys. wobec 137 tys.
  - Drobne ulepszenia zwracają się w tygodnie, a raty na 3 miesiące kosztują tylko 4%.
  - W rankingu to dominujące otwarcie dla każdego, kto je zna.
- **Wariant od najdroższej to pewna strata względem gry bez rat** (20 z 20 sklepów), ale nie bankructwo:
  - kasy samoobsługowe bez kamer produkują ubytki, które wychodzą przy remanencie;
  - gotówka po roku wynosi od −44 do +48 tys. zł.
- **Mistrz z tym samym otwarciem od najdroższej** też traci na wszystkich 20 sklepach.
- **Do decyzji właściciela (§9), czy drobne ulepszenia na raty od pierwszego dnia mają być takim pewniakiem.** Najprostsze przeciwwagi, bez zmiany modelu:
  - niższy limit przed pierwszym przelewem, np. 20% gwarancji zamiast 35%;
  - wyższa opłata za najkrótszy plan;
  - raty dopiero od poziomu 2–3.

  Niczego z tego nie zmieniałem.

## 7. Widok (smoke headless, 390 px)

**Smoke SIM 6:** **38/38 OK**. Skrypt, log i zrzuty są w notatkach sesji: `trzy-kieszenie/smoke.mjs`, `smoke-wynik.log`, `zrzuty/`.

| Zrzut | Co pokazuje |
|---|---|
| 01 | pasek z trzema polami w jednym wierszu |
| 02 | przyciski „na raty: 3 × 1214 zł” pod ceną |
| 03 | podgląd |
| 04–05 | wyciąg |
| 06 | protokół remanentu |
| 07 | pierwszy wyciąg po migracji SIM 5, z notką |
| 08 | ostrzeżenie przy drogim zakupie |

Sprawdzane:
- pasek bez poziomego przewijania;
- saldo rośnie, a gotówka stoi;
- zakup na raty: rata na liście, gotówka bez zmian;
- podgląd nie zmienia stanu ani dziennika i równa się zamknięciu;
- wyciąg z ZUS-em, VAT-em i księgową;
- protokół remanentu z limitem, który „poznajesz dopiero teraz”, i potrąceniem 30.11;
- ostrzeżenie `.tt-spend`, które nie blokuje zakupu;
- sześć starych zapisów (SIM 5 z połowy miesiąca, SIM 4, dwa v1, dwa v2): wczytane, gotówka bez zmian, saldo od zera, konsola czysta.

**Smoke opłaty z sesji „widoczna opłata”** sprawdzał „Do oddania Centrali”, którego już nie ma. Jego scenariusze przeszły do smoke'u SIM 6: tożsamość stanu przy podglądzie, podgląd = zamknięcie, ostrzeżenie przy zakupie, stare zapisy. Pomiar dławienia CPU przy liczeniu podglądu się nie zmienił (ten sam kod liczenia), więc go nie powtarzałem.

**Pozostałe smoke'i:**

| Smoke | Wynik |
|---|---|
| palety | bez zmian względem SIM 5: 22 palety, 13 w przejściach, nic nie znika, nie ma „Odeślij”, zapis SIM 4 się wczytuje, konsola czysta |
| roboty | PASS (18 sprawdzeń) |

## 8. Testy i bramki

| Bramka | Wynik |
|---|---|
| `npm test` | 4589 przechodzi, 0 pada, 7 pominiętych (158 plików; pominięte to m.in. pomiary uruchamiane z `MEASURE=1`) |
| `npx tsc --noEmit` | 0 błędów |
| `npm run build` | OK |
| `npm run check:vercel-build` | PASS (25 sprawdzeń) |
| `npm run build:judge` | przebudowany |
| `GOLDEN[6]` | `5e9bf18c7a4f04ad3e55081aa2c7ee3fb8ad1ef5262ab0b4469d9be3cca08c0e` |

**Nowe testy:**
- `franchisee.test.ts`: plany rat, limit, termin remanentu, zakup na raty, gwarancja z ratami, zapis i migracja;
- testy saldo/wyciąg/remanent w `economy.test.ts`;
- przepisany `forecast.test.ts`;
- migracja zapisu SIM 5 w `session.test.ts`;
- obsługa zdarzenia `remanent` w `actions.test.ts`;
- testy widoku: pasek, przyciski rat, wyciąg, protokół.

**Zmienione progi i scenariusze:**
- **Balans:** mistrz ma być co najmniej 7 tys. zł przed biernym zamiast 8 tys. Premie KPI mistrza idą teraz przez przelew i płacą VAT. Na `makieta` wychodzi 7,9 tys.
- **Scenariusze rankingu:** jak w §6.
- **Złoty bieg i sezon:** sprzęt i remont na raty, nowa lista `CARD_ANSWERS`.
- **Bot losowy w `run.test.ts`:** co drugi zakup na raty.
- **„Jak grać”:** limit słów 450 → 490. Nowy model ma sześć tematów o pieniądzach zamiast trzech; limit punktów na górze (110) zostaje.

## 9. Decyzje do pokazania właścicielowi

Liczby z analizy są w §4 i §6. Każdą z tych rzeczy da się zmienić jedną stałą albo małą poprawką.

1. **Pewne otwarcie: drobne ulepszenia na raty pierwszego dnia.** Wygrywa z grą bez rat na każdym z 20 sklepów i ponad dwukrotnie podnosi wynik sezonu rankingowego. Zostawić, bo raty mają być głównym sposobem na rozwój? Czy przyciąć, np. limitem przed pierwszym przelewem 20% gwarancji zamiast 35%?
2. **Bankructwo przed końcem sezonu jest niemożliwe.** Gotówka rusza się przy przelewach, a granica to −100 tys. zł, więc w trzy miesiące nie da się zbankrutować przed ostatnim zamknięciem. Ranking zawsze liczy pełny sezon. Do decyzji, czy granica debetu ma zostać tak daleko.
3. **Nadmierne zamawianie zabija w 6 miesięcy.** Zamawianie stale ponad sprzedaż (nawet 1,4×) kończy się bankructwem przy drugim remanencie. Składają się na to zagracenie z SIM 5 i rachunek za przeterminowany nadmiar. Jeden zły miesiąc sklep przeżywa, ale zostaje ślad (ok. −75 tys. zł po dwóch latach).
4. **Kasy samoobsługowe bez kamer kosztują co kwartał 20–40 tys. zł przy remanencie.** To „zapomniane” skany, dziś ujawniane dopiero przy liczeniu. W SIM 5 szły w mniejszych porcjach co miesiąc. Gracz, który kupi kasy bez kamer, dowie się o tym po trzech miesiącach. Taki jest zamysł remanentu, ale to najmocniejszy efekt w całej analizie.
5. **Płaca 500 → 340 zł za osobę na zmianie.** Oznacza powrót do płacy z SIM 4, bo ZUS, VAT i księgowa są teraz osobnymi pozycjami. Bez tego bierny tracił ok. 4 tys. zł miesięcznie.
6. **VAT jako 17% przelewu.** To uproszczenie: gra pokazuje kwotę z relacji, a nie mechanizm, który raport skarg uznaje za sporny.
7. **Wynik do rankingu jest bez rat**, tak jak bez zakupów za gotówkę. Okno pokazuje osobno „Zostaje Ci” (to, co wpływa do gotówki) i ten wynik.
8. **Podgląd w miesiącu remanentu zdradza nadwyżkę.** Musi równać się zamknięciu, więc ją pokazuje. Pasek jej nie pokazuje. Prognoza na pasku w pierwszym dniu miesiąca jest ostrożna o kilka tysięcy złotych.
9. **„Jak grać” ma limit 490 słów zamiast 450**, bo pieniądze mają teraz sześć tematów zamiast trzech.

Sesja „Onboarding i samouczek” musi po scaleniu dostosować kroki o pieniądzach. Pasek ma teraz trzy pola. Okno końca miesiąca to wyciąg. Doszły przyciski „na raty” i okno remanentu. Klasy paska zostały `tt-due*`.

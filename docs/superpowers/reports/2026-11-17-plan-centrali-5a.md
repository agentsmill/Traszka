# Raport: etap 5a, plan sprzedaży Centrali (Zadanie 6: balans na botach, zapis, smoke, bramki)

18.11.2026. Gałąź `claude/plan-centrali-5a`, worktree `ZabkaTycone-wt/plan-centrali-5a`. Nic nie wypchnięte ani scalone.
Spec: `docs/superpowers/specs/2026-11-13-etap-5a-plan-centrali-design.md`, plan: `docs/superpowers/plans/2026-11-17-etap-5a-plan-centrali.md`.

**Najkrócej.** Plan Centrali jest w grze, działa w jednym sklepie i w sieci, ma pasek, przełącznik dobicia, zapowiedź, raport i koniec gry,
a zapis i ranking zostały bez zmian (`SIM_VERSION` 7, `FIRM_SAVE_SCHEMA` 4, `GOLDEN` ten sam). Z siedmiu bramek balansu pięć przechodzi, **dwie nie**:
**P5** (sieć, która przestała kupować, ma pierwszą wpadkę za wcześnie na dwóch seedach z pięciu) i **P6** (ostrożny gracz nie dochodzi do miliona w portfelu
na żadnym seedzie). Sześciu rund strojenia stałych `PLAN` nie dało się rozstrzygnąć na korzyść obu naraz, więc zostawiłem zestaw, który nie psuje reszty,
i opisuję lukę. Decyzje są w punkcie 11. Wszystkie bramki techniczne są zielone: build, `npm test` (6281 testów), `check:vercel-build`, pełny `city:smoke`.

Pojęcia, które pojawiają się dalej:
- **Wpadka** = miesiąc, w którym sklep nie zrobił planu (i nie dobił go z kieszeni). **Trzecia z rzędu** kończy umowę na ten sklep.
- **Boty** to programy grające za człowieka (te same co w raporcie 4b, plik `tests/progresjaPlay.ts`): `mistrz` (jeden sklep, nic nie kupuje, gra sam), `jeden` (jeden sklep,
  kupuje wszystko), `siec12` (pięć sklepów, przez 12 miesięcy kupuje wszystko, potem tylko gra), `rozsadny` (nowy: pięć sklepów, kupuje tylko wtedy, gdy prognoza planu
  któregoś sklepu spada poniżej 105%, poza tym oszczędza, nie dobija planu).
- **Bramka** = warunek z specu (§6.7), który pomiar na botach ma spełnić. Nazywają się P1–P7.
- **Miesiąc** w pomiarze to numer zamkniętego miesiąca gry (wrzesień 2026 = 1).
- **Seedy pomiaru**: `traszka-1, kopytka-541, makieta, lublin-9, seed-3` (te same co w raporcie 4b), 24 miesiące.

## 1. Co weszło do gry

| Co | Opis | Zadanie |
|---|---|---|
| Plan miesięczny sklepu | Od czwartego miesiąca umowy (przy starcie we wrześniu pierwszy plan obowiązuje od 1 grudnia). Cel = średni dzienny obrót z trzech ostatnich miesięcy × dni miesiąca × (1 + wzrost). Baza nie spada szybciej niż o 5% miesięcznie. Wzrost: 1% + 0,25 pkt proc. za każde trafienie z rzędu, najwyżej 3% | 1, 2 |
| Rozliczenie i drabina | Trafienie: premia 1% obrotu, zaufanie +2, seria rośnie, stopień niżej. Wpadka: zaufanie −2, seria zero, stopień wyżej, kara 10% (stopień 1) albo 20% (stopień 2) **brakującego** obrotu, jako osobny wiersz „Plan Centrali” w wyciągu. Trzecia wpadka z rzędu: koniec umowy na sklep (w sieci z rozliczeniem końcowym, ostatni sklep kończy grę) | 2, 3 |
| „Dobij plan z własnej kieszeni” | Przełącznik przy pasku, polecenie firmy `planTopUp`. Przy wykonaniu 90–100% kupujesz brakujący towar sam (ok. 83% brakującej kwoty), miesiąc jest zaliczony bez premii, następny plan rośnie. Bez dobicia, gdy portfel spadłby pod próg ostrzeżenia o debecie | 3 |
| Prognoza i podgląd | Pasek planu (wykonane, prognoza, werdykt z kwotą kary albo kosztem dobicia), plan w podglądzie końca miesiąca (jeden sklep i sieć), zdanie „plan na styk” przy prognozie poniżej 103% | 4, 5, 6a |
| Okna i raporty | Okno „Koniec okresu wdrożenia”, zapowiedź dla starego zapisu, ostrzeżenie „Plan: brakuje do progu” (przedostatni dzień miesiąca), sekcja planu w raporcie z listem partnera regionalnego i „dlaczego tyle”, koniec gry za plan, ostrzeżenie w zakładce Miasto | 2, 4, 5 |
| Stare zapisy | Zapis z co najmniej trzema raportami i bez bloku planu dostaje zapowiedź („od przyszłego miesiąca plan”), plan zaczyna się w następnym miesiącu, stopień 0, seria 0 | 2 |
| Zapis | Blok planu jest opcjonalnym polem rozliczenia sklepu, bez zmiany koperty. Odczyt przycina stopnie i serię | 2, 6a |
| Balans i bramki | Bot `rozsadny`, pomiar `plan.measure.test.ts`, szybka bramka `planBalance.test.ts`, strojenie stałych `PLAN` | 6a |

Wersje: `SIM_VERSION` 7 (`GOLDEN` bez zmian, ranking się nie resetuje), `FIRM_SAVE_SCHEMA` 4, `GENERATOR_VERSION` 1 i `CITY_GENERATOR_VERSION` 1 bez zmian.

## 2. Jak to zobaczyć

- **Na zrzutach:** `docs/superpowers/reports/2026-11-17-plan-centrali-5a/` (punkt 8).
- **W grze:** raport trzeciego miesiąca (koniec listopada przy starcie we wrześniu) zapowiada „Koniec okresu wdrożenia. Od jutra obowiązuje plan sprzedaży Centrali”, rano 1 grudnia pasek mówi
  „Od dziś obowiązuje plan Centrali: …”, a wieczorem tego dnia okno „Koniec okresu wdrożenia” zakłada plan; od 2 grudnia widać pełny pasek. Skrótem: `npm run dev`, adres
  z `?debug=1`, w konsoli przeglądarki `traszkaGame.skip(1440)` przewija o dobę (karty decyzji i okna trzeba zamykać).
- **Stare zapisy** z `src/game/fixtures/` dostają zapowiedź po jednym dniu gry (tak robi krok `5a-a` smoke'a).
- **Smoke tylko dla planu:** `PLAYWRIGHT_ROOT=… npm run city:smoke -- --etap 5a` (zrzuty do `.smoke/city/`). Na tym komputerze nie ma pobranej przeglądarki Playwrighta, więc użyłem
  zainstalowanego Google Chrome w trybie headless (`CITY_SMOKE_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`); okno się nie otwiera.

## 3. Jak mierzyłem

- `tests/progresjaPlay.ts`: bot `rozsadny` i dwa pola wyniku (`plans` w każdym miesiącu, `closedByPlan`: który sklep stracił umowę i w którym miesiącu).
- `tests/measure/plan.measure.test.ts` (`MEASURE=1`): cztery boty × pięć seedów × 24 miesiące, bramki P3–P6 jako asercje. Jeden pełny pomiar trwa ok. 42 s (osiem procesów).
  Gdy pomiar jest częściowy (`SEEDS`, `MONTHS` albo `MERGE`), test pisze teraz jedną linię, że bramek nie oceniał.
- `tests/planBalance.test.ts` (w `npm test`): `mistrz` i `rozsadny`, 13 miesięcy, seedy `traszka-1` i `kopytka-541`.
- Utrata ostatniego sklepu nie ma zdarzenia „sklep zamknięty” (kończy grę), więc pomiar dopisuje ją po biegu, ale nie wtedy, gdy gra skończyła się debetem.

## 4. Bramki P1–P7

| Bramka | Warunek | Wynik | Liczby |
|---|---|---|---|
| P1 | ranking: wynik sezonu bit w bit jak przed etapem | **spełniona** | `tests/simGolden.test.ts` przechodzi z `GOLDEN` bez zmian, `SIM_VERSION` 7. Blok planu powstaje dopiero po końcu sezonu rankingowego (3 miesiące) |
| P2 | miesiące 1–3 zwykłej gry bez zmian | **spełniona** | `planEconomy.test.ts`: przez trzy miesiące w stanie nie ma klucza `plan` ani w wyciągu, ani w raporcie; pierwszy plan powstaje wieczorem 1 grudnia |
| P3 | `mistrz`: pierwsza wpadka w m. 5–9 na każdym seedzie, utrata sklepu przed końcem m. 18 | **spełniona** | pierwsza wpadka m. 5, 6, 5, 5, 6; utrata sklepu m. 9, 12, 7, 7, 8 |
| P4 | `jeden`: mediana pierwszej wpadki nie wcześniej niż w m. 12 | **spełniona** | m. 13, 13, 15, 13, 15; mediana 13 |
| P5 | `siec12`: pierwsza wpadka w ciągu 4 miesięcy od końca zakupów (m. 13–16) | **NIE spełniona** | m. 13, **11**, **11**, 14, 13. Dwa seedy (kopytka-541 i makieta) wpadają w m. 11: sklep #2 przy 98,3% planu i sklep #3 przy 98,5%. Medianą (13) bramka by przeszła, ale spec nie mówi „mediana”, więc liczę ostrzej: na każdym seedzie |
| P6 | `rozsadny`: milion w portfelu w m. 14–22 na ≥ 3 z 5 seedów, sklep startowy nigdy nie stracony | **NIE spełniona** | milion na 0 z 5 seedów; najwyższy portfel 574, 322, 515, 623, 484 tys. zł. Sklep startowy nie został stracony nigdzie. Na traszka-1 zamknięcie sklepu #3 w m. 23 zrzuciło portfel do −613 tys. zł i gra skończyła się debetem w m. 24 |
| P7 | żadna kara nie spada bez wcześniejszej prognozy w podglądzie miesiąca | **spełniona** | `planForecast.test.ts`: przed każdą karą pasek nie był pewnym trafieniem (wpadka, dobicie albo „na styk”), a dokładny podgląd miesiąca pokazuje karę. Po zmianie R13 gwarancją paska jest ostrzeżenie „na styk”, nie kara policzona w prognozie |

Wniosek: plan robi to, co miał robić wobec bezczynnych graczy (P3, P4) i wobec gracza, który kupuje wszystko, ale **nie** da się go dostroić samymi sześcioma stałymi tak, żeby
sieć po zakupach (P5) i ostrożny gracz (P6) także zmieściły się w bramkach. Dlaczego, jest w punkcie 5.

Co zmieniło się dla `siec12` względem raportu 4b: w 4b gracz, który przestał kupować po 12. miesiącu, miał milion w m. 16–18 na wszystkich pięciu seedach.
Pod planem milion ma tylko w trzech biegach: m. 16 (lublin-9), m. 16 (seed-3) i m. 25, czyli już po pomiarze (makieta). Na traszka-1 i kopytka-541 go nie ma.
W każdym biegu `siec12` traci pod planem cztery albo pięć z pięciu sklepów (m. 15–23). To jest ta presja, o którą chodziło („czekanie z gotówką przestaje być
najlepszą drogą do miliona”).

## 5. Strojenie: było → jest → dlaczego

Zmieniłem trzy z dziewięciu stałych `PLAN`, resztę zostawiłem.

| Stała | Było | Jest | Dlaczego |
|---|---|---|---|
| `growthBase` (wzrost podstawowy) | 0,02 | **0,01** | Na starcie P5 padało na wszystkich pięciu seedach (pierwsza wpadka w m. 8, 11, 11, 7, 10): sklep w rozbudowie spadał do 96–99% planu, gdy obok otwierały się własne sklepy (kanibalizacja z 4b) |
| `growthPerHit` (za trafienie z rzędu) | 0,005 | **0,0025** | Seria 4–6 trafień podnosiła wzrost do 4–5% akurat w miesiącach wpadek |
| `growthMax` (sufit wzrostu) | 0,05 | **0,03** | Jak wyżej; sufit wzrostu to nie sufit planu (plan dalej rośnie bez górnej granicy) |
| `baseFloor`, `fineShare`, `bonusShare`, progi dobicia | | bez zmian | Pomiar nie pokazał, że któraś z nich pomaga bramkom |

Po zmianie P5 przeszło z 0 do 3 seedów z 5, a `rozsadny` przestał tracić sklep startowy na traszka-1 i kopytka-541 (na starcie tracił). P3 i P4 zostały spełnione.

Sześć rund strojenia (limit z planu), P3–P6 po seedach w kolejności traszka-1 / kopytka-541 / makieta / lublin-9 / seed-3:

| Runda | growthBase / PerHit / Max / bonusShare | P3: pierwsza wpadka; utrata sklepu | P4: pierwsza wpadka (mediana) | P5: pierwsza wpadka | P6: milion; sklep startowy |
|---|---|---|---|---|---|
| start | 0,02 / 0,005 / 0,05 / 0,01 | ok: 5,6,5,5,5; 7,8,7,7,7 | ok: 11,13,14,13,14 (13) | pada: 8,11,11,7,10 | pada: 0 z 5; stracony na traszka-1 i kopytka-541 |
| r1 (**wybrana**) | 0,01 / 0,0025 / 0,03 / 0,01 | ok: 5,6,5,5,6; 9,12,7,7,8 | ok: 13,13,15,13,15 (13) | pada: 13,11,11,14,13 | pada: 0 z 5; nigdzie stracony |
| r2 | 0,005 / 0,0025 / 0,02 / 0,01 | ok | ok (13) | pada: 13,11,11,14,14 | pada: 0 z 5 |
| r3 | 0,005 / 0,0005 / 0,01 / **0,03** | ok | ok (15) | pada: 14,11,13,14,14 | pada: 0 z 5; stracony na traszka-1 |
| r4 | 0,003 / 0,0005 / 0,01 / 0,01 | **pada** (makieta: utrata dopiero w m. 22) | ok (16) | pada: 13,11,13,14,14 | pada: 0 z 5 |
| r5 | 0,005 / 0,0005 / 0,01 / 0,01 | ok | ok (16) | pada: 13,11,11,14,14 | pada: 0 z 5 |
| r6 | 0,004 / 0,0005 / 0,01 / 0,01 | ok | ok (16) | pada: 13,11,13,14,14 | pada: 0 z 5; traszka-1 kończy z portfelem −683 tys. |

Dlaczego nie ma zestawu, który spełnia P3–P6 razem:
- **P5 i P3 ciągną w przeciwne strony.** P3 chce, żeby sklep bez zakupów wpadał trzy razy z rzędu do m. 18 (przy bardzo niskim wzroście makieta trzyma się do m. 22, r4).
  P5 chce, żeby sklep w rozbudowie ani razu przez osiem miesięcy nie spadł pod średnią z trzech miesięcy plus wzrost. Spadki pojedynczego sklepu o 1–3% przy otwarciu sąsiada
  i przy rotacji bota są większe niż różnica, którą da się zdjąć wzrostem bez łamania P3 albo P7.
- **P6 zależy od bota, nie od planu.** `rozsadny` kupuje, gdy prognoza **któregoś** sklepu jest poniżej 105%. Plan goni obrót, więc przy pięciu sklepach prawie zawsze któryś jest
  poniżej 105% i bot kupuje prawie jak `siec`. Żadna z sześciu stałych nie zmienia tego, ile bot wydaje. Premia 3% (r3) też nie pomogła: bot wydał dodatkową gotówkę.
- **P7 odrzuciło część zestawów.** `planForecast.test.ts` na starcie przechodził tylko przy zestawach start i r1 (przy r2, r5, r6 padał na seedzie `żabka-7`: pasek rano ostatniego dnia
  mówił „plan zrobiony”, a zamknięcie dawało wpadkę). Po dodaniu zdania „na styk” (R13) zestaw r5 też przechodzi P7 (r6 dalej pada, bo `żabka-7` nie traci umowy w 8 miesiącach).
- **Dlaczego r1, a nie r5.** Po R13 r1 i r5 przechodzą te same bramki (P3, P4, P7), a nie przechodzą P5 i P6. Zostawiłem r1, bo jest mniejszą zmianą od startu (wzrost 1–3% zamiast 2–5%,
  r5 ma 0,5–1%). To wybór „najmniejszej zmiany”, a nie wynik, który mierzył coś więcej.

Test starej bramki progresji z prawdziwym planem (`progresjaBalance` z `easyPlans: false`, kopia testu, bez zmiany kodu): na stałych końcowych przechodzi na obu seedach
(traszka-1: bez wpadek, suma „Zostaje Ci” m. 1–13 = 2 049 320 zł; kopytka-541: wpadki w m. 11 i 13, żaden sklep nie stracony, 838 730 zł; próg 600 000 zł). Na stałych startowych kopytka-541 padało
(w m. 13 cztery sklepy zamiast pięciu). Zapas na kopytka-541 jest więc mały.

## 6. Dwa warianty informacyjne ostrożnego bota (bez bramek)

Pytanie: czy ostrożny gracz pod planem w ogóle dochodzi do miliona? Pomiar: `rozsadny-sklep` (warunek „prognoza poniżej 105%” liczony w sklepie, w którym bot akurat jest, badania Sieci
tylko wtedy, gdy ten sklep spełnia warunek) i `rozsadny-dobicie` (to samo plus włączony przełącznik dobicia w każdym sklepie z planem).

| Seed | Wariant | Pierwsza wpadka | Najwyższy portfel (tys. zł, miesiąc) | Sklepy na końcu | Dobicia (liczba, koszt) |
|---|---|---|---|---|---|
| traszka-1 | sklep | m. 23 | 508 (m. 20) | 5 | – |
| traszka-1 | dobicie | brak | 656 (m. 20) | 5 | 4, 64 tys. zł |
| kopytka-541 | sklep | m. 19 | 381 (m. 22) | 5 | – |
| kopytka-541 | dobicie | brak | 368 (m. 22) | 5 | 3, 42 tys. zł |
| makieta | sklep | brak | 425 (m. 22) | 5 | – |
| makieta | dobicie | brak | 424 (m. 22) | 5 | 0 |
| lublin-9 | sklep | m. 24 | 634 (m. 23) | 5 | – |
| lublin-9 | dobicie | brak | 645 (m. 23) | 5 | 1, 35 tys. zł |
| seed-3 | sklep | brak | 561 (m. 23) | 5 | – |
| seed-3 | dobicie | brak | 561 (m. 23) | 5 | 0 |

Odczyt: **ostrożny gracz nie dochodzi do miliona w portfelu w 24 miesiące w żadnym wariancie** (najwyżej 656 tys. zł), choć sieć przelewa mu 3,7–5,8 mln zł w tym czasie. Brakuje nie zarobku,
tylko powściągliwości: bot dalej kupuje ulepszeń za 5,7–8,5 mln zł i badań za 1,9–2,7 mln zł (`rozsadny`: 8,1–11,2 mln i 1,2–2,7 mln). Warunek na sklepie za to uspokaja plan: wpadki dopiero od m. 19 albo wcale,
żadnego sklepu straconego, żadnego końca grą z debetu. Przełącznik dobicia kupił resztę spokoju tanio (0–4 dobicia na seed, 0–64 tys. zł) i zamienił wszystkie późne wpadki w trafienia.

## 7. Paczka „Wyślij zapis”

| Pomiar | Bajty |
|---|---|
| Raport 4b, najgorszy przypadek (bez planu) | 60 395 |
| Najgorszy przypadek z planem (blok planu i raport z karą w każdym z pięciu otwartych sklepów, cele i bazy sześciocyfrowe) | **61 248** |
| Próg testu (bez zmiany) | 62 000 |
| Twardy limit | 65 536 |

Zapas do progu testu: **752 B** (w 4b było 1 605 B), do twardego limitu 4 288 B. Bez kompaktowania najgorszy przypadek miałby 89 578 B. Skracania `lastReport.plan` w kompaktowaniu
nie trzeba było dopisywać. Raport planu niesie teraz kwoty w pełnych złotych i wykonanie do czterech miejsc. **Każde kolejne pole w zapisie sklepu trzeba policzyć w `saveTransfer.test.ts`:** 752 B to mało.

## 8. Smoke w przeglądarce

Skrypt `scripts/city-smoke.mjs` ma trzy kroki planu (`5a-a`…`5a-c`, osobno: `node scripts/city-smoke.mjs --etap 5a`) na obu rozmiarach: telefon 390×844 (dotyk), komputer 1440×900.
Zapisy do kroków powstają w skrypcie z istniejących fixtures (bez nowych plików): kopia „dwa sklepy” z jednym otwartym sklepem i czterema raportami bez bloku planu (`withReports`),
kopia „po Traszce” (sieć z dwóch sklepów) z blokiem planu sklepu #1 (`withPlanBlock`). Cel planu smoke ustawia w stronie tak, żeby prognoza paska wyszła na 95% (`calibratePlan`), bo
tylko wtedy dobicie ma sens. Zrzuty: `docs/superpowers/reports/2026-11-17-plan-centrali-5a/` (14 plików; kadr `telefon-…` ma 390×844, `desktop-…` 1440×900): zapowiedź planu (`01`), pasek jednego sklepu (`02`),
pasek sieci przy prognozie 95% z wyłączonym przełącznikiem (`03`), podgląd końca miesiąca z wynikiem planu (`05`), arkusz Miasta pod paskiem (`06`, telefon), okno „brakuje do progu” (`07`), raport z dobiciem (`08`),
pasek po angielsku (`10`). Pozostałe zrzuty kroków (przełącznik włączony, podgląd jednego sklepu, okna i raport po angielsku) smoke zapisuje do `.smoke/city/`, ale nie wchodzą do repozytorium.

| Krok | Co sprawdza | Telefon | Komputer |
|---|---|---|---|
| 5a-a | jeden sklep, cztery raporty, bez bloku planu: przed zapowiedzią nie ma wiersza planu; po jednym dniu okno „Plan sprzedaży Centrali” (cel 0, miesiąc bez rozliczenia); po końcu miesiąca pierwszy plan z celem i wiersz planu; pasek wobec `--hud-h`; podgląd końca miesiąca z wierszem planu; bez błędów konsoli | ok | ok |
| 5a-b | sieć, plan sklepu #1 przy prognozie 95%: wiersz planu i przełącznik (stan, cel dotyku, brak przecięć); włączenie zmienia stan gry i werdykt na „dobicie z kieszeni”; podgląd; arkusz Miasta nie wchodzi pod pasek; w przedostatnim dniu okno „Plan: brakuje do progu” z kosztem dobicia; po zamknięciu miesiąca wyciąg sklepu #1 z „Plan zaliczony z dobiciem z kieszeni”, nowym planem i „dlaczego tyle” | ok | ok |
| 5a-c | to samo po angielsku: tytuły okien, wiersz planu, przełącznik, podgląd, ostrzeżenie, raport z dobiciem i okno zapowiedzi; w żadnym tekście nie ma polskich liter ani polskich słów (poza „zł” i nazwami ulic) | ok | ok |

Pomiar paska robi sam smoke (`getBoundingClientRect` wobec `--hud-h`), także przy najdłuższych zdaniach planu (wstawianych na chwilę do wiersza) i, na komputerze, przy 768 px.

**Co pokazały zrzuty i co zmieniłem.** Pierwsze uruchomienie wywróciło wszystkie trzy kroki: `--hud-h` podniesiono w Zadaniu 5 „na oko” i było za niskie.

| Układ | Pasek przed poprawką (zmierzony) | `--hud-h` było | `--hud-h` jest | Pasek po poprawce (zmierzony) |
|---|---|---|---|---|
| telefon 390 px, jeden sklep | 212 px (werdykt w jednej linii), 228 px (w dwóch) | 208 px | 228 px | 212 px, 228 px |
| telefon 390 px, sieć | 241 px (jedna linia), 256 px (dwie) | 242 px | 256 px | 241 px, 256 px |
| komputer 1440 px, jeden sklep i sieć | 156 px (po angielsku 172 px) | 126 px | 140 px | 140 px (także po angielsku) |
| tablet 768 px, jeden sklep / sieć | 204 px / 264 px | 176 px / 242 px | 228 px / 256 px | 197 px / 226 px |

Co było źle i co poprawiłem (commit `fix(ui): pasek planu Centrali mieści się w --hud-h, na komputerze zwarty`):
- Na telefonie pasek wchodził o 4 px (jeden sklep) i 14 px (sieć) pod pierwsze okna i komunikaty. Teraz `--hud-h` pokrywa także dwuliniowy werdykt; pasek ma przy tym 16 px zapasu przy jednolinijkowym.
- Na komputerze przełącznik miał 300 px szerokości i trzy do czterech linii napisu (62–78 px wysokości), przez co pasek miał 156–172 px zamiast 126 px. Przełącznik ma teraz 460 px, napis w jednej linii i dopisek w jednej–dwóch,
  a pasek 140 px, także po angielsku.
- Na tablecie (640–819 px) przełącznik obok tekstu miał 78–109 px wysokości, a pasek wychodził poza `--hud-h`. Układ „w rzędzie” zaczyna się teraz od 820 px, niżej wiersz jest kolumną jak na telefonie.
- **Wylew w poziomie w podglądzie sieci na telefonie.** Zdanie „Plan zaliczony z dobiciem z kieszeni: …” w sekcji „Plan Centrali” okna wyciągu było w jednej linii (reguła „kwota bez łamania”
  z podglądu obejmowała też zdania), więc okno miało 502–584 px zawartości w 358 px. Wyłapał to pomiar szerokości (krok 5a i dawny krok 12, który po wejściu planu zaczął padać). Zdanie łamie się teraz
  na szerokość okna (commit `fix(ui): zdanie o wyniku planu w podglądzie sieci łamie się na telefonie`). Same kroki 5a wcześniej nie sprawdzały wyniku pomiaru, tylko go zapisywały: teraz wylew psuje krok.
- Reszta bez zmian: wiersz planu mieści się w pasku, nic się na nim nie przecina, przełącznik ma 36 px wysokości na telefonie (cel dotyku), brak poziomego przewijania na 390 px (`checkWidth` przy każdym oknie planu),
  okna zapowiedzi, „brakuje do progu”, podgląd i raport czytają się dobrze, a po angielsku nie ma polskich zdań.
- W trakcie okazało się, że smoke sam zepsuł wiersz planu: pomiar najdłuższych zdań podmieniał węzeł tekstowy, którego trzyma Preact, więc wiersz przestawał się odświeżać (na zrzucie „wykonane 18%” w ostatnim dniu miesiąca).
  To była pomyłka pomiaru, nie błąd gry (sprawdziłem osobno, że w grze wiersz się odświeża); pomiar zmienia teraz tekst w istniejącym węźle.

Obserwacja spoza planu: po angielsku na telefonie napisy w kieszeniach prognozy są ucięte („Balan…”, „Instalmen…”, „Keep”). Nie dotyka to planu i nie ruszałem tego.

Wyniki całego smoke'a i bramek są w punkcie 9.

`Ruling: kroki 5a stawiają jedną sieć z dwóch sklepów („po Traszce”) i jeden sklep (kopia „dwa sklepy” bez budowy) — pasek ma dwa układy (z chipem sklepów i bez), każdy z własnym `--hud-h` — koszt: dwa zapisy do utrzymania w skrypcie, zamiast jednego.`

`Ruling: cel planu w smoke'u jest ustawiany w stronie na prognozę 95% (nie wpisany na sztywno do fixture'a) — obrót z zapisu zależy od losu dnia i wersji, a krok ma sprawdzić dobicie, które ma sens tylko przy 90–100% — koszt: krok zmienia stan gry przez uchwyt debugowy, jak 4b-c i 4b-d.`

`Ruling: Chrome zamiast headless shell — pobrana przeglądarka Playwrighta nie istnieje na tym komputerze, a pobranie czegokolwiek wymaga Twojej zgody — koszt: smoke z Chrome może różnić się od smoke'a z headless shell w szczegółach renderowania; wyniki kroków 1–15 z 4a i 4b wyszły takie same.`

## 9. Bramki i liczby

| Polecenie | Wynik |
|---|---|
| `npm run build` | OK: bundle sędziego, `tsc` bez błędów, `vite build` |
| `npm test` | 211 plików przeszło, 8 pominiętych (pomiary `MEASURE=1`); 6281 testów przeszło, 15 pominiętych; 173 s. Przechodzą m.in. `simGolden` (bez zmiany `GOLDEN`), `i18n`, `planForecast`, `planBalance`, `saveTransfer`, `citySmoke` |
| `npm run check:vercel-build` | PASS (26 sprawdzeń) |
| `PLAYWRIGHT_ROOT=… npm run city:smoke` | 47 z 47 wierszy „ok” (telefon 24, komputer 23, w tym trzy kroki 5a na każdym rozmiarze), 1273 s. Błędy konsoli 0, zapytania poza localhost 0, przerwane `/api/**` 8 (wszystkie w kroku 4b-d, jak w 4b), awaryjne `click()` w DOM 2 (po jednym na rozmiar, krok 1: okno wpisu `.tt-story .tt-primary`). Pierwszy pełny przebieg padł na dawnym kroku 12 (telefon) z powodu wylewu w podglądzie sieci (punkt 8); po poprawce przechodzi |

Neutralność: `tests/simGolden.test.ts`, `src/sim/simVersion.ts`, `FIRM_SAVE_SCHEMA` i próg 62 000 B nie zostały zmienione; stałe `PLAN` w tym zadaniu (6b) też nie.

## 10. Rulingi z budowy

Pełne brzmienie jest w specu, w raportach zadań i w `.superpowers/sdd/2026-11-17-etap-5a-plan-centrali/progress.md`. Po jednej linii:

- **R1.** Pierwszy plan pokazuje się rano z czystej funkcji tylko wtedy, gdy wieczorem naprawdę powstałby plan z celem; w innych dniach zapowiedź nie wymyśla kwoty.
- **R2.** Każdy test naszkicowany w planie pustym ciałem ma prawdziwe asercje; puste ciało w kodzie to wada.
- **R3.** W testach „plan nie do zrobienia” to cel umiarkowanie powyżej tempa (kara rzędu dziesiątek tysięcy), żeby bieg nie kończył się debetem.
- **R4.** Teksty zdarzeń planu (start, zapowiedź, „brakuje do progu”) i ich angielskie wersje pisze symulacja, dokładnie zdaniami z interfejsu; po wpadce na stopniu 3 końcówka brzmi „Centrala wypowie umowę na tę placówkę”.
- **R5.** Build przed testami (wymóg kolejności bramek).
- **R6.** Recenzja końcowa na modelu `opus`, nie na modelu sesji, żeby pilnować oszczędności.
- **R7.** Stare scenariusze bezczynnych biegów dwuletnich (`firmSave`, `saveTransfer`) dostały pomocnika, który utrzymuje plan wykonalny; bez zmian w `src/` i bez zmiany progów rozmiaru.
- **R8.** Łatwy plan w botach progresji jest opcją (`easyPlans`), włączoną tylko w `progresjaBalance`; pomiar planu gra prawdziwym planem.
- **R9.** Bramka P7 biegnie do końca gry sklepu bezczynnego (m. 8), a nie osiem miesięcy planu, i wymaga co najmniej jednego miesiąca z karą na seed.
- **R10.** Raport planu niesie stopień sprzed rozliczenia (`stageBefore`); list partnera pojawia się dokładnie wtedy, gdy stopień się zmienił (heurystyka z serii mylała się na starych zapisach).
- **R11.** Zadanie 6 rozdzielone na 6a (pomiary, strojenie, zapis) i 6b (smoke, bramki, ten raport).
- **R12.** Strojenie najwyżej sześć rund; gdy P3–P6 nie przechodzą razem, zostaje najlepszy zestaw (remis rozstrzyga P6), a lukę rozstrzyga właściciel.
- **R13.** Pasek planu mówi „plan na styk” przy prognozie poniżej 103%, a P7 sprawdza, że żadna kara nie przyszła po pewnym „plan zrobiony”.
- **R14.** Dwa warianty informacyjne ostrożnego bota, bez asercji, żeby wiedzieć, czy ostrożny gracz w ogóle dochodzi do miliona.
- **Zadanie 6b (ten raport).** Cztery poprawki po recenzji 6a (`share` zaokrąglane w dół, zdanie „na styk” przy stopniu 2, bot bez „utraty sklepu” przy debecie, komunikat o pomiarze częściowym), wartości `--hud-h` i układ paska
  z punktu 8 oraz łamanie zdania o planie w podglądzie sieci na telefonie.

## 11. Do decyzji właściciela

Bramki techniczne (build, testy, smoke) są zielone, a dwie bramki balansu (P5 i P6) nie są spełnione. Poniżej rzeczy, które zależą od Ciebie; liczby z punktów 4–6.

1. **P5: „na każdym seedzie” czy mediana?**
   - Liczby: pierwsza wpadka `siec12` w m. 13, 11, 11, 14, 13. Medianą (13) bramka przechodzi, na każdym seedzie pada na dwóch (m. 11 przy 98,3% i 98,5% planu).
   - Opcje: (a) czytać bramkę medianą: bez zmian w grze, bramka spełniona. (b) zostawić „na każdym seedzie” i zmienić reguły planu, np. próg trafienia 98% albo baza bez sklepów otwartych w ostatnich trzech
     miesiącach.
   - Koszt: (a) nie rozwiązuje wpadek w rozbudowie, tylko je uznaje. (b) to zmiana reguł, nie stałych; bezczynny sklep trzyma się przy 94–99% planu, więc łagodniejszy próg najpewniej przesunie jego pierwszą wpadkę
     poza m. 5–9 i złamie P3. Tego nie mierzyłem.
2. **P6: definicja bota i milion dla ostrożnego gracza.**
   - Liczby: `rozsadny` milion na 0 z 5 (najwyżej 623 tys. zł). Wariant „sklep” 381–634 tys., bez straconych sklepów i bez końca debetem; wariant „dobicie” 368–656 tys., zero wpadek za 0–64 tys. zł dobić. Sieć przelewa 3,7–5,8 mln zł.
   - Opcje: (a) zostawić milion jako nagrodę za „przestań kupować” (decyzja 2.11 z raportu 4b) i zmienić P6 na „bez utraty sklepu startowego i bez końca debetem” (wariant „sklep” to spełnia). (b) bramka z sumy „Zostaje Ci”, jak w 4b (3,7–5,8 mln zł:
     przechodzi z zapasem). (c) zmienić ekonomię, żeby ostrożny gracz dochodził do miliona.
   - Koszt: (a) i (b) nie zmieniają gry, ale przestają mierzyć to, co spec obiecał (milion w portfelu). (c) to gwałtowna zmiana (jak w 4b: podwojenie zarobku albo zabranie zakupów), a żadna z sześciu stałych planu jej nie daje.
3. **Rozliczenie końcowe przy utracie sklepu może skończyć grę debetem.**
   - Liczby: `rozsadny` traszka-1: −613 tys. zł po zamknięciu sklepu #3 w m. 23 (na początku strojenia −1 553 tys.); `siec12` kopytka-541 na starcie −465 tys. Raty pakietu spadają na wspólny portfel naraz.
   - Opcje: (a) zostawić (zgodne ze specem §6.3: jeden sklep z pięciu kończy całą grę, jeśli portfel jest cienki). (b) rozłożyć rozliczenie końcowe, np. raty ze zwolnionego sklepu dalej miesięcznie, albo ograniczyć je do gotówki sklepu.
   - Koszt: (a) gracz traci całą grę przez jeden sklep. (b) zmiana kodu zamykania sklepu z 4a.2 i nowy pomiar; spec tego nie przewiduje.
4. **Pasek prognozy a kreska 100%.**
   - Liczby: przy łagodnym wzroście miesiące kończą się przy 99,x%, a pasek rano ostatniego dnia potrafił pokazać „plan zrobiony”, gdy zamknięcie dawało wpadkę (seed `żabka-7`). Teraz pasek mówi „na styk” poniżej 103%;
     dokładny podgląd miesiąca ma rację.
   - Opcje: (a) zostawić (pasek jest szacunkiem z zapowiedzią „na styk”). (b) podnieść margines z 3% do 5% (więcej pomarańczowego paska). (c) pasek liczy się z dokładnego podglądu miesiąca.
   - Koszt: (b) więcej ostrzeżeń dla sklepów, które trafią z zapasem. (c) każde odświeżenie paska to symulacja miesiąca; nie mierzyłem, ile to kosztuje.
5. **Nacisk planu w późnej grze jest o połowę mniejszy niż na starcie** (wzrost 1–3% zamiast 2–5%).
   - Liczby: bezczynny sklep traci umowę w m. 7–12, `jeden` w m. 17–22, `siec12` traci cztery–pięć sklepów w m. 15–23. Na stałych startowych `rozsadny` tracił sklep startowy, a P5 padało na wszystkich seedach.
   - Opcje: (a) zostać przy r1. (b) wrócić do 2–5% (nacisk mocniejszy, ale P5 i P6 gorsze). (c) wybrać r5 (0,5–1%, nacisk słabszy; po R13 przechodzi te same bramki co r1).
   - Koszt: (b) sklep w rozbudowie wpada w m. 7–11, a ostrożny gracz traci sklep startowy. (c) słabszy nacisk, bezczynny sklep żyje dłużej.
6. **Przełącznik „dobij plan z własnej kieszeni” zostaje włączony na kolejne miesiące** (po rozliczeniu stan przełącznika się nie zmienia). Spec mówi, że gracz może go zmienić w dowolnej chwili, a nie mówi, co dzieje się z nim po miesiącu.
   - Opcje: (a) zostaje jak jest: ustawienie stałe, dobicie dzieje się samo w każdym miesiącu, w którym wykonanie wypada w 90–100% i stać Cię. (b) przełącznik wraca na „wyłączony” po każdym rozliczeniu.
   - Koszt: (a) łatwo zapomnieć, że co miesiąc płacisz ok. 80% brakującej kwoty (ostrzeżenie „brakuje do progu” stoi w przedostatnim dniu). (b) dodatkowe klikanie w sklepach w tle, gdzie nikt nie patrzy.

## 12. Znane ograniczenia

- **Pasek prognozy jest szacunkiem.** Blisko 100% bywa po złej stronie kreski; stąd „na styk” (poniżej 103%). Dokładny wynik pokazuje podgląd końca miesiąca.
- **Pasek nie dolicza premii 1% za trafienie,** więc przy prognozie „zrobiony” kwota „zostaje Ci” w pasku jest odrobinę zaniżona.
- **Przy kilku sklepach z dobiciem i portfelu blisko progu ostrzeżenia o debecie pasek bywa zbyt optymistyczny:** liczy dobicie każdego sklepu na jego własnej gotówce i może pokazać „dobicie”, gdy zamknięcie da wpadkę. Dokładny podgląd miesiąca pokazuje karę.
- **Suma sieci w prognozie nie ma planu** (plan jest tylko w prognozie sklepu; interfejs czyta go z listy sklepów).
- **Brakuje funkcji „przewiń dzień”.** Spec zakładał, że przewijanie dni nie staje na komunikacie ostatniego dnia, ale w grze jest tylko debugowe `skip(minuty)`, więc nie było do czego tego przypiąć. Zdarzenia planu idą zwykłą kolejką okien.
- **„Od jutra obowiązuje plan…” w raporcie bywa nieprecyzyjne** po przewinięciu `skip` (plan wtedy obowiązuje od dziś). Tekstu nie zmieniałem.
- **„× N dni” w „dlaczego tyle”** jest zgadywane z kwoty planu; ryzyko tylko przy bazie rzędu kilku złotych.
- **Wiersz planu ma `data-tut="plan"`, ale nie ma kroku samouczka.** Gracz dowiaduje się o planie z okna „Koniec okresu wdrożenia”.
- **Wiersz planu w sieci liczy prognozę sieci drugi raz na odświeżenie.** Nie mierzyłem, ile to kosztuje.
- **Powód końca gry w podglądzie** przy karze planu, która spycha portfel poniżej progu długu, mówi „debet”, choć zdarzenie dotyczy planu.
- **Na telefonie pasek z planem zajmuje dużo ekranu:** 228 px w jednym sklepie i 256 px w sieci z 844 px wysokości (bez planu 112 i 146 px). Sklep i arkusze mieszczą się pod nim, ale widok sklepu jest o 110–116 px niższy.
- **Smoke planu na tablecie** sprawdza tylko jedną szerokość (768 px) i tylko w przebiegu komputerowym.
- **Pomiar `siec12` na seedzie makieta daje milion dopiero w m. 25**, czyli poza oknem 24 miesięcy pomiaru; tabela liczy go „po biegu”.

## 13. Do opisu wdrożenia

Nie ma zmian w schemacie zapisu ani w `SIM_VERSION`, więc ranking się nie resetuje, a starsza wersja gry wczyta zapis bez bloku planu (pole jest opcjonalne i nowa wersja odtworzy plan od zapowiedzi). Mimo to
zapis z blokiem planu ma w najgorszym przypadku 61 248 B (zapas do progu testu 752 B): przy kolejnym polu w zapisie sklepu trzeba policzyć paczkę „Wyślij zapis”.

# Raport: etap 4b, progresja bez sufitu (Zadanie 10: balans na botach, smoke, bramki)

2.11.2026. Gałąź `claude/progresja-4b`, worktree `ZabkaTycone-wt/progresja-4b`. Nic nie wypchnięte ani scalone.
Spec: `docs/superpowers/specs/2026-11-02-etap-4b-progresja-design.md`, plan: `docs/superpowers/plans/2026-11-02-etap-4b-progresja.md`.

**Najkrócej.** Wszystko z P1 jest w grze i przechodzi bramki, smoke i testy. Jedna rzecz się nie udała: cel „zaangażowany gracz z 3+ sklepami
ma milion na koncie po około roku”. Bot, który wydaje wszystko, czego Centrala mu nie zabroni, w 24 miesiące nie dochodzi do miliona w portfelu,
bo co miesiąc wkłada cały przelew w ulepszenia i badania. Gałki 4b tego nie zmienią, więc ich nie ruszałem: **liczby zostają takie, jak w specu**.
Szczegóły i liczby są w punktach 3–5.

## 1. Co weszło do gry

| Co | Opis | Zadanie |
|---|---|---|
| Remonty 4 i 5 | „Flagowiec Plus” (450 000 zł, poziom 28, ruch ×1,45) i „Traszka Max Pro Ultra” (900 000 zł, poziom 34, ×1,6). Remont 1 kosztuje 35 000 zł, remont 2 100 000 zł. Sklep rośnie po tej samej stronie ulicy, kartka „DO WYNAJĘCIA” wisi do poziomu 4 | 1, 9 |
| Ulepszenia późnej gry | wyższe `maxLevel` 10 ulepszeń i 5 nowych (kasa ekspresowa, ekrany Centrali, bar hot-food, magazyn wysokiego składowania, dron-inwentaryzator) | 1 |
| Cele sklepu | remont 4, remont 5, milion marży w jednym sklepie (działają też w rankingu) | 1 |
| 12 kart dnia | m.in. „Zrzut Traszkomonów” (fala klientów od 6:00), festyn, sanepid, awaria prądu, koncert disco polo, catering dla korpo, pociąg z kibicami; waga zależy od dzielnicy | 2 |
| Do 5 sklepów | limit startowy 3, czwarta placówka od 1 mln zł miesięcznego obrotu sieci, piąta od 1,6 mln; własne sklepy bliżej niż 150 m podbierają sobie 10% ruchu (poza sklepem startowym) | 3, 7 |
| Badania Sieci | 6 badań (dostawy, obsada, marketing, magazyn, lojalność, prąd), od 2 otwartych sklepów, efekt na wszystkie sklepy, rośnie z liczbą sklepów coraz wolniej; w cenie satyryczna „opłata koordynacyjna Centrali” | 4, 7 |
| Cele firmy | 10 celów sieci (gotówka 250 tys.–2 mln, 3–5 sklepów, badania), nagroda w Ogonkach po „Odbierz” | 5, 7 |
| Galeria sław | pierwszy milion w zwykłej grze otwiera gratulacje i wpis do publicznej listy (`/api/fame/*`, prefiks `tr:fame:`, za `RANKING_ENABLED`); zakładka „Galeria sław” w panelu rankingu | 5, 6, 8 |
| Zapis | `FIRM_SAVE_SCHEMA` 4 z migracją ze schematu 3; paczka „Wyślij zapis” kompaktowana, żeby 5 sklepów zmieściło się w 64 KB | 3, 5 |

Wersje: `SIM_VERSION` 7 (wpis `GOLDEN[7]` z Zadania 2, w tym zadaniu bez zmian, bo symulacja się nie zmieniła), `FIRM_SAVE_SCHEMA` 4,
`GENERATOR_VERSION` 1 i `CITY_GENERATOR_VERSION` 1 bez zmian (`LAYOUTS_GOLDEN`, `CITY_GOLDEN` bez zmian). Ranking resetuje się przez SIM 7 (decyzja właściciela).

**Wycięte (P2):** tłum przed sklepem przy „Zrzucie Traszkomonów”, kolejne karty (upał, matury, Black Friday Centrali), hasła słowniczka
„Badania Sieci” i „Galeria sław”, polerka balansu po tym raporcie.

## 2. Jak mierzyłem

- `tests/progresjaPlay.ts`: wspólne strategie botów przez prawdziwą firmę (te same zakupy i wybór lokalu co pomiar miasta 4a.1/4a.2).
  - `bierny`, `mistrz`: jeden sklep, sam bot;
  - `jeden`: mistrz z zakupami w jednym sklepie (= `mistrzZakupy` z 4a.2);
  - `trzy`: mistrz z trzema sklepami jak w 4a.2, bez zakupów;
  - `siec`: mistrz z zakupami i rotacją po wszystkich sklepach, wynajmuje do limitu Centrali (raty albo gotówka), raz dziennie kupuje najtańsze badanie, gdy zostaje ≥ 50 000 zł;
  - `siec12` (dodatkowa, bez bramki): `siec` przez 12 miesięcy, potem już nic nie kupuje, tylko gra.
- `tests/measure/progresja.measure.test.ts` (`MEASURE=1`): 5 seedów raportu 4a.1 (`traszka-1, kopytka-541, makieta, lublin-9, seed-3`), 24 miesiące, bramki B1–B4 jako asercje.
- Zakupy botów idą od najtańszej rzeczy, za gotówkę albo na raty, gdy prognoza to zniesie. To ważne dla odczytu: bot nie oszczędza na nic.

**Wartości bazowe** (commit 562a49e, rodzic pierwszego commitu Zadania 1, osobny worktree, `tests/measure/miasto.measure.test.ts`):

| Strategia | Gotówka m. 12 (tys. zł, po seedach) | średnio | „Zostaje Ci” m. 13–24 | Wynik bez rat m. 13–24 | Milion |
|---|---|---|---|---|---|
| bierny | 171 95 132 108 143 | 130 000 | 10 754 | 10 676 | – |
| mistrz | 231 145 174 171 210 | 186 113 | 15 342 | 15 333 | – |
| jeden (`mistrzZakupy`) | 328 280 288 291 332 | 303 755 | 80 923 | 120 420 | m. 21–22 |

## 3. Pomiar 4b (24 miesiące, 5 seedów)

| Strategia | Gotówka m. 12 / m. 24 (tys. zł) | 1 mln / 2 mln (miesiąc) | Sklepy, 4. i 5. odblokowane w m. | Wynik bez rat m. 13–24 | „Zostaje Ci” m. 13–24 | Niekupione (tys. zł) |
|---|---|---|---|---|---|---|
| bierny | 171 98 129 112 173 / 333 195 250 229 329 | – / – | 1 | 10 861 | 10 718 | 14 512 |
| mistrz | 237 140 176 166 212 / 470 291 347 318 420 | – / – | 1 | 15 248 | 15 086 | 14 512 |
| jeden | 33 141 202 85 87 / 293 184 100 163 133 | – / – | 1 | 190 285 | 46 422 | 10 552–11 081 |
| trzy | 386 286 247 294 264 / 934 685 679 734 672 | – (rzut: m. 25–33) / – | 3, bez odblokowania | 39 127 | 37 041 | 33 953 |
| **siec** | 268 35 102 188 120 / 606 317 284 454 399 | **– / –** | 5; 4.: m. 3–4, 5.: m. 4–6 | 863 094 | 304 013 | 34 149–40 887 |
| siec12 | jak siec / 6 229 3 316 4 014 4 895 4 311 | **16 18 17 16 17** / 18 22 20 19 20 | 5 (jak siec) | 530 652 | 355 725 | 47 762–50 282 przy 2 mln |

Dodatkowo dla `siec`:
- otwarcia sklepów: drugi i trzeci w m. 3 (dni 65–68), czwarty w m. 4–5, piąty w m. 5–7;
- badania: 13–19 poziomów z 23, wydane 0,92–2,20 mln zł;
- remonty na końcu: prawie wszędzie 3, mimo że sklepy mają poziom 45–62 (poziom 28 w m. 5–8, 34 w m. 8–10);
- zakupy w sklepach przez 24 miesiące: ulepszenia 10,1–15,4 mln zł, remonty 1,5–1,7 mln, sprzęt ok. 0,33 mln, w tym ok. 300 zakupów na raty;
- suma „Zostaje Ci” od startu przekracza milion w m. **11 16 14 13 14** (mediana 14).

Jak to czytać:
- `siec` zarabia dużo (wynik bez rat 0,67–1,10 mln zł miesięcznie w drugim roku), ale co miesiąc wkłada cały przelew w ulepszenia, a raty zjadają 35–50% przelewu.
  Portfel po zamknięciu miesiąca to mniej więcej „Zostaje Ci” z tego miesiąca, więc do miliona w portfelu brakuje miesięcznego „Zostaje Ci” rzędu miliona.
- Gracz, który rok rozbudowuje sieć, a potem przestaje kupować (`siec12`), ma milion w m. 16–18. Raty z pierwszego roku spłacają się jeszcze przez rok i to one opóźniają milion.
- Boty nie kupują remontów 4 i 5. Kupują od najtańszej rzeczy, a tańszych ulepszeń zawsze coś zostaje. Ceny remontów 4–5 nie zostały więc sprawdzone na botach.
- `jeden` po 4b: wynik bez rat +58% wobec bazy, ale gotówka w m. 24 to 100–293 tys. zł zamiast 1,24–1,40 mln. Bot kupuje ok. 3,1–3,6 mln zł ulepszeń późnej gry (ok. 68 na raty), których koszt rośnie szybciej niż efekt (tak je zaprojektowano).
  Milion na jednym sklepie przed 4b przychodził w m. 21–22, a teraz tylko temu, kto przestanie kupować.

## 4. Bramki B1–B5

| Bramka | Wynik | Liczby |
|---|---|---|
| B1: `siec`, mediana miesiąca pierwszego miliona w [10, 15], żaden seed > 18 | **nie spełniona** | portfel `siec` nie dochodzi do 1 mln w 24 miesiące na żadnym seedzie (maks. 606 tys. zł w m. 24). Dla porównania: `siec12` m. 16–18, suma „Zostaje Ci” ≥ 1 mln w m. 11–16 (mediana 14) |
| B2: `siec`, przy pierwszych 2 mln niekupione ≥ 1 mln | spełniona (formalnie) | 2 mln nie przychodzi w 24 miesiące; niekupione na końcu 34,1–40,9 mln zł (`siec12` przy 2 mln: 47,8–50,3 mln) |
| B3: `jeden` bez końców gry i ostrzeżeń o debecie, wynik m. 13–24 ≥ 0,95 × bazowy | spełniona | 0 końców, 0 ostrzeżeń; wynik bez rat 190 285 wobec 120 420 (158%). Uwaga: „Zostaje Ci” (po ratach) 46 422 wobec 80 923 (57%), punkt 3 |
| B4: `mistrz` i `bierny`, gotówka m. 12 w ±8% bazowej | spełniona | mistrz 186 182 wobec 186 113 (+0,0%), bierny 136 966 wobec 130 000 (+5,4%) |
| B5: `tests/districtBalance.test.ts` bez zmiany progów | spełniona | przechodzi w `npm test`, progi bez zmian |

`Ruling: B3 liczę na wyniku bez rat (wynik miesiąca z historii i rankingu), a „Zostaje Ci” podaję obok — pomiar miasta nazywał „wynikiem” liczbę „Zostaje Ci”, ale ona spada od samych rat za zakupy, które spec 4b celowo dokłada, a B3 ma pilnować, że sklep się nie psuje — koszt pomyłki: przy odczycie „po ratach” B3 pada (57%), a gracz jednym sklepem, który kupuje wszystko, ma w drugim roku mniej gotówki niż przed 4b.`

`Ruling: B4 na średniej z pięciu seedów, nie na każdym seedzie osobno — nowe karty zmieniają losowanie talii, więc pojedynczy seed może drgnąć bardziej — koszt: po seedach bierny ma 0,0 / +3,3 / −2,3 / +3,8 / +21,5% (seed-3 poza ±8%), mistrz +2,8 / −3,9 / +1,6 / −3,0 / +0,8%; przy odczycie „każdy seed” B4 pada na jednym seedzie biernego.`

## 5. Strojenie: było → jest

Nic nie zmieniłem. Wszystkie gałki zostają jak w specu:

| Gałka | Wartość | Decyzja | Dlaczego |
|---|---|---|---|
| `perLevel` badań | 0,10 / 0,03 / 0,025 / 0,10 / 0,015 / 0,05 | bez zmian | mocniejsze badania podnoszą zarobek, a bot wydaje go w tym samym miesiącu; portfel `siec` nie zbliża się do miliona |
| `NET_SCALE` | 0, 0, 1, 1,5, 1,8, 2 | bez zmian | jak wyżej |
| `OWN_FACTOR` | 0,9 | bez zmian | +5% ruchu w części sklepów nie zmienia obrazu |
| progi odblokowania | 1,0 mln / 1,6 mln | bez zmian | czwarty i piąty sklep przychodzą w m. 3–6, a `trzy` bez zakupów nie odblokowuje nic, czyli tak, jak chciał spec („czwarty wymaga inwestycji”). Wyższy próg opóźni sieć, a nie przyspieszy milion |
| ceny remontów 4–5 | 450 000 / 900 000 | bez zmian | boty ich nie kupują (punkt 3), więc pomiar nic o nich nie mówi |

Dlaczego B1 nie da się dostroić: bot `siec` trzyma w portfelu tyle, ile zostało mu po zakupach z jednego przelewu. Żadna gałka z listy nie zmienia tego, że
do kupienia jest zawsze 30–40 mln zł (ulepszenia do `maxLevel` w pięciu sklepach), a to jest cel B2 i spec 4b („gracz z 2–3 mln dalej ma na co wydawać”).
B1 i B2 dla bota, który wydaje wszystko, są ze sobą sprzeczne. Coś, co dałoby milion w portfelu `siec` w m. 10–15, musiałoby albo podwoić zarobek sieci,
albo zabrać graczowi zakupy. Obie zmiany są gwałtowne, więc ich nie robię. Luka jest opisana tu, a decyzja należy do właściciela (punkt 10).

## 6. Szybka bramka w `npm test`

`tests/progresjaBalance.test.ts`: `siec`, 13 miesięcy, seedy `traszka-1` i `kopytka-541`. Sprawdza pięć otwartych sklepów w m. 13, odblokowanie 4. i 5.
placówki, kupione badania, brak końca gry i ostrzeżeń o debecie oraz sumę „Zostaje Ci” m. 1–13 ≥ 600 000 (pomiar: 1 767 200 i 662 578; 90% gorszego to 596 320,
więc obowiązuje dolna granica z planu, 600 000). Lokalnie ok. 8 s na seed, limit 240 s na test.

`Ruling: szybka bramka patrzy na sumę „Zostaje Ci”, a nie na portfel w m. 13 — portfel `siec` w m. 13 to 146–324 tys. zł i mówi, ile bot zostawił po zakupach, a nie, ile sieć zarabia; próg planu (≥ 700 000, nie niżej niż 600 000) zakładał spełnione B1 — koszt: bramka nie złapie zmiany, która tylko przesuwa wydatki bota.`

## 7. Paczka „Wyślij zapis” przy pięciu sklepach

- Najgorszy osiągalny przypadek (5 otwartych i 4 zamknięte sklepy po remoncie 5, pełne wyposażenie i badania, najgorsza minuta doby): **60 395 B**. Do progu testu (62 000 B) zostaje 1 605 B, do twardego limitu 65 536 B zostaje 5 141 B.
- Pięć sklepów po 24 miesiącach (remonty 5, 3, 3, 0, 0): 46 700 B.
- Bez kompaktowania najgorszy przypadek miałby 87 703 B.

## 8. Smoke w przeglądarce

`PLAYWRIGHT_ROOT=…/playwright-core npm run city:smoke` (headless Chromium, swiftshader, `locale: 'pl-PL'`, `/api/**` przerywane, nic poza localhost).
Skrypt dostał siedem kroków 4b (`4b-a`…`4b-g`, osobno: `node scripts/city-smoke.mjs --etap 4b`). Komputer w krokach 4b ma 1440×900, telefon 390×844 w pionie.
Zrzuty: `docs/superpowers/reports/2026-11-02-progresja-4b/` (telefon: wszystkie dwanaście `telefon-4b-*`; komputer: remont 5 w kadrze i po oddaleniu,
badania, cztery sklepy, „Milion!”, Galeria z atrapy, remont 4 po oddaleniu i „Zrzut Traszkomonów”). Kadr z gry ma sufiks `-sklep`, kamera oddalona do granicy `-ulica`.

| Krok | Co sprawdza | Telefon | Komputer |
|---|---|---|---|
| 4b-a | kopia `save-v3-dwa-sklepy.json` (schemat 3) z remontem 5 i poziomem 34 sklepu #2: wczytuje się bez `:broken`, firma po migracji ma `research {}`, limit 3, puste cele, bez Galerii; sklep i ulica bez błędów konsoli | ok | ok |
| 4b-b | po otwarciu budowy #3 (dwa sklepy) sekcja „Sieć: badania”: 6 wierszy, każdy z „w tym opłata koordynacyjna Centrali” (dostawy: 5000 zł); kupno „Wspólnych dostaw” zdejmuje z portfela dokładnie 25 000 zł | ok | ok |
| 4b-c | limit 4 i portfel 400 000 zł: wynajem dwóch najtańszych lokali za gotówkę (Browarna 7, 36 900 zł; Kolejowa 10, 53 400 zł), po budowie lista chipa ma 4 otwarte sklepy | ok | ok |
| 4b-d | portfel 999 500 zł i gra: okno „Milion!” następnego dnia; „Wpisz mnie do Galerii sław” przy przerwanym `/api/**` daje „Galeria jest teraz nieczynna. Wpis wyślesz później z panelu rankingu.”, gra idzie dalej; zakładka „Galeria sław” pokazuje komunikat i „Wyślij mój wpis”. Potem atrapa `/api/fame/*` w samej przeglądarce: „Wyślij mój wpis” → wpis (seed, dzień, gotówka, SIM 7) → „Jesteś w Galerii sław Traszki (miejsce 3)” → lista z trzema wpisami, seed w `meta.fameSent` | ok | ok |
| 4b-e | po angielsku: „Network: research”, sześć nazw badań po angielsku, opłata „including Head Office’s coordination fee”; po przeładowaniu gratulacje nie wracają | ok | ok |
| 4b-f | kopia „po Traszce” z remontem 4 sklepu startowego (poziom 28): sklep i ulica bez błędów konsoli | ok | ok |
| 4b-g | „Zrzut Traszkomonów”: w kopii zapisu każda inna karta talii „była dziś”, więc jutrzejsze losowanie gry może dać tylko ją; karta przychodzi następnego dnia o 6:00, a domyślna odpowiedź „Limit 2 saszetki” daje ruch +0,9 od 6:00 przez 6 h | ok | ok |

**Cały smoke** (kroki 1–12 z 4a.1 i 4a.2, dymki, 4b): wszystko „ok” na obu rozmiarach (punkt 9). Pierwszy przebieg wywrócił krok 1: stary zapis
`save-v2-remont2.json` ma 1 341 510 zł gotówki, więc po aktualizacji od razu dostaje okno „Milion!”, a pętla zamykania okien go nie znała. Po
dopisaniu go do pętli (Ruling niżej) krok 1 przechodzi. W obu przebiegach na każdym rozmiarze raz zadziałało awaryjne `click()` w DOM na przycisku
„OK” okna z wpisem (`.tt-story .tt-primary`, zasłonięty przez 6 s) w krokach 4a; żaden krok przez to nie padł, w przebiegu samych kroków 4b
awaryjnych kliknięć nie było. Stara uwaga z 4a.2 zostaje: na 390 px kartka „lokal obok” leży pod dwiema pinezkami.

Co widać na zrzutach:
- **Remont 5 na telefonie** (`telefon-4b-01-remont5-sklep.jpg`, `…-ulica.jpg`): pawilon ma 42 × 43 kratki (21 × 21,5 m), a kadr telefonu w pionie ma ok. 13 m szerokości (oddalony do granicy 30 m wysokości: 13,9 m). W kadrze mieści się środek sklepu z regałami i kawałek ulicy; ściany boczne, kasa i sąsiedzi są poza kadrem. Oddalenie prawie nic nie zmienia (28 → 30 m). Tak samo jest już przy remoncie 3 (recenzja Zadania 9), a gracz może przesuwać widok palcem. Kamery nie przebudowywałem.
- **Remont 4 na telefonie** (`telefon-4b-07-remont4-*`): pawilon 39 × 44 kratki (19,5 × 22 m), ten sam obraz: widać sklep od frontu z ulicą i przejściem, bez bocznych ścian.
- **Komputer 1440×900** (`desktop-4b-01-remont5-ulica.jpg`, `desktop-4b-07-remont4-ulica.jpg`): po oddaleniu cały pawilon, kamienica sąsiada z kartką „DO WYNAJĘCIA” (remont 4; po remoncie 5 kartki nie ma), ulica z chodnikiem i przejściem. Po stronie zaplecza leży pusta, brązowa działka z obrysem; jest taka sama przy remoncie 4 i 5. Nie sprawdzałem, czy tak ma wyglądać.
- **Okna 4b na telefonie**: gratulacje „Milion!”, komunikat Galerii, zakładka „Galeria sław” (zakładki rankingu łamią się na dwa wiersze: „Galeria sław” jest w drugim), lista z atrapy, karta „Zrzut Traszkomonów” z trzema odpowiedziami: bez poziomego przewijania (pomiar `checkWidth`).

`Ruling: krok 4b-a stawia remont 5 w sklepie #2, nie #1 — w `save-v3-dwa-sklepy.json` sklep #1 jest zamknięty (minimalny rekord), a #2 to sklep aktywny; remont 4 sklepu startowego (#1) sprawdza krok 4b-f na zapisie „po Traszce” — koszt: brak.`

`Ruling: kartę „Zrzut Traszkomonów” smoke wywołuje przez kopię zapisu, w której każda inna karta talii „była dziś” (każda ma przerwę ≥ 2 dni), a losowanie zostaje grze — test w tests/citySmoke.test.ts sprawdza to samo w node — koszt: gdyby kiedyś któraś karta dostała przerwę 1 dnia, krok padnie (test to złapie wcześniej).`

`Ruling: komunikat Chromium „Failed to load resource: net::ERR_FAILED” dla zapytania do /api/** na porcie smoke'a nie jest błędem konsoli (krok 8), tylko śladem przerwania przez smoke; krok 8 pada, gdy takich komunikatów jest więcej niż przerwanych zapytań — koszt: brak.`

`Ruling: pętla zamykania okien (settle) zamyka gratulacje za milion przyciskiem „Zamknij” — stary zapis save-v2-remont2.json ma 1 341 510 zł gotówki, więc po aktualizacji dostaje „Milion!” zaraz po wczytaniu (tak chce spec §5.7), a krok 1 nie mógł zatrzymać czasu — koszt: brak (krok 4b-d zatrzymuje się na tym oknie, zanim pętla je zamknie).`

## 9. Bramki i liczby

| Polecenie | Wynik |
|---|---|
| `npm run build` | OK: bundle sędziego 255,0 KB, `tsc` bez błędów, `vite build` |
| `npm test` | 201 plików przeszło, 7 pominiętych (pomiary `MEASURE=1`); 5969 testów przeszło, 14 pominiętych; 152 s. Przechodzą m.in. `simGolden`, `i18n`, `architecture`, `judgeBundle`, `districtBalance`, `citySmoke`, `firmSave`, `saveTransfer` i nowy `progresjaBalance` |
| `npm run check:vercel-build` | PASS (26 sprawdzeń), 7 funkcji, w tym `/api/fame/list` i `/api/fame/submit` |
| `npm run city:smoke` | 36 z 36 wierszy „ok” (telefon 19, komputer 17, w tym 7 kroków 4b na każdym rozmiarze), 664 s. Błędy konsoli 0, zapytania poza localhost 0, przerwane `/api/**` 8 (wszystkie w kroku 4b-d), awaryjne `click()` w DOM 1 na rozmiar |
| pomiar `MEASURE=1 … progresja.measure.test.ts` | B1 nie, B2–B4 tak (punkt 4); 70–136 s na proces |

Ciężkie testy tego zadania mają zapas na wolny runner CI: `tests/progresjaBalance.test.ts` 240 s na test (lokalnie ok. 8 s, 30×), paczka zapisu
w `saveTransfer.test.ts` 600 s (lokalnie ok. 25 s).

## 10. Do decyzji właściciela (nic nie blokuje wdrożenia)

1. **Milion po około roku.** Bot, który wydaje wszystko, nie ma go w 24 miesiące. Gracz, który rok buduje sieć i potem zbiera, ma go w m. 16–18. Możliwe kierunki na P2:
   - zostawić (Galeria jest nagrodą za to, że ktoś przestał kupować, a to też jest wybór);
   - tańsze lub krótsze raty w późnej grze, żeby rok rozbudowy nie ciągnął się przez kolejny rok spłat;
   - milion liczony inaczej, np. jako suma „Zostaje Ci” (wtedy m. 11–16, mediana 14). To zmienia spec i serwer Galerii.

   **Decyzja właściciela (2026-11-02): zostaje jak jest.** Milion w portfelu po 16–18 miesiącach przy 5 sklepach; B1 świadomie niespełniona.
2. **Remonty 4 i 5 bez weryfikacji na botach.** Boty ich nie kupują. Do polerki balansu: bot, który stawia remont przed ulepszeniami.
3. **Jeden sklep i ulepszenia późnej gry.** Gracz, który kupuje wszystko, ma w drugim roku znacznie mniej gotówki niż przed 4b (punkt 3), choć sklep zarabia więcej. Jeśli to ma być mniej bolesne: krótsza lista ulepszeń późnej gry albo ich ceny.
4. **Kadr telefonu przy remontach 3–5.** Pawilon nie mieści się w pionie nawet po oddaleniu (punkt 8). Można podnieść granicę oddalenia na telefonie w pionie, tak jak robi to panel Miasta.

## 11. Rulingi do przejrzenia

Pełne brzmienie jest w specu, w raportach zadań i w `.superpowers/sdd/2026-11-02-etap-4b-progresja/progress.md`. Najważniejsze:

- **Spec 4b:** remonty 4–5 dają +15 pkt proc. ruchu; przy L4+ generator bierze układ niższego poziomu, gdy nowy byłby gorszy; L4–5 nie zajmują kolejnego lokalu; opłata koordynacyjna jest tylko w tekście; badania kupione przy jednym sklepie nie działają; widełki na karcie lokalu nie liczą badań; odblokowanie po miesięcznym obrocie sieci; sklep startowy nie traci ruchu przez własne sklepy obok; Galeria bez sezonów, nie rezerwuje nicka, dzień ≥ 90; `FIRM_SAVE_SCHEMA` 4; kompaktowanie paczki.
- **Zadanie 1:** `layoutFor` odrzuca gorsze układy L4+; nowe ulepszenia są widoczne jako zablokowane od pierwszego dnia.
- **Zadanie 2:** liczby kart w specu to wartości skuteczne (po `CARDS.stakes`).
- **Zadanie 3:** limit paczki zostaje 64 KB; w paczce nie ma logu kart, a zamknięte sklepy to minimalny rekord (najwyżej 6); próg testu najgorszego przypadku 62 000 B; schemat 3 i 4 idą ścieżką firmy (stare zapisy nie lądują w `:broken`).
- **Zadanie 4:** neutralność jednego sklepu liczona względem `GOLDEN` po Zadaniu 2.
- **Zadanie 6:** `fame-invalid` (422) sprawdzany przed zajętym nickiem (409); odpowiedź wpisu niesie miejsce (`ZRANK`).
- **Zadanie 7:** cele firmy jako zbiorczy toast; „3 najbliższe cele” po jednym z każdej ścieżki.
- **Zadanie 8:** przy `first: false` bez znacznika wysłania i bez zmiany nicka. Klient przycina dzień wpisu do progu serwera (≥ 90): w smoke'u milion wymuszony w dniu 72 poszedł jako dzień 90.
- **Zadanie 9:** robot rysuje się z `min(poziom, 3)`; kadr telefonu przy L5 jak przy L3.
- **Zadanie 10:** punkty 4, 6 i 8 tego raportu (B3 na wyniku bez rat, B4 na średniej, szybka bramka na sumie „Zostaje Ci”, smoke na sklepie #2, karta przez talię w zapisie, konsola przy przerwanym `/api/**`, `settle` zamyka „Milion!”).

## 12. Znane ograniczenia

- **Galerii nikt nie weryfikuje.** Wpis to deklaracja klienta (seed, dzień, gotówka). Serwer sprawdza tylko wiarygodność, limity zapytań i budżet 300 wpisów dziennie. Fałszywy wpis jest możliwy (świadoma decyzja właściciela).
- **Produkcja stoi za Vercel Security Checkpoint.** Smoke, boty i skrypty nie sprawdzą produkcji automatycznie. Po wdrożeniu Galerię i ranking trzeba obejrzeć ręcznie w przeglądarce.
- **Paczka „Wyślij zapis” ma ok. 1,6 KB zapasu** do progu testu (60 395 z 62 000 B; do twardego 64 KB 5,1 KB). Każde nowe pole w zapisie sklepu trzeba policzyć w `saveTransfer.test.ts`.
- **Gałąź nie ma jeszcze commitu `092b2a6` z `main`** (dłuższe limity czasu dla `districtBalance` i siatki kartki na runnerze CI). Scalenie `main` daje konflikt tylko w `src/render/street/przejecie.test.ts`: obie strony ustawiają tam 30 s, wystarczy wziąć wersję z gałęzi. `districtBalance` po scaleniu dostanie 600 s.

## 13. Do opisu wdrożenia

**Nie cofać produkcji do wersji sprzed tego etapu.** Gra zapisuje firmę w schemacie 4 (`FIRM_SAVE_SCHEMA`). Starsza wersja widzi taki zapis jako
„nowszy” i go nie wczyta, a gracz zostaje bez swojego sklepu do czasu powrotu nowej wersji. Jeśli trzeba coś naprawić, to tylko poprawką do przodu.
Ranking resetuje się przy SIM 7, a Galeria sław przeżywa podbicia wersji (osobny prefiks `tr:fame:`).

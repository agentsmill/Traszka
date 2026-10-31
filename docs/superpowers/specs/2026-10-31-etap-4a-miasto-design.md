# Etap 4a: miasto i drugi sklep (wersja z 31.10, pod SIM 6 i rogalika)

Status: **zatwierdzony przez właściciela 2026-10-31 (odpowiedzi 1a, 2a, 3a, 4a), zastępuje `2026-10-29-etap-4a-miasto-design.md`** (zatwierdzony 30.10, gałąź `claude/modest-curran-de1dae`, 5dd6f3a) · data: 2026-10-31 · baza: `main` 7e2fb66 (SIM_VERSION 6, samouczek) · plan: `docs/superpowers/plans/2026-10-31-etap-4a1-miasto.md` (część 4a.1); stary plan `2026-10-29-etap-4a-miasto.md` jest nieaktualny · makieta ekranu: `git show 5dd6f3a:docs/superpowers/specs/2026-10-29-etap-4a-miasto-makieta.html` (układ dalej obowiązuje) · spec główny `2026-10-27-traszka-tycoon-design.md` (§5.3, §9, §10, §12, §14.7), spec SIM 6 `2026-10-30-prawdziwy-model-rozliczen-design.md`, spec samouczka `2026-10-30-samouczek-design.md`.

Oznaczenia: **[U]** decyzja właściciela, **[C]** decyzja Claude'a do sprawdzenia przy czytaniu, **[R]** wniosek z kodu.

---

## 0. Co się zmieniło od 2026-10-29 i dlaczego

1. **Pieniądze to dziś trzy kieszenie (SIM 6), a nie opłata na koniec miesiąca.** Stary projekt miał „raport i opłatę dla Centrali osobno dla każdego sklepu”. Opłaty już nie ma, więc każdy sklep ma swój **wyciąg od Centrali** (saldo, przelew, potrącenia, raty, remanent), a gotówka zostaje jedna (§11). Decyzja [U] o wspólnym portfelu i osobnych rozliczeniach zostaje, zmienia się tylko jej mechanika.
2. **Czynszu za nowy lokal nie ma.** W prawdziwej sieci lokal i sprzęt daje sieć, a franczyzobiorca płaci za lokal symbolicznie (ok. 200 zł). Właściciel z tego samego powodu kazał usunąć opłatę bez źródła („Tak, urealnij”). Koszt lokalu to teraz **pakiet otwarcia**: adaptacja za gotówkę albo na raty z przelewów nowego sklepu (§10.3).
3. **Liczby z SIM 4 są nieaktualne.** Granica debetu to −100 tys. zł, a nie −10 tys. Sklep na start ma ok. 300–350 klientów dziennie, a nie 520–560. Gotówka na start to 5000 zł, a pierwsze 3 miesiące chroni gwarancja 25 tys. zł. Ceny lokali liczę od nowa, z limitu rat nowego sklepu (§10.3).
4. **Rogalik.** Gra idzie w cykl życia franczyzobiorcy: sklep zostaje, ludzie się zmieniają. Stan dzieli się więc na trzy warstwy: miasto z lokalami, osobę franczyzobiorcy i placówki (§14). Dzięki temu 4a i rogalik dają się zbudować w dowolnej kolejności. Przy upadku następca dostaje tylko sklep startowy, a dodatkowe sklepy wracają na mapę jako lokale „po Traszce” **[U]** (§14.2). Cel przy kilku sklepach zostaje 1 mln zł **[U]** (§14.3).
5. **Ranking.** Właściciel akceptuje reset rankingu przy podbiciu `SIM_VERSION`. Twardy zakaz zmian w symulacji ze starego projektu łagodnieje: celem jest 4a.1 bez podbicia, a najwyżej jedno podbicie zbiorcze, jeśli okaże się czystsze (§3.1).
6. **Zakres w dwóch częściach** zamiast całości naraz **[U]**. 4a.1 to płaski widok miasta i jeden wynajem, czyli najwyżej dwa sklepy. 4a.2 to makieta 3D, trzeci sklep, profile godzin i karty dzielnic (§5).
7. **Nowe ograniczenia z dzisiejszego `main`:**
   - dymki „pierwszy raz” samouczka dla miasta i drugiego sklepu (§17);
   - angielska wersja każdego nowego tekstu po scaleniu tłumaczenia (§18);
   - wspólny język wizualny z kartką „DO WYNAJĘCIA” z równoległej zmiany renderu remontu (§9.2).
8. **Dwie pułapki znalezione w kodzie [R]:**
   - `createEconomy` zawsze startuje 1 września, więc nowy sklep potrzebuje startu w bieżącej minucie (§10.4);
   - debet sprawdza każdy sklep po swojej minucie, więc przy wspólnej gotówce kolejność sklepów decydowałaby o bankructwie. Debet sprawdza więc firma, po minucie wszystkich sklepów (§11.4).
9. **Zamknięcie sklepu ma rozliczenie końcowe.** Przy zamknięciu sklepu niespłacone raty i ubytki od ostatniego remanentu płaci się od razu (`outstandingDebt`). Bez tego zamknięcie przez Centralę byłoby darmową ucieczką od rat. Gracz może też sam wypowiedzieć umowę sklepu, z tym samym rozliczeniem końcowym **[U]** (§13.2).
10. **Prestiż** zostaje jak w decyzji [U]: przycisk „Otwórz kolejną Traszkę” znika. Jego relację do rogalika opisuje §15.

## 1. Intencja

Etap 2 dał pętlę jednego sklepu, a SIM 6 jej prawdziwe rozliczenie. Etap 4a dodaje nad nią warstwę strategiczną: **gdzie postawić kolejną Traszkę** **[U]**. Gracz po dwóch dobrych miesiącach dostaje od Centrali (niechętnie) status Partnera Strategicznego. Otwiera mapę miasta, porównuje ruch, konkurencję i wolne lokale z kartką „DO WYNAJĘCIA”, bierze lokal z pakietem otwarcia i od tej pory prowadzi dwa sklepy z jednej gotówki.

Frajda ma płynąć z wyboru, a nie z samego „więcej”. Dzielnice różnią się charakterem **[U]**:
- w **drogiej** części miasta klienci są zamożni i zostawiają więcej pieniędzy, ale mają wyższe oczekiwania;
- w **taniej** częściej ginie towar i częściej trafiają się trudni klienci.

Pierwszy sklep stoi w **neutralnej** dzielnicy i gra się nim dokładnie tak jak dziś. Różnice zaczynają się od drugiego lokalu **[U]**.

Ton zostaje ten z SIM 6: zła lokalizacja to „błędna decyzja z opóźnionym skutkiem”. Rachunek przychodzi wyciągiem i remanentem nowego sklepu, a nie losowym nieszczęściem. Właściciel chce, żeby upadek brał się z decyzji i z presji Centrali, a nie z pecha.

## 2. Cele, nie-cele, anty-cele

**Cele 4a.1** (pierwsza część, **[U]**)
1. Miasto z seeda: kwartały, cztery dzielnice, ulice z natężeniem ruchu, lokale i statyczna konkurencja (§7).
2. Dzielnice, które przestawiają ekonomię sklepu: ruch, koszyk, oczekiwania, kradzieże, dzień tygodnia (§8).
3. Ekran Miasta w widoku płaskim (warstwy), z listą i kartą lokalu, także na telefonie (§9).
4. Status Partnera Strategicznego, pakiet otwarcia, budowa i otwarcie drugiego sklepu (§10).
5. Dwa sklepy: wspólna gotówka i osobne wyciągi, sklep w tle na pełnej ekonomii, zastępca przy kartach (§11, §12).
6. Zamknięcie jednego sklepu z rozliczeniem końcowym (§13).
7. Zapis firmy ze starymi zapisami wczytywanymi bez straty (§16).
8. Prestiż przeniesiony na poziom miasta (§15), dymki samouczka (§17), angielska wersja (§18).

**Cele 4a.2**
- makieta 3D z kartką w witrynach wolnych lokali (§19);
- trzeci sklep **[U]**;
- profile godzinowe dzielnic i karty Dworca (§8);
- ponowny wynajem lokalu „po Traszce” z wyposażeniem (§13.3);
- przegląd balansu i wydajności.

**Nie-cele 4a (4b albo później)** **[U]**
- Ruchy AI konkurencji, płatne analizy, odkup od innego franczyzobiorcy, przejęcie lokalu po konkurencji, „cudza Traszka” Centrali.
- Kierownik sklepu.
- Udział w rynku, „Król Traszek”, nowe Punkty Partnera.
- Nowe formaty lokali (okienko, flagowiec, Nanoo).
- Ranking z ekspansją.
- Więcej niż 3 sklepy.
- Tłum pieszych na ulicach miasta **[C]**.
- Sam rogalik: generator postaci, zdjęcie w ramce, tryby hardcore i sztafeta. 4a tylko się do niego przygotowuje (§14).

**Anty-cele**
- Zmiana wyniku pierwszego sklepu albo biegu rankingowego. Gracz bez ekspansji gra bit w bit jak dziś.
- Drugi sklep jako kopia pierwszego. Jeśli dzielnica nie zmienia odczuwalnie gry, warstwy strategicznej nie ma.
- Sklep w tle jako czarna skrzynka. Gracz widzi, co się w nim dzieje, bez przełączania co minutę.
- Gotówka, która „znika” bez wyjaśnienia. Przy kilku sklepach pasek i wyciągi muszą pokazać, który sklep zjada pieniądze.
- Miasto z klocków i ekran miasta, który dławi telefon.
- Utrata zapisu przy przejściu na nowy format.

## 3. Ograniczenia

### 3.1 Ranking **[U]** / **[C]**
- **Tryb rankingowy zostaje na jednym sklepie, bez ekspansji [U].** Mapę widać, ale w biegu rankingowym Centrala nie nadaje statusu (tekst w §10.1).
- **Cel [C]: 4a.1 bez podbicia `SIM_VERSION`.** Wszystko, co nowe, wchodzi przez parametr środowiska sklepu (`StoreInfo.site`, §8.3) i przez stan firmy poza `EconomyState`. Brak parametru daje dzisiejsze zachowanie co do bitu. `tests/simGolden.test.ts` przechodzi bez zmian, `GENERATOR_VERSION` zostaje 1.
- **Jeśli podbicie okaże się czystsze** (np. pole w stanie zamiast flagi w środowisku), wolno podbić **raz** na całe 4a, z nowym `GOLDEN[7]` i przebudowanym `judgeBundle.js`. Właściciel akceptuje reset rankingu. Podbicie warto połączyć z innymi zmianami symulacji, które czekają na decyzję (raport SIM 6, §9).
- **Sędzia nie dostaje miasta ani firmy [C].** `src/sim/city` i `src/sim/firm` nie są importowane przez `run.ts` ani `ranked.ts`, więc bundel sędziego się nie zmienia. Pilnuje tego test architektury.
- Plików rankingu nie ruszamy: `src/server/**`, `src/sim/ranked.ts`, `src/game/rankedRun.ts`, zapis `traszka:ranked`, `SAVE_SCHEMA` 2.

### 3.2 Determinizm **[C]**
- Miasto liczy się z podseeda `subSeed(seed, 'city')`, z własną wersją `CITY_GENERATOR_VERSION`. Dodanie miasta nie zmienia sklepów.
- Sklep w nowym lokalu ma seed `subSeed(seed, 'store:' + lotId)`.
- Ten sam seed i ten sam dziennik poleceń dają ten sam stan miasta i wszystkich sklepów. Sklepy liczą się w stałej kolejności (po `id`). W `src/sim` nie ma `Math.random`, `Date` ani three.js.

### 3.3 Ekonomia SIM 6 **[R]**
- Ekonomia jednego sklepu zostaje taka, jaka jest:
  - marża i premie idą na saldo;
  - przelew, potrącenia i koszty własne schodzą przy zamknięciu miesiąca;
  - raty mają limit od przelewu i zaufania;
  - remanent wypada co 3 miesiące;
  - debet −100 tys. zł, ostrzeżenie od −50 tys.
- 4a niczego w tym nie przestawia dla sklepu bez parametru `site`.
- Nowe zasady dla dodatkowych sklepów to flagi środowiska (§11.2): bez gwarancji, bez ZUS i księgowej, debet sprawdzany przez firmę.
- Otwarte punkty raportu SIM 6 (§9) dotyczą 4a w dwóch miejscach:
  - pewne otwarcie „drobne ulepszenia na raty pierwszego dnia” (właściciel: „Zostaw jak jest”). Każdy nowy sklep ma własny limit rat, więc ekspansja daje więcej rat, a przegląd balansu to mierzy;
  - kasy samoobsługowe bez kamer kosztują 20–40 tys. zł przy remanencie. Mnożnik kradzieży Dworca nie może tego mnożyć bez umiaru (§8.1).

### 3.4 Samouczek **[R]**
Samouczek to czysta warstwa widoku (`src/ui/tutorial/`), bez wpływu na symulację. 4a dokłada dymki „pierwszy raz” (§17) i hasła w słowniczku „Jak grać”. Przelot się nie zmienia, bo dotyczy pierwszych minut w jednym sklepie.

### 3.5 Tłumaczenie **[R]** / **[C]**
Angielska nakładka czeka na scalenie na gałęzi `claude/quirky-newton-dinhy9`:
- funkcje `t` i `tr`, słownik `EN_UI`;
- dane po identyfikatorach (`EN_REMONTS` itd.);
- tłumacz zdań symulacji;
- napisy w scenie (`EN_RENDER`);
- test `tests/i18n.test.ts` ze skanerem `tests/i18nScan.ts`, który oblewa każdy polski napis bez tłumaczenia.

**[C] 4a startuje po scaleniu tłumaczenia** i każdy nowy tekst od pierwszego commita ma wersję angielską (§18). Gdyby 4a ruszyło wcześniej, każde scalenie wymaga dopisania tłumaczeń do wszystkich nowych tekstów.

### 3.6 Sprzęt **[C]**
Laptop bazowy: ok. 60 FPS na Średniej. Telefon to cel ekranu miasta: ok. 30 FPS w widoku warstw (`src/render/quality.ts` już startuje telefon na oszczędnym presecie).

### 3.7 Architektura
Bez zmian względem specu głównego §14.1: `src/sim` to czysty TypeScript, render tylko czyta stan, a UI czyta stan i wysyła polecenia.

### 3.8 Prace równoległe **[C]**
- **Render remontu „dokupienie lokalu obok”** (31.10, tylko render): przed remontem witryna sąsiada ma kartkę „DO WYNAJĘCIA”, a po remoncie Traszka zajmuje jego lokal. Miasto korzysta z tej samej kartki (jedna funkcja rysująca, §9.2) i z tej samej reguły „lokal obok należy do remontu” (§7.2).
- **Rogalik** (spec jeszcze nie powstał) rusza te same miejsca co 4a: koniec gry, meta, `session.ts`, `actions.ts`. Obu prac nie prowadzimy równolegle na tych plikach. Kolejność ustala koordynator. Projekt działa w obu kolejnościach (§14).

## 4. Decyzje właściciela i co się z nimi dzieje

Z rozmowy z 29.10, zatwierdzone 30.10:

| # | Decyzja **[U]** | Dziś |
|---|---|---|
| 1 | Widok miasta z góry z natężeniem ruchu, konkurencją i listą wolnych lokali; przy lokalu przewidywani klienci, rodzaj klienta i cena | zostaje; „cena” to pakiet otwarcia (§10.3) |
| 2 | Droga dzielnica: zamożni klienci, wyższe oczekiwania. Tania: kradzieże i trudni klienci | zostaje |
| 3 | Pierwszy sklep neutralny, różnice od drugiego lokalu | zostaje |
| 4 | Zakres 4a; konkurencja, analizy, odkup i przejęcie w 4b | zostaje; 4a dzieli się na dwie części **[U]** |
| 5 | Tryb rankingowy bez ekspansji | zostaje |
| 6 | Wspólny portfel; raport, opłata, zaufanie i zamknięcie osobno dla sklepu; debet na portfelu; koniec gry przy ostatnim sklepie albo debecie | zostaje w duchu. „Opłata” to dziś wyciąg sklepu (§11). „Koniec gry” w rogaliku to upadek franczyzobiorcy **[U]** |
| 7 | Sklep w tle liczy się pełną ekonomią; ręce tylko w aktywnym | zostaje |
| 8 | Karta w tle: zastępca od razu wybiera odpowiedź zaznaczoną z góry | zostaje (zgodne z odtwarzaniem w `replayRun` i z życzeniem z playtestu o automatycznych decyzjach) |
| 9 | Ekran miasta „makieta + warstwy”, na telefonie domyślnie warstwa | zostaje; w 4a.1 tylko warstwa, makieta w 4a.2 **[U]** |
| 10 | Prestiż na poziomie miasta: przycisk „Otwórz kolejną Traszkę” znika, Punkty Partnera i dochód z sieci działają dalej | zostaje (§15) |
| 11 | Najwyżej 3 sklepy w 4a | zostaje; w 4a.1 najwyżej 2 **[U]** |

Późniejsze decyzje, które 4a musi uszanować:
- **trzy kieszenie** (30.10);
- **raty jako główny sposób rozwoju i „Zostaw jak jest”** dla rat dnia 1 (31.10);
- **rogalik:**
  - sklep zostaje;
  - cel 1 mln zł gotówki;
  - tryby hardcore i sztafeta;
  - upadek z decyzji i od Centrali;
  - „miasto podniesie albo zmieni cel; cel przypięty do trybu”;
- **samouczek:**
  - styl B;
  - dymki „pierwszy raz” działają też w rankingu;
  - samouczek nie wysyła poleceń.

## 5. Zakres i kolejność części **[U]**

| Część | Co dostaje gracz | Co się buduje |
|---|---|---|
| **4a.1 Drugi sklep** | mapa miasta w widoku warstw, status Partnera, wynajem jednego lokalu, dwa sklepy, wyciąg każdego sklepu i podsumowanie sieci | generator miasta i ruch (sim), dzielnice z pięcioma pokrętłami, firma (gotówka, sklep w tle, zastępca), zapis firmy, ekran miasta (warstwy), przełącznik sklepów, pasek i okno miesiąca dla dwóch sklepów, rozliczenie końcowe, dymki, angielski |
| **4a.2 Pełne miasto** | makieta 3D z autami, trzeci sklep, profile dnia i karty dzielnic, ponowny wynajem lokalu „po Traszce” | budynki proceduralne, chunki, presety i benchmark, karty Dworca, profil godzinowy na karcie lokalu, balans na botach |

Dlaczego taki podział **[C]**:
- 4a.1 to najmniejszy kawałek, w którym gracz podejmuje nową decyzję;
- makieta 3D to najdroższa i najbardziej ryzykowna dla telefonu część pracy, a nie jest potrzebna, żeby sprawdzić, czy drugi sklep jest ciekawy;
- generator od początku tworzy pełne miasto (wszystkie dzielnice i lokale), więc 4a.2 nie zmienia miasta istniejących zapisów.

## 6. Przebieg dla gracza (4a.1)

1. **Start.** Nowa gra (i stara po wczytaniu) ma miasto. Zakładka „Miasto” pokazuje widok z Twoim sklepem na Osiedlu, konkurencją i wolnymi lokalami z kartką „DO WYNAJĘCIA”. Pasek statusu mówi, czego brakuje („jeszcze 1 miesiąc z zyskiem”, „zaufanie 68/75”). Karta lokalu działa, przycisk „Biorę lokal” jest zablokowany tekstem Centrali.
2. **Próg.** Przy zamknięciu miesiąca, który spełnia warunek (§10.1), Centrala przysyła ważne zdarzenie z „OK”: nadaje status Partnera z wyraźną niechęcią.
3. **Wybór lokalu.** Gracz porównuje widełki klientów, dzielnicę, konkurencję obok, pakiet otwarcia (gotówka albo raty) i czas budowy. Wybiera sposób zapłaty i potwierdza.
4. **Budowa.** Lokal ma rusztowanie i licznik dni. Gracz gra dalej pierwszym sklepem.
5. **Otwarcie.** Ważne zdarzenie „Traszka #2 otwarta”. Przełączyć się można od razu albo później.
6. **Dwa sklepy.** Przełącznik w górnym pasku. Sklep w tle pracuje na personelu i ustawieniach, jego karty rozstrzyga zastępca, a skrzynka mówi, co zaszło. Pasek pokazuje gotówkę i kieszenie całej sieci. Koniec miesiąca to jedno okno: podsumowanie sieci i wyciąg każdego sklepu.

## 7. Miasto

### 7.1 Generator **[C]** (zasady ze specu głównego §5.3)
- **6×6 kwartałów.**
- **Dzielnice:**
  - Osiedle: neutralne, startowe;
  - Śródmieście: zamożne;
  - Dworzec: tanie;
  - Biurowce;
  - park bez lokali.

  Każda dzielnica to spójny obszar kilku kwartałów. Nazwy ulic i miasta składają się z polskich członów.
- **Zabudowa z dzielnicy:**
  - Osiedle: bloki z wielkiej płyty;
  - Śródmieście: kamienice z podwórkami;
  - Biurowce: wieże i pawilony biurowe;
  - Dworzec: pawilony, garaże i dworzec.
- **Lokale.** Każdy lokal ma `LotSpec` (`kind`, wymiary, narożnik). Generator sklepu przyjmuje go wprost: `generateStore(seed, lot, opts)` **[R]**. Format lokalu w każdej dzielnicy:
  - Osiedle: parter bloku;
  - Śródmieście: narożnik kamienicy;
  - Dworzec: pawilon;
  - Biurowce: parter biurowca (`blok`).
- **Stany lokalu:**
  - zajęty (dekoracja);
  - wolny („DO WYNAJĘCIA”);
  - lokal obok Twojej Traszki (§7.2);
  - konkurencja;
  - Twój sklep;
  - w budowie;
  - po Traszce (wolny, z wyposażeniem, §13.3).
- **Wolne lokale:** 5–8 na miasto, co najmniej jeden w każdej dzielnicy innej niż neutralna.
- **Konkurencja:** 3–5 sklepów (Szop 24h, Kawka Express) w lokalach z dużym ruchem, żaden bliżej niż 2 kwartały od sklepu startowego.

### 7.2 Lokal startowy i lokal obok **[C]**
- Lokal startowy leży na Osiedlu i ma średni potencjał.
- **Miasto dopasowuje się do sklepu:** `LotSpec` lokalu startowego to `generateStore(seed).lot`. Układ, `StoreInfo` i ekonomia pierwszego sklepu się nie zmieniają.
- **Lokal obok należy do remontu.** Lokal sąsiada po stronie, w którą rośnie sklep przy „Remont: dokupienie lokalu obok” (`REMONTS[0]`), nie trafia na listę wolnych lokali:
  - przed remontem ma na mapie tę samą kartkę co w scenie ulicy;
  - jego karta mówi: „Ten lokal zajmiesz remontem „Dokupienie lokalu obok”” i prowadzi do Ulepszeń;
  - po remoncie obrys Twojej Traszki na mapie obejmuje oba lokale.

  Ta sama reguła dotyczy każdego Twojego sklepu.
- Wygląd rzędu przy sklepie startowym (szerokość i wysokość sąsiadów) ma być spójny ze sceną ulicy (`planRow` w `src/render/street/buildings.ts`), ale nie bit w bit.

### 7.3 Ruch **[C]**
- **Punkty ruchu** mają profil godzinowy i tygodniowy. Są to:
  - przystanki;
  - szkoła i uczelnia;
  - biurowce;
  - dworzec;
  - osiedla.

  Natężenie odcinka ulicy to suma wpływów, malejąca z odległością.
- **Mnożnik ruchu lokalu** to iloczyn trzech czynników i mnoży `baseTraffic(info)`, a nie go zastępuje:
  - mnożnik dzielnicy (§8.1);
  - lokalne natężenie względem średniej dzielnicy (0,85–1,15);
  - konkurencja w promieniu (×0,8 za rywala bliżej niż 250 m).

  Rodzaj i wielkość lokalu już siedzą w `baseTraffic` (`LOT_TRAFFIC`, półki), więc nie liczą się drugi raz.
- **Skala liczb na karcie [R]:** sklep na start ma dziś ok. 300–350 klientów dziennie (komentarz przy `TRAFFIC_BASE`). Widełki na karcie są w tej skali: `expectedDailyCustomers` sklepu z tego lokalu z mnożnikiem.
- Mnożnik lokalu startowego to z definicji brak mnożnika (§8.3).

### 7.4 Stan miasta **[C]**
- Miasto jest czystą funkcją seeda i `CITY_GENERATOR_VERSION`.
- **Do zapisu trafiają tylko zmiany:** stany lokali, budowy z dniem otwarcia, lokale „po Traszce” z wyposażeniem. Kształt `CityState` zostaje budowniczemu.
- To oszczędza miejsce w zapisie (limit 64 KB, §16).

## 8. Dzielnice

### 8.1 Charakter **[U]** (kierunek) / **[C]** (liczby, do strojenia)

| | Osiedle (neutralne) | Śródmieście (zamożne) | Dworzec (tani) | Biurowce |
|---|---|---|---|---|
| Ruch | 1 | ok. 1,1 | ok. 1,4 | ok. 1,2 w dni robocze, ok. 0,5 w weekend |
| Koszyk (zł na klienta) | 1 | ok. 1,35 | ok. 0,8 | ok. 1,1 |
| Oczekiwania | 1 | wysokie: cierpliwość −2 osoby, kary reputacji za pustą półkę, brud i kolejkę ×1,5 | niskie: cierpliwość +1 | średnie |
| Kradzieże | 1 | ok. 0,6 | ok. 1,8 | ok. 0,8 |
| Pakiet otwarcia (§10.3) | średni | wysoki | niski | średni |
| Profil dnia (4a.2) | jak dziś | mocniejszy wieczór | płaski | szczyty 7–9 i 12–14, pusto po 18 |
| Trudni klienci (4a.2) | 1 | rzadziej | częściej, plus 2–3 karty tylko dla Dworca | rzadziej |

- **Kradzieże** działają przez ukryty licznik ubytków, więc wychodzą przy remanencie. To zamierzone: tania dzielnica kusi ruchem, a rachunek przychodzi po kwartale. Mnożnik Dworca jest niższy niż w starym projekcie (2,5 → ok. 1,8). Przy remanencie z SIM 6 kasy bez kamer w takim lokalu kosztowałyby inaczej 50–100 tys. zł na kwartał. Karta lokalu ostrzega: „kradzieże: wysokie, zobaczysz je przy remanencie”.
- **Godziny otwarcia** wszędzie te same (6:00–23:00). Profil dnia zmienia tylko rozkład klientów.
- **„Kto przychodzi”** na karcie lokalu to opis z punktów ruchu, a nie nowe archetypy w symulacji.
- **Niedziela** (`tycoon/sunday.ts`, więcej klientów) w Biurowcach ustępuje mnożnikowi weekendu.

### 8.2 Gdzie dzielnica wchodzi do ekonomii **[R]**
Pokrętła już są w kodzie:
- **ruch:** `arrivalRate`;
- **koszyk:** marża i obrót z klienta w `sell`;
- **oczekiwania:** `patienceOf` i kary reputacji;
- **kradzieże:** `WUT.baseline.kradziez` i ubytek na kasach samoobsługowych w `tycoon/wut.ts`;
- **trudni klienci (4a.2):** wagi kart w `tycoon/deck.ts` (pole `weight` przyjmuje funkcję `CardContext`).

### 8.3 Zasada neutralności **[C]**
- Dzielnica, flagi dodatkowego sklepu (§11.2) i kontrola debetu przez firmę wchodzą do ekonomii jako opcjonalne pole `StoreInfo.site`. `StoreInfo` nie jest częścią stanu.
- **Brak pola to dzisiejsza gra co do bitu.** Modyfikator pomija się gałęzią, a nie mnoży przez 1.
- Nowa karta z wagą 0 nie może przesunąć losowania talii.
- Pilnuje tego `tests/simGolden.test.ts` bez zmian i nowy test: sklep z jawną dzielnicą neutralną daje ten sam skrót co sklep bez pola.
- `site` musi przetrwać remont: `computeStoreInfo` po remoncie dostaje je z powrotem, a układ po remoncie powstaje z lokalu miasta, a nie z `pickLot(seed)`.

### 8.4 Cel balansu **[C]**
Na botach z harnessu SIM 6 (`tests/measure/trzyKieszenie.measure.test.ts`, strategie bierny, normalny, mistrz, mistrz z zakupami) i nowej strategii „mistrz z ekspansją”:
- dobry gracz w każdej dzielnicy zarabia na drugim sklepie podobnie (±30%), ale inaczej: w Śródmieściu z koszyka, na Dworcu z ruchu mimo remanentu;
- bierny gracz traci w Śródmieściu więcej niż na Osiedlu (oczekiwania);
- na Dworcu remanent biernego sklepu bez kas samoobsługowych to kilka tysięcy złotych na kwartał. Z kasami bez kamer bez porównania więcej, a karta lokalu o tym ostrzega.

## 9. Ekran Miasta

### 9.1 Widok **[U]** / **[C]**
- **4a.1: widok warstw.** Budynki są niskie, płaskie i wybielone. Ulice mają kolor od żółtego do czerwonego według ruchu („Ruch”), a tło kwartałów kolor dzielnicy („Dzielnice”). Pinezki:
  - Twoje sklepy: zielone;
  - konkurencja: pomarańczowe i fioletowe;
  - wolne lokale: kartka z numerem;
  - budowa: rusztowanie z licznikiem dni.
- **4a.2: makieta 3D** w stylu sklepu, przełączana przyciskami „Makieta / Ruch / Dzielnice”, jak w makiecie z 29.10.
- Kamera jak w sklepie: rzut izometryczny, obrót co 90°, zoom, przesuwanie palcem i myszą.
- Czas płynie na ekranie miasta. Karty aktywnego sklepu dalej zatrzymują grę.
- **Wejście [C]:** zakładka „Miasto” obok pięciu dzisiejszych (`TabId`). Gdyby szósta zakładka nie mieściła się na 390 px bez ucinania, miasto otwiera chip sklepu w górnym pasku (§9.4).

### 9.2 Kartka „DO WYNAJĘCIA” **[C]**
- Jedna funkcja rysuje kartkę dla sceny ulicy (render remontu) i dla miasta. Wolny lokal ma ją:
  - w widoku warstw jako pinezkę-kartkę;
  - w makiecie (4a.2) przyklejoną w ciemnej, pustej witrynie.
- Lokal „po Traszce” ma tę samą kartkę i dopisek „po Traszce”.
- Napis kartki tłumaczy `EN_RENDER` (np. „TO LET”).

### 9.3 Lista i karta lokalu **[U]** (zawartość) / **[C]** (forma)
- **Lista:** numer, adres, dzielnica, format i metraż, widełki klientów dziennie, pakiet otwarcia.
- **Karta lokalu:**
  - klienci dziennie (widełki);
  - kto przychodzi;
  - koszyk, oczekiwania, kradzieże (słowami: niskie, średnie, wysokie);
  - konkurencja obok (nazwa i odległość);
  - pakiet otwarcia: „za gotówkę X zł” i „na raty Y zł × 12 z przelewów tego sklepu”;
  - czas budowy;
  - w 4a.2 profil godzinowy jako mały wykres.
- **Widełki zamiast dokładnej liczby:** potencjał ±25% z deterministycznym przesunięciem z seeda, więc prawdziwa liczba nie zawsze leży w środku. Płatna analiza w 4b je zawęzi.
- **Przycisk „Biorę lokal”** jest zablokowany tekstem Centrali, dopóki nie ma statusu, wolnego miejsca na sklep (§10.2) albo gotówki przy zapłacie gotówką.

### 9.4 Telefon i przełącznik sklepów **[U]** / **[C]**
- Na telefonie mapa jest na górze, a karta lokalu wysuwa się od dołu. Między lokalami przesuwa się palcem.
- **Chip sklepu** w górnym pasku („Traszka #1, Ogrodowa”) otwiera listę sklepów z mini-stanem każdego:
  - dzisiejszy wynik;
  - prognoza „Zostanie” tego sklepu;
  - zaufanie;
  - znak ostrzegawczy: paleta w przejściu, pusta półka, karta rozstrzygnięta przez zastępcę.

  Przełączenie jest natychmiastowe, także w pauzie. Stuknięcie w pinezkę własnego sklepu też przełącza.

## 10. Partner Strategiczny, pakiet otwarcia i otwarcie

### 10.1 Status **[U]** (próg) / **[C]** (liczby)
- **Warunek:** dwa ostatnie zamknięte miesiące z dodatnim wynikiem (`history.profit`, wynik bez rat z SIM 6) w sklepie startowym i zaufanie co najmniej 75 („Zaufany partner”) przy zamknięciu miesiąca.
- **[R]** W SIM 6 bierny sklep ma dodatni wynik już w 1.–2. miesiącu, więc w praktyce o terminie decyduje zaufanie. Najwcześniej status przychodzi przy zamknięciu października, czyli przed pierwszym remanentem 30 listopada.
- Gdyby przegląd balansu uznał to za za łatwe, wolno dołożyć warunek „po pierwszym remanencie”, ale tylko za zgodą właściciela, bo próg jest jego decyzją.
- Status jest osobisty: należy do franczyzobiorcy, a nie do sklepu (§14). W 4a raz nadany zostaje.
- Nadanie to ważne zdarzenie z „OK”, np. „Po wnikliwej analizie i z pewnymi oporami nadajemy Panu/Pani status Partnera Strategicznego.”
- **Ranking:** status nie przychodzi. Pasek: „W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.”

### 10.2 Limit sklepów **[U]**
- W 4a.1 najwyżej 2 sklepy, wliczając budowę. W 4a.2 najwyżej 3.
- Przy limicie przycisk mówi tekstem Centrali, np. „Dwie placówki to na tym etapie partnerstwa wszystko, na co Centrala jest gotowa się zgodzić.”

### 10.3 Pakiet otwarcia zamiast czynszu **[C]**
- **Dlaczego bez czynszu.** W prawdziwej sieci lokal i sprzęt daje sieć, a franczyzobiorca płaci za lokal ok. 200 zł (pamięć projektu: prawdziwe liczby franczyzy). Duży czynsz nie ma źródła, tak jak nie miała go opłata usunięta w SIM 6.
- **Pakiet otwarcia.** Gracz bierze lokal spoza planów Centrali, więc Centrala urządza go na jego koszt:
  - **za gotówkę:** pełna cena od razu, a gotówka po zapłacie musi zostać nie mniejsza od zera (nie budujesz na debecie);
  - **na raty:** 12 rat z opłatą 15% (plan `INSTALLMENTS` dla ceny ponad 25 tys. zł). Raty należą do **nowego sklepu**: lądują w jego bloku rozliczenia przy otwarciu i schodzą z jego przelewów.
- **Wyciąg sam pokazuje, czy lokal był dobry.** Kiepski lokal ma ujemne „Zostaje Ci” i zjada gotówkę, a dobry spłaca się w rok.
- **Ceny [C]:** od ok. 35 tys. zł (pawilon przy Dworcu) do ok. 85 tys. zł (narożnik kamienicy w Śródmieściu). Górna granica wynika z kodu **[R]**: nowy sklep bez historii ma limit rat 35% × 25 tys. × 1 = 8750 zł miesięcznie (`installmentLimit` przy zaufaniu 65), a 85 tys. zł w 12 ratach z opłatą 15% to ok. 8150 zł. Najdroższy lokal mieści się więc w limicie nowego sklepu, ale zajmuje go prawie całego na rok: ulepszenia drugiego sklepu w pierwszym roku idą za gotówkę. To świadoma presja.
- Ceny stroi przegląd balansu (§8.4).
- Koszt trafia do podsumowania sieci jako „Pakiet otwarcia: ul. …” (gotówka) albo jako rata w wyciągu nowego sklepu, z etykietą „Adaptacja lokalu: ul. …” (`Installment.label`).

### 10.4 Budowa i otwarcie **[C]** / **[R]**
- **Budowa** trwa 5–8 dni gry. Stan budowy trzyma firma (lokal „w budowie”, dzień otwarcia). Sklep jeszcze nie istnieje i niczego nie liczy.
- **[R] `createEconomy` zawsze tworzy sklep 1 września** (minuta `OPEN_FROM` dnia 0). Kalendarzowe rzeczy liczą się od dnia 0:
  - tydzień KPI;
  - pogoda;
  - termin remanentu w `createFranchisee(OPEN_FROM)`.

  Nowy sklep potrzebuje więc startu w danej minucie: o `OPEN_FROM` dnia otwarcia, z tygodniem KPI do najbliższej niedzieli i z remanentem w tym samym dniu co reszta sieci (`remanentDayFrom` liczy z kalendarza gry, więc wychodzi to samo samo z siebie). Dzisiejszy `createEconomy` dla starych wywołań się nie zmienia.
- **Otwarcie.** Nowy sklep startuje jak świeży:
  - towar Centrali (półki 80%, zaplecze 35%, 2 palety);
  - 2 osoby, reputacja 50, zaufanie 65, poziom 1;
  - premia Punktów Partnera jak dziś;
  - układ z `generateStore(subSeed(seed, 'store:' + lotId), lot.spec)`.

  Dodatkowo:
  - **bez gotówki startowej**, bo gotówka jest wspólna;
  - **bez gwarancji 25 tys.** (§11.2);
  - limit ubytków „znany”, jeśli franczyzobiorca przeszedł już remanent (pole `remanent.known` z wiedzy osoby, §14).
- Raty pakietu powstają przy otwarciu. Pierwsza schodzi z pierwszego przelewu nowego sklepu, jak każda rata w SIM 6.

## 11. Pieniądze przy kilku sklepach: trzy kieszenie

### 11.1 Co jest wspólne, a co osobne **[U]** (zasada) / **[C]** (podział)
Każdy sklep to osobna umowa z Centralą, więc ma osobne rozliczenie. Gotówka to pieniądze jednej osoby. Wspólne jest to, co należy do franczyzobiorcy albo do miasta, a osobne to, co należy do placówki i jej umowy.

Właściciel potwierdził to 31.10.2026 po pytaniu o osobne kasy dla sklepów: „wspólna gotówka, tak jakby to było w życiu”. W życiu franczyzobiorca z dwoma sklepami ma jedną działalność i jedno konto, a z Centralą podpisuje osobną umowę na każdą placówkę. Osobnych kas dla sklepów nie robimy, suma w pasku to nie podgląd, tylko prawdziwy portfel.

| Wspólne (raz na osobę albo miasto) | Osobne (każdy sklep i jego umowa) |
|---|---|
| **Gotówka** (portfel, licznik do celu) | **Saldo u Centrali, przelew, wyciąg** |
| Status Partnera | **Raty** (limit z przelewu i zaufania tego sklepu) |
| ZUS i księgowa (§11.2) | **Remanent** (własny towar), w tym samym dniu dla całej sieci |
| Siły franczyzobiorcy (zmęczenie, §12) | Zaufanie, KPI, poziom, XP, kamienie milowe |
| Ogonki | Zapasy, palety, dostawy, personel, sprzęt, remonty |
| Pogoda (losuje sklep #1, firma kopiuje o północy) | Karty dnia (w tle rozstrzyga zastępca) |
| Dochód z sieci z poprzednich gier: raz dziennie | Procentowe premie Punktów Partnera: w każdym sklepie |
| Premia dzienna i zarobek offline: raz, z wyników wszystkich sklepów | VAT (od przelewu sklepu), płace, media |
| Wiedza „limit ubytków poznany” | |

- **[R]** `closeDay` księguje `partner.networkIncome` w każdym sklepie. Przy kilku sklepach dostaje go tylko sklep o najniższym `id`, a pozostałe mają 0.
- **[R]** Blok `EconomyState.franchisee` z SIM 6 ma w komentarzu „należy do osoby, nie do sklepu”. Przy kilku sklepach to rozliczenie **umowy tego sklepu** (saldo, raty, remanent). Rzeczy osoby trzyma warstwa franczyzobiorcy (§14). Nazwy w kodzie zostają budowniczemu, ale nie mogą się mylić z `franchisee`.

### 11.2 Flagi dodatkowego sklepu **[C]**
Wchodzą przez `StoreInfo.site` (§8.3). Sklep startowy ich nie ma, więc liczy się jak dziś.
- **Bez gwarancji.** **[R]** `guaranteeTopUp` daje dopłatę każdemu sklepowi z mniej niż 3 raportami, więc dodatkowy sklep dostałby ją sam z siebie. Gwarancja jest dla nowych franczyzobiorców. Tekst Centrali: „Gwarancja przysługuje nowym partnerom. Pan/Pani jest już strategiczny/a.”
- **Bez ZUS i księgowej.** **[R]** `buildStatement` dolicza je każdemu wyciągowi, a ZUS płaci osoba, nie lokal. Płaci je sklep o najniższym `id` wśród otwartych, a po zamknięciu sklepu startowego następny w kolejności.
- **Debet sprawdza firma** (§11.4).

### 11.3 Pasek i podgląd **[C]**
- **Gotówka** zostaje główną liczbą.
- **Drugi wiersz** (saldo, raty, „Zostanie”) przy dwóch sklepach pokazuje sumę sieci z dopiskiem „sieć”. Stuknięcie otwiera prognozowany wyciąg z osobną częścią dla każdego sklepu.
- Kolor „Zostanie” i ostrzeżenia przy zakupach (`.tt-spend`) liczą prognozę całej sieci, bo debet dotyczy wspólnej gotówki.
- **Podgląd końca miesiąca** (`monthPreview.ts`) liczy każdy sklep na kopii stanu. Wynik musi zgadzać się z zamknięciem co do złotówki, jak dziś.

### 11.4 Debet **[C]** / **[R]**
- **[R]** `checkDebt` biegnie w `stepMinute` każdego sklepu. Przy wspólnej gotówce sklep #1 zamykający miesiąc na −60 tys. zakończyłby grę, zanim sklep #2 dołoży swoje +30 tys. tej samej minuty. O bankructwie decydowałaby kolejność, a nie wynik.
- Dlatego przy dwóch i więcej sklepach debet sprawdza firma, raz po minucie wszystkich sklepów. Sklepy mają wtedy flagę „debet sprawdza firma”.
- Granica −100 tys. zł i ostrzeżenie od −50 tys. zł dotyczą całej gotówki, bez względu na liczbę sklepów. Kilka wyciągów naraz szybciej zbliża do granicy, i o to chodzi.

### 11.5 Koniec miesiąca **[C]**
- Sklepy zamykają miesiąc w tej samej minucie (23:00 ostatniego dnia), po kolei według `id`. Każdy dodaje swoje „Zostaje Ci” do gotówki.
- **Jedno okno** z podsumowaniem sieci na pierwszej zakładce i wyciągiem każdego sklepu na kolejnych. Na telefonie zakładki to przełącznik segmentowy.
- **Podsumowanie sieci:**
  - „Zostaje Ci” każdego sklepu i razem;
  - pakiety otwarcia za gotówkę;
  - gotówka po zamknięciu;
  - wynik każdego sklepu (do statusu i do historii).
- **Remanent** wypada w całej sieci tego samego dnia. Protokoły pokazuje jedno okno z zakładkami.

## 12. Sklep w tle **[U]**

- Liczy się pełnym `stepMinute`, minuta po minucie razem z aktywnym, bez renderu. **[R]** Koszt jest pomijalny: 24 miesiące jednego sklepu odtwarzają się w ok. 3,3 s.
- **Ręce tylko tam, gdzie jesteś.** Stukanie działa w aktywnym sklepie.
- **Jedna pula sił [C].** Franczyzobiorca jest jeden, więc zmęczenie jedzie z nim. Przy przełączeniu nowy aktywny sklep dostaje bieżący stan puli.
- **Karty w tle:** zastępca od razu wybiera odpowiedź zaznaczoną z góry (`defaultAnswer`, jak `replayRun`). Skrzynka: „Traszka #2 (Lipowa): zastępca wybrał: …”. Jeśli kiedyś powstanie „zawsze odpowiadaj tak” z playtestu, zastępca czyta tę samą pamięć **[C]**.
- **Ważne zdarzenia z tła** czekają na „OK” z nazwą sklepu:
  - wyciąg;
  - remanent;
  - nowy próg zaufania;
  - wypowiedzenie umowy.

  Drobne informacje zamykają się same.
- Ustawienia sklepu w tle (zamówienia, priorytety ludzi) zostają, jakie były.

## 13. Zamknięcie sklepu, rozliczenie końcowe i koniec gry

### 13.1 Zamknięcie przez Centralę **[U]** / **[C]**
- Sklep z zaufaniem 0 przy zamknięciu miesiąca traci umowę. Zamyka się tylko on, a franczyzobiorca prowadzi pozostałe.
- **Rozliczenie końcowe [C]** (spec główny §10 **[R]**, `outstandingDebt` z SIM 6) biegnie zaraz po wyciągu tego miesiąca:
  1. natychmiastowy remanent od ostatniego liczenia: nadwyżka ponad limit do zapłaty;
  2. wszystkie niespłacone raty tej umowy;
  3. suma schodzi z gotówki jednym ruchem, z protokołem „Rozliczenie końcowe”.

  Bez tego zamknięcie byłoby darmowym sposobem na pozbycie się rat. Ten sam mechanizm przyda się rogalikowi przy upadku franczyzobiorcy.
- Lokal wraca na mapę jako „po Traszce” z wyposażeniem (§13.3).

### 13.2 Wypowiedzenie przez gracza **[U]**
Przycisk „Wypowiedz umowę” jest w panelu sklepu, dostępny tylko wtedy, gdy gracz ma więcej niż jeden sklep.
- Sklep działa normalnie do końca następnego miesiąca. To miesięczny okres wypowiedzenia, jak w pierwszym roku prawdziwej umowy.
- Potem przychodzi to samo rozliczenie końcowe co w §13.1.
- Przez okres wypowiedzenia Centrala nie finansuje nowych rat tego sklepu.

### 13.3 Lokal „po Traszce” **[C]**
- Lokal zachowuje wyposażenie: ulepszenia, sprzęt, poziom remontu i układ. Towar, ludzie, saldo i raty przepadają w rozliczeniu.
- **4a.2:** lokal można znów wziąć, a pakiet otwarcia kosztuje ok. 30% ceny, bo urządzenie lokalu zostało. Sklep startuje z wyposażeniem, ale z poziomem 1, reputacją 50 i zaufaniem 65.
- To jest „sklep zostaje” rogalika w wersji miejskiej (§14).

### 13.4 Koniec gry (do czasu rogalika) **[U]**
- Gotówka poniżej −100 tys. zł: franczyzobiorca upada, a wszystkie sklepy kończą się razem. Ekran końca jak dziś.
- Zamknięcie ostatniego sklepu przez Centralę (albo koniec wypowiedzenia ostatniego sklepu, §13.2 **[U]**) też kończy grę.
- Po rogaliku upadek w sztafecie zamiast końca gry uruchamia przejęcie (§14).

## 14. Rogalik: kto jest właścicielem czego

### 14.1 Trzy warstwy stanu **[C]**
Rogalik mówi: sklep zostaje, franczyzobiorcy się zmieniają. W prawdziwej sieci lokal i sprzęt należą do sieci, a franczyzobiorca prowadzi placówkę na umowie. 4a układa stan tak samo:

| Warstwa | Co w niej jest | Co się z nią dzieje przy zmianie franczyzobiorcy |
|---|---|---|
| **Miasto i lokale** | generator, stany lokali, wyposażenie lokali „po Traszce”, konkurencja | zostaje (ten sam seed) |
| **Franczyzobiorca (osoba)** | gotówka, status Partnera, siły, ZUS i księgowa, wiedza o limicie ubytków, Ogonki; w rogaliku imię i zdjęcie | wymienia się na nową osobę (5000 zł, bez statusu) |
| **Placówki** | `EconomyState` każdego sklepu z rozliczeniem umowy (saldo, raty, remanent) | sklep startowy przechodzi na następcę, pozostałe wracają jako lokale „po Traszce” (§14.2) **[U]** |

Dzięki temu rogalik nie musi przebudowywać 4a ani odwrotnie. Przejęcie to wymiana osoby i decyzja, które placówki przechodzą dalej.

### 14.2 Upadek franczyzobiorcy z kilkoma sklepami **[U]**
- następca w sztafecie dostaje **tylko sklep startowy**, z całym wyposażeniem, jak dziś przewiduje rogalik;
- pozostałe sklepy przechodzą rozliczenie końcowe (dług zostaje przy upadłym, na zdjęciu w ramce) i wracają na mapę jako lokale „po Traszce” z wyposażeniem;
- następca może je znów wziąć, gdy sam zdobędzie status (4a.2, §13.3).

Każdy sklep „zostaje”. Celowe topienie franczyzobiorców z trzema sklepami kosztuje: status i pakiety otwarcia trzeba zdobyć od nowa. Właściciel chciał, żeby to kosztowało („Niech kosztuje”).

W trybie hardcore upadek kończy grę, więc ta zasada go nie dotyczy.

### 14.3 Cel 1 mln zł przy kilku sklepach **[U]**
- **[U]** Cel to 1 mln zł gotówki. Gotówka jest wspólna (§11.1), więc kilka sklepów zbiera na jeden cel.
- **[R]** Z raportu SIM 6: jeden sklep „mistrz z zakupami” dochodzi do miliona w 21.–22. miesiącu, a bierny w 6–13 lat. Miasto skróci ten czas. Ile, zmierzy strategia „mistrz z ekspansją” (§8.4).
- **[U]** W pamięci projektu jest zapisane, że miasto podniesie albo zmieni cel, a cel ma być przypięty do trybu. Cel zostaje 1 mln zł także przy kilku sklepach.
- **[C]** Cel siedzi w jednej tabeli „tryb → cel”, a każdy wynik zapisuje tryb i wersję celu. Podniesienie poprzeczki później nie miesza wyników.
- 4a.1 celu nie pokazuje (SIM 6 i tak zostawiło to rogalikowi), ale podsumowanie sieci ma na niego miejsce.

### 14.4 Tryby **[C]**
- **Zwykła gra:** miasto jest.
- **Ranking:** bez miasta **[U]**.
- **Hardcore i sztafeta rogalika:** miasto jest, z celem 1 mln zł **[U]**.
- Punkty Partnera w trybach rogalika: §15.

## 15. Prestiż **[U]**

- Przycisk „Otwórz kolejną Traszkę” i okno prestiżu znikają w 4a.1, razem z możliwością wzięcia drugiego lokalu. Ich miejsce zajmuje ekspansja w mieście.
- Sekcja „Twoja sieć Traszek” w zakładce Cele zmienia się w listę sklepów w tym mieście. Pod nią zostaje wiersz „Z poprzednich gier: N sklepów, X zł dziennie, P Punktów Partnera”, jeśli gracz je ma.
- `meta.network`, `meta.partnerPoints` i `partnerOf` działają dalej w zwykłej grze. Procentowa premia trafia do każdego sklepu, a dochód z sieci raz dziennie (§11.1). Ranking i tak startuje bez partnera (`freshRun`) **[R]**.
- **[C]** Gracz, któremu dziś przysługuje „Otwórz kolejną Traszkę” (`prestigeReady`), traci tę możliwość po aktualizacji. Zdobyte punkty i dochód zostają. Komunikat w notce wydania.
- **[C] Rogalik:** stary projekt dawał nowe Punkty Partnera w 4b „za zamknięcie miasta”. Rogalik ma inny koniec (milion zł albo upadek), więc źródło nowych punktów rozstrzyga spec rogalika. Rekomendacja na tamtą rozmowę: punkty nie działają w trybach hardcore i sztafeta, bo psułyby porównywalność wyników.

## 16. Zapis gry **[C]**

- **Nowa koperta** zapisu firmy ze schematem 3 pod **własną stałą** (np. `FIRM_SAVE_SCHEMA = 3`). `SAVE_SCHEMA` zostaje 2, bo na nim stoi zapis biegu rankingowego. Klucz zostaje `traszka:save:<seed>`.
- **Koperta zawiera:**
  - seed, `gameVersion` i `CITY_GENERATOR_VERSION`;
  - zmiany w mieście (§7.4);
  - warstwę osoby (§14);
  - dla każdego sklepu `lotId`, `generatorVersion`, układ i `EconomyState`.
- **Stary zapis (schemat 1 i 2, każda wersja SIM)** wczytuje się bez straty: sklep z zapisu staje się sklepem #1 w lokalu startowym, a miasto generuje się z seeda. Migracje SIM 4 i 5 z SIM 6 działają jak dziś, bo dotyczą `EconomyState`.
- Starsza wersja gry, która trafi na schemat 3, pokazuje „Zapis pochodzi z nowszej wersji gry” i niczego nie nadpisuje. Po wdrożeniu nie wolno cofać produkcji przed ten commit.
- **Rozmiar:** „Wyślij zapis” przyjmuje 64 KB (`src/server/saves.ts`).
  - Stary pomiar to ok. 16 KB na sklep po 90 dniach, a SIM 6 dołożył blok rozliczenia, raty i wyciągi w historii raportów. Pomiar trzeba powtórzyć na dzisiejszym `main`.
  - Test sprawdza najgorszy przypadek: 2 sklepy w 4a.1, 3 sklepy w 4a.2, każdy po dwóch remontach, koniec roku.
  - Miasto zapisuje tylko zmiany, więc prawie nic nie waży.

## 17. Samouczek: dymki „pierwszy raz” **[C]**

- Dymki działają jak dzisiejsze (spec samouczka §5): raz na przeglądarkę, bez przygaszania i bez zatrzymywania gry, wyłącza je to samo pole w ⚙.
- Działają też w rankingu, bo tylko coś pokazują.
- Mieszkają w osobnym pliku (np. `src/ui/tutorial/city.ts`, jak `money.ts`). Ich identyfikatory dochodzą do `TIP_IDS`.

| Id | Kiedy | Wskazuje (`data-tut`) | Tekst |
|---|---|---|---|
| `tip-miasto` | pierwsze otwarcie ekranu miasta | `city-status` (pasek statusu) | bez statusu: „Mapa miasta. Kartka „DO WYNAJĘCIA” to wolny lokal. Weźmiesz go, gdy Centrala nada Ci status Partnera: pasek mówi, czego brakuje.” · ze statusem: „Masz status Partnera. Stuknij kartkę, żeby zobaczyć lokal. Liczby na karcie to widełki, nie obietnica.” · w rankingu: „W sezonie rankingowym miasto tylko oglądasz.” |
| `tip-lokal` | pierwsza karta lokalu, gdy gracz ma status | `lot-price` (pakiet otwarcia) | „Urządzenie lokalu płacisz od razu albo w 12 ratach z przelewów nowego sklepu. Nowy sklep nie ma gwarancji 25 tys. zł: na siebie zarabia sam.” |
| `tip-sklepy` | pierwszy raz otwarte dwa sklepy | `store-switch` (chip) | „Tu przełączasz sklepy. Sklep w tle pracuje sam, a jego karty rozstrzyga zastępca: wybiera odpowiedź zaznaczoną z góry. Ręce masz tylko tam, gdzie jesteś.” |
| `tip-siec` (w oknie) | pierwszy koniec miesiąca z dwoma sklepami | `network-summary` | „Każdy sklep ma swój wyciąg, ale gotówka jest jedna: minus w jednym sklepie zjada plus w drugim.” |

- Liczby w tekstach biorą się ze stałych gry.
- Słowniczek „Jak grać” dostaje hasła:
  - „Partner Strategiczny”;
  - „Pakiet otwarcia”;
  - „Zastępca”;
  - „Dzielnica”;
  - „Rozliczenie końcowe”.

  Limit słów „Jak grać” (dziś 490) może wymagać podniesienia.
- Przelot się nie zmienia.

## 18. Tłumaczenie **[C]**

- **Każdy nowy tekst** UI idzie przez `t` albo `tr` i ma wpis w `EN_UI`, także liczba mnoga (`EN_PLURALS`). Test `tests/i18n.test.ts` musi przejść bez dopisywania nowych pozycji do listy `SKIP`.
- **Dane po identyfikatorach:**
  - dzielnice, formaty lokali, stany lokali i opisy „kto przychodzi” mają słowniki angielskie (jak `EN_REMONTS`);
  - karty Dworca (4a.2) mają wpisy w `EN_CARDS`.
- **Nazwy własne** (miasto, ulice z polskich członów, Szop 24h, Kawka Express) zostają po polsku. To świadome pominięcia z powodem w `SKIP`. Format adresu („ul. Ogrodowa 12” → „12 Ogrodowa St.”) robi `t`.
- **Zdarzenia firmy nie są polskimi zdaniami w symulacji.** Nadanie statusu, otwarcie sklepu, wpis zastępcy i rozliczenie końcowe niosą identyfikator i parametry, a tekst składa UI (jak `commentId` w raporcie). Dzięki temu tłumacz zdań symulacji nie potrzebuje nowych wzorców.
- **Napisy w scenie:** kartka „DO WYNAJĘCIA” i szyldy na mapie mają wpisy w `EN_RENDER`.
- Teksty Centrali z §10 wolno skrócić tylko za zgodą właściciela. Wersja angielska trzyma ton z glosariusza `docs/i18n/glossary-en.md`.

## 19. Render i wydajność **[C]**

**4a.1 (widok warstw):**
- budynki to niskie bryły z obrysu, sklejone w jedną geometrię na chunk (2×2 kwartały);
- ulice mają kolory wierzchołków według natężenia, tło kwartałów według dzielnicy;
- pinezki to nakładka HTML jak `src/ui/worldOverlay.ts`, z kartką z §9.2;
- bez cieni i bez aut. Cel: poniżej 60 draw calli, płynnie na telefonie.

**4a.2 (makieta):**
- budynki proceduralne (blok, kamienica, pawilon, biurowiec, dworzec) z paletą ze `style.ts` i fasadami z `src/render/street/facadeAtlas.ts`, żeby miasto wyglądało jak ulica przed sklepem;
- drzewa i auta przez `InstancedMesh`, poniżej 150 draw calli na całym mieście;
- warstwy na tej samej geometrii: spłaszczenie i podmiana materiału, bez drugiego modelu;
- presety:
  - Niska i telefon: bez cieni, bez aut, warstwa domyślnie;
  - Średnia: cienie statyczne i auta;
  - Wysoka: N8AO.
- `?bench=1` dostaje ujęcie miasta.

**Pamięć:** scena miasta i scena sklepu nie muszą żyć naraz. Na telefonie scena miasta zwalnia się po wyjściu z zakładki.

## 20. Kiedy zrobione

**4a.1**
1. `tests/simGolden.test.ts` przechodzi bez zmian i bieg rankingowy daje identyczny wynik. Jeśli wybrano jedno podbicie (§3.1): `GOLDEN[7]`, przebudowany sędzia, a test architektury potwierdza, że w bundlu sędziego nie ma miasta ani firmy.
2. Firma z jednym sklepem daje bit w bit ten sam `EconomyState` co dzisiejsza pętla (test skrótu).
3. **Generator miasta:**
   - złote seedy;
   - lokal startowy na Osiedlu z `LotSpec` równym `generateStore(seed).lot`;
   - lokal obok poza listą;
   - każdy lokal dostępny od ulicy;
   - w każdej dzielnicy innej niż neutralna co najmniej jeden wolny lokal;
   - konkurencja nie stoi na wolnym lokalu ani blisko sklepu startowego;
   - każdy wolny lokal daje sklep z generatora.
4. **Dzielnice:**
   - test neutralności;
   - testy kierunku: Śródmieście ma większy koszyk, Dworzec większe ubytki z kradzieży, Biurowce pusty weekend;
   - `site` przeżywa remont.
5. **Firma:**
   - determinizm;
   - gotówka bez dublowania;
   - debet sprawdzany po minucie wszystkich sklepów (test na przypadku z §11.4);
   - zastępca przy kartach, jedna pula sił, wspólna pogoda, dochód z sieci raz dziennie;
   - ZUS i księgowa raz;
   - brak gwarancji w nowym sklepie;
   - raty pakietu w nowym sklepie i limit z §10.3;
   - remanent tego samego dnia;
   - wiedza o limicie ubytków przechodzi na nowy sklep;
   - limit 2 sklepów;
   - zamknięcie jednego sklepu z rozliczeniem końcowym (remanent i raty);
   - koniec gry przy ostatnim sklepie i przy debecie.
6. **Zapis:**
   - schemat 2 (w tym zapisy SIM 4 i 5 z połowy miesiąca) wczytuje się jako firma z jednym sklepem;
   - schemat 3 tam i z powrotem daje identyczny przebieg 1000 kroków;
   - najgorszy przypadek mieści się w 64 KB.
7. **Ranking:** ekran miasta widać, statusu nie ma, polecenie wynajmu jest odrzucane.
8. **Widok:**
   - pasek z sumą sieci na 390 px bez ucinania;
   - podgląd równy zamknięciu dla dwóch sklepów;
   - okno miesiąca z zakładkami;
   - przełącznik;
   - dymki z §17;
   - angielski: `tests/i18n.test.ts`.
9. **Smoke w headless Playwright**, desktop i 390 px:
   - status;
   - wynajem gotówką i na raty;
   - budowa i otwarcie;
   - przełączanie;
   - wyciąg dwóch sklepów;
   - zamknięcie sklepu;
   - stary zapis;
   - konsola czysta.
10. **Balans na botach** (§8.4, §10.3) i przegląd części.

**4a.2:** makieta z benchmarkiem na presetach, trzeci sklep i zapis trzech sklepów, karty Dworca bez przesunięcia talii w innych dzielnicach, profile dnia, ponowny wynajem „po Traszce”, przegląd etapu (Opus).

## 21. Odpowiedzi właściciela (2026-10-31)

1. **Co wchodzi najpierw (1a):** płaska mapa miasta z wynajmem jednego lokalu (4a.1, najwyżej dwa sklepy), a makieta 3D, trzeci sklep i karty dzielnic w 4a.2.
2. **Dodatkowe sklepy przy upadku w sztafecie (2a):** następca dostaje tylko sklep startowy, a pozostałe wracają na mapę jako lokale „po Traszce” z wyposażeniem, które następca może znów wziąć po zdobyciu statusu.
3. **Oddanie sklepu przez gracza (3a):** tak, przez wypowiedzenie umowy z miesięcznym okresem i rozliczeniem końcowym (niespłacone raty i braki z ostatniego liczenia).
4. **Cel przy kilku sklepach (4a):** zostaje 1 mln zł gotówki, a cel jest przypięty do trybu, więc poprzeczkę da się podnieść później bez mieszania wyników.

## 22. Co zostaje budowniczemu

- Liczby **[C]**:
  - mnożniki dzielnic;
  - ceny pakietów i czas budowy;
  - promień konkurencji;
  - szerokość widełek;
  - zniżka za lokal „po Traszce”.

  Stroi je przegląd balansu.
- Kształt stanu miasta, firmy i warstwy osoby, nazwy typów i plików, sposób synchronizacji gotówki między sklepami (np. przed krokiem sklepu `cash` dostaje stan portfela, a po kroku portfel przejmuje `cash`).
- Algorytm generatora, o ile spełnia niezmienniki z §20.
- Wygląd budynków w stylu sklepu (przegląd artystyczny w 4a.2).
- Forma pinezek, zakładek okna miesiąca i wejścia do miasta na 390 px (§9.1).

## 23. Kolejność prac (wskazówka dla planu 4a.1)

1. Generator miasta i ruch: czysty `src/sim/city`, testy, bez renderu.
2. Dzielnice i flagi w ekonomii przez `StoreInfo.site`: test neutralności, testy kierunku.
3. Firma (`src/sim/firm`): warstwy z §14, lista sklepów, gotówka, kolejność kroków, debet po minucie firmy, sklep w tle, zastępca, pula sił, start sklepu w danej minucie, polecenia firmy (wynajem, przełączenie) w osobnym typie poza `Command`.
4. Status, pakiet otwarcia, budowa, otwarcie, rozliczenie końcowe, zamknięcie jednego sklepu.
5. Zapis schematu 3 z migracją i pomiarem rozmiaru.
6. Ekran miasta w widoku warstw, kartka wspólna z renderem remontu.
7. UI:
   - zakładka Miasto, lista i karta lokalu;
   - przełącznik;
   - pasek sieci, podgląd, okno miesiąca;
   - prestiż;
   - dymki;
   - angielski.
8. Balans na botach, smoke, przegląd.

Kroki 1 i 6 mogą iść równolegle po ustaleniu kształtu miasta. Kroki 2 i 3 mogą iść równolegle, jeśli rozsądnie dzielą pliki ekonomii.

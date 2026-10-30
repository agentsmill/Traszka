# Palety bez odsyłania, debet 100 tys., cele „Odbierz” i rzadsze karty (SIM_VERSION 5)

Status: projekt sesji `palety-bez-odsylania` (2026-10-30), do weryfikacji koordynatora · Wypchnięcie: poniedziałek 2.11.2026, na granicy tygodnia rankingu · Podstawa: playtest właściciela z 30.10.2026 na produkcji (SIM_VERSION 4).

Wszystkie zmiany poniżej zmieniają wynik symulacji, więc wchodzą jedną podwyżką `SIM_VERSION` z 4 na 5 (nowy wpis `GOLDEN[5]`, przebudowany bundle sędziego). Biegi rankingowe z SIM 4 przestają przechodzić (`old-version`), a gra trzyma je lokalnie jak dotąd.

## 1. Decyzje właściciela (wiążące, cytaty z 30.10.2026)

- „te palety muszą się rozkładać całe w sklepie, bo to odsyłanie palet jest bez sensu”
- „jak ktoś zamówi za dużo palet, to jego sklep będzie nimi zasrany, ludzie się będą potykać, nie będą się mogli przesuwać … przynajmniej zobaczymy, że jest za dużo palet”
- „Palety są za często”
- „zwiększ możliwy debet do 100k”
- „jak zrealizujemy cel, … to się samo nam dodaje. Powinniśmy klikać odbierz”
- „zmniejszmy ilość eventów do 0,5 na dobę” (koordynator: 0,5 na dobę łącznie, karty dnia i okólniki razem)

## 2. Skąd się wzięło 27 odesłanych palet (pomiar przed zmianą)

Odtworzone na SIM 4, boty z `tycoon/bots.ts` przez `economyEnv`. Gracz z wózkiem, regałami, rampą i trzema osobami grał 30–90 dni na pięciu seedach testu bilansu.

- **Asystent w trybie auto przez cały sezon nie odesłał ani jednej palety** (5 seedów × 60 dni). Jego zamówienie liczy zapas razem z paletami, więc przy pełnych półkach zamawia mniej.
- **Zamówienie ręczne większe od sprzedaży odsyła dziesiątki palet.** Przy ręcznym 8 palet dziennie (sprzedaż ok. 6) kierowca zabrał 41–62 palety w 30 dni. Przy 10 dziennie zabrał 99–126 palet. W momencie odesłania półki są pełne w 100% i zaplecze w 100%. Palety stoją po 2–8 dni z resztką towaru, na którą nie ma miejsca (`room = 0`). Zajmują wtedy miejsca, a każda następna dostawa ich nie ma.
- **Załoga w tym czasie nie stoi przy kasach.** Licznik `starved.rozladunek` (rozładunek bez rąk) jest równy 0. Bezczynność to ok. 135–140 osobominut dziennie. Hipoteza „w falach załoga stoi przy kasach i rozładunek stoi” się nie potwierdza. Rozładunek stoi, bo towar nie ma gdzie trafić.
- **Drugie źródło: asystent zamawiał ponad liczbę miejsc.** Górną granicą była tylko wydajność zmiany (`crewPalletCap`). Przy trzech osobach z wózkiem to 17 palet, a sklep ma 15 miejsc (chodnik, sala i zaplecze z rampą). Przy pustych półkach, na starcie i po remoncie, który powiększa półki, asystent zamawiał 17. Kierowca zabierał wtedy 1–2 palety.

Wniosek: odesłane palety to objaw nadmiaru towaru, a nie braku rąk. Bez odsyłania ten nadmiar musi stanąć w sklepie i być widoczny. Tak chciał właściciel.

## 3. Zero odsyłania

- `deliver()` stawia każdą paletę z dostawy. Kolejność miejsc się nie zmienia: z rampą najpierw zaplecze, potem chodnik i sala. Gdy zwykłe miejsca się skończą, paleta trafia na nowe miejsce **`aisle` („W przejściach”)**. Opłata `RETURN_FEE` i zaufanie `driverReturned` znikają. Komunikat o zabraniu palety zastępuje ostrzeżenie: „Zabrakło miejsca: N palet stoi w przejściach. Klienci się potykają…”.
- **Komenda gracza `returnPallet` i przycisk „Odeślij” znikają** z interfejsu, pomocy i podpowiedzi.
  - *Decyzja sesji:* typ `returnPallet` zostaje w unii `Command` wyłącznie jako zapis historyczny. Odmawia zawsze, nie zmienia stanu i nie ma go w interfejsie.
  - *Powód:* zapisany bieg rankingowy z SIM 4 przechodzi przez `readRun` (`isCommand` każdego wpisu). Wpis nieznanego typu odrzuciłby cały zapis, a stare zapisy mają się wczytać.
- Stała `TRUST.returnedPallet` i `TRUST.driverReturned` znikają. Przyczyna zaufania `palety` zostaje w typie, bo stare raporty miesięczne ją mają. Nowa gra jej nie nalicza.
- *Decyzja sesji:* limit kredytu kupieckiego liczy też palety w drodze. Wcześniej `room` w `placeOrder` pomijał dostawę popołudniową z `dostawy2`, więc zapas mógł przekroczyć limit o pół zamówienia. Teraz limit naprawdę ogranicza liczbę palet w sklepie.

## 4. Miejsca w przejściach (`StoreInfo.spots.aisle`)

- Kwadraty 2×2 na podłodze sali (`floor`), gęsto, bez odstępu, od środka sali na zewnątrz (ta sama dokładna arytmetyka co `floorSpots`).
- Wykluczone kratki:
  - kolejka do kasy;
  - pas personelu;
  - dostęp do kasy, slotów i drzwi zaplecza;
  - wejście i punkty pojawiania się klientów;
  - zwykłe miejsca w sali.
- Gwarancja: z wejścia da się dojść do kolejki i kasy (BFS przy każdym kandydacie). Regały mogą zostać odcięte, bo to jest „zasrany sklep”.
- **Pojemność bez końca.** Gdy kwadraty się skończą, następne palety stają na tych samych kwadratach jako drugie i kolejne piętro stosu.
  - Paleta przechowuje numer `spot`.
  - Kwadrat to `spot mod n`, piętro to `floor(spot / n)` (helper `palletPlace` w `storeInfo.ts`).
  - Wszystkie miejsca w kodzie, które czytały `info.spots[loc][spot]` (widok, cele załogi, przeszkody tłumu, `fitsStore`), idą przez ten helper.
- Górną granicę liczby palet daje limit kredytu kupieckiego (§3): przy `CREDIT_LIMIT` 70 tys. to ok. 24 palety towaru (po zmianie z §6), a po trzecim remoncie ok. 60. `LIMITS.pallets` w `sanitize.ts`: 64 → 256.
- Gracz może przenieść paletę z przejścia na wolne zwykłe miejsce (`movePallet`). Do przejścia przenieść jej nie można: tam stawia kierowca i załoga (niżej).
- **Załoga wciąga w przejścia paletę spod sklepu, której towaru nie ma gdzie wyłożyć** (pełne półki i zaplecze), gdy stoi tam co najmniej 2 godziny (`CLUTTER.pullInMin`, sprawdzane o pełnej godzinie, gdy załoga jest w sklepie).
  - *Decyzja sesji po pomiarze:* bez tego nadmiar kończył się bankructwem z mandatów, nie zagraceniem. Pięć takich palet stało na chodniku dwa tygodnie, a Straż Miejska pisała mandaty co obchód: ok. 5,6 tys. zł dziennie i −2 reputacji za każdy. Mały sklep (`seed-3`) zbankrutował 26. dnia, choć gracz wrócił do asystenta 13. dnia.
  - Z wciąganiem nadmiar widać w sali, jak chciał właściciel, a mandat zostaje karą za palety, które czekają na ręce.
- Rozładunek zaczyna od chodnika (mandat), potem przejścia, sala i zaplecze (`PALLET_ORDER`). Tempo w przejściu jak w sali (`UNLOAD_AT.aisle = 1`).
- Remont (`relayout`): paleta z przejścia najpierw szuka zwykłego miejsca w nowym układzie. Żadna paleta już nie przepada.

## 5. Skutek zagracenia w symulacji (deterministyczny)

Zagracenie `Z` to liczba palet w sali i w przejściach. Wszystkie wzory są czystymi funkcjami stanu, więc odtworzenie na serwerze daje to samo.

| Skutek | Wzór | Uzasadnienie |
|---|---|---|
| Klienci rezygnują przy wejściu | ruch × `max(0,5; 1 − 0,08·(Z + worki w sali))` (dotąd liczyły się tylko palety w sali) | przy 6 paletach ruch spada o połowę, ale nie niżej |
| Klienci wolniej przechodzą i szybciej się zniechęcają | cierpliwość − `min(3, Z)` | najwyżej −3, tyle co trzy palety w sali dotąd |
| Reputacja spada proporcjonalnie | co minutę otwarcia −0,0006 × `min(8, palety w przejściach)`, ale nie poniżej 25 (`CLUTTER.repFloor`) | najwyżej −4,9 punktu dziennie; jedna paleta to −0,6 dziennie, a obsługa klientów daje ok. +1,4 dziennie |

**Wyjście z zagracenia.**

- Rozładunek nie zwalnia od zagracenia. Ruch nie spada poniżej połowy, więc sklep dalej sprzedaje, a towar schodzi.
- Zagracenie nie zbija reputacji poniżej 25. Przy 0 sklep miałby 0,6 ruchu razy 0,5 od zagracenia i towar schodziłby tygodniami.
- Asystent w trybie auto przy pełnym zapasie zamawia 0. Gracz, który przełączy zamówienie na auto, wychodzi z zagracenia sam (test `tycoon/overflow.test.ts`).
- Dodatkowo nadmiar ogranicza kredyt kupiecki: towar w sklepie i w drodze (licząc palety) nie może być wart więcej niż 70 tys. zł, czyli ok. 24 palety razem z półkami i zapleczem. Dlatego w średnim sklepie na start (`traszka-1`, 12 zwykłych miejsc) nadmiar w ogóle nie trafia w przejścia, a w małym (`kopytka-541`, `seed-3`) w przejściach staje 10–19 palet.

## 6. „Palety są za często”: większa paleta i asystent pilnuje miejsc

Pomiar: sklep sprzedaje 5–7 palet towaru dziennie (320 sztuk) i co dzień rano dostaje 5–7 palet do rozładunku. Przy ×8 to dostawa co ok. 25 s.

Rozważone i odrzucone: **dostawa co drugi dzień.** Zapas docelowy (półki plus 60% zaplecza) wystarcza na 0,94–2,57 dnia sprzedaży, a 4 z 10 zmierzonych sklepów startowych mają poniżej 1,5 dnia. Dwudniowa dostawa wymagałaby przebudowy pojemności i zostawiała małe sklepy z pustymi półkami.

Wprowadzone (*decyzja sesji*):

- **`PALLET_ITEMS` 320 → 480.** Ten sam towar przychodzi na trzech paletach zamiast pięciu, czyli dziennie ok. 3,5–4,5 palety zamiast 5–7. Tempo rozładunku jest w sztukach, więc praca zmiany się nie zmienia.
- Stałe liczone na paletę skalowane ×1,5, żeby koszty i nagrody na sztukę zostały:

  | Stała | Było | Jest |
  |---|---|---|
  | `PALLETS_FREE` | 6 | 4 |
  | `PALLET_FEE` | 60 | 90 |
  | `FINE_PER_PALLET` | 100 | 150 |
  | `STRAZ.perPallet` | 0,25 | 0,375 |
  | `GOLDEN_CHANCE` | 0,025 | 0,0375 (dalej ok. jedna złota na tydzień) |
  | `XP.pallet` | 12 | 18 |
  | `WASTE.bagsPerPallet` | 1 | 1,5 |
  | `WASTE.bagsFoilDrinks` | 2 | 3 |
  | domyślne zamówienie ręczne | 4 | 3 |

  Liczba worków z palety była całkowita: `palletBags` zwraca teraz 1,5 i 3, a `sanitize` przyjmuje ułamek (stare zapisy mają 1 i 2).
- **Asystent nie zamawia ponad miejsca.** Górna granica to mniejsza z dwóch liczb: `crewPalletCap` oraz suma zwykłych miejsc, na które stawia kierowca (chodnik, sala, a z rampą wolne miejsca na zapleczu). Asystent nigdy sam nie zagraca przejść. Nadmiar w przejściach to zawsze decyzja gracza (zamówienie ręczne).
- **Ulepszenie `asystent`** (współczynnik `overorder` 1,3 / 1,15 / 1,02): zostaje bez zmian. Zawyżenie liczy się od braku do zapasu docelowego, a nie od sprzedaży, więc średnio nie zwiększa dostaw. Zwiększa tylko zapas na zapleczu. Przy większej palecie zaokrąglenie w górę samo daje zapas, więc dalsze strojenie nie jest potrzebne.

## 7. Debet

`DEBT_LIMIT` −10 000 → **−100 000**. Ostrzeżenie (`DEBT_WARN_SHARE` 0,5) przychodzi przy −50 000.

Skutek dla mandatu za sprzedaż energetyka nieletniemu (`MINOR_SALE_FINE = {min: 4000, dailyMargins: 2}`):

- przy −10 tys. trzy takie mandaty z rzędu kończyły grę;
- przy −100 tys. potrzeba ich kilkunastu.

Liczby są w raporcie. Bez przestrajania, zgodnie z poleceniem.

## 8. Cele odbierane kliknięciem „Odbierz”

- Nowe pole stanu `milestonesReady: string[]`: cele spełnione, jeszcze nieodebrane.
- `checkMilestones` (co godzinę gry) przenosi spełniony cel do `milestonesReady` i wysyła zdarzenie `milestone`: „Cel osiągnięty: … Odbierz nagrodę w zakładce Cele.” Nagrody już nie dolicza.
- Nowa komenda **`claimMilestone { id }`**:
  - cel z `milestonesReady` przechodzi do `milestones`;
  - dolicza Ogonki i XP (`XP.milestonePerOgonek`);
  - wchodzi do dziennika biegu, więc sędzia odtwarza ją jak każdą inną;
  - odmowa, gdy cel nie czeka na odbiór.
- Cele z `milestones` w zapisie SIM 4 są już odebrane i tak zostają. Brak pola w starym zapisie oznacza `[]`. Nieodebrane cele nie przepadają.
- *Decyzja sesji:* gotowość sprawdza się tylko dla celów, których nie ma ani w `milestones`, ani w `milestonesReady`. Warunek celu nie musi trwać do odbioru, np. „3 osoby na zmianie” po zwolnieniu jednej i tak zostaje do odebrania.
- Interfejs:
  - w panelu celów cele do odebrania są na górze, z wyróżnieniem i przyciskiem „Odbierz”;
  - w pasku HUD plakietka z liczbą celów do odebrania.
- Boty:
  - `bierny` nie odbiera, bo niczego nie klika;
  - `stukacz`, `decydent` i `mistrz` odbierają od razu.

## 9. Mniej kart: 0,5 na dobę łącznie

*Decyzja sesji po pomiarze:* każda karta waży trzy razy więcej (`CARDS.stakes` = 3).

- **Na co działa mnożnik:**
  - pieniądze z odpowiedzi (bez mandatów);
  - zaufanie i reputacja;
  - efekty ruchu i marży w procentach.
- **Na co nie działa:**
  - mandat `MINOR_SALE_FINE` (zgodnie z poleceniem, żeby nie przestrajać go bez zgłoszenia);
  - czas ludzi, siły i Ogonki;
  - zamknięcie sklepu i liczba osób na zmianie, bo tekst karty mówi „na godzinę” albo „jedna osoba”.
- **Powód:**
  - bez mnożnika bierny gracz kończył dwa miesiące z medianą +5,2 tys. zł zamiast ok. 0, bo rzadziej zatwierdzał kosztowne domyślne odpowiedzi;
  - przewaga dobrych decyzji spadła o połowę, a „stukanie dokłada najwyżej 20%” się nie trzymało.
- **Dlaczego mnożnik obejmuje ruch i marżę:** bez nich zmieniłby wybór w kartach, w których jedna odpowiedź kosztuje złotówki, a druga zmienia ruch. Przykład to glitch kasy, w którym mały rabat lepiej przeczekać.
- **Opłata Centrali:** `FRANCHISE_FEE_SHARE` 0,151 → 0,153. Wyniki są w raporcie.

| Parametr | Było | Jest |
|---|---|---|
| Karty dnia | 0 z szansą 0,15; 1 z szansą 0,6; 2 z szansą 0,25 (średnio 1,1) | 0 z szansą 0,6; 1 z szansą 0,4 (średnio 0,4) |
| Okólnik | co 2–4 dni (`circularGapMin` 2, `circularGapSpan` 3) | co 4–6 dni (`circularGapMin` 4, `circularGapSpan` 3, średnio co 5) |

Okólnik zajmuje miejsce karty dnia i wymusza co najmniej jedną kartę w swoim dniu. Średnio wychodzi ok. 0,4 + 0,6 × 0,2 ≈ 0,52 karty na dobę.

Zasada „pierwszy dzień gry ma kartę” zostaje: to pierwsze spotkanie z mechaniką.

Test bilansu sprawdza tempo 0,4–0,6 karty na dobę, czyli kartę co ok. 5,5–8 min przy ×1 i co 40–60 s przy ×8. XP i zaufanie z kart w miesiącu przed zmianą i po niej są w raporcie.

## 10. Testy i kryteria

- Test bilansu (`tycoon/balance.test.ts`) przechodzi na nowych liczbach, w razie potrzeby po strojeniu udokumentowanym w raporcie.
- Nowy test „nadmiar palet” (`tycoon/overflow.test.ts`):
  - gracz zamawia ręcznie ponad sprzedaż;
  - żadna paleta nie znika;
  - nadmiar stoi w przejściach;
  - ruch i reputacja spadają;
  - po powrocie do asystenta przejścia pustoszeją w ograniczonym czasie.
- `GOLDEN[5]` w `tests/simGolden.test.ts`:
  - `PLAN` zamiast `returnPallet` ma `claimMilestone`;
  - polecenie dochodzi też do `judge-worst-case.mjs`, `judgeBundle.test.ts` (`LOG`), `rankedSeason.test.ts` i `ranking-smoke.mjs`.
- Stary zapis z SIM 4 (fixture w `src/game/fixtures/`) wczytuje się z paletami na swoich miejscach i z celami odebranymi.
- Smoke w headless Playwright na `vite preview` z `?debug=1`:
  - nadmiar w przejściach;
  - brak komunikatu o zabraniu palet;
  - wczytanie zapisu SIM 4;
  - czysta konsola;
  - zrzuty ekranu.

## 11. Urealnienie ekonomii (decyzja właściciela z 30.10.2026: „Tak, urealnij”)

Źródło liczb: publiczne dane dużej polskiej sieci convenience za 2025 r. z prasy. W samej grze nazwy sieci nie ma.

| Rzeczywistość (2025) | Wartość |
|---|---|
| Marża franczyzobiorcy, ze sprzedaży i wynagrodzenia motywacyjnego, przed jego kosztami | ok. 446 tys. zł rocznie (ok. 37 tys. zł miesięcznie), ok. 16,5–16,7% obrotu |
| Obrót sklepu | ok. 2,4–2,7 mln zł rocznie, czyli 6,6–7,4 tys. zł dziennie |
| Przychód gwarantowany nowego franczyzobiorcy | 25 tys. zł miesięcznie |
| Wkład na start | ok. 5000 zł |

| Stała | Było (SIM 5 przed urealnieniem) | Jest | Uzasadnienie |
|---|---|---|---|
| `TRAFFIC_BASE`, `TRAFFIC_PER_SHELF_ITEM`, `TRAFFIC_RANGE` | 23, 1/180, [12, 60] | 13, 1/320, [7, 34] | sklep na start ok. 260–350 klientów, czyli 6–7,5 tys. zł dziennie; średnio w dwóch miesiącach ok. 7,8 tys. (reputacja rośnie, gdy kolejka jest krótka) |
| `FRANCHISE_FEE_FIXED` / `FRANCHISE_FEE_SHARE` | 2000 zł / 15,3% | 1000 zł / 3,4% | przy przeciętnym zaufaniu franczyzobiorcy zostaje ok. 16,5% obrotu |
| `turnoverBonusShare` | 2% od 70, 3% od 85 | 0,5% od 70, 1% od 85 | przy wysokim zaufaniu ok. 17–18% obrotu |
| `START_CASH` | 2000 zł | 5000 zł | wkład na start |
| `WAGE_PER_DAY` | 340 zł | 500 zł | 340 zł na 17 h to ok. 20 zł za godzinę, a pełny koszt pracodawcy przy płacy minimalnej 2025 to ok. 37 zł za godzinę. Przyjmujemy ok. 29 zł, bo część godzin w prawdziwym sklepie pokrywa sam franczyzobiorca. Bez tego bierny gracz miał +20–30 tys. zł miesięcznie. |
| `LEVEL_CASH` | 400 + 200 zł za poziom | 100 + 50 zł za poziom | stara nagroda dawała ok. 9 tys. zł miesięcznie |
| `XP.customer` | 1 | 1,3 | klientów jest ok. 40% mniej, a poziomy mają przychodzić podobnie szybko |
| `GUARANTEE` | brak | 25 tys. zł, 3 miesiące, zaufanie co najmniej 40, miesiąc bez mandatu | patrz niżej |

**Przychód gwarantowany.**
- *Na czym polega:* przy zamknięciu miesiąca, w pierwszych 3 miesiącach gry, Centrala dopłaca do 25 tys. zł przychodu franczyzobiorcy. Przychód to marża minus opłata plus premie Centrali.
- *Warunki:* zaufanie co najmniej 40 i żadnego mandatu w miesiącu.
- *Dlaczego 3 miesiące:* to kwartał wdrożenia i cały sezon rankingowy.
- *Gdzie widać:*
  - dopłata to premia Centrali, a w raporcie ma osobną pozycję „Dopłata do przychodu gwarantowanego” (licznik `guarantee`);
  - podgląd końca miesiąca pokazuje ją osobnym wierszem;
  - komunikat: „Wierzymy w Ciebie. Do odwołania.”;
  - gdy warunek nie jest spełniony, gra mówi, że dopłaty nie będzie, z „punktem 7.3.b”.
- *Kiedy działa:* w przeciętnym sklepie przychód franczyzobiorcy to ok. 34–45 tys. zł, więc dopłata włącza się tylko w słabym miesiącu, np. przy remoncie albo w małym sklepie, jak w rzeczywistości.

**Bez zmian:**
- media;
- ceny ulepszeń (z eDwardem): tempo progresji wyszło szybsze niż w SIM 4, liczby są w raporcie;
- premie KPI, złota paleta i karty (liczą się od marży dnia sklepu, więc maleją z ruchem same);
- mandat za energetyk (minimum 4000 zł);
- kredyt kupiecki;
- debet −100 tys. zł.

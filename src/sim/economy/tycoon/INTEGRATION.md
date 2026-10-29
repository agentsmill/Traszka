# Tycoon: jak podpiąć moduły do ekonomii (część 2)

Moduły w tym katalogu to czysta symulacja mechanik ze specu §6.5 (praca ludzi) i §7.5 (kliker a tycoon). Nie zmieniają
`economy.ts`, interfejsu ani `main.ts`; ten plik mówi, co trzeba zrobić w części 2, gdy warstwa komend strumienia A
będzie już w `main`.

Wzorcem kolejności wywołań jest `sandbox.ts` (`stepSandbox`): to ta sama minuta, tylko na makiecie sklepu.

## Decyzje użytkownika z 28.10.2026 (wiążą część 2)

- **Niedziela:** bez osobnego trybu („placówka pocztowa” ze specu odpada). Sklep działa jak co dzień, tylko przychodzi
  więcej ludzi, bo duże sklepy są zamknięte: ruch × `SUNDAY_TRAFFIC` (`sunday.ts`, `dayTrafficMult(day)`).
- **Komunikaty i pauza:** informacja bez decyzji zamyka się sama, ale nie miga, także przy ×8 (zostaje co najmniej
  `readMs(tekst)` czasu rzeczywistego); ważne zdarzenie fabularne zatrzymuje grę i czeka na „OK”; karta decyzji zatrzymuje
  grę, aż gracz wybierze. Podział: `notices.ts` (`noticeLevel`, `pausesGame`, `readMs`).
- **XP:** trafiony KPI tygodnia (40 + 10 × poziom, jak dawne zlecenie) i każda odpowiedź na kartę (10, okólnik 15).
- **Zaufanie:** miękkie granice zostają (zyski powyżej 75 i straty poniżej 30 liczą się w połowie).
- **Kasy samoobsługowe:** „zapomniane” skany to ubytek w WUT (kradzieże), jak w prawdziwym sklepie, a nie obcięta marża.
  Klient z alkoholem (albo innym towarem od 18 lat) czeka przy SCO, aż człowiek z kasy potwierdzi wiek (`SCO_AGE`).
- **Ręczny przydział:** przypięta osoba bierze najpierw swoje zadanie, a gdy nie ma w nim pracy, wraca do puli.
- **Wypowiedzenie umowy:** zaufanie na zerze kończy grę dopiero przy zamknięciu miesiąca (po zmianie z wyniku), nie od razu.
- **Co zatrzymuje grę:** lista z `notices.ts` zaakceptowana (karta decyzji; raport miesięczny, koniec remontu, nowy próg
  zaufania, koniec gry i nowy poziom, który coś odblokowuje).

## Zasady wspólne

- **Stan.** Wszystkie kawałki siedzą w jednym obiekcie `TycoonState` (`state.ts`). Proponuję jedno nowe pole
  `EconomyState.tycoon: TycoonState`, `version: 2` w `EconomyState` i migrację w `sanitize.ts`:
  `tycoon: sanitizeTycoon(raw.tycoon, { day, seedHash, trust: raw.trust, staff, metrics, scale })`. Zapis z wersji 1 nie ma
  pola `tycoon`, więc dostaje świeży stan, a zaufanie bierze ze starego `trust` (sprawdzane: `null` albo tekst daje 60,
  nie 0). Dni w zapisie (KPI, karty, efekty kart) są przycinane do dnia wczytania. Test w `sanitize.test.ts` („wynik ma
  dokładnie pola `EconomyState`”) trzeba uzupełnić o nowe pole.
- **Importy.** Moduły importują tylko `catalog.ts`, `rand.ts`, `@/sim/guards`, `@/sim/rng` i typy z `economy.ts`
  (`import type`), więc `economy.ts` może je importować bez cyklu. Pilnuje tego `purity.test.ts`.
- **Determinizm.** Losowanie wyłącznie przez `rand01(seedHash, zdarzenie, kanał)` na kanałach 100–199 (`channels.ts`):
  karty 100–105, pogoda 110, KPI 120, komentarz raportu 130, makieta 180–181. Bez `Date` (czas z `time.ts`, zgodny
  z `calendar.ts`, co sprawdza test), bez logarytmów, trygonometrii i potęg.
- **Teksty.** W stanie są liczby i identyfikatory. Teksty z liczbami (`fillText`, `kpiTitle`, `hintText`) przyjmują
  funkcję formatującą, więc interfejs podaje polskie formatowanie (`toLocaleString('pl-PL')`), a stan zostaje czysty.
- **Pętla gry (`clock.ts`, `advanceEconomy`).** Przed każdą minutą: gdy `awaitingDecision(s)` (to `cardsBlocking` bez końca
  gry), gra stoi (minuta nie mija, ułamek zegara się nie zbiera), a interfejs pokazuje kartę; `{ type: 'answerCard', seq,
  answer }` ją wznawia. `stepMinute` **nie** sprawdza karty i zostaje całkowitą funkcją „minuta dalej” (pętle `while (minute <
  do) stepMinute(...)` w testach nie mogą zawisnąć); pauzę wymuszają wołający: `advanceEconomy`, `replayRun` (karta bez
  odpowiedzi w dzienniku dostaje odpowiedź zaznaczoną z góry), `skip` w debugu i boty. Do odpowiedzi stuknięcia są odrzucane.
  Tak samo stoi na komunikacie `story` do „OK” (stan pauzy fabularnej to sprawa warstwy gry, nie zapisu ekonomii).
  Karta pokazuje się w minucie `showAt`, więc przy ×8 gra zatrzyma się dokładnie na niej.

## Minuta gry: proponowana kolejność w `stepMinute`

```
 0. pętla gry:            gdy cardsBlocking(cards, minute): stop (minuta nie mija, czekamy na card.answer)
 1. mod === 0 (północ):   hall.weather = rollWeather(seedHash, day, dateOfDay(day).month)
                          drawDayCards(cards, cardContext(s), seedHash)            // także w createEconomy dla dnia 0
 2. co minutę:            pruneCardMods(cards, minute)   // efekty kart po czasie znikają; karty czekają na odpowiedź
 3. dostawy i remont:     jak dziś; paleta dostaje bags = palletBags(items); zaplecze liczy miejsca bez worków;
                          po postawieniu palet na zapleczu settleWaste(waste, room)
 4. mods = cardModifiers(cards, minute); sklep otwarty = isStoreOpen(s) && !mods.closed
 5. klienci:              przyjścia × mods.traffic × dayTrafficMult(day); cierpliwość = fx.patience + cleanlinessEffects(c).patience
                          − hallObstacle(waste) (worki w sali liczą się jak palety w sali, także w ruchu)
 6. pula ludzi:           till = tillDemand(...); demand = { kasa, rozladunek, wykladanie, sprzatanie };
                          alloc = stepStaff(staffPool, { staff: s.staff + mods.staff (w godzinach pracy), demand, robots })
 7. obsługa:              obsłużeni = serveTill(till, alloc.total.kasa, rate) (najpierw potwierdzenia wieku na SCO, potem kolejka);
                          sell(...) z marżą × mods.margin,
                          wutFromSales(revenue), wutFromSco(revenue × udział SCO, mnożnik kamer),
                          reputacja += obsłużeni × cleanlinessEffects(c).repPerCustomer
 8. praca:                rozładunek z alloc.total.rozladunek (rozładowana paleta → addWaste), wykładanie z alloc.total.wykladanie,
                          sprzątanie: najpierw removeWaste, reszta minut na cleanHall
 9. co minutę:            soilHall(hall, przyjścia, waste.hall); wasteMinute(waste); gdy otwarty: sampleHall(hall)
10. Straż Miejska:        jak dziś, zaufanie przez addTrust(trust, 'mandaty', TRUST.fine)
11. 11:00:                zamówienie jak dziś
12. 23:00 (closeDay):     fatigueNight, closeStaffDay; w niedzielę closeKpiWeek → addTrust('kpi'), premia, XP; ostatni dzień
                          miesiąca: closeMonth (niżej)
```

## Moduły

### 1. Pula czasu ludzi (`staff.ts`)

- **Stan:** `tycoon.staff: StaffPoolState` (profil albo własna kolejność, przypięci ludzie, czas winny kartom,
  statystyki dnia i miesiąca). Przypięta osoba bierze najpierw swoje zadanie (także wbrew profilowi), a bez pracy wraca
  do puli. Zastępuje `EconomyState.priority`; `lastCashiers` i `lastWorkers` interfejs może brać
  z ostatniego przydziału (`StaffAllocation`) albo ze statystyk dnia.
- **Zaczep:** w `stepMinute` zamiast `allocateCashiers` i `doWork`:
  - kasa: `tillDemand({ queue, tills: fx.tills, tillRate: TILL_RATE * fx.tillSpeed, sco: fx.sco, scoRate: SCO_RATE * fx.scoSpeed, scoAccept: fx.scoAccept })`;
    zapotrzebowanie kasy obejmuje potwierdzenia wieku na SCO (0,25 osobominuty na klienta z alkoholem, 30% klientów SCO;
    nie zajmują stanowiska kasowego), a obsługę liczy `serveTill` (potwierdzenia przed kolejką; klient bez
    potwierdzenia zostaje w kolejce przy SCO);
  - rozładunek: `unloadDemand(pallets.map((p) => ({ items: p.total, rate: UNLOAD_RATE * fx.unloadMult * UNLOAD_AT[p.loc] })))`,
    przycięte do miejsca na zapleczu i półkach (jak w makiecie);
  - wykładanie: `restockDemand(Σ min(shelfCap − shelf, backroom), RESTOCK_RATE)`;
  - sprzątanie: `wasteDemand(waste, prasa) + cleaningDemand(hall)`.
  Kolejność rozładunku palet (chodnik, sala, zaplecze) zostaje z `doWork`. Dzisiejsze „pilne wykładanie poniżej
  połowy półki” znika: kolejność ustawia gracz profilem.
- **Automatyka:** `RobotFleet` z ulepszeń: `tasmociag = level('tasmociag')`, `wykladacz = level('wykladacz')`,
  `edward = humanoid ? 1 : 0`, `prasa` to nowe ulepszenie w grupie „warsztat”. Roboty zastępują osobominuty
  (`ROBOT_RATE`), więc `fx.autoUnload` i `fx.autoRestock` w obecnej postaci odchodzą. Roboty pracują całą dobę
  (`staff: 0` poza godzinami, przydział i tak daje minuty robotom). Statystyki (`stepStaff`) liczą tylko minuty zmiany
  (6:00–23:00): nocą `runStaff` woła czysty `allocateStaff`, bo paleta czekająca do rana nie jest niedoborem rąk
  i nie może dawać fałszywej wskazówki „braki” w raporcie.
- **Polecenia:**
  - `{ type: 'staff.profile', profile: 'kolejka' | 'dostawa' | 'porzadek' }` → `setStaffProfile`;
  - `{ type: 'staff.order', order: ['kasa', 'wykladanie', 'rozladunek', 'sprzatanie'] }` → `setStaffOrder` (permutacja);
  - `{ type: 'staff.pin', task: 'kasa', count: 1 }` → `pinStaff(pool, task, count, s.staff)`;
  - istniejące `fire` woła potem `normalizePins(pool, s.staff)`; `setPriority` znika (mapa dla starych zapisów:
    `klienci` → `kolejka`, `palety` → `dostawa`, `rowno` → `kolejka`).
- **Pytania:** czy kasa ma brać całe osoby (dziś ułamki, jak w modelu zbiorczym)? Czy udział klientów SCO z towarem od
  18 lat ma zależeć od pory (wieczorem więcej alkoholu)? `tillDemand` przyjmuje `ageShare`, więc to tylko liczba.

### 2. Śmieci z rozładunku (`waste.ts`)

- **Stan:** `tycoon.waste: WasteState`; `Pallet` dostaje pole `bags?: number` (liczone w `deliver` przez `palletBags(items)`).
- **Zaczep:**
  - `unloadPallet`, gałąź „paleta właśnie rozładowana”: `addWaste(waste, p.bags ?? 1, room)`, gdzie
    `room = effects.backroomSpots − palety na zapleczu`;
  - `freeSpot` / `freeSpots` dla `backroom`: limit pomniejszony o `wasteSpots(waste)`; po `deliver`, `movePallet`
    i `relayout` na zaplecze: `settleWaste(waste, room)`;
  - cierpliwość i ruch: `floorPallets + hallObstacle(waste)`; brud: `soilHall(hall, przyjścia, waste.hall)`;
  - sprzątanie: `removeWaste(waste, minuty, prasa)` przed `cleanHall`.
- **Polecenia:** brak (wynoszenie idzie przez pulę ludzi).
- **Pytania:** czy wiata śmietnikowa ma pojemność i dzień wywozu (żart z „gabarytów”)? Czy stuknięcie w worek ma
  wynosić śmieci rękami franczyzobiorcy (z puli sił)?

### 3. Czystość sali (`cleanliness.ts`)

- **Stan:** `tycoon.hall: HallState` (czystość, pogoda dnia, sumy do średnich).
- **Zaczep:** pogoda o północy (`rollWeather`, miesiąc z `dateOfDay(day).month`); brud i sprzątanie jak w kolejności
  wyżej; `sampleHall` w minutach otwarcia; efekty z `cleanlinessEffects(c)`: `patience` do cierpliwości,
  `repPerCustomer` w `sell`, `score` do audytu (średnia miesiąca, `closeHallMonth`) i tajemniczego klienta (czystość
  w chwili wizyty, etap 3.3).
- **Polecenia:** brak.
- **Pytania:** kiedy przyjdzie prawdziwy system pogody (wtedy `rollWeather` znika, a `hall.weather` ustawia pogoda)?
  Czy czystość ma też obniżać ruch (dziś tylko cierpliwość, reputację i audyt, jak w specu)?

### 4. Zmęczenie franczyzobiorcy (`fatigue.ts`)

- **Stan:** `tycoon.fatigue: FatigueState`.
- **Zaczep:**
  - `tapTill`: po sprawdzeniu, że jest kogo obsłużyć, `r = tap(fatigue, 'kasa', combo)`; odmowa to
    `{ ok: false, text: r.text }`; obsłużonych `min(queue, r.power)` zamiast `combo × tapBoost`;
  - `tapPallet`: po sprawdzeniu palety i miejsca `r = tap(fatigue, 'paleta', combo)`;
    sztuki `tapItems(r.power) × (1 + 0.25 × level('wozek'))`;
  - `closeDay`: `fatigueNight`; raport: `closeFatigueMonth`. Niedziela nie ma osobnych zasad sił: więcej klientów
    oznacza po prostu więcej okazji do stukania.
- **Polecenia:** bez zmian kształtu: `{ type: 'tap.till', combo: number }`, `{ type: 'tap.pallet', id?: number, combo: number }`;
  wynik może być odmową rąk. Brak `combo` albo bzdura w nim to jedno stuknięcie (jak dzisiejsze `combo = 1`).
- **Uwagi:** `tapBoost` (turbo rękawice z paczki) znika razem z paczką. Zlecenie „pomóż osobiście: N stuknięć” traci sens.

### 5. Karty decyzji i okólniki (`cards.ts`, `deck.ts`)

- **Stan:** `tycoon.cards: CardsState` (karty dnia z liczbami i odpowiedzią zaznaczoną z góry, efekty na czas, dziennik,
  liczniki miesiąca: odpowiedzi, w tym zatwierdzone domyślne).
- **Zaczep:**
  - o północy `drawDayCards(cards, ctx, seedHash)`, gdzie `ctx` z ekonomii: `deliveryToday` (dostawa w `s.deliveries`
    na ten dzień), `palletsToday`, `staff`, `trust`, `cleanliness`, `sidewalkPallets`, `weather`,
    `dailyMargin = estimatedDailyMargin(s, info)`, `dailyRevenue` (oczekiwani klienci × średni obrót na klienta);
  - karta nie ma terminu: gdy się pokaże (`showAt`), gra stoi, aż gracz wybierze (`cardsBlocking`); odpowiedź
    zaznaczona z góry (`defaultAnswer`, zwykle „nic nie robię”) to tylko podpowiedź interfejsu;
  - co minutę `pruneCardMods` i `cardModifiers` (ruch, marża, sklep zamknięty, ludzie na zmianie); efekt z godziną
    („od 17:00”) dotyczy dnia karty;
  - skutek karty: `applyCardOutcome(tycoon, o)` księguje zaufanie, WUT, czas ludzi i siły; resztę księguje ekonomia:
    `other` (inne przychody/koszty), `bonus` (premia Centrali), `fine` (mandaty), `logistics` (logistyka),
    `reputation`, `ogonki`, `xp` (do `s.xp`). W `Counters` przyda się osobny licznik premii (dziś premia od obrotu idzie
    do `other`) i licznik `wut`;
  - zdarzenia dla interfejsu: nowy `EconEventKind` `'card'` przy pokazaniu karty (`decision`) i wynik po odpowiedzi
    (`'card-result'`, `info`, tekst `o.text` przez `fillText` z polskim formatowaniem).
- **Polecenia:** `{ type: 'answerCard', seq: number, answer: number }` → `answerCard` w `economy.ts` (`resolveCard`, potem
  `applyCardOutcome` i księgowanie reszty).
- **Co znika:** paczka od Centrali co 45–110 s (`claimGift`, `giftSeq`, `tapBoostUntil`): jej rolę bierze okólnik.
- **Pytania:** ile kart treści na start (dziś 17 zdarzeń i 6 okólników)? Karta audytu jest dziś skrótem audytu; gdy
  powstanie moduł audytu (etap 3.3), jej odpowiedzi mogą ustawiać „przygotowanie” zamiast od razu zmieniać zaufanie.

### 6. Zaufanie Centrali (`trust.ts`)

- **Stan:** `tycoon.trust: TrustState` zastępuje `EconomyState.trust` (liczbę). Interfejs pokazuje wartość i próg
  (`trustTier`) od pierwszego dnia.
- **Zaczep:** każda dzisiejsza zmiana `s.trust` przez `addTrust` z przyczyną: kierowca zabrał palety
  (`'palety', TRUST.driverReturned`), odesłana paleta (`'palety', TRUST.returnedPallet`), mandat (`'mandaty', TRUST.fine`),
  wynik miesiąca (`'wynik', TRUST.monthProfit / monthLoss`). Premia od obrotu: `turnoverBonusShare(value) × obrót`
  (zamiast „≥ 70 to 1%”). Wypowiedzenie umowy (spec §10, nowy warunek końca gry): w `closeMonth` po
  `addTrust('wynik')`, gdy `trustTerminates(value)`, tak jak dziś przy bankructwie. Zero w środku miesiąca to tylko
  ostrzeżenie (decyzja użytkownika).
- **Polecenia:** brak.
- **Miękkie granice** (zyski powyżej 75 i straty poniżej 30 liczą się w połowie) zaakceptowane przez użytkownika.
  Zmiana progu (`trustTier`) to komunikat `story` (`'trust-tier'`).
- **Uwagi:** `viralShare` czeka na produkty wiralowe (etap 3.4); karta „Drop: lody BANDY XL” już go używa.

### 7. WUT (`wut.ts`)

- **Stan:** `tycoon.wut: WutState` (ubytki miesiąca wg przyczyny). Wdrożone: `sell` (eksportowane do testów) i `closeMonth`;
  opłata idzie do licznika `Counters.wut` (pozycja raportu), a ubytki z kart (przyczyna `karty`) liczą się do sumy miesiąca.
- **Zaczep:** `sell`: `wutFromSales(wut, revenue)` i zamiast dzisiejszego `margin −= revenue × scoShare × fx.shrink`:
  `wutFromSco(wut, revenue × scoShare, 1 − 0.4 × level('kamery'))` (decyzja użytkownika: jak w prawdziwym sklepie
  to ubytek w inwentaryzacji); koniec miesiąca: `closeWutMonth(wut, obrót)` i obciążenie `charge` (pozycja raportu
  „WUT ponad próg”). `fx.shrink` w `effects` przestaje być potrzebne.
- **Liczby do strojenia:** próg 1,2% obrotu, naturalne ubytki 0,9%, „zapomniane” skany 4% obrotu przez SCO.

### 8. KPI tygodnia (`kpi.ts`)

- **Stan:** `tycoon.kpi: KpiState` zastępuje zlecenia (`quests`, `questSeq`, `claimQuest`, `fillQuests`).
- **Zaczep:** liczniki z `s.total` (`customers`, `hotSold`, `lost`), liczba mandatów (nowy licznik w `Counters` albo
  `cleanDays` odwrotnie) i sumy czystości z `tycoon.hall`. `closeDay` w dniu `kpi.toDay` (niedziela):
  `closeKpiWeek` (z `level: s.level` w skali) → `addTrust('kpi', r.trust)`, premia `r.bonus` do premii Centrali,
  `r.xp` do `s.xp`, komunikat `'kpi-week'` (`info`). Cel liczy niedzielny ruch (`SUNDAY_TRAFFIC`: `kpi.ts` mnoży ruch dnia
  przez `dni − 1 + SUNDAY_TRAFFIC`, a `expectedDailyCustomers` zostaje bez niedzieli). Wdrożone w `closeDay` przed rachunkiem
  dnia (premia należy do wyniku niedzieli); tydzień zamknięty w ostatnim dniu miesiąca wchodzi do raportu tego miesiąca.
- **Polecenia:** brak (cel jest automatyczny; dawne „Odbierz!” znika).

### 9. Raport miesięczny (`report.ts`)

- **Stan:** raport trzyma ekonomia: `MonthReport.detail: TycoonMonthReport | null` (`null` w raportach ze starych zapisów),
  a `MonthReport.comment` to `reportCommentText(detail.commentId)`. Wynik raportu równa się wynikowi w `history`.
- **Zaczep:** `closeMonth`: `buildMonthReport({ monthIndex, figures, trust: closeTrustMonth(...), cleanlinessAvg:
  closeHallMonth(...), staff: closeStaffMonth(...), exhaustedDays: closeFatigueMonth(...).exhaustedDays,
  kpi: closeKpiMonth(...), cards: closeCardsMonth(...), marginPerCustomer, ... }, seedHash)`. Kolejność: najpierw opłata, premia
  i WUT, potem `addTrust('wynik')`, potem `closeTrustMonth` (żeby zmiana z wyniku była w raporcie).
- **Interfejs:** pozycje z `REPORT_LINE_LABEL`, komentarz `reportCommentText(commentId)`, wskazówka
  `hintText(hint, fmt)`, zaufanie `trust.reasons` z `TRUST_REASON_LABEL`.

### 10. Boty (`bots.ts`) i makieta (`sandbox.ts`)

- Boty widzą `BotView` i wydają `BotCommand` w kształcie poleceń warstwy komend. Na prawdziwej ekonomii puszcza je
  `economyEnv.ts` (część 2): `economyEnv({ state, info })` buduje widok z `EconomyState` (`economyView`), mapuje polecenia
  na `applyCommand` (`card.answer` → `answerCard`, `staff.profile` → `setStaffProfile`, `tap.till` → `tapTill`,
  `tap.pallet` → `tapPallet`, `pallet.move` → `movePallet`; combo z `BotCommand` pomija, bo ekonomia liczy je z serii stuknięć)
  i robi minutę przez `stepMinute`, który zwraca false, gdy gra stoi na karcie. `playBot(bot, seed, minutes)` puszcza bota od `freshRun(seed)`,
  a `measureBots(seeds, minutes)` daje `{ totals, gameOver, cards }`: sumę wyników miesięcy (`history[].profit`), sygnał końca
  gry i liczbę rozstrzygniętych kart każdego bota na każdym seedzie. To pomiar do wyważenia, który pilnuje
  `balance.test.ts` (cele balansu niżej). Bierny gracz i „stukanie bez decyzji” zatwierdzają odpowiedzi zaznaczone
  z góry i nie ruszają palet; decydent i mistrz przenoszą palety spod sklepu na zaplecze (`BotView.palletList`, `freeSpots`).
  Bot, który nie odpowie na kartę, zatrzymałby grę, więc `runBot` rzuca wtedy wyjątek. Makieta polecenie `pallet.move` odrzuca.
- Plik stoi nad `economy.ts` (nikt z ekonomii go nie importuje), więc jako jedyny w `tycoon/` bierze jej wartości, nie tylko
  typy (wyjątek w `purity.test.ts`). Makieta zostaje jako test modułów.

## Cele balansu do sprawdzenia w części 2 (spec §7.5)

| Cel | Stan w makiecie (2 miesiące, 3 seedy) |
|---|---|
| bierny gracz w pierwszych dwóch miesiącach kończy około zera | **nie do sprawdzenia tutaj**: makieta nie ma zamówień, opłat za palety ani ulepszeń; bierny ma tu +34…+38 tys. zł |
| stukanie w granicach puli dokłada najwyżej 15–20% wyniku | 12–14% (test: ≤ 20%) |
| dobre decyzje dają wynik 2–4 razy lepszy od biernego | +49…+92% w makiecie; stosunek zależy od tego, gdzie część 2 ustawi biernego (≈ 0) |
| „decyzje bez stukania” wygrywa ze „stukaniem bez decyzji” | tak, na każdym seedzie (+13…+26 tys. zł) |

Na prawdziwej ekonomii te cele (w postaci przyjętej przez właściciela 29.10.2026: bierny ±5 tys. zł, mistrz 20–40 tys. zł,
stukanie najwyżej 20%) pilnuje `balance.test.ts`; liczby są w `docs/ekonomia.md`.

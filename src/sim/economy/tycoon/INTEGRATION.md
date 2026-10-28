# Tycoon: jak podpiąć moduły do ekonomii (część 2)

Moduły w tym katalogu to czysta symulacja mechanik ze specu §6.5 (praca ludzi) i §7.5 (kliker a tycoon). Nie zmieniają
`economy.ts`, interfejsu ani `main.ts`; ten plik mówi, co trzeba zrobić w części 2, gdy warstwa komend strumienia A
będzie już w `main`.

Wzorcem kolejności wywołań jest `sandbox.ts` (`stepSandbox`): to ta sama minuta, tylko na makiecie sklepu.

## Zasady wspólne

- **Stan.** Wszystkie kawałki siedzą w jednym obiekcie `TycoonState` (`state.ts`). Proponuję jedno nowe pole
  `EconomyState.tycoon: TycoonState`, `version: 2` w `EconomyState` i migrację w `sanitize.ts`:
  `tycoon: sanitizeTycoon(raw.tycoon, { day, seedHash, trust: raw.trust, staff, metrics, scale })`. Zapis z wersji 1 nie ma
  pola `tycoon`, więc dostaje świeży stan, a zaufanie bierze ze starego `trust`. Test w `sanitize.test.ts` („wynik ma
  dokładnie pola `EconomyState`”) trzeba uzupełnić o nowe pole.
- **Importy.** Moduły importują tylko `catalog.ts`, `rand.ts`, `@/sim/guards`, `@/sim/rng` i typy z `economy.ts`
  (`import type`), więc `economy.ts` może je importować bez cyklu. Pilnuje tego `purity.test.ts`.
- **Determinizm.** Losowanie wyłącznie przez `rand01(seedHash, zdarzenie, kanał)` na kanałach 100–199 (`channels.ts`):
  karty 100–105, pogoda 110, KPI 120, komentarz raportu 130, makieta 180–181. Bez `Date` (czas z `time.ts`, zgodny
  z `calendar.ts`, co sprawdza test), bez logarytmów, trygonometrii i potęg.
- **Teksty.** W stanie są liczby i identyfikatory. Teksty z liczbami (`fillText`, `kpiTitle`, `hintText`) przyjmują
  funkcję formatującą, więc interfejs podaje polskie formatowanie (`toLocaleString('pl-PL')`), a stan zostaje czysty.

## Minuta gry: proponowana kolejność w `stepMinute`

```
 1. mod === 0 (północ):   hall.weather = rollWeather(seedHash, day, dateOfDay(day).month)
                          drawDayCards(cards, cardContext(s), seedHash)            // także w createEconomy dla dnia 0
 2. co minutę:            for (o of expireCards(cards, minute, seedHash)) applyOutcome(s, o)
 3. dostawy i remont:     jak dziś; paleta dostaje bags = palletBags(items); zaplecze liczy miejsca bez worków;
                          po postawieniu palet na zapleczu settleWaste(waste, room)
 4. mods = cardModifiers(cards, minute); sklep otwarty = isStoreOpen(s) && !mods.closed
 5. klienci:              przyjścia × mods.traffic; cierpliwość = fx.patience + cleanlinessEffects(c).patience
                          − hallObstacle(waste) (worki w sali liczą się jak palety w sali, także w ruchu)
 6. pula ludzi:           till = tillDemand(...); demand = { kasa, rozladunek, wykladanie, sprzatanie };
                          alloc = stepStaff(staffPool, { staff: s.staff + mods.staff (w godzinach pracy), demand, robots })
 7. obsługa:              obsłużeni = till.scoServed + tillServed(till, alloc.total.kasa, rate); sell(...) z marżą × mods.margin,
                          wutFromSales(revenue), reputacja += obsłużeni × cleanlinessEffects(c).repPerCustomer
 8. praca:                rozładunek z alloc.total.rozladunek (rozładowana paleta → addWaste), wykładanie z alloc.total.wykladanie,
                          sprzątanie: najpierw removeWaste, reszta minut na cleanHall
 9. co minutę:            soilHall(hall, przyjścia, waste.hall); wasteMinute(waste); fatigueMinute(fatigue, ctx, otwarty);
                          gdy otwarty: sampleHall(hall)
10. Straż Miejska:        jak dziś, zaufanie przez addTrust(trust, 'mandaty', TRUST.fine)
11. 11:00:                zamówienie jak dziś
12. 23:00 (closeDay):     fatigueNight, closeStaffDay; w niedzielę closeKpiWeek → addTrust('kpi'), premia; ostatni dzień
                          miesiąca: closeMonth (niżej)
```

## Moduły

### 1. Pula czasu ludzi (`staff.ts`)

- **Stan:** `tycoon.staff: StaffPoolState` (profil albo własna kolejność, przypięci ludzie, czas winny kartom,
  statystyki dnia i miesiąca). Zastępuje `EconomyState.priority`; `lastCashiers` i `lastWorkers` interfejs może brać
  z ostatniego przydziału (`StaffAllocation`) albo ze statystyk dnia.
- **Zaczep:** w `stepMinute` zamiast `allocateCashiers` i `doWork`:
  - kasa: `tillDemand({ queue, tills: fx.tills, tillRate: TILL_RATE * fx.tillSpeed, sco: fx.sco, scoRate: SCO_RATE * fx.scoSpeed, scoAccept: fx.scoAccept })`;
  - rozładunek: `unloadDemand(pallets.map((p) => ({ items: p.total, rate: UNLOAD_RATE * fx.unloadMult * UNLOAD_AT[p.loc] })))`,
    przycięte do miejsca na zapleczu i półkach (jak w makiecie);
  - wykładanie: `restockDemand(Σ min(shelfCap − shelf, backroom), RESTOCK_RATE)`;
  - sprzątanie: `wasteDemand(waste, prasa) + cleaningDemand(hall)`.
  Kolejność rozładunku palet (chodnik, sala, zaplecze) zostaje z `doWork`. Dzisiejsze „pilne wykładanie poniżej
  połowy półki” znika: kolejność ustawia gracz profilem.
- **Automatyka:** `RobotFleet` z ulepszeń: `tasmociag = level('tasmociag')`, `wykladacz = level('wykladacz')`,
  `edward = humanoid ? 1 : 0`, `prasa` to nowe ulepszenie w grupie „warsztat”. Roboty zastępują osobominuty
  (`ROBOT_RATE`), więc `fx.autoUnload` i `fx.autoRestock` w obecnej postaci odchodzą. Roboty pracują całą dobę
  (`staff: 0` poza godzinami, przydział i tak daje minuty robotom).
- **Polecenia:**
  - `{ type: 'staff.profile', profile: 'kolejka' | 'dostawa' | 'porzadek' }` → `setStaffProfile`;
  - `{ type: 'staff.order', order: ['kasa', 'wykladanie', 'rozladunek', 'sprzatanie'] }` → `setStaffOrder` (permutacja);
  - `{ type: 'staff.pin', task: 'kasa', count: 1 }` → `pinStaff(pool, task, count, s.staff)`;
  - istniejące `fire` woła potem `normalizePins(pool, s.staff)`; `setPriority` znika (mapa dla starych zapisów:
    `klienci` → `kolejka`, `palety` → `dostawa`, `rowno` → `kolejka`).
- **Pytania:** czy przypięta osoba bez pracy ma stać na posterunku (dziś tak: to koszt ręcznego przydziału), czy wracać
  do puli? Czy kasa ma brać całe osoby (dziś ułamki, jak w modelu zbiorczym)? Czy kasa samoobsługowa potrzebuje opieki
  (np. 0,1 osoby na stanowisko)?

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
  - `tapTill`: po sprawdzeniu, że jest kogo obsłużyć, `r = tap(fatigue, 'kasa', combo, ctx)`; odmowa to
    `{ ok: false, text: r.text }`; obsłużonych `min(queue, r.power)` zamiast `combo × tapBoost`;
  - `tapPallet`: po sprawdzeniu palety i miejsca `r = tap(fatigue, 'paleta', combo, ctx)`;
    sztuki `tapItems(r.power) × (1 + 0.25 × level('wozek'))`;
  - minuta: `fatigueMinute(fatigue, { sundayPost }, otwarty)`; `closeDay`: `fatigueNight`; raport: `closeFatigueMonth`.
- **Polecenia:** bez zmian kształtu: `{ type: 'tap.till', combo: number }`, `{ type: 'tap.pallet', id?: number, combo: number }`;
  wynik może być odmową rąk.
- **Pytania:** niedziela „placówka pocztowa”: dziś sklep działa codziennie tak samo; czy niedziela ma być osobnym
  trybem (podwójna marża z §7.1a, sam na kasie), zamknięta, czy wybierana przez gracza? `tapBoost` (turbo rękawice
  z paczki) znika razem z paczką. Zlecenie „pomóż osobiście: N stuknięć” traci sens.

### 5. Karty decyzji i okólniki (`cards.ts`, `deck.ts`)

- **Stan:** `tycoon.cards: CardsState` (karty czekające z liczbami, efekty na czas, dziennik, liczniki miesiąca).
- **Zaczep:**
  - o północy `drawDayCards(cards, ctx, seedHash)`, gdzie `ctx` z ekonomii: `deliveryToday` (dostawa w `s.deliveries`
    na ten dzień), `palletsToday`, `staff`, `trust`, `cleanliness`, `sidewalkPallets`, `weather`,
    `dailyMargin = estimatedDailyMargin(s, info)`, `dailyRevenue` (oczekiwani klienci × średni obrót na klienta);
  - co minutę `expireCards` i `cardModifiers` (ruch, marża, sklep zamknięty, ludzie na zmianie);
  - skutek karty: `applyCardOutcome(tycoon, o)` księguje zaufanie, WUT, czas ludzi i siły; resztę księguje ekonomia:
    `other` (inne przychody/koszty), `bonus` (premia Centrali), `fine` (mandaty), `logistics` (logistyka),
    `reputation`, `ogonki`. W `Counters` przyda się osobny licznik premii (dziś premia od obrotu idzie do `other`)
    i licznik `wut`;
  - zdarzenia dla interfejsu: nowy `EconEventKind` `'card'` przy pokazaniu karty (minuta `showAt`) i przy rozstrzygnięciu
    (tekst `o.text` przez `fillText` z polskim formatowaniem).
- **Polecenia:** `{ type: 'card.answer', seq: number, answer: number }` → `resolveCard`.
- **Co znika:** paczka od Centrali co 45–110 s (`claimGift`, `giftSeq`, `tapBoostUntil`): jej rolę bierze okólnik.
- **Pytania:** czy przy ×4 i ×8 gra ma się pauzować na nową kartę (karta trwa 50–600 minut gry, czyli przy ×8
  kilka sekund)? Ile kart treści na start (dziś 17 zdarzeń i 6 okólników)? Karta audytu jest dziś skrótem audytu;
  gdy powstanie moduł audytu (etap 3.3), jej odpowiedzi mogą ustawiać „przygotowanie” zamiast od razu zmieniać zaufanie.

### 6. Zaufanie Centrali (`trust.ts`)

- **Stan:** `tycoon.trust: TrustState` zastępuje `EconomyState.trust` (liczbę). Interfejs pokazuje wartość i próg
  (`trustTier`) od pierwszego dnia.
- **Zaczep:** każda dzisiejsza zmiana `s.trust` przez `addTrust` z przyczyną: kierowca zabrał palety
  (`'palety', TRUST.driverReturned`), odesłana paleta (`'palety', TRUST.returnedPallet`), mandat (`'mandaty', TRUST.fine`),
  wynik miesiąca (`'wynik', TRUST.monthProfit / monthLoss`). Premia od obrotu: `turnoverBonusShare(value) × obrót`
  (zamiast „≥ 70 to 1%”). Zaufanie 0 to wypowiedzenie umowy (`trustTerminates`, spec §10): nowy warunek końca gry.
- **Polecenia:** brak.
- **Pytania:** miękkie granice (zyski powyżej 75 i straty poniżej 30 liczą się w połowie) to moja decyzja balansu
  [C]; czy wypowiedzenie przy zerze ma być od razu, czy na koniec miesiąca? `viralShare` czeka na produkty wiralowe
  (etap 3.4); karta „Drop: lody BANDY XL” już go używa.

### 7. WUT (`wut.ts`)

- **Stan:** `tycoon.wut: WutState` (ubytki miesiąca wg przyczyny).
- **Zaczep:** `sell`: `wutFromSales(wut, revenue)`; koniec miesiąca: `closeWutMonth(wut, obrót)` i obciążenie
  `charge` (nowa pozycja raportu „WUT ponad próg”).
- **Pytania:** dzisiejszy ubytek na kasach samoobsługowych (`margin −= revenue × scoShare × fx.shrink`) proponuję
  przenieść do WUT (`addWut(wut, 'kradziez', …)`), żeby kamery obniżały WUT, a nie marżę. Próg 1,2% i naturalne
  0,9% obrotu to liczby do strojenia.

### 8. KPI tygodnia (`kpi.ts`)

- **Stan:** `tycoon.kpi: KpiState` zastępuje zlecenia (`quests`, `questSeq`, `claimQuest`, `fillQuests`).
- **Zaczep:** liczniki z `s.total` (`customers`, `hotSold`, `lost`), liczba mandatów (nowy licznik w `Counters` albo
  `cleanDays` odwrotnie) i sumy czystości z `tycoon.hall`. `closeDay` w dniu `kpi.toDay` (niedziela):
  `closeKpiWeek` → `addTrust('kpi', r.trust)`, premia `r.bonus` do premii Centrali, zdarzenie dla gracza.
- **Polecenia:** brak (cel jest automatyczny; dawne „Odbierz!” znika).
- **Pytania:** zlecenia dawały XP i Ogonki; czy KPI i karty mają dawać XP (poziomy dalej odblokowują sprzęt)?

### 9. Raport miesięczny (`report.ts`)

- **Stan:** `tycoon.lastReport: TycoonMonthReport | null` (obok albo zamiast `EconomyState.lastReport`).
- **Zaczep:** `closeMonth`: `buildMonthReport({ monthIndex, figures, trust: closeTrustMonth(...), cleanlinessAvg:
  closeHallMonth(...), staff: closeStaffMonth(...), exhaustedDays: closeFatigueMonth(...).exhaustedDays,
  kpi: closeKpiMonth(...), cards: cards.month, marginPerCustomer, ... }, seedHash)`. Kolejność: najpierw opłata, premia
  i WUT, potem `addTrust('wynik')`, potem `closeTrustMonth` (żeby zmiana z wyniku była w raporcie).
- **Interfejs:** pozycje z `REPORT_LINE_LABEL`, komentarz `reportCommentText(commentId)`, wskazówka
  `hintText(hint, fmt)`, zaufanie `trust.reasons` z `TRUST_REASON_LABEL`.

### 10. Boty (`bots.ts`) i makieta (`sandbox.ts`)

- Boty widzą `BotView` i wydają `BotCommand` w kształcie poleceń warstwy komend. W części 2 wystarczy napisać
  `EconomyEnv: BotEnv` (widok z `EconomyState`, polecenia przez warstwę komend strumienia A, krok `stepMinute`)
  i puścić te same cztery boty na prawdziwej ekonomii, żeby sprawdzić cele balansu ze specu.
- Makieta zostaje jako test modułów albo znika, gdy `EconomyEnv` ją zastąpi.

## Cele balansu do sprawdzenia w części 2 (spec §7.5)

| Cel | Stan w makiecie (2 miesiące, 3 seedy) |
|---|---|
| bierny gracz w pierwszych dwóch miesiącach kończy około zera | **nie do sprawdzenia tutaj**: makieta nie ma zamówień, opłat za palety ani ulepszeń; bierny ma tu +38…+43 tys. zł |
| stukanie w granicach puli dokłada najwyżej 15–20% wyniku | 2–15% (test: ≤ 20%) |
| dobre decyzje dają wynik 2–4 razy lepszy od biernego | +50…+59% w makiecie; stosunek zależy od tego, gdzie część 2 ustawi biernego (≈ 0) |
| „decyzje bez stukania” wygrywa ze „stukaniem bez decyzji” | tak, na każdym seedzie (+13…+22 tys. zł) |

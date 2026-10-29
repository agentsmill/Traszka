# Ekonomia sklepu (etap 2, wersja grywalna)

Kod: `src/sim/economy/`. Liczby w `catalog.ts`, ulepszenia i sprzęt w `upgrades.ts`, kamienie milowe w `milestones.ts`.
To uproszczona wersja §6–§8 specu, zrobiona tak, żeby gra była grywalna na telefonie jak kliker z decyzjami.

## Pętla

- **Czas.** Krok symulacji to minuta gry. Przy ×1 dzień sklepu (6:00–23:00) trwa 2 min 50 s, noc 30 s, cała doba ~3 min 20 s (miesiąc ~100 min przy ×1, ~12,5 min przy ×8). Start 1 września 2026.
  Ostatniego dnia miesiąca o 23:00 jest raport i opłata franczyzowa. Noc (20:00–6:00) zmienia oświetlenie sceny.
- **Klienci** są liczeni zbiorczo: strumień przyjść = ruch bazowy × krzywa godzinowa × reputacja × marketing.
  Ruch bazowy to 23 klientów na godzinę z ulicy plus pojemność półek / 180 (`TRAFFIC_BASE`, `TRAFFIC_PER_SHELF_ITEM`), razy lokal:
  sklep na start ma 450–550 klientów dziennie, a większy po remoncie sam ściąga ludzi.
  Klienci przychodzą falami (`WAVES`, autobus albo przerwa w szkole): w bloku 20 minut z szansą 75% przez 5 minut przychodzi ich
  ponad dwa razy więcej, a w pozostałych minutach o 35% mniej. Średnia bloku zostaje ta sama, więc w szczycie kolejka dochodzi do
  3–5 osób kilka razy dziennie, a poza szczytem stoją przy kasie najwyżej 1–2. Fale liczy `waveAt` z minuty bloku (bez stanu w zapisie).
  Tłum w 3D to obraz tego strumienia (gęstość zależy od ruchu), a nie źródło liczb.
- **Kolejka.** Kasjer obsługuje 0,7 klienta na minutę (szkolenia +15%), kasa samoobsługowa 0,4 (część klientów jej unika).
  Gdy w kolejce stoi więcej osób, niż wynosi cierpliwość (6 + klimatyzacja − palety w sali), nowi klienci odchodzą.
- **Zapasy** w 7 kategoriach (te same, co na nadstawkach regałów): półki, zaplecze i palety. Pusta półka to utracona
  sprzedaż i spadek reputacji. Półki w 3D pustoszeją razem z zapasem.
- **Palety.** Zamówienie zamyka się o 11:00, dostawa jest rano (z ulepszeniem o 5:00, z drugą dostawą także o 15:00).
  Asystent liczy zapas docelowy (półki + 60% zaplecza w proporcji do sprzedaży) i mnoży wynik przez 1,3, ale zamawia najwyżej
  tyle palet, ile ludzie poza kasą rozładują spod sklepu w 7,5 godziny po dostawie (`crewPalletCap`; dwie osoby: 6 palet,
  każda kolejna osoba więcej). Ręczne zamówienie nie ma tego limitu.
  Palety stoją pod sklepem, w sali (korek) albo na zapleczu. Straż Miejska (`STRAZ`) patroluje od 9:00 do 20:00 i palety
  obchodzą ją dopiero po sześciu godzinach od dostawy (tyle dwie osoby rozładowują 6 palet); pierwszy obchód dnia to upomnienie, mandat przychodzi przy kolejnym
  obchodzie tego samego dnia (co najmniej godzinę później), więc gracz ma czas zareagować.
  Gdy nie ma gdzie ich postawić, kierowca je zabiera za opłatą.
- **Ludzie.** Czas osób na zmianie to wspólna pula osobominut dla czterech zadań: kasy, rozładunku palet (6 szt./min,
  wózek +40%), wykładania towaru (20 szt./min) i sprzątania z workami. Gracz wybiera profil („Kolejka”, „Dostawa”,
  „Porządek”) albo układa kolejność sam i może przypiąć osobę do zadania (bez pracy wraca do puli). Zadanie, na które
  nie starcza ludzi, czeka. Gracz pomaga stukaniem w paletę (8 szt.), a w kasę tylko wtedy, gdy przy kasie nikogo nie ma albo
  kolejka czekałaby dłużej niż 3 minuty (`tillTapBlock`; inaczej „Kasjer nadąża z kolejką.”).
- **Koszty.** Płace 340 zł dziennie na osobę na zmianie, media, opłata franczyzowa 2000 zł + 15,1% obrotu (`FRANCHISE_FEE_*`),
  mandaty (800 zł + 100 zł za każdą dalszą paletę, po upomnieniu), opłaty logistyczne i WUT ponad próg. Zaufanie Centrali startuje
  od 65; franczyzobiorca, któremu Centrala ufa (zaufanie od 70), dostaje z powrotem 2% obrotu miesiąca, od 85 trzy (`turnoverBonusShare`). Gotówka poniżej granicy debetu
  −10 000 zł (`DEBT_LIMIT`) kończy grę od razu, także w środku miesiąca; od −5 000 zł Centrala ostrzega, ile zostało do końca
  (zdarzenie, czerwona gotówka na pasku, wiersz w zakładce Cele i w raporcie). Dołek gotówki jest po opłacie na koniec miesiąca.
- **WUT** (ubytki towarowe) liczy się od każdej sprzedaży: naturalne 0,9% obrotu, a kasy samoobsługowe dopisują do kradzieży
  „zapomniane” skany (4% obrotu przez SCO, kamery mniej). Do progu 1,2% obrotu miesiąca płaci Centrala, nadwyżkę
  franczyzobiorca przy zamknięciu miesiąca (`tycoon/wut.ts`, pozycja „WUT ponad próg” w raporcie).

## Pętla nagród

Cel: nagroda w każdej skali czasu, a gra bez końca.

| Skala | Nagroda | Kod |
|---|---|---|
| sekunda | stuknięcie w paletę albo kasę: liczba nad palcem, dźwięk, wibracja; combo co 4 szybkie stuknięcia (do ×5), a każde zużywa dzienną pulę sił (100; noc oddaje 70) | `tapPallet`, `tapTill`, `tycoon/fatigue.ts` |
| kilka minut | poziom gracza: XP z klientów, palet, zakupów i KPI; nagroda (400 zł + 200 zł za poziom) i odblokowania na poziomach | `progress.ts`, `processLevels`, `unlocksAt` |
| kilkanaście minut | złota paleta (2,5% palet, czyli co kilka dni gry): premia Centrali po rozładunku, ćwierć marży typowego dnia, nie mniej niż 800 zł | `unloadPallet`, `GOLDEN_PRIZE` |
| tydzień | KPI tygodnia (jeden cel do niedzieli 23:00): zaufanie, premia (30% marży dnia) i XP (40 + 10 × poziom) | `tycoon/kpi.ts`, `closeDay` |
| powrót | kierownik zmiany: 25% średniego dziennego wyniku ostatniego miesiąca (po opłacie franczyzowej) na godzinę nieobecności, do 8 h, nic przy wyniku ≤ 0; seria dni do 7. dnia daje tylko drobne Ogonki | `game/meta.ts` |
| bez końca | „Otwórz kolejną Traszkę”: sklep dołącza do sieci (10% najlepszego dnia co dzień), Punkty Partnera (+4% marży, +3% ruchu każdy) | `game/meta.ts`, `partner` w stanie ekonomii |

Rangi nie mają rodzaju gramatycznego (to palety): Drewniana, EURO, w Folii, Srebrna, Złota, Platynowa, Diamentowa,
Legendarna, potem gwiazdki co 10 poziomów.

## Rozwój (bez drzewka badań)

- **Ulepszenia** kupowane od razu, z rosnącą ceną kolejnych poziomów (kasa, palety i zaplecze, klienci).
  W sklepie widać tylko te, których wymagania są spełnione, żeby początek nie przytłaczał.
- **Sprzęt do slotów**: kasa samoobsługowa, bankomat, Paczkownik 24h, piec do pizzy. Slot 2×2 mieści dwie
  kompaktowe kasy samoobsługowe albo jeden duży sprzęt.
- **Remont generalny** (3 poziomy): sklep zamknięty na kilka dni, potem większy lokal z generatora z większą liczbą slotów.
- **Warsztat złotej rączki** odsłania się na 10. poziomie albo po pierwszym remoncie: taśmociąg i wykładacz pracują
  całą dobę, a humanoid eDward (po drugim remoncie, od 25. poziomu) robi za trzech.
- **Odblokowania poziomem**: bankomat 3, piec 4, druga kasa 5, Paczkownik 6, remonty 8 / 14 / 20.
- **Ogonki** za cele i obsłużonych klientów: kampania w aplikacji (+30% ruchu przez dobę), przyspieszenie remontu.

## Balans (boty na prawdziwej ekonomii, stan na 29.10.2026)

Kryterium właściciela, pilnowane przez `tycoon/balance.test.ts`: boty z `tycoon/bots.ts` grają 61 dni (wrzesień i październik 2026) od
świeżego sklepu. Wynik to suma wyników miesięcy po kosztach (przed inwestycjami), w tysiącach zł:

- bierny gracz (zatwierdza odpowiedzi zaznaczone z góry, niczego nie rusza) po mandatach i opłacie ledwo wiąże koniec z końcem: od −4 do +2, mediana najwyżej +1;
- mistrz (dobre decyzje na kartach, palety spod sklepu na zaplecze, rozsądne stukanie) wychodzi na +20…+40;
- samo stukanie dokłada mistrzowi najwyżej 20%, a decyzje bez stukania wygrywają ze stukaniem bez decyzji;
- karta decyzji wypada średnio 0,95–1,35 razy na dobę, czyli co ok. 3 min przy ×1 i co ok. 23 s przy ×8.

| Sklep (seed) | Bierny | Stukanie bez decyzji | Decyzje bez stukania | Decyzje i stukanie |
|---|---|---|---|---|
| `traszka-1` (pawilon) | −3,5 | 0,0 | +21,7 | +21,5 |
| `kopytka-541` | +0,4 | +0,8 | +24,3 | +24,0 |
| `makieta` | +0,7 | +1,4 | +31,0 | +30,8 |
| `lublin-9` | −3,1 | −2,0 | +27,5 | +27,4 |
| `seed-3` | +0,4 | +0,1 | +21,9 | +21,7 |

Po „ruchu i falach” (29.10.2026, SIM_VERSION 4): sklep na start ma ok. 500 klientów dziennie zamiast 300–350, kasjer w szczycie
pracuje przy 80–100% i ma kolejkę, a druga osoba rozładowuje 6 palet do wczesnego popołudnia zamiast siedzieć bez zajęcia (bezczynne
osobominuty dnia na dwuosobowej zmianie spadły o ok. 40%). Obrót dwóch miesięcy to 680–760 tys. zł zamiast 410–530, więc udział
Centrali wzrósł do 15,1%, a premia od obrotu spadła do 2% / 3%. Mandaty biernego (4–11 w dwa miesiące) biorą się z dni z chorym
pracownikiem, kiedy jedyna osoba stoi przy kasie i palet nikt nie rusza. Złotych palet jest mniej (2,5%), bo palet jest więcej, a ich
losowa liczba rozjeżdżała wynik między seedami.

Granica debetu (`DEBT_LIMIT`, −10 tys. zł; `tycoon/debt.test.ts`): bierny bez pecha kończy miesiąc po opłacie z gotówką od ok. −1,5
do +2,7 tys. zł. Dwa duże koszty (po dwie typowe marże dnia, ok. 4,4 tys. zł) spychają go do 50–70% granicy z ostrzeżeniem, trzy
kończą grę przy raporcie za październik. Tak dużego pojedynczego kosztu w grze dziś nie ma: największy to mandat z ryzyka karty
„Nastolatek po energetyka” (ok. 1,1 tys. zł), więc dwa takie zdarzenia biernemu jeszcze nie szkodzą.

Bierny gracz traci na mandatach po zignorowanych upomnieniach i na zaufaniu: odpowiedzi domyślne je zjadają, a bez zaufania od
70 nie ma premii od obrotu. Widełki są ciasne, bo płace są stałe, a losowe zdarzenia (dni z chorobą, złote palety, trafione KPI) różnią się między seedami; nie każdy seed się w nich
mieści (np. `kiełbasa-42` daje mistrzowi ok. 42 tys.). Przed strojeniem (opłata 4500 zł + 3% obrotu) bierny gracz wychodził od +23 do +50 tys. zł, a mistrz od +34 do +67 tys. zł.

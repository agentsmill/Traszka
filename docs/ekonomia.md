# Ekonomia sklepu (etap 2, wersja grywalna)

Kod: `src/sim/economy/`. Liczby w `catalog.ts`, ulepszenia i sprzęt w `upgrades.ts`, kamienie milowe w `milestones.ts`.
To uproszczona wersja §6–§8 specu, zrobiona tak, żeby gra była grywalna na telefonie jak kliker z decyzjami.

## Pętla

- **Czas.** Krok symulacji to minuta gry. Przy ×1 dzień sklepu (6:00–23:00) trwa 2 min 50 s, noc 30 s, cała doba ~3 min 20 s (miesiąc ~100 min przy ×1, ~12,5 min przy ×8). Start 1 września 2026.
  Ostatniego dnia miesiąca o 23:00 jest raport i opłata franczyzowa. Noc (20:00–6:00) zmienia oświetlenie sceny.
- **Klienci** są liczeni zbiorczo: strumień przyjść = ruch bazowy × krzywa godzinowa × reputacja × marketing.
  Ruch bazowy wynika z pojemności półek (pojemność / 75 klientów na godzinę), więc większy sklep sam ściąga ludzi.
  Tłum w 3D to obraz tego strumienia (gęstość zależy od ruchu), a nie źródło liczb.
- **Kolejka.** Kasjer obsługuje 0,7 klienta na minutę (szkolenia +15%), kasa samoobsługowa 0,4 (część klientów jej unika).
  Gdy w kolejce stoi więcej osób, niż wynosi cierpliwość (6 + klimatyzacja − palety w sali), nowi klienci odchodzą.
- **Zapasy** w 7 kategoriach (te same, co na nadstawkach regałów): półki, zaplecze i palety. Pusta półka to utracona
  sprzedaż i spadek reputacji. Półki w 3D pustoszeją razem z zapasem.
- **Palety.** Zamówienie zamyka się o 11:00, dostawa jest rano (z ulepszeniem o 5:00, z drugą dostawą także o 15:00).
  Asystent liczy zapas docelowy (półki + 60% zaplecza w proporcji do sprzedaży) i mnoży wynik przez 1,3.
  Palety stoją pod sklepem (mandat Straży Miejskiej po godzinie tolerancji), w sali (korek) albo na zapleczu.
  Gdy nie ma gdzie ich postawić, kierowca je zabiera za opłatą.
- **Ludzie.** Osoby na zmianie dzielą się na kasę i palety według priorytetu (kasa, po równo, palety). Kto nie stoi
  na kasie, rozładowuje (6 szt./min, wózek +40%) i wykłada towar (20 szt./min). Gracz pomaga stukaniem (8 szt.).
- **Koszty.** Płace 340 zł dziennie na osobę na zmianie, media, opłata franczyzowa 2000 zł + 12% obrotu (`FRANCHISE_FEE_*`),
  mandaty (400 zł + 120 zł za każdą dalszą paletę), opłaty logistyczne i WUT ponad próg. Franczyzobiorca, któremu Centrala ufa
  (zaufanie od 70), dostaje z powrotem 3% obrotu miesiąca, od 85 trzy i pół (`turnoverBonusShare`). Na koniec miesiąca z gotówką
  poniżej −30 000 zł Centrala wypowiada umowę.
- **WUT** (ubytki towarowe) liczy się od każdej sprzedaży: naturalne 0,9% obrotu, a kasy samoobsługowe dopisują do kradzieży
  „zapomniane” skany (4% obrotu przez SCO, kamery mniej). Do progu 1,2% obrotu miesiąca płaci Centrala, nadwyżkę
  franczyzobiorca przy zamknięciu miesiąca (`tycoon/wut.ts`, pozycja „WUT ponad próg” w raporcie).

## Pętla nagród

Cel: nagroda w każdej skali czasu, a gra bez końca.

| Skala | Nagroda | Kod |
|---|---|---|
| sekunda | stuknięcie w paletę albo kasę: liczba nad palcem, dźwięk, wibracja; combo co 4 szybkie stuknięcia (do ×5), a każde zużywa dzienną pulę sił (100; noc oddaje 70) | `tapPallet`, `tapTill`, `tycoon/fatigue.ts` |
| minuta | złota paleta (5% palet): premia Centrali po rozładunku, ćwierć marży typowego dnia, nie mniej niż 800 zł | `unloadPallet`, `GOLDEN_PRIZE` |
| kilka minut | poziom gracza: XP z klientów, palet, zakupów i KPI; nagroda (500 zł + 200 zł za poziom) i odblokowania na poziomach | `progress.ts`, `processLevels`, `unlocksAt` |
| tydzień | KPI tygodnia (jeden cel do niedzieli 23:00): zaufanie, premia (30% marży dnia) i XP (40 + 10 × poziom) | `tycoon/kpi.ts`, `closeDay` |
| powrót | kierownik zmiany: 25% ostatniego dnia na godzinę nieobecności (do 8 h); seria dni do 7. dnia | `game/meta.ts` |
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

- bierny gracz (zatwierdza odpowiedzi zaznaczone z góry, niczego nie rusza) kończy w okolicy zera, najwyżej ±5;
- mistrz (dobre decyzje na kartach, palety spod sklepu na zaplecze, rozsądne stukanie) wychodzi na +20…+40;
- samo stukanie dokłada mistrzowi najwyżej 20%, a decyzje bez stukania wygrywają ze stukaniem bez decyzji;
- karta decyzji wypada średnio 0,95–1,35 razy na dobę, czyli co ok. 3 min przy ×1 i co ok. 23 s przy ×8.

| Sklep (seed) | Bierny | Stukanie bez decyzji | Decyzje bez stukania | Decyzje i stukanie |
|---|---|---|---|---|
| `traszka-1` (pawilon) | +0,8 | +7,6 | +26,9 | +31,8 |
| `kopytka-541` | −3,4 | −2,4 | +21,4 | +21,1 |
| `makieta` | +3,7 | +9,9 | +37,5 | +38,5 |
| `lublin-9` | +0,5 | +4,7 | +37,2 | +37,6 |
| `seed-3` | +0,4 | +2,9 | +30,0 | +34,5 |

Bierny gracz traci głównie na mandatach (palety stoją na chodniku) i na zaufaniu: odpowiedzi domyślne je zjadają, a bez zaufania od
70 nie ma premii od obrotu. Widełki są ciasne, bo płace są stałe, a obrót sklepów różni się dwukrotnie; nie każdy seed się w nich
mieści (np. `kiełbasa-42` daje mistrzowi ok. 42 tys.). Przed strojeniem (opłata 4500 zł + 3% obrotu) bierny gracz wychodził od +23 do +50 tys. zł, a mistrz od +34 do +67 tys. zł.

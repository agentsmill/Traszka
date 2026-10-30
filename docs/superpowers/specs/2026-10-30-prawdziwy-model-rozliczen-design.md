# Prawdziwy model rozliczeń: trzy kieszenie (SIM_VERSION 6)

Data: 30.10.2026. Gałąź `claude/trzy-kieszenie` z `origin/main` (5bf6947, SIM 5 na produkcji).
Źródła: raport `reports/Skargi franczyzobiorców Żabki.md` (poza gitem) i pamięć projektu (prawdziwe liczby franczyzy, cykl życia franczyzobiorcy).
Model zatwierdził właściciel („Idealny. Możemy to wdrożyć”); szczegóły i liczby w tym dokumencie to decyzje sesji wykonawczej.

## 1. Po co

W SIM 5 marża z każdej sprzedaży wpada od razu do gotówki, a na koniec miesiąca Centrala ściąga opłatę „1000 zł + 3,4% obrotu”. Żadne
źródło nie potwierdza takiej opłaty. Prawdziwy miesiąc wygląda odwrotnie:

- towar przychodzi na kredyt kupiecki;
- utarg idzie codziennie na konto sieci;
- na koniec miesiąca Centrala robi przelew **do** franczyzobiorcy (marża i premie, minus potrącenia);
- z przelewu franczyzobiorca płaci VAT, ZUS, pensje i księgową.

Słaby miesiąc robi dziurę bez żadnej kary, a prawdziwy rachunek za braki i przeterminowania przychodzi przy remanencie. SIM 6 przenosi ten
mechanizm do gry i pokazuje go graczowi. Satyra zostaje w tekstach, ale liczby i kolejność zdarzeń mają odpowiadać źródłom.

## 2. Trzy kieszenie

| Kieszeń | Co to jest | Kto może ją wydać | Gdzie ją widać |
|---|---|---|---|
| **Saldo u Centrali** | marża ze sprzedaży i premie Centrali naliczone w tym miesiącu | nikt; przychodzi jako przelew przy zamknięciu miesiąca | pasek, rośnie na żywo |
| **Gotówka** | pieniądze franczyzobiorcy | gracz: zakupy za gotówkę, rekrutacja | pasek, główna liczba |
| **Raty u Centrali** | ulepszenia kupione na raty; Centrala potrąca je z kolejnych przelewów | nie da się ich wydać; to dług | pasek: suma rat w miesiącu |

Gotówka to licznik do przyszłego celu 1 mln zł. Granica bankructwa się nie zmienia: gotówka poniżej −100 tys. zł kończy grę od razu,
a od −50 tys. zł Centrala ostrzega.

## 3. Dokąd idzie każdy złoty

| Przepływ | SIM 5 | SIM 6 |
|---|---|---|
| Marża ze sprzedaży (półki i strefa hot) | gotówka od razu | **saldo** |
| Premia KPI tygodnia, złota paleta, premia z karty (`bonus`) | gotówka od razu | **saldo** |
| Premia od obrotu (zaufanie od 70) | gotówka przy zamknięciu | **przelew** (saldo przy zamknięciu) |
| Dopłata do przychodu gwarantowanego | gotówka przy zamknięciu | **przelew** |
| Opłata franczyzowa 1000 zł + 3,4% obrotu | gotówka przy zamknięciu | **znika**; udział Centrali jest w stawce marży (§5.1) |
| Ubytki ponad limit Centrali (miesięcznie) | gotówka przy zamknięciu | **znika jako pozycja miesięczna**; ubytki idą do ukrytego licznika remanentu (§7) |
| Opłata za palety ponad darmowe | gotówka przy zamówieniu | **potrącenie** z przelewu |
| Karta: koszt logistyki | gotówka od razu | **potrącenie** z przelewu |
| Płace | gotówka co wieczór | **koszt własny** naliczany co dzień, płacony przy zamknięciu |
| Media | gotówka co wieczór | **koszt własny** naliczany co dzień, płacony przy zamknięciu |
| ZUS, VAT, księgowa | brak | **koszty własne** przy zamknięciu (§5.2) |
| Mandat Straży, mandat z karty (sanepid, nieletni) | gotówka od razu | **gotówka od razu**, bez zmian; może zejść pod zero |
| Karta: gotówka (`cash`, ze znakiem) | gotówka od razu | gotówka od razu, bez zmian |
| Najem bankomatu, dochód z sieci, nagroda za poziom, premia dzienna, zarobek offline | gotówka | gotówka, bez zmian |
| Ulepszenie, sprzęt, remont za gotówkę; rekrutacja | gotówka od razu | gotówka od razu (zakup wymaga gotówki ≥ ceny, jak dziś) |
| Ulepszenie, sprzęt, remont na raty | brak | **raty**: potrącenie z kolejnych przelewów (§6) |
| Remanent: ubytki ponad limit | brak | **potrącenie** z najbliższego przelewu (§7) |

Kary umowne Centrali (np. za audyt) nie wchodzą: raport skarg zaznacza, że nie ma dla nich potwierdzenia. Wyciąg ma na nie miejsce w strukturze,
ale w SIM 6 nie ma ich źródła, więc pozycja się nie pokazuje.

## 4. Zamknięcie miesiąca: wyciąg od Centrali

Zamknięcie zostaje o 23:00 ostatniego dnia miesiąca, w tej samej minucie co dziś. Kolejność:

1. **Premia od obrotu** z zaufania (`turnoverBonusShare`, bez zmian: 0,5% od 70, 1% od 85) dopisuje się do salda.
2. **Gwarancja** (pierwsze 3 miesiące, zaufanie co najmniej 40, miesiąc bez mandatu): Centrala dopłaca do 25 tys. zł przychodu.
   Przychód to marża plus premie z liczników całego miesiąca, a nie saldo, żeby zapis przeniesiony z SIM 5 w połowie miesiąca nie dostał
   dopłaty do połowy miesiąca (marża sprzed migracji jest już w gotówce).
3. **Przelew** = marża + premie + dopłata z gwarancji (z salda miesiąca).
4. **Potrącenia** = raty z tego miesiąca + opłaty za palety + nadwyżka z remanentu, jeśli czeka.
5. **Twoje koszty** = płace + media (naliczone w miesiącu) + ZUS + księgowa + VAT od przelewu.
6. **Zostaje Ci** = przelew − potrącenia − Twoje koszty. Ta kwota (może być ujemna) wchodzi do gotówki jednym ruchem.
7. Zaufanie z wyniku miesiąca, raport tycoona (komentarz, wskazówka, KPI, czystość), historia, wyzerowanie liczników miesiąca.

Kontrola debetu biegnie jak dziś po minucie gry, więc bankructwo wypada w chwili przelewu, jeśli „Zostaje Ci” zepchnie gotówkę poniżej −100 tys. zł.

**Wynik miesiąca** (historia, ranking, komentarz Centrali, zmiana zaufania) = wszystko poza inwestycjami:
przelew − palety − remanent − Twoje koszty + inne przychody i koszty z gotówki − mandaty. Raty (rata i opłata za finansowanie) to inwestycja,
jak zakup za gotówkę, więc do wyniku nie wchodzą. Dzięki temu w rankingu raty i gotówka są równe: liczy się, co sklep zarobił,
a ryzyko rat to debet i bankructwo. W oknie wyciągu wynik stoi pod „Zostaje Ci” jako mniejsza liczba z opisem.

**Wynik dnia** (komunikat o zamknięciu dnia, rekord dnia, zarobek offline) liczy się memoriałowo jak dziś: marża + premie + inne − płace −
media − mandaty − palety. Nie zmienia gotówki.

## 5. Stawki

### 5.1 Marża zamiast opłaty

Opłata franczyzowa znika. Stawki marży w katalogu (`CAT_INFO.margin`, `HOT.margin`) to od SIM 6 marża **franczyzobiorcy**, czyli to, co
zostaje mu po udziale Centrali. Start kalibracji: dzisiejsze stawki razy 0,8 (marża sklepu 19,1% obrotu daje ok. 15,3%). Cel: przelew
(marża plus premie) średnio 16,5–16,7% obrotu, jak w danych sieci za 2025 r. (446 tys. zł marży na sklep przy 2,4–2,7 mln zł obrotu).
Żadnej stałej opłaty miesięcznej nie zostawiam. Satyra o opłacie przechodzi do tekstów Centrali (komentarze raportu, „Jak grać”).

### 5.2 Twoje koszty

| Pozycja | Start kalibracji | Uzasadnienie |
|---|---|---|
| Płace | osoba na zmianie: ok. 340 zł za dzień (SIM 5: 500) | SIM 5 podniósł płacę do 500 zł, żeby zamknąć bilans bez ZUS-u, VAT-u i księgowej. Te trzy pozycje kosztują teraz ok. 9–10 tys. zł miesięcznie, czyli ok. 165 zł na osobę na zmianie dziennie przy dwóch osobach. Płaca wraca do kosztu godzin, których franczyzobiorca nie pokrywa sam (komentarz SIM 5 już to mówi: część godzin pokrywa on z rodziną). Ostateczna liczba z symulacji (§11). |
| Media | bez zmian (140 zł dziennie razy wielkość sali) | prąd i ogrzewanie sklepu z lodówkami: ok. 3–5 tys. zł miesięcznie |
| ZUS | 2200 zł miesięcznie | relacja z Opola: 2–2,5 tys. zł |
| Księgowa | 1000 zł miesięcznie | relacja z Opola: ok. 1 tys. zł |
| VAT | 17% przelewu | relacja z Opola: 3,9–4,5 tys. zł przy przelewie ok. 25 tys., czyli 15,6–18%. To uproszczenie: raport skarg ostrzega, że mechanizm VAT-u jest sporny, więc gra pokazuje kwotę i nie tłumaczy, od czego dokładnie się liczy. |

Kontrola proporcji ze słabym miesiącem z Opola: przelew 25 tys. zł, VAT ok. 4,25 tys., ZUS 2,2 tys., księgowa 1 tys., dwie osoby na zmianie
ok. 20 tys., media ok. 4 tys. To daje ok. −6,5 tys. zł, czyli dziurę, jak w relacji (ok. −5 tys. z rezerwą na ubytki). Przeciętny sklep
w grze ma przelew ok. 38–39 tys. zł, czyli tyle co średnia sieci (37 tys.), i wychodzi na plus.

## 6. Raty u Centrali

**Po co.** To główny sposób na rozwój: ulepszenie kupujesz od razu, Centrala potrąca raty z kolejnych przelewów. W prawdziwej sieci tak
finansuje się sprzęt na start.

**Plany** (wybór zależy od ceny):

| Cena | Rat | Opłata za finansowanie |
|---|---|---|
| do 5 000 zł | 3 | 4% |
| do 25 000 zł | 6 | 8% |
| ponad 25 000 zł | 12 | 15% |

- Rata miesięczna to (cena + opłata) / liczba rat, zaokrąglona w górę do pełnych złotych, a ostatnia rata wyrównuje resztę.
- Pierwsza rata schodzi z najbliższego przelewu, czyli przy zamknięciu bieżącego miesiąca.
- Zakup za gotówkę zawsze kosztuje mniej.

**Limit rat.** Suma rat w miesiącu (aktywne plus nowa) nie może przekroczyć 35% przelewu bazowego razy mnożnik zaufania:

- **Przelew bazowy:** średni przelew z ostatnich (najwyżej 3) zamkniętych miesięcy. Przed pierwszym zamknięciem to przychód gwarantowany, 25 tys. zł („Centrala liczy limit od gwarancji”).
- **Mnożnik zaufania:**

  | Zaufanie | Mnożnik |
  |---|---|
  | poniżej 25 | 0 („Centrala nie finansuje”) |
  | 25–39 | 0,5 |
  | 40–69 | 1 |
  | 70–84 | 1,25 |
  | od 85 | 1,5 |

Na start limit wynosi więc ok. 8,75 tys. zł rat miesięcznie, co wystarcza na remont 1 (25 tys. zł) na 6 rat po ok. 4,5 tys. zł.

**Co wolno kupić na raty:** ulepszenie, sprzęt i remont. Rekrutacji nie, bo to koszt pracy, nie sprzęt. Wcześniejszej spłaty nie ma
(poza zakresem).

**Własność.** Ulepszenie należy do sklepu, raty do franczyzobiorcy. Raty mieszkają w nowym bloku stanu `franchisee` (§9), który zbiera
wszystko, co należy do osoby, a nie do sklepu: saldo miesiąca, raty i rozliczenie remanentu. Funkcja `outstandingDebt(s)` zwraca niespłacone
raty i czekającą nadwyżkę z remanentu. Przyszły rogalik wrzuci tę kwotę do rozliczenia końcowego przy bankructwie. Samego rogalika teraz nie ma.

## 7. Remanent

- **Ukryty licznik.** Przeterminowania, kradzieże, „zapomniane” skany, pomyłki i ubytki z kart kumulują się od ostatniego remanentu.
  Obok rośnie obrót z tego okresu. Pasek i raport miesięczny tego nie pokazują: dzienny widok to tylko sprzedaż.
- **Przeterminowania z nadmiaru zapasu** (nowe). Co wieczór towar ponad `coverDays` dni sprzedaży (wartość zapasu na półkach, na zapleczu,
  na paletach i w drodze, liczona po cenach sklepu, minus `coverDays` razy przewidywany obrót dnia) traci `rate` swojej wartości jako
  przeterminowany. Start: `coverDays` 3, `rate` 1% dziennie. Asystent nie zamawia ponad potrzebę, więc bierny gracz nie powinien tego
  odczuć, a gracz, który zamawia za dużo, dostanie rachunek przy remanencie. To jest „błędna decyzja” z opóźnionym skutkiem, której
  właściciel chciał. Liczby ustali symulacja (§11).
- **Kiedy.** Pierwszy remanent wypada ostatniego dnia trzeciego miesiąca gry, czyli przy końcu gwarancji (30 listopada, także ostatni dzień
  sezonu rankingowego). Kolejne ostatniego dnia co trzeciego miesiąca: luty, maj, sierpień, listopad itd. Remanent odbywa się o 5:00,
  przed otwarciem. Nadwyżka schodzi z przelewu tego samego wieczoru, a ubytki z reszty tego dnia idą już do następnego okresu.
- **Limit.** Centrala pokrywa ubytki do 1,2% obrotu z okresu (dzisiejszy próg `WUT.threshold`); nadwyżka idzie do potrąceń. Do pierwszego
  remanentu gracz limitu nie zna: interfejs mówi „limit ubytków: Centrala poda przy remanencie”. Po pierwszym pokazuje „1,2% obrotu”.
- **Protokół** (osobne okno, pauzuje grę):
  - okres;
  - obrót w okresie;
  - ubytki według przyczyn (przeterminowane, kradzieże i „zapomniane” skany, pomyłki i stłuczki, decyzje dnia);
  - razem;
  - limit Centrali;
  - nadwyżka do potrącenia z przelewu dnia X;
  - satyryczny komentarz.

  Okno otwiera zdarzenie remanentu (jak raport miesiąca). Ostatni protokół zostaje w stanie, więc panel sklepu pokazuje go później jako
  „Ostatni remanent”, także po przeładowaniu strony. Zamknięcie okna nie jest poleceniem gry, bo nie może trafić do dziennika rankingu.
- **Rozbieżności systemowych nie ma.** To zarzut z zawiadomienia do prokuratury, nie ustalenie.
- Comiesięczna pozycja „Ubytki ponad limit Centrali” znika z wyciągu i z raportu. Wskazówka raportu o ubytkach odzywa się tylko
  w miesiącu remanentu (kwota nadwyżki).

## 8. Widok

**Pasek górny (390 px).**
- **Pierwszy wiersz:** gotówka, główna liczba, jak dziś.
- **Drugi wiersz:** zamiast „Do oddania Centrali | Wolne” trzy pola:

  | Pole | Krótka etykieta (wąski ekran) | Długa etykieta (szeroki ekran) | Wartość |
  |---|---|---|---|
  | saldo | „Saldo” | „Saldo u Centrali” | rośnie na żywo |
  | raty | „Raty” | — | kwota rat w tym miesiącu; „0” bez rat |
  | prognoza | „Zostanie” | „Po zamknięciu zostanie” | prognoza „Zostaje Ci” (niżej) |

  Kolor prognozy idzie z progów debetu po dodaniu do gotówki, jak dziś kolor wolnych środków.
- **Stuknięcie** w drugi wiersz otwiera prognozowany wyciąg.
- **Prognoza na pasku** to szybki szacunek bez symulacji: to, co już naliczone, plus reszta miesiąca liczona z przewidywanej marży dnia
  (`estimatedDailyMargin`), płac i mediów razy dni do końca, plus stałe koszty, VAT i raty. Pasek nie liczy dokładnie, bo nie może
  symulować co klatkę. Dokładną liczbę daje podgląd.

**Wyciąg od Centrali (koniec miesiąca).** Okno raportu miesięcznego dostaje u góry wyciąg, a pod nim zostaje reszta raportu tycoona
(zaufanie, KPI, komentarz, wskazówka):

| Sekcja | Pozycje |
|---|---|
| Przelew od Centrali | marża, premie, dopłata z gwarancji |
| Potrącenia | raty, palety ponad darmowe, remanent |
| Twoje koszty | pensje, ZUS, VAT, księgowa, media |
| Podsumowanie | **Zostaje Ci**, gotówka po zamknięciu, wynik miesiąca bez rat (z dopiskiem „do rankingu”) |
| Gotówka w miesiącu (zwinięta lista) | zakupy za gotówkę, mandaty, inne; pozwala odtworzyć gotówkę po zamknięciu |

Raporty ze starych zapisów nie mają wyciągu i pokazują dawne pozycje.

**Podgląd końca miesiąca** (`monthPreview.ts`, symulacja na kopii stanu). Wynikiem jest prognozowany wyciąg, który zgadza się z prawdziwym
zamknięciem co do złotówki (test na kilku dniach i seedach, jak dziś).

Podgląd uruchomiony w miesiącu remanentu, przed nim, pokazuje też nadwyżkę z remanentu. To cena dokładności: pasek jej nie zdradza
(ukryty licznik), a podgląd to symulacja „co będzie, jeśli nic nie zrobię”, więc musi równać się zamknięciu.

**Okna zakupu** (ulepszenia, sprzęt, remont): przy cenie dwa przyciski, „za gotówkę X zł” i „na raty Y zł × N mies.”.
- **Przycisk rat:**
  - jest wyłączony, gdy rata przekracza wolny limit;
  - podpowiedź podaje limit, opłatę za finansowanie i sumę do spłaty.
- **Ostrzeżenia `.tt-spend`** liczą prognozę gotówki po zamknięciu miesiąca: gotówka plus „Zostaje Ci” minus zakup za gotówkę albo minus
  pierwsza rata. Progi są te same co dziś („ciasno”, ostrzeżenie, granica debetu).
- Rekrutacja zostaje tylko za gotówkę.

**Protokół remanentu:** osobne okno (§7).

**„Jak grać”:** przepisuję tylko części o pieniądzach: trzy kieszenie, wyciąg, raty, remanent, koszty własne, gwarancja. Kroki samouczka
o pieniądzach dostosuje sesja „Onboarding i samouczek” po wejściu SIM 6.

## 9. Stan, zapis i migracja

**Nowy blok stanu.** `EconomyState.franchisee` zbiera to, co należy do franczyzobiorcy:
- `month`: naliczenia do wyciągu w bieżącym miesiącu:
  - marża i premie (to jest saldo);
  - palety;
  - płace;
  - media.
- `raty` (lista) i `nextRataId`;
- `remanent`:
  - obrót okresu;
  - dzień następnego remanentu;
  - czy limit jest już znany;
  - nadwyżka czekająca na przelew;
  - ostatni protokół.

**Ukryty licznik ubytków.** To dalej `tycoon.wut.month`, tylko zeruje go remanent, a nie koniec miesiąca. Nazwa w kodzie zostaje.

**Raporty.** `MonthReport` dostaje `statement` (wyciąg; `null` w starych raportach). `Counters` dostają liczniki `zus`, `vat`,
`accounting`, `installments` i `remanent`. `fee` i `wut` zostają w typie dla starych zapisów i historii, a w SIM 6 są zerowe.

**Migracja zapisów SIM 4 i SIM 5** (`sanitize`), także w połowie miesiąca:
- **Saldo i naliczenia:** zerowe, bo marża, płace i media sprzed migracji już przeszły przez gotówkę.
- **Raty:** brak.
- **Remanent:**
  - obrót okresu = obrót bieżącego miesiąca, bo ubytki z tego miesiąca już są w liczniku;
  - następny remanent: najbliższy ostatni dzień miesiąca, który jest wielokrotnością trzech miesięcy gry, ale nie wcześniej niż koniec
    gwarancji;
  - limit nieznany.
- **Pierwsze zamknięcie po migracji:**
  - przelew i koszty liczy tylko od chwili migracji;
  - ZUS i księgową w całości, bo to opłaty miesięczne;
  - gwarancję z liczników całego miesiąca (§4).

  Wyciąg tego jednego miesiąca jest więc niepełny. Dostanie notkę „Rozliczenie od wejścia nowych zasad”.
- **Fixtures:** zapis SIM 5 i zapis SIM 4, oba w połowie miesiąca.

**SIM_VERSION 6.** Nowy `GOLDEN[6]`, przebudowany `judgeBundle.js`. Polecenia zakupu dostają opcjonalne pole `raty: true`. Bez niego zakup
jest za gotówkę, jak dziś, więc stare dzienniki dalej się parsują.

## 10. Bankructwo i ranking

- Granica bankructwa −100 tys. zł i ostrzeżenie od −50 tys. zł się nie zmieniają.
- Kredyt kupiecki na towar się nie zmienia.
- **Ranking:** wynik sezonu to dalej suma wyników trzech miesięcy (§4: bez rat). W sezonie rankingowym 30 listopada wypada pierwszy
  remanent, więc zamawianie ponad potrzebę obniża wynik sezonu.
- **Sędzia:** czas odtwarzania dla długich dzienników mierzę w analizie.
- **Wniosek z wdrożenia.** Gotówka zmienia się prawie wyłącznie przy przelewach, a granica to −100 tys. zł. Przez to bankructwo przed
  ostatnim zamknięciem sezonu jest w praktyce nieosiągalne. Najgłębszy dołek po dwóch miesiącach, jaki dało się zbudować, to ok.
  −90 tys. zł (raport, §„Sezon rankingowy”). Reguła `season-bankrupt` zostaje. Test sędziego sprawdza ją na bundlu z podstawionym
  końcem gry po październiku.

## 11. Kalibracja i analiza

**Cele:**
- przelew średnio ok. 16,5–16,7% obrotu;
- słaby miesiąc ma proporcje jak w Opolu i daje dziurę;
- wynik netto (wynik miesiąca) bierny i mistrz blisko SIM 5 (+5,9 tys. i +14,6 tys. zł miesięcznie) albo z uzasadnieniem.

**Strategie:**

| Strategia | Co robi |
|---|---|
| bierny | asystent, karty domyślne, nic nie kupuje |
| normalny | kupuje za gotówkę, gdy go stać z zapasem na koniec miesiąca |
| mistrz | bot z balansu, kupuje jak dziś |
| agresywne raty | od startu kupuje na raty do limitu |
| nadmierne zamawianie | ręcznie 2× tyle palet, ile proponuje asystent |

**Zakres:** 12–24 miesiące na 5 seedach (te same co w balansie).

**Tabela miesięczna:**
- przelew;
- potrącenia;
- koszty własne;
- „Zostaje Ci”;
- gotówka;
- miesiąc bankructwa, jeśli jest;
- udział przelewu w obrocie.

**Do sprawdzenia:**
- bierny przeżywa;
- agresywne raty czasem upadają, ale nie zawsze, w okolicy końca gwarancji albo przy remanencie;
- mistrz rośnie;
- milion jest osiągalny tylko przez rozwój: szacunek, po ilu miesiącach.

**Przypadki brzegowe:**
- remanent w dniu zamknięcia miesiąca;
- gwarancja razem z ratami;
- zapis w połowie miesiąca: saldo i raty się zapisują;
- migracja zapisów SIM 5 i SIM 4 w połowie miesiąca;
- podgląd równy prawdziwemu zamknięciu;
- determinizm i czas odtwarzania przez sędziego.

## 12. Poza zakresem

- rogalik i rozliczenie końcowe (jest tylko struktura danych);
- cel 1 mln zł w interfejsie;
- wcześniejsza spłata rat;
- kary umowne i audyty;
- kampania narzucona z automatu;
- awaria systemu promocji;
- weksel;
- okres wypowiedzenia;
- refundacje części nadwyżki z remanentu.

## 13. Decyzje tej sesji (do pokazania właścicielowi)

1. Marża ze sprzedaży i wszystkie premie Centrali idą na saldo; gotówka zmienia się w miesiącu tylko od zakupów, mandatów, kart, najmu i nagród.
2. Płace i media nie schodzą co wieczór, tylko przy zamknięciu, razem z ZUS-em (2200 zł), księgową (1000 zł) i VAT-em (17% przelewu).
3. Opłata franczyzowa znika bez śladu w liczbach; udział Centrali to niższa stawka marży (ok. ×0,8). Satyra o opłacie zostaje w tekstach.
4. Płaca osoby na zmianie spada z 500 do ok. 340 zł dziennie, bo ZUS, VAT i księgowa są teraz osobno (ostateczna liczba z symulacji).
5. Mandaty (Straż, sanepid, nieletni) płaci się z gotówki od razu; kar umownych Centrali nie ma, bo brak źródła.
6. Raty: 3 / 6 / 12 miesięcy zależnie od ceny, opłata 4% / 8% / 15%. Limit to 35% przelewu bazowego razy mnożnik zaufania; przed pierwszym przelewem liczy się od gwarancji 25 tys. Rekrutacja tylko za gotówkę. Pierwsza rata schodzi już w tym miesiącu.
7. Wynik miesiąca do rankingu nie zawiera rat (tak jak dziś nie zawiera zakupów za gotówkę); okno pokazuje osobno „Zostaje Ci” i wynik.
8. Remanent ostatniego dnia co trzeciego miesiąca o 5:00 (pierwszy 30 listopada, przy końcu gwarancji i sezonu), limit 1,2% obrotu okresu, nadwyżka z przelewu tego samego wieczoru. Gracz poznaje limit dopiero przy pierwszym remanencie.
9. Nowe: przeterminowania z nadmiaru zapasu (towar ponad 3 dni sprzedaży traci ok. 1% wartości dziennie), żeby za dużo palet kosztowało przy remanencie.
10. Gwarancja dopłaca do przelewu (przed potrąceniami), warunki bez zmian.
11. Raty i remanent należą do franczyzobiorcy (blok `franchisee`), ulepszenia do sklepu; `outstandingDebt` czeka na rogalika.
12. Pasek: gotówka zostaje główną liczbą, drugi wiersz to saldo, raty i prognoza „Zostanie”; dokładny wyciąg daje podgląd.

## 14. Builder check

Lista, którą wykonawca odhacza przed raportem. Każdy punkt ma test albo pomiar.

- [ ] **Saldo, nie gotówka.** `sell()` nie zmienia `s.cash`; saldo rośnie o marżę. Test: minuta sprzedaży zmienia saldo, a gotówka stoi.
- [ ] **Zamknięcie zgodne z wyciągiem.** Gotówka po zamknięciu minus gotówka przed nim = „Zostaje Ci”. Test na 3 seedach.
- [ ] **Wyciąg się sumuje.** Przelew − potrącenia − koszty = „Zostaje Ci”, a wynik miesiąca = „Zostaje Ci” + raty + inne − mandaty. Test.
- [ ] **Brak opłaty i miesięcznych ubytków.** W kodzie nie ma `franchiseFee` ani `FRANCHISE_FEE_*`; liczniki `fee` i `wut` są w SIM 6 zerowe.
- [ ] **Raty.**
  - plan, opłata i zaokrąglenie: ostatnia rata wyrównuje do grosza;
  - pierwsza rata w bieżącym miesiącu;
  - limit z mnożnikiem zaufania i bazą z gwarancji;
  - polecenie odrzucone ponad limit;
  - `raty` w dzienniku i w odtworzeniu.
- [ ] **Raty się kończą.** Po N przelewach rata znika z listy; `outstandingDebt` maleje do zera.
- [ ] **Remanent:**
  - termin pierwszego (dzień 90, 5:00) i kolejnych;
  - licznik zeruje się tylko przy remanencie;
  - nadwyżka trafia do przelewu tego samego dnia;
  - limit „nieznany”, a po pierwszym remanencie znany;
  - protokół w stanie.
- [ ] **Remanent w dniu zamknięcia.** Remanent o 5:00, przelew o 23:00, ubytki z tego dnia w następnym okresie. Test.
- [ ] **Przeterminowania z nadmiaru.** Bierny ma ich prawie zero; nadmierne zamawianie płaci przy remanencie wyraźną kwotę (pomiar w raporcie).
- [ ] **Gwarancja z ratami.** Dopłata do 25 tys. przed potrąceniami; raty schodzą normalnie. Test.
- [ ] **Zapis w połowie miesiąca.** Saldo, naliczenia, raty i remanent przechodzą przez zapis i `sanitize` bez zmian. Test.
- [ ] **Migracja SIM 5 i SIM 4 w połowie miesiąca:**
  - saldo zero;
  - brak podwójnej marży i podwójnych płac;
  - brak dopłaty z gwarancji za pół miesiąca;
  - fixtures.
- [ ] **Podgląd.** Prognozowany wyciąg równa się prawdziwemu zamknięciu co do złotówki (3 momenty miesiąca); podgląd niczego nie zmienia w stanie.
- [ ] **Prognoza na pasku.** Czysta funkcja, bez zmiany stanu; w ostatniej minucie przed zamknięciem równa się wyciągowi (poza dniem remanentu przed 5:00).
- [ ] **Wersja.** `SIM_VERSION` 6, `GOLDEN[6]`, przebudowany `judgeBundle.js`, testy sędziego i rankingu.
- [ ] **Kalibracja:**
  - przelew 16,5–16,7% obrotu (średnio, bierny);
  - bierny przeżywa 24 miesiące na 5 seedach;
  - mistrz rośnie;
  - tabela w raporcie.
- [ ] **Widok na 390 px:**
  - pasek z trzema kieszeniami bez zawijania i ucinania liczb;
  - wyciąg;
  - zakup na raty;
  - protokół remanentu;
  - stary zapis.

  Smoke headless Playwright ze zrzutami.
- [ ] **„Jak grać” i słownictwo.** Nowe teksty o pieniądzach; strażnik „WUT” przechodzi; nie ma nazwy prawdziwej sieci.
- [ ] **Smoke'i.** Smoke palet i smoke opłaty dostosowane do SIM 6; smoke robotów przechodzi.
- [ ] **Bramki.** Pełne testy, `tsc`, `npm run build`, `npm run check:vercel-build`.

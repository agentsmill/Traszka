# Etap 5a: plan sprzedaży Centrali (presja w późnej grze) — projekt

**Data:** 2026-11-13. **Podstawa:** `main` 6e692b7 (`SIM_VERSION` 7, `FIRM_SAVE_SCHEMA` 4).
**Stan:** zatwierdzony przez właściciela 2026-11-17 razem z trzema propozycjami z §4.
**Plan:** `docs/superpowers/plans/2026-11-17-etap-5a-plan-centrali.md`.
Oznaczenia: **[W]** to decyzja właściciela, **[?]** to pytanie do właściciela (§4), `Ruling:` to rozstrzygnięcie autora
(format: decyzja — dlaczego — koszt pomyłki). Liczby z dopiskiem „start” są wartościami wyjściowymi do strojenia na botach.

## 1. Cel i dlaczego

Gracz z ok. 500 tys. zł mówi, że nie ma już co robić. To ta sama skarga, co 1 listopada przy 400 tys. zł, mimo że etap 4b dołożył
ok. 14,5 mln zł zakupów w jednym sklepie i 30–40 mln w sieci. Zakupów więc nie brakuje. Brakuje stawki:

- bogatemu graczowi nic nie grozi (koniec gry jest przy −100 tys. zł albo przy zaufaniu 0, a zyskowny sklep dostaje +5 zaufania co miesiąc);
- najkrótsza droga do miliona to „przestań kupować i czekaj” (raport 4b, bot `siec12`).

Ten etap daje Centrali narzędzie, które rośnie razem z sukcesem gracza: **miesięczny plan sprzedaży**. Kto dobrze sprzedaje, dostaje
wyższy plan. Kto go nie robi, płaci, a po trzech wpadkach z rzędu traci placówkę. Pieniądze przestają być tylko wynikiem: stają się
poduszką, którą trzeba mądrze wydawać, żeby utrzymać sklep. Trzyma się to zasady właściciela, że franczyzobiorcę mają kłaść
„błędne decyzje i centrala”, a upadek ma budzić „złość na centralę z lekkim ściskiem w żołądku” **[W, 30.10 i 1.11]**.

## 2. Cele, nie-cele, anty-cele

**Cele (P1).**
- Plan sprzedaży na każdy sklep, od czwartego miesiąca umowy, widoczny od pierwszego dnia miesiąca.
- Plan rośnie z wykonaniem („zapadka”): im dłuższa seria trafień, tym szybciej.
- Drabina skutków na sklep: kara, program naprawczy, wypowiedzenie placówki.
- Przełącznik „dobij plan z własnej kieszeni”: ratuje miesiąc, podbija następny plan.
- Czekanie z gotówką przestaje być najlepszą drogą do miliona.

**Nie-cele.** Sztafeta franczyzobiorców (osobny, następny etap; ten etap daje jej powód upadku), nowe rzeczy do kupienia, zmiana opłaty
franczyzowej, progów zaufania, KPI tygodnia i remanentu, nowe miasta, zmiana wyniku rankingu.

**Anty-cele.**
- Kara bez zapowiedzi. Każdą złotówkę kary gracz widzi w podglądzie miesiąca, zanim spadnie (lekcja z playtestu 30.10).
- Upadek z pecha. Plan liczy się z obrotu, który gracz widzi i prognozuje; żadnego losowania w wysokości planu.
- „To samo, tylko drożej”: plan nie może być kolejnym podatkiem, którego nie da się uniknąć decyzją.
- Twierdzenia o prawdziwej sieci. To satyra na fikcyjną Traszkę; w grze i repo nie piszemy, że tak działa konkretna firma.
- `Math.random` i `Date` w `src/sim`; import firmy przez sędziego.

## 3. Ograniczenia

- **Ranking bez zmiany wyniku.** Sezon ma 3 miesiące (`RANKED_SEASON_MONTHS`), a plan zaczyna się w czwartym miesiącu umowy, razem z końcem
  gwarancji (`GUARANTEE.months` 3). Bieg rankingowy ma dać ten sam wynik co dziś. Jeśli `GOLDEN` mimo to się zmieni (np. przez nowy blok
  stanu), `SIM_VERSION` idzie 7 → 8 i ranking się resetuje; właściciel godził się na to przy każdym poprzednim etapie.
- `FIRM_SAVE_SCHEMA` 4 → 5 z migracją z 4. Wszystkie zapisy z `src/game/fixtures/` się wczytują.
- **Rozstrzygnięcia z planu wykonania (2026-11-17), które zmieniają dwa punkty powyżej:**
  - `SIM_VERSION` zostaje 7 i ranking się nie resetuje. Blok planu jest opcjonalny i powstaje dopiero wieczorem pierwszego dnia czwartego
    miesiąca, czyli po końcu sezonu, więc `GOLDEN[7]` się nie zmienia. Pierwszy plan interfejs pokazuje od rana z czystej funkcji.
  - `FIRM_SAVE_SCHEMA` zostaje 4. Blok planu to opcjonalne pole wewnątrz rozliczenia sklepu, a nie zmiana koperty zapisu; starsza
    wersja gry go pominie, a nowa odtworzy plan od miesiąca zapowiedzi.
  - Przełącznik dobicia (§6.4) jest poleceniem firmy, a komunikat „Brakuje X zł do planu” wychodzi przy zamknięciu przedostatniego dnia
    miesiąca.
  - Miesiąc bez ani jednego dnia otwartego nie jest rozliczany; trzeci stopień drabiny nie ma kary pieniężnej.
- Paczka „Wyślij zapis” ma dziś ok. 1,6 KB zapasu do progu testu (raport 4b §7). Blok planu trzeba policzyć w `saveTransfer.test.ts`.
- Każdy nowy napis ma wersję angielską, `tests/i18n.test.ts` przechodzi.
- Pierwsze trzy miesiące zwykłej gry bez zmian (samouczek, gwarancja, pierwszy remanent).

## 4. Pytania do właściciela [?]

**Rozstrzygnięte [W, 2026-11-17]:** właściciel zatwierdził wszystkie trzy propozycje. Ostatni sklep: koniec gry. Plan: bez sufitu.
„Dobij plan z własnej kieszeni”: wchodzi do gry.

1. **Ostatni sklep.** Trzecia wpadka z rzędu w jedynym (albo ostatnim) sklepie kończy grę, tak jak dziś zaufanie 0. Moja propozycja: tak,
   koniec gry, dopóki nie ma sztafety. Druga droga: zamiast końca gry Centrala narzuca gorszą umowę i zeruje plan.
2. **Zapadka bez sufitu.** Plan rośnie bez górnej granicy, więc każdy franczyzobiorca kiedyś odpada; pytanie tylko, czy zdąży po milion.
   Moja propozycja: tak, bez sufitu (to jest sedno satyry i grunt pod sztafetę). Druga droga: plan staje przy sklepie w pełni rozbudowanym.
3. **„Dobij plan z własnej kieszeni”.** Czy ta decyzja ma wejść do gry (§6.4)? Moja propozycja: tak.

## 5. Podejścia

| | Podejście | Co daje | Co kosztuje |
|---|---|---|---|
| **A** | **Plan sprzedaży z zapadką** (wybrane) | Stawka rośnie z sukcesem; pieniądze i decyzje (w co inwestować, który sklep oddać, kiedy dobić plan) mają cel; gracz widzi prognozę cały miesiąc | Nowy blok stanu, strojenie na botach, ryzyko spirali w dół |
| B | Wymuszone wydatki (okólniki „nowy standard do 30 dni albo kara”) | Proste, od razu zjada gotówkę | To podatek: gracz płaci i nic nie wybiera. Wraca „to samo, tylko drożej” |
| C | Rosnący standard jakości (ocena punktowa audytu, próg rośnie z remontem) | Bliskie skargom z forów (ocena partnera regionalnego) | W dużej części już jest (audyty, KPI, czystość); karze za obsługę, a nie za strategię, i nie rusza gracza z gotówką |

`Ruling: A jako trzon, B i C dopiero jako treść „programu naprawczego” w P2 — tylko A wiąże presję z decyzjami gracza i z jego gotówką — koszt pomyłki: jeśli plan okaże się zbyt abstrakcyjny, trzeba będzie dołożyć widoczne skutki z B/C wcześniej.`

## 6. Projekt

### 6.1 Plan (`src/sim/economy/`, blok przy `franchisee`)

- Plan to obrót sklepu w miesiącu (zł). Należy do umowy franczyzobiorcy na ten sklep, jak raty: w sztafecie następca zacznie od zera.
- **Start:** pierwszy plan obowiązuje w czwartym pełnym miesiącu umowy sklepu. Sklepy otwarte później mają własny zegar.
- **Wysokość:** `plan = baza dzienna × dni miesiąca × (1 + wzrost)`, zaokrąglone do „ładnej” kwoty.
  - `baza dzienna` = większa z dwóch: średni dzienny obrót z trzech ostatnich zamkniętych miesięcy; 95% bazy poprzedniego planu (start).
    Po wpadce plan spada więc najwyżej o 5% miesięcznie: Centrala „łaskawie koryguje”.
  - `wzrost` = 2% + 0,5 pkt proc. za każde trafienie z rzędu, najwyżej 5% (start).
- Liczenie na dzień zdejmuje różnicę 28–31 dni. Kalendarz gry nie ma sezonów miesięcznych, więc innej korekty nie trzeba.
- Dni, w których sklep stał przez remont, nie wchodzą ani do bazy, ani do planu (plan liczy się na dni otwarte).
- Blok planu sam trzyma to, czego potrzebuje: dzienny obrót z trzech ostatnich miesięcy, bazę, serię, stopień drabiny, licznik dni
  otwartych i obrót do planu w bieżącym miesiącu. `history` zostaje bez nowych pól.
- „Obrót do planu” to obrót miesiąca z `closeMonth` plus dobicie z §6.4. Dobicie nie wchodzi do `history.revenue`, więc nie zawyża
  raportu, premii od obrotu ani progów czwartego i piątego sklepu.

`Ruling: stan planu w osobnym bloku przy `franchisee` sklepu, bez zmian w `history` — `history` ma dziś tylko sumy miesiąca, a paczka zapisu ma 1,6 KB zapasu — koszt pomyłki: przy migracji starego zapisu dni remontu z ostatnich trzech miesięcy nie są znane, więc pierwszy plan po migracji może być minimalnie za niski.`

`Ruling: plan miesięczny, nie kwartalny — raport miesięczny jest tętnem gry, a podgląd miesiąca (`monthPreview.ts`) już prognozuje obrót — koszt pomyłki: miesiąc jest bardziej szarpany przez karty dnia; łagodzi to średnia z trzech miesięcy.`

### 6.2 Rozliczenie przy zamknięciu miesiąca

| Wykonanie | Skutek |
|---|---|
| ≥ 100% | premia 1% obrotu miesiąca na saldo, zaufanie +2, seria +1, drabina o stopień w dół |
| < 100% | bez premii, zaufanie −2, seria = 0, drabina o stopień w górę, kara wg stopnia |

Wszystkie liczby: start. Kara jest osobnym wierszem „Plan Centrali” w wyciągu tego sklepu i schodzi z jego najbliższego przelewu, jak
nadwyżka z remanentu. Nie jest mandatem: nie zabiera dodatkowego zaufania i nie psuje KPI „bez mandatu”.

`Ruling: zaufanie za plan tylko ±2 (jak KPI tygodnia), nowa przyczyna „plan” w raporcie zaufania — sklep ma tracić umowę przez drabinę, a nie przez zaufanie 0 po drodze; zaufanie 0 działa dalej jak dziś — koszt pomyłki: plan słabo wpływa na premię od obrotu i przydział wirali.`

### 6.3 Drabina (osobno dla każdego sklepu)

| Stopień | Nazwa | Co się dzieje |
|---|---|---|
| 0 | W planie | nic |
| 1 | Rozmowa z partnerem regionalnym | kara 10% brakującego obrotu |
| 2 | Program naprawczy | kara 20% brakującego obrotu, premia od obrotu zawieszona, audyty dwa razy częściej |
| 3 | Wypowiedzenie placówki | Centrala zamyka sklep z rozliczeniem końcowym (`closeStore`, nowy powód `plan`); lokal zostaje „po Traszce” |

Trzy wpadki z rzędu to utrata sklepu; jedno trafienie cofa o stopień. Gracz może wcześniej sam oddać sklep z wypowiedzeniem (istniejąca
ścieżka `notice`). W sieci własne sklepy podbierają sobie ruch (kanibalizacja 4b), więc piąty sklep obok trzeciego utrudnia oba plany.

Ostatni sklep (pytanie 1 z §4): stopień 3 kończy grę tak, jak dziś zaufanie 0, czyli bez rozliczenia końcowego (`f.over = 'closed'`).
Ekran końca gry mówi, że umowę zakończył plan, i pokazuje przeżyte miesiące, gotówkę oraz ostatni plan i jego wykonanie.

### 6.4 „Dobij plan z własnej kieszeni” [?]

Na pasku planu każdego sklepu jest przełącznik „Dobij plan z własnej kieszeni, jeśli zabraknie do 10%”, domyślnie wyłączony. Gracz
może go zmienić w dowolnej chwili miesiąca (polecenie gracza, jak zakup). Przy zamknięciu miesiąca:

- **włączony i wykonanie 90–100%:** franczyzobiorca kupuje brakujący towar sam. Ze wspólnego portfela schodzi brakujący obrót
  pomniejszony o jego marżę (ok. 83% kwoty), miesiąc liczy się jako trafiony, ale bez premii, a dokupiony obrót wchodzi do bazy
  następnego planu. Gdy portfel po dobiciu spadłby poniżej progu ostrzeżenia o debecie, dobicia nie ma;
- **wyłączony albo wykonanie poniżej 90%:** wpadka, jak w §6.2.

Rano ostatniego dnia miesiąca, gdy prognoza jest w przedziale 90–100%, gra staje z komunikatem „Brakuje X zł do planu” i pokazuje
koszt dobicia oraz karę za wpadkę. Dotyczy to też sklepów w tle (przez skrzynkę firmy).

To jedyne miejsce, w którym gotówka wprost kupuje spokój, i od razu pułapka: każde dobicie podnosi poprzeczkę.

`Ruling: przełącznik zamiast karty dnia — karty przychodzą tylko do aktywnego sklepu, a sklepy w tle i przewijanie dni zamykają miesiąc same; przełącznik działa wszędzie tak samo i jest deterministyczny — koszt pomyłki: decyzja jest mniej dramatyczna niż karta; ratuje to komunikat ostatniego dnia.`

### 6.5 Co widzi gracz

Pasek w podglądzie miesiąca, od pierwszego dnia:

```
Plan Centrali: 412 000 zł      seria: 3 miesiące
wykonane 61%   prognoza na koniec: 97%
Jeśli nic się nie zmieni: kara 1 240 zł, stopień 1 (rozmowa z partnerem)
```

- Raport miesięczny: wiersz „Plan Centrali”, wykonanie, premia albo kara, nowy plan na następny miesiąc i dlaczego tyle.
- Zmiana stopnia drabiny: komunikat fabularny (gra staje), list od partnera regionalnego.
- Miesiąc trzeci: zapowiedź „koniec okresu wdrożenia, od przyszłego miesiąca plan”.
- Zakładka Miasto: przy każdym sklepie stopień drabiny i prognoza wykonania.
- Przewijanie dni trzyma się przełącznika z §6.4 i nie staje na komunikacie ostatniego dnia (trafia on na listę „co się wydarzyło”).

### 6.6 Stare zapisy

Zapis po migracji dostaje plan od następnego miesiąca, liczony z trzech ostatnich raportów, ze stopniem 0 i serią 0, razem z zapowiedzią.
Sklep młodszy niż trzy miesiące czeka do swojego czwartego miesiąca.

### 6.7 Balans na botach (bramki, liczby: start)

Boty z `tests/progresjaPlay.ts`, 5 seedów raportu 4b, 24 miesiące, plus jeden nowy bot `rozsadny` (kupuje, gdy prognoza planu spada
poniżej 105%, poza tym oszczędza; nie dobija planu z kieszeni).

| Bramka | Warunek |
|---|---|
| P1 | ranking: wynik sezonu bit w bit jak przed etapem |
| P2 | miesiące 1–3 zwykłej gry bez zmian |
| P3 | `mistrz` (jeden sklep, nic nie kupuje): pierwsza wpadka w miesiącach 5–9, utrata sklepu przed końcem 18. miesiąca |
| P4 | `jeden` (kupuje wszystko): mediana pierwszej wpadki nie wcześniej niż w 12. miesiącu |
| P5 | `siec12` (rok buduje, potem tylko czeka): pierwsza wpadka w ciągu 4 miesięcy od końca zakupów |
| P6 | `rozsadny`: milion w portfelu w miesiącach 14–22 na co najmniej 3 z 5 seedów, bez utraty sklepu startowego |
| P7 | żadna kara nie spada bez wcześniejszej prognozy w podglądzie miesiąca (test jednostkowy) |

Jeśli P3–P6 nie dają się spełnić razem, autor raportu opisuje lukę i nie zmienia gwałtownie ekonomii (jak w raporcie 4b §5).

## 7. P2 (do wycięcia)

- Program naprawczy z treścią: obowiązkowe palety promocyjne, narzucone promocje.
- Partner regionalny jako postać (imię, portret, ton listów).
- Okólniki późnej gry („nowy standard wizualny”).
- Cele i wpisy do Galerii za serię trafionych planów.

## 8. Ryzyka

- **Spirala w dół.** Kara zabiera gotówkę potrzebną na inwestycje, które ratują plan. Hamulce: plan spada do 5% miesięcznie po wpadce,
  kary liczą się od brakującego obrotu, a nie od całego.
- **Gra na zaniżanie.** Gracz może celowo trzymać obrót nisko, żeby plan nie rósł. To świadomie dozwolona strategia (mniej zarabia), ale
  bramka P6 sprawdza, czy nie jest lepsza od inwestowania.
- **Stary zapis po 20 miesiącach.** Gracz wraca i od razu ma plan. Łagodzi to stopień 0 i miesiąc zapowiedzi.
- **Gniew zamiast napięcia.** Jeśli gracz nie widzi, skąd wziął się plan, poczuje oszustwo. Stąd „dlaczego tyle” w raporcie.

## 9. Zostaje dla wykonawcy

Nazwy pól bloku planu, wygląd przełącznika z §6.4, układ paska w podglądzie, teksty listów (po polsku i angielsku,
w tonie dotychczasowych okólników), dobór „ładnego” zaokrąglenia, strojenie liczb „start” w granicach bramek.

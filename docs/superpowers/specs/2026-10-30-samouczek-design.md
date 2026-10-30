# Samouczek: krótki przelot po grze i dymki „pierwszy raz”

Status: projekt sesji `samouczek` (2026-10-30), czeka na akceptację właściciela · Gałąź: `claude/samouczek` (od `main` 5bf6947) · Podstawa: burza mózgów z właścicielem 2026-10-30 (sesja local_8ef1db87), opis zatwierdzony słowami „Jest super, wprowadzaj”.

Samouczek to wyłącznie warstwa widoku. Nie zmienia `src/sim/**`, `SIM_VERSION`, GOLDEN ani `judgeBundle.js`, więc serwer rankingu odtwarza biegi tak samo jak dziś. Samouczek nigdy sam nie wywołuje `dispatch`: każde polecenie dla symulacji klika gracz.

## 1. Problem i zakres

Nowy gracz jest na starcie przytłoczony. Musi naraz zrozumieć palety, ekonomię (gotówka, rachunek Centrali, zaufanie), cel gry i rozwój, zakupy i ludzi, a do tego „co jest czym na tym ekranie”. Dziś dostaje okno „Jak grać” (7 punktów i zwinięte szczegóły) oraz sześć dymków `FIRST_DAY_HINTS`, które same przewijają się co 9 s. Jedno i drugie to tekst bez wskazania, gdzie co jest.

W zakresie:
- okno wyboru po ekranie startowym: „Samouczek (ok. 3 min)” albo „Pomiń, znam grę”;
- przelot po prawdziwym sklepie gracza: przygaszony ekran, wskazany element, dymek ze strzałką, kilka zadań do wykonania;
- pojedyncze dymki przy pierwszym zdarzeniu danego rodzaju;
- pamięć w `localStorage`, ponowne uruchomienie z „Jak grać” i z ⚙, wyłącznik dymków w ⚙.

Poza zakresem (robi to równolegle SIM 6, gałąź `claude/trzy-kieszenie`):
- `src/sim/economy/*`;
- wygląd i zachowanie wiersza pieniędzy w `src/ui/game/Hud.tsx` (gotówka, `DueChip`);
- okno rachunku końca miesiąca (`src/ui/game/monthPreview.tsx`);
- ostrzeżenia `.tt-spend`;
- teksty „Jak grać”.

W tych miejscach samouczek dopisuje najwyżej atrybut `data-tut`. Nie zmienia ich wyglądu ani zachowania.

## 2. Decyzje właściciela (wiążące)

- **Styl B.** Neutralny dymek ze strzałką przy elemencie. Reszta ekranu przygasa, element dostaje spotlight i pulsujący pierścień. Dymek ma licznik kroków („3 / 16”) oraz przyciski „Dalej” i „Pomiń”. Bez postaci przewodnika. Satyrę niosą krótkie, suche zdania.
- **Nauka rozłożona w czasie.** Na start krótki przelot (ok. 3 min) z kilkoma zadaniami. Później pojedyncze dymki przy pierwszym zdarzeniu: cel do odebrania, nadmiar palet w przejściach, karta decyzji, koniec miesiąca (po SIM 6 także wyciąg od Centrali i remanent).
- **Okno wyboru zastępuje** samo otwierające się „Jak grać” i sześć dymków `FIRST_DAY_HINTS`. „Jak grać” zostaje pod „?” i w ⚙.
- **Przelot w prawdziwym, pierwszym zwykłym sklepie gracza.** Czas stoi na istniejącej pauzie (`controls.setSpeed(0)`).
- **Zadania tylko darmowe i odwracalne:** otwórz zakładkę, przełącz zamówienie, stuknij paletę, odpowiedz na kartę. Zatrudniania i ulepszeń samouczek tylko pokazuje.
- **Ranking.** Przelot działa tylko w zwykłym sklepie: przy starcie rankingowym nie ma propozycji, a uruchomiony w biegu rankingowym pokazuje komunikat „Samouczek działa w zwykłym sklepie.”. Dymki „pierwszy raz” działają także w rankingu.
- **Pamięć** w `localStorage`, z `try/catch`. Samouczek da się uruchomić ponownie z „Jak grać” i z ⚙.
- **Rogalik (później).** Nowy franczyzobiorca z generatora nie dostaje samouczka automatycznie, ale może go uruchomić.

## 3. Przepływ pierwszego wejścia

```
ekran „Twój kasjer”
 ├─ „Otwieramy sklep!” → nowy zwykły sklep ──→ okno „Pierwszy dzień w Traszce” (gra czeka)
 │                                              ├─ „Samouczek (ok. 3 min)” → przelot (§4) → gra rusza
 │                                              └─ „Pomiń, znam grę”       → gra rusza od razu
 └─ „Start rankingowy” → bieg rankingowy ──────→ „Jak grać” jak dziś, bez propozycji samouczka
```

**Kiedy pojawia się okno wyboru.** Dokładnie tam, gdzie dziś gra sama otwiera „Jak grać” dla zwykłego, zupełnie nowego sklepu:
- `GameShell.open` z wyborem z ekranu startowego (`src/game/actions.ts`, dziś linia 951);
- `openChosenStore` po „Nowy sklep” z ⚙, gdy sklep nie jest wczytany z zapisu (dziś linia 805).

Dodatkowy warunek: gracz jeszcze nigdy nie odpowiedział na to okno (`tour === null` w pamięci, §8). Rogalik i każdy kolejny nowy sklep tego samego gracza okna już nie dostają.

**Co znika:**
- automatyczne `ui.openHowTo()` w obu miejscach wyżej (start rankingowy w `main.ts` zostaje, patrz niżej);
- `FIRST_DAY_HINTS`, komponent `FirstDayHints` i mechanizm dymków pierwszego dnia w `state.ts` (`hints`, `showHints`, `nextHint`, `HINT_MS`, `hintsHeld`), pole `firstDayHints` w `ShellDeps` oraz style `.tt-hintbubble*`. Testy tych elementów idą razem z nimi. Zamiast nich testy sprawdzają okno wyboru.

**Start rankingowy z ekranu startowego** (`main.ts`, `onStarted`): nadal otwiera „Jak grać”. To jedyna pomoc w biegu rankingowym, bo przelotu tam nie ma. *Decyzja sesji do potwierdzenia przez właściciela (§13, pytanie 1).*

**Gracze sprzed tej zmiany** mają już metę, więc nie widzą ekranu startowego ani okna wyboru przy wejściu. Okno zobaczą raz, gdy otworzą nowy sklep przez ⚙ → „Nowy sklep”. Samouczek mogą też włączyć sami (§9).

**Okno wyboru** (zwykłe okno `tt-modal`; dopóki jest otwarte, gra stoi, bo okno wchodzi do `isWindowOpen`):

> **Pierwszy dzień w Traszce**
> Centrala przygotowała krótkie szkolenie: co jest na ekranie, palety, pieniądze, ludzie i rozwój. Czas w sklepie stoi, dopóki nie skończysz.
> [ Samouczek (ok. 3 min) ]  [ Pomiń, znam grę ]
> *Samouczek włączysz też później: „?” albo ⚙.*

- „Samouczek (ok. 3 min)” zapisuje w pamięci `tour: 'started'` i uruchamia przelot.
- „Pomiń, znam grę” zapisuje `tour: 'skipped'`, zamyka okno i gra rusza z prędkością, jaką miała (×1).

## 4. Przelot

### 4.1 Czas, klawisze i kliknięcia

- **Pauza.** Na starcie przelot zapamiętuje bieżącą prędkość i woła `controls.setSpeed(0)`. Przy „Pomiń” i w ostatnim kroku przywraca zapamiętaną prędkość. Uruchomiony w pauzie, przywraca pauzę. Pod oknem wyboru czas stoi tak jak pod „Jak grać” (`isWindowOpen`), a sam przelot korzysta tylko z prędkości.
- **Klawisze.** W czasie przelotu skróty gry (spacja, Q/E, X, F3…) są wyłączone: `bindControls` w `main.ts` dostaje w `blocked` także „trwa przelot”. W dymku: Enter albo strzałka w prawo to „Dalej”, Esc to „Pomiń”.
- **Kliknięcia.** Ekran poza wskazanym elementem zasłaniają cztery przezroczyste prostokąty wokół „dziury”. Kliknięcia nie dochodzą do sceny ani do innych przycisków. W kroku informacyjnym dziurę zamyka piąty prostokąt, więc wskazanego przycisku też nie da się nacisnąć: samouczek pokazuje „+” przy zatrudnianiu, ale nic nie kupi. W kroku z zadaniem dziura jest otwarta i gracz klika prawdziwy element gry.
- **Czego samouczek wolno.** Samouczek nie wywołuje `dispatch`. Zmienia tylko stan widoku: prędkość (pauza i jej zdjęcie), otwartą zakładkę (`tab`), zaznaczenie (`selection = null`), przewinięcie arkusza do wskazanego elementu (`scrollIntoView({ block: 'nearest' })`) i atrybut `data-tut-step` na `<html>` (dla stylów kroku, §10). Pilnuje tego test źródła (§12).

### 4.2 Wygląd (styl B)

- **Przygaszenie.** Pierścień wokół wskazanego elementu (prostokąt elementu plus 6 px) ma `box-shadow: 0 0 0 9999px rgba(8, 16, 12, 0.6)` i pomarańczową obwódkę marki, która pulsuje (bez pulsu przy `prefers-reduced-motion`). Krok bez elementu przygasza cały ekran.
- **Dymek.** Kremowe tło jak w kartach gry, zielony tytuł i licznik „3 / 16” po prawej, tekst 13 px, strzałka (trójkąt) od strony elementu. Pod tekstem, w krokach z zadaniem, wiersz „👉 …” z tym, co zrobić. Na dole „Pomiń” (przycisk bez tła) i „Dalej” (główny).
  - W kroku z zadaniem nie ma „Dalej”. Gdy zadanie jest zrobione, dymek pokazuje „✓ Zrobione” i po 0,7 s przechodzi dalej sam.
  - Jeśli zadanie nie da się wykonać (np. brak palet, karta na biurku blokuje stukanie), krok zamienia się w zwykły krok z „Dalej”.
  - W ostatnim kroku główny przycisk to „Zakończ”.
  - Gdy wskazanego elementu nie ma w DOM (np. po przebudowie paska przez SIM 6), krok pokazuje dymek na środku ekranu bez strzałki i bez dziury. Przelot się nie zatrzymuje. Zadanie bez elementu zamienia się w krok informacyjny.
- **Dostępność.** Dymek ma `role="dialog"`, `aria-modal="true"` i etykietę „Samouczek, krok N z M”. Fokus przechodzi na główny przycisk przy każdym kroku. Dymki „pierwszy raz” mają `role="status"`.
- **Warstwy.** Przelot leży na `z-index: 25`: nad oknami gry (12) i ekranem startowym (20), pod banerem nagrody (30) i konfetti (40). Dymki „pierwszy raz” leżą na 24.

### 4.3 Kolejność kroków

Kolejność ustala się raz, na starcie przelotu, z bieżącego stanu (`buildTour(ctx)`, czysta funkcja). Dzięki temu licznik „N / M” od początku zna M. Warunki:
- **Karta na biurku na starcie** (`visibleCards(...).length > 0`). Dzieje się to w nowej grze, gdy pierwsza karta dnia 0 ma godzinę 6:00, oraz po ponownym uruchomieniu w trakcie gry. Wtedy krok 2 to zadanie „odpowiedz na kartę”, a ogólny krok o kartach (14) wypada. Taka kolejność jest konieczna: póki karta czeka, gra odrzuca stuknięcia („Najpierw karta na biurku.”), a okno karty zasłania ekran.
- **Zamówienie w trybie Asystenta na starcie** (`s.order.auto`). Wtedy kroki 9a i 9b to zadania: przełącz na „Ręcznie”, potem z powrotem na Asystenta. Przelot zostawia ustawienie takie, jakie było. Gracz, który zamawia ręcznie, dostaje zamiast nich jeden krok informacyjny 9c i samouczek nie namawia go do zmiany.
- **Wynik:** zwykle 16 kroków, 15 przy zamówieniu ręcznym.

**Dlaczego „stuknij paletę” jest na końcu.** W pauzie przyciski stukania są wyłączone (`tapBlock` w `src/ui/game/tapBlock.ts`: „Gra wstrzymana: wznów czas”). Inaczej pauza dawałaby darmowy rozładunek. Dlatego ostatni krok najpierw zdejmuje pauzę, a dopiero potem prosi o stuknięcie 📦. Sklep ożywa za przygaszeniem i to jest naturalny koniec przelotu.

### 4.4 Kroki i teksty

Liczby w tekstach pochodzą ze stałych gry, tak jak w `howToText.ts`: zmiana stałej zmienia tekst. Kolumna „Wskazuje” to wartość `data-tut` (§11.3); „—” oznacza dymek na środku ekranu. Kroki oznaczone **[$]** leżą na osobnej liście pieniędzy (§6).

| # | Id | Wskazuje | Rodzaj | Tytuł i tekst | Zadanie / zaliczenie |
|---|---|---|---|---|---|
| 1 | `cel` | — | info, zamyka zakładkę i zaznaczenie | **Witaj w Traszce.** Prowadzisz sklep Traszki na franczyzie. Cel: dojść do rangi „{najwyższa ranga}” i nie stracić umowy z Centralą. Czas stoi, dopóki nie skończymy. | — |
| 2 | `karta-teraz` | `card` | zadanie, tylko gdy karta czeka | **Karta decyzji.** Centrala już ma sprawę. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest zaznaczona. | 👉 Wybierz odpowiedź i naciśnij „Zatwierdź”. Zaliczone, gdy na biurku nie ma widocznej karty. |
| 3 | `gotowka` **[$]** | `cash` | info | **Gotówka.** Z niej idą zakupy, płace i opłaty. Poniżej zera to debet, a przy {DEBT_LIMIT} Centrala kończy współpracę od ręki. | — |
| 4 | `rachunek` **[$]** | `due` | info | **Rachunek Centrali.** Tyle oddasz Centrali przy zamknięciu miesiąca, a tyle gotówki zostanie wolne. Kwota rośnie z każdym klientem. Stuknij, a zobaczysz rachunek i podgląd końca miesiąca. | — |
| 5 | `zaufanie` **[$]** | `trust` | info | **Zaufanie Centrali.** Od 0 do 100, na start {TRUST.start}. Rośnie za trafione cele tygodnia i miesiące na plusie, spada za mandaty i straty. Przy zerze na koniec miesiąca umowa się kończy. | — |
| 6 | `czas` | `speed` | info | **Czas.** ❚❚ zatrzymuje grę (także spacja), ×1–×8 przyspiesza. Doba przy ×1 trwa ok. {dayLengthText()}. Teraz czas stoi: samouczek trzyma pauzę. | — |
| 7 | `zakladki` | `tabs` | info | **Zakładki.** Tu jest zarządzanie: Sklep (kolejka, półki, opinia), Palety, Ludzie, Ulepszenia i Cele. Drugie stuknięcie zamyka zakładkę. | — |
| 8 | `palety` | `tab-palety` | zadanie | **Palety.** Towar przyjeżdża na paletach. Zobaczmy, gdzie stoją. | 👉 Otwórz zakładkę Palety. Zaliczone przy `tab === 'palety'`. |
| 9a | `reczne` | `order-manual` | zadanie, gdy Asystent | **Zamówienie.** Domyślnie zamawia Asystent Traszki. Zwykle trochę przesadza, bo „klienci to kochają”. Ręcznie sam ustawiasz liczbę palet na jutro. | 👉 Przełącz na „Ręcznie”. Zaliczone przy `!s.order.auto`. |
| 9b | `asystent` | `order-auto` | zadanie, gdy Asystent | **Zamówienie.** Teraz liczbę palet ustawiasz przyciskami − i +. Na początek zostaw to Asystentowi: liczy za Ciebie. | 👉 Wróć do „Asystent Traszki”. Zaliczone przy `s.order.auto`. |
| 9c | `zamowienie` | `order` | info, gdy ręcznie | **Zamówienie.** Zamawiasz ręcznie. Gdy zechcesz, Asystent Traszki policzy za Ciebie: przełącznik jest tutaj. | — |
| 10 | `miejsca` | `pallets` | info | **Gdzie stoją palety.** Pod sklepem grozi mandat Straży Miejskiej. Zaplecze jest bezpieczne, ale małe. W sali i w przejściach palety przeszkadzają klientom, a ⭐ reputacja spada. „Na zaplecze” przenosi paletę. | — |
| 11 | `ludzie` | `hire` | info, otwiera zakładkę Ludzie | **Ludzie.** „+” zatrudnia: {HIRE_COST} zł rekrutacji i {WAGE_PER_DAY} zł dziennie za osobę. Niżej ustawiasz, czym ludzie zajmują się najpierw. Samouczek niczego tu nie kupi. | — |
| 12 | `ulepszenia` | `sheet` | info, otwiera zakładkę Ulepszenia | **Ulepszenia.** Sprzęt do slotów, szkolenia i remont, który powiększa sklep. {MONEY_NOTES.ulepszenia} | — |
| 13 | `cele` | `sheet` | info, otwiera zakładkę Cele | **Cele i rozwój.** Cel tygodnia od Centrali daje premię, zaufanie i XP. Poziomy odblokowują sprzęt i remonty. Kamienie milowe dają Ogonki 🦎: „Odbierz”. Po drugim remoncie albo na {20}. poziomie otworzysz kolejną Traszkę. | — |
| 14 | `karta` | — | info, gdy kroku 2 nie było | **Karty decyzji.** Codziennie może przyjść karta: sprawa od Centrali albo od życia. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach. | — |
| 15 | `pomoc` | `help` | info, zamyka zakładkę | **Pomoc.** Instrukcja i ten samouczek są pod „?”. Przy pierwszych zdarzeniach podpowiemy jeszcze krótko. | — |
| 16 | `start` | `clicker` | zadanie, zdejmuje pauzę | **Czas rusza.** Twoje ręce: 📦 rozładowuje najpilniejszą paletę, 🧾 obsługuje klienta, gdy kasa się korkuje. Każde stuknięcie zjada siły z paska nad przyciskami. | 👉 Stuknij 📦. Zaliczone, gdy `s.total.taps` wzrośnie względem wejścia w krok. Przycisk „Zakończ” jest zawsze. |

Ustalenia do tabeli:
- **{MONEY_NOTES.ulepszenia}** na `main`: „Płacisz gotówką od razu, a przy zakupie widać, czy starczy na opłatę Centrali.”
- **„{20}”** i „drugim remoncie” to dziś liczby wpisane w `prestigeReady` (`src/game/meta.ts`, warstwa gry, nie sim). Wynosimy je do stałych `PRESTIGE_LEVEL` i `PRESTIGE_REMONT` w tym samym pliku, bez zmiany wartości, i z nich składamy tekst.
- **Krok 16.** Zadanie jest wykonalne, gdy 📦 jest aktywny: palety są, siły są, czas idzie i nie czeka karta (`tapBlock` i `s.pallets.length > 0`). Jeśli nie jest, zostaje sam „Zakończ”.
- **Zaliczenia zadań** to czyste funkcje stanu i sygnałów widoku: `done(ctx, mark)`, gdzie `mark` to migawka z wejścia w krok (np. `taps`). Sprawdzają się przy każdej publikacji stanu (co 200 ms) i przy zmianie zakładki.

### 4.5 Koniec przelotu

- **„Zakończ” albo zaliczony krok 16:** pamięć `tour: 'done'`, warstwa znika, prędkość zostaje przywrócona (krok 16 zrobił to już na wejściu).
- **„Pomiń” w dowolnym kroku:** pamięć `tour: 'skipped'`. Jeśli wcześniej było `'done'`, pamięć zostaje bez zmian. Warstwa znika, wraca zapamiętana prędkość, zakładka się zamyka.
- **Przeładowanie strony w trakcie** kończy przelot bez śladu (stan przelotu nie jest zapisywany). W pamięci zostaje `'started'`, więc okno wyboru już nie wraca. Samouczek da się włączyć z „?”.

## 5. Dymki „pierwszy raz”

Zasady:
- Każdy dymek wyskakuje najwyżej raz na przeglądarkę (`seen` w pamięci, §8). Wszystkie da się wyłączyć w ⚙ („Podpowiedzi przy pierwszych zdarzeniach”).
- Działają w zwykłej grze i w biegu rankingowym, bo tylko coś pokazują.
- Nie przygaszają ekranu i nie zatrzymują gry. Mają pulsujący pierścień na elemencie, dymek ze strzałką i przycisk „OK”.
- Naraz widać najwyżej jeden, w kolejności z listy. Nie pojawiają się pod oknem wyboru ani w trakcie przelotu.
- Dymek, którego element jest pod innym oknem gry, czeka. Wyjątek to dymki wskazujące samo okno (karta, raport): pokazują się nad nim.
- Dymek znika po „OK” albo gdy zdarzenie się rozwiąże (cel odebrany, przejścia puste, karta odpowiedziana, raport zamknięty). W obu przypadkach trafia do `seen`.
- Gdy elementu nie ma w DOM (np. zakładka zamknięta), dymek wskazuje element zastępczy z tabeli albo czeka.

Warunki są czystymi funkcjami stanu gry i sygnałów widoku (`tipFor(ctx, memory)`). Żadnej zmiany w symulacji.

| Id | Warunek wyzwolenia (ze stanu) | Wskazuje | Tekst | Znika, gdy |
|---|---|---|---|---|
| `tip-cel` | `s.milestonesReady.length > 0` | zakładka Cele zamknięta: `claim` (🎁 w pasku); otwarta: `claim-btn` (pierwsze „Odbierz”) | zamknięta: „Cel spełniony. Nagroda nie przyjdzie sama: stuknij 🎁.” · otwarta: „Tu „Odbierz”. Centrala lubi, jak się o coś prosi.” | `milestonesReady` puste albo „OK” |
| `tip-przejscia` | `s.pallets.some(p => p.loc === 'aisle')` | zakładka Palety zamknięta: `tab-palety`; otwarta: `pallet-aisle` (pierwsza paleta w przejściu) | zamknięta: „Zabrakło miejsc: palety stoją w przejściach, a klienci się o nie potykają. Zajrzyj do Palet.” · otwarta: „Rozładuj ją albo przenieś na wolne miejsce. Na przyszłość: mniej palet w zamówieniu.” | brak palet w przejściach albo „OK” |
| `tip-karta` | jest widoczna karta i `s.history.length === 0` (pierwszy miesiąc gry); dymek nad oknem karty | `card` | „Karta decyzji. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest już zaznaczona.” | brak widocznej karty albo „OK” |
| `tip-miesiac` **[$]** | `report.value !== null`, `s.history.length <= 1` i nie `gameOver`; dymek nad raportem | `report` (nagłówek „Wynik miesiąca”) | „Koniec miesiąca. Centrala pobrała opłatę: stałą kwotę i procent obrotu. Miesiąc na plusie podnosi zaufanie, na minusie je obniża.” | raport zamknięty albo „OK” |
| `tip-remanent` **[$]** | po SIM 6: otwarty protokół remanentu (dziś zawsze fałsz) | po SIM 6: `remanent` | do napisania z SIM 6 | po SIM 6 |

Uwagi:
- **`tip-karta`.** Jeśli przelot obsłużył prawdziwą kartę (krok 2), `tip-karta` od razu trafia do `seen`. Jeśli gracz przeszedł przelot z krokiem 14 (bez karty na ekranie), dymek przy pierwszej prawdziwej karcie pokaże ją palcem. Warunek „pierwszy miesiąc” chroni gracza, który gra od tygodni: nie dostanie dymka przy setnej karcie.
- **Gracze sprzed tej zmiany.** Warunki opierają się na stanie gry, więc dostaną tylko to, czego jeszcze nie przeżyli. `tip-przejscia` dotyczy mechaniki z SIM 5, więc przyda się także im.

## 6. Lista pieniędzy (do podmiany po SIM 6)

Wszystko, co mówi o pieniądzach, zaufaniu Centrali i ratach, leży w jednym pliku `src/ui/tutorial/money.ts`. Po wejściu SIM 6 da się go przepisać bez dotykania silnika i reszty kroków:
- `MONEY_STEPS`: kroki 3–5 (`gotowka`, `rachunek`, `zaufanie`). `buildTour` wstawia je po kroku 2.
- `MONEY_NOTES.ulepszenia`: zdanie o płaceniu w kroku 12.
- `MONEY_TIPS`: `tip-miesiac` i `tip-remanent`.

Pozycje do poprawy po wejściu SIM 6 (trafią też do raportu końcowego):
1. `gotowka`, `rachunek`, `zaufanie`: zamiana na trzy kieszenie z paska (gotówka, saldo u Centrali, które widać, ale nie da się go wydać, i przelew miesięczny) oraz zaufanie, które decyduje o kredycie i ratach. Nowe `data-tut` na elementach nowego wiersza pieniędzy.
2. `MONEY_NOTES.ulepszenia`: „gotówka czy raty”; raty potrącane z przelewów Centrali.
3. `tip-miesiac`: wskazanie i tekst dla okna „Wyciąg od Centrali”. Z gotówki idą VAT, ZUS i pensje, a przelew przychodzi od Centrali.
4. `tip-remanent`: warunek (otwarty protokół remanentu), `data-tut="remanent"` i tekst.
5. Atrybuty `data-tut="cash"` i `data-tut="due"`: SIM 6 przebudowuje te elementy, więc atrybuty trzeba przenieść na nowe.

## 7. Ranking

- Okno wyboru nigdy nie pojawia się przy starcie rankingowym. `openChosenStore` dla rankingu kończy się, zanim dojdzie do okna, a `GameShell.open` obsługuje tylko zwykły sklep.
- „Samouczek” z „Jak grać” albo z ⚙ w biegu rankingowym (`ranked.value !== null`) niczego nie uruchamia. Pokazuje tylko toast „Samouczek działa w zwykłym sklepie.”.
- Dymki „pierwszy raz” działają w biegu rankingowym, bo niczego nie wysyłają i nie zmieniają stanu gry.
- Przelot nie wywołuje `dispatch` i nie zmienia `src/sim/**`. Bieg zwykły po przelocie ma w dzienniku tylko polecenia kliknięte przez gracza (odpowiedź na kartę, `setOrder`, stuknięcie), jak bez samouczka.
- Smoke nigdy nie łączy się z produkcją: blokuje wszystkie zapytania poza `localhost` i niczego nie wysyła do `/api/runs` (§12).

## 8. Pamięć w `localStorage`

- Klucz: `traszka:tutorial`. Wartość: `{"v":1,"tour":null|"started"|"skipped"|"done","seen":["tip-cel",…],"tips":true}`.
- Odczyt i zapis są w `try/catch`. Brak klucza, zły JSON, obce pola albo błąd przeglądarki dają wartości domyślne `{ v: 1, tour: null, seen: [], tips: true }`. Błąd zapisu jest cichy: gra działa dalej, a okno wyboru może się pokazać jeszcze raz.
- `seen` przyjmuje tylko znane identyfikatory dymków, bez powtórzeń. Najwyżej 32 wpisy.
- Pamięć jest wspólna dla przeglądarki. Nie wchodzi do zapisu sklepu ani do mety, więc nie trafia do pakietu kodu odzyskiwania i nie zmienia formatu zapisu.
- Moduł przyjmuje magazyn jako argument z domyślnym `globalThis.localStorage`. Testy podają `MemoryStorage` z `src/game/memoryStorage.ts`, także z `failWrites`.

## 9. Ponowne uruchomienie

- **„?” → „Jak grać”:** w stopce okna obok „Zaczynamy” dochodzi przycisk „Samouczek”. Zamyka okno i uruchamia przelot od kroku 1.
- **⚙ → Pomoc:** obok „Jak grać” dochodzi „Samouczek” (zamyka ustawienia i uruchamia przelot) oraz pole „Podpowiedzi przy pierwszych zdarzeniach” (`tips`).
- **W biegu rankingowym** oba przyciski dają toast z §7.
- **Po końcu współpracy** (`gameOver`) przelot nie rusza. Okno końca gry i tak zasłania „?” i ⚙.
- **W sklepie tymczasowym** (`ephemeral`) przelot działa normalnie, a pamięć samouczka zapisuje się jak zawsze.
- **Przelot uruchomiony w środku gry** układa kroki z bieżącego stanu (§4.3). Kroki z zakładkami działają w każdym sklepie. Zadanie ze stukaniem bez palet albo bez sił zamienia się w krok informacyjny.
- **Rogalik:** nowy franczyzobiorca z generatora ma już `tour !== null`, więc okna wyboru nie dostaje. Włączy samouczek tak jak wyżej.

## 10. Układ na 390 px i na desktopie

**Geometria dziś** (ze stylów `ui.css`):

| | 390×844 (telefon) | 1280×800 (desktop) |
|---|---|---|
| pasek górny | 3 wiersze, ok. 112 px | 1 wiersz, ok. 52 px |
| zakładki | dół, 60 px | dół, 60 px |
| arkusz zakładki | od dołu nad zakładkami, do 62vh (ok. 523 px), górna krawędź ok. 261 px | panel z prawej, 390 px szerokości, od ok. 64 px do ok. 728 px |
| kliker | prawy dolny róg nad zakładkami | jak na telefonie |
| szerokość dymka | `min(340px, 100vw − 24px)` | 360 px |

**Wybór strony** (`placeBubble`, czysta funkcja w `src/ui/tutorial/layout.ts`):
1. Wejście: prostokąt celu (albo `null`), wymiary dymka zmierzone po narysowaniu, wymiary okna i miękkie „omijaj” (prostokąt otwartego arkusza, gdy cel jest w arkuszu).
2. Cel powiększony o pierścień (6 px). Kandydaci w kolejności: najpierw pion, w stronę środka ekranu (cel w górnej połowie: pod, w dolnej: nad), potem poziom, w stronę środka (lewo albo prawo).
3. Strona pasuje, gdy dymek z odstępem 12 px mieści się w oknie z marginesem 8 px i nie przecina celu. Spośród pasujących wygrywa pierwsza, która nie przecina prostokątów „omijaj”. Gdy takiej nie ma, wygrywa pierwsza pasująca.
4. Pozycja wzdłuż krawędzi: środek na środku celu, docięty do okna. Strzałka wskazuje środek celu (docięta 16 px od rogów dymka).
5. Gdy żadna strona nie pasuje: dymek przechodzi w tryb zwarty (bez tytułu, mniejsze odstępy) i liczy się jeszcze raz. Jeśli dalej nie pasuje, staje po stronie z największym miejscem, a funkcja zwraca `covers: true`. Testy i smoke traktują to jako błąd do naprawienia w treści albo we wskazaniu, a nie jako stan dopuszczalny.

**Czego się spodziewamy:**
- Telefon: elementy paska (gotówka, rachunek, zaufanie, czas, „?”) mają dymek pod spodem. Zakładki i kliker mają dymek nad sobą. Elementy w arkuszu („Ręcznie”, palety, „+”) mają dymek nad arkuszem, na tle sceny, więc treść arkusza zostaje widoczna. Cały arkusz (Ulepszenia, Cele) ma dymek nad sobą, w pasie między górnym paskiem a arkuszem.
- Desktop: to samo dla paska, zakładek i klikera. Elementy w arkuszu i cały arkusz mają dymek po lewej stronie panelu.

**Wysokie okna (karta decyzji, raport).** Na telefonie okno karty bywa wysokie na kilkaset pikseli. Na czas kroku 2 i dymków `tip-karta` i `tip-miesiac` `<html>` dostaje `data-tut-step`. Styl przesuwa wtedy dane okno do dolnej krawędzi ekranu (`align-items: end` w jego `tt-modal-wrap`), żeby nad nim zmieścił się dymek. Raport wskazujemy jego nagłówkiem („Wynik miesiąca”), a nie całym oknem. Wyglądu okien to nie zmienia, tylko ich położenie na czas dymka.

**Śledzenie.** Póki przelot albo dymek jest na ekranie, warstwa mierzy cel co klatkę (`requestAnimationFrame`, `getBoundingClientRect`) i przestawia się tylko przy zmianie o więcej niż 0,5 px. Obsługuje to obrót telefonu, przewinięcie arkusza i animacje paska.

## 11. Architektura

### 11.1 Nowe pliki (`src/ui/tutorial/`)

| Plik | Zawartość |
|---|---|
| `layout.ts` | `Rect`, `placeBubble(...)`, `blockersAround(hole, view)`. Czyste funkcje, testy w node. |
| `memory.ts` | `loadTutorial(storage?)`, `saveTutorial(mem, storage?)`, `markSeen`, walidacja. |
| `steps.ts` | Typy `TourCtx`, `TourStep`, `TourMark`, ogólne kroki, `buildTour(ctx)`. Teksty to funkcje ze stałych gry. |
| `money.ts` | `MONEY_STEPS`, `MONEY_NOTES`, `MONEY_TIPS` (§6). |
| `tips.ts` | `TIPS` (ogólne) oraz `tipFor(ctx, memory)`: pierwszy dymek do pokazania albo null. |
| `tour.ts` | Stan przelotu (sygnał `tour`), `offerTutorial()`, `requestTour()`, `nextStep()`, `skipTour()`, `finishTour()`, sprawdzanie zadań. Rejestr `controls` (prędkość) ustawiany przez komponent. |
| `Tutorial.tsx` | `TutorialOffer` (okno wyboru), `TourLayer` (przygaszenie, blokady, dymek), `TipLayer` (dymki „pierwszy raz”), wspólny `Bubble`. |
| `tutorial.css` | Style warstw, dymka, pierścienia i `data-tut-step`. |

### 11.2 Zmiany w istniejących plikach

- `src/ui/state.ts`: sygnał `tutorialOffer` (okno wyboru) w `isWindowOpen`. Usunięty mechanizm dymków pierwszego dnia (§3).
- `src/game/actions.ts`: w dwóch miejscach `ui.openHowTo()` zamienione na `ui.offerTutorial()`, który pokazuje okno tylko przy `tour === null`. Usunięte `showHints(...)` z `open` i pole `firstDayHints` z `ShellDeps`. `enterRanked` przestaje wołać `showHints([])`, ale dalej zamyka okno wyboru, gdyby było otwarte.
- `src/main.ts`: bez `FIRST_DAY_HINTS`. `blocked` w `bindControls` dostaje warunek „trwa przelot”. `onStarted` (start rankingowy) bez zmian.
- `src/ui/App.tsx`: `TutorialOffer`, `TourLayer` i `TipLayer` jako ostatnie warstwy. Bez `FirstDayHints`.
- `src/ui/howto/HowTo.tsx`: przycisk „Samouczek” w stopce.
- `src/ui/game/overlays.tsx`: w ⚙ → Pomoc przycisk „Samouczek” i pole „Podpowiedzi przy pierwszych zdarzeniach”. Atrybuty `data-tut` (niżej). Bez `FIRST_DAY_HINTS` i `FirstDayHints`.
- `src/ui/game/panels.tsx`, `src/ui/game/cards.tsx`, `src/ui/game/Hud.tsx`: wyłącznie atrybuty `data-tut`.
- `src/ui/ui.css`: usunięte `.tt-hintbubble*`.
- `README.md`: zdanie o oknie „Jak grać”, które „otwiera się samo”, zamienione na zdanie o samouczku.

### 11.3 Atrybuty `data-tut`

Wszystkie dopisane do istniejących elementów, bez zmiany klas, stylu i zachowania:

| Wartość | Element | Plik |
|---|---|---|
| `cash` | `span.tt-cash` | `Hud.tsx` (wiersz pieniędzy, tylko atrybut) |
| `due` | `div.tt-hud-row.tt-hud-due` (opakowanie `DueChip`) | `Hud.tsx` (tylko atrybut) |
| `trust` | `span.tt-trust` w `TrustChip` | `Hud.tsx` |
| `speed` | `div.tt-seg` z prędkościami | `Hud.tsx` |
| `claim` | przycisk 🎁 w `ClaimChip` | `Hud.tsx` |
| `help` | przycisk „?” | `Hud.tsx` |
| `tabs`, `tab-sklep` … `tab-cele` | `nav.tt-tabs` i przyciski zakładek | `panels.tsx` |
| `sheet` | `aside.tt-sheet` | `panels.tsx` |
| `order`, `order-auto`, `order-manual` | grupa „Kto zamawia” i jej dwa przyciski | `panels.tsx` |
| `pallets` | sekcja „Palety (N)” | `panels.tsx` (opcjonalny `tut` w `Section`) |
| `pallet-aisle` | `PalletItem` palety w przejściu | `panels.tsx` |
| `hire` | stepper w sekcji „Zmiana” | `panels.tsx` |
| `claim-btn` | przyciski „Odbierz” | `panels.tsx` |
| `clicker` | `div.tt-clicker` | `overlays.tsx` |
| `report` | nagłówek raportu (`.tt-report-head`, a w starym raporcie samo okno) | `overlays.tsx` |
| `card` | `div.tt-deck` | `cards.tsx` |

Gdy selektor pasuje do kilku elementów, warstwa bierze pierwszy widoczny (niezerowy prostokąt).

## 12. Testy i weryfikacja

**Vitest** (środowisko node, styl jak w `overlays.test.tsx` z `vnodeTree`):
- `layout.test.ts`:
  - strony dla typowych układów z §10 (pasek, zakładki, arkusz, panel desktopowy);
  - „omijaj”, strzałka docięta do rogów, tryb zwarty, `covers`;
  - właściwość: dla 500 losowych celów, gdy funkcja zwraca `covers: false`, dymek nie przecina celu i mieści się w oknie;
  - `blockersAround` pokrywa okno bez dziury.
- `memory.test.ts`: brak klucza, zły JSON, obce pola, nieznane `seen`, duplikaty, `failWrites`, magazyn, który rzuca przy odczycie.
- `steps.test.ts`:
  - `buildTour` dla czterech wariantów (karta tak/nie × Asystent/ręcznie), liczba kroków i kolejność;
  - każdy `target` ma swój `data-tut` w źródłach (test na źródłach jak `sourceLiterals.ts`);
  - zaliczenia zadań na stanach z `createEconomy`;
  - kroki [$] pochodzą z `money.ts`;
  - teksty bez zakazanych słów (istniejący test słów) i bez „WUT”.
- `tips.test.ts`: warunki z §5 na stanach z `createEconomy` (cel gotowy, paleta w przejściu, karta, raport), kolejność, `seen`, `tips: false`, brak dymków w trakcie przelotu i pod oknem wyboru.
- `tour.test.ts`:
  - start zapamiętuje prędkość i pauzuje, „Pomiń” i koniec ją przywracają, krok 16 zdejmuje pauzę;
  - pamięć `started`, `skipped`, `done`;
  - w biegu rankingowym toast i brak przelotu;
  - zadania przechodzą dalej same;
  - `offerTutorial` tylko przy `tour === null`.
- `Tutorial.test.tsx`: okno wyboru (teksty, oba przyciski), dymek (licznik, „Dalej”, „Pomiń”, wiersz zadania, „Zakończ”).
- **Test źródła:** żaden plik w `src/ui/tutorial/` nie zawiera `dispatch`.
- `actions.test.ts`: oczekiwania „Jak grać po ekranie startowym” zamienione na okno wyboru (nowy zwykły sklep tak, wczytany z zapisu nie, rankingowy nie). Bez `firstDayHints`.

**Komendy:** `npm test`, `npm run build`, `npm run check:vercel-build`.

**Smoke headless** (`scripts/tutorial-smoke.mjs`):
- Środowisko: Playwright z Chromium w kontenerze, `vite preview` na zbudowanym `dist` lokalnie w kontenerze. Wszystkie zapytania poza `localhost` są blokowane i liczone, a smoke sprawdza, że nic nie poszło do `*.vercel.app`.
- Dwa rozmiary okna: 390×844 (dotyk) i 1280×800. Na każdym:
  1. czysta pamięć → ekran startowy → „Otwieramy sklep!” → okno wyboru (zrzut) → „Samouczek” → przejście wszystkich kroków ze zrzutem każdego. Smoke klika wskazany element w zadaniach i „Dalej” w krokach informacyjnych. Przy każdym kroku sprawdza, że prostokąt dymka nie przecina prostokąta celu.
  2. Po końcu: `tour: 'done'` i czas idzie.
  3. „?” → „Jak grać” → „Samouczek” → krok 1 (zrzut) → „Pomiń”: warstwa znika, prędkość wraca.
  4. ⚙ → „Samouczek” → krok 1 (zrzut) → „Pomiń”.
  5. Nowa pamięć → „Pomiń, znam grę”: brak przelotu, `tour: 'skipped'`, czas idzie.
  6. Dymki „pierwszy raz” przez `?debug=1` i `traszkaGame.skip(...)`: pierwsza karta i koniec miesiąca (zrzuty).
  7. Start rankingowy (lokalnie, nic nie jest wysyłane): brak okna wyboru, „?” → „Samouczek” daje toast „Samouczek działa w zwykłym sklepie.”.
- Konsola: zero `console.error` i zero `pageerror`. Ostrzeżenia sterownika swiftshader są notowane, ale nie są błędem.
- Zrzuty i raport: `docs/superpowers/reports/2026-10-30-samouczek.md` i katalog `docs/superpowers/reports/2026-10-30-samouczek/`. Zrzuty są w JPEG (jakość 80), żeby repozytorium nie urosło o kilkanaście MB.

## 13. Pytania do właściciela i ryzyka

1. **Start rankingowy z ekranu startowego** nadal otwiera „Jak grać” (bez propozycji samouczka). Alternatywa: nic się nie otwiera. Proponuję zostawić „Jak grać”, bo to jedyna pomoc w biegu rankingowym.
2. **„Stuknij paletę” jako ostatnie zadanie, po zdjęciu pauzy** (§4.3). W pauzie stukanie jest dziś zablokowane i tak ma zostać.
3. **Dwa zadania z zamówieniem** (na „Ręcznie” i z powrotem), żeby przelot nie zostawił nowego gracza na ręcznym zamówieniu. Alternatywa: jedno zadanie „Ręcznie” i zostawienie tego wyboru graczowi.
4. **Usunięcie `FIRST_DAY_HINTS` z mechanizmem dymków** (zamiast zostawiania martwego kodu). Ryzyko konfliktu z SIM 6 w `state.ts` i `overlays.tsx` jest małe: zmiany są w innych miejscach tych plików.
5. **Ryzyko:** SIM 6 przebuduje wiersz pieniędzy i okna, na które wskazują `cash`, `due` i `report`. Do czasu przeniesienia atrybutów (§6) kroki [$] pokażą dymek na środku ekranu, bez strzałki. Przelot się nie zepsuje.

# Samouczek: krótki przelot po grze, dymki „pierwszy raz” i słowniczek

Status: projekt sesji `samouczek` (2026-10-30), czeka na akceptację właściciela · Gałąź: `claude/samouczek` (od `main` 14541c8, SIM 6) · Podstawa: burza mózgów z właścicielem 2026-10-30 (sesja local_8ef1db87), opis zatwierdzony słowami „Jest super, wprowadzaj”. Dopisek właściciela po wejściu SIM 6: samouczek tłumaczy nowe pojęcia SIM 6 i dostaje słowniczek.

Samouczek to wyłącznie warstwa widoku. Nie zmienia `src/sim/**`, `SIM_VERSION` (6), `GOLDEN[6]` ani `judgeBundle.js`, więc serwer rankingu odtwarza biegi tak samo jak dziś. Samouczek nigdy sam nie wywołuje `dispatch`: każde polecenie dla symulacji klika gracz.

## 1. Problem i zakres

Nowy gracz jest na starcie przytłoczony. Musi naraz zrozumieć palety, pieniądze SIM 6 (gotówka, saldo u Centrali, raty, „Zostaje Ci”, wyciąg, remanent), zaufanie Centrali, cel gry i rozwój, zakupy i ludzi, a do tego „co jest czym na tym ekranie”. Dziś dostaje okno „Jak grać” i sześć dymków `FIRST_DAY_HINTS`, które same przewijają się co 9 s. Jedno i drugie to tekst bez wskazania, gdzie co jest.

W zakresie:
- okno wyboru po ekranie startowym: „Samouczek (ok. 3 min)” albo „Pomiń, znam grę”;
- przelot po prawdziwym sklepie gracza (przygaszony ekran, wskazany element, dymek ze strzałką, kilka zadań);
- pojedyncze dymki przy pierwszym zdarzeniu danego rodzaju;
- słowniczek pojęć w oknie „Jak grać”;
- pamięć w `localStorage`, ponowne uruchomienie z „Jak grać” i z ⚙, wyłącznik dymków w ⚙.

Bez zmian wyglądu i zachowania: pasek pieniędzy w `src/ui/game/Hud.tsx` (gotówka, `ForecastChip`), `src/ui/game/statement.tsx`, `src/ui/game/monthPreview.tsx`, `src/ui/game/spend.tsx` (przyciski „za gotówkę” i „na raty”, ostrzeżenia `.tt-spend`), protokół remanentu i teksty SIM 6 w `howToText.ts`. Samouczek dopisuje tam najwyżej atrybut `data-tut`. Słowniczek to nowa, osobna sekcja okna „Jak grać” (§6), a nie zmiana tekstów SIM 6.

Opłata franczyzowa i „Do oddania Centrali” zniknęły z gry w SIM 6. Samouczek i słowniczek o nich nie mówią (pilnuje tego test, §13).

## 2. Decyzje właściciela (wiążące)

- **Styl B.** Neutralny dymek ze strzałką przy elemencie. Reszta ekranu przygasa, element dostaje spotlight i pulsujący pierścień. Dymek ma licznik kroków („3 / 16”) oraz przyciski „Dalej” i „Pomiń”. Bez postaci przewodnika. Satyrę niosą krótkie, suche zdania.
- **Nauka rozłożona w czasie.** Na start krótki przelot (ok. 3 min) z kilkoma zadaniami. Później pojedyncze dymki przy pierwszym zdarzeniu: cel do odebrania, nadmiar palet w przejściach, karta decyzji, wyciąg od Centrali, remanent.
- **Okno wyboru zastępuje** samo otwierające się „Jak grać” i sześć dymków `FIRST_DAY_HINTS`. „Jak grać” zostaje pod „?” i w ⚙.
- **Przelot w prawdziwym, pierwszym zwykłym sklepie gracza.** Czas stoi na istniejącej pauzie (`controls.setSpeed(0)`).
- **Zadania tylko darmowe i odwracalne:** otwórz zakładkę, przełącz zamówienie, stuknij paletę. Zatrudniania i ulepszeń samouczek tylko pokazuje.
- **Ranking.** Przelot działa tylko w zwykłym sklepie: przy starcie rankingowym nie ma propozycji, a uruchomiony w biegu rankingowym pokazuje komunikat „Samouczek działa w zwykłym sklepie.”. Dymki „pierwszy raz” działają także w rankingu.
- **Pamięć** w `localStorage`, z `try/catch`. Samouczek da się uruchomić ponownie z „Jak grać” i z ⚙.
- **Rogalik (później).** Nowy franczyzobiorca z generatora nie dostaje samouczka automatycznie, ale może go uruchomić.
- **Słowniczek (dopisek po SIM 6):** saldo u Centrali, przelew, wyciąg, raty, remanent, ubytki, „Zostaje Ci”, ZUS (skrót zostaje, z objaśnieniem), księgowa.

## 3. Przepływ pierwszego wejścia

```
ekran „Twój kasjer”
 ├─ „Otwieramy sklep!” → nowy zwykły sklep ──→ okno „Pierwszy dzień w Traszce” (gra czeka)
 │                                              ├─ „Samouczek (ok. 3 min)” → przelot (§4) → gra rusza
 │                                              └─ „Pomiń, znam grę”       → gra rusza od razu
 └─ „Start rankingowy” → bieg rankingowy ──────→ „Jak grać” jak dziś, bez propozycji samouczka
```

**Kiedy pojawia się okno wyboru.** Gdy gracz jeszcze nigdy nie odpowiedział na to okno (`tour === null` w pamięci, §9), a otwiera się zupełnie nowy zwykły sklep:
- w `GameShell.open` (`src/game/actions.ts`, dziś linia 956) przy `startupWindow(...).intro`, czyli nowy sklep na kreskę: 6:00, zero klientów, tryb zwykły, sklep nietymczasowy. Obejmuje to pierwsze wejście przez ekran startowy, przeładowanie strony przy otwartym oknie wyboru (sklep jest już zapisany na 6:00 bez klientów) i nowy sklep z adresu (`?new=1`). Przy `intro` okno powitalne jest zawsze puste, więc oba okna nigdy nie stoją naraz;
- w `openChosenStore` po „Nowy sklep” z ⚙, gdy sklep nie jest wczytany z zapisu (dziś linia 810).

Każde z tych miejsc woła `ui.offerTutorial()`. Funkcja sama sprawdza pamięć, więc rogalik i każdy kolejny nowy sklep tego samego gracza okna nie dostają.

**Co znika:**
- automatyczne `ui.openHowTo()` w obu miejscach wyżej (start rankingowy w `main.ts` zostaje, §14 pytanie 1). Zmienia się to też dla wyboru z ekranu startowego, który wczytuje istniejący zapis: dziś dostaje „Jak grać”, po zmianie nic (gracz wraca do swojej gry);
- `FIRST_DAY_HINTS`, komponent `FirstDayHints` i mechanizm dymków pierwszego dnia w `state.ts` (`hints`, `showHints`, `nextHint`, `HINT_MS`, `hintsHeld`, `armHint`), pole `firstDayHints` w `ShellDeps` oraz style `.tt-hintbubble*`. Testy tych elementów idą razem z nimi (`state.test.ts`, `overlays.test.tsx`, `actions.test.ts`, a `services.test.ts:57` przestaje podawać `firstDayHints`, inaczej `tsc` w `npm run build` padnie na nadmiarowym polu).

**Gracze sprzed tej zmiany** mają już metę, więc ekranu startowego nie widzą. Okno wyboru zobaczą raz, gdy otworzą zupełnie nowy sklep (⚙ → „Nowy sklep” albo nowy seed z adresu). Samouczek mogą też włączyć sami (§10).

**Okno wyboru** (`tt-modal`; dopóki jest otwarte, gra stoi, bo jego sygnał `tutorialOffer` wchodzi do `isWindowOpen`):

> **Pierwszy dzień w Traszce**
> Centrala przygotowała krótkie szkolenie: co jest na ekranie, palety, pieniądze, ludzie i rozwój. Czas w sklepie stoi, dopóki nie skończysz.
> [ Samouczek (ok. 3 min) ]  [ Pomiń, znam grę ]
> *Samouczek i słowniczek znajdziesz też pod „?”.*

- „Samouczek (ok. 3 min)” zapisuje w pamięci `tour: 'started'` i uruchamia przelot.
- „Pomiń, znam grę” zapisuje `tour: 'skipped'`, zamyka okno, a gra rusza z prędkością, jaką miała.

## 4. Przelot

### 4.1 Czas

- Na starcie przelot zapamiętuje bieżącą prędkość (`saved`) i woła `controls.setSpeed(0)`. Pod oknem wyboru czas stoi jak pod „Jak grać” (`isWindowOpen`). Sam przelot korzysta tylko z prędkości i nie wchodzi do `isWindowOpen`.
- Ostatni krok (16) zdejmuje pauzę: ustawia `saved`, a gdy było 0, ×1. Bez tego 📦 jest wyłączony (`tapBlock` w `src/ui/game/tapBlock.ts`: „Gra wstrzymana: wznów czas”). „Zakończ” i zaliczenie kroku 16 zostawiają czas w ruchu.
- „Pomiń” przed krokiem 16 przywraca `saved`. W kroku 16 czas już idzie i tak zostaje.

### 4.2 Wstrzymanie, gdy wstanie okno gry

Gdy w trakcie przelotu jest otwarte okno gry, przelot się wstrzymuje. Dotyczy to sytuacji, gdy `isWindowOpen()` jest prawdą, czeka karta decyzji (`awaitingDecision`), gra się skończyła (`gameOver`) albo są otwarte ustawienia. Przykłady: wpis „OK” po awansie z odblokowaniem, karta, która przyszła w kroku 16, gdy czas już idzie.

W tym czasie:
- warstwa przelotu znika razem z przygaszeniem i blokadami, a gracz obsługuje okno normalnie;
- pauza i numer kroku zostają;
- dymki „pierwszy raz” wskazujące to okno mogą się pokazać (§5).

Po zamknięciu okna przelot wraca do tego samego kroku. Dzięki temu warstwa nigdy nie zasłania okna, którego gracz potrzebuje, i nie ma zakleszczeń.

W nowej grze o 6:00 karta nie leży na biurku. Jedyna karta na 6:00 (`chory`) wymaga dostawy w `s.deliveries`, a ta lista jest w `createEconomy` pusta. Pomiar: 0 na 300 seedów, najwcześniejsza karta o 7:00. W kroku 16 czas idzie, więc karta o 7:00 może przyjść po ok. 10 s przy ×1. Wtedy działa wstrzymanie, a po odpowiedzi krok 16 wraca z aktywnym 📦.

### 4.3 Kliknięcia, klawiatura i fokus

- **Kliknięcia.** Ekran poza wskazanym elementem zasłaniają cztery przezroczyste prostokąty wokół „dziury”. Kliknięcia nie dochodzą ani do sceny, ani do innych przycisków.
  - W kroku informacyjnym dziurę zamyka piąty prostokąt: wskazanego przycisku nie da się nacisnąć (samouczek pokazuje „+” przy zatrudnianiu, ale nic nie kupi).
  - W kroku z zadaniem dziura jest otwarta, dopóki zadanie nie jest zaliczone, a potem się zamyka (podwójne stuknięcie w zakładkę nie zamknie jej z powrotem).
  - Pierścień ma `pointer-events: none`.
- **Klawisze gry.** W czasie przelotu skróty gry (spacja, Q/E, strzałki, X, F3…) są wyłączone: `bindControls` w `main.ts` dostaje w `blocked` także „trwa przelot”. Esc to „Pomiń”, obsługiwany w fazie przechwytywania.
- **Fokus.** Przy każdym kroku fokus idzie na główny przycisk dymka, a w kroku z zadaniem na kontener dymka (`tabindex=-1`), żeby Enter nie trafił w „Pomiń”. Tab krąży tylko po dymku i, w kroku z zadaniem, po elemencie w dziurze (pułapka fokusu w fazie przechwytywania). Nie ma globalnej obsługi Enter: działa natywnie na przycisku, który ma fokus, więc jedno naciśnięcie to jeden krok.
- **Czego samouczek wolno.** Samouczek nie wywołuje `dispatch`. Zmienia tylko stan widoku:
  - prędkość;
  - otwartą zakładkę (`tab`);
  - zaznaczenie (`selection = null`);
  - przewinięcie arkusza do wskazanego elementu (`scrollIntoView({ block: 'nearest' })`);
  - atrybut `data-tut-tip` na `<html>` (§11).

  Pilnuje tego test źródła (§13).

### 4.4 Wygląd (styl B)

- **Przygaszenie.** Pierścień wokół wskazanego elementu (prostokąt plus 6 px) ma `box-shadow: 0 0 0 9999px rgba(8, 16, 12, 0.6)` i pomarańczową obwódkę marki, która pulsuje (bez pulsu przy `prefers-reduced-motion`). Krok bez elementu przygasza cały ekran.
- **Dymek.**
  - Kremowe tło jak w kartach gry, zielony tytuł i licznik „3 / 16” po prawej, tekst 13 px, strzałka od strony elementu.
  - W krokach z zadaniem pod tekstem jest wiersz „👉 …” z tym, co zrobić. Na dole „Pomiń” (bez tła) i „Dalej” (główny).
  - W kroku z zadaniem nie ma „Dalej”. Po zaliczeniu dymek pokazuje „✓ Zrobione” i po 0,7 s przechodzi dalej sam.
  - Zadanie, którego nie da się wykonać (brak palet, brak sił, element zniknął), zamienia się w krok z „Dalej”.
  - W ostatnim kroku główny przycisk to „Zakończ” i jest zawsze.
- **Brak elementu.** Gdy wskazanego elementu nie ma albo jest w całości przewinięty poza widok (§11), krok pokazuje dymek na środku ekranu, bez strzałki i bez dziury. Przelot się nie zatrzymuje.
- **Dostępność.** Dymek przelotu ma `role="dialog"`, `aria-modal="true"` i etykietę „Samouczek, krok N z M”. Dymki „pierwszy raz” mają `role="status"`.
- **Warstwy.** Przelot leży na `z-index: 25` wewnątrz `.tt-ui`, nad oknami gry (12) i ekranem startowym (20), pod banerem nagrody (30). Konfetti (40) leży na `body`. Dymki „pierwszy raz” są na 24. Toasty i komunikaty w czasie przelotu są pod przygaszeniem. To zamierzone: przelot jest krótki, a gra stoi.

### 4.5 Kolejność kroków

Kolejność ustala się raz, na starcie przelotu, z bieżącego stanu (`buildTour(ctx)`, czysta funkcja), więc licznik „N / M” od początku zna M. Jedyny warunek to tryb zamówienia:
- **Asystent na starcie** (`s.order.auto`): kroki 8 i 9 to zadania (na „Ręcznie” i z powrotem), więc przelot zostawia ustawienie takie, jakie było.
- **Zamówienie ręczne:** zamiast nich jest jeden krok informacyjny 8*, bez namawiania do zmiany.

Razem 16 kroków (15 przy zamówieniu ręcznym).

### 4.6 Kroki i teksty

Liczby w tekstach pochodzą ze stałych gry, tak jak w `howToText.ts`: zmiana stałej zmienia tekst. Kolumna „Wskazuje” to wartość `data-tut` (§11.1); „—” to dymek na środku ekranu. Kroki i zdania oznaczone **[$]** leżą na liście pieniędzy w `src/ui/tutorial/money.ts` (§7).

| # | Id | Wskazuje | Rodzaj | Tytuł i tekst | Zadanie / zaliczenie |
|---|---|---|---|---|---|
| 1 | `cel` | — | info, zamyka zakładkę i zaznaczenie | **Witaj w Traszce.** Prowadzisz sklep Traszki na franczyzie. Cel: dojść do rangi „{finalRank()}” i nie stracić umowy z Centralą. Czas stoi, dopóki nie skończymy. | — |
| 2 | `gotowka` **[$]** | `cash` | info | **Gotówka.** Twoje pieniądze na zakupy, rekrutację i mandaty. W trakcie miesiąca rusza się mało, bo marża tu nie wpada. Od {DEBT_WARN} Centrala ostrzega, a przy {DEBT_LIMIT} kończy współpracę. | — |
| 3 | `saldo` **[$]** | `saldo` | info | **Saldo u Centrali.** Tu wpada marża ze sprzedaży i premie. Widać je, ale go nie wydasz: Centrala odda je przelewem przy zamknięciu miesiąca. | — |
| 4 | `zostanie` **[$]** | `due` | info | **Raty i „Zostanie”.** Przy zamknięciu Centrala potrąca z przelewu raty i palety, a Ty płacisz pensje, media, ZUS, VAT i księgową. Reszta to „Zostaje Ci” i wpada do gotówki. Stuknięcie w ten pasek pokaże wyciąg. | — |
| 5 | `zaufanie` **[$]** | `trust` | info | **Zaufanie Centrali.** Od 0 do 100, na start {TRUST.start}. Od niego zależą premia od obrotu i limit rat. Przy zerze na koniec miesiąca umowa się kończy. | — |
| 6 | `czas` | `speed` | info | **Czas.** ❚❚ zatrzymuje grę (także spacja), ×1–×8 przyspiesza. Doba przy ×1 trwa ok. {dayLengthText()}. Teraz czas stoi: samouczek trzyma pauzę. | — |
| 7 | `zakladki` | `tabs` | zadanie | **Zakładki.** Tu jest zarządzanie: Sklep (kolejka, półki, remanent), Palety, Ludzie, Ulepszenia i Cele. Drugie stuknięcie zamyka zakładkę. | 👉 Otwórz Palety. Zaliczone przy `tab === 'palety'`. |
| 8 | `reczne` | `order-manual` | zadanie, gdy Asystent; ustawia `tab = 'palety'` | **Zamówienie.** Domyślnie zamawia Asystent Traszki. Zwykle trochę przesadza, bo „klienci to kochają”. Ręcznie sam ustawiasz liczbę palet na jutro. | 👉 Przełącz na „Ręcznie”. Zaliczone przy `!s.order.auto`. |
| 9 | `asystent` | `order-auto` | zadanie, gdy Asystent; ustawia `tab = 'palety'` | **Zamówienie.** Teraz liczbę palet ustawiasz przyciskami − i +. Na początek zostaw to Asystentowi: liczy za Ciebie. | 👉 Wróć do „Asystent Traszki”. Zaliczone przy `s.order.auto`. |
| 8* | `zamowienie` | `order` | info, gdy ręcznie; ustawia `tab = 'palety'` | **Zamówienie.** Zamawiasz ręcznie. Gdy zechcesz, Asystent Traszki policzy za Ciebie: przełącznik jest tutaj. | — |
| 10 | `miejsca` | `pallets` | info; ustawia `tab = 'palety'` | **Gdzie stoją palety.** Pod sklepem grozi mandat Straży Miejskiej. Zaplecze jest bezpieczne, ale małe. W sali i w przejściach palety przeszkadzają klientom, a ⭐ reputacja spada. {MONEY_NOTES.palety} | — |
| 11 | `ludzie` | `hire` | info; ustawia `tab = 'ludzie'` | **Ludzie.** „+” zatrudnia, „−” zwalnia. {MONEY_NOTES.ludzie} Niżej ustawiasz, czym ludzie zajmują się najpierw. Samouczek niczego tu nie kupi. | — |
| 12 | `ulepszenia` | `buy` | info; ustawia `tab = 'ulepszenia'` | **Ulepszenia.** Sprzęt do slotów, szkolenia i remont, który powiększa sklep. {MONEY_NOTES.ulepszenia} | — |
| 13 | `cele` | `sheet` | info; ustawia `tab = 'cele'` | **Cele i rozwój.** Cel tygodnia od Centrali daje XP i {MONEY_NOTES.kpi}. Poziomy odblokowują sprzęt i remonty. Kamienie milowe dają Ogonki 🦎: „Odbierz”. Po {PRESTIGE_REMONT}. remoncie albo na {PRESTIGE_LEVEL}. poziomie otworzysz kolejną Traszkę. | — |
| 14 | `karta` | — | info | **Karty decyzji.** Codziennie może przyjść karta: sprawa od Centrali albo od życia. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest zaznaczona. | — |
| 15 | `pomoc` | `help` | info; zamyka zakładkę | **Pomoc.** Pod „?” jest instrukcja, słowniczek (saldo, wyciąg, raty, remanent…) i ten samouczek. Przy pierwszych zdarzeniach podpowiemy jeszcze krótko. | — |
| 16 | `start` | `clicker` | zadanie; zamyka zakładkę i zaznaczenie, zdejmuje pauzę (§4.1) | **Czas rusza.** Twoje ręce: 📦 rozładowuje najpilniejszą paletę, 🧾 obsługuje klienta, gdy kasa się korkuje. Każde stuknięcie zjada siły z paska nad przyciskami. | 👉 Stuknij 📦. Zaliczone, gdy `s.total.taps` wzrośnie względem wejścia w krok. „Zakończ” jest zawsze. |

Ustalenia do tabeli:
- **Numeracja.** Tabela numeruje wariant z Asystentem (16 kroków). Przy zamówieniu ręcznym jeden krok 8* zastępuje 8 i 9, a licznik numeruje 15 kroków po kolei.
- **Liczby.** `finalRank()` i `dayLengthText()` pochodzą z `howToText.ts`.
- **Próg kolejnej Traszki.** `PRESTIGE_LEVEL` (20) i `PRESTIGE_REMONT` (2) to dziś liczby wpisane w `prestigeReady` (`src/game/meta.ts`, warstwa gry: nie ma go w bundlu sędziego ani na serwerze). Wynosimy je do nazwanych stałych w tym samym pliku, bez zmiany wartości.
- **Krok 16** jest wykonalny, gdy 📦 jest aktywny: palety są, siły są, czas idzie, nie czeka karta (`tapBlock` i `s.pallets.length > 0`). Inaczej zostaje sam „Zakończ”. Karta, która przyjdzie w tym kroku, wstrzymuje przelot (§4.2). W nowej grze o 6:00 pod sklepem stoją dwie palety, a siły są pełne.
- **Zaliczenia zadań** to czyste funkcje `done(ctx, mark)`, gdzie `mark` to migawka z wejścia w krok (np. `taps`). Sprawdzają się przy każdej publikacji stanu (co 200 ms) i przy zmianie zakładki.

### 4.7 Koniec przelotu

- **„Zakończ” albo zaliczony krok 16:** pamięć `tour: 'done'`, warstwa znika, czas idzie.
- **„Pomiń”:** pamięć `tour: 'skipped'` (gdy wcześniej było `'done'`, zostaje `'done'`). Warstwa znika, prędkość jak w §4.1, zakładka się zamyka.
- **Przeładowanie strony w trakcie** kończy przelot bez śladu, bo stan przelotu się nie zapisuje. W pamięci zostaje `'started'`, więc okno wyboru już nie wraca. Samouczek da się włączyć z „?”.

## 5. Dymki „pierwszy raz”

Zasady:
- Każdy dymek wyskakuje najwyżej raz na przeglądarkę (`seen`, §9). Wszystkie wyłącza pole w ⚙ „Podpowiedzi przy pierwszych zdarzeniach”.
- Działają w zwykłej grze i w biegu rankingowym, bo tylko coś pokazują.
- Nie przygaszają ekranu i nie zatrzymują gry. Mają pulsujący pierścień na elemencie, dymek ze strzałką i „OK”.
- Naraz widać najwyżej jeden. Nie pokazują się pod oknem wyboru ani przy widocznej warstwie przelotu. Przy przelocie wstrzymanym oknem gry (§4.2) mogą się pokazać dymki wskazujące to okno.
- **Kolejność.** `tipsFor(ctx, memory)` (czysta funkcja) zwraca listę dymków, których warunek jest spełniony, w kolejności z tabeli. Warstwa bierze pierwszy, którego element jest na ekranie. Dymek czekający na element nie blokuje następnych.
- **Dymki „w oknie”** (karta, wyciąg, remanent) wskazują samo okno i pokazują się nad nim. Pozostałe wymagają, żeby nic ich nie zasłaniało: `isWindowOpen()`, ustawienia, czekająca karta i `gameOver` muszą być fałszem. Dodatkowo warstwa sprawdza `elementFromPoint` w środku elementu (z pominięciem własnych warstw).
- **Znikanie.** Dymek znika po „OK” albo gdy zdarzenie się rozwiąże (cel odebrany, przejścia puste, karta odpowiedziana, okno zamknięte). W obu przypadkach trafia do `seen`.
- **Bez przewijania.** Dymki nie przewijają arkusza. Gdy element jest przewinięty poza widok, dymek wskazuje element zastępczy z tabeli albo czeka.

| Id | Warunek wyzwolenia (ze stanu) | Wskazuje | Tekst | Znika, gdy |
|---|---|---|---|---|
| `tip-cel` | `s.milestonesReady.length > 0` | zakładka Cele zamknięta: `claim` (🎁 w pasku); otwarta: `claim-btn` (pierwsze „Odbierz”), a gdy jest przewinięte, `tab-cele` | zamknięta: „Cel spełniony. Nagroda nie przyjdzie sama: stuknij 🎁.” · otwarta: „Tu „Odbierz”. Centrala lubi, jak się o coś prosi.” | `milestonesReady` puste albo „OK” |
| `tip-przejscia` | `s.pallets.some(p => p.loc === 'aisle')` | zakładka Palety zamknięta: `tab-palety`; otwarta: `pallet-aisle`, a gdy jest przewinięte, `tab-palety` | zamknięta: „Zabrakło miejsc: palety stoją w przejściach, a klienci się o nie potykają. Zajrzyj do Palet.” · otwarta: „Rozładuj ją albo przenieś na wolne miejsce. Na przyszłość: mniej palet w zamówieniu.” | brak palet w przejściach albo „OK” |
| `tip-karta` (w oknie) | okno karty jest na ekranie (ten sam warunek co `CardDesk`: widoczna karta, brak raportu, protokołu, wpisu „OK” i `gameOver`) i `s.history.length === 0` (pierwszy miesiąc gry) | `card` | „Karta decyzji. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest już zaznaczona.” | brak widocznej karty albo „OK” |
| `tip-wyciag` **[$]** (w oknie) | `report.value?.statement` i nie `gameOver` | `zostaje-ci` (wiersz „Zostaje Ci”), a gdy jest przewinięty, `report` (tytuł okna) | „Wyciąg od Centrali. Przelew (marża, premie) minus potrącenia (raty, palety) minus Twoje koszty daje „Zostaje Ci”: tyle właśnie wpadło do gotówki. Słowniczek: „?”.” | okno zamknięte albo „OK” |
| `tip-remanent` **[$]** (w oknie) | `remanent.value !== null` | `remanent-verdict` (zdanie o nadwyżce) | „Remanent. Co {REMANENT.everyMonths} miesiące Centrala liczy ubytki: przeterminowany towar, kradzieże, pomyłki. Ponad limit płacisz Ty, z dzisiejszego przelewu.” | okno zamknięte albo „OK” |

Uwagi:
- **`tip-karta`** pokaże się przy pierwszej prawdziwej karcie, zwykle tuż po przelocie: karta o 7:00 albo później. Warunek „pierwszy miesiąc” chroni gracza, który gra od tygodni, przed dymkiem przy setnej karcie.
- **Gracze sprzed tej zmiany.** Warunki biorą się ze stanu gry, więc dostaną tylko to, czego jeszcze nie przeżyli. Wyjątki są dwa:
  - `tip-wyciag` i `tip-remanent` pokażą się im raz, przy pierwszym wyciągu i pierwszym remanencie w SIM 6. To nowe mechaniki, więc to zamierzone;
  - `tip-przejscia` (mechanika z SIM 5) też może się im przydać.

## 6. Słowniczek

Nowa, zwijana sekcja „Słowniczek” na końcu okna „Jak grać”, pod szczegółami SIM 6. Dane w `src/ui/howto/glossary.ts` (funkcja `glossary()` zwraca listę `{ term, text }`, liczby ze stałych gry). `HowTo.tsx` rysuje je jako listę definicji (`<dl>`). Treść:

| Hasło | Objaśnienie |
|---|---|
| **Saldo u Centrali** | Marża ze sprzedaży i premie naliczone w tym miesiącu. Widać je na pasku, ale nie da się go wydać: przychodzi przelewem przy zamknięciu miesiąca. |
| **Przelew** | To, co Centrala przelewa Ci przy zamknięciu miesiąca: marża, premie, a przez pierwsze {GUARANTEE.months} miesiące dopłata z gwarancji do {GUARANTEE.income}. Z przelewu schodzą potrącenia i Twoje koszty. |
| **Wyciąg** | Rozliczenie miesiąca od Centrali: przelew, potrącenia (raty, palety, remanent), Twoje koszty i „Zostaje Ci”. Przychodzi przy zamknięciu miesiąca. Prognozę pokazuje stuknięcie w pasek pod gotówką. |
| **Raty** | Ulepszenie, sprzęt albo remont od razu, a zapłata w {3, 6 albo 12} ratach z opłatą {4%, 8% albo 15%}. Centrala potrąca ratę z każdego przelewu. Limit rat zależy od zaufania. Za gotówkę zawsze taniej. |
| **Remanent** | Liczenie towaru co {REMANENT.everyMonths} miesiące, ostatniego dnia miesiąca o {5:00}. Ubytki ponad limit Centrali schodzą z przelewu tego samego dnia. |
| **Ubytki** | Przeterminowany towar, kradzieże, „zapomniane” skany, pomyłki i skutki decyzji dnia. Nie widać ich na bieżąco: rachunek przychodzi przy remanencie. Część pokrywa Centrala, a limit poda przy pierwszym remanencie. |
| **„Zostaje Ci”** | Przelew minus potrącenia minus Twoje koszty. Ta kwota, także ujemna, wpada do gotówki przy zamknięciu miesiąca. Na pasku jej szacunek to „Zostanie”. |
| **ZUS** | Zakład Ubezpieczeń Społecznych. Twoje składki jako przedsiębiorcy: {OWN_COSTS.zus} miesięcznie, płatne przy zamknięciu miesiąca, także w słabym miesiącu. |
| **Księgowa** | Prowadzi Twoje papiery za {OWN_COSTS.accounting} miesięcznie. Liczy, ile jesteś winien wszystkim innym. |

Ustalenia:
- **Liczby** pochodzą ze stałych `GUARANTEE`, `INSTALLMENTS`, `REMANENT` i `OWN_COSTS` (`src/sim/economy/catalog.ts`, tylko odczyt).
- **Limit ubytków.** Słowniczek nie zdradza go przed pierwszym remanentem, tak jak panel Sklep („Centrala poda przy remanencie”).
- **Słowa zakazane.** Test słowniczka sprawdza, że każde hasło z listy właściciela jest na miejscu, ZUS ma rozwinięcie, a teksty nie zawierają „opłata franczyzowa”, „do oddania” ani procentu limitu ubytków.
- **Odesłania.** Krok 15 i `tip-wyciag` odsyłają do słowniczka.

## 7. Lista pieniędzy (`src/ui/tutorial/money.ts`)

Wszystko, co przelot i dymki mówią o pieniądzach, zaufaniu Centrali i ratach, leży w jednym pliku. Przy następnej zmianie ekonomii da się go przepisać bez dotykania silnika i reszty kroków:
- **`MONEY_STEPS`:** kroki 2–5 (`gotowka`, `saldo`, `zostanie`, `zaufanie`); `buildTour` wstawia je po kroku 1;
- **`MONEY_NOTES`:**
  - `palety`: „Nadmiar towaru się przeterminuje, a rachunek przyjdzie przy remanencie.”;
  - `ludzie`: „Rekrutacja to {HIRE_COST} zł z gotówki, a każda osoba na zmianie kosztuje {WAGE_PER_DAY} zł dziennie, płatne przy zamknięciu miesiąca.”;
  - `ulepszenia`: „Płacisz gotówką albo na raty: Centrala potrąci je z kolejnych przelewów. Za gotówkę zawsze taniej.”;
  - `kpi`: „premię na saldo i zaufanie Centrali”;
- **`MONEY_TIPS`:** `tip-wyciag` i `tip-remanent`.

Po wejściu SIM 6 lista jest już napisana pod trzy kieszenie, więc po scaleniu nie ma kroków o pieniądzach do poprawy. Raport końcowy wymieni ten plik jako miejsce zmian przy kolejnej wersji ekonomii.

## 8. Ranking

- Okno wyboru nigdy nie pojawia się przy starcie rankingowym. `openChosenStore` dla rankingu kończy się, zanim do niego dojdzie, a `startupWindow` w biegu rankingowym nie daje `intro`.
- „Samouczek” z „Jak grać” albo z ⚙ w biegu rankingowym (`ranked.value !== null`) zamyka to okno i pokazuje tylko toast „Samouczek działa w zwykłym sklepie.”. Okno trzeba zamknąć najpierw, bo toast leży pod jego tłem.
- Dymki „pierwszy raz” działają w biegu rankingowym: niczego nie wysyłają i nie zmieniają stanu gry.
- Przelot nie wywołuje `dispatch` i nie zmienia `src/sim/**`. Dziennik zwykłego biegu po przelocie ma tylko polecenia kliknięte przez gracza (`setOrder`, stuknięcie), jak bez samouczka.
- Smoke blokuje wszystkie zapytania poza `localhost` i niczego nie wysyła do `/api/runs` (§13).

## 9. Pamięć w `localStorage`

- **Klucz i wartość.** Klucz `traszka:tutorial`, wartość `{"v":1,"tour":null|"started"|"skipped"|"done","seen":["tip-cel",…],"tips":true}`.
- **Odczyt i zapis** są w `try/catch`. Brak klucza, zły JSON, obce pola albo błąd przeglądarki dają wartości domyślne `{ v: 1, tour: null, seen: [], tips: true }`. Błąd zapisu jest cichy: gra działa dalej, a okno wyboru może się pokazać jeszcze raz.
- **`seen`** przyjmuje tylko znane identyfikatory dymków, bez powtórzeń.
- **Zasięg.** Pamięć jest wspólna dla przeglądarki. Nie wchodzi do zapisu sklepu ani do mety, więc nie trafia do pakietu kodu odzyskiwania (ten ma jawną listę kluczy) i nie zmienia formatu zapisu.
- **Testowalność.** `memory.ts` przy każdym wywołaniu czyta `globalThis.localStorage` (testy podmieniają go na `MemoryStorage` z `src/game/memoryStorage.ts`, także z `failWrites`). Nie importuje niczego z `state.ts`.

## 10. Ponowne uruchomienie

- **„?” → „Jak grać”:** w stopce obok „Zaczynamy” dochodzi przycisk „Samouczek”. Zamyka okno i uruchamia przelot od kroku 1.
- **⚙ → Pomoc:** obok „Jak grać” dochodzi przycisk „Samouczek” (zamyka ustawienia i uruchamia przelot) oraz pole „Podpowiedzi przy pierwszych zdarzeniach” (`tips`).
- **W biegu rankingowym** oba przyciski dają toast z §8.
- **Po końcu współpracy** (`gameOver`) przelot nie rusza. Okno końca gry i tak zasłania „?” i ⚙.
- **W sklepie tymczasowym** (`ephemeral`) przelot działa normalnie.
- **W środku gry** kroki układają się z bieżącego stanu (§4.5). Zadanie ze stukaniem bez palet albo bez sił zamienia się w krok informacyjny.
- **Prędkość** działa jak w §4.1, także po „Nowy sklep” z ⚙, gdzie prędkość poprzedniego sklepu przechodzi dalej (0, ×1 albo ×8).
- **Rogalik:** nowy franczyzobiorca z generatora ma już `tour !== null`, więc okna wyboru nie dostaje. Włączy samouczek tak jak wyżej.

## 11. Układ na 390 px i na desktopie

**Geometria dziś** (ze stylów `ui.css`):

| | 390×844 (telefon) | 1280×800 (desktop) |
|---|---|---|
| pasek górny | 3 wiersze, ok. 112 px | 1 wiersz, ok. 52 px (od 820 px) |
| zakładki | dół, 60 px | dół, 60 px |
| arkusz zakładki | od dołu nad zakładkami, do 62vh (ok. 523 px), górna krawędź ok. 261 px | panel z prawej (od 900 px), 390 px, od ok. 64 do ok. 728 px |
| kliker | prawy dolny róg nad zakładkami | jak na telefonie |
| szerokość dymka | `min(340px, 100vw − 24px)` | 360 px |

**Prostokąt celu.** Prostokąt elementu jest przycinany do jego przewijanych przodków (np. `.tt-sheet-body`). Element przycięty w całości traktujemy jak nieobecny. Przelot najpierw przewija arkusz do celu (`scrollIntoView({ block: 'nearest' })`), a dopiero potem mierzy.

**Wybór strony** (`placeBubble`, czysta funkcja w `src/ui/tutorial/layout.ts`):
1. Wejście: prostokąt celu (albo `null`), wymiary dymka zmierzone po narysowaniu, wymiary okna i opcjonalny kontener (prostokąt otwartego arkusza, gdy cel leży w nim).
2. Kotwica:
   - cel w kontenerze: kotwicą jest kontener, więc dymek staje nad arkuszem albo obok panelu i nie zasłania treści arkusza, a strzałka wskazuje cel w poprzek odstępu;
   - inaczej: kotwicą jest cel powiększony o pierścień (6 px).
3. Kandydaci to wszystkie cztery strony kotwicy: najpierw pion w stronę środka ekranu, potem pion przeciwny, potem poziom w stronę środka, potem poziom przeciwny.
4. Strona pasuje, gdy dymek z odstępem 12 px mieści się w oknie z marginesem 8 px i nie przecina ani celu, ani kontenera. Wygrywa pierwsza pasująca.
5. Pozycja wzdłuż krawędzi: środek dymka na środku celu, docięty do okna. Strzałka celuje w środek celu, docięta 16 px od rogów dymka.
6. Gdy żadna strona nie pasuje, dymek przechodzi w tryb zwarty (bez tytułu, mniejsze odstępy) i liczy się jeszcze raz. Jeśli dalej nic nie pasuje, staje po stronie z największym miejscem bez warunku kontenera (ale wciąż poza celem). Jeśli i to się nie da, funkcja zwraca `covers: true`. Smoke traktuje `covers` w przelocie jako błąd do naprawy w treści albo we wskazaniu.

**Czego się spodziewamy:**
- **Telefon:**
  - pod elementem: gotówka, saldo, pasek pieniędzy, zaufanie, czas, „?”;
  - nad elementem: zakładki i kliker;
  - nad arkuszem, na tle sceny: elementy w arkuszu („Ręcznie”, palety, „+”, „na raty”) i cały arkusz (Cele), w pasie między górnym paskiem a arkuszem.
- **Desktop:** to samo dla paska, zakładek i klikera. Elementy w panelu i cały panel mają dymek po lewej stronie panelu.

**Wysokie okna w dymkach „pierwszy raz”.** Kotwica nie musi być całym oknem:
- **Karta (`tip-karta`).** Na telefonie okno karty stoi przy dolnej krawędzi i ma do 88dvh. Na czas dymka `<html>` dostaje `data-tut-tip="card"`, a styl zmniejsza `max-height` karty na wąskim ekranie do 60dvh (karta przewija się w środku). Nad kartą zostaje miejsce na dymek. Zmienia się tylko wysokość okna, przyciski i treść zostają.
- **Wyciąg (`tip-wyciag`).** Kotwicą jest wiersz „Zostaje Ci”. Dymek może zasłonić inne wiersze wyciągu, ale nigdy ten wiersz. Okna nie przesuwamy, bo wyciąg ma prawie pełną wysokość i sam się przewija.
- **Remanent (`tip-remanent`).** Protokół jest krótki, więc kotwicą jest zdanie o nadwyżce.

**Poza zakresem pomiaru:** telefon poziomo (nad pełnoszerokim arkuszem zostaje ok. 88 px, więc dymek może przejść w tryb zwarty albo zasłonić). Smoke mierzy 390×844 i 1280×800.

**Śledzenie.** Póki przelot albo dymek jest na ekranie, warstwa mierzy cel co klatkę (`requestAnimationFrame`) i przestawia się tylko przy zmianie o więcej niż 0,5 px. Obsługuje to obrót telefonu, przewinięcie arkusza i animacje paska.

### 11.1 Atrybuty `data-tut`

Wszystkie dopisane do istniejących elementów, bez zmiany klas, stylu i zachowania:

| Wartość | Element | Plik |
|---|---|---|
| `cash` | `span.tt-cash` | `Hud.tsx` (tylko atrybut) |
| `due` | `div.tt-hud-row.tt-hud-due` (opakowanie `ForecastChip`) | `Hud.tsx` (tylko atrybut) |
| `saldo` | pierwsza `span.tt-due-part` w `ForecastChip` | `Hud.tsx` (tylko atrybut) |
| `trust` | `span.tt-trust` w `TrustChip` | `Hud.tsx` |
| `speed` | `div.tt-seg` z prędkościami | `Hud.tsx` |
| `claim` | przycisk 🎁 w `ClaimChip` | `Hud.tsx` |
| `help` | przycisk „?” | `Hud.tsx` |
| `tabs`, `tab-sklep` … `tab-cele` | `nav.tt-tabs` i przyciski zakładek | `panels.tsx` |
| `sheet` | `aside.tt-sheet` | `panels.tsx` |
| `order`, `order-auto`, `order-manual` | grupa „Kto zamawia” i jej dwa przyciski | `panels.tsx` |
| `pallets` | sekcja „Palety (N)” (opcjonalne `tut` w `Section`) | `panels.tsx` |
| `pallet-aisle` | `PalletItem` palety w przejściu | `panels.tsx` |
| `hire` | stepper w sekcji „Zmiana” | `panels.tsx` |
| `claim-btn` | przyciski „Odbierz” | `panels.tsx` |
| `buy` | `div.tt-buys` (para „za gotówkę” / „na raty”) | `spend.tsx` (tylko atrybut) |
| `clicker` | `div.tt-clicker` | `overlays.tsx` |
| `report` | tytuł okna raportu (`h2`) | `overlays.tsx` |
| `remanent-verdict` | `p.tt-remanent-verdict` | `overlays.tsx` (tylko atrybut) |
| `zostaje-ci` | `div.tt-st-net` | `statement.tsx` (tylko atrybut) |
| `card` | `div.tt-deck` | `cards.tsx` |

Gdy selektor pasuje do kilku elementów, warstwa bierze pierwszy widoczny po przycięciu (§11). Dla `buy` to pierwsza para przycisków w Ulepszeniach (pierwszy sprzęt do slotów).

## 12. Architektura

### 12.1 Nowe pliki

| Plik | Zawartość |
|---|---|
| `src/ui/tutorial/layout.ts` | `Rect`, `clipToAncestors` (na prostokątach), `placeBubble(...)`, `blockersAround(hole, view)`. Czyste funkcje, testy w node. |
| `src/ui/tutorial/memory.ts` | `loadTutorial()`, `saveTutorial()`, `markSeen()`, walidacja. |
| `src/ui/tutorial/steps.ts` | Typy `TourCtx`, `TourStep`, `TourMark`, ogólne kroki, `buildTour(ctx)`. Teksty to funkcje ze stałych gry. |
| `src/ui/tutorial/money.ts` | `MONEY_STEPS`, `MONEY_NOTES`, `MONEY_TIPS` (§7). |
| `src/ui/tutorial/tips.ts` | `TIPS` (ogólne) i `tipsFor(ctx, memory)`. |
| `src/ui/tutorial/tour.ts` | Stan przelotu (sygnał `tour`), `requestTour()`, `nextStep()`, `skipTour()`, `finishTour()`, wstrzymanie (§4.2), sprawdzanie zadań, rejestr `controls`. Bez `document`: wszystko, co dotyka DOM, siedzi w efektach komponentów. |
| `src/ui/tutorial/Tutorial.tsx` | `TutorialOffer` i `Bubble`: komponenty bez haków, testowalne `vnodeTree`. `TourLayer` i `TipLayer`: pomiar, rAF, fokus, `scrollIntoView`, `data-tut-tip`. |
| `src/ui/tutorial/tutorial.css` | Style warstw, dymka, pierścienia i `data-tut-tip`. |
| `src/ui/howto/glossary.ts` | `glossary()` (§6). |
| `scripts/tutorial-smoke.mjs` | Smoke (§13). Playwright ładowany przez `createRequire` z globalnej instalacji (`/opt/node-tools`), bo nie ma go w `package.json`. |

### 12.2 Zmiany w istniejących plikach

- **`src/ui/state.ts`:**
  - sygnał `tutorialOffer` w `isWindowOpen`;
  - `offerTutorial()`, które importuje tylko `tutorial/memory.ts`, więc nie ma cyklu importów;
  - bez mechanizmu dymków pierwszego dnia (§3).
- **`src/game/actions.ts`:**
  - w `open`: `ui.offerTutorial()` przy `start.intro`, zamiast `showHints` i `if (choice) ui.openHowTo()`;
  - w `openChosenStore`: `ui.offerTutorial()` zamiast `ui.openHowTo()`;
  - bez `firstDayHints` w `ShellDeps`;
  - `enterRanked` zamyka okno wyboru zamiast wołać `showHints([])`.
- **`src/game/meta.ts`:** stałe `PRESTIGE_LEVEL` i `PRESTIGE_REMONT` w `prestigeReady`, wartości bez zmian.
- **`src/main.ts`:**
  - bez `FIRST_DAY_HINTS`;
  - `blocked` w `bindControls` z warunkiem „trwa przelot”;
  - `onStarted` (start rankingowy) bez zmian.
- **`src/ui/App.tsx`:** `TutorialOffer`, `TourLayer` i `TipLayer` jako ostatnie warstwy, bez `FirstDayHints`.
- **`src/ui/howto/HowTo.tsx`:** przycisk „Samouczek” w stopce i sekcja „Słowniczek”.
- **`src/ui/game/overlays.tsx`:**
  - w ⚙ → Pomoc przycisk „Samouczek” i pole „Podpowiedzi przy pierwszych zdarzeniach”;
  - atrybuty `data-tut`;
  - bez `FIRST_DAY_HINTS` i `FirstDayHints`.
- **Tylko atrybuty `data-tut`:** `src/ui/game/panels.tsx`, `cards.tsx`, `Hud.tsx`, `spend.tsx`, `statement.tsx`.
- **`src/ui/ui.css`:** bez `.tt-hintbubble*`.
- **`README.md`:** zdanie o „Jak grać”, które „otwiera się samo”, zastąpione zdaniem o samouczku i słowniczku.
- **Testy, które się zmienią:**
  - `actions.test.ts`: okno wyboru zamiast „Jak grać”;
  - `state.test.ts` i `overlays.test.tsx`: bez dymków pierwszego dnia;
  - `services.test.ts:57`: bez `firstDayHints`;
  - `HowTo.test.tsx:84,123,149`: przyciski stopki to teraz „Samouczek” i „Zaczynamy”.

## 13. Testy i weryfikacja

**Vitest** (środowisko node, styl jak w `overlays.test.tsx` z `vnodeTree`):
- **`layout.test.ts`:**
  - strony dla układów z §11: pasek, zakładki, cel w arkuszu telefonu (dymek nad arkuszem), cel w panelu desktopu (dymek po lewej panelu), cały arkusz;
  - wszystkie cztery strony;
  - tryb zwarty i `covers`;
  - strzałka docięta do rogów;
  - przycinanie do przodków;
  - właściwość: dla 500 losowych celów przy `covers: false` dymek nie przecina celu i mieści się w oknie;
  - `blockersAround` pokrywa okno bez dziury.
- **`memory.test.ts`:** brak klucza, zły JSON, obce pola, nieznane `seen`, duplikaty, `failWrites`, magazyn, który rzuca przy odczycie.
- **`steps.test.ts`:**
  - `buildTour` dla Asystenta i zamówienia ręcznego (liczba i kolejność kroków);
  - każdy cel ma swój `data-tut` w źródłach (test na źródłach jak `sourceLiterals.ts`);
  - zaliczenia zadań na stanach z `createEconomy`;
  - kroki i zdania [$] pochodzą z `money.ts`.
- **`tips.test.ts`:**
  - warunki z §5 na stanach z `createEconomy`: cel gotowy, paleta w przejściu, karta po przewinięciu minut do jej `showAt`, raport z wyciągiem, protokół remanentu;
  - kolejność, `seen`, `tips: false`;
  - brak dymków przy widocznej warstwie przelotu i pod oknem wyboru.
- **`tour.test.ts`:**
  - start zapamiętuje prędkość i pauzuje, „Pomiń” przywraca `saved`, krok 16 ustawia `saved` albo ×1, a koniec ją zostawia;
  - pamięć `started`, `skipped`, `done`;
  - w biegu rankingowym toast i brak przelotu;
  - wstrzymanie przy oknie gry i powrót do tego samego kroku;
  - zadania przechodzą dalej same.
- **`state.test.ts`:** `offerTutorial` tylko przy `tour === null`, sygnał w `isWindowOpen`.
- **`Tutorial.test.tsx`:** okno wyboru (teksty, oba przyciski), `Bubble` (licznik, „Dalej”, „Pomiń”, wiersz zadania, „Zakończ”, brak „Dalej” w zadaniu).
- **`glossary.test.ts`:** wszystkie hasła właściciela, rozwinięcie ZUS, brak „opłata franczyzowa”, „do oddania” i procentu limitu ubytków.
- **Test źródła:** żaden plik w `src/ui/tutorial/` nie zawiera `dispatch` ani `document.` poza `Tutorial.tsx`.
- **Słowa zakazane:** istniejący `noWut.test.ts` skanuje całe `src/ui`, więc obejmuje nowe pliki. Do tego test: teksty samouczka i dymków nie zawierają „opłat franczyzow” ani „do oddania”.
- **`actions.test.ts`:**
  - nowy zwykły sklep daje okno wyboru;
  - sklep wczytany z zapisu go nie daje;
  - start rankingowy go nie daje;
  - okno nie pojawia się przy `tour !== null`;
  - przeładowanie przy otwartym oknie (sklep na 6:00 bez klientów) daje je znowu.

`TourLayer` i `TipLayer` (pomiar, rAF, fokus) sprawdza smoke, bo node nie ma DOM.

**Komendy:** `npm test`, `npm run build`, `npm run check:vercel-build`. Na `main` 14541c8 w tym kontenerze pada już jeden test sim: `src/sim/economy/exactMath.test.ts` (`n ** 1.4` różni się na ostatnim bicie w Node 22.22). Nie ruszamy go, bo to symulacja. Raport poda wynik z tym jednym wyjątkiem.

**Smoke headless** (`scripts/tutorial-smoke.mjs`):
- **Środowisko:** Playwright z Chromium (WebGL2 działa w kontenerze) i `vite preview` na zbudowanym `dist`, lokalnie. Wszystkie zapytania poza `localhost` są blokowane i liczone, a smoke sprawdza, że nic nie poszło do `*.vercel.app` ani do `/api/runs`.
- **Rozmiary okna:** 390×844 (dotyk) i 1280×800. Każdy scenariusz z czystym kontekstem przeglądarki.
- **Scenariusze, na każdym rozmiarze:**
  1. Ekran startowy → „Otwieramy sklep!” → okno wyboru (zrzut) → „Samouczek” → wszystkie kroki ze zrzutem każdego. Smoke klika wskazany element w zadaniach, a w krokach informacyjnych „Dalej”. Przy każdym kroku sprawdza, że prostokąt dymka nie przecina prostokąta celu i że nie ma `covers`. W kroku 16, gdy przyjdzie karta, smoke klika „Zatwierdź” i wraca do kroku.
  2. Po końcu: `tour: 'done'`, czas idzie, warstwa zniknęła.
  3. „?” → „Jak grać” → „Samouczek” → krok 1 (zrzut) → „Pomiń”: warstwa znika, prędkość wraca.
  4. ⚙ → „Samouczek” → krok 1 (zrzut) → „Pomiń”.
  5. Nowy kontekst → „Pomiń, znam grę”: brak przelotu, `tour: 'skipped'`, czas idzie.
  6. Dymki „pierwszy raz” przez `?debug=1` i `traszkaGame.skip(...)`. Pierwsza karta (zrzut `tip-karta`), potem przewijanie do końca miesiąca w pętli z odpowiedzią na każdą kartę (`skip` staje na kartach) i zrzut `tip-wyciag`.
  7. Start rankingowy (lokalny, nic nie jest wysyłane): brak okna wyboru, „?” → „Samouczek” daje toast „Samouczek działa w zwykłym sklepie.”.
  8. „?” → „Jak grać” → rozwinięty „Słowniczek” (zrzut).
- **Konsola:** zero `console.error` i zero `pageerror`. Ostrzeżenia sterownika swiftshader są notowane, ale nie są błędem.
- **Zrzuty i raport:** `docs/superpowers/reports/2026-10-30-samouczek.md` i katalog `docs/superpowers/reports/2026-10-30-samouczek/`. Zrzuty w JPEG (jakość 80), żeby repozytorium nie urosło o kilkanaście MB.

## 14. Pytania do właściciela i ryzyka

1. **Start rankingowy z ekranu startowego** nadal otwiera „Jak grać”, bez propozycji samouczka. Alternatywa: nic się nie otwiera. Proponuję zostawić „Jak grać”, bo to jedyna pomoc w biegu rankingowym.
2. **„Stuknij 📦” jest ostatnim zadaniem, po zdjęciu pauzy** (§4.1). W pauzie przyciski stukania są dziś wyłączone i tak zostaje. Stukanie w paletę w scenie 3D działa w pauzie także dziś, ale przelot zasłania scenę.
3. **Dwa zadania z zamówieniem** (na „Ręcznie” i z powrotem), żeby przelot nie zostawił nowego gracza na ręcznym zamówieniu. Alternatywa: jedno zadanie „Ręcznie” i wybór dla gracza.
4. **Usunięcie `FIRST_DAY_HINTS` razem z mechanizmem dymków**, zamiast zostawiać martwy kod.
5. **Słowniczek jako sekcja „Jak grać”** z dziewięcioma hasłami z §6. Rozumiem dopisek „dotłumacz nowe teksty” jako „wytłumacz graczowi pojęcia SIM 6”, a nie przekład na inny język. W repozytorium nie ma warstwy tłumaczeń.
6. **Ryzyko:** przyszła zmiana paska pieniędzy albo wyciągu może przenieść elementy z `data-tut`. Wtedy kroki [$] pokażą dymek na środku ekranu, bez strzałki. Przelot się nie zepsuje, a test źródeł (`steps.test.ts`) wskaże brakujący atrybut.

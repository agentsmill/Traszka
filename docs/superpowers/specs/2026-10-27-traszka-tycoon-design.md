# Traszka Tycoon: dokument projektu

Status: do akceptacji (po researchu i recenzji budowniczego) · data: 2026-10-27

Oznaczenia: **[U]** to decyzja użytkownika, **[C]** to decyzja Claude'a (do sprawdzenia przy czytaniu), **[R]** to wniosek z researchu (źródła w załączniku).

---

## 1. Intencja

Satyryczny tycoon w przeglądarce. Gracz jest franczyzobiorcą sieci sklepów convenience **Traszka**, czyli jawnej parodii polskiej sieci „zawsze blisko”. Gra śmieje się z realiów: palet pod sklepem, centrali z obowiązkowymi promocjami, polowań na wiralowe lody i sklepu tej samej sieci otwartego 150 m dalej. Mimo to ma być grą ekonomiczną, która naprawdę wciąga **[U]**.

Na czym ma polegać frajda w pierwszych 20 minutach **[U]**:
- maksymalizujesz zysk jednego sklepu,
- ustawiasz palety i ludzi tak, żeby klienci się nie korkowali,
- odkładasz na upgrade'y i remont,
- przyspieszasz czas, żeby „jeszcze jeden miesiąc” przyniósł kasę na kolejny sklep.

W dłuższej perspektywie budujesz sieć i podbijasz jedno miasto **[U]**.

Każdy wpisuje własny **seed**, który deterministycznie generuje miasto, lokale i sklepy. Ten sam seed daje ten sam świat, więc seedami można się wymieniać **[U]**.

## 2. Cele, nie-cele, anty-cele

**Cele**
- Ładna gra 3D w Three.js w rzucie izometrycznym, którą chce się oglądać. Ludzie wyglądają jak ludzie, a miasto jak polskie miasto **[U]**.
- Pełna generatywność z seeda: sklepy różnych rozmiarów, ale zawsze z wiarygodnym układem takiego sklepu, plus miasto z ruchem **[U]**.
- Pętla ekonomiczna z prawdziwymi decyzjami: dostawy, palety, ludzie, ceny i promocje, upgrade'y, ekspansja **[U]**.
- Humor i parodia bez prawdziwych nazw, marek, logo i nazwisk **[U]**.
- Mechaniki znane z gier klikerowych (rosnące liczby, przyspieszanie czasu, odblokowania) jako „haczyk”, ale nie zamiast decyzji **[U]/[C]**.

**Nie-cele (w tej wersji)** **[C]**
- Multiplayer, backend, konta, rankingi online.
- Realistyczna księgowość (VAT, ZUS, PIT): wystarczy uproszczony rachunek zysków i strat.
- Pełna symulacja ruchu ulicznego z fizyką aut. Auta i piesi w mieście są dekoracją sterowaną mapą natężenia.
- Wersja mobilna jako cel. Gra działa na laptopie i desktopie; telefon to ewentualnie później.
- Inne języki niż polski.

**Anty-cele** (porażka, nawet jeśli wszystko „działa”)
- Wygląd „klocków” i programmer art. Szkic z pudełek został odrzucony wprost **[U]**.
- Prawdziwe marki, nazwiska influencerów albo treści, które można uznać za zniesławienie **[U]**.
- Grind bez decyzji: klikanie dla samego klikania **[C]**.
- Korki i tłum, które zjadają wydajność. Cel to płynne ~60 FPS na zwykłym laptopie przy pełnym sklepie **[C]**.
- Humor, który kopie pracowników albo klientów. Satyra celuje w system, tzn. w centralę, absurdy i memy, a nie w ludzi przy kasie **[C]**.

## 3. Ograniczenia

- Przeglądarka, statyczny hosting (np. GitHub Pages / Netlify), bez serwera **[C]**.
- Assety 3D wyłącznie na licencjach CC0 / permissive, które pozwalają dołączyć je do gry. Szczegóły w §14 **[C]**.
- Determinizm: ten sam seed i ta sama sekwencja decyzji gracza dają ten sam świat. Losowość symulacji (klienci, zdarzenia) też płynie z PRNG zasilanego seedem **[C]**.
- Zapis gry lokalnie (localStorage) plus eksport/import pliku zapisu **[C]**.
- **Publikacja** **[C]**: gra publiczna i darmowa, bez celów komercyjnych (każdy ma móc wpisać swój seed **[U]**). Na ekranie startowym zastrzeżenie „Wszystkie firmy, postacie i zdarzenia są fikcyjne”. Zasada pisania: satyra przez absurd i przesadę, bez twierdzeń, które brzmią jak fakty o prawdziwej firmie. Przed publikacją osobny przegląd tekstów i nazw.
- **Sprzęt bazowy** **[C]**: MacBook Air z Apple Silicon (M1/M2) albo laptop ze zintegrowaną grafiką Intel Iris Xe. Ustawienia jakości Niska / Średnia / Wysoka od początku. Na Średniej cel to ~60 FPS przy ×1–×4; przy ×8 akceptowalne jest 30 FPS. Przy konflikcie: na Niskiej wygrywa płynność (bez AO, mniejsze cienie), na Wysokiej wygląd.

## 4. Świat i ton

- Sieć: **Traszka**, z hasłem w stylu „Zawsze pod ręką”. Maskotka: pomarańczowobrzucha traszka. Kolory marki: zieleń + pomarańcz **[C]**.
- Centrala: **Traszka Polska S.A.**, w grze po prostu „Centrala”. Mówi korpo-mową, ma zawsze rację i zawsze ma nowy KPI **[C]**.
- Waluta lojalnościowa: **Ogonki** (traszka odrzuca i odrasta ogon). Klienci zbierają je w aplikacji **Traszkapka** **[C]**.
- Konkurencja: fikcyjne sieci, np. **Szop 24h** i **Kawka Express**, plus „cudze Traszki” innych franczyzobiorców **[C]**.
- Miasto: nazwa generowana z seeda z polskich członów, np. „Pcimiów Wielki”, „Koziegłowy Dolne” **[C]**.
- Ton: ciepła satyra. Teksty krótkie, jak z memów, a powiadomienia z centrali to parodia korpo-maili **[C]**.

*(Katalog popkulturowych odniesień: §11 i załącznik A, uzupełniane z researchu.)*

## 5. Generowanie z seeda

### 5.1 Seed i PRNG
- Seed to dowolny tekst, hashowany do 32 bitów. Szybki PRNG (np. sfc32 / mulberry32) **[C]**.
- Każdy podsystem dostaje własny podseed: `hash(seed + ":city")`, `hash(seed + ":store:" + lotId)`, `hash(seed + ":sim")`. Dzięki temu dodanie nowego podsystemu nie zmienia wyglądu starych światów **[C]**.

### 5.2 Generator sklepu **[U]** (rozmiary i spójność) / **[C]** (reguły)
Wejście: lokal z miasta (typ budynku, wymiary, strona ulicy, narożnik lub nie). Wyjście: siatka sklepu (1 kratka ≈ 0,5 m) z rozmieszczonymi elementami.

Formaty lokali. Średnia powierzchnia prawdziwych sklepów to ok. 65 m². Rozpiętość sięga od 8 m² okienka na dworcu do 172 m² flagowca na dwóch kondygnacjach **[R]**.
- **Okienko** na dworcu lub przystanku, 8–15 m²: tylko kasa, kawa, hot-dogi. Ogromny ruch, zero miejsca na palety.
- **Parter bloku z wielkiej płyty**, prostokąt 50–80 m². Format startowy.
- **Narożnik kamienicy**, 40–80 m²: nieregularny, z dwoma witrynami i ciasnym zapleczem.
- **Wolnostojący pawilon**, 80–120 m², z rampą od zaplecza (palety nie blokują chodnika).
- **Flagowiec**, 150–180 m², dwa poziomy, strefa konsumpcji, powerbanki, automat kaucyjny. Do zdobycia przez remont generalny albo zakup.
- **Traszka Nanoo** (bezobsługowa, 15–30 m²): biurowiec albo szpital. Bez kasjera, ale z „wpadkami kamer”.

Twarde reguły układu:
1. Wejście od ulicy. Kasa tuż przy wejściu, za kasą regał z papierosami, alkoholem i loterią.
2. Strefa „hot” (hot-dogi, kawa, piekarnik) przy kasie.
3. Lodówki wzdłuż ściany najdalszej od wejścia, żeby klient przeszedł przez sklep.
4. Regały gondolowe w równoległych rzędach. Minimalna szerokość alejki to 2 kratki (~1 m), docelowo 2,4 kratki.
5. Zaplecze za drzwiami „tylko dla personelu”: magazyn, mini-biuro, ewentualnie drugie wejście dla dostaw.
6. Kasa samoobsługowa, paczkomat i bankomat tylko wtedy, gdy powierzchnia na to pozwala (odblokowywane upgrade'ami).
7. Walidacja: od wejścia musi dać się dojść (flood fill / A*) do każdej półki, kasy i wyjścia. Jeśli się nie da, generator próbuje ponownie z kolejnym podseedem.

Generator działa w dwóch krokach: **szkielet** (strefy) → **wypełnienie** (konkretne meble z biblioteki assetów). Remont generalny uruchamia generator ponownie z większym budżetem i nowymi strefami.

### 5.3 Generator miasta **[U]** (miasto z ruchem, rozmiar „do opanowania”) / **[C]** (reguły)
- Rozmiar: ok. 6×6 do 8×8 kwartałów, czyli kilkadziesiąt lokali, 3–5 dzielnic. Do „zdobycia” w kilka godzin gry.
- Dzielnice: śródmieście z kamienicami, osiedle bloków, biurowce, okolice dworca/uczelni, domki jednorodzinne na obrzeżach, park.
- Punkty generujące ruch: przystanki, szkoły, uczelnia, biurowce, dworzec, osiedla, stadion. Każdy ma profil godzinowy (rano do pracy, południe szkoły, wieczór osiedla, noc imprezy).
- Mapa natężenia ruchu na ulicach jest wyliczana z punktów i profili. Z niej wynika potencjał klientów każdego lokalu.
- Lokale mają stany: zajęty (dekoracja), wolny do wynajęcia, sklep konkurencji, sklep innego franczyzobiorcy Traszki, Twój sklep.
- Startowy sklep gracza: generator wybiera lokal średni, nie najlepszy, żeby było o co walczyć.

## 6. Symulacja sklepu

### 6.0 Co gracz może przestawiać **[U]**
- **Meble są stałe**: regały, lodówki, kasa i strefa hot stoją tak, jak wygenerował je seed. Nowy układ mebli daje tylko **remont generalny** (§8).
- **Palety** gracz przeciąga dowolnie: pod sklep, na zaplecze, do sali (§6.4).
- **Sloty sprzętu**: generator zostawia wyznaczone miejsca, gdzie gracz stawia kupiony sprzęt (kasa samoobsługowa, ekspozytor, drugi piec, paczkomat, bankomat).
- **Planogram** (zakładka „Półki”): gracz przypisuje kategorie towaru do odcinków półek. Lokalizacja ma znaczenie: strefa przy kasie i na wysokości oczu sprzedaje lepiej (zakupy impulsowe), lodówki muszą mieć napoje i nabiał, a niezgodność z wytycznymi Centrali obniża wynik audytu. Siatka nawigacji jest więc stała, poza paletami i slotami.

### 6.1 Klienci
- Archetypy z harmonogramem, listą zakupów, cierpliwością i preferencjami (np. omija kasę samoobsługową). Katalog: §11 i załącznik A **[R]**.
- Liczba klientów = potencjał lokalu (mapa ruchu) × krzywa dobowa × reputacja × promocje × efekty zdarzeń.
- Ruch po siatce (A* lub flow field) z kosztami. Palety i inni klienci to przeszkody. Tłok spowalnia, a spadek cierpliwości do zera oznacza wyjście bez zakupów, minus do reputacji i dymek z tekstem **[U]** (korki).
- Kolejka do kasy jest widoczna i długa kolejka odstrasza nowych klientów od wejścia.

### 6.2 Personel
- Pracownicy mają statystyki: szybkość kasy, siłę/tempo rozładunku, niezawodność, morale.
- Zadania: obsługa kasy, rozładunek palet, wykładanie towaru, strefa hot, sprzątanie.
- Pracownik bierze zadanie według priorytetów. Gracz ustawia priorytety globalnie (np. suwak „kasa ↔ palety”) i może ręcznie przydzielić osobę.
- Kasa samoobsługowa zwalnia ludzi do palet, ale część archetypów jej unika, a inni „zapominają” coś zeskanować **[U]/[C]**.
- Franczyzobiorca jest postacią w sklepie. Gracz może go wstawić na kasę albo do palet za darmo, ale kosztem „zmęczenia”, które obniża wydajność w kolejnych dniach (puszczamy oko do niedziel) **[C]**.

### 6.3 Zapasy i półki
- Kategorie produktów (napoje, nabiał, pieczywo, słodycze, przekąski, alkohol, tytoń, chemia, hot food, gotowe dania, sezonowe, wiralowe). Każda ma zapas na półce i na zapleczu.
- Puste półki = utracona sprzedaż + minus do reputacji. Przepełnione zaplecze = towar ląduje na podłodze/paletach.
- Świeże produkty mają termin. Przeterminowane to strata (kosz) **[C]**.

### 6.4 Dostawy i palety **[U]**, sedno mechaniki
- **Zamówienie do 11:00** **[R]**: w systemie **CyberTraszka** gracz zamawia towar na następną dostawę. „Asystent Traszki” podpowiada ilości i zawsze lekko przesadza (np. „40 hot-dogów, klienci to kochają”). Przyjęcie podpowiedzi to wygoda, a jej korekta oszczędza pieniądze. **Za duże zamówienie oznacza więcej palet**, więc decyzja zakupowa wprost przekłada się na korki **[C]**.
- Dostawy co 1–2 dni, świeże (kanapki, pieczywo) codziennie ok. 7–8 rano **[R]**. Kierowca zostawia palety pod sklepem.
- **Skanowanie dostawy** **[R]/[C]**: rozbieżność trzeba zgłosić, zanim kierowca odjedzie. Inaczej płacisz za „towar-widmo”, którego nie było. Szybka, opcjonalna mini-akcja.
- Gracz decyduje, gdzie stoi każda paleta:
  - **Pod sklepem:** nie przeszkadza w środku, ale rośnie ryzyko, że ktoś zadzwoni po straż miejską lub policję (zajęty chodnik). Mandat plus minus do reputacji. Ryzyko rośnie z liczbą palet i czasem postoju.
  - **W sklepie lub na zapleczu:** szybszy rozładunek, ale palety w alejach to przeszkody i korek.
- Rozładunek trwa i robią go pracownicy wtedy, gdy są wolni. To zależy od obłożenia kasy, od tego, czy jest kasa samoobsługowa, i od tego, ile osób z niej korzysta.
- Palety same się nie rozładują. W nieoptymalnym sklepie się kumulują, następna dostawa dokłada kolejne i robi się kula śnieżna, która uderza po kieszeni.
- Ostateczność: **odesłanie dostawy do hurtowni** **[C]**. Zawsze możliwe, ale bolesne: opłata logistyczna, brak towaru (puste półki) i spadek **zaufania Centrali**, który obniża szanse na przydział produktów wiralowych (§7.3). Dzięki temu palety, wiralowe produkty i relacja z Centralą łączą się w jedną pętlę.
- Upgrade'y logistyczne: wózek paletowy, rampa i drzwi od zaplecza, regały magazynowe, dodatkowy pracownik na poranną zmianę, okno dostaw nocnych.

## 7. Ekonomia

### 7.1 Rachunek miesiąca **[U]** (cel: zysk na koniec miesiąca) / model **[R]**
Model wzorowany na realiach, uproszczony:
- **Start na kreskę** **[R]**: sklep pełen towaru Centrali (kredyt kupiecki ~150 tys. zł) i 0 zł w kasie. Towar nie jest Twój, Ty tylko na nim zarabiasz.
- **Zamówienie nie kosztuje gotówki z góry** **[C]** (kredyt kupiecki), ale przesada boli na trzy sposoby: (1) każda paleta ponad bazowy przydział dostawy to **opłata logistyczna**, (2) niesprzedany towar świeży trafia do **WUT**, a ubytki ponad próg płacisz Ty, (3) wartość towaru w sklepie ma **limit kredytu**, po którego przekroczeniu Centrala wstrzymuje dostawy. Dzięki temu zamawianie jest decyzją bez pełnego modelu przepływów gotówki.
- **Utarg** wpłacasz codziennie. Gotówka zostawiona w sejfie na weekend to ryzyko kradzieży, czyli mała decyzja i mały żart **[R]/[C]**.
- **Twój przychód** = marża wg kategorii (np. 5% tytoń, 10% napoje, 15%+ hot food i dania) + premie Centrali (audyt, świeże, KPI) **[R]**. Gwarancja minimalnego przychodu działa tylko wtedy, gdy sklep jest otwarty każdego dnia, a wskaźnik jakości ≥ 80% **[R]**.
- **Twoje koszty:** wynagrodzenia (2–4 etaty po ~4,5–5,5 tys. zł), ZUS, księgowa, media, **opłata franczyzowa dla Centrali** (miesięczna, stała plus prowizja od płatności kartą), mandaty i kary, ubytki ponad próg WUT **[U]/[R]**.
- **Wynik:** Twój zysk. Rzędy wielkości do balansu **[R]**: obrót sklepu ~150 tys. zł/mies., przychód franczyzobiorcy ~30 tys. zł, „na rękę” 5–8 tys. zł. Dobrze prowadzony sklep w grze powinien dać wyraźnie więcej, to w końcu tycoon **[C]**.
- Koniec miesiąca to ekran **Raport miesięczny**: wykres, komentarz Centrali, premie i kary, przypomnienie o opłacie.

### 7.1a Codzienność franczyzobiorcy **[R]** → mechaniki
- **Pasek WUT** (Wskaźnik Ubytków Towarowych): napełniają go przeterminowany towar, kradzieże i pomyłki. Powyżej progu płacisz Ty. Raz na jakiś czas Centrala ogłasza „program refundacyjny”.
- **FEFO i naklejka „NIE marnujeMY”**: ok. 18:00 możesz przecenić kanapki albo ryzykować kosz. Ostatnia deska ratunku to paczki-niespodzianki w Traszkapce.
- **Audyt i tajemniczy klient**: losowe wizyty sprawdzają planogram, czystość, ceny i obsługę. Wynik wpływa na premię, gwarancję i zaufanie Centrali.
- **Glitch kasowy**: system daje losowe rabaty. Zamykasz sklep czy sprzedajesz prawie za darmo?
- **Niedziela „placówka pocztowa”**: podwójna marża, ale na kasie stoisz sam i rośnie zmęczenie.
- **Grafik 17-godzinnej doby**: ułożenie zmian na 3–4 etaty. Pracownik, który „zachorował” akurat w dzień dostawy.

### 7.2 Ogonki i giełda Ogonków **[U]** (spekulacja) / **[C]** (forma)
- Ogonki to druga waluta. Gracz dostaje je za cele, sprzedaż promocji i zadowolenie klientów, a wydaje na wnioski o przydział produktów wiralowych, kampanie w Traszkapce i skrócenie czasu remontu.
- Kurs Ogonków do złotówki wahnie się: losowy spacer z pędem plus skoki przy zdarzeniach (premiera wiralowego produktu, viral w social mediach, „afera” w Centrali). Gracz może kupować i sprzedawać, czyli spekulować.
- Zabezpieczenie przed nadużyciem: prowizja od wymiany i dzienny limit, żeby giełda była przyprawą, a nie najlepszą strategią.

### 7.3 Produkty wiralowe **[U]**
- Co jakiś czas Centrala ogłasza zrzut produktu wiralowego, np. lody BANDY albo pizza Księżniczka (parodie, lista w załączniku A).
- Przydział na sklep zależy od **zaufania Centrali** (KPI, terminowość, brak odesłanych dostaw, audyty) i od Ogonków włożonych we wniosek.
- Efekt: skok ruchu, kolejki, klienci przyjeżdżający z daleka, odsprzedawcy, dodatkowe palety. Wielka szansa i wielki stres dla układu sklepu.

### 7.4 Ceny i promocje **[C]**
- Ceny ustala Centrala. Gracz ma wpływ tylko na lokalne promocje z puli (np. „kawa + drożdżówka”) i na ekspozycję (co stoi przy kasie).
- Obowiązkowe promocje Centrali są wymuszone i bywają nieopłacalne. To źródło humoru i decyzji typu „jak zminimalizować stratę”.

## 8. Progresja i upgrade'y **[U]**

- **Wyposażenie:** lodówki (pojemność, zużycie prądu), regały, druga kasa, kasa samoobsługowa, ekspres premium, piec, hot-dogi, paczkomat, bankomat, klimatyzacja, kamery (mniej kradzieży).
- **Logistyka:** jak w §6.4.
- **Ludzie:** rekrutacja, szkolenia, premie (morale).
- **Asortyment:** nowe kategorie odblokowywane poziomem sklepu lub zaufaniem Centrali.
- **Remont generalny:** sklep zamknięty na N dni (zero przychodu, koszty stałe zostają), po nim nowy układ z generatora z większym budżetem, nowymi strefami i lepszym wyglądem. Kilka poziomów (np. Standard → Premium → Flagowiec).
- **Marketing:** ulotki, kampanie w aplikacji (za Ogonki), event pod sklepem.
- Mechaniki klikerowe **[C]**: widoczne liczniki, „kamienie milowe” z nagrodą, szybkie mikro-ulepszenia z krótkim czasem zwrotu na start, żeby szybko poczuć postęp.

## 9. Ekspansja i miasto **[U]**

- Widok miasta 3D z góry jest dostępny od początku, ale ekspansja odblokowuje się po osiągnięciu progu: 2 miesiące z zyskiem plus poziom zaufania, co przy dobrej grze daje ~45–60 minut (§10).
- Satyryczna rama **[R]/[C]**: oficjalnie obowiązuje zasada „jeden sklep, jeden franczyzobiorca”. Żeby mieć ich więcej, trzeba zdobyć status **Partnera Strategicznego**. Centrala nadaje go za wysokie zaufanie i z wyraźną niechęcią.
- Pozyskanie lokalu:
  - **wynajem pustego lokalu i budowa od zera** (czas budowy i koszt adaptacji),
  - **odkupienie** sklepu od innego franczyzobiorcy, np. zmęczonego albo na wylocie,
  - **przejęcie** lokalu po zamkniętym sklepie konkurencji.
- **Analizy:** płatne raporty ujawniają warstwy mapy (natężenie ruchu wg godzin, demografia, konkurencja w promieniu, prognoza obrotu). Bez analizy gracz widzi tylko przybliżenie **[U]**.
- Przełączanie między sklepami: osobne ekrany izometryczne każdego sklepu **[U]**. Sklepy nieaktywne liczą się w tle uproszczonym modelem statystycznym. Opcjonalnie gracz zatrudnia kierownika, który poprawia wynik nieaktywnego sklepu, ale kosztuje.
- **Konkurencja (AI):** sieci rywali otwierają sklepy w lokalach z dużym ruchem, robią promocje i podbierają klientów w promieniu. Gracz wypiera je lokalizacją, promocją i wiralowymi produktami. Sklep konkurencji, któremu spada obrót, w końcu się zamyka **[U]**.
- **Centrala jako przeciwnik** **[C]**: potrafi otworzyć „cudzą Traszkę” blisko Ciebie (kanibalizacja). Możesz temu zapobiec, zajmując lokal pierwszy, albo mieć wysoki poziom zaufania.

## 10. Czas, tempo, wygrana i przegrana

- Czas płynie w trybie ciągłym z pauzą i prędkościami ×1, ×2, ×4, ×8 **[U]** (przyspieszanie). **Doba przy ×1 trwa ok. 60 s realnych** (sklep otwarty 6:00–23:00), więc miesiąc to ~30 min przy ×1 i ~4 min przy ×8 **[C]**.
- **Kalendarz** **[C]**: prawdziwy kalendarz gregoriański z tygodniami. Gra startuje 1 września, żeby pierwsze miesiące miały wyraziste zdarzenia: fioletowy dog, Halloween, Black Friday, święta, Sylwester. Rozliczenie miesiąca następuje ostatniego dnia. Niedziele niehandlowe są modelowane: sklep zamknięty albo „placówka pocztowa” (§7.1a).
- **Tempo docelowe** **[C]**: pierwsze 20 minut to ok. 1,5–2 miesięcy gry (pierwszy raport, pierwsze upgrade'y). Drugi sklep jest w zasięgu po ~45–60 minutach. Podbicie miasta zajmuje 4–8 godzin.
- Pora dnia wpływa na ruch, oświetlenie (dzień/noc) i archetypy klientów.
- **Przegrana** **[C]**: dwa miesiące z rzędu bez opłacenia Centrali albo zaufanie spadające do zera oznacza wypowiedzenie umowy franczyzowej. Potem przychodzi „Rozliczenie końcowe” **[R]**: inwentaryzacja, odkup tylko towaru ze świeżą datą i rachunek za każdy ubytek, a na końcu ekran „Dziękujemy za współpracę”.
- **Wygrana** **[C]**: udział w rynku miasta ≥ 60% albo zamknięcie wszystkich sklepów konkurencji daje tytuł „Króla Traszek”. Potem gra toczy się dalej w trybie bez końca i można wylosować nowe miasto z nowym seedem.

## 11. Zdarzenia i popkultura **[R]**

System zdarzeń: karty w skrzynce (prawy panel ze szkicu) z 0–3 wyborami i konsekwencjami. Źródła zdarzeń: Centrala, klienci, miasto, social media, pogoda i kalendarz. Wszystkie nazwy to parodie; prawdziwe osoby i marki nie występują **[U]**.

### 11.1 Produkty specjalne **[R]**
| W grze (parodia) | Inspiracja | Mechanika |
|---|---|---|
| **Lody BANDY XL** | lody youtuberskiej ekipy, 2021: znikały z zamrażarek w godzinę | drop influencera: przydział < popyt, zamawiasz z wyprzedzeniem, pusta zamrażarka = minus reputacji u dzieciaków |
| **Pizza Hrabiego Placuszka „na grubo”** | pizza recenzenta jedzenia, X 2026: 10–20 szt. na dostawę, sentyment 47% za / 45% przeciw | „polowanie”: klienci objeżdżają sklepy w mieście szukając produktu; pasek wiarygodności influencera opada z czasem |
| **Napój „Kraftuś”** | napój youtubera, 2025: kartki „brak” na drzwiach, potem zalegał w dyskoncie | krzywa hype'u: gaśnie, gdy produkt trafia do konkurencji; ryzyko zdarzenia „Urząd Ochrony Dzieciaków” |
| **Traszdog** + edycje kolorowe (Czarny Kumak na Black Friday, Hrabia Traszula na Halloween, fioletowy na 1 września) | 80 mln hot-dogów rocznie, limitowane kolory | produkt bazowy strefy hot; edycje kalendarzowe z marżą premium |
| **Pizza z pieca** z kuponem dnia | 16,5 mln pizz w 2025, kupon raz dziennie | upgrade „piec”: duży zysk, ale zajmuje pracownika |
| **Mniamm** (zupy i dania gotowe) | marka własna dań gotowych | kategoria „dania”, wysoka marża, krótki termin |
| **„Masz 2 zeta”**: produkt za 2 zł zmieniany co 3 godziny | akcja happy hours 2021 | okna czasowe promocji jako narzędzie sterowania falami klientów |
| **Jadziki**: zdrapki i maskotki przy kasie | kolekcjonerskie akcje dla dzieci | gacha przy kasie: mały przychód, duży ruch dzieciaków |
| **Traszka Retro**: sweter z traszką | kolekcja ubrań w stylu lat 90. | nagroda w konkursie Traszkapki, kosmetyka |

### 11.2 Archetypy klientów **[R]** (zachowania częściowo moje **[C]**)
- **Dzieciak od dropu:** przychodzi po lekcjach wyłącznie po produkt z dropu. Gdy go nie ma, wychodzi wkurzony, a rodzic potem pisze skargę.
- **Nastolatek po energetyka:** sprzedaż od 18 lat. Odmowa grozi awanturą (zdarzenie bezpieczeństwa), a sprzedaż karą do 2000 zł przy kontroli.
- **Łowca kuponów:** kupuje tylko z kuponem z Traszkapki. Bez promocji porzuca koszyk.
- **Kibic:** w dniu meczu zestaw piwo + chipsy, przychodzą falą przed gwizdkiem.
- **Nocny klient:** wpada tuż przed godziną zakazu po alkohol. Po godzinach w trybie Nano.
- **Korpo-kawa** (rano), **babcia z drobnymi** (wolna przy kasie, lojalna), **poranny klient z puszką**, **student** (hot-dog + energetyk w sesji), **kurier/odbiór paczki** (generuje ruch, rzadko kupuje), **turysta** (sezon wakacyjny) **[C]**.

### 11.3 Talia zdarzeń (przykłady)
- **Traszka naprzeciwko Traszki:** Centrala otwiera cudzą Traszkę obok (kanibalizacja). Osiągnięcie „Dwie Traszki, jedno skrzyżowanie” **[R]**.
- **Traszkashoposting:** Twój kasjer robi memy, konto rośnie. Decyzja: wspierasz go (reputacja ↑) albo Centrala „wynajmuje agencję, która robi to samo, tylko gorzej” (ryzyko afery) **[R]**.
- **Godzina Ciszy Piwnej:** rada gminy zmienia godziny nocnej sprzedaży alkoholu w dzielnicy **[R]**.
- **Kontrola cenówek:** urząd sprawdza czytelność etykiet. Masz 2 doby na poprawę albo kara **[R]**.
- **Reset Ogonków:** program lojalnościowy kończy sezon, saldo klientów i część Twoich Ogonków wygasa 31.12. Wcześniej panika zakupowa **[R]**.
- **Kot w Nano:** kamera w trybie bezobsługowym policzyła kota jako 3 batony **[R]/[C]**.
- **Gazetka dla uczniów:** Centrala wypuszcza promocję energetyka „na powrót do szkoły”. Burza w sieci, a Ty zbierasz skutki **[R]**.
- **Poczta Traszkowa:** niedziela. Otwierasz jako „placówka pocztowa” i ryzykujesz kontrolę? **[R]** (stan prawny dziś niepotwierdzony, w grze to żart).
- **Sezon nad morzem:** możliwość otwarcia sezonowej Traszki na wakacje **[R]**.
- **Mecz reprezentacji:** fala piwa i chipsów; przygotuj zapas i dodatkowe ręce do kasy **[R]**.

### 11.4 Kalendarz **[R]**
Black Friday (Czarny Kumak), Halloween (Hrabia Traszula, szczyt 31.10 po południu), 1 września (fioletowy dog), wakacje (sklepy sezonowe, lody, dmuchane koła), mecze, Sylwester (część sklepów zamknięta), Walentynki (limitowany dog).

## 12. Interfejs **[U]** (szkic zaakceptowany)

- Górny pasek: marka, gotówka, Ogonki z trendem kursu, dzień miesiąca i godzina, odliczanie do opłaty dla Centrali, zadowolenie klientów, prędkość czasu.
- Prawy panel: skrzynka zdarzeń (dostawy, Centrala, wiralowe zrzuty, klienci).
- Dolny pasek zakładek: Sklep · Dostawy · Półki · Ludzie · Ulepszenia · Giełda Ogonków · Miasto.
- Interakcja w sklepie: kamera izometryczna (obrót co 90°, zoom, przesuwanie), przeciąganie palet i mebli, kliknięcie w osobę lub mebel otwiera kartę z akcjami.
- Język: polski.

## 13. Grafika i dźwięk

- Wymóg **[U]**: ładnie i szczegółowo, dużo więcej wielokątów niż klocki. Ludzie wyglądają jak ludzie (proporcje, ubrania, fryzury, animacja chodu), miasto jak polskie miasto (bloki, kamienice, pawilony, drzewa, auta, latarnie).
- **Punkt odniesienia** **[U]**: **Two Point Hospital**. Co z tego wynika **[C]**:
  - Postacie stylizowane, lekko karykaturalne (trochę większa głowa i dłonie, wyraźne sylwetki), z charakterem i wyrazistymi animacjami (zniecierpliwienie w kolejce, radość przy zakupie, złość przy pustej półce).
  - Ciepła, nasycona paleta, czyste kształty czytelne z daleka, dużo drobnych rekwizytów (plakaty promocji, kosze, rośliny, stojaki z gazetami).
  - Wnętrza w przekroju (ściany od kamery ścięte).
  - Humor widoczny w grafice i w tekstach: nazwy produktów, plakaty Centrali, **komunikaty z radia sklepowego** („Drodzy klienci, Centrala przypomina…”).
- Miękkie cienie, ambient occlusion i ciepłe światło (§14.3). Ma być „cozy”, a nie realistycznie.
- **Dobór postaci w etapie 1** **[C]**: porównać Quaternius UBC (realistyczne proporcje, można je przeskalować) z Quaternius Ultimate Modular Men/Women (bardziej stylizowane). Wybrać to, co bliższe Two Point, i w razie potrzeby zastosować proceduralną przesadę proporcji.
- Przekrój ścian (cutaway): ściany od strony kamery są obniżone lub przezroczyste, a witryna od ulicy jest szklana.
- Cykl dnia i nocy: neon szyldu, światło z witryny, latarnie.
- Dźwięk **[C]**: w pierwszej wersji tylko kilka efektów CC0 (dzwonek drzwi, kasa, „pik” skanera). Muzyka później.

## 14. Technologia **[R]**

### 14.1 Architektura **[C]**
- **Symulacja oddzielona od renderu.** Rdzeń gry (`sim/`) to czysty TypeScript bez three.js: stały krok czasowy, deterministyczny PRNG, stan serializowalny do JSON, testy jednostkowe w Vitest. Render (`render/`) tylko czyta stan i rysuje, a UI (`ui/`) czyta stan i wysyła komendy.
- **Komendy gracza** to obiekty („przesuń paletę”, „zamów”, „kup upgrade”).
- **Zapis gry** **[C]** = seed + wersja gry + **pełny stan, łącznie z wygenerowanym światem** (układy sklepów i miasta to małe siatki, kilkadziesiąt KB). Zapis nie zależy więc od tego, czy generator się zmienił. Gwarancja seeda: ten sam seed daje ten sam świat **w tej samej wersji gry**. Między wersjami świat może się zmienić, bo to projekt w rozwoju. Testy „złotych seedów” pilnują determinizmu w obrębie wersji.
- **Zero `Math.random`** w `sim/` i generatorach.

### 14.2 Stos **[R]** (wersje z rejestru npm, 2026-10)
- **three 0.186.1** + `WebGLRenderer`, `OrthographicCamera`, `@types/three` 0.186.0. WebGPU dopiero później: Firefox domyślnie go nie ma, a N8AO go nie wspiera.
- **Vite 8.3.5**, **TypeScript 7.0.2** (awaryjnie 6.0.3, jeśli zgrzyta z `@types/three`), **Vitest 5.0.5**.
- **UI:** nakładka HTML/CSS z **Preact 11.1.0 + @preact/signals 2.11.4** **[C]**: lekkie, komponentowe i łatwe do rozdzielenia na małe zadania.
- **PRNG:** własne **sfc32** seedowane **xmur3** ze stringa (128 bitów stanu), osobny strumień na podsystem.
- **Zapis:** localStorage z try/catch i wersją schematu. Przy dużych zapisach idb-keyval 6.3.0.

### 14.3 Render: najwięcej „ładności” za najmniejszy koszt **[R]**
1. Tone mapping AgX lub Neutral, wyjście sRGB.
2. `DirectionalLight` z cieniami (kamera cienia dopasowana do widoku ortho, mapa 2048–4096, `PCFShadowMap`, bo `PCFSoftShadowMap` jest w r186 przestarzały), `HemisphereLight`, `RoomEnvironment` przez PMREM jako `scene.environment`.
3. **N8AO** (ambient occlusion, tryb halfRes, działa z kamerą ortograficzną). To największy skok „głębi”. Licencję (CC0 kontra ISC) trzeba sprawdzić przed publikacją.
4. **pmndrs/postprocessing 6.39.5**: jeden `EffectPass` z SMAA, delikatnym bloomem (neony, światła nocą) i winietą. Uwaga: wymaga three < 0.187.
5. Outline tylko dla zaznaczenia i hovera. Bez cel-shadingu.
6. pixelRatio ograniczony do 1,5–2. Cienie statyczne odświeżane rzadko.

### 14.4 Assety **[R]**
- **Ludzie:** Quaternius **Universal Base Characters** (CC0, ~13k trójkątów, realistyczne proporcje) + **Universal Animation Library** (CC0, wspólny rig, chód i idle). Darmowy tier daje tylko 2 bazy (M/K) i 5 fryzur, więc różnorodność tłumu dokładamy z seeda: kolory skóry, włosów i ubrań, skala wzrostu i tuszy, fryzury, dołączane torby i plecaki. Postacie decymowane do 2–4k trójkątów. Plan B: Ultimate Modular Men/Women (CC0).
- **Miasto i rekwizyty:** Kenney (City Kit Commercial, Suburban, Roads, Car Kit, Furniture Kit, Food Kit, Nature Kit), Quaternius (Downtown City MegaKit, Cars), KayKit City Builder Bits. Wszystkie CC0.
- **Polskie budynki proceduralnie** (brak gotowych paczek CC0): bloki z wielkiej płyty (siatka paneli i loggii w pastelach), kamienice (gzyms, tynk, brama), pawilony (duża witryna i szyld). Tekstury z jednego atlasu generowanego w canvasie plus tekstura świateł okien na noc. Paleta dopasowana do Kenneya i Quaterniusa, żeby wszystko wyglądało spójnie.
- **Wnętrze sklepu:** regały, lodówki z szybami, kasa, piec, ekspres i kasa samoobsługowa składane proceduralnie z prostych brył z fazowaniem i detalami, wypełnione produktami z Food Kit przez `InstancedMesh`.
- **Pipeline:** @gltf-transform/cli 4.5.1 (dedup, decymacja, meshopt).

### 14.5 Ruch ludzi i wydajność **[R]/[C]**
- **Sklep:** własny A* na siatce sklepu (0,5 m) z rezerwacją kratek. Palety i meble to dynamiczne przeszkody, a korki powstają naturalnie. Kolejka do kasy to sloty i maszyna stanów. Plan B dla omijania: navcat 0.4.1.
- **Postacie w sklepie** (do ~60): klony `SkeletonUtils` z własnym `AnimationMixer`, rzadsze aktualizacje dla dalszych.
- **Tłum w mieście** (setki, dekoracja): animacja wypieczona do tekstur (three-vat 4.2.0) albo InstancedMesh2 (@three.ez/instanced-mesh 0.3.16), sterowany mapą natężenia, bez pełnego pathfindingu.
- **Draw calle:** `InstancedMesh` dla powtarzalnych obiektów, `BatchedMesh` i `mergeGeometries` dla budynków, miasto pocięte na chunki.
- **Benchmark w etapie 1** jest obowiązkowy: 60 postaci w sklepie i pełne miasto na zwykłym laptopie, cel ~60 FPS.

### 14.6 Do sprawdzenia przed startem etapu 1
Zawartość paczek (GLB/glTF), czy bazy UBC mają ubrania, lista klipów UAL Standard, licencja N8AO, zgodność TS 7 z `@types/three`.

## 15. Etapy

1. **Pionowy wycinek wyglądu.** Jeden wygenerowany sklep z ulicą, ładnie wyrenderowany, z chodzącymi ludźmi i kamerą, plus benchmark wydajności. **Twarda brama** **[C]**: po etapie 1 prace nad renderem stoją, dopóki użytkownik nie zaakceptuje wyglądu (prowadzi to sesja główna, budowniczy nie rozmawia z użytkownikiem). Rdzeń symulacji (`sim/`, bez renderu) może w tym czasie iść równolegle. Szkic `.superpowers/brainstorm/*/ekrany-gry.html` jest wzorcem tylko dla **układu interfejsu** (HUD, skrzynka zdarzeń, zakładki), a nie dla grafiki.
2. **Pętla jednego sklepu.** Klienci, kasa, personel, zapasy, dostawy i palety, rachunek miesiąca, HUD, prędkości czasu, zapis gry.
3. **Smak i treść.** Zdarzenia, Centrala, wiralowe produkty, Ogonki i giełda, upgrade'y, remont generalny.
4. **Miasto i ekspansja.** Generator miasta, mapa ruchu, analizy, zakup lokali, przełączanie sklepów, AI konkurencji, wygrana i przegrana.
5. **Szlif.** Balans ekonomii, onboarding (pierwsze 20 minut), efekty, dźwięki, wydajność.

## 16. Co zostaje budowniczemu

- Konkretne liczby balansu: ceny, marże, koszty, tempo spawnu. Wychodzimy od rzędów wielkości z researchu i stroimy w etapie 5.
- Wybór algorytmu ruchu (A* / flow field) i szczegóły nawigacji, byle spełniały wymagania korków i wydajności.
- Dobór konkretnych modeli z paczek assetów i paleta kolorów, w ramach kierunku z §13.
- Teksty humorystyczne, w tonie z §4 i na bazie załącznika A.

## Załącznik A: kluczowe źródła researchu (2026-10)

Zastrzeżenie: liczby sieci to materiały PR, relacje franczyzobiorców to pojedyncze anegdoty, a spory opisujemy ogólnie i bez nazwisk. W grze wszystko jest parodią.

- Drop lodów youtuberów (2021): [wiadomoscihandlowe.pl](https://www.wiadomoscihandlowe.pl/przemysl-i-producenci/rynek-slodyczy-i-przekasek/lody-ekipa-wyparowaly-ze-sklepow-gdzie-mozna-je-jeszcze-kupic-2490122)
- Pizza recenzenta (10.2026): [superbiz.se.pl](https://superbiz.se.pl/wiadomosci/pizza-ksiazula-znika-z-zabek-polki-opustoszaly-w-kilka-dni-aa-dsNL-TGAQ-XgFV.html)
- Hot-dogi, edycje kolorowe: [zabkagroup.com](https://zabkagroup.com/more-than-80-million-hot-dogs-sold-14-million-paninis-and-6-million-crunchy-snacks-on-offer-prostozpieca/)
- Program lojalnościowy i jego wygaszenie: [antyweb.pl](https://antyweb.pl/zabka-gasi-swiatlo-czy-to-koniec-zappsow)
- Sklep naprzeciwko sklepu, kanibalizacja: [bezprawnik.pl](https://bezprawnik.pl/zabka-dawno-przekroczyla-granice-absurdu/), [money.pl](https://www.money.pl/gospodarka/zabka-otworzy-nowe-sklepy-szykuje-ekspansje-w-rumunii-7077332094512096a.html)
- Model franczyzy i liczby: [zabka.pl/franczyza](https://www.zabka.pl/franczyza/), [money.pl](https://www.money.pl/firma/ile-zarabia-franczyzobiorca-zabki-siec-ujawnia-dane-7316182029981760a.html), [bezprawnik.pl](https://bezprawnik.pl/nagral-rekrutacje-do-zabki/), [bankier.pl](https://www.bankier.pl/wiadomosc/Franczyzobiorcy-Zabki-sami-kupuja-swoje-hot-dogi-To-nie-jedyny-ich-zarzut-wobec-sieci-8842012.html)
- Dostawy i zamówienia: [zabka.pl, artykuł o zatowarowaniu](https://www.zabka.pl/artykul-edukacyjny/zatowarowanie-sklepu-jak-dobrze-zarzadzac-towarem-za-pomoca-programow-i-systemow-zabki/)
- Formaty (8 m² – 172 m²): [cdn.zabka.pl](https://cdn.zabka.pl/wp-content/uploads/2026/07/23175015/Komunikat_Nowa-najmniejsza-Zabka-w-Polsce.-Zakupy-kawa-i-cieple-przekaski-prosto-z-okienka_23-07-2026.pdf), [wiadomoscihandlowe.pl](https://www.wiadomoscihandlowe.pl/multimedia/13-000-sklep-sieci-zabka-zobacz-jak-wyglada-i-w-co-jest-wyposazony-2537816)
- Awaria promocji 2.08.2026: [money.pl](https://www.money.pl/gospodarka/awaria-w-zabkach-ajenci-zamykaja-sklepy-7314118904096832a.html)
- Assety: [Quaternius UBC](https://quaternius.com/packs/universalbasecharacters.html), [Quaternius UAL](https://quaternius.com/packs/universalanimationlibrary.html), [Kenney](https://kenney.nl/assets), [N8AO](https://github.com/N8python/n8ao), [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing)

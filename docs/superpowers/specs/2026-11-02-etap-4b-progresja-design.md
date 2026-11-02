# Etap 4b: progresja bez sufitu, zdarzenia i Galeria sław — projekt

**Data:** 2026-11-02. **Podstawa:** `main` po scaleniu części A etapu 4a.2 (gałąź `claude/miasto-4a2-a56360`, 9802658).
**Plan:** `docs/superpowers/plans/2026-11-02-etap-4b-progresja.md`. **Decyzje wiążące:** notatka koordynatora z 2026-11-02.
Oznaczenia: **[W]** to decyzja właściciela, `Ruling:` to rozstrzygnięcie autora specu (format: decyzja — dlaczego — koszt pomyłki).

## 1. Cel i dlaczego

Gracz z ok. 400 tys. zł ma wszystko wykupione, nie może wziąć kolejnego sklepu i nie ma co robić. Etap 4b daje mu na co wydawać do 2–3 mln zł
(remonty 4–5, wyższe poziomy ulepszeń, badania Sieci, czwarty i piąty sklep), daje mu powody do patrzenia na ekran (12 nowych kart dnia,
13 nowych celów) i nagradza pierwszy milion wpisem do publicznej Galerii sław. Rano ma to być na produkcji, więc zakres dzieli się na P1 i P2.

## 2. Cele, nie-cele, anty-cele

**Cele (P1).**
- Remonty 4 i 5. Remonty 1 i 2 drożeją.
- Wyższe `maxLevel` 11 ulepszeń i 5 nowych ulepszeń późnej gry. Koszt rośnie geometrycznie, efekt liniowo.
- Grupa „Sieć”: 6 badań na poziomie firmy, od 2 otwartych sklepów, z efektem na wszystkie sklepy.
- Do 5 sklepów w mieście. Czwarty i piąty odblokowuje obrót sieci. Własne sklepy podbierają sobie klientów.
- 12 nowych kart dnia, w tym „Zrzut Traszkomonów”.
- 13 nowych celów: 10 celów firmy i 3 cele sklepu.
- Galeria sław: próg 1 mln zł w zwykłej grze, endpoint, lista i gratulacje.

**Nie-cele.** Nowe miasta, nowe dzielnice, zmiana balansu 4a.1, nowy tryb rankingowy z firmą, sezony Galerii, weryfikacja wpisów Galerii
przez sędziego, nowe hasła słowniczka i samouczka.

**Anty-cele.** Nie robimy tu:
- żadnego `Math.random` ani `Date` w `src/sim`;
- importu miasta ani firmy przez sędziego (`run.ts`, `ranked.ts`, `judge-entry.ts`);
- nowych zmiennych środowiskowych ani czytania env poza `env.ts`;
- prawdziwych marek kart kolekcjonerskich ani innych cudzych marek w grze, repo i commitach;
- zmian w gałęzi bez Sieci: gra jednym sklepem i bieg rankingowy nie dostają efektów badań, kanibalizacji, celów firmy ani Galerii.

## 3. Ograniczenia

- `SIM_VERSION` 6 → 7 z nowym wpisem `GOLDEN`. Ranking się resetuje **[W]**.
- `GENERATOR_VERSION` (1) i `CITY_GENERATOR_VERSION` (1) zostają, bo poziomy remontu 1–3 dają ten sam układ co dziś (§5.1).
- `FIRM_SAVE_SCHEMA` 3 → 4 z migracją z 3. Wczytują się wszystkie zapisy z `src/game/fixtures/`, w tym `save-v3-po-traszce.json` (sklep `reopened`).
- Paczka „Wyślij zapis” ≤ 64 KB (`SAVE_TRANSFER_MAX_BYTES`), także przy 5 otwartych sklepach po 24 miesiącach.
- Każdy nowy polski napis ma wpis w `EN_UI`, `EN_RENDER`, `EN_CARDS`, `EN_PLURALS` albo w tabelach treści (`EN_UPGRADES`, `EN_REMONTS`, `EN_MILESTONES`), a `tests/i18n.test.ts` przechodzi.
- Balans 4a.1 (ruch dzielnic, rywale, `PARTNER_MONTHS` 2, `PARTNER_TRUST` 75) zostaje **[W]**.
- Repo jest publiczne: żadnych sekretów. Smoke nigdy nie wysyła niczego na produkcję.

## 4. Decyzje właściciela [W]

1. Remonty: poziom 1 kosztuje 35 000 (było 25 000), poziom 2 100 000 (było 80 000), poziom 3 (Flagowiec) 200 000 bez zmian. Nowe poziomy 4 i 5 mają parodystyczne nazwy, większe `grow`, `slots` i `minLevel`, a ceny na start ok. 450k i 900k, strojone na botach. Sklep rośnie delikatnie. Generator i render ulicy obsługują poziomy 4–5.
2. Wyższe `maxLevel` tam, gdzie ma to sens, i kilka nowych ulepszeń późnej gry. Koszt rośnie szybciej niż efekt. Gracz z 2–3 mln zł dalej ma na co wydawać.
3. Grupa „Sieć”: badania firmy od 2 otwartych sklepów. Bonus obejmuje wszystkie sklepy i rośnie z liczbą sklepów coraz wolniej. Przykłady: wspólne dostawy, wspólna obsada, plus 3–4 własne. Satyryczna opłata koordynacyjna Centrali jest dozwolona. Stan leży w `FirmState`, droga do sklepu prowadzi przez `StoreInfo.site` / `SiteMods`. Jeden sklep i ranking nie dostają nic.
4. `MAX_STORES = 5`, czwarty i piąty odblokowywane stopniowo. Kanibalizacja własnych sklepów: współczynnik na start 0,9. Bez nowych miast.
5. Co najmniej 10 nowych kart dnia, w tym parodia szału kart kolekcjonerskich z dużą falą klientów od rana. Determinizm.
6. Co najmniej 10 nowych celów: gotówka 250k, 500k, 1 mln i 2 mln; 3, 4 i 5 sklepów; badania Sieci; remonty 4 i 5.
7. Galeria sław. Wpis powstaje, gdy `person.wallet` w zwykłej grze pierwszy raz osiąga 1 000 000 zł. Klient wysyła nick, seed, dzień gry, gotówkę i `SIM_VERSION`. Serwer:
   - stempluje wpis datą serwera;
   - liczy tylko pierwszy wpis na nick;
   - sortuje listę od najwcześniejszego.

   Galeria nie ma sezonów i przeżywa podbicie `SIM_VERSION`. UI pokazuje gratulacje i listę „Galeria sław Traszki”. Zabezpieczenia to sprawdzenia wiarygodności i limit zapytań. Wpisy leżą w Upstash pod osobnym prefiksem, za `RANKING_ENABLED`, bez nowych zmiennych env.
8. Cele na botach: progresja ciągnie się co najmniej do 2–3 mln zł; zaangażowany gracz z 3+ sklepami dochodzi do 1 mln w około rok gry; gracz z jednym sklepem się nie psuje.
9. P2: tłum przed sklepem przy zrzucie kart, kolejne zdarzenia, polerka balansu.

## 5. Projekt

### 5.1 Remonty (`src/sim/economy/upgrades.ts`)

| Poziom | Nazwa | Koszt | Dni | `grow` | `slots` | `minLevel` | Ruch |
|---|---|---|---|---|---|---|---|
| 1 | Remont: dokupienie lokalu obok | **35 000** | 2 | [4, 2, 1] | 4 | 8 | ×1,1 |
| 2 | Remont: wersja Premium | **100 000** | 3 | [8, 4, 2] | 5 | 14 | ×1,2 |
| 3 | Remont: Flagowiec | 200 000 | 4 | [12, 6, 3] | 7 | 20 | ×1,3 |
| 4 | **Remont: Flagowiec Plus** | **450 000** | 5 | [14, 7, 4] | 8 | 28 | **×1,45** |
| 5 | **Remont: Traszka Max Pro Ultra** | **900 000** | 6 | [16, 8, 4] | 9 | 34 | **×1,6** |

Mnożnik ruchu z remontu to dziś `1 + 0.1 × remontLevel`. Zastępuje go `remontTrafficMult(level) = 1 + 0.1 × min(level, 3) + 0.15 × max(0, level − 3)`, który dla poziomów 0–3 daje te same bity.

`Ruling: remonty 4–5 dają po +15 pkt proc. ruchu zamiast +10 — samo +10% przy 450k zwracałoby się ponad 6 lat, bo baseTraffic jest ucięty przez TRAFFIC_RANGE — za mocno: gracz z 5 sklepami szybciej rośnie; strojenie ceny na botach to łapie.`

`Ruling: przy poziomie ≥ 4, gdy generator nie złoży układu żadną skalą, layoutFor zwraca układ poziomu niższego, nie poziomu 0 — sklep po remoncie nigdy się nie zmniejsza; poziomy 1–3 zachowują dzisiejszy fallback, więc GENERATOR_VERSION zostaje — koszt: rzadki sklep L5 wygląda jak L4 (tylko wygląd, mnożnik ruchu i tak liczy się z poziomu).`

`Ruling: układ poziomu ≥ 4 jest przyjęty tylko wtedy, gdy nie jest węższy, płytszy ani uboższy w sloty sprzętu niż układ poziomu niższego (kolejne próby generatora, potem mniejszy przyrost, na końcu układ poziomu niższego) — generator stawia tyle slotów, ile się zmieści, więc większy lokal bywa uboższy w sloty, a gracz po drogim remoncie nie może dostać sklepu gorszego niż miał — koszt: czasem wypada układ nieco mniejszy od idealnego (przyrost 0,75 albo 0,5 zamiast 1); test na 200 seedach i trzech rodzajach lokalu pilnuje szerokości, głębokości i slotów L5 ≥ L4 ≥ L3.`

`Ruling: poziomy 4–5 nie zajmują kolejnego lokalu na mapie miasta (lotState bez zmian), a na ulicy rosną po tej samej stronie przejęcia; zjedzony sąsiad dalej ma co najmniej MIN_TAKEN_NEIGHBOUR_W (4 m), a kartka „DO WYNAJĘCIA” wisi do poziomu 4 — przejęcie drugiego sąsiada to nowa geometria ulicy i miasta — koszt: przy L5 sąsiad bywa wąski (4 m).`

Po poziomie 5 tekst brzmi „Większego sklepu już nie będzie. To jest Traszka Max Pro Ultra.” (także w panelu).

### 5.2 Ulepszenia

**Wyższe `maxLevel`.** Nazwy dopisane na końcu, efekt na poziom bez zmian.

| id | maxLevel | Nowe nazwy poziomów |
|---|---|---|
| szkolenie | 5 → 8 | Kasjer-ninja: czarny pas; Kasjer-ninja: sensei; Kasjer, który skanuje wzrokiem |
| klima | 2 → 3 | Klimatyzacja z zapachem świeżych bułek |
| scoSoft | 3 → 5 | SCO 5.0: pamięta Twoje imię; SCO 6.0: sama się przeprasza |
| wozek | 3 → 5 | Wózek autonomiczny (czasem jedzie do konkurencji); Wózek z napędem rakietowym |
| regaly | 3 → 5 | Regały wysokiego składowania; Zaplecze w czwartym wymiarze |
| ulotki | 5 → 8 | Dron z banerem nad osiedlem; Reklama na tramwaju; Neon widoczny z kosmosu |
| kawa | 3 → 5 | Kawa speciality z ziaren Centrali; Barista-robot z dyplomem |
| traszkapka | 3 → 5 | Program „Traszka Gold”; Powiadomienia push o 4:58 |
| tasmociag | 3 → 5 | Taśmociąg z lotniska (po przetargu); Taśmociąg magnetyczny z demobilu |
| wykladacz | 3 → 5 | Wykładacz z AI (układa według feng shui); Wykładacz, który przeprasza klientów |

**Nowe ulepszenia.** Cena = `baseCost × costMult^poziom`, zaokrąglona do 50 zł (`upgradeCost`).

| id | grupa | nazwa (poziom 1) | efekt na poziom | max | baseCost | costMult | wymaga |
|---|---|---|---|---|---|---|---|
| kasaEkspres | kasa | Kasa ekspresowa „do 5 produktów” (nikt nie liczy) | `tillSpeed` +0,10 | 3 | 45 000 | 2,4 | remont 3, szkolenie 5 |
| ekrany | klienci | Ekrany z reklamą Centrali (Ty płacisz za prąd) | ruch +6% (w sumie `traffic`) | 5 | 60 000 | 2,1 | remont 3 |
| barHot | klienci | Bar hot-food ze stołkami | `hotMult` +0,25 | 4 | 50 000 | 2,3 | remont 3, kawa 3 |
| magazynWys | palety | Magazyn wysokiego składowania | zaplecze +40% (obok +50% regałów) | 3 | 80 000 | 2,5 | remont 4, regały 3 |
| dron | warsztat | Dron-inwentaryzator z odkurzacza | kradzież (WUT `kradziez` i SCO) −12% | 3 | 70 000 | 2,4 | remont 3, wykładacz 2 |

`Ruling: maszyny warsztatu na poziomach 4–5 wyglądają jak na poziomie 3 (render przycina MachineLevel do 3) — modele mają tablice kolorów na 3 poziomy — koszt: brak nowej grafiki, zero ryzyka awarii renderu.`

### 5.3 Badania Sieci (`src/sim/firm/research.ts`)

Badania działają, gdy otwarte są co najmniej 2 sklepy, i tylko w zwykłej grze. Płaci się gotówką z portfela osoby, bez rat. Wydatek trafia do `monthInvest`, czyli do podsumowania sieci. Poziom badania zostaje na zawsze.

Każde badanie zmienia jedno pole `NetMods`: `1 ± min(cap, perLevel × poziom × skala)`. Skala zależy od liczby otwartych sklepów: `NET_SCALE = [0, 0, 1, 1.5, 1.8, 2]` (indeks to liczba sklepów, od 5 w górę 2). Każdy kolejny sklep dokłada więc mniej. Cena = `round(baseCost × costMult^poziom / 100) × 100`.

| id | nazwa | pole | perLevel | cap | max | baseCost | costMult | suma cen |
|---|---|---|---|---|---|---|---|---|
| dostawy **[W]** | Wspólne dostawy | `logistics` − | 0,10 | 0,60 | 3 | 25 000 | 2,0 | 175 tys. |
| obsada **[W]** | Wspólna obsada (grafik sieci) | `wages` − | 0,03 | 0,25 | 4 | 60 000 | 2,0 | 900 tys. |
| marketing | Wspólny marketing | `traffic` + | 0,025 | 0,30 | 5 | 50 000 | 1,8 | ok. 1,12 mln |
| magazyn | Centralny magazyn | `backroom` + | 0,10 | 0,50 | 3 | 30 000 | 2,2 | ok. 241 tys. |
| lojalnosc | Program lojalnościowy „Traszka+” | `basket` + | 0,015 | 0,20 | 5 | 80 000 | 1,9 | ok. 2,11 mln |
| media | Grupa zakupowa prądu | `media` − | 0,05 | 0,30 | 3 | 35 000 | 2,0 | 245 tys. |

Badania łącznie kosztują ok. 4,8 mln zł. Remonty 4–5 to 1,35 mln zł na sklep, czyli 6,75 mln przy 5 sklepach.

**Droga do sklepu.** `SiteMods` dostaje opcjonalne pole `net?: NetMods` (`traffic`, `basket`, `wages`, `media`, `logistics`, `backroom`). Ustawia je `refreshSites`, gdy `netMods(research, open) !== null`. Ekonomia czyta je jak flagę (`info.site?.net`), za gałęzią, w sześciu miejscach:
- `traffic` w `effects()`;
- `basket` w `sell()`: obrót i marża;
- `wages` przy naliczaniu płac;
- `media` przy mediach dnia;
- `logistics` przy opłacie za palety ponad przydział;
- `backroom` w `effects().backroomCap`.

Pole `net` nie wchodzi do `districtNeutral`, więc nie włącza gałęzi dzielnicy.

`Ruling: opłata koordynacyjna Centrali to 20% ceny badania pokazane w UI jako „w tym opłata koordynacyjna Centrali: X zł” (coordinationFee = round(cena × 0,2 / 100) × 100), bez osobnego obciążenia w symulacji — satyra bez nowej pozycji wyciągu — koszt: żart tylko w tekście.`

`Ruling: przy powrocie do jednego sklepu badania zostają kupione, ale nie działają (skala 0, sklep startowy znów bez site), a sklep startowy gra wtedy jak dziś co do bitu — zgodne z [W] „jeden sklep nie dostaje nic” — koszt: gracz może czuć stratę; UI mówi „działa od 2 sklepów”.`

`Ruling: widełki na karcie lokalu nie uwzględniają badań Sieci (uwzględniają kanibalizację) — badania zmieniają się po otwarciu, a karta pokazuje lokal — koszt: lekkie niedoszacowanie, miła niespodzianka.`

### 5.4 Do 5 sklepów (`src/sim/firm/*`, `src/sim/city/traffic.ts`)

- `MAX_STORES = 5` to twardy limit. `FirmState.storeLimit` (3, 4 albo 5, nigdy nie maleje) mówi, ile placówek Centrala pozwala mieć naraz, licząc budowy. `rentRefusal` zwraca `limit` przy `open + builds ≥ storeLimit`.
- **Odblokowanie:** sprawdzane przy zamknięciu miesiąca w kilku sklepach (`network-report`). Obrót sieci to suma `report.counters.revenue` raportów z tej minuty. Gdy obrót ≥ `STORE_UNLOCK_TURNOVER[storeLimit]` (`{3: 1 000 000, 4: 1 600 000}`), `storeLimit` rośnie o 1 (najwyżej o 1 na miesiąc) i przychodzi zdarzenie firmy `unlock`. Tekst: „Centrala zgadza się na czwartą placówkę. Obrót sieci X zł przekonał Dział Ekspansji, który zaraz potem wyszedł na lunch.”
- **Kanibalizacja:** `OWN_RADIUS_M = 150`, `OWN_FACTOR = 0.9` **[W] start**. `siteFor` i `lotEstimate` dostają `own: readonly number[]`, czyli lokale innych otwartych sklepów firmy. Natężenie lokalu mnoży się przez `OWN_FACTOR` za każdy własny sklep bliżej niż 150 m, pętlą jak rywale, bez `**`. Nowa funkcja `ownNear(city, lotId, own)` jest dla karty lokalu.

`Ruling: próg odblokowania to miesięczny obrót sieci (1,0 mln zł dla 4., 1,6 mln dla 5.), a nie cel ani gotówka — Centrala „patrzy na KPI”, a trzy nieulepszone sklepy robią ok. 0,9–1,0 mln (raport 4a.1), więc czwarty wymaga inwestycji w sklepy — koszt: zły próg; gałka strojenia w zadaniu balansu (0,8–1,2 mln i 1,3–2,0 mln).`

`Ruling: lokal startowy nie traci ruchu przez własne sklepy obok (jak przy rywalach w 4a.1: siteFor zwraca NEUTRAL_SITE), traci go tylko sklep niestartowy — sklep startowy ma grać jak zatwierdzony balans 4a.1 — koszt: gracz może otworzyć sklep tuż obok startowego bez kary dla startowego; kara spada na nowy sklep i widać ją na karcie lokalu.`

### 5.5 Karty dnia (`src/sim/economy/tycoon/deck.ts`, na końcu `DECK`)

Waga kart zależy od dzielnicy przez nowy pomocnik `byDistrict({ none, osiedle, srodmiescie, dworzec, biurowce })`. `none` to sklep bez aktywnej dzielnicy. `k` to skala z `deck.ts`, a dM to `dailyMargin`.

| id | tytuł | `at` | cooldown | wagi none/os/śr/dw/bi | odpowiedzi (domyślna pogrubiona) |
|---|---|---|---|---|---|
| karty-zrzut | Zrzut Traszkomonów | 6:00 | 18 | 0,8/1,0/0,9/0,6/0,5 | **Limit 2 saszetki**: ruch +0,9 od 6:00 przez 360 min, staffMinutes 40, trust +1, reputacja +1 · Bez limitu: ruch +1,6 od 6:00 przez 240 min, ryzyko 0,5 (reputacja −3, WUT 0,15 dM) · Odsyłam karton: trust −2 |
| festyn | Festyn osiedlowy z pierogami | 9:00 | 21 | 0,6/1,4/0,4/0,3/0,3 | Stoisko z hot-dogami: gotówka −0,1 dM, staffMinutes 90, ruch +0,3 i marża +0,15 od 10:00 przez 480 min · Plakat „Zimne napoje obok”: −0,02 dM, ruch +0,2 przez 480 min · **Nic** |
| sanepid | Sanepid na rowerze | 11:00 | 25 | 1/1/1/1,2/0,8 | **Oprowadzam**: staffMinutes 30, ryzyko (czystość < 60: 0,6, inaczej 0,1) gotówka −1,5 × `FINE_BASE`, trust −2 · Kawa na koszt firmy: −15 zł, ryzyko 0,3 trust −3 |
| awaria-pradu | Awaria prądu na pół dzielnicy | 14:00 | 30 | 0,7 wszędzie | Agregat od szwagra: −0,15 dM, staffMinutes 30 · **Zamykam na 2 h**: `closed` 120 min, WUT 0,05 dM · Sprzedaję po ciemku: ruch −0,3 przez 120 min, ryzyko 0,4 WUT 0,2 dM |
| rozkopy | ZDM rozkopał chodnik | 7:00 | 30 | 0,8/0,8/1,2/0,8/0,8 | Kładka z palet: −0,08 dM, staffMinutes 45, ruch −0,1 przez 3 dni · **Nic**: ruch −0,3 przez 3 dni |
| koncert | Koncert disco polo na stadionie | 16:00 | 21 | 0,5/0,6/1,3/1,3/0,4 | Zatowarowuję napoje: logistyka +`PALLET_FEE`, staffMinutes 30, ruch +0,6 i marża +0,05 od 18:00 przez 300 min · **Zamykam o 22**: ruch +0,3 od 18:00 przez 240 min · Ochroniarz (szwagier): −0,04 dM, ruch +0,6 od 18:00 przez 300 min |
| elearning | Obowiązkowe e-learningi Centrali | 8:00 | 30 | 0,8 wszędzie | W godzinach pracy: staffMinutes 180, trust +2 · Klikam za wszystkich: staffMinutes 20, ryzyko 0,35 trust −4 · **Ignoruję**: trust −2 |
| catering-korpo | Korporacja zamawia kanapki na spotkanie | 9:00 | 10 | 0,3/0,2/0,8/0,3/2,0 | **Przyjmuję** (n = 40–100): gotówka +4n, staffMinutes 60, ryzyko 0,2 gotówka −4n („spotkanie odwołano mailem o 8:59”) · Odmawiam: reputacja −1 |
| kibice | Pociąg z kibicami | 15:00 | 14 | 0,3/0,2/0,6/2,0/0,1 | Ochrona przy wejściu: −0,05 dM, ruch +0,5 od 16:00 przez 180 min · Zamykam do odjazdu: `closed` 120 min od 16:00 · **Normalna praca**: ruch +0,5 od 16:00 przez 180 min, ryzyko 0,6 WUT 0,25 dM i reputacja −2 |
| bon-centrali | Bon motywacyjny od Centrali | 10:00 | 40 | 0,6 wszędzie | Biorę palety marki własnej: gotówka +0,2 dM, logistyka +`PALLET_FEE` · **Zostawiam na lepsze czasy**: nic („bon wygasł po 3 dniach, zgodnie z regulaminem ogłoszonym po 2 dniach”) |
| ai-inwentaryzacja | Centrala testuje AI do liczenia towaru | 6:00 | 45 | 0,5 wszędzie | Zgłaszam sklep do pilotażu: trust +3, ryzyko 0,5 WUT 0,1 dM („AI policzyło kota jako 14 batonów”) · **Grzecznie odmawiam**: trust −1 |
| wybory | Lokal wyborczy w szkole obok | 7:00 | 60 | 1,0/1,3/0,8/0,5/0,5 | Promocja „Kawa obywatelska”: ruch +0,25 od 7:00 przez 600 min, marża −0,05 · **Nic**: ruch +0,15 od 7:00 przez 600 min |

`Ruling: jednodniową falę wyraża istniejący efekt mods {kind: 'traffic', from, minutes}; nowego typu efektu nie dodajemy — ModDef.from już istnieje i jest w zapisie — koszt: brak.`

`Ruling: parodystyczna nazwa to „Traszkomony” (saszetki kart, edycja „Błyszcząca Kasjerka”) — swoja marka gry, bez cudzej — koszt: brak.`

Nowe karty zmieniają losowanie talii każdego sklepu. To w porządku, bo `SIM_VERSION` 7 jest podbity.

### 5.6 Cele

**Cele firmy** (`src/sim/firm/goals.ts`, `FIRM_GOALS`) są tylko w zwykłej grze. Nagroda to Ogonki do portfela osoby, bez XP. Odbiera się je kliknięciem, poleceniem `claimGoal`. Cel spełniony trafia do `goals.ready` i daje zdarzenie `goal`.

| id | nazwa | warunek | Ogonki |
|---|---|---|---|
| cash250k | Ćwierć bańki na koncie | `person.wallet` ≥ 250 000 | 30 |
| cash500k | Pół bańki | ≥ 500 000 | 50 |
| cash1m | Milioner spod znaku Traszki | ≥ 1 000 000 | 100 |
| cash2m | Dwa miliony (Centrala pyta, czy nie za dużo) | ≥ 2 000 000 | 150 |
| stores3 | Trzy placówki | otwarte sklepy ≥ 3 | 40 |
| stores4 | Czwarta placówka | ≥ 4 | 60 |
| stores5 | Sieć pełna: pięć Traszek | ≥ 5 | 100 |
| research1 | Pierwsze badanie Sieci | suma poziomów badań ≥ 1 | 20 |
| research10 | Dziesięć poziomów badań | suma ≥ 10 | 60 |
| researchAll | Wszystkie badania Sieci | każde badanie ≥ 1 | 80 |

**Cele sklepu** trafiają na koniec `MILESTONES` i działają też w rankingu:
- `remont4`: „Flagowiec Plus”, `remontLevel` ≥ 4, 80 Ogonków;
- `remont5`: „Traszka Max Pro Ultra”, ≥ 5, 120 Ogonków;
- `earned1m`: „Milion marży w jednym sklepie”, `total.margin` ≥ 1 000 000, 80 Ogonków.

`Ruling: cele gotówki i liczby sklepów są celami firmy, nie sklepu — w MILESTONES każdy sklep odebrałby je osobno, a w rankingu Ogonki spoza ekonomii rozjechałyby sędziego — koszt: dwie listy celów w UI (sekcja „Sieć” w Celach).`

### 5.7 Galeria sław

**Wyzwalacz.** Pod koniec `stepFirmMinute`, gdy `!ranked`, `fame === null` i `person.wallet ≥ FAME_CASH` (1 000 000), firma ustawia `fame = { day, cash }` i wysyła zdarzenie `million`. Zapis firmy, w którym wallet już przekracza milion, dostaje zdarzenie w pierwszej minucie po wczytaniu.

**Serwer** (`src/server/fame.ts`, `api/fame/list.ts`, `api/fame/submit.ts`, za `route()` i `RANKING_ENABLED`):
- `POST /api/fame/submit` z `{ key, nick, seed, day, cash, simVersion }`, ciało ≤ `SMALL_BODY_BYTES`. Sprawdzenia po kolei: metoda; `early` limitu; JSON; klucz (`bad-key`); `normalizeNick` (`bad-nick`); limit `fame`; nick zarezerwowany przez innego właściciela (`nick-taken`); wiarygodność (`fame-invalid`: seed to tekst o 1–`RUN_MAX_SEED_CHARS` punktach kodowych, `day` całkowite z [90, 36 500], `cash` skończone z [1 000 000, 1e12], `simVersion` całkowite z [7, 999]); budżet dzienny `fame` 300 (`fame-budget`).
  Zapis to `SET tr:fame:e:{nickKey} {nick, seed, day, cash, simVersion, at} NX`, potem `ZADD tr:fame:list NX at nickKey`. Gdy wpis już był, serwer go nie zmienia, ponawia `ZADD NX` z jego `at` (naprawa) i zwraca `{ ok, first: false, entry }`.
- `GET /api/fame/list` bez parametrów (inny parametr daje 400), `cache-control: BOARD_CACHE`. Zwraca `{ ok, total, rows: [{ place, nick, at }] }`: pierwsze 100 wpisów (`ZRANGE 0 99 WITHSCORES` i `MGET`).
- Limit: `RATE_LIMITS.fame = { window: 3600, perKey: 5, perAddress: 20 }`. Nowe kody błędów: `fame-invalid` (422) i `fame-budget` (429).

`Ruling: prefiks kluczy tr:fame: (nie tr:lb:) i bez SIM_VERSION w kluczu — dzięki temu reset rankingu go nie dotyka — koszt: brak.`

`Ruling: wpis do Galerii nie rezerwuje nicka (claimNick zostaje dla biegów), ale nie przyjmuje nicka zarezerwowanego przez kogoś innego — Galeria nie ma zmieniać rankingu — koszt: nick wolny dziś może jutro zarezerwować ktoś inny; wpis Galerii zostaje przy pierwszym autorze.`

`Ruling: dzień ≥ 90 — przed statusem Partnera (dzień 60) i budową drugiego sklepu żadna strategia botów nie zbliża się do miliona (najszybsza „mistrz z zakupami i ekspansją, rotacja” to 16 miesięcy w 4a.1) — koszt: przy zbyt niskim progu fałszywy wpis jest odrobinę łatwiejszy, ale i tak nie jest weryfikowany.`

`Ruling: MemoryRedis dostaje ZRANGE (z WITHSCORES), żeby lista szła od najwcześniejszego bez sztuczki z ujemnym wynikiem — czytelniej — koszt: kilka linii atrapy z testem.`

**Klient.** `RankingClient` dostaje `fameList()` i `fameSubmit(key, entry)`. Zdarzenie `million` otwiera `FameWindow` („Milion! Centrala jest w szoku, księgowa w euforii.”) z nickiem z mety i przyciskiem „Wpisz mnie do Galerii sław”. Po sukcesie seed trafia do `meta.fameSent`. Gdy wysyłka się nie uda, UI pokazuje komunikat, a przycisk „Wyślij mój wpis” zostaje w zakładce Galerii, dopóki firma ma `fame`, a seed nie jest w `fameSent`. `RankingPanel` dostaje zakładkę „Galeria sław” z listą „miejsce, nick, data” i komunikatem „Galeria jest teraz nieczynna”, gdy API nie odpowiada.

### 5.8 Zapis i wersje

`FirmState` dostaje cztery pola:
- `research: Partial<Record<ResearchId, number>>`;
- `storeLimit: number`;
- `goals: { ready: string[]; claimed: string[] }`;
- `fame: { day: number; cash: number } | null`.

Wszystkie trafiają do koperty (`firm`), a `FIRM_SAVE_SCHEMA` rośnie do 4. Odczyt schematu 3 (i 1–2 przez `createFirm`) daje `research {}`, `storeLimit 3`, puste `goals` i `fame null`. Przy odczycie:
- poziomy badań przycina `maxLevel`;
- `storeLimit` przycina się do [3, 5]. Gdy otwartych sklepów razem z budowami jest więcej niż `storeLimit`, rośnie do tej liczby: zapis z gry nie mógł jej przekroczyć;
- cele firmy przechodzą filtr po znanych id (najwyżej `FIRM_GOALS.length` wpisów każda lista);
- `fame` musi mieć liczbę całkowitą `day` i skończoną `cash`, inaczej jest null.

`research` i `storeLimit` trzeba wczytać **przed** `refreshSites`, bo `site.net` powstaje z nich.

`Ruling: FIRM_SAVE_SCHEMA 4 mimo addytywnych pól — stara karta przeglądarki (sprzed wdrożenia) widzi isNewerSave i nie nadpisze zapisu z remontem 5, ucinając go do 3 i gubiąc badania — koszt: „Wyślij zapis” ze starej wersji na nową działa, w drugą stronę odmawia (tak ma być).`

`Ruling: paczka „Wyślij zapis” jest kompaktowana: sklepy poza aktywnym bez lastReport (null), każda historia do ostatnich 12 miesięcy, skrzynka do ostatnich 10 wpisów (compactForTransfer w saveTransfer.ts); zapis lokalny bez zmian — 3 sklepy po roku ważą 35,7 KB, więc 5 po 24 miesiącach przekroczyłoby 64 KB — koszt: na drugim urządzeniu znika ostatni raport sklepów w tle i historia starsza niż rok (limit rat i status Partnera patrzą na ostatnie miesiące).`

### 5.9 UI i render

- **Panel Miasto.** Nowa sekcja „Sieć: badania” (`src/ui/city/ResearchSection.tsx`). Pokazuje cenę, opłatę koordynacyjną, efekt przy obecnej liczbie sklepów i poziom `n/max`. Przy jednym sklepie: „Działa od 2 sklepów”. Odmowa `limit` mówi o progu obrotu (`limitText(f)`). Karta lokalu pokazuje własny sklep w promieniu: „Twoja Traszka 120 m stąd: −10% ruchu”.
- **Sklep → Ulepszenia.** Nowe ulepszenia pojawiają się same (`UPGRADES`). Remont po poziomie 5 pokazuje „To już Traszka Max Pro Ultra…”. Przy 2+ sklepach jest podpowiedź „Badania Sieci znajdziesz w panelu Miasto”.
- **Cele.** Sekcja „Sieć” w `GoalsPanel`: gotowe do odbioru (przycisk „Odbierz”) i 3 najbliższe.
- **Zdarzenia firmy.** `unlock`, `goal` (toast), `million` (okno OK i `FameWindow`), `research` (toast). Teksty są w `firmText.ts`.
- **Render.** `planRow` daje kartkę „DO WYNAJĘCIA” na poziomach 0–4; ulica i kamera mieszczą sklep L5 (najszerszy pawilon: 26 + 16 = 42 kratki); robot rysuje się z `min(poziom, 3)`.

### 5.10 Balans na botach

Nowy pomiar `tests/measure/progresja.measure.test.ts` korzysta ze strategii `jeden`, `trzy` i `siec`:
- `jeden` to mistrz z zakupami w jednym sklepie;
- `trzy` jak w 4a.2;
- `siec` to mistrz z zakupami i rotacją, który wynajmuje sklepy do limitu, gdy rata albo gotówka pozwala, i raz dziennie kupuje najtańsze dostępne badanie, gdy po zakupie zostaje ≥ 50 000 zł.

Seedy: `traszka-1,kopytka-541,makieta,lublin-9,seed-3`. 24 miesiące.

**Bramki (asercje pomiaru).**
- **B1:** `siec`, mediana miesiąca, w którym portfel pierwszy raz ≥ 1 mln, mieści się w [10, 15], a żaden seed nie przekracza 18.
- **B2:** `siec`, w miesiącu pierwszego 2 mln suma cen rzeczy jeszcze niekupionych (remonty, badania, ulepszenia do `maxLevel` w otwartych sklepach) ≥ 1 000 000.
- **B3:** `jeden`: zero końców gry i zero ostrzeżeń o debecie. Średni wynik m. 13–24 ≥ 0,95 × wartość bazowa.
- **B4:** `mistrz` i `bierny`: gotówka m. 12 w ±8% wartości bazowej.
- **B5:** `tests/districtBalance.test.ts` bez zmiany progów.

Wartości bazowe mierzy się na commicie bazowym etapu (przed zmianami) i zapisuje w raporcie.

**Gałki strojenia, po kolei:**
1. `perLevel` badań (±50%);
2. `NET_SCALE`;
3. `OWN_FACTOR` (0,85–0,95);
4. progi odblokowania;
5. ceny remontów 4–5 (400–600k i 800k–1,2 mln).

Liczb 4a.1 nie ruszamy.

`Ruling: B1 liczy się z portfela bota, który wydaje wszystko, co może — gracz-oszczędzacz dojdzie szybciej, a [W] mówi „zaangażowany” — koszt: przy innym stylu gry milion przyjdzie inaczej niż za rok.`

## 6. P2 (do wycięcia)

- Tłum przed sklepem przy `karty-zrzut`. Gdy aktywna jest karta zrzutu z modyfikatorem ruchu ≥ 1,8, przed wejściem stoi kolejka 6–12 postaci z puli tłumu.
- Kolejne karty: upał, matury, Black Friday Centrali.
- Polerka balansu po raporcie.
- Hasła słowniczka „Badania Sieci” i „Galeria sław”. Licznik słowniczka w smoke samouczka rośnie wtedy z 14 do 16.

## 7. Ryzyka

- **Rozmiar zapisu przy 5 sklepach.** Pilnuje go test rozmiaru z kompaktowaniem.
- **Generator przy `slots` 8–9.** Pilnuje go test na 200 seedach i fallback do poziomu niższego.
- **B1 może wymagać mocniejszych badań, niż „uczciwie” wygląda.** Raport pokaże liczby, a strojenie zostaje w granicach gałek.
- **Galeria bez weryfikacji jest do sfałszowania.** To świadoma decyzja **[W]**. Ograniczają to limity i budżet dzienny.
- **Zmiany w `economy.ts` (6 haków `net`, 5 ulepszeń).** Gra jednym sklepem musi zostać co do bitu taka jak bez Sieci. Pilnuje tego test neutralności.

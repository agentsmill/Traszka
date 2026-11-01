# Etap 4a.2: pełne miasto — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** dzielnice dostają profil dnia i trudnych klientów (z kartami tylko dla Dworca), gracz może prowadzić trzy sklepy i znów wziąć lokal „po Traszce” z wyposażeniem za ok. 30% pakietu, a ekran Miasta dostaje makietę 3D z autami i drzewami, przełączaną przyciskami „Makieta / Ruch / Dzielnice”.

**Architektura:** plan ma dwie części, które da się scalić osobno.
- **Część A, rozgrywka (Zadania 1–9).** Wszystko, co liczy, siedzi w czystym `src/sim`.
  - Profil dnia i mnożnik trudnych klientów wchodzą do ekonomii tak jak dzielnica w 4a.1: przez opcjonalne `StoreInfo.site`. Brak pola to dzisiejsza gra co do bitu.
  - Karty Dworca dopisujemy na końcu `DECK`. Bez Dworca mają wagę 0, więc nie przesuwają losowania.
  - Ponowny wynajem otwiera z powrotem zamknięty wpis sklepu w firmie: to samo `id`, lokal, seed i układ.
  - Część A kończy się balansem na botach i smoke'iem. Po Zadaniu 9 można ją scalić i wdrożyć bez makiety.
- **Część B, makieta 3D (Zadania 10–15).** Tylko render i UI, za bramką benchmarku (Zadanie 13).
  - Budynki proceduralne z fasadami z `facadeAtlas.ts`, sklejone w chunki.
  - Warstwy „Ruch” i „Dzielnice” to ta sama geometria: spłaszczona i z podmienionym materiałem.
  - Drzewa i auta to `InstancedMesh`; profil miasta zależy od presetu i telefonu.
  - Gdy makieta nie przejdzie bramki na telefonie, przycisk „Makieta” znika tam z `CITY_PROFILES`, a rozgrywka zostaje nietknięta.

**Technologie:** TypeScript, Vitest, three.js 0.186, Preact + @preact/signals, Vite 8, headless Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-10-31-etap-4a-miasto-design.md` (zatwierdzony 2026-10-31). Plan obejmuje część 4a.2:
- §2 „Cele 4a.2” i tabela §5;
- §8.1 (profil dnia, trudni klienci), §8.2, §8.3, §8.4;
- §9.1–§9.3, §10.2 (limit 3), §13.3, §14.2;
- §16 (zapis trzech sklepów), §18, §19 „4a.2”, §20 „4a.2”, §22.

Numery „§” niżej odnoszą się do tego specu.

**Podstawa:**
- plan 4a.1 `docs/superpowers/plans/2026-10-31-etap-4a1-miasto.md` (zrobiony, na produkcji);
- raport `docs/superpowers/reports/2026-10-31-miasto-4a1.md`. Decyzja właściciela z 1.11.2026 („Zostaw jak jest”, §7 raportu): balans 4a.1 zostaje bez zmian.

**Poza zakresem:**
- rogalik (przejęcie w sztafecie, następca). Ponowny wynajem działa dla każdego, kto ma status Partnera, więc §14.2 („następca może je znów wziąć”) nie wymaga osobnej pracy;
- ruchy AI konkurencji, tłum pieszych na ulicach miasta, więcej niż 3 sklepy, ranking z ekspansją;
- nowe dymki samouczka (§17 ich dla 4a.2 nie przewiduje);
- przegląd etapu (Opus, §20) zleca koordynator po Zadaniu 15.

## Global Constraints
- **Ranking i liczby wersji bez zmian:**
  - `SIM_VERSION` zostaje 6, `GOLDEN` i `tests/simGolden.test.ts` bez zmian;
  - `GENERATOR_VERSION` zostaje 1;
  - `CITY_GENERATOR_VERSION` zostaje 1, a `CITY_GOLDEN` bez zmian, bo 4a.2 nie zmienia miasta istniejących zapisów (§5). Profil i trudni klienci żyją w `DISTRICTS` i `SiteMods`, nie w `CityState`.
  - Gracz bez ekspansji i bieg rankingowy grają bit w bit jak dziś (§2, anty-cele).
- **Zasada neutralności (§8.3):**
  - „Brak pola to dzisiejsza gra co do bitu. Modyfikator pomija się gałęzią, a nie mnoży przez 1.”;
  - „Nowa karta z wagą 0 nie może przesunąć losowania talii.”;
  - sklep startowy w sieci ma `site` z samymi flagami i nie dostaje ani profilu, ani kart dzielnicy.
- **Kształt `EconomyState` się nie zmienia:** żadnych nowych pól, także opcjonalnych i w obiektach zagnieżdżonych. Nowe pola wolno dodać tylko poza stanem: `SiteMods`, `CardContext`, `FirmStore`, koperta zapisu.
- **Sędzia nie dostaje miasta ani firmy:** `src/sim/run.ts`, `src/sim/ranked.ts` i `scripts/judge-entry.ts` nie sięgają do `src/sim/city` ani `src/sim/firm` (test architektury). Zmiany w `economy.ts`, `cards.ts` i `deck.ts` są w ścieżce sędziego, więc muszą być neutralne bez `site`. Nie ruszamy `src/server/**`, `src/sim/ranked.ts`, `src/game/rankedRun.ts`, zapisu `traszka:ranked` ani `SAVE_SCHEMA` 2.
- **Determinizm (§3.2):** w `src/sim` nie ma `Math.random`, `Date` ani three.js. Sklepy liczą się po `id`. Render miasta też nie losuje: drzewa, auta i warianty budynków biorą się ze skrótu numeru, jak `unit(id)` w `buildCity.ts`.
- **Zapis:**
  - koperta zostaje w `FIRM_SAVE_SCHEMA = 3` pod `traszka:save:<seed>`;
  - nowe pole sklepu w kopercie (`reopened`) pojawia się tylko wtedy, gdy jest `true`, więc koperty istniejących fixtures są co do znaku takie same;
  - paczka „Wyślij zapis” w najgorszym przypadku 4a.2 (3 sklepy, każdy po dwóch remontach, koniec roku) ma ≤ 64 KB (`SAVE_TRANSFER_MAX_BYTES`). Gdy się nie mieści, wykonawca staje i zgłasza pomiar, a limitu nie podnosi;
  - produkcji nie wolno cofać przed b54d33c (schemat 3), a po wdrożeniu Zadania 4 także przed jego commit. Kod 4a.1 odrzuciłby budowę w lokalu „po Traszce” (pakiet zapłacony gotówką by przepadł) i dałby gwarancję ponownie otwartemu sklepowi #1. To uwaga do opisu PR.
- **Balans 4a.1 zostaje, jak jest** (decyzja właściciela 1.11.2026):
  - nie stroimy `traffic`, `weekendTraffic`, `basket`, `patience`, `repPenalty`, `theft`, `rivals`, `package`, `buildDays` w `DISTRICTS`;
  - zostają `RIVAL_RADIUS_M = 150`, `RIVAL_FACTOR = 0.8`, `PARTNER_MONTHS = 2`, `PARTNER_TRUST = 75`, spadek zaufania sklepu w tle i teksty odmów Centrali;
  - przegląd 4a.2 stroi tylko to, co 4a.2 dodaje: `hours`, `difficult`, liczby kart Dworca, `RELET_SHARE` i `RELET_BUILD_DAYS`. Cele §8.4 mają się dalej trzymać.
- **Liczby z projektu:**
  - najwyżej 3 sklepy, wliczając budowę (§10.2);
  - lokal „po Traszce”: pakiet ok. 30% ceny, sklep z wyposażeniem (ulepszenia, sprzęt, poziom remontu, układ), poziom 1, reputacja 50, zaufanie 65 (§13.3);
  - godziny otwarcia wszędzie 6:00–23:00, a profil dnia zmienia tylko rozkład klientów (§8.1).
- **Tłumaczenie:**
  - każdy nowy tekst UI, w scenie i na kartach ma wersję angielską (`EN_UI`, `EN_RENDER`, `EN_CARDS`, `EN_PLURALS`);
  - `tests/i18n.test.ts` przechodzi bez nowych pozycji w `SKIP`;
  - ton z `docs/i18n/glossary-en.md` („ex-Traszka unit”, *opening package*, *Head Office*);
  - teksty Centrali z §10 bez skracania.
- **Render (§19):**
  - całe miasto w makiecie, z drzewami, autami i przebiegiem cieni, ma mniej niż 150 wywołań rysowania; widok warstw mniej niż 60;
  - drzewa i auta przez `InstancedMesh`;
  - profile: Niska i telefon bez cieni i bez aut, z warstwą na start; Średnia z cieniami statycznymi i autami; Wysoka z N8AO;
  - na telefonie scena miasta zwalnia się po wyjściu z zakładki;
  - `?bench=1` ma ujęcie miasta.
- **Telefon 390 px bez poziomego przewijania.** Smoke mierzy osobno dokument i każde widoczne okno, arkusz, kartę lokalu i listę sklepów, jak w 4a.1.
- **Smoke tylko w headless Playwright**, bez panelu przeglądarki w aplikacji:
  - każdy kontekst z `locale: 'pl-PL'`, rozmiary 390×844 (dotyk) i 1280×800;
  - `**/api/**` przerwane, a ruch poza localhost zablokowany i policzony (nic nie trafia do rankingu).
- **Bramki:** `npm run build` przed `npm test`, bo stary, nieśledzony `src/server/judgeBundle.js` daje fałszywe 503 w `api.test.ts`. Potem `npm run check:vercel-build`. Commity w stylu repo (`feat(miasto): …`).
- Gdyby któreś ograniczenie okazało się niemożliwe, wykonawca staje i pyta koordynatora. `SIM_VERSION` nie podbija sam.

## Review Focus
1. **Ponowny wynajem lokalu startowego.** Sklep #1 zamknięty przez zaufanie 0 przy działającym #2, potem wzięty znów:
   - #1 wraca na pierwsze miejsce listy z seedem gry i układem po remontach;
   - nie dostaje gwarancji 25 tys. zł, także wtedy, gdy później zostaje jedynym sklepem;
   - zapis i odczyt tego nie zmieniają.

   Test: Zadanie 4.
2. **Budowa w lokalu „po Traszce” i przeładowanie strony.**
   - Lokal w budowie ma na mapie stan `budowa`, a nie `po-traszce`.
   - Zapis z budową wraca z tą budową, a sklep otwiera się w jej dniu z wyposażeniem odtworzonym z `ClosedFittings`, tak samo jak bez zapisu.

   Test: Zadanie 4.
3. **Profil dnia nie zmienia doby.** Biurowce, Śródmieście i Dworzec mają tę samą sumę klientów doby co bez profilu.
   - Nie zmieniają się `expectedDailyCustomers`, widełki na karcie lokalu ani cel KPI tygodnia.
   - Sobota w Biurowcach to ten sam kształt dnia razy `weekendTraffic`.

   Test: Zadanie 1.
4. **Trzy sklepy na 390 px.** Okno miesiąca z czterema zakładkami („Sieć” i trzy wyciągi), protokół remanentu, podgląd końca miesiąca i lista chipa z ostrzeżeniem o zaufaniu mieszczą się bez poziomego przewijania. Zapis trzech sklepów ma ≤ 64 KB. Testy: Zadania 3, 6 i 9.
5. **Makieta przy zmianie trybu, presetu i zakładki.**
   - Po spłaszczeniu kotwice pinezek i `pickLot` trafiają w dachy.
   - W warstwach, na Niskiej i na telefonie aut nie ma.
   - Na telefonie wyjście z zakładki zwalnia scenę (licznik geometrii), a powrót buduje ją od nowa bez wycieku.

   Testy: Zadania 11, 12 i 15.

## Rozstrzygnięcia (spec milczy albo jest niejednoznaczny)
1. **Profil dnia jest znormalizowany do sumy `HOUR_CURVE` (15,6).**
   - Dlaczego: §8.1 mówi „Profil dnia zmienia tylko rozkład klientów”.
   - Koszt pomyłki: gdyby profil miał zmieniać dobę, zmienia się jedna funkcja `siteHours`.
2. **Jeden kształt dnia na dzielnicę dla wszystkich dni.**
   - Dlaczego: weekend Biurowców już ma `weekendTraffic`.
   - Koszt pomyłki: drugi wektor w `DistrictDef`.
3. **„Trudni klienci” to istniejąca karta `wiek` z mnożnikiem dzielnicy (`difficult`) plus trzy karty tylko dla Dworca.**
   - Dlaczego: nowa karta ogólna z wagą > 0 przesunęłaby talię sklepu startowego.
   - Koszt pomyłki: kolejne „trudne” karty dla wszystkich dzielnic dostałyby wagę 0 bez dzielnicy.
4. **Ponowny wynajem otwiera ten sam wpis sklepu** (`id`, lokal, seed, układ), a nie dokłada nowego.
   - Dlaczego: odczyt zapisu 4a.1 wymaga różnych lokali i #1 w lokalu startowym. Gracz widzi znów „Traszka #2, Lipowa”.
   - Koszt pomyłki: nowe `id` wymagałoby zmiany walidacji zapisu i zerwania zgodności wstecz.
5. **Lokal startowy też można wziąć znów**, ale sklep po ponownym wynajmie (`reopened`) nigdy nie ma gwarancji.
   - Dlaczego: §11.2 mówi, że gwarancja jest dla nowych partnerów.
   - Koszt pomyłki: jedna flaga.
6. **Ponowny wynajem:**
   - pakiet to `round(package × 0,3 / 100) × 100`;
   - raty z tego samego `planFor` (6 albo 12 rat);
   - budowa trwa 2 dni (`RELET_BUILD_DAYS`), bo urządzenie lokalu zostało.

   Koszt pomyłki: dwie stałe, które i tak stroi Zadanie 8.
7. **Wyposażenie wchodzi do `createEconomy` opcjonalnym argumentem `fittings`**, przed celem KPI i kartami dnia 0.
   - Dlaczego: skala sklepu z wyposażeniem ma liczyć się od pierwszej minuty.
   - Koszt pomyłki: parametr w ścieżce sędziego; bez argumentu daje ten sam stan (`simGolden`).
8. **Ostrzeżenie o zaufaniu sklepu poniżej 40** (próg „Na cenzurowanym”, `trustTier`). Koszt pomyłki: jedna stała.
9. **Pinezka „lokal obok” na telefonie jest bez napisu i zawsze pod innymi pinezkami** (`zIndex` 0). Kartę lokalu pokazuje stuknięcie. Koszt pomyłki: CSS.
10. **Telefon i Niska otwierają miasto w warstwie na prostej geometrii z 4a.1.** Pełna geometria powstaje dopiero po „Makieta”, a od tej chwili warstwy spłaszczają ją. W każdej chwili istnieje jedna geometria.
    - Dlaczego: §19 „bez drugiego modelu” i anty-cel „ekran miasta, który dławi telefon”.
    - Koszt pomyłki: `firstDetail` w `CITY_PROFILES`, jedna linia.
11. **Średnia ma w mieście AO „half” z presetu**, bo postprocessing jest wspólny dla całej gry. „Wysoka: N8AO” spełnia się samo.
    - Koszt pomyłki: hak wyłączający AO w rendererze, gdyby bramka tego wymagała.
12. **Telefon wygrywa z presetem.** Profil „telefon” to Niska w mieście, także przy wybranej Wysokiej, i zawsze zwalnia scenę po wyjściu z zakładki (dziś zwalnia tylko preset `niska`).
    - Dlaczego: §19 mówi „Niska i telefon”.
    - Koszt pomyłki: jedna linia.
13. **Bramka makiety to liczby z prawdziwego laptopa i telefonu** (`?bench=1`). Headless ze swiftshaderem niczego nie rozstrzyga.
    - Progi z §3.6:
      - laptop, Średnia, makieta: ≥ 50 FPS średnio i p95 ≤ 25 ms;
      - telefon, warstwa: ≥ 30 FPS;
      - telefon, makieta: ≥ 24 FPS.
    - Co robić przy porażce: najpierw wyłączyć auta, potem cienie, a na telefonie ukryć przycisk „Makieta”.
    - Koszt pomyłki: progi są orientacyjne.
14. **Bez podbicia `SIM_VERSION`.**
    - Drugi i trzeci sklep w istniejących zapisach od aktualizacji gra z profilem i kartami, bez migracji: zapis nie niesie dziennika, który trzeba odtworzyć (`firmRun` po wczytaniu to `null`).
    - Koszt pomyłki: stary dziennik firmy z pamięci sesji nie odtworzy się przez aktualizację, ale nikt go nie przechowuje.
15. **Angielska nazwa przycisku „Makieta” to “Model”** („Model / Footfall / Districts”).

## Pliki

| Plik | Co | Zadania |
|---|---|---|
| `src/sim/city/districts.ts` | `DistrictDef.hours`, `DistrictDef.difficult`, `siteHours`, `districtSite` | 1, 2, 8 |
| `src/sim/economy/site.ts` | `SiteMods.hours`, `SiteMods.difficult`, `NEUTRAL_SITE`, `activeSite` | 1, 2 |
| `src/sim/city/traffic.ts` | `siteFor` przepisuje nowe pola | 1, 2 |
| `src/sim/economy/economy.ts` | `arrivalRate` (profil), `cardContext` (dzielnica), `createEconomy(…, fittings?)` | 1, 2, 4 |
| `src/sim/economy/tycoon/cards.ts`, `deck.ts`, `src/i18n/en/cards.ts` | `CardContext.district/difficult`, `difficultWeight`, karty Dworca | 2, 8 |
| `src/sim/firm/types.ts`, `firm.ts`, `commands.ts` | `MAX_STORES = 3`, `reopened`, `reopenStoreAt`, `rentPrice`, `storeSeedOf` | 3, 4, 8 |
| `src/game/firmSave.ts` | `reopened` w kopercie, budowy na lokalu „po Traszce” | 4 |
| `src/ui/city/*` | wykres godzin, karta „po Traszce”, ostrzeżenie zaufania, pinezka obok, przyciski trybu | 3–7, 14 |
| `src/render/city/cityBuildings.ts` (nowy) | bryły makiety i witryny | 10 |
| `src/render/city/buildCity.ts` | tryby na jednej geometrii | 11, 12 |
| `src/render/city/cityProps.ts`, `cityQuality.ts` (nowe) | drzewa, auta, profile miasta | 12 |
| `src/render/street/facadeAtlas.ts` | komórka `witrynaPoTraszce` | 11 |
| `src/render/renderer.ts`, `src/game/scene.ts` | cienie statyczne, zwalnianie sceny, `cityStats` | 11, 12 |
| `src/bench/bench.ts`, `src/main.ts`, `src/ui/BenchOverlay.tsx` | ujęcie miasta w benchmarku | 13 |
| `scripts/city-smoke.mjs`, `tests/citySmoke.test.ts` | smoke 4a.2 | 9, 15 |
| `tests/districtBalance.test.ts`, `tests/measure/miasto.measure.test.ts` | balans 4a.2 | 8 |

## Zależności między zadaniami
- **Część A:** 1 → 2 → 3 → 4 → 5 → 8 → 9.
  - 6 i 7 to drobne zadania UI; wchodzą w dowolnym miejscu przed 9.
  - Zadania 1 i 2 dotykają tych samych plików (`site.ts`, `districts.ts`, `economy.ts`), a 3 i 4 tych samych (`commands.ts`, `firmText.ts`), więc idą po kolei.
- **Część B:** 10 → 11 → 12 → 13 → 14 → 15.
  - Makieta nie zależy od części A, ale rusza po niej, żeby jej porażka na telefonie nie blokowała rozgrywki.
  - Zadanie 13 to bramka: zanim ruszy 14, koordynator ustawia `CITY_PROFILES` według liczb z prawdziwych urządzeń.

---

## Część A: rozgrywka

### Zadanie 1: profil dnia dzielnic w ekonomii

**Model:** standardowy (sonnet).

**Pliki:**
- Zmień:
  - miasto: `src/sim/city/districts.ts`, `src/sim/city/traffic.ts`;
  - ekonomia: `src/sim/economy/site.ts`, `src/sim/economy/economy.ts`;
  - spec: §8.1, wiersz „Profil dnia” z liczbami startowymi.
- Testy: `src/sim/economy/site.test.ts`, `src/sim/city/districts.test.ts` (dopiski).

**Interfejsy:**
- Wymaga: `HOUR_CURVE` (`catalog.ts`), `arrivalRate`, `effects`, `activeSite`, `siteFor`, `districtSite`.
- Daje:
```ts
// districts.ts
interface DistrictDef { /* … */ hours: readonly number[] | null }   // surowy kształt godzin 6–22 (17 liczb); null = HOUR_CURVE, jak dziś
export function siteHours(d: StoreDistrict): readonly number[] | null;  // 24 liczby, 0 poza 6–22, suma 6–22 = suma HOUR_CURVE; zamrożona tablica liczona raz
// site.ts
interface SiteMods { /* … */ hours: readonly number[] | null }       // NEUTRAL_SITE.hours = null; hours ≠ null włącza gałąź dzielnicy w activeSite
```
- Liczby startowe **[C]** (`DistrictDef.hours`, godziny 6–22; stroi je Zadanie 8):

| Dzielnica | Kształt (6, 7, …, 22) | Charakter (§8.1) |
|---|---|---|
| `osiedle` | `null` | jak dziś |
| `srodmiescie` | 0,3 0,8 1 0,8 0,7 0,8 1 1 0,8 0,9 1,1 1,4 1,6 1,6 1,4 1,1 0,8 | mocniejszy wieczór |
| `dworzec` | 17 × 1 | płaski |
| `biurowce` | 0,4 1,6 2 1,6 0,8 0,9 1,8 1,8 1,2 0,8 0,8 0,7 0,3 0,15 0,1 0,1 0,1 | szczyty 7–9 i 12–14, pusto po 18 |

- Gdzie wchodzi:
  - `arrivalRate` bierze `fx.site.hours[hour]` zamiast `HOUR_CURVE[hour]` tylko w gałęzi `fx.site && fx.site.hours`; bez tego wyrażenie zostaje co do znaku dzisiejsze;
  - `siteFor` (lokal niestartowy) i `districtSite` przepisują `siteHours(lot.district)`;
  - lokal startowy zostaje `NEUTRAL_SITE` z flagami;
  - `expectedDailyCustomers`, `kpiScaleOf` i `lotEstimate` się nie zmieniają.

- [ ] **Krok 1: testy.**
```ts
it('siteHours: 24 liczby, zera poza 6–22, suma 6–22 równa sumie HOUR_CURVE (±1e-9); osiedle i NEUTRAL_SITE: null', ...);
it('profil zmienia rozkład, nie dobę: suma arrivalRate po godzinach 6–22 dnia roboczego z profilem i bez (te same pozostałe pola site) równa ±1e-9', ...);
it('kierunki §8.1: Śródmieście ma udział godzin 17–22 ≥ 1,15× udziału Osiedla; Dworzec max/min po godzinach 6–22 ≤ 1,05; Biurowce 19–22 ≤ 5% doby, a dwa najmocniejsze okna trzygodzinne to 7–9 i 12–14', ...);
it('Review Focus 3: Biurowce w sobotę mają kształt dnia roboczego razy weekendTraffic / traffic; expectedDailyCustomers i cel KPI tygodnia (createEconomy) równe jak bez profilu', ...);
```
  `arrivalRate` liczymy na świeżym `createEconomy`, ustawiając `s.minute` na kolejne godziny wybranego dnia, bo to czysta funkcja stanu. Istniejący test neutralności (61 dni, `NEUTRAL_SITE` i brak `site`) zostaje bez zmian i ma przechodzić.
- [ ] **Krok 2:** `npx vitest run src/sim/economy/site.test.ts src/sim/city/districts.test.ts` → FAIL.
- [ ] **Krok 3: implementacja** według Interfejsów. `siteHours` normalizuje surowy kształt do sumy `HOUR_CURVE` i zamraża wynik (`Object.freeze`).
- [ ] **Krok 4:** `npm run build && npm test` → PASS, w tym `simGolden` bez zmian w `GOLDEN`, `generateCity.test.ts` (`CITY_GOLDEN` bez zmian), `tests/districtBalance.test.ts`. Gdy `districtBalance` pada, łagodzisz tylko kształty `hours` (bliżej `HOUR_CURVE`), aż przejdzie, i wpisujesz to do opisu commita. Pełne strojenie i raport robi Zadanie 8. Commit `feat(miasto): profil dnia dzielnic, ten sam ruch doby w innym rozkładzie`.

### Zadanie 2: trudni klienci i karty Dworca

**Model:** standardowy (sonnet).

**Pliki:**
- Zmień:
  - miasto: `src/sim/city/districts.ts`, `src/sim/city/traffic.ts`;
  - ekonomia: `src/sim/economy/site.ts`, `src/sim/economy/economy.ts` (`cardContext`);
  - karty: `src/sim/economy/tycoon/cards.ts`, `src/sim/economy/tycoon/deck.ts`, `src/i18n/en/cards.ts`;
  - test kart: `src/sim/economy/tycoon/cards.test.ts`. Pomocnik `ctxFor` szuka kontekstu także z `district: 'dworzec'`, żeby `make()` wylosował kartę Dworca.
- Utwórz: `src/sim/economy/tycoon/districtCards.test.ts`.

**Interfejsy:**
- Wymaga: `activeSite`, `SiteMods` (Zadanie 1); `pickWeighted` i `eligible` przez `drawDayCards`.
- Daje:
```ts
interface DistrictDef { /* … */ difficult: number }        // osiedle 1, srodmiescie 0.6, dworzec 1.6, biurowce 0.7 [C]
interface SiteMods { /* … */ difficult: number }           // NEUTRAL_SITE.difficult = 1; ≠ 1 włącza gałąź dzielnicy w activeSite
interface CardContext { /* … */ district?: SiteMods['district']; difficult?: number }   // tylko gdy activeSite(info) ≠ null; inaczej kluczy nie ma
export const difficultWeight: (base: number) => (c: CardContext) => number;           // bez `difficult` dokładnie `base` (gałąź)
export const DWORZEC_CARD_IDS: readonly ['dworzec-pociag', 'dworzec-bilon', 'dworzec-walizka'];
```
- `wiek` dostaje `weight: difficultWeight(1)`.
- Karty Dworca stoją na samym końcu `DECK`, po `wiralowy`. Ich waga to `c.district === 'dworzec' ? w : 0`. Liczby startowe **[C]** (stroi Zadanie 8), kwoty jak w talii: z `k(c)`, `dailyMargin` albo `dailyRevenue`.

| id | Pora | Waga | Przerwa | Domyślna | Odpowiedzi i skutki |
|---|---|---|---|---|---|
| `dworzec-pociag` | 21:00 | 1 | 6 | 2 | Odwołany ostatni pociąg, w sklepie ludzie, którym uciekło połączenie:<br>0 „wpuść, niech się grzeją”: `traffic` +0,5 na 60 min, `wut` 0,03 × `dailyRevenue`, `staffMinutes` 20;<br>1 kawa za pół ceny z Twojej marży: `cash` −0,05 × `dailyMargin`, `reputation` +2, `ogonki` +2;<br>2 „regulamin Centrali: bez zakupu nie przebywamy”: ryzyko 0,5, `reputation` −1,5 |
| `dworzec-bilon` | 8:00 | 1,2 | 5 | 2 | Podróżny płaci workiem groszy, a „Procedura przyjmowania bilonu” Centrali każe liczyć dwa razy:<br>0 liczysz dwa razy: `staffMinutes` 25, `trust` +1;<br>1 ważysz na wadze do bułek: `staffMinutes` 5, ryzyko 0,25, `trust` −2;<br>2 tylko karta albo banknoty: `reputation` −1 |
| `dworzec-walizka` | 13:00 | 1 | 8 | 2 | Walizka bez właściciela przy wejściu i trzystronicowy formularz „Zdarzenie nietypowe” w Traszkapce:<br>0 ochrona dworca, wejście zamknięte: `closed` na 30 min, `trust` +1;<br>1 wypełniasz formularz: `staffMinutes` 30, `energy` −5, `trust` +2;<br>2 „ktoś po nią wróci”: ryzyko 0,35, `reputation` −2, `trust` −2 |

- Ton: satyra celuje w procedury Centrali, a nie w podróżnych. Bez żartów z bezdomności i nałogów, bez prawdziwych marek (PKP, InterCity). Polski tekst i angielski w `EN_CARDS` pisze wykonawca, z tymi samymi parametrami w `{…}`.

- [ ] **Krok 1: testy** (`districtCards.test.ts`):
  - `difficultWeight(1.3)` bez `difficult` zwraca dokładnie 1,3, a z `difficult: 0.6` zwraca 1,3 × 0,6;
  - talia:
    - 400 dni `drawDayCards` z kontekstem bez dzielnicy i z `{ district: 'osiedle', difficult: 1 }` daje identyczny ciąg identyfikatorów;
    - §20: w 2000 dniach karty z `DWORZEC_CARD_IDS` wypadają tylko przy `district: 'dworzec'`; dla braku dzielnicy, `osiedle`, `srodmiescie` i `biurowce` jest ich 0;
    - częstość `wiek`: Dworzec > Osiedle > Śródmieście;
  - ekonomia:
    - `cardContext` sklepu bez `site` nie ma kluczy `district` ani `difficult`;
    - sklep z `siteFor` lokalu Dworca ma `district: 'dworzec'` i `difficult: 1.6`;
    - sklep startowy w firmie z dwoma sklepami (flagi bez dzielnicy) nie ma `district`;
  - zastępca: sklep w tle na Dworcu odpowiada na kartę Dworca `defaultAnswer`, a `firmEventText(deputy)` po angielsku daje etykietę z `EN_CARDS`;
  - istniejące testy talii w `cards.test.ts` przechodzą także dla nowych kart: 2–3 odpowiedzi, najwyżej jedna „nic nie robię”, bez prawdziwych marek, polskie litery.
- [ ] **Krok 2:** `npx vitest run src/sim/economy/tycoon tests/i18n.test.ts` → FAIL.
- [ ] **Krok 3: implementacja.** `cardContext` dopisuje oba pola gałęzią `const site = activeSite(info); if (site) …`. Spec §8.1, wiersz „Trudni klienci”: liczby `difficult`.
- [ ] **Krok 4:** `npm run build && npm test` → PASS, w tym `simGolden` bez zmian, `judgeBundle`, `rankedSeason`, `i18n` i `districtBalance`. Gdy `districtBalance` pada, łagodzisz tylko liczby kart Dworca i `difficult`. Commit `feat(miasto): trudni klienci wg dzielnicy i trzy karty tylko dla Dworca`.

### Zadanie 3: trzeci sklep

**Model:** standardowy (sonnet).

**Pliki:**
- Zmień: `src/sim/firm/types.ts` (`MAX_STORES = 3`), `src/ui/city/firmText.ts` (odmowa `limit`), `src/i18n/en/ui/firm.ts`, `README.md` (Jak grać: „do trzech sklepów”)
- Testy: `src/sim/firm/commands.test.ts`, `src/sim/firm/firm.test.ts`, `src/game/firmSave.test.ts`, `src/ui/city/NetworkReport.test.tsx`, `src/ui/city/StoreSwitcher.test.tsx`, `src/ui/game/monthPreview.test.tsx`

**Interfejsy:**
- Wymaga: firmy i zapisu z 4a.1 (`openStoreAt`, `rentRefusal`, `firmEnvelopeOf`). Testy UI biorą pomocniki z `tests/firmKit.ts`, a testy `src/sim` swoje, jak `closure.test.ts`.
- Istniejące testy, które zakładają limit 2 (np. `commands.test.ts` przy `limit`), dostają trzeci sklep albo budowę. Nie zmieniamy progu w teście.
- Daje:
  - `MAX_STORES = 3`; licznik „placówki n/3” w `CityBar` bierze go sam;
  - odmowa `limit`: „Trzy placówki to na tym etapie partnerstwa wszystko, na co Centrala jest gotowa się zgodzić.”, po angielsku “Three branches is, at this stage of the partnership, all Head Office is prepared to agree to.” (ton z wersji 4a.1, zatwierdzonej przez właściciela).
- [ ] **Krok 1: testy:**
  - limit:
    - dwa otwarte i jedna budowa dają `limit`;
    - trzy otwarte dają `limit`;
    - dwa otwarte bez budowy przechodzą;
  - trzy sklepy w firmie:
    - ZUS i księgowa raz w miesiącu;
    - dochód z sieci raz dziennie;
    - debet sprawdza firma;
    - `network-report` ma trzy sklepy, a `total` to suma `net`;
  - Review Focus 4, zapis: paczka „Wyślij zapis” z trzema otwartymi sklepami, każdy po dwóch remontach, na koniec roku (365 dni prawdziwych kroków, wzór `playWithClosedStore`) ma ≤ `SAVE_TRANSFER_MAX_BYTES` i wraca z tą samą kopertą. Test drukuje rozmiar (`transferSize`);
  - UI:
    - `NetworkReport` z trzema sklepami ma cztery zakładki i sumy;
    - lista chipa ma trzy wiersze;
    - podgląd końca miesiąca ma część na każdy z trzech sklepów.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. Gdy test rozmiaru nie przechodzi, zatrzymaj się i zgłoś pomiar koordynatorowi. Limitu nie podnoś.
- [ ] **Krok 4:** `npx vitest run src/sim/firm src/game src/ui tests/i18n.test.ts` → PASS; commit `feat(firma): trzeci sklep (limit 3 placówek) i zapis trzech sklepów w 64 KB`.

### Zadanie 4: ponowny wynajem lokalu „po Traszce”

**Model:** standardowy (sonnet).

**Pliki:**
- Zmień:
  - ekonomia: `src/sim/economy/economy.ts` (`createEconomy(…, fittings?)`);
  - firma: `src/sim/firm/types.ts`, `src/sim/firm/firm.ts`, `src/sim/firm/commands.ts`;
  - zapis: `src/game/firmSave.ts` (`storeSeedOf` przeniesione do firmy, `reopened`, budowy na lokalu „po Traszce”)
- Utwórz: `src/sim/firm/relet.test.ts`
- Testy: także `src/game/firmSave.test.ts`, `src/sim/firm/replay.test.ts`

**Interfejsy:**
- Wymaga: `lotState`, `rentRefusal`, `openDueBuilds`, `refreshSites`, `setPartner`, `closeStore` (4a.1); `MAX_STORES` (Zadanie 3).
- Daje:
```ts
// economy.ts
export type StoreFittings = Pick<EconomyState, 'upgrades' | 'equipment' | 'remontLevel'>;
export function createEconomy(seed, info, partner?, startMinute?, fittings?: StoreFittings): EconomyState;
// z `fittings`: kopie trzech pól tuż po literale, przed createTycoon (cel KPI) i kartami dnia 0; bez `fittings` stan co do bitu jak dziś
// types.ts
interface FirmStore { /* … */ reopened?: true }        // sklep po ponownym wynajmie: nigdy bez flagi `extra`
// firm.ts
export function storeSeedOf(seed: string, city: CityState, lotId: number): string;   // lokal startowy: seed gry, inne: storeSeedFor (przeniesione z firmSave.ts bez zmian)
export function reopenStoreAt(f: FirmState, st: FirmStore, minute: number): FirmStore;
// commands.ts
export const RELET_SHARE = 0.3;                         // §13.3 [C]
export const RELET_BUILD_DAYS = 2;                      // [C]
export function rentPrice(f: FirmState, lotId: number): number;      // wolny: package; po-traszce: round(package × RELET_SHARE / 100) × 100
export function rentBuildDays(f: FirmState, lotId: number): number;  // wolny: buildDays; po-traszce: RELET_BUILD_DAYS
// firmSave.ts
interface SavedStoreBase { /* … */ reopened?: true }   // zapisywane tylko przy true
```
- Zasady:
  - **`lotState`:** budowa (`builds`) sprawdza się przed własnym sklepem, więc zamknięty sklep z budową w swoim lokalu daje `budowa`. Reszta bez zmian.
  - **`rentRefusal`** przyjmuje lokal w stanie `wolny` albo `po-traszce`. `gotowka` i `raty` liczą z `rentPrice`. `rentLot` zapisuje `price: rentPrice` i `readyDay: dzień + rentBuildDays`.
  - **`openDueBuilds`:**
    - gdy w lokalu budowy stoi zamknięty sklep, woła `reopenStoreAt`, a w przeciwnym razie `openStoreAt`;
    - rata ma tę samą etykietę „Adaptacja lokalu: ul. …”;
    - `FirmEvent` `opened` niesie `params.reopened = 1`.
  - **`reopenStoreAt`, w miejscu na liście:**
    - te same `id`, `lotId` i `layout`;
    - `closed = false`, `notice = null`, `reopened = true`;
    - `info` z `computeStoreInfo(st.layout)`, potem `refreshSites`;
    - `econ = createEconomy(storeSeedOf(f.seed, f.city, lotId), info, { ...partner, networkIncome: 0 }, minute, kopie fittings z st.econ)`;
    - gotówka, Ogonki i `remanent.known` od osoby, jak w `openStoreAt`;
    - na koniec `setPartner(f, partner najniższego otwartego sklepu sprzed otwarcia)`, bo dochód z sieci przechodzi na najniższe `id`, także gdy wraca #1.
  - **`siteOf` i `refreshSites`:**
    - `extra: !start || st.reopened === true`;
    - gałąź „jeden sklep startowy bez `site`” działa tylko dla `!st.reopened`.
  - **Zapis:**
    - `firmEnvelopeOf` pisze `reopened: true` tylko przy `true`, a `restoreEnvelope` je czyta;
    - `addBuilds` przyjmuje lokale `wolny` i `po-traszce`, a brakująca cena to `rentPrice`.
- [ ] **Krok 1: testy** (`relet.test.ts`, pomocniki jak w `closure.test.ts`; asercja `fitsStore` w `firmSave.test.ts`, bo `src/sim` nie importuje `src/game`):
  - cena i czas:
    - `rentPrice` lokalu „po Traszce” to 30% pakietu zaokrąglone do 100 zł;
    - budowa trwa 2 dni;
    - `lot` dla stanów `zajety`, `konkurencja`, `twoj` i `budowa`;
    - `limit` przy trzech sklepach;
  - ponowne otwarcie #2 (remont 1 i kasa samoobsługowa przed wypowiedzeniem):
    - to samo `id`, lokal i seed sceny, `layout` równy temu z chwili zamknięcia;
    - `upgrades`, `equipment` i `remontLevel` równe (a w `firmSave.test.ts` `fitsStore(econ, info)` daje `true`);
    - `level` 1, `reputation` 50, zaufanie 65 (`TRUST.start`), pusta historia;
    - gotówka równa portfelowi;
    - przy ratach w `installments` jest tylko rata pakietu z planu `planFor(rentPrice)`;
    - `info.site.extra === true`, a pierwszy wyciąg ma `guarantee === 0`;
  - Review Focus 1: #1 zamknięty przez zaufanie 0 przy działającym #2, potem wzięty znów:
    - kolejność `[1, 2]`, seed sceny #1 to seed gry, `site.extra === true`;
    - #1 dostaje znów dochód z sieci;
    - po wypowiedzeniu i zamknięciu #2 sklep #1 jako jedyny nadal ma `site.extra === true` i `guarantee === 0`;
  - Review Focus 2: zapis z budową w lokalu „po Traszce”:
    - po odczycie `lotState === 'budowa'`;
    - w dniu odbioru sklep otwiera się z tym samym wyposażeniem co bez zapisu (skrót `econ` równy);
    - `reopened` przetrwa zapis;
    - koperty fixtures z `src/game/fixtures/` po wczytaniu i zapisie nie mają klucza `reopened`;
  - determinizm: `replayFirm` scenariusza z wynajmem lokalu „po Traszce” równa się żywej firmie;
  - bit w bit: `createEconomy(seed, info)` i `createEconomy(seed, info, undefined, OPEN_FROM, undefined)` dają ten sam skrót.
- [ ] **Krok 2:** `npx vitest run src/sim/firm src/game/firmSave.test.ts` → FAIL.
- [ ] **Krok 3:** implementacja według Zasad.
- [ ] **Krok 4:** `npm run build && npm test` → PASS (`simGolden` bez zmian). Commit `feat(firma): ponowny wynajem lokalu „po Traszce” z wyposażeniem za 30% pakietu`. W opisie PR: zakaz cofania produkcji przed ten commit.

### Zadanie 5: karta lokalu: profil godzinowy i lokal „po Traszce”

**Model:** standardowy (sonnet).

**Pliki:**
- Utwórz: `src/ui/city/HourChart.tsx`
- Zmień:
  - model i karta: `src/ui/city/cityModel.ts`, `src/ui/city/LotCard.tsx`, `src/ui/city/city.css`;
  - teksty: `src/ui/city/firmText.ts` (`opened` po ponownym wynajmie), `src/i18n/en/ui/city.ts`, `src/i18n/en/ui/firm.ts`
- Testy: `src/ui/city/cityModel.test.ts`, `src/ui/city/CityPanel.test.tsx`, `src/ui/city/firmText.test.ts`

**Interfejsy:**
- Wymaga: `siteHours`, `DISTRICTS` (Zadanie 1); `rentPrice`, `rentBuildDays` (Zadanie 4); `lotEstimate`.
- Daje:
```ts
export interface HourBars { weekday: number[]; weekend: number[] | null }   // klienci na godzinę 6–22 (17 liczb) przy środku widełek
export function lotHours(seed: string, f: FirmState, lotId: number): HourBars;
interface LotCardModel { /* … */ hours: HourBars; relet: { remontLevel: number; equipment: number; upgrades: number } | null }
// freeLotRows: także lokale `po-traszce` (cena `rentPrice`); lotCardModel: price = rentPrice, buildDays = rentBuildDays
```
- Zasady:
  - **`lotHours`:**
    - `weekday[i]` = `(lo + hi) / 2 × kształt[6 + i] / Σ kształtu`, gdzie kształt to `siteHours(d) ?? HOUR_CURVE`;
    - `weekend` przy `weekendTraffic ≠ null` to `weekday × weekendTraffic / traffic`, a inaczej `null`.
  - **`HourChart`:**
    - SVG z 17 słupkami; weekend to obrys obok, gdy jest;
    - podpisy 6, 12, 18 i 22;
    - nagłówek „Ruch w ciągu dnia”, legenda „dzień roboczy” i „weekend”;
    - `aria-label` „Szczyt około {h}:00”;
    - bez liczb na osi, bo widełki już są na karcie.
  - **Karta lokalu „po Traszce”** to ta sama karta wynajmu z blokiem „Wyposażenie zostało: remont {n}, sprzęt {k} szt., ulepszenia {u}” i podpisem pakietu „po Traszce: 30% ceny”.
  - **Okno `opened` z `reopened`:**
    - tytuł „Traszka #{id} znów otwarta”;
    - tekst „{nazwa} znów przyjmuje klientów ({adres}). Wyposażenie zostało, ale Centrala zaczyna znajomość od nowa: poziom 1, zaufanie {TRUST.start}.”
- [ ] **Krok 1: testy:**
  - `lotHours`:
    - Σ `weekday` = środek widełek ±1%;
    - Biurowce mają `weekend ≠ null` i wieczór poniżej 5% doby;
    - Dworzec jest płaski;
    - Osiedle ma kształt `HOUR_CURVE`;
  - lista:
    - lokal „po Traszce” jest na liście z ceną `rentPrice`;
    - lokal startowy „po Traszce” nie ma numeru kartki;
  - karta:
    - wykres ma 17 słupków;
    - karta „po Traszce” ma blok wyposażenia, a „Biorę lokal” wysyła `rentLot`;
    - rata pokazuje `plan.months` (6 albo 12), a nie stałe 12;
  - `firmEventText(opened, reopened)` po polsku i po angielsku;
  - `tests/i18n.test.ts` zielony.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/ui tests/i18n.test.ts` → PASS; commit `feat(ui): profil godzinowy na karcie lokalu i karta lokalu „po Traszce”`.

### Zadanie 6: zaufanie sklepu w tle widoczne bez otwierania listy

**Model:** tani (haiku).

**Pliki:**
- Zmień: `src/ui/city/storeSwitcherModel.ts`, `src/ui/city/StoreSwitcher.tsx`, `src/ui/city/NetworkReport.tsx`, `src/i18n/en/ui/firm.ts`
- Testy: `src/ui/city/storeSwitcherModel.test.ts`, `src/ui/city/NetworkReport.test.tsx`

**Interfejsy:**
- Daje:
  - `export const TRUST_WARN_BELOW = 40;`
  - `StoreWarning` dostaje `'zaufanie'`, gdy `trust < TRUST_WARN_BELOW`, ostatnie w stałej kolejności;
  - tekst ostrzeżenia: `⚠ zaufanie {n} ({tr(trustTier(n).label)})`, np. „zaufanie 32 (Na cenzurowanym)”;
  - znak ⚠ na chipie zapala się sam, bo liczy ostrzeżenia sklepów w tle;
  - zakładka „Sieć” w oknie miesiąca: przy każdym sklepie „zaufanie {n}” z bieżącego stanu sklepu.
- Powód: raport 4a.1, §7 punkt 3. Zaufanie sklepu w tle może po cichu spaść do 7 na Dworcu w 24 miesiące.
- [ ] **Krok 1: testy:**
  - sklep w tle z zaufaniem 39 ma `'zaufanie'`, a z 40 nie ma;
  - chip ma ⚠;
  - „Sieć” pokazuje zaufanie każdego sklepu;
  - angielski: liczba i ta sama etykieta progu przez `tr` (bez nowego wpisu dla etykiety, bo `trustTier` ma już tłumaczenie).
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/ui/city tests/i18n.test.ts` → PASS; commit `feat(ui): ostrzeżenie o niskim zaufaniu sklepu w tle na chipie i w podsumowaniu sieci`.

### Zadanie 7: pinezka „lokal obok” na telefonie

**Model:** tani (haiku).

**Pliki:**
- Zmień: `src/render/city/cityPins.ts`, `src/ui/city/cityModel.ts` (`cityPinSpecs`), `src/ui/city/city.css`
- Testy: `src/render/city/cityPins.test.ts`, `src/ui/city/cityModel.test.ts`, `src/ui/city/cityCss.test.ts`

**Interfejsy:**
- Daje:
  - `CityPinKind` dostaje `'obok'`, a `pinStyle('obok')` to kartka bez dopisku;
  - klasa `tt-cpin-obok`;
  - w `update` pinezka `obok` ma zawsze `zIndex` 0, więc leży pod pozostałymi;
  - `cityPinSpecs` daje lokalowi obok rodzaj `obok` (dziś `wolny`) z napisem „lokal obok”;
  - CSS ≤ 899 px: `.tt-cpin-obok .tt-cpin-label { display: none }`.
- Powód: zgłoszenie z przeglądu. Na 390 px napis „lokal obok” zachodzi na sąsiednie pinezki.
- [ ] **Krok 1: testy:**
  - `cityPinSpecs` daje `obok` dla lokalu obok;
  - pinezka ma klasę i `zIndex` „0” po `update`;
  - `cityCss.test.ts` sprawdza regułę telefonu.

  Pomiar nakładania się pinezek w przeglądarce robi Zadanie 9.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/render/city src/ui/city` → PASS; commit `fix(miasto): pinezka lokalu obok na telefonie bez napisu i pod innymi pinezkami`.

### Zadanie 8: balans 4a.2 na botach i raport

**Model:** standardowy (sonnet).

**Pliki:**
- Zmień:
  - testy: `tests/districtBalance.test.ts`, `tests/measure/miasto.measure.test.ts`;
  - strojenie: `src/sim/city/districts.ts` (tylko `hours` i `difficult`), `src/sim/economy/tycoon/deck.ts` (tylko liczby kart Dworca), `src/sim/firm/commands.ts` (`RELET_SHARE`, `RELET_BUILD_DAYS`);
  - spec: tabela §8.1 (profil dnia, trudni klienci) i §13.3 (zniżka, dni budowy) po strojeniu, w tym samym commicie
- Utwórz: `docs/superpowers/reports/2026-11-01-miasto-4a2.md`

**Interfejsy:**
- Wymaga: `playBot(name, seed, minutes, site?, setup?)`, `districtSite`; firma z Zadań 3–4.
- [ ] **Krok 1: testy w `districtBalance.test.ts`:**
  - Pięć celów §8.4 z 4a.1 przechodzi bez zmiany progów, teraz z profilem i kartami. Zapewnia to `districtSite` z Zadań 1–2.
  - Dopiski:
```ts
it('karty Dworca: mistrz na Dworcu dostaje w 92 dniach co najmniej jedną kartę z DWORZEC_CARD_IDS na każdym seedzie, w innych dzielnicach żadnej', ...);
it('lokal po Traszce: sklep z remontem 1 i pakietem RELET_SHARE zostawia w trzech miesiącach po racie (suma net) więcej niż świeży lokal tej dzielnicy, mistrz i bierny', ...);
```
- [ ] **Krok 2:** `npx vitest run tests/districtBalance.test.ts`, potem strojenie tylko pokręteł 4a.2, aż przejdzie. Liczb 4a.1 nie ruszamy (Global Constraints). Gdy cel nie przechodzi bez ruszania 4a.1, zatrzymaj się i zgłoś koordynatorowi.
- [ ] **Krok 3: pomiar** (`MEASURE=1 OUT=<plik> npx vitest run tests/measure/miasto.measure.test.ts`), nowe strategie:
  - **`trzy`:** mistrz z ekspansją do trzech sklepów (trzeci, gdy rata mieści się w limicie albo gotówka wystarcza);
  - **`relet`:** gdy zaufanie sklepu w tle spada poniżej 40, wypowiedzenie, a po rozliczeniu ponowny wynajem.

  Raport podaje:
  - miesiąc drugiego i trzeciego sklepu;
  - gotówkę w miesiącach 12 i 24;
  - miesiąc miliona przy 1, 2 i 3 sklepach;
  - koszt cyklu „wypowiedz i weź znów” (rozliczenie, pakiet, utracony poziom) wobec zysku z odbudowanego zaufania;
  - wpływ profilu dnia (straty z kolejki w szczytach Biurowców, wieczór Śródmieścia);
  - częstość kart Dworca;
  - decyzje strojenia.

  Jeśli cykl „relet” jest opłacalną sztuczką, raport zadaje to jako pytanie do właściciela i niczego nie stroi po cichu.
- [ ] **Krok 4:** `npm run build && npm test` → PASS (neutralność, `GOLDEN` i `CITY_GOLDEN` bez zmian). Commit `test(balans): profil dnia, karty Dworca, trzeci sklep i lokal po Traszce na botach`.

### Zadanie 9: smoke rozgrywki 4a.2 i bramki części A

**Model:** standardowy (sonnet).

**Pliki:**
- Utwórz: fixture `src/game/fixtures/save-v3-po-traszce.json`. Generator siedzi w `src/game/firmSave.test.ts` pod `MAKE_FIXTURE=1`, test o nazwie z „po-traszce”.
- Zmień: `scripts/city-smoke.mjs` (kroki 9–12 i pomiar pinezki obok w kroku 2), `tests/citySmoke.test.ts` (pomocniki), `FIXTURES` w skrypcie
- Raport: sekcja „Smoke części A” w `docs/superpowers/reports/2026-11-01-miasto-4a2.md`, zrzuty w `docs/superpowers/reports/2026-11-01-miasto-4a2/`

**Interfejsy:**
- Wymaga: `window.traszkaGame` pod `?debug=1` (`skip`) i wzorców `settle`, `pause`, `advance`, `readGame` i `readLots` ze skryptu 4a.1.
- [ ] **Krok 1: fixture.** Seed `traszka-1`, bot `mistrz` gra przez firmę.
  1. Status Partnera, potem wynajem najtańszego wolnego lokalu na raty.
  2. W #2 remont 1 i kasa samoobsługowa na raty. Gdy limit rat nie pozwala, generator gra dalej, najwyżej 6 miesięcy, inaczej test pada.
  3. `terminateStore(2)` i gra do rozliczenia końcowego.
  4. Wynajem drugiego wolnego lokalu, który staje się sklepem #3.
  5. Zapis o 6:00 dnia, w którym #3 jest otwarty, a portfel ≥ `rentPrice` lokalu #2.

  Test sprawdza:
  - sklepy `[[1, otwarty], [2, zamknięty, remontLevel 1, sprzęt z 'sco'], [3, otwarty]]`;
  - `partner === true`;
  - portfel ≥ `rentPrice`.
- [ ] **Krok 2: smoke**, nowe kroki na obu rozmiarach, chyba że napisano inaczej:
  - **Krok 2 (dopisek), 390 px na fixture „przed statusem”:** ramka napisu i kartki pinezki `.tt-cpin-obok` nie przecina ramek innych pinezek (`getBoundingClientRect`).
  - **Krok 9: fixture „po Traszce”.**
    - Miasto ma pinezkę „po Traszce” na lokalu #2.
    - Lista i karta pokazują cenę `rentPrice`, blok wyposażenia i wykres z 17 słupkami.
    - Telefon płaci na raty, komputer gotówką.
    - Po `skip` do dnia otwarcia jest okno „Traszka #2 znów otwarta”.
    - Z danych gry (`readGame`): #2 ma `level` 1, zaufanie 65 i `remontLevel` z fixture, a chip ma trzy sklepy.
  - **Krok 10:** karta innego wolnego lokalu ma zablokowane „Biorę lokal” z tekstem „Trzy placówki to …”.
  - **Krok 11:** `skip` do końca miesiąca daje okno z „Sieć” i trzema wyciągami (cztery zakładki); zaufanie przy każdym sklepie jest widoczne.
  - **Krok 12 (telefon):**
    - pomiar szerokości jak w kroku 7 4a.1 na każdym nowym ekranie: karta z wykresem, karta „po Traszce”, lista chipa z trzema sklepami, okno sieci z czterema zakładkami;
    - to samo po angielsku.
  - Konsola i `pageerror` bez błędów (krok 8 obejmuje nowe kroki).
- [ ] **Krok 3: bramki:**
  - `npm run build` → kod 0;
  - `npm test` → zielone, w tym `simGolden` (bez zmian), `i18n`, `architecture`, `judgeBundle`, `citySmoke`, `districtBalance`;
  - `npm run check:vercel-build` → kod 0;
  - `npm run city:smoke` → wszystkie kroki „ok”;
  - `git diff main -- src/sim/simVersion.ts tests/simGolden.test.ts src/server src/sim/ranked.ts src/game/rankedRun.ts` → pusto.
- [ ] **Krok 4:** raport uzupełniony o wyniki i zrzuty; commit `test(miasto): smoke trzeciego sklepu i lokalu po Traszce bez okna przeglądarki`. Po tym zadaniu część A można scalić i wdrożyć osobno.

---

## Część B: makieta 3D (za bramką benchmarku)

### Zadanie 10: bryły budynków makiety

**Model:** najmocniejszy (opus).

**Pliki:**
- Utwórz: `src/render/city/cityBuildings.ts`, `src/render/city/cityBuildings.test.ts`

**Interfejsy:**
- Wymaga:
  - `CityState`, `CityLot`, `BLOCK_M`, `SLOT_M`, `STREET_HALF_M`;
  - `cityToWorld`, `CITY_UNIT_M` (`buildCity.ts`);
  - `GeomBuilder` (`src/render/street/buildings.ts`), `createFacadeAtlas`, `AtlasCellName`, `PALETTE`.
- Daje:
```ts
export type BuildingStyle = 'blok' | 'kamienica' | 'pawilon' | 'biurowiec' | 'dworzec';
export function buildingStyle(lot: CityLot): BuildingStyle;   // osiedle → blok, srodmiescie → kamienica, dworzec → pawilon, biurowce → biurowiec
export interface BuildingPlan {
  lotId: number | null;                    // null: budynek dworca (bez lokalu)
  style: BuildingStyle; x0: number; x1: number; z0: number; z1: number;   // jednostki sceny
  floors: number; height: number; main: string; accent: string; front: 'n' | 's';
}
export function planCityBuildings(city: CityState): BuildingPlan[];   // jeden na lokal + jeden dworzec w kwartale punktu ruchu 'dworzec'
export interface ShopFront { lotId: number; first: number; count: number }   // wierzchołki witryny parteru w siatce chunku
export interface ChunkGeometry { chunk: number; geometry: BufferGeometry; fronts: ShopFront[]; boxes: { lotId: number; box: Box3; top: Vector3 }[] }
export function buildChunkGeometries(city: CityState, plans: readonly BuildingPlan[], atlas: Pick<FacadeAtlas, 'cell'>): ChunkGeometry[];
export function setFront(g: BufferGeometry, front: ShopFront, cell: AtlasCellName, tint: Color): void;   // zmienia tylko uv i kolor
export const MOCKUP_TRIS_MAX = 250_000;
```
- Wygląd (§7.1, §19, w stylu ulicy przed sklepem):
  - **blok:** 4–11 kondygnacji po 2,8 m z `blokPastel` i `szewPlyty`;
  - **kamienica:** 4–5 kondygnacji po 3,3 m z `kamienicaPlaster` i `gzyms`;
  - **pawilon:** 1 kondygnacja po 3,5 m; co trzeci lokal (`unit(id) < 0,3`) to rząd garaży;
  - **biurowiec:** 6–14 kondygnacji po 3,5 m;
  - **dworzec:** hala ok. 12 m z wieżą zegarową, we wnętrzu kwartału, bez kolizji z lokalami.
- Fasady:
  - od frontu i od tyłu czworokąt na przęsło i kondygnację, z komórką `okno` albo `oknoGasne` (40% świeci, jak `LIT_SHARE` ulicy);
  - boki to jeden czworokąt `tynk` albo `szewPlyty`;
  - parter od ulicy to jedna adresowalna witryna (`ShopFront`, domyślnie `witryna`);
  - chunk ma 2×2 kwartały, jak w 4a.1.
- [ ] **Krok 1: testy** (10 seedów, atlas z `createFacadeAtlas()`, w Node `cell()` działa bez płótna):
  - obrys każdego budynku lokalu mieści się w slocie lokalu, a obrysy nie nachodzą na siebie ani na prostokąty ulic;
  - dworzec jest tylko przy punkcie ruchu `dworzec`;
  - style według dzielnic; mediana wysokości biurowców jest najwyższa, pawilonów najniższa; wszystkie `y ≥ 0`;
  - deterministycznie: ten sam seed daje tę samą tablicę pozycji (skrót);
  - trójkąty całego miasta < `MOCKUP_TRIS_MAX`;
  - każdy lokal ma dokładnie jedną `ShopFront`;
  - `setFront` zmienia tylko `uv` i `color` w `[first, first + count)`, a UV leżą w komórce atlasu.
- [ ] **Krok 2:** `npx vitest run src/render/city/cityBuildings.test.ts` → FAIL. **Krok 3:** implementacja. **Krok 4:** PASS; `npx tsc --noEmit`; commit `feat(render): proceduralne bryły makiety miasta z fasadami z atlasu`.

### Zadanie 11: scena miasta na jednej geometrii: tryby i witryny

**Model:** najmocniejszy (opus).

**Pliki:**
- Zmień:
  - render: `src/render/city/buildCity.ts`, `src/render/street/facadeAtlas.ts` (komórka `witrynaPoTraszce` w `{ x: 256, y: 1024, w: 256, h: 256 }`, `drawRentPoster` z dopiskiem `tr('po Traszce')`);
  - gra i stan: `src/game/scene.ts` (sygnatura `showCity` bez zmian, `layer` może być `'makieta'`, a szczegółowość wybiera scena), `src/ui/state.ts` (typ)
- Testy: `src/render/city/buildCity.test.ts`, `src/game/sceneCity.test.ts`, `src/render/rentPoster.test.ts` (skan atlasu)

**Interfejsy:**
- Wymaga: Zadania 10.
- Daje:
```ts
export type CityLayer = 'makieta' | 'ruch' | 'dzielnice';
export type CityDetail = 'prosty' | 'pelny';              // prosty: bryły z 4a.1; pelny: bryły z Zadania 10
export const FLAT_SCALE = 0.25;                           // spłaszczenie budynków w warstwach (scale.y chunków)
export function buildCity(city: CityState, states: Record<number, LotState>, opts?: { detail?: CityDetail }): CityView;
interface CityView { /* 4a.1 */ readonly detail: CityDetail; supports(layer: CityLayer): boolean }   // prosty nie umie 'makieta'
```
- Zasady:
  - **`pelny`:**
    - jeden zestaw siatek, dwa materiały:
      - makieta: `MeshStandardMaterial` z `map` i `emissiveMap` atlasu i `vertexColors`, jak budynki ulicy;
      - warstwy: `MeshBasicMaterial` z `vertexColors`, jak w 4a.1;
    - trzy bufory kolorów na tryb (makieta: barwy `main` i `accent`; „Ruch” i „Dzielnice”: biel z barwą stanu lokalu, cieniowanie wypieczone jak `SHADE`), ziemia też ma trzeci zestaw (park zielony, ulice asfalt);
    - `setLayer` podmienia materiał, kolory i `scale.y` chunków (1 albo `FLAT_SCALE`), a geometrii nie ruszamy.
  - **Witryny według stanu** (`setLots` przez `setFront`):

| Stan | Komórka | Barwa |
|---|---|---|
| `wolny` | `witrynaWynajem` | brak |
| `obok` | `witrynaWynajem` | brak (§7.2: ta sama kartka co na ulicy) |
| `po-traszce` | `witrynaPoTraszce` | brak |
| `twoj` | `witryna` | zieleń marki |
| `konkurencja` | `witryna` | pomarańcz (Szop) albo fiolet (Kawka) |
| `budowa` | `tynk` | pomarańcz |
| `zajety` | `witryna` | brak |

  - **Kotwice i `pickLot`:** `pinAnchors` i `pickLot` liczą z bieżącym `scale.y`.
  - **`SceneHost.showCity`:**
    - `'makieta'` na widoku `prosty` buduje `pelny` od nowa (stary zwalnia);
    - warstwy zostają na bieżącym widoku;
    - pierwszy widok w tym zadaniu to `pelny` dla makiety i `prosty` dla warstw; Zadanie 12 zastępuje to profilem.
  - **`dispose`** zwalnia geometrie i oba materiały, ale nie tekstury atlasu (wspólny cache).
- [ ] **Krok 1: testy:**
  - `pelny`:
    - draw calls < 60 w każdym trybie (10 seedów);
    - `setLayer` nie zmienia obiektów `BufferGeometry` ani tablic `position`, a zmienia materiał i `scale.y`;
    - kotwice w makiecie leżą wyżej niż w warstwach;
    - `pickLot` promieniem z góry trafia lokal w obu trybach;
  - witryny: `setLots` z `wolny` daje UV komórki `witrynaWynajem`, z `po-traszce` komórki `witrynaPoTraszce`, a pozycje się nie zmieniają;
  - `prosty`: dotychczasowe testy z 4a.1 przechodzą bez zmian, a `supports('makieta') === false`;
  - `sceneCity.test.ts`: przejście ruch → makieta → ruch buduje `pelny` raz, a licznik zwolnionych geometrii zgadza się z liczbą siatek `prosty`;
  - atlas: `witrynaPoTraszce` rysuje `drawRentPoster` z dopiskiem `tr('po Traszce')`.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/render src/game/sceneCity.test.ts tests/i18n.test.ts` → PASS; commit `feat(render): makieta i warstwy miasta na jednej geometrii, kartka w ciemnej witrynie`.

### Zadanie 12: drzewa, auta, profile miasta, cienie statyczne, zwalnianie sceny

**Model:** standardowy (sonnet).

**Pliki:**
- Utwórz: `src/render/city/cityQuality.ts`, `src/render/city/cityProps.ts`, testy obok
- Zmień:
  - render: `src/render/city/buildCity.ts` (eksport `streetRect`, `countShadowCasters`, podpięcie rekwizytów), `src/render/renderer.ts` (`setStaticShadows`, `refreshShadows`);
  - gra: `src/game/scene.ts` (profil, `tick` aut w klatce, odświeżanie cieni, zwalnianie, `cityStats`), `src/main.ts` (`cityStats` w `window.traszkaGame` pod `?debug=1`)
- Testy: `src/render/city/cityQuality.test.ts`, `src/render/city/cityProps.test.ts`, `src/render/renderer.test.ts`, `src/game/sceneCity.test.ts`

**Interfejsy:**
- Wymaga: Zadań 10–11; `streetIntensity` (`traffic.ts`); `detectDeviceCaps`.
- Daje:
```ts
export interface CityProfile { mockup: boolean; defaultLayer: CityLayer; cars: boolean; shadows: 'off' | 'static'; firstDetail: CityDetail; releaseOnExit: boolean }
export const CITY_PROFILES: Record<QualityPresetId | 'telefon', CityProfile>;
export function cityProfile(preset: QualityPresetId, isMobile: boolean): CityProfile;   // isMobile → 'telefon', bez względu na preset
export const TREES_MAX = 400;
export const CARS_MAX = 80;
export interface CityProps { root: Group; tick(dtSec: number, hour: number, weekend: boolean): void; setLayer(layer: CityLayer): void; dispose(): void }
export function buildCityProps(city: CityState, plans: readonly BuildingPlan[], opts: { cars: boolean }): CityProps;
export function countShadowCasters(root: Object3D): number;
// RenderContext: setStaticShadows(on: boolean): void; refreshShadows(): void
// SceneHost: cityStats(): { shown: boolean; built: boolean; detail: CityDetail | null; layer: CityLayer | null; cars: number; drawCalls: number; shadowCasters: number }
```

| Profil | `mockup` | `defaultLayer` | `cars` | `shadows` | `firstDetail` | `releaseOnExit` |
|---|---|---|---|---|---|---|
| `telefon` | tak | `ruch` | nie | `off` | `prosty` | tak |
| `niska` | tak | `ruch` | nie | `off` | `prosty` | tak |
| `srednia` | tak | `makieta` | tak | `static` | `pelny` | nie |
| `wysoka` | tak | `makieta` | tak | `static` | `pelny` | nie |

- Zasady:
  - **Drzewa:**
    - jedna `InstancedMesh` ze sklejonym pniem i koroną (kolory wierzchołków);
    - stoją w kwartałach parku co ok. 12 m i na podwórkach (wnętrza kwartałów poza obrysami z Zadania 10);
    - najwyżej `TREES_MAX`, widoczne tylko w makiecie.
  - **Auta:**
    - jedna `InstancedMesh` (nadwozie z kabiną) z `instanceColor` z `PALETTE.clothes`;
    - liczba na odcinku proporcjonalna do `streetIntensity` w godzinie gry, razem najwyżej `CARS_MAX`;
    - jadą prawym pasem `streetRect` z prędkością ok. 8 m/s; `tick` tylko przy widocznej makiecie;
    - bez cieni; nie ma ich przy `cars: false` i w warstwach.
  - **Cienie statyczne:**
    - w makiecie przy `shadows: 'static'` chunki i drzewa rzucają cień, a ziemia go przyjmuje;
    - `setStaticShadows(true)` wyłącza `shadowMap.autoUpdate`;
    - `refreshShadows()` przy `showCity`, `setLots`, zmianie pory dnia i presetu;
    - `hideCity` przywraca cienie dynamiczne sklepu.
  - **Profil:** `showCity` czyta `cityProfile(ctx.preset, isMobile)` (pierwsza geometria, auta, cienie). `hideCity` zwalnia scenę przy `releaseOnExit`; dziś warunkiem jest `ctx.preset === 'niska'`.
- [ ] **Krok 1: testy:**
  - `cityProfile('wysoka', true)` to profil `telefon`;
  - budżet §19: `countDrawCalls(root) + countShadowCasters(root)` makiety z drzewami i autami < 150 (10 seedów), a warstw < 60;
  - drzewa nie leżą w obrysach budynków ani na ulicach;
  - auta leżą w prostokątach swoich ulic;
  - w szczycie (8:00) aut jest więcej niż w nocy (3:00), w weekend w Biurowcach mniej niż w dzień roboczy;
  - deterministycznie z seeda;
  - warstwy i `cars: false` dają 0 widocznych aut;
  - renderer (atrapa): `setStaticShadows` przełącza `autoUpdate`, a `refreshShadows` ustawia `needsUpdate`;
  - Review Focus 5 (`sceneCity.test.ts`):
    - profil `telefon`: `hideCity` zwalnia wszystkie geometrie i materiały miasta (licznik);
    - ponowne `showCity` buduje `prosty`;
    - `cityStats()` mówi prawdę w każdym kroku.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npm run build && npx vitest run src/render src/game` → PASS; commit `feat(render): drzewa i auta w makiecie, profile miasta, cienie statyczne i zwalnianie sceny na telefonie`.

### Zadanie 13: benchmark miasta i bramka wydajności

**Model:** standardowy (sonnet).

**Pliki:**
- Zmień:
  - benchmark: `src/bench/bench.ts`, `src/main.ts` (gospodarz benchmarku: miasto), `src/ui/BenchOverlay.tsx`;
  - smoke: `scripts/city-smoke.mjs` (przełącznik `--bench`: sam bieg `?bench=1&quick=1`)
- Testy: `src/bench/bench.test.ts`, `tests/citySmoke.test.ts` (parsowanie `--bench`)
- Raport: sekcja „Bramka makiety” w `docs/superpowers/reports/2026-11-01-miasto-4a2.md`

**Interfejsy:**
- Wymaga: `SceneHost.showCity`, `cityStats` (Zadanie 12); `generateCity`.
- Daje:
```ts
export interface BenchCityRow extends SampleStats { preset: QualityPresetId; layer: CityLayer }
interface BenchExtra { /* … */ city: BenchCityRow[] }      // `__benchResult` (sklep) bez zmiany kształtu
interface BenchHost { /* … */ setCity(layer: CityLayer | null): void }   // null: z powrotem sklep
// BenchTimings: cityWarmupMs 2000, cityMeasureMs 8000; wersja quick: 500 i 1500
```
- Kolejność:
  1. Po presetach i próbach sklepu, dla każdego presetu z `BENCH_PRESETS`: `setPreset`, `setCity('makieta')`, rozgrzewka, pomiar i wiersz.
  2. Na `niska` dodatkowo `setCity('ruch')`, pomiar i wiersz.
  3. `setCity(null)` i `restore`.
- Miasto benchmarku to `generateCity(BENCH_SEED)` ze stanami z generatora, bez firmy. `console.table` drukuje też wiersze miasta.
- **Bramka** (Rozstrzygnięcie 13): koordynator prosi właściciela o `?bench=1` na laptopie bazowym i na telefonie i wpisuje liczby do raportu.
  - Jak właściciel dochodzi do makiety: po Zadaniu 13 koordynator scala i wdraża gałąź na produkcję (makieta nie ma jeszcze przycisków, więc gracze jej nie widzą), a właściciel otwiera `https://traszka.vercel.app/?bench=1` na obu urządzeniach. Adresy wdrożeń z podglądu stoją za logowaniem Vercela, więc się do tego nie nadają.
  - Wykonawca przed tym wdrożeniem sprawdza, że `?bench=1` nie wysyła niczego do `/api/**`.

| Pomiar | Próg |
|---|---|
| laptop, Średnia, makieta | ≥ 50 FPS średnio, p95 ≤ 25 ms |
| telefon, `ruch` | ≥ 30 FPS |
| telefon, makieta | ≥ 24 FPS |
| każdy wiersz | `calls` < 150 |

  Gdy próg nie przechodzi, zmienia się tylko `CITY_PROFILES`:
  1. Średnia: najpierw `cars: false`, potem `shadows: 'off'`;
  2. telefon: `mockup: false`.

  Każdą zmianę mierzy się ponownie. Rozgrywka nie zależy od wyniku.
- [ ] **Krok 1: testy** (`BenchRun` na sztucznym zegarze): po presetach są trzy wiersze makiety i jeden `ruch` na Niskiej, `setCity(null)` na końcu, przerwa w karcie powtarza krok miasta jak krok presetu, a `__benchResult` ma ten sam kształt co dziś.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. W `city-smoke.mjs` tryb `--bench` używa tego samego `vite preview`, tej samej blokady sieci i `locale: 'pl-PL'` co reszta skryptu.
- [ ] **Krok 4:** `npx vitest run src/bench tests/citySmoke.test.ts` → PASS. Potem `npm run build && npm run city:smoke -- --bench`: bieg się kończy, a `__benchExtra.city` ma 4 wiersze z `calls` < 150. Commit `feat(bench): ujęcie miasta w benchmarku i bramka makiety`.

### Zadanie 14: przyciski „Makieta / Ruch / Dzielnice” i widok startowy

**Model:** tani (haiku).

**Pliki:**
- Zmień:
  - UI: `src/ui/city/CityPanel.tsx`, `src/ui/state.ts`, `src/i18n/en/ui/city.ts`;
  - start i ekran: `src/main.ts` (`cityLayer` na start z `cityProfile(preset, isMobile).defaultLayer`), `src/game/cityScreen.ts` (przy `mockup: false` tryb `makieta` spada do `ruch`)
- Testy: `src/ui/city/CityPanel.test.tsx`, `src/game/cityScreen.test.ts`

**Interfejsy:**
- Wymaga: `cityProfile`, `CITY_PROFILES` (Zadania 12–13).
- Daje:
  - trzy przyciski „Makieta / Ruch / Dzielnice” (§9.1), po angielsku „Model / Footfall / Districts”;
  - „Makieta” tylko przy `mockup: true`;
  - legenda tylko dla „Ruch” i „Dzielnice”;
  - zmiana presetu w ⚙ nie przestawia wybranego trybu.
- [ ] **Krok 1: testy:**
  - przyciski i `aria-pressed`;
  - profil `srednia` startuje w `makieta`, a `telefon` w `ruch`;
  - przy `mockup: false` nie ma przycisku, a `cityLayer = 'makieta'` daje `showCity(…, 'ruch')`;
  - angielski.
- [ ] **Krok 2:** FAIL. **Krok 3:** implementacja. **Krok 4:** `npx vitest run src/ui src/game/cityScreen.test.ts tests/i18n.test.ts` → PASS; commit `feat(ui): przełącznik Makieta / Ruch / Dzielnice z widokiem startowym z profilu`.

### Zadanie 15: smoke makiety i bramki końcowe

**Model:** standardowy (sonnet).

**Pliki:**
- Zmień: `scripts/city-smoke.mjs` (kroki 13–15; krok 15 woła tryb `--bench` z Zadania 13), `tests/citySmoke.test.ts`
- Raport: sekcja „Smoke makiety” i zrzuty w `docs/superpowers/reports/2026-11-01-miasto-4a2/`

**Interfejsy:**
- Wymaga: `cityStats` w `window.traszkaGame` (Zadanie 12), przycisków (Zadanie 14), benchmarku (Zadanie 13).
- [ ] **Krok 1: smoke:**
  - **Krok 13, komputer** (preset domyślny, czyli `srednia`):
    - Miasto otwiera się w makiecie;
    - `cityStats()`: `detail === 'pelny'`, auta > 0, `drawCalls + shadowCasters` < 150;
    - „Ruch” i „Dzielnice” dają auta 0 i `drawCalls` < 60;
    - zrzut wolnego lokalu z bliska (kartka w ciemnej witrynie) i lokalu „po Traszce” z fixture z Zadania 9.
  - **Krok 14, telefon** (profil `telefon`):
    - Miasto startuje w `ruch` na `prosty`;
    - „Makieta” daje `pelny` i auta 0;
    - wyjście z zakładki daje `built === false`, a powrót znów `prosty`;
    - bez poziomego przewijania z trzema przyciskami w pasku miasta, po polsku i po angielsku;
    - FPS warstwy i makiety z licznika F3 do raportu (orientacyjnie, swiftshader).
  - **Krok 15:** pełny bieg zawiera też bieg `--bench`: `?bench=1&quick=1` kończy się, a `__benchExtra.city` ma 4 wiersze z `calls` < 150.
  - Konsola i `pageerror` bez błędów.
- [ ] **Krok 2: bramki** jak w Zadaniu 9, Krok 3, plus `npm run city:smoke -- --bench` → „ok”.
- [ ] **Krok 3:** raport uzupełniony (liczby z prawdziwych urządzeń, jeśli właściciel je przysłał, i ustawienia `CITY_PROFILES` po bramce); commit `test(miasto): smoke makiety 3D, profili i benchmarku miasta bez okna przeglądarki`. Przegląd etapu (Opus, §20) zleca koordynator.

# Palety bez odsyłania, debet 100 tys., cele „Odbierz”, rzadsze karty: raport (SIM_VERSION 5)

Data: 2026-10-30 · Gałąź: `claude/palety-bez-odsylania-6d9793` (od `main` 2446bb0) · Spec: `docs/superpowers/specs/2026-10-30-palety-bez-odsylania-design.md`

Nic nie zostało wypchnięte ani scalone. Koordynator wypycha tę zmianę zasad w poniedziałek 2.11.2026, na granicy tygodnia rankingu.

## 1. Stan na koniec

| Sprawdzenie | Wynik |
|---|---|
| `npm test` | 142 pliki, 4391 testów zielonych (2 pominięte, `runIf`) |
| `npx tsc --noEmit` | 0 błędów |
| `npm run build` | przechodzi (bundle sędziego 206 KB, `tsc`, `vite build`) |
| `npm run check:vercel-build` | **PASS** (25 sprawdzeń); odtworzenie 3 miesięcy w funkcji: zimny start 446 ms, mediana ciepłych 406 ms |
| Smoke headless (`vite preview`, `?debug=1`) | przechodzi, szczegóły w §8 |

Wersja symulacji: `SIM_VERSION` 4 → 5, `GOLDEN[5] = 7f4ffe2f…a009`. Bundle sędziego przebudowany lokalnie przez `npm run build:judge`. Plik jest w `.gitignore`, bo buduje go `npm run build` na Vercelu.

## 2. Skąd 27 odesłanych palet u właściciela

Odtworzone na SIM 4 (kod z 2446bb0), boty z `tycoon/bots.ts`, gracz z wózkiem, regałami, rampą i 3 osobami. Pełne liczby są w specyfikacji, §2.

- **Asystent (tryb auto) nie odsyła prawie nic.** Na 5 seedach przez 60 dni było 0 odesłań. Zapas liczy razem z paletami, więc przy pełnych półkach zamawia mniej.
- **Zamówienie ręczne ponad sprzedaż odsyła dziesiątki palet.**
  - 8 palet dziennie przy sprzedaży ok. 6: kierowca zabrał 41–62 palety w 30 dni.
  - 10 palet dziennie: 99–126 palet.
  - W chwili odesłania półki i zaplecze są pełne w 100%. Palety stoją 2–8 dni z resztką towaru, na którą nie ma miejsca, i zajmują miejsca.
- **Hipoteza „w falach załoga stoi przy kasach” się nie potwierdza.**
  - Rozładunek bez rąk (`starved.rozladunek`) był równy 0, a bezczynność wynosiła ok. 135–140 osobominut dziennie.
  - Rozładunek stoi, bo towar nie ma gdzie trafić.
- **Drugie źródło: asystent zamawiał ponad liczbę miejsc.** Ograniczała go tylko wydajność zmiany (`crewPalletCap`), przy 3 osobach z wózkiem 17 palet. Sklep miał 15 miejsc. Przy pustych półkach (start, powiększone półki po remoncie) kierowca zabierał 1–2 palety.

Wniosek: odesłane palety były objawem nadmiaru towaru. Teraz ten nadmiar stoi w sklepie i go widać.

## 3. Co się zmieniło w zasadach

| Obszar | Zmiana | Gdzie |
|---|---|---|
| Odsyłanie | Kierowca nie zabiera palet, gracz nie odsyła. Znika `RETURN_FEE` i `TRUST.returnedPallet`/`driverReturned`. Typ `returnPallet` zostaje w unii `Command` jako zawsze odrzucany, żeby zapisane biegi rankingowe z SIM 4 dalej przechodziły `readRun`. | `economy.ts`, `commands.ts`, `trust.ts` |
| Przejścia | Nowe miejsce `aisle`. Gęste kwadraty 2×2 w sali, zawsze z drogą od wejścia do kolejki i kasy. Pojemność bez końca: po ostatnim kwadracie palety stają piętro wyżej (`palletPlace`). | `storeInfo.ts` |
| Zagracenie | Liczą się palety w sali i w przejściach (Z). Ruch × `max(0,5; 1 − 0,08·(Z + worki))`, cierpliwość −`min(3, Z)`. Reputacja co minutę otwarcia spada o 0,0006 × `min(8, palety w przejściach)`, ale nie poniżej 25. | `catalog.ts` `CLUTTER`, `economy.ts` |
| Wyjście z zagracenia | Paletę spod sklepu bez miejsca na towar załoga po 2 h wciąga w przejścia. Rozładunek zaczyna od chodnika, potem przejścia, sala i zaplecze. | `economy.ts` `pullInStuck`, `PALLET_ORDER` |
| „Palety za często” | Paleta 320 → **480 sztuk**: 3,5–4,5 palety dziennie zamiast 5–7. Stałe na paletę przeskalowane ×1,5 (opłata 6 × 60 → 4 × 90 zł, mandat za paletę 150, Straż `perPallet` 0,375, złota paleta 3,75%, XP 18, worki 1,5 i 3, zamówienie ręczne domyślnie 3). | `catalog.ts`, `progress.ts`, `waste.ts` |
| Asystent | Nie zamawia ponad zwykłe miejsca, na które stawia kierowca (`deliverySpots`). Sam nigdy nie zagraca przejść. | `economy.ts` |
| Kredyt kupiecki | Liczy też palety w drodze. Wcześniej popołudniowa tura (`dostawy2`) przepychała zapas ponad limit. | `economy.ts` `placeOrder` |
| Debet | `DEBT_LIMIT` −10 000 → **−100 000**, ostrzeżenie przy −50 000. | `catalog.ts` |
| Cele | Spełniony cel czeka w `milestonesReady`. Nagroda przychodzi dopiero po komendzie `claimMilestone`, która idzie do dziennika biegu. | `economy.ts`, `commands.ts`, `sanitize.ts` |
| Karty | 0,5 na dobę łącznie: 0 albo 1 karta dnia (60/40%), okólnik co 4–6 dni. **Każda karta waży ×3** (`CARDS.stakes`, §6). | `cards.ts` |
| Opłata Centrali | `FRANCHISE_FEE_SHARE` 0,151 → 0,153 (§5). | `catalog.ts` |

**Widok** (interfejs i render):

- przycisk „Odeślij” i teksty o odsyłaniu zniknęły (panele, pomoc, podpowiedź);
- palety w przejściach stoją w scenie i tworzą stosy, a nad każdym kwadratem jest znacznik ⚠️ z czerwoną poświatą;
- klienci obchodzą przejścia (przeszkody tłumu);
- panel „Palety” pokazuje liczbę palet w przejściach;
- cele do odebrania są na górze panelu „Cele” z przyciskiem „Odbierz”, a w HUD jest plakietka „🎁 N”.

**Poprawka starego błędu** (osobny commit): animacja podskoku znacznika nadpisywała `transform`, którym worldOverlay ustawia pozycję. Wszystkie znaczniki w świecie (złota paleta ✨, paleta pod sklepem ⚠️) stały w lewym górnym rogu, pod paskiem, od commita d90ebd2. Teraz stoją nad paletami.

## 4. Nadmiar palet w liczbach (`tycoon/overflow.test.ts`)

*Liczby w tej sekcji są sprzed urealnienia ekonomii. Aktualne są w §12.*

Sklep `kopytka-541` (6 miejsc pod sklepem, 3 w sali), bot `decydent`. Od dnia 3 do 12 zamawia ręcznie 12 palet dziennie, od dnia 13 wraca do asystenta. Punkt odniesienia to ten sam bot z samym asystentem.

| | Bez nadmiaru | Z nadmiarem |
|---|---|---|
| Palet w przejściach w szczycie | 0 | **13** (dzień 12), przez 13 dni co najmniej 6 |
| Klienci na dzień (dni z co najmniej 6 paletami w przejściach) | 480–630 | **185–325** (ok. 40%) |
| Reputacja | 53 → 55 | 56 → **25** (próg zagracenia, dni 13–19), do 47 w dniu 44 |
| Przejścia puste | | od dnia 22, czyli **9 dni** po powrocie do asystenta |
| Klienci w dniu 44 | 548 | 444 (81%) |
| Wynik września | **+10 069 zł** | **−6 609 zł** |
| Mandaty, koniec gry | | brak, brak |

Żadna paleta nie znika: rozładowane plus stojące zawsze równa się dostarczonym (test sprawdza to codziennie).

**Kredyt kupiecki ogranicza nadmiar sam.** Towar w sklepie i w drodze może być wart najwyżej 70 tys. zł, czyli ok. 24 palety razem z półkami i zapleczem. W średnim sklepie na start (`traszka-1`, 12 zwykłych miejsc) nadmiar w ogóle nie trafia w przejścia. Właściciel z dużym sklepem po remontach miał wyższy kredyt (×1,5 na poziom remontu), więc u niego przejścia się zapełnią.

**Pomiar przed wciąganiem palet** pokazał pułapkę. Pięć palet spod sklepu bez miejsca na towar stało dwa tygodnie. Straż pisała mandaty po ok. 5,6 tys. zł dziennie, każdy za −2 reputacji. `seed-3` zbankrutował w dniu 26, choć gracz wrócił do asystenta w dniu 13. Wciąganie palet w przejścia i próg reputacji 25 to poprawki z tego pomiaru (spec §4 i §5).

## 5. Bilans: gracz bierny i aktywny (`tycoon/balance.test.ts`, 61 dni)

*Liczby w tej sekcji są sprzed urealnienia ekonomii. Aktualne są w §12.*

| Seed | bierny (zł) | mistrz (zł) | klienci/dzień (bierny / mistrz) | karty/dobę |
|---|---|---|---|---|
| traszka-1 | **+38** | **22 390** | 573 / 574 | 0,46 |
| kopytka-541 | **+354** | **25 805** | 536 / 548 | 0,49 |
| makieta | **+10 622** | **27 507** | 550 / 551 | 0,57 |
| lublin-9 | **+686** | **36 292** | 538 / 558 | 0,48 |
| seed-3 | **+292** | **27 068** | 540 / 564 | 0,46 |

- **Bierny:**
  - mediana +354 zł;
  - 4 z 5 sklepów w widełkach −4 do +2 tys. zł;
  - `makieta` +10,6 tys. zł: trafione KPI i audyt dały zaufanie 78, a od 70 Centrala płaci premię od obrotu, ok. 7 tys. zł miesięcznie.
- **Mistrz:** 22–36 tys. zł na każdym sklepie.
- **Stukanie:** dokłada najwyżej ok. 3% do wyniku mistrza.
- **Decyzje:** decydent wygrywa ze stukaczem na każdym sklepie.
- **Inne seedy:** na próbie 10 innych bierny miał od −3,5 do +11,6 tys. zł (mediana ok. +0,7 tys.), a mistrz od 20,0 do 29,8 tys. zł. Dla porównania w SIM 4 na 9 innych seedach: bierny od −8 do +10 tys., mistrz od 22 do 34 tys.

**Zmiana testu bilansu (do akceptacji koordynatora).**

- Dotąd: każdy z 5 sklepów w −4 do +2 tys. zł.
- Teraz:
  - co najmniej 4 z 5 sklepów w tych widełkach;
  - mediana najwyżej +1 tys. zł;
  - na każdym sklepie bierny ma najwyżej połowę wyniku mistrza.
- Powód: przy 0,5 karty na dobę pojedyncze losowanie (KPI, audyt) waży więcej, a `makieta` trafia akurat dobrze.

## 6. Karty: XP i zaufanie przed zmianą i po niej

*Liczby w tej sekcji są sprzed urealnienia ekonomii. Aktualne są w §12.*

Średnio na sklep, 5 seedów testu bilansu, wrzesień / październik:

| | SIM 4 | SIM 5 |
|---|---|---|
| Kart w miesiącu (w tym okólników) | 34,2 (10,2) / 35,4 (10,2) | 14,8 (5,4) / 15,2 (6,4) |
| XP z kart | 393 / 405 | **175 / 184** |
| Zaufanie z kart i okólników, bierny | −6,8 / −8,0 | −9,6 / −7,2 |
| Zaufanie z kart i okólników, mistrz | +8,1 / +7,0 | +14,4 / +8,7 |
| Wynik miesiąca, bierny | +2 315 / −3 326 | +3 603 / −1 204 |
| Wynik miesiąca, mistrz | +15 446 / +9 623 | +14 175 / +13 637 |

**XP z kart spada o ok. 55%**, ale to ok. 6 XP dziennie przy ok. 550 XP z klientów. Poziom po dwóch miesiącach jest ten sam (14).

**Zaufanie z kart** zostaje w podobnej skali dzięki wadze ×3:

- mnożnik dotyczy pieniędzy, zaufania, reputacji oraz efektów ruchu i marży;
- nie dotyczy mandatów, czasu ludzi, sił, Ogonków, zamknięcia sklepu ani osób na zmianie.

**Bez wagi ×3** bierny miał medianę +5,2 tys. zł, a mistrz był tylko 1,3–2,6 raza lepszy. Mandat `MINOR_SALE_FINE` zostaje bez mnożnika, zgodnie z poleceniem.

**Do wiedzy właściciela:** kwoty na kartach są teraz trzy razy większe (np. glitch kasy z rabatem 20%). Gracz rzadziej klika, ale każda decyzja więcej waży.

## 7. Debet −100 tys. i mandat za energetyk (`tycoon/debt.test.ts`)

*Liczby w tej sekcji są sprzed urealnienia ekonomii. Aktualne są w §12.*

Mandat za sprzedaż nieletniemu (`MINOR_SALE_FINE = {min: 4000, dailyMargins: 2}`) wynosi w tych sklepach ok. 4,3–4,8 tys. zł. Bierny gracz, wymuszone mandaty rozłożone na 2 miesiące:

| Mandatów | Najniższa gotówka (`makieta` / `traszka-1` / `lublin-9`) | Skutek |
|---|---|---|
| 3 (do SIM 4 koniec gry) | −8,2 / −12,6 / −12,2 tys. zł | gra trwa, bez ostrzeżenia |
| 12 | −50,0 / −56,5 / −50,1 tys. zł | ostrzeżenie (−50 tys.) we wszystkich trzech |
| 15 | −61,2 / −68,9 / −63,6 tys. zł | ostrzeżenie, gra trwa |
| 22 | −94,0 / **−103,8** / −98,9 tys. zł | koniec gry tylko w `traszka-1` |

Groźba mandatu słabnie około siedmiokrotnie: zamiast 3 do końca gry trzeba ok. 22–26. Nie przestrajałem, zgodnie z poleceniem. Jeśli właściciel chce, żeby taki mandat dalej był groźny, można podnieść `min` albo `dailyMargins`. To decyzja do zgłoszenia.

## 8. Smoke w headless Playwright

`vite preview` na zbudowanym `dist`, Chrome headless shell ze swiftshader, `?debug=1`. Skrypt i zrzuty leżą w folderze notatek sesji: `/Users/mpawelczuk/Library/Application Support/Claude/side-session-notes/local_f64f0989-d2f7-49da-a10f-db41d55db729/palety-smoke/`.

**A. Nowa gra (`kopytka-541`) i dostawa 20 palet:**

- 6 pod sklepem, 3 w sali, **13 w przejściach**, nic nie zniknęło;
- komunikat „Zabrakło miejsca, 13 palet w przejściach!” jest, komunikatu o zabraniu palety nie ma;
- w panelu „Palety” nie ma przycisku „Odeślij”, jest „W przejściach 13 palet ⚠️”;
- zrzuty: `A1-nadmiar-w-przejsciach.png`, `A2-panel-palet.png`, `A3-znaczniki.png` (znaczniki ⚠️ nad przejściami).

**B. Stary zapis z SIM 4** (`src/game/fixtures/save-sim4-palety.json`, zrobiony kodem z 2446bb0):

- wczytuje się bez komunikatu (`fromSave`);
- 10 palet po 320 sztuk na swoich miejscach (chodnik, sala, zaplecze);
- cele `pallet1`, `cust500` i `earned10k` zostają odebrane, a `milestonesReady` jest puste;
- zrzuty: `B1-zapis-sim4.png`, `B2-cele.png`.

**Konsola i sieć:** ani jednego błędu i żadnego `pageerror`. Są tylko 4 ostrzeżenia sterownika swiftshader („GPU stall due to ReadPixels”), które nie pochodzą z gry. Nie było zapytań poza localhost (poza `blob:`) i nic nie poszło do produkcyjnego `/api`.

Ten sam zapis z SIM 4 sprawdza test `src/game/session.test.ts`: dwa dni dalej przychodzą dostawy po 480 sztuk, żadna paleta nie znika i nikt nic nie zabiera.

## 9. Ranking: co zmieniło się w testach i skryptach

| Plik | Zmiana |
|---|---|
| `tests/simGolden.test.ts` | `PLAN` ma `claimMilestone` (dwa odbiory i jedna odmowa przed czasem). `returnPallet` zostaje jako odmowa; osobny test sprawdza, że bez niego wynik jest ten sam. Nowa lista `CARD_ANSWERS` i generator (`GOLDEN_CARDS=1 npx vitest run tests/simGolden.test.ts -t 'nowa lista' --silent=false`). Do tego `GOLDEN[5]`. |
| `scripts/judge-worst-case.mjs` | `COMMANDS` ma `claimMilestone`. |
| `tests/rankedSeason.test.ts` | `PLAN` ma odbiory celów. |
| `tests/judgeBundle.test.ts`, `src/server/api.test.ts`, `src/game/rankedRun.test.ts`, `src/sim/ranked.test.ts` | Scenariusze bankructwa przy −10 tys. przestały działać: sam remont, 30 palet od pierwszego dnia i bierny `kiełbasa-42` już do debetu nie sprowadzają. Nowe scenariusze to 6 etatów więcej plus 30 palet dziennie od wybranego dnia. Bankructwo przed końcem sezonu: `szarlotka-380` od 10.10. Debet dokładnie przy zamknięciu 30.11: `kiełbasa-42` od 18.10. Oba strojone pod SIM 5 i opisane w komentarzach. |
| `src/server/verify.test.ts` | Limit czasu 30 s dla testu z dwoma odtworzeniami sezonu. Przy pełnym zestawie równolegle przekraczał 5 s. |

`scripts/ranking-smoke.mjs` (`SMOKE_LOG`) nie wymagał zmian: nie ma w nim `returnPallet`, a jego polecenia dalej zmieniają wynik.

## 10. Dla koordynatora: scalanie z równoległymi sesjami

**Opłata w HUD** (helper prognozy, czyta `DEBT_LIMIT`):

- `DEBT_LIMIT` ma teraz −100 000, a `FRANCHISE_FEE_SHARE` 0,153 zamiast 0,151. Jeśli prognoza ma własne testy z liczbami, zmienią się po scaleniu.
- Możliwy konflikt tekstowy w `src/ui/game/Hud.tsx`: dodałem `ClaimChip` w drugim rzędzie paska.

**Roboty** (eDward, maszyny, drzwi zaplecza):

- dotknąłem `src/render/staff/targets.ts` (tylko `PALLET_ORDER` z `aisle`) i testów `targets.test.ts` oraz `crew.test.ts`;
- `src/game/scene.ts`: przeszkody tłumu i znaczniki palet idą przez nowe `crowdObstaclesOf` i `palletMarkersOf` w `src/game/palletRefs.ts`;
- `src/ui/ui.css`: keyframes `tt-bob` i style celów.

Po scaleniu trzeba ponownie uruchomić `npm run build:judge`, `npm test`, `npm run check:vercel-build`.

**`GOLDEN[5]`** policzono na tej gałęzi. Jeśli któraś z równoległych sesji zmieni cokolwiek w `src/sim` (nie powinna), skrót się rozjedzie i test wypisze nowy.

## 11. Do decyzji właściciela

1. **„Palety są za często”: większa paleta zamiast rzadszej dostawy.** Dostawa co drugi dzień nie mieści się w magazynie: zapas docelowy starcza na 0,94–2,57 dnia sprzedaży. Jeśli właścicielowi chodziło o rzadsze dostawy, a nie o mniej palet, to osobna, większa zmiana (pojemność zaplecza, rytm zamówień).
2. **Karty ×3:** kwoty i efekty na kartach są trzy razy większe niż w SIM 4.
3. **Mandat za energetyk** przestał być groźny przy −100 tys. (§7).
4. **Bierny na `makieta`** kończy dwa miesiące na +10,6 tys. zł (§5).
5. **Załoga sama wciąga stojące palety w przejścia.** To decyzja tej sesji, która ratuje przed bankructwem z mandatów. Gdyby właściciel wolał, żeby gracz wnosił palety ręcznie, trzeba dopuścić `movePallet` do przejść i nauczyć tego boty.

## 12. Urealnienie ekonomii (decyzja właściciela z 30.10.2026: „Tak, urealnij”)

Źródło liczb to publiczne dane dużej sieci convenience za 2025 r.

- Marża franczyzobiorcy wynosi ok. 446 tys. zł rocznie, czyli ok. 16,5–16,7% obrotu przed jego kosztami.
- Obrót sklepu to 2,4–2,7 mln zł rocznie.
- Przychód gwarantowany nowego franczyzobiorcy to 25 tys. zł miesięcznie.
- Wkład na start wynosi ok. 5000 zł.

W samej grze nazwy sieci nie ma. Decyzje są w specyfikacji, §11.

### 12.1 Tabela: prawdziwy sklep, SIM 4, SIM 5

Średnio na 5 sklepach testu bilansu (`traszka-1`, `kopytka-541`, `makieta`, `lublin-9`, `seed-3`), z dwóch pierwszych miesięcy gry (bot `bierny` albo `mistrz`). Udział franczyzobiorcy to marża minus opłata Centrali plus premie, podzielone przez obrót.

| | Prawdziwy sklep (2025) | SIM 4 | SIM 5 przed urealnieniem | **SIM 5** |
|---|---|---|---|---|
| Obrót dziennie, bierny | 6,6–7,4 tys. zł | 11,5 tys. zł | 11,9 tys. zł | **7,8 tys. zł** (start ok. 6,4 tys.) |
| Obrót dziennie, mistrz | | 12,0 tys. zł | 12,1 tys. zł | **8,7 tys. zł** |
| Udział franczyzobiorcy, bierny | ok. 16,5–16,7% | 4,6% | 4,6% | **16,5%** |
| Udział franczyzobiorcy, mistrz | trochę więcej przy dobrej współpracy | 7,2% | 7,7% | **18,1%** |
| Wynik miesiąca po kosztach, bierny | „kilka do kilkunastu tys. zł” na rękę | −0,5 tys. zł | +1,2 tys. zł | **+5,9 tys. zł** (od +1,2 do +12 tys.) |
| Wynik miesiąca po kosztach, mistrz | | +12,5 tys. zł | +13,9 tys. zł | **+14,6 tys. zł** (od +9 do +19 tys.) |
| Wózek paletowy (dzień zakupu) | | 1–5 | 1–6 | **0** (start 5000 zł) |
| Rampa (poziom 6, 9 tys. zł) | | 20–29 | 17–27 | **17–40** |
| Remont 1 (poziom 8, 25 tys. zł) | | 104–178, `traszka-1` nigdy w roku | 108–157, `traszka-1` nigdy | **57–131** |
| Remont 2 (poziom 14, 80 tys. zł) | | nigdy w roku | nigdy w roku | **174–269** |
| eDward (poziom 25, remont 2, 220 tys. zł) | | nigdy w roku | nigdy w roku | nigdy w roku (poziom 25 w dniach 175–216) |

**Jak liczone są dni do ulepszeń.**
- Kupujący to bot `mistrz`, który kupuje po kolei: wózek, regały, ulotki, szkolenie, rampa, ulotki, trzecia osoba, remont 1, taśmociąg, druga dostawa, remont 2, taśmociąg ×2, wykładacz ×2, eDward.
- Kupuje, gdy wolne środki po zakupie (gotówka minus to, co netto zabierze Centrala przy zamknięciu miesiąca) wynoszą co najmniej 2000 zł.
- Horyzont pomiaru to rok gry.

**Tempo progresji jest szybsze niż w SIM 4**, więc ceny ulepszeń (z eDwardem za 220 tys.) zostały bez zmian. eDward nadal jest celem na drugi rok gry.

### 12.2 Co się zmieniło

| Stała | Było | Jest | Dlaczego |
|---|---|---|---|
| Ruch: `TRAFFIC_BASE` / `PER_SHELF_ITEM` / `RANGE` | 23 / 1/180 / [12, 60] | 13 / 1/320 / [7, 34] | sklep na start ok. 260–350 klientów (6–7,5 tys. zł); przy krótkiej kolejce reputacja rośnie i z nią ruch (średnio 7,8 tys. zł w dwóch miesiącach) |
| Opłata Centrali | 2000 zł + 15,3% | 1000 zł + 3,4% | przy przeciętnym zaufaniu zostaje ok. 16,5% obrotu |
| Premia od obrotu | 2% (zaufanie od 70), 3% (od 85) | 0,5% / 1% | przy wysokim zaufaniu ok. 17–18% |
| `START_CASH` | 2000 zł | 5000 zł | wkład na start |
| `WAGE_PER_DAY` | 340 zł | **500 zł** | 340 zł na 17 h to ok. 20 zł za godzinę, a pełny koszt pracodawcy przy płacy minimalnej 2025 to ok. 37 zł za godzinę. 500 zł (ok. 29 zł za godzinę) uwzględnia godziny, które w prawdziwym sklepie pokrywa sam franczyzobiorca. Z dawną płacą bierny miał +20–30 tys. zł miesięcznie zamiast kilku. |
| `LEVEL_CASH` | 400 + 200 zł za poziom | 100 + 50 zł | dawna nagroda dawała ok. 9 tys. zł miesięcznie, tyle co wcześniej wyrównywało biernemu opłatę |
| `XP.customer` | 1 | 1,3 | klientów jest ok. 40% mniej, a poziomy przychodzą w podobnym tempie (6 w dniach 5–8, 14 w dniach 45–59) |
| `GUARANTEE` (nowe) | | 25 tys. zł, 3 miesiące, zaufanie co najmniej 40, bez mandatu | §12.3 |

**Bez zmian:**
- media (140 zł × wielkość sali, czyli 3–7,5 tys. zł miesięcznie, rozsądnie wobec prądu dla lodówek);
- premie KPI, złota paleta i kwoty na kartach (liczą się od marży dnia sklepu, więc maleją z ruchem same, ok. 35%);
- kredyt kupiecki 70 tys. zł (liczy się od wartości towaru, a nie od obrotu);
- debet −100 tys. zł;
- paleta 480 sztuk, karty ×3, wciąganie palet po 2 h i test biernego.

**Mandat za energetyk** (`MINOR_SALE_FINE`): przy realnym ruchu zawsze obowiązuje minimum 4000 zł. To ok. 3 dni przychodu franczyzobiorcy, a w SIM 4 ok. 8 dni. Bierny gracz z wymuszonymi mandatami:

| Mandatów w 2 miesiące | Skutek |
|---|---|
| 3 | gotówka nie schodzi poniżej ok. 0 |
| 18 | ostrzeżenie o debecie |
| ok. 30 | koniec gry |

Nie przestrajałem go.

### 12.3 Przychód gwarantowany

- **Zasada.** Przy zamknięciu każdego z pierwszych 3 miesięcy gry Centrala dopłaca do 25 tys. zł przychodu franczyzobiorcy, czyli marży minus opłaty plus premii. Warunki: zaufanie co najmniej 40 i miesiąc bez mandatu.
- **Dlaczego trzy miesiące:** to kwartał wdrożenia i zarazem cały sezon rankingowy, więc siatka chroni początek gry, a nie zastępuje decyzji.
- **Gdzie widać dopłatę:**
  - raport miesiąca ma pozycję „Dopłata do przychodu gwarantowanego” (licznik `guarantee`, księgowana jako premia Centrali);
  - podgląd końca miesiąca ma wiersz z warunkami i tekstem „Wierzymy w Ciebie. Do odwołania.”;
  - komunikat przy zamknięciu miesiąca. Gdy warunek nie jest spełniony, gra mówi, ile Centrala nie dopłaci i dlaczego („Regulamin, punkt 7.3.b, przypis drobnym drukiem”).
- **Kiedy działa:** w przeciętnym sklepie przychód franczyzobiorcy wynosi 34–45 tys. zł, więc dopłata włącza się tylko w słabym miesiącu, np. przy zamkniętym sklepie albo w bardzo małym lokalu. Tak samo jest w rzeczywistości: gwarancja 25 tys. przy średniej 37 tys.
- **Testy:** `economy.test.ts`, opis „przychód gwarantowany”.
- **Podgląd** (`monthPreview`) pokazuje dopłatę jak raport, a nieodebranych celów sam nie odbiera (test z poprzedniego kroku).

### 12.4 Tłum na ekranie przed zmianą i po niej

Pomiar w prawdziwej scenie: headless Chrome, `vite preview`, drugi dzień gry, 16:45–18:00, sklepy `traszka-1` i `kopytka-541`, co sekundę przez 40 s.

| | Przed (SIM 5 przed urealnieniem) | Po |
|---|---|---|
| Postacie w sklepie, szczyt | 9 i 9 | **8 i 10** |
| Postacie w sklepie, średnio | 6,9 i 7,5 | **6,7 i 7,6** |
| Kolejka z ekonomii, szczyt | 7,1 i 5,9 | **1,5 i 0,9** |

Tłum na ekranie zostaje prawie taki sam, bo ogranicza go preset grafiki i lustro tłumu. Wyraźnie krótsza jest kolejka: dwie osoby na zmianie przy ok. 300 klientach dziennie nadążają.

- **Tłum docelowy w szczycie** (`crowdRateFor`: klientów na godzinę × 0,35): było 15,2, teraz 8,6.
- **Najdłuższa kolejka dnia w symulacji:**

  | Gracz | Było | Jest |
  |---|---|---|
  | bierny | 6,8 | 2,6 |
  | mistrz | 7,1 | 4,3 |

Fale zostają. Ruch rośnie z reputacją, ulotkami, kampaniami, remontami i siecią sklepów bez górnego limitu poza `TRAFFIC_RANGE`.

### 12.5 Sprawdzenia

| Sprawdzenie | Wynik |
|---|---|
| `npm test` | 152 pliki, 4536 testów zielonych (2 pominięte) |
| `tsc` | 0 błędów |
| `npm run build` | przechodzi, bundle sędziego przebudowany |
| `npm run check:vercel-build` | **PASS** (25 sprawdzeń) |
| `GOLDEN[5]` | `fc9c4c59…232f` |

**Smoke'i headless** (`vite preview`, `?debug=1`):

- **Palety: przechodzi.**
  - Nadmiar to 13 palet w przejściach.
  - Komunikatu o zabraniu palet nie ma, przycisku „Odeślij” też nie.
  - Zapis z SIM 4 wczytuje się z paletami i odebranymi celami.
  - Konsola jest czysta, a zapytań poza localhost nie ma.
- **Roboty: PASS**, 18 sprawdzeń.
- **Opłata: pada w kroku 2 przez zamierzoną zmianę.**
  - Krok ustawia 60 tys. zł gotówki i 330 tys. zł obrotu, zakładając dawną opłatę 15,3%, czyli ok. 52 tys. do oddania.
  - Przy opłacie z SIM 5 do oddania jest 12,2 tys. zł, wolne 47,8 tys., więc żaden zakup nie przekracza wolnych środków, notka `.tt-spend` się nie pojawia i skrypt czeka na nią do limitu czasu.
  - Ich skryptu nie zmieniałem. Kopia z obrotem 1,5 mln zł (52 tys. do oddania, czyli założenie pierwotnego skryptu) przechodzi **26/26**: ostrzeżenia przy zakupach działają i nie blokują zakupu.
  - Do poprawienia w skrypcie sesji opłaty: obrót w kroku 2 trzeba liczyć z `FRANCHISE_FEE_SHARE` albo podnieść do ok. 1,5 mln zł.

### 12.6 Testy, które zmieniły się przez urealnienie

| Test | Zmiana |
|---|---|
| `tycoon/balance.test.ts` | Bierny na każdym sklepie na plus (do 30 tys. zł za dwa miesiące), mediana 5–20 tys. Mistrz 15–50 tys. i co najmniej 8 tys. więcej niż bierny. Stukanie najwyżej 20% (wychodzi ok. 1%). Decyzje wygrywają ze stukaniem. |
| `tycoon/debt.test.ts` | 3, 18 i 34 mandaty zamiast 3, 15 i 26. |
| Scenariusze debetu przy zamknięciu 30 listopada (`ranked.test.ts`, `rankedRun.test.ts`, `api.test.ts`) | `kiełbasa-42`: 30 palet dziennie od 25.10 i 6 etatów więcej od 26.10. Zapas wynosi ok. 500 zł, więc każda zmiana ekonomii może go przesunąć, a test powie to wprost. |
| `judgeBundle.test.ts` | Remont 1 w 55. dniu: wcześniej sklepu nie stać. |
| `simGolden.test.ts`, `rankedSeason.test.ts` | Zakupy w `PLAN` rozłożone na wrzesień i październik, krótki profil „porządek”, kampania w 25. dniu, piec w 55. Nowe `CARD_ANSWERS` z generatora. |
| `scripts/ranking-smoke.mjs` | `SMOKE_LOG`: ulotki i dodatkowy etat od 2. do 25. dnia. Same ulotki opłacały się na każdym sklepie, a test potrzebuje obu wyników: wychodzi 17 lepszych i 7 gorszych na 24. |
| Testy interfejsu (`spend.test.tsx`, `monthPreview.test.tsx`, `forecast.test.ts`, `scene.test.ts`, `howToText.test.ts`) | Liczby ze stałych zamiast wpisanych na sztywno, większy obrót tam, gdzie test potrzebuje dużej opłaty. |

### 12.7 Do decyzji właściciela

1. **Płace 500 zł zamiast 340 zł.** To jedyna zmiana kosztu, bez której cel „bierny kilka tysięcy na plus” się nie mieści. Przy realnym udziale w obrocie i starych płacach bierny miał +20–30 tys. zł miesięcznie.
2. **Gwarancja 25 tys. zł działa rzadko.** Przeciętny sklep i tak przekracza 25 tys. przychodu, tak jak w rzeczywistości. Jeśli ma być odczuwalna częściej, trzeba ją podnieść albo liczyć od wyniku po płacach, ale wtedy przestaje odpowiadać prawdziwej umowie.
3. **Krótsza kolejka.** Postaci na ekranie jest tyle samo, ale kolejka w szczycie spadła z 6–7 do 1–2 osób. Jeśli właściciel chce tłoku przy kasie, można zmniejszyć tempo kasy albo ruszyć fale; to zmiana symulacji, więc przed poniedziałkiem.
4. **Pierwszy miesiąc małego sklepu wychodzi w okolicy zera** (np. `kopytka-541`: −1 tys. we wrześniu, +3,4 tys. w październiku). Start jest powolny: gotówka rośnie o kilkaset złotych dziennie, a nie o 1,6 tys. jak w SIM 4.

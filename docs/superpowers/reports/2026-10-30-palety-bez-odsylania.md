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

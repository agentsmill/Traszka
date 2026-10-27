# Przewodnik stylu Traszki

Wzorzec: **Two Point Hospital**: ciepło, nasycenie, czytelność z daleka. Wartości z `src/render/style.ts`, tone mapping **Neutral** (AgX szarzy paletę). Każdy punkt to kryterium odbioru zadań 8–12 i 16. Właściciel przewodnika od zadania 16: przegląd wyglądu (zadanie 16, poprawki po bramie z zadania 17).

## 1. Bryła
- Prostopadłościany w kadrze to `RoundedBoxGeometry`: `BEVEL.medium` (3 segmenty) od 10 cm najmniejszego wymiaru, `BEVEL.small` (2) dla cieńszych, poniżej 3 cm `min(BEVEL.small, 0,4 × wymiar)`, drobiazgi < 5 cm w każdym wymiarze: 1 segment.
- **Wyjątek: opakowania towaru** (`products.ts`) mają fazę `BEVEL.small` w 1 segmencie (108 trójkątów na bryłę), choć są większe niż 5 cm. Przy domyślnym zoomie to obiekty ~5 px, a 2 segmenty dałyby ~+91 tys. trójkątów na `kiełbasa-42` (ruling R28).
- Elewacje: gzymsy, płyty balkonów i loggii, daszki nad witrynami i lizeny są fazowane (`GeomBuilder.faceRBox`, promień 3–6 cm, 1–2 segmenty). Parapety i nadproża okien zostają ostre: to setki brył na budynek po kilka pikseli.
- Blat ≥ 6 cm z nawisem 3–5 cm, półka ≥ 4 cm, cokół 10–12 cm cofnięty o 3 cm, słupki ≥ 6 cm. Gondola ≤ 1,6 m, regał ścienny i lodówka 2,0 m, lada 0,95 m.
- Sylwetka ma ≥ 2 uskoki (cokół → korpus → nadstawka lub blat).
- Builder mebla, przed scaleniem geometrii: ≥ 3 siatki (gondola i lodówka ≥ 8), ≥ 1 element w kolorze marki, ≤ 10 tys. trójkątów bez towaru.
- Obowiązkowe części. Gondola i regał: cokół, plecy, ≥ 4 półki z listwą cenową, nadstawka z kategorią. Lodówka: rama, szklane drzwi z uchwytem, półki, listwa LED, plecy w kolorze ramy z kratką skraplacza (w przekroju widać je z sali). Kasa: blat z nawisem, ekran, terminal, koszyk ze zdrapkami. Papierosy: fronty, podświetlenie. Hot-dogi: ≥ 4 rolki, szyba. Ekspres: tacka, kubki. Kasa samoobsługowa: słupek, ekran, półkę, skaner. Sloty: półprzezroczysty znacznik z ikoną „+”.
- Meble przy ścianie odwracają się do kamery tyłem, gdy ściana jest w przekroju, więc ich plecy są wykończone (pas, tabliczka marki, kratka). Nie chowamy ich i nie robimy przezroczystymi (decyzja R22 w zadaniu 16, patrz §7).
- Lampy sufitowe na pręcie lub lince; nie rzucają cienia.
- Drzewa (ulica i podwórko) są proceduralne (`street/courtyard.ts`, `buildTree`): pień i korona z kilku ikosaedrów, kanciasto-miękkie jak meble. Modele Kenneya obok mebli wyglądały płasko.

## 2. Kolor
- Tylko `PALETTE`. Wyjątki: `'#ffffff'` jako baza pod `setColorAt` i kolory wierzchołków komórek atlasu z własnym kolorem, maski (emissive, alfa) w skali szarości i światła z §4. Bez czystej szarości, bieli i czerni.
- Tło spokojne, S ≤ 0,35: `floor`, `wall` poza cokołem `wall[2]`, `asphalt`, `sidewalk`, `curb`, `grass`. Elewacje S ≤ 0,5. Kolor niosą towar (w każdej kategorii ≥ 3 kolory z S ≥ 0,5) i marka (zieleń i pomarańcz, S ≥ 0,6). Pilnuje tego `style.test.ts`.
- Gondole i regały ścienne: korpus `fixture.shelf`, cokół i nadstawka `brand.green`, listwy cenowe `brand.orange`, cenówki `brand.cream`. Lada `fixture.counter`, rama lodówki `fixture.fridgeFrame`.
- Indeksy `floor`, `wall` i `street.*`: znaczenie w JSDoc `style.ts`. Płyty chodnika losuj z list per płyta, elewacje per obiekt, pokłady dachów po kolei z listy (papa, jasna papa, żwir), żeby dachy w wierszu nie były jednolicie ciemne.

## 3. Materiały
`plasticMatte`: korpusy, ściany, plakaty; `plasticGloss`: opakowania, listwy; `metalPainted`: ramy, słupki, latarnie; `wood`: blaty, palety; `fabric`: ubrania, wycieraczki; `glass`: szyby; `emissive`: tylko to, co świeci. Szkło i emissive bez cieni. Materiałów z cache nie zmieniaj i nie zwalniaj (świecenie zmieniane nocą ma własny materiał per sklep lub ulica).

- Postać to jeden materiał (jeden draw call): skóra i oczy mają `plasticMatte` (lekki połysk „zabawkowej” skóry), a włosy, ubrania i akcesoria szorstkość `fabric` (0,95) przez region w shaderze postaci (`fallbackCharacter.ts`, `FABRIC_ROUGHNESS`).
- Ulica i budynki: materiały z kolorami wierzchołków (kolor z PALETTE w wierzchołku, faktura w atlasie elewacji), żeby cały budynek, podwórko i rekwizyt kosztowały po jednym draw callu.

## 4. Światło
Dzień: krótkie cienie, nigdy czarne. Noc: sklep najjaśniejszy w kadrze. Ciepłe światło wnętrza (bez cieni, tylko w sali) dodaje `buildStore`. Latarnie i okna świecą przez emissive. Bloom łapie tylko emissive.

Emissive (kolor, `emissiveIntensity`):

| Co | Kolor | Dzień | Noc |
|---|---|---|---|
| Neon szyldu i pylonu „TRASZKA 24h” | `brand.cream` (maska napisu i logo) | szyld 3, pylon 0,35 | 3 |
| Lampy sufitowe sklepu (`LAMP_EMISSIVE`) | `brand.cream` | 2,0 | 2,5 |
| LED w lodówkach | `brand.cream` | 2,2 | 2,2 |
| Ekrany | `#8fd3ff` | 1,2 | 1,2 |
| Grzałka rolek | `brand.orange` | 1,5 | 1,5 |
| Latarnie | `#ffb35c` | — (kremowa obudowa) | 3 |
| Okna budynków | `#ffd28a` | 0 | 1–1,6 (1,1) |
| Murale | `#ffd28a`, maska 25% | 0 | jak okna |

- Ciepłe światła punktowe wnętrza (`#ffd28a`, do 6) są w scenie zawsze, a dzień/noc zmienia tylko ich natężenie (0 w dzień). Ukrywanie ich przekompilowałoby przy pierwszym przełączeniu wszystkie materiały (przycięcie klatki).
- Nocą witryny i wejście kładą na chodniku ciepłą plamę światła (`#ffd28a`, addytywnie, 2,6 m w głąb), a latarnie plamę `#ffb35c`.
- Maska świecenia napisu ma czarne tło (nie przezroczyste): emissive czyta tylko RGB, a brzegi liter po `clearRect` miały pełny kolor i jaśniejszą, poszarpaną obwódkę.

## 5. Postacie
- **Paczka: `modular` (Quaternius Modular Men/Women), jedyna w grze.** Wybór z `?charTest=1` w zadaniu 16: prawdziwe ubrania i buty, różne sylwetki (sukienka, bluza, szorty, ogrodniczki), 2,9 tys. trójkątów i własne klipy chodu. UBC odpada: anatomia superbohatera pod malowaną koszulką, „legginsy” zamiast spodni, bose stopy, gniewne oczy. Zadanie 16b usuwa paczkę UBC (ciała, fryzury, brwi i UAL) z potoku assetów i kodu; `?pack=ubc` działa tylko do tego czasu.
- Proporcje z `CHARACTER_STYLE` (modele bazowe są smukłe i długonogie, Two Point jest krępe): głowa ×1,45, dłonie ×1,35, tułów (miednica, brzuch, klatka) ×1,14, szyja i barki wracają do ×1, więc ręce i głowa rosną tylko o własne mnożniki. Wzrost 1,55–1,88 m (od podeszwy do czubka głowy, po powiększeniu), tusza ×0,95–1,25. Wzrost wyrównuje skala całej postaci, więc większa głowa i tułów dają krótsze nogi w proporcji. Nogi nie są skalowane: stopy modular to kości IK przypięte do korzenia.
- Personel nosi `brand.green`, klient nigdy. Góra i dół w różnych kolorach. Białe części stroju (kołnierz koszuli, podeszwy) mają ciepłą biel `wall[0]`: przyciągnięte do PALETTE dawały szaroniebieski kołnierz, który pod brodą czytał się jak zarost.
- **Cienie postaci (decyzja R30):** każda postać ma miękką plamę cienia (`characters/blobShadows.ts`: jedna `InstancedMesh` na cały tłum, 1 draw call, kolor `wall[4]`, promień 0,4 m × tusza) na wszystkich presetach. Prawdziwy cień z mapy cieni (+1 draw call i ~2,9 tys. trójkątów na postać) tylko na presecie `wysoka` (`QualitySettings.characterShadows`).
- Animacja: powyżej ×4 nogi chodzą w tempie ×4 (`ANIM_SPEED_CAP`), a postać przesuwa się z prędkością gry; przy ×8 klip chodu migał (stroboskop).

## 6. Humor
- Teksty po polsku, nagłówek plakatu ≤ 6 słów. W kadrze sklepu przy domyślnym zoomie ≥ 3 żarty czytelne bez przybliżania. Nośniki:
  - **hasła na pasie marki** (górny pas ścian sali, litery 0,25 m; `SLOGANS` w `store/props.ts`), widoczne na ścianach dalszych od kamery,
  - **mural na odsłoniętej ścianie szczytowej** dalszego sąsiada („CENTRALA MYŚLI ZA CIEBIE” albo reklama konkurencji „SZOP 24h · OTWARTE, GDY TRASZKA ŚPI”),
  - **pylon „TRASZKA 24h”** przy krawężniku (marka i neon w kadrze, gdy ściana frontowa jest w przekroju).
- Żarty z bliska (zoom): plakaty Centrali, mata „Witamy w Traszce”, tabliczki „Tylko dla personelu” i „Premii tu nie ma”, cenówka „Reklamówka 0,20 zł”, potykacz z hasłem dnia, gazety na stojaku.
- Satyra celuje w Centralę i absurdy sieci, nigdy w kasjera ani klienta. Zero prawdziwych marek, logo i nazwisk; nazwy z gry: Traszka, Centrala, Ogonki, Traszdog, Kraftuś, konkurencja Szop 24h i Kawka Express.
- Przykłady: „KPI to stan umysłu. Centrala”, „Promocja: 3 w cenie 3!”, „Centrala czuwa 24/7 (w godz. 9–15)”.

## 7. Przekrój i miasto
- Przekrój (widok wnętrza): ściany sklepu od strony kamery spadają do 0,5 m, bryła nad sklepem znika, **sąsiad od strony kamery** (yaw 0–1: od −x, yaw 2–3: od +x) spada do 0,5 m z przekrojem wnętrza (podłoga z desek, ściany działowe z przejściami, schody), a **dalszy sąsiad zostaje w pełnej wysokości**. Nie zasłania sklepu (promienie do kamery biegną od niego), a kadr wygląda jak miasto, nie jak plac.
- Ślepa ściana szczytowa dalszego sąsiada (odsłonięta, gdy bryła nad sklepem znika) dostaje mural z atlasu elewacji, oparty tuż nad sklepem (≤ 3,3 m wysokości, cały w domyślnym kadrze).
- Za wierszem budynków jest podwórko (`street/courtyard.ts`): ścieżka, trawnik, trzepak, wiata śmietnikowa z koszami do segregacji, piaskownica, ławka, drzewa, podjazd i blaszaki. Reguła zasłaniania: rzecz o wysokości h stoi ≥ h metrów za tylną ścianą (w izometrii promień do kamery wznosi się o tyle, ile przebiega wzdłuż z), więc przy kamerze od podwórka nic nie wchodzi w kadr wnętrza. Pilnuje tego `courtyard.test.ts`.
- Rekwizyty uliczne stoją wyłącznie w wierszu 0 chodnika (pas mebli ulicznych, zablokowany dla klientów, ruling R32). W sali nie stawiamy niczego na podłodze: symulacja nie zna rekwizytów, więc klient przeszedłby przez donicę.
- Wysokie meble przy ścianach w przekroju (R22): zostają pełne, z wykończonymi plecami (§1). Rozdzielenie ich od scalonej siatki i przyciemnianie dokłada ~10–15 draw calli i ścieżkę przezroczystości z artefaktami; wrócimy do tego, gdy dojdzie zaznaczanie mebli (etap 2).

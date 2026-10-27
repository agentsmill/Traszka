# Przewodnik stylu Traszki

Wzorzec: **Two Point Hospital**: ciepło, nasycenie, czytelność z daleka, miękkie przysadziste bryły, dużo detalu, humor w szczegółach. Wartości bierz z `src/render/style.ts`. Tone mapping: **Neutral** (AgX szarzy tę paletę). Każdy punkt to kryterium odbioru zadań 8–12 i 16.

## 1. Bryła
- Każdy widoczny prostopadłościan to `RoundedBoxGeometry`: `BEVEL.medium` (3 segmenty) dla części o najmniejszym wymiarze ≥ 10 cm, `BEVEL.small` (2 segmenty) dla cieńszych, poniżej 3 cm `min(BEVEL.small, 0,4 × wymiar)`; drobiazgi < 5 cm w każdym wymiarze (cenówki, przyciski) 1 segment. Gołe `BoxGeometry` w kadrze nie przechodzi.
- Przysadziście: blat ≥ 6 cm z nawisem 3–5 cm, półka ≥ 4 cm, cokół 10–12 cm cofnięty o 3 cm, boki i słupki ≥ 6 cm.
- Wysokości pod kamerę 35°: gondola ≤ 1,6 m, regał ścienny i lodówka 2,0 m, lada 0,95 m. Od brzegu footprintu 2–3 cm luzu.
- Sylwetka ma ≥ 2 uskoki (cokół → korpus → nadstawka albo blat). Jednolity prostopadłościan to „klocek”.
- Mebel: ≥ 3 siatki (gondola i lodówka ≥ 8), ≥ 1 element w kolorze marki, ≤ 10 tys. trójkątów bez towaru, statyka scalona per materiał. Minimum części:
  - **gondola, regał ścienny:** zielony cokół, korpus z plecami, ≥ 4 półki, pomarańczowa listwa cenowa na każdej, kremowe cenówki, nadstawka z tabliczką kategorii;
  - **lodówka:** rama `fixture.fridgeFrame`, cokół, nadstawka z szyldem, szklane drzwi z uchwytem, półki `metalPainted`, pionowa listwa LED;
  - **kasa:** cokół, korpus `fixture.counter`, drewniany blat z nawisem, panel z logo, ekran, terminal, koszyk ze zdrapkami;
  - **papierosy:** zamykane fronty, podświetlenie, tabliczka „18+”; **hot-dogi:** obudowa, ≥ 4 rolki z grzałką, szyba; **ekspres:** ekran, tacka, ≥ 2 kubki; **kasa samoobsługowa:** słupek, ekran, półka, skaner; **slot:** znacznik z `opacity` 0,5 i „+”.
- Lampy sufitowe: widoczny pręt lub linka, bez cienia (pływający panel wygląda z góry jak plama na podłodze).

## 2. Kolor
- Tylko z `PALETTE`. Wyjątki: biała baza `'#ffffff'` pod `setColorAt` i tabela świateł z §4. Bez czystej szarości, bieli i czerni (pilnuje `style.test.ts`).
- Spokojne tło, kolorowy pierwszy plan: podłogi, ściany i nawierzchnie S ≤ 0,35, elewacje S ≤ 0,5, korpusy mebli jasne szałwiowe. Kolor niosą towar, marka i ludzie (S ≥ 0,5).
- Marka: zieleń na cokołach, nadstawkach, szyldzie i koszulkach personelu; pomarańcz na listwach cenowych, logo i ladzie; krem na cenówkach i napisach.
- Sala: płytki `floor[0]` z fugą `floor[2]`, pas `floor[1]` przy wejściu, zaplecze `floor[3]`. Ściana `wall[0]`, u góry pas marki `wall[1]` (40–50 cm), cokół `wall[2]` (12 cm), wierzch ściętej ściany `wall[4]`.
- Ulica: płyty 50×50 z `sidewalk` losowane per płyta, `curb`, jezdnia `asphalt[0]` z łatami `[1]` i pasami `[2]`. Blok: dwa kolory z `blokPastel` w pasach. Kamienica: tynk z `kamienicaPlaster`, gzyms i cokół jaśniejsze.

## 3. Materiały: `material(kind, color, opts)`
`plasticMatte` korpusy, ściany, plakaty · `plasticGloss` opakowania, listwy, obudowy ekranów · `metalPainted` ramy, słupki, kosze, latarnie · `wood` blaty, palety · `fabric` ubrania, wycieraczki, markizy · `glass` szyby · `emissive` tylko to, co świeci. Szkło i emissive: `castShadow = false`. Materiały są wspólne: nie zmieniaj ich pól, w `dispose()` zwalniaj tylko geometrie.

## 4. Światło
- **Dzień:** krótkie, widoczne cienie, nigdy czarne. Bloom ledwo muska świecące elementy.
- **Noc:** granatowa ulica, a sklep jest najjaśniejszym miejscem kadru. Ciepłe światło wnętrza (bez cieni, nie przecieka na sąsiednie budynki) dokłada renderer. Świecą szyld, witryna, lampy, latarnie i okna. Bloom (próg ~0,9) łapie tylko emissive.

| Element | Kolor | `emissiveIntensity` |
|---|---|---|
| neon szyldu | `brand.green`, `brand.orange`, napis `brand.cream` | 3 |
| lampy, listwy LED w lodówkach | `brand.cream` | 2–2,5 |
| ekrany kas i terminali | `#8fd3ff` | 1,2 |
| grzałka rolek | `brand.orange` | 1,5 |
| latarnie (sodówki) | `#ffb35c` | 3 |
| okna mieszkań nocą | `#ffd28a` | 1–1,6 |

## 5. Postacie
Głowa ×`headScale`, dłonie ×`handScale`, wzrost w metrach z `heightRange`, tusza z `widthRange`. Personel: koszulka `brand.green`, identyfikator `brand.orange`; klient nigdy w zieleni marki. Góra i dół w różnych kolorach, żeby sylwetka czytała się z daleka.

## 6. Humor w grafice
- Po polsku, krótko (nagłówek plakatu ≤ 6 słów), czytelnie przy domyślnym zoomie. W kadrze sklepu ≥ 3 żarty (plakat, cenówka z dopiskiem, mata lub tabliczka).
- Satyra celuje w Centralę, KPI i absurdy sieci, nigdy w kasjera ani klienta.
- Zero prawdziwych marek, logo i nazwisk. Nazwy z gry: Traszka, Centrala, Ogonki, Traszkapka, Traszdog, Kraftuś, Lody BANDY XL, Mniamm, Szop 24h, Kawka Express.
- Cenówki „4,99 zł”, co piąta z dopiskiem. Przykłady: „KPI to stan umysłu. Centrala”, „Promocja: 3 w cenie 3!”, „Kraftusia brak. Nie pytaj.”, „Witamy w Traszce. Wycieraj ogonki”, „Tylko dla personelu (i Centrali)”.

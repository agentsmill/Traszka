# Przewodnik stylu Traszki

Wzorzec: **Two Point Hospital**, czyli ciepło, nasycenie i czytelność z daleka. Wartości bierz z `src/render/style.ts`, tone mapping **Neutral** (AgX szarzy paletę). Każdy punkt to kryterium odbioru zadań 8–12 i 16.

## 1. Bryła
- Prostopadłościany w kadrze to `RoundedBoxGeometry`: `BEVEL.medium` (3 segmenty) od 10 cm najmniejszego wymiaru, `BEVEL.small` (2) dla cieńszych, poniżej 3 cm `min(BEVEL.small, 0,4 × wymiar)`, drobiazgi < 5 cm: 1 segment.
- Blat ≥ 6 cm z nawisem 3–5 cm, półka ≥ 4 cm, cokół 10–12 cm cofnięty o 3 cm, słupki ≥ 6 cm. Gondola ≤ 1,6 m, regał ścienny i lodówka 2,0 m, lada 0,95 m.
- Sylwetka ma ≥ 2 uskoki (cokół → korpus → nadstawka lub blat).
- Builder mebla, przed scaleniem geometrii: ≥ 3 siatki (gondola i lodówka ≥ 8), ≥ 1 element w kolorze marki, ≤ 10 tys. trójkątów bez towaru.
- Obowiązkowe części. Gondola i regał: cokół, plecy, ≥ 4 półki z listwą cenową, nadstawka z kategorią. Lodówka: rama, szklane drzwi z uchwytem, półki, listwa LED. Kasa: blat z nawisem, ekran, terminal. Papierosy: fronty, podświetlenie. Hot-dogi: ≥ 4 rolki, szyba. Ekspres: tacka, kubki. Kasa samoobsługowa: słupek, ekran, skaner.
- Lampy sufitowe wiszą na pręcie lub lince i nie rzucają cienia.

## 2. Kolor
- Tylko `PALETTE`. Wyjątki: `'#ffffff'` jako baza pod `setColorAt` i światła z §4. Bez czystej szarości, bieli i czerni.
- Tło spokojne, S ≤ 0,35: `floor`, `wall` poza cokołem `wall[2]`, `asphalt`, `sidewalk`, `curb`. Elewacje S ≤ 0,5. Kolor niosą towar (w każdej kategorii ≥ 3 kolory z S ≥ 0,5) i marka (zieleń i pomarańcz, S ≥ 0,6). Pilnuje tego `style.test.ts`.
- Gondole i regały ścienne: korpus `fixture.shelf`, cokół i nadstawka `brand.green`, listwy cenowe `brand.orange`, cenówki `brand.cream`. Lada `fixture.counter`, rama lodówki `fixture.fridgeFrame`.
- Indeksy `floor`, `wall` i `street.*` mają znaczenie opisane w JSDoc `style.ts`. Płyty chodnika i elewacje losuj z list per obiekt.

## 3. Materiały
`plasticMatte`: korpusy, ściany, plakaty; `plasticGloss`: opakowania, listwy; `metalPainted`: ramy, słupki, latarnie; `wood`: blaty, palety; `fabric`: ubrania, wycieraczki; `glass`: szyby; `emissive`: tylko to, co świeci. Szkło i emissive bez cieni. Materiałów z cache nie zmieniaj i nie zwalniaj.

## 4. Światło
Dzień: krótkie cienie, nigdy czarne. Noc: sklep najjaśniejszy w kadrze. Ciepłe światło wnętrza (bez cieni, tylko w sali) dodaje `buildStore` (zadanie 8). Latarnie i okna świecą przez emissive (zadanie 12). Bloom łapie tylko emissive.

Emissive (kolor, `emissiveIntensity`): neon szyldu `brand.green`/`brand.orange`/`brand.cream` 3; lampy i LED w lodówkach `brand.cream` 2–2,5; ekrany `#8fd3ff` 1,2; grzałka rolek `brand.orange` 1,5; latarnie `#ffb35c` 3; okna nocą `#ffd28a` 1–1,6.

## 5. Postacie
Proporcje z `CHARACTER_STYLE`: wzrost w metrach, tusza jako mnożnik. Personel nosi `brand.green`, klient nigdy. Góra i dół w różnych kolorach.

## 6. Humor
- Teksty po polsku, nagłówek plakatu ≤ 6 słów. W kadrze sklepu ≥ 3 żarty (plakat, cenówka, mata lub tabliczka).
- Satyra celuje w Centralę i absurdy sieci, nigdy w kasjera ani klienta. Zero prawdziwych marek, logo i nazwisk; nazwy z gry: Traszka, Centrala, Ogonki, Traszdog, Kraftuś.
- Przykłady: „KPI to stan umysłu. Centrala”, „Promocja: 3 w cenie 3!”.

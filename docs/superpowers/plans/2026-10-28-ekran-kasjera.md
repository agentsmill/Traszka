# Ekran „Twój kasjer” i kasjer w sklepie: plan

> **Dla agentów:** wykonanie przez superpowers:subagent-driven-development. Kroki w formacie `- [ ]`.

**Cel:** przed grą gracz składa swojego kasjera (z losowaniem i dziwnymi strojami), wpisuje nick i seed, a w grze ten kasjer stoi za ladą.

**Architektura:** stroje specjalne przechodzą przez istniejący potok assetów jako osobna lista (klienci ich nie dostają). Wygląd kasjera to mały, serializowalny obiekt (`CashierLook`) zapisany w meta gracza. Ekran startowy to komponent Preact z osobnym, lekkim podglądem three.js; w sklepie kasjera stawia `CashierView` w pasie personelu za kasą.

**Stos:** jak w etapie 1 (three 0.186.1, Preact + signals, Vitest, gltf-transform).

**Spec:** `docs/superpowers/specs/2026-10-27-traszka-tycoon-design.md` (§6.2 personel i franczyzobiorca jako postać, §12 interfejs, §14.1 zapis). Opis zaakceptowany przez użytkownika 2026-10-28 (rozmowa).

## Global Constraints
- `src/sim` bez three i bez `Math.random`; losowość przez `createRng`/`subSeed` (w `src/sim/economy` także `rand01`).
- Teksty po polsku z polskimi znakami; zero prawdziwych marek i nazwisk (test zakazanych słów obejmuje nowe teksty).
- Zwykła gra (12 klientów + kasjer) < 300 draw calli na każdym presecie; kasjer to 1 wywołanie (+1 cień tylko na `wysoka`) i miejsce w instancjonowanych plamach cienia.
- Zapis: format z rundy poprawek po przeglądzie (koperta v2 z walidacją); nowe pola meta walidowane tak samo, uszkodzone → wartości domyślne.
- `npm test`, `npm run typecheck`, `npm run build` zielone. Przeglądarka tylko przez własny headless playwright-core na porcie 5199 (nie narzędzia Playwright MCP, nie port 4173).

## Review Focus
1. Pierwsze wejście bez zapisu i bez meta: ekran startowy musi się pokazać i dać się przejść na telefonie (układ pionowy < 700 px).
2. Seed z dziwnym tekstem (spacje, emoji, 200 znaków, pusty): zawsze grywalny sklep, nigdy pętla błędów.
3. Stary zapis (v1/v2 bez kasjera i nicka): gra startuje z domyślnym kasjerem, bez wyjątku.
4. Strój specjalny w podglądzie i w sklepie: poprawne skórowanie (bez rozciągniętych trójkątów), stopy na podłodze.
5. Zmiana seeda i remont: kasjer nie dubluje się i jest zwalniany razem ze sklepem.

---

### Zadanie K1: Stroje specjalne w potoku assetów

**Model:** Sonnet

**Pliki:** `scripts/process-assets.mjs`, `public/assets/characters/special-*.glb`, `public/assets/LICENSES.md`, `src/render/assets.ts`, `src/render/characters/modularPack.ts`, `src/render/characters/characterFactory.ts`, testy obok.

**Interfejsy:**
- `ASSETS.characters.special: string[]`: mężczyźni Spacesuit, King, Swat, Adventurer; kobiety SciFi, Adventurer, Witch, Medieval, Soldier (z `Individual Characters/glTF`, tylko klipy `Idle` i `Walk`, ta sama ścieżka uproszczenia i straży macierzy kości co reszta).
- `OUTFIT_PAINT` ma wpis dla każdego stroju specjalnego (typowana tabela: literówka = błąd `tsc`).
- `CharacterFactory.createWithOutfit(appearanceSeed: string, outfit: OutfitFile): CharacterInstance` (stroje zwykłe i specjalne; `create(seed)` dla klientów bez zmian i bez strojów specjalnych).

- [ ] Testy: każdy plik z `ASSETS.characters.special` istnieje i ma wiersz w LICENSES; każdy strój specjalny ma wpis w `OUTFIT_PAINT`; każdy składa się w Node z prawdziwego GLB (wysokość w zakresie, podeszwy przy y≈0, kolory regionów z palety); `create(seed)` nigdy nie zwraca stroju specjalnego (200 seedów).
- [ ] FAIL → implementacja → `npm run assets` → PASS. Tabela rozmiarów w raporcie.
- [ ] Commit `feat(assets): stroje specjalne dla kasjera`.

### Zadanie K2: Kasjer w sklepie

**Model:** Sonnet

**Pliki:** `src/game/cashier.ts` (+ test), `src/render/cashierView.ts` (+ test), wpięcie w scenę gry (plik z pętlą/sceną gry po rundzie poprawek).

**Interfejsy:**
- `interface CashierLook { outfit: OutfitFile; appearanceSeed: string }`, `randomCashierLook(rng: Rng, includeSpecial = true): CashierLook` (stroje specjalne jako okazja: ok. 20% losowań; z `includeSpecial = false` wyłącznie zwykłe), `DEFAULT_CASHIER_LOOK` (strój zwykły), `isCashierLook(x: unknown): x is CashierLook`. Klienci nigdy nie dostają strojów specjalnych.
- Fabryka ładuje stroje specjalne na żądanie (ruling R40): `ensureOutfit(outfit): Promise<void>`, potem `createWithOutfit`; gra pobiera tylko strój wybranego kasjera.
- `class CashierView { constructor(factory, layout, parent, blobs, look); setLook(look); update(dt, servingAgent | null, saleHappened: boolean); dispose() }`.

- [ ] Testy: kasjer stoi na kratce pasa personelu za kasą (nie w alejce klientów) i patrzy na ladę; przy kliencie w kasie obraca się do niego (ograniczona prędkość obrotu jak w tłumie); przy sprzedaży wykonuje krótki gest (proceduralny ukłon / podskok, bez nowych klipów); `dispose` zwalnia postać i miejsce w plamach cienia; zmiana seeda i remont nie dublują kasjera.
- [ ] FAIL → implementacja → PASS. Draw calle w zwykłej grze przed i po (oczekiwane +1).
- [ ] Commit `feat(game): kasjer za ladą`.

### Zadanie K3: Ekran startowy „Twój kasjer”

**Model:** Sonnet

**Pliki:** `src/ui/start/StartScreen.tsx`, `src/ui/start/preview.ts` (osobny lekki renderer three.js), `src/game/seed.ts` (+ test), meta gracza (nick, wygląd kasjera), style w `src/ui/ui.css`.

**Zakres:**
- Pokazuje się przy pierwszym wejściu (brak gracza w meta) i przy „Nowy sklep” z ⚙. Zastępuje okno „Witaj w Traszce”; jego wskazówki przechodzą do podpowiedzi pierwszego dnia (krótkie dymki).
- **Lewa strona:** kasjer w 3D (obrót jak na podeście, animacja `Idle`), 🎲 **Losuj** (`randomCashierLook`) i strzałki ‹ › przełączające strój (najpierw zwykłe, potem specjalne). Przełącznik „Stroje specjalne w losowaniu” (domyślnie włączony, zapamiętany): kto nie chce grać dziwnym strojem, wyłącza go i losuje tylko zwykłe. Strój specjalny dociąga się dopiero przy pokazaniu (R40). Podgląd zwalnia swój renderer przy starcie gry.
- **Prawa strona:** u góry „Nazwa gracza” (1–20 znaków, przycięta, zapamiętana), niżej „Seed sklepu” (dowolny tekst) z 🎲 (słowo + liczba), duży przycisk „Otwieramy sklep!”.
- Telefon (< 700 px): podgląd u góry, formularz pod spodem.
- `normalizeSeed(raw: string): string`: przycięcie, małe litery, zwinięte spacje, maks. 40 znaków, pusty → losowy. `resolveStore(seed)`: gdy generator nie złoży sklepu, deterministycznie próbuje `seed·1` … `seed·5` i zwraca użyty seed + komunikat „Ten lokal się nie zmieścił, otwieramy sąsiedni”.

- [ ] Testy: `normalizeSeed` (spacje, wielkie litery, emoji, 200 znaków, pusty), `resolveStore` z wymuszoną porażką generatora, walidacja nicka, zapis i odczyt meta z kasjerem (także stara meta bez tych pól).
- [ ] FAIL → implementacja → PASS. Zrzuty `docs/screens/etap2/start-desktop.png`, `start-telefon.png`, `kasjer-w-sklepie.png`.
- [ ] Commit `feat(ui): ekran startowy z kasjerem, nickiem i seedem`.

Po każdym zadaniu recenzja (Sonnet); na koniec kontroler sprawdza grę w przeglądarce, robi zrzuty i pyta o push.

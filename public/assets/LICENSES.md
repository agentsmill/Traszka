# Licencje assetów

Wszystkie assety w tym katalogu pochodzą z paczek na licencji CC0 1.0 Universal (dedykacja do domeny publicznej). Nie wymagają podania autora, ale go podajemy.

Pliki `.glb` są generowane z oryginałów w `assets-src/` (katalog git-ignored) poleceniem `npm run assets` (`scripts/process-assets.mjs`). Oryginały nie trafiają do repozytorium.

## Paczki

| Paczka | Autor | Licencja | URL | Data pobrania |
| --- | --- | --- | --- | --- |
| Kenney Car Kit (3.1) | Kenney (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/car-kit | 2026-10-27 |
| Kenney City Kit Roads (2.2) | Kenney (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/city-kit-roads | 2026-10-27 |
| Ultimate Modular Men (Feb 2022) | Quaternius | CC0 1.0 | https://quaternius.com | 2026-10-27 |
| Ultimate Modular Women (April 2022) | Quaternius | CC0 1.0 | https://quaternius.com | 2026-10-27 |

Uwaga: plik `License.txt` w paczce Ultimate Modular Women ma w nagłówku nazwę „Ultimate Modular Males”. Treść licencji to CC0 1.0.

## Pliki

### Postacie (`characters/`)

| Plik | Paczka | Źródło w paczce |
| --- | --- | --- |
| `men-casual-hoodie.glb` | Ultimate Modular Men | Individual Characters/glTF/Casual_Hoodie.gltf |
| `men-casual-2.glb` | Ultimate Modular Men | Individual Characters/glTF/Casual_2.gltf |
| `men-suit.glb` | Ultimate Modular Men | Individual Characters/glTF/Suit.gltf |
| `men-worker.glb` | Ultimate Modular Men | Individual Characters/glTF/Worker.gltf |
| `men-farmer.glb` | Ultimate Modular Men | Individual Characters/glTF/Farmer.gltf |
| `men-beach.glb` | Ultimate Modular Men | Individual Characters/glTF/Beach.gltf |
| `men-punk.glb` | Ultimate Modular Men | Individual Characters/glTF/Punk.gltf |
| `women-casual.glb` | Ultimate Modular Women | Individual Characters/glTF/Casual.gltf |
| `women-suit.glb` | Ultimate Modular Women | Individual Characters/glTF/Suit.gltf |
| `women-formal.glb` | Ultimate Modular Women | Individual Characters/glTF/Formal.gltf |
| `women-worker.glb` | Ultimate Modular Women | Individual Characters/glTF/Worker.gltf |
| `women-punk.glb` | Ultimate Modular Women | Individual Characters/glTF/Punk.gltf |

### Postacie: stroje specjalne (`characters/special-*.glb`, tylko kasjer gracza)

| Plik | Paczka | Źródło w paczce |
| --- | --- | --- |
| `special-men-spacesuit.glb` | Ultimate Modular Men | Individual Characters/glTF/Spacesuit.gltf |
| `special-men-king.glb` | Ultimate Modular Men | Individual Characters/glTF/King.gltf |
| `special-men-swat.glb` | Ultimate Modular Men | Individual Characters/glTF/Swat.gltf |
| `special-men-adventurer.glb` | Ultimate Modular Men | Individual Characters/glTF/Adventurer.gltf |
| `special-women-scifi.glb` | Ultimate Modular Women | Individual Characters/glTF/SciFi.gltf |
| `special-women-adventurer.glb` | Ultimate Modular Women | Individual Characters/glTF/Adventurer.gltf |
| `special-women-witch.glb` | Ultimate Modular Women | Individual Characters/glTF/Witch.gltf |
| `special-women-medieval.glb` | Ultimate Modular Women | Individual Characters/glTF/Medieval.gltf |
| `special-women-soldier.glb` | Ultimate Modular Women | Individual Characters/glTF/Soldier.gltf |

Stroje specjalne przechodzą przez ten sam potok co pozostałe postacie (klipy `Idle` i `Walk`, uproszczenie siatki). W strojach `special-men-swat`, `special-women-scifi` i `special-women-medieval` usunięto broń (pistolet, miecz), której gra nie rysuje.

### Rekwizyty (`props/`)

| Plik | Paczka | Źródło w paczce |
| --- | --- | --- |
| `lamp-curved.glb` | Kenney City Kit Roads | Models/GLB format/light-curved.glb |
| `van-delivery.glb` | Kenney Car Kit | Models/GLB format/delivery.glb |

## Biblioteki (nie są assetami, nie trafiają do `public/assets/`)

- **n8ao 2.0.1** (SSAO, `node_modules/n8ao`). Plik `LICENSE` to CC0 1.0 Universal. README projektu podaje: „A CC0 license is used for this project”. Pole `license` w `package.json` to `ISC`. Wszystkie trzy wskazują licencję pozwalającą na użycie. Biblioteka jest zależnością npm, a jej kod nie jest kopiowany do repozytorium.

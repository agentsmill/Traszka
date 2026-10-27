# Licencje assetów

Wszystkie assety w tym katalogu pochodzą z paczek na licencji CC0 1.0 Universal (dedykacja do domeny publicznej). Nie wymagają podania autora, ale go podajemy.

Pliki `.glb` są generowane z oryginałów w `assets-src/` (katalog git-ignored) poleceniem `npm run assets` (`scripts/process-assets.mjs`). Oryginały nie trafiają do repozytorium.

## Paczki

| Paczka | Autor | Licencja | URL | Data pobrania |
| --- | --- | --- | --- | --- |
| Kenney Nature Kit (2.1) | Kenney (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/nature-kit | 2026-10-27 |
| Kenney Car Kit (3.1) | Kenney (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/car-kit | 2026-10-27 |
| Kenney City Kit Roads (2.2) | Kenney (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/city-kit-roads | 2026-10-27 |
| Universal Base Characters [Standard] | Quaternius | CC0 1.0 | https://quaternius.com | 2026-10-27 |
| Universal Animation Library [Standard] | Quaternius | CC0 1.0 | https://quaternius.com | 2026-10-27 |
| Ultimate Modular Men (Feb 2022) | Quaternius | CC0 1.0 | https://quaternius.com | 2026-10-27 |
| Ultimate Modular Women (April 2022) | Quaternius | CC0 1.0 | https://quaternius.com | 2026-10-27 |

Uwaga: plik `License.txt` w paczce Ultimate Modular Women ma w nagłówku nazwę „Ultimate Modular Males”. Treść licencji to CC0 1.0.

## Pliki

### Postacie (`characters/`)

| Plik | Paczka | Źródło w paczce |
| --- | --- | --- |
| `ubc-male.glb` | Universal Base Characters | Base Characters/Godot - UE/Superhero_Male_FullBody.gltf |
| `ubc-female.glb` | Universal Base Characters | Base Characters/Godot - UE/Superhero_Female_FullBody.gltf |
| `hair-beard.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Beard.gltf |
| `hair-buns.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buns.gltf |
| `hair-buzzed.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buzzed.gltf |
| `hair-buzzed-female.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_BuzzedFemale.gltf |
| `hair-long.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.gltf |
| `hair-simple-parted.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.gltf |
| `eyebrows-regular.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Eyebrows_Regular.gltf |
| `eyebrows-female.glb` | Universal Base Characters | Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Eyebrows_Female.gltf |
| `ual1-standard.glb` | Universal Animation Library | Unreal-Godot/UAL1_Standard.glb (bez wersji `_RM`) |
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

### Rekwizyty (`props/`)

| Plik | Paczka | Źródło w paczce |
| --- | --- | --- |
| `tree-default.glb` | Kenney Nature Kit | Models/GLTF format/tree_default.glb |
| `tree-fat.glb` | Kenney Nature Kit | Models/GLTF format/tree_fat.glb |
| `lamp-curved.glb` | Kenney City Kit Roads | Models/GLB format/light-curved.glb |
| `van-delivery.glb` | Kenney Car Kit | Models/GLB format/delivery.glb |

## Biblioteki (nie są assetami, nie trafiają do `public/assets/`)

- **n8ao 2.0.1** (SSAO, `node_modules/n8ao`). Plik `LICENSE` to CC0 1.0 Universal. README projektu podaje: „A CC0 license is used for this project”. Pole `license` w `package.json` to `ISC`. Wszystkie trzy wskazują licencję pozwalającą na użycie. Biblioteka jest zależnością npm, a jej kod nie jest kopiowany do repozytorium.

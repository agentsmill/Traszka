# Traszka Tycoon

Przeglądarkowa gra ekonomiczna w izometrycznym widoku. Three.js + TypeScript.

## Uruchomienie

Wymagany Node.js w wersji ^22.12, 24 lub >=26 (zgodnie z wymaganiami Vitest 5).

```bash
npm install
npm run dev        # serwer deweloperski (Vite)
npm run build      # typecheck + build produkcyjny
npm run preview    # podgląd zbudowanej wersji
npm test           # testy (Vitest)
npm run typecheck  # tsc --noEmit
```

## Stack

- three 0.186.1, @types/three 0.186.0
- Vite 8.3.5, TypeScript 7.0.2, Vitest 5.0.5
- UI: Preact 11.1.0 + @preact/signals 2.11.4
- Postprocessing: postprocessing 6.39.5, n8ao 2.0.1
- Pipeline assetów: @gltf-transform/cli 4.5.1, meshoptimizer 1.3.0

## Konwencje

- `src/sim/` to logika gry bez three.js i bez `Math.random`. Pilnuje tego `tests/architecture.test.ts`.
- Alias `@/` wskazuje na `src/`.

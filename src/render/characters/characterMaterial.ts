import { Color, type MeshStandardMaterial } from 'three';
import { MATERIALS, PALETTE, material } from '@/render/style';
import type { Appearance } from './appearance';

/**
 * Materiał postaci i paleta regionów: wspólne podstawy rysowania postaci z modeli i postaci zastępczej.
 *
 * Siatka postaci ma atrybut `region` (liczba zmiennoprzecinkowa): indeks koloru w palecie postaci. Wartość między
 * całkowitymi (np. 2,5 na granicy skóry i góry) shader tnie progiem w połowie między sąsiednimi indeksami, z antyaliasingiem
 * po `fwidth`, więc granica dwóch regionów (rękaw, pas, tęczówka) to ostra, gładka linia, a nie gradient po dużych
 * trójkątach. Kolory leżą w uniformie materiału, a nie w geometrii: geometria wariantu jest wspólna dla wszystkich
 * postaci, a wygląd to tylko paleta (jeden program shadera, materiał na postać).
 */
export const REGION = { eyeDark: 0, eyeWhite: 1, skin: 2, top: 3, bottom: 4, shoes: 5, hair: 6, brow: 7, accent: 8, accent2: 9 } as const;
export type RegionName = keyof typeof REGION;
/** Pierwszy indeks stałych kolorów części stroju (kask, kamizelka itp.). */
export const FIXED_BASE = 10;
export const PALETTE_SIZE = 24;

/** Paleta postaci z `Appearance` (indeksy z REGION; akcenty uzupełnia wołający). Kolory z PALETTE, liniowe jak `new Color(hex)`. */
export function characterPalette(a: Appearance, shoes: string = PALETTE.wall[4]): Color[] {
  const hair = new Color(a.hair);
  return [
    new Color(PALETTE.hair[0]), new Color(PALETTE.wall[0]), new Color(a.skin), new Color(a.top), new Color(a.bottom),
    new Color(shoes), hair, hair.clone().lerp(new Color(PALETTE.hair[0]), 0.4), new Color(a.top), new Color(a.bottom),
  ];
}

/**
 * Szorstkość tkaniny (`fabric` z docs/style-guide.md §3) dla regionów od włosów w górę i ubrań: skóra i oczy zostają
 * `plasticMatte` (lekki połysk, „zabawkowa” skóra jak w Two Point), reszta jest matowa jak materiał. Zadanie 16.
 */
const FABRIC_ROUGHNESS = MATERIALS.fabric.roughness;

/** Klucz programu shadera: zmień go przy każdej zmianie tekstu łatki, żeby cache programów nie mieszał wersji. */
export const CHARACTER_PROGRAM_KEY = 'traszka-character-v4';

/** Fragment shadera three, który łatka rozszerza: `#include <nazwa>`. */
type Chunk = 'color_pars_vertex' | 'color_vertex' | 'color_pars_fragment' | 'color_fragment' | 'roughnessmap_fragment';

/**
 * Dokleja `addition` za `#include <chunk>`. Gdy chunka nie ma (inna wersja three zmieniła shader), łatka nie zadziała:
 * zamiast cichego braku palety (postacie w jednym kolorze) logujemy błąd z nazwą chunka.
 */
function extendChunk(source: string, chunk: Chunk, addition: string): string {
  const marker = `#include <${chunk}>`;
  const out = source.replace(marker, () => `${marker}\n${addition}`);
  if (out === source) console.error(`Materiał postaci: w shaderze nie ma ${marker}, paleta regionów nie zadziała (zmiana wersji three?).`);
  return out;
}

/** Shader postaci: atrybut `region` w vertex shaderze, kolor z palety (uniform) i szorstkość tkaniny w fragment shaderze. */
export function patchCharacterShader(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = extendChunk(
    extendChunk(shader.vertexShader, 'color_pars_vertex', 'attribute float region;\nvarying float vRegion;'),
    'color_vertex', 'vRegion = region;',
  );
  let fragment = extendChunk(shader.fragmentShader, 'color_pars_fragment', `uniform vec3 uPalette[${PALETTE_SIZE}];\nvarying float vRegion;`);
  fragment = extendChunk(fragment, 'color_fragment', `float regionFloor = floor(vRegion);
float regionCut = max(fwidth(vRegion), 1e-4);
int regionIndex = max(int(regionFloor), 0);
diffuseColor.rgb *= mix(uPalette[regionIndex], uPalette[min(regionIndex + 1, ${PALETTE_SIZE - 1})],
  smoothstep(0.5 - regionCut, 0.5 + regionCut, vRegion - regionFloor));`);
  fragment = extendChunk(fragment, 'roughnessmap_fragment',
    `roughnessFactor = mix(roughnessFactor, ${FABRIC_ROUGHNESS.toFixed(2)}, step(${REGION.skin + 0.5}, vRegion));`);
  shader.fragmentShader = fragment;
}

/**
 * Materiał jednej postaci: `MeshStandardMaterial` (rodzaj plasticMatte) z kolorem z palety po `region`; regiony ubrań,
 * włosów i akcesoriów dostają szorstkość tkaniny (FABRIC_ROUGHNESS), więc jedna postać to nadal jeden materiał i jeden
 * draw call. Programy shadera są wspólne (ten sam `customProgramCacheKey`), każda postać ma własny materiał z własną
 * paletą (uniform `uPalette`). Zwalnia go `dispose()` postaci.
 */
export function createCharacterMaterial(palette: Color[]): MeshStandardMaterial {
  const colors = palette.slice(0, PALETTE_SIZE);
  while (colors.length < PALETTE_SIZE) colors.push(colors[0]);
  const m = (material('plasticMatte', '#ffffff') as MeshStandardMaterial).clone();
  m.name = 'character';
  m.customProgramCacheKey = () => CHARACTER_PROGRAM_KEY;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPalette = { value: colors };
    patchCharacterShader(shader);
  };
  return m;
}

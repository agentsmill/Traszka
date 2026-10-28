import { Color, MeshStandardMaterial, type Material } from 'three';

/**
 * Styl wizualny Traszki w kodzie: paleta, fazowanie, materiały, światło i proporcje postaci.
 * Zasady użycia (kryteria odbioru zadań 8–12) są w docs/style-guide.md.
 *
 * Kolory to '#rrggbb' w sRGB; three.js sam przelicza je do przestrzeni liniowej.
 * Paleta i światło są dobrane pod tone mapping Neutral (THREE.NeutralToneMapping albo ToneMappingMode.NEUTRAL
 * w postprocessing). AgX wyraźnie szarzy tę paletę: ciepła podłoga robi się beżowoszara, pomarańcz łososiowy
 * (porównanie na scenie próbnej z N8AO i bloomem, raport zadania 6).
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export const PALETTE: {
  brand: { green: string; greenDark: string; orange: string; cream: string };
  floor: string[]; wall: string[]; fixture: Record<'shelf' | 'fridgeFrame' | 'counter' | 'wood' | 'metal', string>;
  productCategory: Record<'napoje' | 'nabial' | 'slodycze' | 'przekaski' | 'pieczywo' | 'chemia' | 'alkohol', string[]>;
  skin: string[]; hair: string[]; clothes: string[];
  street: Record<'asphalt' | 'sidewalk' | 'curb' | 'grass' | 'blokPastel' | 'kamienicaPlaster', string[]>;
} = deepFreeze({
  /** green: szyld, cokoły, nadstawki, koszulki personelu; orange (brzuch traszki): listwy cenowe, logo, akcenty;
   *  cream: tło cenówek i plakatów, napisy na zielonym. */
  brand: { green: '#2faa4f', greenDark: '#1d6b3a', orange: '#ff8a1f', cream: '#fff3df' },
  /** [0] płytka sali, [1] płytka akcentowa (obwódka, pas przy wejściu), [2] fuga, [3] posadzka zaplecza. */
  floor: ['#e3d2b5', '#cbb38e', '#ad9c80', '#a9a397'],
  /** [0] ściana sali, [1] pas marki u góry ściany, [2] cokół i listwa przypodłogowa (ciemna zieleń: jedyny wpis
   *  poza regułą spokojnego tła S ≤ 0,35), [3] ściana zaplecza, [4] przekrój (wierzch ściętej ściany w cutaway). */
  wall: ['#f3ece0', '#8fcf98', '#3f6b4f', '#d9d2c3', '#4b3f3a'],
  /** Korpusy mebli. shelf: gondole i regały ścienne; fridgeFrame: rama lodówki; counter: korpus lady kasy;
   *  wood: blaty, skrzynki, palety; metal: słupki, wsporniki, kosze. */
  fixture: { shelf: '#cde2c4', fridgeFrame: '#2f4a44', counter: '#e57f3f', wood: '#c58f5a', metal: '#a8b2b9' },
  /** Kolory opakowań do losowania per produkt. Każda kategoria ma własną „rodzinę” barw, żeby odcinek
   *  półki czytał się z daleka jako blok koloru. */
  productCategory: {
    napoje: ['#e23d3d', '#2d8de0', '#f6b21b', '#3fbf6f', '#7a4fd0', '#19b3b0'],
    nabial: ['#eef2f8', '#3b7fd4', '#9dc8f0', '#f5d55e', '#e9667e', '#2a9d8f'],
    slodycze: ['#d8344f', '#7b3fb3', '#f2c03c', '#6e3f27', '#ff7eb0', '#2f9fe0'],
    przekaski: ['#ffc72c', '#ff7a2a', '#e5483a', '#2e9e5b', '#3a6fd8', '#9b5a2c'],
    pieczywo: ['#d9a35f', '#b7773d', '#f0d6a2', '#8a5a33', '#e8c07f'],
    chemia: ['#2e86de', '#5fd3e8', '#f06aa6', '#9a6ee0', '#eaf4f7', '#3dbf7f'],
    alkohol: ['#7a471c', '#2d6a3a', '#d8a31f', '#1f4c8c', '#a8243a', '#e9dbb2'],
  },
  /** Od najjaśniejszej do najciemniejszej. */
  skin: ['#f7d9c4', '#f0c3a2', '#e2a982', '#c98b62', '#a86d47', '#7d4b30', '#5a3524'],
  /** Czarne, ciemny brąz, brąz, jasny brąz, blond, rude, siwe, „fioletowa płukanka”. */
  hair: ['#2b2220', '#4b3326', '#7b5133', '#b07e4c', '#e3c27f', '#b5532e', '#cdc5bb', '#b8a5d8'],
  /** Ubrania klientów. Bez zieleni marki: zielona koszulka to znak personelu. */
  clothes: ['#d9483b', '#f2a33a', '#f0cf4a', '#8a9a3b', '#2f7fc4', '#2e4a8a', '#7a5cc7', '#d66ba8',
    '#2f9c96', '#8a5a3c', '#d8c3a2', '#4c6fa3', '#3a3943'],
  street: {
    /** [0] nawierzchnia, [1] łata, [2] oznakowanie poziome (pasy, zebra), [3] ciemna spoina. */
    asphalt: ['#4a4b55', '#585963', '#f0e9d6', '#3e3f48'],
    /** Warianty płyt chodnikowych 50×50, losowane per płyta. */
    sidewalk: ['#bfb8ac', '#b3ab9e', '#c9c2b6', '#a8a094'],
    /** [0] krawężnik, [1] wariant (starszy odcinek). */
    curb: ['#d3cdc3', '#b9b2a7'],
    /** Trawniki podwórka: [0] trawa, [1] ciemniejsza łata, [2] wydeptana jaśniejsza. Tło, więc spokojne (S ≤ 0,35). */
    grass: ['#8fb07a', '#7fa36c', '#a5c08e'],
    /** Ocieplone bloki: żółty, łososiowy, miętowy, liliowy, błękit, róż. Dwa kolory na blok (pasy). */
    blokPastel: ['#f3d27a', '#f4b493', '#a9d9b9', '#c6b7e4', '#9fcbe8', '#f2a9a1'],
    /** Tynki kamienic: ochra, terakota, krem, szałwia, pudrowy róż, nieodnowiona szarość. */
    kamienicaPlaster: ['#e8cf9e', '#d9a07a', '#efe3c9', '#b9c4a1', '#d8a5a3', '#9c9286'],
  },
});

/**
 * Promienie fazowania w metrach (parametr `radius` RoundedBoxGeometry).
 * medium: części o najmniejszym wymiarze ≥ 10 cm (korpusy, blaty, cokoły, ramy).
 * small: cieńsze części (półki, listwy, słupki, drzwi). Dla bardzo cienkich: Math.min(BEVEL.small, 0.4 * minWymiar).
 */
export const BEVEL: { small: number; medium: number } = deepFreeze({ small: 0.012, medium: 0.04 });

export type MaterialKind = 'plasticMatte' | 'plasticGloss' | 'metalPainted' | 'glass' | 'wood' | 'emissive' | 'fabric';
export interface MaterialOpts { emissiveIntensity?: number; opacity?: number }

export interface KindSpec { roughness: number; metalness: number; opacity: number; emissiveIntensity: number }

/** Parametry fizyczne rodzajów materiałów (źródło prawdy dla `material()` i dla shaderów, które je powielają). */
export const MATERIALS: Readonly<Record<MaterialKind, Readonly<KindSpec>>> = {
  plasticMatte: { roughness: 0.7, metalness: 0, opacity: 1, emissiveIntensity: 0 },
  plasticGloss: { roughness: 0.3, metalness: 0, opacity: 1, emissiveIntensity: 0 },
  metalPainted: { roughness: 0.42, metalness: 0.35, opacity: 1, emissiveIntensity: 0 },
  glass: { roughness: 0.05, metalness: 0, opacity: 0.28, emissiveIntensity: 0 },
  wood: { roughness: 0.62, metalness: 0, opacity: 1, emissiveIntensity: 0 },
  emissive: { roughness: 0.5, metalness: 0, opacity: 1, emissiveIntensity: 1 },
  fabric: { roughness: 0.95, metalness: 0, opacity: 1, emissiveIntensity: 0 },
};

const HEX = /^#[0-9a-f]{6}$/i;
const cache = new Map<string, Material>();

/**
 * Wspólny materiał z cache po kluczu `kind:color:opts` (opcje po uzupełnieniu domyślnych, więc
 * `material('glass', c)` i `material('glass', c, { opacity: 0.28 })` to ta sama instancja).
 *
 * Instancje są współdzielone: nie zmieniaj ich pól i nie wywołuj na nich dispose(). Kolor per instancja:
 * `material(kind, '#ffffff')` + `InstancedMesh.setColorAt(i, kolor z PALETTE)` (kolor instancji mnoży kolor
 * materiału, więc baza musi być biała). Biel jest dozwolona tylko jako taka baza, nie jako kolor powierzchni.
 *
 * - `emissiveIntensity`: dla 'emissive' domyślnie 1; dla innych rodzajów > 0 dokłada poświatę w tym samym kolorze.
 * - `opacity` < 1 włącza przezroczystość (bez zapisu głębi). 'glass' ma domyślnie 0,28.
 */
export function material(kind: MaterialKind, color: string, opts: MaterialOpts = {}): Material {
  if (!HEX.test(color)) throw new Error(`material(): kolor musi mieć postać #rrggbb, jest "${color}"`);
  const spec = MATERIALS[kind];
  const opacity = opts.opacity ?? spec.opacity;
  const emissiveIntensity = opts.emissiveIntensity ?? spec.emissiveIntensity;
  if (!(opacity >= 0 && opacity <= 1)) throw new RangeError(`material(): opacity poza [0, 1]: ${opacity}`);
  if (!(emissiveIntensity >= 0 && Number.isFinite(emissiveIntensity))) {
    throw new RangeError(`material(): emissiveIntensity musi być ≥ 0: ${emissiveIntensity}`);
  }
  const hex = color.toLowerCase();
  const key = `${kind}:${hex}:${emissiveIntensity}:${opacity}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = new Color(hex);
  const m = new MeshStandardMaterial({
    name: key,
    color: c,
    roughness: spec.roughness,
    metalness: spec.metalness,
  });
  if (emissiveIntensity > 0) {
    m.emissive.copy(c);
    m.emissiveIntensity = emissiveIntensity;
  }
  if (opacity < 1) {
    m.transparent = true;
    m.opacity = opacity;
    m.depthWrite = false;
  }
  cache.set(key, m);
  return m;
}

/**
 * Światło dla Task 7 (renderer). Kierunek słońca: azimuthDeg mierzony w płaszczyźnie XZ od osi +X w stronę +Z,
 * elevationDeg nad horyzontem; wektor do słońca = (cos e · cos a, sin e, cos e · sin a).
 * Dzień 250°: słońce od strony −Z (ulica, jeśli y siatki rośnie w +Z), lekko z boku, żeby cienie nie leżały
 * na przekątnej kamery (yaw 45° + 90°·k) w żadnym z czterech obrotów.
 * envIntensity → scene.environmentIntensity (RoomEnvironment), exposure → renderer.toneMappingExposure,
 * bloomStrength → intensywność BloomEffect (próg luminancji ~0,9, więc świeci tylko emissive). Tło sceny: hemi.sky.
 * Noc opisuje tylko niebo i księżyc. Ciepłe światło wnętrza sklepu dodaje buildStore (zadanie 8), a latarnie
 * i okna świecą przez emissive (zadanie 12); patrz docs/style-guide.md, „Światło”.
 */
export const LIGHT_PRESETS: Record<'day' | 'night', {
  sun: { color: string; intensity: number; elevationDeg: number; azimuthDeg: number };
  hemi: { sky: string; ground: string; intensity: number }; envIntensity: number; exposure: number; bloomStrength: number;
}> = deepFreeze({
  day: {
    sun: { color: '#fff0d9', intensity: 2.4, elevationDeg: 52, azimuthDeg: 250 },
    hemi: { sky: '#cfe3ff', ground: '#e6d3b3', intensity: 0.7 },
    envIntensity: 0.45, exposure: 1.0, bloomStrength: 0.2,
  },
  night: {
    sun: { color: '#a8b8ff', intensity: 0.3, elevationDeg: 62, azimuthDeg: 120 },
    hemi: { sky: '#33467a', ground: '#2a2431', intensity: 0.5 },
    envIntensity: 0.1, exposure: 1.1, bloomStrength: 0.9,
  },
});

/**
 * Proporcje postaci w stylu Two Point (zadanie 16: modele Quaternius są smukłe i długonogie, Two Point ma duże głowy,
 * krępy tułów i krótkie nogi). headScale, handScale i torsoScale to skala kości głowy, dłoni i tułowia (miednica, brzuch,
 * klatka) względem modelu bazowego. Wzrost wyrównuje skala całej postaci, więc większa głowa i tułów skracają nogi
 * w proporcji. heightRange: wzrost w metrach (od podeszwy do czubka głowy, po powiększeniu). widthRange: mnożnik
 * szerokości całej postaci (oś X i Z), czyli „tusza”.
 */
export const CHARACTER_STYLE: {
  headScale: number; handScale: number; torsoScale: number; heightRange: [number, number]; widthRange: [number, number];
} = deepFreeze({ headScale: 1.45, handScale: 1.35, torsoScale: 1.14, heightRange: [1.55, 1.88], widthRange: [0.95, 1.25] });

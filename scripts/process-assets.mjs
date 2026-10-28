// Pipeline assetów CC0: assets-src/<paczka>/files/** -> public/assets/**.glb
// Uruchomienie: npm run assets
//
// Układ katalogu źródeł (assets-src/ jest git-ignored, nie trafia do repozytorium):
//   assets-src/<paczka>/zip/    pobrane archiwum paczki (zostaje jako dowód pochodzenia, skrypt go nie czyta)
//   assets-src/<paczka>/files/  rozpakowana zawartość paczki; stąd skrypt czyta pliki (ścieżki w stałych poniżej)
// Paczki: kenney-car-kit, kenney-city-kit-roads, quaternius-modular-men, quaternius-modular-women.
//
// Źródła są tylko czytane (gltf-transform), nic z assets-src/ nie jest wykonywane.
// Postacie: z 24 wbudowanych klipów zostają tylko Idle i Walk (reszta nigdy nie jest odtwarzana), potem przycięcie
// klatek animacji (resample) i uproszczenie do celu zadania (`triangles`, domyślnie CHARACTER_TRIANGLES). Uproszczenie
// jest odrzucane, jeśli psuje skinning lub liczbę skinów/animacji/prymitywów.
// Siatki Quaterniusa są cieniowane płasko (każda ściana ma własne wierzchołki), więc zwykłe uproszczenie topologiczne nic
// nie zwija, a „sloppy” rwie cienkie części (płytki zbroi, nogawki, oczy pod skórą twarzy) w dziury. Dlatego każde zadanie
// postaci ma `permissive: true`: uproszczenie topologiczne z flagą Permissive (PERMISSIVE). Zadanie z `permissive`, które
// nie schodzi do celu, kończy potok błędem: nie ma po cichu gorszej ścieżki. Cel 3 tys. trójkątów wystarcza zwykłym strojom;
// kosmonauta, król i poszukiwacz przygód (mężczyzna) dostają więcej (`triangles`, uzasadnienie przy ich zadaniach).
// Stroje specjalne (special-*.glb, tylko dla kasjera gracza) idą tą samą ścieżką. Zadanie `drop` usuwa przed uproszczeniem
// węzły, których gra nie rysuje (pistolet, miecz): zjadałyby limit trójkątów, a niezwiązane ze skórą wisiałyby na kości
// dłoni jako osobne siatki, czyli dodatkowe draw calle postaci.
// Tekstury postaci (stroje modular ich nie mają) byłyby skalowane do TEXTURE_LIMIT i zapisywane jako JPEG.
// Na końcu każdy plik dostaje bezstratną kompresję meshopt (EXT_meshopt_compression, bez kwantyzacji), a zapisany plik
// jest wczytany z powrotem dekoderem meshopt i porównany ze źródłem (macierze inverseBindMatrices po nazwie kości).
// Pliki w public/assets/characters i public/assets/props, których skrypt już nie tworzy, są usuwane.

import { access, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
  cloneDocument,
  dedup,
  prune,
  reorder,
  resample,
  simplifyPrimitive,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets-src');
const OUT = join(ROOT, 'public', 'assets');
/** Katalogi wyjścia, w których skrypt sprząta pliki, których już nie tworzy. */
const OUT_DIRS = ['characters', 'props'];

/** Domyślny cel uproszczenia postaci w trójkątach; zadanie może go zmienić własnym `triangles`. */
const CHARACTER_TRIANGLES = 3000;
// Mniejsze prymitywy (oczy, drobne detale) nie są upraszczane, bo uproszczenie mogłoby je usunąć.
const SMALL_PRIMITIVE_TRIANGLES = 300;
const SLOPPY_ERROR = 0.15;
const PERMISSIVE_ERROR = 0.05;
const TEXTURE_LIMIT = 512;
const TRIANGLES_MODE = 4;
/** Jedyne klipy, które gra odtwarza (characterFactory: idle i walk). Pozostałe 22 klipy stroju są usuwane. */
const CHARACTER_CLIPS = ['Idle', 'Walk'];

const MEN = join(SRC, 'quaternius-modular-men', 'files', 'Ultimate Modular Men- Feb 2022', 'Individual Characters', 'glTF');
const WOMEN = join(SRC, 'quaternius-modular-women', 'files', 'Ultimate Modular Women - April 2022', 'Individual Characters', 'glTF');
const CITY = join(SRC, 'kenney-city-kit-roads', 'files', 'Models', 'GLB format');
const CAR = join(SRC, 'kenney-car-kit', 'files', 'Models', 'GLB format');

/** Wspólne ustawienia zadania postaci: klipy, tekstury i uproszczenie strategią permissive (patrz PERMISSIVE). */
const CHARACTER = { character: true, permissive: true };

/**
 * Wejście -> wyjście względem public/assets. `character: true` włącza przycięcie klipów, uproszczenie i tekstury.
 * `triangles`: cel uproszczenia tego pliku (domyślnie CHARACTER_TRIANGLES); tylko dla zadań postaci.
 * `drop`: nazwy węzłów (z siatkami) usuwanych przed resztą potoku, każdy musi istnieć dokładnie raz.
 * `permissive`: uproszczenie topologiczne z flagą Permissive (patrz PERMISSIVE); gdy nie schodzi do celu, potok kończy się błędem.
 */
const JOBS = [
  { src: join(MEN, 'Casual_Hoodie.gltf'), out: 'characters/men-casual-hoodie.glb', ...CHARACTER },
  { src: join(MEN, 'Casual_2.gltf'), out: 'characters/men-casual-2.glb', ...CHARACTER },
  { src: join(MEN, 'Suit.gltf'), out: 'characters/men-suit.glb', ...CHARACTER },
  { src: join(MEN, 'Worker.gltf'), out: 'characters/men-worker.glb', ...CHARACTER },
  { src: join(MEN, 'Farmer.gltf'), out: 'characters/men-farmer.glb', ...CHARACTER },
  { src: join(MEN, 'Beach.gltf'), out: 'characters/men-beach.glb', ...CHARACTER },
  { src: join(MEN, 'Punk.gltf'), out: 'characters/men-punk.glb', ...CHARACTER },
  { src: join(WOMEN, 'Casual.gltf'), out: 'characters/women-casual.glb', ...CHARACTER },
  { src: join(WOMEN, 'Suit.gltf'), out: 'characters/women-suit.glb', ...CHARACTER },
  { src: join(WOMEN, 'Formal.gltf'), out: 'characters/women-formal.glb', ...CHARACTER },
  { src: join(WOMEN, 'Worker.gltf'), out: 'characters/women-worker.glb', ...CHARACTER },
  { src: join(WOMEN, 'Punk.gltf'), out: 'characters/women-punk.glb', ...CHARACTER },
  // Stroje specjalne (ASSETS.characters.special): tylko kasjer gracza, klienci ich nie dostają.
  // `triangles: 8000` (kosmonauta, źródło 10,6 tys.): przy 3000 rwie się pancerz (12,1 tys. px przezroczystych dziur w 16 widokach), przy
  // 5000 zostaje 1,5 tys. px (cienkie kremowe szczeliny wzdłuż szwów płyt, widać je w dużym podglądzie na ekranie startowym), przy 5500
  // 835, przy 6500 162 px (pod progiem 200 px, ale szczeliny dalej widać w zbliżeniu 2× DPR z przodu i z tyłu), przy 8000 17 px i
  // zbliżenie jest czyste (potok: 7992 trójkąty, 358 KB wobec 261 KB przy 5000; źródło 0 px, 439 KB). Metoda: skrypty z przeglądu K1,
  // rzut ortogonalny źródła i wyniku z 16 kierunków z odcinaniem tylnych ścian, dziura = piksel pokryty w źródle, a niepokryty w wyniku.
  // `triangles: 5000` (król, poszukiwacz przygód m): przy 3000 oczy giną pod skórą twarzy (widoczność oczu od frontu 0% i 43%, przy 5000:
  // 48% i 75%; źródło: 45% i 75%).
  { src: join(MEN, 'Spacesuit.gltf'), out: 'characters/special-men-spacesuit.glb', ...CHARACTER, triangles: 8000 },
  { src: join(MEN, 'King.gltf'), out: 'characters/special-men-king.glb', ...CHARACTER, triangles: 5000 },
  { src: join(MEN, 'Swat.gltf'), out: 'characters/special-men-swat.glb', ...CHARACTER, drop: ['Pistol'] },
  { src: join(MEN, 'Adventurer.gltf'), out: 'characters/special-men-adventurer.glb', ...CHARACTER, triangles: 5000 },
  { src: join(WOMEN, 'SciFi.gltf'), out: 'characters/special-women-scifi.glb', ...CHARACTER, drop: ['Pistol'] },
  { src: join(WOMEN, 'Adventurer.gltf'), out: 'characters/special-women-adventurer.glb', ...CHARACTER },
  { src: join(WOMEN, 'Witch.gltf'), out: 'characters/special-women-witch.glb', ...CHARACTER },
  { src: join(WOMEN, 'Medieval.gltf'), out: 'characters/special-women-medieval.glb', ...CHARACTER, drop: ['Sword'] },
  { src: join(WOMEN, 'Soldier.gltf'), out: 'characters/special-women-soldier.glb', ...CHARACTER },
  { src: join(CITY, 'light-curved.glb'), out: 'props/lamp-curved.glb' },
  { src: join(CAR, 'delivery.glb'), out: 'props/van-delivery.glb' },
];

// Zapis z kompresją meshopt wymaga encodera zarejestrowanego jako zależność.
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  .setLogger(new Logger(Logger.Verbosity.WARN));

// Odczyt zapisanych plików (kontrola po zapisie) wymaga dekodera meshopt.
const verifyIo = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  .setLogger(new Logger(Logger.Verbosity.WARN));

/**
 * Uproszczenie „sloppy” ignoruje topologię. Siatki modularne są złożone z osobnych
 * kawałków (szwy nie dzielą krawędzi), więc zwykłe uproszczenie ich nie zmniejsza.
 * Limit błędu (SLOPPY_ERROR) jest ciasny: przy błędzie 1 postacie się rozpadają.
 * Używają go tylko zadania postaci bez `permissive` (obecnie żadne): „sloppy” rwie cienkie części w dziury.
 */
const SLOPPY = {
  simplify: (indices, positions, stride, target, error) =>
    MeshoptSimplifier.simplifySloppy(indices, positions, stride, null, target, error),
};

/**
 * Uproszczenie topologiczne z flagą `Permissive`: pozwala zwijać krawędzie przez szwy atrybutów. Siatki Quaterniusa są
 * cieniowane płasko (każda ściana ma własne wierzchołki z własną normalną), więc zwykłe uproszczenie widzi sam szew i nie
 * zwinie niczego (10558 trójkątów kosmonauty zostaje 10138 nawet przy błędzie 0,5), a „sloppy” rwie cienkie płytki zbroi
 * w dziury. Z `Permissive` ta sama siatka schodzi do celu przy błędzie rzędu 0,01–0,04 i zachowuje kształty. Limit błędu
 * (PERMISSIVE_ERROR) jest zapasowy: wszystkie zadania schodzą do celu, zanim go osiągną. Gdyby któreś nie zeszło (wynik
 * wyższy niż cel + 10% albo zepsuty skinning), potok kończy się błędem z opisem, zamiast po cichu wziąć gorszą ścieżkę:
 * wtedy trzeba podnieść `triangles` zadania albo PERMISSIVE_ERROR.
 */
const PERMISSIVE = {
  simplify: (indices, positions, stride, target, error, flags) =>
    MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']),
};

const exists = (path) => access(path).then(() => true, () => false);

function primitiveTriangles(prim) {
  if (prim.getMode() !== TRIANGLES_MODE) return 0;
  const indices = prim.getIndices();
  return (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
}

function skinnedPrimitiveCount(doc) {
  return doc
    .getRoot()
    .listMeshes()
    .reduce((n, mesh) => n + mesh.listPrimitives().filter((p) => p.getAttribute('WEIGHTS_0')).length, 0);
}

function summarize(doc) {
  const root = doc.getRoot();
  const tris = root
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((n, prim) => n + primitiveTriangles(prim), 0);
  return {
    tris: Math.round(tris),
    skins: root.listSkins().length,
    joints: root.listSkins().reduce((n, skin) => n + skin.listJoints().length, 0),
    anims: root.listAnimations().length,
    skinnedPrims: skinnedPrimitiveCount(doc),
  };
}

/** Każdy wierzchołek skinowanej siatki ma JOINTS_0 i wagi sumujące się do 1. */
function skinningIntact(doc) {
  const w = [0, 0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const weights = prim.getAttribute('WEIGHTS_0');
      if (!weights) continue;
      const joints = prim.getAttribute('JOINTS_0');
      if (!joints || joints.getCount() !== weights.getCount()) return false;
      for (let i = 0; i < weights.getCount(); i++) {
        weights.getElement(i, w);
        if (Math.abs(w[0] + w[1] + w[2] + w[3] - 1) > 1e-2) return false;
      }
    }
  }
  return true;
}

/**
 * Upraszcza prymitywy od SMALL_PRIMITIVE_TRIANGLES wzwyż do wspólnego współczynnika,
 * tak aby suma trójkątów zbliżyła się do `target`.
 */
function simplifyCharacter(doc, target, simplifier, error) {
  const prims = doc
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .filter((prim) => primitiveTriangles(prim) > 0);
  const big = prims.filter((prim) => primitiveTriangles(prim) >= SMALL_PRIMITIVE_TRIANGLES);
  const smallTris = prims
    .filter((prim) => primitiveTriangles(prim) < SMALL_PRIMITIVE_TRIANGLES)
    .reduce((n, prim) => n + primitiveTriangles(prim), 0);
  const bigTris = big.reduce((n, prim) => n + primitiveTriangles(prim), 0);
  const ratio = Math.min(1, Math.max(0.05, (target - smallTris) / bigTris));
  for (const prim of big) simplifyPrimitive(prim, { simplifier, ratio, error });
}

/**
 * Upraszcza kopię dokumentu. `doc` w wyniku jest ustawione tylko wtedy, gdy zachowano skinning i animacje, a siatka zeszła do
 * celu (z zapasem 10%); `tris` i `intact` opisują wynik także przy odrzuceniu (do komunikatu błędu).
 */
async function trySimplify(doc, before, simplifier, error, target) {
  const candidate = cloneDocument(doc);
  simplifyCharacter(candidate, target, simplifier, error);
  const after = summarize(candidate);
  const intact =
    after.skins === before.skins &&
    after.joints === before.joints &&
    after.anims === before.anims &&
    after.skinnedPrims === before.skinnedPrims &&
    skinningIntact(candidate);
  return { doc: intact && after.tris <= target * 1.1 ? candidate : null, tris: after.tris, intact };
}

/**
 * Usuwa z dokumentu węzły o podanych nazwach (`drop` zadania). Każdy musi istnieć dokładnie raz, nie może mieć dzieci ani być
 * kością skina: inaczej zadanie by po cichu nic nie usunęło albo urwało szkielet. Siatki, materiały i akcesory usuniętych
 * węzłów zbiera potem `prune()`.
 */
function dropNodes(doc, names, label) {
  const joints = new Set(doc.getRoot().listSkins().flatMap((skin) => skin.listJoints()));
  for (const name of names) {
    const nodes = doc.getRoot().listNodes().filter((node) => node.getName() === name);
    if (nodes.length !== 1) throw new Error(`${label}: do usunięcia oczekiwano jednego węzła "${name}", jest ${nodes.length}`);
    const [node] = nodes;
    if (joints.has(node)) throw new Error(`${label}: węzeł "${name}" jest kością skina, nie wolno go usunąć`);
    if (node.listChildren().length) throw new Error(`${label}: węzeł "${name}" ma dzieci, nie wolno go usunąć`);
    node.dispose();
  }
}

/**
 * Zostawia w dokumencie tylko klipy `keep` (po dokładnej nazwie). Brak któregoś z nich to błąd: gra szuka ich po nazwie.
 * Kanały i samplery usuwanych klipów trzeba zwolnić osobno: `Animation.dispose()` ich nie rusza, a dopóki sampler
 * trzyma akcesor, `prune()` go nie usunie (plik niósłby wtedy tysiące nieużywanych akcesorów w JSON-ie).
 */
function keepClips(doc, keep, label) {
  const animations = doc.getRoot().listAnimations();
  for (const name of keep) {
    if (!animations.some((a) => a.getName() === name)) throw new Error(`${label}: brak klipu "${name}"`);
  }
  for (const animation of animations) {
    if (keep.includes(animation.getName())) continue;
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
}

/** Macierze odwrotne bind skinów po nazwie kości (16 liczb). Nazwa musi być jednoznaczna w obrębie wszystkich skinów. */
function inverseBindByJoint(doc, label) {
  const out = new Map();
  for (const skin of doc.getRoot().listSkins()) {
    const matrices = skin.getInverseBindMatrices();
    skin.listJoints().forEach((joint, i) => {
      const name = joint.getName();
      if (out.has(name)) throw new Error(`${label}: powtórzona nazwa kości "${name}"`);
      out.set(name, matrices ? matrices.getElement(i, new Array(16)) : null);
    });
  }
  return out;
}

/** Zgłasza kość, której macierz odwrotna bind różni się (albo której brakuje) względem `expected`. Zwraca opis błędu lub null. */
function compareInverseBind(expected, actual) {
  if (expected.size !== actual.size) return `liczba kości ${actual.size} zamiast ${expected.size}`;
  for (const [name, a] of expected) {
    const b = actual.get(name);
    if (!b) return `brak kości "${name}"`;
    if (!a || a.length !== b.length || a.some((v, k) => v !== b[k])) return `kość "${name}": inna macierz`;
  }
  return null;
}

/** Czyści dokument (w tym przycina klipy i klatki animacji) i opcjonalnie upraszcza do `simplifyTo` trójkątów. */
async function prepare(job, simplifyTo) {
  const doc = await io.read(job.src);
  const sourceInverseBind = inverseBindByJoint(doc, job.out);
  if (job.drop) dropNodes(doc, job.drop, job.out);
  if (job.character) keepClips(doc, CHARACTER_CLIPS, job.out);
  await doc.transform(dedup(), weld(), prune(), resample());
  const before = summarize(doc);
  const result = (candidate, note) => ({ doc: candidate, before, sourceInverseBind, note });
  if (!simplifyTo || before.tris <= simplifyTo) return result(doc, '');

  const topology = await trySimplify(doc, before, MeshoptSimplifier, 0.01, simplifyTo);
  if (topology.doc) return result(topology.doc, 'uproszczono');
  if (job.permissive) {
    const permissive = await trySimplify(doc, before, PERMISSIVE, PERMISSIVE_ERROR, simplifyTo);
    if (permissive.doc) return result(permissive.doc, 'uproszczono (permissive)');
    // Bez cichego spadku na „sloppy”: dziury w stroju widać dopiero w grze, a nie w tabeli potoku.
    throw new Error(
      `${job.out}: uproszczenie permissive nie osiągnęło celu ${simplifyTo} trójkątów ` +
        `(wynik ${permissive.tris}, limit ${Math.floor(simplifyTo * 1.1)}, skinning ${permissive.intact ? 'cały' : 'zepsuty'}); ` +
        'podnieś `triangles` zadania albo PERMISSIVE_ERROR',
    );
  }
  const sloppy = await trySimplify(doc, before, SLOPPY, SLOPPY_ERROR, simplifyTo);
  if (sloppy.doc) return result(sloppy.doc, 'uproszczono (sloppy)');
  return result(doc, 'BEZ uproszczenia: uproszczenie psuje skinning lub animacje');
}

/**
 * Kompresja meshopt bez kwantyzacji. `meshopt()` z gltf-transform kwantyzuje wszystkie
 * akcesory i przy tym psuje macierze inverseBindMatrices skinów (postacie się rozpadają).
 */
async function compressMeshopt(doc) {
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
    method: EXTMeshoptCompression.EncoderMethod.FILTER,
  });
}

/** Kopie macierzy inverseBindMatrices wszystkich skinów (do sprawdzenia po kompresji w pamięci). */
function inverseBindMatrices(doc) {
  return doc.getRoot().listSkins().map((skin) => Float32Array.from(skin.getInverseBindMatrices()?.getArray() ?? []));
}

function sameMatrices(a, b) {
  return a.length === b.length && a.every((m, i) => m.length === b[i].length && m.every((v, k) => v === b[i][k]));
}

/** Cel uproszczenia zadania w trójkątach; 0 = bez uproszczenia (rekwizyty). `triangles` ma sens tylko dla postaci. */
function targetTriangles(job) {
  if (job.triangles !== undefined && !job.character) throw new Error(`${job.out}: \`triangles\` dotyczy tylko zadań postaci`);
  return job.character ? (job.triangles ?? CHARACTER_TRIANGLES) : 0;
}

async function processJob(job) {
  const outPath = join(OUT, job.out);
  await mkdir(dirname(outPath), { recursive: true });

  const { doc, before, sourceInverseBind, note } = await prepare(job, targetTriangles(job));
  const matricesBefore = inverseBindMatrices(doc);
  if (job.character) {
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'jpeg',
        resize: [TEXTURE_LIMIT, TEXTURE_LIMIT],
        quality: 85,
        chromaSubsampling: '4:4:4',
      }),
    );
  }
  await compressMeshopt(doc);

  const after = summarize(doc);
  if (after.skins !== before.skins || after.anims !== before.anims) {
    throw new Error(`${job.out}: zmieniła się liczba skinów lub animacji`);
  }
  if (!sameMatrices(matricesBefore, inverseBindMatrices(doc))) {
    throw new Error(`${job.out}: zmieniły się macierze inverseBindMatrices`);
  }
  await io.write(outPath, doc);

  // Kontrola po zapisie: dopiero tu działa encoder meshopt, więc dopiero tu widać, czy zepsuł macierze skina.
  // Czytamy plik z dysku dekoderem i porównujemy ze źródłem, kość po kości (po nazwie).
  const written = await verifyIo.read(outPath);
  const problem = compareInverseBind(sourceInverseBind, inverseBindByJoint(written, job.out));
  if (problem) throw new Error(`${job.out}: po zapisie inverseBindMatrices różnią się od źródła (${problem})`);
  const writtenSummary = summarize(written);
  if (writtenSummary.skins !== before.skins || writtenSummary.anims !== before.anims || writtenSummary.tris !== after.tris) {
    throw new Error(`${job.out}: odczyt po zapisie nie zgadza się z dokumentem (skiny, animacje lub trójkąty)`);
  }

  const { size } = await stat(outPath);
  return { file: job.out, tris: after.tris, skins: after.skins, anims: after.anims, kb: size / 1024, note, target: job.triangles };
}

/** Usuwa z katalogów wyjścia pliki, których żadne zadanie już nie tworzy (np. po usunięciu paczki ze źródeł). */
async function removeStale(produced) {
  const removed = [];
  for (const dir of OUT_DIRS) {
    const names = await readdir(join(OUT, dir)).catch(() => []);
    for (const name of names) {
      const rel = `${dir}/${name}`;
      if (produced.has(rel)) continue;
      await rm(join(OUT, rel), { recursive: true });
      removed.push(rel);
    }
  }
  return removed;
}

async function main() {
  // Encoder i uproszczacz meshopt to WASM: przed pierwszym użyciem muszą być gotowe.
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);

  const rows = [];
  for (const job of JOBS) {
    if (!(await exists(job.src))) throw new Error(`Brak pliku źródłowego: ${job.src}`);
    console.log(`przetwarzam ${job.out}`);
    rows.push(await processJob(job));
  }
  for (const rel of await removeStale(new Set(JOBS.map((job) => job.out)))) console.log(`usunięto nieaktualny plik ${rel}`);

  const width = Math.max('plik'.length, ...rows.map((r) => r.file.length));
  const line = (file, tris, kb, notes) =>
    `${file.padEnd(width)}  ${String(tris).padStart(9)}  ${kb.padStart(9)}  ${notes}`;
  console.log(`\n${line('plik', 'trójkąty', 'KB', 'uwagi')}`);
  for (const r of rows) {
    const notes = [r.note, r.target ? `cel ${r.target}` : '', r.skins ? `skiny ${r.skins}` : '', r.anims ? `animacje ${r.anims}` : '']
      .filter(Boolean)
      .join(', ');
    console.log(line(r.file, r.tris, r.kb.toFixed(1), notes));
  }
  const totalTris = rows.reduce((n, r) => n + r.tris, 0);
  const totalKb = rows.reduce((n, r) => n + r.kb, 0);
  console.log(line('RAZEM', totalTris, totalKb.toFixed(1), `${rows.length} plików`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

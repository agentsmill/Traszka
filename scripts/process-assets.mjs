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
// klatek animacji (resample) i uproszczenie do CHARACTER_TRIANGLES trójkątów (najpierw po topologii, a gdy siatka jest
// pocięta na kawałki, metodą sloppy). Uproszczenie jest odrzucane, jeśli psuje skinning lub liczbę skinów/animacji/prymitywów.
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

const CHARACTER_TRIANGLES = 3000;
// Mniejsze prymitywy (oczy, drobne detale) nie są upraszczane, bo uproszczenie mogłoby je usunąć.
const SMALL_PRIMITIVE_TRIANGLES = 300;
const SLOPPY_ERROR = 0.15;
const TEXTURE_LIMIT = 512;
const TRIANGLES_MODE = 4;
/** Jedyne klipy, które gra odtwarza (characterFactory: idle i walk). Pozostałe 22 klipy stroju są usuwane. */
const CHARACTER_CLIPS = ['Idle', 'Walk'];

const MEN = join(SRC, 'quaternius-modular-men', 'files', 'Ultimate Modular Men- Feb 2022', 'Individual Characters', 'glTF');
const WOMEN = join(SRC, 'quaternius-modular-women', 'files', 'Ultimate Modular Women - April 2022', 'Individual Characters', 'glTF');
const CITY = join(SRC, 'kenney-city-kit-roads', 'files', 'Models', 'GLB format');
const CAR = join(SRC, 'kenney-car-kit', 'files', 'Models', 'GLB format');

/** Wejście -> wyjście względem public/assets. `character: true` włącza przycięcie klipów, uproszczenie i tekstury. */
const JOBS = [
  { src: join(MEN, 'Casual_Hoodie.gltf'), out: 'characters/men-casual-hoodie.glb', character: true },
  { src: join(MEN, 'Casual_2.gltf'), out: 'characters/men-casual-2.glb', character: true },
  { src: join(MEN, 'Suit.gltf'), out: 'characters/men-suit.glb', character: true },
  { src: join(MEN, 'Worker.gltf'), out: 'characters/men-worker.glb', character: true },
  { src: join(MEN, 'Farmer.gltf'), out: 'characters/men-farmer.glb', character: true },
  { src: join(MEN, 'Beach.gltf'), out: 'characters/men-beach.glb', character: true },
  { src: join(MEN, 'Punk.gltf'), out: 'characters/men-punk.glb', character: true },
  { src: join(WOMEN, 'Casual.gltf'), out: 'characters/women-casual.glb', character: true },
  { src: join(WOMEN, 'Suit.gltf'), out: 'characters/women-suit.glb', character: true },
  { src: join(WOMEN, 'Formal.gltf'), out: 'characters/women-formal.glb', character: true },
  { src: join(WOMEN, 'Worker.gltf'), out: 'characters/women-worker.glb', character: true },
  { src: join(WOMEN, 'Punk.gltf'), out: 'characters/women-punk.glb', character: true },
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
 */
const SLOPPY = {
  simplify: (indices, positions, stride, target, error) =>
    MeshoptSimplifier.simplifySloppy(indices, positions, stride, null, target, error),
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

/** Upraszcza kopię dokumentu. Zwraca wynik tylko wtedy, gdy zachowano skinning i animacje. */
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
  return intact && after.tris <= target * 1.1 ? candidate : null;
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
  if (job.character) keepClips(doc, CHARACTER_CLIPS, job.out);
  await doc.transform(dedup(), weld(), prune(), resample());
  const before = summarize(doc);
  const result = (candidate, note) => ({ doc: candidate, before, sourceInverseBind, note });
  if (!simplifyTo || before.tris <= simplifyTo) return result(doc, '');

  const topology = await trySimplify(doc, before, MeshoptSimplifier, 0.01, simplifyTo);
  if (topology) return result(topology, 'uproszczono');
  const sloppy = await trySimplify(doc, before, SLOPPY, SLOPPY_ERROR, simplifyTo);
  if (sloppy) return result(sloppy, 'uproszczono (sloppy)');
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

async function processJob(job) {
  const outPath = join(OUT, job.out);
  await mkdir(dirname(outPath), { recursive: true });

  const { doc, before, sourceInverseBind, note } = await prepare(job, job.character ? CHARACTER_TRIANGLES : 0);
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
  return { file: job.out, tris: after.tris, skins: after.skins, anims: after.anims, kb: size / 1024, note };
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
    const notes = [r.note, r.skins ? `skiny ${r.skins}` : '', r.anims ? `animacje ${r.anims}` : '']
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

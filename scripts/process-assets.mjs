// Pipeline assetów CC0: assets-src/<paczka>/files/** -> public/assets/**.glb
// Uruchomienie: npm run assets
//
// Źródła są tylko czytane (gltf-transform), nic z assets-src/ nie jest wykonywane.
// Postacie: przycięcie klatek animacji (resample), uproszczenie do CHARACTER_TRIANGLES
// trójkątów (najpierw po topologii, a gdy siatka jest pocięta na kawałki, metodą sloppy).
// Uproszczenie jest odrzucane, jeśli psuje skinning lub liczbę skinów/animacji/prymitywów.
// Tekstury postaci są skalowane do TEXTURE_LIMIT i zapisywane jako JPEG.
// Na końcu każdy plik dostaje bezstratną kompresję meshopt (EXT_meshopt_compression, bez kwantyzacji).

import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
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
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets-src');
const OUT = join(ROOT, 'public', 'assets');

const CHARACTER_TRIANGLES = 3000;
// Mniejsze prymitywy (oczy, drobne detale) nie są upraszczane, bo uproszczenie mogłoby je usunąć.
const SMALL_PRIMITIVE_TRIANGLES = 300;
const SLOPPY_ERROR = 0.15;
const TEXTURE_LIMIT = 1024;
const TRIANGLES_MODE = 4;

const UBC = join(SRC, 'quaternius-ubc', 'files', 'Universal Base Characters[Standard]');
const UBC_BODY = join(UBC, 'Base Characters', 'Godot - UE');
const UBC_HAIR = join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');
const UAL = join(SRC, 'quaternius-ual', 'files', 'Universal Animation Library[Standard]', 'Unreal-Godot');
const MEN = join(SRC, 'quaternius-modular-men', 'files', 'Ultimate Modular Men- Feb 2022', 'Individual Characters', 'glTF');
const WOMEN = join(SRC, 'quaternius-modular-women', 'files', 'Ultimate Modular Women - April 2022', 'Individual Characters', 'glTF');
const NATURE = join(SRC, 'kenney-nature-kit', 'files', 'Models', 'GLTF format');
const CITY = join(SRC, 'kenney-city-kit-roads', 'files', 'Models', 'GLB format');
const CAR = join(SRC, 'kenney-car-kit', 'files', 'Models', 'GLB format');

/** Wejście -> wyjście względem public/assets. `character: true` włącza uproszczenie i tekstury. */
const JOBS = [
  { src: join(UBC_BODY, 'Superhero_Male_FullBody.gltf'), out: 'characters/ubc-male.glb', character: true },
  { src: join(UBC_BODY, 'Superhero_Female_FullBody.gltf'), out: 'characters/ubc-female.glb', character: true },
  { src: join(UBC_HAIR, 'Hair_Beard.gltf'), out: 'characters/hair-beard.glb', character: true },
  { src: join(UBC_HAIR, 'Hair_Buns.gltf'), out: 'characters/hair-buns.glb', character: true },
  { src: join(UBC_HAIR, 'Hair_Buzzed.gltf'), out: 'characters/hair-buzzed.glb', character: true },
  { src: join(UBC_HAIR, 'Hair_BuzzedFemale.gltf'), out: 'characters/hair-buzzed-female.glb', character: true },
  { src: join(UBC_HAIR, 'Hair_Long.gltf'), out: 'characters/hair-long.glb', character: true },
  { src: join(UBC_HAIR, 'Hair_SimpleParted.gltf'), out: 'characters/hair-simple-parted.glb', character: true },
  { src: join(UBC_HAIR, 'Eyebrows_Regular.gltf'), out: 'characters/eyebrows-regular.glb', character: true },
  { src: join(UBC_HAIR, 'Eyebrows_Female.gltf'), out: 'characters/eyebrows-female.glb', character: true },
  { src: join(UAL, 'UAL1_Standard.glb'), out: 'characters/ual1-standard.glb', character: true },
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
  { src: join(NATURE, 'tree_default.glb'), out: 'props/tree-default.glb' },
  { src: join(NATURE, 'tree_fat.glb'), out: 'props/tree-fat.glb' },
  { src: join(CITY, 'light-curved.glb'), out: 'props/lamp-curved.glb' },
  { src: join(CAR, 'delivery.glb'), out: 'props/van-delivery.glb' },
];

// Zapis z kompresją meshopt wymaga encodera zarejestrowanego jako zależność.
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
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

/**
 * Wczytuje .glb wprost. Pliki .gltf wczytuje ręcznie: paczka Quaternius UBC odwołuje się
 * do tekstur `T_*_png.png`, których w paczce nie ma. Używany jest wtedy plik `T_*.png`
 * z tej samej paczki (ten sam obraz, sam sufiks eksportu).
 */
async function readDocument(file) {
  if (extname(file) === '.glb') return io.read(file);
  const dir = dirname(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  const resources = {};
  for (const def of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!def.uri || def.uri.startsWith('data:') || def.uri in resources) continue;
    let name = decodeURIComponent(def.uri);
    if (!(await exists(join(dir, name)))) {
      const alt = name.replace(/_png(\.png)$/, '$1');
      if (alt === name || !(await exists(join(dir, alt)))) throw new Error(`Brak zasobu: ${join(dir, name)}`);
      console.warn(`  uwaga: ${name} -> ${alt} (brak w paczce, używam pliku z tym samym sufiksem)`);
      name = alt;
    }
    def.uri = name;
    resources[name] = await readFile(join(dir, name));
  }
  return io.readJSON({ json, resources });
}

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

/** Czyści dokument (w tym przycina klatki animacji) i opcjonalnie upraszcza do `simplifyTo` trójkątów. */
async function prepare(job, simplifyTo) {
  const doc = await readDocument(job.src);
  await doc.transform(dedup(), weld(), prune(), resample());
  const before = summarize(doc);
  if (!simplifyTo || before.tris <= simplifyTo) return { doc, before, note: '' };

  const topology = await trySimplify(doc, before, MeshoptSimplifier, 0.01, simplifyTo);
  if (topology) return { doc: topology, before, note: 'uproszczono' };
  const sloppy = await trySimplify(doc, before, SLOPPY, SLOPPY_ERROR, simplifyTo);
  if (sloppy) return { doc: sloppy, before, note: 'uproszczono (sloppy)' };
  return { doc, before, note: 'BEZ uproszczenia: uproszczenie psuje skinning lub animacje' };
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

/** Kopie macierzy inverseBindMatrices wszystkich skinów (do sprawdzenia po kompresji). */
function inverseBindMatrices(doc) {
  return doc.getRoot().listSkins().map((skin) => Float32Array.from(skin.getInverseBindMatrices()?.getArray() ?? []));
}

function sameMatrices(a, b) {
  return a.length === b.length && a.every((m, i) => m.length === b[i].length && m.every((v, k) => v === b[i][k]));
}

async function processJob(job) {
  const outPath = join(OUT, job.out);
  await mkdir(dirname(outPath), { recursive: true });

  const { doc, before, note } = await prepare(job, job.character ? CHARACTER_TRIANGLES : 0);
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
  const { size } = await stat(outPath);
  return { file: job.out, tris: after.tris, skins: after.skins, anims: after.anims, kb: size / 1024, note };
}

async function main() {
  const rows = [];
  for (const job of JOBS) {
    if (!(await exists(job.src))) throw new Error(`Brak pliku źródłowego: ${job.src}`);
    console.log(`przetwarzam ${job.out}`);
    rows.push(await processJob(job));
  }

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

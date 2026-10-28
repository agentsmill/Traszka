import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Wyłącznie dla testów (nie jest importowany przez kod gry). Loader testowy: czyta prawdziwe GLB z public/, usuwa tekstury
 * (Node nie ma obrazów) i parsuje GLTFLoaderem, więc fabryka dostaje te same siatki, szkielety i klipy co w przeglądarce.
 */
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const cache = new Map<string, Promise<GLTF>>();

export function loadFromDisk(url: string): Promise<GLTF> {
  let hit = cache.get(url);
  if (!hit) {
    hit = (async () => {
      const bytes = readFileSync(join('public', url));
      const doc = await io.readBinary(new Uint8Array(bytes));
      for (const t of doc.getRoot().listTextures()) t.dispose();
      for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
      const out = await io.writeBinary(doc);
      const buffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      return new GLTFLoader().parseAsync(buffer, '');
    })();
    cache.set(url, hit);
  }
  return hit;
}

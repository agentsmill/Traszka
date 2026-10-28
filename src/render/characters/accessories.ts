import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BEVEL, CHARACTER_STYLE } from '@/render/style';
import type { Appearance } from './appearance';
import { REGION } from './characterMaterial';
import type { Variant } from './modularPack';

/**
 * Akcesoria postaci (plecak, torba, telefon): zaokrąglone pudełka przypięte sztywno do kości i scalone z siatką wariantu,
 * więc 0 dodatkowych draw calls. Geometria wariantu z akcesorium jest budowana przy pierwszym użyciu i współdzielona przez
 * wszystkie postacie o tym samym wariancie i akcesorium.
 */

interface Parts { position: number[]; normal: number[]; index: number[]; skinIndex: number[]; skinWeight: number[]; region: number[] }
export type Side = 'l' | 'r';

/** Dokłada zaokrąglone pudełko (w układzie `frame`, czyli przestrzeni bind kości) przypięte do kości z wagą 1. */
function addBox(out: Parts, bone: number, frame: Matrix4, size: Vector3, at: Vector3, region: number): void {
  const g = new RoundedBoxGeometry(size.x, size.y, size.z, 1, Math.min(BEVEL.small * 2, 0.4 * Math.min(size.x, size.y, size.z)));
  g.translate(at.x, at.y, at.z).applyMatrix4(frame);
  const base = out.position.length / 3;
  out.position.push(...g.getAttribute('position').array);
  out.normal.push(...g.getAttribute('normal').array);
  const n = g.getAttribute('position').count;
  const idx = g.index;
  for (let i = 0, count = idx ? idx.count : n; i < count; i++) out.index.push(base + (idx ? idx.getX(i) : i));
  for (let i = 0; i < n; i++) {
    out.skinIndex.push(bone, 0, 0, 0);
    out.skinWeight.push(1, 0, 0, 0);
    out.region.push(region);
  }
  g.dispose();
}

/**
 * Plecak (na plecach, układ świata w pozie bind), torba (wisi na dłoni) albo telefon (w dłoni). Dłonie są powiększone o
 * `handScale`, więc przedmioty w układzie dłoni są pomniejszone o tyle samo. Kolory z regionów `accent` i `accent2` palety postaci.
 */
function accessoryParts(kind: Exclude<Appearance['accessory'], 'none'>, v: Variant, side: Side): Parts | null {
  const out: Parts = { position: [], normal: [], index: [], skinIndex: [], skinWeight: [], region: [] };
  const world = (bone: number): Matrix4 => v.rig.boneInverses[bone].clone().invert();
  if (kind === 'backpack') {
    if (v.chest < 0) return null;
    const frame = new Matrix4().makeTranslation(new Vector3().setFromMatrixPosition(world(v.chest)));
    addBox(out, v.chest, frame, new Vector3(0.32, 0.38, 0.15), new Vector3(0, -0.04, -0.19), REGION.accent);
    addBox(out, v.chest, frame, new Vector3(0.22, 0.14, 0.06), new Vector3(0, -0.14, -0.29), REGION.accent2);
    return out;
  }
  const bone = v.hands[side];
  if (bone < 0) return null;
  const k = 1 / CHARACTER_STYLE.handScale;
  const frame = world(bone).multiply(new Matrix4().makeScale(k, k, k));
  if (kind === 'bag') {
    addBox(out, bone, frame, new Vector3(0.1, 0.27, 0.22), new Vector3(0, 0.23, 0), REGION.accent);
    addBox(out, bone, frame, new Vector3(0.11, 0.07, 0.23), new Vector3(0, 0.3, 0), REGION.accent2);
    addBox(out, bone, frame, new Vector3(0.03, 0.1, 0.03), new Vector3(0, 0.12, 0), REGION.accent2);
  } else {
    addBox(out, bone, frame, new Vector3(0.02, 0.17, 0.09), new Vector3(0.03, 0.1, 0), REGION.accent);
  }
  return out;
}

/** Geometria wariantu z akcesorium (albo bez), z cache: wspólna dla wszystkich postaci o tym samym wariancie i akcesorium. */
export function variantGeometry(v: Variant, kind: Appearance['accessory'], side: Side): BufferGeometry {
  const key = kind === 'none' || kind === 'backpack' ? kind : `${kind}:${side}`;
  const hit = v.geometries.get(key);
  if (hit) return hit;
  const { shared } = v;
  const extra = kind === 'none' ? null : accessoryParts(kind, v, side);
  const cat = <T extends Float32Array | Uint16Array>(base: T, more: ArrayLike<number> | undefined): T => {
    if (!more) return base;
    const out = new (base.constructor as new (n: number) => T)(base.length + more.length);
    out.set(base);
    out.set(more, base.length);
    return out;
  };
  const n = shared.count + (extra ? extra.region.length : 0);
  const index = new (n > 65535 ? Uint32Array : Uint16Array)(shared.index.length + (extra ? extra.index.length : 0));
  index.set(shared.index);
  if (extra) index.set(extra.index.map((i) => i + shared.count), shared.index.length);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(cat(shared.position, extra?.position), 3));
  geometry.setAttribute('normal', new BufferAttribute(cat(shared.normal, extra?.normal), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(cat(shared.skinIndex, extra?.skinIndex), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(cat(shared.skinWeight, extra?.skinWeight), 4));
  geometry.setAttribute('region', new BufferAttribute(cat(shared.region, extra?.region), 1));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere(); // z pozy bind (T-pose): obejmuje postać w każdej animacji
  v.geometries.set(key, geometry);
  return geometry;
}

/** Zwalnia geometrie wariantu z pamięci GPU i opróżnia cache (następne `variantGeometry` zbuduje je od nowa). */
export function disposeVariantGeometries(v: Variant): void {
  for (const geometry of v.geometries.values()) geometry.dispose();
  v.geometries.clear();
}

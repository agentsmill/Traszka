import type { Vector3 } from 'three';
import type { PalletRef } from '@/render/staff/types';
import type { EconomyState } from '@/sim/economy/economy';
import { palletPlace, spotCells, type StoreInfo } from '@/sim/economy/storeInfo';
import type { Cell } from '@/sim/grid';
import type { WorldMarker } from '@/ui/worldOverlay';

/**
 * Palety z niezerowym towarem, z kwadratami z `info.spots` przez `palletPlace` (palety bez znanego miejsca pomijamy). Palety z różnych
 * pięter stosu w przejściach mają ten sam kwadrat. Tylko odczyt.
 */
export function palletRefsOf(s: EconomyState, info: StoreInfo): PalletRef[] {
  const out: PalletRef[] = [];
  for (const p of s.pallets) {
    if (p.total <= 0) continue;
    const at = palletPlace(info, p.loc, p.spot);
    // kopia, żeby widok nie miał w ręku obiektu, który należy do informacji o sklepie
    if (at) out.push({ loc: p.loc, spot: { ...at.spot }, since: p.since });
  }
  return out;
}

/**
 * Kratki, które palety zagradzają tłumowi: chodnik, sala i przejścia (zaplecze to nie sala). Piętra stosu w przejściach stoją na tym
 * samym kwadracie, więc każda kratka jest raz. Tylko odczyt.
 */
export function crowdObstaclesOf(s: EconomyState, info: StoreInfo): Cell[] {
  const cells = new Map<string, Cell>();
  for (const p of s.pallets) {
    if (p.loc === 'backroom') continue;
    const at = palletPlace(info, p.loc, p.spot);
    if (!at) continue;
    for (const c of spotCells(at.spot)) cells.set(`${c.x},${c.y}`, c);
  }
  return [...cells.values()];
}

/** O ile (m) nad podstawą palety wisi jej znacznik. */
export const MARKER_LIFT = 1.45;

/**
 * Znaczniki nad paletami w świecie: złota (premia ✨), stojąca pod sklepem ponad godzinę (⚠️, ryzyko mandatu) i stojąca w przejściach
 * (⚠️ `clutter`, zagracenie: klienci się potykają). Stos w przejściach dostaje jeden znacznik nad najwyższą paletą, żeby nie było ich
 * kilkudziesięciu na jednym kwadracie. `positionOf` daje środek podstawy palety w świecie (kopię, którą wolno przesunąć) albo null.
 */
export function palletMarkersOf(s: EconomyState, info: StoreInfo, positionOf: (id: number) => Vector3 | null): WorldMarker[] {
  const marks: WorldMarker[] = [];
  const aisleTops = new Map<string, Vector3>();
  for (const p of s.pallets) {
    const at = positionOf(p.id);
    if (!at) continue;
    if (p.loc === 'aisle' && !p.golden) {
      const square = palletPlace(info, p.loc, p.spot)?.spot;
      if (!square) continue;
      const key = `${square.x},${square.y}`;
      const top = aisleTops.get(key);
      if (!top || at.y > top.y) aisleTops.set(key, at);
      continue;
    }
    at.y += MARKER_LIFT;
    if (p.golden) marks.push({ key: `g${p.id}`, world: at, text: '✨', kind: 'golden' });
    else if (p.loc === 'sidewalk' && s.minute - p.since >= 60) marks.push({ key: `r${p.id}`, world: at, text: '⚠️', kind: 'risk' });
  }
  for (const [square, world] of aisleTops) {
    world.y += MARKER_LIFT;
    marks.push({ key: `a${square}`, world, text: '⚠️', kind: 'clutter' });
  }
  return marks;
}

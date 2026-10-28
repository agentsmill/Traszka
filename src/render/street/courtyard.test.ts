import { describe, expect, it } from 'vitest';
import { createRng } from '@/sim/rng';
import { GeomBuilder } from './buildings';
import { COURT_DEPTH, buildCourtyard } from './courtyard';

describe('buildCourtyard', () => {
  for (const [label, avoid] of [['bez przecznicy', null], ['z przecznicą', [6, 14.6]]] as const) {
    it(`${label}: nic nie zasłania sklepu przy kamerze od podwórka (h ≤ d), nic przed tylną ścianą ani na przecznicy`, () => {
      for (const seed of ['a', 'b', 'c', 'kiełbasa-42']) {
        const b = new GeomBuilder([0.5, 0.5]);
        const z0 = 6;
        buildCourtyard(b, { x0: -18, x1: 22, z: z0, avoid: avoid ? [avoid[0], avoid[1]] : null }, createRng(seed));
        const p = b.toGeometry().attributes.position!;
        expect(p.count).toBeGreaterThan(1000);
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          // izometria: promień do kamery wznosi się o tyle, ile przebiega w z; 0,25 m zapasu na fazę i obrzeża
          expect(y, `${seed} wierzchołek ${i} (z − z0 = ${(z - z0).toFixed(2)})`).toBeLessThanOrEqual(Math.max(0.1, z - z0) + 0.25);
          expect(z).toBeGreaterThanOrEqual(z0 - 0.05);
          expect(z).toBeLessThanOrEqual(z0 + COURT_DEPTH + 0.2);
          if (avoid) expect(x > avoid[0] + 0.05 && x < avoid[1] - 0.05, `${seed} x=${x} na przecznicy`).toBe(false);
        }
      }
    }, 30_000);   // kilkaset tysięcy asercji: ~2 s na wolnym rdzeniu, a przy obciążonej maszynie przekraczało domyślne 5 s
  }
});

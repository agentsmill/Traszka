import { describe, expect, it } from 'vitest';
import { STAFF_WALK_SPEED } from '@/render/staff/walker';
import { CELL_SIZE_M } from '@/sim/grid';
import { BACKROOM_LEAF } from './fixtures/backroomDoor';
import { DOOR_CLOSE_S, DOOR_HOLD_S, DOOR_OPEN_ANGLE, DOOR_OPEN_S, DOOR_REACH, DoorSwing, doorGap, nearestMover } from './doorSwing';

// Drzwi jak z generatora: 2 kratki szerokości (1 m) w ścianie działowej, 1 kratka głębokości; zaplecze to większe y.
const DOOR = { x: 4, y: 10, w: 2, d: 1 };
const FRAME = 1 / 60;
const person = (x: number, y: number, moving = true): { walker: { x: number; y: number; moving: boolean } } => ({ walker: { x, y, moving } });

/** Zawias i długość skrzydła w kratkach (backroomDoor.ts podaje metry od lewego-przedniego rogu drzwi). */
const HINGE = { x: DOOR.x + BACKROOM_LEAF.hingeX / CELL_SIZE_M, y: DOOR.y + BACKROOM_LEAF.hingeZ / CELL_SIZE_M };
const LEAF_LEN = BACKROOM_LEAF.length / CELL_SIZE_M;
/** Pół szerokości tułowia postaci w kratkach (0,15 m): bliżej skrzydło już przechodzi przez ciało. */
const BODY_R = 0.3;

/** Odległość (kratki) punktu od skrzydła otwartego o `angle`: odcinek od zawiasu, przy 0 wzdłuż +x, otwarty w +y (na zaplecze). */
function leafDistance(angle: number, px: number, py: number): number {
  const dx = Math.cos(angle) * LEAF_LEN;
  const dy = Math.sin(angle) * LEAF_LEN;
  const t = Math.max(0, Math.min(1, ((px - HINGE.x) * dx + (py - HINGE.y) * dy) / (LEAF_LEN * LEAF_LEN)));
  return Math.hypot(px - (HINGE.x + t * dx), py - (HINGE.y + t * dy));
}

/** Przemarsz na wprost przez kolumnę `x` z `fromY` do `toY` tempem załogi; najmniejszy odstęp ciała od skrzydła po drodze. */
function walkThrough(x: number, fromY: number, toY: number): number {
  const swing = new DoorSwing();
  const dir = Math.sign(toY - fromY);
  let closest = Infinity;
  for (let y = fromY; (toY - y) * dir > 0; y += dir * STAFF_WALK_SPEED * FRAME) {
    // jak w scenie: najpierw krok załogi, potem drzwi z jej nowymi pozycjami
    const angle = swing.step(nearestMover(DOOR, [person(x, y)]), FRAME);
    closest = Math.min(closest, leafDistance(angle, x, y));
  }
  return closest;
}

describe('doorGap', () => {
  it('0 w kratkach drzwi i na ich brzegu, poza nimi odległość od najbliższego brzegu (kratki)', () => {
    expect(doorGap(DOOR, 5, 10.5)).toBe(0);
    expect(doorGap(DOOR, 6, 11)).toBe(0);
    expect(doorGap(DOOR, 5, 8.5)).toBe(1.5);       // z sali, na wprost
    expect(doorGap(DOOR, 5.5, 13)).toBe(2);        // z zaplecza, na wprost
    expect(doorGap(DOOR, 7, 12)).toBeCloseTo(Math.SQRT2, 9);   // po skosie od rogu
  });
});

describe('nearestMover', () => {
  it('liczy idących z obu stron drzwi; nikogo albo same stojące obok: Infinity', () => {
    expect(nearestMover(DOOR, [])).toBe(Infinity);
    expect(nearestMover(DOOR, [person(5, 7.5), person(5.5, 12.5)])).toBe(1.5);
    // bezczynni na zapleczu stoją 2 kratki (manhattan) od drzwi, tuż za ścianą obok przejścia: drzwi przez nich nie stoją otworem
    expect(nearestMover(DOOR, [person(3.5, 11.5, false), person(6.5, 11.5, false), person(4.5, 12.5, false)])).toBe(Infinity);
  });

  it('stojący w przejściu albo w rzędzie tuż za nim (tam zamiata skrzydło) trzyma drzwi otwarte', () => {
    expect(nearestMover(DOOR, [person(4.5, 10.5, false)])).toBe(0);
    expect(nearestMover(DOOR, [person(5.5, 11.5, false)])).toBe(0.5);
  });
});

describe('DoorSwing', () => {
  it('bez nikogo w zasięgu drzwi stoją zamknięte (kąt 0)', () => {
    const swing = new DoorSwing();
    for (let i = 0; i < 120; i++) expect(swing.step(Infinity, FRAME)).toBe(0);
    expect(swing.step(DOOR_REACH + 0.01, FRAME)).toBe(0);
  });

  it(`otwiera się płynnie do ${Math.round((DOOR_OPEN_ANGLE * 180) / Math.PI)}° w ${DOOR_OPEN_S} s i dalej nie idzie`, () => {
    const swing = new DoorSwing();
    let last = 0;
    for (let t = FRAME; t < DOOR_OPEN_S - 1e-9; t += FRAME) {
      const angle = swing.step(DOOR_REACH, FRAME);
      expect(angle).toBeGreaterThan(last);
      expect(angle).toBeLessThan(DOOR_OPEN_ANGLE);
      last = angle;
    }
    expect(swing.step(DOOR_REACH, FRAME)).toBeCloseTo(DOOR_OPEN_ANGLE, 9);
    expect(swing.step(0, 10)).toBe(DOOR_OPEN_ANGLE);
  });

  it(`po wyjściu ostatniej postaci czeka ${DOOR_HOLD_S} s, potem zamyka się w ${DOOR_CLOSE_S} s`, () => {
    const swing = new DoorSwing();
    swing.step(0, 1);
    const angles: number[] = [];
    do angles.push(swing.step(Infinity, FRAME)); while (angles.at(-1)! > 0 && angles.length < 600);
    for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeLessThanOrEqual(angles[i - 1]!);
    expect(angles.at(-1)).toBe(0);
    expect(angles.filter((a) => a === DOOR_OPEN_ANGLE).length * FRAME).toBeCloseTo(DOOR_HOLD_S, 1);
    expect(angles.filter((a) => a < DOOR_OPEN_ANGLE).length * FRAME).toBeCloseTo(DOOR_CLOSE_S, 1);
    // ktoś wraca w czasie zamykania: drzwi znów się otwierają od miejsca, w którym są
    swing.step(0, 1);
    for (let i = 0; i < 40; i++) swing.step(Infinity, FRAME);
    const half = swing.step(Infinity, 0);
    expect(half).toBeGreaterThan(0);
    expect(swing.step(0, FRAME)).toBeGreaterThan(half);
  });

  it('pauza (dt 0) zatrzymuje skrzydło, a dt ujemne albo NaN nic nie psują', () => {
    const swing = new DoorSwing();
    const mid = swing.step(0, DOOR_OPEN_S / 2);
    expect(swing.step(0, 0)).toBe(mid);
    expect(swing.step(Infinity, 0)).toBe(mid);
    for (const dt of [-1, Number.NaN, Infinity]) {
      const angle = swing.step(Number.NaN, dt);
      expect(Number.isFinite(angle)).toBe(true);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThanOrEqual(DOOR_OPEN_ANGLE);
    }
  });

  // Obie kolumny drzwi (przy zawiasie i przy klamce), w obie strony: skrzydło nigdy nie przechodzi przez idącego.
  it.each([
    ['z sali na zaplecze, kolumną przy zawiasie', DOOR.x + 0.5, DOOR.y - 6, DOOR.y + 6],
    ['z sali na zaplecze, kolumną przy klamce', DOOR.x + 1.5, DOOR.y - 6, DOOR.y + 6],
    ['z zaplecza na salę, kolumną przy zawiasie', DOOR.x + 0.5, DOOR.y + 6, DOOR.y - 6],
    ['z zaplecza na salę, kolumną przy klamce', DOOR.x + 1.5, DOOR.y + 6, DOOR.y - 6],
  ])('%s: skrzydło nie wchodzi w postać idącą tempem załogi', (_, x, fromY, toY) => {
    expect(walkThrough(x, fromY, toY)).toBeGreaterThanOrEqual(BODY_R);
  });

  it('otwarte do końca odchodzi od barków idącego kolumną przy zawiasie, zamiast stać przy nich na całej głębokości', () => {
    for (let y = HINGE.y + 1; y <= HINGE.y + LEAF_LEN; y += 0.25) {
      expect(leafDistance(DOOR_OPEN_ANGLE, DOOR.x + 0.5, y)).toBeGreaterThanOrEqual(0.4);   // pół szerokości barków: 0,2 m
    }
  });

  it('otwarte do końca nie sięga kratek obok przejścia, na których stoją bezczynni z zaplecza', () => {
    for (const [x, y] of [[DOOR.x - 1, DOOR.y + 1], [DOOR.x + DOOR.w, DOOR.y + 1], [DOOR.x, DOOR.y + 2], [DOOR.x + 1, DOOR.y + 2]] as const) {
      expect(leafDistance(DOOR_OPEN_ANGLE, x + 0.5, y + 0.5), `kratka ${x},${y}`).toBeGreaterThanOrEqual(BODY_R);
    }
  });
});

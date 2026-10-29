import { Group } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CELL_SIZE_M } from '@/sim/grid';
import { IDLE_DELAY_S } from '@/render/crowdView';
import type { CharacterInstance } from './characterFactory';
import { Gait } from './gait';
import { WALK_TIME_SCALE_RANGE, walkTimeScale } from './walkSpeed';

const FOOT_MPS = 1.15;
const SPEED_CELLS = 2.6;          // tempo marszu pracownika (kratek/s)
const SCALE_Z = 0.9 * 1.2;        // wzrost 0,9 × tusza 1,2, jak w fabryce-atrapie kasjera

/** Postać-atrapa: liczy się to, jakie klipy wybrano i z jakim czasem wołano `update`. */
function fakeCharacter(scaleZ = SCALE_Z) {
  const object = new Group();
  object.scale.set(scaleZ, 0.9, scaleZ);
  const setAnim = vi.fn();
  const update = vi.fn();
  const character: CharacterInstance = { object, outfit: 'men-suit', setAnim, update, dispose: vi.fn(), isFallback: false };
  return { character, setAnim, update };
}

describe('Gait: wybór klipu', () => {
  it('stoi w Idle: bez ruchu nigdy nie zmienia klipu (klip domyślny postaci to idle), a update idzie z animDt', () => {
    const { character, setAnim, update } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    for (let i = 0; i < 30; i++) gait.update(false, 0.05, 0.05);
    expect(setAnim).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(30);
    expect(update).toHaveBeenLastCalledWith(0.05);
  });

  it('idle -> walk od razu, w pierwszej klatce z ruchem, i tylko raz', () => {
    const { character, setAnim } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    gait.update(false, 0.05, 0.05);
    expect(setAnim).not.toHaveBeenCalled();
    gait.update(true, 0.05, 0.05);
    expect(setAnim).toHaveBeenCalledTimes(1);
    expect(setAnim).toHaveBeenLastCalledWith('walk');
    for (let i = 0; i < 10; i++) gait.update(true, 0.05, 0.05);
    expect(setAnim).toHaveBeenCalledTimes(1);
  });

  it('walk -> idle dopiero po IDLE_DELAY_S bez ruchu (czas ramki, nie czas animacji), i tylko raz', () => {
    const { character, setAnim } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    gait.update(true, 0.05, 0.05);
    setAnim.mockClear();
    const frame = 0.05;
    let still = 0;
    while (still + frame < IDLE_DELAY_S - 1e-9) {
      gait.update(false, frame, frame);
      still += frame;
    }
    expect(setAnim).not.toHaveBeenCalled();                 // jeszcze chód: pojedynczy krok bez ruchu nie miga animacją
    gait.update(false, frame, frame);                       // przekroczony próg
    expect(setAnim).toHaveBeenCalledTimes(1);
    expect(setAnim).toHaveBeenLastCalledWith('idle');
    for (let i = 0; i < 10; i++) gait.update(false, frame, frame);
    expect(setAnim).toHaveBeenCalledTimes(1);               // postój nie powtarza zmiany klipu
  });

  it('postój liczy frameDt, a nie animDt: animDt = 0 nie wstrzymuje przejścia w Idle, a duży animDt przy frameDt = 0 go nie przyspiesza', () => {
    const { character, setAnim } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    gait.update(true, 0.05, 0.05);
    setAnim.mockClear();
    gait.update(false, 0, 10);                              // pauza gry: animDt nie liczy się do postoju
    expect(setAnim).not.toHaveBeenCalled();
    gait.update(false, IDLE_DELAY_S, 0);
    expect(setAnim).toHaveBeenLastCalledWith('idle');
  });

  it('ruch w trakcie opóźnienia zeruje postój: krótka przerwa w marszu nie przełącza w Idle', () => {
    const { character, setAnim } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    gait.update(true, 0.05, 0.05);
    setAnim.mockClear();
    for (let i = 0; i < 5; i++) {
      gait.update(false, IDLE_DELAY_S * 0.6, 0.05);          // za krótko, żeby przejść w Idle
      gait.update(true, 0.05, 0.05);                         // ruch zeruje licznik
    }
    expect(setAnim).not.toHaveBeenCalled();
  });

  it('po Idle znów ruszający chód wybiera walk, a potem znów Idle: cykl da się powtarzać', () => {
    const { character, setAnim } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    for (let cycle = 0; cycle < 3; cycle++) {
      gait.update(true, 0.05, 0.05);
      gait.update(false, IDLE_DELAY_S, 0.05);
    }
    expect(setAnim.mock.calls.map((c) => c[0])).toEqual(['walk', 'idle', 'walk', 'idle', 'walk', 'idle']);
  });
});

describe('Gait: tempo klipu i update', () => {
  it('w marszu update dostaje animDt × walkTimeScale(stopa, prędkość w m/s, skala z postaci), w postoju samo animDt', () => {
    const { character, update } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    const scale = walkTimeScale(FOOT_MPS, SPEED_CELLS * CELL_SIZE_M, SCALE_Z);
    expect(scale).toBeCloseTo((SPEED_CELLS * 0.5) / (FOOT_MPS * SCALE_Z), 12);   // 1,3 m/s przy stopie 1,15 m/s · 1,08
    expect(scale).toBeGreaterThan(WALK_TIME_SCALE_RANGE.min);
    expect(scale).toBeLessThan(WALK_TIME_SCALE_RANGE.max);

    gait.update(true, 0.04, 0.03);
    expect(update).toHaveBeenLastCalledWith(0.03 * scale);
    gait.update(true, 0.04, 0.06);
    expect(update).toHaveBeenLastCalledWith(0.06 * scale);
    // jeszcze w opóźnieniu postoju klip to chód, więc tempo też jest chodu (jak u tłumu)
    gait.update(false, IDLE_DELAY_S / 3, 0.03);
    expect(update).toHaveBeenLastCalledWith(0.03 * scale);
    gait.update(false, IDLE_DELAY_S, 0.03);                  // teraz Idle
    expect(update).toHaveBeenLastCalledWith(0.03);
  });

  it('tempo zależy od skali postaci (węższa idzie szybciej klipem) i jest ograniczone granicami walkTimeScale', () => {
    const slim = fakeCharacter(0.9);
    const wide = fakeCharacter(1.2);
    new Gait(slim.character, FOOT_MPS, SPEED_CELLS).update(true, 0.05, 0.1);
    new Gait(wide.character, FOOT_MPS, SPEED_CELLS).update(true, 0.05, 0.1);
    const slimDt = slim.update.mock.calls[0]![0] as number;
    const wideDt = wide.update.mock.calls[0]![0] as number;
    expect(slimDt).toBeGreaterThan(wideDt);
    expect(slimDt).toBeCloseTo(0.1 * walkTimeScale(FOOT_MPS, SPEED_CELLS * CELL_SIZE_M, 0.9), 12);
    expect(wideDt).toBeCloseTo(0.1 * walkTimeScale(FOOT_MPS, SPEED_CELLS * CELL_SIZE_M, 1.2), 12);

    const fast = fakeCharacter();
    new Gait(fast.character, FOOT_MPS, 100).update(true, 0.05, 0.1);      // absurdalnie szybki marsz: sufit mnożnika
    expect(fast.update).toHaveBeenLastCalledWith(0.1 * WALK_TIME_SCALE_RANGE.max);
    const slow = fakeCharacter();
    new Gait(slow.character, FOOT_MPS, 0.01).update(true, 0.05, 0.1);     // prawie stoi: podłoga mnożnika
    expect(slow.update).toHaveBeenLastCalledWith(0.1 * WALK_TIME_SCALE_RANGE.min);
  });

  it('update woła character.update w każdej klatce: w Idle, w marszu i przy pauzie (czas 0)', () => {
    const { character, update } = fakeCharacter();
    const gait = new Gait(character, FOOT_MPS, SPEED_CELLS);
    gait.update(false, 0.05, 0.05);
    gait.update(true, 0.05, 0.05);
    gait.update(true, 0, 0);
    gait.update(false, 0, 0);
    gait.update(false, 0.5, 0.05);
    expect(update).toHaveBeenCalledTimes(5);
    expect(update.mock.calls[2]).toEqual([0]);
    expect(update.mock.calls[3]).toEqual([0]);
  });

  it('IDLE_DELAY_S to ułamek sekundy (kilka klatek), wspólny z tłumem', () => {
    expect(IDLE_DELAY_S).toBeGreaterThan(0);
    expect(IDLE_DELAY_S).toBeLessThan(0.5);
  });
});

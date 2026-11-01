import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraRig } from '@/render/cameraRig';
import { PIN_COLOR, pinStyle, screenPosition } from './cityPins';

describe('screenPosition: rzut punktu sceny na ekran w pikselach', () => {
  const rig = new CameraRig(800 / 600);

  it('cel kamery leży na środku ekranu', () => {
    const p = screenPosition(new Vector3(0, 0, 0), rig.camera, 800, 600);
    expect(p.x).toBeCloseTo(400, 3);
    expect(p.y).toBeCloseTo(300, 3);
    expect(p.onScreen).toBe(true);
  });

  it('wyżej w scenie to wyżej na ekranie (mniejsze y), a punkt daleko od celu wypada poza ekran', () => {
    const base = screenPosition(new Vector3(0, 0, 0), rig.camera, 800, 600);
    const up = screenPosition(new Vector3(0, 1, 0), rig.camera, 800, 600);
    expect(up.y).toBeLessThan(base.y);
    expect(up.x).toBeCloseTo(base.x, 3);
    expect(screenPosition(new Vector3(500, 0, 500), rig.camera, 800, 600).onScreen).toBe(false);
  });
});

describe('pinStyle: wygląd pinezki wg rodzaju', () => {
  it('własny sklep zielony, Szop pomarańczowy, Kawka fioletowa, każdy inny', () => {
    expect(new Set([PIN_COLOR.twoj, PIN_COLOR.szop, PIN_COLOR.kawka]).size).toBe(3);
    expect(PIN_COLOR.twoj).toBe('#2faa4f');
    expect(PIN_COLOR.szop).toBe('#ff8a1f');
  });

  it('wolny lokal i „po Traszce” to kartka, budowa to rusztowanie, reszta to kropka', () => {
    expect(pinStyle('wolny').art).toBe('kartka');
    expect(pinStyle('po-traszce').art).toBe('kartka');
    expect(pinStyle('budowa').art).toBe('rusztowanie');
    for (const k of ['twoj', 'szop', 'kawka'] as const) expect(pinStyle(k).art).toBe('kropka');
  });

  it('dopisek na kartce ma tylko lokal „po Traszce”; przy wolnym numer idzie w etykiecie', () => {
    expect(pinStyle('po-traszce').note).toBe('po Traszce');
    expect(pinStyle('wolny').note).toBeNull();
  });
});

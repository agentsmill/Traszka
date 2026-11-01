import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { CameraRig } from '@/render/cameraRig';
import { createCityPins, PIN_COLOR, pinStyle, screenPosition } from './cityPins';

/** Element DOM tylko tyle, ile trzeba `createCityPins` (w node nie ma przeglądarki, a jsdom w projekcie nie ma). */
class FakeElement {
  children: FakeElement[] = [];
  className = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> & { setProperty?: () => void } = {};
  hidden = false;
  textContent = '';
  type = '';
  private attrs = new Map<string, string>();
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  addEventListener(): void {}
  removeEventListener(): void {}
  remove(): void {}
  getContext(): null { return null; }   // płótno kartki bez kontekstu: rysowanie się pomija
}
const fakeDocument = { createElement: (tag: string) => new FakeElement(tag) };

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

  it('wolny lokal, lokal obok i „po Traszce” to kartka, budowa to rusztowanie, reszta to kropka', () => {
    expect(pinStyle('wolny').art).toBe('kartka');
    expect(pinStyle('obok').art).toBe('kartka');
    expect(pinStyle('po-traszce').art).toBe('kartka');
    expect(pinStyle('budowa').art).toBe('rusztowanie');
    for (const k of ['twoj', 'szop', 'kawka'] as const) expect(pinStyle(k).art).toBe('kropka');
  });

  it('dopisek na kartce ma tylko lokal „po Traszce”; przy wolnym numer idzie w etykiecie, a lokal obok nie ma dopisku', () => {
    expect(pinStyle('po-traszce').note).toBe('po Traszce');
    expect(pinStyle('wolny').note).toBeNull();
    expect(pinStyle('obok')).toEqual({ art: 'kartka', color: null, note: null });
  });
});

describe('createCityPins: pinezka lokalu obok leży pod innymi', () => {
  beforeEach(() => {
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('po update ma klasę tt-cpin-obok i zIndex 0, a zwykła wolna pinezka w tym samym punkcie leży wyżej (zIndex = y ekranu)', () => {
    const parent = new FakeElement('div');
    const pins = createCityPins(parent as unknown as HTMLElement);
    pins.set([
      { lotId: 1, kind: 'obok', label: 'lokal obok', world: new Vector3(0, 0, 0) },
      { lotId: 2, kind: 'wolny', label: '7', world: new Vector3(0, 0, 0) },
    ]);
    pins.update(new CameraRig(800 / 600).camera);
    const layer = parent.children[0]!;
    const byLot = (id: number): FakeElement => layer.children.find((c) => c.dataset.lot === String(id))!;
    expect(byLot(1).className).toContain('tt-cpin-obok');
    expect(byLot(1).style.zIndex).toBe('0');
    expect(Number(byLot(2).style.zIndex)).toBeGreaterThan(0);
  });
});

import { Vector3, type Camera } from 'three';
import { tr } from '@/i18n';
import { drawRentPoster } from '@/render/rentPoster';
import { PALETTE } from '@/render/style';

/**
 * Pinezki ekranu Miasta (spec §9.1, §19): elementy HTML przyklejone do punktów sceny, jak `ui/worldOverlay.ts`, ale do stukania.
 * Własny sklep jest zielony, Szop pomarańczowy, Kawka fioletowa; wolny lokal to kartka „DO WYNAJĘCIA” (ta sama funkcja co w witrynie
 * ulicy, `drawRentPoster`), budowa to rusztowanie, lokal po Traszce to ta sama kartka z dopiskiem „po Traszce”. Napisy z `label` składa
 * UI (numer lokalu, adres, licznik dni budowy z odmianą) i pinezka pokazuje je jak są; scena sama mówi tylko to, co na kartce.
 * Kotwice (`CityView.pinAnchors`) i stany lokali dostaje ten, kto zna firmę; render jej nie importuje.
 */

export type CityPinKind = 'twoj' | 'szop' | 'kawka' | 'wolny' | 'budowa' | 'po-traszce';
export interface CityPin { lotId: number; kind: CityPinKind; label: string; world: Vector3 }

export interface CityPins {
  /** Lista zastępuje poprzednią; pinezka o tym samym lokalu i rodzaju zostaje w DOM (zmienia się tylko napis i położenie). */
  set(pins: CityPin[]): void;
  /** Ustawia pinezki na ekranie wg kamery; co klatkę, dopóki miasto jest na ekranie. */
  update(camera: Camera): void;
  /** Stuknięcie w pinezkę: numer lokalu. Kolejne wywołanie zastępuje poprzednie. */
  onTap(cb: (lotId: number) => void): void;
  dispose(): void;
}

/** Kolory kropek: własny sklep, Szop 24h, Kawka Express. */
export const PIN_COLOR: Readonly<Record<'twoj' | 'szop' | 'kawka', string>> = {
  twoj: PALETTE.brand.green,
  szop: PALETTE.brand.orange,
  kawka: PALETTE.clothes[6]!,
};

export interface PinStyle {
  /** Kropka (sklepy), kartka „DO WYNAJĘCIA” albo rusztowanie. */
  art: 'kropka' | 'kartka' | 'rusztowanie';
  /** Kolor kropki; null dla kartki (ma własne). */
  color: string | null;
  /** Dopisek pod napisem kartki w języku gracza; null bez dopisku. */
  note: string | null;
}

export function pinStyle(kind: CityPinKind): PinStyle {
  switch (kind) {
    case 'twoj':
    case 'szop':
    case 'kawka':
      return { art: 'kropka', color: PIN_COLOR[kind], note: null };
    case 'wolny':
      return { art: 'kartka', color: null, note: null };
    case 'po-traszce':
      return { art: 'kartka', color: null, note: tr('po Traszce') };
    case 'budowa':
      return { art: 'rusztowanie', color: PALETTE.brand.orange, note: null };
  }
}

// --- Położenie na ekranie -----------------------------------------------------------------------------------------

/** Pinezka tuż za brzegiem ekranu jeszcze się liczy (ma swoją wielkość). */
const EDGE_PX = 80;
const scratch = new Vector3();

/** Punkt sceny na ekranie o rozmiarze `width` × `height` px (początek w lewym górnym rogu) i czy leży na nim, z marginesem na pinezkę. */
export function screenPosition(world: Vector3, camera: Camera, width: number, height: number): { x: number; y: number; onScreen: boolean } {
  scratch.copy(world).project(camera);
  const x = (scratch.x * 0.5 + 0.5) * width;
  const y = (-scratch.y * 0.5 + 0.5) * height;
  const onScreen = scratch.z >= -1 && scratch.z <= 1 && x >= -EDGE_PX && x <= width + EDGE_PX && y >= -EDGE_PX && y <= height + EDGE_PX;
  return { x, y, onScreen };
}

// --- Rysunki ------------------------------------------------------------------------------------------------------

const POSTER_PX = { w: 64, h: 52 } as const;
const SCAFFOLD_PX = { w: 40, h: 40 } as const;

/** Płótno z rozdzielczością ekranu (do 2×), rysowane w pikselach CSS. */
function paintedCanvas(w: number, h: number, className: string, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.className = className;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    draw(ctx);
  }
  return canvas;
}

/** Rusztowanie na jasnej tarczy: dwa słupki, trzy pomosty i krzyżulce. */
function drawScaffold(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = PALETTE.brand.cream;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  const line = (color: string, width: number, x0: number, y0: number, x1: number, y1: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0 * w, y0 * h);
    ctx.lineTo(x1 * w, y1 * h);
    ctx.stroke();
  };
  line(PALETTE.brand.orange, 2.2, 0.3, 0.76, 0.7, 0.3);   // krzyżulce
  line(PALETTE.brand.orange, 2.2, 0.3, 0.3, 0.7, 0.76);
  for (const x of [0.3, 0.7]) line(PALETTE.fixture.metal, 3, x, 0.18, x, 0.84);   // słupki
  for (const y of [0.3, 0.52, 0.76]) line(PALETTE.fixture.wood, 3.4, 0.2, y, 0.8, y);   // pomosty
}

// --- Nakładka -----------------------------------------------------------------------------------------------------

interface Entry {
  el: HTMLButtonElement;
  label: HTMLSpanElement;
  kind: CityPinKind;
  world: Vector3;
  visible: boolean;
  x: number;
  y: number;
}

function buildPin(pin: CityPin): Entry {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `tt-cpin tt-cpin-${pin.kind}`;
  el.dataset.lot = String(pin.lotId);
  const style = pinStyle(pin.kind);
  if (style.art === 'kropka') {
    const dot = document.createElement('span');
    dot.className = 'tt-cpin-dot';
    dot.style.setProperty('--pin', style.color!);
    el.appendChild(dot);
  } else if (style.art === 'kartka') {
    const { w, h } = POSTER_PX;
    // kartka mieści się w płótnie z miejscem u góry na taśmę, która wystaje nad jej krawędź
    el.appendChild(paintedCanvas(w, h, 'tt-cpin-art', (ctx) => drawRentPoster(ctx, 4, 9, w - 8, h - 12, style.note)));
  } else {
    const { w, h } = SCAFFOLD_PX;
    el.appendChild(paintedCanvas(w, h, 'tt-cpin-art', (ctx) => drawScaffold(ctx, w, h)));
  }
  const label = document.createElement('span');
  label.className = 'tt-cpin-label';
  el.appendChild(label);
  return { el, label, kind: pin.kind, world: new Vector3(), visible: true, x: NaN, y: NaN };
}

export function createCityPins(parent: HTMLElement): CityPins {
  const layer = document.createElement('div');
  layer.className = 'tt-world tt-cpins';
  parent.appendChild(layer);
  const entries = new Map<number, Entry>();
  let tap: ((lotId: number) => void) | null = null;

  const onClick = (e: Event): void => {
    const target = e.target as Element | null;
    const el = target?.closest<HTMLElement>('[data-lot]');
    if (el && tap) tap(Number(el.dataset.lot));
  };
  layer.addEventListener('click', onClick);

  return {
    set(pins) {
      const keep = new Set(pins.map((p) => p.lotId));
      for (const [id, e] of entries) if (!keep.has(id)) { e.el.remove(); entries.delete(id); }
      for (const pin of pins) {
        let e = entries.get(pin.lotId);
        if (e && e.kind !== pin.kind) { e.el.remove(); e = undefined; }
        if (!e) {
          e = buildPin(pin);
          entries.set(pin.lotId, e);
          layer.appendChild(e.el);
        }
        e.world.copy(pin.world);
        const shown = tr(pin.label);   // napis składa UI; tr() przepuszcza gotowy tekst bez zmian
        if (e.label.textContent !== shown) e.label.textContent = shown;
        e.label.hidden = shown === '';
        e.el.setAttribute('aria-label', shown);
      }
    },
    update(camera) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const e of entries.values()) {
        const p = screenPosition(e.world, camera, w, h);
        if (p.onScreen !== e.visible) {
          e.visible = p.onScreen;
          e.el.style.display = p.onScreen ? '' : 'none';
        }
        if (!p.onScreen) continue;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x === e.x && y === e.y) continue;
        e.x = x;
        e.y = y;
        e.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        e.el.style.zIndex = String(y);   // niżej na ekranie to bliżej kamery: przykrywa pinezki za sobą
      }
    },
    onTap(cb) {
      tap = cb;
    },
    dispose() {
      layer.removeEventListener('click', onClick);
      layer.remove();
      entries.clear();
      tap = null;
    },
  };
}

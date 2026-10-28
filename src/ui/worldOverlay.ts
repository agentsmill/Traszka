import { Vector3, type Camera } from 'three';

/**
 * Elementy HTML przyklejone do punktów sceny: dymek kolejki nad kasą i „latające” liczby po stuknięciu. Poza Preactem,
 * bo pozycja zmienia się co klatkę.
 */
export interface WorldOverlay {
  /** Dymek nad kasą: tekst i stan (`warn` gdy kolejka odstrasza klientów). `null` chowa. */
  setTill(world: Vector3 | null, text: string, warn: boolean): void;
  /** Liczba wylatująca z punktu ekranu (px). */
  floater(x: number, y: number, text: string, kind?: 'money' | 'work' | 'bad'): void;
  update(camera: Camera): void;
  dispose(): void;
}

let floatLayer: HTMLElement | null = null;

/** Liczba wylatująca z punktu ekranu (px), np. „+8 szt.” po stuknięciu w paletę. */
export function floatText(x: number, y: number, text: string, kind: 'money' | 'work' | 'bad' = 'money'): void {
  if (!floatLayer) {
    floatLayer = document.createElement('div');
    floatLayer.className = 'tt-world';
    document.body.appendChild(floatLayer);
  }
  const el = document.createElement('div');
  el.className = `tt-floater ${kind}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

export function createWorldOverlay(parent: HTMLElement): WorldOverlay {
  const layer = document.createElement('div');
  layer.className = 'tt-world';
  parent.appendChild(layer);
  const till = document.createElement('div');
  till.className = 'tt-bubble';
  till.style.display = 'none';
  layer.appendChild(till);
  let tillWorld: Vector3 | null = null;
  const v = new Vector3();

  return {
    setTill(world, text, warn) {
      tillWorld = world;
      till.style.display = world ? '' : 'none';
      if (till.textContent !== text) till.textContent = text;
      till.classList.toggle('warn', warn);
    },
    floater: floatText,
    update(camera) {
      if (!tillWorld) return;
      v.copy(tillWorld).project(camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      till.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    },
    dispose() {
      layer.remove();
    },
  };
}

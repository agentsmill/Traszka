import { Vector3, type Camera } from 'three';
import { tr } from '@/i18n';

/**
 * Elementy HTML przyklejone do punktów sceny: dymek kolejki nad kasą i „latające” liczby po stuknięciu. Poza Preactem,
 * bo pozycja zmienia się co klatkę.
 */
export interface WorldMarker { key: string; world: Vector3; text: string; kind: 'golden' | 'risk' | 'clutter' }

export interface WorldOverlay {
  /** Dymek nad kasą: tekst i stan (`warn` gdy kolejka odstrasza klientów). `null` chowa. */
  setTill(world: Vector3 | null, text: string, warn: boolean): void;
  /** Znaczniki nad paletami (złota, ryzyko mandatu, zagracenie przejść). Lista zastępuje poprzednią. */
  setMarkers(markers: WorldMarker[]): void;
  /** Dymek z wypowiedzią klienta nad punktem zwracanym przez `where` (np. pozycja agenta); znika po `ms`. */
  say(where: () => Vector3 | null, text: string, ms?: number): void;
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
  const markers = new Map<string, { el: HTMLElement; world: Vector3 }>();
  const speech: { el: HTMLElement; where: () => Vector3 | null; until: number }[] = [];
  const place = (el: HTMLElement, world: Vector3, camera: Camera): void => {
    v.copy(world).project(camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  };

  return {
    setTill(world, text, warn) {
      tillWorld = world;
      till.style.display = world ? '' : 'none';
      const shown = tr(text);   // „ZAMKNIĘTE”, „REMONT” w języku gracza; liczba kolejki i emoji bez zmian
      if (till.textContent !== shown) till.textContent = shown;
      till.classList.toggle('warn', warn);
    },
    floater: floatText,
    setMarkers(list) {
      const keep = new Set(list.map((m) => m.key));
      for (const [key, m] of markers) if (!keep.has(key)) { m.el.remove(); markers.delete(key); }
      for (const m of list) {
        let entry = markers.get(m.key);
        if (!entry) {
          const el = document.createElement('div');
          layer.appendChild(el);
          entry = { el, world: m.world };
          markers.set(m.key, entry);
        }
        entry.world = m.world;
        entry.el.className = `tt-marker ${m.kind}`;
        if (entry.el.textContent !== m.text) entry.el.textContent = m.text;
      }
    },
    say(where, text, ms = 2600) {
      if (speech.length >= 2) return;   // najwyżej dwa dymki naraz: ma być gwar, nie ściana tekstu
      const el = document.createElement('div');
      el.className = 'tt-speech';
      el.textContent = tr(text);   // dymki klientów (`LINES` w ui/game/lines.ts) w języku gracza
      layer.appendChild(el);
      speech.push({ el, where, until: performance.now() + ms });
    },
    update(camera) {
      if (tillWorld) place(till, tillWorld, camera);
      for (const m of markers.values()) place(m.el, m.world, camera);
      const now = performance.now();
      for (let i = speech.length - 1; i >= 0; i--) {
        const sp = speech[i]!;
        const w = sp.where();
        if (!w || now > sp.until) { sp.el.remove(); speech.splice(i, 1); continue; }
        place(sp.el, w, camera);
      }
    },
    dispose() {
      layer.remove();
    },
  };
}

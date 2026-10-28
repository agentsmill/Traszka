import { MathUtils } from 'three';
import { ISO_PITCH_DEG } from '@/render/cameraRig';
import type { RenderContext } from '@/render/renderer';
import type { QualityPresetId } from '@/render/quality';

/** Ile metrów na ekranie to jeden piksel (kamera ortograficzna: tyle samo w poziomie i w pionie). */
export const metersPerPixel = (ctx: RenderContext): number => ctx.rig.viewSize / Math.max(1, window.innerHeight);

/**
 * Przesuwa cel kamery tak, żeby punkt podłogi pod kursorem został pod kursorem po przeciągnięciu o (dx, dy) pikseli.
 * W prawo na ekranie to prostopadła do kierunku patrzenia, w górę ekranu to kierunek patrzenia na podłodze, którego
 * odcinek jest na ekranie skrócony o sin(nachylenie), więc pion przeliczamy z tym dzieleniem.
 */
export function dragPan(ctx: RenderContext, dx: number, dy: number): void {
  const yaw = MathUtils.degToRad(45 + 90 * ctx.rig.yawIndex);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);   // kierunek patrzenia na podłodze (x, z)
  const right = dx * metersPerPixel(ctx);
  const forward = (dy * metersPerPixel(ctx)) / Math.sin(MathUtils.degToRad(ISO_PITCH_DEG));
  ctx.rig.panBy(fz * right + fx * forward, -fx * right + fz * forward);
}

export interface Bindings {
  /** Klawisze sceny (np. N dzień/noc). Nadpisują domyślne, jeśli mają tę samą nazwę. */
  extra?: Record<string, () => void>;
  /** Zmiana presetu klawiszami 1/2/3. Gra przekazuje wersję, która od razu aktualizuje sygnał UI. */
  setPreset?: (id: QualityPresetId) => void;
  /** Stuknięcie (klik bez przeciągania) w scenę, współrzędne ekranu w px. */
  onTap?: (x: number, y: number) => void;
  /** Gdy zwraca true, klawisze nie działają (np. ekran startowy zasłania grę: spacja ma wciskać przycisk, a nie pauzować). */
  blocked?: () => boolean;
}

/** Klawisze nie działają, gdy gracz pisze w polu (np. seed), bo litery są wtedy tekstem, a nie poleceniem. */
export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement);

/** Przesunięcie (px), powyżej którego dotknięcie jest przeciąganiem, a nie stuknięciem. */
export const TAP_SLOP = 8;

/** Dłuższe przytrzymanie (ms) nie jest stuknięciem. */
export const TAP_MAX_MS = 600;

/**
 * Akcja przypisana do naciśniętego klawisza albo `undefined`, gdy klawisz nic nie robi: nieznany, z Ctrl/Cmd/Alt (np. Cmd+R to
 * przeładowanie strony, nie nowy seed), w polu tekstowym albo gdy `blocked` zwraca true. Dokładna nazwa klawisza ma
 * pierwszeństwo, potem jej wersja małymi literami (Shift i CapsLock dają `Q`, a akcja jest pod `q`).
 */
export function keyAction(
  keys: Record<string, () => void>,
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>,
  blocked?: () => boolean,
): (() => void) | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || blocked?.()) return undefined;
  return keys[e.key] ?? keys[e.key.toLowerCase()];
}

/**
 * Czy puszczenie palca (pointer `id` w punkcie `x`, `y` w chwili `now`) kończy stuknięcie zaczęte przez `tap`: ten sam palec,
 * ruch mniejszy niż `TAP_SLOP` i krócej niż `TAP_MAX_MS` od dotknięcia. `null` to brak zaczętego stuknięcia (przeciąganie,
 * drugi palec albo przycisk inny niż lewy).
 */
export function isTapRelease(tap: { id: number; x: number; y: number; t: number } | null, id: number, x: number, y: number, now: number): boolean {
  return tap !== null && tap.id === id && Math.hypot(x - tap.x, y - tap.y) < TAP_SLOP && now - tap.t < TAP_MAX_MS;
}

/**
 * Sterowanie wspólne dla scen: Q/E obrót, +/− zoom, strzałki pan, kółko myszy zoom, 1/2/3 preset jakości.
 * Mysz i dotyk na płótnie: przeciąganie (lewym albo prawym przyciskiem, jednym palcem) przesuwa widok, dwa palce
 * przybliżają (pinch), a krótkie stuknięcie bez ruchu woła `onTap`. `extra` dokłada klawisze sceny.
 */
export function bindControls(ctx: RenderContext, { extra = {}, setPreset = (id) => ctx.setPreset(id), onTap, blocked }: Bindings = {}): void {
  const keys: Record<string, () => void> = {
    q: () => ctx.rig.rotate(-1),
    e: () => ctx.rig.rotate(1),
    '+': () => ctx.rig.zoomBy(1.15),
    '=': () => ctx.rig.zoomBy(1.15),
    '-': () => ctx.rig.zoomBy(1 / 1.15),
    ArrowLeft: () => ctx.rig.panBy(-0.5, 0),
    ArrowRight: () => ctx.rig.panBy(0.5, 0),
    ArrowUp: () => ctx.rig.panBy(0, -0.5),
    ArrowDown: () => ctx.rig.panBy(0, 0.5),
    '1': () => setPreset('niska'),
    '2': () => setPreset('srednia'),
    '3': () => setPreset('wysoka'),
    ...extra,
  };
  window.addEventListener('keydown', (e) => {
    const action = keyAction(keys, e, blocked);
    if (!action) return;
    e.preventDefault();   // F3 nie otwiera wyszukiwania przeglądarki, strzałki nie przewijają strony
    action();
  });
  const canvas = ctx.renderer.domElement;
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); ctx.rig.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const pointers = new Map<number, { x: number; y: number }>();
  let tap: { id: number; x: number; y: number; t: number } | null = null;
  let pinch: number | null = null;   // odległość między palcami w poprzedniej klatce
  const mid = (): { x: number; y: number } => {
    const ps = [...pointers.values()];
    return { x: (ps[0]!.x + ps[1]!.x) / 2, y: (ps[0]!.y + ps[1]!.y) / 2 };
  };
  const spread = (): number => {
    const ps = [...pointers.values()];
    return Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y);
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap = pointers.size === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
    pinch = pointers.size === 2 ? spread() : null;
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 2) {
      const before = mid();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = mid();
      const d = spread();
      if (pinch && d > 0) ctx.rig.zoomBy(d / pinch);
      pinch = d;
      dragPan(ctx, after.x - before.x, after.y - before.y);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < TAP_SLOP) return;   // jeszcze stuknięcie
    tap = null;
    dragPan(ctx, e.clientX - prev.x, e.clientY - prev.y);
  });
  const end = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (e.type === 'pointerup' && isTapRelease(tap, e.pointerId, e.clientX, e.clientY, performance.now())) onTap?.(e.clientX, e.clientY);
    tap = null;
    pinch = pointers.size === 2 ? spread() : null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

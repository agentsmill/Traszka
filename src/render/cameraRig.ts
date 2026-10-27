import { MathUtils, OrthographicCamera, Vector3 } from 'three';

/** Kąt nachylenia kamery nad poziomem: arctan(1/√2), czyli klasyczna izometria. */
export const ISO_PITCH_DEG = 35.264;

export const VIEW_SIZE_MIN = 6;
export const VIEW_SIZE_MAX = 30;
export const VIEW_SIZE_DEFAULT = 14;
/** O ile metrów cel kamery może wyjść poza granice podane w `setBounds`. */
export const PAN_MARGIN_M = 4;

const CAMERA_DISTANCE_M = 60;
const NEAR = 0.1;
const FAR = 200;

export interface Frustum { left: number; right: number; top: number; bottom: number }

/** `viewSize` to wysokość widoku w metrach, szerokość wynika z proporcji ekranu. */
export function computeFrustum(aspect: number, viewSize: number): Frustum {
  const top = viewSize / 2;
  const right = top * aspect;
  return { left: -right, right, top, bottom: -top };
}

type YawIndex = 0 | 1 | 2 | 3;

/**
 * Kamera izometryczna (ortograficzna) wokół punktu na podłodze, w świecie z `cellToWorld`.
 *
 * Yaw to azymut kierunku patrzenia, liczony od +z w stronę +x: yaw = 45° + 90° · yawIndex. Kamera stoi po przeciwnej
 * stronie celu niż kierunek patrzenia, więc ściany sklepu bliższe kamerze to:
 *
 * | yawIndex | kamera nad rogiem | najbliższe ściany            |
 * |----------|-------------------|------------------------------|
 * | 0        | (−x, −z)          | frontowa (ulica) i lewa      |
 * | 1        | (−x, +z)          | tylna i lewa                 |
 * | 2        | (+x, +z)          | tylna i prawa                |
 * | 3        | (+x, −z)          | frontowa (ulica) i prawa     |
 *
 * Dzięki temu przy domyślnym słońcu (od ulicy) oświetlone ściany są widoczne, a cienie padają w głąb sklepu.
 */
export class CameraRig {
  readonly camera: OrthographicCamera;
  /** Punkt na podłodze (y = 0), na który patrzy kamera. */
  readonly target = new Vector3();

  private _yawIndex: YawIndex = 0;
  private _viewSize = VIEW_SIZE_DEFAULT;
  private aspect: number;
  private _bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(aspect: number) {
    this.aspect = aspect;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
    this.applyFrustum();
    this.applyPose();
  }

  get yawIndex(): YawIndex { return this._yawIndex; }
  set yawIndex(value: YawIndex) {
    if (value === this._yawIndex) return;
    this._yawIndex = value;
    this.applyPose();
    this.emit();
  }

  /** Wysokość widoku w metrach, w [6, 30]. */
  get viewSize(): number { return this._viewSize; }

  /** Granice podane w `setBounds` (bez marginesu) albo null, gdy nie ustawiono. */
  get bounds(): Readonly<{ minX: number; minZ: number; maxX: number; maxZ: number }> | null { return this._bounds; }

  /** +1 zwiększa yawIndex (kamera obiega cel w stronę kolejnego rogu z tabeli), −1 zmniejsza. */
  rotate(dir: 1 | -1): void {
    this.yawIndex = ((this._yawIndex + dir + 4) % 4) as YawIndex;
  }

  /** `factor` > 1 przybliża (widok się zmniejsza), < 1 oddala. Wynik zostaje w [6, 30]. */
  zoomBy(factor: number): void {
    const next = MathUtils.clamp(this._viewSize / factor, VIEW_SIZE_MIN, VIEW_SIZE_MAX);
    if (next === this._viewSize) return;
    this._viewSize = next;
    this.applyFrustum();
    this.emit();
  }

  /** Przesuwa cel o (dx, dz) metrów we współrzędnych świata, z uwzględnieniem granic. */
  panBy(dx: number, dz: number): void {
    if (this.moveTarget(this.target.x + dx, this.target.z + dz)) this.emit();
  }

  /** Ogranicza pan do prostokąta powiększonego o 4 m. Cel poza nim wraca na jego brzeg. */
  setBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const b = this._bounds;
    if (b && b.minX === minX && b.minZ === minZ && b.maxX === maxX && b.maxZ === maxZ) return;
    this._bounds = { minX, minZ, maxX, maxZ };
    this.moveTarget(this.target.x, this.target.z);
    this.emit();
  }

  resize(aspect: number): void {
    if (aspect === this.aspect) return;
    this.aspect = aspect;
    this.applyFrustum();
    this.emit();
  }

  /** Wywoływane po każdej zmianie (obrót, zoom, pan, granice, proporcje), np. żeby ściany mogły się obniżać. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private moveTarget(x: number, z: number): boolean {
    const b = this._bounds;
    if (b) {
      x = MathUtils.clamp(x, b.minX - PAN_MARGIN_M, b.maxX + PAN_MARGIN_M);
      z = MathUtils.clamp(z, b.minZ - PAN_MARGIN_M, b.maxZ + PAN_MARGIN_M);
    }
    if (x === this.target.x && z === this.target.z) return false;
    this.target.set(x, 0, z);
    this.applyPose();
    return true;
  }

  private applyFrustum(): void {
    Object.assign(this.camera, computeFrustum(this.aspect, this._viewSize));
    this.camera.updateProjectionMatrix();
  }

  private applyPose(): void {
    const yaw = MathUtils.degToRad(45 + 90 * this._yawIndex);
    const pitch = MathUtils.degToRad(ISO_PITCH_DEG);
    const horizontal = Math.cos(pitch) * CAMERA_DISTANCE_M;
    this.camera.position.set(
      this.target.x - Math.sin(yaw) * horizontal,
      Math.sin(pitch) * CAMERA_DISTANCE_M,
      this.target.z - Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb();
  }
}

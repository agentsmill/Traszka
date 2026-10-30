import { Group, Mesh, type BufferGeometry } from 'three';
import {
  BRAND, FIX, SCREEN_COLOR, box, cachedTexture, canvasTexture, cyl, matte, painted, plane, texturedMaterial,
} from '@/render/store/parts';
import { PALETTE } from '@/render/style';
import { bake } from './bake';

/**
 * Humanoid eDward: „złożony z odkurzacza, wycieraczek i starego laptopa” (opis ulepszenia w upgrades.ts). Korpus to odkurzacz
 * workowy na tarczy odkurzacza-robota, ramiona to wycieraczki z szyby, a głowa to stary laptop na szyi: ekran z buźką jest twarzą.
 * Proporcje trochę mniejsze od człowieka (1,4 m), żeby było go widać na tle załogi, ale nie wyglądał na dziecko.
 *
 * Koszt: pięć siatek (korpus, głowa, dwa ramiona i ekran z buźką), bo bryły są wypieczone w kolory wierzchołków (`bake`), a nie
 * szkieletowa postać z fabryki. Nie ma tekstur poza jedną buźką 256 × 128 (dwa wyrazy twarzy obok siebie, przełączane
 * przesunięciem tekstury, więc zmiana miny nic nie kosztuje). Wszystko stoi na podłodze w początku układu i patrzy w +z.
 */

/** Skala bryły: tarcza ma 0,26 m promienia, a całość 1,4 m wysokości przed skalą. */
const EDWARD_SCALE = 1.15;
/** Promień plamy cienia pod eDwardem (m): ciaśniejsza niż pod człowiekiem (plama człowieka ma 0,54 m). */
export const EDWARD_BLOB_RADIUS = 0.42;

const DARK = PALETTE.fixture.fridgeFrame;
const RUBBER = PALETTE.clothes[12]!;
const CREAM = BRAND.cream;

/** Pozycja zawiasu laptopa na tylnej krawędzi podstawy i jego odchylenie ekranu do tyłu. */
const HINGE_Z = -0.14;
const LID_TILT = -0.18;

/** Buźka: lewa połowa to „dzień dobry”, prawa to skupienie przy pracy. Rysowana raz i współdzielona (cache tekstur). */
function faceTexture() {
  return cachedTexture('edward-face', () => canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = SCREEN_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = BRAND.greenDark;
    ctx.fillStyle = BRAND.greenDark;
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    // uśmiech
    for (const x of [38, 90]) { ctx.beginPath(); ctx.arc(x, 48, 10, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.arc(64, 62, 28, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    // skupienie: oczy-kreski i prosta buzia
    ctx.beginPath(); ctx.moveTo(150, 46); ctx.lineTo(176, 46); ctx.moveTo(204, 46); ctx.lineTo(230, 46); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(172, 92); ctx.lineTo(208, 92); ctx.stroke();
  }, true));
}

/** Ramię-wycieraczka zawieszone w barku (początek układu): ramię z blachy i gumowe pióro na końcu. */
function buildWiper(owned: BufferGeometry[], name: string): Mesh {
  const parts = new Group();
  box(parts, [0.06, 0.06, 0.06], [0, -0.03, 0], painted(FIX.metal));
  box(parts, [0.04, 0.38, 0.03], [0, -0.38, 0], painted(FIX.metal));
  box(parts, [0.035, 0.34, 0.03], [0, -0.45, 0.04], matte(BRAND.greenDark));
  return bake(parts, owned, name, false);
}

export interface EdwardRig {
  readonly object: Group;
  /**
   * Jedna klatka. `dt`: czas animacji (s). `moving`: idzie. `working`: stoi przy swoim zadaniu i pracuje (wycieraczki szaleją,
   * głowa kiwa, buźka robi skupioną minę); bez pracy i ruchu stoi i się rozgląda.
   */
  update(dt: number, moving: boolean, working: boolean): void;
  /** Cień z mapy cieni (polityka jak u postaci, `QualitySettings.characterShadows`). */
  setCasting(on: boolean): void;
  dispose(): void;
}

export function createEdward(): EdwardRig {
  const owned: BufferGeometry[] = [];
  // `object` ustawia widok załogi (pozycja i obrót co klatkę), a podskoki jazdy idą na `rig` pod nim
  const object = new Group();
  object.name = 'eDward';
  const rig = new Group();
  rig.scale.setScalar(EDWARD_SCALE);   // przerysowany o 15%: przy domyślnym zbliżeniu ma być czytelny obok ludzi
  object.add(rig);

  // korpus: tarcza odkurzacza-robota z zderzakiem, workowy odkurzacz z zieloną opaską, szyja i wąż na plecach
  const body = new Group();
  cyl(body, 0.25, 0.09, [0, 0.045, 0], matte(DARK), { segs: 20 });
  cyl(body, 0.262, 0.03, [0, 0.05, 0], matte(BRAND.orange), { segs: 20 });
  cyl(body, 0.185, 0.55, [0, 0.365, 0], matte(CREAM), { segs: 18 });
  cyl(body, 0.19, 0.06, [0, 0.3, 0], matte(BRAND.green), { segs: 18 });
  cyl(body, 0.185, 0.1, [0, 0.69, 0], matte(CREAM), { segs: 18, rTop: 0.1 });
  cyl(body, 0.1, 0.03, [0, 0.755, 0], painted(FIX.metal), { segs: 14 });
  cyl(body, 0.04, 0.14, [0, 0.82, 0], painted(FIX.metal), { segs: 10 });
  cyl(body, 0.028, 0.46, [-0.12, 0.41, -0.19], matte(BRAND.orange), { segs: 8, rot: [0.08, 0, 0] });
  box(body, [0.2, 0.08, 0.012], [0, 0.46, 0.186], matte(BRAND.orange));
  box(body, [0.05, 0.025, 0.012], [0.06, 0.575, 0.186], matte(BRAND.green), { seg: 1, radius: 0.004 });
  const chassis = bake(body, owned, 'eDward korpus');
  rig.add(chassis);

  // głowa: podstawa laptopa na szyi i ekran odchylony do tyłu; ekran (buźka) to osobna płaszczyzna ze świecącą teksturą
  const head = new Group();
  head.position.y = 0.89;
  const headParts = new Group();
  box(headParts, [0.4, 0.025, 0.28], [0, 0, 0], painted(FIX.metal));
  box(headParts, [0.34, 0.01, 0.15], [0, 0.025, 0.04], matte(DARK), { seg: 1, radius: 0.004 });
  const lid = new Group();
  lid.position.set(0, 0.02, HINGE_Z);
  lid.rotation.x = LID_TILT;
  box(lid, [0.4, 0.27, 0.03], [0, 0, 0], matte(DARK));
  box(lid, [0.1, 0.06, 0.006], [0.09, 0.12, -0.0165], matte(BRAND.orange), { seg: 1, radius: 0.004 });   // naklejka na plecach ekranu
  headParts.add(lid);
  head.add(bake(headParts, owned, 'eDward głowa'));
  const screen = plane(head, [0.35, 0.22], [0, 0, 0], texturedMaterial('edward-face', faceTexture(), {
    roughness: 0.35, emissiveMap: faceTexture(), emissive: '#ffffff', emissiveIntensity: 0.85,
  }), { cast: false });
  // ekran leży na przedniej ściance wieczka: punkt (0,135 m w górę wieczka, 1,65 cm przed nim) obrócony o jego odchylenie wokół zawiasu
  const [ly, lz] = [0.135, 0.0165];
  screen.position.set(
    0,
    0.02 + ly * Math.cos(LID_TILT) - lz * Math.sin(LID_TILT),
    HINGE_Z + ly * Math.sin(LID_TILT) + lz * Math.cos(LID_TILT),
  );
  screen.rotation.x = LID_TILT;
  rig.add(head);

  // ramiona: wycieraczki w barkach, wiszą wzdłuż korpusu
  const arms = [-1, 1].map((side) => {
    const arm = buildWiper(owned, side < 0 ? 'eDward lewe ramię' : 'eDward prawe ramię');
    arm.position.set(side * 0.215, 0.62, 0);
    arm.rotation.z = side * 0.16;
    rig.add(arm);
    return arm;
  });

  const map = faceTexture();
  map.repeat.set(0.5, 1);
  let phase = 0;
  let clock = 0;

  return {
    object,
    update(dt, moving, working) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      clock += step;
      phase += step * (moving ? 9 : working ? 7.5 : 1.3);
      const sway = Math.sin(phase);
      // korpus kołysze się na tarczy podczas jazdy
      chassis.rotation.z = moving ? 0.035 * sway : 0;
      rig.position.y = moving ? 0.012 * Math.abs(sway) : 0;
      // głowa: w pracy kiwa, w postoju rozgląda się na boki
      head.rotation.x = working ? 0.1 * Math.sin(phase * 2) : 0;
      head.rotation.y = !moving && !working ? 0.35 * Math.sin(clock * 0.55) : 0;
      // wycieraczki: w marszu wymach do przodu i do tyłu na przemian, w pracy szyba (szeroki, szybki wymach na boki)
      arms.forEach((arm, i) => {
        const side = i === 0 ? -1 : 1;
        if (working) {
          arm.rotation.x = 0;
          arm.rotation.z = side * (0.2 + 0.55 * (0.5 + 0.5 * Math.sin(phase + (i === 0 ? 0 : 0.6))) * 1.9);
        } else if (moving) {
          arm.rotation.x = 0.55 * sway * side;
          arm.rotation.z = side * 0.16;
        } else {
          arm.rotation.x = 0;
          arm.rotation.z = side * (0.16 + 0.03 * Math.sin(clock * 1.3 + i));
        }
      });
      map.offset.x = working ? 0.5 : 0;
    },
    setCasting(on) {
      chassis.castShadow = on;
      for (const o of [head.children[0]!, ...arms]) o.castShadow = on;
    },
    dispose() {
      object.removeFromParent();
      for (const g of owned) g.dispose();
    },
  };
}

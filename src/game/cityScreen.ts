import { effect } from '@preact/signals';
import type { Camera, Vector3 } from 'three';
import { createCityPins, screenPosition, type CityPin, type CityPins } from '@/render/city/cityPins';
import type { RenderContext } from '@/render/renderer';
import type { CityState } from '@/sim/city/types';
import { lotState } from '@/sim/firm/commands';
import { cityLotStates, cityPinSpecs } from '@/ui/city/cityModel';
import * as ui from '@/ui/state';
import { dragPan } from './controls';
import type { ScreenArea, SceneHost } from './scene';

/*
 * Ekran Miasta po stronie gry (spec §9): zakładka „Miasto” zapala mapę (`SceneHost.showCity`) i gasi ją po zamknięciu, pinezki dostają
 * numery, marki i licznik dni z modelu firmy (`ui/city/cityModel.ts`), a stuknięcie w pinezkę albo budynek wybiera lokal (karta w arkuszu)
 * albo, przy własnym sklepie, przełącza go (`switchStore`). Wszystko idzie z sygnałów interfejsu (`tab`, `firm`, `cityLayer`,
 * `selectedLot`), więc ta warstwa nie ma własnego stanu poza tym, co już narysowała (żeby nie budować sceny co 200 ms publikacji).
 * Kamerę ustawia scena (`showCity` z prostokątem widocznym spod interfejsu); tu tylko dosuwamy wybrany lokal, gdy leży pod arkuszem.
 */

/** Prawa kolumna arkusza na komputerze (≥ 900 px): szerokość 390 px, 12 px od krawędzi i 12 px odstępu od mapy (ui.css, `.tt-sheet`). */
export const SHEET_WIDE_PX = 390 + 12 + 12;
const WIDE_FROM_PX = 900;
/** Arkusz miasta na telefonie sięga najwyżej tyle wysokości okna (city.css, `.tt-sheet-city`). */
export const SHEET_PHONE_SHARE = 0.46;
/** Mapa nie dostaje mniej wysokości niż tyle px, nawet na niskim ekranie. */
const MIN_BAND_PX = 120;

/**
 * Prostokąt okna (px), który zostaje widoczny, gdy arkusz miasta jest otwarty: pod górnym paskiem i nad zakładkami, a poziomo
 * (komputer) na lewo od prawej kolumny, na telefonie nad arkuszem wysuwanym od dołu. Wartości jak w `ui.css` i `city.css`.
 */
export function visibleArea(width: number, height: number, hudBottom: number, tabsTop: number): ScreenArea {
  if (width >= WIDE_FROM_PX) return { left: 0, top: hudBottom, right: width - SHEET_WIDE_PX, bottom: tabsTop };
  return { left: 0, top: hudBottom, right: width, bottom: Math.max(hudBottom + MIN_BAND_PX, tabsTop - Math.round(height * SHEET_PHONE_SHARE)) };
}

export interface CityScreenDeps {
  scene: Pick<SceneHost, 'showCity' | 'hideCity' | 'cityShown' | 'cityView'>;
  game: Pick<ui.GameActions, 'firm'>;
  pins: CityPins;
  /** Widoczny prostokąt okna (px) przy otwartym arkuszu miasta. */
  area(): ScreenArea;
  /** Przesuwa kamerę, żeby punkt sceny stanął w widocznym prostokącie (gdy leży poza nim). */
  reveal(world: Vector3, area: ScreenArea): void;
}

export interface CityScreen {
  /** Co klatkę: ustawia pinezki na ekranie wg kamery. */
  update(camera: Camera): void;
  /** Stuknięcie w budynek na mapie (`SceneHost.pickCityLot`): lokal albo null (puste miejsce zdejmuje wybór). */
  tap(lotId: number | null): void;
  dispose(): void;
}

export function createCityScreen(deps: CityScreenDeps): CityScreen {
  const { scene, game, pins } = deps;
  let shownCity: CityState | null = null;   // miasto, które scena już pokazuje (po tożsamości: nowa gra to nowy obiekt)
  let stateKey = '';   // co scena miasta już pokazuje (warstwa i stany lokali)
  let pinKey = '';     // co pinezki już pokazują
  let revealed: number | null = null;

  /** Własny sklep przełącza (aktywny nic nie zmienia), inny lokal się wybiera; lokal zajęty bez pinezki zdejmuje wybór. */
  function onLot(lotId: number): void {
    const f = ui.firm.value?.f;
    if (!f) return;
    const own = f.stores.find((s) => s.lotId === lotId && !s.closed);
    if (own) {
      if (own.id !== f.activeId) game.firm({ type: 'switchStore', storeId: own.id });
      return;
    }
    ui.selectedLot.value = lotState(f, lotId) === 'zajety' ? null : lotId;
  }
  pins.onTap(onLot);

  const stop = effect(() => {
    const view = ui.firm.value;
    const layer = ui.cityLayer.value;
    const selected = ui.selectedLot.value;
    if (ui.tab.value !== 'miasto' || !view) {
      if (scene.cityShown) {
        scene.hideCity();
        pins.set([]);
        shownCity = null;
        stateKey = pinKey = '';
        revealed = null;
      }
      return;
    }
    const { f } = view;
    const states = cityLotStates(f);
    const key = `${layer}|${Object.values(states).join(',')}`;
    if (!scene.cityShown || f.city !== shownCity || key !== stateKey) {
      scene.showCity(f.city, states, layer, deps.area());
      shownCity = f.city;
      stateKey = key;
      pinKey = '';
    }
    const specs = cityPinSpecs(f.seed, f, selected);
    const nextPins = JSON.stringify(specs);
    if (nextPins !== pinKey) {
      const anchors = new Map((scene.cityView?.pinAnchors() ?? []).map((a) => [a.lotId, a.world]));
      pins.set(specs.flatMap((p): CityPin[] => { const world = anchors.get(p.lotId); return world ? [{ ...p, world }] : []; }));
      pinKey = nextPins;
    }
    // wybrany lokal może leżeć pod arkuszem: dosuwamy go do widocznego prostokąta, raz na wybór
    if (selected !== revealed) {
      revealed = selected;
      const world = selected === null ? undefined : scene.cityView?.pinAnchors().find((a) => a.lotId === selected)?.world;
      if (world) deps.reveal(world, deps.area());
    }
  });

  return {
    update: (camera) => pins.update(camera),
    tap: (lotId) => { if (lotId === null) ui.selectedLot.value = null; else onLot(lotId); },
    dispose() {
      stop();
      pins.dispose();
    },
  };
}

/** Ekran Miasta w przeglądarce: pinezki w `parent`, widoczny prostokąt z paska i zakładek, kamera z renderera. */
export function browserCityScreen(ctx: RenderContext, scene: SceneHost, game: ui.GameActions, parent: HTMLElement): CityScreen {
  const area = (): ScreenArea => {
    const h = window.innerHeight;
    const hud = document.querySelector('.tt-hud2')?.getBoundingClientRect().bottom ?? 0;
    const tabs = document.querySelector('.tt-tabs')?.getBoundingClientRect().top ?? h;
    return visibleArea(window.innerWidth, h, hud, tabs);
  };
  const PAD_PX = 48;
  return createCityScreen({
    scene, game, area, pins: createCityPins(parent),
    reveal(world, a) {
      const p = screenPosition(world, ctx.rig.camera, window.innerWidth, window.innerHeight);
      if (p.x >= a.left + PAD_PX && p.x <= a.right - PAD_PX && p.y >= a.top + PAD_PX && p.y <= a.bottom - PAD_PX) return;
      dragPan(ctx, (a.left + a.right) / 2 - p.x, (a.top + a.bottom) / 2 - p.y);
    },
  });
}

import type { RenderContext } from '@/render/renderer';
import { advanceEconomy } from '@/sim/economy/clock';
import { awaitingDecision, type EconEvent } from '@/sim/economy/economy';
import * as ui from '@/ui/state';
import type { GameShell } from './actions';
import type { SceneHost } from './scene';
import type { GameSession } from './session';

/**
 * Logika pętli klatek, którą da się sprawdzić w node (bez `three` i renderera): kiedy gra stoi, ile minut ekonomii upływa
 * w klatce i kiedy wolno wystawić uchwyt do ręcznych testów. Sama pętla (`requestAnimationFrame`, scena, tłum, render) zostaje
 * w `main.ts`, bo składa ze sobą scenę, powłokę i renderer.
 */

/**
 * Czy na wierzchu jest okno, które zatrzymuje grę: raport miesiąca, ważne zdarzenie czekające na „OK” (`ui.story`), ekran
 * startowy, powitanie, prestiż, „Jak grać” albo koniec gry (ten ostatni czyta się z `session`, bez sesji go nie ma). Karta decyzji
 * zatrzymuje grę sama, w symulacji (`cardsBlocking`). Pauza z klawisza to osobna sprawa: nią steruje prędkość.
 */
export const isModalOpen = (session: Pick<GameSession, 'econ'> | null = null): boolean => ui.isWindowOpen() || !!session?.econ.gameOver;

/**
 * Czy scena stoi: tłum, ludzie i dymki zamierają pod oknem (`modal`, czyli `isModalOpen`) i pod kartą decyzji, która trzyma grę
 * (`awaitingDecision`). Bez tego sklep żył własnym życiem, np. w ×8, pod napisem „Gra czeka na Twoją decyzję”. Pauza z klawisza
 * nie potrzebuje tego warunku: prędkość świata 0 zatrzymuje scenę sama.
 */
export const isSceneHeld = (session: Pick<GameSession, 'econ'> | null, modal: boolean): boolean =>
  modal || (!!session && awaitingDecision(session.econ));

/**
 * Przesuwa ekonomię sesji o czas klatki `realDt` (s) przy prędkości gry `speed`, a zdarzenia dopisuje do `out`.
 * Zwraca liczbę wykonanych minut gry. Przy pauzie (`speed <= 0`) i przy oknie na wierzchu (`modal`) nic się nie dzieje:
 * ani minuty, ani zegar `session.clock` się nie ruszają.
 */
export function advanceSession(session: GameSession, realDt: number, speed: number, modal: boolean, out: EconEvent[]): number {
  if (!(speed > 0) || modal) return 0;
  return advanceEconomy(session.econ, session.info, session.clock, realDt * speed, out);
}

/**
 * Czy wystawić `window.traszkaGame`: w buildzie deweloperskim zawsze, w produkcji tylko pod adresem z `?debug=1`.
 * Uchwyt pozwala przewijać grę (`skip`) i grzebać w stanie, więc zwykły gracz nie ma go mieć pod ręką (M11).
 */
export const debugHandleEnabled = (isDev: boolean, params: URLSearchParams): boolean => isDev || params.get('debug') === '1';

/** Wystawia `handle` jako `target.traszkaGame` (pola uchwytu zostają żywe: gettery czytają bieżący stan). Wyłączony nie dotyka `target`. */
export function installDebugHandle(target: object, handle: object, enabled: boolean): void {
  if (!enabled) return;
  Object.assign(target, { traszkaGame: handle });
}

/** Z czego składa się uchwyt debugowania: kontekst renderera, powłoka gry i scena (tylko pola, które uchwyt czyta). */
export interface DebugParts {
  ctx: RenderContext;
  shell: Pick<GameShell, 'session' | 'setSeed' | 'skip' | 'game'>;
  scene: Pick<SceneHost, 'loaded' | 'factory'>;
}

/**
 * Uchwyt `window.traszkaGame` do ręcznych testów w konsoli i skryptów przeglądarkowych: kontekst renderera, `setSeed`, `game`
 * (polecenia), `skip(minutes)` (przewija grę o minuty) i widoki bieżącego sklepu. Pola stanu to gettery: czytają sesję i scenę
 * w chwili odczytu, więc po przebudowie sceny (remont, zmiana sklepu) uchwyt pokazuje nowy świat. Wystawia go `installDebugHandle`.
 */
export function debugHandleOf({ ctx, shell, scene }: DebugParts): object {
  return {
    ctx,
    setSeed: shell.setSeed,
    game: shell.game,
    skip: shell.skip,
    get session() { return shell.session; },
    get world() { return scene.loaded?.world ?? null; },
    get view() { return scene.loaded?.view ?? null; },
    get street() { return scene.loaded?.street ?? null; },
    get crowdView() { return scene.loaded?.crowdView ?? null; },
    get cashierView() { return scene.loaded?.cashierView ?? null; },
    get staffView() { return scene.loaded?.staffView ?? null; },
    get factory() { return scene.factory; },
  };
}

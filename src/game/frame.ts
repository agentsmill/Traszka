import { advanceEconomy } from '@/sim/economy/clock';
import type { EconEvent } from '@/sim/economy/economy';
import * as ui from '@/ui/state';
import type { GameSession } from './session';

/**
 * Logika pętli klatek, którą da się sprawdzić w node (bez `three` i renderera): kiedy gra stoi, ile minut ekonomii upływa
 * w klatce i kiedy wolno wystawić uchwyt do ręcznych testów. Sama pętla (`requestAnimationFrame`, scena, tłum, render) zostaje
 * w `main.ts`, bo korzysta z obiektów sceny.
 */

/**
 * Czy na wierzchu jest okno, które zatrzymuje grę: raport miesiąca, ekran startowy, powitanie, prestiż albo koniec gry
 * (ten ostatni czyta się z `session`, bez sesji go nie ma). Pauza z klawisza to osobna sprawa: nią steruje prędkość.
 */
export const isModalOpen = (session: Pick<GameSession, 'econ'> | null = null): boolean =>
  !!ui.report.value || !!ui.start.value || !!ui.welcome.value || ui.showPrestige.value || !!session?.econ.gameOver;

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

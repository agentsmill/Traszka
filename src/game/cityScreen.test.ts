import { Vector3, type Camera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partnerSession, openSecond } from '../../tests/firmKit';
import type { CityPin, CityPins } from '@/render/city/cityPins';
import type { CityLayer } from '@/render/city/buildCity';
import type { CityState, LotState } from '@/sim/city/types';
import { firmOf, type GameSession } from '@/game/session';
import type { FirmCommand, FirmCommandResult } from '@/sim/firm/commands';
import type { FirmState } from '@/sim/firm/types';
import { freeLotRows } from '@/ui/city/cityModel';
import * as ui from '@/ui/state';
import { CityScreen, SHEET_PHONE_SHARE, SHEET_WIDE_PX, createCityScreen, visibleArea } from './cityScreen';
import type { ScreenArea } from './scene';

/*
 * Ekran Miasta po stronie gry: zakładka zapala i gasi mapę, scena dostaje stany lokali tylko wtedy, gdy się zmieniły, pinezki mają
 * kotwice ze sceny, a stuknięcie wybiera lokal albo przełącza własny sklep. Scena, pinezki i kamera to atrapy: liczy się to, co ekran
 * im każe, nie WebGL.
 */

const AREA: ScreenArea = { left: 0, top: 112, right: 390, bottom: 400 };

interface Harness {
  screen: CityScreen;
  pins: CityPins;
  f: FirmState;
  shown: { city: CityState; states: Record<number, LotState>; layer: CityLayer; area: ScreenArea | undefined }[];
  hides: number;
  pinSets: CityPin[][];
  taps: ((lotId: number) => void)[];
  revealed: { world: Vector3; area: ScreenArea }[];
  firmCmds: FirmCommand[];
  state: { shown: boolean };
}

function harness(session: GameSession = partnerSession()): Harness {
  const f = firmOf(session);
  const h = { f, shown: [], hides: 0, pinSets: [], taps: [], revealed: [], firmCmds: [], state: { shown: false } } as unknown as Harness;
  let anchors: { lotId: number; world: Vector3 }[] = [];
  const scene = {
    get cityShown() { return h.state.shown; },
    get cityView() { return h.state.shown ? { pinAnchors: () => anchors } as never : null; },
    showCity(city: CityState, states: Record<number, LotState>, layer: CityLayer, area?: ScreenArea) {
      h.shown.push({ city, states, layer, area });
      h.state.shown = true;
      // kotwica każdego lokalu poza zwykłym zajętym, jak w buildCity
      anchors = city.lots.filter((l) => states[l.id] !== 'zajety').map((l) => ({ lotId: l.id, world: new Vector3(l.id, 0.3, -l.id) }));
    },
    hideCity() { h.hides++; h.state.shown = false; },
  };
  const pins: CityPins = {
    set: (list) => { h.pinSets.push(list); },
    update: vi.fn(),
    onTap: (cb) => { h.taps.push(cb); },
    dispose: vi.fn(),
  };
  const game = { firm: (cmd: FirmCommand): FirmCommandResult => { h.firmCmds.push(cmd); return { ok: true }; } };
  h.pins = pins;
  h.screen = createCityScreen({ scene: scene as never, game, pins, area: () => AREA, reveal: (world, area) => { h.revealed.push({ world, area }); } });
  ui.firm.value = { f, v: 1 };
  return h;
}

let current: Harness | null = null;
const make = (session?: GameSession): Harness => (current = harness(session));

function resetSignals(): void {
  ui.tab.value = null;
  ui.firm.value = null;
  ui.cityLayer.value = 'ruch';
  ui.selectedLot.value = null;
}
beforeEach(resetSignals);
afterEach(() => { current?.screen.dispose(); current = null; resetSignals(); });

describe('visibleArea: co zostaje z okna przy otwartym arkuszu miasta', () => {
  it('komputer: lewa część okna między paskiem a zakładkami, prawa kolumna arkusza odpada', () => {
    expect(visibleArea(1280, 800, 52, 740)).toEqual({ left: 0, top: 52, right: 1280 - SHEET_WIDE_PX, bottom: 740 });
  });

  it('telefon w pionie: całe okno szerokości, nad arkuszem wysuwanym od dołu', () => {
    const a = visibleArea(390, 844, 112, 784);
    expect(a).toEqual({ left: 0, top: 112, right: 390, bottom: 784 - Math.round(844 * SHEET_PHONE_SHARE) });
    expect(a.bottom - a.top).toBeGreaterThan(200);   // na mapę zostaje porządny pas
  });

  it('na niskim ekranie mapa nie dostaje mniej niż kilkadziesiąt pikseli', () => {
    const a = visibleArea(390, 320, 112, 260);
    expect(a.bottom - a.top).toBeGreaterThanOrEqual(100);
  });
});

describe('zakładka Miasto zapala i gasi mapę', () => {
  it('bez zakładki scena miasta nie rusza; otwarcie pokazuje to samo miasto firmy z jej stanami lokali, warstwą i widocznym prostokątem', () => {
    const h = make();
    expect(h.shown).toHaveLength(0);
    expect(h.hides).toBe(0);
    ui.tab.value = 'miasto';
    expect(h.shown).toHaveLength(1);
    const shown = h.shown[0]!;
    expect(shown.city).toBe(h.f.city);   // jeden CityState na grę, scena porównuje po tożsamości
    expect(shown.layer).toBe('ruch');
    expect(shown.area).toEqual(AREA);
    expect(Object.keys(shown.states)).toHaveLength(h.f.city.lots.length);
    expect(shown.states[h.f.city.startLotId]).toBe('twoj');
  });

  it('zamknięcie zakładki (albo przejście na inną) gasi mapę i pinezki, ponowne otwarcie zapala je od nowa', () => {
    const h = make();
    ui.tab.value = 'miasto';
    ui.tab.value = 'sklep';
    expect(h.hides).toBe(1);
    expect(h.pinSets[h.pinSets.length - 1]).toEqual([]);
    ui.tab.value = 'miasto';
    expect(h.shown).toHaveLength(2);
    ui.tab.value = null;
    expect(h.hides).toBe(2);
  });

  it('inna zakładka nie dotyka sceny miasta, gdy nigdy nie była pokazana', () => {
    const h = make();
    ui.tab.value = 'cele';
    expect(h.hides).toBe(0);
    expect(h.shown).toHaveLength(0);
  });

  it('zmiana warstwy pokazuje miasto jeszcze raz z nową warstwą; zwykła publikacja firmy (to samo miasto, te same stany) nie rusza sceny', () => {
    const h = make();
    ui.tab.value = 'miasto';
    ui.firm.value = { f: h.f, v: 2 };
    ui.firm.value = { f: h.f, v: 3 };
    expect(h.shown).toHaveLength(1);
    ui.cityLayer.value = 'dzielnice';
    expect(h.shown).toHaveLength(2);
    expect(h.shown[1]!.layer).toBe('dzielnice');
  });

  it('nowa gra (nowy obiekt miasta, nawet z tymi samymi stanami lokali) pokazuje się od nowa, a nie zostaje starym miastem', () => {
    const h = make();
    ui.tab.value = 'miasto';
    expect(h.shown).toHaveLength(1);
    const next = firmOf(partnerSession());   // ten sam seed, osobny CityState
    expect(next.city).not.toBe(h.f.city);
    ui.firm.value = { f: next, v: 1 };
    expect(h.shown).toHaveLength(2);
    expect(h.shown[1]!.city).toBe(next.city);
  });

  it('wynajęty lokal zmienia stany: scena dostaje nowe, a pinezka wolnego lokalu zamienia się w budowę', async () => {
    const h = make();
    ui.tab.value = 'miasto';
    const row = freeLotRows(h.f.seed, h.f)[0]!;
    expect(h.pinSets[h.pinSets.length - 1]!.find((p) => p.lotId === row.lotId)!.kind).toBe('wolny');
    const { applyFirmCommand } = await import('@/sim/firm/commands');
    const { emptyStepOut } = await import('@/sim/firm/firm');
    expect(applyFirmCommand(h.f, { type: 'rentLot', lotId: row.lotId, pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
    ui.firm.value = { f: h.f, v: 2 };
    expect(h.shown).toHaveLength(2);
    expect(h.shown[1]!.states[row.lotId]).toBe('budowa');
    expect(h.pinSets[h.pinSets.length - 1]!.find((p) => p.lotId === row.lotId)!.kind).toBe('budowa');
  });
});

describe('pinezki', () => {
  it('mają kotwice ze sceny, numery wolnych lokali i markę konkurencji', () => {
    const h = make();
    ui.tab.value = 'miasto';
    const pins = h.pinSets[h.pinSets.length - 1]!;
    const free = freeLotRows(h.f.seed, h.f);
    expect(pins.filter((p) => p.kind === 'wolny' && free.some((r) => r.lotId === p.lotId))).toHaveLength(free.length);
    for (const p of pins) expect(p.world).toEqual(new Vector3(p.lotId, 0.3, -p.lotId));
    expect(pins.find((p) => p.lotId === h.f.city.startLotId)).toMatchObject({ kind: 'twoj', label: 'Traszka #1' });
    expect(pins.filter((p) => p.kind === 'szop' || p.kind === 'kawka').length).toBeGreaterThan(0);
  });

  it('wybór lokalu dopisuje adres do jego pinezki; zwykła publikacja firmy nie przestawia pinezek', () => {
    const h = make();
    ui.tab.value = 'miasto';
    const before = h.pinSets.length;
    ui.firm.value = { f: h.f, v: 2 };
    expect(h.pinSets).toHaveLength(before);
    const row = freeLotRows(h.f.seed, h.f)[1]!;
    ui.selectedLot.value = row.lotId;
    expect(h.pinSets.length).toBe(before + 1);
    expect(h.pinSets[h.pinSets.length - 1]!.find((p) => p.lotId === row.lotId)!.label).toBe(`${row.no} · ul. ${row.street} ${row.number}`);
  });

  it('wybrany lokal jest dosuwany do widocznego prostokąta raz na wybór', () => {
    const h = make();
    ui.tab.value = 'miasto';
    expect(h.revealed).toHaveLength(0);
    const rows = freeLotRows(h.f.seed, h.f);
    ui.selectedLot.value = rows[0]!.lotId;
    expect(h.revealed).toHaveLength(1);
    expect(h.revealed[0]!.world).toEqual(new Vector3(rows[0]!.lotId, 0.3, -rows[0]!.lotId));
    expect(h.revealed[0]!.area).toEqual(AREA);
    ui.firm.value = { f: h.f, v: 5 };
    expect(h.revealed).toHaveLength(1);
    ui.selectedLot.value = rows[1]!.lotId;
    expect(h.revealed).toHaveLength(2);
    ui.selectedLot.value = null;
    expect(h.revealed).toHaveLength(2);
  });

  it('update przekazuje kamerę pinezkom', () => {
    const h = make();
    const camera = {} as Camera;
    h.screen.update(camera);
    expect(h.pins.update).toHaveBeenCalledWith(camera);
  });
});

describe('stuknięcie', () => {
  it('w pinezkę wolnego lokalu wybiera go (karta w arkuszu)', () => {
    const h = make();
    ui.tab.value = 'miasto';
    const row = freeLotRows(h.f.seed, h.f)[2]!;
    h.taps[0]!(row.lotId);
    expect(ui.selectedLot.value).toBe(row.lotId);
    expect(h.firmCmds).toEqual([]);
  });

  it('w pinezkę własnego, nieaktywnego sklepu wysyła switchStore; w aktywny nic nie robi', () => {
    const session = partnerSession();
    openSecond(session, 'raty');
    const h = make(session);
    const f = h.f;
    ui.tab.value = 'miasto';
    const second = f.stores[1]!;
    expect(f.activeId).toBe(1);
    h.taps[0]!(second.lotId);
    expect(h.firmCmds).toEqual([{ type: 'switchStore', storeId: second.id }]);
    expect(ui.selectedLot.value).toBeNull();
    f.activeId = second.id;   // przełączone: stuknięcie w aktywny sklep jest bez skutku
    h.taps[0]!(second.lotId);
    expect(h.firmCmds).toHaveLength(1);
    h.taps[0]!(f.stores[0]!.lotId);
    expect(h.firmCmds).toHaveLength(2);
    expect(h.firmCmds[1]).toEqual({ type: 'switchStore', storeId: 1 });
  });

  it('w budynek na mapie wybiera lokal, w puste miejsce albo zwykły zajęty lokal zdejmuje wybór', () => {
    const h = make();
    ui.tab.value = 'miasto';
    const row = freeLotRows(h.f.seed, h.f)[0]!;
    h.screen.tap(row.lotId);
    expect(ui.selectedLot.value).toBe(row.lotId);
    h.screen.tap(null);
    expect(ui.selectedLot.value).toBeNull();
    h.screen.tap(row.lotId);
    const plain = h.f.city.lots.find((l) => l.state === 'zajety')!;
    h.screen.tap(plain.id);
    expect(ui.selectedLot.value).toBeNull();
  });
});

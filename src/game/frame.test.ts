import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINUTES_PER_SECOND_OPEN as R, OPEN_FROM } from '@/sim/economy/catalog';
import { advanceEconomy } from '@/sim/economy/clock';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, type EconEvent, type MonthReport } from '@/sim/economy/economy';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import * as ui from '@/ui/state';
import type { GameShell } from './actions';
import { advanceSession, debugHandleEnabled, debugHandleOf, installDebugHandle, isModalOpen, isSceneHeld } from './frame';
import { MemoryStorage } from './memoryStorage';
import type { SceneHost } from './scene';
import { createRankedSession } from './rankedRun';
import { createSession, type GameSession } from './session';

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

/** Świeża gra: sklep otwarty od 6:00, więc ×1 daje `R` (`MINUTES_PER_SECOND_OPEN`) minut gry na sekundę. */
const fresh = (): GameSession => createSession('traszka-frame', true);

describe('advanceSession', () => {
  it('pauza (prędkość 0) nie przesuwa ani minut, ani zegara', () => {
    const s = fresh();
    const out: EconEvent[] = [];
    expect(advanceSession(s, 1, 0, false, out)).toBe(0);
    expect(s.econ.minute).toBe(OPEN_FROM);
    expect(s.clock.acc).toBe(0);
    expect(out).toEqual([]);
  });

  it('prędkość ujemna albo NaN to też zero minut', () => {
    const s = fresh();
    expect(advanceSession(s, 1, -1, false, [])).toBe(0);
    expect(advanceSession(s, 1, Number.NaN, false, [])).toBe(0);
    expect(s.econ.minute).toBe(OPEN_FROM);
  });

  it('okno na wierzchu (modal) zatrzymuje grę mimo prędkości ×8', () => {
    const s = fresh();
    const out: EconEvent[] = [];
    expect(advanceSession(s, 1, 8, true, out)).toBe(0);
    expect(s.econ.minute).toBe(OPEN_FROM);
    expect(s.clock.acc).toBe(0);
    expect(out).toEqual([]);
  });

  it('×1 w godzinach otwarcia to R minut gry na sekundę', () => {
    const s = fresh();
    expect(advanceSession(s, 1.01, 1, false, [])).toBe(R);   // 1,01 s: R pełnych minut i reszta w zegarze
    expect(s.econ.minute).toBe(OPEN_FROM + R);
    expect(s.clock.acc).toBeCloseTo(0.01 * R, 9);
  });

  it('równa sekunda to R minut z dokładnością do błędu zaokrągleń zegara (ostatnia domyka się w następnej klatce)', () => {
    const s = fresh();
    const done = advanceSession(s, 1, 1, false, []);
    expect(done === R - 1 || done === R).toBe(true);   // R × (1/R) s w liczbach zmiennoprzecinkowych bywa o włos mniej niż 1 s
    expect(s.econ.minute - OPEN_FROM + s.clock.acc).toBeCloseTo(R, 9);
    advanceSession(s, 0.001, 1, false, []);
    expect(s.econ.minute).toBe(OPEN_FROM + R);
  });

  it('prędkość mnoży czas ramki: pół sekundy ×2 to tyle samo, co sekunda ×1', () => {
    const slow = fresh(), fast = fresh();
    advanceSession(slow, 1.01, 1, false, []);
    advanceSession(fast, 0.505, 2, false, []);
    expect(fast.econ.minute).toBe(slow.econ.minute);
    expect(fast.clock.acc).toBeCloseTo(slow.clock.acc, 9);
  });

  it('ułamek minuty zostaje w zegarze i dopełnia się w następnej klatce', () => {
    const s = fresh();
    expect(advanceSession(s, 0.8 / R, 1, false, [])).toBe(0);   // 0,8 minuty
    expect(s.clock.acc).toBeCloseTo(0.8, 9);
    expect(advanceSession(s, 0.4 / R, 1, false, [])).toBe(1);   // razem 1,2 minuty
    expect(s.econ.minute).toBe(OPEN_FROM + 1);
  });

  it('daje ten sam stan, co bezpośrednie advanceEconomy z czasem pomnożonym przez prędkość', () => {
    const viaSession = fresh();
    const direct = fresh();
    const a: EconEvent[] = [], b: EconEvent[] = [];
    for (let i = 0; i < 40; i++) {
      advanceSession(viaSession, 0.1, 4, false, a);
      advanceEconomy(direct.econ, direct.info, direct.clock, 0.1 * 4, b);
    }
    expect(viaSession.econ).toEqual(direct.econ);
    expect(viaSession.clock).toEqual(direct.clock);
    expect(a).toEqual(b);
  });

  it('zdarzenia trafiają do `out` (koniec dnia)', () => {
    const s = fresh();
    const out: EconEvent[] = [];
    for (let i = 0; i < 200 && !out.some((e) => e.kind === 'day'); i++) {
      // karta dnia zatrzymuje grę do odpowiedzi gracza: tu zatwierdzamy zaznaczoną z góry
      for (const c of visibleCards(s.econ.tycoon.cards, s.econ.minute)) applyCommand(s.econ, s.info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
      advanceSession(s, 1, 1, false, out);
    }
    expect(out.some((e) => e.kind === 'day')).toBe(true);
    expect(out.some((e) => e.kind === 'card')).toBe(true);   // po drodze karty się pokazywały
  });

  it('karta decyzji zatrzymuje grę mimo prędkości ×8: staje na showAt, zdarzenie card, kolejne klatki dają 0 minut', () => {
    const s = fresh();
    const first = Math.min(...s.econ.tycoon.cards.pending.map((c) => c.showAt));
    const out: EconEvent[] = [];
    for (let i = 0; i < 200 && !awaitingDecision(s.econ); i++) advanceSession(s, 1, 8, false, out);
    expect(s.econ.minute).toBe(first);
    expect(out.filter((e) => e.kind === 'card').length).toBeGreaterThanOrEqual(1);
    const stopped = JSON.stringify(s);
    expect(advanceSession(s, 1, 8, false, out)).toBe(0);
    expect(JSON.stringify(s)).toBe(stopped);
  });

  it('po końcu gry nie liczy minut', () => {
    const s = fresh();
    s.econ.gameOver = true;
    expect(advanceSession(s, 1, 1, false, [])).toBe(0);
    expect(s.econ.minute).toBe(OPEN_FROM);
  });
});

describe('advanceSession: sezon rankingowy kończy się dokładnie na RANKED_SEASON_END_MINUTE', () => {
  const END = RANKED_SEASON_END_MINUTE;
  /** Sesja tuż przed końcem sezonu, bez kart na biurku (to koniec sezonu, a nie karta, ma zatrzymać zegar). */
  const nearEnd = (s: GameSession, minutesBefore = 5): GameSession => {
    s.econ.minute = END - minutesBefore;
    s.econ.tycoon.cards.pending = [];
    return s;
  };

  it('×1, ×8 i duży czas klatki: stan staje na END, nigdy na END + k', () => {
    for (const [dt, speed] of [[0.05, 1], [0.1, 8], [0.5, 8], [1000, 8], [1e9, 1]] as const) {
      const s = nearEnd(createRankedSession('traszka-frame'));
      for (let i = 0; i < 400; i++) advanceSession(s, dt, speed, false, []);
      expect(s.econ.minute).toBe(END);
      expect(s.clock.acc).toBe(0);   // reszta czasu klatki przepada, nie zbiera się
    }
  });

  it('po dojściu do końca kolejne klatki nic nie robią (0 minut, stan bez zmian), także gdy zdarzenia są puste', () => {
    const s = nearEnd(createRankedSession('traszka-frame'), 1);
    const out: EconEvent[] = [];
    expect(advanceSession(s, 10, 8, false, out)).toBe(1);
    expect(s.econ.minute).toBe(END);
    const stopped = JSON.stringify(s);
    const events: EconEvent[] = [];
    expect(advanceSession(s, 10, 8, false, events)).toBe(0);
    expect(JSON.stringify(s)).toBe(stopped);
    expect(events).toEqual([]);
  });

  it('zwykła sesja o tej samej minucie się nie zatrzymuje: gra idzie za END', () => {
    const s = nearEnd(createSession('traszka-frame', true));
    advanceSession(s, 1000, 8, false, []);
    expect(s.econ.minute).toBeGreaterThan(END);
  });

  it('sesja rankingowa, która zaczyna przed końcem, gra normalnie aż do niego (żaden wcześniejszy limit)', () => {
    const s = createRankedSession('traszka-frame');
    const first = Math.min(...s.econ.tycoon.cards.pending.map((c) => c.showAt));
    for (let i = 0; i < 200 && !awaitingDecision(s.econ); i++) advanceSession(s, 1, 8, false, []);
    expect(s.econ.minute).toBe(first);   // staje na karcie, nie na końcu sezonu
  });
});

describe('isSceneHeld (scena stoi pod oknem i pod kartą decyzji)', () => {
  afterEach(() => { ui.howTo.value = false; });

  it('bez okna i bez karty scena żyje, z sesją i bez niej', () => {
    expect(isSceneHeld(null, false)).toBe(false);
    expect(isSceneHeld(fresh(), isModalOpen())).toBe(false);
  });

  it('okno na wierzchu zatrzymuje scenę, także bez sesji', () => {
    ui.howTo.value = true;
    expect(isSceneHeld(null, isModalOpen())).toBe(true);
    expect(isSceneHeld(fresh(), isModalOpen())).toBe(true);
  });

  it('karta decyzji, która trzyma grę, zatrzymuje scenę, choć żadne okno nie jest otwarte; po odpowiedzi scena rusza', () => {
    const s = fresh();
    const out: EconEvent[] = [];
    for (let i = 0; i < 200 && !awaitingDecision(s.econ); i++) advanceSession(s, 1, 8, false, out);
    expect(awaitingDecision(s.econ)).toBe(true);
    expect(isModalOpen(s)).toBe(false);   // to nie jest okno: tylko karta w symulacji
    expect(isSceneHeld(s, isModalOpen(s))).toBe(true);
    for (const c of visibleCards(s.econ.tycoon.cards, s.econ.minute)) applyCommand(s.econ, s.info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
    expect(awaitingDecision(s.econ)).toBe(false);
    expect(isSceneHeld(s, isModalOpen(s))).toBe(false);
  });

  it('po końcu gry karta nikogo nie czeka: scenę trzyma wtedy okno końca gry (isModalOpen), nie karta', () => {
    const s = fresh();
    const out: EconEvent[] = [];
    for (let i = 0; i < 200 && !awaitingDecision(s.econ); i++) advanceSession(s, 1, 8, false, out);
    s.econ.gameOver = true;
    expect(awaitingDecision(s.econ)).toBe(false);
    expect(isSceneHeld(s, false)).toBe(false);
    expect(isSceneHeld(s, isModalOpen(s))).toBe(true);
  });
});

describe('isModalOpen', () => {
  afterEach(() => {
    ui.report.value = null;
    ui.start.value = null;
    ui.welcome.value = null;
    ui.showPrestige.value = false;
    ui.howTo.value = false;
    ui.story.value = [];
  });

  it('bez żadnego okna gra się toczy, z sesją i bez niej', () => {
    expect(isModalOpen()).toBe(false);
    expect(isModalOpen(null)).toBe(false);
    expect(isModalOpen(fresh())).toBe(false);
  });

  it('raport miesiąca, ekran startowy, powitanie i prestiż zatrzymują grę', () => {
    ui.report.value = {} as MonthReport;
    expect(isModalOpen()).toBe(true);
    ui.report.value = null;

    ui.start.value = {} as NonNullable<typeof ui.start.value>;
    expect(isModalOpen()).toBe(true);
    ui.start.value = null;

    ui.welcome.value = {} as NonNullable<typeof ui.welcome.value>;
    expect(isModalOpen()).toBe(true);
    ui.welcome.value = null;

    ui.showPrestige.value = true;
    expect(isModalOpen()).toBe(true);
    ui.showPrestige.value = false;

    expect(isModalOpen()).toBe(false);
  });

  it('okno „Jak grać” zatrzymuje grę (z sesją i bez), a po „Zaczynamy” gra rusza', () => {
    ui.howTo.value = true;
    expect(isModalOpen()).toBe(true);
    expect(isModalOpen(fresh())).toBe(true);
    const s = fresh();
    expect(advanceSession(s, 1, 1, isModalOpen(s), [])).toBe(0);   // pętla klatek: okno na wierzchu, więc ani minuty
    expect(s.econ.minute).toBe(OPEN_FROM);
    ui.howTo.value = false;
    expect(isModalOpen(s)).toBe(false);
    expect(advanceSession(s, 1, 1, isModalOpen(s), [])).toBeGreaterThan(0);
  });

  it('ważne zdarzenie czekające na „OK” zatrzymuje grę, a po „OK” (pusta kolejka) gra rusza', () => {
    ui.pushStory('Remont zakończony', 'Sklep otwarty.');
    expect(isModalOpen()).toBe(true);
    expect(isModalOpen(fresh())).toBe(true);
    ui.pushStory('Poziom 5', 'Nagroda');
    ui.dismissStory();
    expect(isModalOpen()).toBe(true);   // zostało jeszcze jedno
    ui.dismissStory();
    expect(isModalOpen()).toBe(false);
  });

  it('koniec gry w sesji zatrzymuje grę', () => {
    const s = fresh();
    s.econ.gameOver = true;
    expect(isModalOpen(s)).toBe(true);
    expect(isModalOpen(null)).toBe(false);
  });
});

describe('debugHandleEnabled', () => {
  it('w buildzie deweloperskim uchwyt jest zawsze', () => {
    expect(debugHandleEnabled(true, new URLSearchParams(''))).toBe(true);
    expect(debugHandleEnabled(true, new URLSearchParams('?debug=0'))).toBe(true);
  });

  it('w produkcji uchwyt włącza dopiero ?debug=1', () => {
    expect(debugHandleEnabled(false, new URLSearchParams('?debug=1'))).toBe(true);
    expect(debugHandleEnabled(false, new URLSearchParams('?seed=abc&debug=1'))).toBe(true);
  });

  it('w produkcji bez ?debug=1 uchwytu nie ma (brak parametru, inna wartość, inny parametr)', () => {
    expect(debugHandleEnabled(false, new URLSearchParams(''))).toBe(false);
    expect(debugHandleEnabled(false, new URLSearchParams('?debug=0'))).toBe(false);
    expect(debugHandleEnabled(false, new URLSearchParams('?debug=true'))).toBe(false);
    expect(debugHandleEnabled(false, new URLSearchParams('?debug='))).toBe(false);
    expect(debugHandleEnabled(false, new URLSearchParams('?perf=1'))).toBe(false);
  });
});

describe('installDebugHandle', () => {
  it('włączony wystawia uchwyt jako traszkaGame na celu', () => {
    const target: Record<string, unknown> = {};
    const handle = { skip: () => {} };
    installDebugHandle(target, handle, true);
    expect(target.traszkaGame).toBe(handle);
  });

  it('pola odczytywane na bieżąco (gettery uchwytu) zostają żywe', () => {
    let current = 'a';
    const handle = { get session() { return current; } };
    const target: Record<string, { session: string }> = {};
    installDebugHandle(target, handle, true);
    expect(target.traszkaGame!.session).toBe('a');
    current = 'b';
    expect(target.traszkaGame!.session).toBe('b');
  });

  it('wyłączony nie dotyka celu: żaden zapis, żadna definicja, żaden odczyt pól', () => {
    const touched: string[] = [];
    const target = new Proxy({}, {
      set: (_t, key) => { touched.push(`set ${String(key)}`); return true; },
      defineProperty: (_t, key) => { touched.push(`define ${String(key)}`); return true; },
      deleteProperty: (_t, key) => { touched.push(`delete ${String(key)}`); return true; },
      get: (_t, key) => { touched.push(`get ${String(key)}`); return undefined; },
    });
    const handle = { get session() { touched.push('handle read'); return 1; } };
    installDebugHandle(target, handle, false);
    expect(touched).toEqual([]);
  });

  it('wyłączony zostawia pusty obiekt pustym, a zamrożony nie rzuca', () => {
    const target: Record<string, unknown> = {};
    installDebugHandle(target, {}, false);
    expect(Object.keys(target)).toEqual([]);
    expect(() => installDebugHandle(Object.freeze({}), {}, false)).not.toThrow();
  });
});

describe('debugHandleOf', () => {
  type Loaded = NonNullable<SceneHost['loaded']>;
  const loadedOf = (tag: string): Loaded => ({
    world: { tag }, view: { tag }, street: { tag }, crowdView: { tag }, cashierView: { tag },
  } as unknown as Loaded);

  it('wystawia kontekst, czynności powłoki i `game`, a pola stanu czyta na bieżąco ze sceny i powłoki', () => {
    const ctx = { name: 'ctx' };
    const setSeed = (): boolean => true;
    const skip = (): void => {};
    const game = { name: 'game' };
    const shell = { session: null as GameSession | null, setSeed, skip, game } as unknown as GameShell;
    let loaded: Loaded | null = null;
    let factory: SceneHost['factory'] = null;
    const scene = { get loaded() { return loaded; }, get factory() { return factory; } };

    const handle = debugHandleOf({ ctx: ctx as never, shell, scene }) as Record<string, unknown>;

    expect(handle.ctx).toBe(ctx);
    expect(handle.setSeed).toBe(setSeed);
    expect(handle.skip).toBe(skip);
    expect(handle.game).toBe(game);
    // scena pusta: widoki to null (nie wyjątek)
    for (const key of ['world', 'view', 'street', 'crowdView', 'cashierView', 'factory', 'session']) expect(handle[key]).toBeNull();

    const session = fresh();
    shell.session = session;
    loaded = loadedOf('a');
    factory = { tag: 'factory' } as unknown as SceneHost['factory'];
    expect(handle.session).toBe(session);
    expect(handle.world).toBe(loaded.world);
    expect(handle.view).toBe(loaded.view);
    expect(handle.street).toBe(loaded.street);
    expect(handle.crowdView).toBe(loaded.crowdView);
    expect(handle.cashierView).toBe(loaded.cashierView);
    expect(handle.factory).toBe(factory);

    loaded = loadedOf('b');   // po przebudowie sceny (remont) uchwyt pokazuje nowy świat
    expect((handle.world as { tag: string }).tag).toBe('b');
  });

  it('razem z installDebugHandle trafia pod `traszkaGame` tylko, gdy włączony', () => {
    const parts = { ctx: {} as never, shell: { session: null } as unknown as GameShell, scene: { loaded: null, factory: null } };
    const on: Record<string, unknown> = {};
    installDebugHandle(on, debugHandleOf(parts), true);
    expect(on.traszkaGame).toBeDefined();
    const off: Record<string, unknown> = {};
    installDebugHandle(off, debugHandleOf(parts), false);
    expect(off.traszkaGame).toBeUndefined();
  });
});

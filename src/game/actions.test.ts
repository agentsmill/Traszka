import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand, COMMAND_TYPES, type Command } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type CommandResult, type EconEvent } from '@/sim/economy/economy';
import { cardDef, visibleCards } from '@/sim/economy/tycoon/cards';
import { CIRCULARS, DECK } from '@/sim/economy/tycoon/deck';
import { xpToNext } from '@/sim/economy/progress';
import { UPGRADES } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import * as layoutModule from '@/sim/store/layoutFor';
import { replayRun, type LogEntry } from '@/sim/run';
import * as ui from '@/ui/state';
import { AFTER, createShell, dispatchCommand, markOffLog, type CommandEffects, type GameShell, type ShellEffects, type ShellScene } from './actions';
import type { CashierLook } from './cashier';
import { isModalOpen } from './frame';
import { MemoryStorage } from './memoryStorage';
import { loadMeta, type Meta } from './meta';
import {
  NEWER_SAVE_NOTICE, RUN_LOG_MAX, createSession, hasStoredSave, saveSession, withLayoutFromSeed, type GameSession,
} from './session';

const SEED = 'traszka-1';
const REBUILD_NOTICE = 'Nie udało się przebudować sklepu po remoncie. Postęp jest zapisany — odśwież stronę.';
const REBUILD_NOTICE_EPHEMERAL = 'Nie udało się przebudować sklepu po remoncie. Ten sklep jest tymczasowy — odśwież stronę, żeby wrócić do swojego.';

/** Atrapa efektów: zapisuje każde wywołanie (nazwa i argumenty) w kolejności; `over` podmienia wybrane efekty. */
type Call = [name: string, ...args: unknown[]];
function recorder(over: Partial<CommandEffects> = {}): { fx: CommandEffects; calls: Call[]; names: () => string[]; named: (name: string) => Call[] } {
  const calls: Call[] = [];
  const fx: CommandEffects = {
    play: (sfx) => { calls.push(['play', sfx]); },
    buzz: (pattern) => { calls.push(['buzz', pattern]); },
    toast: (text, kind) => { calls.push(['toast', text, kind]); },
    confetti: (x, y, count) => { calls.push(['confetti', x, y, count]); },
    handleEvents: (events) => { calls.push(['handleEvents', events]); },
    persist: () => { calls.push(['persist']); },
    clearSelection: () => { calls.push(['clearSelection']); },
    rebuildScene: () => { calls.push(['rebuildScene']); },
    notice: (text) => { calls.push(['notice', text]); },
    refresh: () => { calls.push(['refresh']); },
    ...over,
  };
  return { fx, calls, names: () => calls.map((c) => c[0]), named: (name) => calls.filter((c) => c[0] === name) };
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Świeża gra bez premii partnera: tak zaczyna się bieg, który `replayRun` umie odtworzyć. */
const fresh = (seed = SEED): GameSession => createSession(seed, true);
const log = (s: GameSession): LogEntry[] => s.run!.record.log;

describe('dziennik biegu', () => {
  it('polecenie trafia do dziennika z minutą stanu i kolejnym seq, także nieudane', () => {
    const s = fresh();
    const { fx } = recorder();
    const accepted: Command = { type: 'setOrder', auto: false, manual: 4 };
    const refused: Command = { type: 'returnPallet', palletId: 999 };

    expect(dispatchCommand(s, accepted, fx).ok).toBe(true);
    expect(dispatchCommand(s, refused, fx).ok).toBe(false);
    stepMinute(s.econ, s.info, []);
    expect(dispatchCommand(s, { type: 'tapTill' }, fx).ok).toBe(false);   // przy kasie nikt nie czeka

    expect(log(s)).toEqual([
      { minute: OPEN_FROM, seq: 0, cmd: accepted },
      { minute: OPEN_FROM, seq: 1, cmd: refused },
      { minute: OPEN_FROM + 1, seq: 2, cmd: { type: 'tapTill' } },
    ]);
    expect(s.run!.seq).toBe(3);
  });

  it('do dziennika idzie kopia polecenia: późniejsza zmiana obiektu interfejsu niczego w nim nie zmienia', () => {
    const s = fresh();
    const cmd = { type: 'setOrder', auto: true, manual: 2 } as { type: 'setOrder'; auto: boolean; manual: number };
    dispatchCommand(s, cmd, recorder().fx);
    cmd.manual = 99;
    cmd.auto = false;
    expect(log(s)[0]!.cmd).toEqual({ type: 'setOrder', auto: true, manual: 2 });
    expect(log(s)[0]!.cmd).not.toBe(cmd);
  });

  it('dziennik z dispatchCommand odtwarza się replayRun do tego samego stanu', () => {
    const s = fresh();
    const { fx } = recorder();
    const firstUpgrade = UPGRADES[0]!.id;
    const script: Command[] = [
      { type: 'tapPallet' }, { type: 'tapPallet', palletId: 2 }, { type: 'tapTill' }, { type: 'setOrder', auto: false, manual: 6 },
      { type: 'movePallet', palletId: 1, loc: 'backroom' }, { type: 'hire' }, { type: 'setStaffProfile', profile: 'dostawa' },
      { type: 'pinStaff', task: 'kasa', count: 1 }, { type: 'pinStaff', task: 'rozladunek', count: 9 },
      { type: 'buyUpgrade', id: firstUpgrade }, { type: 'startRemont' }, { type: 'returnPallet', palletId: 999 },
      { type: 'fire' }, { type: 'returnPallet', palletId: 2 }, { type: 'campaign' }, { type: 'rushRemont' }, { type: 'setOrder', auto: true },
    ];
    const results: CommandResult[] = [];
    const events: EconEvent[] = [];
    let issued = 0;
    let answered = 0;
    for (let i = 0; i < 2 * MINUTES_PER_DAY; i++) {
      // gra stoi na karcie, dopóki gracz nie odpowie: pętla klatek nie wykonałaby minuty (odpowiedź idzie do dziennika jak każde polecenie)
      if (awaitingDecision(s.econ)) {
        for (const card of visibleCards(s.econ.tycoon.cards, s.econ.minute)) {
          expect(dispatchCommand(s, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer }, fx).ok).toBe(true);
          answered++;
        }
      }
      if (i % 90 === 0) {
        // co 180. minutę dwa polecenia w jednej minucie: o ich kolejności decyduje `seq`
        const count = i % 180 === 0 ? 2 : 1;
        for (let k = 0; k < count; k++) results.push(dispatchCommand(s, script[issued++ % script.length]!, fx));
      }
      events.length = 0;
      stepMinute(s.econ, s.info, events);
    }

    expect(results.some((r) => r.ok)).toBe(true);
    expect(results.some((r) => !r.ok)).toBe(true);
    expect(answered).toBeGreaterThanOrEqual(2);   // dwie doby: co najmniej po karcie na dzień
    expect(log(s)).toHaveLength(issued + answered);
    const replayed = replayRun(s.run!.record, s.econ.minute);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(s.econ));
  });

  it('sesja z zapisu nie ma dziennika; markOffLog wyłącza dziennik; RUN_LOG_MAX wyłącza dziennik', () => {
    const { fx } = recorder();
    const cmd: Command = { type: 'setOrder', auto: true };

    // z zapisu: polecenia działają, tylko nie ma gdzie ich zapisać
    saveSession(fresh());
    const loaded = createSession(SEED);
    expect(loaded.run).toBeNull();
    expect(dispatchCommand(loaded, cmd, fx).ok).toBe(true);
    expect(loaded.run).toBeNull();
    expect(withLayoutFromSeed(fresh()).run).toBeNull();   // układ przestawiony `relayout`: stan nie zaczyna się od świeżego sklepu

    // markOffLog: zmiana stanu spoza dziennika (nagroda powitalna, skip)
    const off = fresh();
    dispatchCommand(off, cmd, fx);
    expect(off.run!.record.log).toHaveLength(1);
    markOffLog(off);
    expect(off.run).toBeNull();
    expect(dispatchCommand(off, cmd, fx).ok).toBe(true);
    expect(off.run).toBeNull();

    // RUN_LOG_MAX: ostatni wpis mieści się, następny wyłącza dziennik (a polecenie i tak się wykonuje)
    const full = fresh();
    for (let i = 0; i < RUN_LOG_MAX - 1; i++) full.run!.record.log.push({ minute: OPEN_FROM, seq: i, cmd });
    full.run!.seq = RUN_LOG_MAX - 1;
    dispatchCommand(full, cmd, fx);
    expect(full.run!.record.log).toHaveLength(RUN_LOG_MAX);
    expect(full.run!.record.log.at(-1)!.seq).toBe(RUN_LOG_MAX - 1);
    expect(dispatchCommand(full, { type: 'setOrder', auto: false }, fx).ok).toBe(true);
    expect(full.run).toBeNull();
    expect(full.econ.order.auto).toBe(false);
  });
});

describe('kroki po poleceniu', () => {
  it('nieudane polecenie: toast error i dźwięk error, bez dźwięku sukcesu i bez zapisu', () => {
    const s = fresh();
    const rec = recorder();
    s.econ.cash = 0;
    const r = dispatchCommand(s, { type: 'buyUpgrade', id: UPGRADES[0]!.id }, rec.fx);

    expect(r).toEqual({ ok: false, text: 'Za mało gotówki.' });
    expect(rec.calls).toEqual([
      ['toast', 'Za mało gotówki.', 'error'],
      ['play', 'error'],
      ['handleEvents', []],
      ['refresh'],
    ]);   // żadnego 'persist' ani 'play' sukcesu (coins), choć buyUpgrade po sukcesie zapisuje
  });

  it('buyUpgrade ok: toast z tekstem, dźwięk coins i zapis', () => {
    const s = fresh();
    const rec = recorder();
    s.econ.cash = 1e6;
    const r = dispatchCommand(s, { type: 'buyUpgrade', id: UPGRADES[0]!.id }, rec.fx);

    expect(r.ok).toBe(true);
    expect(rec.names()).toEqual(['toast', 'play', 'handleEvents', 'persist', 'refresh']);
    expect(rec.calls[0]).toEqual(['toast', (r as { text: string }).text, 'ok']);
    expect(rec.calls[1]).toEqual(['play', 'coins']);
  });

  /** Karta widoczna od teraz; zwraca jej numer i odpowiedź zaznaczoną z góry. */
  function cardNow(s: GameSession): { seq: number; answer: number } {
    const card = s.econ.tycoon.cards.pending[0]!;
    card.showAt = s.econ.minute;
    return { seq: card.seq, answer: card.defaultAnswer };
  }

  it('answerCard ok: bez toastu (wynik idzie zdarzeniem card-result), dźwięk pop, zapis', () => {
    const s = fresh();
    const { seq, answer } = cardNow(s);
    const rec = recorder();
    const r = dispatchCommand(s, { type: 'answerCard', seq, answer }, rec.fx);

    expect(r.ok).toBe(true);
    expect(rec.names()).toEqual(['play', 'handleEvents', 'persist', 'refresh']);
    expect(rec.calls[0]).toEqual(['play', 'pop']);
    const events = rec.calls[1]![1] as EconEvent[];
    expect(events.map((e) => e.kind)).toContain('card-result');
    expect(log(s).at(-1)!.cmd).toEqual({ type: 'answerCard', seq, answer });
  });

  it('zła odpowiedź na kartę: toast error i dźwięk error, bez zapisu', () => {
    const s = fresh();
    const { seq } = cardNow(s);
    const rec = recorder();
    const r = dispatchCommand(s, { type: 'answerCard', seq, answer: 99 }, rec.fx);

    expect(r.ok).toBe(false);
    expect(rec.names()).toEqual(['toast', 'play', 'handleEvents', 'refresh']);
    expect(rec.calls[0]).toEqual(['toast', 'Nie ma takiej odpowiedzi.', 'error']);
    expect(rec.calls[1]).toEqual(['play', 'error']);
  });

  it('stuknięcie przy karcie na biurku: odmowa z toastem i dźwiękiem błędu, wpis do dziennika jest', () => {
    const s = fresh();
    cardNow(s);
    s.econ.queue = 3;
    const rec = recorder();
    const r = dispatchCommand(s, { type: 'tapTill' }, rec.fx);

    expect(r).toEqual({ ok: false, text: 'Najpierw karta na biurku.' });
    expect(rec.calls[0]).toEqual(['toast', 'Najpierw karta na biurku.', 'error']);
    expect(rec.calls[1]).toEqual(['play', 'error']);
    expect(s.econ.queue).toBe(3);
    expect(log(s)).toEqual([{ minute: OPEN_FROM, seq: 0, cmd: { type: 'tapTill' } }]);   // serwer odtwarzający zrobi to samo
  });

  it('tapTill ok: bez toastu, dźwięk cash', () => {
    const s = fresh();
    s.econ.queue = 3;
    const rec = recorder();
    const r = dispatchCommand(s, { type: 'tapTill' }, rec.fx);

    expect(r.ok).toBe(true);
    expect(rec.names()).toEqual(['play', 'buzz', 'handleEvents', 'refresh']);
    expect(rec.calls[0]).toEqual(['play', 'cash']);
    expect(rec.calls[1]).toEqual(['buzz', 8]);
  });

  describe('zdarzenia', () => {
    /** Zdarzenia, jakie to samo polecenie da na kopii stanu: to, co ma dojść do `handleEvents`. */
    const eventsOn = (s: GameSession, cmd: Command): EconEvent[] => applyCommand(structuredClone(s.econ), s.info, cmd).events;
    const received = (rec: ReturnType<typeof recorder>): EconEvent[][] => rec.named('handleEvents').map((c) => c[1] as EconEvent[]);

    it('stuknięcie w złotą paletę: zdarzenie golden z wyniku polecenia trafia do handleEvents', () => {
      const s = fresh();
      const pallet = s.econ.pallets[0]!;
      pallet.golden = true;
      for (const key of Object.keys(pallet.items) as (keyof typeof pallet.items)[]) pallet.items[key] = 0;
      pallet.items.napoje = 3;
      pallet.total = 3;
      const cmd: Command = { type: 'tapPallet', palletId: pallet.id };
      const expected = eventsOn(s, cmd);
      expect(expected.map((e) => e.kind)).toEqual(['golden']);

      const rec = recorder();
      const r = dispatchCommand(s, cmd, rec.fx);
      expect(r.ok).toBe(true);
      expect(received(rec)).toEqual([expected]);
      expect(rec.named('toast')).toEqual([]);   // tapPallet nie pokazuje toastu: złotą paletę pokazuje samo zdarzenie
    });

    it('odpowiedź na kartę, która daje poziom: zdarzenia card-result i levelup z wyniku polecenia trafiają do handleEvents', () => {
      const s = fresh();
      const { seq, answer } = cardNow(s);
      s.econ.xp = xpToNext(s.econ.level) - 1;   // XP za kartę (10) przeskakuje na nowy poziom
      const cmd: Command = { type: 'answerCard', seq, answer };
      const expected = eventsOn(s, cmd);
      expect(expected.map((e) => e.kind)).toContain('levelup');

      const rec = recorder();
      expect(dispatchCommand(s, cmd, rec.fx).ok).toBe(true);
      expect(received(rec)).toEqual([expected]);
      expect(s.econ.level).toBe(2);
    });
  });

  it('returnPallet: toast z tekstem, zaznaczenie czyszczone po poleceniu, także nieudanym', () => {
    const s = fresh();
    const ok = recorder();
    expect(dispatchCommand(s, { type: 'returnPallet', palletId: 1 }, ok.fx).ok).toBe(true);
    expect(ok.names()).toEqual(['toast', 'handleEvents', 'clearSelection', 'refresh']);
    expect(ok.calls[0]![2]).toBe('ok');

    const failed = recorder();
    expect(dispatchCommand(s, { type: 'returnPallet', palletId: 1 }, failed.fx).ok).toBe(false);   // palety już nie ma
    expect(failed.names()).toEqual(['toast', 'play', 'handleEvents', 'clearSelection', 'refresh']);
    expect(failed.calls[0]![2]).toBe('error');
  });

  it('polecenie z błędnym typem: odmowa i komunikat o błędzie, bez wyjątku', () => {
    const s = fresh();
    const rec = recorder();
    const r = dispatchCommand(s, { type: 'toString' } as unknown as Command, rec.fx);
    expect(r).toEqual({ ok: false, text: 'Nieznane polecenie.' });
    expect(rec.names()).toEqual(['toast', 'play', 'handleEvents', 'refresh']);
  });

  describe('remont', () => {
    /** Gracz z poziomem i gotówką na pierwszy remont (ustawione przed pierwszym wpisem dziennika, to test kroków, nie odtwarzania). */
    function readyForRemont(): GameSession {
      const s = fresh();
      s.econ.cash = 1e6;
      s.econ.level = 8;
      return s;
    }

    it('remont: układ sesji podmieniony, rebuildScene raz, zapis, zaznaczenie wyczyszczone przed', () => {
      const s = readyForRemont();
      const oldLayout = s.layout;
      const seen: { stage: string; level: number; remont: number; logged: number; layout: unknown; info: unknown }[] = [];
      const snapshot = (stage: string): void => {
        seen.push({ stage, level: s.layoutLevel, remont: s.econ.remontLevel, logged: log(s).length, layout: s.layout, info: s.info });
      };
      const rec = recorder({
        clearSelection: () => { rec.calls.push(['clearSelection']); snapshot('clearSelection'); },
        persist: () => { rec.calls.push(['persist']); snapshot('persist'); },
        rebuildScene: () => { rec.calls.push(['rebuildScene']); snapshot('rebuildScene'); },
      });
      const r = dispatchCommand(s, { type: 'startRemont' }, rec.fx);

      expect(r.ok).toBe(true);
      expect(s.econ.remontLevel).toBe(1);
      expect(s.layoutLevel).toBe(1);
      expect(s.layout).toEqual(layoutFor(SEED, 1));
      expect(s.layout).not.toEqual(oldLayout);
      expect(s.info.spots).toBeDefined();
      expect(s.run!.record.log).toEqual([{ minute: OPEN_FROM, seq: 0, cmd: { type: 'startRemont' } }]);

      // kolejność: zaznaczenie przed poleceniem, zapis i przebudowa już na nowym układzie, zapis tylko raz
      expect(rec.names()).toEqual(['clearSelection', 'toast', 'handleEvents', 'persist', 'rebuildScene', 'refresh']);
      expect(rec.named('persist')).toHaveLength(1);
      expect(rec.named('rebuildScene')).toHaveLength(1);
      expect(seen.map((x) => [x.stage, x.level])).toEqual([['clearSelection', 0], ['persist', 1], ['rebuildScene', 1]]);
      // zaznaczenie schodzi jeszcze przed poleceniem: stan nie zmieniony przez `applyCommand` i nic w dzienniku
      expect(seen.map((x) => [x.stage, x.remont, x.logged])).toEqual([['clearSelection', 0, 0], ['persist', 1, 1], ['rebuildScene', 1, 1]]);
      expect(seen[0]!.layout).toBe(oldLayout);
      expect(seen[1]!.layout).toBe(s.layout);
      expect(seen[2]!.info).toBe(s.info);
    });

    it('rebuildScene rzuca: wynik ok, komunikat, zapis, bez wyjątku', () => {
      const s = readyForRemont();
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const boom = new Error('scena się nie zbudowała');
      const rec = recorder({ rebuildScene: () => { throw boom; } });
      let r: CommandResult | undefined;
      expect(() => { r = dispatchCommand(s, { type: 'startRemont' }, rec.fx); }).not.toThrow();

      expect(r!.ok).toBe(true);
      expect(rec.named('notice')).toEqual([['notice', REBUILD_NOTICE]]);
      expect(rec.named('persist')).toHaveLength(1);
      expect(rec.names().indexOf('persist')).toBeLessThan(rec.names().indexOf('notice'));   // postęp zapisany przed przebudową
      expect(rec.names().at(-1)).toBe('refresh');
      expect(errorLog).toHaveBeenCalledOnce();
      expect(errorLog.mock.calls[0]).toContain(boom);
      expect(s.layoutLevel).toBe(1);   // sesja ma nowy układ mimo błędu sceny
    });

    it('rebuildScene rzuca w sklepie tymczasowym: komunikat bez obietnicy zapisu, reszta jak w zwykłym', () => {
      const s = readyForRemont();
      s.ephemeral = true;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const rec = recorder({ rebuildScene: () => { throw new Error('scena się nie zbudowała'); } });

      expect(dispatchCommand(s, { type: 'startRemont' }, rec.fx).ok).toBe(true);

      expect(rec.named('notice')).toEqual([['notice', REBUILD_NOTICE_EPHEMERAL]]);
      expect(REBUILD_NOTICE_EPHEMERAL).not.toMatch(/zapisan/);   // ten sklep się nie zapisuje, więc tekst tego nie obiecuje
      expect(rec.names().at(-1)).toBe('refresh');
      expect(s.layoutLevel).toBe(1);
    });
  });
});

describe('tabela AFTER', () => {
  it('tabela AFTER ma wpis dla każdego COMMAND_TYPES', () => {
    expect(Object.keys(AFTER).sort()).toEqual([...COMMAND_TYPES].sort());
  });

  it('wartości z dzisiejszego main.ts', () => {
    expect(AFTER).toEqual({
      tapPallet: { okToast: false, sfx: 'tap', buzz: 8 },
      tapTill: { okToast: false, sfx: 'cash', buzz: 8 },
      movePallet: { okToast: true },
      returnPallet: { okToast: true, clearSelection: 'after' },
      setOrder: { okToast: false },
      setStaffProfile: { okToast: false },
      pinStaff: { okToast: false },
      hire: { okToast: false },
      fire: { okToast: false },
      buyUpgrade: { okToast: true, sfx: 'coins', persist: true },
      buyEquipment: { okToast: true, sfx: 'coins', persist: true },
      startRemont: { okToast: true, persist: true, clearSelection: 'before' },
      campaign: { okToast: true },
      rushRemont: { okToast: true },
      answerCard: { okToast: false, sfx: 'pop', persist: true },
    });
  });
});

// --- Powłoka gry: przepływy sklepu na atrapach sceny i efektów ---------------------------------------------------------

/** Atrapa sceny: zapisuje budowy sklepów. Seedy z `failing` „nie budują się” (jak wyjątek z `loadStore`, po którym scena jest pusta). */
class FakeScene implements ShellScene {
  seed: string | null = null;
  loads: { seed: string; session: GameSession | null }[] = [];
  syncs: boolean[] = [];
  looks: CashierLook[] = [];
  failing = new Set<string>();
  /** Żaden świat się nie buduje (renderer nie działa). */
  failAll = false;

  load(seed: string, session: GameSession | null): void {
    this.loads.push({ seed, session });
    if (this.failAll || this.failing.has(seed)) {
      this.seed = null;
      throw new Error(`świat „${seed}” się nie zbudował`);
    }
    this.seed = seed;
  }
  syncVisuals(_session: GameSession | null, force = false): void { this.syncs.push(force); }
  setCashierLook(look: CashierLook): void { this.looks.push(look); }
}

/** Wskazówki pierwszego dnia z atrapy (prawdziwe leżą w ui/game/overlays.tsx). */
const HINTS = ['wskazówka 1', 'wskazówka 2'];

interface Harness {
  shell: GameShell;
  scene: FakeScene;
  /** Efekty z rozruchu powłoki (`setSound`, `setVibration`). */
  startup: Call[];
  /** Efekty po rozruchu w kolejności wywołań (`play`, `confetti`, `setSound`…). */
  calls: Call[];
  /** Seedy zapisane do adresu strony. */
  urls: string[];
  /** Komunikaty dla gracza (`notice`). */
  notices: string[];
}

/** Powłoka na atrapach; `seeds` to kolejne losowania `randomSeed`. */
function harness(options: { meta?: Meta; benchMode?: boolean; seeds?: string[] } = {}): Harness {
  const calls: Call[] = [];
  const urls: string[] = [];
  const notices: string[] = [];
  const scene = new FakeScene();
  const seeds = [...(options.seeds ?? ['losowy-1', 'losowy-2', 'losowy-3'])];
  const effects: ShellEffects = {
    play: (sfx) => { calls.push(['play', sfx]); },
    buzz: (pattern) => { calls.push(['buzz', pattern]); },
    confetti: (fx, fy, count) => { calls.push(['confetti', fx, fy, count]); },
    notice: (text) => { notices.push(text); },
    setSound: (on) => { calls.push(['setSound', on]); },
    setVibration: (on) => { calls.push(['setVibration', on]); },
    floater: (x, y, text, kind) => { calls.push(['floater', x, y, text, kind]); },
  };
  const shell = createShell({
    meta: options.meta ?? loadMeta(), benchMode: options.benchMode ?? false, scene, effects,
    randomSeed: () => seeds.shift() ?? 'zapas',
    writeSeedToUrl: (seed) => { urls.push(seed); },
    characterFactory: () => Promise.resolve({} as CharacterFactory),
    firstDayHints: HINTS,
  });
  const startup = calls.splice(0);
  return { shell, scene, startup, calls, urls, notices };
}

/** Otwiera sklep tak, jak robi to rozruch w main.ts (sesja i świat), i zeruje ślady, żeby test widział tylko to, co po nim. */
function open(h: Harness, seed = SEED): GameSession {
  const session = createSession(seed, true);
  h.shell.session = session;
  h.scene.load(seed, session);
  ui.seed.value = seed;
  h.scene.loads.length = 0;
  h.scene.syncs.length = 0;
  h.calls.length = 0;
  return session;
}

const savedMeta = (): Meta => JSON.parse(storage.getItem('traszka:meta')!) as Meta;

describe('powłoka gry (createShell)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 9, 28, 12, 0, 0) });
    ui.welcome.value = null;
    ui.report.value = null;
    ui.celebration.value = null;
    ui.start.value = null;
    ui.selection.value = null;
    ui.tab.value = null;
    ui.showSettings.value = false;
    ui.toasts.value = [];
    ui.story.value = [];
    ui.econ.value = null;
    ui.ephemeral.value = false;
    ui.seed.value = '';
  });
  afterEach(() => { vi.useRealTimers(); ui.story.value = []; });

  describe('rozruch', () => {
    it('dźwięk i wibracja z mety, widok mety dla interfejsu, bez komunikatu', () => {
      const meta: Meta = {
        ...loadMeta(), sound: false, vibration: true, partnerPoints: 3,
        network: [{ seed: 'a', income: 300, level: 5, margin: 10 }, { seed: 'b', income: 200, level: 4, margin: 5 }],
      };
      const h = harness({ meta });
      expect(h.startup).toEqual([['setSound', false], ['setVibration', true]]);
      expect(h.notices).toEqual([]);
      expect(ui.metaView.value).toEqual({ points: 3, stores: 2, networkIncome: 500, network: ['a', 'b'], sound: false, vibration: true });
    });

    it('meta z nowszej wersji gry: komunikat o odświeżeniu strony', () => {
      const h = harness({ meta: { ...loadMeta(), readOnly: true } });
      expect(h.notices).toEqual([NEWER_SAVE_NOTICE]);
    });
  });

  describe('persist i publish', () => {
    it('persist bez sesji nic nie robi; z sesją zapisuje sklep i metę z czasem wyjścia', () => {
      const h = harness();
      h.shell.persist();
      expect(storage.keys()).toEqual([]);

      const s = open(h);
      h.shell.persist();
      expect(hasStoredSave(s.seed)).toBe(true);
      expect(savedMeta().lastSeen).toBe(Date.now());
    });

    it('czas wyjścia stoi w miejscu, gdy czeka okno powitalne albo sklep jest tymczasowy', () => {
      const h = harness();
      open(h);
      ui.welcome.value = { hours: 2, offline: 100, streak: 1, daily: null };
      h.shell.persist();
      expect(savedMeta().lastSeen).toBe(0);   // zarobek z nieobecności czeka na „Odbierz!”

      const other = harness();
      const s = open(other, 'traszka-tymczasowy');
      s.ephemeral = true;
      ui.welcome.value = null;
      other.shell.persist();
      expect(hasStoredSave(s.seed)).toBe(false);   // sklepu tymczasowego nie zapisuje nic
      expect(savedMeta().lastSeen).toBe(0);
    });

    it('publish: stan i opis sklepu dla interfejsu, wersja rośnie; sklep tymczasowy zapala flagę', () => {
      const h = harness();
      h.shell.publish();
      expect(ui.econ.value).toBeNull();   // bez sesji nic nie ma do pokazania

      const s = open(h);
      h.shell.publish();
      const first = ui.econ.value!;
      expect(first.s).toBe(s.econ);
      expect(first.info).toBe(s.info);
      s.ephemeral = true;
      h.shell.publish();
      expect(ui.econ.value!.v).toBe(first.v + 1);
      expect(ui.ephemeral.value).toBe(true);
    });
  });

  describe('open (rozruch: pierwszy sklep)', () => {
    afterEach(() => { ui.showHints([]); });

    it('nowa gra: sesja i świat, adres, wskazówki pierwszego dnia, bez okna powitalnego, zapis', () => {
      const h = harness();
      expect(h.shell.open({ seed: 'traszka-1', fresh: false, choice: null })).toBe(true);

      const s = h.shell.session!;
      expect(s.seed).toBe('traszka-1');
      expect(s.fromSave).toBe(false);
      expect(h.scene.loads).toEqual([{ seed: 'traszka-1', session: s }]);
      expect(h.urls).toEqual(['traszka-1']);
      expect(ui.seed.value).toBe('traszka-1');
      expect(ui.econ.value!.s).toBe(s.econ);
      expect(ui.hints.value).toEqual(HINTS);   // pierwszy dzień: krótkie dymki zamiast okna powitalnego
      expect(ui.welcome.value).toBeNull();
      expect(hasStoredSave('traszka-1')).toBe(true);
      expect(h.notices).toEqual([]);
    });

    it('zapis sprzed dłuższej nieobecności: okno „Witaj z powrotem” z zarobkiem, bez wskazówek; nic nie jest odebrane', () => {
      const old = createSession('traszka-1', true);
      for (let i = 0; i < 30; i++) stepMinute(old.econ, old.info, []);
      old.econ.lastDayProfit = 1000;
      saveSession(old);
      const meta: Meta = { ...loadMeta(), lastSeen: Date.now() - 5 * 3_600_000 };
      const h = harness({ meta });

      expect(h.shell.open({ seed: 'traszka-1', fresh: false, choice: null })).toBe(true);

      const s = h.shell.session!;
      expect(s.fromSave).toBe(true);
      expect(s.econ.minute).toBe(OPEN_FROM + 30);
      expect(ui.hints.value).toEqual([]);
      expect(ui.welcome.value).toMatchObject({ offline: 1250, streak: 1 });
      expect(s.econ.cash).toBe(old.econ.cash);   // nagroda czeka na „Odbierz!”
      expect(h.shell.meta.lastSeen).toBe(meta.lastSeen);   // czas wyjścia stoi, dopóki okno czeka
    });

    it('`fresh` (`?new=1`) pomija zapis; bez niego seed z zapisem wczytuje ten zapis', () => {
      const saved = createSession('traszka-1', true);
      saved.econ.cash = 4242;
      saveSession(saved);

      const loaded = harness();
      loaded.shell.open({ seed: 'traszka-1', fresh: false, choice: null });
      expect(loaded.shell.session!.econ.cash).toBe(4242);

      const fresh = harness();
      fresh.shell.open({ seed: 'traszka-1', fresh: true, choice: null });
      expect(fresh.shell.session!.fromSave).toBe(false);
      expect(fresh.shell.session!.econ.cash).not.toBe(4242);
    });

    it('wybór z ekranu startowego: nigdy świeża gra, a komunikat wyboru idzie do toastu tylko, gdy zapis się wczytał', () => {
      const saved = createSession('stary', true);
      saved.econ.cash = 4242;
      saveSession(saved);
      const look = { outfit: 'normal', appearanceSeed: 'abc' } as unknown as CashierLook;
      const choice = { nick: 'Kasia', seed: 'stary', look, specialOutfits: true, notice: 'Wczytujemy Twój sklep spod tego seeda' };

      const h = harness();
      h.shell.open({ seed: 'stary', fresh: true, choice });   // `fresh` z adresu nie ma tu znaczenia: wybór gracza nie nadpisze zapisu
      expect(h.shell.session!.fromSave).toBe(true);
      expect(h.shell.session!.econ.cash).toBe(4242);
      expect(ui.toasts.value.map((t) => t.text)).toEqual(['Wczytujemy Twój sklep spod tego seeda']);
    });

    it('świat zapisanego sklepu się nie buduje: sklep tymczasowy o losowym seedzie, adres zostaje, komunikat o bezpiecznym zapisie', () => {
      saveSession(createSession('traszka-1', true));
      const h = harness({ seeds: ['losowy-1'] });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add('traszka-1');

      expect(h.shell.open({ seed: 'traszka-1', fresh: false, choice: null })).toBe(true);

      expect(h.shell.session!.seed).toBe('losowy-1');
      expect(h.shell.session!.ephemeral).toBe(true);
      expect(h.urls).toEqual([]);   // odświeżenie wraca do sklepu gracza, a nie do zastępczego
      expect(h.notices).toEqual(['Nie udało się zbudować Twojego sklepu — zapis jest bezpieczny, spróbuj odświeżyć stronę']);
      expect(hasStoredSave('losowy-1')).toBe(false);
      expect(ui.ephemeral.value).toBe(true);
    });

    it('zapis z nowszej wersji gry: sklep tymczasowy na tym samym seedzie wpisuje adres; komunikat o zapisie zostaje', () => {
      storage.setItem('traszka:save:nowszy', JSON.stringify({ schema: 99, seed: 'nowszy' }));
      const h = harness();
      expect(h.shell.open({ seed: 'nowszy', fresh: false, choice: null })).toBe(true);
      expect(h.shell.session!.ephemeral).toBe(true);
      expect(h.urls).toEqual(['nowszy']);
      expect(h.notices).toEqual([NEWER_SAVE_NOTICE]);
      expect(ui.welcome.value).toBeNull();   // sklep tymczasowy nie dostaje nagród
      expect(storage.getItem('traszka:save:nowszy')).toContain('"schema":99');
    });

    it('żaden sklep się nie buduje: false i komunikat, zapis nietknięty, adres bez zmian', () => {
      saveSession(createSession('traszka-1', true));
      const before = storage.getItem('traszka:save:traszka-1');
      const h = harness();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failAll = true;

      expect(h.shell.open({ seed: 'traszka-1', fresh: false, choice: null })).toBe(false);

      expect(h.notices).toEqual(['Nie udało się zbudować Twojego sklepu — zapis jest bezpieczny, spróbuj odświeżyć stronę']);
      expect(h.urls).toEqual([]);
      expect(storage.getItem('traszka:save:traszka-1')).toBe(before);
      expect(ui.econ.value).toBeNull();
    });
  });

  describe('setSeed', () => {
    it('udane przejście: zapis poprzedniego, nowa sesja, świat, adres, seed w interfejsie', () => {
      const h = harness();
      const old = open(h, 'traszka-1');
      const r = h.shell.setSeed('traszka-2');

      expect(r).toBe(true);
      expect(hasStoredSave('traszka-1')).toBe(true);   // obecny sklep zapisany przed przejściem
      expect(h.shell.session).not.toBe(old);
      expect(h.shell.session!.seed).toBe('traszka-2');
      expect(h.shell.session!.fromSave).toBe(false);
      expect(h.scene.loads).toEqual([{ seed: 'traszka-2', session: h.shell.session }]);
      expect(h.urls).toEqual(['traszka-2']);
      expect(ui.seed.value).toBe('traszka-2');
      expect(ui.econ.value!.s).toBe(h.shell.session!.econ);
      expect(hasStoredSave('traszka-2')).toBe(true);   // nowy sklep zapisany od razu
      expect(h.notices).toEqual([]);
    });

    it('świat nowego sklepu się nie buduje: wraca poprzedni sklep, adres się nie zmienia, gracz dostaje komunikat', () => {
      const h = harness();
      const old = open(h, 'traszka-1');
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add('zepsuty');
      ui.selection.value = { kind: 'till' };

      expect(h.shell.setSeed('zepsuty')).toBe(false);

      expect(h.shell.session).toBe(old);   // sesja poprzedniego sklepu, ta sama
      expect(h.scene.loads.map((l) => l.seed)).toEqual(['zepsuty', 'traszka-1']);   // próba, potem odtworzenie poprzedniego
      expect(h.scene.loads[1]!.session).toBe(old);
      expect(h.scene.seed).toBe('traszka-1');
      expect(h.urls).toEqual([]);   // adres zmienia się dopiero, gdy świat stoi
      expect(ui.seed.value).toBe('traszka-1');
      expect(ui.selection.value).toBeNull();
      expect(h.notices).toEqual(['Nie udało się otworzyć sklepu „zepsuty”. Zostajesz w poprzednim.']);
      expect(hasStoredSave('zepsuty')).toBe(false);
      expect(errorLog).toHaveBeenCalledOnce();
    });

    it('odtworzenie poprzedniego sklepu też się nie udaje: false, komunikat, sesja poprzednia, bez wyjątku', () => {
      const h = harness();
      const old = open(h, 'traszka-1');
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add('zepsuty').add('traszka-1');

      expect(() => h.shell.setSeed('zepsuty')).not.toThrow();
      expect(h.shell.setSeed('zepsuty')).toBe(false);
      expect(h.shell.session).toBe(old);
      expect(h.urls).toEqual([]);
      expect(h.notices).toHaveLength(2);
      expect(errorLog).toHaveBeenCalledTimes(4);   // dwa razy: nowy sklep i odtworzenie poprzedniego
    });

    it('świeża gra (fresh), której świat się nie buduje: zostaje poprzedni sklep i adres, nic nie zapisano pod nowym seedem', () => {
      const h = harness();
      const old = open(h, 'traszka-1');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add('zepsuty');
      expect(h.shell.setSeed('zepsuty', true)).toBe(false);
      expect(h.shell.session).toBe(old);
      expect(h.urls).toEqual([]);
      expect(hasStoredSave('zepsuty')).toBe(false);
    });

    it('generator nie daje sklepu dla seeda (createSession rzuca): zostaje poprzedni sklep z odtworzoną sceną, komunikat, adres bez zmian', () => {
      const h = harness();
      const old = open(h, 'traszka-1');
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const generatorError = new Error('generateStore: brak poprawnego układu');
      const realLayoutFor = layoutModule.layoutFor;
      vi.spyOn(layoutModule, 'layoutFor').mockImplementation((seed, level) => {
        if (seed === 'bez-generatora') throw generatorError;   // tak rzuca generator po dziesięciu nieudanych próbach
        return realLayoutFor(seed, level);
      });

      expect(h.shell.setSeed('bez-generatora', true)).toBe(false);

      expect(h.shell.session).toBe(old);   // sesja nowego sklepu nie powstała
      expect(h.scene.loads).toEqual([{ seed: 'traszka-1', session: old }]);   // nowego świata nie próbowano; poprzedni zbudowany od nowa
      expect(h.scene.seed).toBe('traszka-1');
      expect(h.urls).toEqual([]);
      expect(ui.seed.value).toBe('traszka-1');
      expect(h.notices).toEqual(['Nie udało się otworzyć sklepu „bez-generatora”. Zostajesz w poprzednim.']);
      expect(hasStoredSave('traszka-1')).toBe(true);   // poprzedni sklep zapisany przed przejściem
      expect(hasStoredSave('bez-generatora')).toBe(false);
      expect(errorLog).toHaveBeenCalledOnce();
      expect(errorLog.mock.calls[0]).toContain(generatorError);
    });

    it('nowy sklep z `ephemeral` jest tymczasowy: nic go nie zapisze', () => {
      const h = harness();
      open(h, 'traszka-1');
      expect(h.shell.setSeed('traszka-9', true, true)).toBe(true);
      expect(h.shell.session!.ephemeral).toBe(true);
      expect(ui.ephemeral.value).toBe(true);
      expect(hasStoredSave('traszka-9')).toBe(false);
    });

    it('komunikat o zapisie nowego sklepu idzie do gracza po udanym przejściu', () => {
      const h = harness();
      open(h, 'traszka-1');
      storage.setItem('traszka:save:nowszy', JSON.stringify({ schema: 99, seed: 'nowszy' }));   // zapis z nowszej wersji gry
      expect(h.shell.setSeed('nowszy')).toBe(true);
      expect(h.shell.session!.ephemeral).toBe(true);
      expect(h.notices).toEqual([NEWER_SAVE_NOTICE]);
      expect(storage.getItem('traszka:save:nowszy')).toContain('"schema":99');   // cudzy zapis nietknięty
    });

    it('benchmark: sesji nie ma, świat idzie z samego seeda', () => {
      const h = harness({ benchMode: true });
      expect(h.shell.setSeed('bench-2')).toBe(true);
      expect(h.shell.session).toBeNull();
      expect(h.scene.loads).toEqual([{ seed: 'bench-2', session: null }]);
    });
  });

  describe('openNextStore (kolejna Traszka)', () => {
    /** Sklep z zarobkiem, który po zamknięciu da 2 Punkty Partnera i 500 zł dochodu z sieci. */
    function profitable(h: Harness): GameSession {
      const s = open(h, 'traszka-1');
      s.econ.total.margin = 80_000;
      s.econ.bestDayProfit = 5000;
      saveSession(s);
      return s;
    }

    it('zamyka sklep w sieci i otwiera nowy z premią, z zapisem sieci i nowego sklepu', () => {
      const h = harness({ seeds: ['nowy-1'] });
      const closed = profitable(h);
      h.shell.game.openNextStore();

      expect(h.shell.meta.network).toEqual([{ seed: 'traszka-1', income: 500, level: closed.econ.level, margin: 80_000 }]);
      expect(h.shell.meta.partnerPoints).toBe(2);
      expect(closed.retired).toBe(true);
      expect(hasStoredSave('traszka-1')).toBe(false);   // zamknięty sklep nie wróci z zapisu
      expect(h.shell.session!.seed).toBe('nowy-1');
      expect(h.shell.session).not.toBe(closed);
      expect(h.shell.session!.econ.partner).toEqual({ points: 2, networkIncome: 500, stores: 1 });
      expect(h.scene.loads).toEqual([{ seed: 'nowy-1', session: h.shell.session }]);
      expect(h.urls).toEqual(['nowy-1']);
      expect(hasStoredSave('nowy-1')).toBe(true);
      expect(savedMeta().network.map((n) => n.seed)).toEqual(['traszka-1']);   // sieć zapisana w pamięci przeglądarki
      expect(savedMeta().partnerPoints).toBe(2);
      expect(ui.metaView.value).toMatchObject({ points: 2, stores: 1, networkIncome: 500, network: ['traszka-1'] });
      expect(ui.celebration.value).toEqual({
        title: 'NOWA TRASZKA!',
        subtitle: 'Sieć: 1 sklep · 2 Punktów Partnera',
        lines: [`Dochód z sieci: ${(500).toLocaleString('pl-PL')} zł dziennie`],
      });
      expect(h.calls).toEqual([['play', 'levelup'], ['confetti', undefined, undefined, undefined]]);
      expect(ui.tab.value).toBeNull();
    });

    it('seed nowego sklepu jest wolny: pomija zapisy i sklepy z sieci', () => {
      const h = harness({ seeds: ['traszka-2', 'traszka-1', 'wolny'] });
      h.shell.meta.network.push({ seed: 'traszka-2', income: 200, level: 3, margin: 1 });
      saveSession(createSession('traszka-3', true));
      profitable(h);
      h.shell.game.openNextStore();
      expect(h.shell.session!.seed).toBe('wolny');   // 'traszka-2' jest w sieci, 'traszka-1' ma zapis (zamykanego sklepu)
    });

    it('nowy sklep się nie otwiera: sieć, zapis i sesja wracają na miejsce, bez fety', () => {
      const h = harness({ seeds: ['nowy-1'] });
      const closed = profitable(h);
      const before = h.shell.meta;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add('nowy-1');

      h.shell.game.openNextStore();

      expect(h.shell.meta).toBe(before);
      expect(h.shell.meta.network).toEqual([]);
      expect(h.shell.meta.partnerPoints).toBe(0);
      expect(closed.retired).toBe(false);
      expect(h.shell.session).toBe(closed);
      expect(hasStoredSave('traszka-1')).toBe(true);   // zapis przywrócony (`reviveSession`)
      expect(ui.celebration.value).toBeNull();
      expect(h.urls).toEqual([]);
      expect(h.notices).toEqual(['Nie udało się otworzyć sklepu „nowy-1”. Zostajesz w poprzednim.']);
      expect(h.scene.seed).toBe('traszka-1');
    });

    it('sklep tymczasowy albo meta tylko do odczytu: komunikat zamiast zamykania sklepu', () => {
      const h = harness();
      const s = profitable(h);
      s.ephemeral = true;
      h.shell.game.openNextStore();
      expect(h.shell.session).toBe(s);
      expect(h.shell.meta.network).toEqual([]);
      expect(s.retired).toBe(false);
      expect(h.notices).toEqual(['Kolejną Traszkę otworzysz po odświeżeniu strony: ta karta nie może teraz zapisać sieci sklepów.']);

      const readOnly = harness({ meta: { ...loadMeta(), readOnly: true } });
      const t = open(readOnly, 'traszka-4');
      readOnly.shell.game.openNextStore();
      expect(readOnly.shell.session).toBe(t);
      expect(readOnly.notices).toHaveLength(2);   // komunikat o nowszej mecie z rozruchu i ten o sieci
    });

    it('bez sesji nic się nie dzieje', () => {
      const h = harness();
      h.shell.game.openNextStore();
      expect(h.shell.session).toBeNull();
      expect(h.calls).toEqual([]);
    });
  });

  describe('claimWelcome (odbiór nagrody po nieobecności)', () => {
    it('daje zarobek i premię dzienną, przesuwa serię dni i wyłącza dziennik biegu', () => {
      const h = harness();
      const s = open(h);
      expect(s.run).not.toBeNull();
      const cash = s.econ.cash;
      const ogonki = s.econ.ogonki;
      ui.welcome.value = { hours: 3, offline: 1234, streak: 4, daily: { cash: 500, ogonki: 7 } };

      h.shell.game.claimWelcome();

      expect(s.run).toBeNull();   // stan zmienił się poza poleceniami: dziennik już go nie odtworzy
      expect(s.econ.cash).toBe(cash + 1234 + 500);
      expect(s.econ.ogonki).toBe(ogonki + 7);
      expect(ui.welcome.value).toBeNull();
      expect(h.shell.meta.daily).toEqual({ date: '2026-10-28', streak: 4 });
      expect(savedMeta().daily).toEqual({ date: '2026-10-28', streak: 4 });
      expect(hasStoredSave(s.seed)).toBe(true);
      expect(h.calls).toEqual([['play', 'coins'], ['confetti', undefined, undefined, undefined]]);
      expect(h.scene.syncs).toEqual([true]);   // scena odświeżona od razu
      expect(ui.econ.value!.s).toBe(s.econ);
      // polecenia po odbiorze nadal działają, tylko bez dziennika
      expect(h.shell.game.dispatch({ type: 'setOrder', auto: false }).ok).toBe(true);
      expect(s.run).toBeNull();
    });

    it('sam zarobek bez premii dziennej nie rusza serii dni', () => {
      const h = harness();
      const s = open(h);
      const cash = s.econ.cash;
      ui.welcome.value = { hours: 1, offline: 80, streak: null, daily: null };
      h.shell.game.claimWelcome();
      expect(s.econ.cash).toBe(cash + 80);
      expect(h.shell.meta.daily).toEqual({ date: '', streak: 0 });
      expect(s.run).toBeNull();
    });

    it('bez okna powitalnego albo bez sesji: nic nie odbiera, dziennik zostaje', () => {
      const h = harness();
      const s = open(h);
      h.shell.game.claimWelcome();
      expect(s.run).not.toBeNull();
      expect(h.calls).toEqual([]);

      const empty = harness();
      ui.welcome.value = { hours: 1, offline: 80, streak: null, daily: null };
      empty.shell.game.claimWelcome();
      expect(ui.welcome.value).toBeNull();   // okno zamyka się zawsze
      expect(empty.calls).toEqual([]);
    });

    it('poziom, który czekał na przeliczenie, wchodzi po odbiorze (settleOutsideCommand) i dostaje fetę', () => {
      const h = harness();
      const s = open(h);
      s.econ.xp = xpToNext(s.econ.level);
      ui.welcome.value = { hours: 1, offline: 50, streak: null, daily: null };
      h.shell.game.claimWelcome();
      expect(s.econ.level).toBe(2);
      expect(ui.celebration.value!.title).toBe('POZIOM 2');
      expect(h.calls.map((c) => c[0])).toEqual(['play', 'confetti', 'play', 'buzz', 'confetti']);   // coins i konfetti odbioru, potem feta poziomu
    });
  });

  describe('skip, restart, nowy sklep, ustawienia', () => {
    it('skip przewija minuty, wyłącza dziennik i odświeża scenę oraz interfejs', () => {
      const h = harness();
      const s = open(h);
      h.shell.skip(10);
      expect(s.econ.minute).toBe(OPEN_FROM + 10);
      expect(s.run).toBeNull();
      expect(h.scene.syncs).toEqual([true]);
      expect(ui.econ.value!.s).toBe(s.econ);
      expect(() => harness().shell.skip(10)).not.toThrow();   // bez sesji nic
    });

    it('skip staje na karcie decyzji i nie przewija dalej, póki gracz nie odpowie', () => {
      const h = harness();
      const s = open(h);
      const first = [...s.econ.tycoon.cards.pending].sort((a, b) => a.showAt - b.showAt)[0]!;
      h.shell.skip(MINUTES_PER_DAY);
      expect(awaitingDecision(s.econ)).toBe(true);
      expect(s.econ.minute).toBe(first.showAt);
      const stopped = JSON.stringify(s.econ);
      h.shell.skip(60);
      expect(JSON.stringify(s.econ)).toBe(stopped);   // nic się nie zmieniło: ani minuta, ani stan
      expect(s.run).toBeNull();
      expect(ui.toasts.value.some((t) => t.kind === 'card' && t.text === cardDef(first.id)!.title)).toBe(true);
      // po odpowiedzi skip rusza dalej
      for (const c of visibleCards(s.econ.tycoon.cards, s.econ.minute)) h.shell.game.dispatch({ type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
      h.shell.skip(5);
      expect(s.econ.minute).toBe(first.showAt + 5);
    });

    it('restart: kasuje zapis i zaczyna ten sam seed od nowa, zamyka raport', () => {
      const h = harness();
      const s = open(h, 'traszka-1');
      s.econ.cash = 777_777;
      saveSession(s);
      ui.report.value = { label: 'x', counters: s.econ.total, profit: 0, cash: 0, comment: '', detail: null };

      h.shell.game.restart();

      expect(ui.report.value).toBeNull();
      expect(h.shell.session).not.toBe(s);
      expect(h.shell.session!.seed).toBe('traszka-1');
      expect(h.shell.session!.econ.cash).not.toBe(777_777);
      expect(h.shell.session!.fromSave).toBe(false);
      expect(h.scene.loads.map((l) => l.seed)).toEqual(['traszka-1']);
    });

    it('restart w sklepie tymczasowym zostawia cudzy zapis, a świeża gra też jest tymczasowa', () => {
      const h = harness();
      const s = open(h, 'traszka-1');
      s.ephemeral = true;
      storage.setItem('traszka:save:traszka-1', '{"schema":99}');
      h.shell.game.restart();
      expect(storage.getItem('traszka:save:traszka-1')).toBe('{"schema":99}');
      expect(h.shell.session!.ephemeral).toBe(true);
    });

    it('newStore: ekran startowy w trybie „new” z wolnym seedem; zatwierdzenie otwiera sklep, zapisuje gracza i wygląd kasjera', () => {
      const h = harness({ seeds: ['zajety', 'wolny-1'] });
      saveSession(createSession('zajety', true));
      const old = open(h, 'traszka-1');
      ui.showSettings.value = true;
      ui.tab.value = 'palety';
      ui.selection.value = { kind: 'till' };

      h.shell.game.newStore();

      expect(ui.showSettings.value).toBe(false);
      expect(ui.tab.value).toBeNull();
      expect(ui.selection.value).toBeNull();
      const request = ui.start.value!;
      expect(request.mode).toBe('new');
      expect(request.form.seed).toBe('wolny-1');   // 'zajety' ma zapis, więc losowanie szuka dalej
      expect(h.scene.loads).toEqual([]);   // gra czeka pod ekranem

      const look: CashierLook = { outfit: 'normal', appearanceSeed: 'abc' } as unknown as CashierLook;
      request.onStart({ nick: 'Kasia', seed: 'traszka-5', look, specialOutfits: false, notice: null });

      expect(h.shell.meta.player).toEqual({ nick: 'Kasia', look: { outfit: look.outfit, appearanceSeed: look.appearanceSeed }, specialOutfits: false });
      expect(savedMeta().player!.nick).toBe('Kasia');
      expect(h.scene.looks).toEqual([look]);   // wygląd idzie do sceny przed budową sklepu
      expect(h.scene.looks[0]).toBe(look);
      expect(h.shell.session).not.toBe(old);
      expect(h.shell.session!.seed).toBe('traszka-5');
      expect(h.urls).toEqual(['traszka-5']);
    });

    it('newStore w benchmarku nie robi nic', () => {
      const h = harness({ benchMode: true });
      ui.showSettings.value = true;
      h.shell.game.newStore();
      expect(ui.start.value).toBeNull();
      expect(ui.showSettings.value).toBe(true);
    });

    it('wybór sklepu z zapisem wczytuje ten zapis (nigdy świeża gra), a komunikat wyboru idzie do toastu', () => {
      const h = harness();
      open(h, 'traszka-1');
      const saved = createSession('stary', true);
      saved.econ.cash = 4242;
      saveSession(saved);
      h.shell.game.newStore();
      const look = ui.start.value!.form.look;
      ui.start.value!.onStart({ nick: 'Kasia', seed: 'stary', look, specialOutfits: true, notice: 'Wczytujemy Twój sklep spod tego seeda' });
      expect(h.shell.session!.fromSave).toBe(true);
      expect(h.shell.session!.econ.cash).toBe(4242);
      expect(ui.toasts.value.map((t) => t.text)).toEqual(['Wczytujemy Twój sklep spod tego seeda']);
    });

    it('setSound i setVibration: meta w pamięci i w zapisie, efekt, widok mety', () => {
      const h = harness();
      h.shell.game.setSound(false);
      h.shell.game.setVibration(false);
      expect(h.calls).toEqual([['setSound', false], ['setVibration', false]]);
      expect(h.shell.meta).toMatchObject({ sound: false, vibration: false });
      expect(savedMeta()).toMatchObject({ sound: false, vibration: false });
      expect(ui.metaView.value).toMatchObject({ sound: false, vibration: false });
    });

    it('generate (pole seeda w ⚙) otwiera sklep tak jak ekran startowy; randomize losuje nowy seed', () => {
      const h = harness({ seeds: ['los-1'] });
      open(h, 'traszka-1');
      h.shell.generate('traszka-7');
      expect(h.shell.session!.seed).toBe('traszka-7');
      h.shell.randomize();
      expect(h.shell.session!.seed).toBe('los-1');
    });
  });

  describe('polecenia i zdarzenia', () => {
    it('dispatch bez sesji to odmowa z pustym tekstem', () => {
      expect(harness().shell.game.dispatch({ type: 'hire' })).toEqual({ ok: false, text: '' });
    });

    it('dispatch przechodzi przez dispatchCommand: dziennik, dźwięk, zapis i odświeżenie sceny', () => {
      const h = harness();
      const s = open(h);
      s.econ.queue = 2;
      expect(h.shell.game.dispatch({ type: 'tapTill' }).ok).toBe(true);
      expect(s.run!.record.log.map((e) => e.cmd.type)).toEqual(['tapTill']);
      expect(h.calls).toEqual([['play', 'cash'], ['buzz', 8]]);
      expect(h.scene.syncs).toEqual([true]);
      expect(ui.econ.value!.s).toBe(s.econ);
    });

    it('remont przez dispatch przebudowuje scenę z nowego układu sesji', () => {
      const h = harness();
      const s = open(h);
      s.econ.cash = 1e6;
      s.econ.level = 8;
      const before = s.layout;
      expect(h.shell.game.dispatch({ type: 'startRemont' }).ok).toBe(true);
      expect(s.layout).not.toBe(before);
      expect(h.scene.loads).toEqual([{ seed: s.seed, session: s }]);   // jedna przebudowa, na sesji po remoncie
      expect(hasStoredSave(s.seed)).toBe(true);
    });

    it('przebudowa po remoncie, która rzuca: komunikat o odświeżeniu, wynik ok', () => {
      const h = harness();
      const s = open(h);
      s.econ.cash = 1e6;
      s.econ.level = 8;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add(s.seed);
      expect(h.shell.game.dispatch({ type: 'startRemont' }).ok).toBe(true);
      expect(h.notices).toEqual([REBUILD_NOTICE]);
    });

    it('przebudowa po remoncie, która rzuca, w sklepie tymczasowym: komunikat o tymczasowym sklepie, nic nie zapisane', () => {
      const h = harness();
      const s = open(h);
      s.ephemeral = true;
      s.econ.cash = 1e6;
      s.econ.level = 8;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add(s.seed);
      expect(h.shell.game.dispatch({ type: 'startRemont' }).ok).toBe(true);
      expect(h.notices).toEqual([REBUILD_NOTICE_EPHEMERAL]);
      expect(hasStoredSave(s.seed)).toBe(false);   // odświeżenie nie przywróci tego sklepu, więc komunikat nie mówił o zapisie
    });

    it('handleEvents: dzień zapisuje, raport miesiąca idzie do interfejsu, reszta do toastów z dźwiękiem', () => {
      const h = harness();
      const s = open(h);
      const report = { label: 'wrzesień', counters: s.econ.total, profit: 1, cash: 2, comment: 'ok', detail: null };
      h.shell.handleEvents([
        { kind: 'day', text: 'Dzień' },
        { kind: 'month', text: 'Miesiąc', report },
        { kind: 'delivery', text: 'Dostawa' },
        { kind: 'warning', text: 'Uwaga' },
        { kind: 'info', text: 'Info' },
      ]);
      expect(hasStoredSave(s.seed)).toBe(true);   // zdarzenie dnia zapisuje, bez toastu
      expect(ui.report.value).toBe(report);
      expect(h.calls).toEqual([['play', 'delivery'], ['play', 'error']]);   // 'info' i 'month' nie mają dźwięku
      expect(ui.toasts.value.map((t) => t.text)).toEqual(['Uwaga', 'Info']);   // najwyżej dwa naraz, najnowsze
    });

    it('handleEvents: karta decyzji gra pop i dostaje toast, wynik karty to sam toast', () => {
      const h = harness();
      open(h);
      h.shell.handleEvents([{ kind: 'card', text: 'FEFO o 18:00' }]);
      expect(h.calls).toEqual([['play', 'pop']]);
      expect(ui.toasts.value.map((t) => [t.text, t.kind])).toEqual([['FEFO o 18:00', 'card']]);
      h.calls.length = 0;
      h.shell.handleEvents([{ kind: 'card-result', text: 'Naklejki przyklejone.' }]);
      expect(h.calls).toEqual([]);
      expect(ui.toasts.value.map((t) => t.text)).toContain('Naklejki przyklejone.');
    });

    it('handleEvents: wynik karty z premią Centrali dzwoni monetami, wynik bez premii zostaje samym toastem', () => {
      const h = harness();
      open(h);
      const premium = cardDef('okolnik-premia')!.answers[0]!.result;
      h.shell.handleEvents([{ kind: 'card-result', text: premium }]);
      expect(h.calls).toEqual([['play', 'coins']]);
      expect(ui.toasts.value.map((t) => t.text)).toContain(premium);
      h.calls.length = 0;
      h.shell.handleEvents([{ kind: 'card-result', text: 'Centrala przyjęła odmowę ze zrozumieniem.' }]);
      expect(h.calls).toEqual([]);
    });

    it('premię w wyniku karty rozpoznaje słowo „premi…”: w całej talii pojawia się tylko w odpowiedzi, która ją wypłaca', () => {
      // zdarzenie `card-result` niesie sam tekst, więc dźwięk monet zależy od brzmienia; ten test pilnuje, żeby talia go nie rozjechała
      const withWord: string[] = [];
      for (const def of [...DECK, ...CIRCULARS]) {
        def.answers.forEach((a, i) => {
          for (const text of [a.result, a.risk?.text ?? '']) if (/premi/i.test(text)) withWord.push(`${def.id}#${i}`);
        });
      }
      expect(withWord).toEqual(['okolnik-premia#0']);
    });

    it('handleEvents: nowy poziom z odblokowaniami to feta (baner, dźwięk, wibracja, konfetti) i okno „Poziom N” z listą, bez toastu', () => {
      const h = harness();
      open(h);
      h.shell.handleEvents([{ kind: 'levelup', text: 'Poziom 5! Nagroda: +500 zł i +3 Ogonków.', level: 5, unlocks: ['Ulotki', 'Kasa'] }]);
      expect(ui.celebration.value).toEqual({
        title: 'POZIOM 5',
        subtitle: expect.any(String) as string,
        lines: ['Nagroda: +500 zł i +3 Ogonków.', '🔓 Ulotki', '🔓 Kasa'],
      });
      expect(h.calls).toEqual([['play', 'levelup'], ['buzz', [30, 40, 30]], ['confetti', undefined, undefined, undefined]]);
      expect(ui.toasts.value).toEqual([]);
      expect(ui.story.value).toHaveLength(1);
      expect(ui.story.value[0]).toMatchObject({ title: 'Poziom 5', text: 'Nagroda: +500 zł i +3 Ogonków.\n🔓 Ulotki\n🔓 Kasa' });
      expect(isModalOpen()).toBe(true);   // gra czeka na „OK”
    });

    it('handleEvents: nowy poziom bez odblokowań to sama feta, gra się nie zatrzymuje', () => {
      const h = harness();
      open(h);
      h.shell.handleEvents([{ kind: 'levelup', text: 'Poziom 6! Nagroda: +100 zł.', level: 6, unlocks: [] }]);
      h.shell.handleEvents([{ kind: 'levelup', text: 'Poziom 7! Nagroda: +100 zł.', level: 7 }]);
      expect(ui.celebration.value?.title).toBe('POZIOM 7');
      expect(ui.story.value).toEqual([]);
      expect(ui.toasts.value).toEqual([]);
      expect(isModalOpen()).toBe(false);
    });

    it('handleEvents: nowy próg zaufania i koniec remontu czekają na „OK” zamiast toastu', () => {
      const h = harness();
      open(h);
      h.shell.handleEvents([
        { kind: 'trust-tier', text: 'Zaufanie Centrali: Zaufany partner. Lody wiralowe przyjeżdżają do Ciebie.' },
        { kind: 'remont', text: 'Remont zakończony! Sklep otwarty, pachnie nową farbą i starym kurzem.' },
      ]);
      expect(ui.story.value.map((e) => [e.title, e.text])).toEqual([
        ['Zaufanie Centrali', 'Zaufanie Centrali: Zaufany partner. Lody wiralowe przyjeżdżają do Ciebie.'],
        ['Remont zakończony', 'Remont zakończony! Sklep otwarty, pachnie nową farbą i starym kurzem.'],
      ]);
      expect(ui.toasts.value).toEqual([]);
      expect(isModalOpen()).toBe(true);
    });

    it('handleEvents: raport miesiąca ma własne okno, koniec gry też (okno końca współpracy), więc żadne nie trafia do story', () => {
      const h = harness();
      const s = open(h);
      const report = { label: 'wrzesień', counters: s.econ.total, profit: 1, cash: 2, comment: 'ok', detail: null };
      h.shell.handleEvents([
        { kind: 'month', text: 'Raport za wrzesień', report },
        { kind: 'gameover', text: 'Centrala wypowiada umowę franczyzową.' },
      ]);
      expect(ui.report.value).toBe(report);
      expect(ui.story.value).toEqual([]);
    });

    it('handleEvents: karta, wynik karty, KPI tygodnia, dostawa, mandat i reszta informacji zostają toastami, bez zatrzymania gry', () => {
      const h = harness();
      open(h);
      h.shell.handleEvents([{ kind: 'kpi-week', text: 'KPI trafione' }]);
      h.shell.handleEvents([{ kind: 'card', text: 'Karta' }, { kind: 'card-result', text: 'Wynik' }]);
      h.shell.handleEvents([{ kind: 'fine', text: 'Mandat' }, { kind: 'milestone', text: 'Kamień milowy' }]);
      expect(ui.story.value).toEqual([]);
      expect(ui.toasts.value.map((t) => t.text)).toEqual(['Mandat', 'Kamień milowy']);   // najwyżej dwa naraz
      expect(isModalOpen()).toBe(false);
    });

    it('nowy sklep (setSeed) i „zacznij od nowa” zdejmują wpisy ze starej gry', () => {
      const h = harness();
      open(h);
      h.shell.handleEvents([{ kind: 'trust-tier', text: 'Zaufanie Centrali: Na wylocie.' }]);
      expect(ui.story.value).toHaveLength(1);
      h.shell.game.restart();
      expect(ui.story.value).toEqual([]);
      h.shell.handleEvents([{ kind: 'remont', text: 'Remont zakończony!' }]);
      expect(h.shell.setSeed('inny-sklep', true)).toBe(true);
      expect(ui.story.value).toEqual([]);
    });

    it('handleEvents: złota paleta rozładowana to konfetti na środku ekranu, inne złote tylko dźwięk', () => {
      const h = harness();
      open(h);
      h.shell.handleEvents([{ kind: 'golden', text: '✨ Złota paleta rozładowana! +500 zł' }]);
      expect(h.calls).toEqual([['play', 'golden'], ['confetti', 0.5, 0.5, 24]]);
      h.calls.length = 0;
      h.shell.handleEvents([{ kind: 'golden', text: '✨ Pojawiła się złota paleta' }]);
      expect(h.calls).toEqual([['play', 'golden']]);
    });
  });

  describe('tap (stuknięcie w scenę)', () => {
    it('paleta: zaznaczenie, rozładunek i liczba nad palcem', () => {
      const h = harness();
      const s = open(h);
      const palletId = s.econ.pallets[0]!.id;
      const expected = applyCommand(structuredClone(s.econ), s.info, { type: 'tapPallet', palletId }).result;
      expect(expected.ok).toBe(true);
      const unloaded = expected.ok ? expected.value ?? 0 : 0;

      h.shell.tap({ kind: 'pallet', id: palletId }, 120, 340);

      expect(ui.selection.value).toEqual({ kind: 'pallet', id: palletId });
      expect(s.run!.record.log.map((e) => e.cmd)).toEqual([{ type: 'tapPallet', palletId }]);
      expect(h.calls.filter((c) => c[0] === 'floater')).toEqual([['floater', 120, 340, `+${Math.round(unloaded)} szt.`, 'work']]);
    });

    it('kasa: obsługa klienta i kwota nad palcem; pusta kolejka to odmowa bez liczby', () => {
      const h = harness();
      const s = open(h);
      s.econ.queue = 3;
      const expected = applyCommand(structuredClone(s.econ), s.info, { type: 'tapTill' }).result;
      h.shell.tap({ kind: 'till' }, 10, 20);
      const sale = expected.ok ? expected.value ?? 0 : 0;
      const money = `+${sale.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
      expect(h.calls.filter((c) => c[0] === 'floater')).toEqual([['floater', 10, 20, money, 'money']]);
      expect(ui.selection.value).toEqual({ kind: 'till' });

      h.calls.length = 0;
      s.econ.queue = 0;
      h.shell.tap({ kind: 'till' }, 10, 20);
      expect(h.calls.filter((c) => c[0] === 'floater')).toEqual([]);
    });

    it('slot: zaznaczenie i zamknięcie panelu, bez polecenia', () => {
      const h = harness();
      const s = open(h);
      ui.tab.value = 'palety';
      h.shell.tap({ kind: 'slot', slotId: 'slot-1' }, 5, 5);
      expect(ui.selection.value).toEqual({ kind: 'slot', slotId: 'slot-1' });
      expect(ui.tab.value).toBeNull();
      expect(s.run!.record.log).toEqual([]);
    });

    it('nic pod palcem: zaznaczenie znika', () => {
      const h = harness();
      open(h);
      ui.selection.value = { kind: 'till' };
      h.shell.tap(null, 5, 5);
      expect(ui.selection.value).toBeNull();
    });
  });
});

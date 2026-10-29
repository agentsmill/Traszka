import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import { MINUTES_PER_DAY, MINUTES_PER_SECOND_OPEN, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand, COMMAND_TYPES, type Command } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type CommandResult, type EconEvent } from '@/sim/economy/economy';
import { cardDef, visibleCards } from '@/sim/economy/tycoon/cards';
import { CIRCULARS, DECK } from '@/sim/economy/tycoon/deck';
import { xpToNext } from '@/sim/economy/progress';
import { UPGRADES } from '@/sim/economy/upgrades';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { SIM_VERSION } from '@/sim/simVersion';
import { layoutFor } from '@/sim/store/layoutFor';
import * as layoutModule from '@/sim/store/layoutFor';
import * as generatorModule from '@/sim/store/generateStore';
import { replayRun, type LogEntry } from '@/sim/run';
import * as ui from '@/ui/state';
import {
  AFTER, createShell, dispatchCommand, dropUnsentRun, markOffLog, syncUnsent, type CommandEffects, type GameShell, type ShellEffects, type ShellScene,
} from './actions';
import { openAtBoot } from './boot';
import { DEFAULT_CASHIER_LOOK, type CashierLook } from './cashier';
import { advanceSession, isModalOpen } from './frame';
import { MemoryStorage } from './memoryStorage';
import { loadMeta, type Meta } from './meta';
import * as rankedRunModule from './rankedRun';
import {
  clearFinished, createRankedSession, getPlayMode, loadFinished, loadRanked, pendingFinished, saveFinished, saveRanked, setPlayMode, type FinishedRun,
} from './rankedRun';
import { entrySeed } from './seeds';
import type { StartChoice } from './start';
import {
  NEWER_SAVE_NOTICE, RANKED_LOG_RESERVE, RANKED_TAP_LOG_MAX, RUN_LOG_MAX, createSession, hasStoredSave, lastSavedSeed, newRunLog, saveSession, withLayoutFromSeed, type GameSession,
} from './session';

const SEED = 'traszka-1';
/** Klucz gracza w postaci kanonicznej: 20 znaków base32 Crockforda (`playerKey.ts`). */
const KEY_FORMAT = /^[0-9A-HJKMNP-TV-Z]{20}$/;
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
  clearFinished();   // bieg trzymany w pamięci karty (rankedRun.ts) żyje dłużej niż pamięć przeglądarki z atrapy
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
  /** Wywołania `clearSeedFromUrl` (zdjęcie `?seed=` z adresu przy wejściu w bieg rankingowy): jeden wpis na wywołanie. */
  clears: string[];
  /** Komunikaty dla gracza (`notice`). */
  notices: string[];
}

/** Powłoka na atrapach; `seeds` to kolejne losowania `randomSeed`. */
function harness(options: { meta?: Meta; benchMode?: boolean; seeds?: string[]; weekSeed?: () => Promise<string | null> } = {}): Harness {
  const calls: Call[] = [];
  const urls: string[] = [];
  const clears: string[] = [];
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
    clearSeedFromUrl: () => { clears.push('seed'); },
    characterFactory: () => Promise.resolve({} as CharacterFactory),
    firstDayHints: HINTS,
    weekSeed: options.weekSeed,
  });
  const startup = calls.splice(0);
  return { shell, scene, startup, calls, urls, clears, notices };
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
    ui.howTo.value = false;
    ui.toasts.value = [];
    ui.story.value = [];
    ui.picked.value = null;
    ui.econ.value = null;
    ui.ephemeral.value = false;
    ui.seed.value = '';
    ui.ranked.value = null;
    ui.unsent.value = null;
    ui.confirmRankedStart.value = null;
    ui.finish.value = null;
  });
  afterEach(() => { vi.useRealTimers(); ui.story.value = []; ui.picked.value = null; ui.finish.value = null; });

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
      old.econ.lastDayProfit = 99_999;   // wynik dnia przed opłatą nie liczy się do nagrody; liczy się ostatni zamknięty miesiąc
      old.econ.history = [{ label: 'sierpień 2026', profit: 31_000, revenue: 150_000 }];   // zegar stoi na 1 września: sierpień ma 31 dni
      saveSession(old);
      const meta: Meta = { ...loadMeta(), lastSeen: Date.now() - 5 * 3_600_000 };
      const h = harness({ meta });

      expect(h.shell.open({ seed: 'traszka-1', fresh: false, choice: null })).toBe(true);

      const s = h.shell.session!;
      expect(s.fromSave).toBe(true);
      expect(s.econ.minute).toBe(OPEN_FROM + 30);
      expect(ui.hints.value).toEqual([]);
      expect(ui.welcome.value).toMatchObject({ offline: 1250, streak: 1, daily: { cash: 0, ogonki: 2 } });   // 1000 zł dziennie × ćwierć × 5 h
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
      const choice = { nick: 'Kasia', seed: 'stary', look, specialOutfits: true, notice: 'Wczytujemy Twój sklep spod tego seeda', ranked: false };

      const h = harness();
      h.shell.open({ seed: 'stary', fresh: true, choice });   // `fresh` z adresu nie ma tu znaczenia: wybór gracza nie nadpisze zapisu
      expect(h.shell.session!.fromSave).toBe(true);
      expect(h.shell.session!.econ.cash).toBe(4242);
      expect(ui.toasts.value.map((t) => t.text)).toEqual(['Wczytujemy Twój sklep spod tego seeda']);
    });

    it('pierwsze wejście przez ekran startowy otwiera okno „Jak grać”; wejście bez ekranu (adres, zapis) nie', () => {
      const look = { outfit: 'normal', appearanceSeed: 'abc' } as unknown as CashierLook;
      const withChoice = harness();
      withChoice.shell.open({ seed: 'traszka-1', fresh: false, choice: { nick: 'Kasia', seed: 'traszka-1', look, specialOutfits: true, notice: null, ranked: false } });
      expect(ui.howTo.value).toBe(true);
      expect(isModalOpen()).toBe(true);   // gra stoi do „Zaczynamy”

      ui.howTo.value = false;
      const without = harness();
      without.shell.open({ seed: 'traszka-2', fresh: false, choice: null });
      expect(ui.howTo.value).toBe(false);
    });

    it('dymki pierwszego dnia czekają pod oknem „Jak grać”: ich zegar rusza od „Zaczynamy”', () => {
      const look = { outfit: 'normal', appearanceSeed: 'abc' } as unknown as CashierLook;
      const h = harness();
      h.shell.open({ seed: 'traszka-1', fresh: false, choice: { nick: 'Kasia', seed: 'traszka-1', look, specialOutfits: true, notice: null, ranked: false } });
      expect(ui.hints.value).toEqual(HINTS);
      vi.advanceTimersByTime(ui.HINT_MS * (HINTS.length + 2));   // dłużej, niż wszystkie dymki razem
      expect(ui.hints.value).toEqual(HINTS);                      // nic nie wygasło pod oknem
      ui.closeHowTo();
      vi.advanceTimersByTime(ui.HINT_MS);
      expect(ui.hints.value).toEqual(HINTS.slice(1));             // pierwszy dymek dostał pełny czas
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

    it('benchmark, świat się nie buduje: scena wraca do poprzedniego świata bez sesji (bez poprzedniej sesji też się odtwarza)', () => {
      const h = harness({ benchMode: true });
      h.scene.load('bench-1', null);
      h.scene.loads.length = 0;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add('zepsuty');
      expect(h.shell.setSeed('zepsuty')).toBe(false);
      expect(h.scene.loads).toEqual([{ seed: 'zepsuty', session: null }, { seed: 'bench-1', session: null }]);
      expect(h.scene.seed).toBe('bench-1');
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
      request.onStart({ nick: 'Kasia', seed: 'traszka-5', look, specialOutfits: false, notice: null, ranked: false });

      expect(h.shell.meta.player).toEqual({
        nick: 'Kasia', look: { outfit: look.outfit, appearanceSeed: look.appearanceSeed }, specialOutfits: false, key: expect.stringMatching(KEY_FORMAT),
      });
      expect(savedMeta().player!.nick).toBe('Kasia');
      expect(savedMeta().player!.key).toBe(h.shell.meta.player!.key);
      expect(h.scene.looks).toEqual([look]);   // wygląd idzie do sceny przed budową sklepu
      expect(h.scene.looks[0]).toBe(look);
      expect(h.shell.session).not.toBe(old);
      expect(h.shell.session!.seed).toBe('traszka-5');
      expect(h.urls).toEqual(['traszka-5']);
    });

    describe('newStore: klucz gracza do rankingu', () => {
      const OLD_KEY = 'K7QX9MBD2HFAP3WN8RTE';
      const OLD_LOOK: CashierLook = { outfit: 'men-suit', appearanceSeed: 'kasjer-a' };
      const NEW_LOOK: CashierLook = { outfit: 'women-suit', appearanceSeed: 'kasjerka-b' };
      const playerMeta = (over: Partial<NonNullable<Meta['player']>> = {}, rest: Partial<Meta> = {}): Meta => ({
        ...loadMeta(), player: { nick: 'Stary', look: OLD_LOOK, specialOutfits: true, key: OLD_KEY, ...over }, ...rest,
      });
      const picked = (over: Partial<StartChoice> = {}): StartChoice =>
        ({ nick: 'Stary', seed: 'traszka-5', look: OLD_LOOK, specialOutfits: true, notice: null, ranked: false, ...over });
      /** Ekran „Nowy sklep” z ⚙ i zatwierdzenie wyboru (jak robi to `StartScreen`). */
      function choose(h: Harness, c: StartChoice): void {
        h.shell.game.newStore();
        const request = ui.start.value!;
        ui.start.value = null;
        request.onStart(c);
      }

      it('zmiana nicka, kasjera i seeda nie gubi klucza: zostaje w pamięci i w zapisie', () => {
        const h = harness({ meta: playerMeta(), seeds: ['wolny-1', 'wolny-2', 'wolny-3'] });
        open(h, 'traszka-1');

        choose(h, picked({ nick: 'Kasia' }));
        expect(h.shell.meta.player).toEqual({ nick: 'Kasia', look: OLD_LOOK, specialOutfits: true, key: OLD_KEY });

        choose(h, picked({ nick: 'Kasia', look: NEW_LOOK, seed: 'traszka-6' }));
        expect(h.shell.meta.player).toEqual({ nick: 'Kasia', look: NEW_LOOK, specialOutfits: true, key: OLD_KEY });

        choose(h, picked({ nick: 'Zosia', look: NEW_LOOK, specialOutfits: false, seed: 'traszka-7' }));
        expect(h.shell.meta.player).toEqual({ nick: 'Zosia', look: NEW_LOOK, specialOutfits: false, key: OLD_KEY });
        expect(savedMeta().player).toEqual({ nick: 'Zosia', look: NEW_LOOK, specialOutfits: false, key: OLD_KEY });
        expect(h.shell.session!.seed).toBe('traszka-7');
      });

      it('gracz sprzed rankingu (meta bez klucza) dostaje klucz przy pierwszym wyborze, a kolejne wybory go nie zmieniają', () => {
        const noKey = playerMeta();
        delete noKey.player!.key;
        const h = harness({ meta: noKey, seeds: ['wolny-1', 'wolny-2'] });
        open(h, 'traszka-1');

        choose(h, picked({ nick: 'Kasia' }));
        const key = h.shell.meta.player!.key;
        expect(key).toMatch(KEY_FORMAT);
        expect(savedMeta().player).toEqual({ nick: 'Kasia', look: OLD_LOOK, specialOutfits: true, key });

        choose(h, picked({ nick: 'Zosia', look: NEW_LOOK, seed: 'traszka-6' }));
        expect(h.shell.meta.player!.key).toBe(key);
        expect(savedMeta().player!.key).toBe(key);
      });

      it('reszta mety (sieć sklepów, punkty, seria, dźwięk) przechodzi wybór bez zmian, a klucz nie trafia do widoku mety, toastów ani komunikatów', () => {
        const rest: Partial<Meta> = { partnerPoints: 9, network: [{ seed: 'a', income: 5, level: 2, margin: 1 }], daily: { date: '2026-10-27', streak: 2 }, sound: false };
        const noKey = playerMeta({}, rest);
        delete noKey.player!.key;
        const h = harness({ meta: noKey, seeds: ['wolny-1'] });
        open(h, 'traszka-1');

        choose(h, picked({ nick: 'Kasia', notice: 'Ten lokal się nie zmieścił, wzięliśmy sąsiedni.' }));

        expect(savedMeta()).toMatchObject(rest);
        const key = h.shell.meta.player!.key!;
        expect(key).toMatch(KEY_FORMAT);
        const seen = JSON.stringify([ui.metaView.value, ui.toasts.value, h.notices, h.calls]);
        expect(seen).not.toContain(key);
      });

      it('meta z nowszej wersji gry (tylko do odczytu): gracz jest w pamięci tej karty, ale klucza nie ma i nic się nie zapisuje', () => {
        const h = harness({ meta: { ...loadMeta(), readOnly: true }, seeds: ['wolny-1'] });
        open(h, 'traszka-1');

        choose(h, picked({ nick: 'Kasia' }));

        expect(h.shell.meta.player).toEqual({ nick: 'Kasia', look: OLD_LOOK, specialOutfits: true });
        expect(storage.getItem('traszka:meta')).toBeNull();
      });
    });

    it('newStore: okno „Jak grać” otwiera się dopiero po zamknięciu ekranu startowego i gdy sklep się otworzył', () => {
      const h = harness({ seeds: ['wolny-1'] });
      open(h, 'traszka-1');
      h.shell.game.newStore();
      expect(ui.howTo.value).toBe(false);   // ekran startowy jeszcze stoi
      const request = ui.start.value!;
      request.onStart({ nick: 'Kasia', seed: 'traszka-5', look: request.form.look, specialOutfits: true, notice: null, ranked: false });
      expect(h.shell.session!.seed).toBe('traszka-5');
      expect(ui.howTo.value).toBe(true);
    });

    it('newStore: sklep, który się nie zbudował, zostawia gracza w poprzednim i nie otwiera instrukcji', () => {
      const h = harness({ seeds: ['wolny-1'] });
      const old = open(h, 'traszka-1');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      h.scene.failing.add('zepsuty');
      h.shell.game.newStore();
      const request = ui.start.value!;
      request.onStart({ nick: 'Kasia', seed: 'zepsuty', look: request.form.look, specialOutfits: true, notice: null, ranked: false });
      expect(h.shell.session).toBe(old);
      expect(ui.howTo.value).toBe(false);
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
      ui.start.value!.onStart({ nick: 'Kasia', seed: 'stary', look, specialOutfits: true, notice: 'Wczytujemy Twój sklep spod tego seeda', ranked: false });
      expect(h.shell.session!.fromSave).toBe(true);
      expect(h.shell.session!.econ.cash).toBe(4242);
      expect(ui.toasts.value.map((t) => t.text)).toEqual(['Wczytujemy Twój sklep spod tego seeda']);
      expect(ui.howTo.value).toBe(false);   // gracz wraca do swojego sklepu: instrukcji nie narzucamy
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
      s.econ.lastCashiers = 0;   // przy kasie nikogo: stukanie pomaga (`tillTapBlock`)
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

    it('nowy sklep (setSeed) i „zacznij od nowa” czyszczą też zaznaczoną odpowiedź karty: numery kart zaczynają się w nowej grze od 1', () => {
      const h = harness();
      open(h);
      ui.picked.value = { seq: 1, answer: 1 };
      h.shell.game.restart();
      expect(ui.picked.value).toBeNull();
      ui.picked.value = { seq: 1, answer: 1 };
      expect(h.shell.setSeed('inny-sklep', true)).toBe(true);
      expect(ui.picked.value).toBeNull();
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

  describe('bieg rankingowy: start, wznowienie, wyjście i zapis', () => {
    const RANKED_SEED = 'kielbasa-42';
    const BROKEN_NOTICE = 'Zapis biegu rankingowego był uszkodzony. Kopia została w przeglądarce.';
    const INCOMPATIBLE_NOTICE = 'Zapisany bieg rankingowy powstał w innej wersji gry i nie da się go wznowić. Możesz go porzucić w ustawieniach.';
    const STALE_NOTICE = 'Ten bieg powstał w starszej wersji gry i nie trafi do rankingu. Możesz go dograć dla zabawy albo zacząć nowy.';
    const NO_SPACE_NOTICE = 'Przeglądarka nie ma miejsca na zapis biegu rankingowego. Gra toczy się dalej, ale po zamknięciu karty bieg przepadnie.';
    const SWITCH_FAILED_NOTICE = 'Nie udało się otworzyć sklepu „traszka-1”. Zostajesz w poprzednim.';
    const request = (seed = 'traszka-1') => ({ seed, fresh: false, choice: null });

    /** Szuflada niewysłanego biegu: poprawny, pusty dziennik rankingowy z wynikiem (bez odtwarzania całego sezonu). */
    const drawerRun = (seed = 'stary-bieg'): FinishedRun => ({ v: 1, seed, record: newRunLog(seed, 'ranked').record, score: 12_345, finishedAt: 1_000 });

    /** Zwykły sklep otwarty i zapisany (jest `traszka:last`), z gotówką, po której widać, że wczytał się zapis. */
    function casualOpen(h: Harness, seed = 'traszka-1', cash = 4242): GameSession {
      const s = open(h, seed);
      s.econ.cash = cash;
      h.shell.persist();
      return s;
    }

    describe('startRanked', () => {
      it('świeża sesja rankingowa bez premii z sieci: zapis pod traszka:ranked, tryb ranked, świat bez adresu; zwykłe zapisy i traszka:last nietknięte', () => {
        const meta: Meta = { ...loadMeta(), partnerPoints: 3, network: [{ seed: 'a', income: 300, level: 5, margin: 10 }] };
        const h = harness({ meta });
        const sameSeed = createSession(RANKED_SEED, true);
        sameSeed.econ.cash = 777;
        saveSession(sameSeed);   // zwykły sklep o tym samym seedzie, co bieg rankingowy
        const casual = casualOpen(h, 'traszka-1');
        const before = { save: storage.getItem(`traszka:save:${RANKED_SEED}`), last: storage.getItem('traszka:last') };
        expect(before.last).toBe('traszka-1');
        ui.selection.value = { kind: 'till' };
        ui.tab.value = 'palety';
        ui.story.value = [{ id: 1, title: 'x', text: 'y' }];
        ui.picked.value = { seq: 3, answer: 1 };
        ui.report.value = { label: 'x', counters: casual.econ.total, profit: 0, cash: 0, comment: '', detail: null };
        h.urls.length = 0;

        expect(h.shell.startRanked(RANKED_SEED)).toBe(true);

        const s = h.shell.session!;
        expect(s).not.toBe(casual);
        expect(s).toMatchObject({ seed: RANKED_SEED, mode: 'ranked', fromSave: false, ephemeral: false });
        expect(s.econ.partner?.points ?? 0).toBe(0);   // bieg rankingowy startuje bez premii z sieci (serwer odtwarza bez niej)
        expect(s.econ.partner?.networkIncome ?? 0).toBe(0);
        expect(s.run).toMatchObject({ seq: 0, record: { seed: RANKED_SEED, mode: 'ranked', log: [] } });
        expect(h.scene.loads).toEqual([{ seed: RANKED_SEED, session: s }]);
        expect(h.urls).toEqual([]);   // sesje rankingowe nie wpisują seeda do adresu
        expect(ui.seed.value).toBe(RANKED_SEED);
        expect(ui.econ.value!.s).toBe(s.econ);
        expect(ui.ranked.value).toEqual({ seed: RANKED_SEED, day: 1, days: 91, phase: 'playing' });
        // stan sklepu poprzedniej gry nie przechodzi do nowej; bez wskazówek, okna powitalnego i instrukcji
        expect([ui.selection.value, ui.tab.value, ui.report.value, ui.picked.value]).toEqual([null, null, null, null]);
        expect(ui.story.value).toEqual([]);
        expect([ui.welcome.value, ui.hints.value, ui.howTo.value, ui.confirmRankedStart.value]).toEqual([null, [], false, null]);
        expect(h.notices).toEqual([]);
        // pamięć: bieg, tryb; poprzedni sklep zapisany, cudzy zapis i traszka:last bez zmian
        expect(loadRanked()).toMatchObject({ status: 'ok', session: { seed: RANKED_SEED, mode: 'ranked' } });
        expect(storage.getItem('traszka:mode')).toBe('ranked');
        expect(getPlayMode()).toBe('ranked');
        expect(storage.getItem(`traszka:save:${RANKED_SEED}`)).toBe(before.save);
        expect(storage.getItem('traszka:last')).toBe(before.last);
        expect(hasStoredSave('traszka-1')).toBe(true);
      });

      it('seed przechodzi normalizację, a zwykły zapis pod tym seedem nie zamienia startu we wczytanie sklepu; losowy seed z losowania powłoki', () => {
        const h = harness({ seeds: ['losowy-1'] });
        const casual = createSession('kielbasa 42', true);
        casual.econ.cash = 777;
        saveSession(casual);
        expect(h.shell.startRanked('  Kielbasa   42 ')).toBe(true);
        expect(h.shell.session).toMatchObject({ seed: 'kielbasa 42', mode: 'ranked', fromSave: false });
        expect(h.shell.session!.econ.cash).not.toBe(777);
        expect(JSON.parse(storage.getItem('traszka:save:kielbasa 42')!).econ.cash).toBe(777);

        expect(h.shell.startRanked('', { replace: true })).toBe(true);
        expect(h.shell.session!.seed).toBe('losowy-1');
      });

      it('stary zwykły zapis pod nieznormalizowanym napisem nie podmienia seeda biegu (serwer przyjmuje tylko postać kanoniczną)', () => {
        saveSession(createSession('Kielbasa 42', true));
        const h = harness();
        expect(h.shell.startRanked('Kielbasa 42')).toBe(true);
        expect(h.shell.session).toMatchObject({ seed: 'kielbasa 42', mode: 'ranked', fromSave: false });
        expect(ui.toasts.value).toEqual([]);   // żadnego „Wczytujemy Twój sklep spod tego seeda”
      });

      it('lokal, którego generator nie składa, daje sąsiedni seed z komunikatem, jak na ekranie startowym', () => {
        const realGenerate = generatorModule.generateStore;
        vi.spyOn(generatorModule, 'generateStore').mockImplementation((seed, ...rest) => {
          if (seed === 'bez-miejsca') throw new Error('generateStore: brak poprawnego układu');
          return realGenerate(seed, ...rest);
        });
        const h = harness();
        expect(h.shell.startRanked('bez-miejsca')).toBe(true);
        expect(h.shell.session!.seed).toBe('bez-miejsca·1');
        expect(ui.toasts.value.map((t) => t.text)).toEqual(['Ten lokal się nie zmieścił, otwieramy sąsiedni']);
      });

      it('bez sesji (rozruch) też startuje; w benchmarku nie robi nic', () => {
        const h = harness();
        expect(h.shell.startRanked(RANKED_SEED)).toBe(true);
        expect(h.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked' });

        const bench = harness({ benchMode: true });
        expect(bench.shell.startRanked(RANKED_SEED)).toBe(false);
        expect(bench.scene.loads).toEqual([]);
        expect(getPlayMode()).toBe('ranked');   // tryb zostaje z pierwszej powłoki: benchmark go nie ruszył
      });

      it('pełna szuflada niewysłanego biegu: false, pytanie o decyzję (reason unsent) i żadnej zmiany', () => {
        const h = harness();
        const casual = casualOpen(h);
        saveFinished(drawerRun());
        const keys = storage.keys().sort();
        h.scene.loads.length = 0;

        expect(h.shell.startRanked('  Inny   Seed ')).toBe(false);

        expect(ui.confirmRankedStart.value).toEqual({ seed: 'inny seed', reason: 'unsent' });   // seed w kanonicznej postaci
        expect(h.shell.session).toBe(casual);
        expect(h.scene.loads).toEqual([]);
        expect(storage.keys().sort()).toEqual(keys);
        expect(loadFinished()).not.toBeNull();
        expect(getPlayMode()).toBe('casual');
        expect(h.notices).toEqual([]);
      });

      it('trwa bieg rankingowy (także z innej wersji gry): false i reason active; zapis nietknięty', () => {
        const h = harness();
        expect(h.shell.startRanked(RANKED_SEED)).toBe(true);
        h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });
        h.shell.persist();
        const raw = storage.getItem('traszka:ranked');
        const running = h.shell.session!;
        h.scene.loads.length = 0;

        expect(h.shell.startRanked('inny')).toBe(false);
        expect(ui.confirmRankedStart.value).toEqual({ seed: 'inny', reason: 'active' });
        expect(h.shell.session).toBe(running);
        expect(h.scene.loads).toEqual([]);
        expect(storage.getItem('traszka:ranked')).toBe(raw);

        const other = harness();   // nowa karta: w pamięci biegu nie ma, jest tylko zapis z innej wersji gry
        ui.confirmRankedStart.value = null;
        storage.setItem('traszka:ranked', JSON.stringify({ schema: 99 }));
        expect(other.shell.startRanked('inny')).toBe(false);
        expect(ui.confirmRankedStart.value).toEqual({ seed: 'inny', reason: 'active' });
        expect(storage.getItem('traszka:ranked')).toBe('{"schema":99}');   // incompatible nie jest kasowany po cichu
      });

      it('szuflada ma pierwszeństwo przed trwającym biegiem', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        saveFinished(drawerRun());
        expect(h.shell.startRanked('inny')).toBe(false);
        expect(ui.confirmRankedStart.value).toEqual({ seed: 'inny', reason: 'unsent' });
      });

      it('sesja rankingowa w pamięci bez zapisu (przeglądarka go nie dała) też liczy się jako trwający bieg', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        storage.removeItem('traszka:ranked');
        expect(h.shell.startRanked('inny')).toBe(false);
        expect(ui.confirmRankedStart.value).toEqual({ seed: 'inny', reason: 'active' });
        expect(h.shell.session!.seed).toBe(RANKED_SEED);
      });

      it('uszkodzony zapis biegu nie blokuje startu: idzie do kopii, nowy bieg rusza', () => {
        const h = harness();
        storage.setItem('traszka:ranked', 'nie json');
        expect(h.shell.startRanked(RANKED_SEED)).toBe(true);
        expect(ui.confirmRankedStart.value).toBeNull();
        expect(storage.getItem('traszka:ranked:broken')).toBe('nie json');
        expect(loadRanked()).toMatchObject({ status: 'ok', session: { seed: RANKED_SEED } });
      });

      it('z `replace` kasuje szufladę i aktywny bieg, startuje nowy i zamyka pytanie', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });
        saveFinished(drawerRun());
        syncUnsent();
        expect(ui.unsent.value).toEqual({ seed: 'stary-bieg', score: 12_345 });
        expect(h.shell.startRanked('nowy-bieg')).toBe(false);   // pytanie otwarte
        expect(ui.confirmRankedStart.value).not.toBeNull();

        expect(h.shell.startRanked('nowy-bieg', { replace: true })).toBe(true);

        expect(h.shell.session).toMatchObject({ seed: 'nowy-bieg', mode: 'ranked' });
        expect(h.shell.session!.run!.record.log).toEqual([]);
        expect(loadFinished()).toBeNull();
        expect(ui.unsent.value).toBeNull();
        expect(ui.confirmRankedStart.value).toBeNull();
        expect(loadRanked()).toMatchObject({ status: 'ok', session: { seed: 'nowy-bieg' } });
        expect(ui.ranked.value?.seed).toBe('nowy-bieg');
      });

      it('świat nowego biegu się nie buduje: wraca poprzedni sklep, komunikat, tryb bez zmian; nic nie skasowane nawet z `replace`', () => {
        const h = harness();
        const casual = casualOpen(h);
        saveFinished(drawerRun());
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        h.scene.failing.add('zepsuty');
        h.urls.length = 0;
        h.scene.loads.length = 0;

        expect(h.shell.startRanked('zepsuty', { replace: true })).toBe(false);

        expect(h.shell.session).toBe(casual);
        expect(h.scene.loads.map((l) => l.seed)).toEqual(['zepsuty', 'traszka-1']);   // próba, potem odtworzenie poprzedniego
        expect(h.notices).toHaveLength(1);
        expect(h.notices[0]).toContain('zepsuty');
        expect(h.urls).toEqual([]);
        expect(ui.seed.value).toBe('traszka-1');
        expect(ui.ranked.value).toBeNull();
        expect(getPlayMode()).toBe('casual');
        expect(storage.getItem('traszka:ranked')).toBeNull();
        expect(loadFinished()).not.toBeNull();   // szuflada ginie dopiero, gdy nowy bieg naprawdę stoi
        expect(errorLog).toHaveBeenCalled();
      });
    });

    describe('ekran startowy „Nowy sklep”: start rankingowy', () => {
      const LOOK = { outfit: 'men-suit', appearanceSeed: 'kasjer-a' } as CashierLook;
      const rankedChoice = (over: Partial<StartChoice> = {}): StartChoice =>
        ({ nick: 'Kasia', seed: RANKED_SEED, look: LOOK, specialOutfits: false, notice: null, ranked: true, ...over });
      /** Ekran „Nowy sklep” otwarty z ⚙, a potem zamknięty przez gracza (tak robi `close` w StartScreen przed `onStart`). */
      function openedScreen(h: Harness): ui.StartRequest {
        h.shell.game.newStore();
        const request = ui.start.value!;
        ui.start.value = null;
        return request;
      }

      it('wybór z `ranked: true` zaczyna bieg rankingowy na seedzie z wyboru: gracz i wygląd zapisani, zwykłego sklepu nie otwiera, instrukcja nie wstaje', () => {
        const h = harness();
        casualOpen(h);
        const request = openedScreen(h);
        h.scene.loads.length = 0;
        h.urls.length = 0;

        request.onStart(rankedChoice());

        expect(h.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked', fromSave: false });
        expect(h.scene.loads.map((l) => l.seed)).toEqual([RANKED_SEED]);   // jedna budowa świata
        expect(h.shell.meta.player).toEqual({ nick: 'Kasia', look: LOOK, specialOutfits: false, key: expect.stringMatching(KEY_FORMAT) });
        expect(savedMeta().player!.nick).toBe('Kasia');
        expect(h.scene.looks).toEqual([LOOK]);   // wygląd idzie do sceny przed budową świata
        expect(getPlayMode()).toBe('ranked');
        expect(h.urls).toEqual([]);   // seed biegu nie trafia do adresu
        expect(ui.howTo.value).toBe(false);   // instrukcja otwiera się tylko przy zwykłym zupełnie nowym sklepie
        expect(ui.confirmRankedStart.value).toBeNull();
      });

      it('start rankingowy nie gubi klucza gracza (zmiana nicka i kasjera) i tworzy go u gracza sprzed rankingu', () => {
        const KEY = 'K7QX9MBD2HFAP3WN8RTE';
        const withKey = harness({ meta: { ...loadMeta(), player: { nick: 'Stary', look: DEFAULT_CASHIER_LOOK, specialOutfits: true, key: KEY } } });
        casualOpen(withKey);
        openedScreen(withKey).onStart(rankedChoice());
        expect(withKey.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked' });
        expect(withKey.shell.meta.player).toEqual({ nick: 'Kasia', look: LOOK, specialOutfits: false, key: KEY });
        expect(savedMeta().player!.key).toBe(KEY);

        storage.clear();
        const noKey = harness({ meta: { ...loadMeta(), player: { nick: 'Stary', look: DEFAULT_CASHIER_LOOK, specialOutfits: true } } });
        casualOpen(noKey);
        openedScreen(noKey).onStart(rankedChoice());
        expect(noKey.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked' });
        expect(noKey.shell.meta.player!.key).toMatch(KEY_FORMAT);
        expect(savedMeta().player!.key).toBe(noKey.shell.meta.player!.key);
      });

      it('zwykły zapis tego samego seeda nie zamienia startu w wczytanie sklepu: bieg zaczyna się od zera, zapis stoi nietknięty', () => {
        const h = harness();
        const saved = createSession(RANKED_SEED, true);
        saved.econ.cash = 777_777;
        saveSession(saved);
        casualOpen(h, 'traszka-1');
        const raw = storage.getItem(`traszka:save:${RANKED_SEED}`);

        openedScreen(h).onStart(rankedChoice());

        expect(h.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked', fromSave: false });
        expect(h.shell.session!.econ.cash).not.toBe(777_777);
        expect(storage.getItem(`traszka:save:${RANKED_SEED}`)).toBe(raw);
      });

      it('komunikat z wyboru (sąsiedni lokal) pokazuje się po starcie biegu', () => {
        const h = harness();
        casualOpen(h);
        openedScreen(h).onStart(rankedChoice({ notice: 'Ten lokal się nie zmieścił, wzięliśmy sąsiedni.' }));
        expect(h.shell.session!.mode).toBe('ranked');
        expect(ui.toasts.value.map((t) => t.text)).toEqual(['Ten lokal się nie zmieścił, wzięliśmy sąsiedni.']);
      });

      it('wybór zwykły (`ranked: false`) nadal otwiera zwykły sklep i instrukcję; `opts.replace` go nie dotyczy', () => {
        const h = harness();
        casualOpen(h);
        openedScreen(h).onStart(rankedChoice({ ranked: false, seed: 'traszka-5' }), { replace: true });
        expect(h.shell.session).toMatchObject({ seed: 'traszka-5', mode: 'casual' });
        expect(ui.howTo.value).toBe(true);
        expect(getPlayMode()).toBe('casual');
      });

      it('pełna szuflada: ekran sprawdza ją przed zamknięciem (`rankedBlock`), nic nie kasuje ani nie zmienia', () => {
        const h = harness();
        const casual = casualOpen(h);
        h.shell.game.newStore();
        const request = ui.start.value!;
        expect(request.rankedBlock!()).toBeNull();   // zwykły sklep, pusta szuflada
        saveFinished(drawerRun());
        const keys = storage.keys().sort();

        expect(request.rankedBlock!()).toBe('unsent');

        expect(ui.confirmRankedStart.value).toBeNull();   // samo sprawdzenie nie pyta: pyta ekran
        expect(h.shell.session).toBe(casual);
        expect(storage.keys().sort()).toEqual(keys);
        expect(loadFinished()).not.toBeNull();
      });

      it('trwający bieg (w pamięci, w zapisie, z innej wersji gry) też blokuje; skończony i uszkodzony nie', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        h.shell.game.newStore();
        const request = ui.start.value!;
        expect(request.rankedBlock!()).toBe('active');   // „Nowy sklep” z ⚙ w trakcie biegu

        h.shell.leaveRanked();
        expect(request.rankedBlock!()).toBe('active');   // bieg czeka w zapisie, gracz jest w zwykłym sklepie

        storage.setItem('traszka:ranked', JSON.stringify({ schema: 99 }));
        expect(request.rankedBlock!()).toBe('active');

        storage.setItem('traszka:ranked', 'nie json');
        expect(request.rankedBlock!()).toBeNull();
      });

      it('szuflada pełna mimo sprawdzenia (stan zmienił się po drodze): nic się nie kasuje, ekran wraca z tym samym wyborem i pytaniem', () => {
        const h = harness();
        const casual = casualOpen(h);
        const request = openedScreen(h);
        saveFinished(drawerRun());
        h.scene.loads.length = 0;

        request.onStart(rankedChoice({ nick: 'Kasia', seed: 'nowy-bieg', specialOutfits: true }));

        expect(h.shell.session).toBe(casual);
        expect(h.scene.loads).toEqual([]);
        expect(loadFinished()).not.toBeNull();   // nic nie skasowane bez potwierdzenia
        expect(ui.confirmRankedStart.value).toEqual({ seed: 'nowy-bieg', reason: 'unsent' });
        const again = ui.start.value!;   // ekran stoi znowu, z tym, co gracz wybrał
        expect(again).not.toBe(request);   // nowy obiekt prośby: StartHost daje mu nowy egzemplarz ekranu (świeża wyrzutnia i podgląd)
        expect(again.mode).toBe('new');
        expect(again.form).toEqual({ nick: 'Kasia', seed: 'nowy-bieg', look: LOOK, specialOutfits: true });
        expect(again.rankedBlock!()).toBe('unsent');
        expect(getPlayMode()).toBe('casual');
        expect(ui.howTo.value).toBe(false);
      });

      it('„Porzuć i zacznij”: `onStart(wybór, { replace: true })` kasuje szufladę, startuje bieg i zamyka pytanie', () => {
        const h = harness();
        casualOpen(h);
        saveFinished(drawerRun());
        syncUnsent();
        const request = openedScreen(h);
        request.onStart(rankedChoice({ seed: 'nowy-bieg' }));   // pytanie otwarte
        expect(ui.confirmRankedStart.value).not.toBeNull();
        ui.start.value = null;

        request.onStart(rankedChoice({ seed: 'nowy-bieg' }), { replace: true });

        expect(h.shell.session).toMatchObject({ seed: 'nowy-bieg', mode: 'ranked' });
        expect(loadFinished()).toBeNull();
        expect(ui.unsent.value).toBeNull();
        expect(ui.confirmRankedStart.value).toBeNull();
        expect(ui.start.value).toBeNull();
        expect(ui.ranked.value?.seed).toBe('nowy-bieg');
      });

      it('„Porzuć i zacznij” przy trwającym biegu zastępuje zapis nowym biegiem', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });
        const request = openedScreen(h);

        request.onStart(rankedChoice({ seed: 'nowy-bieg' }));
        expect(h.shell.session!.seed).toBe(RANKED_SEED);
        expect(ui.confirmRankedStart.value).toEqual({ seed: 'nowy-bieg', reason: 'active' });
        ui.start.value = null;

        request.onStart(rankedChoice({ seed: 'nowy-bieg' }), { replace: true });
        expect(h.shell.session).toMatchObject({ seed: 'nowy-bieg', mode: 'ranked' });
        expect(h.shell.session!.run!.record.log).toEqual([]);
        expect(loadRanked()).toMatchObject({ status: 'ok', session: { seed: 'nowy-bieg' } });
      });

      it('świat biegu się nie buduje: gracz zostaje w poprzednim sklepie z komunikatem, ekran się nie otwiera od nowa, pytania nie ma', () => {
        const h = harness();
        const casual = casualOpen(h);
        const request = openedScreen(h);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        h.scene.failing.add('zepsuty');

        request.onStart(rankedChoice({ seed: 'zepsuty' }));

        expect(h.shell.session).toBe(casual);
        expect(h.notices).toHaveLength(1);
        expect(ui.start.value).toBeNull();
        expect(ui.confirmRankedStart.value).toBeNull();
        expect(ui.howTo.value).toBe(false);
        expect(getPlayMode()).toBe('casual');
      });

      it('„Nowy sklep” zdejmuje stare pytanie i podaje ekranowi wybór chipa „Seed tygodnia” z serwera', async () => {
        const weekSeed = vi.fn(async () => 'babka-834');
        const h = harness({ weekSeed });
        casualOpen(h);
        ui.confirmRankedStart.value = { seed: 'stary', reason: 'active' };

        h.shell.game.newStore();

        expect(ui.confirmRankedStart.value).toBeNull();
        expect(await ui.start.value!.weekSeed!()).toBe('babka-834');
        expect(weekSeed).toHaveBeenCalledOnce();
      });

      it('bez `weekSeed` w zależnościach ekran „Nowy sklep” nie ma czym zapytać serwera', () => {
        const h = harness();
        casualOpen(h);
        h.shell.game.newStore();
        expect(ui.start.value!.weekSeed).toBeUndefined();
      });
    });

    describe('rozruch: wznowienie biegu albo zwykły sklep', () => {
      it('po przeładowaniu rozruch wznawia bieg: ten sam dziennik i seq, jedna budowa świata, bez adresu, nagród i komunikatów', () => {
        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });
        first.shell.game.dispatch({ type: 'returnPallet', palletId: 999 });   // odmowa też trafia do dziennika
        first.shell.persist();
        const before = first.shell.session!;
        const log = structuredClone(before.run!.record.log);
        expect(log).toHaveLength(2);

        const second = harness();   // „przeładowanie”: nowa powłoka na tym samym magazynie
        expect(openAtBoot(second.shell, request(), false)).toBe(true);

        const s = second.shell.session!;
        expect(s).toMatchObject({ seed: RANKED_SEED, mode: 'ranked', fromSave: true });
        expect(s.run!.record.log).toEqual(log);
        expect(s.run!.seq).toBe(before.run!.seq);
        expect(s.econ.minute).toBe(before.econ.minute);
        expect(second.scene.loads).toEqual([{ seed: RANKED_SEED, session: s }]);   // bez drugiej budowy: zwykłego sklepu nikt nie otwierał
        expect(second.urls).toEqual([]);
        expect(second.notices).toEqual([]);
        expect([ui.welcome.value, ui.hints.value, ui.howTo.value]).toEqual([null, [], false]);
        expect(ui.seed.value).toBe(RANKED_SEED);
        expect(ui.ranked.value).toMatchObject({ seed: RANKED_SEED, phase: 'playing' });
        expect(ui.econ.value!.s).toBe(s.econ);
        expect(storage.getItem('traszka:save:traszka-1')).toBeNull();   // żaden zwykły sklep nie powstał

        // dalsze polecenia dopisują się bez luki i bez powtórki
        second.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 5 });
        expect(s.run!.record.log.map((e) => e.seq)).toEqual([0, 1, 2]);
        expect(s.run!.seq).toBe(3);
      });

      it('bieg zaczęty w starszej wersji symulacji wznawia się z komunikatem, że nie trafi do rankingu', () => {
        const old = createRankedSession(RANKED_SEED);
        old.run!.record.simVersion = SIM_VERSION - 1;
        expect(saveRanked(old)).toBe(true);
        setPlayMode('ranked');
        const h = harness();

        expect(openAtBoot(h.shell, request(), false)).toBe(true);

        expect(h.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked' });
        expect(h.shell.session!.run!.record.simVersion).toBe(SIM_VERSION - 1);
        expect(h.notices).toEqual([STALE_NOTICE]);
      });

      it('adres z ?seed= otwiera zwykły sklep mimo trybu ranked; bieg czeka nietknięty, a zwykłe wejście dalej go wznowi', () => {
        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.persist();
        const raw = storage.getItem('traszka:ranked');

        const second = harness();
        expect(openAtBoot(second.shell, request('traszka-9'), true)).toBe(true);
        expect(second.shell.session).toMatchObject({ seed: 'traszka-9', mode: 'casual' });
        expect(second.urls).toEqual(['traszka-9']);
        expect(second.scene.loads.map((l) => l.seed)).toEqual(['traszka-9']);
        expect(storage.getItem('traszka:ranked')).toBe(raw);
        expect(ui.ranked.value).toBeNull();
        expect(getPlayMode()).toBe('ranked');   // link z seedem nie zmienia zapamiętanego trybu

        const third = harness();
        expect(openAtBoot(third.shell, request(), false)).toBe(true);
        expect(third.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked' });
      });

      it('zapis biegu uszkodzony: zwykły sklep i komunikat; kopia w :broken, aktywny klucz zwolniony', () => {
        setPlayMode('ranked');
        storage.setItem('traszka:ranked', '{nie json');
        const h = harness();

        expect(openAtBoot(h.shell, request(), false)).toBe(true);

        expect(h.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
        expect(h.notices).toEqual([BROKEN_NOTICE]);
        expect(storage.getItem('traszka:ranked:broken')).toBe('{nie json');
        expect(storage.getItem('traszka:ranked')).toBeNull();
        expect(h.scene.loads.map((l) => l.seed)).toEqual(['traszka-1']);
      });

      it('zapis biegu z innej wersji gry: zwykły sklep, komunikat o porzuceniu w ustawieniach, zapis zostaje na miejscu', () => {
        setPlayMode('ranked');
        storage.setItem('traszka:ranked', '{"schema":99}');
        const h = harness();

        expect(openAtBoot(h.shell, request(), false)).toBe(true);

        expect(h.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
        expect(h.notices).toEqual([INCOMPATIBLE_NOTICE]);
        expect(storage.getItem('traszka:ranked')).toBe('{"schema":99}');
        expect(storage.getItem('traszka:ranked:broken')).toBeNull();
      });

      it('tryb ranked bez zapisanego biegu, `?new=1` albo wybór z ekranu startowego: zwykły sklep, bez komunikatu', () => {
        setPlayMode('ranked');
        const none = harness();
        expect(openAtBoot(none.shell, request(), false)).toBe(true);
        expect(none.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
        expect(none.notices).toEqual([]);

        const saved = harness();
        saved.shell.startRanked(RANKED_SEED);
        saved.shell.persist();
        const fresh = harness();
        expect(openAtBoot(fresh.shell, { seed: 'traszka-2', fresh: true, choice: null }, false)).toBe(true);
        expect(fresh.shell.session).toMatchObject({ seed: 'traszka-2', mode: 'casual', fromSave: false });
        const look = { outfit: 'normal', appearanceSeed: 'abc' } as unknown as CashierLook;
        const chosen = harness();
        const choice = { nick: 'Kasia', seed: 'traszka-3', look, specialOutfits: true, notice: null, ranked: false };
        expect(openAtBoot(chosen.shell, { seed: 'traszka-3', fresh: false, choice }, false)).toBe(true);
        expect(chosen.shell.session).toMatchObject({ seed: 'traszka-3', mode: 'casual' });
        expect(loadRanked().status).toBe('ok');   // bieg przez to wszystko nietknięty
      });

      it('tryb casual: rozruch otwiera zwykły sklep, nawet gdy leży zapis biegu', () => {
        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.persist();
        setPlayMode('casual');
        const h = harness();
        expect(openAtBoot(h.shell, request(), false)).toBe(true);
        expect(h.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
        expect(h.notices).toEqual([]);
      });

      it('wznowienie, którego świat się nie buduje: false, komunikat o bezpiecznym zapisie, zwykły sklep ze świeżą sceną; zapis biegu zostaje', () => {
        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.persist();
        const raw = storage.getItem('traszka:ranked');
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

        const h = harness();
        h.scene.failing.add(RANKED_SEED);
        expect(openAtBoot(h.shell, request(), false)).toBe(true);

        expect(h.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
        expect(h.notices).toHaveLength(1);
        expect(h.notices[0]).toContain('Nie udało się wznowić biegu rankingowego');
        expect(h.scene.loads.map((l) => l.seed)).toEqual([RANKED_SEED, 'traszka-1']);   // bez odtwarzania sceny dla nieistniejącej sesji
        expect(storage.getItem('traszka:ranked')).toBe(raw);
        expect(errorLog).toHaveBeenCalled();
      });

      it('resumeRanked w trakcie biegu nic nie przeładowuje: zapis w przeglądarce nie jest nowszy od stanu na ekranie', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        const running = h.shell.session!;
        h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });   // jeszcze niezapisane
        h.scene.loads.length = 0;
        expect(h.shell.resumeRanked()).toBe(true);
        expect(h.shell.session).toBe(running);
        expect(running.run!.record.log).toHaveLength(1);
        expect(h.scene.loads).toEqual([]);
      });

      it('resumeRanked bez biegu, w benchmarku albo przy zepsutym zapisie: false', () => {
        expect(harness().shell.resumeRanked()).toBe(false);
        expect(harness({ benchMode: true }).shell.resumeRanked()).toBe(false);
        storage.setItem('traszka:ranked', 'x');
        const h = harness();
        expect(h.shell.resumeRanked()).toBe(false);
        expect(h.notices).toEqual([BROKEN_NOTICE]);
      });

      it('resumeRanked ze zwykłego sklepu: zapisuje go, przechodzi do biegu i ustawia tryb ranked', () => {
        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.persist();
        const h = harness();
        const casual = casualOpen(h, 'traszka-1');
        casual.econ.cash = 999;

        expect(h.shell.resumeRanked()).toBe(true);

        expect(h.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked' });
        expect(JSON.parse(storage.getItem('traszka:save:traszka-1')!).econ.cash).toBe(999);   // poprzedni sklep zapisany przed przejściem
        expect(getPlayMode()).toBe('ranked');
        expect(h.urls).toEqual([]);
      });
    });

    describe('leaveRanked i abandonRanked', () => {
      it('leaveRanked zapisuje bieg i wraca do ostatniego zwykłego sklepu; kolejne wejście na stronę otwiera zwykły sklep', () => {
        const h = harness();
        casualOpen(h, 'traszka-1', 4242);
        h.shell.startRanked(RANKED_SEED);
        h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });   // bez zapisu: zapisze go dopiero wyjście
        ui.tab.value = 'palety';
        ui.report.value = { label: 'x', counters: h.shell.session!.econ.total, profit: 0, cash: 0, comment: '', detail: null };
        h.urls.length = 0;
        h.scene.loads.length = 0;

        h.shell.leaveRanked();

        expect(h.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual', fromSave: true });
        expect(h.shell.session!.econ.cash).toBe(4242);
        expect(h.scene.loads).toEqual([{ seed: 'traszka-1', session: h.shell.session }]);
        expect(h.urls).toEqual(['traszka-1']);   // zwykły sklep wpisuje seed do adresu jak zawsze
        expect(ui.seed.value).toBe('traszka-1');
        expect([ui.ranked.value, ui.tab.value, ui.report.value]).toEqual([null, null, null]);
        expect(getPlayMode()).toBe('casual');
        const kept = loadRanked();
        expect(kept.status).toBe('ok');
        if (kept.status === 'ok') expect(kept.session.run!.record.log).toHaveLength(1);   // polecenie sprzed wyjścia jest w zapisie

        const next = harness();   // kolejne wejście na stronę
        expect(openAtBoot(next.shell, request(entrySeed(null, lastSavedSeed())), false)).toBe(true);
        expect(next.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
      });

      it('leaveRanked bez zwykłego zapisu otwiera wolny losowy sklep; poza biegiem nic nie robi', () => {
        const h = harness({ seeds: ['losowy-1'] });
        h.shell.startRanked(RANKED_SEED);
        h.shell.leaveRanked();
        expect(h.shell.session).toMatchObject({ seed: 'losowy-1', mode: 'casual', fromSave: false });
        expect(loadRanked().status).toBe('ok');

        const calm = harness();
        const casual = casualOpen(calm);
        calm.scene.loads.length = 0;
        calm.shell.leaveRanked();
        expect(calm.shell.session).toBe(casual);
        expect(calm.scene.loads).toEqual([]);
        expect(() => harness({ benchMode: true }).shell.leaveRanked()).not.toThrow();
      });

      it('leaveRanked, gdy zwykły sklep się nie buduje: gracz zostaje w biegu, tryb ranked, komunikat jak przy zmianie sklepu', () => {
        const h = harness();
        casualOpen(h, 'traszka-1');
        h.shell.startRanked(RANKED_SEED);
        const running = h.shell.session!;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        h.scene.failing.add('traszka-1');

        h.shell.leaveRanked();

        expect(h.shell.session).toBe(running);
        expect(getPlayMode()).toBe('ranked');
        expect(h.notices).toEqual([SWITCH_FAILED_NOTICE]);
        expect(ui.ranked.value).toMatchObject({ seed: RANKED_SEED });
        expect(loadRanked().status).toBe('ok');
      });

      it('abandonRanked kasuje aktywny bieg i wraca do zwykłej gry; szuflada niewysłanego biegu zostaje', () => {
        const h = harness();
        casualOpen(h, 'traszka-1', 4242);
        h.shell.startRanked(RANKED_SEED);
        saveFinished(drawerRun());
        syncUnsent();

        h.shell.abandonRanked();

        expect(storage.getItem('traszka:ranked')).toBeNull();   // także po zapisie, który robi przejście
        expect(getPlayMode()).toBe('casual');
        expect(h.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
        expect(ui.ranked.value).toBeNull();
        expect(loadFinished()).not.toBeNull();
        expect(ui.unsent.value).toEqual({ seed: 'stary-bieg', score: 12_345 });

        const next = harness();
        expect(openAtBoot(next.shell, request(), false)).toBe(true);
        expect(next.shell.session).toMatchObject({ mode: 'casual' });
      });

      it('abandonRanked ze zwykłego sklepu porzuca bieg z innej wersji gry (z ustawień) bez zmiany sklepu', () => {
        setPlayMode('ranked');
        storage.setItem('traszka:ranked', '{"schema":99}');
        const h = harness();
        const casual = casualOpen(h);
        h.scene.loads.length = 0;

        h.shell.game.abandonRanked();

        expect(storage.getItem('traszka:ranked')).toBeNull();
        expect(getPlayMode()).toBe('casual');
        expect(h.shell.session).toBe(casual);
        expect(h.scene.loads).toEqual([]);
      });

      it('abandonRanked, gdy zwykły sklep się nie buduje: bieg zostaje (nic nie skasowane, skoro przejście się nie udało)', () => {
        const h = harness();
        casualOpen(h, 'traszka-1');
        h.shell.startRanked(RANKED_SEED);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        h.scene.failing.add('traszka-1');

        h.shell.abandonRanked();

        expect(h.shell.session).toMatchObject({ seed: RANKED_SEED, mode: 'ranked' });
        expect(loadRanked().status).toBe('ok');
        expect(getPlayMode()).toBe('ranked');
      });
    });

    describe('adres strony: ?seed= zdejmowany przy wejściu w bieg, żeby odświeżenie go wznowiło', () => {
      it('startRanked zdejmuje ?seed= z adresu (raz, po zbudowaniu świata) i nie wpisuje żadnego seeda', () => {
        const h = harness();
        casualOpen(h);   // zwykły sklep wpisał ?seed=traszka-1
        h.urls.length = 0;
        expect(h.clears).toEqual([]);

        expect(h.shell.startRanked(RANKED_SEED)).toBe(true);

        expect(h.clears).toEqual(['seed']);
        expect(h.urls).toEqual([]);
      });

      it('resumeRanked (rozruch i ze zwykłego sklepu) zdejmuje ?seed= z adresu', () => {
        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.persist();

        const boot = harness();
        expect(openAtBoot(boot.shell, request(), false)).toBe(true);
        expect(boot.clears).toEqual(['seed']);   // także, gdy adresu z seedem nie było: sprzątanie jest po stronie adresu (no-op)
        expect(boot.urls).toEqual([]);

        const fromCasual = harness();
        casualOpen(fromCasual);
        expect(fromCasual.shell.resumeRanked()).toBe(true);
        expect(fromCasual.clears).toEqual(['seed']);
      });

      it('adresu nie ruszają: start odmówiony (pytanie), start, któremu świat się nie buduje, wznowienie bez biegu, z uszkodzonym zapisem i z błędem budowy', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const asked = harness();
        casualOpen(asked);
        saveFinished(drawerRun());
        expect(asked.shell.startRanked(RANKED_SEED)).toBe(false);
        expect(asked.clears).toEqual([]);
        storage.removeItem('traszka:ranked:done');

        const failing = harness();
        casualOpen(failing);
        failing.scene.failing.add('zepsuty');
        expect(failing.shell.startRanked('zepsuty')).toBe(false);
        expect(failing.clears).toEqual([]);

        expect(harness().shell.resumeRanked()).toBe(false);   // brak biegu
        storage.setItem('traszka:ranked', 'x');
        const broken = harness();
        expect(broken.shell.resumeRanked()).toBe(false);
        expect(broken.clears).toEqual([]);

        const saved = harness();
        saved.shell.startRanked(RANKED_SEED);
        saved.shell.persist();
        const unbuildable = harness();
        unbuildable.scene.failing.add(RANKED_SEED);
        expect(unbuildable.shell.resumeRanked()).toBe(false);
        expect(unbuildable.clears).toEqual([]);
      });

      it('zwykłe przepływy nie zdejmują seeda z adresu: rozruch, ?seed= przy trybie ranked, setSeed, wyjście z biegu i jego porzucenie', () => {
        const plain = harness();
        plain.shell.open({ seed: 'traszka-1', fresh: false, choice: null });
        plain.shell.setSeed('traszka-2');
        plain.shell.randomize();
        expect(plain.clears).toEqual([]);

        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.persist();
        const deepLink = harness();
        expect(openAtBoot(deepLink.shell, request('traszka-9'), true)).toBe(true);
        expect(deepLink.clears).toEqual([]);
        expect(deepLink.urls).toEqual(['traszka-9']);

        const leaving = harness();
        casualOpen(leaving);
        leaving.shell.resumeRanked();
        expect(leaving.clears).toEqual(['seed']);
        leaving.shell.leaveRanked();
        leaving.shell.resumeRanked();
        leaving.shell.abandonRanked();
        expect(leaving.clears).toEqual(['seed', 'seed']);   // tylko dwa wejścia w bieg; wyjście i porzucenie wpisują seed zwykłego sklepu
        expect(leaving.urls.slice(-1)).toEqual(['traszka-1']);
      });

      it('`?new=1` i wybór z ekranu startowego nadal otwierają zwykły sklep przy trybie ranked i nie zdejmują seeda', () => {
        const first = harness();
        first.shell.startRanked(RANKED_SEED);
        first.shell.persist();
        const look = { outfit: 'normal', appearanceSeed: 'abc' } as unknown as CashierLook;
        const choice = { nick: 'Kasia', seed: 'traszka-3', look, specialOutfits: true, notice: null, ranked: false };
        const fresh = harness();
        expect(openAtBoot(fresh.shell, { seed: 'traszka-2', fresh: true, choice: null }, false)).toBe(true);
        const chosen = harness();
        expect(openAtBoot(chosen.shell, { seed: 'traszka-3', fresh: false, choice }, false)).toBe(true);
        expect([fresh.shell.session!.mode, chosen.shell.session!.mode]).toEqual(['casual', 'casual']);
        expect([fresh.clears, chosen.clears]).toEqual([[], []]);
      });
    });

    describe('stan interfejsu przy przejściach: wspólny reset sklepu', () => {
      it('wejście w bieg zamyka wskazówki pierwszego dnia i pytanie o start; zwykłe przejście wskazówek nie rusza', () => {
        const h = harness();
        casualOpen(h);
        ui.showHints(HINTS);
        h.shell.setSeed('traszka-2');
        expect(ui.hints.value).toEqual(HINTS);   // zwykły sklep tak jak dotąd: dymki zostają
        ui.confirmRankedStart.value = { seed: 'x', reason: 'active' };

        expect(h.shell.startRanked(RANKED_SEED)).toBe(true);

        expect(ui.hints.value).toEqual([]);
        expect(ui.confirmRankedStart.value).toBeNull();
        ui.showHints(HINTS);
        h.shell.leaveRanked();   // powrót do zwykłego sklepu też nie rusza dymków
        expect(ui.hints.value).toEqual(HINTS);
        ui.showHints([]);
      });

      it('zwykłe przejście nie zamyka zakładki ani raportu (jak dotąd); wyjście z biegu i wejście w bieg tak', () => {
        const h = harness();
        casualOpen(h);
        ui.tab.value = 'palety';
        h.shell.setSeed('traszka-2');
        expect(ui.tab.value).toBe('palety');
        ui.tab.value = null;

        ui.tab.value = 'ludzie';
        h.shell.startRanked(RANKED_SEED);
        expect(ui.tab.value).toBeNull();
        ui.tab.value = 'ludzie';
        h.shell.leaveRanked();
        expect(ui.tab.value).toBeNull();
      });
    });

    describe('zapis sesji rankingowej i tryb przy przejściach na zwykłe sklepy', () => {
      it('persist sesji rankingowej: zapis do traszka:ranked, a zwykłe klucze sklepu nietknięte; czas wyjścia w mecie jak dotąd', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        expect(h.shell.session).not.toBeNull();
        storage.removeItem('traszka:ranked');
        h.shell.persist();
        expect(loadRanked().status).toBe('ok');
        expect(storage.keys().filter((k) => k.startsWith('traszka:save:'))).toEqual([]);
        expect(storage.getItem('traszka:last')).toBeNull();
        expect(savedMeta().lastSeen).toBe(Date.now());
      });

      it('sesje rankingowe nie wołają writeSeedToUrl: start, polecenia, zapisy, koniec dnia i wznowienie', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });
        h.shell.handleEvents([{ kind: 'day', text: 'Dzień' }]);
        h.shell.persist();
        const second = harness();
        second.shell.resumeRanked();
        expect(h.urls).toEqual([]);
        expect(second.urls).toEqual([]);
      });

      it('odmowa localStorage: jedna wiadomość na sesję, nie za każdym zapisem; nowa sesja dostaje własną', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        expect(h.notices).toEqual([]);
        storage.failWrites = true;

        h.shell.persist();
        h.shell.persist();
        h.shell.handleEvents([{ kind: 'day', text: 'Dzień' }]);
        h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 });
        h.shell.persist();
        expect(h.notices).toEqual([NO_SPACE_NOTICE]);
        expect(h.shell.session!.mode).toBe('ranked');   // gra toczy się dalej

        expect(h.shell.startRanked('drugi', { replace: true })).toBe(true);   // nowa sesja: znów jedno ostrzeżenie
        h.shell.persist();
        expect(h.notices).toEqual([NO_SPACE_NOTICE, NO_SPACE_NOTICE]);
      });

      it('bieg bez dziennika (nie do zapisu) nie wmawia graczowi braku miejsca w przeglądarce', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        h.shell.session!.run = null;
        h.shell.persist();
        expect(h.notices).toEqual([]);
      });

      it('zwykły zapis przy odmowie localStorage nie mówi nic o biegu rankingowym', () => {
        const h = harness();
        open(h);
        storage.failWrites = true;
        h.shell.persist();
        expect(h.notices).toEqual([]);
      });

      it('przejścia na zwykły sklep (setSeed, generate, randomize, restart, newStore) ustawiają tryb casual; sam zwykły gracz nie dostaje klucza traszka:mode', () => {
        const plain = harness();
        open(plain);
        plain.shell.setSeed('traszka-2');
        plain.shell.randomize();
        expect(storage.getItem('traszka:mode')).toBeNull();   // zwykła gra zostawia pamięć tak, jak było

        for (const leave of [
          (h: Harness) => h.shell.setSeed('traszka-3'),
          (h: Harness) => h.shell.generate('traszka-4'),
          (h: Harness) => h.shell.randomize(),
        ]) {
          const h = harness();
          h.shell.startRanked(RANKED_SEED, { replace: true });
          expect(getPlayMode()).toBe('ranked');
          leave(h);
          expect(h.shell.session!.mode).toBe('casual');
          expect(getPlayMode()).toBe('casual');
          expect(ui.ranked.value).toBeNull();
          expect(loadRanked().status).toBe('ok');   // bieg czeka w zapisie
        }

        setPlayMode('ranked');   // zwykły sklep otwarty linkiem z ?seed= przy trybie ranked
        const h = harness();
        open(h, 'traszka-1');
        h.shell.game.restart();
        expect(getPlayMode()).toBe('casual');
        setPlayMode('ranked');
        h.shell.game.newStore();
        ui.start.value!.onStart({ nick: 'Kasia', seed: 'traszka-5', look: ui.start.value!.form.look, specialOutfits: true, notice: null, ranked: false });
        expect(getPlayMode()).toBe('casual');
      });

      it('openNextStore ze zwykłego sklepu przy trybie ranked też ustawia tryb casual', () => {
        setPlayMode('ranked');
        const h = harness({ seeds: ['nowy-1'] });
        const s = open(h, 'traszka-1');
        s.econ.total.margin = 80_000;
        s.econ.bestDayProfit = 5000;
        saveSession(s);
        h.shell.game.openNextStore();
        expect(h.shell.session!.seed).toBe('nowy-1');
        expect(getPlayMode()).toBe('casual');
      });
    });

    describe('widok dla interfejsu: ranked i unsent', () => {
      it('publish: dzień biegu z minuty stanu (od 1, do 91), faza; zwykły sklep daje null; ten sam widok nie jest podmieniany co 200 ms', () => {
        const h = harness();
        h.shell.startRanked(RANKED_SEED);
        const s = h.shell.session!;
        const view = ui.ranked.value;
        h.shell.publish();
        expect(ui.ranked.value).toBe(view);   // nic się nie zmieniło: ten sam obiekt, bez zbędnych odświeżeń

        s.econ.minute = 5 * MINUTES_PER_DAY + OPEN_FROM;
        h.shell.publish();
        expect(ui.ranked.value).toEqual({ seed: RANKED_SEED, day: 6, days: 91, phase: 'playing' });

        s.econ.minute = 200 * MINUTES_PER_DAY;   // za końcem sezonu: dzień nie rośnie ponad 91
        h.shell.publish();
        expect(ui.ranked.value).toMatchObject({ day: 91, days: 91, phase: 'over' });

        h.shell.setSeed('traszka-1');
        expect(ui.ranked.value).toBeNull();
      });

      it('unsent: stan szuflady z rozruchu i po syncUnsent', () => {
        harness();
        expect(ui.unsent.value).toBeNull();

        saveFinished(drawerRun('bieg-a'));
        harness();
        expect(ui.unsent.value).toEqual({ seed: 'bieg-a', score: 12_345 });

        storage.removeItem('traszka:ranked:done');
        syncUnsent();
        expect(ui.unsent.value).toBeNull();
        storage.setItem('traszka:ranked:done', 'śmieci');   // nierozpoznana szuflada to pusta szuflada
        syncUnsent();
        expect(ui.unsent.value).toBeNull();
      });
    });

    describe('koniec sezonu rankingowego i wyłączone nagrody', () => {
      const END = RANKED_SEASON_END_MINUTE;
      const SEASON_OVER_TEXT = 'Sezon dobiegł końca.';
      const LOG_FULL_TEXT = 'Dziennik biegu rankingowego jest pełny.';
      const TAP_LOG_FULL_TEXT = 'Dziennik biegu jest prawie pełny: ręczne stukanie się skończyło. Zakupy i decyzje działają dalej.';
      const TERMINATED_TEXT = 'Umowa wypowiedziana: bieg się zakończył.';
      const NOT_COUNTED_NOTICE = 'Ten bieg nie liczy się do rankingu.';
      const BANKRUPT_NOTICE = 'Ten bieg nie trafi do rankingu: sezon zakończony bankructwem.';
      const RESULT_NOT_SAVED_NOTICE = 'Przeglądarka nie ma miejsca na zapis wyniku. Wyślij go teraz, zanim zamkniesz kartę.';
      const NO_NETWORK_NOTICE = 'W biegu rankingowym nie ma sieci sklepów.';
      const NO_RESTART_NOTICE = 'W biegu rankingowym nie zaczyna się od nowa. Porzuć bieg w ustawieniach.';
      const FULL_SEASON_MS = 60_000;   // pełne odtworzenie sezonu w `finishRun` trwa około sekundy, a pod obciążeniem dłużej

      /** Bieg rankingowy w powłoce, ustawiony `before` minut przed końcem sezonu, bez kart na biurku. */
      function rankedNearEnd(h: Harness, before = 1): GameSession {
        h.shell.startRanked(RANKED_SEED);
        const s = h.shell.session!;
        s.econ.minute = END - before;
        s.econ.tycoon.cards.pending = [];
        return s;
      }
      /** Jedna klatka pętli z main.ts: czas gry, potem zdarzenia do powłoki. */
      function frame(h: Harness, seconds = 10, speed = 8, modal = false): EconEvent[] {
        const events: EconEvent[] = [];
        advanceSession(h.shell.session!, seconds, speed, modal, events);
        h.shell.handleEvents(events);
        return events;
      }
      const snapshot = (): Record<string, string | null> => Object.fromEntries(storage.keys().map((k) => [k, storage.getItem(k)]));
      const drawerWrites = (spy: { mock: { calls: unknown[][] } }): number => spy.mock.calls.filter(([key]) => key === 'traszka:ranked:done').length;

      describe('zamknięcie biegu', () => {
        it('koniec sezonu w jednej klatce z kartą decyzji, raportem miesiąca i zapisem dnia: szuflada dokładnie raz, aktywny zapis zdjęty, gra nie robi kroku poza koniec', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          s.econ.minute = END - 3;
          s.econ.tycoon.cards.pending = s.econ.tycoon.cards.pending.slice(0, 1).map((c) => ({ ...c, showAt: END }));   // karta na minutę końca sezonu
          const finish = vi.spyOn(rankedRunModule, 'finishRun');
          const writes = vi.spyOn(storage, 'setItem');

          const events = frame(h);   // ×8: trzy minuty do końca w jednej klatce, w ostatniej zamknięcie dnia i miesiąca oraz karta

          expect(s.econ.minute).toBe(END);
          expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['day', 'month', 'card']));
          expect(awaitingDecision(s.econ)).toBe(true);
          expect(finish).toHaveBeenCalledTimes(1);
          expect(drawerWrites(writes)).toBe(1);
          const drawer = loadFinished()!;
          expect(drawer).toMatchObject({ v: 1, seed: RANKED_SEED, finishedAt: Date.now() });
          expect(drawer.record.mode).toBe('ranked');
          expect(Number.isInteger(drawer.score)).toBe(true);
          expect(storage.getItem('traszka:ranked')).toBeNull();   // aktywny zapis zdjęty, choć „zapis dnia” w tej samej klatce go zapisał
          expect(ui.unsent.value).toEqual({ seed: RANKED_SEED, score: drawer.score });
          expect(ui.ranked.value).toMatchObject({ seed: RANKED_SEED, day: 91, days: 91, phase: 'over' });
          expect(ui.report.value).not.toBeNull();   // raport miesiąca wstał mimo zamknięcia biegu w tej samej klatce
          expect(h.notices).toEqual([]);

          // kolejne klatki (okno raportu, karta, puste zdarzenia): ani kroku, ani drugiego zamknięcia
          for (let i = 0; i < 5; i++) frame(h, 10, 8, i % 2 === 0);
          expect(s.econ.minute).toBe(END);
          expect(finish).toHaveBeenCalledTimes(1);
          expect(drawerWrites(writes)).toBe(1);
          expect(storage.getItem('traszka:ranked')).toBeNull();
        }, FULL_SEASON_MS);

        it('bez karty: gra staje na końcu sezonu, a zamknięcie nie czeka na zdarzenie month ani day (wystarczy minuta stanu)', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          s.econ.minute = END;   // stan już za końcem, zdarzenia puste
          h.shell.handleEvents([]);
          expect(loadFinished()?.seed).toBe(RANKED_SEED);
          expect(ui.ranked.value?.phase).toBe('over');
          expect(h.shell.session).toBe(s);   // gracz zostaje w sesji: okno końca pokaże kolejny krok
        }, FULL_SEASON_MS);

        it('bankrut (gameOver przed końcem sezonu) nie trafia do szuflady: bez odtwarzania, aktywny zapis skasowany, jeden komunikat, bez ui.unsent i bez okna końca sezonu', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          expect(h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 4 }).ok).toBe(true);
          h.shell.persist();
          expect(storage.getItem('traszka:ranked')).not.toBeNull();   // aktywny zapis jest, zanim bieg się skończy
          s.econ.minute = 40 * MINUTES_PER_DAY + OPEN_FROM;
          s.econ.gameOver = true;
          const finish = vi.spyOn(rankedRunModule, 'finishRun');
          const writes = vi.spyOn(storage, 'setItem');

          h.shell.handleEvents([{ kind: 'gameover', text: 'Koniec współpracy' }]);
          h.shell.handleEvents([]);   // następna klatka niczego nie powtarza

          expect(finish).not.toHaveBeenCalled();
          expect(drawerWrites(writes)).toBe(0);
          expect(loadFinished()).toBeNull();
          expect(pendingFinished()).toBeNull();
          expect(storage.getItem('traszka:ranked:done')).toBeNull();
          expect(storage.getItem('traszka:ranked')).toBeNull();
          expect(ui.unsent.value).toBeNull();
          expect(ui.finish.value).toBeNull();
          expect(ui.ranked.value).toMatchObject({ phase: 'over', day: 41 });
          expect(h.notices).toEqual([BANKRUPT_NOTICE]);

          // sesja zamknięta nie odnawia aktywnego zapisu, a nowy bieg rusza bez pytania o „niewysłany bieg”
          h.shell.persist();
          h.shell.handleEvents([{ kind: 'day', text: 'Dzień' }]);
          expect(storage.getItem('traszka:ranked')).toBeNull();
          expect(h.shell.startRanked('nowy-bieg')).toBe(true);
          expect(ui.confirmRankedStart.value).toBeNull();
          expect(h.shell.session).not.toBe(s);
        });

        it('bankrut w tej samej klatce co ostatni raport sezonu (gameOver na końcu sezonu): też bez szuflady i bez okna', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          s.econ.minute = END;
          s.econ.gameOver = true;
          const finish = vi.spyOn(rankedRunModule, 'finishRun');

          h.shell.handleEvents([]);

          expect(finish).not.toHaveBeenCalled();
          expect(loadFinished()).toBeNull();
          expect(ui.finish.value).toBeNull();
          expect(h.notices).toEqual([BANKRUPT_NOTICE]);
        });

        it('po bankructwie „Wróć do zwykłej gry” (leaveRanked) otwiera zwykły sklep, a ranking nie ma czego wznawiać ani wysyłać', () => {
          const h = harness();
          casualOpen(h, 'traszka-1', 4242);
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          s.econ.minute = 40 * MINUTES_PER_DAY + OPEN_FROM;
          s.econ.gameOver = true;
          h.shell.handleEvents([{ kind: 'gameover', text: 'Koniec współpracy' }]);

          h.shell.leaveRanked();

          expect(h.shell.session).toMatchObject({ seed: 'traszka-1', mode: 'casual' });
          expect(h.shell.session!.econ.cash).toBe(4242);
          expect(getPlayMode()).toBe('casual');
          expect(loadRanked().status).toBe('none');
          expect(loadFinished()).toBeNull();
          expect(ui.ranked.value).toBeNull();
          expect(ui.unsent.value).toBeNull();
        });

        it('sesja z run === null (po markOffLog) nie tworzy szuflady: aktywny zapis zdjęty, komunikat, faza over, bez ui.unsent', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          markOffLog(s);
          const finish = vi.spyOn(rankedRunModule, 'finishRun');
          s.econ.minute = END;

          h.shell.handleEvents([]);
          h.shell.handleEvents([]);

          expect(finish).toHaveBeenCalledTimes(1);
          expect(loadFinished()).toBeNull();
          expect(storage.getItem('traszka:ranked:done')).toBeNull();
          expect(storage.getItem('traszka:ranked')).toBeNull();
          expect(ui.unsent.value).toBeNull();
          expect(pendingFinished()).toBeNull();
          expect(ui.ranked.value?.phase).toBe('over');
          expect(h.notices).toEqual([NOT_COUNTED_NOTICE]);

          // skończony bieg bez szuflady nie jest „rozpoczętym biegiem”: nowy start rusza bez pytania
          expect(h.shell.startRanked('nowy-bieg')).toBe(true);
          expect(ui.confirmRankedStart.value).toBeNull();
          expect(h.shell.session).not.toBe(s);
        });

        it('przeglądarka odmawia zapisu szuflady: bieg zostaje w pamięci karty (pendingFinished, ui.unsent), jedno ostrzeżenie, aktywny zapis nietknięty, nowy start pyta o niewysłany bieg', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          s.econ.minute = END;
          h.shell.persist();   // aktywny zapis ze stanem na końcu sezonu, jak po zapisie dnia z ostatniej klatki
          const active = storage.getItem('traszka:ranked');
          expect(active).not.toBeNull();
          const finish = vi.spyOn(rankedRunModule, 'finishRun');
          storage.failWrites = true;

          h.shell.handleEvents([]);
          h.shell.handleEvents([]);

          expect(finish).toHaveBeenCalledTimes(1);   // druga klatka nie zamyka biegu ponownie
          expect(h.notices).toEqual([RESULT_NOT_SAVED_NOTICE]);   // jedno, nie przy każdej klatce
          expect(loadFinished()).toBeNull();
          const held = pendingFinished()!;
          expect(held).toMatchObject({ v: 1, seed: RANKED_SEED });
          expect(ui.unsent.value).toEqual({ seed: RANKED_SEED, score: held.score });
          expect(ui.ranked.value?.phase).toBe('over');
          expect(storage.getItem('traszka:ranked')).toBe(active);   // szuflada nie przyjęła biegu, więc aktywny zapis zostaje, bajt w bajt

          storage.failWrites = false;
          h.shell.persist();
          h.shell.handleEvents([{ kind: 'day', text: 'Dzień' }]);
          expect(storage.getItem('traszka:ranked')).toBe(active);   // sesja zamknięta nie odnawia aktywnego zapisu
          expect(h.shell.startRanked('inny-bieg')).toBe(false);   // bieg z pamięci blokuje start tak jak szuflada
          expect(ui.confirmRankedStart.value).toEqual({ seed: 'inny-bieg', reason: 'unsent' });
          expect(h.shell.session).toBe(s);
          clearFinished();   // „Odrzuć bieg” (albo przyjęcie przez serwer) zabiera bieg z pamięci
          syncUnsent();
          expect(ui.unsent.value).toBeNull();
        }, FULL_SEASON_MS);

        it('po odmowie zapisu szuflady przeładowanie wznawia bieg ze stanu na końcu sezonu i zamyka go ponownie: szuflada, bez aktywnego zapisu', () => {
          const first = harness();
          const s = rankedNearEnd(first, 1);
          s.econ.minute = END;
          first.shell.persist();
          storage.failWrites = true;
          first.shell.handleEvents([]);
          storage.failWrites = false;
          expect(loadFinished()).toBeNull();
          expect(storage.getItem('traszka:ranked')).not.toBeNull();

          // nowa karta: pamięć karty jest pusta, zostaje tylko zapis w przeglądarce
          clearFinished();
          ui.unsent.value = null;
          ui.ranked.value = null as ui.RankedView | null;   // jak po świeżym załadowaniu strony
          const second = harness();
          expect(second.shell.resumeRanked()).toBe(true);
          expect(second.shell.session!.econ.minute).toBe(END);
          second.shell.handleEvents([]);
          second.shell.handleEvents([]);

          const drawer = loadFinished()!;
          expect(drawer.seed).toBe(RANKED_SEED);
          expect(storage.getItem('traszka:ranked')).toBeNull();
          expect(ui.unsent.value).toEqual({ seed: RANKED_SEED, score: drawer.score });
          expect(ui.ranked.value?.phase).toBe('over');
          expect(second.notices).toEqual([]);
        }, FULL_SEASON_MS);

        it('wyjątek z odtwarzania nie wychodzi z handleEvents ani nie powtarza się co klatkę: komunikat, faza over, aktywny zapis zostaje', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          const before = storage.getItem('traszka:ranked');
          expect(before).not.toBeNull();
          const finish = vi.spyOn(rankedRunModule, 'finishRun').mockImplementation(() => { throw new Error('rozjazd wersji'); });
          vi.spyOn(console, 'error').mockImplementation(() => {});
          s.econ.minute = END;

          expect(() => h.shell.handleEvents([])).not.toThrow();
          h.shell.handleEvents([]);

          expect(finish).toHaveBeenCalledTimes(1);
          expect(h.notices).toHaveLength(1);
          expect(ui.ranked.value?.phase).toBe('over');
          expect(storage.getItem('traszka:ranked')).toBe(before);   // bieg nie przepada: zapis czeka na kolejną próbę po odświeżeniu
          expect(loadFinished()).toBeNull();
        });

        it('po zamknięciu persist sesji nie zapisuje aktywnego slotu (ani zapis dnia, ani przejście): leaveRanked zostawia traszka:ranked puste i szufladę nietkniętą', () => {
          const h = harness();
          casualOpen(h, 'traszka-1');
          const s = rankedNearEnd(h, 1);
          s.econ.minute = END;
          h.shell.handleEvents([]);
          const drawer = storage.getItem('traszka:ranked:done');
          expect(drawer).not.toBeNull();
          expect(storage.getItem('traszka:ranked')).toBeNull();

          h.shell.persist();
          h.shell.handleEvents([{ kind: 'day', text: 'Dzień' }]);
          expect(storage.getItem('traszka:ranked')).toBeNull();

          h.shell.leaveRanked();

          expect(h.shell.session!.mode).toBe('casual');
          expect(h.shell.session!.seed).toBe('traszka-1');
          expect(storage.getItem('traszka:ranked')).toBeNull();   // przejście na zwykły sklep zapisuje poprzednią sesję: tej już nie
          expect(storage.getItem('traszka:ranked:done')).toBe(drawer);
          expect(ui.unsent.value).toMatchObject({ seed: RANKED_SEED });
          expect(ui.ranked.value).toBeNull();
          expect(loadRanked().status).toBe('none');
        }, FULL_SEASON_MS);

        it('porzucenie po zakończonym sezonie zostawia szufladę', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          s.econ.minute = END;
          h.shell.handleEvents([]);
          const drawer = storage.getItem('traszka:ranked:done');
          h.shell.abandonRanked();
          expect(storage.getItem('traszka:ranked:done')).toBe(drawer);
          expect(storage.getItem('traszka:ranked')).toBeNull();
          expect(h.shell.session!.mode).toBe('casual');
        }, FULL_SEASON_MS);

        it('w trakcie sezonu nic się nie zmienia: zapis dnia zapisuje bieg, a zamknięcie nie rusza szuflady', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          storage.removeItem('traszka:ranked');
          h.shell.handleEvents([{ kind: 'day', text: 'Dzień' }]);
          expect(loadRanked().status).toBe('ok');
          expect(loadFinished()).toBeNull();
          expect(ui.ranked.value?.phase).toBe('playing');
          expect(ui.unsent.value).toBeNull();
        });

        it('finishRun na biegu zagranym przez dispatch (kilkanaście dni, stuknięcia, polecenia tuż przed końcem): record.log ma same minuty < RANKED_SEASON_END_MINUTE', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          const answerCards = (): void => {
            for (const c of visibleCards(s.econ.tycoon.cards, s.econ.minute)) h.shell.game.dispatch({ type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
          };
          for (let i = 0; i < 4000 && s.econ.minute < 12 * MINUTES_PER_DAY; i++) {
            answerCards();
            if (i % 25 === 0) h.shell.game.dispatch({ type: 'tapTill' });
            frame(h, 1, 8);
          }
          expect(s.econ.minute).toBeGreaterThanOrEqual(12 * MINUTES_PER_DAY);
          expect(s.run!.record.log.length).toBeGreaterThan(10);

          // sezon skrócony ustawieniem minuty tuż przed końcem: polecenia w ostatnich minutach i próba po końcu
          const oneMinute = (): EconEvent[] => frame(h, 1.01 / MINUTES_PER_SECOND_OPEN, 1);   // ×1: dokładnie jedna minuta gry
          s.econ.minute = END - 2;
          s.clock.acc = 0;
          s.econ.tycoon.cards.pending = [];
          h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 3 });
          oneMinute();   // END - 1
          expect(s.econ.minute).toBe(END - 1);
          expect(h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 5 }).ok).toBe(true);
          oneMinute();   // END: koniec sezonu
          expect(s.econ.minute).toBe(END);
          expect(h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 7 })).toEqual({ ok: false, text: SEASON_OVER_TEXT });

          const live = s.run!.record.log;
          expect(live.every((e) => e.minute < END)).toBe(true);
          expect(live.at(-1)).toMatchObject({ minute: END - 1, cmd: { type: 'setOrder', manual: 5 } });
          const drawer = loadFinished()!;
          expect(drawer.record.log.length).toBe(live.length);
          expect(drawer.record.log.every((e) => e.minute < END)).toBe(true);
          expect(drawer.record.log.at(-1)).toMatchObject({ minute: END - 1, cmd: { type: 'setOrder', manual: 5 } });
        }, FULL_SEASON_MS);
      });

      describe('okno końca sezonu (ui.finish)', () => {
        const PLAYER_KEY = 'K7QX9MBD2HFAP3WN8RTE';

        /** Zmiany sygnału `finish` od chwili podpięcia (bez wartości początkowej). */
        function watchFinish(): { seen: (typeof ui.finish.value)[]; stop: () => void } {
          const seen: (typeof ui.finish.value)[] = [];
          let first = true;
          const stop = ui.finish.subscribe((v) => { if (first) { first = false; return; } seen.push(v); });
          return { seen, stop };
        }

        it('koniec sezonu z biegiem w szufladzie otwiera okno raz: szuflada, ui.unsent i faza over są już ustawione, gra stoi', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          s.econ.minute = END - 3;
          s.econ.tycoon.cards.pending = s.econ.tycoon.cards.pending.slice(0, 1).map((c) => ({ ...c, showAt: END }));   // karta na minutę końca: trzyma grę, ale nie może zasłonić okna
          const { seen, stop } = watchFinish();
          let atOpen: unknown = null;
          const off = ui.finish.subscribe((v) => {
            if (v) atOpen = { drawer: loadFinished()?.seed, unsent: ui.unsent.value?.seed, phase: ui.ranked.value?.phase };
          });

          frame(h);
          for (let i = 0; i < 4; i++) frame(h, 10, 8, true);

          expect(seen).toEqual([{ open: true }]);
          expect(atOpen).toEqual({ drawer: RANKED_SEED, unsent: RANKED_SEED, phase: 'over' });
          expect(ui.isWindowOpen()).toBe(true);
          expect(isModalOpen(s)).toBe(true);
          expect(awaitingDecision(s.econ)).toBe(true);
          off();
          stop();
        }, FULL_SEASON_MS);

        it('wypowiedzenie umowy przed końcem sezonu (bankructwo) nie otwiera okna końca sezonu: nie ma wyniku do wysłania', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          s.econ.minute = 40 * MINUTES_PER_DAY + OPEN_FROM;
          s.econ.gameOver = true;
          h.shell.handleEvents([{ kind: 'gameover', text: 'Koniec współpracy' }]);
          expect(ui.finish.value).toBeNull();
          expect(ui.unsent.value).toBeNull();
        });

        it('szuflada nie przyjęła biegu (bieg tylko w pamięci karty): okno też się otwiera', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          s.econ.minute = END;
          storage.failWrites = true;
          h.shell.handleEvents([]);
          storage.failWrites = false;
          expect(loadFinished()).toBeNull();
          expect(pendingFinished()).not.toBeNull();
          expect(ui.finish.value).toEqual({ open: true });
        }, FULL_SEASON_MS);

        it('bieg bez dziennika (nie do wysłania) albo błąd podliczenia nie otwierają okna', () => {
          const off = harness();
          const s = rankedNearEnd(off, 1);
          markOffLog(s);
          s.econ.minute = END;
          off.shell.handleEvents([]);
          expect(ui.finish.value).toBeNull();
          expect(ui.ranked.value?.phase).toBe('over');

          const broken = harness();
          const b = rankedNearEnd(broken, 1);
          vi.spyOn(rankedRunModule, 'finishRun').mockImplementation(() => { throw new Error('rozjazd wersji'); });
          vi.spyOn(console, 'error').mockImplementation(() => {});
          b.econ.minute = END;
          broken.shell.handleEvents([]);
          expect(ui.finish.value).toBeNull();
        });

        it('w trakcie sezonu okno się nie otwiera, a niewysłany bieg z poprzedniej wizyty nie otwiera go przy rozruchu', () => {
          saveFinished(drawerRun('bieg-a'));
          const h = harness();
          expect(ui.unsent.value).toMatchObject({ seed: 'bieg-a' });
          expect(ui.finish.value).toBeNull();
          h.shell.startRanked(RANKED_SEED, { replace: true });
          h.shell.handleEvents([{ kind: 'day', text: 'Dzień' }]);
          expect(ui.finish.value).toBeNull();
        });

        describe('openFinish', () => {
          it('otwiera okno dla niewysłanego biegu z szuflady, a ponowne wywołanie niczego nie podmienia', () => {
            saveFinished(drawerRun('bieg-a'));
            const h = harness();
            h.shell.game.openFinish();
            const opened = ui.finish.value;
            expect(opened).toEqual({ open: true });
            h.shell.game.openFinish();
            expect(ui.finish.value).toBe(opened);
            expect(ui.isWindowOpen()).toBe(true);
          });

          it('otwiera okno także dla biegu trzymanego tylko w pamięci karty', () => {
            const h = harness();
            rankedRunModule.holdFinished(drawerRun('w-pamieci'));
            h.shell.game.openFinish();
            expect(ui.finish.value).toEqual({ open: true });
          });

          it('bez niewysłanego biegu nic nie otwiera', () => {
            const h = harness();
            h.shell.game.openFinish();
            expect(ui.finish.value).toBeNull();
            storage.setItem('traszka:ranked:done', 'śmieci');
            h.shell.game.openFinish();
            expect(ui.finish.value).toBeNull();
          });
        });

        describe('rememberNick', () => {
          const playerMeta = (over: Partial<NonNullable<Meta['player']>> = {}): Meta => ({
            ...loadMeta(), player: { nick: 'Stary', look: DEFAULT_CASHIER_LOOK, specialOutfits: false, key: PLAYER_KEY, ...over },
          });

          it('zapisuje nick w mecie (w pamięci i w przeglądarce), klucz i reszta gracza zostają', () => {
            const h = harness({ meta: playerMeta() });
            h.shell.game.rememberNick('Nowy Nick');
            expect(h.shell.meta.player).toEqual({ nick: 'Nowy Nick', look: DEFAULT_CASHIER_LOOK, specialOutfits: false, key: PLAYER_KEY });
            expect(savedMeta().player).toEqual({ nick: 'Nowy Nick', look: DEFAULT_CASHIER_LOOK, specialOutfits: false, key: PLAYER_KEY });
          });

          it('gracz bez klucza zostaje bez klucza (nick nie tworzy go z niczego)', () => {
            const noKey = { ...playerMeta().player! };
            delete noKey.key;
            const h = harness({ meta: { ...loadMeta(), player: noKey } });
            h.shell.game.rememberNick('Nowy Nick');
            expect(h.shell.meta.player).toEqual({ ...noKey, nick: 'Nowy Nick' });
          });

          it('bez gracza w mecie (przed ekranem startowym) niczego nie zapisuje i nie rzuca', () => {
            const h = harness({ meta: { ...loadMeta(), player: undefined } });
            expect(() => h.shell.game.rememberNick('Nowy Nick')).not.toThrow();
            expect(h.shell.meta.player).toBeUndefined();
            expect(storage.getItem('traszka:meta')).toBeNull();
          });

          it('meta z nowszej wersji gry (tylko do odczytu): nick tylko w pamięci karty, pod kluczem mety nic nowego', () => {
            const h = harness({ meta: { ...playerMeta(), readOnly: true } });
            h.shell.game.rememberNick('Nowy Nick');
            expect(h.shell.meta.player?.nick).toBe('Nowy Nick');
            expect(storage.getItem('traszka:meta')).toBeNull();
          });
        });

        describe('dropUnsentRun: bieg przyjęty przez serwer albo odrzucony przez gracza', () => {
          it('opróżnia szufladę, pamięć karty i aktywny zapis biegu (inaczej przeładowanie wskrzesiłoby bieg) i zdejmuje ui.unsent', () => {
            const h = harness();
            const s = rankedNearEnd(h, 1);
            s.econ.minute = END;
            h.shell.persist();   // aktywny zapis na końcu sezonu
            storage.failWrites = true;
            h.shell.handleEvents([]);   // szuflada odmawia: bieg w pamięci karty, aktywny zapis zostaje
            storage.failWrites = false;
            expect(storage.getItem('traszka:ranked')).not.toBeNull();
            expect(ui.unsent.value).not.toBeNull();

            dropUnsentRun();

            expect(storage.getItem('traszka:ranked')).toBeNull();
            expect(storage.getItem('traszka:ranked:done')).toBeNull();
            expect(pendingFinished()).toBeNull();
            expect(ui.unsent.value).toBeNull();
            expect(loadRanked().status).toBe('none');
          }, FULL_SEASON_MS);

          it('bez niczego do skasowania nie rzuca i nie rusza reszty pamięci', () => {
            storage.setItem('traszka:last', 'traszka-1');
            expect(() => dropUnsentRun()).not.toThrow();
            expect(storage.getItem('traszka:last')).toBe('traszka-1');
          });

          it('spóźnione przyjęcie (okno zamknięte w trakcie wysyłania, potem „Porzuć i zacznij”) nie rusza aktywnego zapisu nowego biegu', () => {
            saveFinished(drawerRun('bieg-a'));   // seed 'bieg-a', finishedAt 1000: ten bieg poszedł do serwera
            const h = harness();
            expect(ui.unsent.value).toMatchObject({ seed: 'bieg-a' });
            // gracz zamknął okno i zaczął nowy bieg, porzucając niewysłany: szuflada pusta, w przeglądarce aktywny zapis nowego biegu
            expect(h.shell.startRanked('nowy-bieg', { replace: true })).toBe(true);
            expect(loadFinished()).toBeNull();
            const active = storage.getItem('traszka:ranked');
            expect(active).not.toBeNull();
            expect(loadRanked()).toMatchObject({ status: 'ok', session: { seed: 'nowy-bieg' } });
            ui.finish.value = null;
            ui.toasts.value = [];

            dropUnsentRun({ seed: 'bieg-a', finishedAt: 1_000 });   // odpowiedź serwera „przyjęty” dla biegu, którego już nie ma w szufladzie

            expect(storage.getItem('traszka:ranked')).toBe(active);   // aktywny zapis nowego biegu bajt w bajt
            expect(h.shell.session!.seed).toBe('nowy-bieg');
            expect(ui.unsent.value).toBeNull();
            expect(ui.toasts.value.map((t) => t.text)).toEqual(['Bieg przyjęty do rankingu.']);   // okno zamknięte: gracz dowiaduje się z toastu
          });

          it('przyjęcie innego biegu niż ten w szufladzie (inny seed albo inna chwila końca) zostawia szufladę i aktywny zapis', () => {
            const kept = drawerRun('bieg-a');
            saveFinished(kept);
            storage.setItem('traszka:ranked', '{"zapis":"aktywny"}');
            harness();
            for (const sent of [{ seed: 'bieg-b', finishedAt: 1_000 }, { seed: 'bieg-a', finishedAt: 999 }]) {
              dropUnsentRun(sent);
              expect(loadFinished(), JSON.stringify(sent)).toEqual(kept);
              expect(storage.getItem('traszka:ranked')).toBe('{"zapis":"aktywny"}');
              expect(ui.unsent.value).toMatchObject({ seed: 'bieg-a' });
            }
          });

          it('przyjęcie tego samego biegu opróżnia szufladę i aktywny zapis; toast tylko przy zamkniętym oknie', () => {
            saveFinished(drawerRun('bieg-a'));
            storage.setItem('traszka:ranked', '{"zapis":"aktywny"}');
            harness();
            ui.toasts.value = [];
            ui.finish.value = { open: true };   // okno otwarte: przyjęcie pokazuje samo okno
            dropUnsentRun({ seed: 'bieg-a', finishedAt: 1_000 });
            expect(loadFinished()).toBeNull();
            expect(storage.getItem('traszka:ranked')).toBeNull();
            expect(ui.unsent.value).toBeNull();
            expect(ui.toasts.value).toEqual([]);

            saveFinished(drawerRun('bieg-a'));
            ui.finish.value = null;
            dropUnsentRun({ seed: 'bieg-a', finishedAt: 1_000 });
            expect(ui.toasts.value.map((t) => t.text)).toEqual(['Bieg przyjęty do rankingu.']);
            ui.toasts.value = [];
            dropUnsentRun();   // ręczne „Odrzuć bieg”: bez toastu o przyjęciu
            expect(ui.toasts.value).toEqual([]);
          });
        });
      });

      describe('polecenia po końcu sezonu i limit dziennika', () => {
        it('po końcu sezonu polecenie jest odmówione: toast error, bez dziennika, bez zmiany stanu, bez zapisu i bez zdarzeń', () => {
          const s = createRankedSession(RANKED_SEED);
          s.econ.minute = END;
          const rec = recorder();
          const before = JSON.stringify(s.econ);

          const r = dispatchCommand(s, { type: 'setOrder', auto: false, manual: 4 }, rec.fx);

          expect(r).toEqual({ ok: false, text: SEASON_OVER_TEXT });
          expect(rec.named('toast')).toEqual([['toast', SEASON_OVER_TEXT, 'error']]);
          expect(rec.names()).not.toContain('persist');
          expect(rec.names()).not.toContain('handleEvents');
          expect(s.run!.record.log).toEqual([]);
          expect(s.run!.seq).toBe(0);
          expect(JSON.stringify(s.econ)).toBe(before);
        });

        it('wypowiedzenie umowy przed końcem sezonu też zamyka polecenia, z własnym komunikatem (nie „Sezon dobiegł końca”); tuż przed końcem polecenie jeszcze przechodzi', () => {
          const rec = recorder();
          const over = createRankedSession(RANKED_SEED);
          over.econ.gameOver = true;
          expect(dispatchCommand(over, { type: 'setOrder', auto: false }, rec.fx)).toEqual({ ok: false, text: TERMINATED_TEXT });
          expect(rec.named('toast')).toEqual([['toast', TERMINATED_TEXT, 'error']]);
          expect(over.run!.record.log).toEqual([]);
          over.econ.minute = END;   // gameOver wygrywa także po końcu sezonu: bieg się zakończył umową, a nie sezonem
          expect(dispatchCommand(over, { type: 'setOrder', auto: false }, rec.fx).text).toBe(TERMINATED_TEXT);

          const last = createRankedSession(RANKED_SEED);
          last.econ.minute = END - 1;
          expect(dispatchCommand(last, { type: 'setOrder', auto: false }, rec.fx).ok).toBe(true);
          expect(last.run!.record.log).toEqual([{ minute: END - 1, seq: 0, cmd: { type: 'setOrder', auto: false } }]);
        });

        it('zwykła sesja po tej samej minucie przyjmuje polecenia jak dotąd (nie ma sezonu)', () => {
          const s = fresh();
          s.econ.minute = END + 10;
          const rec = recorder();
          expect(dispatchCommand(s, { type: 'setOrder', auto: false }, rec.fx).ok).toBe(true);
          expect(s.run!.record.log).toHaveLength(1);
          const over = fresh();
          over.econ.gameOver = true;
          expect(dispatchCommand(over, { type: 'setOrder', auto: false }, rec.fx).text ?? '').not.toBe(SEASON_OVER_TEXT);
        });

        it('przez game.dispatch: po końcu sezonu odmowa idzie do toastów interfejsu i nic nie trafia do zapisu', () => {
          const h = harness();
          const s = rankedNearEnd(h, 1);
          s.econ.minute = END;
          h.shell.handleEvents([]);
          const keys = snapshot();
          ui.toasts.value = [];

          expect(h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 2 })).toEqual({ ok: false, text: SEASON_OVER_TEXT });

          expect(ui.toasts.value.map((t) => [t.text, t.kind])).toEqual([[SEASON_OVER_TEXT, 'error']]);
          expect(snapshot()).toEqual(keys);
          expect(s.run!.record.log).toEqual([]);
        }, FULL_SEASON_MS);

        it('RUN_LOG_MAX w sesji rankingowej odmawia polecenia i nie wyłącza dziennika; w zwykłej nadal wyłącza dziennik, a polecenie się wykonuje', () => {
          const cmd: Command = { type: 'setOrder', auto: true };
          const fill = (s: GameSession, n: number): void => {
            for (let i = 0; i < n; i++) s.run!.record.log.push({ minute: OPEN_FROM, seq: i, cmd });
            s.run!.seq = n;
          };
          const rec = recorder();

          const ranked = createRankedSession(RANKED_SEED);
          fill(ranked, RUN_LOG_MAX - 1);
          expect(dispatchCommand(ranked, { type: 'setOrder', auto: true, manual: 1 }, rec.fx).ok).toBe(true);   // ostatni wpis się mieści
          expect(ranked.run!.record.log).toHaveLength(RUN_LOG_MAX);
          const before = JSON.stringify(ranked.econ);
          const seq = ranked.run!.seq;
          rec.calls.length = 0;

          const r = dispatchCommand(ranked, { type: 'setOrder', auto: false }, rec.fx);

          expect(r).toEqual({ ok: false, text: LOG_FULL_TEXT });
          expect(rec.named('toast')).toEqual([['toast', LOG_FULL_TEXT, 'error']]);
          expect(ranked.run).not.toBeNull();   // bieg dalej da się zapisać i wysłać
          expect(ranked.run!.record.log).toHaveLength(RUN_LOG_MAX);
          expect(ranked.run!.seq).toBe(seq);
          expect(JSON.stringify(ranked.econ)).toBe(before);
          expect(ranked.econ.order.auto).toBe(true);

          const casual = fresh();
          fill(casual, RUN_LOG_MAX);
          expect(dispatchCommand(casual, { type: 'setOrder', auto: false }, rec.fx).ok).toBe(true);
          expect(casual.run).toBeNull();
          expect(casual.econ.order.auto).toBe(false);
        });
      });

      describe('rezerwa w dzienniku biegu rankingowego: stuknięcia kończą się przed zakupami i kartami', () => {
        /** Dopełnia dziennik do `n` wpisów (poprawnych: minuta i numer rosną), jak po długiej grze. */
        const fillTo = (s: GameSession, n: number): void => {
          const log = s.run!.record.log;
          while (log.length < n) log.push({ minute: OPEN_FROM, seq: log.length, cmd: { type: 'setOrder', auto: true } });
          s.run!.seq = n;
        };
        /** Karta na biurku, na którą wolno odpowiedzieć już teraz. */
        const visibleCard = (s: GameSession) => {
          s.econ.tycoon.cards.pending[0]!.showAt = s.econ.minute;
          return visibleCards(s.econ.tycoon.cards, s.econ.minute)[0]!;
        };

        it('stałe: rezerwa 4000 wpisów, stuknięcia kończą się 4000 przed RUN_LOG_MAX', () => {
          expect(RANKED_LOG_RESERVE).toBe(4_000);
          expect(RANKED_TAP_LOG_MAX).toBe(RUN_LOG_MAX - RANKED_LOG_RESERVE);
          expect(RANKED_TAP_LOG_MAX).toBe(16_000);
        });

        it('przy RANKED_TAP_LOG_MAX − 1 wpisach stuknięcie jest przyjęte i dopisane, od RANKED_TAP_LOG_MAX odmówione bez wpisu i bez zmiany stanu', () => {
          const rec = recorder();
          const s = createRankedSession(RANKED_SEED);
          fillTo(s, RANKED_TAP_LOG_MAX - 1);

          const accepted = dispatchCommand(s, { type: 'tapTill' }, rec.fx);
          expect(accepted.text).not.toBe(TAP_LOG_FULL_TEXT);
          expect(s.run!.record.log).toHaveLength(RANKED_TAP_LOG_MAX);
          expect(s.run!.record.log.at(-1)).toMatchObject({ seq: RANKED_TAP_LOG_MAX - 1, cmd: { type: 'tapTill' } });

          rec.calls.length = 0;
          const before = JSON.stringify(s.econ);
          const seq = s.run!.seq;
          for (const cmd of [{ type: 'tapTill' }, { type: 'tapPallet', palletId: 1 }, { type: 'tapPallet' }] as const) {
            expect(dispatchCommand(s, cmd, rec.fx)).toEqual({ ok: false, text: TAP_LOG_FULL_TEXT });
          }
          expect(rec.named('toast')).toEqual(Array.from({ length: 3 }, () => ['toast', TAP_LOG_FULL_TEXT, 'error']));
          expect(rec.names()).not.toContain('persist');
          expect(rec.names()).not.toContain('handleEvents');
          expect(s.run!.record.log).toHaveLength(RANKED_TAP_LOG_MAX);
          expect(s.run!.seq).toBe(seq);
          expect(s.run).not.toBeNull();
          expect(JSON.stringify(s.econ)).toBe(before);
        });

        it('w rezerwie zakupy, karty i inne polecenia są przyjmowane i logowane aż do RUN_LOG_MAX; dopiero tam odmowa wszystkiego starym tekstem (także stuknięć)', () => {
          const rec = recorder();
          const s = createRankedSession(RANKED_SEED);
          fillTo(s, RANKED_TAP_LOG_MAX);
          s.econ.cash = 1e7;
          s.econ.level = 30;
          const log = s.run!.record.log;

          const bought = dispatchCommand(s, { type: 'buyUpgrade', id: UPGRADES[0]!.id }, rec.fx);
          expect(bought.ok).toBe(true);
          expect(log).toHaveLength(RANKED_TAP_LOG_MAX + 1);
          expect(log.at(-1)!.cmd.type).toBe('buyUpgrade');

          const card = visibleCard(s);
          expect(dispatchCommand(s, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer }, rec.fx).ok).toBe(true);
          expect(log).toHaveLength(RANKED_TAP_LOG_MAX + 2);
          expect(log.at(-1)!.cmd.type).toBe('answerCard');
          expect(awaitingDecision(s.econ)).toBe(false);   // odpowiedź naprawdę zadziałała

          fillTo(s, RUN_LOG_MAX - 1);
          expect(dispatchCommand(s, { type: 'setOrder', auto: false }, rec.fx).ok).toBe(true);   // ostatni wpis się mieści
          expect(log).toHaveLength(RUN_LOG_MAX);

          const before = JSON.stringify(s.econ);
          rec.calls.length = 0;
          for (const cmd of [
            { type: 'tapTill' }, { type: 'tapPallet' }, { type: 'buyUpgrade', id: UPGRADES[1]!.id }, { type: 'answerCard', seq: card.seq + 1, answer: 0 }, { type: 'setOrder', auto: true },
          ] as const) {
            expect(dispatchCommand(s, cmd, rec.fx)).toEqual({ ok: false, text: LOG_FULL_TEXT });
          }
          expect(rec.named('toast')).toEqual(Array.from({ length: 5 }, () => ['toast', LOG_FULL_TEXT, 'error']));
          expect(log).toHaveLength(RUN_LOG_MAX);
          expect(s.run).not.toBeNull();
          expect(JSON.stringify(s.econ)).toBe(before);
        });

        it('zwykła sesja bez zmian: stuknięcia logowane do RUN_LOG_MAX (także powyżej RANKED_TAP_LOG_MAX), potem markOffLog, a stuknięcie się wykonuje', () => {
          const rec = recorder();
          const casual = fresh();
          fillTo(casual, RANKED_TAP_LOG_MAX + 5);
          const tapped = dispatchCommand(casual, { type: 'tapTill' }, rec.fx);
          expect(tapped.text).not.toBe(TAP_LOG_FULL_TEXT);
          expect(casual.run!.record.log).toHaveLength(RANKED_TAP_LOG_MAX + 6);
          expect(casual.run!.record.log.at(-1)!.cmd.type).toBe('tapTill');
          expect(rec.named('toast').filter(([, text]) => text === TAP_LOG_FULL_TEXT)).toEqual([]);

          fillTo(casual, RUN_LOG_MAX);
          const cash = casual.econ.cash;
          dispatchCommand(casual, { type: 'tapTill' }, rec.fx);
          expect(casual.run).toBeNull();   // ten wpis przekroczyłby limit: dziennika już nie prowadzimy
          expect(casual.econ.cash).toBeGreaterThanOrEqual(cash);
          expect(rec.named('toast').filter(([, text]) => text === TAP_LOG_FULL_TEXT || text === LOG_FULL_TEXT)).toEqual([]);
        });

        it('sezon zamyka się też z dziennikiem w strefie rezerwy: szuflada z całym dziennikiem, wynik, aktywny zapis zdjęty', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          fillTo(s, RANKED_TAP_LOG_MAX + 1_000);   // 17 000 wpisów: stuknięcia już odmawiane, reszta działa
          expect(h.shell.game.dispatch({ type: 'tapTill' })).toEqual({ ok: false, text: TAP_LOG_FULL_TEXT });
          s.econ.minute = END;

          h.shell.handleEvents([]);

          const drawer = loadFinished()!;
          expect(drawer.seed).toBe(RANKED_SEED);
          expect(drawer.record.log).toHaveLength(RANKED_TAP_LOG_MAX + 1_000);
          expect(Number.isInteger(drawer.score)).toBe(true);
          expect(storage.getItem('traszka:ranked')).toBeNull();
          expect(ui.unsent.value).toEqual({ seed: RANKED_SEED, score: drawer.score });
          expect(ui.ranked.value?.phase).toBe('over');
          expect(h.notices).toEqual([]);
        }, FULL_SEASON_MS);
      });

      describe('nagrody poza dziennikiem są wyłączone w biegu rankingowym', () => {
        it('skip nic nie robi: minuta, stan, dziennik i scena nietknięte', () => {
          const h = harness();
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          h.shell.game.dispatch({ type: 'setOrder', auto: false, manual: 2 });
          const before = JSON.stringify(s.econ);
          const log = s.run!.record.log.length;
          h.scene.syncs.length = 0;

          h.shell.skip(120);

          expect(JSON.stringify(s.econ)).toBe(before);
          expect(s.run).not.toBeNull();
          expect(s.run!.record.log).toHaveLength(log);
          expect(h.scene.syncs).toEqual([]);
        });

        it('openNextStore odmawia z komunikatem i niczego nie zmienia: sesja, sieć w mecie, zapisy', () => {
          const h = harness({ seeds: ['nowy-1'] });
          casualOpen(h, 'traszka-1');
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          s.econ.total.margin = 80_000;   // prestiż byłby gotowy
          s.econ.bestDayProfit = 5000;
          const keys = snapshot();
          const meta = h.shell.meta;
          const network = [...meta.network];
          h.scene.loads.length = 0;

          h.shell.game.openNextStore();

          expect(h.notices).toEqual([NO_NETWORK_NOTICE]);
          expect(h.shell.session).toBe(s);
          expect(h.shell.meta).toBe(meta);
          expect(meta.network).toEqual(network);
          expect(snapshot()).toEqual(keys);
          expect(h.scene.loads).toEqual([]);
          expect(ui.celebration.value).toBeNull();
          expect(hasStoredSave('traszka-1')).toBe(true);
        });

        it('restart odmawia z komunikatem: nie kasuje zwykłego zapisu ani biegu, nie otwiera nowego świata, nie zamyka raportu', () => {
          const h = harness();
          casualOpen(h, 'traszka-1');
          h.shell.startRanked(RANKED_SEED);
          const s = h.shell.session!;
          ui.report.value = { label: 'x', counters: s.econ.total, profit: 0, cash: 0, comment: '', detail: null };
          const keys = snapshot();
          h.scene.loads.length = 0;

          h.shell.game.restart();

          expect(h.notices).toEqual([NO_RESTART_NOTICE]);
          expect(h.shell.session).toBe(s);
          expect(snapshot()).toEqual(keys);   // zapis sklepu 'traszka-1', traszka:last i traszka:ranked na miejscu
          expect(h.scene.loads).toEqual([]);
          expect(ui.report.value).not.toBeNull();
          expect(getPlayMode()).toBe('ranked');
        });

        it('wejście w bieg nie pokazuje okna powitalnego ani dymków, choć meta ma nagrodę za nieobecność i serię dni', () => {
          const meta: Meta = { ...loadMeta(), lastSeen: Date.now() - 6 * 3_600_000 };
          const h = harness({ meta });
          h.shell.startRanked(RANKED_SEED);
          expect(ui.welcome.value).toBeNull();
          expect(ui.hints.value).toEqual([]);
          expect(h.shell.session!.run).not.toBeNull();
        });

        it('zwykłe skip, restart i openNextStore działają jak dotąd', () => {
          const h = harness({ seeds: ['nowy-1'] });
          const s = open(h, 'traszka-1');
          h.shell.skip(10);
          expect(s.econ.minute).toBe(OPEN_FROM + 10);
          expect(s.run).toBeNull();
          h.shell.game.restart();
          expect(h.shell.session).not.toBe(s);
          expect(h.notices).toEqual([]);
        });
      });
    });
  });
});

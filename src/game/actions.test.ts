import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { COMMAND_TYPES, type Command } from '@/sim/economy/commands';
import { stepMinute, type CommandResult, type EconEvent } from '@/sim/economy/economy';
import { questMetric } from '@/sim/economy/quests';
import { UPGRADES } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import { replayRun, type LogEntry } from '@/sim/run';
import { AFTER, dispatchCommand, markOffLog, type CommandEffects } from './actions';
import { MemoryStorage } from './memoryStorage';
import { RUN_LOG_MAX, createSession, saveSession, withLayoutFromSeed, type GameSession } from './session';

const SEED = 'traszka-1';
const REBUILD_NOTICE = 'Nie udało się przebudować sklepu po remoncie. Postęp jest zapisany — odśwież stronę.';

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

/** Zlecenie gotowe do odebrania: początek licznika cofnięty o cel. */
function finishQuest(s: GameSession, index = 0): number {
  const q = s.econ.quests[index]!;
  q.start = questMetric(s.econ, q.kind) - q.target;
  return q.id;
}

describe('dziennik biegu', () => {
  it('polecenie trafia do dziennika z minutą stanu i kolejnym seq, także nieudane', () => {
    const s = fresh();
    const { fx } = recorder();
    const accepted: Command = { type: 'setOrder', auto: false, manual: 4 };
    const refused: Command = { type: 'claimQuest', questId: 999 };

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
      { type: 'movePallet', palletId: 1, loc: 'backroom' }, { type: 'hire' }, { type: 'setPriority', priority: 'palety' },
      { type: 'buyUpgrade', id: firstUpgrade }, { type: 'claimGift' }, { type: 'startRemont' }, { type: 'claimQuest', questId: 1 },
      { type: 'fire' }, { type: 'returnPallet', palletId: 2 }, { type: 'campaign' }, { type: 'rushRemont' }, { type: 'setOrder', auto: true },
    ];
    const results: CommandResult[] = [];
    const events: EconEvent[] = [];
    let issued = 0;
    for (let i = 0; i < 2 * MINUTES_PER_DAY; i++) {
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
    expect(log(s)).toHaveLength(issued);
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
    const r = dispatchCommand(s, { type: 'claimQuest', questId: 999 }, rec.fx);

    expect(r).toEqual({ ok: false, text: 'Nie ma takiego zlecenia.' });
    expect(rec.calls).toEqual([
      ['toast', 'Nie ma takiego zlecenia.', 'error'],
      ['play', 'error'],
      ['handleEvents', []],
      ['refresh'],
    ]);   // żadnego 'persist', 'play' sukcesu, 'buzz' ani 'confetti', choć claimQuest po sukcesie zapisuje
  });

  it('claimQuest: coins, wibracja, konfetti 0.5/0.6/28 i zapis', () => {
    const s = fresh();
    const rec = recorder();
    const id = finishQuest(s);
    const r = dispatchCommand(s, { type: 'claimQuest', questId: id }, rec.fx);

    expect(r.ok).toBe(true);
    expect(rec.names()).toEqual(['toast', 'play', 'buzz', 'confetti', 'handleEvents', 'persist', 'refresh']);
    expect(rec.calls[0]).toEqual(['toast', (r as { text: string }).text, 'ok']);
    expect(rec.calls[1]).toEqual(['play', 'coins']);
    expect(rec.calls[2]).toEqual(['buzz', [15, 30, 15]]);
    expect(rec.calls[3]).toEqual(['confetti', 0.5, 0.6, 28]);
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
      const seen: { stage: string; level: number; layout: unknown; info: unknown }[] = [];
      const snapshot = (stage: string): void => { seen.push({ stage, level: s.layoutLevel, layout: s.layout, info: s.info }); };
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
      claimQuest: { okToast: true, sfx: 'coins', buzz: [15, 30, 15], confetti: { fx: 0.5, fy: 0.6, count: 28 }, persist: true },
      claimGift: { okToast: true, sfx: 'gift', buzz: [10, 20, 10] },
      movePallet: { okToast: true },
      returnPallet: { okToast: true, clearSelection: 'after' },
      setOrder: { okToast: false },
      setPriority: { okToast: false },
      hire: { okToast: false },
      fire: { okToast: false },
      buyUpgrade: { okToast: true, sfx: 'coins', persist: true },
      buyEquipment: { okToast: true, sfx: 'coins', persist: true },
      startRemont: { okToast: true, persist: true, clearSelection: 'before' },
      campaign: { okToast: true },
      rushRemont: { okToast: true },
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type EconEvent } from '@/sim/economy/economy';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
import { freshRun, replayRun } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { dispatchCommand, markOffLog, type CommandEffects } from './actions';
import { MemoryStorage } from './memoryStorage';
import {
  RANKED_DAYS, RANKED_KEYS, clearFinished, createRankedSession, discardRanked, finishRun, getPlayMode, holdFinished, loadFinished, loadRanked,
  pendingFinished, rankedDayOf, rankedRunStale, saveFinished, saveRanked, seasonOver, setPlayMode, storedRankedBlock, type FinishedRun,
} from './rankedRun';
import { GAME_VERSION } from './version';
import { SAVE_SCHEMA, createSession, deleteSave, discardSave, newRunLog, retireSession, reviveSession, saveSession, type GameSession } from './session';

const SEED = 'kiełbasa-42';
const END = RANKED_SEASON_END_MINUTE;

/** Efekty poleceń bez skutków: te testy sprawdzają dziennik i zapis, nie dźwięk ani scenę. */
const NO_EFFECTS: CommandEffects = {
  play: () => {}, buzz: () => {}, toast: () => {}, confetti: () => {}, handleEvents: () => {}, persist: () => {}, clearSelection: () => {},
  rebuildScene: () => {}, notice: () => {}, refresh: () => {},
};

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dispatch = (s: GameSession, cmd: Command): boolean => dispatchCommand(s, cmd, NO_EFFECTS).ok;

/**
 * Gra przez `minutes` minut tak jak żywa gra: karta do odpowiedzi dostaje odpowiedź domyślną (przez `dispatchCommand`, więc wpada do
 * dziennika), co `tapEvery` minut jest stuknięcie w paletę, a każda minuta to `stepMinute`.
 */
function play(s: GameSession, minutes: number, tapEvery = 45): void {
  const events: EconEvent[] = [];
  for (let i = 0; i < minutes; i++) {
    if (awaitingDecision(s.econ)) {
      for (const card of visibleCards(s.econ.tycoon.cards, s.econ.minute)) {
        dispatch(s, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
      }
    }
    if (i % tapEvery === 0) dispatch(s, { type: 'tapPallet' });
    events.length = 0;
    stepMinute(s.econ, s.info, events);
  }
}

const log = (s: GameSession) => s.run!.record.log;

describe('createRankedSession', () => {
  it('świeży sklep z seeda bez premii sieci, tryb rankingowy i pusty dziennik rankingowy', () => {
    const s = createRankedSession(SEED);
    const start = freshRun(SEED);

    expect(s.mode).toBe('ranked');
    expect(s.seed).toBe(SEED);
    expect(s.econ.partner).toEqual({ points: 0, networkIncome: 0, stores: 0 });
    expect(JSON.stringify(s.econ)).toBe(JSON.stringify(start.state));   // dokładnie ten stan, od którego startuje `replayRun`
    expect(s.layout).toEqual(start.layout);
    expect(s.layoutLevel).toBe(0);
    expect(s.fromSave).toBe(false);
    expect(s.ephemeral).toBe(false);
    expect(s.retired).toBe(false);
    expect(s.loadNotice).toBeNull();
    expect(s.run!.record.mode).toBe('ranked');
    expect(s.run).toEqual(newRunLog(SEED, 'ranked'));
    expect(s.run!.record).toMatchObject({ seed: SEED, gameVersion: GAME_VERSION, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, log: [] });
    expect(s.run!.seq).toBe(0);
  });

  it('zwykła sesja ma tryb casual', () => {
    expect(createSession(SEED, true).mode).toBe('casual');
    saveSession(createSession(SEED, true));
    expect(createSession(SEED).mode).toBe('casual');   // także ta z zapisu
  });
});

describe('zapis i wznawianie biegu', () => {
  it('zapis → loadRanked oddaje ten sam stan, dziennik i seq; dalsze polecenia dopisują wpisy bez luki i bez powtórki', () => {
    const s = createRankedSession(SEED);
    play(s, 2 * MINUTES_PER_DAY);
    expect(log(s).length).toBeGreaterThan(10);
    expect(saveRanked(s)).toBe(true);

    const raw = storage.getItem(RANKED_KEYS.active)!;
    const stored = JSON.parse(raw) as { schema: number; seed: string; savedAt: number; save: { schema: number }; run: { log: unknown[]; seq: number } };
    expect(stored).toMatchObject({
      schema: 1, seed: SEED, save: { schema: SAVE_SCHEMA, gameVersion: GAME_VERSION, generatorVersion: GENERATOR_VERSION },
      run: { seq: s.run!.seq, simVersion: SIM_VERSION },
    });
    expect(Number.isFinite(stored.savedAt)).toBe(true);
    expect(Object.keys(stored.run).sort()).toEqual(['log', 'seq', 'simVersion']);

    const loaded = loadRanked();
    expect(loaded.status).toBe('ok');
    const r = (loaded as { status: 'ok'; session: GameSession }).session;
    expect(r.mode).toBe('ranked');
    expect(r.fromSave).toBe(true);
    expect(r.ephemeral).toBe(false);
    expect(r.retired).toBe(false);
    expect(r.seed).toBe(SEED);
    expect(r.econ.minute).toBe(s.econ.minute);
    expect(r.econ).toEqual(s.econ);
    expect(r.layout).toEqual(s.layout);
    expect(r.run).not.toBeNull();
    expect(r.run!.record).toEqual(s.run!.record);
    expect(r.run!.seq).toBe(s.run!.seq);

    // dalsza gra: wpisy z seq od miejsca, w którym skończył zapis
    const before = log(r).length;
    const nextSeq = r.run!.seq;
    expect(dispatch(r, { type: 'setOrder', auto: false, manual: 4 })).toBe(true);
    play(r, 30, 7);
    const seqs = log(r).map((e) => e.seq);
    expect(log(r).length).toBeGreaterThan(before + 2);
    expect(seqs.slice(0, before)).toEqual(log(s).map((e) => e.seq));
    expect(seqs.slice(before)[0]).toBe(nextSeq);
    expect(seqs).toEqual(seqs.map((_, i) => i));   // 0, 1, 2…: bez luki i bez powtórki
    expect(r.run!.seq).toBe(seqs.length);

    // wznowiony bieg dalej jest odtwarzalny: stan sesji to dokładnie to, co daje `replayRun` z jej dziennika
    expect(replayRun(r.run!.record, r.econ.minute)).toEqual(r.econ);
  });

  it('kolejne polecenia dostają seq z zapisu, nie długość dziennika (seq większe od liczby wpisów, np. po wpisach spoza zapisu)', () => {
    const s = createRankedSession(SEED);
    play(s, 100);
    s.run!.seq += 7;   // dziennik ma lukę w numeracji; ważne jest tylko, że zapisane seq jest większe od każdego wpisu
    const expected = s.run!.seq;
    saveRanked(s);

    const loaded = loadRanked() as { status: 'ok'; session: GameSession };
    expect(loaded.status).toBe('ok');
    expect(loaded.session.run!.seq).toBe(expected);
    expect(dispatch(loaded.session, { type: 'setOrder', auto: false, manual: 4 })).toBe(true);
    expect(log(loaded.session).at(-1)!.seq).toBe(expected);
    expect(loaded.session.run!.seq).toBe(expected + 1);
  });

  it('bez zapisu loadRanked mówi none, a po discardRanked znów none (kopia w :broken i szuflada zostają)', () => {
    expect(loadRanked()).toEqual({ status: 'none' });

    const s = createRankedSession(SEED);
    play(s, 100);
    saveRanked(s);
    storage.setItem(RANKED_KEYS.broken, 'stara kopia');
    storage.setItem(RANKED_KEYS.done, 'szuflada');
    discardRanked();
    expect(loadRanked()).toEqual({ status: 'none' });
    expect(storage.getItem(RANKED_KEYS.active)).toBeNull();
    expect(storage.getItem(RANKED_KEYS.broken)).toBe('stara kopia');
    expect(storage.getItem(RANKED_KEYS.done)).toBe('szuflada');
  });

  it('klucze zapisu rankingowego', () => {
    expect(RANKED_KEYS).toEqual({
      active: 'traszka:ranked', done: 'traszka:ranked:done', broken: 'traszka:ranked:broken', mode: 'traszka:mode',
    });
  });

  it('zapis rankingowy nie rusza zwykłego sklepu o tym samym seedzie ani traszka:last, a zwykły zapis nie rusza biegu', () => {
    const casual = createSession(SEED, true);
    dispatch(casual, { type: 'setOrder', auto: false, manual: 3 });
    saveSession(casual);
    const casualRaw = storage.getItem(`traszka:save:${SEED}`);
    expect(casualRaw).not.toBeNull();
    expect(storage.getItem('traszka:last')).toBe(SEED);

    const ranked = createRankedSession(SEED);
    play(ranked, MINUTES_PER_DAY);
    expect(saveRanked(ranked)).toBe(true);
    expect(loadRanked().status).toBe('ok');
    expect(storage.getItem(`traszka:save:${SEED}`)).toBe(casualRaw);
    expect(storage.getItem('traszka:last')).toBe(SEED);
    expect(storage.keys().sort()).toEqual(['traszka:last', RANKED_KEYS.active, `traszka:save:${SEED}`].sort());
    discardRanked();
    expect(storage.getItem(`traszka:save:${SEED}`)).toBe(casualRaw);

    // odwrotnie: zwykły sklep o tym seedzie (zapis, kasowanie) nie ma wpływu na bieg rankingowy
    expect(saveRanked(ranked)).toBe(true);
    const rankedRaw = storage.getItem(RANKED_KEYS.active);
    saveSession(casual);
    deleteSave(SEED);
    expect(storage.getItem(RANKED_KEYS.active)).toBe(rankedRaw);
    expect(createSession(SEED).fromSave).toBe(false);   // zwykły sklep o tym seedzie startuje od zera: zapisu rankingowego nie czyta
  });

  it('saveRanked odmawia sesji zwykłej i sesji bez dziennika, i niczego wtedy nie zapisuje ani nie kasuje', () => {
    expect(saveRanked(createSession(SEED, true))).toBe(false);
    expect(storage.keys()).toEqual([]);

    const s = createRankedSession(SEED);
    play(s, 100);
    expect(saveRanked(s)).toBe(true);
    const good = storage.getItem(RANKED_KEYS.active);
    play(s, 50);
    markOffLog(s);
    expect(saveRanked(s)).toBe(false);
    expect(storage.getItem(RANKED_KEYS.active)).toBe(good);   // ostatni dobry zapis zostaje
  });
});

describe('uszkodzony zapis biegu', () => {
  interface Doc {
    schema: unknown;
    seed: unknown;
    savedAt: number;
    save: { schema: unknown; seed: unknown; gameVersion?: unknown; generatorVersion?: unknown; econ: { minute: number; partner?: unknown } | unknown };
    run?: { log: Record<string, unknown>[]; seq: unknown; simVersion?: unknown } | unknown;
  }
  /** Prawdziwy zapis po dobie gry (kilkadziesiąt wpisów), do zepsucia na różne sposoby. */
  function genuine(): Doc {
    const s = createRankedSession(SEED);
    play(s, MINUTES_PER_DAY);
    expect(saveRanked(s)).toBe(true);
    return JSON.parse(storage.getItem(RANKED_KEYS.active)!) as Doc;
  }
  const run = (d: Doc) => d.run as { log: Record<string, unknown>[]; seq: unknown; simVersion?: unknown };
  const minuteOf = (d: Doc) => (d.save.econ as { minute: number }).minute;

  const CASES: [string, (d: Doc) => void][] = [
    ['wpis z minutą większą od minuty stanu', (d) => {
      const seq = run(d).seq as number;
      run(d).log.push({ minute: minuteOf(d) + 1, seq, cmd: { type: 'tapPallet' } });
      run(d).seq = seq + 1;
    }],
    ['polecenie bez type', (d) => { run(d).log[0]!.cmd = { auto: true }; }],
    ['polecenie z nieznanym type', (d) => { run(d).log[0]!.cmd = { type: 'oszukaj' }; }],
    ['polecenie ze złym polem', (d) => { run(d).log[0]!.cmd = { type: 'answerCard', seq: 'a', answer: 0 }; }],
    ['wpis bez seq', (d) => { delete run(d).log[0]!.seq; }],
    ['wpis nie jest obiektem', (d) => { run(d).log[0] = 5 as unknown as Record<string, unknown>; }],
    ['wpisy poza kolejnością seq', (d) => { run(d).log.reverse(); }],
    ['powtórzony seq w jednej minucie', (d) => { run(d).log[1]!.minute = run(d).log[0]!.minute; run(d).log[1]!.seq = run(d).log[0]!.seq; }],
    ['ułamkowa minuta wpisu', (d) => { run(d).log[0]!.minute = 400.5; }],
    ['ujemny seq wpisu', (d) => { run(d).log[0]!.seq = -1; }],
    ['brak pola run', (d) => { delete d.run; }],
    ['run nie jest obiektem', (d) => { d.run = []; }],
    ['log nie jest tablicą', (d) => { run(d).log = {} as unknown as Record<string, unknown>[]; }],
    ['seq nie większy od seq ostatniego wpisu', (d) => { run(d).seq = run(d).log.at(-1)!.seq; }],
    ['seq ułamkowy', (d) => { run(d).seq = (run(d).seq as number) + 0.5; }],
    ['seq nie jest liczbą', (d) => { run(d).seq = '12'; }],
    ['schemat zapisu biegu 0', (d) => { d.schema = 0; }],
    ['schemat zapisu biegu nie jest liczbą', (d) => { d.schema = 'x'; }],
    ['brak simVersion w run', (d) => { delete run(d).simVersion; }],
    ['simVersion nie jest liczbą', (d) => { run(d).simVersion = '2'; }],
    ['simVersion ułamkowy', (d) => { run(d).simVersion = 1.5; }],
    ['simVersion ujemny', (d) => { run(d).simVersion = -1; }],
    ['simVersion null', (d) => { run(d).simVersion = null; }],
    ['gameVersion koperty nie jest napisem', (d) => { d.save.gameVersion = 5; }],
    ['brak generatorVersion w kopercie', (d) => { delete d.save.generatorVersion; }],
    ['generatorVersion koperty ułamkowy', (d) => { d.save.generatorVersion = GENERATOR_VERSION + 0.5; }],
    ['brak schematu zapisu biegu', (d) => { delete (d as Partial<Doc>).schema; }],
    ['seed zapisu biegu różny od seedu koperty', (d) => { d.seed = 'inny-seed'; }],
    ['seed koperty różny od seedu zapisu biegu', (d) => { d.save.seed = 'inny-seed'; }],
    ['koperta stanu w złym schemacie', (d) => { d.save.schema = 1; }],
    ['koperta stanu bez schematu, z version 1 (zapis dawnego sklepu)', (d) => { delete (d.save as Partial<Doc['save']>).schema; (d.save as { version?: number }).version = 1; }],
    ['stan nie jest obiektem', (d) => { d.save.econ = 5; }],
    ['premia sieci sklepów w stanie biegu', (d) => { (d.save.econ as { partner: unknown }).partner = { points: 3, networkIncome: 0, stores: 0 }; }],
  ];

  it.each(CASES)('%s: broken, kopia w :broken, aktywny klucz zwolniony', (_name, spoil) => {
    const d = genuine();
    spoil(d);
    const raw = JSON.stringify(d);
    storage.setItem(RANKED_KEYS.active, raw);

    expect(loadRanked()).toEqual({ status: 'broken' });
    expect(storage.getItem(RANKED_KEYS.broken)).toBe(raw);
    expect(storage.getItem(RANKED_KEYS.active)).toBeNull();
    expect(loadRanked()).toEqual({ status: 'none' });
  });

  it.each([
    ['nie-JSON', 'to nie jest json{'],
    ['null', 'null'],
    ['tablica', '[]'],
    ['liczba', '5'],
  ])('%s w kluczu aktywnym: broken z kopią', (_name, raw) => {
    storage.setItem(RANKED_KEYS.active, raw);
    expect(loadRanked()).toEqual({ status: 'broken' });
    expect(storage.getItem(RANKED_KEYS.broken)).toBe(raw);
    expect(storage.getItem(RANKED_KEYS.active)).toBeNull();
  });

  it('wpis z minutą równą minucie stanu jest dobry (polecenie wydane w bieżącej minucie)', () => {
    const s = createRankedSession(SEED);
    play(s, 200);
    expect(dispatch(s, { type: 'tapTill' })).toBe(false);   // nieudane polecenie też trafia do dziennika
    expect(log(s).at(-1)!.minute).toBe(s.econ.minute);
    saveRanked(s);
    expect(loadRanked().status).toBe('ok');
  });

  it('uszkodzony zapis nie rusza zwykłego sklepu o tym samym seedzie', () => {
    saveSession(createSession(SEED, true));
    const casualRaw = storage.getItem(`traszka:save:${SEED}`);
    const d = genuine();
    delete d.run;
    storage.setItem(RANKED_KEYS.active, JSON.stringify(d));
    expect(loadRanked()).toEqual({ status: 'broken' });
    expect(storage.getItem(`traszka:save:${SEED}`)).toBe(casualRaw);
    expect(storage.getItem('traszka:last')).toBe(SEED);
  });

  it('gdy na kopię nie ma miejsca, aktywny klucz i tak jest zwolniony, a wołający dostaje broken', () => {
    const d = genuine();
    delete d.run;
    storage.setItem(RANKED_KEYS.active, JSON.stringify(d));
    storage.failWrites = true;
    expect(loadRanked()).toEqual({ status: 'broken' });
    expect(storage.getItem(RANKED_KEYS.active)).toBeNull();
    expect(storage.getItem(RANKED_KEYS.broken)).toBeNull();
  });
});

describe('bieg zapisany w innej wersji gry', () => {
  interface Stored {
    schema: number;
    seed: string;
    save: { schema: number; gameVersion: string; generatorVersion: number };
    run: { log: { cmd: unknown }[]; seq: number; simVersion: number };
  }
  /** Prawdziwy zapis po dobie gry, do przepisania na zapis z innej wersji. */
  function stored(): Stored {
    const s = createRankedSession(SEED);
    play(s, MINUTES_PER_DAY);
    expect(saveRanked(s)).toBe(true);
    return JSON.parse(storage.getItem(RANKED_KEYS.active)!) as Stored;
  }
  /** Wkłada zapis do pamięci i zwraca jego surowy tekst. */
  const put = (d: unknown): string => {
    const raw = JSON.stringify(d);
    storage.setItem(RANKED_KEYS.active, raw);
    return raw;
  };
  /** Zapis ma zostać dokładnie taki, jaki był, i bez kopii w :broken (nic nie zostało zniszczone ani przeniesione). */
  const expectUntouched = (raw: string): void => {
    expect(storage.getItem(RANKED_KEYS.active)).toBe(raw);
    expect(storage.getItem(RANKED_KEYS.broken)).toBeNull();
  };
  const ok = (): GameSession => {
    const l = loadRanked();
    expect(l.status).toBe('ok');
    return (l as { status: 'ok'; session: GameSession }).session;
  };

  it.each([[GENERATOR_VERSION + 1], [GENERATOR_VERSION - 1]])('generator %i w zapisie: incompatible, klucz nietknięty, nic w :broken', (generatorVersion) => {
    const d = stored();
    d.save.generatorVersion = generatorVersion;
    const raw = put(d);
    expect(loadRanked()).toEqual({ status: 'incompatible' });
    expectUntouched(raw);
    expect(loadRanked()).toEqual({ status: 'incompatible' });   // i za drugim razem, i za trzecim: nic się nie zużywa
    expectUntouched(raw);
  });

  it('inny generator wygrywa z dziennikiem, którego ten kod nie rozumie: zapis z innej wersji nie idzie do :broken', () => {
    const d = stored();
    d.save.generatorVersion = GENERATOR_VERSION + 1;
    d.run.log[0]!.cmd = { type: 'polecenie-z-przyszlosci' };
    d.run.seq = 'śmieci' as unknown as number;
    const raw = put(d);
    expect(loadRanked()).toEqual({ status: 'incompatible' });
    expectUntouched(raw);
  });

  it.each([2, 3, 99, 1.5])('nowszy schemat zapisu biegu (%s): incompatible, klucz nietknięty, nic w :broken', (schema) => {
    const raw = put({ schema, seed: SEED, cośNowego: { zupełnie: 'inny kształt' } });
    expect(loadRanked()).toEqual({ status: 'incompatible' });
    expectUntouched(raw);
  });

  it('schemat 1e999 (JSON.parse daje Infinity) to też nowszy zapis', () => {
    const raw = '{"schema":1e999,"seed":"kiełbasa-42"}';
    storage.setItem(RANKED_KEYS.active, raw);
    expect(loadRanked()).toEqual({ status: 'incompatible' });
    expectUntouched(raw);
  });

  it('nowszy schemat koperty stanu: incompatible, klucz nietknięty, nic w :broken', () => {
    const d = stored();
    d.save.schema = SAVE_SCHEMA + 1;
    (d.save as Record<string, unknown>).cośNowego = [1, 2, 3];
    const raw = put(d);
    expect(loadRanked()).toEqual({ status: 'incompatible' });
    expectUntouched(raw);
  });

  it('zapis ze starszym simVersion wraca jako ok ze starym simVersion; finishRun niesie go do biegu, a ponowny zapis go nie nadpisuje', () => {
    const d = stored();
    d.run.simVersion = SIM_VERSION - 1;
    put(d);
    const r = ok();

    expect(r.run!.record.simVersion).toBe(SIM_VERSION - 1);
    expect(r.run!.record).toMatchObject({ generatorVersion: GENERATOR_VERSION, gameVersion: GAME_VERSION, mode: 'ranked' });
    expect(rankedRunStale(r)).toBe(true);

    play(r, 20, 5);   // gra toczy się dalej, a ponowny zapis nie przepisuje wersji na bieżącą
    expect(saveRanked(r)).toBe(true);
    expect((JSON.parse(storage.getItem(RANKED_KEYS.active)!) as Stored).run.simVersion).toBe(SIM_VERSION - 1);
    expect(rankedRunStale(ok())).toBe(true);

    const f = finishRun(r, 77)!;
    expect(f.record.simVersion).toBe(SIM_VERSION - 1);
    expect(saveFinished(f)).toBe(true);
    expect(loadFinished()!.record.simVersion).toBe(SIM_VERSION - 1);
  });

  it('gameVersion i generatorVersion rekordu pochodzą z zapisu, także po ponownym zapisie', () => {
    const d = stored();
    d.save.gameVersion = 'stara-wersja+abc123';
    put(d);
    const r = ok();
    expect(r.run!.record.gameVersion).toBe('stara-wersja+abc123');
    expect(r.run!.record.generatorVersion).toBe(GENERATOR_VERSION);
    expect(r.run!.record.simVersion).toBe(SIM_VERSION);
    expect(rankedRunStale(r)).toBe(false);   // sama wersja gry niczego nie unieważnia

    expect(saveRanked(r)).toBe(true);
    expect((JSON.parse(storage.getItem(RANKED_KEYS.active)!) as Stored).save).toMatchObject({ gameVersion: 'stara-wersja+abc123', generatorVersion: GENERATOR_VERSION });
    expect(ok().run!.record.gameVersion).toBe('stara-wersja+abc123');
  });

  it('bieg w bieżących wersjach nie jest nieaktualny; sesja bez dziennika też nie', () => {
    const s = createRankedSession(SEED);
    expect(rankedRunStale(s)).toBe(false);
    play(s, 100);
    saveRanked(s);
    expect(rankedRunStale(ok())).toBe(false);
    expect(rankedRunStale(createSession(SEED, true))).toBe(false);

    s.run!.record.simVersion = SIM_VERSION + 1;   // także nowsza wersja niż bieżąca to nie ta, którą liczy sędzia
    expect(rankedRunStale(s)).toBe(true);
    s.run!.record.simVersion = SIM_VERSION - 1;
    expect(rankedRunStale(s)).toBe(true);
    markOffLog(s);
    expect(rankedRunStale(s)).toBe(false);
  });

  it('szuflada z biegiem w innej wersji symulacji zostaje: loadFinished go oddaje i niczego nie czyści', () => {
    const f: FinishedRun = {
      v: 1, seed: SEED, record: { ...newRunLog(SEED, 'ranked').record, simVersion: SIM_VERSION - 1, generatorVersion: GENERATOR_VERSION - 1, gameVersion: 'stara' },
      score: 321, finishedAt: 9,
    };
    expect(saveFinished(f)).toBe(true);
    const raw = storage.getItem(RANKED_KEYS.done);
    expect(loadFinished()).toEqual(f);
    expect(storage.getItem(RANKED_KEYS.done)).toBe(raw);
  });
});

describe('sesja rankingowa a zapisy zwykłego sklepu', () => {
  it('saveSession, discardSave, retireSession i reviveSession na prawdziwej sesji rankingowej nie ruszają traszka:save:<seed> ani traszka:last', () => {
    const casual = createSession(SEED, true);
    saveSession(casual);
    storage.setItem('traszka:last', 'inny-sklep');
    const casualRaw = storage.getItem(`traszka:save:${SEED}`);

    const ranked = createRankedSession(SEED);
    play(ranked, 100);
    saveSession(ranked);
    discardSave(ranked);
    retireSession(ranked);
    reviveSession(ranked);
    expect(storage.getItem(`traszka:save:${SEED}`)).toBe(casualRaw);
    expect(storage.getItem('traszka:last')).toBe('inny-sklep');
    expect(storage.keys().sort()).toEqual(['traszka:last', `traszka:save:${SEED}`].sort());

    saveRanked(ranked);
    saveSession(ranked);
    discardRanked();
    expect(storage.getItem(`traszka:save:${SEED}`)).toBe(casualRaw);
  });
});

describe('szuflada niewysłanego biegu', () => {
  const finished = (over: Partial<FinishedRun> = {}): FinishedRun => ({
    v: 1, seed: SEED, record: { ...newRunLog(SEED, 'ranked').record, log: [{ minute: OPEN_FROM, seq: 0, cmd: { type: 'tapPallet' } }] },
    score: 12345, finishedAt: 1_700_000_000_000, ...over,
  });
  const put = (value: unknown): void => storage.setItem(RANKED_KEYS.done, typeof value === 'string' ? value : JSON.stringify(value));

  it('saveFinished → loadFinished oddaje ten sam bieg, a clearFinished go zabiera', () => {
    expect(loadFinished()).toBeNull();
    const f = finished();
    expect(saveFinished(f)).toBe(true);
    expect(loadFinished()).toEqual(f);
    expect(storage.getItem(RANKED_KEYS.active)).toBeNull();   // szuflada to osobny klucz
    clearFinished();
    expect(loadFinished()).toBeNull();
    expect(storage.getItem(RANKED_KEYS.done)).toBeNull();
  });

  it('loadFinished odrzuca bieg zwykły (record.mode casual) i wynik, który nie jest liczbą skończoną', () => {
    put(finished({ record: { ...finished().record, mode: 'casual' } }));
    expect(loadFinished()).toBeNull();

    for (const score of ['12', null, true, {}, []]) {
      put({ ...finished(), score });
      expect(loadFinished()).toBeNull();
    }
    put({ ...finished(), score: NaN });          // JSON.stringify zamienia NaN i Infinity w null
    expect(loadFinished()).toBeNull();
    put('{"v":1,"seed":"' + SEED + '","record":' + JSON.stringify(finished().record) + ',"score":1e999,"finishedAt":5}');   // 1e999 parsuje się do Infinity
    expect(loadFinished()).toBeNull();
    put(finished({ score: -250 }));               // strata to też wynik
    expect(loadFinished()?.score).toBe(-250);
  });

  it('loadFinished odrzuca bieg w złym kształcie', () => {
    const base = finished();
    const bad: unknown[] = [
      'nie-json{', 'null', '5', '[]',
      { ...base, v: 2 }, { ...base, v: undefined }, { ...base, seed: 5 }, { ...base, seed: 'inny-seed' },
      { ...base, finishedAt: 'wczoraj' }, { ...base, finishedAt: null },
      { ...base, record: null }, { ...base, record: { ...base.record, log: {} } },
      { ...base, record: { ...base.record, simVersion: 'x' } }, { ...base, record: { ...base.record, generatorVersion: 1.5 } },
      { ...base, record: { ...base.record, log: [{ minute: OPEN_FROM, seq: 0, cmd: { auto: true } }] } },
      { ...base, record: { ...base.record, log: [{ minute: 'x', seq: 0, cmd: { type: 'tapPallet' } }] } },
    ];
    for (const value of bad) {
      put(value);
      expect(loadFinished(), JSON.stringify(value)).toBeNull();
    }
  });

  it('loadFinished nie kasuje szuflady, której nie rozumie', () => {
    put('nie-json{');
    expect(loadFinished()).toBeNull();
    expect(storage.getItem(RANKED_KEYS.done)).toBe('nie-json{');
  });
});

describe('bieg trzymany w pamięci karty (przeglądarka nie dała zapisać szuflady)', () => {
  const finished = (seed = SEED, score = 777): FinishedRun => ({ v: 1, seed, record: newRunLog(seed, 'ranked').record, score, finishedAt: 1_700_000_000_000 });
  afterEach(() => { clearFinished(); });

  it('pendingFinished widzi bieg z szuflady, a bez niej ten z pamięci; holdFinished niczego nie zapisuje w przeglądarce', () => {
    expect(pendingFinished()).toBeNull();
    const held = finished('trzymany', 5);
    holdFinished(held);
    expect(pendingFinished()).toEqual(held);
    expect(storage.keys()).toEqual([]);
    expect(loadFinished()).toBeNull();

    clearFinished();
    saveFinished(finished('z-szuflady', 9));
    expect(pendingFinished()?.seed).toBe('z-szuflady');
  });

  it('bieg w pamięci jest nowszy od szuflady: wygrywa, dopóki ktoś go nie zabierze', () => {
    saveFinished(finished('stary', 1));
    holdFinished(finished('nowy', 2));
    expect(pendingFinished()?.seed).toBe('nowy');
    clearFinished();
    expect(pendingFinished()).toBeNull();
    expect(loadFinished()).toBeNull();
  });

  it('udany saveFinished zdejmuje bieg z pamięci (jest już w szufladzie), nieudany go zostawia', () => {
    holdFinished(finished('trzymany', 5));
    storage.failWrites = true;
    expect(saveFinished(finished('inny', 6))).toBe(false);
    expect(pendingFinished()?.seed).toBe('trzymany');
    storage.failWrites = false;
    expect(saveFinished(finished('inny', 6))).toBe(true);
    expect(pendingFinished()?.seed).toBe('inny');
    clearFinished();
    expect(pendingFinished()).toBeNull();
  });
});

describe('finishRun', () => {
  it('sesja po markOffLog (skip, nagroda powitalna) albo bez dziennika: null', () => {
    const s = createRankedSession(SEED);
    play(s, 60);
    markOffLog(s);
    expect(finishRun(s, 1)).toBeNull();

    const casualFromSave = (saveSession(createSession(SEED, true)), createSession(SEED));
    expect(casualFromSave.run).toBeNull();
    expect(finishRun(casualFromSave, 1)).toBeNull();
  });

  it('bieg po 12 dobach z odpowiedziami na karty: log tylko z minutami przed końcem sezonu, wynik z odtworzenia', () => {
    const s = createRankedSession(SEED);
    play(s, 12 * MINUTES_PER_DAY);
    const played = log(s).length;
    expect(played).toBeGreaterThan(30);
    expect(log(s).some((e) => e.cmd.type === 'answerCard')).toBe(true);

    // koniec sezonu „na skróty”: stan dostaje minutę tuż przed końcem, a polecenie z ostatniej minuty trafia do dziennika przez dispatch;
    // wpisy z minut spoza sezonu dopisujemy ręcznie, bo `dispatchCommand` biegu rankingowego odmawia poleceń po końcu sezonu (ale `finishRun` dalej
    // ma je odfiltrować, gdyby dziennik jakimś cudem takie miał)
    s.econ.minute = END - 1;
    expect(dispatch(s, { type: 'tapPallet' })).toBeDefined();
    for (const minute of [END, END + 7]) s.run!.record.log.push({ minute, seq: s.run!.seq++, cmd: { type: 'tapTill' } });
    expect(log(s)).toHaveLength(played + 3);

    const f = finishRun(s, 1_700_000_000_000)!;
    expect(f).not.toBeNull();
    expect(f.v).toBe(1);
    expect(f.seed).toBe(SEED);
    expect(f.finishedAt).toBe(1_700_000_000_000);
    expect(f.record.mode).toBe('ranked');
    expect(f.record).toMatchObject({ seed: SEED, gameVersion: GAME_VERSION, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION });
    expect(f.record.log).toHaveLength(played + 1);
    expect(f.record.log.every((e) => e.minute < END)).toBe(true);
    expect(f.record.log.at(-1)).toMatchObject({ minute: END - 1, cmd: { type: 'tapPallet' } });
    expect(f.record.log.map((e) => e.seq)).toEqual(log(s).slice(0, played + 1).map((e) => e.seq));

    // wynik to ten sam rachunek, który zrobi sędzia, a gra żywa jest nietknięta
    expect(Number.isFinite(f.score)).toBe(true);
    expect(f.score).toBe(seasonScore(replayRun(f.record, END)));
    expect(log(s)).toHaveLength(played + 3);
    expect(s.run!.record.mode).toBe('ranked');
  });

  it('wynik jest kopią: późniejsza gra nie zmienia gotowego biegu', () => {
    const s = createRankedSession(SEED);
    play(s, 300);
    s.econ.minute = END - 1;
    dispatch(s, { type: 'setOrder', auto: false, manual: 4 });
    const f = finishRun(s, 5)!;
    const snapshot = JSON.stringify(f);
    expect(f.record.log).not.toBe(log(s));
    expect(f.record.log.at(-1)).not.toBe(log(s).at(-1));
    expect(f.record.log.at(-1)!.cmd).not.toBe(log(s).at(-1)!.cmd);
    (log(s).at(-1)!.cmd as { manual: number }).manual = 99;
    log(s).push({ minute: 1, seq: 1000, cmd: { type: 'hire' } });
    s.run!.record.seed = 'zmieniony';
    expect(JSON.stringify(f)).toBe(snapshot);
  });
});

describe('porażki localStorage', () => {
  it('saveRanked i saveFinished zwracają false, gdy zapis rzuca, a to, co już leży w pamięci, zostaje', () => {
    const s = createRankedSession(SEED);
    play(s, 200);
    expect(saveRanked(s)).toBe(true);
    const minuteSaved = s.econ.minute;
    const f: FinishedRun = { v: 1, seed: SEED, record: newRunLog(SEED, 'ranked').record, score: 7, finishedAt: 3 };
    const copy = JSON.stringify(f);

    storage.failWrites = true;
    play(s, 50);
    expect(saveRanked(s)).toBe(false);
    expect(saveFinished(f)).toBe(false);
    expect(() => setPlayMode('ranked')).not.toThrow();
    expect(JSON.stringify(f)).toBe(copy);                 // niewysłany bieg zostaje u wołającego, nietknięty
    expect(loadFinished()).toBeNull();                    // nic nie zapisano…
    const kept = loadRanked();                            // …a poprzedni zapis biegu dalej jest dobry
    expect(kept.status).toBe('ok');
    expect((kept as { status: 'ok'; session: GameSession }).session.econ.minute).toBe(minuteSaved);

    storage.failWrites = false;                           // gdy miejsce się znajdzie, ten sam bieg da się zapisać
    expect(saveFinished(f)).toBe(true);
    expect(loadFinished()).toEqual(f);
  });

  it('odczyt, który rzuca, nie wywraca gry', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('SecurityError', 'SecurityError'); },
      setItem: () => { throw new DOMException('SecurityError', 'SecurityError'); },
      removeItem: () => { throw new DOMException('SecurityError', 'SecurityError'); },
    });
    expect(loadRanked()).toEqual({ status: 'none' });
    expect(loadFinished()).toBeNull();
    expect(getPlayMode()).toBe('casual');
    expect(() => { discardRanked(); clearFinished(); setPlayMode('ranked'); }).not.toThrow();
    expect(saveRanked(createRankedSession(SEED))).toBe(false);
  });
});

describe('tryb gry i koniec sezonu', () => {
  it('getPlayMode: casual, dopóki ktoś nie wybierze ranked; wszystko inne to casual', () => {
    expect(getPlayMode()).toBe('casual');
    setPlayMode('ranked');
    expect(storage.getItem(RANKED_KEYS.mode)).toBe('ranked');
    expect(getPlayMode()).toBe('ranked');
    setPlayMode('casual');
    expect(getPlayMode()).toBe('casual');
    for (const junk of ['Ranked', 'RANKED', ' ranked', '', 'true', '1', '"ranked"', 'null']) {
      storage.setItem(RANKED_KEYS.mode, junk);
      expect(getPlayMode(), junk).toBe('casual');
    }
  });

  it('seasonOver od RANKED_SEASON_END_MINUTE włącznie', () => {
    expect(seasonOver({ minute: OPEN_FROM })).toBe(false);
    expect(seasonOver({ minute: END - 1 })).toBe(false);
    expect(seasonOver({ minute: END })).toBe(true);
    expect(seasonOver({ minute: END + 1000 })).toBe(true);
  });
});

describe('storedRankedBlock: co w przeglądarce stoi na przeszkodzie nowemu biegowi', () => {
  const drawerRun = (): FinishedRun => ({ v: 1, seed: SEED, record: newRunLog(SEED, 'ranked').record, score: 12_345, finishedAt: 1_000 });

  it('pusta przeglądarka: nic nie blokuje', () => {
    expect(storedRankedBlock()).toBeNull();
  });

  it('aktywny zapis biegu: active', () => {
    expect(saveRanked(createRankedSession(SEED))).toBe(true);
    expect(storedRankedBlock()).toBe('active');
  });

  it('bieg z innej wersji gry też blokuje (nie da się go wznowić, ale nie wolno go po cichu skasować)', () => {
    storage.setItem(RANKED_KEYS.active, JSON.stringify({ schema: 99 }));
    expect(storedRankedBlock()).toBe('active');
    expect(storage.getItem(RANKED_KEYS.active)).toBe('{"schema":99}');
  });

  it('szuflada niewysłanego biegu: unsent, i ma pierwszeństwo przed aktywnym zapisem', () => {
    saveFinished(drawerRun());
    expect(storedRankedBlock()).toBe('unsent');
    saveRanked(createRankedSession(SEED));
    expect(storedRankedBlock()).toBe('unsent');
  });

  it('bieg trzymany w pamięci karty (przeglądarka nie dała zapisać szuflady) też jest niewysłany', () => {
    holdFinished(drawerRun());
    expect(storedRankedBlock()).toBe('unsent');
    clearFinished();
    expect(storedRankedBlock()).toBeNull();
  });

  it('uszkodzony zapis biegu nie blokuje: idzie do kopii, jak w loadRanked', () => {
    storage.setItem(RANKED_KEYS.active, 'nie json');
    expect(storedRankedBlock()).toBeNull();
    expect(storage.getItem(RANKED_KEYS.broken)).toBe('nie json');
  });
});

describe('dzień sezonu rankingowego', () => {
  it('sezon trwa 91 dni (od 1 września do 30 listopada)', () => {
    expect(RANKED_DAYS).toBe(91);
  });

  it('rankedDayOf liczy od 1 i nie wychodzi poza sezon', () => {
    expect(rankedDayOf({ minute: OPEN_FROM })).toBe(1);
    expect(rankedDayOf({ minute: OPEN_FROM + MINUTES_PER_DAY })).toBe(2);
    expect(rankedDayOf({ minute: END - 1 })).toBe(91);
    expect(rankedDayOf({ minute: END + 10 * MINUTES_PER_DAY })).toBe(91);
  });
});

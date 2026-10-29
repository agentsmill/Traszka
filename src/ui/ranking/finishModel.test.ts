import { signal } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { NICK_ERRORS } from '@/game/nick';
import { clearFinished, loadFinished, pendingFinished, saveFinished, type FinishedRun } from '@/game/rankedRun';
import { newRunLog } from '@/game/session';
import { API_ERRORS } from '@/server/errors';
import { NETWORK_ERROR, createRankingClient, type ApiResult, type RankingClient, type RunAccepted } from './client';
import {
  ACCEPTED_TEXT, LATER_TEXT, NICK_TAKEN_TEXT, NOTHING_TO_SEND_TEXT, NO_KEY_TEXT, OLD_VERSION_TEXT, READY_TEXT, REJECTED_TEXT, SENDING_TEXT,
  bindFinishOpen, classify, createFinishModel, type FinishDeps, type SendOutcome,
} from './finishModel';

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const SEED = 'kielbasa-42';

const ACCEPTED: RunAccepted = { nick: 'Mateusz', score: 12_345, best: 12_345, improved: true, ranks: { global: 3, seed: 1, week: null } };
const accepted = (over: Partial<RunAccepted> = {}): ApiResult<RunAccepted> => ({ ok: true, ...ACCEPTED, ...over });
const failure = (error: string, message = 'komunikat serwera'): ApiResult<RunAccepted> => ({ ok: false, error, message });

const finishedRun = (over: Partial<FinishedRun> = {}): FinishedRun => ({
  v: 1, seed: SEED, record: { ...newRunLog(SEED, 'ranked').record, log: [{ minute: 400, seq: 0, cmd: { type: 'tapTill' } }] }, score: 12_345, finishedAt: 1_000, ...over,
});

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  clearFinished();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('classify: odpowiedź serwera na wysłany bieg', () => {
  it('ok to przyjęty bieg, z miejscami, rekordem i wynikiem z serwera', () => {
    expect(classify(accepted())).toEqual({ kind: 'accepted', accepted: ACCEPTED });
  });

  it('przyjęty bieg z brakującymi albo błędnymi miejscami nie wysypuje okna: miejsca bez wartości to null', () => {
    const broken = { ok: true, nick: 'Ala', score: 5, best: 5, improved: false } as unknown as ApiResult<RunAccepted>;
    expect(classify(broken)).toEqual({ kind: 'accepted', accepted: { nick: 'Ala', score: 5, best: 5, improved: false, ranks: { global: null, seed: null, week: null } } });
    const weird = { ok: true, nick: 'Ala', score: 5, best: 5, improved: true, ranks: { global: '1', seed: Number.NaN, week: 4 } } as unknown as ApiResult<RunAccepted>;
    expect(classify(weird)).toMatchObject({ kind: 'accepted', accepted: { ranks: { global: null, seed: null, week: 4 } } });
  });

  it('zajęty nick i stara wersja mają własne wyniki', () => {
    expect(classify(failure('nick-taken'))).toEqual({ kind: 'nick-taken', message: NICK_TAKEN_TEXT });
    expect(classify(failure('old-version'))).toEqual({ kind: 'old-version', message: OLD_VERSION_TEXT });
  });

  it.each(['bad-request', 'bad-log', 'bad-seed', 'not-ranked', 'bad-nick', 'bad-key', 'too-large'])('%s: Centrala odrzuciła bieg', (code) => {
    expect(classify(failure(code))).toEqual({ kind: 'rejected', message: REJECTED_TEXT });
  });

  it.each([
    'ranking-off', 'not-configured', 'replay-unavailable', 'replay-failed', 'rate-limited', 'server', 'network', 'unavailable',
    'bad-save', 'save-too-large', 'save-budget', 'save-conflict', 'no-save', 'bad-board', 'method', 'cos-nieznanego',
  ])('%s: spróbuj później', (code) => {
    expect(classify(failure(code))).toEqual({ kind: 'later', message: LATER_TEXT });
  });

  it('każdy kod z errors.ts ma wynik, a przyjęcie dają tylko odpowiedzi ok', () => {
    const kinds = new Set<SendOutcome['kind']>();
    for (const code of Object.keys(API_ERRORS)) kinds.add(classify(failure(code)).kind);
    expect(kinds).toEqual(new Set(['nick-taken', 'old-version', 'rejected', 'later']));
  });

  it('komunikaty po polsku, w tonie gry: bieg zostaje u gracza', () => {
    expect(NICK_TAKEN_TEXT).toMatch(/nick jest zajęty/i);
    expect(OLD_VERSION_TEXT).toMatch(/Odśwież stronę/);
    expect(LATER_TEXT).toMatch(/^Spróbuj później/);
    expect(LATER_TEXT).toMatch(/panelu rankingu/);
    expect(REJECTED_TEXT).toMatch(/Centrala odrzuciła/);
  });
});

/** Model na atrapie klienta i prawdziwej szufladzie (atrapa `localStorage`): `replies` to kolejne odpowiedzi serwera. */
function setup(over: { replies?: (ApiResult<RunAccepted> | (() => Promise<ApiResult<RunAccepted>>))[]; player?: FinishDeps['player']; run?: FinishedRun } = {}) {
  const replies = [...(over.replies ?? [accepted()])];
  const submitRun = vi.fn(async (_key: string, _nick: string, _run: unknown): Promise<ApiResult<RunAccepted>> => {
    const next = replies.length > 1 ? replies.shift()! : replies[0]!;
    return typeof next === 'function' ? next() : next;
  });
  const client: RankingClient = { board: vi.fn(), player: vi.fn(), uploadSave: vi.fn(), downloadSave: vi.fn(), submitRun };
  const player = { key: KEY as string | undefined, nick: 'Mateusz' as string | null };
  const clear = vi.fn(() => { clearFinished(); });
  const rememberNick = vi.fn((nick: string) => { player.nick = nick; });
  saveFinished(over.run ?? finishedRun());
  const model = createFinishModel({ client, finished: pendingFinished, clear, player: over.player ?? (() => player), rememberNick });
  model.open();
  return { model, client, submitRun, clear, rememberNick, player };
}

describe('model okna końca sezonu', () => {
  it('po otwarciu: nick gracza w polu, wynik i seed z biegu, faza „gotowy” z komunikatem Centrali', () => {
    const { model } = setup();
    expect(model.phase.value).toBe('ready');
    expect(model.nick.value).toBe('Mateusz');
    expect(model.score.value).toBe(12_345);
    expect(model.seed.value).toBe(SEED);
    expect(model.message.value).toBe(READY_TEXT);
    expect(model.places.value).toBeNull();
    expect(model.confirming.value).toBe(false);
  });

  it('gracz bez nicka dostaje puste pole', () => {
    const { model } = setup({ player: () => ({ key: KEY, nick: null }) });
    expect(model.nick.value).toBe('');
  });

  it('przyjęcie: wysyła dziennik biegu z kluczem i nickiem, czyści szufladę, pokazuje miejsca i wynik z serwera', async () => {
    const { model, submitRun, clear, rememberNick } = setup({ replies: [accepted({ score: 12_400 })] });
    const run = loadFinished()!;
    await model.send();
    expect(submitRun).toHaveBeenCalledTimes(1);
    expect(submitRun).toHaveBeenCalledWith(KEY, 'Mateusz', run.record);
    expect(model.phase.value).toBe('accepted');
    expect(model.message.value).toBe(ACCEPTED_TEXT);
    expect(model.places.value).toEqual({ global: 3, seed: 1, week: null });
    expect(model.accepted.value).toMatchObject({ improved: true, best: 12_345 });
    expect(model.score.value).toBe(12_400);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(loadFinished()).toBeNull();
    expect(pendingFinished()).toBeNull();
    expect(rememberNick).not.toHaveBeenCalled();   // nick ten sam co zapamiętany
  });

  it('przyjęcie pod innym nickiem niż zapamiętany: gra zapamiętuje wysłany (znormalizowany) nick', async () => {
    const { model, rememberNick, submitRun } = setup();
    model.setNick('  Kasjer   Roku ');
    await model.send();
    expect(submitRun).toHaveBeenCalledWith(KEY, 'Kasjer Roku', expect.anything());
    expect(rememberNick).toHaveBeenCalledTimes(1);
    expect(rememberNick).toHaveBeenCalledWith('Kasjer Roku');
  });

  it('w trakcie wysyłania: faza „sending”, komunikat o wysyłaniu, bieg jeszcze w szufladzie', async () => {
    let finish!: (r: ApiResult<RunAccepted>) => void;
    const { model, clear } = setup({ replies: [() => new Promise<ApiResult<RunAccepted>>((resolve) => { finish = resolve; })] });
    const sending = model.send();
    expect(model.phase.value).toBe('sending');
    expect(model.message.value).toBe(SENDING_TEXT);
    expect(loadFinished()).not.toBeNull();
    finish(accepted());
    await sending;
    expect(model.phase.value).toBe('accepted');
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('podwójne wysłanie w trakcie wysyłania wysyła raz; po przyjęciu kolejne wysłanie też nic nie robi', async () => {
    let finish!: (r: ApiResult<RunAccepted>) => void;
    const { model, submitRun } = setup({ replies: [() => new Promise<ApiResult<RunAccepted>>((resolve) => { finish = resolve; })] });
    const first = model.send();
    const second = model.send();
    await second;
    expect(submitRun).toHaveBeenCalledTimes(1);
    finish(accepted());
    await first;
    await model.send();
    expect(submitRun).toHaveBeenCalledTimes(1);
  });

  describe('bieg zostaje w szufladzie po każdym wyniku poza przyjęciem (Review Focus 4)', () => {
    const cases: [string, ApiResult<RunAccepted>, SendOutcome['kind']][] = [
      ['zajęty nick', failure('nick-taken'), 'nick-taken'],
      ['stara wersja gry', failure('old-version'), 'old-version'],
      ['ranking wyłączony (503)', failure('ranking-off'), 'later'],
      ['limit zapytań (429)', failure('rate-limited'), 'later'],
      ['błąd serwera', failure('server'), 'later'],
      ['sędzia niegotowy', failure('replay-unavailable'), 'later'],
      ['brak sieci', failure('network', NETWORK_ERROR), 'later'],
      ['serwer odrzucił dziennik', failure('bad-log'), 'rejected'],
      ['zły klucz', failure('bad-key'), 'rejected'],
    ];
    it.each(cases)('%s', async (_name, reply, kind) => {
      const { model, clear, rememberNick } = setup({ replies: [reply] });
      const before = loadFinished()!;
      await model.send();
      expect(model.phase.value).toBe(kind);
      expect(model.message.value).toBe((classify(reply) as { message: string }).message);
      expect(loadFinished()).toEqual(before);
      expect(pendingFinished()).toEqual(before);
      expect(clear).not.toHaveBeenCalled();
      expect(rememberNick).not.toHaveBeenCalled();
      expect(model.places.value).toBeNull();
    });

    it('odpowiedź bez JSON-a (strona 404 zamiast API) to „spróbuj później”, a bieg zostaje', async () => {
      const calls: string[] = [];
      const fetchFn = (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response('<html>404</html>', { status: 404 }); }) as typeof fetch;
      const real = createRankingClient(fetchFn);
      const clear = vi.fn(() => { clearFinished(); });
      saveFinished(finishedRun());
      const model = createFinishModel({ client: real, finished: pendingFinished, clear, player: () => ({ key: KEY, nick: 'Mateusz' }), rememberNick: vi.fn() });
      model.open();
      await model.send();
      expect(calls).toEqual(['/api/runs']);
      expect(model.phase.value).toBe('later');
      expect(loadFinished()).not.toBeNull();
      expect(clear).not.toHaveBeenCalled();
    });

    it('klient, który rzuci wyjątek, daje „spróbuj później” zamiast zawieszonej fazy wysyłania', async () => {
      const { model, submitRun, clear } = setup();
      submitRun.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await model.send();
      expect(model.phase.value).toBe('later');
      expect(model.message.value).toBe(LATER_TEXT);
      expect(loadFinished()).not.toBeNull();
      expect(clear).not.toHaveBeenCalled();
    });

    it('po nieudanej próbie można wysłać jeszcze raz i bieg przechodzi', async () => {
      const { model, submitRun, clear } = setup({ replies: [failure('ranking-off'), accepted()] });
      await model.send();
      expect(model.phase.value).toBe('later');
      await model.send();
      expect(submitRun).toHaveBeenCalledTimes(2);
      expect(model.phase.value).toBe('accepted');
      expect(clear).toHaveBeenCalledTimes(1);
      expect(loadFinished()).toBeNull();
    });
  });

  it('zajęty nick: gracz zmienia nick i wysyła ten sam bieg jeszcze raz', async () => {
    const { model, submitRun, rememberNick } = setup({ replies: [failure('nick-taken'), accepted({ nick: 'Inny' })] });
    const record = loadFinished()!.record;
    await model.send();
    expect(model.phase.value).toBe('nick-taken');
    expect(model.message.value).toBe(NICK_TAKEN_TEXT);
    expect(loadFinished()).not.toBeNull();

    model.setNick('Inny');
    expect(model.nick.value).toBe('Inny');
    await model.send();
    expect(submitRun).toHaveBeenCalledTimes(2);
    expect(submitRun).toHaveBeenLastCalledWith(KEY, 'Inny', record);
    expect(model.phase.value).toBe('accepted');
    expect(rememberNick).toHaveBeenCalledWith('Inny');
    expect(loadFinished()).toBeNull();
  });

  describe('nick i klucz sprawdzane przed wysłaniem', () => {
    it('zły nick: komunikat z reguł nicka i żadnego żądania; bieg w szufladzie, faza bez zmian', async () => {
      const { model, submitRun, clear } = setup();
      model.setNick('Ala 🦎');
      await model.send();
      expect(submitRun).not.toHaveBeenCalled();
      expect(model.message.value).toBe(NICK_ERRORS.chars);
      expect(model.phase.value).toBe('ready');
      expect(clear).not.toHaveBeenCalled();
      expect(loadFinished()).not.toBeNull();

      model.setNick('');
      await model.send();
      expect(model.message.value).toBe(NICK_ERRORS.length);
      model.setNick('Centrala');
      await model.send();
      expect(model.message.value).toBe(NICK_ERRORS.reserved);
      expect(submitRun).not.toHaveBeenCalled();
    });

    it('poprawienie nicka zdejmuje komunikat o błędzie i wraca komunikat fazy', async () => {
      const { model } = setup();
      model.setNick('x'.repeat(30));
      await model.send();
      expect(model.message.value).toBe(NICK_ERRORS.length);
      model.setNick('Ala');
      expect(model.message.value).toBe(READY_TEXT);
    });

    it('zły nick po „zajęty nick”: komunikat o nicku, a po poprawce znowu o zajętym', async () => {
      const { model } = setup({ replies: [failure('nick-taken')] });
      await model.send();
      model.setNick('');
      await model.send();
      expect(model.message.value).toBe(NICK_ERRORS.length);
      expect(model.phase.value).toBe('nick-taken');
      model.setNick('Inny');
      expect(model.message.value).toBe(NICK_TAKEN_TEXT);
    });

    it('brak klucza gracza (albo brak gracza): komunikat i żadnego żądania', async () => {
      for (const player of [() => ({ key: undefined, nick: 'Mateusz' }), () => undefined]) {
        const { model, submitRun, clear } = setup({ player });
        model.setNick('Mateusz');
        await model.send();
        expect(submitRun).not.toHaveBeenCalled();
        expect(model.message.value).toBe(NO_KEY_TEXT);
        expect(model.message.value).toMatch(/Odśwież stronę/);
        expect(model.phase.value).toBe('ready');
        expect(clear).not.toHaveBeenCalled();
        expect(loadFinished()).not.toBeNull();
      }
    });

    it('brak biegu do wysłania (szuflada pusta): komunikat i żadnego żądania', async () => {
      const { model, submitRun } = setup();
      clearFinished();
      await model.send();
      expect(submitRun).not.toHaveBeenCalled();
      expect(model.message.value).toBe(NOTHING_TO_SEND_TEXT);
    });
  });

  describe('odrzucenie biegu', () => {
    it('discard kasuje szufladę i pamięć karty przez clear; pytanie o potwierdzenie można wycofać', () => {
      const { model, clear } = setup();
      model.askDiscard();
      expect(model.confirming.value).toBe(true);
      model.cancelDiscard();
      expect(model.confirming.value).toBe(false);
      expect(clear).not.toHaveBeenCalled();
      expect(loadFinished()).not.toBeNull();

      model.askDiscard();
      model.discard();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(loadFinished()).toBeNull();
      expect(pendingFinished()).toBeNull();
      expect(model.confirming.value).toBe(false);
      expect(model.score.value).toBeNull();
    });

    it('odrzucenie nie rusza serwera ani nicka', () => {
      const { model, submitRun, rememberNick } = setup();
      model.discard();
      expect(submitRun).not.toHaveBeenCalled();
      expect(rememberNick).not.toHaveBeenCalled();
    });
  });

  describe('ponowne otwarcie okna', () => {
    it('open po nieudanej próbie zaczyna od nowa: faza gotowy, nick z gracza, brak starego komunikatu', async () => {
      const { model, player } = setup({ replies: [failure('ranking-off')] });
      model.setNick('Cos innego');
      await model.send();
      expect(model.phase.value).toBe('later');
      player.nick = 'Zmieniony';
      model.open();
      expect(model.phase.value).toBe('ready');
      expect(model.message.value).toBe(READY_TEXT);
      expect(model.nick.value).toBe('Zmieniony');
    });

    it('open w trakcie wysyłania niczego nie rusza (odpowiedź i tak dojdzie)', async () => {
      let finish!: (r: ApiResult<RunAccepted>) => void;
      const { model } = setup({ replies: [() => new Promise<ApiResult<RunAccepted>>((resolve) => { finish = resolve; })] });
      const sending = model.send();
      model.open();
      expect(model.phase.value).toBe('sending');
      finish(accepted());
      await sending;
      expect(model.phase.value).toBe('accepted');
    });

    it('open bez biegu w szufladzie: wynik pusty', () => {
      const { model } = setup();
      clearFinished();
      model.open();
      expect(model.score.value).toBeNull();
      expect(model.seed.value).toBeNull();
    });
  });
});

describe('bindFinishOpen: odświeżenie modelu przy każdym otwarciu okna', () => {
  it('woła open przy przejściu z zamkniętego na otwarte, nie przy zmianie otwartego i nie przy zamknięciu', () => {
    const open = signal<{ open: true } | null>(null);
    const model = { open: vi.fn() };
    const stop = bindFinishOpen(model, open);
    expect(model.open).not.toHaveBeenCalled();
    open.value = { open: true };
    expect(model.open).toHaveBeenCalledTimes(1);
    open.value = { open: true };
    expect(model.open).toHaveBeenCalledTimes(1);
    open.value = null;
    expect(model.open).toHaveBeenCalledTimes(1);
    open.value = { open: true };
    expect(model.open).toHaveBeenCalledTimes(2);
    stop();
    open.value = null;
    open.value = { open: true };
    expect(model.open).toHaveBeenCalledTimes(2);
  });

  it('okno już otwarte w chwili podpięcia też odświeża model', () => {
    const open = signal<{ open: true } | null>({ open: true });
    const model = { open: vi.fn() };
    bindFinishOpen(model, open)();
    expect(model.open).toHaveBeenCalledTimes(1);
  });
});

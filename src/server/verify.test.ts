import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@/sim/economy/commands';
import type { EconomyState } from '@/sim/economy/economy';
import { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
import { replayRun, type RunRecord } from '@/sim/run';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { API_ERRORS } from './errors';
import { describeError, makeReplayVerifier, replayNotAvailable, type VerifyFailure } from './verify';

const RUN: RunRecord = { seed: 'kiełbasa-42', gameVersion: '0.0.0+abc123def456', generatorVersion: 1, simVersion: 1, mode: 'ranked', log: [] };
const state = (...profits: number[]): Pick<EconomyState, 'history'> => ({
  history: profits.map((profit, i) => ({ label: `m${i}`, profit, revenue: 0 })),
});
const judge = (replay: (run: RunRecord, until: number) => Pick<EconomyState, 'history'>) =>
  makeReplayVerifier({ replay, endMinute: RANKED_SEASON_END_MINUTE, score: seasonScore });

describe('sędzia biegu (verifyRun)', () => {
  it('domyślny sędzia do czasu scalenia strumienia A: „odtwarzanie jeszcze niedostępne”, dla każdego biegu', async () => {
    expect(await replayNotAvailable(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
  });

  it('każdy powód odmowy sędziego (VerifyFailure) ma w API własny kod, status i komunikat dla gracza', () => {
    // `satisfies Record<VerifyFailure, …>` robi z tej tabeli kontrolę w czasie kompilacji: nowy powód w `VerifyFailure` bez wpisu tutaj
    // (albo wpis bez powodu) nie przejdzie `tsc`. W czasie działania każdy z nich musi mieć odpowiedź w `errors.ts`, bo `http.ts` oddaje
    // powód graczowi pod tym samym kodem.
    const statuses = { 'replay-unavailable': 503, 'replay-failed': 422, 'old-version': 409 } satisfies Record<VerifyFailure, number>;
    for (const [reason, status] of Object.entries(statuses)) {
      expect(API_ERRORS[reason as VerifyFailure], reason).toMatchObject({ status, message: expect.stringMatching(/\S/) });
    }
  });

  it('odtworzenie do końca sezonu daje wynik policzony przez serwer, a nie przez grę', async () => {
    const calls: [RunRecord, number][] = [];
    const verify = judge((run, until) => {
      calls.push([run, until]);
      return state(10_000, 20_000, -5_000);
    });
    expect(await verify(RUN)).toEqual({ ok: true, score: 25_000 });
    expect(calls).toEqual([[RUN, RANKED_SEASON_END_MINUTE]]);
  });

  it('bieg zakończony wypowiedzeniem umowy przed końcem listopada liczy się z raportami, które powstały', async () => {
    expect(await judge(() => state(-20_000, -30_000))(RUN)).toEqual({ ok: true, score: -50_000 });
  });

  it('odtworzenie, które rzuca albo daje wynik nieliczbowy: replay-failed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await judge(() => { throw new Error('nieznane polecenie'); })(RUN)).toEqual({ ok: false, reason: 'replay-failed' });
    expect(await judge(() => state(NaN, 1, 2))(RUN)).toEqual({ ok: false, reason: 'replay-failed' });
    expect(errors).toHaveBeenCalledTimes(1);
  });

  describe('wyjątek sędziego zostawia ślad w logu Vercela (inaczej uczciwy bieg znika bez wieści)', () => {
    afterEach(() => vi.restoreAllMocks());
    const secretRun: RunRecord = {
      ...RUN, seed: 'tajny-seed-777',
      log: [{ minute: 400, seq: 0, cmd: { type: 'tapTill', tajne: 'DZIENNIK-GRACZA' } as Command }],
    };

    it('console.error z oznaczeniem, nazwą i treścią błędu, a bez klucza, seeda i dziennika poleceń', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const verify = judge(() => { throw new RangeError('Nieznane polecenie: tapX'); });
      expect(await verify(secretRun)).toEqual({ ok: false, reason: 'replay-failed' });
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith('[ranking] replay', 'RangeError', 'Nieznane polecenie: tapX');
      const logged = JSON.stringify(errors.mock.calls);
      for (const secret of ['DZIENNIK-GRACZA', 'tajny-seed-777', 'tapTill', 'K7QX']) expect(logged).not.toContain(secret);
    });

    it('treść w jednej linii i najwyżej 200 znaków; wyrzucony nie-błąd dostaje ogólną nazwę', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await judge(() => { throw new Error(`pierwsza\nlinia\r\n\tdruga ${'x'.repeat(500)}`); })(RUN);
      const [tag, name, message] = errors.mock.calls[0] as [string, string, string];
      expect([tag, name]).toEqual(['[ranking] replay', 'Error']);
      expect(message).not.toMatch(/[\r\n\t]/);
      expect(message.startsWith('pierwsza linia druga xxx')).toBe(true);
      expect(message.length).toBe(200);
      await judge(() => { throw 'tekst zamiast błędu'; })(RUN);   // eslint-disable-line @typescript-eslint/only-throw-error
      expect(errors.mock.calls[1]).toEqual(['[ranking] replay', 'nieznany błąd', '']);
    });

    it('bez wyjątku nic się nie loguje', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(await judge(() => state(1, 2))(RUN)).toEqual({ ok: true, score: 3 });
      expect(errors).not.toHaveBeenCalled();
    });
  });

  it('podpięcie prawie prawdziwe: bieg bierny (bez poleceń) odtworzony z seeda prawdziwym replayRun z gry', async () => {
    // `replayRun` to stabilne publiczne API symulacji: świeży sklep z seeda i kroki minuty do końca sezonu
    const verify = makeReplayVerifier({ replay: replayRun, endMinute: RANKED_SEASON_END_MINUTE, score: seasonScore });
    const run: RunRecord = { ...RUN, generatorVersion: GENERATOR_VERSION };
    const res = await verify(run);
    expect(res.ok).toBe(true);
    expect(res.ok && Number.isInteger(res.score)).toBe(true);
    expect(res).toEqual({ ok: true, score: seasonScore(replayRun(run, RANKED_SEASON_END_MINUTE)) });
  });

  it('describeError: nazwa i treść w jednej linii (najwyżej 200 znaków); nie-błąd dostaje ogólną nazwę', () => {
    expect(describeError(new RangeError('zły  zakres\n\tdrugi wiersz'))).toEqual(['RangeError', 'zły zakres drugi wiersz']);
    expect(describeError(new Error('x'.repeat(500)))[1]).toHaveLength(200);
    expect(describeError('tekst zamiast błędu')).toEqual(['nieznany błąd', '']);
  });
});

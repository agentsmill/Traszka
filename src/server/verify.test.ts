import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEconomy, stepMinute, type EconomyState } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
import { generateStore } from '@/sim/store/generateStore';
import type { RunRecord } from './runs';
import { makeReplayVerifier, replayNotAvailable } from './verify';

const RUN: RunRecord = { seed: 'kiełbasa-42', gameVersion: '0.0.0', generatorVersion: 1, mode: 'ranked', log: [] };
const state = (...profits: number[]): Pick<EconomyState, 'history'> => ({
  history: profits.map((profit, i) => ({ label: `m${i}`, profit, revenue: 0 })),
});
const judge = (replay: (run: RunRecord, until: number) => Pick<EconomyState, 'history'>) =>
  makeReplayVerifier({ replay, endMinute: RANKED_SEASON_END_MINUTE, score: seasonScore });

describe('sędzia biegu (verifyRun)', () => {
  it('domyślny sędzia do czasu scalenia strumienia A: „odtwarzanie jeszcze niedostępne”, dla każdego biegu', async () => {
    expect(await replayNotAvailable(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
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
      log: [{ minute: 400, seq: 0, cmd: { type: 'tapTill', tajne: 'DZIENNIK-GRACZA' } }],
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

  it('podpięcie prawie prawdziwe: bierny bieg (bez poleceń) odtworzony z seeda na prawdziwej symulacji', async () => {
    // tak będzie wyglądał `replayRun` dla pustego dziennika: świeży sklep z seeda i kroki minuty do końca sezonu
    const verify = judge((run, until) => {
      const info = computeStoreInfo(generateStore(run.seed));
      const s = createEconomy(run.seed, info);
      while (s.minute < until && !s.gameOver) stepMinute(s, info, []);
      return s;
    });
    const res = await verify(RUN);
    expect(res.ok).toBe(true);
    expect(res.ok && Number.isInteger(res.score)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { createEconomy, stepMinute, type EconomyState } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { RANKED_SEASON_END_MINUTE, seasonComplete, seasonScore } from '@/sim/ranked';
import { generateStore } from '@/sim/store/generateStore';
import type { RunRecord } from './runs';
import { makeReplayVerifier, replayNotAvailable } from './verify';

const RUN: RunRecord = { seed: 'kiełbasa-42', gameVersion: '0.0.0', generatorVersion: 1, mode: 'ranked', log: [] };
const state = (...profits: number[]): Pick<EconomyState, 'history'> => ({
  history: profits.map((profit, i) => ({ label: `m${i}`, profit, revenue: 0 })),
});
const judge = (replay: (run: RunRecord, until: number) => Pick<EconomyState, 'history'>) =>
  makeReplayVerifier({ replay, endMinute: RANKED_SEASON_END_MINUTE, complete: seasonComplete, score: seasonScore });

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

  it('bieg bez trzech raportów (np. wypowiedzenie umowy w październiku): season-incomplete', async () => {
    expect(await judge(() => state(1, 2))(RUN)).toEqual({ ok: false, reason: 'season-incomplete' });
  });

  it('odtworzenie, które rzuca albo daje wynik nieliczbowy: replay-failed', async () => {
    expect(await judge(() => { throw new Error('nieznane polecenie'); })(RUN)).toEqual({ ok: false, reason: 'replay-failed' });
    expect(await judge(() => state(NaN, 1, 2))(RUN)).toEqual({ ok: false, reason: 'replay-failed' });
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

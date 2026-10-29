import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { EconomyState } from '@/sim/economy/economy';
import type { RunRecord } from '@/sim/run';
import { SEASON_END_MINUTE } from './config';
import { route } from './env';
import { handleRuns } from './http';
import { makeBundleVerifier } from './judge';

/**
 * Sędzia z bundla (judge.ts) na atrapie bundla: każdy z pięciu eksportów jest podmienialny, a funkcja ładująca to szpieg, więc
 * widać, ile razy i kiedy sędzia sięga po plik. Sędzia na prawdziwym, zbudowanym bundlu jest w tests/judgeBundle.test.ts.
 */
const RUN: RunRecord = { seed: 'kiełbasa-42', gameVersion: '0.0.0+abc123def456', generatorVersion: 1, simVersion: 7, mode: 'ranked', log: [] };
const END = 1_000;
const history = (...profits: number[]): Pick<EconomyState, 'history'> => ({ history: profits.map((profit, i) => ({ label: `m${i}`, profit, revenue: 0 })) });

interface FakeBundle {
  SIM_VERSION: unknown;
  GENERATOR_VERSION: unknown;
  RANKED_SEASON_END_MINUTE: unknown;
  seasonScore: unknown;
  seasonBankrupt: unknown;
  replayRun: unknown;
}
const bundle = (over: Partial<FakeBundle> = {}): FakeBundle => ({
  SIM_VERSION: 7,
  GENERATOR_VERSION: 1,
  RANKED_SEASON_END_MINUTE: END,
  seasonScore: (state: Pick<EconomyState, 'history'>) => state.history.reduce((sum, h) => sum + h.profit, 0),
  seasonBankrupt: () => false,
  replayRun: (_run: RunRecord, _until: number) => history(10, 20, 30),
  ...over,
});
const loader = (mod: unknown = bundle()) => vi.fn(() => Promise.resolve(mod));

let errors: MockInstance<typeof console.error>;
beforeEach(() => { errors = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe('sędzia z bundla: zgodny bieg', () => {
  it('bieg z tą samą simVersion co bundle jest odtworzony do końca sezonu z bundla, a wynik liczy funkcja z bundla', async () => {
    const replayRun = vi.fn((_run: RunRecord, _until: number) => history(100, 200, -50));
    const verify = makeBundleVerifier(loader(bundle({ replayRun })));
    expect(await verify(RUN)).toEqual({ ok: true, score: 250 });
    expect(replayRun).toHaveBeenCalledTimes(1);
    expect(replayRun).toHaveBeenCalledWith(RUN, END);
    expect(errors).not.toHaveBeenCalled();
  });

  it('wynik, który nie jest liczbą, to replay-failed (reszta kontroli jak w makeReplayVerifier)', async () => {
    const verify = makeBundleVerifier(loader(bundle({ seasonScore: () => NaN })));
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-failed' });
  });

  it('bankrut według bundla (seasonBankrupt) to season-bankrupt bez wyniku; reguła jest po stronie bundla, nie sędziego', async () => {
    const seasonBankrupt = vi.fn((state: unknown) => state === states.broke);
    const states = { broke: history(10, 20), fine: history(10, 20, 30) };
    const replay = (run: RunRecord) => (run.seed === 'bankrut' ? states.broke : states.fine);
    const verify = makeBundleVerifier(loader(bundle({ replayRun: replay, seasonBankrupt })));
    expect(await verify({ ...RUN, seed: 'bankrut' })).toEqual({ ok: false, reason: 'season-bankrupt' });
    expect(await verify(RUN)).toEqual({ ok: true, score: 60 });
    expect(seasonBankrupt).toHaveBeenCalledTimes(2);
  });

  it('wyjątek z replayRun to replay-failed, z logiem „[ranking] replay” (nazwa i treść), a bez wyjątku na zewnątrz', async () => {
    const verify = makeBundleVerifier(loader(bundle({ replayRun: () => { throw new RangeError('inny generator'); } })));
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-failed' });
    expect(errors.mock.calls).toEqual([['[ranking] replay', 'RangeError', 'inny generator']]);
  });
});

describe('sędzia z bundla: wersja symulacji', () => {
  it('simVersion inny niż SIM_VERSION bundla: old-version, bez odtwarzania (starszy i nowszy bieg)', async () => {
    const replayRun = vi.fn(() => history(1));
    const verify = makeBundleVerifier(loader(bundle({ replayRun })));
    for (const simVersion of [6, 8, 0, 1, 70, Number.MAX_SAFE_INTEGER]) {
      expect(await verify({ ...RUN, simVersion }), String(simVersion)).toEqual({ ok: false, reason: 'old-version' });
    }
    expect(replayRun).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();   // to zwykła odmowa, a nie awaria sędziego
  });

  it('wersja gry (gameVersion) nic nie zmienia: bieg z tą samą simVersion przechodzi, choćby gra była z innego commita', async () => {
    const verify = makeBundleVerifier(loader());
    expect(await verify({ ...RUN, gameVersion: '9.9.9+000000000000' })).toMatchObject({ ok: true });
  });
});

describe('sędzia z bundla: brak albo zepsuty bundle to replay-unavailable, nigdy wyjątek', () => {
  it('ładowanie rzuca (nie zbudowano bundla): replay-unavailable i wpis „[ranking] sędzia” z nazwą i treścią błędu', async () => {
    const load = vi.fn(() => Promise.reject(Object.assign(new Error('Cannot find module judgeBundle.js'), { code: 'ERR_MODULE_NOT_FOUND' })));
    const verify = makeBundleVerifier(load);
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
    expect(errors.mock.calls).toEqual([['[ranking] sędzia', 'Error', 'Cannot find module judgeBundle.js']]);
  });

  it('funkcja ładująca, która rzuca od razu (a nie odrzuca obietnicy), też daje replay-unavailable', async () => {
    const verify = makeBundleVerifier(() => { throw new TypeError('zły import'); });
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
    expect(errors.mock.calls).toEqual([['[ranking] sędzia', 'TypeError', 'zły import']]);
  });

  it('log ma jedną linię, najwyżej 200 znaków treści i nie zawiera ani seeda, ani dziennika biegu', async () => {
    const load = () => Promise.reject(new Error(`pierwsza\nlinia\r\n\tdruga ${'x'.repeat(500)}`));
    const verify = makeBundleVerifier(load);
    await verify({ ...RUN, seed: 'tajny-seed-777', log: [{ minute: 1, seq: 0, cmd: { type: 'tapTill' } }] });
    const [tag, name, message] = errors.mock.calls[0] as [string, string, string];
    expect([tag, name]).toEqual(['[ranking] sędzia', 'Error']);
    expect(message).not.toMatch(/[\r\n\t]/);
    expect(message.length).toBe(200);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('tajny-seed-777');
  });

  it.each([
    ['null', null],
    ['tekst', 'judgeBundle'],
    ['pusty obiekt', {}],
  ])('moduł, który nie jest bundlem (%s): replay-unavailable z logiem', async (_name, mod) => {
    const verify = makeBundleVerifier(loader(mod));
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toBe('[ranking] sędzia');
  });

  it.each(['SIM_VERSION', 'GENERATOR_VERSION', 'RANKED_SEASON_END_MINUTE', 'seasonScore', 'seasonBankrupt', 'replayRun'] as const)(
    'bundle bez eksportu %s (albo z eksportem złego typu): replay-unavailable, a w logu nazwa brakującego eksportu',
    async (name) => {
      const missing = bundle();
      delete (missing as Partial<FakeBundle>)[name];
      expect(await makeBundleVerifier(loader(missing))(RUN), 'brak').toEqual({ ok: false, reason: 'replay-unavailable' });
      expect(JSON.stringify(errors.mock.calls.at(-1))).toContain(name);
      expect(await makeBundleVerifier(loader(bundle({ [name]: 'napis' })))(RUN), 'zły typ').toEqual({ ok: false, reason: 'replay-unavailable' });
      expect(await makeBundleVerifier(loader(bundle({ [name]: undefined })))(RUN), 'undefined').toEqual({ ok: false, reason: 'replay-unavailable' });
    },
  );

  it('koniec sezonu z bundla musi być rozsądną liczbą całkowitą (czas odtwarzania rośnie z nim): NaN, nieskończoność, ułamek, zero, ujemny, ponad sezon serwera', async () => {
    const replayRun = vi.fn(() => history(1));
    for (const end of [NaN, Infinity, -Infinity, 0.5, 0, -1, SEASON_END_MINUTE + 1, 1e12]) {
      const verify = makeBundleVerifier(loader(bundle({ RANKED_SEASON_END_MINUTE: end, replayRun })));
      expect(await verify(RUN), String(end)).toEqual({ ok: false, reason: 'replay-unavailable' });
    }
    expect(replayRun).not.toHaveBeenCalled();
    // granice włącznie: koniec sezonu serwera przechodzi
    expect(await makeBundleVerifier(loader(bundle({ RANKED_SEASON_END_MINUTE: SEASON_END_MINUTE })))(RUN)).toMatchObject({ ok: true });
    expect(await makeBundleVerifier(loader(bundle({ RANKED_SEASON_END_MINUTE: 1 })))(RUN)).toMatchObject({ ok: true });
  });

  it('wersja symulacji w bundlu, która nie jest liczbą całkowitą nieujemną, to zepsuty bundle (replay-unavailable), a nie old-version', async () => {
    for (const v of [NaN, -1, 1.5, '7', null, 2 ** 53]) {
      expect(await makeBundleVerifier(loader(bundle({ SIM_VERSION: v })))(RUN), String(v)).toEqual({ ok: false, reason: 'replay-unavailable' });
    }
  });
});

describe('sędzia z bundla: ładowanie leniwe, zapamiętane tylko po sukcesie', () => {
  it('nic nie ładuje, dopóki nie przyjdzie bieg', () => {
    const load = loader();
    makeBundleVerifier(load);
    expect(load).not.toHaveBeenCalled();
  });

  it('udane ładowanie jest zapamiętane: kolejne biegi, także równoległe od pierwszego, ładują bundle raz', async () => {
    const load = loader();
    const verify = makeBundleVerifier(load);
    const first = await Promise.all([verify(RUN), verify(RUN), verify(RUN)]);
    expect(first.every((v) => v.ok)).toBe(true);
    await verify(RUN);
    await verify({ ...RUN, simVersion: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('nieudane ładowanie nie jest zapamiętane: gdy plik się pojawi, następny bieg przechodzi bez ponownego uruchamiania sędziego', async () => {
    const load = vi.fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('jeszcze nie ma'))
      .mockRejectedValueOnce(new Error('nadal nie ma'))
      .mockResolvedValue(bundle());
    const verify = makeBundleVerifier(load);
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
    expect(await verify(RUN)).toMatchObject({ ok: true });
    expect(load).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('równoległe biegi przy nieudanym ładowaniu dzielą jedną próbę i jeden wpis w logu, a każdy dostaje replay-unavailable', async () => {
    const load = vi.fn(() => Promise.reject(new Error('brak')));
    const verify = makeBundleVerifier(load);
    const all = await Promise.all([verify(RUN), verify(RUN), verify(RUN)]);
    expect(all).toEqual(Array(3).fill({ ok: false, reason: 'replay-unavailable' }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('zepsuty bundle (zły kształt) też nie jest zapamiętany na stałe', async () => {
    const load = vi.fn<() => Promise<unknown>>().mockResolvedValueOnce({}).mockResolvedValue(bundle());
    const verify = makeBundleVerifier(load);
    expect(await verify(RUN)).toEqual({ ok: false, reason: 'replay-unavailable' });
    expect(await verify(RUN)).toMatchObject({ ok: true });
  });
});

describe('sędzia wpięty w route (jak w api/runs.ts): ranking wyłączony nie dotyka bundla', () => {
  // Sam `api/runs.ts` ma literał `import('../src/server/judgeBundle.js')`, którego z testu nie da się podmienić (Vitest nie przechwytuje
  // dynamicznego importu brakującego pliku), więc to samo okablowanie odtwarzamy tu ze szpiegiem w miejscu importu: `route` z sędzią
  // `makeBundleVerifier(szpieg)`. Że `api/runs.ts` nie ładuje bundla statycznie, pilnują `runtimeImports.test.ts` i `api.test.ts`.
  const request = (): Request => new Request('https://traszka.test/api/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'K7QX-9MBD-2HFA-P3WN-8RTE', nick: 'Mateusz', run: RUN }),
  });

  it('bez RANKING_ENABLED=1: 503 ranking-off, a funkcja ładująca bundle nie jest wywołana', async () => {
    const load = loader();
    const post = route(handleRuns, { env: () => ({ KV_REST_API_URL: 'https://atrapa.upstash.test', KV_REST_API_TOKEN: 'atrapa' }), verifyRun: makeBundleVerifier(load) });
    const res = await post(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: 'ranking-off' });
    expect(load).not.toHaveBeenCalled();
  });

  it('z RANKING_ENABLED=1, ale bez konfiguracji bazy: 503 not-configured, bundle nadal nietknięty', async () => {
    const load = loader();
    const post = route(handleRuns, { env: () => ({ RANKING_ENABLED: '1' }), verifyRun: makeBundleVerifier(load) });
    expect((await (await post(request())).json() as { error: string }).error).toBe('not-configured');
    expect(load).not.toHaveBeenCalled();
  });
});

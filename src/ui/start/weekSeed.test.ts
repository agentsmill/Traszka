import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, BoardResponse, RankingClient } from '../ranking/client';
import { createWeekSeedPicker, weekSeedOf } from './weekSeed';

/** Obietnica, którą test spełnia sam, kiedy chce (serwer odpowiada „później”). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('createWeekSeedPicker: seed tygodnia z serwera do pola seeda', () => {
  it('kliknięcie: chip czeka („loading”), po odpowiedzi seed idzie do pola, a chip wraca do stanu spoczynku', async () => {
    const reply = deferred<string | null>();
    const apply = vi.fn();
    const picker = createWeekSeedPicker(() => reply.promise, apply);
    expect(picker.status.value).toBe('idle');
    picker.pick();
    expect(picker.status.value).toBe('loading');
    expect(apply).not.toHaveBeenCalled();
    reply.resolve('babka-834');
    await flush();
    expect(apply).toHaveBeenCalledExactlyOnceWith('babka-834');
    expect(picker.status.value).toBe('idle');
  });

  it('serwer nie odpowiada (null): komunikat „niedostępny”, pole nietknięte', async () => {
    const apply = vi.fn();
    const picker = createWeekSeedPicker(async () => null, apply);
    picker.pick();
    await flush();
    expect(picker.status.value).toBe('unavailable');
    expect(apply).not.toHaveBeenCalled();
  });

  it('wyjątek z zapytania to też „niedostępny”, a nie nieobsłużone odrzucenie', async () => {
    const apply = vi.fn();
    const picker = createWeekSeedPicker(() => Promise.reject(new Error('sieć')), apply);
    picker.pick();
    await flush();
    expect(picker.status.value).toBe('unavailable');
    expect(apply).not.toHaveBeenCalled();
  });

  it('drugie kliknięcie w trakcie czekania nie wysyła drugiego zapytania', async () => {
    const reply = deferred<string | null>();
    const load = vi.fn(() => reply.promise);
    const picker = createWeekSeedPicker(load, vi.fn());
    picker.pick();
    picker.pick();
    expect(load).toHaveBeenCalledOnce();
    reply.resolve('babka-834');
    await flush();
  });

  it('po porażce kolejne kliknięcie próbuje jeszcze raz i zdejmuje komunikat', async () => {
    const replies: (string | null)[] = [null, 'babka-834'];
    const apply = vi.fn();
    const picker = createWeekSeedPicker(async () => replies.shift() ?? null, apply);
    picker.pick();
    await flush();
    expect(picker.status.value).toBe('unavailable');
    picker.pick();
    expect(picker.status.value).toBe('loading');
    await flush();
    expect(picker.status.value).toBe('idle');
    expect(apply).toHaveBeenCalledExactlyOnceWith('babka-834');
  });

  it('reset (gracz sam zmienił seed) w trakcie czekania: spóźniona odpowiedź niczego nie nadpisuje', async () => {
    const reply = deferred<string | null>();
    const apply = vi.fn();
    const picker = createWeekSeedPicker(() => reply.promise, apply);
    picker.pick();
    picker.reset();
    expect(picker.status.value).toBe('idle');
    reply.resolve('babka-834');
    await flush();
    expect(apply).not.toHaveBeenCalled();
    expect(picker.status.value).toBe('idle');
  });

  it('reset zdejmuje komunikat „niedostępny”; spóźniona porażka go nie przywraca', async () => {
    const reply = deferred<string | null>();
    const picker = createWeekSeedPicker(() => reply.promise, vi.fn());
    picker.pick();
    picker.reset();
    reply.resolve(null);
    await flush();
    expect(picker.status.value).toBe('idle');
  });
});

describe('weekSeedOf: seed tygodnia z klienta rankingu', () => {
  const week = { id: '2026-W44', seed: 'babka-834', endsAt: 1_800_000_000_000 };
  const clientReplying = (reply: ApiResult<BoardResponse> | (() => never)): Pick<RankingClient, 'board'> => ({
    board: vi.fn(async () => (typeof reply === 'function' ? reply() : reply)),
  });

  it('prosi o tablicę tygodnia i oddaje jego seed', async () => {
    const client = clientReplying({ ok: true, board: 'week', week, rows: [] });
    expect(await weekSeedOf(client)()).toBe('babka-834');
    expect(client.board).toHaveBeenCalledExactlyOnceWith('week');
  });

  it('ranking wyłączony, brak sieci i odpowiedź spoza API: null', async () => {
    for (const error of ['ranking-off', 'network', 'unavailable']) {
      expect(await weekSeedOf(clientReplying({ ok: false, error, message: 'x' }))(), error).toBeNull();
    }
  });

  it('klient, który rzuca, i pusty seed w odpowiedzi: null', async () => {
    expect(await weekSeedOf(clientReplying(() => { throw new Error('boom'); }))()).toBeNull();
    expect(await weekSeedOf(clientReplying({ ok: true, board: 'week', week: { ...week, seed: '' }, rows: [] }))()).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import { createShell, type GameShell, type ShellEffects, type ShellScene } from '@/game/actions';
import { DEFAULT_CASHIER_LOOK } from '@/game/cashier';
import { MemoryStorage } from '@/game/memoryStorage';
import { loadMeta, saveMeta, type Meta } from '@/game/meta';
import { RECOVERY_ERRORS, formatRecoveryCode } from '@/game/playerKey';
import { createSession, saveSession } from '@/game/session';
import type { ApiResult, BoardResponse, PlayerResponse, RankingClient, SaveDownloaded, SaveUploadResult } from './client';
import { NO_SEED } from './rankingModel';
import * as transfer from './saveTransfer';
import { IMPORT_KEY, SAVE_SYNC_KEY, exportTransfer, readSaveSync } from './saveTransfer';
import { createRankingServices } from './services';

const KEY_A = 'K7QX9MBD2HFAP3WN8RTE';
const KEY_B = 'M2N3P4Q5R6S7T8V9W0XY';
const SEED = 'pierogi-731';
const WEEK = { id: '2026-W44', seed: 'babka-834', endsAt: Date.UTC(2026, 10, 2) };

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const meta = (over: Partial<Meta> = {}): Meta => ({
  version: 1, partnerPoints: 7, network: [], daily: { date: '2026-10-27', streak: 4 }, lastSeen: 1, sound: true, vibration: true,
  player: { nick: 'Mateusz', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true, key: KEY_A }, ...over,
});

/** Prawdziwa powłoka gry na atrapach sceny i efektów (jak w actions.test.ts): `persist` jest tym samym, co wołają `pagehide` i `visibilitychange`. */
function makeShell(initial: Meta = meta(), withSession = true): GameShell {
  const scene: ShellScene = { seed: null, load: () => undefined, syncVisuals: () => undefined, setCashierLook: () => undefined };
  const effects: ShellEffects = {
    play: () => undefined, buzz: () => undefined, confetti: () => undefined, notice: () => undefined,
    setSound: () => undefined, setVibration: () => undefined, floater: () => undefined,
  };
  const shell = createShell({
    meta: initial, benchMode: false, scene, effects, randomSeed: () => 'losowy', writeSeedToUrl: () => undefined, clearSeedFromUrl: () => undefined,
    characterFactory: () => Promise.resolve({} as CharacterFactory), firstDayHints: [],
  });
  if (withSession) shell.session = createSession(SEED, true);
  return shell;
}

/** Klient z odpowiedziami domyślnymi (pusty ranking, brak nicków, wysyłanie przyjęte); `over` podmienia wybrane. */
function fakeClient(over: Partial<RankingClient> = {}): RankingClient {
  return {
    board: vi.fn(async (tab): Promise<ApiResult<BoardResponse>> => ({ ok: true, board: tab, week: WEEK, rows: [] })),
    player: vi.fn(async (): Promise<ApiResult<PlayerResponse>> => ({ ok: true, nicks: ['Kasjer Roku'] })),
    uploadSave: vi.fn(async (): Promise<SaveUploadResult> => ({ ok: true, bytes: 2048, savedAt: 777 })),
    downloadSave: vi.fn(async (): Promise<ApiResult<SaveDownloaded>> => ({ ok: true, save: 'nie paczka', savedAt: 555 })),
    submitRun: vi.fn(),
    ...over,
  };
}

/** Wpisuje kod z innego urządzenia i go zatwierdza, tak jak gracz w panelu „Kod odzyskiwania”. */
async function adopt(services: ReturnType<typeof createRankingServices>, key: string): Promise<void> {
  const { recoveryModel } = services;
  recoveryModel.setInput(formatRecoveryCode(key));
  await recoveryModel.submitCode();
  await recoveryModel.confirmPending();
}

describe('createRankingServices: klucz gracza (adoptKey)', () => {
  it('kod z innego urządzenia zmienia klucz w pamięci powłoki i w zapisanej mecie', async () => {
    const shell = makeShell();
    saveMeta(shell.meta);
    const services = createRankingServices({ shell, client: fakeClient() });
    expect(services.recoveryModel.code()).toBe(formatRecoveryCode(KEY_A));
    await adopt(services, KEY_B);
    expect(services.recoveryModel.error.value).toBeNull();
    expect(shell.meta.player?.key).toBe(KEY_B);
    expect(loadMeta().player?.key).toBe(KEY_B);
    expect(services.recoveryModel.code()).toBe(formatRecoveryCode(KEY_B));
    expect(shell.meta.player?.nick).toBe('Mateusz');   // nick i reszta mety zostają
    expect(shell.meta.partnerPoints).toBe(7);
  });

  it('kolejny zapis powłoki (persist przy zamknięciu karty) nie cofa klucza do poprzedniego', async () => {
    const shell = makeShell();
    saveMeta(shell.meta);
    const services = createRankingServices({ shell, client: fakeClient() });
    await adopt(services, KEY_B);
    shell.persist();
    expect(loadMeta().player?.key).toBe(KEY_B);
    shell.persist();   // pagehide i visibilitychange potrafią przyjść po sobie
    expect(loadMeta().player?.key).toBe(KEY_B);
    expect(shell.meta.player?.key).toBe(KEY_B);
  });

  it('kod odrzucony (bez gracza w mecie, meta z nowszej wersji gry): komunikat dla gracza, klucz i meta bez zmian', async () => {
    const noPlayer = makeShell(meta({ player: undefined }));
    const withoutPlayer = createRankingServices({ shell: noPlayer, client: fakeClient() });
    await adopt(withoutPlayer, KEY_B);
    expect(withoutPlayer.recoveryModel.error.value).toBe(RECOVERY_ERRORS.noPlayer);
    expect(noPlayer.meta.player).toBeUndefined();

    const readOnly = makeShell(meta({ readOnly: true }));
    const frozen = createRankingServices({ shell: readOnly, client: fakeClient() });
    await adopt(frozen, KEY_B);
    expect(frozen.recoveryModel.error.value).toBe(RECOVERY_ERRORS.readOnly);
    expect(readOnly.meta.player?.key).toBe(KEY_A);
    expect(storage.getItem('traszka:meta')).toBeNull();   // meta z nowszej wersji nie jest zapisywana
  });

  it('po zmianie klucza model rankingu pyta serwer już nowym kluczem', async () => {
    const shell = makeShell();
    const client = fakeClient();
    const services = createRankingServices({ shell, client });
    await services.rankingModel.select('global');
    expect(client.player).toHaveBeenLastCalledWith(KEY_A, 'Mateusz', SEED);
    await adopt(services, KEY_B);
    await services.rankingModel.select('global');
    expect(client.player).toHaveBeenLastCalledWith(KEY_B, 'Mateusz', SEED);
  });
});

describe('createRankingServices: nick (useNick)', () => {
  it('wybrany nick z kodu zapamiętuje powłoka, klucz zostaje, a zapis mety widzi go po odświeżeniu strony', () => {
    const shell = makeShell();
    saveMeta(shell.meta);
    const services = createRankingServices({ shell, client: fakeClient() });
    services.recoveryModel.chooseNick('Kasjer Roku');
    expect(shell.meta.player).toMatchObject({ nick: 'Kasjer Roku', key: KEY_A });
    expect(loadMeta().player).toMatchObject({ nick: 'Kasjer Roku', key: KEY_A });
    expect(services.recoveryModel.notice.value).toBe('Grasz jako Kasjer Roku.');
  });
});

describe('createRankingServices: model rankingu czyta stan gry na bieżąco', () => {
  it('gracz z mety powłoki, seed bieżącego sklepu; bez sesji zakładka „Ten seed” podpowiada, co zrobić', async () => {
    const shell = makeShell(meta(), false);
    const client = fakeClient();
    const services = createRankingServices({ shell, client });
    await services.rankingModel.select('seed');
    expect(services.rankingModel.view.value).toMatchObject({ status: 'error', message: NO_SEED });
    expect(client.board).not.toHaveBeenCalled();
    shell.session = createSession('kielbasa-42', true);
    await services.rankingModel.select('seed');
    expect(client.board).toHaveBeenCalledWith('seed', 'kielbasa-42');
    expect(client.player).toHaveBeenLastCalledWith(KEY_A, 'Mateusz', 'kielbasa-42');
  });

  it('gracz bez klucza i nicka nie jest pytany o miejsca', async () => {
    const shell = makeShell(meta({ player: undefined }));
    const client = fakeClient();
    const services = createRankingServices({ shell, client });
    await services.rankingModel.select('global');
    expect(client.player).not.toHaveBeenCalled();
    expect(services.rankingModel.hasPlayer()).toBe(false);
  });
});

describe('createRankingServices: zapis gry (exportSave)', () => {
  it('woła persist przed eksportem: kolejność wywołań', async () => {
    const order: string[] = [];
    const shell = { meta: meta(), session: null, persist: () => { order.push('persist'); }, game: { rememberNick: () => undefined } } as unknown as GameShell;
    vi.spyOn(transfer, 'exportTransfer').mockImplementation(() => { order.push('exportTransfer'); return '{"paczka":1}'; });
    const client = fakeClient();
    const services = createRankingServices({ shell, client });
    await services.recoveryModel.upload();
    expect(order).toEqual(['persist', 'exportTransfer']);
    expect(client.uploadSave).toHaveBeenCalledWith(KEY_A, '{"paczka":1}', expect.anything());
  });

  it('paczka ma stan sprzed chwili, a nie sprzed ostatniego zapisu: dzień gry w pamięci nie zostaje w tyle', async () => {
    const shell = makeShell();
    saveMeta(shell.meta);
    const session = shell.session!;
    session.econ.cash = 1_000;
    saveSession(session);   // zapis z końca poprzedniego dnia
    session.econ.cash = 4_321;   // dalsza gra w pamięci, jeszcze niezapisana
    const cashIn = (bundle: string): number => (JSON.parse(bundle) as { save: { econ: { cash: number } } }).save.econ.cash;
    expect(cashIn(exportTransfer()!)).toBe(1_000);   // sam eksport z przeglądarki byłby o dzień wstecz
    const client = fakeClient();
    const services = createRankingServices({ shell, client });
    await services.recoveryModel.upload();
    const sent = vi.mocked(client.uploadSave).mock.calls[0]![1];
    expect(cashIn(sent)).toBe(4_321);
  });

  it('bez sklepu do zapisania nie ma czego wysłać: komunikat zamiast pustej paczki', async () => {
    const shell = makeShell(meta(), false);
    const client = fakeClient();
    const services = createRankingServices({ shell, client });
    await services.recoveryModel.upload();
    expect(client.uploadSave).not.toHaveBeenCalled();
    expect(services.recoveryModel.error.value).toContain('Nie ma jeszcze czego wysłać');
  });

  it('chwila ostatniej kopii (sync) leży w przeglądarce: po wysłaniu zapisana, przy następnym wysłaniu jedzie jako expected', async () => {
    const shell = makeShell();
    saveMeta(shell.meta);
    const client = fakeClient();
    const services = createRankingServices({ shell, client });
    expect(readSaveSync()).toBeNull();
    await services.recoveryModel.upload();
    expect(readSaveSync()).toBe(777);
    expect(storage.getItem(SAVE_SYNC_KEY)).toBe('777');
    await services.recoveryModel.upload();
    expect(client.uploadSave).toHaveBeenLastCalledWith(KEY_A, expect.any(String), { expected: 777 });
  });
});

describe('createRankingServices: pobrany zapis (stageSave i reload)', () => {
  const download = (save: string): ApiResult<SaveDownloaded> => ({ ok: true, save, savedAt: 555 });

  async function downloaded(save: string) {
    const shell = makeShell();
    saveMeta(shell.meta);
    saveSession(shell.session!);
    const client = fakeClient({ downloadSave: vi.fn(async () => download(save)) });
    const reload = vi.fn();
    const services = createRankingServices({ shell, client, reload });
    await services.recoveryModel.download();
    await services.recoveryModel.confirmPending();
    return { services, reload, shell };
  }

  it('dobra paczka czeka pod kluczem pośrednim, a strona się przeładowuje; meta i sklepy nietknięte', async () => {
    const shell = makeShell();
    saveMeta(shell.meta);
    saveSession(shell.session!);
    const bundle = exportTransfer()!;
    const before = [...storage.keys()].sort();
    const { reload } = await downloaded(bundle);
    expect(storage.getItem(IMPORT_KEY)).toBe(bundle);
    expect(reload).toHaveBeenCalledTimes(1);
    expect([...storage.keys()].filter((k) => k !== IMPORT_KEY && k !== SAVE_SYNC_KEY).sort()).toEqual(before);
  });

  it('zła paczka: komunikat dla gracza, nic nie czeka na start, strony nie przeładowujemy', async () => {
    const { services, reload } = await downloaded('to nie jest zapis');
    expect(services.recoveryModel.error.value).toBe(transfer.TRANSFER_ERRORS.invalid);
    expect(storage.getItem(IMPORT_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('bez wstrzykniętego reload gra przeładowuje stronę przeglądarki (location.reload)', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const shell = makeShell();
    saveMeta(shell.meta);
    saveSession(shell.session!);
    const client = fakeClient({ downloadSave: vi.fn(async () => download(exportTransfer()!)) });
    const services = createRankingServices({ shell, client });
    await services.recoveryModel.download();
    await services.recoveryModel.confirmPending();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('createRankingServices: modele powstają leniwie, raz', () => {
  it('ten sam model przy każdym odczycie, a samo utworzenie usług nie pyta serwera', () => {
    const client = fakeClient();
    const services = createRankingServices({ shell: makeShell(), client });
    expect(services.rankingModel).toBe(services.rankingModel);
    expect(services.recoveryModel).toBe(services.recoveryModel);
    expect(client.board).not.toHaveBeenCalled();
    expect(client.player).not.toHaveBeenCalled();
    expect(client.uploadSave).not.toHaveBeenCalled();
  });
});

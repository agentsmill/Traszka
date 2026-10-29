import type { ComponentChild, VNode } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { RECOVERY_ERRORS } from '@/game/playerKey';
import { NETWORK_ERROR, type ApiResult, type RankingClient, type SaveDownloaded, type SaveUploadOptions, type SaveUploadResult } from './client';
import { MASKED_CODE, NO_KEY, NOTHING_TO_SEND, RecoveryPanel, SAME_CODE } from './RecoveryPanel';
import { STAGED_NOTICE, createRecoveryModel, type RecoveryDeps } from './recoveryModel';
import { SAVE_SYNC_KEY, readSaveSync, writeSaveSync } from './saveTransfer';

function walk(node: ComponentChild, out: VNode<Record<string, unknown>>[] = []): VNode<Record<string, unknown>>[] {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  const vnode = node as VNode<Record<string, unknown>>;
  out.push(vnode);
  walk(vnode.props?.children as ComponentChild, out);
  return out;
}
function textOf(node: ComponentChild): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as VNode<Record<string, unknown>>).props?.children as ComponentChild);
}
const button = (tree: ComponentChild, label: string) => {
  const b = walk(tree).find((v) => v.type === 'button' && textOf(v) === label);
  if (!b) throw new Error(`brak przycisku „${label}” w: ${walk(tree).filter((v) => v.type === 'button').map(textOf).join(' | ')}`);
  return b;
};
const labels = (tree: ComponentChild) => walk(tree).filter((v) => v.type === 'button').map(textOf);

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const OTHER = 'M2N3P4Q5R6S7T8V9W0XY';

afterEach(() => vi.unstubAllGlobals());

/**
 * Atrapa szuflady Centrali (jedna kopia na kod): przyjmuje wysłanie, gdy kopii nie ma, gdy urządzenie zna jej chwilę (`expected`)
 * albo gdy wysyła z `force`; inaczej odpowiada tak jak serwer, 409 `save-conflict` z chwilą kopii, która tam leży.
 */
function fakeDrawer(initial: number | null = null) {
  const drawer = { savedAt: initial, clock: 100 };
  const uploadSave = vi.fn(async (_key: string, save: string, opts?: SaveUploadOptions): Promise<SaveUploadResult> => {
    if (drawer.savedAt !== null && opts?.expected !== drawer.savedAt && opts?.force !== true) {
      return { ok: false, error: 'save-conflict', message: 'Na serwerze leży nowsza kopia zapisu, której to urządzenie jeszcze nie widziało.', savedAt: drawer.savedAt };
    }
    drawer.savedAt = ++drawer.clock;
    return { ok: true, bytes: save.length, savedAt: drawer.savedAt };
  });
  return { drawer, uploadSave };
}

function setup(over: Partial<RecoveryDeps> = {}, download: ApiResult<SaveDownloaded> = { ok: true, save: '{"schema":2}', savedAt: Date.UTC(2026, 9, 27, 18, 30) },
  uploadSave: RankingClient['uploadSave'] = fakeDrawer().uploadSave) {
  const state = { key: KEY as string | null, sync: null as number | null };
  const client: RankingClient = {
    board: vi.fn(),
    player: vi.fn(async () => ({ ok: true as const, nicks: ['Mateusz', 'Kasjer Roku'] })),
    uploadSave,
    downloadSave: vi.fn(async () => download),
    submitRun: vi.fn(),
  };
  const deps: RecoveryDeps = {
    client,
    key: () => state.key,
    adoptKey: vi.fn((key: string) => { state.key = key; return null; }),
    useNick: vi.fn(),
    exportSave: vi.fn(() => '{"schema":2,"seed":"pierogi-731"}'),
    stageSave: vi.fn(() => null),
    reload: vi.fn(),
    sync: { get: vi.fn(() => state.sync), set: vi.fn((savedAt: number) => { state.sync = savedAt; }) },
    copy: vi.fn(async () => undefined),
    ...over,
  };
  const model = createRecoveryModel(deps);
  const view = () => RecoveryPanel({ model, onClose: () => undefined });
  return { model, deps, client, state, view };
}

describe('kod odzyskiwania: pokazanie i kopiowanie', () => {
  it('kod jest zakryty, dopóki gracz go nie odsłoni; potem pięć grup po cztery znaki', () => {
    const { view } = setup();
    expect(textOf(view())).toContain(MASKED_CODE);
    expect(textOf(view())).not.toContain('K7QX');
    (button(view(), 'Pokaż kod').props.onClick as () => void)();
    expect(textOf(view())).toContain('K7QX-9MBD-2HFA-P3WN-8RTE');
    expect(labels(view())).toContain('Ukryj kod');
  });

  it('„Kopiuj” kopiuje kod w postaci z łącznikami i mówi, że się udało', async () => {
    const { view, deps, model } = setup();
    await (button(view(), 'Kopiuj').props.onClick as () => Promise<void>)();
    expect(deps.copy).toHaveBeenCalledWith('K7QX-9MBD-2HFA-P3WN-8RTE');
    expect(model.notice.value).toMatch(/skopiowany/i);
  });

  it('gracz bez klucza (przed pierwszym sklepem): komunikat zamiast kodu, a wysyłanie zapisu nie działa', async () => {
    const { view, state, model } = setup();
    state.key = null;
    expect(textOf(view())).toContain(NO_KEY);
    expect(labels(view())).not.toContain('Pokaż kod');
    await model.upload();
    expect(model.error.value).toBe(NO_KEY);
  });
});

describe('kod z innego urządzenia', () => {
  it('wpisany kod wymaga potwierdzenia; po nim klucz się zmienia, a panel pokazuje nicki tego kodu z serwera', async () => {
    const { view, model, deps, client } = setup();
    model.setInput('m2n3-p4q5-r6s7-t8v9-w0xy');
    await (button(view(), 'Użyj kodu').props.onClick as () => Promise<void>)();
    expect(deps.adoptKey).not.toHaveBeenCalled();
    expect(textOf(view())).toContain('K7QX-9MBD-2HFA-P3WN-8RTE');   // potwierdzenie przypomina obecny kod
    await (button(view(), 'Zastąp klucz').props.onClick as () => Promise<void>)();
    expect(deps.adoptKey).toHaveBeenCalledWith(OTHER);
    expect(client.player).toHaveBeenCalledWith(OTHER);
    expect(model.nicks.value).toEqual(['Mateusz', 'Kasjer Roku']);
    (button(view(), 'Graj jako Kasjer Roku').props.onClick as () => void)();
    expect(deps.useNick).toHaveBeenCalledWith('Kasjer Roku');
  });

  it('„Anuluj” zostawia klucz', async () => {
    const { view, model, deps } = setup();
    model.setInput(OTHER);
    await model.submitCode();
    (button(view(), 'Anuluj').props.onClick as () => void)();
    expect(model.confirm.value).toBeNull();
    expect(deps.adoptKey).not.toHaveBeenCalled();
  });

  it('zły kod: komunikat z reguł kodu; ten sam kod co tutaj: nic do zrobienia; błąd zapisu mety wraca do gracza', async () => {
    const { model } = setup();
    model.setInput('abc');
    await model.submitCode();
    expect(model.error.value).toBe(RECOVERY_ERRORS.invalid);
    model.setInput('k7qx 9mbd 2hfa p3wn 8rte');
    await model.submitCode();
    expect(model.notice.value).toBe(SAME_CODE);
    expect(model.confirm.value).toBeNull();
    const failing = setup({ adoptKey: vi.fn(() => RECOVERY_ERRORS.noPlayer) });
    failing.model.setInput(OTHER);
    await failing.model.submitCode();
    await failing.model.confirmPending();
    expect(failing.model.error.value).toBe(RECOVERY_ERRORS.noPlayer);
    expect(failing.client.player).not.toHaveBeenCalled();
  });
});

describe('zapis gry przez kod', () => {
  it('„Wyślij zapis” wysyła bieżący zapis z kluczem tego urządzenia', async () => {
    const { model, client, view } = setup();
    await (button(view(), 'Wyślij zapis').props.onClick as () => Promise<void>)();
    expect(client.uploadSave).toHaveBeenCalledWith(KEY, '{"schema":2,"seed":"pierogi-731"}', { expected: null });
    expect(model.notice.value).toMatch(/wysłany/i);
  });

  it('nie ma czego wysłać: komunikat, bez zapytania', async () => {
    const { model, client } = setup({ exportSave: () => null });
    await model.upload();
    expect(model.error.value).toBe(NOTHING_TO_SEND);
    expect(client.uploadSave).not.toHaveBeenCalled();
  });

  it('„Pobierz zapis” pyta przed zastąpieniem zapisu na tym urządzeniu (z datą wysłania), a dopiero „Zastąp zapis” go zapisuje do wczytania po przeładowaniu', async () => {
    const { model, deps, view } = setup();
    await (button(view(), 'Pobierz zapis').props.onClick as () => Promise<void>)();
    expect(deps.stageSave).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(textOf(view())).toMatch(/27\.10\.2026/);
    expect(textOf(view())).toMatch(/zastąpi/i);
    await (button(view(), 'Zastąp zapis').props.onClick as () => Promise<void>)();
    expect(deps.stageSave).toHaveBeenCalledExactlyOnceWith('{"schema":2}');
    expect(model.notice.value).toBe(STAGED_NOTICE);
    expect(model.notice.value).toMatch(/czeka na wczytanie/i);
    expect(model.error.value).toBeNull();
    expect(model.confirm.value).toBeNull();
  });

  it('potwierdzenie pobrania: najpierw stageSave, potem reload, każde dokładnie raz', async () => {
    const calls: string[] = [];
    const { model } = setup({ stageSave: vi.fn(() => { calls.push('stage'); return null; }), reload: vi.fn(() => { calls.push('reload'); }) });
    await model.download();
    expect(calls).toEqual([]);   // samo pobranie niczego nie wczytuje
    await model.confirmPending();
    await model.confirmPending();   // drugie potwierdzenie nie ma już czego potwierdzać
    expect(calls).toEqual(['stage', 'reload']);
  });

  it('błędy z serwera (np. brak zapisu pod kodem) i ze schowania paczki wracają do gracza, a strona się nie przeładowuje', async () => {
    const none = setup({}, { ok: false, error: 'no-save', message: 'Pod tym kodem nie ma zapisu w szufladzie Centrali.' });
    await none.model.download();
    expect(none.model.error.value).toBe('Pod tym kodem nie ma zapisu w szufladzie Centrali.');
    expect(none.model.confirm.value).toBeNull();
    const broken = setup({ stageSave: vi.fn(() => 'Zapis jest uszkodzony') });
    await broken.model.download();
    await broken.model.confirmPending();
    expect(broken.model.error.value).toBe('Zapis jest uszkodzony');
    expect(broken.model.notice.value).toBeNull();
    expect(broken.deps.reload).not.toHaveBeenCalled();
    expect(broken.deps.sync.set).not.toHaveBeenCalled();
  });

  it('w trakcie zapytania przyciski są wyłączone', async () => {
    let release: () => void = () => undefined;
    const slow = setup({}, { ok: true, save: '{}', savedAt: 1 });
    (slow.client.downloadSave as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: true, save: '{}', savedAt: 1 }); }));
    const pending = slow.model.download();
    expect(slow.model.busy.value).toBe(true);
    expect(button(slow.view(), 'Wyślij zapis').props.disabled).toBe(true);
    release();
    await pending;
    expect(slow.model.busy.value).toBe(false);
  });
});

describe('zapis gry: kopia na serwerze, której to urządzenie nie widziało (Drobne 6)', () => {
  it('pierwsze wysłanie idzie bez kopii na serwerze (expected: null), po sukcesie urządzenie zapamiętuje chwilę kopii, a kolejne wysłanie nie pyta', async () => {
    const { drawer, uploadSave } = fakeDrawer();
    const { model, deps, state, client } = setup({}, undefined, uploadSave);
    await model.upload();
    expect(client.uploadSave).toHaveBeenLastCalledWith(KEY, expect.any(String), { expected: null });
    expect(state.sync).toBe(drawer.savedAt);
    expect(deps.sync.set).toHaveBeenCalledExactlyOnceWith(drawer.savedAt);
    const first = drawer.savedAt;
    await model.upload();
    expect(client.uploadSave).toHaveBeenLastCalledWith(KEY, expect.any(String), { expected: first });
    expect(model.confirm.value).toBeNull();
    expect(model.error.value).toBeNull();
    expect(model.notice.value).toMatch(/wysłany/i);
    expect(state.sync).toBe(drawer.savedAt);
    expect(drawer.savedAt).not.toBe(first);
  });

  it('urządzenie, które nie widziało kopii z serwera, dostaje pytanie z datą tej kopii zamiast błędu; „Anuluj” nic nie wysyła', async () => {
    const { drawer, uploadSave } = fakeDrawer(Date.UTC(2026, 9, 27, 12, 0));
    const { model, view, client, state } = setup({}, undefined, uploadSave);
    await (button(view(), 'Wyślij zapis').props.onClick as () => Promise<void>)();
    expect(model.confirm.value).toEqual({ kind: 'overwrite', savedAt: Date.UTC(2026, 9, 27, 12, 0) });
    expect(model.error.value).toBeNull();
    expect(model.notice.value).toBeNull();
    expect(textOf(view())).toMatch(/Na serwerze leży kopia z .*27\.10\.2026.*której to urządzenie jeszcze nie widziało\. Zastąpić ją tym zapisem\?/);
    expect(labels(view())).toEqual(expect.arrayContaining(['Zastąp', 'Anuluj']));
    expect(client.uploadSave).toHaveBeenCalledTimes(1);
    (button(view(), 'Anuluj').props.onClick as () => void)();
    expect(model.confirm.value).toBeNull();
    expect(client.uploadSave).toHaveBeenCalledTimes(1);   // anulowanie niczego nie wysyła
    expect(drawer.savedAt).toBe(Date.UTC(2026, 9, 27, 12, 0));
    expect(state.sync).toBeNull();
  });

  it('„Zastąp” ponawia wysłanie z force: true; po sukcesie znacznik się aktualizuje, a następne wysłanie nie pyta', async () => {
    const { drawer, uploadSave } = fakeDrawer(Date.UTC(2026, 9, 27, 12, 0));
    const { model, view, client, state } = setup({}, undefined, uploadSave);
    await model.upload();
    await (button(view(), 'Zastąp').props.onClick as () => Promise<void>)();
    expect(client.uploadSave).toHaveBeenCalledTimes(2);
    expect(client.uploadSave).toHaveBeenLastCalledWith(KEY, '{"schema":2,"seed":"pierogi-731"}', { expected: null, force: true });
    expect(model.confirm.value).toBeNull();
    expect(model.error.value).toBeNull();
    expect(model.notice.value).toMatch(/wysłany/i);
    expect(state.sync).toBe(drawer.savedAt);
    const known = state.sync;
    await model.upload();
    expect(client.uploadSave).toHaveBeenLastCalledWith(KEY, expect.any(String), { expected: known });
    expect(model.confirm.value).toBeNull();
    expect(model.error.value).toBeNull();
  });

  it('inne błędy wysyłania (nie konflikt) wracają jako komunikat, bez pytania i bez zmiany znacznika', async () => {
    const down: SaveUploadResult = { ok: false, error: 'network', message: 'Brak połączenia z Centralą.' };
    const { model, state } = setup({}, undefined, vi.fn(async () => down));
    await model.upload();
    expect(model.error.value).toBe('Brak połączenia z Centralą.');
    expect(model.confirm.value).toBeNull();
    expect(state.sync).toBeNull();
    const odd: SaveUploadResult = { ok: false, error: 'save-conflict', message: 'Konflikt bez chwili kopii.' };   // odpowiedź bez savedAt nie otwiera pytania
    const strange = setup({}, undefined, vi.fn(async () => odd));
    await strange.model.upload();
    expect(strange.model.error.value).toBe('Konflikt bez chwili kopii.');
    expect(strange.model.confirm.value).toBeNull();
  });

  it('po „Pobierz zapis” znacznik ma chwilę pobranej kopii (po potwierdzeniu), więc następne wysłanie z tego urządzenia nie pyta', async () => {
    const savedAt = Date.UTC(2026, 9, 27, 18, 30);
    const { drawer, uploadSave } = fakeDrawer(savedAt);
    const { model, deps, state, client } = setup({}, { ok: true, save: '{"schema":2}', savedAt }, uploadSave);
    await model.download();
    expect(deps.sync.set).not.toHaveBeenCalled();   // dopóki gracz nie potwierdzi, urządzenie kopii nie „widziało”
    await model.confirmPending();
    expect(state.sync).toBe(savedAt);
    await model.upload();
    expect(client.uploadSave).toHaveBeenLastCalledWith(KEY, expect.any(String), { expected: savedAt });
    expect(model.confirm.value).toBeNull();
    expect(drawer.savedAt).not.toBe(savedAt);
  });

  it('znacznik w przeglądarce (traszka:saveSync): zapisuje się po wysłaniu i po pobraniu, a bez niego urządzenie dostaje pytanie', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const sync = { get: readSaveSync, set: writeSaveSync };
    const { drawer, uploadSave } = fakeDrawer();
    const a = setup({ sync }, undefined, uploadSave);
    await a.model.upload();
    expect(storage.getItem(SAVE_SYNC_KEY)).toBe(String(drawer.savedAt));
    await a.model.upload();
    expect(a.model.confirm.value).toBeNull();
    // drugie urządzenie: czysta przeglądarka
    storage.clear();
    const b = setup({ sync }, undefined, uploadSave);
    await b.model.upload();
    expect(b.model.confirm.value).toEqual({ kind: 'overwrite', savedAt: drawer.savedAt });
    const before = drawer.savedAt;
    await b.model.confirmPending();
    expect(drawer.savedAt).not.toBe(before);
    expect(storage.getItem(SAVE_SYNC_KEY)).toBe(String(drawer.savedAt));
    // po pobraniu zapisu znacznik wskazuje pobraną kopię
    storage.clear();
    const c = setup({ sync }, { ok: true, save: '{"schema":2}', savedAt: 4242 }, uploadSave);
    await c.model.download();
    await c.model.confirmPending();
    expect(storage.getItem(SAVE_SYNC_KEY)).toBe('4242');
  });
});

describe('kod odzyskiwania: serwer wyłączony albo nieosiągalny (panel działa dalej)', () => {
  const OFF = { ok: false as const, error: 'ranking-off', message: 'Ranking Centrali jeszcze nie ruszył.' };
  const NET = { ok: false as const, error: 'network', message: NETWORK_ERROR };
  const failures = [['ranking-off', OFF], ['network', NET]] as const;
  const alertLine = (tree: ComponentChild) => walk(tree).find((v) => v.props?.role === 'alert' && v.type === 'p');

  it.each(failures)('„Pobierz zapis” przy odpowiedzi „%s”: komunikat serwera w linii błędu, żadne pytanie, nic nie odłożone', async (_name, failure) => {
    const { view, deps, model } = setup({}, failure);
    await (button(view(), 'Pobierz zapis').props.onClick as () => Promise<void>)();
    expect(textOf(alertLine(view()))).toBe(failure.message);
    expect(model.confirm.value).toBeNull();
    expect(deps.stageSave).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it.each(failures)('„Wyślij zapis” przy odpowiedzi „%s”: ten sam komunikat, a znacznik ostatniej kopii się nie zmienia', async (_name, failure) => {
    const { view, deps } = setup({}, undefined, vi.fn(async (): Promise<SaveUploadResult> => failure));
    await (button(view(), 'Wyślij zapis').props.onClick as () => Promise<void>)();
    expect(textOf(alertLine(view()))).toBe(failure.message);
    expect(deps.sync.set).not.toHaveBeenCalled();
  });

  it.each(failures)('po błędzie „%s” przyciski wracają do pracy, kod zostaje do pokazania, a ✕ zamyka panel', async (_name, failure) => {
    const { model, deps } = setup({}, failure);
    const onClose = vi.fn();
    await model.download();
    const tree = RecoveryPanel({ model, onClose });
    expect(model.busy.value).toBe(false);
    for (const label of ['Wyślij zapis', 'Pobierz zapis', 'Użyj kodu']) expect(button(tree, label).props.disabled).toBe(false);
    expect(labels(tree)).toContain('Pokaż kod');
    (button(tree, 'Pokaż kod').props.onClick as () => void)();
    expect(textOf(RecoveryPanel({ model, onClose }))).toContain('K7QX-9MBD-2HFA-P3WN-8RTE');
    // drugie podejście działa tak samo, a kolejny błąd zastępuje poprzedni zamiast się dopisywać
    await model.download();
    expect(model.error.value).toBe(failure.message);
    expect(deps.stageSave).not.toHaveBeenCalled();
    (walk(tree).find((v) => v.props?.['aria-label'] === 'Zamknij' && v.type === 'button')!.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('kod przyjęty przy wyłączonym rankingu: klucz się zmienia, a brak nicków z serwera nie wysypuje panelu', async () => {
    const { view, deps, model, client } = setup();
    (client.player as ReturnType<typeof vi.fn>).mockResolvedValueOnce(OFF);
    model.setInput('m2n3-p4q5-r6s7-t8v9-w0xy');
    await model.submitCode();
    await model.confirmPending();
    expect(deps.adoptKey).toHaveBeenCalledWith(OTHER);
    expect(model.nicks.value).toBeNull();
    expect(model.error.value).toBeNull();
    expect(labels(view()).some((l) => l.startsWith('Graj jako'))).toBe(false);
  });
});

import type { ComponentChild, VNode } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { RECOVERY_ERRORS } from '@/game/playerKey';
import type { ApiResult, RankingClient, SaveDownloaded } from './client';
import { MASKED_CODE, NO_KEY, NOTHING_TO_SEND, RecoveryPanel, SAME_CODE } from './RecoveryPanel';
import { createRecoveryModel, type RecoveryDeps } from './recoveryModel';

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

function setup(over: Partial<RecoveryDeps> = {}, download: ApiResult<SaveDownloaded> = { ok: true, save: '{"schema":2}', savedAt: Date.UTC(2026, 9, 27, 18, 30) }) {
  const state = { key: KEY as string | null };
  const client: RankingClient = {
    board: vi.fn(),
    player: vi.fn(async () => ({ ok: true as const, nicks: ['Mateusz', 'Kasjer Roku'] })),
    uploadSave: vi.fn(async (_k: string, save: string) => ({ ok: true as const, bytes: save.length, savedAt: 1 })),
    downloadSave: vi.fn(async () => download),
    submitRun: vi.fn(),
  };
  const deps: RecoveryDeps = {
    client,
    key: () => state.key,
    adoptKey: vi.fn((key: string) => { state.key = key; return null; }),
    useNick: vi.fn(),
    exportSave: vi.fn(() => '{"schema":2,"seed":"pierogi-731"}'),
    importSave: vi.fn(() => null),
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
    expect(client.uploadSave).toHaveBeenCalledWith(KEY, '{"schema":2,"seed":"pierogi-731"}');
    expect(model.notice.value).toMatch(/wysłany/i);
  });

  it('nie ma czego wysłać: komunikat, bez zapytania', async () => {
    const { model, client } = setup({ exportSave: () => null });
    await model.upload();
    expect(model.error.value).toBe(NOTHING_TO_SEND);
    expect(client.uploadSave).not.toHaveBeenCalled();
  });

  it('„Pobierz zapis” pyta przed zastąpieniem zapisu na tym urządzeniu (z datą wysłania), a dopiero „Zastąp zapis” go wczytuje', async () => {
    const { model, deps, view } = setup();
    await (button(view(), 'Pobierz zapis').props.onClick as () => Promise<void>)();
    expect(deps.importSave).not.toHaveBeenCalled();
    expect(textOf(view())).toMatch(/27\.10\.2026/);
    expect(textOf(view())).toMatch(/zastąpi/i);
    await (button(view(), 'Zastąp zapis').props.onClick as () => Promise<void>)();
    expect(deps.importSave).toHaveBeenCalledWith('{"schema":2}');
    expect(model.notice.value).toMatch(/pobrany/i);
  });

  it('błędy z serwera (np. brak zapisu pod kodem) i z wczytania wracają do gracza', async () => {
    const none = setup({}, { ok: false, error: 'no-save', message: 'Pod tym kodem nie ma zapisu w szufladzie Centrali.' });
    await none.model.download();
    expect(none.model.error.value).toBe('Pod tym kodem nie ma zapisu w szufladzie Centrali.');
    expect(none.model.confirm.value).toBeNull();
    const broken = setup({ importSave: vi.fn(() => 'Zapis jest uszkodzony') });
    await broken.model.download();
    await broken.model.confirmPending();
    expect(broken.model.error.value).toBe('Zapis jest uszkodzony');
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

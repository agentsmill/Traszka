import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from '@/game/cashier';
import { loadMeta, type Meta } from '@/game/meta';
import { MemoryStorage } from '@/game/memoryStorage';
import { lang } from '@/i18n';
import { SIM_VERSION } from '@/sim/simVersion';
import { buttonLabelled, click, labels, textOf, walk, type Vnode } from '../game/vnodeTree';
import { fameOffer, type FameOffer } from '../state';
import { FAME_TIMEOUT_MS, NETWORK_ERROR, UNAVAILABLE_ERROR, createRankingClient, type ApiResult, type FameSubmitted, type RankingClient } from './client';
import { FameWindow } from './FameWindow';
import { FAME_CLOSED_TEXT, createFameModel } from './fameModel';

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const OFFER: FameOffer = { seed: 'pierogi-731', day: 134, cash: 1_012_345 };
const sent = (over: Partial<FameSubmitted> = {}): ApiResult<FameSubmitted> => ({ ok: true, first: true, place: 3, entry: { nick: 'Mateusz', at: 1_000 }, ...over });
const failure = (error: string, message = 'komunikat serwera'): ApiResult<FameSubmitted> => ({ ok: false, error, message });

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  fameOffer.value = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fameOffer.value = null;
  lang.value = 'pl';
});

function setup(reply: ApiResult<FameSubmitted> | (() => Promise<ApiResult<FameSubmitted>>) = sent(), offer: FameOffer = OFFER) {
  const fameSubmit = vi.fn(async () => (typeof reply === 'function' ? reply() : reply));
  const client: RankingClient = {
    board: vi.fn(), player: vi.fn(), uploadSave: vi.fn(), downloadSave: vi.fn(), submitRun: vi.fn(), fameList: vi.fn(), fameSubmit,
  };
  const meta: Meta = { ...loadMeta(), player: { nick: 'Mateusz', look: DEFAULT_CASHIER_LOOK, specialOutfits: true, key: KEY } };
  const saveMeta = vi.fn();
  const model = createFameModel({ client, meta: () => meta, saveMeta });
  model.open();
  const onClose = vi.fn();
  const onOpenGallery = vi.fn();
  const view = (): Vnode => FameWindow({ model, offer, onClose, onOpenGallery }) as Vnode;
  return { model, meta, saveMeta, fameSubmit, onClose, onOpenGallery, view };
}

const liveRegion = (tree: Vnode): Vnode => {
  const found = walk(tree).filter((v) => v.props['aria-live'] !== undefined);
  expect(found).toHaveLength(1);
  return found[0]!;
};
const nickInput = (tree: Vnode): Vnode | undefined => walk(tree).find((v) => v.type === 'input');
const SEND = 'Wpisz mnie do Galerii sław';

describe('FameWindow: gratulacje i wysłanie wpisu', () => {
  it('pokazuje „Milion!”, zdanie Centrali, nick z mety w polu i przycisk „Wpisz mnie do Galerii sław”', () => {
    const { view } = setup();
    const tree = view();
    expect(textOf(tree)).toContain('Milion!');
    expect(textOf(tree)).toContain('Centrala jest w szoku, księgowa w euforii.');
    expect(nickInput(tree)!.props.value).toBe('Mateusz');
    expect(labels(tree)).toEqual([SEND, 'Zamknij']);
    expect(walk(tree).find((v) => v.props.role === 'dialog')?.props['aria-modal']).toBe('true');
  });

  it('sukces: wysyła { nick, seed, dzień, gotówka, SIM_VERSION } z kluczem gracza, pokazuje miejsce i zapisuje seed w meta.fameSent', async () => {
    const { view, model, fameSubmit, meta, saveMeta } = setup();
    click(buttonLabelled(view(), SEND));
    await vi.waitFor(() => expect(model.state.value).toBe('sent'));
    expect(fameSubmit).toHaveBeenCalledWith(KEY, { nick: 'Mateusz', seed: 'pierogi-731', day: 134, cash: 1_012_345, simVersion: SIM_VERSION });
    const tree = view();
    expect(textOf(liveRegion(tree))).toContain('Jesteś w Galerii sław Traszki (miejsce 3)');
    expect(meta.fameSent).toEqual(['pierogi-731']);
    expect(saveMeta).toHaveBeenCalledWith(meta);
    expect(labels(tree)).toEqual(['Zobacz Galerię', 'Zamknij']);
    expect(nickInput(tree)).toBeUndefined();
  });

  it('„Zobacz Galerię” i „Zamknij” wołają swoje funkcje', async () => {
    const { view, model, onClose, onOpenGallery } = setup();
    click(buttonLabelled(view(), SEND));
    await vi.waitFor(() => expect(model.state.value).toBe('sent'));
    click(buttonLabelled(view(), 'Zobacz Galerię'));
    click(buttonLabelled(view(), 'Zamknij'));
    expect(onOpenGallery).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('first: false: komunikat z miejscem (bez „jesteś w Galerii”), seed i nick w mecie bez zmian, pole i przycisk zostają; udany wpis pod innym nickiem oznacza seed i zapisuje nick', async () => {
    const { view, model, meta, saveMeta, fameSubmit } = setup(sent({ first: false, place: 2 }));
    click(buttonLabelled(view(), SEND));
    await vi.waitFor(() => expect(model.placed.value).not.toBeNull());
    expect(model.state.value).toBe('idle');
    const text = textOf(liveRegion(view()));
    expect(text).not.toContain('Jesteś w Galerii');
    expect(text).toContain('Ten nick już jest w Galerii sław Traszki (miejsce 2)');
    expect(text).toContain('Mógł go wpisać ktoś inny');
    expect(meta.fameSent).toBeUndefined();
    expect(meta.player?.nick).toBe('Mateusz');
    expect(saveMeta).not.toHaveBeenCalled();
    expect(labels(view())).toEqual([SEND, 'Zamknij']);   // wysyłka nadal dostępna, bez „Zobacz Galerię”
    expect(nickInput(view())).toBeDefined();
    expect(model.pending('pierogi-731', { day: 134, cash: 1_012_345 })).toBe(true);

    // gracz poprawia nick: stary komunikat znika, wpis pod innym nickiem przechodzi
    fameSubmit.mockResolvedValueOnce(sent({ first: true, place: 5 }));
    (nickInput(view())!.props.onInput as (e: unknown) => void)({ currentTarget: { value: 'Kasjer Roku' } });
    expect(textOf(liveRegion(view()))).not.toContain('Ten nick już jest');
    click(buttonLabelled(view(), SEND));
    await vi.waitFor(() => expect(model.state.value).toBe('sent'));
    expect(fameSubmit).toHaveBeenLastCalledWith(KEY, expect.objectContaining({ nick: 'Kasjer Roku' }));
    expect(textOf(liveRegion(view()))).toContain('Jesteś w Galerii sław Traszki (miejsce 5)');
    expect(meta.fameSent).toEqual(['pierogi-731']);
    expect(meta.player?.nick).toBe('Kasjer Roku');
    expect(meta.player?.key).toBe(KEY);
    expect(saveMeta).toHaveBeenCalledTimes(1);
  });

  it('miejsce poza pierwszą setką też jest pokazane', async () => {
    for (const first of [true, false]) {
      const { view, model } = setup(sent({ first, place: 140 }));
      click(buttonLabelled(view(), SEND));
      await vi.waitFor(() => expect(model.placed.value).not.toBeNull());
      expect(textOf(liveRegion(view()))).toContain('(miejsce 140)');
    }
  });

  it('nick-taken: komunikat o zajętym nicku, wpis nie jest oznaczony jako wysłany, przycisk zostaje, a po zmianie nicka wpis przechodzi i nick trafia do mety', async () => {
    const { view, model, meta, saveMeta, fameSubmit } = setup(failure('nick-taken', 'Ten nick jest zajęty'));
    click(buttonLabelled(view(), SEND));
    await vi.waitFor(() => expect(model.state.value).toBe('error'));
    expect(textOf(liveRegion(view()))).toContain('Ten nick jest zajęty');
    expect(meta.fameSent).toBeUndefined();
    expect(saveMeta).not.toHaveBeenCalled();
    expect(labels(view())).toContain(SEND);

    fameSubmit.mockResolvedValueOnce(sent({ place: 4 }));
    (nickInput(view())!.props.onInput as (e: unknown) => void)({ currentTarget: { value: 'Kasjer Roku' } });
    click(buttonLabelled(view(), SEND));
    await vi.waitFor(() => expect(model.state.value).toBe('sent'));
    expect(fameSubmit).toHaveBeenLastCalledWith(KEY, expect.objectContaining({ nick: 'Kasjer Roku' }));
    expect(meta.player?.nick).toBe('Kasjer Roku');
    expect(meta.player?.key).toBe(KEY);
    expect(meta.fameSent).toEqual(['pierogi-731']);
  });

  it('brak sieci, odpowiedź spoza API i wyłączony ranking: „Galeria jest teraz nieczynna. Wpis wyślesz później z panelu rankingu.”, nic nie zapisane', async () => {
    expect(FAME_CLOSED_TEXT).toBe('Galeria jest teraz nieczynna. Wpis wyślesz później z panelu rankingu.');
    for (const reply of [
      { ok: false as const, error: 'network', message: NETWORK_ERROR },
      { ok: false as const, error: 'unavailable', message: UNAVAILABLE_ERROR },
      failure('ranking-off'), failure('not-configured'), failure('server'),
    ]) {
      const { view, model, meta } = setup(reply);
      click(buttonLabelled(view(), SEND));
      await vi.waitFor(() => expect(model.state.value).toBe('error'));
      expect(textOf(liveRegion(view()))).toContain(FAME_CLOSED_TEXT);
      expect(meta.fameSent).toBeUndefined();
      expect(labels(view())).toContain(SEND);
    }
  });

  it('odmowa kontroli i limit (fame-invalid, fame-budget, rate-limited) pokazują komunikat serwera i nie oznaczają wpisu', async () => {
    for (const code of ['fame-invalid', 'fame-budget', 'rate-limited']) {
      const { view, model, meta } = setup(failure(code, 'Za dużo zgłoszeń naraz. Centrala prosi o cierpliwość (i o kawę).'));
      click(buttonLabelled(view(), SEND));
      await vi.waitFor(() => expect(model.state.value).toBe('error'));
      expect(textOf(liveRegion(view()))).toContain('Centrala prosi o cierpliwość');
      expect(meta.fameSent).toBeUndefined();
    }
  });

  it('goły { ok: true } (bez miejsca) to nie jest przyjęcie: wpis czeka', async () => {
    const { view, model, meta } = setup({ ok: true } as unknown as ApiResult<FameSubmitted>);
    click(buttonLabelled(view(), SEND));
    await vi.waitFor(() => expect(model.state.value).toBe('error'));
    expect(textOf(liveRegion(view()))).toContain(FAME_CLOSED_TEXT);
    expect(meta.fameSent).toBeUndefined();
  });

  it('w trakcie wysyłania przycisk i pole są wyłączone, a drugie kliknięcie nie wysyła drugi raz', async () => {
    let finishSend!: (r: ApiResult<FameSubmitted>) => void;
    const { view, model, fameSubmit } = setup(() => new Promise<ApiResult<FameSubmitted>>((resolve) => { finishSend = resolve; }));
    const sending = model.submit(OFFER);
    const tree = view();
    expect(model.state.value).toBe('sending');
    expect(buttonLabelled(tree, SEND).props.disabled).toBe(true);
    expect(nickInput(tree)!.props.disabled).toBe(true);
    expect(textOf(liveRegion(tree))).toContain('Wysyłamy wpis do Galerii');
    void model.submit(OFFER);
    finishSend(sent());
    await sending;
    expect(fameSubmit).toHaveBeenCalledTimes(1);
    expect(model.state.value).toBe('sent');
  });

  it('zły nick: komunikat z reguł nicka i brak żądania; brak klucza gracza: komunikat i brak żądania', async () => {
    const a = setup();
    a.model.setNick('Ala 🦎');
    click(buttonLabelled(a.view(), SEND));
    await Promise.resolve();
    expect(a.fameSubmit).not.toHaveBeenCalled();
    expect(textOf(liveRegion(a.view()))).toContain('Dozwolone są litery');

    const b = setup();
    delete b.meta.player!.key;
    click(buttonLabelled(b.view(), SEND));
    await Promise.resolve();
    expect(b.fameSubmit).not.toHaveBeenCalled();
    expect(textOf(liveRegion(b.view()))).toContain('Brak klucza gracza');
  });

  it('wpis spoza zakresów serwera jest przycięty przed wysyłką (dzień do 90…36 500, gotówka do 1e12), a seed, którego serwer nie pokaże, nie jedzie wcale', async () => {
    const low = setup(sent(), { seed: 'pierogi-731', day: 41.4, cash: 999_999.5 });
    await low.model.submit({ seed: 'pierogi-731', day: 41.4, cash: 999_999.5 });
    expect(low.fameSubmit).toHaveBeenCalledWith(KEY, expect.objectContaining({ day: 90, cash: 1_000_000 }));
    const high = setup();
    await high.model.submit({ seed: 'pierogi-731', day: 99_999, cash: 5e15 });
    expect(high.fameSubmit).toHaveBeenCalledWith(KEY, expect.objectContaining({ day: 36_500, cash: 1e12 }));

    for (const bad of [{ seed: '', day: 134, cash: 1e6 }, { seed: 'a​b', day: 134, cash: 1e6 }, { seed: 'x'.repeat(49), day: 134, cash: 1e6 }, { seed: 'ok', day: Number.NaN, cash: 1e6 }, { seed: 'ok', day: 134, cash: Number.POSITIVE_INFINITY }]) {
      const s = setup(sent(), bad);
      expect(s.model.pending(bad.seed, { day: bad.day, cash: bad.cash }), JSON.stringify(bad)).toBe(false);
      expect(labels(s.view()), JSON.stringify(bad)).toEqual(['Zamknij']);   // gratulacje bez wysyłki
      await s.model.submit(bad);
      expect(s.fameSubmit).not.toHaveBeenCalled();
    }
  });

  it('po angielsku okno ma angielskie napisy (miejsce, przyciski)', async () => {
    lang.value = 'en';
    const { view, model } = setup();
    expect(labels(view())).toEqual(['Put me in the Hall of Fame', 'Close']);
    click(buttonLabelled(view(), 'Put me in the Hall of Fame'));
    await vi.waitFor(() => expect(model.state.value).toBe('sent'));
    expect(textOf(liveRegion(view()))).toContain('(place 3)');
  });

  it('open() odświeża nick z mety i czyści poprzedni wynik', async () => {
    const { model, meta } = setup(sent({ first: false, place: 2 }));
    await model.submit(OFFER);
    expect(model.placed.value).not.toBeNull();
    model.setNick('Inny');
    meta.player!.nick = 'Nowy';
    model.open();
    expect(model.nick.value).toBe('Nowy');
    expect(model.state.value).toBe('idle');
    expect(model.placed.value).toBeNull();
    expect(model.message.value).toBeNull();
  });

  it('open() w trakcie wysyłania niczego nie rusza: stan „sending”, komunikat i nick zostają, a wynik i tak dochodzi', async () => {
    let finishSend!: (r: ApiResult<FameSubmitted>) => void;
    const { model, meta } = setup(() => new Promise<ApiResult<FameSubmitted>>((resolve) => { finishSend = resolve; }));
    const sending = model.submit(OFFER);
    meta.player!.nick = 'Nowy';
    model.open();
    expect(model.state.value).toBe('sending');
    expect(model.message.value).toBe('Wysyłamy wpis do Galerii…');
    expect(model.nick.value).toBe('Mateusz');
    finishSend(sent());
    await sending;
    expect(model.state.value).toBe('sent');
  });

  it('zawieszone połączenie: po limicie czasu stan błędu „Galeria nieczynna” (zamiast wiecznego „Wysyłamy…”), a ponowienie działa', async () => {
    vi.useFakeTimers();
    try {
      let hang = true;
      const fetchFn = vi.fn((_url: unknown, init?: RequestInit) => (hang
        ? new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); })
        : Promise.resolve(Response.json({ ok: true, first: true, place: 3, entry: { nick: 'Mateusz', at: 1 } })))) as unknown as typeof fetch;
      const meta: Meta = { ...loadMeta(), player: { nick: 'Mateusz', look: DEFAULT_CASHIER_LOOK, specialOutfits: true, key: KEY } };
      const model = createFameModel({ client: createRankingClient(fetchFn), meta: () => meta, saveMeta: vi.fn() });
      model.open();
      const sending = model.submit(OFFER);
      expect(model.state.value).toBe('sending');
      await vi.advanceTimersByTimeAsync(FAME_TIMEOUT_MS - 1);
      expect(model.state.value).toBe('sending');
      await vi.advanceTimersByTimeAsync(1);
      await sending;
      expect(model.state.value).toBe('error');
      expect(model.message.value).toBe(FAME_CLOSED_TEXT);
      expect(meta.fameSent).toBeUndefined();
      hang = false;
      await model.submit(OFFER);
      expect(model.state.value).toBe('sent');
      expect(meta.fameSent).toEqual(['pierogi-731']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pending: czy zakładka Galerii ma przycisk „Wyślij mój wpis”', () => {
  it('tak, gdy firma ma fame, a seed nie jest w fameSent; nie, gdy fame jest null albo seed już wysłany', () => {
    const { model, meta } = setup();
    expect(model.pending('pierogi-731', { day: 134, cash: 1_012_345 })).toBe(true);
    expect(model.pending('pierogi-731', null)).toBe(false);
    meta.fameSent = ['pierogi-731'];
    expect(model.pending('pierogi-731', { day: 134, cash: 1_012_345 })).toBe(false);
    expect(model.pending('bigos-111', { day: 134, cash: 1_012_345 })).toBe(true);
  });
});

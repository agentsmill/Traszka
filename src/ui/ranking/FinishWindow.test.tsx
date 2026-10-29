import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { clearFinished, loadFinished, pendingFinished, saveFinished, type FinishedRun } from '@/game/rankedRun';
import { newRunLog } from '@/game/session';
import { finish, isWindowOpen, ranked, type GameActions } from '../state';
import { zl } from '../game/format';
import { buttonLabelled, buttonsOf, click, labels, textOf, walk, type Vnode } from '../game/vnodeTree';
import type { ApiResult, RankingClient, RunAccepted } from './client';
import { FinishHost, FinishWindow } from './FinishWindow';
import { LATER_TEXT, NICK_TAKEN_TEXT, OLD_VERSION_TEXT, READY_TEXT, REJECTED_TEXT, createFinishModel } from './finishModel';

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const SEED = 'kielbasa-42';
const ACCEPTED: RunAccepted = { nick: 'Mateusz', score: 12_345, best: 12_345, improved: true, ranks: { global: 3, seed: 1, week: null } };
const accepted = (over: Partial<RunAccepted> = {}): ApiResult<RunAccepted> => ({ ok: true, ...ACCEPTED, ...over });
const failure = (error: string): ApiResult<RunAccepted> => ({ ok: false, error, message: 'komunikat serwera' });
const finishedRun = (): FinishedRun => ({ v: 1, seed: SEED, record: newRunLog(SEED, 'ranked').record, score: 12_345, finishedAt: 1_000 });

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  clearFinished();
  finish.value = null;
  ranked.value = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  finish.value = null;
  ranked.value = null;
});

function setup(reply: ApiResult<RunAccepted> | (() => Promise<ApiResult<RunAccepted>>) = accepted()) {
  const submitRun = vi.fn(async () => (typeof reply === 'function' ? reply() : reply));
  const client: RankingClient = { board: vi.fn(), player: vi.fn(), uploadSave: vi.fn(), downloadSave: vi.fn(), submitRun };
  const player = { key: KEY, nick: 'Mateusz' as string | null };
  saveFinished(finishedRun());
  const model = createFinishModel({
    client, finished: pendingFinished, clear: () => { clearFinished(); }, player: () => player, rememberNick: (nick) => { player.nick = nick; },
  });
  model.open();
  const onClose = vi.fn();
  const view = (): Vnode => FinishWindow({ model, onClose }) as Vnode;
  return { model, submitRun, onClose, view };
}

/** Węzeł z `aria-live`: region komunikatów okna. */
const liveRegion = (tree: Vnode): Vnode => {
  const found = walk(tree).filter((v) => v.props['aria-live'] !== undefined);
  expect(found).toHaveLength(1);
  return found[0]!;
};
const nickInput = (tree: Vnode): Vnode | undefined => walk(tree).find((v) => v.type === 'input');

describe('okno końca sezonu: gotowe do wysłania', () => {
  it('pokazuje wynik sezonu i seed, komunikat Centrali w regionie aria-live i przycisk „Wyślij do rankingu”', () => {
    const { view } = setup();
    const tree = view();
    expect(textOf(tree)).toContain(`Wynik sezonu: ${zl(12_345)}`);
    expect(textOf(tree)).toContain(SEED);
    expect(liveRegion(tree).props['aria-live']).toBe('polite');
    expect(textOf(liveRegion(tree))).toContain(READY_TEXT);
    expect(textOf(liveRegion(tree))).toContain('Sezon zamknięty');
    expect(labels(tree)).toEqual(['Wyślij do rankingu', 'Zamknij']);
    expect(walk(tree).find((v) => v.props.role === 'dialog')?.props['aria-modal']).toBe('true');
  });

  it('pole nicka ma nick gracza, zmiana idzie do modelu, wysłanie przyciskiem i Enterem wysyła bieg', async () => {
    const { view, model, submitRun } = setup();
    const input = nickInput(view())!;
    expect(input.props.value).toBe('Mateusz');
    (input.props.onInput as (e: unknown) => void)({ currentTarget: { value: 'Kasjer Roku' } });
    expect(model.nick.value).toBe('Kasjer Roku');

    click(buttonLabelled(view(), 'Wyślij do rankingu'));
    await vi.waitFor(() => expect(model.phase.value).toBe('accepted'));
    expect(submitRun).toHaveBeenCalledWith(KEY, 'Kasjer Roku', expect.anything());
  });

  it('Enter w formularzu wysyła bieg bez przeładowania strony', async () => {
    const { view, model, submitRun } = setup();
    const form = walk(view()).find((v) => v.type === 'form')!;
    const preventDefault = vi.fn();
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(model.phase.value).toBe('accepted'));
    expect(submitRun).toHaveBeenCalledTimes(1);
  });

  it('zły nick: komunikat z reguł nicka w regionie aria-live, bez żądania', async () => {
    const { view, model, submitRun } = setup();
    model.setNick('Ala 🦎');
    click(buttonLabelled(view(), 'Wyślij do rankingu'));
    await Promise.resolve();
    expect(submitRun).not.toHaveBeenCalled();
    expect(textOf(liveRegion(view()))).toContain('Dozwolone są litery');
  });

  it('w trakcie wysyłania przycisk jest wyłączony, pole nicka też, a komunikat mówi o wysyłaniu', async () => {
    let finishSend!: (r: ApiResult<RunAccepted>) => void;
    const { view, model } = setup(() => new Promise<ApiResult<RunAccepted>>((resolve) => { finishSend = resolve; }));
    const sending = model.send();
    const tree = view();
    expect(buttonLabelled(tree, 'Wyślij do rankingu').props.disabled).toBe(true);
    expect(nickInput(tree)!.props.disabled).toBe(true);
    expect(textOf(liveRegion(tree))).toContain('Wysyłamy raport do Centrali');
    finishSend(accepted());
    await sending;
    expect(model.phase.value).toBe('accepted');
  });
});

describe('okno końca sezonu: po odpowiedzi serwera', () => {
  it('przyjęty: „Raport przyjęty.”, miejsce w rankingu globalnym, seed, rekord życiowy; zostaje samo „Zamknij”, bez pola nicka', async () => {
    const { view, model, onClose } = setup(accepted({ ranks: { global: 3, seed: 2, week: 5 } }));
    await model.send();
    const tree = view();
    const live = textOf(liveRegion(tree));
    expect(live).toContain('Raport przyjęty.');
    expect(live).toContain('Miejsce w rankingu globalnym: 3');
    expect(live).toContain(`Miejsce na seedzie „${SEED}”: 2`);
    expect(live).toContain('Miejsce w rankingu tygodnia: 5');
    expect(live).toContain('Nowy rekord życiowy');
    expect(textOf(tree)).toContain(`Wynik sezonu: ${zl(12_345)}`);
    expect(labels(tree)).toEqual(['Zamknij']);
    expect(nickInput(tree)).toBeUndefined();
    click(buttonLabelled(tree, 'Zamknij'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadFinished()).toBeNull();
  });

  it('przyjęty bez rekordu i bez miejsca na seedzie i w tygodniu: tylko ranking globalny i dotychczasowy rekord', async () => {
    const { view, model } = setup(accepted({ improved: false, best: 20_000, ranks: { global: 7, seed: null, week: null } }));
    await model.send();
    const live = textOf(liveRegion(view()));
    expect(live).toContain('Miejsce w rankingu globalnym: 7');
    expect(live).not.toContain('seedzie');
    expect(live).not.toContain('tygodnia');
    expect(live).not.toContain('Nowy rekord życiowy');
    expect(live).toContain(zl(20_000));
  });

  it('zajęty nick: komunikat, pole nicka do poprawy i ponowne wysłanie; bieg zostaje u gracza', async () => {
    const { view, model } = setup(failure('nick-taken'));
    await model.send();
    const tree = view();
    expect(textOf(liveRegion(tree))).toContain(NICK_TAKEN_TEXT);
    expect(textOf(liveRegion(tree))).toMatch(/nick jest zajęty/i);
    expect(nickInput(tree)).toBeDefined();
    expect(labels(tree)).toEqual(['Wyślij do rankingu', 'Zamknij']);
    expect(loadFinished()).not.toBeNull();
  });

  it('stara wersja gry: „Odśwież stronę”, bieg zostaje w przeglądarce; wysyłanie znika, zostaje odrzucenie i zamknięcie', async () => {
    const { view, model } = setup(failure('old-version'));
    await model.send();
    const tree = view();
    expect(textOf(liveRegion(tree))).toContain(OLD_VERSION_TEXT);
    expect(textOf(liveRegion(tree))).toContain('Odśwież stronę');
    expect(textOf(liveRegion(tree))).toContain('niewysłany');
    expect(labels(tree)).toEqual(['Odrzuć bieg', 'Zamknij']);
    expect(loadFinished()).not.toBeNull();
  });

  it('spróbuj później: komunikat, „Spróbuj jeszcze raz” wysyła ponownie, „Zamknij” zostawia bieg w przeglądarce', async () => {
    const { view, model, onClose, submitRun } = setup(failure('ranking-off'));
    await model.send();
    let tree = view();
    expect(textOf(liveRegion(tree))).toContain(LATER_TEXT);
    expect(textOf(liveRegion(tree))).toContain('Spróbuj później');
    expect(labels(tree)).toEqual(['Spróbuj jeszcze raz', 'Zamknij']);

    click(buttonLabelled(tree, 'Spróbuj jeszcze raz'));
    await vi.waitFor(() => expect(submitRun).toHaveBeenCalledTimes(2));

    tree = view();
    click(buttonLabelled(tree, 'Zamknij'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadFinished()).not.toBeNull();   // zamknięcie niczego nie kasuje
  });

  it('odrzucony: „Odrzuć bieg” pyta o potwierdzenie we własnym oknie (bez window.confirm), „Wróć” wycofuje, „Tak, odrzuć” kasuje i zamyka', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const { view, model, onClose } = setup(failure('bad-log'));
    await model.send();
    let tree = view();
    expect(textOf(liveRegion(tree))).toContain(REJECTED_TEXT);
    expect(labels(tree)).toEqual(['Spróbuj jeszcze raz', 'Odrzuć bieg', 'Zamknij']);

    click(buttonLabelled(tree, 'Odrzuć bieg'));
    tree = view();
    expect(textOf(tree)).toMatch(/Odrzucić ten bieg/);
    expect(labels(tree)).toEqual(['Tak, odrzuć', 'Wróć']);
    expect(loadFinished()).not.toBeNull();   // nic się jeszcze nie skasowało

    click(buttonLabelled(tree, 'Wróć'));
    tree = view();
    expect(labels(tree)).toEqual(['Spróbuj jeszcze raz', 'Odrzuć bieg', 'Zamknij']);

    click(buttonLabelled(tree, 'Odrzuć bieg'));
    click(buttonLabelled(view(), 'Tak, odrzuć'));
    expect(loadFinished()).toBeNull();
    expect(pendingFinished()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('każdy przycisk jest typu button (Enter w polu nicka wysyła formularz, nie przyciski)', async () => {
    const { view, model } = setup(failure('bad-log'));
    expect(buttonsOf(view()).every((b) => b.props.type === 'button' || b.props.type === 'submit')).toBe(true);
    await model.send();
    expect(buttonsOf(view()).every((b) => b.props.type === 'button' || b.props.type === 'submit')).toBe(true);
  });
});

describe('okno końca sezonu: szuflada pusta', () => {
  it('bez biegu: komunikat, że nie ma czego wysłać, i samo „Zamknij”', () => {
    const { model, view } = setup();
    clearFinished();
    model.open();
    const tree = view();
    expect(textOf(tree)).toContain('Nie ma biegu do wysłania');
    expect(labels(tree)).toEqual(['Zamknij']);
    expect(nickInput(tree)).toBeUndefined();
  });
});

describe('FinishHost: okno w aplikacji', () => {
  const fakeGame = (): GameActions => ({ leaveRanked: vi.fn() } as unknown as GameActions);

  it('bez sygnału „finish” nic nie widać, z nim okno zatrzymuje grę (isWindowOpen)', () => {
    const { model } = setup();
    expect(FinishHost({ game: fakeGame(), model })).toBeNull();
    expect(isWindowOpen()).toBe(false);
    finish.value = { open: true };
    expect(isWindowOpen()).toBe(true);
    const host = FinishHost({ game: fakeGame(), model }) as Vnode;
    expect(host.type).toBe(FinishWindow);
    expect(host.props.model).toBe(model);
  });

  it('bez modelu (nakładka bez gry) nic nie widać', () => {
    finish.value = { open: true };
    expect(FinishHost({ game: fakeGame(), model: null })).toBeNull();
  });

  it('zamknięcie w fazie „over” biegu rankingowego wychodzi do zwykłej gry; bieg zostaje w szufladzie', async () => {
    const { model } = setup(failure('ranking-off'));
    ranked.value = { seed: SEED, day: 91, days: 91, phase: 'over' };
    finish.value = { open: true };
    const game = fakeGame();
    await model.send();
    const host = FinishHost({ game, model }) as Vnode;
    (host.props.onClose as () => void)();
    expect(finish.value).toBeNull();
    expect(game.leaveRanked).toHaveBeenCalledTimes(1);
    expect(loadFinished()).not.toBeNull();
  });

  it('zamknięcie po przyjęciu w fazie „over” też wychodzi do zwykłej gry', async () => {
    const { model } = setup(accepted());
    ranked.value = { seed: SEED, day: 91, days: 91, phase: 'over' };
    finish.value = { open: true };
    const game = fakeGame();
    await model.send();
    ((FinishHost({ game, model }) as Vnode).props.onClose as () => void)();
    expect(game.leaveRanked).toHaveBeenCalledTimes(1);
    expect(loadFinished()).toBeNull();
  });

  it('zamknięcie okna otwartego z panelu (bez biegu rankingowego albo w trakcie gry) tylko je zamyka', () => {
    const { model } = setup();
    for (const view of [null, { seed: SEED, day: 10, days: 91, phase: 'playing' as const }]) {
      ranked.value = view;
      finish.value = { open: true };
      const game = fakeGame();
      ((FinishHost({ game, model }) as Vnode).props.onClose as () => void)();
      expect(finish.value).toBeNull();
      expect(game.leaveRanked).not.toHaveBeenCalled();
    }
  });
});

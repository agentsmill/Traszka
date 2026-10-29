import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { clearFinished } from '@/game/rankedRun';
import type { StartChoice } from '@/game/start';
import { zl } from '../game/format';
import { buttonLabelled, buttonsOf, click, labels, textOf, walk, type Vnode } from '../game/vnodeTree';
import { confirmRankedStart, ranked, start, unsent, type StartRequest } from '../state';
import { RANKED_NOTE, RankedConfirm, StartHost, StartScreen } from './StartScreen';

// Ekran ma haki (`useState`, `useRef`…), a poza renderem Preacta ich nie ma jak wołać. Atrapa trzyma stan w „szufladach” po kolei
// wywołań (jak prawdziwe haki): kolejne wywołanie `StartScreen()` widzi to, co zostawiły poprzednie, więc test może kliknąć,
// poczekać na odpowiedź i obejrzeć drzewo jeszcze raz. Efekty (podgląd 3D, klawisz Escape, pomiar paska) w teście nie ruszają.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('preact/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('preact/hooks')>()),
  useState: <T,>(initial: T) => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    const set = (next: T | ((prev: T) => T)): void => {
      hooks.slots[i] = typeof next === 'function' ? (next as (prev: T) => T)(hooks.slots[i] as T) : next;
    };
    return [hooks.slots[i] as T, set];
  },
  useRef: <T,>(initial: T) => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
    return hooks.slots[i];
  },
  useMemo: <T,>(factory: () => T) => factory(),
  useEffect: () => {},
}));

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  hooks.slots = [];
  hooks.cursor = 0;
  clearFinished();
  confirmRankedStart.value = null;
  ranked.value = null;
  unsent.value = null;
  start.value = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  confirmRankedStart.value = null;
  ranked.value = null;
  unsent.value = null;
  start.value = null;
});

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(over: Partial<StartRequest> = {}) {
  const onStart = vi.fn<(choice: StartChoice, opts?: { replace?: boolean }) => void>();
  const request: StartRequest = {
    mode: 'new',
    form: { nick: 'Mateusz', seed: 'kielbasa-42', look: { outfit: 'men-suit', appearanceSeed: 'kasjer-a' }, specialOutfits: true },
    factory: new Promise(() => {}),
    onStart, onBack: vi.fn(),
    weekSeed: async () => 'babka-834',
    rankedBlock: () => null,
    ...over,
  };
  start.value = request;
  const view = (): Vnode => { hooks.cursor = 0; return withConfirm(StartScreen({ request }) as Vnode); };
  return { request, onStart, view };
}

/**
 * Pytanie o bieg (`RankedConfirm`) to komponent bez haków, a pomocnik drzewa nie woła komponentów z drzewa: dopisujemy jego wynik obok
 * drzewa ekranu, żeby jego przyciski i tekst były widać tak, jak widzi je gracz.
 */
function withConfirm(tree: Vnode): Vnode {
  const confirm = walk(tree).find((v) => v.type === RankedConfirm);
  if (!confirm) return tree;
  const expanded = (RankedConfirm as unknown as (props: unknown) => Vnode)(confirm.props);
  return { type: 'div', props: { children: [tree, expanded] } } as unknown as Vnode;
}

const byId = (tree: Vnode, id: string): Vnode => {
  const found = walk(tree).filter((v) => v.props.id === id);
  expect(found, id).toHaveLength(1);
  return found[0]!;
};
const submit = (tree: Vnode): void => {
  const form = walk(tree).find((v) => v.type === 'form')!;
  (form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => {} });
};
const typeInto = (input: Vnode, value: string): void => (input.props.onInput as (e: unknown) => void)({ currentTarget: { value } });
const disabled = (tree: Vnode, label: string): boolean => buttonLabelled(tree, label).props.disabled === true;

describe('ekran startowy: przyciski i seed tygodnia', () => {
  it('pod „Otwieramy sklep!” stoi „Start rankingowy” z podpisem, a obok kostki seeda chip „Seed tygodnia”', () => {
    const { view } = setup();
    const tree = view();
    const all = labels(tree);
    expect(all).toContain('Otwieramy sklep!');
    expect(all).toContain('Start rankingowy');
    expect(all).toContain('Seed tygodnia');
    expect(all.indexOf('Otwieramy sklep!')).toBeLessThan(all.indexOf('Start rankingowy'));
    expect(RANKED_NOTE).toBe('Trzy miesiące na jednym seedzie, bez premii z sieci. Wynik wyślesz po sezonie; gdy ranking nie działa, bieg poczeka w przeglądarce. Bankructwo przed końcem sezonu wyklucza z rankingu.');
    expect(textOf(tree)).toContain(RANKED_NOTE);
    const seedRow = walk(tree).find((v) => v.props.class === 'tt-seedrow')!;
    expect(labels(seedRow)).toEqual(['Seed tygodnia', '🎲']);
    expect(buttonLabelled(tree, 'Start rankingowy').props.type).toBe('button');
    expect(buttonLabelled(tree, 'Otwieramy sklep!').props.type).toBe('submit');
  });

  it('bez `weekSeed` w prośbie chipu nie ma (nikt nie umie zapytać serwera), reszta ekranu jest ta sama', () => {
    const { view } = setup({ weekSeed: undefined });
    const all = labels(view());
    expect(all).not.toContain('Seed tygodnia');
    expect(all).toContain('Start rankingowy');
  });

  it('chip czeka na Centralę (wyłączony, „Pytamy Centralę…”), a odpowiedź wpisuje seed tygodnia w pole', async () => {
    let answer!: (seed: string | null) => void;
    const { view } = setup({ weekSeed: () => new Promise((resolve) => { answer = resolve; }) });
    click(buttonLabelled(view(), 'Seed tygodnia'));
    const waiting = view();
    expect(disabled(waiting, 'Pytamy Centralę…')).toBe(true);
    expect(labels(waiting)).not.toContain('Seed tygodnia');
    expect(byId(waiting, 'tt-seed').props.value).toBe('kielbasa-42');   // do czasu odpowiedzi pole stoi
    answer('babka-834');
    await flush();
    const done = view();
    expect(byId(done, 'tt-seed').props.value).toBe('babka-834');
    expect(disabled(done, 'Seed tygodnia')).toBe(false);
    expect(textOf(done)).not.toContain('niedostępny');
  });

  it('serwer nie odpowiada: pod polem „Seed tygodnia jest teraz niedostępny”, pole nietknięte, chip znów do kliknięcia', async () => {
    const { view } = setup({ weekSeed: async () => null });
    click(buttonLabelled(view(), 'Seed tygodnia'));
    await flush();
    const tree = view();
    expect(textOf(tree)).toContain('Seed tygodnia jest teraz niedostępny');
    expect(byId(tree, 'tt-seed').props.value).toBe('kielbasa-42');
    expect(disabled(tree, 'Seed tygodnia')).toBe(false);
  });

  it('komunikat „niedostępny” znika, gdy gracz sam zmieni seed albo wylosuje inny', async () => {
    const { view } = setup({ weekSeed: async () => null });
    click(buttonLabelled(view(), 'Seed tygodnia'));
    await flush();
    typeInto(byId(view(), 'tt-seed'), 'moj-seed');
    expect(textOf(view())).not.toContain('niedostępny');

    click(buttonLabelled(view(), 'Seed tygodnia'));
    await flush();
    expect(textOf(view())).toContain('niedostępny');
    click(buttonLabelled(view(), '🎲'));
    expect(textOf(view())).not.toContain('niedostępny');
  });

  it('wpisany w trakcie czekania własny seed wygrywa ze spóźnioną odpowiedzią serwera', async () => {
    let answer!: (seed: string | null) => void;
    const { view } = setup({ weekSeed: () => new Promise((resolve) => { answer = resolve; }) });
    click(buttonLabelled(view(), 'Seed tygodnia'));
    typeInto(byId(view(), 'tt-seed'), 'moj-seed');
    answer('babka-834');
    await flush();
    const tree = view();
    expect(byId(tree, 'tt-seed').props.value).toBe('moj-seed');
    expect(disabled(tree, 'Seed tygodnia')).toBe(false);
  });
});

describe('ekran startowy: oba starty', () => {
  it('„Otwieramy sklep!” zamyka ekran i oddaje zwykły wybór (jak dotąd: jeden argument, ranked false)', async () => {
    const { view, onStart } = setup();
    submit(view());
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0]).toHaveLength(1);
    expect(onStart.mock.calls[0]![0]).toMatchObject({ nick: 'Mateusz', seed: 'kielbasa-42', ranked: false });
    expect(start.value).toBeNull();
  });

  it('„Start rankingowy” bez przeszkód: ekran się zamyka i wybór idzie z `ranked: true`, bez `replace`', async () => {
    const { view, onStart } = setup();
    click(buttonLabelled(view(), 'Start rankingowy'));
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0]).toHaveLength(1);
    expect(onStart.mock.calls[0]![0]).toMatchObject({ nick: 'Mateusz', seed: 'kielbasa-42', ranked: true, notice: null });
    expect(start.value).toBeNull();
    expect(confirmRankedStart.value).toBeNull();
  });

  it('w trakcie startu oba przyciski są wyłączone, a ten, który kliknięto, mówi „Otwieramy…” (zwykły i rankingowy)', async () => {
    const cases: [string, string, (tree: Vnode) => void][] = [
      ['Start rankingowy', 'Otwieramy sklep!', (tree) => click(buttonLabelled(tree, 'Start rankingowy'))],
      ['Otwieramy sklep!', 'Start rankingowy', submit],   // zwykły start to wysłanie formularza (przycisk „submit”)
    ];
    for (const [label, other, press] of cases) {
      hooks.slots = [];
      const { view, onStart } = setup();
      press(view());
      const tree = view();
      expect(disabled(tree, 'Otwieramy…'), label).toBe(true);
      expect(disabled(tree, other), label).toBe(true);
      expect(labels(tree).filter((l) => l === 'Otwieramy…'), label).toHaveLength(1);
      expect(onStart).not.toHaveBeenCalled();   // budowa świata czeka na namalowanie odpowiedzi
      await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    }
  });

  it('drugie kliknięcie w trakcie startu niczego nie uruchamia', async () => {
    const { view, onStart } = setup();
    click(buttonLabelled(view(), 'Start rankingowy'));
    click(buttonLabelled(view(), 'Otwieramy…'));
    submit(view());
    await vi.waitFor(() => expect(onStart).toHaveBeenCalled());
    await flush();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('zły nick blokuje oba starty: komunikat pod polem, `rankedBlock` nawet nie pytany, ekran stoi', () => {
    const rankedBlock = vi.fn(() => null);
    const { view, onStart } = setup({ form: { nick: '', seed: 'kielbasa-42', look: { outfit: 'men-suit', appearanceSeed: 'kasjer-a' }, specialOutfits: true }, rankedBlock });
    click(buttonLabelled(view(), 'Start rankingowy'));
    const error = walk(view()).find((v) => v.props.id === 'tt-nick-error')!;
    expect(textOf(error)).not.toBe('');
    submit(view());
    expect(rankedBlock).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(start.value).not.toBeNull();
  });
});

describe('ekran startowy: pytanie przed porzuceniem biegu', () => {
  it('niewysłany bieg: „Start rankingowy” pyta w ekranie z wynikiem, nic się nie zamyka i nie startuje', async () => {
    unsent.value = { seed: 'stary-bieg', score: 12_345 };
    const { view, onStart, request } = setup({ rankedBlock: () => 'unsent' });
    click(buttonLabelled(view(), 'Start rankingowy'));
    expect(confirmRankedStart.value).toEqual({ seed: 'kielbasa-42', reason: 'unsent' });

    const tree = view();
    expect(textOf(tree)).toContain(`Masz niewysłany bieg (wynik ${zl(12_345)}). Zacząć nowy i porzucić tamten?`);
    expect(labels(tree)).toEqual(expect.arrayContaining(['Porzuć i zacznij', 'Wróć']));
    expect(labels(tree)).not.toContain('Start rankingowy');   // odpowiedź pada na pytanie, nie obok niego
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    expect(start.value).toBe(request);
  });

  it('trwający bieg: pytanie z dniem N z 91', () => {
    ranked.value = { seed: 'kielbasa-42', day: 12, days: 91, phase: 'playing' };
    const { view } = setup({ rankedBlock: () => 'active' });
    click(buttonLabelled(view(), 'Start rankingowy'));
    expect(confirmRankedStart.value).toEqual({ seed: 'kielbasa-42', reason: 'active' });
    expect(textOf(view())).toContain('Masz rozpoczęty bieg rankingowy (dzień 12 z 91). Zacząć nowy i porzucić tamten?');
  });

  it('„Wróć” zdejmuje pytanie, przyciski wracają, ekran stoi i nic nie ruszyło', async () => {
    unsent.value = { seed: 'stary-bieg', score: 1 };
    const { view, onStart, request } = setup({ rankedBlock: () => 'unsent' });
    click(buttonLabelled(view(), 'Start rankingowy'));
    click(buttonLabelled(view(), 'Wróć'));
    expect(confirmRankedStart.value).toBeNull();
    const tree = view();
    expect(labels(tree)).toEqual(expect.arrayContaining(['Otwieramy sklep!', 'Start rankingowy']));
    expect(labels(tree)).not.toContain('Porzuć i zacznij');
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    expect(start.value).toBe(request);
  });

  it('„Porzuć i zacznij” zamyka ekran i oddaje ten sam wybór z `replace: true`', async () => {
    unsent.value = { seed: 'stary-bieg', score: 1 };
    const { view, onStart } = setup({ rankedBlock: () => 'unsent' });
    click(buttonLabelled(view(), 'Start rankingowy'));
    click(buttonLabelled(view(), 'Porzuć i zacznij'));
    expect(disabled(view(), 'Otwieramy…')).toBe(true);   // jak przy każdym starcie
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ nick: 'Mateusz', seed: 'kielbasa-42', ranked: true }), { replace: true });
    expect(start.value).toBeNull();
    expect(confirmRankedStart.value).toBeNull();
  });

  it('„Porzuć i zacznij” bierze pola z chwili kliknięcia: zmieniony seed idzie do biegu, a zły nick nadal blokuje', async () => {
    unsent.value = { seed: 'stary-bieg', score: 1 };
    const { view, onStart } = setup({ rankedBlock: () => 'unsent' });
    click(buttonLabelled(view(), 'Start rankingowy'));
    typeInto(byId(view(), 'tt-seed'), 'inny-seed');
    typeInto(byId(view(), 'tt-nick'), '');
    click(buttonLabelled(view(), 'Porzuć i zacznij'));
    await flush();
    expect(onStart).not.toHaveBeenCalled();
    expect(textOf(walk(view()).find((v) => v.props.id === 'tt-nick-error')!)).not.toBe('');
    typeInto(byId(view(), 'tt-nick'), 'Ola');
    click(buttonLabelled(view(), 'Porzuć i zacznij'));
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0]![0]).toMatchObject({ nick: 'Ola', seed: 'inny-seed', ranked: true });
  });

  it('pytanie ustawione z zewnątrz (start nie wyszedł mimo sprawdzenia) też pokazuje się w ekranie', () => {
    confirmRankedStart.value = { seed: 'kielbasa-42', reason: 'active' };
    const { view } = setup();
    const tree = view();
    expect(textOf(tree)).toContain('Masz rozpoczęty bieg rankingowy');
    expect(buttonsOf(tree).map((b) => textOf(b))).toEqual(expect.arrayContaining(['Porzuć i zacznij', 'Wróć']));
  });

  it('zwykły start przy otwartym pytaniu zamyka ekran i zdejmuje pytanie (nic nie zostaje w sygnale)', async () => {
    const { view, onStart } = setup({ rankedBlock: () => 'unsent' });
    confirmRankedStart.value = { seed: 'kielbasa-42', reason: 'unsent' };
    submit(view());
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0]![0]).toMatchObject({ ranked: false });
    expect(confirmRankedStart.value).toBeNull();
  });

  it('w trybie „first” pytanie działa tak samo (ekran jeszcze stoi, gry nie ma)', async () => {
    unsent.value = { seed: 'stary-bieg', score: 5 };
    const { view, onStart } = setup({ mode: 'first', onBack: undefined, rankedBlock: () => 'unsent' });
    expect(labels(view())).not.toContain('Wróć do gry');
    click(buttonLabelled(view(), 'Start rankingowy'));
    click(buttonLabelled(view(), 'Porzuć i zacznij'));
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0]![1]).toEqual({ replace: true });
  });
});

describe('StartHost: każda prośba o ekran to osobny egzemplarz ekranu', () => {
  // Preact nie ma tu DOM, więc oglądamy `key` zwróconego elementu: ten sam klucz między renderami to ten sam egzemplarz ekranu (z jego
  // stanem, wyrzutnią startu i podglądem 3D), nowy klucz to świeży. Ekran, który po zamknięciu wraca z nową prośbą (`openChosenStore`
  // odtwarza go, gdy stan biegu zmienił się po sprawdzeniu), nie może odziedziczyć „Otwieramy…” ani zwolnionego podglądu.
  const requestOf = (): StartRequest => setup().request;

  it('bez prośby nic nie rysuje', () => {
    start.value = null;
    expect(StartHost()).toBeNull();
  });

  it('ta sama prośba ma ten sam klucz przy każdym renderze, także po wizycie innej prośby', () => {
    const first = requestOf();
    start.value = first;
    const key = (StartHost() as Vnode).key;
    expect(key).toBeDefined();
    expect((StartHost() as Vnode).key).toBe(key);
    const second = requestOf();
    start.value = second;
    expect((StartHost() as Vnode).key).not.toBe(key);
    start.value = first;
    expect((StartHost() as Vnode).key).toBe(key);
  });

  it('dwie kolejne prośby (ekran zamknięty i odtworzony) dostają różne klucze: nowy egzemplarz zamiast ponownego użycia starego', () => {
    const closed = requestOf();
    start.value = closed;
    const before = (StartHost() as Vnode).key;
    start.value = null;   // `close()` zdejmuje ekran…
    const reopened: StartRequest = { ...closed };   // …a `openStartScreen` składa nową prośbę z tych samych pól
    start.value = reopened;
    const after = StartHost() as Vnode;
    expect(after.key).not.toBe(before);
    expect(after.props.request).toBe(reopened);
  });

  it('klucz nie zależy od zawartości prośby: dwie prośby o tych samych polach to dwa ekrany', () => {
    const a = requestOf();
    const b: StartRequest = { ...a };
    start.value = a;
    const keyA = (StartHost() as Vnode).key;
    start.value = b;
    expect((StartHost() as Vnode).key).not.toBe(keyA);
  });
});

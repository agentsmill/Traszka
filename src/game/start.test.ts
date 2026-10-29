import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from './cashier';
import { MemoryStorage } from './memoryStorage';
import { loadMeta, needsStartScreen, type Meta, type Player } from './meta';
import { NICK_ERRORS } from './nick';
import type { OpenRequest } from './openStore';
import { EXISTING_STORE_NOTICE, NEIGHBOUR_STORE_NOTICE, entrySeed } from './seeds';
import {
  BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, UNBUILDABLE_SAVE_NOTICE, createSession, lastSavedSeed, saveSession, type GameSession,
} from './session';
import {
  initialStartForm, noticeAfterOpen, openChosen, openRequestFor, playerOf, submitStart, type StartChoice, type StartForm, type StoreSwitch,
} from './start';

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

const PLAYER: Player = { nick: 'Mateusz', look: { outfit: 'special-men-king', appearanceSeed: 'kasjer-k' }, specialOutfits: false };
const form = (over: Partial<StartForm> = {}): StartForm => ({
  nick: 'Mateusz', seed: 'kielbasa-42', look: { outfit: 'men-suit', appearanceSeed: 'kasjer-a' }, specialOutfits: true, ...over,
});

describe('initialStartForm: co stoi w polach przy otwarciu ekranu', () => {
  it('pierwsze wejście (brak gracza): pusty nick, kasjer domyślny, przełącznik strojów specjalnych włączony, podany seed', () => {
    const meta: Meta = loadMeta();
    expect(initialStartForm(meta, 'pierogi-731')).toEqual({ nick: '', seed: 'pierogi-731', look: DEFAULT_CASHIER_LOOK, specialOutfits: true });
  });

  it('gracz z meta: jego nick, kasjer i przełącznik; seed zawsze z wywołania (nowy sklep, ?seed=, ostatni zapis)', () => {
    const meta: Meta = { ...loadMeta(), player: PLAYER };
    expect(initialStartForm(meta, 'nowy-1')).toEqual({ nick: 'Mateusz', seed: 'nowy-1', look: PLAYER.look, specialOutfits: false });
  });

  it('gracz z uszkodzonym nickiem w meta: ekran pyta o nick jeszcze raz (pole puste), ale kasjer i przełącznik są jego, nie domyślne', () => {
    storage.setItem('traszka:meta', JSON.stringify({
      version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true,
      player: { nick: 'Centrala', look: { outfit: 'special-women-witch', appearanceSeed: 'kasjer-w' }, specialOutfits: false },
    }));
    const meta = loadMeta();
    expect(needsStartScreen(meta)).toBe(true);
    expect(initialStartForm(meta, 'nowy-1')).toEqual({
      nick: '', seed: 'nowy-1', look: { outfit: 'special-women-witch', appearanceSeed: 'kasjer-w' }, specialOutfits: false,
    });
    const result = submitStart({ ...initialStartForm(meta, 'nowy-1'), nick: 'Ola' });
    if (!result.ok) throw new Error('oczekiwano wyboru');
    expect(playerOf(result.choice)).toEqual({ nick: 'Ola', look: { outfit: 'special-women-witch', appearanceSeed: 'kasjer-w' }, specialOutfits: false });
  });

  it('wygląd w formularzu to kopia: zmiana w ekranie nie rusza mety ani wspólnego wyglądu domyślnego', () => {
    const meta: Meta = { ...loadMeta(), player: PLAYER };
    const a = initialStartForm(meta, 's');
    expect(a.look).not.toBe(PLAYER.look);
    const b = initialStartForm(loadMeta(), 's');
    expect(b.look).not.toBe(DEFAULT_CASHIER_LOOK);
    expect(Object.isFrozen(b.look)).toBe(false);
  });
});

describe('submitStart: nick i seed w jednym kroku', () => {
  const never = () => ({ hasSave: vi.fn(() => false), build: vi.fn(), draw: vi.fn(() => 'losowy-1') });

  it('zły nick: komunikat pod polem, a seed i zapisy nie są nawet dotykane', () => {
    const deps = never();
    for (const [nick, error] of [
      ['', NICK_ERRORS.length], ['   ', NICK_ERRORS.length], ['a'.repeat(21), NICK_ERRORS.length],
      ['🍕', NICK_ERRORS.chars], ['Matеusz', NICK_ERRORS.chars], ['CENTRALA', NICK_ERRORS.reserved],
    ] as const) {
      expect(submitStart(form({ nick }), deps), nick).toEqual({ ok: false, nickError: error });
    }
    expect(deps.hasSave).not.toHaveBeenCalled();
    expect(deps.build).not.toHaveBeenCalled();
    expect(deps.draw).not.toHaveBeenCalled();
  });

  it('dobry nick i seed: wybór z nickiem po normalizacji, seedem po chooseStore, wyglądem i przełącznikiem bez zmian', () => {
    const result = submitStart(form({ nick: '  Ala   Ma  ', seed: '  Moja   Pizza ', specialOutfits: false }), never());
    expect(result).toEqual({
      ok: true,
      choice: { nick: 'Ala Ma', seed: 'moja pizza', look: { outfit: 'men-suit', appearanceSeed: 'kasjer-a' }, specialOutfits: false, notice: null, ranked: false },
    });
  });

  it('wybór z ekranu startowego nie jest jeszcze rankingowy: `ranked` zawsze false (start rankingowy ustawi je później)', () => {
    for (const seed of ['kielbasa-42', '', '🍕', 'bigos-1']) {
      const result = submitStart(form({ seed }), { ...never(), hasSave: (s: string) => s === 'kielbasa-42' });
      expect(result.ok && result.choice.ranked).toBe(false);
    }
  });

  it('wybór ma własną kopię wyglądu (dalsze zmiany formularza go nie ruszą)', () => {
    const f = form();
    const result = submitStart(f, never());
    if (!result.ok) throw new Error('oczekiwano wyboru');
    expect(result.choice.look).not.toBe(f.look);
    f.look.outfit = 'women-punk';
    expect(result.choice.look.outfit).toBe('men-suit');
  });

  it('seed z zapisem: wczytujemy ten sklep (komunikat), seed bez zapisu, którego generator nie składa: sąsiedni lokal (komunikat)', () => {
    const saved = { ...never(), hasSave: (s: string) => s === 'kielbasa-42' };
    const a = submitStart(form(), saved);
    expect(a.ok && a.choice).toMatchObject({ seed: 'kielbasa-42', notice: EXISTING_STORE_NOTICE });
    const broken = { ...never(), build: (s: string) => { if (s === 'bigos-1') throw new Error('brak układu'); } };
    const b = submitStart(form({ seed: 'bigos-1' }), broken);
    expect(b.ok && b.choice).toMatchObject({ seed: 'bigos-1·1', notice: NEIGHBOUR_STORE_NOTICE });
  });

  it('pusty seed to losowy wolny seed, z którego da się zagrać', () => {
    const result = submitStart(form({ seed: '   ' }));
    expect(result.ok && result.choice.seed).toMatch(/^[a-z]+-[1-9]\d{2}$/);
  });

  it('dziwne seedy (spacje, emoji, 200 znaków, sterujące) zawsze dają sklep, który się otwiera: bez wyjątku i bez pętli', () => {
    const weird = ['', ' ', '🍕', '🍕'.repeat(200), 'x'.repeat(200), '\u0000\u0001\u0002', 'A  B\tC\nD', '·', '😀 ' + 'ż'.repeat(100), 'seed:a:b'];
    for (const seed of weird) {
      const result = submitStart(form({ seed }));
      if (!result.ok) throw new Error(`seed ${JSON.stringify(seed)} zablokował start`);
      const session = createSession(result.choice.seed, false, undefined);   // tak otwiera sklep gra
      expect(session.seed).toBe(result.choice.seed);
      expect(session.econ.minute).toBeGreaterThan(0);
    }
  });
});

describe('playerOf i openRequestFor', () => {
  const choice: StartChoice = { nick: 'Ala', seed: 'nowy-7', look: { outfit: 'women-suit', appearanceSeed: 'kasjer-z' }, specialOutfits: true, notice: null, ranked: false };

  it('playerOf: gracz do mety z wyboru (nick, wygląd, przełącznik; bez seeda i komunikatu), z własną kopią wyglądu', () => {
    const player = playerOf(choice);
    expect(player).toEqual({ nick: 'Ala', look: { outfit: 'women-suit', appearanceSeed: 'kasjer-z' }, specialOutfits: true });
    expect(player.look).not.toBe(choice.look);
  });

  it('openRequestFor: sklep z ekranu startowego otwiera się z wybranego seeda i nigdy jako nowa gra (nie nadpisze zapisu)', () => {
    const rest: Omit<OpenRequest, 'seed' | 'fresh'> = { partner: { points: 2, networkIncome: 300, stores: 1 }, randomSeed: () => 'x-100', build: () => {} };
    const request = openRequestFor(choice, rest);
    expect(request).toEqual({ ...rest, seed: 'nowy-7', fresh: false });
    expect(openRequestFor({ ...choice, seed: 'inny-1' }, rest).fresh).toBe(false);
  });

  it('wybrany seed z zapisem otwiera się z zapisu: ten sam postęp po pełnej drodze „ekran → seed → sesja”', () => {
    const played = createSession('kielbasa-42', true);
    played.econ.cash = 777_777;
    saveSession(played);
    const result = submitStart(form({ seed: 'KIELBASA-42' }));
    if (!result.ok) throw new Error('oczekiwano wyboru');
    const opened = createSession(openRequestFor(result.choice, { randomSeed: () => 'x', build: () => {} }).seed, false);
    expect(opened.fromSave).toBe(true);
    expect(opened.econ.cash).toBe(777_777);
  });
});

describe('wejście na stronę (to samo złożenie, które robi main.ts): kto widzi ekran startowy i z jakim seedem', () => {
  const v1 = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const META_KEY = 'traszka:meta';
  /** Co wchodzi w pola ekranu przy wejściu na stronę z danym adresem (`?seed=`) i zapisami w przeglądarce. */
  const entry = (urlSeed: string | null) => {
    const meta = loadMeta();
    return { show: needsStartScreen(meta), form: initialStartForm(meta, entrySeed(urlSeed, lastSavedSeed())) };
  };

  it('pierwsze wejście bez zapisu i bez meta: ekran startowy, losowy seed, kasjer domyślny, pusty nick', () => {
    const { show, form } = entry(null);
    expect(show).toBe(true);
    expect(form).toMatchObject({ nick: '', look: DEFAULT_CASHIER_LOOK, specialOutfits: true });
    expect(form.seed).toMatch(/^[a-z]+-[1-9]\d{2}$/);
  });

  it('R53: stary gracz (zapisy z poprzedniej wersji, brak gracza w meta) dostaje ekran startowy z seedem ostatniego zapisu, a „Otwieramy sklep!” kontynuuje jego grę', () => {
    storage.setItem('traszka:save:kiełbasa-42', v1('save-v1-blok-dzien40.json'));   // zapis v1: bez koperty, bez wyglądu kasjera i nicka
    storage.setItem('traszka:last', 'kiełbasa-42');
    storage.setItem(META_KEY, JSON.stringify({ version: 1, partnerPoints: 3, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true }));
    const { show, form } = entry(null);
    expect(show).toBe(true);
    expect(form.seed).toBe('kiełbasa-42');
    expect(form.look).toEqual(DEFAULT_CASHIER_LOOK);
    const result = submitStart({ ...form, nick: 'Stary Gracz' });
    if (!result.ok) throw new Error('oczekiwano wyboru');
    expect(result.choice).toMatchObject({ seed: 'kiełbasa-42', notice: EXISTING_STORE_NOTICE });
    const opened = createSession(openRequestFor(result.choice, { randomSeed: () => 'x-100', build: () => {} }).seed, false);
    expect(opened.fromSave).toBe(true);
    expect(opened.ephemeral).toBe(false);
    expect(opened.econ.level).toBe(15);
    expect(Math.round(opened.econ.cash)).toBe(17_671);
    expect(playerOf(result.choice).look).toEqual(DEFAULT_CASHIER_LOOK);   // wygląd domyślny trafia do meta, gra stawia domyślnego kasjera
  });

  it('?seed= w adresie wypełnia pole seeda i wygrywa z ostatnim zapisem; pusty ?seed= nie liczy się', () => {
    storage.setItem('traszka:last', 'ostatni-sklep-1');
    expect(entry('z-adresu-7').form.seed).toBe('z-adresu-7');
    expect(entry('').form.seed).toBe('ostatni-sklep-1');
    expect(entry(null).form.seed).toBe('ostatni-sklep-1');
  });

  it('?seed= z dziwnym tekstem wypełnia pole dosłownie, a sklep powstaje z seeda znormalizowanego (200 znaków, spacje, emoji)', () => {
    for (const urlSeed of ['x'.repeat(200), '   ', '  Moja   PIZZA 🍕 ', '🍕'.repeat(120)]) {
      const { form } = entry(urlSeed);
      expect(form.seed).toBe(urlSeed);
      const result = submitStart({ ...form, nick: 'Ala' });
      if (!result.ok) throw new Error('oczekiwano wyboru');
      expect(Array.from(result.choice.seed).length).toBeLessThanOrEqual(42);
      expect(() => createSession(result.choice.seed, false)).not.toThrow();
    }
  });

  it('gracz w meta: bez ekranu startowego; meta z nowszej wersji gry: też bez; sklep otwiera się wtedy z adresu albo ostatniego zapisu', () => {
    storage.setItem(META_KEY, JSON.stringify({ version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true, player: PLAYER }));
    expect(entry(null).show).toBe(false);
    expect(loadMeta().player).toEqual(PLAYER);
    storage.setItem(META_KEY, JSON.stringify({ version: 2, player: { przyszlosc: true } }));
    expect(entry(null).show).toBe(false);
  });
});

// --- „Nowy sklep” i „Otwórz” z ⚙ oraz komunikat po otwarciu sklepu -----------------------------------------------------

describe('openChosen: ⚙ „Nowy sklep” i „Otwórz” (to samo przejście, które robi main.ts po wyborze sklepu)', () => {
  const key = (seed: string): string => `traszka:save:${seed}`;
  /** Przejście na sklep w atrapie gry: prawdziwe `createSession` na prawdziwym (pamięciowym) zapisie, z zapisem argumentów, które dostało. */
  function game() {
    const calls: { seed: string; fresh: boolean }[] = [];
    const toasts: string[] = [];
    let session: GameSession | null = null;
    const host: StoreSwitch = {
      setSeed: (seed, fresh) => {
        calls.push({ seed, fresh });
        session = createSession(seed, fresh);      // tak robi setSeed w main.ts: createSession(next, fresh, …), potem budowa świata
        return true;
      },
      session: () => session,
      toast: (text) => { toasts.push(text); },
    };
    return { host, calls, toasts, session: (): GameSession => session! };
  }
  const choose = (seed: string): StartChoice => {
    const result = submitStart(form({ seed }));
    if (!result.ok) throw new Error('nick jest poprawny');
    return result.choice;
  };

  it('sklep z zapisem otwiera się z zapisu, bez `fresh`: ten sam postęp, komunikat „Wczytujemy…”, a następny zapis go nie kasuje', () => {
    const played = createSession('kielbasa-42', true);
    played.econ.cash = 123_456;
    saveSession(played);
    const { host, calls, toasts, session } = game();
    expect(openChosen(choose('  Kielbasa-42 '), host)).toBe(true);
    expect(calls).toEqual([{ seed: 'kielbasa-42', fresh: false }]);
    expect(session().fromSave).toBe(true);
    expect(session().econ.cash).toBe(123_456);
    expect(toasts).toEqual([EXISTING_STORE_NOTICE]);
    saveSession(session());
    expect(createSession('kielbasa-42', false).econ.cash).toBe(123_456);
  });

  it('żaden wybór nie otwiera sklepu jako nowej gry (`fresh: false` zawsze): z zapisem, bez zapisu, sąsiedni lokal, dziwny tekst', () => {
    saveSession(createSession('kielbasa-42', true));
    const { host, calls } = game();
    for (const seed of ['kielbasa-42', 'Nowy Sklep', '', '🍕', 'x'.repeat(200)]) openChosen(choose(seed), host);
    openChosen({ seed: 'bigos-1·1', notice: NEIGHBOUR_STORE_NOTICE }, host);
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.fresh === false)).toBe(true);
  });

  it('zapis z nowszej wersji gry: sklep tymczasowy, zapis bajt w bajt, a „Wczytujemy…” nie pada obok komunikatu o nowszej wersji', () => {
    const newer = JSON.stringify({ schema: 9, seed: 'nowy-9', econ: { przyszłość: true } });
    storage.setItem(key('nowy-9'), newer);
    const { host, toasts, session } = game();
    openChosen(choose('Nowy-9'), host);
    expect(session().ephemeral).toBe(true);
    expect(session().loadNotice).toBe(NEWER_SAVE_NOTICE);
    saveSession(session());
    expect(storage.getItem(key('nowy-9'))).toBe(newer);
    expect(toasts).toEqual([]);
  });

  it('uszkodzony zapis: idzie do kopii, sklep zaczyna od nowa z komunikatem o uszkodzeniu, a „Wczytujemy…” nie pada obok niego', () => {
    storage.setItem(key('zepsuty-1'), '{"ucięty');
    const { host, toasts, session } = game();
    openChosen(choose('zepsuty-1'), host);
    expect(session().fromSave).toBe(false);
    expect(session().loadNotice).toBe(BROKEN_SAVE_NOTICE);
    expect(storage.getItem(`${key('zepsuty-1')}:broken`)).toBe('{"ucięty');
    expect(toasts).toEqual([]);
  });

  it('seed bez zapisu: nowa gra bez komunikatu; sąsiedni lokal: komunikat o sąsiednim lokalu (jest prawdziwy)', () => {
    const { host, toasts, session } = game();
    openChosen(choose('Mój sklep'), host);
    expect(session().seed).toBe('mój sklep');
    expect(session().fromSave).toBe(false);
    expect(toasts).toEqual([]);
    openChosen({ seed: 'bigos-1·1', notice: NEIGHBOUR_STORE_NOTICE }, host);
    expect(toasts).toEqual([NEIGHBOUR_STORE_NOTICE]);
  });

  it('sklep, który się nie otworzył (setSeed zwraca false): nie ma komunikatu i openChosen mówi, że się nie udało', () => {
    const toasts: string[] = [];
    const host: StoreSwitch = { setSeed: () => false, session: () => createSession('stary-1', true), toast: (t) => { toasts.push(t); } };
    expect(openChosen({ seed: 'kielbasa-42', notice: EXISTING_STORE_NOTICE }, host)).toBe(false);
    expect(toasts).toEqual([]);
  });
});

describe('noticeAfterOpen: komunikat z wyboru sklepu pada tylko wtedy, gdy po otwarciu nadal jest prawdziwy', () => {
  /** Sesja w tym stanie, w jakim zostawia ją `createSession`/`openStore` (tylko pola, które liczy komunikat). */
  const opened = (over: Partial<Pick<GameSession, 'seed' | 'fromSave' | 'ephemeral' | 'loadNotice'>> = {}) =>
    ({ seed: 'kielbasa-42', fromSave: true, ephemeral: false, loadNotice: null, ...over });
  const existing = { seed: 'kielbasa-42', notice: EXISTING_STORE_NOTICE };
  const neighbour = { seed: 'bigos-1·1', notice: NEIGHBOUR_STORE_NOTICE };

  it('zapis wczytał się normalnie: „Wczytujemy Twój sklep spod tego seeda”', () => {
    expect(noticeAfterOpen(existing, opened())).toBe(EXISTING_STORE_NOTICE);
  });

  it('nigdy razem z komunikatem o uszkodzonym zapisie, zapisie z nowszej wersji gry ani o sklepie, którego nie dało się zbudować', () => {
    expect(noticeAfterOpen(existing, opened({ fromSave: false, loadNotice: BROKEN_SAVE_NOTICE }))).toBeNull();
    expect(noticeAfterOpen(existing, opened({ fromSave: false, ephemeral: true, loadNotice: NEWER_SAVE_NOTICE }))).toBeNull();
    expect(noticeAfterOpen(existing, opened({ fromSave: false, ephemeral: true, loadNotice: UNBUILDABLE_SAVE_NOTICE }))).toBeNull();
  });

  it('nie pada też wtedy, gdy otwarł się inny sklep niż wybrany (zastępczy) albo zapis się nie wczytał (nowa gra pod seedem z zapisem)', () => {
    expect(noticeAfterOpen(existing, opened({ seed: 'losowy-1', fromSave: false, ephemeral: true }))).toBeNull();
    expect(noticeAfterOpen(existing, opened({ fromSave: false }))).toBeNull();
    expect(noticeAfterOpen(existing, opened({ ephemeral: true }))).toBeNull();
    expect(noticeAfterOpen(existing, opened({ loadNotice: 'inny komunikat o zapisie' }))).toBeNull();   // każdy komunikat o zapisie wyklucza „Wczytujemy…”
  });

  it('komunikat o sąsiednim lokalu jest prawdziwy, dopóki otworzył się właśnie ten sąsiedni lokal; także obok komunikatu o zapisie', () => {
    expect(noticeAfterOpen(neighbour, opened({ seed: 'bigos-1·1', fromSave: false }))).toBe(NEIGHBOUR_STORE_NOTICE);
    expect(noticeAfterOpen(neighbour, opened({ seed: 'bigos-1·1', fromSave: false, loadNotice: BROKEN_SAVE_NOTICE }))).toBe(NEIGHBOUR_STORE_NOTICE);
    expect(noticeAfterOpen(neighbour, opened({ seed: 'losowy-1', fromSave: false, ephemeral: true }))).toBeNull();   // zastępczy sklep: nie „sąsiedni”
  });

  it('bez komunikatu w wyborze albo bez sesji: nic', () => {
    expect(noticeAfterOpen({ seed: 'x', notice: null }, opened({ seed: 'x' }))).toBeNull();
    expect(noticeAfterOpen(existing, null)).toBeNull();
  });
});

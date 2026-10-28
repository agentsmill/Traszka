import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from './cashier';
import { MemoryStorage } from './memoryStorage';
import { loadMeta, needsStartScreen, type Meta, type Player } from './meta';
import { NICK_ERRORS } from './nick';
import type { OpenRequest } from './openStore';
import { EXISTING_STORE_NOTICE, NEIGHBOUR_STORE_NOTICE, entrySeed } from './seeds';
import { createSession, lastSavedSeed, saveSession } from './session';
import { initialStartForm, openRequestFor, playerOf, submitStart, type StartChoice, type StartForm } from './start';

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
      choice: { nick: 'Ala Ma', seed: 'moja pizza', look: { outfit: 'men-suit', appearanceSeed: 'kasjer-a' }, specialOutfits: false, notice: null },
    });
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
  const choice: StartChoice = { nick: 'Ala', seed: 'nowy-7', look: { outfit: 'women-suit', appearanceSeed: 'kasjer-z' }, specialOutfits: true, notice: null };

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

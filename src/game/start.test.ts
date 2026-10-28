import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from './cashier';
import { MemoryStorage } from './memoryStorage';
import { loadMeta, type Meta, type Player } from './meta';
import { NICK_ERRORS } from './nick';
import type { OpenRequest } from './openStore';
import { EXISTING_STORE_NOTICE, NEIGHBOUR_STORE_NOTICE } from './seeds';
import { createSession, saveSession } from './session';
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from '@/game/cashier';
import { MemoryStorage } from '@/game/memoryStorage';
import { loadMeta, saveMeta, type Meta } from '@/game/meta';
import { NEWER_SAVE_NOTICE, createSession, hasStoredSave, lastSavedSeed, saveSession } from '@/game/session';
import { bootImport } from '@/game/boot';
import { getPlayMode, setPlayMode } from '@/game/rankedRun';
import { entrySeed } from '@/game/seeds';
import { SAVE_BUNDLE_FORMAT, SAVE_BUNDLE_VERSION, SAVE_MAX_BYTES } from '@/server/config';
import { checkSave } from '@/server/saves';
import {
  IMPORT_KEY, SAVE_SYNC_KEY, TRANSFER_ERRORS, TRANSFER_FORMAT, applyStagedImport, exportTransfer, importTransfer, readSaveSync, stageImport,
  writeSaveSync, type TransferBundle,
} from './saveTransfer';

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

const KEY_A = 'K7QX9MBD2HFAP3WN8RTE';
const KEY_B = 'M2N3P4Q5R6S7T8V9W0XY';
const meta = (over: Partial<Meta> = {}): Meta => ({
  version: 1, partnerPoints: 7, network: [{ seed: 'stary-sklep', income: 400, level: 21, margin: 90_000 }],
  daily: { date: '2026-10-27', streak: 4 }, lastSeen: 1, sound: false, vibration: true,
  player: { nick: 'Mateusz', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: false, key: KEY_A }, ...over,
});

/** Urządzenie A: gracz z siecią sklepów i sklepem, w który gra (ostatni zapisany). */
function deviceA(seed = 'pierogi-731') {
  saveMeta(meta());
  const s = createSession(seed, true);
  s.econ.cash = 123_456;
  s.econ.minute += 3 * 1440;
  saveSession(s);
  return s;
}
const { key: _key, ...playerWithoutKey } = meta().player!;
/** Przejście na drugie urządzenie: czysta przeglądarka, w której gracz wpisał już kod (ma ten sam klucz, ale jeszcze nic poza nim). */
const switchDevice = (): void => {
  storage.clear();
  saveMeta({ ...loadMeta(), player: { nick: null, look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true, key: KEY_A } });
};

describe('przeniesienie zapisu: wszystko, czego gra potrzebuje do wczytania', () => {
  it('paczka ma metę (gracz, sieć sklepów, Punkty Partnera, seria dni, ustawienia), zapis bieżącego sklepu i to, który sklep otworzyć', () => {
    const s = deviceA();
    const bundle = JSON.parse(exportTransfer()!) as Record<string, unknown>;
    expect(bundle).toMatchObject({ format: 'traszka-przeniesienie', version: 1, seed: 'pierogi-731', meta: { ...meta(), player: playerWithoutKey } });
    expect((bundle.save as { econ: { cash: number } }).econ.cash).toBe(s.econ.cash);
  });

  it('klucza gracza w paczce nie ma (paczka leży na serwerze, a serwer kluczy nie przechowuje)', () => {
    deviceA();
    const text = exportTransfer()!;
    expect(text).not.toContain(KEY_A);
    expect((JSON.parse(text) as { meta: Meta }).meta.player).toEqual(playerWithoutKey);
  });

  it('paczka po pełnym sezonie mieści się w szufladzie Centrali (64 KB)', () => {
    deviceA();
    expect(new TextEncoder().encode(exportTransfer()!).length).toBeLessThan(SAVE_MAX_BYTES / 2);
  });

  it('serwer przyjmuje paczkę, którą składa gra: format i wersja w config.ts serwera to te same co w grze', () => {
    deviceA();
    const text = exportTransfer()!;
    expect(SAVE_BUNDLE_FORMAT).toBe(TRANSFER_FORMAT);
    const gameVersion: TransferBundle['version'] = SAVE_BUNDLE_VERSION;   // przestaje się kompilować, gdy gra podbije wersję paczki
    expect((JSON.parse(text) as TransferBundle).version).toBe(gameVersion);
    expect(checkSave(text)).toEqual({ ok: true, value: text });
  });

  it('nic do wysłania: bez sklepu albo z metą z nowszej wersji gry (jej tu nie znamy) paczki nie ma', () => {
    expect(exportTransfer()).toBeNull();
    saveMeta(meta());
    expect(exportTransfer()).toBeNull();
    deviceA();
    storage.setItem('traszka:meta', JSON.stringify({ ...meta(), version: 2 }));
    expect(exportTransfer()).toBeNull();
  });

  it('wczytanie na drugim urządzeniu: gra otwiera ten sam sklep z tym samym stanem, a meta wraca cała', () => {
    const s = deviceA();
    const text = exportTransfer()!;
    switchDevice();
    expect(importTransfer(text)).toEqual({ seed: 'pierogi-731' });
    expect(lastSavedSeed()).toBe('pierogi-731');
    expect(hasStoredSave('pierogi-731')).toBe(true);
    const loaded = createSession('pierogi-731');
    expect(loaded.fromSave).toBe(true);
    expect(loaded.econ.cash).toBe(s.econ.cash);
    expect(loaded.econ.minute).toBe(s.econ.minute);
    expect(loadMeta()).toEqual(meta());
  });

  it('klucz tego urządzenia wygrywa (to nim pobrano paczkę), a inne sklepy na tym urządzeniu zostają nietknięte', () => {
    const text = (deviceA(), exportTransfer()!);
    switchDevice();
    saveMeta(meta({ player: { nick: 'Kasia', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true, key: KEY_B }, partnerPoints: 0 }));
    const other = createSession('inny-sklep', true);
    saveSession(other);
    expect(importTransfer(text)).toEqual({ seed: 'pierogi-731' });
    expect(loadMeta().player).toEqual({ ...meta().player, key: KEY_B });
    expect(loadMeta().partnerPoints).toBe(7);
    expect(hasStoredSave('inny-sklep')).toBe(true);
  });

  it('nie paczka, uszkodzona paczka: komunikat i nic nie zmienione', () => {
    saveMeta(meta({ partnerPoints: 1 }));
    for (const text of ['nie json', '{}', JSON.stringify({ format: 'traszka-przeniesienie', version: 1, seed: 5, meta: {}, save: {} }),
      JSON.stringify({ format: 'traszka-przeniesienie', version: 1, seed: 'x', meta: {}, save: 'zapis' })]) {
      expect(importTransfer(text), text).toEqual({ error: TRANSFER_ERRORS.invalid });
    }
    expect(loadMeta().partnerPoints).toBe(1);
    expect(storage.keys()).toEqual(['traszka:meta']);
  });

  it('paczka z nowszej wersji gry (zapis albo meta) i meta tego urządzenia z nowszej wersji: nic nie nadpisujemy', () => {
    deviceA();
    const bundle = JSON.parse(exportTransfer()!) as Record<string, Record<string, unknown>>;
    switchDevice();
    const newerSave = { ...bundle, save: { ...bundle.save, schema: 99 } };
    const newerMeta = { ...bundle, meta: { ...bundle.meta, version: 2 } };
    expect(importTransfer(JSON.stringify(newerSave))).toEqual({ error: NEWER_SAVE_NOTICE });
    expect(importTransfer(JSON.stringify(newerMeta))).toEqual({ error: NEWER_SAVE_NOTICE });
    expect(storage.keys()).toEqual(['traszka:meta']);   // tylko meta z kluczem z kodu, sprzed importu
    expect(loadMeta().player?.nick).toBeNull();
    storage.setItem('traszka:meta', JSON.stringify({ ...meta(), version: 2 }));
    expect(importTransfer(JSON.stringify(bundle))).toEqual({ error: NEWER_SAVE_NOTICE });
    expect(hasStoredSave('pierogi-731')).toBe(false);
  });

  it('brak miejsca w przeglądarce: komunikat zamiast cichej porażki', () => {
    const text = (deviceA(), exportTransfer()!);
    switchDevice();
    storage.failWrites = true;
    expect(importTransfer(text)).toEqual({ error: TRANSFER_ERRORS.storage });
  });
});

describe('import przez klucz pośredni: odporny na zapis przy zamykaniu strony (pagehide)', () => {
  /** Drugie urządzenie z własnym sklepem „a”, kluczem B i zapisem w pamięci karty; do niego trafia paczka ze sklepu „b”. */
  function deviceWithStoreA() {
    const text = (deviceA('sklep-b'), exportTransfer()!);
    storage.clear();
    saveMeta(meta({ player: { nick: 'Kasia', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true, key: KEY_B }, partnerPoints: 0 }));
    const inMemory = createSession('sklep-a', true);
    inMemory.econ.cash = 777;
    saveSession(inMemory);
    return { text, inMemory, inMemoryMeta: loadMeta() };
  }

  it('klucz pośredni to traszka:import', () => {
    expect(IMPORT_KEY).toBe('traszka:import');
  });

  it('kolejność: pagehide po zapisaniu paczki zapisuje stary stan z pamięci karty, a import na starcie i tak wygrywa', () => {
    const { text, inMemory, inMemoryMeta } = deviceWithStoreA();
    setPlayMode('ranked');
    const before = storage.keys().sort();

    expect(stageImport(text)).toEqual({ ok: true });
    expect(storage.keys().sort()).toEqual([...before, IMPORT_KEY].sort());   // tylko klucz pośredni: nic innego nie ruszone
    expect(storage.getItem(IMPORT_KEY)).toBe(text);
    expect(lastSavedSeed()).toBe('sklep-a');
    expect(loadMeta().partnerPoints).toBe(0);

    // strona się przeładowuje: pagehide zapisuje to, co karta trzyma w pamięci (stara meta i stary sklep)
    saveMeta({ ...inMemoryMeta, lastSeen: 999 });
    inMemory.econ.cash = 888;
    saveSession(inMemory);
    expect(lastSavedSeed()).toBe('sklep-a');

    // nowy start, przed `loadMeta()` i przed wyborem sklepu
    expect(applyStagedImport()).toEqual({ seed: 'sklep-b' });
    expect(storage.getItem(IMPORT_KEY)).toBeNull();
    expect(lastSavedSeed()).toBe('sklep-b');
    expect(createSession('sklep-b').fromSave).toBe(true);
    expect(loadMeta().partnerPoints).toBe(7);                                                   // meta z paczki
    expect(loadMeta().network).toEqual(meta().network);
    expect(loadMeta().player).toEqual({ ...meta().player, key: KEY_B });                        // klucz zostaje tutejszy
    expect(hasStoredSave('sklep-a')).toBe(true);                                                // inne sklepy tego urządzenia zostają
    expect(getPlayMode()).toBe('casual');                                                       // nie wznawiamy biegu rankingowego zamiast zapisu
  });

  it('po udanym imporcie tryb to zwykła gra, a aktywny bieg rankingowy zostaje na urządzeniu', () => {
    const { text } = deviceWithStoreA();
    storage.setItem('traszka:ranked', '{"bieg":"w toku"}');
    setPlayMode('ranked');
    stageImport(text);
    expect(applyStagedImport()).toEqual({ seed: 'sklep-b' });
    expect(getPlayMode()).toBe('casual');
    expect(storage.getItem('traszka:ranked')).toBe('{"bieg":"w toku"}');
  });

  it('start strony po imporcie (jak w main.ts): sklep z paczki wygrywa ze starym ?seed= w adresie i z ostatnim sklepem sprzed importu', () => {
    const { text } = deviceWithStoreA();
    stageImport(text);
    const booted = bootImport(applyStagedImport(), 'sklep-a');   // adres sprzed przeładowania wciąż ma ?seed=sklep-a
    expect(entrySeed(booted.requested, lastSavedSeed())).toBe('sklep-b');
    expect(booted.notice).toBe('Zapis wczytany.');
  });

  it('start strony po błędzie importu: gra rusza ze starym sklepem i adresem, a gracz dostaje komunikat o błędzie', () => {
    deviceWithStoreA();
    storage.setItem(IMPORT_KEY, 'nie json');
    const booted = bootImport(applyStagedImport(), null);
    expect(entrySeed(booted.requested, lastSavedSeed())).toBe('sklep-a');
    expect(booted.notice).toBe(TRANSFER_ERRORS.invalid);
  });

  it('nic nie czeka: null i nic nie ruszone', () => {
    deviceWithStoreA();
    const before = storage.keys().sort();
    expect(applyStagedImport()).toBeNull();
    expect(storage.keys().sort()).toEqual(before);
  });

  it('paczka wczytuje się raz: kolejny start nie ma już czego wczytać', () => {
    const { text } = deviceWithStoreA();
    stageImport(text);
    expect(applyStagedImport()).toEqual({ seed: 'sklep-b' });
    expect(applyStagedImport()).toBeNull();
  });

  it('stageImport waliduje jak importTransfer: nie paczka, uszkodzona, z nowszej wersji, meta tego urządzenia z nowszej wersji; nic nie zapisuje', () => {
    const { text } = deviceWithStoreA();
    const before = storage.keys().sort();
    const bundle = JSON.parse(text) as Record<string, Record<string, unknown>>;
    for (const bad of ['nie json', '{}', JSON.stringify({ format: 'traszka-przeniesienie', version: 1, seed: 5, meta: {}, save: {} })]) {
      expect(stageImport(bad), bad).toEqual({ error: TRANSFER_ERRORS.invalid });
    }
    expect(stageImport(JSON.stringify({ ...bundle, save: { ...bundle.save, schema: 99 } }))).toEqual({ error: NEWER_SAVE_NOTICE });
    expect(stageImport(JSON.stringify({ ...bundle, meta: { ...bundle.meta, version: 2 } }))).toEqual({ error: NEWER_SAVE_NOTICE });
    storage.setItem('traszka:meta', JSON.stringify({ ...meta(), version: 2 }));
    expect(stageImport(text)).toEqual({ error: NEWER_SAVE_NOTICE });
    storage.setItem('traszka:meta', JSON.stringify(meta({ player: { nick: 'Kasia', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true, key: KEY_B }, partnerPoints: 0 })));
    expect(storage.keys().sort()).toEqual(before);   // żaden klucz nie doszedł (w tym IMPORT_KEY)
  });

  it('brak miejsca w przeglądarce przy zapisie paczki: komunikat o pamięci, a stary stan bez zmian', () => {
    const { text } = deviceWithStoreA();
    storage.failWrites = true;
    expect(stageImport(text)).toEqual({ error: TRANSFER_ERRORS.storage });
    storage.failWrites = false;
    expect(storage.getItem(IMPORT_KEY)).toBeNull();
  });

  it('paczka uszkodzona w szufladzie: błąd, klucz pośredni skasowany (rozruch się nie zapętli), stary zapis i tryb nietknięte', () => {
    const { inMemoryMeta } = deviceWithStoreA();
    setPlayMode('ranked');
    for (const broken of ['nie json', '{}', JSON.stringify({ format: 'traszka-przeniesienie', version: 1, seed: 'x', meta: {}, save: 'zapis' })]) {
      storage.setItem(IMPORT_KEY, broken);
      const before = storage.keys().filter((k) => k !== IMPORT_KEY).sort();
      expect(applyStagedImport(), broken).toEqual({ error: TRANSFER_ERRORS.invalid });
      expect(storage.getItem(IMPORT_KEY), broken).toBeNull();
      expect(storage.keys().sort()).toEqual(before);
      expect(applyStagedImport(), broken).toBeNull();
    }
    expect(lastSavedSeed()).toBe('sklep-a');
    expect(hasStoredSave('sklep-a')).toBe(true);
    expect(hasStoredSave('sklep-b')).toBe(false);
    expect(loadMeta()).toEqual(inMemoryMeta);
    expect(getPlayMode()).toBe('ranked');
  });

  it('paczka z nowszej wersji gry (zapis albo meta) w szufladzie: komunikat o nowszej wersji, klucz skasowany, nic nie nadpisane', () => {
    const { text, inMemoryMeta } = deviceWithStoreA();
    const bundle = JSON.parse(text) as Record<string, Record<string, unknown>>;
    for (const newer of [{ ...bundle, save: { ...bundle.save, schema: 99 } }, { ...bundle, meta: { ...bundle.meta, version: 2 } }]) {
      storage.setItem(IMPORT_KEY, JSON.stringify(newer));
      expect(applyStagedImport()).toEqual({ error: NEWER_SAVE_NOTICE });
      expect(storage.getItem(IMPORT_KEY)).toBeNull();
    }
    expect(lastSavedSeed()).toBe('sklep-a');
    expect(hasStoredSave('sklep-b')).toBe(false);
    expect(loadMeta()).toEqual(inMemoryMeta);
  });

  it('paczka nie zmieściła się przy wczytywaniu (brak miejsca): komunikat, klucz pośredni skasowany', () => {
    const { text } = deviceWithStoreA();
    stageImport(text);
    storage.failWrites = true;
    expect(applyStagedImport()).toEqual({ error: TRANSFER_ERRORS.storage });
    storage.failWrites = false;
    expect(storage.getItem(IMPORT_KEY)).toBeNull();
    expect(lastSavedSeed()).toBe('sklep-a');
  });
});

describe('znacznik ostatniej znanej kopii na serwerze (traszka:saveSync)', () => {
  it('zapisany czas wraca; bez zapisu albo z przeglądarką, która odmawia, nic nie rzuca', () => {
    expect(SAVE_SYNC_KEY).toBe('traszka:saveSync');
    expect(readSaveSync()).toBeNull();
    writeSaveSync(1_761_600_000_000);
    expect(storage.getItem(SAVE_SYNC_KEY)).toBe('1761600000000');
    expect(readSaveSync()).toBe(1_761_600_000_000);
    storage.failWrites = true;
    expect(() => writeSaveSync(5)).not.toThrow();
    expect(readSaveSync()).toBe(1_761_600_000_000);
    storage.failWrites = false;
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('zablokowane'); }, setItem: () => { throw new Error('zablokowane'); } });
    expect(readSaveSync()).toBeNull();
    expect(() => writeSaveSync(5)).not.toThrow();
  });

  it('śmieci w kluczu to brak znacznika; nieprawidłowej liczby nie zapisujemy', () => {
    for (const junk of ['', 'abc', '12abc', '-5', '1.5', 'NaN', 'Infinity', '9007199254740993', '{"a":1}']) {
      storage.setItem(SAVE_SYNC_KEY, junk);
      expect(readSaveSync(), junk).toBeNull();
    }
    storage.clear();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) writeSaveSync(bad);
    expect(storage.getItem(SAVE_SYNC_KEY)).toBeNull();
    writeSaveSync(0);   // serwer przyjmuje 0 (liczba całkowita nieujemna)
    expect(readSaveSync()).toBe(0);
  });
});

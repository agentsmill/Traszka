import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from '@/game/cashier';
import { MemoryStorage } from '@/game/memoryStorage';
import { loadMeta, saveMeta, type Meta } from '@/game/meta';
import { NEWER_SAVE_NOTICE, createSession, hasStoredSave, lastSavedSeed, saveSession } from '@/game/session';
import { SAVE_BUNDLE_FORMAT, SAVE_BUNDLE_VERSION, SAVE_MAX_BYTES } from '@/server/config';
import { checkSave } from '@/server/saves';
import { TRANSFER_ERRORS, TRANSFER_FORMAT, exportTransfer, importTransfer, type TransferBundle } from './saveTransfer';

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

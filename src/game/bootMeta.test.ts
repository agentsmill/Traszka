import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootMeta } from './bootMeta';
import { DEFAULT_CASHIER_LOOK, type CashierLook } from './cashier';
import { MemoryStorage } from './memoryStorage';
import { loadMeta, sanitizeMeta, saveMeta, type Meta, type Player } from './meta';
import { parseRecoveryCode } from './playerKey';
import { playerOf, type StartChoice } from './start';

const KEY = 'K7QX9MBD2HFAP3WN8RTE';
const NEW_LOOK: CashierLook = { outfit: 'women-suit', appearanceSeed: 'kasjerka-b' };

const player = (over: Partial<Player> = {}): Player => ({
  nick: 'Mateusz', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true, ...over,
});
const meta = (over: Partial<Meta> = {}): Meta => ({
  version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true, ...over,
});
/** Wybór z ekranu startowego (nick i wygląd inne niż w `player()`). */
const choice = (over: Partial<StartChoice> = {}): StartChoice => ({
  nick: 'Kasia', seed: 'traszka-5', look: NEW_LOOK, specialOutfits: false, notice: null, ranked: false, ...over,
});

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('rozruch mety (bootMeta): wybór z ekranu startowego', () => {
  it('gracz z kluczem, który wybiera nowy nick i wygląd, zachowuje klucz; reszta mety zostaje, a wczytana meta nie jest ruszana', () => {
    const loaded = meta({
      player: player({ key: KEY }), partnerPoints: 7, sound: false, lastSeen: 1234,
      network: [{ seed: 'a', income: 5, level: 2, margin: 1 }], daily: { date: '2026-10-28', streak: 3 },
    });
    const before = structuredClone(loaded);

    const booted = bootMeta(loaded, choice());

    expect(booted.player).toEqual({ nick: 'Kasia', look: NEW_LOOK, specialOutfits: false, key: KEY });
    expect(booted).toEqual({ ...before, player: booted.player });
    expect(loaded).toEqual(before);   // czysta funkcja: wczytana meta bez zmian
  });

  it('gracz bez nicka (zapisany nick nie przeszedł sprawdzenia), który podaje nowy, zachowuje klucz i nie dostaje drugiego', () => {
    const booted = bootMeta(meta({ player: player({ nick: null, key: KEY }) }), choice());
    expect(booted.player).toEqual({ nick: 'Kasia', look: NEW_LOOK, specialOutfits: false, key: KEY });
  });

  it('pierwszy gracz (meta bez gracza) dostaje klucz w formacie kodu odzyskiwania, a nick i wygląd z wyboru', () => {
    const booted = bootMeta(meta(), choice());
    const key = booted.player?.key;
    expect(key).toBeDefined();
    expect(parseRecoveryCode(key)).toBe(key);   // 20 znaków Crockforda w postaci kanonicznej
    expect(booted.player).toEqual({ ...playerOf(choice()), key });
  });

  it('gracz sprzed rankingu (nick i wygląd w mecie, bez klucza) dostaje klucz przy wyborze z ekranu', () => {
    const booted = bootMeta(meta({ player: player() }), choice());
    expect(parseRecoveryCode(booted.player?.key)).not.toBeNull();
    expect(booted.player).toMatchObject({ nick: 'Kasia', look: NEW_LOOK, specialOutfits: false });
  });

  it('meta z nowszej wersji gry (tylko do odczytu): gracz z wyboru jest w pamięci tej karty, klucza nie ma, a zapis nic nie robi', () => {
    const loaded = meta({ readOnly: true });
    const booted = bootMeta(loaded, choice());
    expect(booted.player).toEqual(playerOf(choice()));   // „ta karta ma gracza”, ale bez klucza
    expect(booted.readOnly).toBe(true);
    saveMeta(booted);
    expect(storage.getItem('traszka:meta')).toBeNull();
  });

  it('meta tylko do odczytu z kluczem w pamięci karty nie traci go przy wyborze z ekranu', () => {
    const booted = bootMeta(meta({ readOnly: true, player: player({ key: KEY }) }), choice());
    expect(booted.player).toEqual({ ...playerOf(choice()), key: KEY });
  });
});

describe('rozruch mety (bootMeta): bez ekranu startowego', () => {
  it('gracz sprzed rankingu (meta z nickiem, bez klucza) dostaje klucz, reszta mety i gracza zostaje', () => {
    const loaded = meta({ player: player(), partnerPoints: 4 });
    const before = structuredClone(loaded);

    const booted = bootMeta(loaded, null);

    expect(booted).not.toBe(loaded);   // wołający widzi zmianę i zapisuje metę
    expect(parseRecoveryCode(booted.player?.key)).not.toBeNull();
    expect(booted).toEqual({ ...before, player: { ...before.player, key: booted.player?.key } });
    expect(loaded).toEqual(before);
  });

  it('gracz z kluczem: ta sama meta, czyli nic do zapisania, a klucz zostaje', () => {
    const loaded = meta({ player: player({ key: KEY }) });
    expect(bootMeta(loaded, null)).toBe(loaded);
    expect(loaded.player?.key).toBe(KEY);
  });

  it('meta bez gracza i bez wyboru oraz meta tylko do odczytu: ta sama meta, klucz nie powstaje', () => {
    const empty = meta();
    expect(bootMeta(empty, null)).toBe(empty);
    expect(empty.player).toBeUndefined();
    const readOnly = meta({ readOnly: true, player: player() });
    expect(bootMeta(readOnly, null)).toBe(readOnly);
    expect(readOnly.player?.key).toBeUndefined();
  });

  it('uszkodzony klucz w zapisie (wypada przy wczytaniu) zastępuje nowy, a nick i kasjer zostają', () => {
    storage.setItem('traszka:meta', JSON.stringify({ ...meta({ player: player() }), player: { ...player(), key: 'to-nie-jest-klucz' } }));
    const loaded = loadMeta();
    expect(loaded.player?.key).toBeUndefined();

    const booted = bootMeta(loaded, null);

    expect(parseRecoveryCode(booted.player?.key)).not.toBeNull();
    expect(booted.player).toMatchObject({ nick: 'Mateusz', look: DEFAULT_CASHIER_LOOK });
  });
});

describe('rozruch mety (bootMeta): zapis i ponowne wczytanie', () => {
  it('klucz zapisany po rozruchu wraca z przeglądarki taki sam, a kolejny rozruch niczego nie zmienia', () => {
    const first = bootMeta(loadMeta(), choice());
    saveMeta(first);

    const reloaded = loadMeta();
    expect(reloaded.player?.key).toBe(first.player?.key);
    expect(bootMeta(reloaded, null)).toBe(reloaded);
  });

  it('zmiana nicka i wyglądu przy kolejnym wejściu przez ekran startowy zachowuje klucz z zapisu', () => {
    const first = bootMeta(sanitizeMeta(meta()), choice());
    saveMeta(first);

    const second = bootMeta(loadMeta(), choice({ nick: 'Zosia', look: DEFAULT_CASHIER_LOOK }));

    expect(second.player).toMatchObject({ nick: 'Zosia', look: DEFAULT_CASHIER_LOOK });
    expect(second.player?.key).toBe(first.player?.key);
  });
});

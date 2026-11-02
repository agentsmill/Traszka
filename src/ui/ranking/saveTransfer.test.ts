import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK } from '@/game/cashier';
import { SAVE_TRANSFER_MAX_BYTES, firmEnvelopeOf, restoreFirmFrom, type FirmSaveEnvelope } from '@/game/firmSave';
import { MemoryStorage } from '@/game/memoryStorage';
import { loadMeta, saveMeta, type Meta } from '@/game/meta';
import { NEWER_SAVE_NOTICE, createSession, hasStoredSave, lastSavedSeed, saveSession } from '@/game/session';
import { bootImport } from '@/game/boot';
import { getPlayMode, setPlayMode } from '@/game/rankedRun';
import { entrySeed } from '@/game/seeds';
import { storeSeedFor } from '@/sim/city/traffic';
import { CITY_GENERATOR_VERSION } from '@/sim/city/types';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { awaitingDecision } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { CARDS, visibleCards } from '@/sim/economy/tycoon/cards';
import { EQUIPMENT, REMONTS, UPGRADES } from '@/sim/economy/upgrades';
import { applyFirmCommand, lotState } from '@/sim/firm/commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, grantToFirm, openStores, stepFirmMinute } from '@/sim/firm/firm';
import { INBOX_MAX, MAX_STORES, type FirmState } from '@/sim/firm/types';
import { freshRun } from '@/sim/run';
import { layoutFor } from '@/sim/store/layoutFor';
import { SAVE_BUNDLE_FORMAT, SAVE_BUNDLE_VERSION, SAVE_MAX_BYTES } from '@/server/config';
import { checkSave } from '@/server/saves';
import {
  IMPORT_KEY, SAVE_SYNC_KEY, TRANSFER_CARD_LOG, TRANSFER_ERRORS, TRANSFER_FORMAT, TRANSFER_HISTORY_MONTHS, TRANSFER_INBOX, applyStagedImport, compactForTransfer,
  exportTransfer, importTransfer, readSaveSync, stageImport, writeSaveSync, type TransferBundle,
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
    expect((bundle.save as { stores: { econ: { cash: number } }[] }).stores[0]!.econ.cash).toBe(s.econ.cash);   // zapis zwykłej gry to koperta firmy
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

describe('przeniesienie zapisu: koperta firmy (schemat 4, a stary zapis schematu 3 też)', () => {
  /** Urządzenie A z zapisem zwykłej gry w schemacie 4 (firma z jednym sklepem i gotówką portfela osoby). */
  function deviceAWithFirm(seed = 'pierogi-731') {
    saveMeta(meta());
    const { state, layout, info } = freshRun(seed);
    state.cash = 98_765;
    const firm = createFirm(seed, { econ: state, layout, info }, { ranked: false });
    storage.setItem(`traszka:save:${seed}`, JSON.stringify(firmEnvelopeOf(firm)));
    storage.setItem('traszka:last', seed);
    return firm;
  }

  it('paczka niesie kopertę schematu 4 i przechodzi kontrolę serwera', () => {
    deviceAWithFirm();
    const text = exportTransfer()!;
    expect((JSON.parse(text) as TransferBundle).save).toMatchObject({ schema: 4, seed: 'pierogi-731', cityGeneratorVersion: CITY_GENERATOR_VERSION });
    expect(checkSave(text)).toEqual({ ok: true, value: text });
  });

  it('saveTransfer przyjmuje schemat 4: na drugim urządzeniu gra otwiera firmę z tym samym portfelem', () => {
    deviceAWithFirm();
    const text = exportTransfer()!;
    switchDevice();
    expect(importTransfer(text)).toEqual({ seed: 'pierogi-731' });
    const loaded = createSession('pierogi-731');
    expect(loaded.fromSave).toBe(true);
    expect(loaded.loadNotice).toBeNull();
    expect(loaded.firm?.person.wallet).toBe(98_765);
    expect(loaded.econ.cash).toBe(98_765);
    expect(loadMeta()).toEqual(meta());
  });

  it('saveTransfer odrzuca schemat 5 i miasto z nowszego generatora (importTransfer i stageImport): nic nie zapisane', () => {
    deviceAWithFirm();
    const bundle = JSON.parse(exportTransfer()!) as Record<string, Record<string, unknown>>;
    switchDevice();
    const before = storage.keys().sort();
    for (const newer of [{ schema: 5 }, { cityGeneratorVersion: CITY_GENERATOR_VERSION + 1 }]) {
      const text = JSON.stringify({ ...bundle, save: { ...bundle.save, ...newer } });
      expect(importTransfer(text)).toEqual({ error: NEWER_SAVE_NOTICE });
      expect(stageImport(text)).toEqual({ error: NEWER_SAVE_NOTICE });
    }
    expect(storage.keys().sort()).toEqual(before);
    expect(hasStoredSave('pierogi-731')).toBe(false);
    expect(importTransfer(JSON.stringify(bundle))).toEqual({ seed: 'pierogi-731' });   // ta sama paczka w schemacie 4 przechodzi
  });

  it('stary zapis schematu 3 (z ponownym wynajmem) przechodzi przez paczkę: drugie urządzenie otwiera tę samą firmę, bez :broken', () => {
    const raw = readFileSync(new URL('../../game/fixtures/save-v3-ponowny-wynajem.json', import.meta.url), 'utf8');
    const seed = (JSON.parse(raw) as { seed: string }).seed;
    saveMeta(meta());
    storage.setItem(`traszka:save:${seed}`, raw);
    storage.setItem('traszka:last', seed);
    const text = exportTransfer()!;
    expect((JSON.parse(text) as TransferBundle).save).toMatchObject({ schema: 3, seed });
    expect(storage.getItem(`traszka:save:${seed}`)).toBe(raw);   // wysłanie nie rusza zapisu lokalnego
    switchDevice();
    expect(importTransfer(text)).toEqual({ seed });
    const loaded = createSession(seed);
    expect({ fromSave: loaded.fromSave, loadNotice: loaded.loadNotice }).toEqual({ fromSave: true, loadNotice: null });
    expect(storage.getItem(`traszka:save:${seed}:broken`)).toBeNull();
    expect(loaded.firm!.stores.map((st) => [st.id, st.closed, st.reopened ?? null])).toEqual([[1, false, null], [2, false, true], [3, false, null]]);
    expect(loaded.firm!.storeLimit).toBe(3);
  });
});

// --- Pięć sklepów: paczka po kompaktowaniu ----------------------------------------------------------------------------------------------

const DAY = MINUTES_PER_DAY;
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;

/** Gracz klika „OK” na kartach aktywnego sklepu (odpowiedź zaznaczona z góry). */
function answerActive(f: FirmState): void {
  const st = activeStore(f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    expect(applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
  }
}

/**
 * Gra do minuty `minute` prawdziwymi krokami firmy. Karty zaznaczone z góry potrafią wyzerować zaufanie sklepu w ciągu roku i Centrala
 * zamyka go (§13.1), a ten test chce pięciu sklepów, które przetrwają: o północy zaufanie nie spada poniżej 70 (jak w `firmSave.test.ts`).
 */
function playHoldingTrust(f: FirmState, minute: number): void {
  const out = emptyStepOut();
  while (clockOf(f) < minute && f.over === null && !activeStore(f).econ.gameOver) {
    if (clockOf(f) % DAY === 0) for (const st of openStores(f)) st.econ.tycoon.trust.value = Math.max(st.econ.tycoon.trust.value, 70);
    answerActive(f);
    stepFirmMinute(f, out);
    out.active.length = 0;
    out.background.length = 0;
    out.firm.length = 0;
  }
}

/** Remont sklepu `id` do kolejnego poziomu: poziom gracza i gotówka z góry (jak w testach firmy; debet z rat pakietów nie blokuje), potem prawdziwe polecenie. */
function remontNext(f: FirmState, id: number): void {
  expect(applyFirmCommand(f, { type: 'switchStore', storeId: id }, emptyStepOut())).toEqual({ ok: true });
  const def = REMONTS[activeStore(f).econ.remontLevel]!;
  grantToFirm(f, (s) => { s.level = Math.max(s.level, def.minLevel); s.cash = Math.max(s.cash, 0) + def.cost; });
  const done = applyStoreCommand(f, { type: 'startRemont' }).result;
  expect(done.ok, `sklep #${id} do poziomu ${def.level}: ${done.text}; gotówka ${f.person.wallet}`).toBe(true);
}

/** Wolny lokal z największym układem po trzecim remoncie (najcięższy sklep, jaki da się wynająć). */
function largestFreeLot(f: FirmState): number {
  const size = (id: number): number => layoutFor(storeSeedFor(f.seed, id), 3, f.city.lots[id]!.spec).cells.length;
  const free = f.city.lots.filter((l) => lotState(f, l.id) === 'wolny');
  return free.reduce((best, l) => (size(l.id) > size(best.id) ? l : best)).id;
}

const FIVE_SEED = 'pierogi-731';

/**
 * Wszystkie ulepszenia do najwyższego poziomu i sprzęt w każde wolne miejsce sklepu `id` prawdziwymi zakupami (trzy przejścia, bo ulepszenie bywa
 * warunkiem innego). Skrót jak przy remoncie: poziom gracza i gotówka z góry; po zakupach portfel wraca do stanu sprzed nich.
 */
function fitAll(f: FirmState, id: number): void {
  expect(applyFirmCommand(f, { type: 'switchStore', storeId: id }, emptyStepOut())).toEqual({ ok: true });
  const wallet = f.person.wallet;
  const grant = (): void => grantToFirm(f, (s) => { s.level = Math.max(s.level, 200); s.cash = Math.max(s.cash, 0) + 50_000_000; });
  for (let pass = 0; pass < 3; pass++) {
    for (const u of UPGRADES) for (let i = 0; i < 20 && (grant(), applyStoreCommand(f, { type: 'buyUpgrade', id: u.id }).result.ok); i++);
    for (const e of EQUIPMENT) for (let i = 0; i < 30 && (grant(), applyStoreCommand(f, { type: 'buyEquipment', id: e.id }).result.ok); i++);
  }
  grantToFirm(f, (s) => { s.cash = wallet; });
}

/** Poziomy remontu sklepów #1–#5 i czy sklepy dostają wszystkie ulepszenia i sprzęt. */
interface FiveSetup { remonts: readonly number[]; fit: boolean }
/** Scenariusz z briefu: #1 po pięciu remontach, #2 i #3 po trzech, bez dokupionych ulepszeń i sprzętu. */
const BRIEF_FIVE: FiveSetup = { remonts: [5, 3, 3, 0, 0], fit: false };
/** Najgorszy przypadek: wszystkie sklepy po pięciu remontach, wszystkie ulepszenia do maksimum i sprzęt w każdym slocie. */
const WORST_FIVE: FiveSetup = { remonts: [5, 5, 5, 5, 5], fit: true };

/**
 * Pięć otwartych sklepów, cztery w największych wolnych lokalach (wynajem na raty i prawdziwa budowa), remonty z `setup` (kolejne poziomy co
 * 8 dni, bo remont zamyka sklep na kilka dni), do 6:00 ostatniego dnia drugiego roku (730 dni prawdziwych kroków; test gra jeszcze ten dzień).
 * Skróty jak w `firmSave.test.ts`: status Partnera i limit pięciu placówek od razu, poziom gracza i gotówka na zakupy z góry, zaufanie nie
 * spada poniżej 70.
 */
function playFiveStores(setup: FiveSetup): FirmState {
  const { state, layout, info } = freshRun(FIVE_SEED);
  const f = createFirm(FIVE_SEED, { econ: state, layout, info }, { ranked: false });
  f.person.partner = true;
  f.storeLimit = MAX_STORES;
  playHoldingTrust(f, 3 * DAY + OPEN_FROM);
  for (let i = 0; i < 4; i++) expect(applyFirmCommand(f, { type: 'rentLot', lotId: largestFreeLot(f), pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
  playHoldingTrust(f, Math.max(...f.builds.map((b) => b.readyDay)) * DAY + OPEN_FROM + 1);
  expect(openStores(f)).toHaveLength(5);
  for (let round = 0; round < 5; round++) {
    for (const [i, level] of setup.remonts.entries()) if (round < level) remontNext(f, i + 1);
    playHoldingTrust(f, clockOf(f) + 8 * DAY);
  }
  expect(f.stores.map((s) => s.econ.remontLevel)).toEqual(setup.remonts);
  if (setup.fit) for (const st of openStores(f)) fitAll(f, st.id);
  expect(applyFirmCommand(f, { type: 'switchStore', storeId: 1 }, emptyStepOut())).toEqual({ ok: true });
  playHoldingTrust(f, 730 * DAY + OPEN_FROM);
  return f;
}

const fiveMemo = new Map<FiveSetup, FirmState>();
const fiveStores = (setup: FiveSetup = BRIEF_FIVE): FirmState => {
  let f = fiveMemo.get(setup);
  if (!f) fiveMemo.set(setup, f = playFiveStores(setup));
  return f;
};

const bytes = (x: unknown): number => new TextEncoder().encode(typeof x === 'string' ? x : JSON.stringify(x)).length;

/** Firma z tekstu koperty, jak przy wczytaniu w przeglądarce (do porównań z tym, co otworzy drugie urządzenie). */
function opened(text: string): FirmState {
  const r = restoreFirmFrom(JSON.parse(text) as unknown, FIVE_SEED);
  if (!r.ok) throw new Error(`firma się nie otworzyła: ${r.reason}`);
  return r.firm;
}

/** Meta ze średnio rozbudowaną siecią sklepów (12 wpisów), jak w pomiarze rozmiaru w `firmSave.test.ts`. */
const bigMeta = (): Meta => meta({
  partnerPoints: 120, network: Array.from({ length: 12 }, (_, n) => ({ seed: `stary-sklep-${n}`, income: 400, level: 21, margin: 90_000 })),
});

interface Largest { text: string; local: string; at: number; pallets: number }

/**
 * Największa paczka „Wyślij zapis” z kolejnej doby gry, sprawdzana co minutę: zapis lokalny pod kluczem sklepu, paczka z `exportTransfer`
 * (zapis lokalny zostaje bez zmian). Paczka jest największa w ciągu dnia, gdy palety z dostawy stoją w sklepach (o 6:00 ich nie ma).
 */
function largestOfDay(f: FirmState): Largest {
  saveMeta(bigMeta());
  storage.setItem('traszka:last', FIVE_SEED);
  let best: Largest = { text: '', local: '', at: 0, pallets: 0 };
  let size = 0;
  for (let m = 0; m < DAY; m++) {
    const local = JSON.stringify(firmEnvelopeOf(f));
    storage.setItem(`traszka:save:${FIVE_SEED}`, local);
    const text = exportTransfer()!;
    expect(storage.getItem(`traszka:save:${FIVE_SEED}`)).toBe(local);   // zapis lokalny bez zmian
    if (bytes(text) > size) {
      size = bytes(text);
      best = { text, local, at: clockOf(f) % DAY, pallets: openStores(f).reduce((n, st) => n + st.econ.pallets.length, 0) };
    }
    playHoldingTrust(f, clockOf(f) + 1);
  }
  return best;
}

/** Drukuje pomiar paczki i zwraca jej bajty. */
function report(label: string, { text, local, at, pallets }: Largest): number {
  const full = bytes({ format: TRANSFER_FORMAT, version: 1, seed: FIVE_SEED, meta: JSON.parse(text).meta, save: JSON.parse(local) });
  const total = bytes(text);
  const save = (JSON.parse(text) as TransferBundle).save as unknown as FirmSaveEnvelope;
  console.log(`Paczka „Wyślij zapis”, ${label}, dzień 730, największa o ${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')} (palet ${pallets}): `
    + `${total} B z ${SAVE_TRANSFER_MAX_BYTES} B po kompaktowaniu (bez kompaktowania ${full} B); sklepy: ${save.stores.map((st) => bytes(st)).join(' + ')} B, `
    + `skrzynka ${save.firm.inbox.length} wpisów.`);
  expect(full, 'bez kompaktowania paczka by się nie zmieściła: test sprawdza to, po co jest compactForTransfer').toBeGreaterThan(SAVE_TRANSFER_MAX_BYTES);
  expect(save.stores.map((st) => 'layout' in st)).toEqual([false, false, false, false, false]);   // układy odtwarzalne, także po remoncie 5
  expect(checkSave(text)).toEqual({ ok: true, value: text });
  return total;
}

/** Log kart każdego sklepu (ten sam porządek co `stores`). */
const cardLogs = (f: FirmState): FirmState['stores'][number]['econ']['tycoon']['cards']['log'][] => f.stores.map((st) => st.econ.tycoon.cards.log);
/** Koperta bez logu kart: do porównań stanu, w którym log różni się długością. */
const withoutCardLogs = (f: FirmState): unknown => {
  const env = JSON.parse(JSON.stringify(firmEnvelopeOf(f))) as { stores: { closed: boolean; econ: { tycoon?: { cards: { log: unknown } } } }[] };
  for (const st of env.stores) if (!st.closed) st.econ.tycoon!.cards.log = null;
  return env;
};

describe('paczka „Wyślij zapis” przy pięciu sklepach (compactForTransfer)', () => {
  it('pięć otwartych sklepów (dwa po remoncie 3, jeden po 5), 24 miesiące prawdziwych kroków: paczka po compactForTransfer ≤ 65 536 B i wraca ok', () => {
    const f = fiveStores();
    const largest = largestOfDay(f);
    expect(f.over).toBeNull();
    expect(openStores(f).map((s) => [s.id, s.econ.remontLevel])).toEqual([[1, 5], [2, 3], [3, 3], [4, 0], [5, 0]]);
    expect(openStores(f).map((s) => s.econ.history.length)).toEqual([24, 24, 24, 24, 24]);   // #2–#5 otwarte przed końcem pierwszego miesiąca
    expect(f.inbox).toHaveLength(INBOX_MAX);
    expect(largest.pallets, 'największa paczka to ta z paletami w sklepach').toBeGreaterThan(0);
    expect(report('pięć sklepów (remonty 5, 3, 3, 0, 0)', largest)).toBeLessThanOrEqual(SAVE_TRANSFER_MAX_BYTES);
    const { text, local } = largest;
    storage.setItem(`traszka:save:${FIVE_SEED}`, local);
    const localFirm = opened(local);

    // drugie urządzenie: ta sama firma, pięć sklepów z tymi samymi remontami, ten sam portfel, bez :broken
    switchDevice();
    expect(importTransfer(text)).toEqual({ seed: FIVE_SEED });
    const loaded = createSession(FIVE_SEED);
    expect({ fromSave: loaded.fromSave, loadNotice: loaded.loadNotice, ephemeral: loaded.ephemeral }).toEqual({ fromSave: true, loadNotice: null, ephemeral: false });
    expect(storage.getItem(`traszka:save:${FIVE_SEED}:broken`)).toBeNull();
    const g = loaded.firm!;
    expect(openStores(g).map((s) => [s.id, s.lotId, s.econ.remontLevel])).toEqual(openStores(localFirm).map((s) => [s.id, s.lotId, s.econ.remontLevel]));
    expect(g.person).toEqual(localFirm.person);
    expect(g.storeLimit).toBe(MAX_STORES);
    expect(g.stores.map((s) => s.layout)).toEqual(localFirm.stores.map((s) => s.layout));
    expect(g.stores.map((s) => s.econ.pallets)).toEqual(localFirm.stores.map((s) => s.econ.pallets));
    expect(activeStore(g).econ.lastReport).toEqual(activeStore(localFirm).econ.lastReport);
    expect(openStores(g).filter((s) => s.id !== g.activeId).map((s) => s.econ.lastReport)).toEqual([null, null, null, null]);
    expect(openStores(g).map((s) => s.econ.history)).toEqual(openStores(localFirm).map((s) => s.econ.history.slice(-12)));
    expect(cardLogs(g)).toEqual(localFirm.stores.map((s) => (s.id === g.activeId ? s.econ.tycoon.cards.log : s.econ.tycoon.cards.log.slice(-TRANSFER_CARD_LOG))));
  }, 400_000);

  it('najgorszy przypadek: pięć sklepów po remoncie 5, wszystkie ulepszenia i sprzęt, najgorsza minuta doby: paczka ≤ 62 000 B (zapas na badania i cele firmy)', () => {
    const f = fiveStores(WORST_FIVE);
    const largest = largestOfDay(f);
    expect(f.over).toBeNull();
    expect(openStores(f).map((s) => s.econ.remontLevel)).toEqual([5, 5, 5, 5, 5]);
    for (const st of openStores(f)) {
      expect(st.econ.equipment.length, `sprzęt #${st.id}`).toBeGreaterThanOrEqual(19);   // L5: 9 slotów 2×2 i kasa samoobsługowa
      for (const u of UPGRADES) expect(st.econ.upgrades[u.id] ?? 0, `#${st.id} ${u.id}`).toBe(u.maxLevel);
      expect(st.econ.tycoon.cards.log.length, `log kart #${st.id} pełny`).toBe(CARDS.logMax);
    }
    expect(largest.pallets, 'najgorsza minuta to ta z paletami w sklepach').toBeGreaterThanOrEqual(20);
    expect(report('najgorszy przypadek (pięć sklepów po remoncie 5, pełne wyposażenie)', largest)).toBeLessThanOrEqual(62_000);
  }, 400_000);

  it('log kart nie wpływa na grę: firma z logami skróconymi do 10 wpisów gra tydzień co do bajtu tak samo (poza samym logiem), też po przełączeniu sklepu', () => {
    const local = JSON.stringify(firmEnvelopeOf(fiveStores(WORST_FIVE)));
    const full = opened(local);
    const env = JSON.parse(local) as { stores: { closed: boolean; econ: { tycoon: { cards: { log: unknown[] } } } }[] };
    for (const st of env.stores) if (!st.closed) st.econ.tycoon.cards.log = st.econ.tycoon.cards.log.slice(-TRANSFER_CARD_LOG);
    const short = opened(JSON.stringify(env));
    expect(cardLogs(short).map((l) => l.length)).toEqual([10, 10, 10, 10, 10]);
    expect(withoutCardLogs(short)).toEqual(withoutCardLogs(full));
    for (const g of [full, short]) {
      expect(applyFirmCommand(g, { type: 'switchStore', storeId: 3 }, emptyStepOut())).toEqual({ ok: true });
      playHoldingTrust(g, clockOf(g) + 7 * DAY);   // okólnik co 4–6 dni: każdy sklep dostaje w tydzień co najmniej jedną kartę
    }
    expect(short.over).toBeNull();
    expect(withoutCardLogs(short)).toEqual(withoutCardLogs(full));
    // karty dalej przychodzą i trafiają do logu tak samo: skrócony log to końcówka pełnego
    for (const [i, log] of cardLogs(short).entries()) {
      const whole = cardLogs(full)[i]!;
      expect(log, `sklep #${i + 1}`).toEqual(whole.slice(-log.length));
      expect(log.length).toBeGreaterThan(TRANSFER_CARD_LOG);
    }
  }, 400_000);

  it('drugie urządzenie: najgorsza paczka wczytuje się, a sklep w tle ze skróconym logiem kart zostaje aktywnym i gra dalej', () => {
    const f = fiveStores(WORST_FIVE);
    saveMeta(bigMeta());
    storage.setItem('traszka:last', FIVE_SEED);
    storage.setItem(`traszka:save:${FIVE_SEED}`, JSON.stringify(firmEnvelopeOf(f)));
    const text = exportTransfer()!;
    switchDevice();
    expect(importTransfer(text)).toEqual({ seed: FIVE_SEED });
    const loaded = createSession(FIVE_SEED);
    expect({ fromSave: loaded.fromSave, loadNotice: loaded.loadNotice }).toEqual({ fromSave: true, loadNotice: null });
    expect(storage.getItem(`traszka:save:${FIVE_SEED}:broken`)).toBeNull();
    const g = loaded.firm!;
    expect(cardLogs(g).map((l) => l.length)).toEqual(g.stores.map((s) => (s.id === g.activeId ? CARDS.logMax : TRANSFER_CARD_LOG)));
    for (const id of [2, 5]) {
      const st = g.stores.find((s) => s.id === id)!;
      const seq = st.econ.tycoon.cards.seq;
      expect(applyFirmCommand(g, { type: 'switchStore', storeId: id }, emptyStepOut())).toEqual({ ok: true });
      playHoldingTrust(g, clockOf(g) + 7 * DAY);   // okólnik co 4–6 dni: co najmniej jedna karta
      expect(g.over).toBeNull();
      expect(activeStore(g)).toBe(st);
      expect(st.econ.tycoon.cards.seq, `sklep #${id}: karty dalej przychodzą`).toBeGreaterThan(seq);
      expect(st.econ.tycoon.cards.log.length).toBeGreaterThan(TRANSFER_CARD_LOG);
      expect(st.econ.tycoon.cards.log.length).toBeLessThanOrEqual(CARDS.logMax);
    }
    // zapis z drugiego urządzenia wraca do pełnego kształtu i znów wczytuje się bez błędu
    const resaved = JSON.stringify(firmEnvelopeOf(g));
    expect(JSON.parse(JSON.stringify(firmEnvelopeOf(opened(resaved))))).toEqual(JSON.parse(resaved));
  }, 400_000);

  it('compactForTransfer: lastReport null poza aktywnym, history ≤ 12, inbox ≤ 10; zapis lokalny (firmEnvelopeOf) bez zmian', () => {
    expect(TRANSFER_HISTORY_MONTHS).toBe(12);
    expect(TRANSFER_INBOX).toBe(10);
    expect(TRANSFER_CARD_LOG).toBe(10);
    const f = fiveStores();
    const env = firmEnvelopeOf(f);
    const before = JSON.stringify(env);
    const c = compactForTransfer(env);
    expect(JSON.stringify(env)).toBe(before);   // kompaktowanie nie zmienia koperty, z której powstaje
    expect(JSON.stringify(firmEnvelopeOf(f))).toBe(before);
    expect(c.firm.inbox).toEqual(env.firm.inbox.slice(-10));
    expect(c.firm.inbox).toHaveLength(10);
    expect({ ...c.firm, inbox: [] }).toEqual({ ...env.firm, inbox: [] });
    expect([c.schema, c.seed, c.gameVersion, c.cityGeneratorVersion]).toEqual([env.schema, env.seed, env.gameVersion, env.cityGeneratorVersion]);
    const neutral = (st: (typeof c.stores)[number]): unknown => (st.closed ? st : {
      ...st, econ: { ...st.econ, history: [], lastReport: null, tycoon: { ...st.econ.tycoon, cards: { ...st.econ.tycoon.cards, log: [] } } },
    });
    for (const [i, st] of c.stores.entries()) {
      const orig = env.stores[i]!;
      if (st.closed || orig.closed) { expect(st).toEqual(orig); continue; }
      const active = st.id === env.firm.activeId;
      expect(st.econ.history).toEqual(orig.econ.history.slice(-12));
      expect(st.econ.history.length).toBeLessThanOrEqual(12);
      expect(st.econ.lastReport).toEqual(active ? orig.econ.lastReport : null);
      expect(st.econ.tycoon.cards.log).toEqual(active ? orig.econ.tycoon.cards.log : orig.econ.tycoon.cards.log.slice(-10));
      expect(neutral(st)).toEqual(neutral(orig));   // reszta sklepu bez zmian
    }
    expect(env.stores.filter((st) => !st.closed && st.econ.lastReport !== null).length).toBe(5);   // test nie jest pusty: każdy sklep miał raport
    expect(env.stores.filter((st) => !st.closed && st.econ.tycoon.cards.log.length > 10).length).toBe(5);   // i log dłuższy niż 10
  }, 400_000);

  it('compactForTransfer nie rzuca na uszkodzonej kopercie (zapis z przeglądarki nie jest pewny) i nie rusza zamkniętych sklepów', () => {
    const odd = {
      schema: 4, seed: 'x', gameVersion: 'v', cityGeneratorVersion: 1, firm: { activeId: 1, inbox: 'nic' },
      stores: [
        null, 7, { id: 1, closed: false, econ: { history: 'x', lastReport: { a: 1 } } }, { id: 2, closed: true, econ: { remontLevel: 1 } }, { id: 3, closed: false },
        { id: 4, closed: false, econ: { tycoon: { cards: { log: 'x' } } } }, { id: 5, closed: false, econ: { tycoon: 'x' } },
      ],
    } as unknown as FirmSaveEnvelope;
    const c = compactForTransfer(odd);
    expect(c.stores).toEqual([
      null, 7, { id: 1, closed: false, econ: { history: 'x', lastReport: { a: 1 } } }, { id: 2, closed: true, econ: { remontLevel: 1 } }, { id: 3, closed: false },
      { id: 4, closed: false, econ: { tycoon: { cards: { log: 'x' } }, lastReport: null } }, { id: 5, closed: false, econ: { tycoon: 'x', lastReport: null } },
    ]);
    expect(c.firm).toEqual({ activeId: 1, inbox: 'nic' });
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

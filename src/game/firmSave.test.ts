import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCity, lotNeighbour } from '@/sim/city/generateCity';
import { CITY_GENERATOR_VERSION } from '@/sim/city/types';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type EconomyState } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { LIMITS } from '@/sim/economy/sanitize';
import { BOTS } from '@/sim/economy/tycoon/bots';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { economyView, toCommand } from '@/sim/economy/tycoon/economyEnv';
import { storeSeedFor } from '@/sim/city/traffic';
import { closeStore } from '@/sim/firm/closure';
import { RELET_BUILD_DAYS, RELET_SHARE, applyFirmCommand, lotState, rentPrice, rentRefusal } from '@/sim/firm/commands';
import {
  activeStore, applyStoreCommand, createFirm, emptyStepOut, grantToFirm, openStoreAt, openStores, stepFirmMinute, syncWallet,
} from '@/sim/firm/firm';
import { INBOX_MAX, type FirmState, type FirmStepOut } from '@/sim/firm/types';
import { freshRun } from '@/sim/run';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { layoutFor } from '@/sim/store/layoutFor';
import { takeoverSide } from '@/sim/store/takeover';
import type { StoreLayout } from '@/sim/store/types';
import { SAVE_MAX_BYTES } from '@/server/config';
import { TRANSFER_FORMAT } from '@/ui/ranking/saveTransfer';
import { DEFAULT_CASHIER_LOOK } from './cashier';
import { FIRM_SAVE_SCHEMA, SAVE_TRANSFER_MAX_BYTES, firmEnvelopeOf, isNewerSave, restoreFirmFrom, type FirmOpened } from './firmSave';
import { MemoryStorage } from './memoryStorage';
import type { Meta } from './meta';
import { RANKED_KEYS, createRankedSession, loadRanked, saveRanked } from './rankedRun';
import {
  BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, SAVE_SCHEMA, createSession, fitsStore, hasStoredSave, restoreSessionFrom, type GameSession,
} from './session';
import { GAME_VERSION } from './version';

/*
 * Zapis firmy (spec §7.4, §16): koperta schematu 3 z migracją schematu 1 i 2 (sklep z zapisu staje się sklepem #1), miasto liczone z
 * seeda zamiast zapisu, odczyt zepsutego i nowszego zapisu oraz rozmiar najgorszego przypadku w paczce „Wyślij zapis”.
 */

const SEED = 'kiełbasa-42';
const DAY = MINUTES_PER_DAY;
const key = (seed: string): string => `traszka:save:${seed}`;

const hashOf = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fixtureUrl = (name: string): URL => new URL(`./fixtures/${name}`, import.meta.url);
const text = (name: string): string => readFileSync(fixtureUrl(name), 'utf8');
const json = (name: string): Record<string, unknown> => JSON.parse(text(name)) as Record<string, unknown>;

const opened = (r: FirmOpened): FirmState => {
  if (!r.ok) throw new Error(`firma się nie otworzyła: ${r.reason}`);
  return r.firm;
};
/** Zapis i odczyt przez tekst JSON, jak przez `localStorage`. */
const viaJson = (f: FirmState, partner?: EconomyState['partner']): FirmOpened =>
  restoreFirmFrom(JSON.parse(JSON.stringify(firmEnvelopeOf(f))) as unknown, f.seed, partner);

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.spyOn(console, 'error').mockImplementation(() => {});   // wczytanie zepsutego zapisu loguje przyczynę
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- Gra na firmie: te same pomocniki co w testach `src/sim/firm` ---------------------------------------------------

const newFirm = (seed = SEED): FirmState => {
  const { state, layout, info } = freshRun(seed);
  return createFirm(seed, { econ: state, layout, info }, { ranked: false });
};
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;
const freeLot = (f: FirmState): number => f.city.lots.find((l) => lotState(f, l.id) === 'wolny')!.id;

function answerActive(f: FirmState): void {
  const st = activeStore(f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    expect(applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
  }
}

/** Jedna minuta firmy: karty aktywnego sklepu dostają odpowiedź domyślną, potem krok; zdarzenia nie zbierają się (365 dni by je napchało). */
function tick(f: FirmState, out: FirmStepOut = emptyStepOut()): void {
  answerActive(f);
  stepFirmMinute(f, out);
  out.active.length = 0;
  out.background.length = 0;
  out.firm.length = 0;
}

function playTo(f: FirmState, minute: number): void {
  const out = emptyStepOut();
  while (clockOf(f) < minute && f.over === null && !activeStore(f).econ.gameOver) tick(f, out);
}

const command = (f: FirmState, cmd: Parameters<typeof applyFirmCommand>[1]): ReturnType<typeof applyFirmCommand> =>
  applyFirmCommand(f, cmd, emptyStepOut());

/** Remont aktywnego sklepu: poziom gracza i gotówka z góry (jak w testach firmy), potem prawdziwe polecenie. */
function remont(f: FirmState, level: number): void {
  grantToFirm(f, (s) => { s.level = level; s.cash += 200_000; });
  expect(applyStoreCommand(f, { type: 'startRemont' }).result.ok).toBe(true);
}

/** Wyposażenie aktywnego sklepu prawdziwymi zakupami: dwa ulepszenia i dwa urządzenia (po zamknięciu zostają w lokalu, §13.3). */
function fit(f: FirmState): void {
  grantToFirm(f, (s) => { s.level = 14; s.cash += 100_000; });
  for (const cmd of [
    { type: 'buyUpgrade', id: 'szkolenie' }, { type: 'buyUpgrade', id: 'wozek' }, { type: 'buyEquipment', id: 'sco' }, { type: 'buyEquipment', id: 'bankomat' },
  ] as const) expect(applyStoreCommand(f, cmd).result.ok).toBe(true);
}

/**
 * Firma w stanie, który zapis musi unieść: sklep #1 z wyposażeniem i remontem, wypowiedziany i zamknięty (wypowiedzenie zostaje w
 * zapisie), aktywny #2 po remoncie, na koniec nowa budowa w toku. Wszystko prawdziwymi poleceniami i krokami, z jedynym skrótem:
 * status Partnera nadany od razu. Zapis powstaje w wieczór przed dniem otwarcia budowy.
 */
function playScenario(): FirmState {
  const f = newFirm();
  f.person.partner = true;
  playTo(f, 3 * DAY + OPEN_FROM);
  expect(command(f, { type: 'rentLot', lotId: freeLot(f), pay: 'raty' })).toEqual({ ok: true });
  playTo(f, f.builds[0]!.readyDay * DAY + OPEN_FROM + 1);
  expect(f.stores).toHaveLength(2);
  fit(f);
  remont(f, 8);
  expect(command(f, { type: 'switchStore', storeId: 2 })).toEqual({ ok: true });
  remont(f, 8);
  expect(command(f, { type: 'terminateStore', storeId: 1 })).toEqual({ ok: true });
  for (let guard = 0; !f.stores[0]!.closed && guard < 90 * DAY; guard++) tick(f);
  expect(f.stores[0]!.closed).toBe(true);
  expect(command(f, { type: 'rentLot', lotId: freeLot(f), pay: 'raty' })).toEqual({ ok: true });
  playTo(f, (f.builds[0]!.readyDay - 1) * DAY + 20 * 60);
  expect(f.over).toBeNull();
  return f;
}

let scenarioMemo: FirmState | null = null;
/** Firma ze scenariusza; test, który ją zmienia, bierze kopię (`structuredClone`). */
const scenario = (): FirmState => (scenarioMemo ??= playScenario());

/** Mała firma z dwoma otwartymi sklepami (drugi od dnia 10), do prób na zepsutych kopertach. */
function smallFirm(): FirmState {
  const f = newFirm();
  playTo(f, 10 * DAY + OPEN_FROM);
  openStoreAt(f, freeLot(f), clockOf(f));
  playTo(f, 11 * DAY + OPEN_FROM);
  return f;
}
let smallMemo: string | null = null;
/** Koperta małej firmy; każdy test dostaje własną, świeżo sparsowaną kopię. */
const smallEnvelope = (): Record<string, any> => JSON.parse(smallMemo ??= JSON.stringify(firmEnvelopeOf(smallFirm()))) as Record<string, any>;

// --- Bot „mistrz” przez firmę do statusu Partnera (fixture „przed statusem”) ----------------------------------------------------

/** Seed fixture'a „przed statusem”: bez polskich znaków, żeby smoke mógł go wpisać w adres bez kodowania. */
const STATUS_SEED = 'traszka-1';
/** Za ile minut gry od zapisu przychodzi status: smoke przewija `skip(30)`, więc zapis musi leżeć tuż przed zamknięciem miesiąca. */
const STATUS_LEAD_MINUTES = 20;

/**
 * Bot „mistrz” gra firmę minuta po minucie (polecenia bota, krok firmy), aż zamknięcie miesiąca da status Partnera. Zwraca minutę kroku,
 * który go nadał (`statusMinute`), i, gdy `snapshotMinute` nie jest null, kopertę zapisu z tej minuty jako tekst JSON (po poleceniach bota, przed krokiem:
 * wszystkie karty mają odpowiedź, więc `skip` po wczytaniu nie staje od razu).
 */
function mistrzToStatus(seed: string, snapshotMinute: number | null): { statusMinute: number; snapshot: string | null } {
  const f = newFirm(seed);
  let snapshot: string | null = null;
  for (let guard = 0; guard < 120 * DAY && f.over === null; guard++) {
    const st = activeStore(f);
    for (const cmd of BOTS.mistrz.act(economyView(st.econ, st.info))) applyStoreCommand(f, toCommand(cmd));
    if (awaitingDecision(st.econ)) throw new Error('bot „mistrz” zostawił kartę bez odpowiedzi');
    const minute = clockOf(f);
    if (minute === snapshotMinute) snapshot = JSON.stringify(firmEnvelopeOf(f));   // tekst od razu: koperta trzyma żywe obiekty sklepów
    const out = emptyStepOut();
    stepFirmMinute(f, out);
    if (out.firm.some((e) => e.kind === 'partner')) return { statusMinute: minute, snapshot };
  }
  throw new Error(`bot „mistrz” nie dostał statusu w seedzie ${seed}`);
}

// --- Schemat 1 i 2: sklep z zapisu to sklep #1 ------------------------------------------------------------------------

const LEGACY = [
  'save-v1-blok-dzien40.json', 'save-v1-remont1.json', 'save-v2-dzien30.json', 'save-v2-remont2.json', 'save-sim4-palety.json',
  'save-sim5-polowa-miesiaca.json',
];

// Koperta pomija układy, które generator odtwarza z lokalu (zamknięte i otwarte sklepy). Podbicie GENERATOR_VERSION musi więc
// zachować stary generator dla tych zapisów albo je zmigrować, zanim wejdzie nowy — inaczej zapisy firm przestaną się wczytywać.
it('GENERATOR_VERSION 1: zapisy bez układów odtwarzają się tym generatorem', () => {
  expect(GENERATOR_VERSION).toBe(1);
});

describe('schemat 1 i 2: wczytanie jako firma z jednym sklepem', () => {
  it('stałe: koperta firmy to schemat 3, schemat biegu rankingowego zostaje 2, a paczka mieści tyle, co przyjmuje serwer', () => {
    expect(FIRM_SAVE_SCHEMA).toBe(3);
    expect(SAVE_SCHEMA).toBe(2);
    expect(SAVE_TRANSFER_MAX_BYTES).toBe(64 * 1024);
    expect(SAVE_TRANSFER_MAX_BYTES).toBe(SAVE_MAX_BYTES);
  });

  it.each(LEGACY)('%s: jeden sklep #1 w lokalu startowym, econ i układ jak z restoreSessionFrom, bez site', (name) => {
    const data = json(name);
    const seed = data.seed as string;
    const session = (restoreSessionFrom(data, seed) as { ok: true; session: GameSession }).session;
    const f = opened(restoreFirmFrom(data, seed));
    expect(f).toMatchObject({ seed, ranked: false, activeId: 1, builds: [], monthInvest: 0, inbox: [], over: null });
    expect(f.city).toEqual(generateCity(seed));
    expect(f.stores).toHaveLength(1);
    const st = f.stores[0]!;
    expect({ id: st.id, lotId: st.lotId, closed: st.closed, notice: st.notice }).toEqual({ id: 1, lotId: f.city.startLotId, closed: false, notice: null });
    expect(st.econ).toEqual(session.econ);
    expect(st.layout).toEqual(session.layout);
    expect(st.info).toEqual(session.info);
    expect(st.info.site).toBeUndefined();
    expect(f.person).toEqual({ wallet: session.econ.cash, ogonki: session.econ.ogonki, partner: false, remanentKnown: session.econ.franchisee.remanent.known });
    expect(f.weatherHash).toBe(session.econ.seedHash);
  });

  it.each(LEGACY)('%s: pierwszy zapis ma schemat 3 i wraca z niego ten sam sklep', (name) => {
    const data = json(name);
    const seed = data.seed as string;
    const f = opened(restoreFirmFrom(data, seed));
    const envelope = firmEnvelopeOf(f);
    expect(envelope).toMatchObject({ schema: 3, gameVersion: GAME_VERSION, cityGeneratorVersion: CITY_GENERATOR_VERSION, seed });
    expect(envelope.stores).toHaveLength(1);
    expect(Object.keys(envelope).sort()).toEqual(['cityGeneratorVersion', 'firm', 'gameVersion', 'schema', 'seed', 'stores']);
    const again = opened(viaJson(f));
    expect(again.stores[0]!.econ).toEqual(f.stores[0]!.econ);
    expect(again.stores[0]!.layout).toEqual(f.stores[0]!.layout);
    expect(hashOf(firmEnvelopeOf(again))).toBe(hashOf(JSON.parse(JSON.stringify(envelope))));
  });

  it('miasto nie trafia do zapisu: koperta nie ma pól miasta, a lokale i ulice liczą się z seeda', () => {
    const f = opened(restoreFirmFrom(json('save-v2-dzien30.json'), 'traszka-v2-a'));
    const raw = JSON.stringify(firmEnvelopeOf(f));
    expect(raw).not.toContain(f.city.name);
    expect(raw).not.toContain('"streets"');
    expect(raw).not.toContain('"lots"');
    expect(raw).not.toContain('"blocks"');
  });

  it('Review Focus 5: save-v2-remont2 z premią partnera ładuje się jako sklep #1 po dwóch remontach i gra jak dziś', () => {
    const partner = { points: 3, networkIncome: 200, stores: 2 };
    const data = json('save-v2-remont2.json');
    const seed = data.seed as string;
    const direct = (restoreSessionFrom(data, seed, partner) as { ok: true; session: GameSession }).session;
    const f = opened(restoreFirmFrom(data, seed, partner));
    const st = f.stores[0]!;
    expect(st.econ.remontLevel).toBe(2);
    expect(st.layout).toEqual(direct.layout);
    expect(st.layout.generatorVersion).toBe((data.layout as { generatorVersion: number }).generatorVersion);
    expect(st.econ.partner).toEqual(partner);
    expect(st.econ).toEqual(direct.econ);
    expect(f.person.partner).toBe(false);   // premia sieci z poprzednich gier to nie status Partnera Strategicznego
    expect(firmEnvelopeOf(f).schema).toBe(3);

    // premia sieci działa jak dziś: trzy doby firmy i trzy doby samej ekonomii dają ten sam stan (dochód z sieci wpada przy zamknięciu dnia)
    const events: never[] = [];
    for (let i = 0; i < 3 * DAY; i++) {
      for (const card of visibleCards(direct.econ.tycoon.cards, direct.econ.minute)) {
        applyCommand(direct.econ, direct.info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
      }
      stepMinute(direct.econ, direct.info, events);
      tick(f);
    }
    expect(hashOf(st.econ)).toBe(hashOf(direct.econ));
    expect(f.person.wallet).toBe(direct.econ.cash);
  });

  it('zapis, którego nie da się wczytać, nie przechodzi przez firmę: seed obcy, nie obiekt, zły econ', () => {
    const data = json('save-v2-dzien30.json');
    expect(restoreFirmFrom(data, 'inny-seed')).toEqual({ ok: false, reason: 'invalid' });
    expect(restoreFirmFrom(null, 'traszka-v2-a')).toEqual({ ok: false, reason: 'invalid' });
    expect(restoreFirmFrom([], 'traszka-v2-a')).toEqual({ ok: false, reason: 'invalid' });
    expect(restoreFirmFrom({ ...data, econ: [] }, 'traszka-v2-a')).toEqual({ ok: false, reason: 'invalid' });
    expect(restoreFirmFrom({ ...data, schema: 99 }, 'traszka-v2-a')).toEqual({ ok: false, reason: 'invalid' });
  });
});

// --- Schemat 3: obieg ----------------------------------------------------------------------------------------------

describe('schemat 3: zapis i odczyt firmy', () => {
  it('scenariusz jest tym, co ma być: #1 zamknięty z wypowiedzeniem, aktywny #2 po remoncie, budowa w toku', () => {
    const f = scenario();
    expect(f.stores.map((s) => ({ id: s.id, closed: s.closed }))).toEqual([{ id: 1, closed: true }, { id: 2, closed: false }]);
    expect(f.stores[0]!.notice).not.toBeNull();
    expect(f.activeId).toBe(2);
    expect(f.stores[1]!.econ.remontLevel).toBe(1);
    expect(f.stores[0]!.econ).toMatchObject({ remontLevel: 1, upgrades: { szkolenie: 1, wozek: 1 } });
    expect(f.stores[0]!.econ.equipment.map((e) => e.id)).toEqual(['sco', 'bankomat']);
    expect(f.builds).toHaveLength(1);
    expect(lotState(f, f.builds[0]!.lotId)).toBe('budowa');
    expect(lotState(f, f.stores[0]!.lotId)).toBe('po-traszce');
  });

  it('koperta: seed, wersje, osoba, budowy i skrzynka; sklep otwarty z econ, zamknięty tylko z wyposażeniem, układów odtwarzalnych nie ma (bez miasta i info)', () => {
    const f = scenario();
    const env = firmEnvelopeOf(f);
    expect(env).toMatchObject({ schema: 3, gameVersion: GAME_VERSION, cityGeneratorVersion: CITY_GENERATOR_VERSION, seed: SEED });
    expect(env.firm).toEqual({
      person: f.person, activeId: 2, builds: f.builds, monthInvest: f.monthInvest, inbox: f.inbox, weatherHash: f.weatherHash, over: null,
    });
    // układ odtwarzalny z lokalu miasta i poziomu remontu nie leży w kopercie (ani zamkniętego, ani otwartego sklepu)
    expect(env.stores.map((s) => Object.keys(s).sort())).toEqual(env.stores.map(() => ['closed', 'econ', 'generatorVersion', 'id', 'lotId', 'notice']));
    expect(env.stores.map((s) => ({ id: s.id, lotId: s.lotId, closed: s.closed, notice: s.notice, generatorVersion: s.generatorVersion }))).toEqual(
      f.stores.map((s) => ({ id: s.id, lotId: s.lotId, closed: s.closed, notice: s.notice, generatorVersion: s.layout.generatorVersion })),
    );
    const [closed, open] = env.stores;
    expect(open).toMatchObject({ closed: false, generatorVersion: GENERATOR_VERSION, econ: f.stores[1]!.econ });
    const kept = f.stores[0]!.econ;
    expect(closed).toMatchObject({ closed: true, econ: { version: 1, seed: SEED, minute: kept.minute, upgrades: kept.upgrades, equipment: kept.equipment, remontLevel: 1, gameOver: true } });
    expect(Object.keys(closed!.econ).sort()).toEqual(['equipment', 'gameOver', 'minute', 'remontLevel', 'seed', 'upgrades', 'version']);
  });

  it('Review Focus 3: po odczycie te same sklepy, układy, lokale, budowa (readyDay) i aktywny #2; info i site od nowa', () => {
    const live = scenario();
    const back = opened(viaJson(live));
    expect(back.city).toEqual(live.city);
    expect(back.activeId).toBe(2);
    expect(back.builds).toEqual(live.builds);
    expect(back.person).toEqual(live.person);
    expect(back.inbox).toEqual(live.inbox);
    expect({ monthInvest: back.monthInvest, weatherHash: back.weatherHash, over: back.over }).toEqual({ monthInvest: live.monthInvest, weatherHash: live.weatherHash, over: live.over });
    expect(back.stores.map((s) => ({ id: s.id, lotId: s.lotId, closed: s.closed, notice: s.notice }))).toEqual(
      live.stores.map((s) => ({ id: s.id, lotId: s.lotId, closed: s.closed, notice: s.notice })),
    );
    for (const [i, st] of back.stores.entries()) {
      expect(st.layout).toEqual(live.stores[i]!.layout);
      if (st.closed) continue;   // zamknięty sklep wraca z samym wyposażeniem (patrz niżej), a jego stare `site` nic nie znaczy
      expect(st.econ).toEqual(live.stores[i]!.econ);
      expect(st.info).toEqual(live.stores[i]!.info);
    }
    // układ #2 powstał z lokalu miasta: `site.lot` wrócił do StoreInfo, więc kolejny remont da układ z tego lokalu (nie z pickLot seeda sklepu)
    const info2 = back.stores[1]!.info;
    expect(info2.site?.lot).toEqual(back.city.lots[back.stores[1]!.lotId]!.spec);
    expect(back.stores[1]!.layout.lot).toEqual(layoutFor(back.stores[1]!.econ.seed, 1, info2.site!.lot!).lot);
    expect(lotState(back, back.builds[0]!.lotId)).toBe('budowa');
    expect(lotState(back, back.stores[0]!.lotId)).toBe('po-traszce');
  });

  it('Review Focus 3: oba stany (żywy i odczytany) przechodzą 1000 kroków z tym samym skrótem, a budowa otwiera się w dniu z zapisu', () => {
    const a = structuredClone(scenario());
    const text = JSON.stringify(firmEnvelopeOf(a));
    expect((JSON.parse(text) as { stores: { layout?: unknown }[] }).stores.map((s) => s.layout)).toEqual([undefined, undefined]);   // oba układy wracają z generatora
    const b = opened(restoreFirmFrom(JSON.parse(text), SEED));
    expect(b.stores.map((s) => s.layout)).toEqual(a.stores.map((s) => s.layout));
    const { readyDay, lotId } = a.builds[0]!;
    for (let i = 0; i < 1000; i++) {
      tick(a);
      tick(b);
      if (i % 100 === 99) expect(hashOf(firmEnvelopeOf(b))).toBe(hashOf(firmEnvelopeOf(a)));
    }
    expect(hashOf(firmEnvelopeOf(b))).toBe(hashOf(firmEnvelopeOf(a)));
    for (const f of [a, b]) {
      expect(f.builds).toEqual([]);
      expect(f.stores).toHaveLength(3);
      expect(f.stores[2]).toMatchObject({ id: 3, lotId, closed: false });
      expect(f.stores[2]!.econ.minute).toBeGreaterThanOrEqual(readyDay * DAY + OPEN_FROM);
      expect(f.activeId).toBe(2);
    }
    expect(openStores(b).map((s) => s.info)).toEqual(openStores(a).map((s) => s.info));
  });

  it('kolejny remont odczytanego #2 daje ten sam układ co w żywej grze (układ z lokalu miasta)', () => {
    const a = structuredClone(scenario());
    const b = opened(viaJson(a));
    for (const f of [a, b]) remont(f, 14);
    expect(activeStore(b).econ.remontLevel).toBe(2);
    expect(activeStore(b).layout).toEqual(activeStore(a).layout);
    expect(activeStore(b).info).toEqual(activeStore(a).info);
  });

  it('zamknięty sklep: lokal zostaje „po Traszce”, wyposażenie (ulepszenia, sprzęt, poziom remontu) i układ wracają, reszta z domyślnych', () => {
    const live = scenario();
    const back = opened(viaJson(live));
    const [liveStore, store] = [live.stores[0]!, back.stores[0]!];
    expect(store).toMatchObject({ id: 1, closed: true, lotId: liveStore.lotId, notice: liveStore.notice });
    expect(lotState(back, store.lotId)).toBe('po-traszce');
    expect(store.econ.upgrades).toEqual({ szkolenie: 1, wozek: 1 });
    expect(store.econ.equipment).toEqual(liveStore.econ.equipment);
    expect(store.econ.equipment.length).toBe(2);
    expect(store.econ.remontLevel).toBe(1);
    expect(store.econ.gameOver).toBe(true);
    expect(store.econ.minute).toBe(liveStore.econ.minute);
    expect(store.layout).toEqual(liveStore.layout);   // z lokalu miasta i poziomu remontu, jak przed zapisem
    expect(store.econ.history).toEqual([]);   // reszta ekonomii z domyślnych: historia, zapasy i saldo przepadły w rozliczeniu
    expect(store.econ.franchisee.installments).toEqual([]);
  });

  it('save -> load -> save daje tę samą kopertę (też z zamkniętym sklepem), a kolejny odczyt ten sam stan', () => {
    const first = JSON.stringify(firmEnvelopeOf(scenario()));
    const back = opened(restoreFirmFrom(JSON.parse(first), SEED));
    const second = JSON.stringify(firmEnvelopeOf(back));
    expect(JSON.parse(second)).toEqual(JSON.parse(first));
    expect(second).toBe(first);
    expect(JSON.stringify(firmEnvelopeOf(opened(restoreFirmFrom(JSON.parse(second), SEED))))).toBe(second);
  });

  it('układ, którego generator nie odtworzy, zostaje w kopercie: starsza wersja generatora albo układ inny niż z lokalu', () => {
    const data = json('save-v2-remont2.json');
    const seed = data.seed as string;
    const f = opened(restoreFirmFrom(data, seed));
    const envelope = (): Record<string, any> => JSON.parse(JSON.stringify(firmEnvelopeOf(f))) as Record<string, any>;
    expect(envelope().stores[0]).toMatchObject({ generatorVersion: GENERATOR_VERSION });
    expect(envelope().stores[0].layout).toBeUndefined();   // układ ze starego zapisu odtwarza dzisiejszy generator, więc nie jest potrzebny

    const original = f.stores[0]!.layout;
    const changed = original.cells.map((c, i) => (i === 0 ? (c === 'wall' ? 'floor' : 'wall') : c));
    const variants: [string, StoreLayout][] = [
      ['starsza wersja generatora', { ...original, generatorVersion: GENERATOR_VERSION - 1 }],
      ['ta sama wersja, inna siatka', { ...original, cells: changed }],
      ['ta sama wersja, inny seed układu', { ...original, seed: `${original.seed}:inny` }],
    ];
    for (const [name, layout] of variants) {
      f.stores[0]!.layout = layout;
      const env = envelope();
      expect(env.stores[0].layout, name).toEqual(layout);
      expect(env.stores[0].generatorVersion, name).toBe(layout.generatorVersion);
      const back = opened(restoreFirmFrom(env, seed));
      expect(back.stores[0]!.layout, name).toEqual(layout);   // zapisany układ wraca, nie ten z generatora
      expect(JSON.stringify(firmEnvelopeOf(back)), name).toBe(JSON.stringify(env));   // i zostaje w kolejnym zapisie
    }
  });

  it('remont w toku: układ już jest nowy, więc odtwarza się z poziomu remontu i odczyt oddaje ten sam sklep', () => {
    const f = twoOpenStores();
    remontEach(f, [1, 2], 8);
    playTo(f, clockOf(f) + 60);
    for (const st of f.stores) expect([st.econ.remontLevel, st.econ.remontUntil !== null]).toEqual([1, true]);
    const env = JSON.parse(JSON.stringify(firmEnvelopeOf(f))) as { stores: { layout?: unknown }[] };
    expect(env.stores.map((s) => s.layout)).toEqual([undefined, undefined]);
    const back = opened(restoreFirmFrom(env, SEED));
    for (const [i, st] of back.stores.entries()) {
      expect(st.layout).toEqual(f.stores[i]!.layout);
      expect(st.econ).toEqual(f.stores[i]!.econ);
      expect(st.info).toEqual(f.stores[i]!.info);
    }
  });

  it('wypowiedzenie otwartego sklepu przechodzi przez zapis: oba stany zamykają go w tym samym kroku', () => {
    const a = smallFirm();
    expect(command(a, { type: 'terminateStore', storeId: 1 })).toEqual({ ok: true });
    const { endDay } = a.stores[0]!.notice!;
    playTo(a, 30 * DAY + OPEN_FROM);
    expect(a.stores[0]).toMatchObject({ closed: false, notice: { endDay } });
    const b = opened(viaJson(a));
    expect(b.stores[0]).toMatchObject({ closed: false, notice: { endDay } });
    const closeMinute = (f: FirmState): number => {
      for (let guard = 0; !f.stores[0]!.closed && guard < 60 * DAY; guard++) tick(f);
      return clockOf(f);
    };
    const [minuteA, minuteB] = [closeMinute(a), closeMinute(b)];
    expect(a.stores[0]!.closed).toBe(true);
    expect(b.stores[0]!.closed).toBe(true);
    expect(minuteB).toBe(minuteA);
    expect(minuteA).toBeGreaterThan(endDay * DAY);
    for (let i = 0; i < 1000; i++) {
      tick(a);
      tick(b);
    }
    expect(hashOf(firmEnvelopeOf(b))).toBe(hashOf(firmEnvelopeOf(a)));
    expect(b.activeId).toBe(2);
    expect(b.person.wallet).toBe(a.person.wallet);
  });

  it('premia sieci z mety wygrywa z zapisaną; dochód z sieci ma otwarty sklep o najniższym id (tu #2, bo #1 zamknięty)', () => {
    const partner = { points: 3, networkIncome: 200, stores: 2 };
    const live = structuredClone(scenario());
    const none = opened(viaJson(live));
    expect(none.stores.map((s) => s.econ.partner)).toEqual(live.stores.map((s) => s.econ.partner));   // bez parametru zostaje zapisana
    const f = opened(viaJson(live, partner));
    expect(f.stores[1]!.econ.partner).toEqual(partner);
    expect(f.stores[0]!.econ.partner).toEqual({ points: 0, networkIncome: 0, stores: 0 });   // zamknięty sklep nie dostaje premii
    const two = opened(restoreFirmFrom(smallEnvelope(), SEED, partner));
    expect(two.stores.map((s) => s.econ.partner)).toEqual([partner, { ...partner, networkIncome: 0 }]);
  });

  it('gotówka i Ogonki otwartych sklepów to portfel osoby, także gdy zapis mówi inaczej', () => {
    const env = smallEnvelope();
    env.firm.person.wallet = 4321.5;
    env.firm.person.ogonki = 17;
    env.stores[0].econ.cash = 1;
    const f = opened(restoreFirmFrom(env, SEED));
    expect(f.person).toMatchObject({ wallet: 4321.5, ogonki: 17 });
    for (const st of openStores(f)) expect([st.econ.cash, st.econ.ogonki]).toEqual([4321.5, 17]);
  });

  // Fixture to zamrożony zapis schematu 3 z dzisiejszego kodu: kolejne wersje gry mają go wczytać. Odtwarza go (tylko na wyraźną prośbę):
  // MAKE_FIXTURE=1 npx vitest run src/game/firmSave.test.ts -t "generator"
  it.runIf(Boolean(process.env.MAKE_FIXTURE))('fixture save-v3-dwa-sklepy.json: generator (MAKE_FIXTURE=1)', () => {
    writeFileSync(fixtureUrl('save-v3-dwa-sklepy.json'), JSON.stringify(firmEnvelopeOf(scenario())));
  }, 120_000);

  // Fixture „przed statusem” dla smoke'a przeglądarkowego (scripts/city-smoke.mjs): bot „mistrz” gra firmę (jak w pomiarze ekspansji) do
  // zamknięcia miesiąca, które nadaje status Partnera, a zapis powstaje `STATUS_LEAD_MINUTES` minut wcześniej. Dwa przebiegi z tego samego
  // seeda dają ten sam stan, więc pierwszy podaje minutę statusu, a drugi robi zapis. Odtwarza go (tylko na wyraźną prośbę):
  // MAKE_FIXTURE=1 npx vitest run src/game/firmSave.test.ts -t "przed-statusem"
  it.runIf(Boolean(process.env.MAKE_FIXTURE))('fixture save-v3-przed-statusem.json: generator (MAKE_FIXTURE=1)', () => {
    const { statusMinute } = mistrzToStatus(STATUS_SEED, null);
    const { snapshot } = mistrzToStatus(STATUS_SEED, statusMinute - (STATUS_LEAD_MINUTES - 1));
    writeFileSync(fixtureUrl('save-v3-przed-statusem.json'), snapshot!);
  }, 120_000);

  it('fixture save-v3-przed-statusem.json: schemat 3, jedna firma bez statusu, po 20 minutach gry jest Partner (smoke przeglądarkowy)', () => {
    const raw = json('save-v3-przed-statusem.json');
    expect(raw).toMatchObject({ schema: 3, seed: STATUS_SEED, cityGeneratorVersion: CITY_GENERATOR_VERSION });
    const f = opened(restoreFirmFrom(raw, STATUS_SEED));
    expect(f.stores).toHaveLength(1);
    expect(f.builds).toHaveLength(0);
    expect(f.person.partner).toBe(false);
    expect(f.over).toBeNull();
    const st = activeStore(f);
    expect(st.econ.history).toHaveLength(1);   // wrzesień zamknięty z zyskiem; status przyjdzie z zamknięciem października
    expect(st.econ.history[0]!.profit).toBeGreaterThan(0);
    expect(st.econ.tycoon.trust.value).toBeGreaterThanOrEqual(75);
    expect(awaitingDecision(st.econ)).toBe(false);   // `skip` w smoke nie staje od razu na karcie

    // dopiero dwudziesta minuta daje status: smoke przewija 30 minut i musi trafić w zamknięcie miesiąca
    const out = emptyStepOut();
    for (let i = 0; i < STATUS_LEAD_MINUTES; i++) {
      expect(f.person.partner, `po ${i} minutach`).toBe(false);
      answerActive(f);
      stepFirmMinute(f, out);
    }
    expect(f.person.partner).toBe(true);
    expect(out.firm.filter((e) => e.kind === 'partner')).toHaveLength(1);
    expect(activeStore(f).econ.history).toHaveLength(2);
    expect(activeStore(f).econ.history[1]!.profit).toBeGreaterThan(0);
  });

  it('fixture save-v3-dwa-sklepy.json: schemat 3, wczytuje się jako firma i dalej gra deterministycznie', () => {
    const raw = json('save-v3-dwa-sklepy.json');
    expect(raw).toMatchObject({ schema: 3, seed: SEED, cityGeneratorVersion: CITY_GENERATOR_VERSION });
    const stored = raw.stores as { closed: boolean; layout?: unknown; econ: Record<string, unknown> }[];
    expect(stored.map((s) => [s.closed, s.layout !== undefined])).toEqual([[true, false], [false, false]]);   // układy odtwarzalne z lokalu miasta nie leżą w zapisie
    expect(Object.keys(stored[0]!.econ).sort()).toEqual(['equipment', 'gameOver', 'minute', 'remontLevel', 'seed', 'upgrades', 'version']);
    const f = opened(restoreFirmFrom(raw, SEED));
    expect(f.stores.map((s) => ({ id: s.id, closed: s.closed }))).toEqual([{ id: 1, closed: true }, { id: 2, closed: false }]);
    expect(f.stores[0]!.notice).not.toBeNull();
    expect(f.stores[0]!.econ).toMatchObject({ remontLevel: 1, gameOver: true, upgrades: { szkolenie: 1, wozek: 1 } });
    expect(f.activeId).toBe(2);
    expect(f.stores[1]!.econ.remontLevel).toBe(1);
    expect(f.builds).toHaveLength(1);

    const again = opened(restoreFirmFrom(raw, SEED));
    const { readyDay } = f.builds[0]!;
    for (let i = 0; i < 1000; i++) {
      tick(f);
      tick(again);
    }
    expect(hashOf(firmEnvelopeOf(again))).toBe(hashOf(firmEnvelopeOf(f)));
    expect(f.stores).toHaveLength(3);
    expect(f.stores[2]!.econ.minute).toBeGreaterThanOrEqual(readyDay * DAY + OPEN_FROM);
  }, 60_000);
});

// --- Zepsuta koperta ------------------------------------------------------------------------------------------------

describe('schemat 3: odczyt zepsutej koperty', () => {
  const invalid = { ok: false, reason: 'invalid' } as const;

  it('koperta jest poprawna, zanim ją zepsujemy', () => {
    const f = opened(restoreFirmFrom(smallEnvelope(), SEED));
    expect(f.stores).toHaveLength(2);
    expect(f.activeId).toBe(1);
  });

  it('obcy seed, brak sklepów, brak bloku firmy, sklep nie jest obiektem: invalid', () => {
    expect(restoreFirmFrom(smallEnvelope(), 'inny-seed')).toEqual(invalid);
    expect(restoreFirmFrom({ ...smallEnvelope(), stores: [] }, SEED)).toEqual(invalid);
    expect(restoreFirmFrom({ ...smallEnvelope(), stores: 'tak' }, SEED)).toEqual(invalid);
    expect(restoreFirmFrom({ ...smallEnvelope(), firm: [] }, SEED)).toEqual(invalid);
    expect(restoreFirmFrom({ ...smallEnvelope(), firm: undefined }, SEED)).toEqual(invalid);
    const env = smallEnvelope();
    env.stores[1] = 7;
    expect(restoreFirmFrom(env, SEED)).toEqual(invalid);
  });

  it('sklepy muszą mieć rosnące id, różne lokale z miasta, sklep #1 w lokalu startowym i poprawne econ', () => {
    const mutate = (change: (env: Record<string, any>) => void): FirmOpened => {
      const env = smallEnvelope();
      change(env);
      return restoreFirmFrom(env, SEED);
    };
    expect(mutate((e) => { e.stores[1].lotId = e.stores[0].lotId; })).toEqual(invalid);
    expect(mutate((e) => { e.stores[1].lotId = 99_999; })).toEqual(invalid);
    expect(mutate((e) => { e.stores[1].lotId = 1.5; })).toEqual(invalid);
    expect(mutate((e) => { e.stores[1].id = 1; })).toEqual(invalid);
    expect(mutate((e) => { e.stores[0].id = 2; e.stores[1].id = 3; })).toEqual(invalid);
    const city = generateCity(SEED);
    const elsewhere = city.lots.find((l) => l.id !== city.startLotId && l.id !== smallEnvelope().stores[1].lotId)!.id;
    expect(mutate((e) => { e.stores[0].lotId = elsewhere; })).toEqual(invalid);   // sklep startowy poza lokalem startowym
    expect(mutate((e) => { e.stores[1].closed = 'nie'; })).toEqual(invalid);
    expect(mutate((e) => { e.stores[1].econ = []; })).toEqual(invalid);
    expect(mutate((e) => { e.stores[1].econ.seed = 'cudzy'; })).toEqual(invalid);
    expect(mutate((e) => { e.stores[0].econ.version = 2; })).toEqual(invalid);
  });

  it('activeId, którego nie ma wśród otwartych sklepów, wraca do najniższego otwartego; brak otwartych to invalid', () => {
    const env = smallEnvelope();
    env.firm.activeId = 99;
    expect(opened(restoreFirmFrom(env, SEED)).activeId).toBe(1);
    const closedActive = smallEnvelope();
    closedActive.stores[0].closed = true;
    closedActive.firm.activeId = 1;
    expect(opened(restoreFirmFrom(closedActive, SEED)).activeId).toBe(2);
    const none = smallEnvelope();
    for (const s of none.stores) s.closed = true;
    expect(restoreFirmFrom(none, SEED)).toEqual(invalid);
  });

  it('portfel w granicach LIMITS.money, bez portfela gotówka aktywnego sklepu, reszta osoby z domyślnych', () => {
    const big = smallEnvelope();
    big.firm.person.wallet = 1e300;
    big.firm.person.ogonki = -5;
    expect(opened(restoreFirmFrom(big, SEED)).person).toMatchObject({ wallet: LIMITS.money, ogonki: 0 });
    const debt = smallEnvelope();
    debt.firm.person.wallet = -1e300;
    expect(opened(restoreFirmFrom(debt, SEED)).person.wallet).toBe(-LIMITS.money);

    const bare = smallEnvelope();
    const cash = bare.stores[0].econ.cash as number;
    bare.firm.person = null;
    bare.firm.over = 'cokolwiek';
    bare.firm.monthInvest = 'dużo';
    bare.firm.weatherHash = null;
    const f = opened(restoreFirmFrom(bare, SEED));
    expect(f.person).toEqual({ wallet: cash, ogonki: bare.stores[0].econ.ogonki, partner: false, remanentKnown: f.stores[0]!.econ.franchisee.remanent.known });
    expect(f).toMatchObject({ over: null, monthInvest: 0, weatherHash: f.stores[0]!.econ.seedHash });
  });

  it('budowy tylko dla wolnych lokali miasta: zajęte, własne, zdublowane i uszkodzone wypadają, poprawna zostaje', () => {
    const env = smallEnvelope();
    const f0 = opened(restoreFirmFrom(smallEnvelope(), SEED));
    const free = freeLot(f0);
    const lot = f0.city.lots[free]!;
    env.firm.builds = [
      { lotId: f0.city.startLotId, readyDay: 30, price: 50_000, pay: 'raty' },        // lokal #1
      { lotId: f0.stores[1]!.lotId, readyDay: 30, price: 50_000, pay: 'gotowka' },    // lokal #2
      { lotId: free, readyDay: 31, price: 61_000, pay: 'raty' },                      // wolny
      { lotId: free, readyDay: 32, price: 61_000, pay: 'gotowka' },                   // ten sam, zdublowany
      { lotId: 99_999, readyDay: 30, price: 1, pay: 'raty' },
      { lotId: free + 0.5, readyDay: 30, price: 1, pay: 'raty' },
      { lotId: free, readyDay: 'jutro', price: 1, pay: 'raty' },
      { lotId: free, readyDay: 30, price: 1, pay: 'karta' },
      null, 'budowa',
    ];
    expect(opened(restoreFirmFrom(env, SEED)).builds).toEqual([{ lotId: free, readyDay: 31, price: 61_000, pay: 'raty' }]);
    env.firm.builds = [{ lotId: free, readyDay: 31, price: 'tanio', pay: 'raty' }];
    expect(opened(restoreFirmFrom(env, SEED)).builds).toEqual([{ lotId: free, readyDay: 31, price: lot.package, pay: 'raty' }]);
    env.firm.builds = 'nic';
    expect(opened(restoreFirmFrom(env, SEED)).builds).toEqual([]);
  });

  it('skrzynka: uszkodzone wpisy wypadają, zostaje najwyżej INBOX_MAX ostatnich', () => {
    const env = smallEnvelope();
    const note = (n: number): Record<string, unknown> => ({ day: n, storeId: 2, card: 'k', answer: 0 });
    env.firm.inbox = [...Array.from({ length: INBOX_MAX + 5 }, (_, n) => note(n)), null, { day: 'x' }, { ...note(1), card: 7 }];
    const f = opened(restoreFirmFrom(env, SEED));
    expect(f.inbox).toHaveLength(INBOX_MAX);
    expect(f.inbox[0]).toEqual(note(5));
    expect(f.inbox[INBOX_MAX - 1]).toEqual(note(INBOX_MAX + 4));
  });

  it('uszkodzony układ sklepu powstaje od nowa z lokalu miasta i poziomu remontu (ten sam co przed zapisem)', () => {
    const live = scenario();
    const env = JSON.parse(JSON.stringify(firmEnvelopeOf(live))) as Record<string, any>;
    expect(env.stores[1].layout).toBeUndefined();   // koperta nie niesie układu, który odtworzy generator
    env.stores[1].layout = { ...live.stores[1]!.layout, cells: 'nie siatka' };
    const f = opened(restoreFirmFrom(env, SEED));
    expect(f.stores[1]!.econ.remontLevel).toBe(1);
    expect(f.stores[1]!.layout).toEqual(live.stores[1]!.layout);
    env.stores[0].layout = 'płaski';   // zamknięty sklep nie niesie układu: cokolwiek tu leży, układ i tak wraca z lokalu miasta
    expect(opened(restoreFirmFrom(env, SEED)).stores[0]!.layout).toEqual(live.stores[0]!.layout);
  });

  it('otwarte sklepy w różnych minutach to invalid (zegary sklepów chodzą razem); zamknięty może stać w swojej', () => {
    const skewed = smallEnvelope();
    skewed.stores[1].econ.minute += 1;
    expect(restoreFirmFrom(skewed, SEED)).toEqual(invalid);
    const far = smallEnvelope();
    far.stores[0].econ.minute -= 3 * DAY;
    expect(restoreFirmFrom(far, SEED)).toEqual(invalid);
    const closed = smallEnvelope();
    closed.stores[0].closed = true;
    closed.stores[0].econ.minute -= 3 * DAY;
    const f = opened(restoreFirmFrom(closed, SEED));
    expect(f.stores[0]).toMatchObject({ closed: true });
    expect(f.stores[0]!.econ.minute).toBe(closed.stores[0].econ.minute);
    expect(f.stores[1]!.econ.minute).toBe(closed.stores[1].econ.minute);
  });

  it('otwarty sklep bez układu: odtwarzany tylko bieżącym generatorem (inny to unbuildable, bez liczby invalid)', () => {
    const env = smallEnvelope();
    expect(env.stores[1].layout).toBeUndefined();
    expect(opened(restoreFirmFrom(env, SEED)).stores[1]!.layout.generatorVersion).toBe(GENERATOR_VERSION);
    for (const other of [GENERATOR_VERSION + 1, GENERATOR_VERSION - 1]) {
      const changed = smallEnvelope();
      changed.stores[1].generatorVersion = other;
      expect(restoreFirmFrom(changed, SEED)).toEqual({ ok: false, reason: 'unbuildable' });
    }
    for (const bad of ['1', 1.5, null, undefined]) {
      const garbage = smallEnvelope();
      garbage.stores[1].generatorVersion = bad;
      expect(restoreFirmFrom(garbage, SEED)).toEqual(invalid);
    }
    // z zapisanym układem wersja generatora niczego nie blokuje: układ jest, nie trzeba go odtwarzać
    const withLayout = smallEnvelope();
    withLayout.stores[1].layout = layoutFor(storeSeedFor(SEED, withLayout.stores[1].lotId), 0, generateCity(SEED).lots[withLayout.stores[1].lotId]!.spec);
    withLayout.stores[1].generatorVersion = GENERATOR_VERSION + 1;
    expect(opened(restoreFirmFrom(withLayout, SEED)).stores[1]!.layout).toEqual(withLayout.stores[1].layout);
  });

  it('wersje miasta: 0 i śmieci to invalid, inna niż w kodzie to poprawny zapis, którego świata nie złożymy (unbuildable)', () => {
    for (const bad of [0, -1, 1.5, 'jeden', null, undefined]) expect(restoreFirmFrom({ ...smallEnvelope(), cityGeneratorVersion: bad }, SEED)).toEqual(invalid);
    expect(restoreFirmFrom({ ...smallEnvelope(), cityGeneratorVersion: CITY_GENERATOR_VERSION + 1 }, SEED)).toEqual({ ok: false, reason: 'unbuildable' });
  });
});

describe('isNewerSave', () => {
  it('schemat wyższy niż 3 albo miasto z nowszego generatora to zapis z nowszej wersji gry; reszta nie', () => {
    expect(isNewerSave({ schema: 4 })).toBe(true);
    expect(isNewerSave({ schema: 99, seed: 'x' })).toBe(true);
    expect(isNewerSave({ schema: 3, cityGeneratorVersion: CITY_GENERATOR_VERSION + 1 })).toBe(true);
    expect(isNewerSave({ schema: 3, cityGeneratorVersion: CITY_GENERATOR_VERSION })).toBe(false);
    expect(isNewerSave({ schema: 3 })).toBe(false);
    expect(isNewerSave({ schema: 2, cityGeneratorVersion: 99 })).toBe(false);
    expect(isNewerSave({ version: 1 })).toBe(false);
    expect(isNewerSave({ schema: 'cztery' })).toBe(false);
    expect(isNewerSave(null)).toBe(false);
    expect(isNewerSave([])).toBe(false);
  });
});

// --- Sesja: odczyt schematu 3 -------------------------------------------------------------------------------------------

describe('sesja: odczyt zapisu schematu 3 (createSession)', () => {
  it('sesja to aktywny sklep (ten sam obiekt econ, układ i info), a cała firma leży w session.firm', () => {
    storage.setItem(key(SEED), text('save-v3-dwa-sklepy.json'));
    const s = createSession(SEED);
    expect(s).toMatchObject({ seed: SEED, mode: 'casual', fromSave: true, loadNotice: null, ephemeral: false, run: null, layoutLevel: 1 });
    const f = s.firm!;
    expect(f).toBeDefined();
    expect(f.activeId).toBe(2);
    expect(s.econ).toBe(activeStore(f).econ);
    expect(s.layout).toBe(activeStore(f).layout);
    expect(s.info).toBe(activeStore(f).info);
    expect(s.econ.seed).not.toBe(SEED);   // sklep w lokalu miasta ma seed z lokalu, nie z gry
    expect(s.clock).toEqual({ acc: 0 });
  });

  it('premia sieci z mety jest aktualna przy każdym wczytaniu', () => {
    storage.setItem(key(SEED), text('save-v3-dwa-sklepy.json'));
    const partner = { points: 9, networkIncome: 40, stores: 3 };
    const s = createSession(SEED, false, partner);
    expect(s.econ.partner).toEqual(partner);
    expect(s.firm!.stores[0]!.econ.partner).toEqual({ points: 0, networkIncome: 0, stores: 0 });   // zamknięty #1 nie dostaje premii
  });

  it('stary zapis (schemat 2) otwiera się jak dotąd, bez firmy w sesji', () => {
    storage.setItem(key('traszka-v2-a'), text('save-v2-dzien30.json'));
    const s = createSession('traszka-v2-a');
    expect(s.fromSave).toBe(true);
    expect(s.firm).toBeUndefined();
  });

  it('schemat 4 albo miasto z nowszego generatora: NEWER_SAVE_NOTICE, sklep tymczasowy i zapis nienadpisany', () => {
    const base = json('save-v3-dwa-sklepy.json');
    for (const newer of [{ ...base, schema: 4 }, { ...base, cityGeneratorVersion: 2 }, { schema: 4 }]) {
      const raw = JSON.stringify(newer);
      storage.clear();
      storage.setItem(key(SEED), raw);
      const s = createSession(SEED);
      expect(s.loadNotice).toBe(NEWER_SAVE_NOTICE);
      expect(s.ephemeral).toBe(true);
      expect(s.fromSave).toBe(false);
      expect(s.firm).toBeUndefined();
      expect(storage.getItem(key(SEED))).toBe(raw);
      expect(storage.getItem(`${key(SEED)}:broken`)).toBeNull();
      expect(hasStoredSave(SEED)).toBe(true);
    }
  });

  it('zepsuty schemat 3 idzie do :broken, sklep startuje od nowa', () => {
    const broken = { ...json('save-v3-dwa-sklepy.json'), stores: 'nic' };
    const raw = JSON.stringify(broken);
    storage.setItem(key(SEED), raw);
    const s = createSession(SEED);
    expect(s.loadNotice).toBe(BROKEN_SAVE_NOTICE);
    expect(s.fromSave).toBe(false);
    expect(s.ephemeral).toBe(false);
    expect(s.firm).toBeUndefined();
    expect(storage.getItem(`${key(SEED)}:broken`)).toBe(raw);
    expect(storage.getItem(key(SEED))).toBeNull();
  });

  it('schemat 3 zapisu cudzego seeda to zepsuty zapis, nie czyjś sklep', () => {
    storage.setItem(key('inny-seed'), text('save-v3-dwa-sklepy.json'));
    expect(createSession('inny-seed').loadNotice).toBe(BROKEN_SAVE_NOTICE);
  });

  it('zapis biegu rankingowego dalej ma schemat 2 i wczytuje się bez zmian', () => {
    const s = createRankedSession('rankingowy-1');
    s.econ.cash += 10;
    expect(saveRanked(s)).toBe(true);
    const stored = JSON.parse(storage.getItem(RANKED_KEYS.active)!) as { save: { schema: number } };
    expect(stored.save.schema).toBe(2);
    const back = loadRanked();
    expect(back.status).toBe('ok');
    if (back.status === 'ok') {
      expect(back.session.econ).toEqual(s.econ);
      expect(back.session.firm).toBeUndefined();
    }
  });
});

// --- Ponowny wynajem lokalu „po Traszce” ----------------------------------------------------------------------------------

/** Scenariusz bez własnej budowy: #1 zamknięty z wyposażeniem i remontem (lokal startowy „po Traszce”), aktywny #2, który już ma remont. */
function reletFirm(): FirmState {
  const f = structuredClone(scenario());
  f.builds = [];
  return f;
}

/** Wynajem lokalu startowego „po Traszce” na raty i gra do pierwszej minuty po otwarciu sklepu (`tick` w minucie odbioru otwiera budowę). */
function reopenStart(f: FirmState): number {
  const start = f.city.startLotId;
  expect(lotState(f, start)).toBe('po-traszce');
  expect(command(f, { type: 'rentLot', lotId: start, pay: 'raty' })).toEqual({ ok: true });
  const ready = f.builds[0]!.readyDay * DAY + OPEN_FROM;
  playTo(f, ready);
  tick(f);
  expect(f.builds).toEqual([]);
  expect(f.stores[0]!.closed).toBe(false);
  return ready;
}

/**
 * Para lokali S i Y: Y leży po stronie przejęcia sklepu w wolnym lokalu S (remont poziomu 1 dokupuje Y, §7.2), a generator zbuduje sklep w obu.
 * Generator nie stawia wolnych lokali obok siebie (każdy wolny w innym kwartale), więc w teście Y trzeba oznaczyć jako wolny (jak w `relet.test.ts`).
 */
function neighbourPair(): { seed: string; s: number; y: number } {
  for (const seed of [SEED, ...Array.from({ length: 10 }, (_, i) => `miasto-${i}`)]) {
    const city = generateCity(seed);
    for (const lot of city.lots.filter((l) => l.state === 'wolny')) {
      const storeSeed = storeSeedFor(seed, lot.id);
      const side = takeoverSide(layoutFor(storeSeed, 0, lot.spec), storeSeed);
      const y = side === null ? null : lotNeighbour(city, lot.id, side);
      if (y === null || y.state !== 'zajety') continue;
      try {
        layoutFor(storeSeedFor(seed, y.id), 0, y.spec);
      } catch {
        continue;   // generator sklepu bywa bezradny wobec rzadkiej kombinacji wymiarów
      }
      return { seed, s: lot.id, y: y.id };
    }
  }
  throw new Error('żaden seed nie ma pary sąsiednich lokali do zbudowania');
}

describe('ponowny wynajem lokalu „po Traszce” a zapis', () => {
  it('Review Focus 2: zapis z budową w lokalu „po Traszce” wraca z tą budową (stan budowa), a sklep otwiera się w jej dniu z tym samym wyposażeniem co bez zapisu', () => {
    const a = reletFirm();
    const start = a.city.startLotId;
    const lot = a.city.lots[start]!;
    const price = Math.round(lot.package * RELET_SHARE / 100) * 100;
    expect(rentPrice(a, start)).toBe(price);
    expect(command(a, { type: 'rentLot', lotId: start, pay: 'raty' })).toEqual({ ok: true });
    const build = a.builds[0]!;
    expect(build).toEqual({ lotId: start, readyDay: Math.floor(clockOf(a) / DAY) + RELET_BUILD_DAYS, price, pay: 'raty' });
    expect(lotState(a, start)).toBe('budowa');

    const raw = JSON.parse(JSON.stringify(firmEnvelopeOf(a))) as { firm: { builds: unknown[] } };
    expect(raw.firm.builds).toEqual([build]);
    const b = opened(restoreFirmFrom(raw, SEED));
    expect(b.builds).toEqual([build]);
    expect(lotState(b, start)).toBe('budowa');   // zamknięty sklep w lokalu nie przykrywa budowy
    expect(b.stores[0]).toMatchObject({ id: 1, lotId: start, closed: true });
    expect(b.stores[0]!.layout).toEqual(a.stores[0]!.layout);

    const fittings = (f: FirmState): string => JSON.stringify([f.stores[0]!.econ.upgrades, f.stores[0]!.econ.equipment, f.stores[0]!.econ.remontLevel]);
    const before = fittings(a);
    expect(fittings(b)).toBe(before);   // `ClosedFittings` oddały to samo wyposażenie, co żywy zamknięty sklep
    expect(a.stores[0]!.econ.equipment.map((e) => e.id)).toEqual(['sco', 'bankomat']);
    expect(a.stores[0]!.econ.remontLevel).toBe(1);

    const ready = build.readyDay * DAY + OPEN_FROM;
    for (const f of [a, b]) {
      playTo(f, ready - 1);
      expect(f.stores[0]!.closed, 'dzień przed odbiorem').toBe(true);
      playTo(f, ready);
      tick(f);   // w minucie odbioru firma otwiera budowę przed krokiem sklepów
      expect(f.stores[0]).toMatchObject({ id: 1, closed: false, notice: null, reopened: true });
      expect(f.builds).toEqual([]);
      expect(fittings(f)).toBe(before);   // ten sam sprzęt i ulepszenia, które sklep miał przed zamknięciem
      expect(f.stores[0]!.econ.level).toBe(1);
      expect(fitsStore(f.stores[0]!.econ, f.stores[0]!.info)).toBe(true);
    }
    expect(hashOf(b.stores[0]!.econ)).toBe(hashOf(a.stores[0]!.econ));   // z zapisem i bez niego ten sam sklep, minuta w minutę
    for (let i = 0; i < 300; i++) {
      tick(a);
      tick(b);
      if (i % 100 === 99) expect(hashOf(firmEnvelopeOf(b))).toBe(hashOf(firmEnvelopeOf(a)));
    }
    expect(hashOf(firmEnvelopeOf(b))).toBe(hashOf(firmEnvelopeOf(a)));
  }, 120_000);

  it('Review Focus 1: `reopened` przeżywa zapis, a #1 ponownie wynajęty (też jako jedyny sklep) ma po odczycie seed gry i `site.extra`', () => {
    const a = reletFirm();
    reopenStart(a);
    const env = firmEnvelopeOf(a);
    expect(env.stores.map((s) => ('reopened' in s ? s.reopened : null))).toEqual([true, null]);   // klucz tylko przy sklepie po ponownym wynajmie
    const text = JSON.stringify(env);
    expect((JSON.parse(text) as { stores: { reopened?: boolean }[] }).stores.map((s) => s.reopened)).toEqual([true, undefined]);

    const back = opened(restoreFirmFrom(JSON.parse(text), SEED));
    expect(back.stores.map((s) => ({ id: s.id, closed: s.closed, reopened: s.reopened }))).toEqual([
      { id: 1, closed: false, reopened: true }, { id: 2, closed: false, reopened: undefined },
    ]);
    const st = back.stores[0]!;
    expect(st.econ.seed).toBe(SEED);
    expect(st.layout).toEqual(a.stores[0]!.layout);
    expect(st.info).toEqual(a.stores[0]!.info);
    expect(st.info.site).toMatchObject({ extra: true, ownCosts: true, firmDebt: true });
    expect(st.econ).toEqual(a.stores[0]!.econ);
    expect(JSON.parse(JSON.stringify(firmEnvelopeOf(back)))).toEqual(JSON.parse(text));   // save -> load -> save bez zmian

    // po zamknięciu #2 sklep #1 jest jedynym otwartym i dalej ma `site` z flagą dodatkowego (nie „sklep jak dziś”): zapis tego nie zmienia
    for (const f of [a, back]) {
      closeStore(f, 2, 'trust', emptyStepOut());
      expect(openStores(f).map((s) => s.id)).toEqual([1]);
      expect(f.stores[0]!.info.site).toMatchObject({ extra: true, ownCosts: true, firmDebt: false });
    }
    const alone = opened(viaJson(back));
    expect(alone.stores[0]!.reopened).toBe(true);
    expect(alone.stores[0]!.info.site).toMatchObject({ extra: true, ownCosts: true, firmDebt: false });
    expect(alone.stores[0]!.info).toEqual(back.stores[0]!.info);

    // bez flagi ten sam jedyny sklep startowy wraca bez `site`
    const plain = JSON.parse(JSON.stringify(firmEnvelopeOf(back))) as { stores: { reopened?: boolean }[] };
    delete plain.stores[0]!.reopened;
    expect(opened(restoreFirmFrom(plain, SEED)).stores[0]!.info.site).toBeUndefined();
  }, 120_000);

  it('budowy w zapisie: lokal „po Traszce” przyjmuje się jak wolny (dubel odpada), a brakująca cena to cena po Traszce', () => {
    const env = JSON.parse(JSON.stringify(firmEnvelopeOf(reletFirm()))) as Record<string, any>;
    const start = generateCity(SEED).startLotId;
    const lot = generateCity(SEED).lots[start]!;
    const price = Math.round(lot.package * RELET_SHARE / 100) * 100;
    env.firm.builds = [{ lotId: start, readyDay: 90, pay: 'raty' }, { lotId: start, readyDay: 91, price: 1, pay: 'gotowka' }];
    expect(opened(restoreFirmFrom(env, SEED)).builds).toEqual([{ lotId: start, readyDay: 90, price, pay: 'raty' }]);
    env.firm.builds = [{ lotId: start, readyDay: 90, price: 12_300, pay: 'gotowka' }];
    expect(opened(restoreFirmFrom(env, SEED)).builds).toEqual([{ lotId: start, readyDay: 90, price: 12_300, pay: 'gotowka' }]);
    // lokal otwartego sklepu to nadal nie jest lokal do wynajęcia
    env.firm.builds = [{ lotId: env.stores[1].lotId, readyDay: 90, pay: 'raty' }];
    expect(opened(restoreFirmFrom(env, SEED)).builds).toEqual([]);
  });

  it('budowa w lokalu zamkniętego sklepu, którego układ po remoncie zajmuje lokal obok Twojego sklepu, odpada przy odczycie tak samo jak odmowa wynajmu', () => {
    const { seed, s: lotS, y: lotY } = neighbourPair();
    /** Zamknięty #2 w lokalu S (remont poziomu `level`) i sąsiad Y jako #3, otwarty albo zamknięty. Żywa firma ma Y oznaczone jako wolny (generator tak nie robi). */
    const world = (level: 0 | 1, yOpen: boolean): FirmState => {
      const f = newFirm(seed);
      f.person.partner = true;
      f.city.lots[lotY]!.state = 'wolny';
      const closed = openStoreAt(f, lotS, clockOf(f));
      if (level === 1) {
        expect(command(f, { type: 'switchStore', storeId: closed.id })).toEqual({ ok: true });
        remont(f, 8);
        expect(closed.econ.remontLevel).toBe(1);
      }
      closeStore(f, closed.id, 'trust', emptyStepOut());
      const next = openStoreAt(f, lotY, clockOf(f));
      if (!yOpen) closeStore(f, next.id, 'trust', emptyStepOut());
      syncWallet(f);
      return f;
    };
    const lot = generateCity(seed).lots[lotS]!;
    const price = Math.round(lot.package * RELET_SHARE / 100) * 100;
    const build = { lotId: lotS, readyDay: 90, pay: 'raty' as const };
    const loaded = (f: FirmState): FirmState['builds'] => {
      const env = JSON.parse(JSON.stringify(firmEnvelopeOf(f))) as { firm: { builds: unknown[] } };
      env.firm.builds = [build];
      return opened(restoreFirmFrom(env, seed)).builds;
    };

    // sąsiad Y jest Twoim otwartym sklepem, a układ zamkniętego sklepu zajmuje Y: odmowa wynajmu i budowa wypada z zapisu
    const taken = world(1, true);
    expect(lotState(taken, lotY)).toBe('twoj');
    expect(rentRefusal(taken, lotS, 'raty')).toBe('lot');
    expect(loaded(taken)).toEqual([]);
    // sąsiad zamknięty (nie jest Twój): wynajem przechodzi i budowa wraca z zapisu z ceną po Traszce
    const free = world(1, false);
    expect(rentRefusal(free, lotS, 'raty')).toBeNull();
    expect(loaded(free)).toEqual([{ ...build, price }]);
    // sklep zamknięty bez remontu nie zajmuje sąsiada układem: przechodzi mimo Twojego sklepu obok
    const level0 = world(0, true);
    expect(lotState(level0, lotY)).toBe('twoj');
    expect(rentRefusal(level0, lotS, 'raty')).toBeNull();
    expect(loaded(level0)).toEqual([{ ...build, price }]);
  }, 60_000);

  it('koperty fixtures (schemat 3) po wczytaniu i zapisie nie mają klucza `reopened`', () => {
    const names = readdirSync(new URL('./fixtures/', import.meta.url)).filter((n) => n.startsWith('save-v3-'));
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const name of names) {
      const raw = json(name) as { schema: number; seed: string; stores: object[] };
      expect(raw.schema, name).toBe(3);
      expect(raw.stores.some((s) => 'reopened' in s), name).toBe(false);
      const f = opened(restoreFirmFrom(raw, raw.seed));
      expect(f.stores.some((s) => s.reopened !== undefined || 'reopened' in s), name).toBe(false);
      const saved = JSON.stringify(firmEnvelopeOf(f));
      expect(saved, name).not.toContain('reopened');
    }
  });
});

// --- Rozmiar ------------------------------------------------------------------------------------------------------------

/** Dwa remonty (poziom 8, potem 14) kolejnym sklepom z listy: każdy w swoim czasie jest aktywny, a remont kosztuje z portfela osoby. */
function remontEach(f: FirmState, ids: number[], level: number): void {
  for (const id of ids) {
    expect(command(f, { type: 'switchStore', storeId: id })).toEqual({ ok: true });
    remont(f, level);
  }
}

/** Wolny lokal z największym układem po trzecim remoncie (najcięższy sklep, jaki da się wynająć). */
function largestFreeLot(f: FirmState): number {
  const size = (id: number): number => layoutFor(storeSeedFor(f.seed, id), 3, f.city.lots[id]!.spec).cells.length;
  const free = f.city.lots.filter((l) => lotState(f, l.id) === 'wolny');
  return free.reduce((best, l) => (size(l.id) > size(best.id) ? l : best)).id;
}

/** Firma po wynajmie drugiego sklepu w dniu 3 (domyślnie w pierwszym wolnym lokalu): oba sklepy działają, aktywny jest #1. */
function twoOpenStores(seed = SEED, lot: (f: FirmState) => number = freeLot): FirmState {
  const f = newFirm(seed);
  f.person.partner = true;
  playTo(f, 3 * DAY + OPEN_FROM);
  expect(command(f, { type: 'rentLot', lotId: lot(f), pay: 'raty' })).toEqual({ ok: true });
  playTo(f, f.builds[0]!.readyDay * DAY + OPEN_FROM + 1);
  expect(f.stores).toHaveLength(2);
  expect(command(f, { type: 'switchStore', storeId: 1 })).toEqual({ ok: true });
  return f;
}

/**
 * Gra do minuty `minute` z krokami firmy. Karty zaznaczone z góry potrafią wyzerować zaufanie sklepu w ciągu roku i Centrala zamyka go
 * (§13.1), a te testy chcą sklepów, które przetrwają: o północy zaufanie nie spada poniżej 70.
 */
function playHoldingTrust(f: FirmState, minute: number): void {
  while (clockOf(f) < minute && f.over === null && !activeStore(f).econ.gameOver) {
    if (clockOf(f) % DAY === 0) for (const st of openStores(f)) st.econ.tycoon.trust.value = Math.max(st.econ.tycoon.trust.value, 70);
    tick(f);
  }
}

/**
 * Najgorszy przypadek 4a.1: dwa sklepy, każdy po trzech remontach (wszystkie poziomy `REMONTS`), drugi w największym wolnym lokalu,
 * koniec drugiego roku (731 dni prawdziwych kroków: 2028 jest przestępny). Oba sklepy z historią dwudziestu czterech miesięcy, ratą pakietu, pełną skrzynką
 * zastępcy.
 */
function playWorstCase(seed: string): FirmState {
  const f = twoOpenStores(seed, largestFreeLot);
  remontEach(f, [1, 2], 8);
  playHoldingTrust(f, 20 * DAY + OPEN_FROM);
  remontEach(f, [1, 2], 14);
  playHoldingTrust(f, 30 * DAY + OPEN_FROM);
  remontEach(f, [1, 2], 20);
  expect(f.stores.map((s) => s.econ.remontLevel)).toEqual([3, 3]);
  playHoldingTrust(f, 731 * DAY + OPEN_FROM);
  return f;
}

/**
 * Najgorszy przypadek 4a.2 (limit trzech sklepów): trzy otwarte sklepy w największych wolnych lokalach, każdy po dwóch remontach
 * (poziom 8, potem 14), koniec roku (365 dni prawdziwych kroków). Trzeci sklep powstaje prawdziwym wynajmem i budową.
 */
function playThreeOpenStores(): FirmState {
  const f = twoOpenStores(SEED, largestFreeLot);
  expect(command(f, { type: 'rentLot', lotId: largestFreeLot(f), pay: 'raty' })).toEqual({ ok: true });
  playHoldingTrust(f, f.builds[0]!.readyDay * DAY + OPEN_FROM + 1);
  expect(openStores(f)).toHaveLength(3);
  remontEach(f, [1, 2, 3], 8);
  playHoldingTrust(f, clockOf(f) + 10 * DAY);
  remontEach(f, [1, 2, 3], 14);
  playHoldingTrust(f, 365 * DAY + OPEN_FROM);
  return f;
}

/**
 * Zamknięte sklepy gromadzą się (zamknięcie i ponowny wynajem), więc lista sklepów w zapisie bywa dłuższa niż limit sklepów: #1 z
 * wyposażeniem i dwoma remontami wypowiedziany i zamknięty, potem #2 i #3 otwarte, każdy po dwóch remontach, koniec roku.
 */
function playWithClosedStore(): FirmState {
  const f = twoOpenStores();
  fit(f);
  remontEach(f, [1, 2], 8);
  playTo(f, 20 * DAY + OPEN_FROM);
  remontEach(f, [1, 2], 14);
  playTo(f, 25 * DAY + OPEN_FROM);
  expect(command(f, { type: 'switchStore', storeId: 2 })).toEqual({ ok: true });
  expect(command(f, { type: 'terminateStore', storeId: 1 })).toEqual({ ok: true });
  for (let guard = 0; !f.stores[0]!.closed && guard < 90 * DAY; guard++) tick(f);
  expect(f.stores[0]!.closed).toBe(true);
  expect(command(f, { type: 'rentLot', lotId: freeLot(f), pay: 'raty' })).toEqual({ ok: true });
  playTo(f, f.builds[0]!.readyDay * DAY + OPEN_FROM + 1);
  expect(f.stores).toHaveLength(3);
  remontEach(f, [3], 8);
  playTo(f, clockOf(f) + 10 * DAY);
  remontEach(f, [3], 14);
  playTo(f, 365 * DAY + OPEN_FROM);
  return f;
}

const bytes = (x: unknown): number => new TextEncoder().encode(JSON.stringify(x)).length;

/**
 * Paczka „Wyślij zapis” z kopertą firmy i metą ze średnio rozbudowaną siecią sklepów (12 wpisów); drukuje rozmiar (i ile bajtów zjadłyby
 * układy, które zapis pomija) i zwraca bajty paczki.
 */
function transferSize(label: string, f: FirmState): number {
  const meta: Meta = {
    version: 1, partnerPoints: 120, network: Array.from({ length: 12 }, (_, n) => ({ seed: `stary-sklep-${n}`, income: 400, level: 21, margin: 90_000 })),
    daily: { date: '2026-10-27', streak: 4 }, lastSeen: 1_790_000_000_000, sound: true, vibration: true,
    player: { nick: 'Mateusz', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true },
  };
  const bundle = { format: TRANSFER_FORMAT, version: 1, seed: f.seed, meta, save: firmEnvelopeOf(f) };
  const total = bytes(bundle);
  const perStore = bundle.save.stores.map((s) => `${bytes(s)}${s.closed ? ' zamknięty' : ` (ekonomia ${bytes(s.econ)})`}`);
  const omitted = f.stores.reduce((n, st, i) => n + (bundle.save.stores[i]!.closed || 'layout' in bundle.save.stores[i]! ? 0 : bytes(st.layout)), 0);
  console.log(`${label}: paczka ${total} B z ${SAVE_TRANSFER_MAX_BYTES} B (zapis ${bytes(bundle.save)} B, meta ${bytes(meta)} B, skrzynka ${f.inbox.length} wpisów); sklepy: ${perStore.join(' + ')} B; pominięte układy: ${omitted} B.`);
  return total;
}

describe('rozmiar paczki „Wyślij zapis”', () => {
  it.each([SEED, 'x2'])('dwa sklepy po trzech remontach, drugi w największym wolnym lokalu, koniec drugiego roku (%s): mieszczą się w 64 KB', (seed) => {
    const f = playWorstCase(seed);
    expect(f.over).toBeNull();
    expect(openStores(f)).toHaveLength(2);
    expect(f.stores.map((s) => s.econ.history.length)).toEqual([24, 24]);
    expect(f.stores[1]!.layout.cells.length).toBeGreaterThan(f.stores[0]!.layout.cells.length / 2);   // test nie jest pusty: to duży układ
    const total = transferSize(`Zapis schematu 3 (${seed}), dwa sklepy po trzech remontach, 731 dni`, f);
    expect(total).toBeLessThanOrEqual(SAVE_TRANSFER_MAX_BYTES);
    expect(f.inbox.length).toBeGreaterThan(0);
    expect(firmEnvelopeOf(f).stores.map((s) => 'layout' in s)).toEqual([false, false]);   // układy są odtwarzalne, więc zapis ich nie niesie

    // zwarta koperta wraca do tego samego sklepu
    const back = opened(viaJson(f));
    expect(back.stores.map((s) => s.layout)).toEqual(f.stores.map((s) => s.layout));
    expect(JSON.stringify(firmEnvelopeOf(back))).toBe(JSON.stringify(firmEnvelopeOf(f)));
  }, 90_000);

  it('zamknięty sklep w zapisie jest zwarty: #1 zamknięty, #2 i #3 po dwóch remontach na koniec roku też mieszczą się w 64 KB', () => {
    const f = playWithClosedStore();
    expect(f.over).toBeNull();
    expect(f.stores.map((s) => [s.id, s.closed, s.econ.remontLevel])).toEqual([[1, true, 2], [2, false, 2], [3, false, 2]]);
    const total = transferSize('Zapis schematu 3, #1 zamknięty, #2 i #3 po dwóch remontach, 365 dni', f);
    const closed = firmEnvelopeOf(f).stores[0]!;
    expect(closed.closed).toBe(true);
    expect('layout' in closed).toBe(false);
    expect(bytes(closed)).toBeLessThan(1024);   // wyposażenie i flagi, bez układu i ekonomii
    expect(total).toBeLessThanOrEqual(SAVE_TRANSFER_MAX_BYTES);

    // zwarty zapis wraca: ten sam zestaw sklepów, wyposażenie zamkniętego #1 i idempotentna koperta
    const back = opened(viaJson(f));
    expect(back.stores.map((s) => [s.id, s.closed, s.econ.remontLevel])).toEqual([[1, true, 2], [2, false, 2], [3, false, 2]]);
    expect(back.stores[0]!.econ.upgrades).toEqual(f.stores[0]!.econ.upgrades);
    expect(back.stores[0]!.econ.equipment).toEqual(f.stores[0]!.econ.equipment);
    expect(JSON.stringify(firmEnvelopeOf(back))).toBe(JSON.stringify(firmEnvelopeOf(f)));
  }, 60_000);

  it('trzy otwarte sklepy, każdy po dwóch remontach, koniec roku: paczka mieści się w 64 KB i wraca z tą samą kopertą', () => {
    const f = playThreeOpenStores();
    expect(f.over).toBeNull();
    expect(f.stores.map((s) => [s.id, s.closed, s.econ.remontLevel])).toEqual([[1, false, 2], [2, false, 2], [3, false, 2]]);
    expect(f.stores.map((s) => s.econ.history.length)).toEqual([12, 12, 12]);   // przeszedł cały rok: dwanaście zamkniętych miesięcy w każdym
    const total = transferSize('Zapis schematu 3, trzy otwarte sklepy po dwóch remontach, 365 dni', f);
    expect(total).toBeLessThanOrEqual(SAVE_TRANSFER_MAX_BYTES);
    expect(firmEnvelopeOf(f).stores.map((s) => 'layout' in s)).toEqual([false, false, false]);   // układy są odtwarzalne, więc zapis ich nie niesie

    // zwarta koperta wraca do tych samych trzech sklepów i jest idempotentna
    const back = opened(viaJson(f));
    expect(back.stores.map((s) => [s.id, s.closed, s.econ.remontLevel])).toEqual([[1, false, 2], [2, false, 2], [3, false, 2]]);
    expect(back.stores.map((s) => s.layout)).toEqual(f.stores.map((s) => s.layout));
    expect(JSON.stringify(firmEnvelopeOf(back))).toBe(JSON.stringify(firmEnvelopeOf(f)));
  }, 180_000);
});

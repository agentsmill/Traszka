import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCity } from '@/sim/city/generateCity';
import { CITY_GENERATOR_VERSION } from '@/sim/city/types';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type EconomyState } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { LIMITS } from '@/sim/economy/sanitize';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { applyFirmCommand, lotState } from '@/sim/firm/commands';
import {
  activeStore, applyStoreCommand, createFirm, emptyStepOut, grantToFirm, openStoreAt, openStores, stepFirmMinute,
} from '@/sim/firm/firm';
import { INBOX_MAX, type FirmState, type FirmStepOut } from '@/sim/firm/types';
import { freshRun } from '@/sim/run';
import { layoutFor } from '@/sim/store/layoutFor';
import { SAVE_MAX_BYTES } from '@/server/config';
import { TRANSFER_FORMAT } from '@/ui/ranking/saveTransfer';
import { DEFAULT_CASHIER_LOOK } from './cashier';
import { FIRM_SAVE_SCHEMA, SAVE_TRANSFER_MAX_BYTES, firmEnvelopeOf, isNewerSave, restoreFirmFrom, type FirmOpened } from './firmSave';
import { MemoryStorage } from './memoryStorage';
import type { Meta } from './meta';
import { RANKED_KEYS, createRankedSession, loadRanked, saveRanked } from './rankedRun';
import {
  BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, SAVE_SCHEMA, createSession, hasStoredSave, restoreSessionFrom, type GameSession,
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

/**
 * Firma w stanie, który zapis musi unieść: sklep #1 wypowiedziany i zamknięty (wypowiedzenie zostaje w zapisie), aktywny #2 po
 * remoncie, na koniec nowa budowa w toku. Wszystko prawdziwymi poleceniami i krokami, z jedynym skrótem: status Partnera nadany
 * od razu. Zapis powstaje w wieczór przed dniem otwarcia budowy.
 */
function playScenario(): FirmState {
  const f = newFirm();
  f.person.partner = true;
  playTo(f, 3 * DAY + OPEN_FROM);
  expect(command(f, { type: 'rentLot', lotId: freeLot(f), pay: 'raty' })).toEqual({ ok: true });
  playTo(f, f.builds[0]!.readyDay * DAY + OPEN_FROM + 1);
  expect(f.stores).toHaveLength(2);
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

// --- Schemat 1 i 2: sklep z zapisu to sklep #1 ------------------------------------------------------------------------

const LEGACY = [
  'save-v1-blok-dzien40.json', 'save-v1-remont1.json', 'save-v2-dzien30.json', 'save-v2-remont2.json', 'save-sim4-palety.json',
  'save-sim5-polowa-miesiaca.json',
];

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
    expect(f.builds).toHaveLength(1);
    expect(lotState(f, f.builds[0]!.lotId)).toBe('budowa');
    expect(lotState(f, f.stores[0]!.lotId)).toBe('po-traszce');
  });

  it('koperta: seed, wersje, osoba, budowy i skrzynka, a w sklepach tylko lotId, układ, econ i flagi (bez miasta i info)', () => {
    const f = scenario();
    const env = firmEnvelopeOf(f);
    expect(env).toMatchObject({ schema: 3, gameVersion: GAME_VERSION, cityGeneratorVersion: CITY_GENERATOR_VERSION, seed: SEED });
    expect(env.firm).toEqual({
      person: f.person, activeId: 2, builds: f.builds, monthInvest: f.monthInvest, inbox: f.inbox, weatherHash: f.weatherHash, over: null,
    });
    expect(env.stores.map((s) => Object.keys(s).sort())).toEqual(env.stores.map(() => ['closed', 'econ', 'generatorVersion', 'id', 'layout', 'lotId', 'notice']));
    expect(env.stores.map((s) => ({ id: s.id, lotId: s.lotId, closed: s.closed, notice: s.notice, generatorVersion: s.generatorVersion }))).toEqual(
      f.stores.map((s) => ({ id: s.id, lotId: s.lotId, closed: s.closed, notice: s.notice, generatorVersion: s.layout.generatorVersion })),
    );
    expect(env.stores[1]!.layout).toBe(f.stores[1]!.layout);
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
      expect(st.econ).toEqual(live.stores[i]!.econ);
      expect(st.layout).toEqual(live.stores[i]!.layout);
      if (!st.closed) expect(st.info).toEqual(live.stores[i]!.info);   // zamknięty sklep nie liczy się dalej, a jego stare `site` nic nie znaczy
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
    const b = opened(viaJson(a));
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

  it('premia sieci z mety wygrywa z zapisaną; dochód z sieci ma otwarty sklep o najniższym id (tu #2, bo #1 zamknięty)', () => {
    const partner = { points: 3, networkIncome: 200, stores: 2 };
    const live = structuredClone(scenario());
    const none = opened(viaJson(live));
    expect(none.stores.map((s) => s.econ.partner)).toEqual(live.stores.map((s) => s.econ.partner));   // bez parametru zostaje zapisana
    const f = opened(viaJson(live, partner));
    expect(f.stores[1]!.econ.partner).toEqual(partner);
    expect(f.stores[0]!.econ.partner).toEqual(live.stores[0]!.econ.partner);   // zamknięty sklep zostaje, jak był
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

  it('fixture save-v3-dwa-sklepy.json: schemat 3, wczytuje się jako firma i dalej gra deterministycznie', () => {
    const raw = json('save-v3-dwa-sklepy.json');
    expect(raw).toMatchObject({ schema: 3, seed: SEED, cityGeneratorVersion: CITY_GENERATOR_VERSION });
    const f = opened(restoreFirmFrom(raw, SEED));
    expect(f.stores.map((s) => ({ id: s.id, closed: s.closed }))).toEqual([{ id: 1, closed: true }, { id: 2, closed: false }]);
    expect(f.stores[0]!.notice).not.toBeNull();
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
    delete env.stores[1].layout.cells;
    const f = opened(restoreFirmFrom(env, SEED));
    expect(f.stores[1]!.econ.remontLevel).toBe(1);
    expect(f.stores[1]!.layout).toEqual(live.stores[1]!.layout);
    env.stores[0].layout = 'płaski';
    expect(opened(restoreFirmFrom(env, SEED)).stores[0]!.layout).toEqual(live.stores[0]!.layout);
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
    expect(s).toMatchObject({ seed: SEED, mode: 'casual', fromSave: true, loadNotice: null, retired: false, ephemeral: false, run: null, layoutLevel: 1 });
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
    const saved = json('save-v3-dwa-sklepy.json').stores as { econ: EconomyState }[];
    expect(s.firm!.stores[0]!.econ.partner).toEqual(saved[0]!.econ.partner);   // zamknięty #1 zostaje, jak był
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

// --- Rozmiar ------------------------------------------------------------------------------------------------------------

/**
 * Najgorszy przypadek 4a.1: dwa sklepy, każdy po dwóch remontach, koniec roku (365 dni prawdziwych kroków). Oba sklepy z historią
 * dwunastu miesięcy, ratą pakietu, pełną skrzynką zastępcy.
 */
function playWorstCase(): FirmState {
  const f = newFirm();
  f.person.partner = true;
  playTo(f, 3 * DAY + OPEN_FROM);
  expect(command(f, { type: 'rentLot', lotId: freeLot(f), pay: 'raty' })).toEqual({ ok: true });
  playTo(f, f.builds[0]!.readyDay * DAY + OPEN_FROM + 1);
  expect(f.stores).toHaveLength(2);
  const twice = (level: number): void => {
    for (const id of [1, 2]) {
      expect(command(f, { type: 'switchStore', storeId: id })).toEqual({ ok: true });
      remont(f, level);
    }
  };
  twice(8);
  playTo(f, 20 * DAY + OPEN_FROM);
  twice(14);
  expect(f.stores.map((s) => s.econ.remontLevel)).toEqual([2, 2]);
  playTo(f, 365 * DAY + OPEN_FROM);
  return f;
}

describe('rozmiar paczki „Wyślij zapis”', () => {
  it('dwa sklepy po dwóch remontach na koniec roku mieszczą się w 64 KB (paczka z kopertą schematu 3)', () => {
    const f = playWorstCase();
    expect(f.over).toBeNull();
    expect(openStores(f)).toHaveLength(2);
    expect(f.stores.map((s) => s.econ.history.length)).toEqual([12, 12]);

    const meta: Meta = {
      version: 1, partnerPoints: 120, network: Array.from({ length: 12 }, (_, n) => ({ seed: `stary-sklep-${n}`, income: 400, level: 21, margin: 90_000 })),
      daily: { date: '2026-10-27', streak: 4 }, lastSeen: 1_790_000_000_000, sound: true, vibration: true,
      player: { nick: 'Mateusz', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true },
    };
    const bundle = { format: TRANSFER_FORMAT, version: 1, seed: SEED, meta, save: firmEnvelopeOf(f) };
    const bytes = (x: unknown): number => new TextEncoder().encode(JSON.stringify(x)).length;
    const total = bytes(bundle);
    const perStore = bundle.save.stores.map((s) => `${bytes(s)} (układ ${bytes(s.layout)}, ekonomia ${bytes(s.econ)})`);
    console.log(`Zapis schematu 3, dwa sklepy po dwóch remontach, 365 dni: paczka ${total} B z ${SAVE_TRANSFER_MAX_BYTES} B (zapis ${bytes(bundle.save)} B, meta ${bytes(meta)} B, skrzynka ${f.inbox.length} wpisów); sklepy: ${perStore.join(' + ')} B.`);
    expect(f.inbox.length).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(SAVE_TRANSFER_MAX_BYTES);
  }, 60_000);
});

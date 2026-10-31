import { generateCity } from '@/sim/city/generateCity';
import { storeSeedFor } from '@/sim/city/traffic';
import { CITY_GENERATOR_VERSION, type CityState } from '@/sim/city/types';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { createEconomy, relayout, type EconomyState } from '@/sim/economy/economy';
import { LIMITS, sanitizeEconomy } from '@/sim/economy/sanitize';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { REMONTS } from '@/sim/economy/upgrades';
import { lotState } from '@/sim/firm/commands';
import { activeStore, createFirm, openStores, refreshSites, setPartner, syncWallet } from '@/sim/firm/firm';
import { INBOX_MAX, type FirmBuild, type FirmNote, type FirmState, type FirmStore } from '@/sim/firm/types';
import { isNum, isRec, num, whole, type Rec } from '@/sim/guards';
import { layoutFor } from '@/sim/store/layoutFor';
import { sanitizeLayout } from '@/sim/store/sanitize';
import type { StoreLayout } from '@/sim/store/types';
import { fitsStore, restoreSessionFrom } from './session';
import { GAME_VERSION } from './version';

/*
 * Zapis zwykłej gry z firmą (spec §7.4, §16): koperta schematu 3 pod `traszka:save:<seed>`. Zapisuje się to, czego nie da się policzyć z
 * seeda: osobę, skrzynkę, budowy i sklepy (układ i `EconomyState` każdego otwartego, a zamkniętego tylko wyposażenie lokalu). Miasto jest czystą funkcją seeda i
 * `CITY_GENERATOR_VERSION`, więc nie leży w zapisie; `StoreInfo` (z dzielnicą sklepu) też powstaje od nowa z układu i miasta.
 * Schemat 1 i 2 (jeden sklep, każda wersja SIM) wczytuje się przez `restoreSessionFrom` jak dziś i staje się sklepem #1 firmy.
 * Biegu rankingowego to nie dotyczy: jego zapis (`traszka:ranked`) zostaje w schemacie 2 (`SAVE_SCHEMA`).
 *
 * Ten plik i `session.ts` importują się nawzajem: odczyt sesji woła `restoreFirmFrom`, a ta funkcja dla schematu 1 i 2 woła
 * `restoreSessionFrom`. Cykl jest bezpieczny, bo oba moduły używają cudzych eksportów dopiero w ciele funkcji, nie przy ładowaniu.
 */

/** Schemat koperty firmy. `SAVE_SCHEMA` (2) zostaje, bo na nim stoi zapis biegu rankingowego. */
export const FIRM_SAVE_SCHEMA = 3;
/** Tyle bajtów paczki „Wyślij zapis” przyjmuje serwer (`SAVE_MAX_BYTES` w `src/server/config.ts`); test pilnuje zgodności. */
export const SAVE_TRANSFER_MAX_BYTES = 64 * 1024;

/** Pola sklepu, które zapis niesie niezależnie od tego, czy sklep jeszcze działa. */
interface SavedStoreBase {
  id: number;
  lotId: number;
  generatorVersion: number;
  notice: { endDay: number } | null;
}

/**
 * Wyposażenie zamkniętego sklepu (spec §13.3: lokal „po Traszce” zachowuje ulepszenia, sprzęt i poziom remontu; towar, ludzie, saldo
 * i raty przepadają w rozliczeniu). To jedyne pola `EconomyState`, które zamknięty sklep niesie w zapisie, plus to, co `sanitizeEconomy`
 * wymaga od każdego stanu (`version`, `seed`) i co mówi, że sklep jest skończony (`minute` z chwili zamknięcia, `gameOver`). Reszta
 * (układ, zapasy, historia, zaufanie…) przy odczycie wraca z domyślnych, a układ z lokalu miasta i poziomu remontu.
 */
export type ClosedFittings = Pick<EconomyState, 'version' | 'seed' | 'minute' | 'upgrades' | 'equipment' | 'remontLevel'> & { gameOver: true };

/**
 * Sklep w kopercie: otwarty z układem i pełnym `EconomyState`, zamknięty tylko z wyposażeniem lokalu (zamknięte sklepy gromadzą się:
 * pełny kosztuje ok. 25 KB, a paczka „Wyślij zapis” ma 64 KB). `info` i miasto nie są zapisane, powstają przy odczycie.
 */
export type SavedStore =
  | (SavedStoreBase & { closed: false; layout: StoreLayout; econ: EconomyState })
  | (SavedStoreBase & { closed: true; econ: ClosedFittings });

export interface FirmSaveEnvelope {
  schema: typeof FIRM_SAVE_SCHEMA;
  gameVersion: string;
  cityGeneratorVersion: number;
  seed: string;
  firm: Omit<FirmState, 'stores' | 'city' | 'seed' | 'ranked'>;
  stores: SavedStore[];
}

/** Wyposażenie lokalu zamkniętego sklepu: patrz `ClosedFittings`. Zamknięty sklep zawsze wraca jako skończony (`gameOver`). */
const fittingsOf = (e: EconomyState): ClosedFittings => ({
  version: e.version, seed: e.seed, minute: e.minute, upgrades: e.upgrades, equipment: e.equipment, remontLevel: e.remontLevel, gameOver: true,
});

/** Koperta zapisu firmy: seed, wersje gry i miasta, osoba z budowami i skrzynką oraz sklepy (otwarte z układem i ekonomią, zamknięte z wyposażeniem). */
export function firmEnvelopeOf(f: FirmState): FirmSaveEnvelope {
  return {
    schema: FIRM_SAVE_SCHEMA, gameVersion: GAME_VERSION, cityGeneratorVersion: f.city.version, seed: f.seed,
    firm: { person: f.person, activeId: f.activeId, builds: f.builds, monthInvest: f.monthInvest, inbox: f.inbox, weatherHash: f.weatherHash, over: f.over },
    stores: f.stores.map((st): SavedStore => {
      const base = { id: st.id, lotId: st.lotId, generatorVersion: st.layout.generatorVersion, notice: st.notice };
      return st.closed ? { ...base, closed: true, econ: fittingsOf(st.econ) } : { ...base, closed: false, layout: st.layout, econ: st.econ };
    }),
  };
}

/**
 * Zapis z nowszej wersji gry: schemat wyższy niż koperta firmy albo miasto z nowszego generatora (inny kod rozstawiłby lokale
 * inaczej). Nie wiemy, co w nim jest, więc go nie ruszamy. Wspólne dla odczytu sesji i dla przeniesienia zapisu.
 */
export function isNewerSave(data: unknown): boolean {
  if (!isRec(data) || typeof data.schema !== 'number') return false;
  if (data.schema > FIRM_SAVE_SCHEMA) return true;
  return data.schema === FIRM_SAVE_SCHEMA && typeof data.cityGeneratorVersion === 'number' && data.cityGeneratorVersion > CITY_GENERATOR_VERSION;
}

export type FirmOpened = { ok: true; firm: FirmState } | { ok: false; reason: 'invalid' | 'unbuildable' };

const INVALID: FirmOpened = { ok: false, reason: 'invalid' };
const UNBUILDABLE: FirmOpened = { ok: false, reason: 'unbuildable' };

/** Seed sklepu w lokalu miasta; sklep startowy ma seed gry (jak w `openStoreAt` i `lotEstimate`). */
const storeSeedOf = (seed: string, city: CityState, lotId: number): string => (lotId === city.startLotId ? seed : storeSeedFor(seed, lotId));

/**
 * Firma z zapisu w schemacie 3, 2 albo 1. Dwa rodzaje porażki jak w `restoreSessionFrom`: `invalid` (zapis nie przeszedł walidacji,
 * wołający przenosi go do kopii) i `unbuildable` (zapis jest poprawny, ale świata z niego nie złożyliśmy: generator miasta albo
 * układu; zapis zostaje na miejscu). Niczego nie zapisuje i nie rzuca z powodu treści zapisu. `partner` to premia z sieci sklepów
 * (meta): aktualna przy każdym wczytaniu, nadpisuje zapisaną.
 */
export function restoreFirmFrom(data: unknown, seed: string, partner?: EconomyState['partner']): FirmOpened {
  if (!isRec(data)) return INVALID;
  if (data.schema === FIRM_SAVE_SCHEMA) return restoreEnvelope(data, seed, partner);
  const legacy = restoreSessionFrom(data, seed, partner);
  if (!legacy.ok) return legacy;
  const { econ, layout, info } = legacy.session;
  try {
    return { ok: true, firm: createFirm(seed, { econ, layout, info }, { ranked: false }) };
  } catch (error) {
    console.error(`Miasto dla seeda „${seed}” nie dało się zbudować.`, error);
    return UNBUILDABLE;
  }
}

/** Sklep z koperty, zanim jego ekonomia przejdzie wczytanie: surowy zapis i sklep z układem, `info` i ekonomią zastępczą. */
interface Shell { raw: Rec; storeSeed: string; minute: number; st: FirmStore }

/**
 * Układ, `StoreInfo` i ekonomia zastępcza sklepu. Zapisany układ ma jedną dodatkową próbę z układem z lokalu miasta i poziomu remontu
 * (jak w `restoreSessionFrom`); gdy i ta zawiedzie, to nie wina zapisu. Sklep startowy ma układ z seeda gry (lokal startowy to `pickLot`),
 * pozostałe z lokalu miasta. Ekonomia zastępcza tylko zajmuje miejsce: prawdziwa powstaje po `refreshSites`, bo domyślne wartości
 * (pogoda, cel KPI) liczą się z dzielnicy w `StoreInfo`.
 */
function buildShell(seed: string, city: CityState, raw: Rec, id: number, lotId: number, closed: boolean): Shell | null {
  const rawEcon = raw.econ as Rec;
  const minute = whole(rawEcon.minute, OPEN_FROM, 0, LIMITS.minute);
  const level = whole(rawEcon.remontLevel, 0, 0, REMONTS.length);
  const storeSeed = storeSeedOf(seed, city, lotId);
  const spec = lotId === city.startLotId ? undefined : city.lots[lotId]!.spec;
  const stored = closed ? null : sanitizeLayout(raw.layout);   // zamknięty sklep nie niesie układu: wraca z lokalu miasta i poziomu remontu
  const parts = (known: StoreLayout | null): { layout: StoreLayout; info: StoreInfo; econ: EconomyState } => {
    const layout = known ?? layoutFor(storeSeed, level, spec);
    const info = computeStoreInfo(layout);
    return { layout, info, econ: createEconomy(storeSeed, info, undefined, minute) };
  };
  let world: ReturnType<typeof parts>;
  try {
    world = parts(stored);
  } catch (error) {
    console.error(`Układ sklepu #${id} nie dał się zbudować.`, error);
    if (stored === null) return null;   // układ z lokalu miasta to już była druga próba
    try {
      world = parts(null);
    } catch (again) {
      console.error(`Układ sklepu #${id} z lokalu miasta też się nie zbudował.`, again);
      return null;
    }
  }
  const notice = isRec(raw.notice) && isNum(raw.notice.endDay) ? { endDay: whole(raw.notice.endDay, 0, 0, LIMITS.minute / MINUTES_PER_DAY) } : null;
  return { raw, storeSeed, minute, st: { id, lotId, econ: world.econ, layout: world.layout, info: world.info, closed, notice } };
}

/** Budowy tylko w wolnych lokalach miasta (te same reguły co wynajem): zajęte, własne, zdublowane i uszkodzone wypadają. */
function addBuilds(f: FirmState, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const b of raw as unknown[]) {
    if (!isRec(b) || !Number.isInteger(b.lotId) || !isNum(b.readyDay) || (b.pay !== 'gotowka' && b.pay !== 'raty')) continue;
    const lot = f.city.lots[b.lotId as number];
    if (!lot || lot.id !== b.lotId || lotState(f, lot.id) !== 'wolny') continue;   // wpis zajmuje lokal (`budowa`), więc dubel odpada
    f.builds.push({
      lotId: lot.id, readyDay: whole(b.readyDay, 0, 0, LIMITS.minute / MINUTES_PER_DAY), price: num(b.price, lot.package, 0, LIMITS.money), pay: b.pay,
    });
  }
}

const readInbox = (raw: unknown): FirmNote[] => (Array.isArray(raw) ? (raw as unknown[]) : [])
  .flatMap((n): FirmNote[] => (isRec(n) && isNum(n.day) && isNum(n.storeId) && typeof n.card === 'string' && isNum(n.answer)
    ? [{ day: whole(n.day, 0), storeId: whole(n.storeId, 0), card: n.card, answer: whole(n.answer, 0) }] : []))
  .slice(-INBOX_MAX);

/**
 * Koperta schematu 3. Miasto z `generateCity(seed)`, każdy sklep przez `sanitizeLayout` i `sanitizeEconomy` (brakujące pola z
 * `createEconomy` sklepu), `info` od nowa i `refreshSites`, premia sieci przez `setPartner`. Zamknięty sklep nie ma w zapisie układu
 * ani pełnej ekonomii (`ClosedFittings`): układ powstaje z lokalu miasta i poziomu remontu, ekonomia z domyślnych z nałożonym
 * wyposażeniem i `gameOver`. Sprawdzane: seed, wersja miasta, sklepy (rosnące `id`, różne lokale z miasta, #1 w lokalu startowym,
 * wszystkie otwarte w tej samej minucie), a naprawiane: `activeId` spoza otwartych sklepów (wraca najniższy
 * otwarty), portfel (w `LIMITS.money`), budowy, skrzynka. Gotówka i Ogonki otwartych sklepów to portfel osoby.
 */
function restoreEnvelope(data: Rec, seed: string, partner: EconomyState['partner'] | undefined): FirmOpened {
  if (data.seed !== seed) return INVALID;
  const version = data.cityGeneratorVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return INVALID;
  if (version !== CITY_GENERATOR_VERSION) return UNBUILDABLE;   // inne miasto: lokale z zapisu nie leżałyby tam, gdzie były (nowsze: `isNewerSave`)
  if (!isRec(data.firm) || !Array.isArray(data.stores) || data.stores.length === 0) return INVALID;

  let city: CityState;
  try {
    city = generateCity(seed);
  } catch (error) {
    console.error(`Miasto dla seeda „${seed}” nie dało się zbudować.`, error);
    return UNBUILDABLE;
  }
  if (data.stores.length > city.lots.length) return INVALID;

  const shells: Shell[] = [];
  const usedLots = new Set<number>();
  let previousId = 0;
  for (const raw of data.stores as unknown[]) {
    if (!isRec(raw) || !isRec(raw.econ) || typeof raw.closed !== 'boolean') return INVALID;
    const { id, lotId } = raw;
    if (!Number.isInteger(id) || (id as number) <= previousId || !Number.isInteger(lotId)) return INVALID;
    const lot = city.lots[lotId as number];
    if (!lot || lot.id !== lotId || usedLots.has(lot.id)) return INVALID;
    if (shells.length === 0 && (id !== 1 || lot.id !== city.startLotId)) return INVALID;   // sklep startowy: #1 w lokalu startowym
    const shell = buildShell(seed, city, raw, id as number, lot.id, raw.closed);
    if (shell === null) return UNBUILDABLE;
    shells.push(shell);
    usedLots.add(lot.id);
    previousId = id as number;
  }

  const raw = data.firm;
  const f: FirmState = {
    seed, ranked: false, city,
    person: { wallet: 0, ogonki: 0, partner: false, remanentKnown: false },
    stores: shells.map((s) => s.st), activeId: 1, builds: [], monthInvest: 0, inbox: [], over: null,
    weatherHash: whole(raw.weatherHash, shells[0]!.st.econ.seedHash, 0, 0xffff_ffff),   // przed `refreshSites`: dzielnica sklepu niesie pogodę miasta
  };
  const open = openStores(f);
  if (open.length === 0) return INVALID;
  try {
    refreshSites(f);
  } catch (error) {
    console.error('Dzielnice sklepów nie dały się ustawić.', error);
    return UNBUILDABLE;
  }
  for (const { raw: rawStore, storeSeed, minute, st } of shells) {
    const econ = sanitizeEconomy(rawStore.econ, createEconomy(storeSeed, st.info, undefined, minute), st.info);
    if (!econ) return INVALID;
    if (st.closed) econ.gameOver = true;   // zamknięty sklep jest skończony; z zapisu wraca samo wyposażenie, reszta z domyślnych
    st.econ = econ;
  }
  // otwarte sklepy liczą się razem, minuta po minucie: zapis z rozjechanymi zegarami nie powstał w grze
  if (new Set(open.map((s) => s.econ.minute)).size > 1) return INVALID;

  f.activeId = open.some((s) => s.id === raw.activeId) ? (raw.activeId as number) : open[0]!.id;
  const active = activeStore(f).econ;
  const person = isRec(raw.person) ? raw.person : {};
  f.person = {
    wallet: num(person.wallet, active.cash, -LIMITS.money, LIMITS.money),
    ogonki: num(person.ogonki, active.ogonki, 0, LIMITS.money),
    partner: person.partner === true,
    remanentKnown: typeof person.remanentKnown === 'boolean' ? person.remanentKnown : f.stores[0]!.econ.franchisee.remanent.known,
  };
  f.monthInvest = num(raw.monthInvest, 0, 0, LIMITS.money);
  f.over = raw.over === 'debt' || raw.over === 'closed' ? raw.over : null;
  f.inbox = readInbox(raw.inbox);
  addBuilds(f, raw.builds);

  try {
    if (partner) setPartner(f, partner);
    for (const st of f.stores) if (!fitsStore(st.econ, st.info)) relayout(st.econ, st.info);
  } catch (error) {
    console.error('Stan sklepów nie dał się dopasować do układów.', error);
    return UNBUILDABLE;
  }
  syncWallet(f);
  return { ok: true, firm: f };
}

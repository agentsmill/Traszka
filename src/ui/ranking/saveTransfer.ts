import { isFirmEnvelope, isNewerSave, type ClosedFittings, type FirmSaveEnvelope, type SavedStore } from '@/game/firmSave';
import { loadMeta, sanitizeMeta, saveMeta, type Meta } from '@/game/meta';
import { setPlayMode } from '@/game/rankedRun';
import { NEWER_SAVE_NOTICE, lastSavedSeed } from '@/game/session';
import { storeSeedFor } from '@/sim/city/traffic';
import { isNum, isRec, type Rec } from '@/sim/guards';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';

/**
 * Paczka do „Wyślij zapis” i „Pobierz zapis” (spec §14.7): wszystko, czego gra potrzebuje, żeby na drugim urządzeniu wczytać
 * się tak jak na pierwszym (decyzja właściciela gry, 2026-10-28): meta (gracz, sieć sklepów, Punkty Partnera, seria dni,
 * ustawienia), zapis bieżącego sklepu (ostatnio granego) i to, który sklep otworzyć. Zapis sklepu to schemat 2 (jeden sklep, ok. 10 KB po
 * pełnym sezonie) albo koperta firmy ze schematu 4 albo 3 (`firmSave.ts`: trzy sklepy po dwóch remontach na koniec roku to ok. 36 KB, a dwa po
 * trzech remontach na koniec drugiego roku ok. 27 KB, bo odtwarzalne układy nie leżą w zapisie). Od etapu 4b firma ma do pięciu sklepów, więc
 * koperta w paczce jest kompaktowana (`compactForTransfer`); test rozmiaru pilnuje 64 KB przy pięciu sklepach po dwóch latach. Pozostałe sklepy
 * zapisane na pierwszym urządzeniu zostają tam. Klucza gracza w paczce nie
 * ma: serwer trzyma paczkę pod skrótem klucza i samego klucza nie przechowuje (§14.7), a drugie urządzenie ma już ten klucz z kodu.
 *
 * Gra trzyma metę i sesję w pamięci i zapisuje je przy każdym zamknięciu karty (`visibilitychange`, `pagehide`), także wtedy, gdy
 * zamyka ją przeładowanie po imporcie. Paczka wpisana prosto w `localStorage` przegrałaby więc z własnym przeładowaniem: stara
 * meta i stary sklep z pamięci zapisałyby się na wierzch. Dlatego import idzie na dwa razy: po zgodzie gracza (pyta panel „Kod
 * odzyskiwania”) `stageImport` kładzie sam tekst paczki pod osobnym kluczem (`IMPORT_KEY`, którego karta nigdy nie zapisuje) i strona
 * się przeładowuje; na następnym starcie `applyStagedImport` wczytuje paczkę, zanim ktokolwiek przeczyta metę albo wybierze sklep,
 * i kasuje klucz. `importTransfer` robi samo wczytanie (woła je `applyStagedImport`) i bez przeładowania strony nie nadaje się
 * do wołania z działającej gry.
 */
export const TRANSFER_FORMAT = 'traszka-przeniesienie';
export interface TransferBundle { format: typeof TRANSFER_FORMAT; version: 1; seed: string; meta: Meta; save: Record<string, unknown> }

export const TRANSFER_ERRORS = {
  invalid: 'To nie jest zapis Traszki. Centrala nie przyjmuje cudzych segregatorów.',
  storage: 'Przeglądarka nie ma miejsca na zapis. Zwolnij trochę pamięci i spróbuj jeszcze raz.',
} as const;

/**
 * Klucze zapisu sklepu w przeglądarce. Te same, których używa `session.ts` (tam są prywatne); test pilnuje zgodności: to, co
 * zapisze `saveSession`, trafia do paczki, a to, co zapisze import, wczytuje `createSession`.
 */
const SAVE_PREFIX = 'traszka:save:';
const LAST_KEY = 'traszka:last';

const parse = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

/** Tyle ostatnich zamkniętych miesięcy historii każdego otwartego sklepu niesie paczka (spec 4b §5.8). */
export const TRANSFER_HISTORY_MONTHS = 12;
/** Tyle ostatnich wpisów skrzynki zastępcy niesie paczka (spec 4b §5.8). */
export const TRANSFER_INBOX = 10;

/**
 * Najwyżej tyle zamkniętych sklepów (lokali „po Traszce”) niesie paczka (rozstrzygnięcie koordynatora 4b, runda 2): zamknięte sklepy gromadzą
 * się z każdym wypowiedzeniem, a każdy po remoncie 5 z pełnym wyposażeniem to ponad 1 KB. Zostają zawsze sklep #1 (koperta zaczyna się od
 * niego: lokal startowy i seed gry) i zamknięte sklepy, w których lokalu trwa budowa (ponowny wynajem w toku), a resztę miejsc biorą
 * ostatnio zamknięte (minuta zamknięcia, przy remisie wyższe `id`). Starsze zamknięte sklepy w przeniesionej kopii znikają z listy: ich lokal
 * wraca do stanu z generatora (wolny jak każdy, pełna cena pakietu, bez wyposażenia), a wpis skrzynki o takim sklepie mówi już samo „Traszka #n”.
 * Zapis na pierwszym urządzeniu zostaje pełny.
 */
export const TRANSFER_CLOSED_STORES = 6;

/**
 * Zamknięty sklep w paczce: tylko to, czego potrzeba do ponownego wynajmu lokalu „po Traszce” (`reopenStoreAt`: ten sam `id` i lokal, układ
 * z lokalu i poziomu remontu, wyposażenie jako `fittings` do `createEconomy`) i karty lokalu (poziom remontu, wyposażenie), plus minuta
 * zamknięcia (kolejność „ostatnio zamkniętych” przy kolejnym wysłaniu). Resztę (`version`, seed sklepu, `gameOver`, wersja generatora,
 * wypowiedzenie) `unpackTransfer` odtwarza przy rozpakowaniu jako wartości neutralne; flaga `reopened` zamkniętego sklepu niczego nie zmienia
 * (ponowny wynajem ustawia ją znów), więc jej nie ma. Pole `fit` zamiast `econ`: nierozpakowana paczka nie wczyta się po cichu jako zła koperta.
 */
export interface PackedClosedStore {
  id: number; lotId: number; closed: true; fit: Pick<ClosedFittings, 'minute' | 'remontLevel' | 'upgrades' | 'equipment'>;
}

/** Zamknięty sklep z koperty jako `PackedClosedStore`; nierozpoznany kształt zostaje bez zmian. */
function packClosed(st: Rec): unknown {
  if (!isRec(st.econ)) return st;
  const { minute, remontLevel, upgrades, equipment } = st.econ;
  return { id: st.id, lotId: st.lotId, closed: true, fit: { minute, remontLevel, upgrades, equipment } };
}

/** Minuta zamknięcia sklepu z koperty (pełnej albo spakowanej); bez niej sklep jest „najstarszy”. */
const closedAt = (st: Rec): number => {
  const fit = isRec(st.fit) ? st.fit : isRec(st.econ) ? st.econ : {};
  return isNum(fit.minute) ? fit.minute : -Infinity;
};

/** Zamknięte sklepy, które paczka niesie (patrz `TRANSFER_CLOSED_STORES`). */
function keptClosed(stores: readonly unknown[], builds: unknown): Set<Rec> {
  const closed = stores.filter((st): st is Rec => isRec(st) && st.closed === true);
  const building = new Set(Array.isArray(builds) ? (builds as unknown[]).filter(isRec).map((b) => b.lotId) : []);
  const forced = closed.filter((st) => st.id === 1 || building.has(st.lotId));
  const recent = closed.filter((st) => !forced.includes(st))
    .sort((a, b) => closedAt(b) - closedAt(a) || (isNum(b.id) ? b.id : 0) - (isNum(a.id) ? a.id : 0));
  return new Set([...forced, ...recent.slice(0, Math.max(0, TRANSFER_CLOSED_STORES - forced.length))]);
}

/**
 * Ekonomia bez logu kart (`tycoon.cards.log`, w grze do `CARDS.logMax` = 40 wpisów, ok. 2,7 KB na sklep): paczka nie niesie go w żadnym sklepie,
 * a na drugim urządzeniu log zaczyna się od pustego (rozstrzygnięcie koordynatora 4b, runda 3). Log jest tylko dopisywany i przycinany
 * (`resolveCard`, sanityzacja): nie czyta go losowanie kart (przerwy liczą się z `lastSeen`, numeracja z `seq`), reszta symulacji, gra ani żaden
 * widok (`src/ui`, `src/render`). Nierozpoznany kształt zostaje bez zmian.
 */
function withoutCardLog(econ: Record<string, unknown>): Record<string, unknown> {
  const tycoon = econ.tycoon;
  if (!isRec(tycoon) || !isRec(tycoon.cards)) return econ;
  return { ...econ, tycoon: { ...tycoon, cards: { ...tycoon.cards, log: [] } } };
}

/**
 * Otwarty sklep w paczce: bez logu kart, historia do `TRANSFER_HISTORY_MONTHS` miesięcy, a ostatni raport tylko w aktywnym (pozostałe: null).
 * Reszta bez zmian.
 */
function compactStore(st: unknown, activeId: unknown): unknown {
  if (!isRec(st) || st.closed !== false || !isRec(st.econ)) return st;
  const active = st.id === activeId;
  const econ = withoutCardLog(st.econ);
  return {
    ...st,
    econ: {
      ...econ,
      ...(Array.isArray(econ.history) ? { history: (econ.history as unknown[]).slice(-TRANSFER_HISTORY_MONTHS) } : {}),
      ...(active ? {} : { lastReport: null }),
    },
  };
}

/**
 * Koperta firmy do paczki „Wyślij zapis” (spec 4b §5.8 Ruling i rozstrzygnięcia koordynatora po pomiarach): sklepy poza aktywnym bez ostatniego
 * raportu (`lastReport: null`), każdy sklep bez logu kart, historia każdego otwartego sklepu do ostatnich 12 miesięcy, skrzynka
 * zastępcy do ostatnich 10 wpisów, a zamknięte sklepy jako `PackedClosedStore`, najwyżej `TRANSFER_CLOSED_STORES`. Pięć sklepów po dwóch latach
 * nie zmieściłoby się inaczej w 64 KB. Zapis lokalny zostaje pełny: funkcja nie zmienia `env`, tylko składa nową kopertę, którą przed zapisem
 * na drugim urządzeniu trzeba rozpakować (`unpackTransfer`). Na drugim urządzeniu znika ostatni raport sklepów w tle, log rozstrzygniętych kart
 * (zaczyna się od pustego), historia starsza niż rok (limit rat i status Partnera patrzą na ostatnie miesiące) i najstarsze lokale „po Traszce”.
 * Koperta przychodzi z przeglądarki, więc kształtu nie bierze na wiarę: czego nie rozpozna, przepisuje bez zmian.
 */
export function compactForTransfer(env: FirmSaveEnvelope): FirmSaveEnvelope {
  const firm: unknown = env.firm;
  const activeId = isRec(firm) ? firm.activeId : undefined;
  const stores: unknown = env.stores;
  const kept = Array.isArray(stores) ? keptClosed(stores, isRec(firm) ? firm.builds : undefined) : new Set<Rec>();
  return {
    ...env,
    firm: isRec(firm) && Array.isArray(firm.inbox) ? { ...env.firm, inbox: env.firm.inbox.slice(-TRANSFER_INBOX) } : env.firm,
    stores: Array.isArray(stores)
      ? (stores as unknown[]).filter((st) => !isRec(st) || st.closed !== true || kept.has(st))
        .map((st) => (isRec(st) && st.closed === true ? packClosed(st) : compactStore(st, activeId)) as SavedStore)
      : env.stores,
  };
}

/** Zamknięty sklep z paczki (`PackedClosedStore`) jako sklep koperty z wyposażeniem (`ClosedFittings`); reszta bez zmian. */
function unpackStore(st: unknown, seed: string): unknown {
  if (!isRec(st) || st.closed !== true || st.econ !== undefined || !isRec(st.fit) || typeof st.lotId !== 'number') return st;
  const { minute, upgrades, equipment, remontLevel } = st.fit;
  // sklep #1 stoi w lokalu startowym i ma seed gry (koperta to sprawdza), każdy inny ma seed z lokalu (`storeSeedOf`)
  const storeSeed = st.id === 1 ? seed : storeSeedFor(seed, st.lotId);
  return {
    id: st.id, lotId: st.lotId, generatorVersion: GENERATOR_VERSION, notice: null, closed: true,
    econ: { version: 1, seed: storeSeed, minute, upgrades, equipment, remontLevel, gameOver: true },
  };
}

/**
 * Rozpakowanie koperty z paczki przed zapisem w przeglądarce drugiego urządzenia: zamknięte sklepy spakowane przez `compactForTransfer` wracają
 * do kształtu z zapisu lokalnego (`ClosedFittings` z neutralnym seedem sklepu, `gameOver`, bieżącą wersją generatora i bez wypowiedzenia),
 * więc odczyt zapisu (`restoreFirmFrom`) zostaje jeden dla obu dróg. Paczka bez spakowanych sklepów (jeden sklep, starsza wersja gry) przechodzi
 * bez zmian; nierozpoznany kształt też.
 */
export function unpackTransfer(save: Record<string, unknown>): Record<string, unknown> {
  if (!isFirmEnvelope(save) || !Array.isArray(save.stores) || typeof save.seed !== 'string') return save;
  const seed = save.seed;
  return { ...save, stores: (save.stores as unknown[]).map((st) => unpackStore(st, seed)) };
}

/**
 * Paczka z tego urządzenia (tekst JSON) albo null, gdy nie ma czego wysłać: brak sklepu, uszkodzony zapis albo meta z nowszej wersji gry.
 * Koperta firmy (schemat 4 albo 3) idzie w paczce kompaktowana (`compactForTransfer`); zapis w przeglądarce zostaje taki, jaki był.
 */
export function exportTransfer(): string | null {
  const seed = lastSavedSeed();
  const meta = loadMeta();
  if (seed === null || meta.readOnly) return null;
  let save: unknown;
  try {
    save = parse(localStorage.getItem(SAVE_PREFIX + seed));
  } catch {
    return null;
  }
  if (!isRec(save)) return null;
  const sent: Record<string, unknown> = isFirmEnvelope(save) ? { ...compactForTransfer(save as unknown as FirmSaveEnvelope) } : save;
  const { player, ...rest } = meta;
  const withoutKey: Meta = player ? { ...rest, player: { nick: player.nick, look: player.look, specialOutfits: player.specialOutfits } } : rest;
  const bundle: TransferBundle = { format: TRANSFER_FORMAT, version: 1, seed, meta: withoutKey, save: sent };
  return JSON.stringify(bundle);
}

export type ImportResult = { seed: string } | { error: string };

/** Paczka, która przeszła kontrolę: sklep do wczytania i meta (przychodząca oraz tutejsza, do złożenia z kluczem gracza). */
interface CheckedBundle { seed: string; save: Record<string, unknown>; incoming: Meta; local: Meta }

/**
 * Kontrola paczki wspólna dla schowania (`stageImport`) i wczytania (`importTransfer`): format i wersja paczki, kształt sklepu i mety,
 * zapis albo meta z nowszej wersji gry (paczki, ani mety tego urządzenia, nie ruszamy). Niczego nie zapisuje.
 */
function checkBundle(text: string): CheckedBundle | { error: string } {
  const data = parse(text);
  if (!isRec(data) || data.format !== TRANSFER_FORMAT || data.version !== 1 || typeof data.seed !== 'string' || data.seed === ''
    || !isRec(data.save) || !isRec(data.meta)) {
    return { error: TRANSFER_ERRORS.invalid };
  }
  if (isNewerSave(data.save)) return { error: NEWER_SAVE_NOTICE };
  const incoming = sanitizeMeta(data.meta);
  const local = loadMeta();
  if (incoming.readOnly || local.readOnly) return { error: NEWER_SAVE_NOTICE };
  return { seed: data.seed, save: data.save, incoming, local };
}

/**
 * Wczytuje paczkę z drugiego urządzenia: zapis jej sklepu (pod jego seedem, koperta firmy rozpakowana przez `unpackTransfer`; inne sklepy tego
 * urządzenia zostają), metę i „ostatni sklep”. Klucz gracza zostaje tutejszy (paczka go nie ma, a to nim pobrano ją z serwera). Paczka albo meta tego urządzenia
 * z nowszej wersji gry: nic nie zapisujemy. Zwraca seed sklepu do otwarcia albo komunikat. Woła się ją tylko na starcie, zanim gra
 * przeczyta metę (`applyStagedImport`): z działającej gry stan z pamięci karty nadpisałby wczytaną paczkę (patrz nagłówek pliku).
 */
export function importTransfer(text: string): ImportResult {
  const checked = checkBundle(text);
  if ('error' in checked) return checked;
  const { seed, save, incoming, local } = checked;
  const localKey = local.player?.key;
  const player = incoming.player && localKey !== undefined ? { ...incoming.player, key: localKey } : incoming.player ?? local.player;
  const meta: Meta = { ...incoming, ...(player ? { player } : {}) };
  try {
    localStorage.setItem(SAVE_PREFIX + seed, JSON.stringify(unpackTransfer(save)));
    localStorage.setItem(LAST_KEY, seed);
  } catch {
    return { error: TRANSFER_ERRORS.storage };
  }
  saveMeta(meta);
  return { seed };
}

/** Klucz pośredni: tu leży tekst pobranej paczki od zgody gracza do następnego startu. Karta niczego pod nim nie zapisuje. */
export const IMPORT_KEY = 'traszka:import';

/**
 * Pierwszy krok importu: sprawdza paczkę tak jak `importTransfer` i odkłada sam jej tekst pod `IMPORT_KEY`. Poza tym kluczem niczego
 * nie rusza (meta, sklepy i „ostatni sklep” zostają, jakie były), więc zapis przy zamykaniu karty nie ma z czym przegrać. Po sukcesie
 * wołający przeładowuje stronę. Paczka niedobra albo przeglądarka bez miejsca: komunikat, nic nie czeka na start.
 */
export function stageImport(text: string): { ok: true } | { error: string } {
  const checked = checkBundle(text);
  if ('error' in checked) return checked;
  try {
    localStorage.setItem(IMPORT_KEY, text);
  } catch {
    return { error: TRANSFER_ERRORS.storage };
  }
  return { ok: true };
}

/**
 * Drugi krok importu, na samym początku startu strony (przed `loadMeta()`, wyborem sklepu i ekranem startowym): wczytuje paczkę
 * odłożoną przez `stageImport`. `null`, gdy nic nie czeka. W pozostałych przypadkach klucz pośredni znika zawsze, także przy błędzie
 * (uszkodzona paczka nie może zapętlić rozruchu); błąd zostawia stary stan bez zmian. Po sukcesie tryb gry to zwykła gra, żeby
 * start otworzył wczytany sklep, a nie wznowił biegu rankingowego (sam bieg zostaje na urządzeniu), i wraca seed sklepu do otwarcia.
 */
export function applyStagedImport(): ImportResult | null {
  let text: string | null;
  try {
    text = localStorage.getItem(IMPORT_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    localStorage.removeItem(IMPORT_KEY);
  } catch {
    // Przeglądarka nie chce skasować klucza: nic z tym nie zrobimy, a wczytanie niżej jest i tak jednorazowe w tym starcie.
  }
  const result = importTransfer(text);
  if (!('error' in result)) setPlayMode('casual');
  return result;
}

/**
 * Chwila (`savedAt` serwera) ostatniej kopii zapisu, którą to urządzenie wysłało albo pobrało. „Wyślij zapis” wysyła ją jako
 * `expected`: serwer pyta o zgodę, gdy leży tam inna kopia, której to urządzenie jeszcze nie widziało (409 `save-conflict`).
 */
export const SAVE_SYNC_KEY = 'traszka:saveSync';

/** Zapamiętana chwila kopii albo null (brak znacznika, śmieci w kluczu, przeglądarka odmawia dostępu). Liczba całkowita nieujemna, jak w serwerze. */
export function readSaveSync(): number | null {
  try {
    const text = localStorage.getItem(SAVE_SYNC_KEY);
    if (text === null || !/^\d{1,16}$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/** Zapisuje chwilę kopii; nieprawidłowej liczby nie zapisuje, a odmowa przeglądarki nie przerywa gry (znacznik zniknie, gracz dostanie pytanie). */
export function writeSaveSync(savedAt: number): void {
  if (!Number.isSafeInteger(savedAt) || savedAt < 0) return;
  try {
    localStorage.setItem(SAVE_SYNC_KEY, String(savedAt));
  } catch {
    // brak miejsca albo tryb prywatny: wysyłanie bez znacznika po prostu zapyta o zgodę
  }
}

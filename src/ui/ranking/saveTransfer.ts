import { loadMeta, sanitizeMeta, saveMeta, type Meta } from '@/game/meta';
import { setPlayMode } from '@/game/rankedRun';
import { NEWER_SAVE_NOTICE, SAVE_SCHEMA, lastSavedSeed } from '@/game/session';
import { isRec } from '@/sim/guards';

/**
 * Paczka do „Wyślij zapis” i „Pobierz zapis” (spec §14.7): wszystko, czego gra potrzebuje, żeby na drugim urządzeniu wczytać
 * się tak jak na pierwszym (decyzja właściciela gry, 2026-10-28): meta (gracz, sieć sklepów, Punkty Partnera, seria dni,
 * ustawienia), zapis bieżącego sklepu (ostatnio granego) i to, który sklep otworzyć. Sklep po pełnym sezonie to ok. 10 KB, więc
 * paczka mieści się w 64 KB z zapasem. Pozostałe sklepy zapisane na pierwszym urządzeniu zostają tam. Klucza gracza w paczce nie
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

/** Paczka z tego urządzenia (tekst JSON) albo null, gdy nie ma czego wysłać: brak sklepu, uszkodzony zapis albo meta z nowszej wersji gry. */
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
  const { player, ...rest } = meta;
  const withoutKey: Meta = player ? { ...rest, player: { nick: player.nick, look: player.look, specialOutfits: player.specialOutfits } } : rest;
  const bundle: TransferBundle = { format: TRANSFER_FORMAT, version: 1, seed, meta: withoutKey, save };
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
  if (typeof data.save.schema === 'number' && data.save.schema > SAVE_SCHEMA) return { error: NEWER_SAVE_NOTICE };
  const incoming = sanitizeMeta(data.meta);
  const local = loadMeta();
  if (incoming.readOnly || local.readOnly) return { error: NEWER_SAVE_NOTICE };
  return { seed: data.seed, save: data.save, incoming, local };
}

/**
 * Wczytuje paczkę z drugiego urządzenia: zapis jej sklepu (pod jego seedem; inne sklepy tego urządzenia zostają), metę i „ostatni
 * sklep”. Klucz gracza zostaje tutejszy (paczka go nie ma, a to nim pobrano ją z serwera). Paczka albo meta tego urządzenia
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
    localStorage.setItem(SAVE_PREFIX + seed, JSON.stringify(save));
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

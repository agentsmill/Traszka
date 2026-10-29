import { loadMeta, sanitizeMeta, saveMeta, type Meta } from '@/game/meta';
import { NEWER_SAVE_NOTICE, SAVE_SCHEMA, lastSavedSeed } from '@/game/session';
import { isRec } from '@/sim/guards';

/**
 * Paczka do „Wyślij zapis” i „Pobierz zapis” (spec §14.7): wszystko, czego gra potrzebuje, żeby na drugim urządzeniu wczytać
 * się tak jak na pierwszym (decyzja właściciela gry, 2026-10-28): meta (gracz, sieć sklepów, Punkty Partnera, seria dni,
 * ustawienia), zapis bieżącego sklepu (ostatnio granego) i to, który sklep otworzyć. Sklep po pełnym sezonie to ok. 10 KB, więc
 * paczka mieści się w 64 KB z zapasem. Pozostałe sklepy zapisane na pierwszym urządzeniu zostają tam. Klucza gracza w paczce nie
 * ma: serwer trzyma paczkę pod skrótem klucza i samego klucza nie przechowuje (§14.7), a drugie urządzenie ma już ten klucz z kodu.
 *
 * Gra trzyma metę i sesję w pamięci i zapisuje je co chwilę, więc po `importTransfer` trzeba przeładować stronę (inaczej stan z
 * pamięci nadpisze wczytaną paczkę). O zgodę na zastąpienie zapisu pyta panel „Kod odzyskiwania”, zanim zawoła import.
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

/**
 * Wczytuje paczkę z drugiego urządzenia: zapis jej sklepu (pod jego seedem; inne sklepy tego urządzenia zostają), metę i „ostatni
 * sklep”. Klucz gracza zostaje tutejszy (paczka go nie ma, a to nim pobrano ją z serwera). Paczka albo meta tego urządzenia
 * z nowszej wersji gry: nic nie zapisujemy. Zwraca seed sklepu do otwarcia (po przeładowaniu strony) albo komunikat.
 */
export function importTransfer(text: string): ImportResult {
  const data = parse(text);
  if (!isRec(data) || data.format !== TRANSFER_FORMAT || data.version !== 1 || typeof data.seed !== 'string' || data.seed === ''
    || !isRec(data.save) || !isRec(data.meta)) {
    return { error: TRANSFER_ERRORS.invalid };
  }
  if (typeof data.save.schema === 'number' && data.save.schema > SAVE_SCHEMA) return { error: NEWER_SAVE_NOTICE };
  const incoming = sanitizeMeta(data.meta);
  const local = loadMeta();
  if (incoming.readOnly || local.readOnly) return { error: NEWER_SAVE_NOTICE };
  const localKey = local.player?.key;
  const player = incoming.player && localKey !== undefined ? { ...incoming.player, key: localKey } : incoming.player ?? local.player;
  const meta: Meta = { ...incoming, ...(player ? { player } : {}) };
  try {
    localStorage.setItem(SAVE_PREFIX + data.seed, JSON.stringify(data.save));
    localStorage.setItem(LAST_KEY, data.seed);
  } catch {
    return { error: TRANSFER_ERRORS.storage };
  }
  saveMeta(meta);
  return { seed: data.seed };
}

import { isRec } from '../sim/guards.js';
import { SAVE_BUNDLE_FORMAT, SAVE_BUNDLE_VERSION, SAVE_MAX_BYTES, SAVE_TTL } from './config.js';
import { fail, type Checked } from './errors.js';
import { KEYS } from './keys.js';
import { asString, run, type RedisExec } from './redis.js';

/**
 * Przenoszenie zapisu kodem odzyskiwania (spec §14.7), tylko na wyraźne polecenie: „Wyślij zapis” kładzie na serwerze jedną kopię
 * na klucz (do 64 KB, nowa zastępuje starą i odnawia 30 dni życia), a „Pobierz zapis” ją oddaje; gra pyta, zanim zastąpi zapis na
 * urządzeniu. Serwer treści zapisu nie czyta: sprawdza tylko, że to paczka z gry (kształt `TransferBundle`) w granicy rozmiaru.
 * Treść sprawdza gra przy wczytaniu (jak każdy zapis).
 */

const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Paczka z gry (`TransferBundle` w `src/ui/ranking/saveTransfer.ts`): format i wersja, niepusty seed sklepu oraz `meta` i `save` jako
 * obiekty. Dokładnie to, co przyjmie `importTransfer` po stronie gry; reszty (pól wewnątrz `meta` i `save`) serwer nie ocenia.
 */
function isBundle(v: unknown): boolean {
  return isRec(v) && v.format === SAVE_BUNDLE_FORMAT && v.version === SAVE_BUNDLE_VERSION
    && typeof v.seed === 'string' && v.seed !== '' && isRec(v.meta) && isRec(v.save);
}

/** Zapis z żądania: tekst JSON z paczką z gry, najwyżej 64 KB w UTF-8. Cokolwiek innego to `bad-save` (za duży: `save-too-large`). */
export function checkSave(save: unknown): Checked<string> {
  if (typeof save !== 'string') return fail('bad-save');
  if (bytesOf(save) > SAVE_MAX_BYTES) return fail('save-too-large');
  try {
    if (!isBundle(JSON.parse(save))) return fail('bad-save');
  } catch {
    return fail('bad-save');
  }
  return { ok: true, value: save };
}

/**
 * W bazie leży `{savedAt}\n{tekst paczki}`: paczka bajt w bajt, a chwila wysłania (ms, same cyfry) w pierwszej linii. Gdyby wpis
 * był kopertą JSON `{ savedAt, save }`, każdy cudzysłów i ukośnik paczki byłby ucieczkowany drugi raz i 64 KB zajmowało nawet 128 KB.
 * `SET … EX` ustawia wartość i czas życia jednym poleceniem, więc wpis bez czasu życia nie może powstać.
 */
export async function putSave(redis: RedisExec, owner: string, save: string, now: number): Promise<{ bytes: number; savedAt: number }> {
  await run(redis, ['SET', KEYS.save(owner), `${now}\n${save}`, 'EX', SAVE_TTL]);
  return { bytes: bytesOf(save), savedAt: now };
}

export async function getSave(redis: RedisExec, owner: string): Promise<{ save: string; savedAt: number } | null> {
  const raw = asString(await run(redis, ['GET', KEYS.save(owner)]));
  if (raw === null) return null;
  const cut = raw.indexOf('\n');
  const head = raw.slice(0, Math.max(cut, 0));
  const save = raw.slice(cut + 1);
  return cut > 0 && /^\d{1,16}$/.test(head) && save !== '' ? { save, savedAt: Number(head) } : null;
}

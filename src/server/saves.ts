import { isRec } from '../sim/guards.js';
import { SAVE_MAX_BYTES, SAVE_TTL } from './config.js';
import { fail, type Checked } from './errors.js';
import { KEYS } from './keys.js';
import { asString, run, type RedisExec } from './redis.js';

/**
 * Przenoszenie zapisu kodem odzyskiwania (spec §14.7), tylko na wyraźne polecenie: „Wyślij zapis” kładzie na serwerze jedną kopię
 * na klucz (do 64 KB, nowa zastępuje starą), a „Pobierz zapis” ją oddaje; gra pyta, zanim zastąpi zapis na urządzeniu. Serwer
 * zapisu nie czyta: sprawdza tylko, że to obiekt JSON w granicy rozmiaru. Treść sprawdza gra przy wczytaniu (jak każdy zapis).
 */

const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

/** Zapis z żądania: tekst JSON z obiektem, najwyżej 64 KB w UTF-8. */
export function checkSave(save: unknown): Checked<string> {
  if (typeof save !== 'string') return fail('bad-save');
  if (bytesOf(save) > SAVE_MAX_BYTES) return fail('save-too-large');
  try {
    if (!isRec(JSON.parse(save))) return fail('bad-save');
  } catch {
    return fail('bad-save');
  }
  return { ok: true, value: save };
}

export async function putSave(redis: RedisExec, owner: string, save: string, now: number): Promise<{ bytes: number; savedAt: number }> {
  await run(redis, ['SET', KEYS.save(owner), JSON.stringify({ savedAt: now, save }), 'EX', SAVE_TTL]);
  return { bytes: bytesOf(save), savedAt: now };
}

export async function getSave(redis: RedisExec, owner: string): Promise<{ save: string; savedAt: number } | null> {
  const raw = asString(await run(redis, ['GET', KEYS.save(owner)]));
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isRec(v) && typeof v.save === 'string' && Number.isFinite(v.savedAt) ? { save: v.save, savedAt: v.savedAt as number } : null;
  } catch {
    return null;
  }
}

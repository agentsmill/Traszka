import { nickKey, normalizeNick } from '../game/nick.js';
import { parseRecoveryCode } from '../game/playerKey.js';
import { isRec } from '../sim/guards.js';
import {
  KNOWN_GAME_VERSIONS, KNOWN_GENERATOR_VERSIONS, RUN_MAX_COMMAND_BYTES, RUN_MAX_LOG_ENTRIES, RUN_MAX_SEED_CHARS, SEASON_END_MINUTE,
} from './config.js';
import { fail, type Checked } from './errors.js';

/**
 * Bieg zgłoszony do rankingu. Typy to kopia kontraktu z dokumentu etapu 2 (§2, `src/sim/run.ts` dostarcza strumień A): po
 * scaleniu A zastąpić je importem typów z `run.ts` (polecenie jest tam unią `Command`; tu wystarcza obiekt z polem `type`, a
 * resztę sprawdza `applyCommand` przy odtwarzaniu).
 */
export interface RunCommand { type: string; [field: string]: unknown }
export interface LogEntry { minute: number; seq: number; cmd: RunCommand }
export interface RunRecord {
  seed: string; gameVersion: string; generatorVersion: number;
  mode: 'casual' | 'ranked'; log: LogEntry[];
}

/** Zgłoszenie po sprawdzeniu: klucz w postaci kanonicznej, nick po `normalizeNick` (do wyświetlania) i jego klucz porównań. */
export interface Submission { key: string; nick: string; nickKey: string; run: RunRecord }

/** Typ polecenia: krótki identyfikator (jak `tapPallet`), bez spacji i znaków spoza ASCII. */
const COMMAND_TYPE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
/** Znaki, których nie wolno pokazać w rankingu: sterujące, formatujące (kierunek tekstu, zerowej szerokości, BOM) i separatory wierszy. Spójnik emoji (U+200D) zostaje. */
const HIDDEN = /[\p{Cc}\p{Zl}\p{Zp}]|(?!‍)\p{Cf}/u;
const isWhole = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Klucz gracza i nick wspólne dla wszystkich zgłoszeń z nickiem (bieg, sprawdzenie nicka). Brak pola to zły formularz, zły klucz to `bad-key`. */
export function parseKeyAndNick(key: unknown, nick: unknown): Checked<{ key: string; nick: string; nickKey: string }> {
  if (key === undefined || typeof nick !== 'string') return fail('bad-request');
  const parsedKey = parseRecoveryCode(key);
  if (parsedKey === null) return fail('bad-key');
  const n = normalizeNick(nick);
  if ('error' in n) return fail('bad-nick', n.error);
  return { ok: true, value: { key: parsedKey, nick: n.nick, nickKey: nickKey(n.nick) } };
}

/** Seed z biegu, który da się pokazać w rankingu: 1–48 znaków, bez spacji na brzegach i bez znaków niewidocznych. */
export function isShowableSeed(seed: string): boolean {
  const chars = Array.from(seed).length;
  return chars >= 1 && chars <= RUN_MAX_SEED_CHARS && seed === seed.trim() && !HIDDEN.test(seed);
}

function parseLog(raw: unknown[]): Checked<LogEntry[]> {
  if (raw.length > RUN_MAX_LOG_ENTRIES) return fail('too-large');
  const log: LogEntry[] = [];
  let prevMinute = -1;
  let prevSeq = -1;
  for (const e of raw) {
    if (!isRec(e) || !isWhole(e.minute, 0, SEASON_END_MINUTE - 1) || !isWhole(e.seq, 0, 2 ** 31) || !isRec(e.cmd)) return fail('bad-log');
    if (e.minute < prevMinute || (e.minute === prevMinute && e.seq <= prevSeq)) return fail('bad-log');
    if (typeof e.cmd.type !== 'string' || !COMMAND_TYPE.test(e.cmd.type)) return fail('bad-log');
    const json = JSON.stringify(e.cmd);
    if (json.length > RUN_MAX_COMMAND_BYTES) return fail('bad-log');
    log.push({ minute: e.minute, seq: e.seq, cmd: JSON.parse(json) as RunCommand });
    prevMinute = e.minute;
    prevSeq = e.seq;
  }
  return { ok: true, value: log };
}

/**
 * Ciało `POST /api/runs` (`{ key, nick, run }`) bez zaufania → zgłoszenie albo błąd. Kolejność: kształt, klucz, nick (reguły gry;
 * filtra słów nie ma, decyzja właściciela gry z 2026-10-28), wersja gry i generatora, tryb rankingowy, seed, dziennik. Bieg dostaje tylko pola kontraktu (obce
 * odpadają), a polecenia są kopiami. Sam wynik liczy dopiero odtworzenie (`verify.ts`).
 */
export function parseSubmission(body: unknown): Checked<Submission> {
  if (!isRec(body) || !isRec(body.run)) return fail('bad-request');
  const who = parseKeyAndNick(body.key, body.nick);
  if (!who.ok) return who;
  const r = body.run;
  if (typeof r.seed !== 'string' || typeof r.gameVersion !== 'string' || typeof r.generatorVersion !== 'number' || !Array.isArray(r.log)) {
    return fail('bad-request');
  }
  if (r.mode !== 'ranked' && r.mode !== 'casual') return fail('bad-request');
  if (!KNOWN_GAME_VERSIONS.includes(r.gameVersion) || !KNOWN_GENERATOR_VERSIONS.includes(r.generatorVersion)) return fail('old-version');
  if (r.mode !== 'ranked') return fail('not-ranked');
  if (!isShowableSeed(r.seed)) return fail('bad-seed');
  const log = parseLog(r.log);
  if (!log.ok) return log;
  return {
    ok: true,
    value: {
      ...who.value,
      run: { seed: r.seed, gameVersion: r.gameVersion, generatorVersion: r.generatorVersion, mode: 'ranked', log: log.value },
    },
  };
}

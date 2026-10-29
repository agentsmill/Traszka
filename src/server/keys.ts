import { sha256Hex } from './hash.js';

/**
 * Układ kluczy w Upstash (wszystkie z przedrostkiem `tr:`, żeby baza mogła kiedyś służyć czemuś jeszcze):
 *
 * - `tr:nick:{nickKey}` → JSON `{ nick, owner, since, lastScoreAt }`: rezerwacja nicka, żyje rok od ostatniego wyniku;
 * - `tr:owner:{owner}` → zbiór kluczy nicków gracza (do „Twoje nicki” po wpisaniu kodu na nowym urządzeniu);
 * - `tr:lb:global`, `tr:lb:seed:{seedId}`, `tr:lb:week:{rrrr-Wtt}` → zbiory sortowane, członek `{tag}:{nickKey}`, wynik w zł;
 * - `tr:entry:{tag}:{nickKey}` → JSON `{ nick, seed, at }`: nick do wyświetlania oraz seed i chwila najlepszego wyniku w rankingu
 *   globalnym; bez czasu życia, bo wyniki zostają w rankingu także po wygaśnięciu rezerwacji nicka;
 * - `tr:save:{owner}` → tekst `{savedAt}\n{paczka zapisu}`: jeden zapis gry na klucz, paczka bajt w bajt (bez ucieczek JSON-a w
 *   JSON-ie, więc 64 KB zajmuje w bazie 64 KB), a chwila wysłania (ms) w pierwszej linii;
 * - `tr:salt:{okno}:{nr}` → losowa sól okna limitu, tylko bez `RANKING_SALT` (z sekretem skrót adresu liczy się bez soli w bazie);
 * - `tr:rl:{akcja}:{nr}:{k|a}:{skrót}` → liczniki limitu zgłoszeń na klucz (`k`: początek hasha właściciela) i na adres (`a`: skrót
 *   z solą okna albo HMAC z `RANKING_SALT`); sól i liczniki giną z końcem okna (czas życia względny: `PX`, `PEXPIRE`);
 * - `tr:budget:{nazwa}:{RRRR-MM-DD}` → globalny licznik wysłań w dobie UTC (np. `tr:budget:save:2026-10-28`), żyje dobę.
 *
 * `owner` to SHA-256 klucza gracza (samego klucza serwer nie przechowuje), `tag` to jego pierwsze 16 znaków: członek rankingu
 * pamięta, czyj był wynik, więc gdy wygasły nick zarezerwuje ktoś inny, stare wyniki zostają osobnym wpisem i nie łączą się z jego.
 */
const P = 'tr:';

export const KEYS = {
  nick: (nickKey: string): string => `${P}nick:${nickKey}`,
  ownerNicks: (owner: string): string => `${P}owner:${owner}`,
  global: `${P}lb:global`,
  seed: (seedId: string): string => `${P}lb:seed:${seedId}`,
  week: (weekId: string): string => `${P}lb:week:${weekId}`,
  entry: (member: string): string => `${P}entry:${member}`,
  save: (owner: string): string => `${P}save:${owner}`,
  salt: (window: number, index: number): string => `${P}salt:${window}:${index}`,
  rate: (action: string, index: number, who: string): string => `${P}rl:${action}:${index}:${who}`,
  budget: (name: string, day: string): string => `${P}budget:${name}:${day}`,
} as const;

/** Właściciel nicka: SHA-256 klucza gracza (w postaci kanonicznej, z przedrostkiem tej gry). */
export const ownerOf = (key: string): Promise<string> => sha256Hex(`traszka:gracz:${key}`);

/** Identyfikator seeda w kluczu Redisa (seed to dowolny tekst z emoji, a klucz ma być krótki i przewidywalny). */
export const seedIdOf = async (seed: string): Promise<string> => (await sha256Hex(`traszka:seed:${seed}`)).slice(0, 32);

const TAG = 16;
export const tagOf = (owner: string): string => owner.slice(0, TAG);
export const memberOf = (owner: string, nickKey: string): string => `${tagOf(owner)}:${nickKey}`;

/** Członek rankingu z powrotem na tag właściciela i klucz nicka (klucz nicka nie ma dwukropka: reguły nicka go nie dopuszczają). */
export function parseMember(member: string): { tag: string; nickKey: string } {
  const i = member.indexOf(':');
  return { tag: member.slice(0, Math.max(0, i)), nickKey: member.slice(i + 1) };
}

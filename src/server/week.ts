import { SEED_WORDS } from '../game/seedWords.js';

/**
 * „Seed tygodnia” (spec §14.7): co tydzień jeden wspólny seed i osobny ranking z wyników zgłoszonych w tym tygodniu. Tydzień
 * ISO liczony w UTC (od poniedziałku 00:00 UTC, czyli 1:00 albo 2:00 w Polsce). Seed wynika z numeru tygodnia, więc każdy
 * serwer i każda gra policzą ten sam; ma format losowych seedów gry („pierogi-731”), żeby adres nie wymagał kodowania.
 */
export interface Week { id: string; seed: string; startsAt: number; endsAt: number }

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** FNV-1a 32 bit: krótki, deterministyczny skrót tekstu (bez kryptografii, wystarczy do wybrania słowa). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Poniedziałek 00:00 UTC tygodnia, w którym leży `ms`. */
const mondayOf = (ms: number): number => {
  const day = Math.floor(ms / DAY_MS);
  const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;   // poniedziałek = 0
  return (day - weekday) * DAY_MS;
};

export function weekOf(nowMs: number): Week {
  const startsAt = mondayOf(nowMs);
  const year = new Date(startsAt + 3 * DAY_MS).getUTCFullYear();   // rok tygodnia ISO to rok jego czwartku
  const firstMonday = mondayOf(Date.UTC(year, 0, 4));               // 4 stycznia zawsze leży w 1. tygodniu
  const n = Math.round((startsAt - firstMonday) / WEEK_MS) + 1;
  const id = `${year}-W${String(n).padStart(2, '0')}`;
  const seed = `${SEED_WORDS[fnv1a(`tydzien:${id}`) % SEED_WORDS.length]}-${100 + (fnv1a(`liczba:${id}`) % 900)}`;
  return { id, seed, startsAt, endsAt: startsAt + WEEK_MS };
}

/** Czy bieg grano na seedzie tygodnia: ten sam seed albo sąsiedni lokal (`seed·n`), gdyby generator nie złożył sklepu z samego seeda. */
export const isWeekSeed = (runSeed: string, week: Week): boolean => runSeed === week.seed || runSeed.startsWith(`${week.seed}·`);

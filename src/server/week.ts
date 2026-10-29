import { SEED_WORDS } from '../game/seedWords.js';
import { SEED_NEIGHBOURS } from './config.js';

/**
 * „Seed tygodnia” (spec §14.7): co tydzień jeden wspólny seed i osobny ranking z wyników zgłoszonych w tym tygodniu. Tydzień ISO
 * liczony w czasie polskim (Europe/Warsaw, z czasem letnim): zaczyna się w poniedziałek o północy w Polsce (decyzja właściciela gry,
 * 2026-10-28). Seed wynika z numeru tygodnia, więc każdy serwer policzy ten sam; ma format losowych seedów gry („pierogi-731”),
 * żeby adres nie wymagał kodowania.
 */
export interface Week { id: string; seed: string; startsAt: number; endsAt: number }

const ZONE = 'Europe/Warsaw';
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const clockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});

/** Godzina na zegarku w Polsce w chwili `ms`, zapisana jak czas UTC (do zwykłej arytmetyki dat). */
function wallClock(ms: number): number {
  const p: Record<string, number> = {};
  for (const part of clockParts.formatToParts(new Date(ms))) p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** Chwila (ms), w której zegarek w Polsce pokazuje `wall` (północ w poniedziałek nigdy nie wypada w zmianie czasu, w niedzielę nad ranem). */
function instantOf(wall: number): number {
  const guess = wall - (wallClock(wall) - wall);
  return wall - (wallClock(guess) - guess);
}

/** FNV-1a 32 bit: krótki, deterministyczny skrót tekstu (bez kryptografii, wystarczy do wybrania słowa). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Poniedziałek 00:00 tygodnia, w którym leży `ms` (na osi „zegarka zapisanego jak UTC”). */
const mondayOf = (ms: number): number => {
  const day = Math.floor(ms / DAY_MS);
  const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;   // poniedziałek = 0
  return (day - weekday) * DAY_MS;
};

export function weekOf(nowMs: number): Week {
  const monday = mondayOf(wallClock(nowMs));
  const year = new Date(monday + 3 * DAY_MS).getUTCFullYear();   // rok tygodnia ISO to rok jego czwartku
  const firstMonday = mondayOf(Date.UTC(year, 0, 4));             // 4 stycznia zawsze leży w 1. tygodniu
  const n = Math.round((monday - firstMonday) / WEEK_MS) + 1;
  const id = `${year}-W${String(n).padStart(2, '0')}`;
  const seed = `${SEED_WORDS[fnv1a(`tydzien:${id}`) % SEED_WORDS.length]}-${100 + (fnv1a(`liczba:${id}`) % 900)}`;
  // tydzień ze zmianą czasu ma 167 albo 169 godzin, więc koniec liczymy osobno, a nie jako początek + 7 dni
  return { id, seed, startsAt: instantOf(monday), endsAt: instantOf(monday + WEEK_MS) };
}

/**
 * Czy bieg grano na seedzie tygodnia: dokładnie ten seed albo sąsiedni lokal `seed·1` … `seed·5` (gdyby generator nie złożył
 * sklepu z samego seeda). Żaden inny sufiks po „·” nie jest seedem tygodnia: każdy sufiks to inny sklep, więc dopuszczenie
 * dowolnego pozwalałoby wypróbować dowolnie wiele układów lokalu offline i wysłać najlepszy do rankingu „wszyscy grają to samo”.
 */
export function isWeekSeed(runSeed: string, week: Week): boolean {
  if (runSeed === week.seed) return true;
  for (let n = 1; n <= SEED_NEIGHBOURS; n++) if (runSeed === `${week.seed}·${n}`) return true;
  return false;
}

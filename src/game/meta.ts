import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import type { EconomyState } from '@/sim/economy/economy';
import { LIMITS } from '@/sim/economy/sanitize';
import { isRec, num, whole } from '@/sim/guards';
import { DEFAULT_CASHIER_LOOK, isCashierLook, type CashierLook } from './cashier';
import { normalizeNick } from './nick';

/**
 * Postęp ponad pojedynczym sklepem (localStorage, wspólny dla wszystkich seedów): sieć sklepów z poprzednich rozgrywek,
 * Punkty Partnera (trwała premia), seria dni gry i ustawienia dźwięku. To pętla „bez końca”: każdy kolejny sklep
 * startuje z premią i dochodem z sieci.
 */
export interface NetworkStore { seed: string; income: number; level: number; margin: number }

/** Gracz z ekranu startowego „Twój kasjer”: nazwa, wygląd kasjera za ladą i przełącznik strojów specjalnych w losowaniu. */
export interface Player {
  /** Nazwa po `normalizeNick` (1–20 znaków). */
  nick: string;
  look: CashierLook;
  /** „Stroje specjalne w losowaniu” (domyślnie włączone). */
  specialOutfits: boolean;
}

export interface Meta {
  /** Wersja formatu mety: znacznik schematu. Wyższa niż ta, którą umiemy czytać, znaczy „zapisała nowsza wersja gry”. */
  version: 1;
  partnerPoints: number;
  network: NetworkStore[];
  daily: { date: string; streak: number };
  lastSeen: number;
  sound: boolean;
  vibration: boolean;
  /**
   * Gracz z ekranu startowego. Brak pola to pierwsze wejście (albo meta sprzed ekranu startowego): wtedy ekran startowy się
   * pokazuje. Stara meta bez tego pola działa jak dotąd, a gra używa wtedy domyślnego kasjera (`DEFAULT_CASHIER_LOOK`).
   */
  player?: Player;
  /**
   * Meta zapisana przez nowszą wersję gry: w tej karcie działają wartości domyślne, a pod kluczem mety nic się nie zapisuje,
   * żeby nie zjeść cudzej sieci sklepów i punktów. Zwykła meta nie ma tego pola w ogóle.
   */
  readOnly?: true;
}

const KEY = 'traszka:meta';
const META_VERSION = 1;

const defaults = (): Meta => ({
  version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true,
});

export function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeMeta(JSON.parse(raw) as unknown) : defaults();
  } catch {
    return defaults();
  }
}

/** Najdalszy czas, jaki rozumie `Date` (ms): `lastSeen` spoza tego zakresu to nie data. */
const MAX_TIME_MS = 8.64e15;

/**
 * Meta z zapisu bez zaufania (jak zapis sklepu): zły typ pola daje wartość domyślną, uszkodzony wpis sieci wypada, a liczby
 * mają te same granice co stan sklepu (`LIMITS`): dwa wpisy sieci po 1e308 zł dochodu dawały `Infinity` w kasie sklepu.
 */
export function sanitizeMeta(data: unknown): Meta {
  const d = defaults();
  // znacznik schematu to `version`; `schema` (jak w kopercie zapisu sklepu) też uznajemy, gdyby nowsza wersja go dopisała
  if (isRec(data) && [data.version, data.schema].some((v) => typeof v === 'number' && v > META_VERSION)) return { ...d, readOnly: true };
  if (!isRec(data) || data.version !== META_VERSION) return d;
  const daily = isRec(data.daily) && typeof data.daily.date === 'string'
    ? { date: data.daily.date, streak: whole(data.daily.streak, 0, 0, LIMITS.minute / MINUTES_PER_DAY) } : d.daily;
  const network = Array.isArray(data.network) ? data.network.flatMap((n): NetworkStore[] => (
    isRec(n) && typeof n.seed === 'string' && Number.isFinite(n.income) && Number.isFinite(n.level) && Number.isFinite(n.margin)
      ? [{
        seed: n.seed,
        income: num(n.income, 0, 0, LIMITS.money),
        level: whole(n.level, 1, 1, LIMITS.level),
        margin: num(n.margin, 0, 0, LIMITS.money),
      }] : []
  )).slice(0, LIMITS.network) : d.network;
  const player = sanitizePlayer(data.player);
  return {
    version: 1,
    partnerPoints: num(data.partnerPoints, 0, 0, LIMITS.partnerPoints),
    network,
    daily,
    lastSeen: num(data.lastSeen, 0, 0, MAX_TIME_MS),
    sound: typeof data.sound === 'boolean' ? data.sound : d.sound,
    vibration: typeof data.vibration === 'boolean' ? data.vibration : d.vibration,
    ...(player ? { player } : {}),
  };
}

/**
 * Gracz z zapisu bez zaufania: nick przechodzi `normalizeNick` (zły nick to brak gracza, a ekran startowy pokaże się jeszcze raz,
 * bo bez nicka nie ma kogo zapisać), wygląd kasjera `isCashierLook` (zły to wygląd domyślny, własna kopia, bez obcych pól),
 * przełącznik strojów specjalnych musi być wartością logiczną (inaczej włączony).
 */
function sanitizePlayer(raw: unknown): Player | undefined {
  if (!isRec(raw) || typeof raw.nick !== 'string') return undefined;
  const nick = normalizeNick(raw.nick);
  if (!('nick' in nick)) return undefined;
  const look = isCashierLook(raw.look) ? raw.look : DEFAULT_CASHIER_LOOK;
  return {
    nick: nick.nick,
    look: { outfit: look.outfit, appearanceSeed: look.appearanceSeed },
    specialOutfits: typeof raw.specialOutfits === 'boolean' ? raw.specialOutfits : true,
  };
}

export function saveMeta(meta: Meta): void {
  if (meta.readOnly) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    // bez zapisu
  }
}

/** Premia sieci dla nowego albo wczytanego sklepu. */
export function partnerOf(meta: Meta): EconomyState['partner'] {
  return {
    points: meta.partnerPoints,
    networkIncome: meta.network.reduce((n, x) => n + x.income, 0),
    stores: meta.network.length,
  };
}

/** Kiedy można otworzyć kolejny sklep: po drugim remoncie albo na 20. poziomie. */
export const prestigeReady = (s: EconomyState): boolean => s.remontLevel >= 2 || s.level >= 20;

/** Ile Punktów Partnera da zamknięcie obecnego sklepu (pierwiastek z zarobionej marży, min. 1). */
export const prestigePoints = (s: EconomyState): number => Math.max(1, Math.floor(Math.sqrt(s.total.margin / 20_000)));

/** Dochód, który ten sklep będzie dawał sieci co dzień: 10% najlepszego dnia (min. 200 zł). */
export const networkIncomeOf = (s: EconomyState): number => Math.max(200, Math.round(0.1 * s.bestDayProfit));

/**
 * Dopisuje sklep do sieci i przyznaje punkty. Zwraca nową metę (zapis robi wołający). Sklep o tym samym seedzie wchodzi do
 * sieci raz: drugie zamknięcie niczego nie dopisuje, więc nie da się nabijać Punktów Partnera jednym lokalem.
 */
export function addToNetwork(meta: Meta, s: EconomyState): Meta {
  if (meta.network.some((n) => n.seed === s.seed)) return meta;
  return {
    ...meta,
    partnerPoints: meta.partnerPoints + prestigePoints(s),
    network: [...meta.network, { seed: s.seed, income: networkIncomeOf(s), level: s.level, margin: Math.round(s.total.margin) }],
  };
}

const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Seria dni, którą dałby dzisiejszy dzień, albo null, gdy dzisiejszy już odebrano. Niczego nie zapisuje: seria przesuwa się
 * dopiero w `claimDaily`, po „Odbierz!”, więc odświeżenie strony przed odbiorem (albo start nowej gry z ekranem
 * powitalnym zamiast premii) nie zjada nagrody. Wczorajszy dzień przedłuża serię, przerwa zaczyna od 1.
 */
export function pendingDaily(meta: Meta, now: Date): number | null {
  const today = dayKey(now);
  if (meta.daily.date === today) return null;
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  return meta.daily.date === yesterday ? meta.daily.streak + 1 : 1;
}

/** Odbiór dzisiejszej premii: zapisuje dzień i serię (taką, jaką gracz widział w oknie), zapis mety robi wołający. */
export function claimDaily(meta: Meta, streak: number, now: Date): void {
  meta.daily = { date: dayKey(now), streak };
}

/** Nagroda dzienna za `streak` dni z rzędu (rośnie do 7. dnia). */
export function dailyReward(streak: number, level: number): { cash: number; ogonki: number } {
  const d = Math.min(7, streak);
  return { cash: d * (300 + 50 * level), ogonki: 2 * d + (d === 7 ? 10 : 0) };
}

/** Zarobek kierownika zmiany za `hours` nieobecności: ćwierć ostatniego dnia na godzinę, najwyżej 8 godzin. */
export function offlineEarnings(s: EconomyState, hours: number): number {
  if (hours < 0.05 || s.lastDayProfit <= 0) return 0;
  return Math.round(s.lastDayProfit * 0.25 * Math.min(8, hours));
}

/** Okno „Witaj z powrotem”: zarobek pod nieobecność i premia za serię dni. */
export interface WelcomeOffer { hours: number; offline: number; streak: number | null; daily: { cash: number; ogonki: number } | null }

/** Co gracz ma do odebrania po powrocie do istniejącej gry (null: nic). Nie zmienia mety; odbiór to `claimDaily` i `grantOffline`. */
export function welcomeOffer(meta: Meta, s: EconomyState, now: Date): WelcomeOffer | null {
  const hours = meta.lastSeen > 0 ? (now.getTime() - meta.lastSeen) / 3_600_000 : 0;
  const offline = offlineEarnings(s, hours);
  const streak = pendingDaily(meta, now);
  const daily = streak !== null ? dailyReward(streak, s.level) : null;
  return offline > 0 || daily ? { hours, offline, streak, daily } : null;
}

/**
 * Czy przy wejściu na stronę pokazać ekran startowy „Twój kasjer”: gdy nie ma jeszcze gracza (pierwsze wejście albo meta sprzed
 * ekranu startowego). Meta z nowszej wersji gry go nie dostaje: tamta wersja miała już swojego gracza, a ta karta nie umie go
 * zapisać, więc ekran wracałby co wejście. Wciąż można go otworzyć z ⚙ („Nowy sklep”).
 */
export const needsStartScreen = (meta: Meta): boolean => !meta.readOnly && meta.player === undefined;

/** Co pokazać po otwarciu sklepu: ekran powitalny nowej gry albo okno „Witaj z powrotem”. */
export interface StartupWindow { intro: boolean; welcome: WelcomeOffer | null }

/**
 * Nowa gra (sklep na kreskę) dostaje ekran powitalny i niczego nie odbiera. Istniejąca gra dostaje okno powitalne, o ile
 * ma co oddać. Nic nie dostaje: koniec gry (wstaje okno wypowiedzenia umowy), sklep tymczasowy (to nie pierwsza gra
 * gracza, a nagrody miałyby wylądować w sklepie, którego nikt nie zapisze) i gra z metą z nowszej wersji (seria dni
 * i czas wyjścia są domyślne, więc nagroda wracałaby przy każdym odświeżeniu).
 */
export function startupWindow(meta: Meta, s: EconomyState, ephemeral: boolean, now: Date): StartupWindow {
  const none = { intro: false, welcome: null };
  if (ephemeral || s.gameOver) return none;
  if (s.minute === OPEN_FROM && s.total.customers === 0) return { intro: true, welcome: null };
  return meta.readOnly ? none : { intro: false, welcome: welcomeOffer(meta, s, now) };
}

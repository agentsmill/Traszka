import { signal, type ReadonlySignal } from '@preact/signals';
import { markFameSent, type Meta } from '@/game/meta';
import { normalizeNick } from '@/game/nick';
import { isShowableSeed } from '@/game/seedText';
import { numberLocale } from '@/i18n';
import { FAME_CASH, FAME_DAY, FAME_SIM, RUN_MAX_SEED_CHARS } from '@/server/config';
import { SIM_VERSION } from '@/sim/simVersion';
import type { FameOffer } from '../state';
import { NETWORK_ERROR, type ApiResult, type FameRow, type FameSubmitted, type RankingClient } from './client';

/**
 * Stan Galerii sław po stronie gry (4b §5.7), bez DOM, do testów: wysłanie wpisu po pierwszym milionie (`FameWindow`) i lista „Galeria sław
 * Traszki” w panelu rankingu. Wpis wysyła gracz przyciskiem; gdy się nie uda (brak sieci, ranking wyłączony, limit), nic nie przepada:
 * seed trafia do `meta.fameSent` dopiero po przyjęciu przez serwer, a do tego czasu zakładka Galerii pokazuje „Wyślij mój wpis”
 * (`pending`). Nic tu nie blokuje gry: model nie rzuca, a każda odpowiedź serwera kończy się komunikatem.
 */

export const SENDING_TEXT = 'Wysyłamy wpis do Galerii…';
export const FAME_CLOSED_TEXT = 'Galeria jest teraz nieczynna. Wpis wyślesz później z panelu rankingu.';
export const FAME_LIST_CLOSED_TEXT = 'Galeria jest teraz nieczynna. Zajrzyj później.';
export const NICK_TAKEN_TEXT = 'Ten nick jest zajęty. Wybierz inny i spróbuj jeszcze raz.';
export const NO_KEY_TEXT = 'Brak klucza gracza. Odśwież stronę i spróbuj jeszcze raz.';
export const NOT_SENDABLE_TEXT = 'Tego wpisu Galeria nie przyjmie.';

/** Kody, po których serwer odpowiada czymś, co ma sens pokazać słowami serwera (kontrola wiarygodności, limity, klucz i nick). */
const SERVER_MESSAGE_CODES: ReadonlySet<string> = new Set(['fame-invalid', 'fame-budget', 'rate-limited', 'bad-key', 'bad-nick']);

export type FameState = 'idle' | 'sending' | 'sent' | 'error';

export interface FameListView {
  status: 'loading' | 'ready' | 'error';
  rows: FameRow[];
  /** Wszystkich wpisów w Galerii (lista pokazuje najwyżej pierwszą setkę). */
  total: number;
  message: string | null;
}

export interface FameModel {
  state: ReadonlySignal<FameState>;
  /** Nick w polu okna: na początku nick gracza z mety, potem to, co gracz wpisze. */
  nick: ReadonlySignal<string>;
  /** Komunikat okna (polski, okno tłumaczy `tr`): wysyłanie albo powód odmowy; null, gdy nie ma czego mówić. */
  message: ReadonlySignal<string | null>;
  /**
   * Odpowiedź serwera na wpis: czy to pierwszy wpis tego nicka i jego miejsce na liście (bywa większe niż 100). `first: false` to „ten nick już
   * jest w Galerii” (stan zostaje `idle`, seed nie jest znaczony jako wysłany, nick w mecie się nie zmienia); `first: true` kończy się `sent`.
   */
  placed: ReadonlySignal<{ first: boolean; place: number } | null>;
  list: ReadonlySignal<FameListView>;
  /** Czy zakładka „Galeria sław” jest wybrana w panelu rankingu. */
  shown: ReadonlySignal<boolean>;
  /** Odświeża okno przy każdym otwarciu (`bindFinishOpen`): nick z mety, czysty stan. W trakcie wysyłania niczego nie rusza. */
  open(): void;
  setNick(text: string): void;
  /** Czy wpis da się wysłać serwerowi (seed do pokazania, liczby skończone): bez tego okno daje same gratulacje. */
  sendable(offer: FameOffer): boolean;
  /** Czy zakładka Galerii ma pokazać „Wyślij mój wpis”: firma ma milion (`fame`), seed nie jest w `meta.fameSent`, a wpis da się wysłać. */
  pending(seed: string, fame: { day: number; cash: number } | null): boolean;
  submit(offer: FameOffer): Promise<void>;
  load(): Promise<void>;
  /** Wybiera zakładkę Galerii i ładuje listę. */
  show(): Promise<void>;
  hide(): void;
}

export interface FameDeps {
  client: RankingClient;
  /** Meta powłoki (ten sam obiekt, który powłoka zapisuje przy zamknięciu karty): wpis dopisuje się do niej w miejscu. */
  meta: () => Meta;
  saveMeta: (m: Meta) => void;
}

const clamp = (v: number, [min, max]: readonly [number, number]): number => Math.min(max, Math.max(min, v));

/**
 * Wpis w granicach, które przyjmie serwer (`FAME_DAY`, `FAME_CASH`, `FAME_SIM`), albo null, gdy nie da się go wysłać wcale. Dzień i gotówkę
 * przycinamy (uczciwy gracz nie ma przez to odmowy `fame-invalid`; dzień zaokrąglony do całości), seeda nie ruszamy: gdyby serwer go nie
 * pokazał (pusty, niewidoczne znaki, za długi), wpis nie jedzie, a okno daje same gratulacje.
 */
export function fameEntryOf(offer: FameOffer): { seed: string; day: number; cash: number; simVersion: number } | null {
  const { seed, day, cash } = offer;
  if (typeof seed !== 'string' || !isShowableSeed(seed, RUN_MAX_SEED_CHARS)) return null;
  if (!Number.isFinite(day) || !Number.isFinite(cash)) return null;
  if (SIM_VERSION < FAME_SIM[0] || SIM_VERSION > FAME_SIM[1]) return null;
  return { seed, day: clamp(Math.round(day), FAME_DAY), cash: clamp(cash, FAME_CASH), simVersion: SIM_VERSION };
}

/** Odpowiedź `ok` jest przyjęciem wpisu, gdy ma `first`, skończone miejsce i nick (goły `{ ok: true }` nie dowodzi, że wpis jest w Galerii). */
function isPlaced(res: { ok: true } & Partial<FameSubmitted>): res is { ok: true } & FameSubmitted {
  return typeof res.first === 'boolean' && typeof res.place === 'number' && Number.isFinite(res.place) && res.place >= 1 && typeof res.entry?.nick === 'string';
}

/** Najdalszy czas, jaki rozumie `Date` (ms, w obie strony): `at` spoza tego zakresu to nie data (`format` i `toISOString` rzucają `RangeError`). */
const DATE_MAX_MS = 8.64e15;
/** Czy `at` to chwila, którą da się pokazać jako datę (liczba skończona w zakresie `Date`). */
export const isFameTime = (at: unknown): at is number => typeof at === 'number' && Math.abs(at) <= DATE_MAX_MS;

/** Wiersz listy z serwera bez zaufania: miejsce (liczba skończona), nick (tekst) i chwila wpisu, którą da się pokazać. Inny kształt wypada z listy. */
function isFameRow(r: unknown): r is FameRow {
  if (typeof r !== 'object' || r === null) return false;
  const { place, nick, at } = r as Record<string, unknown>;
  return typeof place === 'number' && Number.isFinite(place) && typeof nick === 'string' && isFameTime(at);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Data wpisu w języku gry: „2 listopada 2026” albo „2 November 2026”. Dzień według zegara gracza; chwila spoza zakresu `Date` daje pusty napis. */
export function fameDate(at: number): string {
  if (!isFameTime(at)) return '';
  const locale = numberLocale();
  let f = formatters.get(locale);
  if (!f) formatters.set(locale, f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }));
  return f.format(at);
}

export function createFameModel(deps: FameDeps): FameModel {
  const state = signal<FameState>('idle');
  const nick = signal('');
  const message = signal<string | null>(null);
  const placed = signal<{ first: boolean; place: number } | null>(null);
  const list = signal<FameListView>({ status: 'loading', rows: [], total: 0, message: null });
  const shown = signal(false);
  let generation = 0;

  const sendable = (offer: FameOffer): boolean => fameEntryOf(offer) !== null;
  const alreadySent = (seed: string): boolean => deps.meta().fameSent?.includes(seed) ?? false;

  function fail(text: string): void {
    state.value = 'error';
    message.value = text;
  }

  async function submit(offer: FameOffer): Promise<void> {
    if (state.value === 'sending' || state.value === 'sent') return;
    const entry = fameEntryOf(offer);
    if (!entry) return fail(NOT_SENDABLE_TEXT);
    const checked = normalizeNick(nick.value);
    if ('error' in checked) return fail(checked.error);
    const key = deps.meta().player?.key;
    if (!key) return fail(NO_KEY_TEXT);

    state.value = 'sending';
    message.value = SENDING_TEXT;
    placed.value = null;
    let result: ApiResult<FameSubmitted>;
    try {
      result = await deps.client.fameSubmit(key, { nick: checked.nick, ...entry });
    } catch {
      result = { ok: false, error: 'network', message: NETWORK_ERROR };   // klient sam łapie sieć; to pas bezpieczeństwa, żeby stan nie zawisł
    }
    if (result.ok && isPlaced(result)) {
      placed.value = { first: result.first, place: result.place };
      message.value = null;
      if (!result.first) {
        // Ten nick już jest w Galerii, ale serwer nie rezerwuje nicków przez Galerię, więc to niekoniecznie wpis tego gracza: nie znaczymy
        // seeda jako wysłanego ani nie ruszamy nicka w mecie, a gracz może wpisać się pod innym nickiem (pole i przycisk zostają).
        state.value = 'idle';
        return;
      }
      const meta = deps.meta();
      markFameSent(meta, offer.seed);
      const { player } = meta;
      if (player && player.nick !== checked.nick) meta.player = { ...player, nick: checked.nick };   // nick, pod którym Galeria cię zna (klucz zostaje)
      deps.saveMeta(meta);
      state.value = 'sent';
      return;
    }
    if (!result.ok && result.error === 'nick-taken') return fail(NICK_TAKEN_TEXT);
    if (!result.ok && SERVER_MESSAGE_CODES.has(result.error)) return fail(result.message);
    fail(FAME_CLOSED_TEXT);   // brak sieci, odpowiedź spoza API, ranking wyłączony, baza niepodłączona, błąd serwera, nieznany kod: wpis poczeka
  }

  async function load(): Promise<void> {
    const gen = ++generation;
    list.value = { status: 'loading', rows: [], total: 0, message: null };
    let res: ApiResult<{ total: number; rows: FameRow[] }>;
    try {
      res = await deps.client.fameList();
    } catch {
      res = { ok: false, error: 'network', message: NETWORK_ERROR };
    }
    if (gen !== generation) return;
    if (!res.ok || !Array.isArray(res.rows)) {
      list.value = { status: 'error', rows: [], total: 0, message: FAME_LIST_CLOSED_TEXT };
      return;
    }
    const rows = res.rows.filter(isFameRow);   // wiersz o złym kształcie albo z datą spoza `Date` wypada, zamiast wywrócić render panelu
    list.value = { status: 'ready', rows, total: Number.isFinite(res.total) ? res.total : rows.length, message: null };
  }

  return {
    state, nick, message, placed, list, shown,
    open() {
      if (state.value === 'sending') return;
      state.value = 'idle';
      message.value = null;
      placed.value = null;
      nick.value = deps.meta().player?.nick ?? '';
    },
    setNick(text) {
      nick.value = text;
      // błąd albo „ten nick już jest w Galerii” z poprzedniej próby nie zostaje przy już poprawionym nicku
      if (state.value === 'error' || (state.value === 'idle' && placed.value !== null)) { state.value = 'idle'; message.value = null; placed.value = null; }
    },
    sendable,
    pending: (seed, fame) => fame !== null && !alreadySent(seed) && sendable({ seed, day: fame.day, cash: fame.cash }),
    submit,
    load,
    show() {
      shown.value = true;
      return load();
    },
    hide() {
      shown.value = false;
      generation++;   // spóźniona odpowiedź listy nie ma już gdzie wylądować
    },
  };
}

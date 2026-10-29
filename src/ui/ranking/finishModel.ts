import { computed, signal, type ReadonlySignal } from '@preact/signals';
import { normalizeNick } from '@/game/nick';
import type { FinishedRun, SentRun } from '@/game/rankedRun';
import { NETWORK_ERROR, type ApiResult, type RankingClient, type RunAccepted } from './client';

/**
 * Stan okna końca sezonu i ponownej wysyłki wyniku (bez DOM, do testów). Okno trzyma jeden niewysłany bieg (`finished`: szuflada
 * w przeglądarce albo pamięć karty) i wysyła go na żądanie gracza: nick sprawdza `normalizeNick`, klucz bierze z mety, a odpowiedź
 * serwera rozbija `classify` na pięć wyników. Bieg opuszcza przeglądarkę tylko po przyjęciu przez serwer (`clear`) albo na wyraźne
 * „Odrzuć bieg” (`discard`); zajęty nick, stara wersja gry, wyłączony ranking, brak sieci i odpowiedź spoza API niczego nie kasują.
 */

export const READY_TEXT = 'Sezon zamknięty. Centrala przeliczy Twój raport i wpisze go do rankingu.';
export const SENDING_TEXT = 'Wysyłamy raport do Centrali…';
export const ACCEPTED_TEXT = 'Raport przyjęty.';
export const NICK_TAKEN_TEXT = 'Ten nick jest zajęty. Wybierz inny — bieg zostaje u Ciebie.';
export const OLD_VERSION_TEXT = 'Ta wersja gry jest nieaktualna. Odśwież stronę. Bieg zostaje w przeglądarce jako niewysłany.';
export const LATER_TEXT = 'Spróbuj później. Bieg zostaje w przeglądarce, a wysłać go możesz z panelu rankingu i z ustawień.';
export const REJECTED_TEXT = 'Centrala odrzuciła ten bieg. Możesz go odrzucić albo spróbować jeszcze raz.';
export const BANKRUPT_TEXT = 'Sezon zakończony bankructwem nie trafia do rankingu.';
export const NO_KEY_TEXT = 'Brak klucza gracza. Odśwież stronę i spróbuj jeszcze raz.';
export const NOTHING_TO_SEND_TEXT = 'Nie ma biegu do wysłania.';

/** Wynik wysłania biegu: przyjęty (z miejscami) albo jedna z czterech odmów, każda z komunikatem dla gracza. */
export type SendOutcome =
  | { kind: 'accepted'; accepted: RunAccepted }
  | { kind: 'nick-taken'; message: string }
  | { kind: 'old-version'; message: string }
  | { kind: 'later'; message: string }
  | { kind: 'rejected'; message: string };

/** Kody, po których serwer nie przyjmie tego biegu ani przy drugiej próbie: zły formularz, dziennik, seed, tryb, nick albo klucz. */
const REJECTED_CODES: ReadonlySet<string> = new Set(['bad-request', 'bad-log', 'bad-seed', 'not-ranked', 'bad-nick', 'bad-key', 'too-large']);

/** Miejsce w rankingu to liczba skończona od 1; cokolwiek innego (brak pola, tekst, NaN) znaczy „nie ma go tam”. */
const placeOf = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * Czy odpowiedź `ok` jest naprawdę przyjęciem biegu: ma wynik i najlepszy wynik (liczby skończone) oraz nick, które policzył i zapisał serwer. Goły `{ ok: true }`
 * (strona pośrednia, proxy, serwer w pół drogi) nie dowodzi, że bieg jest w rankingu, a przyjęcie kasuje bieg z szuflady, więc taka
 * odpowiedź to „spróbuj później”: bieg zostaje.
 */
function isAcceptance(res: { ok: true } & Partial<RunAccepted>): res is { ok: true } & RunAccepted {
  return typeof res.score === 'number' && Number.isFinite(res.score) && typeof res.best === 'number' && Number.isFinite(res.best) && typeof res.nick === 'string';
}

function acceptedOf(res: { ok: true } & RunAccepted): RunAccepted {
  const ranks: Partial<Record<keyof RunAccepted['ranks'], unknown>> = res.ranks ?? {};
  return {
    nick: res.nick, score: res.score, best: res.best, improved: res.improved === true,
    ranks: { global: placeOf(ranks.global), seed: placeOf(ranks.seed), week: placeOf(ranks.week) },
  };
}

/**
 * Odpowiedź serwera → wynik wysłania. `ok` to przyjęcie, zajęty nick i stara wersja gry mają własne wyniki, a błędy po stronie
 * zgłoszenia (`REJECTED_CODES`) to odrzucenie; `season-bankrupt` (bieg zakończony bankructwem) to też odrzucenie, z własnym tekstem.
 * Wszystko inne (ranking wyłączony, baza niepodłączona, sędzia niegotowy albo nieudany, limit zapytań, błąd serwera, brak sieci,
 * odpowiedź spoza API i każdy nieznany kod) to „spróbuj później”: z tym samym biegiem za chwilę może pójść.
 */
export function classify(res: ApiResult<RunAccepted>): SendOutcome {
  if (res.ok) return isAcceptance(res) ? { kind: 'accepted', accepted: acceptedOf(res) } : { kind: 'later', message: LATER_TEXT };
  if (res.error === 'nick-taken') return { kind: 'nick-taken', message: NICK_TAKEN_TEXT };
  if (res.error === 'old-version') return { kind: 'old-version', message: OLD_VERSION_TEXT };
  if (res.error === 'season-bankrupt') return { kind: 'rejected', message: BANKRUPT_TEXT };
  if (REJECTED_CODES.has(res.error)) return { kind: 'rejected', message: REJECTED_TEXT };
  return { kind: 'later', message: LATER_TEXT };
}

export type FinishPhase = 'ready' | 'sending' | SendOutcome['kind'];

export interface FinishDeps {
  client: RankingClient;
  /** Niewysłany bieg: pamięć karty albo szuflada (`pendingFinished`). */
  finished: () => FinishedRun | null;
  /**
   * Opróżnia wszystko, co trzyma bieg po przyjęciu albo odrzuceniu: szufladę i pamięć karty, aktywny zapis biegu (gdyby zapis szuflady
   * się nie udał, wskrzesiłby bieg po przeładowaniu) i widok niewysłanego biegu w interfejsie (`dropUnsentRun` w actions.ts). Po
   * przyjęciu dostaje `sent`: bieg, który poszedł do serwera. Odpowiedź bywa spóźniona (gracz zamknął okno w trakcie wysyłania i zaczął
   * nowy bieg), więc `clear` ma ruszyć szufladę i aktywny zapis tylko wtedy, gdy nadal należą do tego biegu. Bez argumentu (ręczne
   * „Odrzuć bieg”) kasuje to, co jest.
   */
  clear: (sent?: SentRun) => void;
  /** Gracz z mety: klucz i nick (undefined przed ekranem startowym). */
  player: () => { key?: string; nick: string | null } | undefined;
  /** Zapamiętuje nick, pod którym bieg został przyjęty (gra zapisuje go w mecie). */
  rememberNick: (nick: string) => void;
}

export interface FinishModel {
  phase: ReadonlySignal<FinishPhase>;
  /** Nick w polu: na początku nick gracza z mety, potem to, co gracz wpisze. */
  nick: ReadonlySignal<string>;
  /** Komunikat dla gracza (region `aria-live`): tekst fazy albo błąd nicka; null, gdy nie ma biegu. */
  message: ReadonlySignal<string | null>;
  /** Wynik sezonu: z biegu, a po przyjęciu ten, który policzył serwer; null, gdy biegu nie ma. */
  score: ReadonlySignal<number | null>;
  seed: ReadonlySignal<string | null>;
  /** Odpowiedź serwera na przyjęty bieg (rekord, miejsca) albo null. */
  accepted: ReadonlySignal<RunAccepted | null>;
  places: ReadonlySignal<RunAccepted['ranks'] | null>;
  /** Czy okno pyta, czy na pewno odrzucić bieg („Odrzuć bieg” ma potwierdzenie w oknie, nie `window.confirm`). */
  confirming: ReadonlySignal<boolean>;
  /** Odświeża model z aktualnego biegu: wołać przy każdym otwarciu okna (`bindFinishOpen`). W trakcie wysyłania niczego nie rusza. */
  open(): void;
  setNick(text: string): void;
  send(): Promise<void>;
  askDiscard(): void;
  cancelDiscard(): void;
  /** Kasuje bieg (`clear`); wołać po potwierdzeniu w oknie. */
  discard(): void;
}

/** Komunikat fazy: to, co gracz widzi, gdy nie ma błędu nicka. Po wyniku serwera komunikat niesie sam wynik (`SendOutcome.message`). */
function phaseText(phase: FinishPhase, outcomeMessage: string | null): string {
  switch (phase) {
    case 'ready': return READY_TEXT;
    case 'sending': return SENDING_TEXT;
    case 'accepted': return ACCEPTED_TEXT;
    default: return outcomeMessage ?? READY_TEXT;
  }
}

export function createFinishModel(deps: FinishDeps): FinishModel {
  const phase = signal<FinishPhase>('ready');
  const nick = signal('');
  const message = signal<string | null>(null);
  const score = signal<number | null>(null);
  const seed = signal<string | null>(null);
  const accepted = signal<RunAccepted | null>(null);
  const confirming = signal(false);
  /** Komunikat ostatniej odmowy serwera (do przywrócenia po poprawieniu błędnego nicka). */
  let outcomeMessage: string | null = null;

  const places = computed(() => accepted.value?.ranks ?? null);

  const settle = (): void => { message.value = phaseText(phase.value, outcomeMessage); };

  function open(): void {
    if (phase.value === 'sending') return;
    const run = deps.finished();
    phase.value = 'ready';
    outcomeMessage = null;
    accepted.value = null;
    confirming.value = false;
    nick.value = deps.player()?.nick ?? '';
    score.value = run ? run.score : null;
    seed.value = run ? run.seed : null;
    message.value = run ? READY_TEXT : NOTHING_TO_SEND_TEXT;
  }

  function setNick(text: string): void {
    nick.value = text;
    if (phase.value !== 'sending' && score.value !== null) settle();   // błąd poprzedniej próby nie zostaje przy już poprawionym nicku; stan modelu, bo szuflada to do ~1 MB JSON-a na klawisz
  }

  async function send(): Promise<void> {
    if (phase.value === 'sending' || phase.value === 'accepted') return;
    const run = deps.finished();
    if (!run) {
      message.value = NOTHING_TO_SEND_TEXT;
      return;
    }
    const checked = normalizeNick(nick.value);
    if ('error' in checked) {
      message.value = checked.error;
      return;
    }
    const key = deps.player()?.key;
    if (!key) {
      message.value = NO_KEY_TEXT;
      return;
    }

    const sent: SentRun = { seed: run.seed, finishedAt: run.finishedAt };   // odpowiedź może przyjść, gdy szuflada ma już inny bieg
    phase.value = 'sending';
    settle();
    let result: ApiResult<RunAccepted>;
    try {
      result = await deps.client.submitRun(key, checked.nick, run.record);
    } catch {
      result = { ok: false, error: 'network', message: NETWORK_ERROR };   // klient sam łapie sieć; to pas bezpieczeństwa, żeby faza nie zawisła
    }
    const outcome = classify(result);
    if (outcome.kind === 'accepted') {
      deps.clear(sent);
      outcomeMessage = null;
      accepted.value = outcome.accepted;
      if (Number.isFinite(outcome.accepted.score)) score.value = outcome.accepted.score;
      phase.value = 'accepted';
      settle();
      if (checked.nick !== deps.player()?.nick) deps.rememberNick(checked.nick);
      return;
    }
    outcomeMessage = outcome.message;
    phase.value = outcome.kind;
    settle();
  }

  function discard(): void {
    confirming.value = false;
    deps.clear();
    score.value = null;
    seed.value = null;
    message.value = NOTHING_TO_SEND_TEXT;
  }

  return {
    phase, nick, message, score, seed, accepted, places, confirming, open, setNick, send, discard,
    askDiscard: () => { confirming.value = true; },
    cancelDiscard: () => { confirming.value = false; },
  };
}

/**
 * Odświeża model (`open`) za każdym razem, gdy okno się otwiera, czyli gdy sygnał przechodzi z pustego na pełny (także gdy jest pełny
 * już w chwili podpięcia). Zmiana otwartego okna na inną wartość i zamknięcie nie odświeżają. Zwraca funkcję odpinającą.
 */
export function bindFinishOpen(model: Pick<FinishModel, 'open'>, opened: ReadonlySignal<unknown>): () => void {
  let wasOpen = false;
  return opened.subscribe((value) => {
    const isOpen = !!value;
    if (isOpen && !wasOpen) model.open();
    wasOpen = isOpen;
  });
}

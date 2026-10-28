/**
 * Błędy API rankingu: kod (dla gry), status HTTP i komunikat dla gracza. Komunikaty po polsku, w tonie gry; „Ten nick jest
 * zajęty” to dosłownie spec §14.7. Zły nick dostaje komunikat z reguł nicka (`NICK_ERRORS`), a nie ten ogólny.
 */
export const API_ERRORS = {
  'bad-request': { status: 400, message: 'Centrala nie rozumie tego zgłoszenia. Prosimy wypełnić formularz jeszcze raz, czytelnie.' },
  'too-large': { status: 413, message: 'Zgłoszenie jest grubsze niż segregator z umową franczyzową.' },
  'bad-key': { status: 400, message: 'Klucz gracza jest nieczytelny. Sprawdź kod odzyskiwania.' },
  'bad-nick': { status: 400, message: 'Ten nick nie przejdzie.' },
  'nick-taken': { status: 409, message: 'Ten nick jest zajęty' },
  'bad-seed': { status: 400, message: 'Tego seeda nie da się pokazać w rankingu.' },
  'bad-log': { status: 400, message: 'Dziennik poleceń się nie zgadza. Centrala nie przyjmuje raportów pisanych ołówkiem.' },
  'not-ranked': { status: 400, message: 'Do rankingu liczy się tylko tryb rankingowy: wrzesień–listopad, bez premii z sieci sklepów.' },
  'old-version': { status: 409, message: 'Ta wersja gry jest nieaktualna. Odśwież stronę: Centrala wydała nowy regulamin.' },
  'replay-failed': { status: 422, message: 'Odtworzenie biegu się nie powiodło, więc wyniku nie ma. Centrala przeprasza (formalnie).' },
  'replay-unavailable': { status: 503, message: 'Sędzia Centrali jeszcze się szkoli. Wyniki rankingowe przyjmiemy wkrótce.' },
  'rate-limited': { status: 429, message: 'Za dużo zgłoszeń naraz. Centrala prosi o cierpliwość (i o kawę).' },
  'bad-save': { status: 400, message: 'To nie wygląda na zapis gry.' },
  'save-too-large': { status: 413, message: 'Zapis ma więcej niż 64 KB, a Centrala ma dla gracza tylko jedną szufladę.' },
  'no-save': { status: 404, message: 'Pod tym kodem nie ma zapisu w szufladzie Centrali.' },
  'bad-board': { status: 400, message: 'Nie ma takiego rankingu. Centrala prowadzi globalny, seeda i tygodnia.' },
  'method': { status: 405, message: 'Ta metoda tu nie działa.' },
  'not-configured': { status: 503, message: 'Ranking jeszcze nie działa: Centrala nie podłączyła bazy.' },
  'server': { status: 500, message: 'Coś poszło nie tak po stronie Centrali. Spróbuj za chwilę.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ApiErrorCode = keyof typeof API_ERRORS;

/** Błąd z kodem (i ewentualnie własnym komunikatem, np. z reguł nicka). */
export interface ApiFailure { ok: false; error: ApiErrorCode; message?: string }
export type Checked<T> = { ok: true; value: T } | ApiFailure;

export const fail = (error: ApiErrorCode, message?: string): ApiFailure => (message === undefined ? { ok: false, error } : { ok: false, error, message });

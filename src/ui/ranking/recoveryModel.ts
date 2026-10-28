import { signal, type ReadonlySignal } from '@preact/signals';
import { RECOVERY_ERRORS, formatRecoveryCode, parseRecoveryCode } from '@/game/playerKey';
import type { RankingClient } from './client';

/**
 * Stan panelu „Kod odzyskiwania” (bez DOM, do testów). Pokazuje kod tego urządzenia, przyjmuje kod z innego urządzenia (po
 * potwierdzeniu, bo zastępuje tutejszy klucz) i przenosi zapis gry tym kodem, zawsze na wyraźne polecenie: „Wyślij zapis” kładzie
 * kopię na serwerze, „Pobierz zapis” pyta, zanim zastąpi zapis na tym urządzeniu (spec §14.7: zapis nigdy nie ginie po cichu).
 * Zapis mety i zapisu sklepu robi gra (`adoptKey`, `importSave`), panel tylko o nie prosi.
 */
export const NO_KEY = 'Kod pojawi się, gdy otworzysz pierwszy sklep.';
export const SAME_CODE = 'To już jest kod tego urządzenia. Centrala docenia zaangażowanie.';
export const NOTHING_TO_SEND = 'Nie ma jeszcze czego wysłać: otwórz sklep i zagraj choć chwilę.';
export const COPIED = 'Kod skopiowany. Schowaj go lepiej niż klucz do zaplecza.';
export const COPY_FAILED = 'Nie udało się skopiować. Przepisz kod ręcznie, Centrala też tak robi.';
export const ADOPTED = 'Kod przyjęty: to urządzenie gra teraz Twoim kluczem.';
export const DOWNLOADED = 'Zapis pobrany i wczytany.';

export type Pending = { kind: 'adopt'; key: string } | { kind: 'download'; save: string; savedAt: number };

export interface RecoveryDeps {
  client: RankingClient;
  /** Klucz gracza z mety (null, gdy gracza jeszcze nie ma). */
  key: () => string | null;
  /** Zapisuje nowy klucz w mecie (`adoptRecoveryCode`); null to sukces, tekst to komunikat dla gracza. */
  adoptKey: (key: string) => string | null;
  /** Gracz wybrał nick z kodu (gra ustawia go jako nick gracza). */
  useNick?: (nick: string) => void;
  /** Zapis do wysłania (tekst JSON) albo null, gdy nie ma czego wysłać. */
  exportSave: () => string | null;
  /** Wczytuje pobrany zapis na tym urządzeniu; null to sukces, tekst to komunikat. */
  importSave: (save: string) => string | null;
  /** Schowek; domyślnie `navigator.clipboard`. */
  copy?: (text: string) => Promise<void>;
}

export interface RecoveryModel {
  revealed: ReadonlySignal<boolean>;
  input: ReadonlySignal<string>;
  busy: ReadonlySignal<boolean>;
  error: ReadonlySignal<string | null>;
  notice: ReadonlySignal<string | null>;
  confirm: ReadonlySignal<Pending | null>;
  /** Nicki kodu wpisanego na tym urządzeniu (null, dopóki żaden nie przyszedł). */
  nicks: ReadonlySignal<string[] | null>;
  /** Kod tego urządzenia w postaci do zapisania albo null. */
  code(): string | null;
  toggleReveal(): void;
  copyCode(): Promise<void>;
  setInput(text: string): void;
  submitCode(): Promise<void>;
  confirmPending(): Promise<void>;
  cancelPending(): void;
  upload(): Promise<void>;
  download(): Promise<void>;
  chooseNick(nick: string): void;
}

const clipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

export function createRecoveryModel(deps: RecoveryDeps): RecoveryModel {
  const revealed = signal(false);
  const input = signal('');
  const busy = signal(false);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const confirm = signal<Pending | null>(null);
  const nicks = signal<string[] | null>(null);

  const say = (text: string | null, isError = false): void => {
    error.value = isError ? text : null;
    notice.value = isError ? null : text;
  };
  /** Zapytanie do serwera z wyłączonymi przyciskami na ten czas. */
  async function busyWhile<T>(job: () => Promise<T>): Promise<T> {
    busy.value = true;
    try {
      return await job();
    } finally {
      busy.value = false;
    }
  }

  return {
    revealed, input, busy, error, notice, confirm, nicks,
    code: () => {
      const key = deps.key();
      return key ? formatRecoveryCode(key) : null;
    },
    toggleReveal() {
      revealed.value = !revealed.value;
    },
    async copyCode() {
      const key = deps.key();
      if (!key) return say(NO_KEY, true);
      try {
        await (deps.copy ?? clipboard)(formatRecoveryCode(key));
        say(COPIED);
      } catch {
        say(COPY_FAILED, true);
      }
    },
    setInput(text) {
      input.value = text;
    },
    async submitCode() {
      const key = parseRecoveryCode(input.value);
      if (key === null) return say(RECOVERY_ERRORS.invalid, true);
      if (key === deps.key()) {
        confirm.value = null;
        return say(SAME_CODE);
      }
      say(null);
      confirm.value = { kind: 'adopt', key };
    },
    async confirmPending() {
      const pending = confirm.value;
      confirm.value = null;
      if (pending === null) return;
      if (pending.kind === 'download') {
        const err = deps.importSave(pending.save);
        return say(err ?? DOWNLOADED, err !== null);
      }
      const err = deps.adoptKey(pending.key);
      if (err !== null) return say(err, true);
      input.value = '';
      say(ADOPTED);
      const res = await busyWhile(() => deps.client.player(pending.key));
      nicks.value = res.ok ? res.nicks : null;
    },
    cancelPending() {
      confirm.value = null;
    },
    async upload() {
      const key = deps.key();
      if (!key) return say(NO_KEY, true);
      const save = deps.exportSave();
      if (save === null) return say(NOTHING_TO_SEND, true);
      const res = await busyWhile(() => deps.client.uploadSave(key, save));
      if (!res.ok) return say(res.message, true);
      say(`Zapis wysłany (${Math.max(1, Math.round(res.bytes / 1024))} KB) i leży w szufladzie Centrali. Na drugim urządzeniu wpisz kod i wybierz „Pobierz zapis”.`);
    },
    async download() {
      const key = deps.key();
      if (!key) return say(NO_KEY, true);
      const res = await busyWhile(() => deps.client.downloadSave(key));
      if (!res.ok) return say(res.message, true);
      say(null);
      confirm.value = { kind: 'download', save: res.save, savedAt: res.savedAt };
    },
    chooseNick(nick) {
      deps.useNick?.(nick);
      say(`Grasz jako ${nick}.`);
    },
  };
}

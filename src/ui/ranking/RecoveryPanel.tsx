import { render } from 'preact';
import { NO_KEY, NOTHING_TO_SEND, SAME_CODE, type Pending, type RecoveryModel } from './recoveryModel';
import './ranking.css';

export { NO_KEY, NOTHING_TO_SEND, SAME_CODE };

/**
 * Panel „Kod odzyskiwania” (spec §14.7): kod tego urządzenia (zakryty, dopóki gracz go nie odsłoni), wpisanie kodu z innego
 * urządzenia i przeniesienie zapisu. Komponent bez hooków, stan w `createRecoveryModel`. Do ⚙ wpina go kolejny krok przez
 * `mountRecoveryPanel`.
 */
export const MASKED_CODE = '••••-••••-••••-••••-••••';
export const RECOVERY_INTRO = 'To Twój klucz do rankingu. Wpisany na innym urządzeniu przenosi nick i zapis gry. Zapisz go i nikomu nie pokazuj: kto ma kod, ten ma Twój nick.';

/** Podpis przycisku potwierdzającego dla każdego pytania. */
const CONFIRM_LABEL: Record<Pending['kind'], string> = { adopt: 'Zastąp klucz', download: 'Zastąp zapis', overwrite: 'Zastąp' };

const dateText = (ms: number): string => new Date(ms).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });

function confirmText(pending: Pending, currentCode: string | null): string {
  if (pending.kind === 'overwrite') {
    return `Na serwerze leży kopia z ${dateText(pending.savedAt)}, której to urządzenie jeszcze nie widziało. Zastąpić ją tym zapisem?`;
  }
  if (pending.kind === 'download') {
    return `Pobrać zapis wysłany ${dateText(pending.savedAt)}? Zastąpi na tym urządzeniu ten sklep, sieć sklepów, Punkty Partnera i kasjera. Inne sklepy zostaną.`;
  }
  return currentCode
    ? `Ten kod zastąpi klucz tego urządzenia. Obecny kod (${currentCode}) przestanie tu działać, więc zapisz go, jeśli ma do czegoś wrócić.`
    : 'Ten kod stanie się kluczem tego urządzenia.';
}

export interface RecoveryPanelProps {
  model: RecoveryModel;
  onClose: () => void;
}

export function RecoveryPanel({ model, onClose }: RecoveryPanelProps) {
  const code = model.code();
  const busy = model.busy.value;
  const pending = model.confirm.value;
  const run = (job: () => Promise<void>) => () => job();
  return (
    <div class="tt-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="tt-modal tt-recovery" role="dialog" aria-label="Kod odzyskiwania">
        <button type="button" class="tt-iconbtn tt-card-close" aria-label="Zamknij" onClick={onClose}>✕</button>
        <h2>Kod odzyskiwania</h2>

        <section class="tt-section">
          <p class="tt-hint">{RECOVERY_INTRO}</p>
          {code === null
            ? <p class="tt-muted">{NO_KEY}</p>
            : (
              <div class="tt-recovery-code">
                <code aria-label="Kod odzyskiwania">{model.revealed.value ? code : MASKED_CODE}</code>
                <button type="button" class="tt-btn" onClick={() => model.toggleReveal()}>{model.revealed.value ? 'Ukryj kod' : 'Pokaż kod'}</button>
                <button type="button" class="tt-btn" onClick={run(() => model.copyCode())}>Kopiuj</button>
              </div>
            )}
        </section>

        <section class="tt-section">
          <h3>Kod z innego urządzenia</h3>
          <form class="tt-recovery-form" onSubmit={(e) => { e.preventDefault(); void model.submitCode(); }}>
            <input class="tt-input" type="text" value={model.input.value} aria-label="Kod z innego urządzenia" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              maxLength={40} spellcheck={false} autocomplete="off" autocapitalize="characters"
              onInput={(e) => model.setInput((e.currentTarget as HTMLInputElement).value)} />
            <button type="button" class="tt-btn tt-primary" disabled={busy} onClick={run(() => model.submitCode())}>Użyj kodu</button>
          </form>
          {model.nicks.value !== null && (
            model.nicks.value.length === 0
              ? <p class="tt-muted">Ten kod nie ma jeszcze nicka w rankingu.</p>
              : (
                <div class="tt-recovery-actions">
                  {model.nicks.value.map((n) => (
                    <button key={n} type="button" class="tt-btn" onClick={() => model.chooseNick(n)}>{`Graj jako ${n}`}</button>
                  ))}
                </div>
              )
          )}
        </section>

        <section class="tt-section">
          <h3>Zapis gry</h3>
          <p class="tt-hint">Jedna kopia na kod, do 64 KB. Nowe wysłanie zastępuje poprzednie.</p>
          <div class="tt-recovery-actions">
            <button type="button" class="tt-btn" disabled={busy || code === null} onClick={run(() => model.upload())}>Wyślij zapis</button>
            <button type="button" class="tt-btn" disabled={busy || code === null} onClick={run(() => model.download())}>Pobierz zapis</button>
          </div>
        </section>

        {pending !== null && (
          <div class="tt-recovery-confirm" role="alertdialog" aria-label="Potwierdzenie">
            <p>{confirmText(pending, code)}</p>
            <div class="tt-recovery-actions">
              <button type="button" class="tt-btn tt-primary" onClick={run(() => model.confirmPending())}>
                {CONFIRM_LABEL[pending.kind]}
              </button>
              <button type="button" class="tt-btn" onClick={() => model.cancelPending()}>Anuluj</button>
            </div>
          </div>
        )}
        {model.error.value !== null && <p class="tt-hint warn" role="alert">{model.error.value}</p>}
        {model.notice.value !== null && <p class="tt-hint" role="status">{model.notice.value}</p>}
      </div>
    </div>
  );
}

/** Wstawia panel do `el`; zwraca funkcję, która go zdejmuje. */
export function mountRecoveryPanel(el: Element, props: RecoveryPanelProps): () => void {
  render(<RecoveryPanel {...props} />, el);
  return () => render(null, el);
}

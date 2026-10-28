import { NOTICE_EVENT } from '@/render/renderer';
import { notice } from './state';

/**
 * Podpina `traszka:notice` pod sygnał `notice`. Wołane przed `createRenderContext`: renderer wysyła komunikat zaraz po
 * swoim starcie (setTimeout 0), a gdyby nasłuch powstawał dopiero w `useEffect`, komunikat mógłby minąć.
 */
export function listenForNotices(): void {
  window.addEventListener(NOTICE_EVENT, (event) => {
    notice.value = (event as CustomEvent<{ text: string }>).detail.text;
  });
}

/**
 * Wysyła komunikat dla gracza tym samym kanałem co renderer. Idzie po zakończeniu bieżącego zadania, czyli po komunikatach
 * renderera z tego samego startu: ten o zapisie, który może kosztować gracza postęp, zostaje na wierzchu.
 */
export function postNotice(text: string): void {
  setTimeout(() => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { text } })), 0);
}

/** Pasek u góry z komunikatem (np. tryb oszczędny albo brak WebGL 2). Zostaje, dopóki gracz go nie zamknie. */
export function Notice() {
  const text = notice.value;
  if (text === null) return null;
  return (
    <div class="tt-notice" role="status">
      <span class="tt-notice-text">{text}</span>
      <button type="button" class="tt-notice-close" aria-label="Zamknij komunikat" onClick={() => { notice.value = null; }}>×</button>
    </div>
  );
}

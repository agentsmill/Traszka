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

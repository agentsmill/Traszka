import { LANGS, lang, setLang, t, type Lang } from '@/i18n';

/** Nazwa języka w nim samym: gracz, który nie zna drugiego języka, i tak znajdzie swój. */
const LANG_NAME: Record<Lang, string> = { pl: 'Polski', en: 'English' };
const LANG_SHORT: Record<Lang, string> = { pl: 'PL', en: 'EN' };

/**
 * Przełącznik języka: ekran startowy (`compact`, skróty PL/EN w nagłówku) i ⚙ (pełne nazwy). Ekran startowy przełącza od razu (sceny
 * jeszcze nie ma albo zaraz powstanie nowa); w ⚙ `onPick` przeładowuje stronę, bo napisy w scenie 3D (szyldy, plakaty) to tekstury,
 * które powstają przy budowie sklepu. Język nie trafia do zapisu gry ani do dziennika biegu rankingowego.
 */
export function LanguageSwitch({ compact = false, onPick = setLang }: { compact?: boolean; onPick?: (next: Lang) => void }) {
  const current = lang.value;
  return (
    <div class={`tt-seg tt-lang${compact ? ' compact' : ' wide'}`} role="group" aria-label={t`Język`}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} class={`tt-btn${l === current ? ' on' : ''}`} aria-pressed={l === current}
          aria-label={LANG_NAME[l]} title={LANG_NAME[l]} onClick={() => { if (l !== lang.value) onPick(l); }}>
          {compact ? LANG_SHORT[l] : LANG_NAME[l]}
        </button>
      ))}
    </div>
  );
}

/**
 * Zmiana języka w trakcie gry: wybór i przeładowanie strony (gra zapisuje się sama przy zamykaniu strony, `pagehide`). Z adresu
 * znika `new=1`, żeby przeładowanie nie zaczęło gry od nowa.
 */
export function setLangAndReload(next: Lang): void {
  setLang(next);
  const url = new URL(location.href);
  if (url.searchParams.has('new')) {
    url.searchParams.delete('new');
    location.replace(url.toString());
  } else {
    location.reload();
  }
}

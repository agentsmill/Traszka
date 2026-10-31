import { CORE_PLURALS, CORE_UI } from './ui/core';
import { GAME_PLURALS, GAME_UI } from './ui/game';
import { HUD_PLURALS, HUD_UI } from './ui/hud';
import { MONTH_PLURALS, MONTH_UI } from './ui/month';
import { RANKING_PLURALS, RANKING_UI } from './ui/ranking';
import { START_PLURALS, START_UI } from './ui/start';
import { TUTORIAL_PLURALS, TUTORIAL_UI } from './ui/tutorial';

/*
 * Słownik tekstów interfejsu po angielsku. Kluczem jest polski tekst z kodu (jak `msgid` w gettext): szablon `t\`…\`` ma klucz
 * z `{0}`, `{1}`… w miejscu wartości, a stała przekazywana do `tr(…)` to po prostu polski napis. Wpis to napis z tymi samymi
 * `{n}` albo funkcja wartości (inny szyk, odmiana). Słownik jest podzielony według obszaru gry (`en/ui/*.ts`), żeby zmiana jednego
 * ekranu dotykała jednego pliku; kompletność (każdy klucz z kodu ma wpis, żaden wpis nie wisi bez klucza) sprawdza
 * `tests/i18n.test.ts`.
 */

/** Wartości szablonu mogą być czymkolwiek, co da się wstawić w tekst (liczby, napisy). */
export type Entry = string | ((...values: any[]) => string);
export type Dict = Record<string, Entry>;

/** Odmiana po angielsku do `plural` (ui/game/format.ts): klucz to trzy polskie formy „one|few|many”, wartość [liczba pojedyncza, mnoga]. */
export type Plurals = Record<string, readonly [string, string]>;

export const EN_UI: Dict = { ...CORE_UI, ...HUD_UI, ...MONTH_UI, ...GAME_UI, ...START_UI, ...RANKING_UI, ...TUTORIAL_UI };

export const EN_PLURALS: Plurals = {
  ...CORE_PLURALS, ...HUD_PLURALS, ...MONTH_PLURALS, ...GAME_PLURALS, ...START_PLURALS, ...RANKING_PLURALS, ...TUTORIAL_PLURALS,
};

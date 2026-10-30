import { plNum, plValue, enPlural } from '../num';
import type { Rule } from '../dict';

/*
 * Zdania z wartościami, które składa warstwa gry (`src/game`: komunikaty, okna „OK”, baner poziomu) i modele rankingu
 * (`src/ui/ranking`). Te pliki zostają bez zmian (mniej konfliktów z równoległą pracą), a tekst tłumaczy się przy wyświetlaniu
 * (`tr`). Stałe bez wartości są w `EN_UI` (en/ui.ts) pod polskim napisem. `pl` to szablon jak w źródle; test zgodności kluczy
 * sprawdza, że każda reguła odpowiada literałowi ze źródła.
 */

export function gameRules(sub: (pl: string) => string): Rule[] {
  return [
    // actions.ts: poziom (baner i okno „OK”), sieć sklepów, starty
    { pl: 'POZIOM {}', en: (n) => `LEVEL ${n}` },
    { pl: 'Poziom {}', en: (n) => `Level ${n}` },
    { pl: 'Nagroda: +{} zł i +{} Ogonków.', en: (c, o) => `Reward: +${plNum(c!)} zł and +${plNum(o!)} Ogonki.` },
    { pl: '🔓 {}', en: (name) => `🔓 ${sub(name!)}` },
    {
      pl: 'Sieć: {} {} · {} Punktów Partnera',
      en: (n, _w, p) => `Network: ${plNum(n!)} ${enPlural(plValue(n!), 'shop', 'shops')} · ${plNum(p!)} Partner Points`,
    },
    { pl: 'Dochód z sieci: {} zł dziennie', en: (x) => `Network income: ${plNum(x!)} zł a day` },
    { pl: 'Nie udało się zacząć biegu rankingowego „{}”.', en: (seed) => `Couldn’t start the ranked run “${seed}”.` },
    { pl: 'Nie udało się otworzyć sklepu „{}”. Zostajesz w poprzednim.', en: (seed) => `Couldn’t open the shop “${seed}”. You’re staying in the previous one.` },
    // openStore.ts
    { pl: 'Nie udało się otworzyć sklepu „{}”. Zaczynamy w nowym.', en: (seed) => `Couldn’t open the shop “${seed}”. Starting a new one.` },
    // ui/ranking/recoveryModel.ts
    {
      pl: 'Zapis wysłany ({} KB) i leży w szufladzie Centrali. Na drugim urządzeniu wpisz kod i wybierz „Pobierz zapis”.',
      en: (kb) => `Save sent (${plNum(kb!)} KB); it’s waiting in Head Office’s drawer. On your other device, enter the code and choose “Download save”.`,
    },
    { pl: 'Grasz jako {}.', en: (nick) => `Playing as ${nick}.` },
  ];
}

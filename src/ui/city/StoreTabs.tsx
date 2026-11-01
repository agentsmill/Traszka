import { t } from '@/i18n';
import type { StoreTab, StoreTabDef } from './tabState';

/**
 * Przełącznik segmentowy zakładek sklepów („Sieć / #1 Ogrodowa / #2 Lipowa”); aktywna ma `aria-selected`. Ten sam mają okno końca miesiąca
 * (`NetworkReport.tsx`), protokół remanentu i podgląd końca miesiąca; wybór zakładki i jej domyślną wartość daje `tabState.ts`. Zwykła
 * funkcja, nie komponent: testy `vnodeTree` widzą wtedy jego przyciski w drzewie okna.
 */
export function StoreTabs({ tabs, active, onPick }: { tabs: StoreTabDef[]; active: StoreTab; onPick(id: StoreTab): void }) {
  return (
    <div class="tt-seg tt-storetabs" role="tablist" aria-label={t`Sklepy`}>
      {tabs.map((x) => (
        <button key={String(x.id)} type="button" role="tab" class={`tt-btn${x.id === active ? ' on' : ''}`} aria-selected={x.id === active} onClick={() => onPick(x.id)}>{x.label}</button>
      ))}
    </div>
  );
}

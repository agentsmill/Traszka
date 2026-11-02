import { t, tr } from '@/i18n';
import { activeStore, openStores } from '@/sim/firm/firm';
import { RESEARCH, RESEARCH_BY_ID, coordinationFee, netMods, researchCost, researchRefusal, type ResearchId } from '@/sim/firm/research';
import type { NetMods } from '@/sim/economy/site';
import type { FirmRefusal, FirmState } from '@/sim/firm/types';
import type { GameActions } from '../state';
import { percentOf, zl } from '../game/format';
import { SpendNote, spendRisk } from '../game/spend';
import { refusalText, researchCashText } from './firmText';

/*
 * Sekcja „Sieć: badania” w panelu Miasto (spec 4b §5.3, §5.9): sześć badań, które działają we wszystkich sklepach naraz, ale dopiero od dwóch
 * otwartych. Wiersz mówi, jaki poziom jest kupiony, ile kosztuje następny (z satyryczną opłatą koordynacyjną Centrali, która siedzi w cenie,
 * a nie na wyciągu), jaki efekt da przy obecnej liczbie sklepów i czemu przycisk jest wyłączony. Wygląd jak w „Ulepszeniach” (`tt-item`);
 * badania nie mają rat, więc przycisk jest jeden, za gotówkę, z tym samym ostrzeżeniem o debecie po zamknięciu miesiąca co inne zakupy za gotówkę
 * (`SpendNote` i `data-risk`, prognoza sieci). Komponent bez haków: dostaje `v` (wersję firmy) w propsach, jak reszta Miasta.
 */

/** Wiersz badania: poziom, cena następnego poziomu z opłatą koordynacyjną, efekt następnego poziomu przy obecnej liczbie sklepów i powód blokady. */
export interface ResearchRow {
  level: number;
  max: number;
  /** Cena następnego poziomu; null na poziomie maksymalnym. */
  price: number | null;
  /** Opłata koordynacyjna Centrali wliczona w cenę (`coordinationFee`); null na poziomie maksymalnym. */
  fee: number | null;
  /** Co da następny poziom przy obecnej liczbie otwartych sklepów, np. „płace −4,5%”; pusty na poziomie maksymalnym i przy mniej niż dwóch sklepach (badania nie działają). */
  effectNow: string;
  /** Dlaczego badania nie da się kupić teraz (`researchRefusal`); null, gdy się da. Na poziomie maksymalnym to `max`. */
  blocked: FirmRefusal | null;
}

/**
 * Zmiana mnożnika w procentach ze znakiem („+3,8%”, „−4,5%”); minus to U+2212 jak w kwotach. Różnica dwóch mnożników `1 ± x` niesie szum zmiennoprzecinkowy
 * (0,0375 wychodzi jako 0,03749999…), więc przed zaokrągleniem do 0,1 p.p. dostaje drobny dodatek: połówki zawsze w górę, jak na kalkulatorze.
 */
const signedPct = (delta: number): string => `${delta < 0 ? '−' : '+'}${percentOf(Math.abs(delta) + 1e-9)}`;

/** Zmiana pola `NetMods` słowami: „ruch +3,8%”, „płace −4,5%”. Nazwa pola to opis tego, co się zmienia w sklepie. */
function effectLabel(field: keyof NetMods, delta: number): string {
  const pct = signedPct(delta);
  switch (field) {
    case 'traffic': return t`ruch ${pct}`;
    case 'basket': return t`koszyk ${pct}`;
    case 'wages': return t`płace ${pct}`;
    case 'media': return t`media ${pct}`;
    case 'logistics': return t`opłata za palety ${pct}`;
    case 'backroom': return t`zaplecze ${pct}`;
  }
}

/** Mnożnik pola badania `id` w mnożnikach `mods` (null: nic nie działa, mnożnik 1). */
const fieldOf = (mods: NetMods | null, id: ResearchId): number => mods?.[RESEARCH_BY_ID[id].field] ?? 1;

/** Wiersz badania `id` firmy `f`. Efekt to różnica mnożnika po kupnie następnego poziomu wobec obecnego (`netMods`), więc przy limicie `cap` bywa mniejszy niż poprzedni. */
export function researchRow(f: FirmState, id: ResearchId): ResearchRow {
  const def = RESEARCH_BY_ID[id];
  const level = f.research[id] ?? 0;
  const maxed = level >= def.maxLevel;
  const price = maxed ? null : researchCost(def, level);
  let effectNow = '';
  if (!maxed) {
    const open = openStores(f).length;
    const after = netMods({ ...f.research, [id]: level + 1 }, open);
    if (after) effectNow = effectLabel(def.field, fieldOf(after, id) - fieldOf(netMods(f.research, open), id));
  }
  return { level, max: def.maxLevel, price, fee: price === null ? null : coordinationFee(price), effectNow, blocked: researchRefusal(f, id) };
}

/** Co badanie `id` daje teraz w sumie („płace −9%”); pusty, gdy badania nie działają (mniej niż dwa sklepy) albo poziom 0. */
export function researchTotal(f: FirmState, id: ResearchId): string {
  if (!((f.research[id] ?? 0) > 0)) return '';
  const mods = netMods(f.research, openStores(f).length);
  return mods ? effectLabel(RESEARCH_BY_ID[id].field, fieldOf(mods, id) - 1) : '';
}

/** Powód blokady przycisku słowami Centrali: „Działa od 2 sklepów” zamiast długiego zdania, gotówka z badaniem w treści, reszta jak odmowy firmy. */
export function blockedText(reason: FirmRefusal, f: FirmState): string {
  if (reason === 'siec') return t`Działa od 2 sklepów`;
  if (reason === 'gotowka') return researchCashText();
  return refusalText(reason, f);
}

/** Jedno badanie: nazwa, poziom, opis, żart, efekt, opłata koordynacyjna i przycisk z ceną (albo ✓ na poziomie maksymalnym). */
function researchItem(f: FirmState, id: ResearchId, game: GameActions) {
  const def = RESEARCH_BY_ID[id];
  const r = researchRow(f, id);
  const total = researchTotal(f, id);
  const maxed = r.price === null;
  const a = activeStore(f);   // gotówka sklepu to portfel (`syncWallet`), więc ocena wydatku (prognoza sieci) czyta ten sam stan co inne zakupy
  return (
    <div key={id} class={`tt-item${maxed ? ' done' : ''}`} data-research={id}>
      <div>
        <b>{tr(def.name)}</b> <span class="tt-muted">{`${r.level}/${r.max}`}</span>
        <div class="tt-muted">{tr(def.effect)}</div>
        <div class="tt-flavor">{tr(def.flavor)}</div>
        {total && <div class="tt-muted">{t`Teraz: ${total}`}</div>}
        {!maxed && r.effectNow && <div class="tt-muted">{t`Kolejny poziom: ${r.effectNow}`}</div>}
        {!maxed && r.fee !== null && <div class="tt-muted">{t`w tym opłata koordynacyjna Centrali: ${zl(r.fee)}`}</div>}
        {!maxed && r.blocked !== null && <div class="tt-muted warn">{blockedText(r.blocked, f)}</div>}
        {!maxed && r.blocked === null && <SpendNote s={a.econ} info={a.info} price={r.price!} />}
      </div>
      {maxed
        ? <span class="tt-check" role="img" aria-label={t`Najwyższy poziom`}>✓</span>
        : (
          <button type="button" class="tt-btn tt-buy" disabled={r.blocked !== null} data-risk={r.blocked === null ? spendRisk(a.econ, a.info, r.price!) : undefined}
            aria-label={t`Kup: ${tr(def.name)}, poziom ${r.level + 1}, ${zl(r.price!)}`} onClick={() => { game.firm({ type: 'research', id }); }}>{zl(r.price!)}</button>
        )}
    </div>
  );
}

/**
 * Sekcja badań Sieci. Rozwinięta od dwóch otwartych sklepów (wtedy badania działają), przy jednym zwinięta, ale z tymi samymi sześcioma
 * wierszami i napisem „Działa od 2 sklepów”: gracz widzi, po co mu druga placówka. Poziomy w nagłówku to suma kupionych z możliwych.
 */
export function ResearchSection({ f, game }: { f: FirmState; game: GameActions; v: number }) {
  const bought = RESEARCH.reduce((n, d) => n + (f.research[d.id] ?? 0), 0);
  const all = RESEARCH.reduce((n, d) => n + d.maxLevel, 0);
  return (
    <details class="tt-research" open={openStores(f).length >= 2}>
      <summary>
        <span class="tt-research-title">{t`Sieć: badania`}</span>
        <span class="tt-muted">{t`poziomy ${bought}/${all}`}</span>
      </summary>
      <p class="tt-hint">{t`Badania działają we wszystkich sklepach naraz, ale dopiero od dwóch otwartych. Płacisz gotówką z portfela, poziom zostaje na zawsze, a im więcej sklepów, tym mocniejszy efekt.`}</p>
      {RESEARCH.map((d) => researchItem(f, d.id, game))}
    </details>
  );
}

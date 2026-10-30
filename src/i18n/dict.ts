import { API_ERRORS, type ApiErrorCode } from '@/server/errors';
import { CATS, CAT_INFO } from '@/sim/economy/catalog';
import { LOC_LABEL } from '@/sim/economy/economy';
import { MILESTONES } from '@/sim/economy/milestones';
import { rankFor } from '@/sim/economy/progress';
import type { PalletLoc } from '@/sim/economy/storeInfo';
import { WEATHERS, WEATHER_LABEL } from '@/sim/economy/tycoon/cleanliness';
import { CIRCULARS, DECK } from '@/sim/economy/tycoon/deck';
import { KPI_FLAVOR, KPI_KINDS } from '@/sim/economy/tycoon/kpi';
import { COMMENTS, REPORT_LINES, REPORT_LINE_LABEL, type CommentPool } from '@/sim/economy/tycoon/report';
import { PROFILE_HINT, PROFILE_LABEL, STAFF_PROFILES, STAFF_TASKS, TASK_LABEL } from '@/sim/economy/tycoon/staff';
import { TRUST_REASONS, TRUST_REASON_LABEL, trustTier } from '@/sim/economy/tycoon/trust';
import { WUT_LABEL, WUT_REASONS } from '@/sim/economy/tycoon/wut';
import { EQUIPMENT, GROUP_LABEL, REMONTS, UPGRADES, type UpgradeGroup } from '@/sim/economy/upgrades';
import { EN_API_ERRORS, EN_KEY_ERRORS, EN_NICK_ERRORS } from './en/api';
import { EN_CARDS } from './en/cards';
import {
  EN_CATS, EN_COMMENTS, EN_EQUIPMENT, EN_GROUP_LABEL, EN_KPI_FLAVOR, EN_LOC_LABEL, EN_MILESTONES, EN_PROFILE_HINT, EN_PROFILE_LABEL, EN_RANKS,
  EN_REMONTS, EN_REPORT_LINES, EN_TASK_LABEL, EN_TRUST_REASONS, EN_TRUST_TIERS, EN_UPGRADES, EN_WEATHER, EN_WUT_LABEL,
} from './en/content';
import { gameRules } from './en/game';
import { EN_RENDER } from './en/render';
import { simRules } from './en/sim';
import { EN_UI } from './en/ui';
import { NICK_ERRORS } from '@/game/nick';
import { RECOVERY_ERRORS } from '@/game/playerKey';

/*
 * Słowniki angielskiej nakładki zebrane w jedno miejsce (budowane leniwie, przy pierwszym tekście po angielsku: gracz po polsku
 * nie płaci za nie nic). `exactEntries`: polski napis → angielski, z danych gry po identyfikatorach (karty, ulepszenia, cele…),
 * ze stałych interfejsu i warstwy gry (`EN_UI`), z napisów sceny 3D i z komunikatów API po kodzie błędu. `patternRules`: zdania
 * z liczbami i wstawkami (symulacja, warstwa gry). Ten sam polski napis z dwóch źródeł musi dawać ten sam angielski
 * (`dataConflicts` zbiera rozbieżności dla testu).
 */

export interface Rule {
  /** Polski szablon jak w źródle (`{}` w miejscu `${…}`). */
  pl: string;
  /** Angielski: napis (`{}` po kolei z przechwyconych kawałków) albo funkcja kawałków. Brak przy `fragment`. */
  en?: string | ((...parts: (string | undefined)[]) => string);
  /** Własne wyrażenie zamiast zbudowanego z `pl`. */
  re?: RegExp;
  /** Kawałek wstawiany w inne zdanie: tłumaczy go reguła tego zdania, sam nie ma wpisu. */
  fragment?: boolean;
}

const pairs: [string, string][] = [];
let exact: Map<string, string> | null = null;
let conflicts: string[] = [];

/** Pary polski → angielski z danych gry po identyfikatorach. */
export function dataPairs(): [string, string][] {
  if (pairs.length > 0) return pairs;
  const add = (pl: string | undefined, en: string | undefined): void => { if (pl && en) pairs.push([pl, en]); };
  for (const c of CATS) add(CAT_INFO[c].label, EN_CATS[c]);
  for (const g of Object.keys(GROUP_LABEL) as UpgradeGroup[]) add(GROUP_LABEL[g], EN_GROUP_LABEL[g]);
  for (const u of UPGRADES) {
    const en = EN_UPGRADES[u.id];
    u.names.forEach((name, i) => add(name, en?.names[i]));
    add(u.effect, en?.effect);
    add(u.flavor, en?.flavor);
  }
  for (const e of EQUIPMENT) { add(e.name, EN_EQUIPMENT[e.id]?.name); add(e.effect, EN_EQUIPMENT[e.id]?.effect); }
  for (const r of REMONTS) add(r.name, EN_REMONTS[r.level]);
  for (const m of MILESTONES) { add(m.label, EN_MILESTONES[m.id]?.label); add(m.hint, EN_MILESTONES[m.id]?.hint); }
  for (const v of [0, 20, 40, 60, 75, 90]) {
    const tier = trustTier(v);
    add(tier.label, EN_TRUST_TIERS[tier.id]?.label);
    add(tier.flavor, EN_TRUST_TIERS[tier.id]?.flavor);
  }
  for (const r of TRUST_REASONS) add(TRUST_REASON_LABEL[r], EN_TRUST_REASONS[r]);
  for (const k of REPORT_LINES) add(REPORT_LINE_LABEL[k], EN_REPORT_LINES[k]);
  for (const pool of Object.keys(COMMENTS) as CommentPool[]) COMMENTS[pool].forEach((c, i) => add(c, EN_COMMENTS[pool]?.[i]));
  for (const k of KPI_KINDS) add(KPI_FLAVOR[k], EN_KPI_FLAVOR[k]);
  for (const t of STAFF_TASKS) add(TASK_LABEL[t], EN_TASK_LABEL[t]);
  for (const p of [...STAFF_PROFILES, 'wlasny'] as const) add(PROFILE_LABEL[p], EN_PROFILE_LABEL[p]);
  for (const p of STAFF_PROFILES) add(PROFILE_HINT[p], EN_PROFILE_HINT[p]);
  for (const w of WEATHERS) add(WEATHER_LABEL[w], EN_WEATHER[w]);
  for (const r of WUT_REASONS) add(WUT_LABEL[r], EN_WUT_LABEL[r]);
  for (const l of Object.keys(LOC_LABEL) as PalletLoc[]) add(LOC_LABEL[l], EN_LOC_LABEL[l]);
  for (const from of Object.keys(EN_RANKS).map(Number)) add(rankFor(from), EN_RANKS[from]);
  for (const card of [...DECK, ...CIRCULARS]) {
    const en = EN_CARDS[card.id];
    add(card.title, en?.title);
    add(card.text, en?.text);
    card.answers.forEach((a, i) => {
      add(a.label, en?.answers[i]?.label);
      add(a.result, en?.answers[i]?.result);
      add(a.risk?.text, en?.answers[i]?.risk);
    });
  }
  for (const code of Object.keys(API_ERRORS) as ApiErrorCode[]) add(API_ERRORS[code].message, EN_API_ERRORS[code]);
  for (const k of Object.keys(NICK_ERRORS) as (keyof typeof NICK_ERRORS)[]) add(NICK_ERRORS[k], EN_NICK_ERRORS[k]);
  for (const k of Object.keys(RECOVERY_ERRORS) as (keyof typeof RECOVERY_ERRORS)[]) add(RECOVERY_ERRORS[k], EN_KEY_ERRORS[k]);
  return pairs;
}

/** Angielskie wpisy reguł bez wartości (napis albo funkcja bez argumentów) jako dokładne napisy. */
function plainRule(rule: Rule): string | null {
  if (rule.fragment || rule.re || rule.pl.includes('{}') || rule.en === undefined) return null;
  return typeof rule.en === 'function' ? rule.en() : rule.en;
}

const nested = (pl: string): string => exactEntries().get(pl) ?? pl;

export function exactEntries(): Map<string, string> {
  if (exact) return exact;
  const map = new Map<string, string>();
  conflicts = [];
  const put = (pl: string, en: string, from: string): void => {
    const had = map.get(pl);
    if (had !== undefined && had !== en) conflicts.push(`${from}: „${pl}” → „${had}” / „${en}”`);
    if (had === undefined) map.set(pl, en);
  };
  for (const [pl, en] of dataPairs()) put(pl, en, 'dane');
  for (const [pl, en] of Object.entries(EN_RENDER)) put(pl, en, 'scena');
  for (const [pl, entry] of Object.entries(EN_UI)) {
    if (/\{\d+\}/.test(pl)) continue;
    put(pl, typeof entry === 'function' ? entry() : entry, 'interfejs');
  }
  for (const rule of [...simRules(nested), ...gameRules(nested)]) {
    const en = plainRule(rule);
    if (en !== null) put(rule.pl, en, 'zdania');
  }
  exact = map;
  return map;
}

/** Rozbieżności (ten sam polski napis, różne angielskie) do testu. */
export function dataConflicts(): string[] {
  exactEntries();
  return conflicts;
}

/** Reguły ze wzorcem (zdania z wartościami); `sub` tłumaczy polskie wstawki. */
export function patternRules(sub: (pl: string) => string): Rule[] {
  return [...simRules(sub), ...gameRules(sub)].filter((r) => !r.fragment && r.en !== undefined && (r.re || r.pl.includes('{}')));
}

/** Wszystkie reguły z kawałkami (do testu zgodności kluczy). */
export function allRules(): Rule[] {
  return [...simRules((s) => s), ...gameRules((s) => s)];
}

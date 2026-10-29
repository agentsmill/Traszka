import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BANKRUPTCY_AT, CATS, CAT_INFO, DELIVERY_AT, FINE_BASE, FINE_PER_PALLET, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HOT, MEDIA_PER_DAY,
  MINUTES_PER_DAY, MINUTES_PER_SECOND_CLOSED, MINUTES_PER_SECOND_OPEN, OPEN_FROM, OPEN_TO, ORDER_DEADLINE, PALLETS_FREE, PALLET_FEE,
  RETURN_FEE, STAFF_MAX, STAFF_START, WAGE_PER_DAY,
} from '@/sim/economy/catalog';
import { nextRankAt, rankFor } from '@/sim/economy/progress';
import { CARDS } from '@/sim/economy/tycoon/cards';
import { FATIGUE } from '@/sim/economy/tycoon/fatigue';
import { KPI } from '@/sim/economy/tycoon/kpi';
import { DEFAULT_PROFILE, PROFILE_LABEL, STAFF_PROFILES } from '@/sim/economy/tycoon/staff';
import { SUNDAY_TRAFFIC } from '@/sim/economy/tycoon/sunday';
import { TRUST, turnoverBonusShare } from '@/sim/economy/tycoon/trust';
import { WUT } from '@/sim/economy/tycoon/wut';
import { plural } from '../game/format';
import { SPEEDS } from '../game/Hud';
import { dayLengthText, daySeconds, finalRank, hourOf, howToSections, marginRange, num, percent, trustBonusSteps } from './howToText';

/** Cały tekst okna: tytuły i akapity, jeden na wiersz. */
const text = (): string => howToSections().flatMap((s) => [s.title, ...s.paragraphs]).join('\n');
/** Słowa jak w szkicu instrukcji: tokeny z literą albo cyfrą, razem z nagłówkami. */
const words = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const pl = (n: number): string => n.toLocaleString('pl-PL');

/** Podmienia pola obiektu stałych na czas `fn` (obiekty `as const` są w czasie działania zwykłymi obiektami) i przywraca je zawsze. */
function patched(target: object, patch: Record<string, number>, fn: () => void): void {
  const obj = target as Record<string, number>;
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, obj[k]!]));
  Object.assign(obj, patch);
  try { fn(); } finally { Object.assign(obj, before); }
}

describe('funkcje pomocnicze treści', () => {
  it('percent: udział jako procent z jednym miejscem po przecinku tylko wtedy, gdy trzeba', () => {
    expect(percent(0.12)).toBe('12%');
    expect(percent(0.012)).toBe('1,2%');
    expect(percent(0.035)).toBe('3,5%');
    expect(percent(1 - 0.15 - 0.6)).toBe('25%');   // 0,25000000000000006 w liczbach zmiennoprzecinkowych
  });

  it('hourOf: godzina z minuty doby bez zera z przodu', () => {
    expect(hourOf(6 * 60)).toBe('6:00');
    expect(hourOf(23 * 60)).toBe('23:00');
    expect(hourOf(11 * 60 + 5)).toBe('11:05');
  });

  it('num: polski zapis liczb, do dwóch miejsc po przecinku', () => {
    expect(num(100)).toBe('100');
    expect(num(2.5)).toBe('2,5');
    expect(num(1.35)).toBe('1,35');
  });

  it('doba przy ×1 to godziny otwarcia przy jednym tempie i noc przy drugim, w tekście zaokrąglona do 10 s', () => {
    const open = OPEN_TO - OPEN_FROM;
    expect(daySeconds()).toBeCloseTo(open / MINUTES_PER_SECOND_OPEN + (MINUTES_PER_DAY - open) / MINUTES_PER_SECOND_CLOSED, 9);
    expect(dayLengthText()).toBe('3 min 20 s');   // 170 s dnia i 30 s nocy
  });

  it('finalRank: ostatnia ranga z listy i poziom, od którego obowiązuje', () => {
    const { name, level } = finalRank();
    expect(name).toBe(rankFor(level));
    expect(nextRankAt(level)).toBeNull();                 // dalej nie ma nazwanej rangi
    expect(nextRankAt(level - 1)).toBe(level);            // a poprzedni poziom prowadzi dokładnie do niej
    expect(level).toBe(50);
    expect(name).toBe('Legendarna Paleta');
  });

  it('trustBonusSteps: progi i wysokości premii wyczytane z turnoverBonusShare', () => {
    const steps = trustBonusSteps();
    expect(steps.length).toBeGreaterThan(0);
    for (const { from, share } of steps) {
      expect(turnoverBonusShare(from)).toBe(share);
      expect(turnoverBonusShare(from - 1)).toBeLessThan(share);   // próg jest pierwszym punktem z taką premią
    }
    expect(steps.map((x) => x.share)).toEqual([...steps.map((x) => x.share)].sort((a, b) => a - b));
  });

  it('marginRange: najmniejsza i największa marża z katalogu, z nazwą kategorii małymi literami', () => {
    const margins = CATS.map((c) => CAT_INFO[c].margin);
    const { low, high } = marginRange();
    expect(low.margin).toBe(Math.min(...margins));
    expect(high.margin).toBe(Math.max(...margins));
    expect(low.label).toBe('alkohol');
    expect(high.label).toBe('słodycze');
  });
});

describe('treść okna „Jak grać”', () => {
  it('sekcje w ustalonej kolejności', () => {
    expect(howToSections().map((s) => s.title)).toEqual([
      'Cel gry', 'Jak mija czas', 'Karty decyzji', 'Pieniądze', 'Palety', 'Ludzie', 'Twoje siły', 'Zaufanie Centrali', 'WUT (ubytki)',
      'KPI tygodnia', 'Czystość, pogoda, niedziela', 'Na start',
    ]);
    for (const s of howToSections()) expect(s.paragraphs.length, s.title).toBeGreaterThan(0);
  });

  it('liczba słów mieści się w 300–600 (cel: ok. 350–500)', () => {
    const n = words(text());
    expect(n).toBeGreaterThanOrEqual(300);
    expect(n).toBeLessThanOrEqual(600);
  });

  it('żadnych śladów po szablonie, wykrzykników ani sklejonych spacji; każdy akapit kończy się kropką', () => {
    for (const s of howToSections()) {
      for (const p of [s.title, ...s.paragraphs]) {
        expect(p, p).not.toMatch(/[{}$]|undefined|NaN|null|\[object|Infinity|!/);
        expect(p, p).not.toMatch(/ {2}|\s$|^\s/);
      }
      for (const p of s.paragraphs) expect(p, p).toMatch(/\.$/);
    }
  });

  it('każda liczba w treści to stała gry: cel, czas i pieniądze', () => {
    const t = text();
    expect(t).toContain(`rangi „${rankFor(50)}” (poziom 50)`);
    expect(t).toContain(`dwa raporty z rzędu zastaną Cię z gotówką poniżej −${pl(-BANKRUPTCY_AT)} zł`);
    expect(t).toContain(`od ${OPEN_FROM / 60}:00 do ${OPEN_TO / 60}:00`);
    expect(t).toContain(`${SPEEDS[1]!.label}–${SPEEDS[SPEEDS.length - 1]!.label}`);
    expect(t).toContain('doba trwa ok. 3 min 20 s');
    expect(t).toContain(`od ${Math.round(CAT_INFO.alkohol.margin * 100)}% (alkohol) do ${Math.round(CAT_INFO.slodycze.margin * 100)}% (słodycze)`);
    expect(t).toContain(`z półek, a hot-dogi i kawa dają więcej: ${Math.round(HOT.margin * 100)}%`);
    expect(HOT.margin).toBeGreaterThan(marginRange().high.margin);   // „dają więcej” jest prawdą
    // media zależą od wielkości sklepu (economy.ts: MEDIA_PER_DAY × powierzchnia sprzedaży), więc tekst obiecuje tylko dolną granicę
    expect(t).toContain(`Płacisz ${WAGE_PER_DAY} zł dziennie za osobę, a za media od ok. ${MEDIA_PER_DAY} zł dziennie (im większy sklep, tym więcej)`);
    expect(t).toContain(`opłatę franczyzową: ${FRANCHISE_FEE_FIXED} zł plus ${Math.round(FRANCHISE_FEE_SHARE * 100)}% obrotu`);
  });

  it('każda liczba w treści to stała gry: palety, ludzie, siły', () => {
    const t = text();
    expect(t).toContain(`Zamówienie na jutro zamyka się o ${ORDER_DEADLINE / 60}:00. Domyślnie zamawia Asystent Traszki`);
    expect(t).toContain(`Dostawa przyjeżdża następnego dnia, zwykle o ${DELIVERY_AT / 60}:00`);
    expect(t).toContain(`Palety ponad ${PALLETS_FREE} w zamówieniu kosztują po ${PALLET_FEE} zł`);
    expect(t).toContain(`liczy ${RETURN_FEE} zł`);
    expect(t).toContain(`mandatem Straży Miejskiej: ${FINE_BASE} zł plus ${FINE_PER_PALLET} zł za każdą kolejną`);
    expect(t).toContain(`Na start masz ${STAFF_START} ${plural(STAFF_START, 'osobę', 'osoby', 'osób')}, najwięcej zatrudnisz ${STAFF_MAX}`);
    expect(t).toContain(`Pula to ${FATIGUE.pool} sił na dobę`);
    expect(t).toContain(`stuknięcie w kasę kosztuje ${FATIGUE.tapCost.kasa}, w paletę ${pl(FATIGUE.tapCost.paleta)}, a noc oddaje ${FATIGUE.nightRecovery}`);
    for (const p of STAFF_PROFILES) expect(t).toContain(`„${PROFILE_LABEL[p]}”`);
    expect(DEFAULT_PROFILE).toBe('kolejka');   // wskazówka „Na start” mówi, że „Kolejka” jest domyślna
    expect(t).toContain(`Profil „${PROFILE_LABEL.kolejka}” (domyślny) stawia ludzi najpierw przy kasie`);
  });

  it('każda liczba w treści to stała gry: zaufanie, WUT, KPI, niedziela, karty', () => {
    const t = text();
    expect(t).toContain(`Zaufanie startuje od ${TRUST.start} punktów`);
    expect(t).toContain(`trafione KPI (+${KPI.trustHit}) i miesiąc na plusie (+${TRUST.monthProfit})`);
    expect(t).toContain(`mandat (−${-TRUST.fine}), miesiąc na minusie (−${-TRUST.monthLoss}) i odesłaną paletę (−${-TRUST.returnedPallet}) albo zabraną przez kierowcę (−${-TRUST.driverReturned})`);
    expect(t).toContain('Zmieniają je też karty decyzji i audyty Centrali.');
    expect([turnoverBonusShare(69), turnoverBonusShare(70), turnoverBonusShare(84), turnoverBonusShare(85)]).toEqual([0, 0.03, 0.03, 0.035]);
    expect(t).toContain('Od 70 punktów Centrala oddaje premię od obrotu: 3%, od 85 punktów 3,5%');
    expect(t).toContain(`Do ${pl(WUT.threshold * 100)}% obrotu miesiąca pokrywa je Centrala`);
    expect(t).toContain(`nietrafiony odbiera zaufanie (−${-KPI.trustMiss})`);
    expect(t).toContain(`ruch rośnie ×${pl(SUNDAY_TRAFFIC)}`);
    const two = 1 - CARDS.none - CARDS.one;
    expect(t).toContain(`${Math.round(CARDS.none * 100)}% brak, ${Math.round(CARDS.one * 100)}% jedna, ${Math.round(two * 100)}% dwie`);
    expect(t).toContain(`Co ${CARDS.circularGapMin}–${CARDS.circularGapMin + CARDS.circularGapSpan - 1} dni jedną z kart jest okólnik Centrali`);
  });

  it('zmiana stałej zmienia tekst (liczby nie są wpisane w treść)', () => {
    const before = text();
    patched(FATIGUE, { pool: 150, nightRecovery: 45 }, () => {
      expect(text()).toContain('Pula to 150 sił na dobę');
      expect(text()).toContain('a noc oddaje 45');
    });
    patched(FATIGUE.tapCost, { kasa: 3 }, () => expect(text()).toContain('stuknięcie w kasę kosztuje 3,'));
    patched(TRUST, { start: 45, fine: -2, driverReturned: -7 }, () => {
      expect(text()).toContain('Zaufanie startuje od 45 punktów');
      expect(text()).toContain('mandat (−2)');
      expect(text()).toContain('zabraną przez kierowcę (−7)');
    });
    patched(HOT, { margin: 0.5 }, () => expect(text()).toContain('dają więcej: 50%'));
    patched(WUT, { threshold: 0.02 }, () => expect(text()).toContain('Do 2% obrotu miesiąca'));
    patched(KPI, { trustMiss: -5 }, () => expect(text()).toContain('odbiera zaufanie (−5)'));
    patched(CARDS, { none: 0.3, one: 0.5 }, () => expect(text()).toContain('30% brak, 50% jedna, 20% dwie'));
    expect(text()).toBe(before);   // po podmianach wszystko wróciło
  });
});

/**
 * Teksty ze źródła: zawartość literałów napisowych i szablonów (bez fragmentów `${...}`, które są kodem, i bez komentarzy).
 * Mały skaner znaków, bo regex nie radzi sobie z szablonami zagnieżdżonymi w `${...}`.
 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  type Frame = { kind: 'code' | 'tpl'; depth: number };
  const stack: Frame[] = [{ kind: 'code', depth: 0 }];
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const top = stack[stack.length - 1]!;
    if (top.kind === 'tpl') {
      if (c === '\\') cur += src[++i] ?? '';
      else if (c === '`') { out.push(cur); cur = ''; stack.pop(); }
      else if (c === '$' && src[i + 1] === '{') { out.push(cur); cur = ''; stack.push({ kind: 'code', depth: 0 }); i++; }
      else cur += c;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1;
    } else if (c === "'" || c === '"') {
      let s = '';
      for (i++; i < src.length && src[i] !== c; i++) s += src[i] === '\\' ? src[++i] ?? '' : src[i];
      out.push(s);
    } else if (c === '`') {
      stack.push({ kind: 'tpl', depth: 0 });
      cur = '';
    } else if (c === '{') top.depth++;
    else if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { stack.pop(); cur = ''; } else top.depth--;
    }
  }
  return out;
}

describe('treść nie ma liczb wpisanych na sztywno', () => {
  it('skaner literałów: napisy i szablony bez kodu z ${...} i bez komentarzy', () => {
    const src = "const a = `x ${f(`y 1`, 'z 2')} w 3`; // 4 `nie`\n/* 5 */ const b = \"q \\\" 6\";";
    expect(stringLiterals(src)).toEqual(['x ', 'y 1', 'z 2', ' w 3', 'q " 6']);
  });

  it('żaden literał napisowy w howToText.ts nie zawiera cyfry (liczby idą ze stałych, a nie z tekstu)', () => {
    // Stałe pierwotne (`WAGE_PER_DAY`, `FRANCHISE_FEE_*`…) to wiązania modułów, których test nie podmieni, więc "równa się stałej" przeszłoby
    // także dla liczby wpisanej w tekst. Ten skan to uzupełnia. Wyjątek: znak dopełnienia '0' w `padStart` przy godzinach, który nie jest liczbą z gry.
    const src = readFileSync(fileURLToPath(new URL('./howToText.ts', import.meta.url)), 'utf8');
    const literals = stringLiterals(src);
    expect(literals.length).toBeGreaterThan(50);   // skaner naprawdę coś znalazł
    const withDigits = literals.filter((s) => /\d/.test(s) && s !== '0');
    expect(withDigits).toEqual([]);
  });
});

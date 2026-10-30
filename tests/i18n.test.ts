import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LANG_KEY, detectLang, initLang, lang, setLang, t, tr } from '@/i18n';
import { storedLang } from '@/i18n/lang';
import { patternOf } from '@/i18n/messages';
import { allRules, dataConflicts, dataPairs } from '@/i18n/dict';
import { EN_API_ERRORS, EN_KEY_ERRORS, EN_NICK_ERRORS } from '@/i18n/en/api';
import { EN_CARDS } from '@/i18n/en/cards';
import {
  EN_CATS, EN_COMMENTS, EN_EQUIPMENT, EN_GROUP_LABEL, EN_HINTS, EN_KPI_FLAVOR, EN_KPI_TITLE, EN_LOC_LABEL, EN_MILESTONES, EN_MONTH_NAME,
  EN_PROFILE_HINT, EN_PROFILE_LABEL, EN_RANKS, EN_REMONTS, EN_REPORT_LINES, EN_TASK_LABEL, EN_TRUST_REASONS, EN_TRUST_TIERS, EN_UPGRADES,
  EN_WEATHER, EN_WEEKDAY_SHORT, EN_WUT_LABEL,
} from '@/i18n/en/content';
import { howToDetailsEn, howToPointsEn } from '@/i18n/en/howTo';
import { EN_RENDER } from '@/i18n/en/render';
import { EN_PLURALS, EN_UI } from '@/i18n/en/ui';
import { localizeEn } from '@/i18n/messages';
import { NICK_ERRORS } from '@/game/nick';
import { RECOVERY_ERRORS } from '@/game/playerKey';
import { API_ERRORS } from '@/server/errors';
import { MONTH_NAME, WEEKDAY_SHORT } from '@/sim/economy/calendar';
import { CATS } from '@/sim/economy/catalog';
import { LOC_LABEL } from '@/sim/economy/economy';
import { MILESTONES } from '@/sim/economy/milestones';
import { nextRankAt } from '@/sim/economy/progress';
import { WEATHERS } from '@/sim/economy/tycoon/cleanliness';
import { CIRCULARS, DECK } from '@/sim/economy/tycoon/deck';
import { economyEnv } from '@/sim/economy/tycoon/economyEnv';
import { BOTS, runBot } from '@/sim/economy/tycoon/bots';
import { KPI_KINDS } from '@/sim/economy/tycoon/kpi';
import { COMMENTS, HINT_IDS, REPORT_LINES } from '@/sim/economy/tycoon/report';
import { STAFF_PROFILES, STAFF_TASKS } from '@/sim/economy/tycoon/staff';
import { TRUST_REASONS, trustTier } from '@/sim/economy/tycoon/trust';
import { WUT_REASONS } from '@/sim/economy/tycoon/wut';
import { EQUIPMENT, GROUP_LABEL, REMONTS, UPGRADES } from '@/sim/economy/upgrades';
import { freshRun } from '@/sim/run';
import { deltaLines } from '@/ui/game/cardText';
import { forecastLabel } from '@/ui/game/forecastText';
import { plural, zl } from '@/ui/game/format';
import { ENERGY_TITLE } from '@/ui/game/tapBlock';
import { howToDetails, howToPoints } from '@/ui/howto/howToText';
import { MemoryStorage } from '@/game/memoryStorage';
import { PL_CHARS, jsxTextsWithLines, scanLiterals, type Literal } from './i18nScan';

/*
 * Zgodność angielskiej nakładki z polskim źródłem (src/i18n). Polski jest językiem źródłowym, więc testy idą od polskiego tekstu:
 * każdy tekst z identyfikatorem (karta, ulepszenie, cel…) ma angielski odpowiednik o tym samym kształcie, każdy klucz `t\`…\`` z kodu
 * ma wpis, każdy polski napis w kodzie gry i w symulacji jest przetłumaczony albo świadomie pominięty (lista `SKIP` z powodem),
 * a zdania, które symulacja naprawdę wysyła w trakcie gry, rozpoznaje tłumacz. Nowe polskie teksty bez tłumaczenia wychodzą tu jako
 * lista „czego brakuje”, z plikiem i linią.
 */

const ROOT = join(__dirname, '..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith('.d.ts') ? [p] : [];
});
const rel = (p: string): string => p.slice(ROOT.length + 1).split(sep).join('/');
const source = (dir: string): { file: string; src: string }[] => files(join(ROOT, dir)).map((p) => ({ file: rel(p), src: readFileSync(p, 'utf8') }));

/** Klucz szablonu `t\`…\`` z tekstu skanera (`{}` → `{0}`, `{1}`…, bez białych znaków na brzegach), jak `templateKey` w src/i18n/t.ts. */
const tKey = (text: string): string => { let i = 0; return text.replace(/\{\}/g, () => `{${i++}}`).trim(); };
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

afterEach(() => { lang.value = 'pl'; });

describe('dane gry po identyfikatorach: każdy polski tekst ma angielski odpowiednik', () => {
  it('karty decyzji i okólniki: ta sama talia, te same odpowiedzi, ryzyka i parametry', () => {
    const cards = [...DECK, ...CIRCULARS];
    expect(Object.keys(EN_CARDS).sort()).toEqual(cards.map((c) => c.id).sort());
    for (const c of cards) {
      const en = EN_CARDS[c.id]!;
      expect(en.answers.length, c.id).toBe(c.answers.length);
      expect(placeholders(en.text), `${c.id}: parametry treści`).toEqual(placeholders(c.text));
      c.answers.forEach((a, i) => {
        expect(!!en.answers[i]!.risk, `${c.id}[${i}]: ryzyko`).toBe(!!a.risk);
        expect(placeholders(en.answers[i]!.result), `${c.id}[${i}]: parametry wyniku`).toEqual(placeholders(a.result));
        expect(en.answers[i]!.label.length, `${c.id}[${i}]`).toBeGreaterThan(0);
      });
    }
  });

  it('ulepszenia (każdy poziom), sprzęt, grupy i remonty', () => {
    expect(Object.keys(EN_UPGRADES).sort()).toEqual(UPGRADES.map((u) => u.id).sort());
    for (const u of UPGRADES) {
      expect(EN_UPGRADES[u.id].names.length, u.id).toBe(u.names.length);
      expect(EN_UPGRADES[u.id].effect && EN_UPGRADES[u.id].flavor, u.id).toBeTruthy();
    }
    expect(Object.keys(EN_EQUIPMENT).sort()).toEqual(EQUIPMENT.map((e) => e.id).sort());
    expect(Object.keys(EN_GROUP_LABEL).sort()).toEqual(Object.keys(GROUP_LABEL).sort());
    expect(Object.keys(EN_REMONTS).map(Number).sort()).toEqual(REMONTS.map((r) => r.level).sort());
  });

  it('cele, kategorie, zaufanie, raport, KPI, ludzie, pogoda, ubytki, miejsca palet, rangi i kalendarz', () => {
    expect(Object.keys(EN_MILESTONES).sort()).toEqual(MILESTONES.map((m) => m.id).sort());
    expect(Object.keys(EN_CATS).sort()).toEqual([...CATS].sort());
    for (const v of [0, 20, 40, 60, 75, 90]) expect(EN_TRUST_TIERS[trustTier(v).id], `próg ${v}`).toBeDefined();
    expect(Object.keys(EN_TRUST_TIERS).length).toBe(6);
    expect(Object.keys(EN_TRUST_REASONS).sort()).toEqual([...TRUST_REASONS].sort());
    expect(Object.keys(EN_REPORT_LINES).sort()).toEqual([...REPORT_LINES].sort());
    for (const pool of Object.keys(COMMENTS) as (keyof typeof COMMENTS)[]) expect(EN_COMMENTS[pool].length, pool).toBe(COMMENTS[pool].length);
    expect(Object.keys(EN_HINTS).sort()).toEqual([...HINT_IDS].sort());
    expect(Object.keys(EN_KPI_TITLE).sort()).toEqual([...KPI_KINDS].sort());
    expect(Object.keys(EN_KPI_FLAVOR).sort()).toEqual([...KPI_KINDS].sort());
    expect(Object.keys(EN_TASK_LABEL).sort()).toEqual([...STAFF_TASKS].sort());
    expect(Object.keys(EN_PROFILE_LABEL).sort()).toEqual([...STAFF_PROFILES, 'wlasny'].sort());
    expect(Object.keys(EN_PROFILE_HINT).sort()).toEqual([...STAFF_PROFILES].sort());
    expect(Object.keys(EN_WEATHER).sort()).toEqual([...WEATHERS].sort());
    expect(Object.keys(EN_WUT_LABEL).sort()).toEqual([...WUT_REASONS].sort());
    expect(Object.keys(EN_LOC_LABEL).sort()).toEqual(Object.keys(LOC_LABEL).sort());
    const ranks: number[] = [1];
    for (let next = nextRankAt(1); next !== null; next = nextRankAt(next)) ranks.push(next);
    expect(Object.keys(EN_RANKS).map(Number)).toEqual(ranks);
    expect(EN_WEEKDAY_SHORT.length).toBe(WEEKDAY_SHORT.length);
    expect(EN_MONTH_NAME.length).toBe(MONTH_NAME.length);
  });

  it('komunikaty API po kodzie błędu, reguły nicka i kodu odzyskiwania', () => {
    expect(Object.keys(EN_API_ERRORS).sort()).toEqual(Object.keys(API_ERRORS).sort());
    expect(Object.keys(EN_NICK_ERRORS).sort()).toEqual(Object.keys(NICK_ERRORS).sort());
    expect(Object.keys(EN_KEY_ERRORS).sort()).toEqual(Object.keys(RECOVERY_ERRORS).sort());
    lang.value = 'en';
    expect(tr(API_ERRORS['nick-taken'].message)).toBe(EN_API_ERRORS['nick-taken']);
    expect(tr(NICK_ERRORS.length)).toBe(EN_NICK_ERRORS.length);
  });

  it('ten sam polski napis z kilku miejsc ma jedno tłumaczenie', () => {
    expect(dataConflicts()).toEqual([]);
  });
});

/** Polskie litery w angielskim tekście dopuszczamy tylko w nazwach własnych i w realiach (lista dla raportu w opisie PR). */
const PL_NAMES = /Kraftuś|dzień dobry|zł/g;
const englishTexts = (): { where: string; text: string }[] => {
  const out: { where: string; text: string }[] = [];
  for (const [k, v] of Object.entries(EN_UI)) if (typeof v === 'string') out.push({ where: `EN_UI[${k}]`, text: v });
  for (const [k, v] of Object.entries(EN_RENDER)) out.push({ where: `EN_RENDER[${k}]`, text: v });
  for (const [pl, en] of dataPairs()) out.push({ where: `dane[${pl}]`, text: en });
  return out;
};

describe('angielski tekst jest po angielsku', () => {
  it('żaden angielski wpis nie ma polskich liter (poza nazwami własnymi)', () => {
    const leaks = englishTexts().filter(({ text }) => PL_CHARS.test(text.replace(PL_NAMES, '')));
    expect(leaks).toEqual([]);
  });

  it('„Jak grać” po angielsku ma tyle punktów i sekcji co po polsku i nie ma polskich liter', () => {
    lang.value = 'en';
    expect(howToPointsEn().length).toBe(howToPoints().length);
    expect(howToDetailsEn().map((s) => s.paragraphs.length)).toEqual(howToDetails().map((s) => s.paragraphs.length));
    const all = [...howToPointsEn(), ...howToDetailsEn().flatMap((s) => [s.title, ...s.paragraphs])];
    expect(all.filter((x) => PL_CHARS.test(x.replace(PL_NAMES, '')))).toEqual([]);
  });

  it('skutki odpowiedzi, prognoza i odmiana idą po angielsku, a po polsku zostają bez zmian', () => {
    const answer = { delta: { trust: 2, wut: 120, staffMinutes: 30 }, mods: [{ kind: 'staff' as const, value: -1, minutes: 60, estimate: 0 }], risk: null };
    const pl = deltaLines(answer as never, String).map((l) => l.text);
    expect(pl).toEqual(['zaufanie +2', 'ubytki +120 zł', 'czas ludzi 30 min', '−1 osoba na zmianie']);
    lang.value = 'en';
    expect(deltaLines(answer as never, String).map((l) => l.text)).toEqual(['trust +2', 'shrinkage +120 zł', 'staff time 30 min', '−1 person on shift']);
    expect(forecastLabel({ saldo: 12_345, installments: 500, net: -1200 } as never)).toBe(
      'Head Office balance 12,345 zł, instalments this month 500 zł, you’ll keep −1,200 zł after the month closes');
    expect(plural(3, 'paleta', 'palety', 'palet')).toBe('pallets');
    lang.value = 'pl';
    expect(plural(3, 'paleta', 'palety', 'palet')).toBe('palety');
    expect(zl(12_345)).toBe('12 345 zł');
  });

  it('po polsku t i tr zwracają dokładnie polski tekst', () => {
    const n = 3;
    expect(t`Karta 1 z ${n}`).toBe(`Karta 1 z ${n}`);
    expect(t` Stukanie pomaga tylko, gdy przy kasie nikogo nie ma albo kolejka rośnie.`).toBe(' Stukanie pomaga tylko, gdy przy kasie nikogo nie ma albo kolejka rośnie.');
    expect(tr('Sklep zamknięty.')).toBe('Sklep zamknięty.');
    lang.value = 'en';
    expect(t`Karta 1 z ${n}`).toBe('Card 1 of 3');
    expect(t` Stukanie pomaga tylko, gdy przy kasie nikogo nie ma albo kolejka rośnie.`).toBe(' Tapping only helps when nobody is on the till or the queue is growing.');
  });
});

describe('wybór języka', () => {
  it('przeglądarka: pl* daje polski, każdy inny angielski, brak danych polski', () => {
    expect(detectLang(['pl-PL', 'en'])).toBe('pl');
    expect(detectLang(['pl'])).toBe('pl');
    expect(detectLang(['en-GB', 'pl'])).toBe('en');
    expect(detectLang(['de-DE'])).toBe('en');
    expect(detectLang([])).toBe('pl');
    expect(detectLang(undefined)).toBe('pl');
  });

  it('wybór gracza zostaje w localStorage pod osobnym kluczem, poza zapisem gry', () => {
    const storage = new MemoryStorage();
    const g = globalThis as { localStorage?: Storage };
    const before = g.localStorage;
    g.localStorage = storage as unknown as Storage;
    try {
      setLang('en');
      expect(storage.getItem(LANG_KEY)).toBe('en');
      expect(storedLang(storage)).toBe('en');
      lang.value = 'pl';
      expect(initLang()).toBe('en');
      storage.setItem(LANG_KEY, 'xx');
      expect(storedLang(storage)).toBeNull();
    } finally {
      g.localStorage = before;
    }
    expect(LANG_KEY.startsWith('traszka:save')).toBe(false);
    expect(['traszka:meta', 'traszka:last', 'traszka:ranked', 'traszka:mode', 'traszka:import', 'traszka:saveSync']).not.toContain(LANG_KEY);
  });
});

// --- Klucze w kodzie -----------------------------------------------------------------------------------------------

/** Katalogi z tekstem dla gracza (bez src/sim: ten ma osobny test niżej) i pliki narzędzi deweloperskich, które zostają po polsku. */
const UI_DIRS = ['src/ui', 'src/game', 'src/render', 'src/main.ts'];
const DEV_ONLY = new Set(['src/ui/BenchOverlay.tsx', 'src/render/characters/charTestPage.ts', 'src/ui/game/sourceLiterals.ts', 'src/ui/game/vnodeTree.ts']);
const uiSources = (): { file: string; src: string }[] => UI_DIRS.flatMap((d) => d.endsWith('.ts')
  ? [{ file: d, src: readFileSync(join(ROOT, d), 'utf8') }] : source(d)).filter((f) => !DEV_ONLY.has(f.file));

/** Wywołania, których napisy nie idą do gracza: logi, wyjątki, selektory i klucze. */
const DEV_CALLEES = new Set(['log', 'warn', 'error', 'info', 'debug', 'warnOnce', 'Error', 'RangeError', 'TypeError', 'PlacementError', 'querySelector',
  'getItem', 'setItem', 'removeItem', 'hashString', 'subSeed', 'createRng', 'cachedTexture', 'texturedMaterial', 'findClip', 'getObjectByName',
  'startsWith', 'bake', 'rig', 'buildWiper']);
/** Pola z nazwą obiektu sceny albo kluczem (nie tekst dla gracza). */
const DEV_PROPS = new Set(['name']);

interface Found { file: string; line: number; text: string }

function allLiterals(sources: { file: string; src: string }[]): (Literal & { file: string })[] {
  return sources.flatMap(({ file, src }) => scanLiterals(src).map((l) => ({ ...l, file })));
}

describe('klucze tekstów interfejsu (t`…`)', () => {
  const literals = allLiterals([...uiSources(), ...source('src/i18n')]);
  const tagged = literals.filter((l) => l.tagged);

  it('każdy szablon t`…` z kodu ma wpis w EN_UI, a wpis używa tylko swoich wartości', () => {
    expect(tagged.length).toBeGreaterThan(300);   // skan naprawdę widzi kod
    const missing = tagged.filter((l) => !(tKey(l.text) in EN_UI)).map((l) => `${l.file}:${l.line} ${tKey(l.text)}`);
    expect(missing).toEqual([]);
    const bad: string[] = [];
    for (const l of tagged) {
      const key = tKey(l.text);
      const entry = EN_UI[key];
      const n = (key.match(/\{\d+\}/g) ?? []).length;
      if (typeof entry === 'string') for (const m of entry.matchAll(/\{(\d+)\}/g)) if (Number(m[1]) >= n) bad.push(`${key} → ${entry}`);
    }
    expect(bad).toEqual([]);
  });

  it('żaden wpis EN_UI nie wisi: każdy klucz to szablon t`…` albo polski napis z kodu (stała pokazywana przez tr)', () => {
    const keys = new Set(tagged.map((l) => tKey(l.text)));
    const plain = new Set(literals.filter((l) => !l.tagged).map((l) => l.text));
    const computed = new Set([ENERGY_TITLE]);
    const orphans = Object.keys(EN_UI).filter((k) => !keys.has(k) && !plain.has(k) && !computed.has(k));
    expect(orphans).toEqual([]);
  });

  it('każda odmiana z EN_PLURALS ma swoje wywołanie plural(…) w kodzie', () => {
    const triples = new Set<string>();
    for (const { src } of uiSources()) for (const m of src.matchAll(/plural\([^,]+,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)) triples.add(`${m[1]}|${m[2]}|${m[3]}`);
    expect(Object.keys(EN_PLURALS).filter((k) => !triples.has(k))).toEqual([]);
  });
});

// --- Pokrycie polskich napisów -------------------------------------------------------------------------------------

/**
 * Napisy, które świadomie zostają bez angielskiej wersji (powód przy każdym). Klucz to dokładny polski literał. Nowy wpis tutaj
 * to decyzja, a nie sposób na uciszenie testu: opis PR wylicza je w „czego nie przetłumaczono”.
 */
const SKIP: Record<string, string> = {
  // logi warstwy gry: `fail` w openStore.ts to console.error, gracz dostaje osobny komunikat
  'Nie udało się zbudować sklepu „{}”.': 'console.error w openStore.ts', 'Nie udało się otworzyć sklepu „{}”.': 'console.error w openStore.ts',
  'Nie udało się odtworzyć układu sklepu „{}” z seeda.': 'console.error w openStore.ts',
  // gałąź tylko po polsku: po angielsku weekLeft zwraca własny tekst przed tym wywołaniem (ui/ranking/RankingPanel.tsx)
  'został': 'polska odmiana w weekLeft', 'zostały': 'polska odmiana w weekLeft', 'zostało': 'polska odmiana w weekLeft',
  // polskie formy liczebników w polskich funkcjach instrukcji (howToText.ts); angielska instrukcja ma własne (en/howTo.ts)
  'osobę': 'howToText.ts po polsku', 'godzinę': 'howToText.ts po polsku', 'godziny': 'howToText.ts po polsku', 'godzin': 'howToText.ts po polsku',
  'kasę': 'howToText.ts po polsku', 'półki': 'howToText.ts po polsku', 'sprzątanie': 'howToText.ts po polsku',
};
/** Pliki, których cała treść jest po polsku z założenia: polska instrukcja (angielska jest w en/howTo.ts) i sam słownik. */
const PL_ONLY_FILES = new Set(['src/ui/howto/howToText.ts']);

/** Klucze składane ze stałych gry (`ENERGY_TITLE` to dwa szablony połączone `+`): kawałek takiego klucza jest pokryty, gdy klucz ma wpis. */
const COMPUTED = [ENERGY_TITLE];
const insideComputed = (literal: string): boolean =>
  COMPUTED.some((k) => k in EN_UI && new RegExp(patternOf(literal).source.slice(1, -1), 's').test(k));

function coveredSet(): Set<string> {
  const covered = new Set<string>();
  for (const k of Object.keys(EN_UI)) covered.add(k);
  for (const k of Object.keys(EN_RENDER)) { covered.add(k); for (const line of k.split('|')) covered.add(line); }
  for (const [pl] of dataPairs()) covered.add(pl);
  for (const r of allRules()) covered.add(r.pl);
  for (const k of Object.keys(EN_PLURALS)) for (const form of k.split('|')) covered.add(form);
  for (const k of Object.keys(SKIP)) covered.add(k);
  // kalendarz: dateText i monthLabel tłumaczą dni i miesiące po indeksie (EN_WEEKDAY_SHORT, EN_MONTH_NAME), nie po napisie
  for (const k of [...WEEKDAY_SHORT, ...MONTH_NAME]) covered.add(k);
  for (const k of ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']) covered.add(k);
  return covered;
}

describe('każdy polski napis w kodzie gry ma angielską wersję', () => {
  const covered = coveredSet();

  it('interfejs, warstwa gry i scena 3D: literały z polskimi literami', () => {
    const missing: Found[] = [];
    for (const l of allLiterals(uiSources())) {
      if (PL_ONLY_FILES.has(l.file) || l.tagged || DEV_CALLEES.has(l.callee ?? '') || DEV_PROPS.has(l.prop ?? '')) continue;
      if (!PL_CHARS.test(l.text.replace(/zł/g, '')) || covered.has(l.text) || insideComputed(l.text)) continue;
      missing.push({ file: l.file, line: l.line, text: l.text });
    }
    expect(missing).toEqual([]);
  });

  it('tekst między znacznikami JSX idzie przez t`…` (zostają skróty i symbole, które są takie same w obu językach)', () => {
    const SAME = new Set(['OK', 'COMBO ×', 'XP', 'SCO', 'FPS']);
    const missing: Found[] = [];
    for (const { file, src } of uiSources().filter((f) => f.file.endsWith('.tsx'))) {
      for (const { text, line } of jsxTextsWithLines(src)) if (!SAME.has(text)) missing.push({ file, line, text });
    }
    expect(missing).toEqual([]);
  });

  it('symulacja (src/sim): zdania i etykiety z polskimi literami albo słowami mają wpis', () => {
    const SIM_DEV = /tycoon\/(bots|sandbox|economyEnv)\.ts$|store\/testLayouts\.ts$|exactMath\.ts$/;
    const sim = source('src/sim').filter((f) => !SIM_DEV.test(f.file));
    const missing: Found[] = [];
    for (const l of allLiterals(sim)) {
      if (DEV_CALLEES.has(l.callee ?? '') || DEV_PROPS.has(l.prop ?? '') || /^[@.]/.test(l.text)) continue;   // wyjątki, logi, ścieżki importów
      const looksPolish = PL_CHARS.test(l.text) || /\p{Ll}\s+\p{L}/u.test(l.text) || /^\p{Lu}\p{Ll}{2,}/u.test(l.text);
      if (!looksPolish || covered.has(l.text)) continue;
      missing.push({ file: l.file, line: l.line, text: l.text });
    }
    expect(missing).toEqual([]);
  });
});

// --- Zdania, które gra naprawdę wysyła -------------------------------------------------------------------------------

describe('tłumacz rozpoznaje zdania z prawdziwej gry', () => {
  it('trzy miesiące bota „mistrz” i bota „bierny”: każde zdarzenie ma angielską wersję', () => {
    const texts = new Set<string>();
    for (const [bot, seed] of [['mistrz', 'i18n-a'], ['bierny', 'i18n-b']] as const) {
      const run = freshRun(seed);
      runBot(BOTS[bot], economyEnv(run, (e) => { if (e.text) texts.add(e.text); }), 92 * 24 * 60);
      for (const h of run.state.history) texts.add(h.label);
    }
    expect(texts.size).toBeGreaterThan(30);
    const unknown = [...texts].filter((x) => localizeEn(x) === null);
    expect(unknown).toEqual([]);
  }, 120_000);
});

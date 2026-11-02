import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BENCH_CALLS_LIMIT, BENCH_CITY_ORDER, BENCH_GATE_COLUMNS, BENCH_MOBILE_UA, BENCH_PATH, BENCH_SHOP_KEYS, CITY_BUDGET, benchProblems, benchTableLines, guardNetwork,
  outDirFor, overlayProblems,
  FIXTURES, HOUR_BARS, LAUNCH_ARGS, LIMIT_TEXT, NEW_SCREENS, OPEN_MINUTE, PHONE_WIDTH, RELET_BUILD_DAYS as SMOKE_RELET_BUILD_DAYS, RELET_CAPTION, RELET_SHARE,
  QUEUE_STEP, RELET_TITLE, RELET_TRUST, STEPS, STEPS_4B, STEPS_MAKIETA, STAGES, TIPS_STEP, DESKTOP_4B, RESEARCH_DOSTAWY_COST, WALLET_4B_MILLION, FAME_TITLE, FAME_CLOSED,
  CITY_M as SMOKE_CITY_M, CITY_UNIT_M as SMOKE_CITY_UNIT_M, LAYER_LABELS, cityStatsProblems, cityWorld, geometryProblems, layerBarProblems, nextWorkdayNoon, perfHint, pinCoversPoint,
  deckIds, isApiUrl, withOnlyCardTomorrow, withRemont,
  BACKGROUND_TRUST_WARN_BELOW, USAGE, VIEWPORTS, DEFAULT_PLAYWRIGHT_ROOT, chromiumCandidates, chromiumExecutable, closedFittings,
  contextOptions, daysText, digitsOf, fixtureSave, loadPlaywright, median, metaFor, newScreenProblems, overlapArea, parseArgs, parseInstallmentButton, parsePerf,
  pinProblems, previewReady, requestVerdict, reletBlockText, reletPrice, saveWithCardDrop, stepResult, storageEntries, summarize, trustRowValues, tutorialMemory,
  widthProblems,
  type MakeRequire, type StepResult, type WidthBox,
} from '../scripts/city-smoke.mjs';
import { MemoryStorage } from '@/game/memoryStorage';
import { cityClockOf } from '@/game/scene';
import { CITY_M as GAME_CITY_M, CITY_UNIT_M as GAME_CITY_UNIT_M, cityToWorld } from '@/render/city/cityCoords';
import { loadMeta, needsStartScreen } from '@/game/meta';
import { createSession, firmOf, hasStoredSave, type GameSession } from '@/game/session';
import { queueSizeFor } from '@/render/crowdView';
import { cardModifiers } from '@/sim/economy/tycoon/cards';
import { OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { DECK } from '@/sim/economy/tycoon/deck';
import { awaitingDecision } from '@/sim/economy/economy';
import { activeStore, emptyStepOut, stepFirmMinute } from '@/sim/firm/firm';
import { FAME_CASH } from '@/sim/firm/goals';
import { RESEARCH_BY_ID, researchCost } from '@/sim/firm/research';
import { layoutFor } from '@/sim/store/layoutFor';
import { lotById } from '@/sim/city/generateCity';
import { FAME_CLOSED_TEXT, FAME_LIST_CLOSED_TEXT } from '@/ui/ranking/fameModel';
import { RELET_BUILD_DAYS, RELET_SHARE as SIM_RELET_SHARE, lotState, partnerProgress, rentPrice } from '@/sim/firm/commands';
import { percentOf } from '@/ui/game/format';
import { lotCardModel } from '@/ui/city/cityModel';
import { firmEventText, refusalText } from '@/ui/city/firmText';
import { BACKGROUND_TRUST_WARN_BELOW as SWITCHER_TRUST_WARN_BELOW } from '@/ui/city/storeSwitcherModel';

/**
 * Pomocniki skryptu smoke'a miasta (scripts/city-smoke.mjs), tak jak `tests/rankingSmoke.test.ts` dla próby rankingu: sam bieg w
 * przeglądarce sprawdza `npm run city:smoke` (Playwright nie jest zależnością projektu), tu pilnujemy tego, co da się sprawdzić w node:
 * plan kroków z Zadania 16, opcje kontekstów (locale, rozmiary, dotyk), zapis i metę, które skrypt wstawia do `localStorage` (gra ma je
 * wczytać bez ekranu startowego), blokadę wszystkiego poza localhost i `/api/**`, wybór Playwrighta i Chromium, odczyt licznika FPS,
 * tabelę wyników i to, że zrzuty idą do katalogu z `.gitignore`. Nic nie wychodzi poza proces.
 */

const ROOT = resolve(__dirname, '..');
const SOURCE = readFileSync(resolve(ROOT, 'scripts/city-smoke.mjs'), 'utf8');
const SOURCE_FAME = readFileSync(resolve(ROOT, 'src/ui/ranking/FameWindow.tsx'), 'utf8');
const DAY = 24 * 60;

describe('plan smoke\'a (Zadanie 16)', () => {
  it('piętnaście kroków (1–8 z 4a.1, 9–12 z 4a.2, 13–15 makieta) i przebieg z dymkami; 6 i 13 tylko na komputerze, 7, 12 i 14 tylko na telefonie, reszta na obu', () => {
    expect(STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const sizes = (id: number | string): string[] => [...[...STEPS, TIPS_STEP].find((s) => s.id === id)!.sizes];
    for (const id of [1, 2, 3, 4, 5, 8, 9, 10, 11, 15]) expect(sizes(id), `krok ${id}`).toEqual(['telefon', 'desktop']);
    expect(sizes(6)).toEqual(['desktop']);
    expect(sizes(13)).toEqual(['desktop']);
    expect(sizes(7)).toEqual(['telefon']);
    expect(sizes(12)).toEqual(['telefon']);
    expect(sizes(14)).toEqual(['telefon']);
    expect(sizes('T')).toEqual(['telefon']);
    for (const s of STEPS) expect(s.name.length).toBeGreaterThan(10);
  });

  it('dwa rozmiary: 390×844 z dotykiem i 1280×800 bez; każdy kontekst z locale pl-PL', () => {
    expect(VIEWPORTS.map((v) => [v.name, v.size.width, v.size.height, v.mobile])).toEqual([['telefon', 390, 844, true], ['desktop', 1280, 800, false]]);
    expect(PHONE_WIDTH).toBe(390);
    for (const vp of VIEWPORTS) {
      expect(contextOptions(vp)).toEqual({ locale: 'pl-PL', viewport: vp.size, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
    }
  });

  it('Chromium dostaje flagi swiftshadera (headless nie ma GPU)', () => {
    expect(LAUNCH_ARGS).toEqual(['--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
  });

  it('npm run city:smoke woła ten skrypt', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['city:smoke']).toBe('node scripts/city-smoke.mjs');
  });
});

describe('zapis i meta wstawiane do localStorage', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  const load = (file: string, tips = false): { seed: string; text: string } => {
    const save = fixtureSave(file);
    for (const [k, v] of Object.entries(storageEntries({ seed: save.seed, saveText: save.text, tips, now: Date.now() }))) storage.setItem(k, v);
    return save;
  };

  it('pamięć samouczka: przelot pominięty, bez dymków (albo z dymkami w przebiegu Zadania 14), dosłownie jak w uzgodnieniu', () => {
    expect(JSON.stringify(tutorialMemory(false))).toBe('{"v":1,"tour":"skipped","seen":[],"tips":false}');
    expect(tutorialMemory(true)).toEqual({ v: 1, tour: 'skipped', seen: [], tips: true });
  });

  it('meta ma gracza z nickiem (bez ekranu startowego), stoi „teraz” i niczego nie gra', () => {
    const now = 1_800_000_000_000;
    const meta = metaFor(now);
    expect(meta).toMatchObject({ version: 1, lastSeen: now, sound: false, vibration: false, daily: { date: '', streak: 0 } });
    load(FIXTURES.stary);
    const loaded = loadMeta();
    expect(loaded.player?.nick).toBe('Smoke');
    expect(needsStartScreen(loaded)).toBe(false);
  });

  it('stary zapis schematu 2: pod swoim seedem, wczytuje się jako sklep po dwóch remontach i bez statusu Partnera', () => {
    const save = load(FIXTURES.stary);
    expect(save.seed).toBe('traszka-v2-b');
    expect(JSON.parse(storage.getItem(`traszka:save:${save.seed}`)!)).toMatchObject({ schema: 2, seed: save.seed });
    expect(hasStoredSave(save.seed)).toBe(true);
    const session = createSession(save.seed);
    expect(session.fromSave).toBe(true);
    expect(session.loadNotice).toBeNull();
    expect(session.ephemeral).toBe(false);
    expect(session.econ.remontLevel).toBe(2);
  });

  it('fixture „przed statusem”: schemat 3, firma z jednym sklepem, jeszcze bez statusu, postęp „1 miesiąc z zyskiem”', () => {
    const save = load(FIXTURES.przedStatusem);
    expect(save.seed).toBe('traszka-1');
    expect(JSON.parse(storage.getItem(`traszka:save:${save.seed}`)!)).toMatchObject({ schema: 3, seed: save.seed });
    const session = createSession(save.seed);
    expect(session.fromSave).toBe(true);
    expect(session.loadNotice).toBeNull();
    const f = session.firm!;
    expect(f.stores).toHaveLength(1);
    expect(f.person.partner).toBe(false);
    const progress = partnerProgress(f);
    expect(progress).toMatchObject({ kind: 'missing', profitMonthsNeeded: 1 });
  });

  it('fixture „po Traszce”: schemat 3, #1 i #3 otwarte, #2 zamknięty z remontem 1 i kasą, Partner, lokal #2 „po Traszce” z ceną po zniżce', () => {
    const save = load(FIXTURES.poTraszce);
    expect(save.seed).toBe('traszka-1');
    expect(JSON.parse(storage.getItem(`traszka:save:${save.seed}`)!)).toMatchObject({ schema: 3, seed: save.seed });
    const session = createSession(save.seed);
    expect(session.fromSave).toBe(true);
    expect(session.loadNotice).toBeNull();
    const f = session.firm!;
    expect(f.stores.map((st) => [st.id, st.closed])).toEqual([[1, false], [2, true], [3, false]]);
    expect(f.person.partner).toBe(true);
    const fit = closedFittings(save.text);
    expect(fit).toHaveLength(1);
    expect(fit[0]).toMatchObject({ id: 2, remontLevel: 1, equipment: ['sco'], upgrades: 0 });
    const lot = fit[0]!.lotId as number;
    expect(f.stores[1]!.lotId).toBe(lot);
    expect(lotState(f, lot)).toBe('po-traszce');
    // cena z napisów smoke'a to dokładnie `rentPrice` gry, a blok wyposażenia to to, co niesie model karty
    expect(reletPrice(f.city.lots[lot]!.package)).toBe(rentPrice(f, lot));
    expect(f.person.wallet).toBeGreaterThanOrEqual(rentPrice(f, lot));
    const model = lotCardModel(save.seed, f, lot, 'gotowka');
    expect(model.price).toBe(rentPrice(f, lot));
    expect(model.relet).toEqual({ remontLevel: fit[0]!.remontLevel, equipment: fit[0]!.equipment.length, upgrades: fit[0]!.upgrades });
    expect(model.buildDays).toBe(RELET_BUILD_DAYS);
    expect(model.buildDays).toBe(SMOKE_RELET_BUILD_DAYS);   // stała smoke'a to dni budowy, które pokazuje karta lokalu po Traszce
    expect(session.firm!.stores[0]!.econ.remontLevel).toBe(0);   // #1 bez remontu: jego lokal obok czeka (pinezka „obok”)
  });

  it('fixtureSave bierze seed z koperty, a brak seeda to błąd', () => {
    expect(() => fixtureSave('nie-ma-takiego-pliku.json')).toThrow();
  });
});

describe('blokada zapytań: smoke niczego nie wysyła do rankingu ani poza localhost', () => {
  const PORT = 4318;
  it('localhost na porcie smoke\'a przechodzi, blob i data też', () => {
    expect(requestVerdict(`http://localhost:${PORT}/`, PORT)).toBe('allow');
    expect(requestVerdict(`http://localhost:${PORT}/assets/index-abc.js`, PORT)).toBe('allow');
    expect(requestVerdict(`http://127.0.0.1:${PORT}/x.glb`, PORT)).toBe('allow');
    expect(requestVerdict('blob:http://localhost:4318/0a1b', PORT)).toBe('allow');
    expect(requestVerdict('data:image/png;base64,AAAA', PORT)).toBe('allow');
  });

  it('/api/** na localhost jest przerywane (ranking jest poza smoke\'em), także zapytania z ukośnikiem na końcu i podścieżką', () => {
    for (const path of ['/api/runs', '/api/runs?sim=6', '/api/week', '/api/', '/api']) expect(requestVerdict(`http://localhost:${PORT}${path}`, PORT), path).toBe('api');
    expect(requestVerdict(`http://localhost:${PORT}/apiary.js`, PORT)).toBe('allow');   // tylko ścieżka /api, nie prefiks nazwy
  });

  it('każdy inny host jest zewnętrzny: produkcja na Vercelu, obcy port, host z `localhost` w nazwie, sztuczka z `user@host`', () => {
    for (const href of [
      'https://traszka.vercel.app/api/runs', 'https://traszka.vercel.app/', 'https://example.com/', `http://localhost:${PORT + 1}/`,
      `http://localhost.evil.test:${PORT}/`, `http://localhost:${PORT}@evil.test/`, 'not a url', `https://localhost:${PORT}/`.replace('https', 'ftp'),
    ]) expect(requestVerdict(href, PORT), href).toBe('external');
  });

  it('źródło skryptu rejestruje trasę `**/api/**` z przerwaniem i nie zna adresów produkcji', () => {
    expect(SOURCE).toMatch(/route\('\*\*\/api\/\*\*'/);
    expect(SOURCE).toMatch(/route\.abort\(\)/);
    expect(SOURCE).not.toMatch(/vercel\.app/);
    expect(SOURCE).not.toMatch(/\bfetch\(\s*['"`]https?:/);
  });
});

describe('Playwright i Chromium', () => {
  const dummy = { chromium: {} };

  it('pakiet z katalogu PLAYWRIGHT_ROOT (sam pakiet), z jego node_modules, albo z projektu; bez nich błąd z podpowiedzią', () => {
    const calls: string[] = [];
    const only = (match: (from: string, id: string) => boolean): MakeRequire => (from) => (id) => {
      calls.push(`${from}|${id}`);
      if (match(from, id)) return dummy;
      throw new Error(`Cannot find module '${id}'\nstos`);
    };
    expect(loadPlaywright('/p/playwright-core', only((from, id) => id === '/p/playwright-core'))).toBe(dummy);
    expect(loadPlaywright('/p', only((from, id) => id === 'playwright'))).toBe(dummy);
    expect(loadPlaywright('/p', only((from, id) => id === 'playwright-core'))).toBe(dummy);
    expect(() => loadPlaywright('/p', only(() => false))).toThrow(/PLAYWRIGHT_ROOT.*Cannot find module/);
    expect(() => loadPlaywright('/p', () => () => ({}))).toThrow(/moduł bez chromium/);
  });

  it('domyślne miejsce Playwrighta jest neutralne jak w tutorial-smoke (repozytorium jest publiczne), a źródło nie zna ścieżek z domu autora', () => {
    expect(DEFAULT_PLAYWRIGHT_ROOT).toBe('/opt/node-tools');
    expect(readFileSync(resolve(ROOT, 'scripts/tutorial-smoke.mjs'), 'utf8')).toContain(`'/opt/node-tools'`);
    expect(SOURCE).not.toMatch(/\/Users\/|\/home\/|mpawelczuk/);
    expect(USAGE).toContain('PLAYWRIGHT_ROOT');
    expect(USAGE).toContain(DEFAULT_PLAYWRIGHT_ROOT);
    // PLAYWRIGHT_ROOT może wskazywać katalog node_modules, w którym leży pakiet
    const nodeModules: MakeRequire = (from) => (id) => {
      if (from === '/x/node_modules/' && id === 'playwright') return dummy;
      throw new Error(`Cannot find module '${id}'`);
    };
    expect(loadPlaywright('/x/node_modules', nodeModules)).toBe(dummy);
  });

  it('kandydaci Chromium: headless shell z cache\'u Playwrighta, najnowszy build pierwszy; brak cache\'u to pusta lista', () => {
    const list = (): string[] => ['chromium-1248', 'chromium_headless_shell-1243', 'chromium_headless_shell-1248', 'ffmpeg-1010'];
    const c = chromiumCandidates('/home/u', list);
    expect(c[0]).toBe('/home/u/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
    expect(c.filter((p) => p.includes('-1243'))).toHaveLength(2);
    expect(c.findIndex((p) => p.includes('-1243'))).toBeGreaterThan(c.findIndex((p) => p.includes('-1248')));
    expect(chromiumCandidates('/home/u', () => { throw new Error('ENOENT'); })).toEqual([]);
  });

  it('CITY_SMOKE_CHROMIUM wygrywa (i musi istnieć), a bez niego pierwszy istniejący kandydat albo nic', () => {
    const exists = (p: string): boolean => p === '/b' || p === '/c';
    expect(chromiumExecutable({ CITY_SMOKE_CHROMIUM: '/b' }, exists, ['/a'])).toBe('/b');
    expect(() => chromiumExecutable({ CITY_SMOKE_CHROMIUM: '/zly' }, exists, [])).toThrow(/CITY_SMOKE_CHROMIUM/);
    expect(chromiumExecutable({}, exists, ['/a', '/c', '/b'])).toBe('/c');
    expect(chromiumExecutable({}, exists, ['/a'])).toBeUndefined();
  });
});

describe('licznik wydajności i tabela wyników', () => {
  it('parsePerf czyta cztery wiersze nakładki, także z twardą spacą tysięcy (pl-PL) i przecinkiem', () => {
    const rows: [string, string][] = [['FPS', '12'], ['Klatka', '83,3 ms'], ['Wywołania rysowania', '52'], ['Trójkąty', '1 234 567']];
    expect(parsePerf(rows)).toEqual({ fps: 12, ms: 83.3, calls: 52, tris: 1_234_567 });
    expect(parsePerf([['FPS', '30'], ['Klatka', '33.3 ms'], ['Draw calls', '41'], ['Triangles', '98,000']])).toMatchObject({ fps: 30, ms: 33.3, calls: 41 });
  });

  it('mediana: nieparzysta, parzysta i pusta', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  const allOk = (): Record<string, Record<string, StepResult>> => {
    const out: Record<string, Record<string, StepResult>> = {};
    for (const vp of VIEWPORTS) {
      out[vp.name] = {};
      for (const step of [...STEPS, TIPS_STEP, ...STEPS_4B]) out[vp.name]![step.id] = step.sizes.includes(vp.name) ? stepResult() : stepResult({ na: true });
    }
    return out;
  };

  it('summarize: wiersz na krok i rozmiar, który go dotyczy (telefon 14 + 7 kroków 4b, komputer 12 + 7), wszystko ok daje ok', () => {
    const s = summarize(allOk());
    expect(s.ok).toBe(true);
    const k4b = ['4b-a', '4b-b', '4b-c', '4b-d', '4b-e', '4b-f', '4b-g'];
    expect(s.rows.filter((r) => r.size === 'telefon').map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 'T', ...k4b]);
    expect(s.rows.filter((r) => r.size === 'desktop').map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 13, 15, ...k4b]);
    expect(s.rows.every((r) => r.status === 'ok')).toBe(true);
  });

  it('summarize: porażka kroku, brak wyniku kroku i wyjątek poza krokiem to FAIL z przyczyną; „nie dotyczy” nie psuje wyniku', () => {
    const failed = allOk();
    failed.desktop![3] = stepResult({ ok: false, failed: ['gotówka za mała'] });
    const s1 = summarize(failed);
    expect(s1.ok).toBe(false);
    expect(s1.rows.find((r) => r.size === 'desktop' && r.step === 3)).toMatchObject({ status: 'FAIL', detail: 'gotówka za mała' });

    const missing = allOk();
    delete missing.telefon![5];
    const s2 = summarize(missing);
    expect(s2.ok).toBe(false);
    expect(s2.rows.find((r) => r.size === 'telefon' && r.step === 5)).toMatchObject({ status: 'FAIL', detail: 'krok się nie wykonał' });

    const boom = allOk();
    boom.telefon!.exception = stepResult({ ok: false, failed: ['wyjątek: strona padła'] });
    const s3 = summarize(boom);
    expect(s3.ok).toBe(false);
    expect(s3.rows.find((r) => r.step === '!')).toMatchObject({ size: 'telefon', status: 'FAIL', detail: 'wyjątek: strona padła' });

    expect(summarize(allOk()).rows.some((r) => r.status === 'n/d')).toBe(false);   // kroki spoza rozmiaru w ogóle nie trafiają do tabeli
  });

  it('parseArgs: --help to pomoc (main drukuje USAGE i kończy kodem 0), --only telefon|phone|desktop, --etap 4b, błędy', () => {
    expect(parseArgs([])).toEqual({ only: null, help: false, bench: false, stage: null });
    expect(parseArgs(['--only', 'desktop'])).toEqual({ only: 'desktop', help: false, bench: false, stage: null });
    expect(parseArgs(['--only', 'phone'])).toEqual({ only: 'telefon', help: false, bench: false, stage: null });
    expect(parseArgs(['--etap', '4b', '--only', 'telefon'])).toEqual({ only: 'telefon', help: false, bench: false, stage: '4b' });
    expect(parseArgs(['--etap', 'makieta'])).toEqual({ only: null, help: false, bench: false, stage: 'makieta' });
    expect(parseArgs(['--etap', 'makieta', '--only', 'phone'])).toEqual({ only: 'telefon', help: false, bench: false, stage: 'makieta' });
    expect(() => parseArgs(['--etap', '4a'])).toThrow(/--etap przyjmuje 4b albo makieta/);
    expect(() => parseArgs(['--etap'])).toThrow(/--etap przyjmuje 4b albo makieta/);
    expect(USAGE).toMatch(/--etap makieta/);
    expect(USAGE).toMatch(/--etap 4b/);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(USAGE).toMatch(/--only/);
    expect(SOURCE).toMatch(/if \(args\.help\) \{\s*console\.log\(USAGE\);\s*return 0;/);
    expect(() => parseArgs(['--only', 'tablet'])).toThrow(/telefon albo desktop/);
    expect(() => parseArgs(['--only'])).toThrow();
    expect(() => parseArgs(['--write'])).toThrow(/nieznany argument/);
  });
});

describe('zrzuty smoke\'a nie trafiają do commita', () => {
  const ignored = (path: string): number | null =>
    spawnSync('git', ['-c', `core.excludesFile=${devNull}`, 'check-ignore', '--no-index', '-q', '--', path], { cwd: ROOT }).status;

  it('katalog wyjściowy skryptu (.smoke/city) jest w .gitignore, a zrzuty wybrane do raportu w docs/ nie', () => {
    expect(ignored('.smoke/city/telefon-01-stary-zapis-karta.jpg')).toBe(0);
    expect(ignored('.smoke/city/smoke.json')).toBe(0);
    expect(ignored('.smoke/city-bench/bench.json')).toBe(0);   // `--bench` pisze osobno, żeby nie kasować wyników pełnego smoke'a
    expect(ignored('docs/superpowers/reports/2026-10-31-miasto-4a1/telefon-01-stary-zapis-karta.jpg')).toBe(1);
    expect(SOURCE).toMatch(/join\(ROOT, '\.smoke', bench \? 'city-bench' : 'city'\)/);
  });
});

describe('szerokość 390 px: okna modalne mierzy się osobno (poziomy wylew w oknie `position: fixed` nie zmienia scrollWidth dokumentu)', () => {
  const box = (patch: Partial<WidthBox> = {}): WidthBox => ({ name: 'tt-modal [Okno]', left: 16, right: 374, scroll: 358, client: 358, ...patch });

  it('dokument i okna w granicach: brak wad', () => {
    expect(widthProblems({ scroll: 390, boxes: [box(), box({ name: 'tt-sheet' })] })).toEqual([]);
    expect(widthProblems({ scroll: 390 })).toEqual([]);   // pomiar bez okien
    expect(widthProblems({ scroll: 390, boxes: [box({ scroll: 359 })] })).toEqual([]);   // tolerancja 1 px na zaokrąglenia
  });

  it('wylew w oknie przy scrollWidth dokumentu równym 390 to wada (dokładnie ten przypadek, którego dokument nie widzi)', () => {
    const p = widthProblems({ scroll: 390, boxes: [box({ name: 'tt-modal [Wyciągi od Centrali]', scroll: 412, client: 358 })] });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/tt-modal \[Wyciągi od Centrali\].*412.*358/);
  });

  it('ramka poza oknem po którejkolwiek stronie i szeroki dokument to wady; granica 390 ma tolerancję 0,5 px', () => {
    expect(widthProblems({ scroll: 390, boxes: [box({ right: 390.4 })] })).toEqual([]);
    expect(widthProblems({ scroll: 390, boxes: [box({ right: 391 })] })[0]).toMatch(/poza oknem/);
    expect(widthProblems({ scroll: 390, boxes: [box({ left: -2 })] })[0]).toMatch(/poza oknem/);
    expect(widthProblems({ scroll: 391, boxes: [] })[0]).toMatch(/dokument 391/);
    expect(widthProblems({ scroll: 400, boxes: [box({ scroll: 500, right: 480 })] })).toHaveLength(3);
    expect(widthProblems({ scroll: 360 }, 360)).toEqual([]);   // własny limit
    expect(PHONE_WIDTH).toBe(390);
  });

  it('źródło mierzy okna, arkusz, kartę i listę sklepów oraz wołają to okna z kolejki gry, status i otwarcie sklepu #2', () => {
    for (const sel of ['.tt-modal', '.tt-sheet', '.tt-lotcard', '.tt-stores-pop']) expect(SOURCE).toContain(sel);
    expect(SOURCE).toContain("checkWidth(page, 'okno: status Partnera')");
    expect(SOURCE).toContain("checkWidth(page, 'okno: Traszka #2 otwarta')");
    expect(SOURCE).toMatch(/hooks\.onDialog = vp\.mobile/);
  });
});

describe('kliknięcia w sterowanie nie omijają kontroli Playwrighta', () => {
  it('`el.click()` w DOM jest tylko w `dismiss` (pętla zamykania okien), a użycia są zapisywane do smoke.json', () => {
    const clicks = SOURCE.match(/\.click\(\)/g) ?? [];
    // `locator(...).click()` i `payButton.click()` to kliknięcia Playwrighta; w DOM klika jedynie `el.click()`
    const dom = SOURCE.match(/\bel\.click\(\)/g) ?? [];
    expect(dom).toHaveLength(1);
    expect(clicks.length).toBeGreaterThan(1);
    const from = SOURCE.indexOf('async function dismiss(');
    const to = SOURCE.indexOf('async function tapOutside(');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    expect(SOURCE.slice(from, to)).toContain('el.click()');
    expect(SOURCE.slice(from, to)).toContain('hooks.fallbacks.push');
    expect(SOURCE).toMatch(/fallbacks: hooks\.fallbacks/);
    // wpis mówi, na której karcie i w którym kroku okno nie dało się zamknąć zwykłym kliknięciem (karta z `newPage`, krok z `runStep`)
    expect(SOURCE.slice(from, to)).toContain('page.smokeTag');
    expect(SOURCE.slice(from, to)).toContain('hooks.step');
    expect(SOURCE).toContain('page.smokeTag = `${vp.name}/${tag}`;');
    expect(SOURCE).toMatch(/hooks\.step = id;[\s\S]*hooks\.step = null;/);
    // `press` (sterowanie sprawdzane w krokach) to samo kliknięcie Playwrighta, bez przechwytywania błędu
    const press = SOURCE.slice(SOURCE.indexOf('async function press('), SOURCE.indexOf('const hooks'));
    expect(press).toContain('await page.click(sel');
    expect(press).not.toMatch(/catch|evaluate/);
    // zamykanie listy sklepów to stuknięcie w tło, a nie `click()` w DOM
    expect(SOURCE).not.toMatch(/stores-backdrop'\)\?\.click/);
  });
});

describe('start serwera podglądu', () => {
  it('gotowość to wpis vite o naszym porcie (także z kodami kolorów); błąd zajętego portu albo cudzy port to nie gotowość', () => {
    expect(previewReady('  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m4318\u001b[22m/\u001b[39m\n', 4318)).toBe(true);
    expect(previewReady('  ➜  Local:   http://localhost:4318/\n', 4318)).toBe(true);
    expect(previewReady('Error: Port 4318 is already in use\n', 4318)).toBe(false);
    expect(previewReady('  ➜  Local:   http://localhost:4319/\n', 4318)).toBe(false);
    expect(previewReady('', 4318)).toBe(false);
  });

  it('źródło nie ufa pierwszej odpowiedzi: proces musi żyć, a SIGTERM i `close()` kończą sprzątaniem w finally', () => {
    expect(SOURCE).toMatch(/previewReady\(log, port\)/);
    expect(SOURCE).toMatch(/proc\.exitCode === null/);
    expect(SOURCE).toMatch(/process\.on\('SIGINT'/);
    expect(SOURCE).toMatch(/process\.on\('SIGTERM'/);
    expect(SOURCE).toMatch(/try \{\s*await browser\?\.close\(\);[^}]*\} finally \{\s*stopAll\(\);/);
  });
});

describe('krok 3: rata pakietu z danych sklepu, nie z napisu', () => {
  it('skrypt sprawdza 12 rat, opłatę 15% i sumę 115% z `installments`, a notatka nie wpisuje „× 12” na sztywno', () => {
    expect(SOURCE).toContain('rata.months === 12');
    expect(SOURCE).toMatch(/0\.15 \* rata\.price/);
    expect(SOURCE).toMatch(/1\.15 \* rata\.price/);
    expect(SOURCE).not.toMatch(/miesięcznie × 12/);
  });
});

describe('plan 4a.2 (Zadanie 9): stałe smoke\'a są zgodne z grą', () => {
  it('cena po Traszce, próg ostrzeżenia, zaufanie po ponownym otwarciu i liczba słupków wykresu', () => {
    expect(RELET_SHARE).toBe(SIM_RELET_SHARE);
    expect(reletPrice(37_500)).toBe(11_300);   // 37 500 × 0,3 = 11 250, zaokrąglone do pełnych setek jak pakiet
    expect(reletPrice(54_800)).toBe(16_400);
    expect(BACKGROUND_TRUST_WARN_BELOW).toBe(SWITCHER_TRUST_WARN_BELOW);
    expect(RELET_TRUST).toBe(TRUST.start);
    expect(HOUR_BARS).toBe((OPEN_TO - OPEN_FROM) / 60);
    expect(OPEN_MINUTE).toBe(OPEN_FROM);   // sklep z budowy otwiera się o 6:00
  });

  it('dni budowy po Traszce z gry (RELET_BUILD_DAYS) i ich zapis na karcie i pinezce', () => {
    expect(SMOKE_RELET_BUILD_DAYS).toBe(RELET_BUILD_DAYS);
    expect(daysText(SMOKE_RELET_BUILD_DAYS)).toBe('2 dni');
    expect(daysText(1)).toBe('1 dzień');
    expect(daysText(5)).toBe('5 dni');
  });

  it('teksty dosłowne: odmowa limitu, tytuł okna ponownego otwarcia i podpis zniżki to teksty gry', () => {
    expect(LIMIT_TEXT).toBe(refusalText('limit', firmOf(createSession('kiełbasa-42', true))));   // świeża firma ma limit 3, jak sklep w scenariuszu smoke'a
    expect(RELET_CAPTION).toBe(`po Traszce: ${percentOf(SIM_RELET_SHARE)} ceny`);
    const save = fixtureSave(FIXTURES.poTraszce);
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    try {
      for (const [k, v] of Object.entries(storageEntries({ seed: save.seed, saveText: save.text, tips: false, now: Date.now() }))) storage.setItem(k, v);
      const firm = createSession(save.seed).firm!;
      expect(firmEventText(firm, { kind: 'opened', storeId: 2, params: { lotId: firm.stores[1]!.lotId, reopened: 1 } }).title).toBe(RELET_TITLE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closedFittings czyta z koperty to, co zostaje w lokalu; reletBlockText składa polski blok karty', () => {
    expect(closedFittings(JSON.stringify({ stores: [
      { id: 1, lotId: 3, closed: false, econ: { remontLevel: 2 } },
      { id: 2, lotId: 9, closed: true, econ: { remontLevel: 1, equipment: [{ id: 'sco' }, { id: 'sco' }, { id: 'piec' }], upgrades: { szkolenie: 1, ulotki: 3 } } },
    ] }))).toEqual([{ id: 2, lotId: 9, remontLevel: 1, equipment: ['sco', 'sco', 'piec'], upgrades: 4 }]);
    expect(reletBlockText({ remontLevel: 1, equipment: ['sco'], upgrades: 0 })).toBe('Wyposażenie zostało: remont 1, sprzęt 1 szt., ulepszenia 0');
  });

  it('digitsOf, parseInstallmentButton i trustRowValues czytają napisy z twardą spacą', () => {
    expect(digitsOf('11\u00a0250 zł')).toBe(11_250);
    expect(digitsOf('brak')).toBe(0);
    expect(parseInstallmentButton('na raty 1\u00a0077 zł × 12 z przelewów tego sklepu')).toEqual({ monthly: 1077, months: 12 });
    expect(parseInstallmentButton('za gotówkę 11 300 zł')).toBeNull();
    expect(trustRowValues(['Traszka #1', 'zaufanie 100', 'Razem', 'zaufanie 65 ', 'zaufanie 7x'])).toEqual([100, 65]);
    expect(trustRowValues(['trust 40', 'zaufanie 12'], 'trust')).toEqual([40]);
  });
});

describe('plan 4a.2 (Zadanie 9): pomiar pinezki „lokal obok” na 390 px', () => {
  type Pin = Parameters<typeof pinProblems>[0]['pins'][number];
  const pin = (patch: Partial<Pin> & { lot: number; kind: string }): Pin => ({
    z: 200, box: { l: 100, t: 100, r: 146, b: 156 }, label: null, covers: [], ...patch,
  });
  const obok = (patch: Partial<Pin> = {}): Pin => pin({
    lot: 13, kind: 'obok', z: 0, box: { l: 156, t: 307, r: 202, b: 344 }, label: { text: 'lokal obok', box: null, display: 'none' }, ...patch,
  });
  const others: Pin[] = [
    pin({ lot: 14, kind: 'twoj', z: 339, box: { l: 137, t: 291, r: 211, b: 339 } }),
    pin({ lot: 7, kind: 'wolny', z: 353, box: { l: 171, t: 297, r: 217, b: 353 } }),
    pin({ lot: 34, kind: 'szop', z: 298, box: { l: 32, t: 250, r: 100, b: 298 } }),
  ];

  it('przecięcie ramek w px²: rozłączne i stykające się dają 0, reszta pole (tolerancja 0,5 px)', () => {
    expect(overlapArea({ l: 0, t: 0, r: 10, b: 10 }, { l: 20, t: 0, r: 30, b: 10 })).toBe(0);
    expect(overlapArea({ l: 0, t: 0, r: 10, b: 10 }, { l: 10, t: 0, r: 20, b: 10 })).toBe(0);
    expect(overlapArea({ l: 0, t: 0, r: 10, b: 10 }, { l: 5, t: 5, r: 20, b: 20 })).toBe(25);
    expect(overlapArea({ l: 0, t: 0, r: 10, b: 10 }, { l: 9.8, t: 0, r: 20, b: 10 })).toBe(0);
  });

  it('telefon: napis ukryty, pinezka pod pozostałymi i niczego niezasłaniająca to brak wad, a zachodzenie samej kartki idzie do przecięć (dowód)', () => {
    const r = pinProblems({ width: 390, pins: [obok(), ...others] });
    expect(r.problems).toEqual([]);
    expect(r.overlaps).toEqual([{ lot: 13, with: 14, kind: 'twoj', area: 1472 }, { lot: 13, with: 7, kind: 'wolny', area: 1147 }]);
  });

  it('wady: widoczny napis na wąskim ekranie, napis wchodzący na inną pinezkę, pinezka nie pod spodem, zasłonięta pinezka i brak pinezki obok', () => {
    const shown = pinProblems({ width: 390, pins: [obok({ label: { text: 'lokal obok', box: { l: 150, t: 280, r: 210, b: 296 }, display: 'block' } }), ...others] });
    expect(shown.problems.some((p) => /widoczny na 390 px/.test(p))).toBe(true);
    expect(shown.problems.some((p) => /napis pinezki obok .* przecina pinezkę twoj/.test(p))).toBe(true);
    const wide = pinProblems({ width: 1280, pins: [obok({ label: { text: 'lokal obok', box: { l: 150, t: 250, r: 210, b: 266 }, display: 'block' } }), ...others] });
    expect(wide.problems).toEqual([]);   // na komputerze napis ma być widoczny, byle nie wchodził na inne pinezki
    expect(pinProblems({ width: 390, pins: [obok({ z: 400 }), ...others] }).problems.join()).toMatch(/nie leży pod spodem/);
    expect(pinProblems({ width: 390, pins: [obok({ covers: [7] }), ...others] }).problems.join()).toMatch(/zasłania pinezki: 7/);
    expect(pinProblems({ width: 390, pins: [...others] }).problems).toEqual(['brak pinezki „lokal obok” na ekranie']);
    expect(pinProblems({ width: 390, pins: [obok({ box: null }), ...others] }).problems).toEqual(['brak pinezki „lokal obok” na ekranie']);
  });

  it('źródło mierzy `.tt-cpin-obok` (nie `.tt-cpin-wolny`) przez `getBoundingClientRect` i `elementFromPoint`, tylko na telefonie w kroku 2', () => {
    expect(SOURCE).toContain('.tt-cpin-obok');
    expect(SOURCE).toMatch(/getBoundingClientRect/);
    expect(SOURCE).toMatch(/elementFromPoint\(\(p\.box\.l \+ p\.box\.r\) \/ 2/);
    expect(SOURCE).toMatch(/if \(phone\) await obokPinCheck\(page, ev\);/);
  });
});

describe('plan 4a.2 (Zadanie 9): nowe ekrany na 390 px', () => {
  const entry = (label: string, ok = true) => ({ label, scroll: 390, boxes: 1, problems: ok ? [] : ['dokument 400 px (limit 390)'], ok });
  const complete = (prefix = '') => [
    entry(`${prefix}karta lokalu z wykresem`), entry(`${prefix}karta lokalu po Traszce`), entry(`${prefix}lista sklepów (trzy)`),
    ...['Sieć', 'wyciąg #1', 'wyciąg #2', 'wyciąg #3'].map((n) => entry(`${prefix}okno sieci (cztery zakładki): ${n}`)),
    ...['Sieć', '#1', '#2', '#3'].map((n) => entry(`${prefix}podgląd końca miesiąca (cztery zakładki): ${n}`)),
  ];

  it('komplet pomiarów bez wad daje pustą listę, osobno po polsku i po angielsku', () => {
    expect(newScreenProblems(complete())).toEqual([]);
    expect(newScreenProblems(complete('angielski: '), 'angielski: ')).toEqual([]);
    expect(newScreenProblems(complete('angielski: '))).toHaveLength(NEW_SCREENS.length);   // angielskie etykiety nie liczą się jako polskie
    expect(NEW_SCREENS.map((s) => s.name)).toEqual([
      'karta lokalu z wykresem', 'karta lokalu po Traszce', 'lista sklepów (trzy)', 'okno sieci (cztery zakładki)', 'podgląd końca miesiąca (cztery zakładki)',
    ]);
    expect(NEW_SCREENS.find((s) => s.name.startsWith('podgląd końca miesiąca'))!.min).toBe(4);   // „Sieć” i trzy sklepy
  });

  it('brakujący ekran, za mało zakładek okna sieci i wylew to wady z nazwą ekranu', () => {
    const missing = complete().filter((w) => !w.label.startsWith('lista sklepów'));
    expect(newScreenProblems(missing)).toEqual(['lista sklepów (trzy): zmierzono 0 z 1']);
    const tabs = complete().filter((w) => !w.label.endsWith('wyciąg #3'));
    expect(newScreenProblems(tabs)).toEqual(['okno sieci (cztery zakładki): zmierzono 3 z 4']);
    // podgląd końca miesiąca: brak całego ekranu, za mało zakładek i wylew w jednej z nich, po polsku i po angielsku
    const noPreview = complete().filter((w) => !w.label.startsWith('podgląd końca miesiąca'));
    expect(newScreenProblems(noPreview)).toEqual(['podgląd końca miesiąca (cztery zakładki): zmierzono 0 z 4']);
    const threePreviewTabs = complete().filter((w) => w.label !== 'podgląd końca miesiąca (cztery zakładki): #3');
    expect(newScreenProblems(threePreviewTabs)).toEqual(['podgląd końca miesiąca (cztery zakładki): zmierzono 3 z 4']);
    const widePreview = complete();
    const at = widePreview.findIndex((w) => w.label === 'podgląd końca miesiąca (cztery zakładki): #2');
    widePreview[at] = entry('podgląd końca miesiąca (cztery zakładki): #2', false);
    expect(newScreenProblems(widePreview)).toEqual(['podgląd końca miesiąca (cztery zakładki): #2: dokument 400 px (limit 390)']);
    const noPreviewEn = complete('angielski: ').filter((w) => !w.label.includes('podgląd końca miesiąca'));
    expect(newScreenProblems(noPreviewEn, 'angielski: ')).toEqual(['angielski: podgląd końca miesiąca (cztery zakładki): zmierzono 0 z 4']);
    const wide = complete();
    wide[1] = entry('karta lokalu po Traszce', false);
    expect(newScreenProblems(wide)).toEqual(['karta lokalu po Traszce: dokument 400 px (limit 390)']);
  });

  it('źródło mierzy te cztery ekrany pod ich nazwami, po polsku w krokach 9–11 i po angielsku w kroku 12', () => {
    for (const label of ["'karta lokalu po Traszce'", "'karta lokalu z wykresem'", "'lista sklepów (trzy)'", "'angielski: karta lokalu po Traszce'", "'angielski: karta lokalu z wykresem'", "'angielski: lista sklepów (trzy)'"]) {
      expect(SOURCE, label).toContain(`checkWidth(page, ${label})`);
    }
    expect(SOURCE).toContain('okno sieci (cztery zakładki): ${net}');
    expect(SOURCE).toContain('newScreenProblems(widths)');
    expect(SOURCE).toContain("newScreenProblems(widths, 'angielski: ')");
  });

  it('źródło otwiera podgląd końca miesiąca z paska prognozy: po polsku w kroku 11 tylko na telefonie, po angielsku w kroku 12, a każdą z czterech zakładek mierzy', () => {
    expect(SOURCE).toContain("if (phone) await monthPreviewChecks(page, ev, { lang: 'pl' });");
    expect(SOURCE).toContain("await monthPreviewChecks(page, ev, { lang: 'en' });");
    const body = SOURCE.slice(SOURCE.indexOf('async function monthPreviewChecks'), SOURCE.indexOf('async function playUntilTrustWarning'));
    expect(body).toContain("press(page, '.tt-due')");
    expect(body).toContain('podgląd końca miesiąca (cztery zakładki)');
    expect(body).toContain('checkWidth(page, `${name}: ${net}`)');
    expect(body).toContain('checkWidth(page, `${name}: #${n}`)');
    expect(body).toContain("'.tt-preview .tt-modal-foot .tt-btn'");   // okno się zamyka
    expect(body).toContain("state: 'detached'");
  });

  it('plan 4a.2 (poprawki końcowe): dni budowy, liczba własnych pinezek i miesięczny limit z gry, angielski sprawdzany tekstem, a nie długością', () => {
    expect(SOURCE).not.toMatch(/\^2\\s\+dni\$/);
    expect(SOURCE).not.toMatch(/\^za 2 dni\$/);
    expect(SOURCE).not.toContain('readyDay - g2.day === 2');
    expect(SOURCE).toContain('b.readyDay - g2.day === RELET_BUILD_DAYS');
    expect(SOURCE).toContain('daysText(RELET_BUILD_DAYS)');
    expect(SOURCE).not.toContain('pins.own === 2');
    expect(SOURCE).toContain('pins.own === openStores');
    expect(SOURCE).toContain('card.relet !== reletBlockText(fit)');
    expect(SOURCE).toContain('free.lock !== LIMIT_TEXT');
    expect(SOURCE).toMatch(/playUntilTrustWarning\(page, ev, \{ stop, prefix, phone, maxMonths = 12 \}\)/);
  });
});

describe('plan 4a.2 (Zadanie 13): przełącznik --bench', () => {
  it('parseArgs: --bench włącza sam bieg benchmarku, łączy się z --only, a USAGE go opisuje', () => {
    expect(parseArgs(['--bench'])).toEqual({ only: null, help: false, bench: true, stage: null });
    expect(parseArgs(['--bench', '--only', 'desktop'])).toEqual({ only: 'desktop', help: false, bench: true, stage: null });
    expect(parseArgs(['--only', 'phone', '--bench'])).toEqual({ only: 'telefon', help: false, bench: true, stage: null });
    expect(USAGE).toMatch(/--bench/);
    expect(USAGE).toContain('bench=1&quick=1');
  });

  it('bieg to ten sam adres, który właściciel otwiera na produkcji, tylko z quick=1', () => {
    expect(BENCH_PATH).toBe('/?bench=1&quick=1');
  });

  it('rozmiar „telefon” w biegu --bench dostaje User-Agent telefonu (inaczej profil „telefon” w ogóle by się nie sprawdził), komputer nie', () => {
    expect(BENCH_MOBILE_UA).toMatch(/Android.*Mobile/);
    const body = SOURCE.slice(SOURCE.indexOf('async function benchPass'), SOURCE.indexOf('async function main'));
    expect(body).toContain('{ ...contextOptions(vp), ...(vp.mobile ? { userAgent: BENCH_MOBILE_UA } : {}) }');
    // ten sam wzorzec co `detectDeviceCaps` (src/render/quality.ts)
    expect(/Android|iPhone|iPad|iPod|Mobi/i.test(BENCH_MOBILE_UA)).toBe(true);
  });

  it('źródło: --bench używa tego samego vite preview, tej samej blokady sieci i locale z contextOptions co kroki 1–12', () => {
    const body = SOURCE.slice(SOURCE.indexOf('async function benchPass'), SOURCE.indexOf('async function main'));
    expect(body).toContain('await startPreview(port)');
    expect(body).toContain('contextOptions(vp)');
    expect(body).toContain('await guardNetwork(ctx, port,');
    expect(contextOptions(VIEWPORTS[0]!).locale).toBe('pl-PL');
    expect(contextOptions(VIEWPORTS[1]!).locale).toBe('pl-PL');
    // kroki 1–12 idą przez to samo `guardNetwork` (jedna blokada, nie dwie kopie)
    const newPage = SOURCE.slice(SOURCE.indexOf('async function newPage'), SOURCE.indexOf('const shot = async'));
    expect(newPage).toContain('await guardNetwork(ctx, port,');
    expect(newPage).not.toContain("ctx.route(");
    // main rozgałęzia się na bench po przygotowaniu katalogu wyjściowego, przed odczytem fixtures
    expect(SOURCE).toMatch(/if \(args\.bench\) return runBench\(\{ args, chromium, executablePath, port, base, out \}\);/);
    expect(SOURCE.indexOf('if (args.bench) return runBench')).toBeLessThan(SOURCE.indexOf('const old = fixtureSave(FIXTURES.stary)'));
  });

  it('źródło: zapytanie do /api/** albo poza localhost w biegu --bench to porażka (przerwanie nie jest „zabezpieczeniem, które zadziałało”)', () => {
    const body = SOURCE.slice(SOURCE.indexOf('async function benchPass'), SOURCE.indexOf('async function main'));
    expect(body).toContain('sink.apiBlocked.length > 0');
    expect(body).toContain('sink.external.length > 0');
    expect(body).toContain('apiFailures.length === 0');
    expect(body).toContain('przerwane zapytania do /api/**');
  });
});

describe('guardNetwork: wspólna blokada sieci smoke\'a', () => {
  type Handler = (route: { request(): { url(): string; method(): string }; continue(): string; abort(): string }) => string;
  function fakeContext() {
    const routes: { pattern: string; handler: Handler }[] = [];
    return { routes, route: (pattern: string, handler: Handler) => { routes.push({ pattern, handler }); return Promise.resolve(); } };
  }
  const request = (url: string, method = 'GET') => ({ request: () => ({ url: () => url, method: () => method }), continue: () => 'continue', abort: () => 'abort' });

  it('dwie trasy w tej kolejności (ogólna, potem /api/**, bo późniejsza ma pierwszeństwo): localhost przechodzi, reszta jest przerwana i policzona', async () => {
    const ctx = fakeContext();
    const sink = { external: [] as string[], apiBlocked: [] as string[] };
    await guardNetwork(ctx, 4318, 'telefon/bench', sink);
    expect(ctx.routes.map((r) => r.pattern)).toEqual(['**/*', '**/api/**']);
    const [general, api] = ctx.routes.map((r) => r.handler);
    expect(general!(request('http://localhost:4318/assets/a.js'))).toBe('continue');
    expect(general!(request('http://example.com/x'))).toBe('abort');
    expect(sink.external).toEqual(['http://example.com/x']);
    expect(api!(request('http://localhost:4318/api/runs', 'POST'))).toBe('abort');
    expect(sink.apiBlocked).toEqual(['telefon/bench: POST /api/runs']);
  });

  it('/api bez ukośnika nie łapie trasa /api/**, ale ogólna go odrzuca i liczy jako zapytanie spoza localhost', async () => {
    const ctx = fakeContext();
    const sink = { external: [] as string[], apiBlocked: [] as string[] };
    await guardNetwork(ctx, 4318, 'x', sink);
    expect(ctx.routes[0]!.handler(request('http://localhost:4318/api'))).toBe('abort');
    expect(sink.external).toEqual(['http://localhost:4318/api']);
  });
});

describe('benchProblems: ważność biegu z miastem', () => {
  const shop = () => ['niska', 'srednia', 'wysoka'].map((preset) => ({ preset, avgFps: 5, p95FrameMs: 250, calls: 20, tris: 1000 }));
  type Facts = Record<string, unknown>;
  interface CityRow { preset: string; layer: string; frames: number; calls: number; stats: Facts | null; profile: Facts | null }
  const profile = (patch: Facts = {}): Facts => ({ mockup: true, defaultLayer: 'ruch', cars: false, shadows: 'off', firstDetail: 'prosty', releaseOnExit: true, ...patch });
  const stats = (patch: Facts = {}): Facts => ({ shown: true, built: true, detail: 'pelny', layer: 'makieta', cars: 0, drawCalls: 13, shadowCasters: 0, ...patch });
  /** Czterowierszowy bieg zgodny z profilami z `CITY_PROFILES` (komputer): Niska bez aut i cieni, Średnia i Wysoka z autami i cieniami. */
  const city = (): CityRow[] => [
    { preset: 'niska', layer: 'makieta', frames: 6, calls: 30, stats: stats(), profile: profile() },
    { preset: 'niska', layer: 'ruch', frames: 6, calls: 12, stats: stats({ layer: 'ruch', detail: 'prosty', drawCalls: 11 }), profile: profile() },
    { preset: 'srednia', layer: 'makieta', frames: 6, calls: 60, stats: stats({ cars: 50, shadowCasters: 10 }), profile: profile({ cars: true, shadows: 'static', firstDetail: 'pelny' }) },
    { preset: 'wysoka', layer: 'makieta', frames: 6, calls: 90, stats: stats({ cars: 50, shadowCasters: 10 }), profile: profile({ cars: true, shadows: 'static', firstDetail: 'pelny' }) },
  ];
  const extra = (c: unknown[] = city()) => ({ city: c, warnings: [] });

  it('stałe zgadzają się z planem: cztery wiersze miasta w kolejności biegu, calls < 150, budżet makiety 150 i warstw 60, wynik sklepu o pięciu polach', () => {
    expect(BENCH_CITY_ORDER).toEqual([['niska', 'makieta'], ['niska', 'ruch'], ['srednia', 'makieta'], ['wysoka', 'makieta']]);
    expect(BENCH_CALLS_LIMIT).toBe(150);
    expect(CITY_BUDGET).toMatchObject({ makieta: 150, ruch: 60, dzielnice: 60 });
    expect(BENCH_SHOP_KEYS).toEqual(['avgFps', 'calls', 'p95FrameMs', 'preset', 'tris']);
  });

  it('poprawny bieg: brak wad', () => {
    expect(benchProblems(shop(), extra())).toEqual([]);
  });

  it('brak wyniku albo dodatków to wada, nie wyjątek', () => {
    expect(benchProblems(undefined, extra())).toEqual(['brak window.__benchResult']);
    expect(benchProblems(shop(), undefined)).toEqual(['brak window.__benchExtra']);
  });

  it('__benchResult musi mieć stary kształt: trzy presety i pięć pól (nowe pole w wierszu sklepu to wada)', () => {
    const wide = shop().map((r) => ({ ...r, city: [] }));
    expect(benchProblems(wide, extra())[0]).toMatch(/__benchResult\[niska\]: pola avgFps,calls,city,p95FrameMs,preset,tris/);
    expect(benchProblems(shop().slice(0, 2), extra())[0]).toMatch(/__benchResult: wiersze 2/);
  });

  it('cztery wiersze w kolejności: brakujący albo przestawiony wiersz miasta to wada', () => {
    expect(benchProblems(shop(), extra(city().slice(0, 3)))[0]).toMatch(/__benchExtra\.city: wiersze „niska\/makieta niska\/ruch srednia\/makieta”/);
    expect(benchProblems(shop(), extra([...city()].reverse()))[0]).toMatch(/__benchExtra\.city/);
  });

  it('calls ≥ 150 i brak klatek to wady wiersza', () => {
    const c = city();
    c[2]!.calls = 150;
    c[0]!.frames = 0;
    const p = benchProblems(shop(), extra(c));
    expect(p).toContain('srednia/makieta: calls 150 (limit 150)');
    expect(p).toContain('niska/makieta: brak klatek w pomiarze');
  });

  it('wiersz zmierzony pod złym profilem to wada: Średnia bez aut, Niska z autami albo cieniami, zła geometria „ruchu”', () => {
    const noCars = city();
    noCars[2]!.stats = stats({ cars: 0, shadowCasters: 10 });
    expect(benchProblems(shop(), extra(noCars))).toEqual(['srednia/makieta: auta 0, a profil je daje']);

    const leftover = city();
    leftover[0]!.stats = stats({ cars: 40, shadowCasters: 10 });   // profil Średniej zostawiony na Niskiej
    expect(benchProblems(shop(), extra(leftover))).toEqual([
      'niska/makieta: auta 40, a profil ich nie daje',
      'niska/makieta: rzucających cień 10, a profil nie daje cieni',
    ]);

    const full = city();
    full[1]!.stats = stats({ layer: 'ruch', detail: 'pelny' });   // „ruch” na pełnej geometrii z makiety, nie na prostej z profilu
    expect(benchProblems(shop(), extra(full))).toEqual(['niska/ruch: geometria pelny, oczekiwana prosty']);
  });

  it('profil bez cieni statycznych: brak rzucających cień jest poprawny także w makiecie (zmiana CITY_PROFILES nie psuje smoke\'a)', () => {
    const c = city();
    c[2]!.profile = profile({ cars: true, shadows: 'off', firstDetail: 'pelny' });
    c[2]!.stats = stats({ cars: 50, shadowCasters: 0 });
    expect(benchProblems(shop(), extra(c))).toEqual([]);
  });

  it('urządzenie mobilne: wszystkie wiersze muszą mieć ten sam profil „telefon”, także Średnia i Wysoka; na komputerze profile różnią się wg presetu', () => {
    expect(benchProblems(shop(), { city: city(), env: { isMobile: false } })).toEqual([]);
    expect(benchProblems(shop(), { city: city(), env: { isMobile: true } })).toEqual([
      'urządzenie mobilne: wiersze miasta nie mają jednego profilu „telefon” (telefon ma wygrywać z presetem)',
    ]);
    const phone = city().map((r) => ({ ...r, profile: profile(), stats: { ...r.stats, cars: 0, shadowCasters: 0 } }));
    expect(benchProblems(shop(), { city: phone, env: { isMobile: true } })).toEqual([]);
  });

  it('profil bez makiety (szczebel drabiny „telefon: mockup: false”): wiersz „makieta” rysuje „Ruch” na prostej geometrii i to jest poprawne', () => {
    const phone = (preset: string, layer: string): CityRow => ({
      preset, layer, frames: 6, calls: 15,
      stats: stats({ layer: 'ruch', detail: 'prosty', drawCalls: 11 }), profile: profile({ mockup: false }),
    });
    const rows = [phone('niska', 'makieta'), phone('niska', 'ruch'), phone('srednia', 'makieta'), phone('wysoka', 'makieta')];
    expect(benchProblems(shop(), { city: rows, env: { isMobile: true } })).toEqual([]);
    // widok narysowany ma być zgodny z profilem: makieta mimo `mockup: false` to wada sceny
    const stillMockup = rows.map((r, i) => (i === 0 ? { ...r, stats: stats({ layer: 'makieta' }) } : r));
    expect(benchProblems(shop(), { city: stillMockup, env: { isMobile: true } })).toEqual([
      'niska/makieta: scena rysowała widok makieta, oczekiwany ruch (profil bez makiety)',
      'niska/makieta: geometria pelny, oczekiwana prosty',
    ]);
  });

  it('budżet i auta liczą się dla widoku faktycznie narysowanego: „makieta” rysowana jako „ruch” ma budżet 60, a auta tylko w makiecie', () => {
    const c = city();
    c[2]!.profile = profile({ mockup: false, cars: true, shadows: 'static', firstDetail: 'pelny' });
    c[2]!.stats = stats({ layer: 'ruch', detail: 'pelny', drawCalls: 61, cars: 0, shadowCasters: 0 });
    expect(benchProblems(shop(), extra(c))).toEqual(['srednia/makieta: scena 61 + 0 wywołań (budżet 60)']);
    c[2]!.stats = stats({ layer: 'ruch', detail: 'pelny', drawCalls: 11, cars: 0, shadowCasters: 0 });
    expect(benchProblems(shop(), extra(c))).toEqual([]);
  });

  it('geometrię „Ruchu” sprawdza się tylko tam, gdzie scena budowała ją od nowa (profil zwalnia scenę przy wyjściu); zostawione miasto może mieć inną', () => {
    const c = city();
    c[1]!.profile = profile({ releaseOnExit: false, firstDetail: 'pelny' });
    c[1]!.stats = stats({ layer: 'ruch', detail: 'prosty', drawCalls: 11 });
    expect(benchProblems(shop(), extra(c))).toEqual([]);
    c[1]!.profile = profile({ releaseOnExit: true, firstDetail: 'pelny' });
    expect(benchProblems(shop(), extra(c))).toEqual(['niska/ruch: geometria prosty, oczekiwana pelny']);
  });

  it('środowisko: jeśli rozmiar okna mówi „telefon”, a przeglądarka podaje komputer (zepsuty User-Agent), bieg jest nieważny', () => {
    expect(benchProblems(shop(), { city: city(), env: { isMobile: false } }, { mobile: false })).toEqual([]);
    expect(benchProblems(shop(), { city: city(), env: { isMobile: false } }, { mobile: true })).toEqual([
      'środowisko: isMobile false, a rozmiar okna to telefon (User-Agent nie zadziałał, miasto dostało profil komputera)',
    ]);
    const uniform = city().map((r) => ({ ...r, profile: profile(), stats: { ...r.stats, cars: 0, shadowCasters: 0 } }));   // jeden profil „telefon” w każdym wierszu
    expect(benchProblems(shop(), { city: uniform, env: { isMobile: true } }, { mobile: false })).toEqual([
      'środowisko: isMobile true, a rozmiar okna to komputer',
    ]);
  });

  it('brak migawki sceny, nie pokazane miasto, zły widok i budżet sceny to wady', () => {
    const c = city();
    c[3]!.stats = null;
    expect(benchProblems(shop(), extra(c))).toEqual(['wysoka/makieta: brak migawki sceny (stats/profile)']);

    const hidden = city();
    hidden[0]!.stats = stats({ shown: false });
    expect(benchProblems(shop(), extra(hidden))).toEqual(['niska/makieta: miasto nie było pokazane (shown false, built true)']);

    const wrongLayer = city();
    wrongLayer[0]!.stats = stats({ layer: 'ruch' });
    expect(benchProblems(shop(), extra(wrongLayer))).toEqual(['niska/makieta: scena rysowała widok ruch, oczekiwany makieta']);

    const heavy = city();
    heavy[1]!.stats = stats({ layer: 'ruch', detail: 'prosty', drawCalls: 61 });
    expect(benchProblems(shop(), extra(heavy))).toEqual(['niska/ruch: scena 61 + 0 wywołań (budżet 60)']);
  });

  it('benchTableLines: wiersze sklepu i miasta z geometrią, autami i cieniami (do konsoli i raportu)', () => {
    const lines = benchTableLines(shop(), extra());
    expect(lines).toHaveLength(1 + 3 + 4);
    expect(lines[0]).toMatch(/wiersz\s+FPS\s+p95 ms\s+calls\s+geom\.\s+auta\s+cienie/);
    expect(lines[4]).toMatch(/^niska makieta\s+.*pelny\s+0\s+0$/);
    expect(lines[7]).toMatch(/^wysoka makieta\s+.*pelny\s+50\s+10$/);
  });

  it('benchTableLines: wiersz „makieta” narysowany jako „ruch” ma to w etykiecie', () => {
    const c = city();
    c[0]!.stats = stats({ layer: 'ruch', detail: 'prosty' });
    expect(benchTableLines(shop(), extra(c))[4]).toMatch(/^niska makieta→ruch\s/);
  });
});

describe('karta benchmarku na telefonie (Zadanie 13, poprawka 1)', () => {
  const m = (patch = {}) => ({
    viewport: 390, hit: true, hitTag: 'DIV',
    card: { left: 12, right: 378, scroll: 520, client: 366 },
    columns: [{ name: 'Miasto', left: 22, right: 219 }, { name: 'FPS', left: 219, right: 265 }, { name: 'p95 ms', left: 265, right: 311 }, { name: 'Wywołania', left: 311, right: 357 }, { name: 'maks ms', left: 357, right: 403 }],
    ...patch,
  });

  it('kolumny bramki to FPS, p95 ms i Wywołania', () => {
    expect([...BENCH_GATE_COLUMNS]).toEqual(['FPS', 'p95 ms', 'Wywołania']);
  });

  it('karta, która dostaje zdarzenia i ma trzy kolumny bramki w widocznym obszarze, jest w porządku (reszta może się przewijać)', () => {
    expect(overlayProblems(m())).toEqual([]);
  });

  it('karta zasłonięta płótnem (`pointer-events: none` odziedziczone z `.tt-ui`) to wada: właściciel nie przewinie tabeli', () => {
    expect(overlayProblems(m({ hit: false, hitTag: 'CANVAS' }))).toEqual(['karta nie dostaje zdarzeń wskaźnika (w jej środku leży CANVAS)']);
  });

  it('kolumna bramki poza widoczną częścią karty albo poza oknem to wada, kolumna „maks ms” poza kartą nie', () => {
    const wide = m({ columns: [{ name: 'FPS', left: 219, right: 265 }, { name: 'p95 ms', left: 265, right: 311 }, { name: 'Wywołania', left: 311, right: 420 }] });
    expect(overlayProblems(wide)).toEqual(['kolumna „Wywołania” wystaje poza widoczną część karty (311–420 px, karta 12–378 px, okno 390 px)']);
    const left = m({ columns: [{ name: 'FPS', left: 2, right: 40 }, { name: 'p95 ms', left: 265, right: 311 }, { name: 'Wywołania', left: 311, right: 357 }] });
    expect(overlayProblems(left)[0]).toMatch(/kolumna „FPS”/);
  });

  it('brak karty, brak tabeli „Miasto” i brak kolumny to wady z nazwą', () => {
    expect(overlayProblems({ card: null })).toEqual(['brak karty benchmarku (.tt-bench)']);
    expect(overlayProblems(m({ columns: [] }))).toEqual(['brak tabeli „Miasto” w karcie']);
    expect(overlayProblems(m({ columns: [{ name: 'FPS', left: 219, right: 265 }, { name: 'p95 ms', left: 265, right: 311 }] }))).toEqual(['brak kolumny „Wywołania” w tabeli „Miasto”']);
  });

  it('karta wystająca poza okno (na telefonie) to wada', () => {
    expect(overlayProblems(m({ card: { left: 12, right: 392, scroll: 520, client: 380 } }))[0]).toMatch(/karta wystaje poza okno/);
  });

  it('źródło: rozmiar „telefon” i komputer mierzą kartę po końcu biegu, po wyrenderowaniu czterech wierszy miasta', () => {
    const body = SOURCE.slice(SOURCE.indexOf('async function benchPass'), SOURCE.indexOf('async function main'));
    expect(body).toContain('overlayProblems(');
    expect(body).toContain('elementFromPoint');
    expect(body).toContain('benchProblems(result, extra, { mobile: vp.mobile })');
    expect(body).toContain('tbody tr');
  });
});

describe('katalog wyjściowy `--bench` (osobny od pełnego smoke\'a)', () => {
  it('bench pisze do .smoke/city-bench, pełny smoke do .smoke/city, a CITY_SMOKE_OUT wygrywa w obu', () => {
    expect(outDirFor(false, {})).toMatch(/\.smoke[\\/]city$/);
    expect(outDirFor(true, {})).toMatch(/\.smoke[\\/]city-bench$/);
    expect(outDirFor(true, { CITY_SMOKE_OUT: '/x/y' })).toBe('/x/y');
    expect(outDirFor(false, { CITY_SMOKE_OUT: '/x/y' })).toBe('/x/y');
    expect(SOURCE).toContain('const out = outDirFor(args.bench);');
  });
});

describe('plan 4b (Zadanie 10): kroki 4b-a…4b-g i koperty zapisów', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Wstawia kopertę `text` (seed z koperty) jak skrypt i wczytuje sesję zwykłej gry. */
  const loadText = (text: string): GameSession => {
    const seed = JSON.parse(text).seed as string;
    for (const [k, v] of Object.entries(storageEntries({ seed, saveText: text, tips: false, now: Date.now() }))) storage.setItem(k, v);
    return createSession(seed);
  };

  it('siedem kroków 4b na obu rozmiarach, komputer 1440×900', () => {
    expect(STEPS_4B.map((s) => s.id)).toEqual(['4b-a', '4b-b', '4b-c', '4b-d', '4b-e', '4b-f', '4b-g']);
    for (const s of STEPS_4B) {
      expect(s.sizes).toEqual(['telefon', 'desktop']);
      expect(s.name.length).toBeGreaterThan(10);
    }
    expect(DESKTOP_4B).toEqual({ width: 1440, height: 900 });
  });

  it('stałe kroków są liczbami i tekstami gry: cena „Wspólnych dostaw”, próg miliona, tytuł okna i komunikat Galerii', () => {
    expect(RESEARCH_DOSTAWY_COST).toBe(researchCost(RESEARCH_BY_ID.dostawy, 0));
    expect(WALLET_4B_MILLION).toBeLessThan(FAME_CASH);
    expect(FAME_CASH - WALLET_4B_MILLION).toBe(500);
    expect(FAME_TITLE).toBe('Milion!');
    expect(SOURCE_FAME).toContain(`{t\`${FAME_TITLE}\`}`);
    expect(FAME_CLOSED_TEXT.startsWith(FAME_CLOSED)).toBe(true);
    expect(FAME_LIST_CLOSED_TEXT.startsWith(FAME_CLOSED)).toBe(true);
  });

  it('withRemont: zapis schematu 3 „dwa sklepy” z remontem 5 i poziomem 34 wczytuje się bez komunikatu, z migracją firmy do schematu 4', () => {
    const two = fixtureSave(FIXTURES.dwaSklepy);
    expect(JSON.parse(two.text)).toMatchObject({ schema: 3 });
    const s = loadText(withRemont(two.text, { storeId: 2, remontLevel: 5, level: 34 }));
    expect(s.fromSave).toBe(true);
    expect(s.loadNotice).toBeNull();
    const f = firmOf(s);
    const st = f.stores.find((x) => x.id === 2)!;
    expect([f.activeId, st.econ.remontLevel, st.econ.level, st.closed]).toEqual([2, 5, 34, false]);
    const spec = lotById(f.city, st.lotId).spec;
    expect(st.layout.width).toBe(layoutFor(st.econ.seed, 5, spec).width);   // układ z poziomu remontu z zapisu
    expect(st.layout.width).toBeGreaterThanOrEqual(layoutFor(st.econ.seed, 3, spec).width);
    expect([f.research, f.storeLimit, f.fame, f.builds.length]).toEqual([{}, 3, null, 1]);
    expect(storage.keys().filter((k) => k.includes(':broken'))).toEqual([]);
    expect(() => withRemont(two.text, { storeId: 1, remontLevel: 5, level: 34 })).toThrow(/otwartego sklepu #1/);   // #1 w tym zapisie jest zamknięty
  });

  it('deckIds czyta z deck.ts dokładnie identyfikatory talii dnia, a każda karta ma przerwę ≥ 2 dni (na tym stoi withOnlyCardTomorrow)', () => {
    const ids = deckIds(readFileSync(resolve(ROOT, 'src/sim/economy/tycoon/deck.ts'), 'utf8'));
    expect(ids).toEqual(DECK.map((d) => d.id));
    expect(ids).toContain('karty-zrzut');
    expect(Math.min(...DECK.map((d) => d.cooldown))).toBeGreaterThanOrEqual(2);
  });

  it('withOnlyCardTomorrow: w zapisie „po Traszce” z remontem 4 sklep startowy dostaje jutro o 6:00 tylko „Zrzut Traszkomonów”', () => {
    const after = fixtureSave(FIXTURES.poTraszce);
    const ids = deckIds(readFileSync(resolve(ROOT, 'src/sim/economy/tycoon/deck.ts'), 'utf8'));
    const text = withOnlyCardTomorrow(withRemont(after.text, { storeId: 1, remontLevel: 4, level: 28 }), { storeId: 1, cardId: 'karty-zrzut', ids });
    const s = loadText(text);
    expect(s.loadNotice).toBeNull();
    const f = firmOf(s);
    const st = activeStore(f);
    expect([st.id, st.econ.remontLevel, st.econ.level]).toEqual([1, 4, 28]);
    const end = (Math.floor(st.econ.minute / DAY) + 1) * DAY + 6 * 60;
    while (activeStore(f).econ.minute < end && !awaitingDecision(activeStore(f).econ)) stepFirmMinute(f, emptyStepOut());
    const shown = visibleCards(activeStore(f).econ.tycoon.cards, activeStore(f).econ.minute);
    expect(shown.map((c) => c.id)).toEqual(['karty-zrzut']);
    expect(activeStore(f).econ.minute % DAY).toBe(6 * 60);
    expect(() => withOnlyCardTomorrow(after.text, { storeId: 1, cardId: 'nie-ma-takiej', ids })).toThrow(/nie ma w talii/);
  });

  it('isApiUrl: tylko /api/… na localhost i porcie smoke\'a (komunikat Chromium o przerwanym zapytaniu nie jest błędem gry)', () => {
    expect(isApiUrl('http://localhost:4318/api/fame/submit', 4318)).toBe(true);
    expect(isApiUrl('http://localhost:4318/api/leaderboard?x=1', '4318')).toBe(true);
    expect(isApiUrl('http://localhost:4319/api/fame/list', 4318)).toBe(false);
    expect(isApiUrl('http://localhost:4318/assets/index.js', 4318)).toBe(false);
    expect(isApiUrl('https://traszka.example/api/fame/list', 4318)).toBe(false);
    expect(isApiUrl('nie adres', 4318)).toBe(false);
    expect(SOURCE).toMatch(/Failed to load resource: net::ERR_FAILED\$\/\.test\(m\.text\(\)\) && isApiUrl\(/);
  });

  it('pętla zamykania okien zamyka też gratulacje za milion („Zamknij”): stary zapis z gotówką ≥ 1 mln dostaje je zaraz po wczytaniu', () => {
    expect(SOURCE).toMatch(/cls\.contains\('tt-fame'\) \? 'fame'/);
    expect(SOURCE).toContain("fame: '.tt-fame .tt-finish-actions > .tt-btn:last-child'");
    expect(SOURCE_FAME).toMatch(/<button type="button" class="tt-btn" onClick=\{onClose\}>\{t`Zamknij`\}<\/button>\s*<\/div>/);
    expect(JSON.parse(fixtureSave(FIXTURES.stary).text).econ?.cash ?? 0).toBeGreaterThanOrEqual(FAME_CASH);
  });

  it('źródło: kroki 4b przerywają /api/** jak cały smoke, a atrapę /api/fame/* stawiają w przeglądarce po sprawdzeniu „nieczynnej” Galerii', () => {
    const at = (needle: string): number => SOURCE.indexOf(needle);
    expect(at("ctx.route('**/api/fame/**'")).toBeGreaterThan(at('4b-05-galeria'));
    expect(SOURCE).toMatch(/route\.fulfill\(\{ json: \{ ok: true, first: true/);
    expect(SOURCE).not.toMatch(/traszka\.vercel\.app/);
  });
});

describe('krok f (plan 4b, Zadanie 11): kolejka przed sklepem przy zrzucie Traszkomonów', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage); });
  afterEach(() => vi.unstubAllGlobals());

  it('krok f jest osobnym przebiegiem tylko na komputerze, poza dwunastoma krokami i przebiegiem z dymkami', () => {
    expect(QUEUE_STEP.id).toBe('f');
    expect(QUEUE_STEP.sizes).toEqual(['desktop']);
    expect(QUEUE_STEP.name.length).toBeGreaterThan(10);
    expect(STEPS.map((s) => s.id)).not.toContain('f');
    const s = summarize({ desktop: { ...Object.fromEntries(STEPS.filter((x) => x.sizes.includes('desktop')).map((x) => [x.id, stepResult()])), f: stepResult() } }, [...STEPS, QUEUE_STEP]);
    expect(s.rows.at(-1)).toMatchObject({ size: 'desktop', step: 'f', status: 'ok' });
    expect(summarize({ desktop: {} }, [QUEUE_STEP]).rows[0]).toMatchObject({ step: 'f', status: 'FAIL' });   // krok, który się nie wykonał, to porażka
  });

  it('saveWithCardDrop: dopisuje efekt ruchu +1,6 od 6:00 następnej doby do 10:00, reszta koperty bez zmian, wejściowy tekst nietknięty', () => {
    const fixture = fixtureSave(FIXTURES.przedStatusem);
    const before = JSON.parse(fixture.text);
    const drop = saveWithCardDrop(fixture.text);
    const econ0 = before.stores[0].econ;
    expect(drop.day).toBe(Math.floor(econ0.minute / 1440) + 1);
    expect(drop.from).toBe(drop.day * 1440 + 360);
    expect(drop.until).toBe(drop.from + 240);
    const after = JSON.parse(drop.text);
    const cards = after.stores[0].econ.tycoon.cards;
    expect(cards.active).toEqual([...econ0.tycoon.cards.active, { kind: 'traffic', value: 1.6, from: drop.from, until: drop.until, seq: econ0.tycoon.cards.seq }]);
    after.stores[0].econ.tycoon.cards.active = econ0.tycoon.cards.active;
    expect(after).toEqual(before);
    expect(JSON.parse(fixture.text)).toEqual(before);
    expect(saveWithCardDrop(fixture.text, { value: 0.9, hours: 6 })).toMatchObject({ until: drop.from + 360 });
  });

  it('gra wczytuje taki zapis zwykłą drogą: efekt przeżywa sanitizeCards i daje ruch 2,6 od 6:00 do 10:00 (kolejka 12), a przed i po niego nie ma', () => {
    const fixture = fixtureSave(FIXTURES.przedStatusem);
    const drop = saveWithCardDrop(fixture.text);
    for (const [k, v] of Object.entries(storageEntries({ seed: fixture.seed, saveText: drop.text, tips: false, now: Date.now() }))) storage.setItem(k, v);
    const s = createSession(fixture.seed);
    const at = (minute: number): number => cardModifiers(s.econ.tycoon.cards, minute).traffic;
    expect(s.econ.tycoon.cards.active.filter((m) => m.kind === 'traffic' && m.from === drop.from)).toHaveLength(1);
    expect(at(drop.from - 1)).toBe(1);
    expect(at(drop.from + 90)).toBeCloseTo(2.6, 12);
    expect(queueSizeFor(at(drop.from + 90), 7 * 60 + 30)).toBe(12);
    expect(at(drop.until)).toBe(1);
    expect(queueSizeFor(at(drop.until), 10 * 60)).toBe(0);
  });
});

describe('plan 4a.2 (Zadanie 15): kroki makiety 13–15', () => {
  const BODY = (from: string, to: string): string => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to));

  it('--etap makieta biegnie same kroki 13–15 (13 komputer, 14 telefon, 15 oba), a wartości --etap to 4b i makieta', () => {
    expect(STEPS_MAKIETA.map((s) => s.id)).toEqual([13, 14, 15]);
    expect(STEPS_MAKIETA.map((s) => [...s.sizes])).toEqual([['desktop'], ['telefon'], ['telefon', 'desktop']]);
    for (const step of STEPS_MAKIETA) expect(STEPS).toContain(step);
    expect([...STAGES]).toEqual(['4b', 'makieta']);
    // tabela wyników z samych kroków makiety: komputer 13 + 15, telefon 14 + 15
    const results: Record<string, Record<string, StepResult>> = { telefon: { 14: stepResult(), 15: stepResult() }, desktop: { 13: stepResult(), 15: stepResult() } };
    const s = summarize(results, STEPS_MAKIETA);
    expect(s.ok).toBe(true);
    expect(s.rows.map((r) => `${r.size}/${r.step}`)).toEqual(['telefon/14', 'telefon/15', 'desktop/13', 'desktop/15']);
    delete results.desktop![15];
    expect(summarize(results, STEPS_MAKIETA).rows.find((r) => r.size === 'desktop' && r.step === 15)).toMatchObject({ status: 'FAIL', detail: 'krok się nie wykonał' });   // krok 15 bez wyniku biegu to porażka
  });

  it('layerBarProblems: trzy przyciski w kolejności Makieta / Ruch / Dzielnice (Model / Footfall / Districts) i dokładnie jeden wciśnięty', () => {
    expect([...LAYER_LABELS.pl]).toEqual(['Makieta', 'Ruch', 'Dzielnice']);
    expect([...LAYER_LABELS.en]).toEqual(['Model', 'Footfall', 'Districts']);
    const bar = (lang: 'pl' | 'en', on: number) => LAYER_LABELS[lang].map((text, i) => ({ text, pressed: i === on }));
    for (const [i, name] of LAYER_LABELS.pl.entries()) expect(layerBarProblems(bar('pl', i), name)).toEqual([]);
    for (const [i, name] of LAYER_LABELS.en.entries()) expect(layerBarProblems(bar('en', i), name, 'en')).toEqual([]);
    expect(layerBarProblems(bar('pl', 1), 'Makieta')[0]).toMatch(/oczekiwany „Makieta”/);                     // wciśnięty inny przycisk
    expect(layerBarProblems(bar('pl', 0).map((b) => ({ ...b, pressed: false })), 'Makieta')[0]).toMatch(/żaden/);
    expect(layerBarProblems(bar('pl', 0).map((b) => ({ ...b, pressed: true })), 'Makieta')[0]).toMatch(/wciśnięte: Makieta, Ruch, Dzielnice/);
    expect(layerBarProblems(bar('pl', 1).slice(1), 'Ruch')[0]).toMatch(/przyciski „Ruch \/ Dzielnice”/);        // bez „Makiety” (profil bez makiety) to wada tego kroku
    expect(layerBarProblems(bar('pl', 0), 'Makieta', 'en')[0]).toMatch(/oczekiwane „Model \/ Footfall \/ Districts”/);   // polski interfejs tam, gdzie ma być angielski
  });

  it('napisy przycisków to teksty gry: „Makieta”, „Ruch”, „Dzielnice” i angielskie „Model”, „Footfall”, „Districts”', () => {
    const city = readFileSync(resolve(ROOT, 'src/i18n/en/ui/city.ts'), 'utf8');
    expect(city).toContain("'Makieta': 'Model'");
    expect(city).toContain("'Ruch': 'Footfall'");
    expect(city).toContain("'Dzielnice': 'Districts'");
    const panel = readFileSync(resolve(ROOT, 'src/ui/city/CityPanel.tsx'), 'utf8');
    for (const label of LAYER_LABELS.pl) expect(panel, label).toContain(`t\`${label}\``);
  });

  it('cityWorld zgadza się z cityToWorld z gry (jednostka sceny i bok miasta), więc zbliżenie staje na wejściu lokalu', () => {
    expect(SMOKE_CITY_M).toBe(GAME_CITY_M);
    expect(SMOKE_CITY_UNIT_M).toBe(GAME_CITY_UNIT_M);
    for (const lot of [{ x: 0, y: 0 }, { x: 330, y: 330 }, { x: 107, y: 593 }, { x: 660, y: 12 }]) {
      const w = cityToWorld(lot.x, lot.y);
      expect(cityWorld(lot).x).toBeCloseTo(w.x, 12);
      expect(cityWorld(lot).z).toBeCloseTo(w.z, 12);
    }
    expect(cityWorld({ x: 330, y: 330 })).toEqual({ x: 0, z: 0 });   // środek miasta w początku układu
  });

  const stats = (patch: Record<string, unknown> = {}) => ({ shown: true, built: true, detail: 'pelny', layer: 'makieta', cars: 63, drawCalls: 13, shadowCasters: 10, ...patch });

  it('cityStatsProblems: makieta z autami w budżecie 150 jest w porządku, a każda wada ma swój komunikat', () => {
    const want = { layer: 'makieta', detail: 'pelny', cars: true };
    expect(cityStatsProblems(stats(), want)).toEqual([]);
    expect(cityStatsProblems(null, want)).toEqual(['brak cityStats()']);
    expect(cityStatsProblems(stats({ cars: 0 }), want)[0]).toMatch(/auta 0, oczekiwane więcej niż 0/);
    expect(cityStatsProblems(stats({ detail: 'prosty' }), want)[0]).toMatch(/geometria prosty, oczekiwana pelny/);
    expect(cityStatsProblems(stats({ layer: 'ruch' }), want)[0]).toMatch(/widok ruch, oczekiwany makieta/);
    expect(cityStatsProblems(stats({ shown: false }), want)[0]).toMatch(/nie jest pokazane/);
    expect(cityStatsProblems(stats({ built: false }), want)[0]).toMatch(/sceny miasta nie ma/);
    // budżet §19: wywołania sceny razem z rzucającymi cień poniżej 150
    expect(cityStatsProblems(stats({ drawCalls: 100, shadowCasters: 49 }), want)).toEqual([]);
    expect(cityStatsProblems(stats({ drawCalls: 100, shadowCasters: 50 }), want)[0]).toMatch(/scena 100 \+ 50 wywołań \(budżet 150 dla makieta\)/);
  });

  it('cityStatsProblems: warstwy bez aut i poniżej 60 wywołań, a telefon bez aut także w makiecie', () => {
    const layer = { layer: 'ruch', detail: 'pelny', cars: false };
    expect(cityStatsProblems(stats({ layer: 'ruch', cars: 0, shadowCasters: 0, drawCalls: 11 }), layer)).toEqual([]);
    expect(cityStatsProblems(stats({ layer: 'dzielnice', cars: 0, shadowCasters: 0, drawCalls: 59 }), { ...layer, layer: 'dzielnice' })).toEqual([]);
    expect(cityStatsProblems(stats({ layer: 'ruch', cars: 0, shadowCasters: 0, drawCalls: 60 }), layer)[0]).toMatch(/budżet 60 dla ruch/);
    expect(cityStatsProblems(stats({ layer: 'ruch', cars: 3, shadowCasters: 0, drawCalls: 11 }), layer)[0]).toMatch(/auta 3, oczekiwane 0/);
    expect(cityStatsProblems(stats({ cars: 0, shadowCasters: 0 }), { layer: 'makieta', detail: 'pelny', cars: false })).toEqual([]);
    expect(CITY_BUDGET).toMatchObject({ makieta: 150, ruch: 60, dzielnice: 60 });
  });

  it('cityStatsProblems: `built: false` to scena zwolniona i miasto niepokazane (wyjście z zakładki na telefonie)', () => {
    const gone = { shown: false, built: false, detail: null, layer: null, cars: 0, drawCalls: 0, shadowCasters: 0 };
    expect(cityStatsProblems(gone, { built: false })).toEqual([]);
    expect(cityStatsProblems(stats(), { built: false })).toEqual(['miasto nadal pokazane (shown true)', 'scena miasta nadal istnieje (built true)']);
    expect(cityStatsProblems({ ...gone, shown: true }, { built: false })).toEqual(['miasto nadal pokazane (shown true)']);
  });

  it('geometryProblems: miasto coś dodaje, spłaszczenie niczego nie przebudowuje, wyjście zwalnia scenę, powrót daje to samo co pierwsze wejście', () => {
    const ok = { before: 120, open: 168, mockup: 171, flat: 171, exited: 120, again: 168 };
    expect(geometryProblems(ok)).toEqual([]);
    expect(geometryProblems({ ...ok, open: 120 })[0]).toMatch(/niczego nie dodało/);
    expect(geometryProblems({ ...ok, flat: 240 })[0]).toMatch(/spłaszczenie przebudowało scenę/);
    expect(geometryProblems({ ...ok, exited: 171 })[0]).toMatch(/nie została zwolniona/);   // scena nie zwolniona po wyjściu (wyciek)
    expect(geometryProblems({ ...ok, again: 339 })[0]).toMatch(/wyciek albo przebudowa/);    // stara plus nowa po powrocie
    expect(geometryProblems({ ...ok, exited: 122 })).toHaveLength(1);                         // bez zapasu każda nadwyżka to wada
    expect(geometryProblems({ ...ok, exited: 122 }, 2)).toEqual([]);                          // z zapasem na rzeczy sklepu powstające w tle
  });

  it('nextWorkdayNoon: południe najbliższego dnia roboczego zgodne z zegarem miasta (`cityClockOf`: dzień 0 to wtorek, weekend to sobota i niedziela)', () => {
    // fixture „po Traszce”: niedziela 6:00 (dzień 187) → poniedziałek 12:00
    const sunday = 187 * DAY + 6 * 60;
    expect(cityClockOf(sunday).weekend).toBe(true);
    expect(nextWorkdayNoon(sunday)).toBe(188 * DAY + 12 * 60);
    expect(cityClockOf(nextWorkdayNoon(sunday))).toEqual({ hour: 12, weekend: false });
    // dzień roboczy przed południem zostaje, po południu przechodzi na następny dzień roboczy, piątek po południu na poniedziałek
    expect(nextWorkdayNoon(0)).toBe(12 * 60);                               // wtorek 0:00
    expect(nextWorkdayNoon(12 * 60)).toBe(12 * 60);                         // dokładnie południe zostaje
    expect(nextWorkdayNoon(12 * 60 + 1)).toBe(DAY + 12 * 60);               // wtorek 12:01 → środa
    expect(nextWorkdayNoon(3 * DAY + 13 * 60)).toBe(6 * DAY + 12 * 60);     // piątek po południu → poniedziałek (dzień 6)
    for (let minute = 0; minute < 21 * DAY; minute += 97) {
      const noon = nextWorkdayNoon(minute);
      expect(noon).toBeGreaterThanOrEqual(minute);
      expect(cityClockOf(noon)).toEqual({ hour: 12, weekend: false });
    }
  });

  it('pinCoversPoint: punkt w ramce pinezki (z zapasem) jest zasłonięty, poza nią nie, brak pinezki to brak zasłonięcia', () => {
    const pin = { l: 100, t: 50, r: 150, b: 90 };
    expect(pinCoversPoint(pin, { x: 120, y: 70 })).toBe(true);
    expect(pinCoversPoint(pin, { x: 100, y: 50 })).toBe(true);     // brzeg ramki
    expect(pinCoversPoint(pin, { x: 154, y: 70 })).toBe(false);
    expect(pinCoversPoint(pin, { x: 154, y: 70 }, 4)).toBe(true);  // zapas 4 px
    expect(pinCoversPoint(pin, { x: 120, y: 95 }, 4)).toBe(false);
    expect(pinCoversPoint(null, { x: 120, y: 70 })).toBe(false);
  });

  it('perfHint podsumowuje licznik F3 w jednym zdaniu notatki', () => {
    expect(perfHint({ fps: 12.34, minFps: 9, maxFps: 15, ms: 83.33, calls: 41, tris: 98_765 })).toBe('12.3 FPS (min 9, max 15), klatka 83 ms, 41 wywołań rysowania, 99 tys. trójkątów');
  });

  it('źródło: krok 13 otwiera grę bez ?q= (preset domyślny), krok 14 z mobilnym User-Agentem, a bez ?q= nie ma parametru w adresie', () => {
    const desktop = BODY('async function scenarioMakieta', 'async function scenarioTelefon');
    const phone = BODY('async function scenarioTelefon', '// ——————— plan 4b, Zadanie 10');
    expect(desktop).toContain("newPage(browser, vp, 'makieta', { fixture: after, quality: null })");
    expect(desktop).toContain("gpu0.preset === 'srednia'");
    expect(phone).toContain("newPage(browser, vp, 'telefon-profil', { fixture: after, quality: null, userAgent: BENCH_MOBILE_UA })");
    expect(phone).toContain("gpu0.preset === 'niska'");
    expect(SOURCE).toContain("${quality ? `&q=${quality}` : ''}");
    expect(SOURCE).toContain('{ ...contextOptions(vp), ...(userAgent ? { userAgent } : {}) }');
    expect(contextOptions(VIEWPORTS[0]!).locale).toBe('pl-PL');   // oba nowe konteksty idą przez `contextOptions`, więc locale pl-PL i blokada sieci jak w krokach 1–12
    expect(BODY('async function newPage', 'const shot = async')).toContain('await guardNetwork(ctx, port,');
  });

  it('źródło: krok 13 sprawdza makietę (pełna geometria, auta, budżet), warstwy bez aut, kadr po powrocie i zbliżenia lokali w czterech obrotach', () => {
    const body = BODY('async function scenarioMakieta', 'async function scenarioTelefon');
    expect(body).toContain("{ layer: 'makieta', detail: 'pelny', cars: true }");
    expect(body).toContain("{ layer: 'ruch', detail: 'pelny', cars: false }");
    expect(body).toContain("{ layer: 'dzielnice', detail: 'pelny', cars: false }");
    expect(body).toContain('nextWorkdayNoon(');
    expect(body).toContain('Math.abs(back.view - open.view) < 0.01');
    expect(body).toContain("closeUps(page, ev, free, 'wolny')");
    expect(body).toContain("closeUps(page, ev, relet, 'po-traszce')");
    expect(BODY('async function closeUps', 'async function scenarioMakieta')).toContain('for (let k = 0; k < 4; k++)');
    expect(BODY('async function closeUps', 'async function scenarioMakieta')).toContain("page.keyboard.press('e')");
  });

  it('źródło: krok 14 sprawdza prostą geometrię na starcie, makietę bez aut, zwolnienie sceny, powrót bez wycieku, trzy przyciski po polsku i angielsku', () => {
    const body = BODY('async function scenarioTelefon', '// ——————— plan 4b, Zadanie 10');
    expect(body).toContain("{ layer: 'ruch', detail: 'prosty', cars: false }");
    expect(body).toContain("{ layer: 'makieta', detail: 'pelny', cars: false }");
    expect(body).toContain("{ built: false }");
    expect(body).toContain('geometryProblems(geo)');
    expect(body).toContain("layerBarProblems(await layerBar(page), 'Footfall', 'en')");
    expect(body).toContain("layerBarProblems(await layerBar(page), 'Model', 'en')");
    expect(body).toContain('layerBarWidth(page,');
    expect(body).toContain('F3');   // FPS warstwy i makiety z licznika wydajności (perfOf włącza F3)
    expect(BODY('async function perfOf', 'async function layerBarWidth')).toContain("press('F3')");
  });

  it('źródło: krok 15 woła ten sam rdzeń `benchPass` co `--bench` (jedna kopia biegu), tylko poza `--etap 4b`, a liczniki sieci biegu trafiają do liczników przebiegu', () => {
    expect(SOURCE.match(/async function benchPass\(/g)).toHaveLength(1);
    expect(SOURCE.match(/window\.__benchResult !== undefined/g)).toHaveLength(1);   // bieg benchmarku jest w kodzie raz
    expect(SOURCE.match(/await benchPass\(\{ browser, args, port, base, out \}\)/g)).toHaveLength(2);   // `runBench` (--bench) i pełny przebieg
    const run = BODY('async function runBench', 'async function main');
    expect(run).toContain('await benchPass({ browser, args, port, base, out })');
    expect(run).toContain('await startPreview(port)');   // `--bench` nadal sam stawia serwer i przeglądarkę
    const main = BODY('async function main', 'function isMain');
    expect(main).toContain("if (args.stage !== '4b') {");
    expect(main).toContain('benchPass({ browser, args, port, base, out })');
    expect(main).toContain('external.push(...bench.external)');
    expect(main).toContain('apiBlocked.push(...bench.apiBlocked)');
    expect(main).toContain('bench.apiFailures');
    // bieg 15 jest po pętli rozmiarów, na tej samej przeglądarce, a jego krok dostaje wynik na każdym rozmiarze
    expect(main.indexOf('benchPass({ browser, args, port, base, out })')).toBeGreaterThan(main.indexOf('(results[vp.name] ??= {})[8] = r8;'));
    expect(main).toContain('(results[vp.name] ??= {})[15] = step;');
  });

  it('źródło: porażka kroku 9 nie przekreśla kroków 13–15 (osobne scenariusze), a `--etap makieta` pomija kroki 4b i 4a', () => {
    expect(BODY('function failRelet', 'async function englishChecks')).toContain('step.id > 12');
    const main = BODY('async function main', 'function isMain');
    expect(main).toContain("args.stage === 'makieta' ? [makieta]");
    expect(main).toContain("args.stage === 'makieta' ? [] : [scenario4b");
    expect(main).toContain("'--etap makieta: tylko kroki 13–15'");
  });
});

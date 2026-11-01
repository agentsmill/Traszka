import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURES, HOUR_BARS, LAUNCH_ARGS, LIMIT_TEXT, NEW_SCREENS, OPEN_MINUTE, PHONE_WIDTH, RELET_BUILD_DAYS as SMOKE_RELET_BUILD_DAYS, RELET_CAPTION, RELET_SHARE,
  RELET_TITLE, RELET_TRUST, STEPS, TIPS_STEP,
  BACKGROUND_TRUST_WARN_BELOW, USAGE, VIEWPORTS, DEFAULT_PLAYWRIGHT_ROOT, chromiumCandidates, chromiumExecutable, closedFittings,
  contextOptions, daysText, digitsOf, fixtureSave, loadPlaywright, median, metaFor, newScreenProblems, overlapArea, parseArgs, parseInstallmentButton, parsePerf,
  pinProblems, previewReady, requestVerdict, reletBlockText, reletPrice, stepResult, storageEntries, summarize, trustRowValues, tutorialMemory,
  widthProblems,
  type MakeRequire, type StepResult, type WidthBox,
} from '../scripts/city-smoke.mjs';
import { MemoryStorage } from '@/game/memoryStorage';
import { loadMeta, needsStartScreen } from '@/game/meta';
import { createSession, hasStoredSave } from '@/game/session';
import { OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import { TRUST } from '@/sim/economy/tycoon/trust';
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

describe('plan smoke\'a (Zadanie 16)', () => {
  it('dwanaście kroków (1–8 z 4a.1, 9–12 z 4a.2) i przebieg z dymkami; 6 tylko na komputerze, 7 i 12 tylko na telefonie, reszta na obu', () => {
    expect(STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const sizes = (id: number | string): string[] => [...[...STEPS, TIPS_STEP].find((s) => s.id === id)!.sizes];
    for (const id of [1, 2, 3, 4, 5, 8, 9, 10, 11]) expect(sizes(id), `krok ${id}`).toEqual(['telefon', 'desktop']);
    expect(sizes(6)).toEqual(['desktop']);
    expect(sizes(7)).toEqual(['telefon']);
    expect(sizes(12)).toEqual(['telefon']);
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
      for (const step of [...STEPS, TIPS_STEP]) out[vp.name]![step.id] = step.sizes.includes(vp.name) ? stepResult() : stepResult({ na: true });
    }
    return out;
  };

  it('summarize: wiersz na krok i rozmiar, który go dotyczy (telefon 12, komputer 10), wszystko ok daje ok', () => {
    const s = summarize(allOk());
    expect(s.ok).toBe(true);
    expect(s.rows.filter((r) => r.size === 'telefon').map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 'T']);
    expect(s.rows.filter((r) => r.size === 'desktop').map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11]);
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

  it('parseArgs: --help to pomoc (main drukuje USAGE i kończy kodem 0), --only telefon|phone|desktop, błędy', () => {
    expect(parseArgs([])).toEqual({ only: null, help: false });
    expect(parseArgs(['--only', 'desktop'])).toEqual({ only: 'desktop', help: false });
    expect(parseArgs(['--only', 'phone'])).toEqual({ only: 'telefon', help: false });
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
    expect(ignored('docs/superpowers/reports/2026-10-31-miasto-4a1/telefon-01-stary-zapis-karta.jpg')).toBe(1);
    expect(SOURCE).toMatch(/join\(ROOT, '\.smoke', 'city'\)/);
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
    expect(LIMIT_TEXT).toBe(refusalText('limit'));
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

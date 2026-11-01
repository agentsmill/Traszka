import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURES, LAUNCH_ARGS, PHONE_WIDTH, STEPS, TIPS_STEP, USAGE, VIEWPORTS, DEFAULT_PLAYWRIGHT_ROOT, chromiumCandidates, chromiumExecutable,
  contextOptions, fixtureSave, loadPlaywright, median, metaFor, parseArgs, parsePerf, previewReady, requestVerdict, stepResult, storageEntries,
  summarize, tutorialMemory, widthProblems,
  type MakeRequire, type StepResult, type WidthBox,
} from '../scripts/city-smoke.mjs';
import { MemoryStorage } from '@/game/memoryStorage';
import { loadMeta, needsStartScreen } from '@/game/meta';
import { createSession, hasStoredSave } from '@/game/session';
import { partnerProgress } from '@/sim/firm/commands';

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
  it('osiem kroków i przebieg z dymkami; 6 tylko na komputerze, 7 tylko na telefonie, reszta na obu', () => {
    expect(STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const sizes = (id: number | string): string[] => [...[...STEPS, TIPS_STEP].find((s) => s.id === id)!.sizes];
    for (const id of [1, 2, 3, 4, 5, 8]) expect(sizes(id), `krok ${id}`).toEqual(['telefon', 'desktop']);
    expect(sizes(6)).toEqual(['desktop']);
    expect(sizes(7)).toEqual(['telefon']);
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

  const load = (file: string, tips = false): { seed: string } => {
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

  it('summarize: wiersz na krok i rozmiar, który go dotyczy (telefon 8, komputer 7), wszystko ok daje ok', () => {
    const s = summarize(allOk());
    expect(s.ok).toBe(true);
    expect(s.rows.filter((r) => r.size === 'telefon').map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 7, 8, 'T']);
    expect(s.rows.filter((r) => r.size === 'desktop').map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 6, 8]);
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

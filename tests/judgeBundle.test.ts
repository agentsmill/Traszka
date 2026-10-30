import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildJudge, DEFAULT_BUNDLE_FILE } from '../scripts/build-judge.mjs';
import * as entry from '../scripts/judge-entry';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
import { replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { makeBundleVerifier } from '../src/server/judge';
import type * as Declared from '../src/server/judgeBundle';

/**
 * Bundle sędziego (scripts/build-judge.mjs): `npm test` nie może wymagać zbudowanego `src/server/judgeBundle.js` (CI puszcza testy
 * przed buildem), więc ten plik buduje bundle sam do katalogu tymczasowego i sprawdza go tak, jak użyje go serwer: jako zwykły moduł
 * ESM bez aliasów i bez Vite.
 */
const ROOT = resolve(__dirname, '..');
const NAMES = ['GENERATOR_VERSION', 'RANKED_SEASON_END_MINUTE', 'SIM_VERSION', 'replayRun', 'seasonBankrupt', 'seasonScore'];

// Kontrola typów (tsc): ręcznie pisany `judgeBundle.d.ts` opisuje dokładnie to, co eksportuje wejście bundla. Wejście musi pasować do
// deklaracji (każda zadeklarowana nazwa istnieje i ma zgodny typ), a zbiory nazw w obu plikach są identyczne.
// (Typów nie da się przypisać w obie strony: `SIM_VERSION` w wejściu ma typ literalny (`export const SIM_VERSION = 2`), a w deklaracji `number`.)
const declaredAsEntry: typeof Declared = entry;
type ExtraDeclared = Exclude<keyof typeof Declared, keyof typeof entry>;
type Undeclared = Exclude<keyof typeof entry, keyof typeof Declared>;
const sameNames: [ExtraDeclared | Undeclared] extends [never] ? true : false = true;
void declaredAsEntry;
void sameNames;

let dir: string;
let file: string;
let bytes: number;
const load = (): Promise<unknown> => import(/* @vite-ignore */ pathToFileURL(file).href);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'traszka-judge-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');   // jak w repozytorium: .js w katalogu z "type": "module" to ESM
  mkdirSync(join(dir, 'out'));
  writeFileSync(join(dir, 'out', 'cudzy-plik.txt'), 'nie ruszać');
  ({ file, bytes } = await buildJudge({ outDir: join(dir, 'out') }));
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Sklep, w którym bierny bieg i bieg z `LOG` przeżywają sezon: sędzia odrzuca bieg zakończony bankructwem (`season-bankrupt`), a w
 * wielu sklepach bierny bieg kończy grę poniżej granicy debetu (np. w `kiełbasa-42` w ostatniej minucie sezonu).
 */
const SEED = 'szarlotka-380';
const RUN: RunRecord = { seed: SEED, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log: [] };
const at = (day: number, hour: number, minute = 0): number => day * MINUTES_PER_DAY + hour * 60 + minute;
/** Dopisuje codzienne stuknięcia (palety i kasa) przez `days` dni i układa wpisy po minucie z kolejnymi `seq`. */
const withTaps = (planned: { minute: number; cmd: LogEntry['cmd'] }[], days: number): LogEntry[] => {
  for (let day = 0; day < days; day++) {
    for (let k = 0; k < 8; k++) planned.push({ minute: at(day, 7, 2 + k), cmd: { type: 'tapPallet' } });
    for (let k = 0; k < 6; k++) planned.push({ minute: at(day, 8, 5 + k), cmd: { type: 'tapTill' } });
  }
  return planned.sort((a, b) => a.minute - b.minute).map((p, seq) => ({ minute: p.minute, seq, cmd: p.cmd }));
};
/**
 * Kilka poleceń rozłożonych na sezon oraz codzienne stuknięcia przez cztery tygodnie. Bieg przeżywa sezon w `SEED` (`gameOver` false), a
 * jego wynik różni się od biernego (pilnuje tego test niżej). Ekonomia z granicą debetu jest ciasna: droższe zakupy (zatrudnienie, sprzęt,
 * remont) w tym sklepie kończą grę przed końcem sezonu, więc są tylko w `LOG_REMONT`.
 */
const LOG: LogEntry[] = withTaps([
  { minute: at(0, 6, 0), cmd: { type: 'setStaffProfile', profile: 'kolejka' } },
  { minute: at(0, 6, 1), cmd: { type: 'movePallet', palletId: 1, loc: 'backroom' } },
  { minute: at(2, 12), cmd: { type: 'buyUpgrade', id: 'ulotki' } },
  { minute: at(3, 7), cmd: { type: 'setOrder', auto: true } },
  { minute: at(40, 12), cmd: { type: 'campaign' } },
], 28);
/**
 * Stuknięcia przez cały sezon i remont 1 w 55. dniu (po stuknięciach sklepu stać wtedy na 25 tys. zł; przy SIM_VERSION 4 wystarczał
 * 45. dzień): układ sklepu zmienia się w trakcie odtwarzania.
 */
const LOG_REMONT: LogEntry[] = withTaps([
  { minute: at(55, 7), cmd: { type: 'startRemont' } },
  { minute: at(55, 7, 5), cmd: { type: 'rushRemont' } },
], 90);
/**
 * Stuknięcia przez cały sezon, a od 10 października (dzień 40) osiem osób na zmianie i 30 palet dziennie: pensje, opłata logistyczna
 * i przejścia zasypane paletami sprowadzają gotówkę poniżej granicy debetu (od SIM_VERSION 5 −100 tys. zł) 29 listopada, przed ostatnim
 * raportem. Wrześniowy raport jest na plusie, czyli taki bieg gracz mógłby wysłać z tym, co zdążył zarobić, gdyby sędzia liczył
 * raporty, które powstały. Strojone pod `SEED` przy SIM_VERSION 5 (do SIM_VERSION 4 wystarczał tu sam remont).
 */
const LOG_BANKRUPT: LogEntry[] = withTaps([
  ...Array.from({ length: 6 }, (_, i) => ({ minute: at(40, 9, i), cmd: { type: 'hire' } as const })),
  { minute: at(40, 9, 10), cmd: { type: 'setOrder', auto: false, manual: 30 } },
], 90);
/** Wynik policzony bezpośrednio z src/sim, tym samym kodem co w bundlu (drugi sposób do porównania). */
const direct = (run: RunRecord): number => seasonScore(replayRun(run, RANKED_SEASON_END_MINUTE));

describe('buildJudge: jeden samodzielny plik z aktualnej symulacji', () => {
  it('do katalogu wyjściowego trafia dokładnie jeden plik, a cudze pliki w nim zostają (katalog nie jest czyszczony)', () => {
    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['cudzy-plik.txt', 'judgeBundle.js']);
    expect(readFileSync(join(dir, 'out', 'cudzy-plik.txt'), 'utf8')).toBe('nie ruszać');
    expect(file).toBe(join(dir, 'out', 'judgeBundle.js'));
    expect(bytes).toBe(readFileSync(file).length);
    expect(bytes).toBeGreaterThan(10_000);   // zawiera symulację, a nie samo wejście
    expect(bytes).toBeLessThan(2_000_000);    // ale nie silnik gry ani render: sędzia ma być lekki (zimny start funkcji)
  });

  it('nazwę pliku wyjściowego można wybrać', async () => {
    const other = await buildJudge({ outDir: join(dir, 'out'), outFile: 'inny.js' });
    expect(other.file).toBe(join(dir, 'out', 'inny.js'));
    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['cudzy-plik.txt', 'inny.js', 'judgeBundle.js']);
  }, 60_000);

  it('plik nie ma żadnych importów (ani aliasów @/, ani względnych, ani dynamicznych): wszystko jest w środku', () => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/^\s*import\b/m);
    expect(text).not.toMatch(/\bimport\s*\(/);
    expect(text).not.toMatch(/require\(/);
    expect(text).not.toContain('@/');
  });

  it('da się go zaimportować w zwykłym Node, bez Vite i bez aliasów, i eksportuje dokładnie sześć nazw', () => {
    const script = `
      const m = await import(process.argv[1]);
      console.log(JSON.stringify({
        names: Object.keys(m).sort(),
        types: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v])),
        SIM_VERSION: m.SIM_VERSION, GENERATOR_VERSION: m.GENERATOR_VERSION, END: m.RANKED_SEASON_END_MINUTE,
        score: m.seasonScore(m.replayRun({ seed: ${JSON.stringify(SEED)}, gameVersion: 'x', generatorVersion: m.GENERATOR_VERSION, mode: 'ranked', log: [] }, m.RANKED_SEASON_END_MINUTE)),
      }));`;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script, pathToFileURL(file).href], { encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { names: string[]; types: Record<string, string>; SIM_VERSION: number; GENERATOR_VERSION: number; END: number; score: number };
    expect(out.names).toEqual(NAMES);
    expect(out.types).toEqual({ SIM_VERSION: 'number', GENERATOR_VERSION: 'number', RANKED_SEASON_END_MINUTE: 'number', seasonScore: 'function', seasonBankrupt: 'function', replayRun: 'function' });
    expect([out.SIM_VERSION, out.GENERATOR_VERSION, out.END]).toEqual([SIM_VERSION, GENERATOR_VERSION, RANKED_SEASON_END_MINUTE]);
    expect(out.score).toBe(direct(RUN));   // ten sam wynik z czystego Node i z kodu źródłowego w Vitest
  }, 60_000);   // dwa pełne sezony (w osobnym Node i tutaj): w CI dłużej niż domyślne 5 s

  it('eksporty bundla to dokładnie te z wejścia (scripts/judge-entry.ts) i te z src: wersje i koniec sezonu równe', async () => {
    const mod = await load() as typeof entry;
    expect(Object.keys(mod).sort()).toEqual(NAMES);
    expect(Object.keys(entry).sort()).toEqual(NAMES);
    expect(mod.SIM_VERSION).toBe(SIM_VERSION);
    expect(mod.GENERATOR_VERSION).toBe(GENERATOR_VERSION);
    expect(mod.RANKED_SEASON_END_MINUTE).toBe(RANKED_SEASON_END_MINUTE);
  });

  it('błąd budowania (brakujący import w wejściu, nieosiągalny katalog) to odrzucona obietnica, a nie cichy sukces', async () => {
    const broken = join(dir, 'zepsute-wejscie.ts');
    writeFileSync(broken, "export { nie } from '@/sim/nie-ma-takiego-pliku';\n");
    await expect(buildJudge({ outDir: join(dir, 'zepsute'), entry: broken })).rejects.toThrow();
    expect(existsSync(join(dir, 'zepsute', 'judgeBundle.js'))).toBe(false);
    // Stary plik wyniku (poprzednie udane budowanie) i wejście z nierozwiązywalnym pakietem: bundler potrafi zapisać wyjście z
    // pozostawionym importem, a dopiero potem odrzucić obietnicę. Po błędzie nie może zostać żaden plik, bo wyglądałby na wynik.
    const brokenPackage = join(dir, 'zepsute-pakiet.ts');
    writeFileSync(brokenPackage, "export { x } from 'nie-ma-takiego-pakietu';\n");
    mkdirSync(join(dir, 'zepsute2'), { recursive: true });
    writeFileSync(join(dir, 'zepsute2', 'judgeBundle.js'), '// stary wynik');
    await expect(buildJudge({ outDir: join(dir, 'zepsute2'), entry: brokenPackage })).rejects.toThrow();
    expect(existsSync(join(dir, 'zepsute2', 'judgeBundle.js'))).toBe(false);
    await expect(buildJudge({ outDir: join(dir, 'out', 'cudzy-plik.txt', 'pod') })).rejects.toThrow();
  }, 60_000);
});

describe('skrypt scripts/build-judge.mjs jako polecenie (npm run build:judge)', () => {
  const script = join(ROOT, 'scripts', 'build-judge.mjs');
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: ROOT });

  it('buduje plik wskazany w --out, wypisuje jego rozmiar i kończy kodem 0', () => {
    const out = join(dir, 'cli', 'bundle.js');
    const res = run('--out', out);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(res.stdout).toMatch(/bundle\.js/);
    expect(res.stdout).toMatch(/\d+(\.\d+)? KB/);
  }, 60_000);

  it('błąd budowania kończy proces kodem różnym od 0 i niczego nie zostawia', () => {
    const res = run('--out', join(dir, 'out', 'cudzy-plik.txt', 'pod', 'bundle.js'));
    expect(res.status).not.toBe(0);
    expect(res.stderr).not.toBe('');
  }, 60_000);

  it('domyślny cel to src/server/judgeBundle.js, a plik jest w .gitignore (nie jest commitowany)', () => {
    // budowanie zapisuje tam, skąd czyta funkcja: `import('../src/server/judgeBundle.js')` w api/runs.ts, liczone od katalogu api/
    expect(DEFAULT_BUNDLE_FILE).toBe(resolve(ROOT, 'api', '../src/server/judgeBundle.js'));
    expect(readFileSync(join(ROOT, 'api', 'runs.ts'), 'utf8')).toContain("import('../src/server/judgeBundle.js')");
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')).toContain('src/server/judgeBundle.js');
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts['build:judge']).toBe('node scripts/build-judge.mjs');
    // bundle musi powstać przed kompilacją i budowaniem gry; kolejne kroki `build` mogą się zmieniać
    expect(scripts.build).toMatch(/^npm run build:judge && /);
  });
});

describe('sędzia na zbudowanym bundlu daje ten sam wynik co symulacja z src', () => {
  it('bieg bierny przez trzy miesiące (pusty dziennik): ok i wynik równy seasonScore(replayRun(…)) z src', async () => {
    const res = await makeBundleVerifier(load)(RUN);
    expect(res).toEqual({ ok: true, score: direct(RUN) });
    expect(Number.isInteger(res.ok && res.score)).toBe(true);
  }, 60_000);

  it('bieg z poleceniami w dzienniku: wynik jak z src i inny niż biernego, więc dziennik naprawdę wpływa na odtworzenie', async () => {
    const run: RunRecord = { ...RUN, log: LOG };
    expect(replayRun(run, RANKED_SEASON_END_MINUTE).gameOver, 'bieg przeżywa sezon').toBe(false);
    const res = await makeBundleVerifier(load)(run);
    expect(res).toEqual({ ok: true, score: direct(run) });
    expect(direct(run)).not.toBe(direct(RUN));
  }, 60_000);

  it('odtwarzanie przechodzi przez zmianę układu sklepu (remont 1 przyjęty): stan z bundla i z src jest ten sam', async () => {
    const run: RunRecord = { ...RUN, log: LOG_REMONT };
    const state = replayRun(run, RANKED_SEASON_END_MINUTE);
    expect(state.remontLevel).toBeGreaterThan(0);
    const mod = await load() as typeof entry;
    expect(JSON.stringify(mod.replayRun(run, RANKED_SEASON_END_MINUTE))).toBe(JSON.stringify(state));
  }, 60_000);

  it('bieg, który bankrutuje przed końcem sezonu, choć ma raport z dodatnim wynikiem: season-bankrupt, a nie wynik z raportów', async () => {
    const run: RunRecord = { ...RUN, log: LOG_BANKRUPT };
    const state = replayRun(run, RANKED_SEASON_END_MINUTE);
    expect(state.gameOver, 'dziennik naprawdę kończy grę').toBe(true);
    expect(state.minute).toBeLessThan(RANKED_SEASON_END_MINUTE);
    expect(state.history.length, 'raporty, które powstały przed bankructwem').toBeGreaterThan(0);
    expect(state.history[0]!.profit, 'wrzesień na plusie').toBeGreaterThan(0);
    expect(await makeBundleVerifier(load)(run)).toEqual({ ok: false, reason: 'season-bankrupt' });
  }, 60_000);

  it('simVersion inny niż SIM_VERSION w bundlu: old-version', async () => {
    expect(await makeBundleVerifier(load)({ ...RUN, simVersion: SIM_VERSION + 1 })).toEqual({ ok: false, reason: 'old-version' });
    expect(await makeBundleVerifier(load)({ ...RUN, simVersion: SIM_VERSION - 1 })).toEqual({ ok: false, reason: 'old-version' });
  });

  it('generatorVersion inny niż w bundlu: replay-failed z wpisem w logu (replayRun rzuca)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await makeBundleVerifier(load)({ ...RUN, generatorVersion: GENERATOR_VERSION + 1 })).toEqual({ ok: false, reason: 'replay-failed' });
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0]![0]).toBe('[ranking] replay');
    } finally {
      errors.mockRestore();
    }
  });

  it('polecenie, którego symulacja nie zna, nie wywraca sędziego: bieg liczy się tak, jakby go nie było (applyCommand odrzuca je)', async () => {
    const odd: RunRecord = { ...RUN, log: [{ minute: at(0, 7), seq: 0, cmd: { type: 'nieZnane' } as never }, ...LOG.map((e) => ({ ...e, seq: e.seq + 1 }))] };
    expect(await makeBundleVerifier(load)(odd)).toEqual({ ok: true, score: direct({ ...RUN, log: LOG }) });
  }, 60_000);
});

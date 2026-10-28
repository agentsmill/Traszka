// Pipeline dźwięków CC0: assets-src/<paczka>/files/<plik>.ogg + scripts/audio-map.json -> public/assets/audio/<rodzaj>-<n>.mp3 + manifest.json
// Uruchomienie: npm run audio [-- --src <katalog z paczkami>]   (domyślnie assets-src w katalogu głównym repozytorium)
//
// Skrypt jest powtarzalny: cały katalog public/assets/audio odtwarza się z mapy (zmiana wyboru dźwięków = edycja
// scripts/audio-map.json i ponowne uruchomienie). Ten sam wynik bajt w bajt przy tych samych źródłach i tej samej wersji ffmpeg.
//
// Mapa: { "<rodzaj>": [{ "pack": "<paczka>", "file": "<ścieżka w files/ paczki>" }, ...], ... } (ten kształt eksportuje strona odsłuchu).
// Rodzaj to nazwa dźwięku w grze (src/ui/sfxBank.ts, SFX_KINDS); pusta lista albo brak klucza = ten dźwięk zostaje syntezowany.
// Źródła są tylko czytane. ffmpeg: z PATH, ze zmiennej FFMPEG albo z /opt/homebrew/bin (potrzebny enkoder libmp3lame).
//
// Co dzieje się z każdą próbką (ffmpeg dekoduje i koduje; decyzje, czyli filtr DC, próg ciszy po wzmocnieniu i miarę głośności
// także dla dźwięków krótszych niż 400 ms, liczy Node, żeby były jawne i powtarzalne):
//  1. Dekodowanie do mono, 44,1 kHz, float (stereo miksowane do mono, 48 kHz przeliczane).
//  2. Filtr górnoprzepustowy 20 Hz (jeden biegun) usuwa przesunięcie stałej składowej. Stuknięcia Kenneya je mają: końcówka pliku
//     to stałe −0,03 (−31 dBFS) przy szczycie +2 dBFS, więc urwanie jej daje trzask na końcu, a obcinanie ciszy po progu nigdy
//     by jej nie uznało za ciszę. Po filtrze ostatnia próbka schodzi poniżej −66 dBFS.
//  3. Wyrównanie głośności (opis niżej) → wzmocnienie w dB, wspólne dla całej próbki.
//  4. Obcięcie ciszy: początek i koniec poniżej TRIM_DB (liczone już po wzmocnieniu, czyli próg jest taki, jak go słychać w grze).
//     Atak zostaje cały: przed pierwszą próbką ponad progiem zostaje PRE_ROLL_MS rozbiegu, a pliki, które zaczynają się od razu
//     od ataku (stuknięcia, dżingle), nie tracą ani próbki.
//  5. Wejście FADE_IN_MS (1 ms, cos²: tylko przeciw trzaskowi, gdy plik zaczyna się od niezerowej próbki, nie przycina ataku)
//     i wyciszenie końca FADE_OUT_MS (18 ms, cos²: niektóre dżingle są urwane w środku fali, np. STEEL10 kończy się na −39 dBFS).
//     Po ostatniej głośnej próbce zostaje dokładnie tyle ciszy, ile trwa wyciszenie, więc zwykle wyciszany jest już sam ogon
//     poniżej progu, a nie dźwięk.
//  6. MP3 (libmp3lame VBR, mono): dekoduje je każda przeglądarka, także Safari na iOS. Nagłówek Xing/LAME zostaje (niesie
//     opóźnienie enkodera, żeby dekoder mógł je odciąć), tag ID3 i metadane wyrzucone.
//  7. Kontrola: zakodowany plik jest dekodowany z powrotem i mierzony (długość, szczyt, głośność, poziom ostatniej milisekundy).
//
// Wyrównanie głośności: nie po szczycie, tylko po głośności K-ważonej wg ITU-R BS.1770 (ta sama miara co w EBU R128:
// filtr „K” i okno 400 ms, „momentary”). Szczyt nic nie mówi o tym, jak głośno coś brzmi: stuknięcie i dżingle o tym samym
// szczycie różnią się o kilkanaście dB. Dla każdej próbki bierzemy maksimum głośności momentary (okno 400 ms co 25 ms; sygnał
// krótszy niż okno jest dopełniany ciszą, więc krótkie stuknięcie liczy się energią, a nie średnią po własnej długości) i
// przesuwamy je do TARGET_LUFS. Gdyby to dało szczyt powyżej PEAK_CEILING_DB (dźwięki rzadkie i ostre, np. brzęk monet),
// wzmocnienie ogranicza szczyt: próbka zostaje cichsza od celu, zamiast się zniekształcać lub pompować limiterem. Takie próbki
// skrypt wypisuje w uwagach. Implementacja miary jest zgodna z filtrem ebur128 ffmpeg (sprawdzone na wszystkich próbkach: 0,00 dB).
//
// Budżet: razem MAX_TOTAL_BYTES, pojedynczy plik MAX_FILE_BYTES; po przekroczeniu skrypt kończy się błędem i niczego nie zmienia
// w public/assets/audio (zapis dopiero po przejściu wszystkich kontroli).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = join(ROOT, 'scripts', 'audio-map.json');
const OUT = join(ROOT, 'public', 'assets', 'audio');

/** Paczki, z których wolno brać dźwięki: każda ma wpis w public/assets/LICENSES.md (nowa paczka wymaga wpisu tam i tutaj). */
const PACKS = ['kenney-interface-sounds', 'kenney-impact-sounds', 'kenney-rpg-audio', 'kenney-music-jingles'];

const RATE = 44100;
const DC_BLOCK_HZ = 20;
/** Cisza: poziom w dBFS po wzmocnieniu; −60 dBFS to poziom, którego w grze nie słychać. */
const TRIM_DB = -60;
const PRE_ROLL_MS = 2;
const FADE_IN_MS = 1;
const FADE_OUT_MS = 18;
/** Cel głośności: maksimum momentary w LUFS. Poziom w grze reguluje MASTER_GAIN w src/ui/sfxBank.ts. */
const TARGET_LUFS = -22;
const PEAK_CEILING_DB = -1;
/** Jakość VBR libmp3lame (0 najlepsza, 9 najgorsza). V2 to wysoka jakość przy małych plikach (15 próbek z mapy startowej: ok. 70 KB). */
const MP3_VBR_QUALITY = 2;
const MAX_TOTAL_BYTES = 400 * 1024;
const MAX_FILE_BYTES = 100 * 1024;
/** Tolerancja długości po zakodowaniu i zdekodowaniu z powrotem: dwie ramki MP3. */
const LENGTH_TOLERANCE = 2 * 1152;

/** Błąd użytkownika (zły argument, brak pliku, przekroczony budżet): komunikat bez śladu stosu. */
class UserError extends Error {}
const fail = (message) => { throw new UserError(message); };

const ms = (value) => Math.round((value / 1000) * RATE);
const toDb = (amplitude) => 20 * Math.log10(amplitude);
const fromDb = (db) => 10 ** (db / 20);
const fmt = (value, digits = 1) => value.toFixed(digits).replace('-', '−');

function parseArgs(argv) {
  let src = join(ROOT, 'assets-src');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--src') {
      const value = argv[++i];
      if (!value) fail('--src wymaga katalogu (npm run audio -- --src <katalog z paczkami>)');
      src = resolve(value);
    } else if (arg.startsWith('--src=')) {
      src = resolve(arg.slice('--src='.length));
    } else {
      fail(`nieznany argument "${arg}". Użycie: npm run audio [-- --src <katalog z paczkami>]`);
    }
  }
  return { src };
}

/** Mapa → lista zadań `{ kind, n, pack, file }` w kolejności z pliku. Sprawdza kształt, paczki i ścieżki. */
function readMap() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
  } catch (err) {
    fail(`nie można wczytać ${relative(ROOT, MAP_FILE)}: ${err.message}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(`${relative(ROOT, MAP_FILE)}: oczekiwany obiekt { "<rodzaj>": [{ "pack", "file" }] }`);
  const jobs = [];
  for (const [kind, list] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9]*$/.test(kind)) fail(`mapa: rodzaj "${kind}" ma mieć nazwę z małych liter i cyfr (trafia do nazwy pliku)`);
    if (!Array.isArray(list)) fail(`mapa: "${kind}" ma być listą wpisów { "pack", "file" }`);
    list.forEach((entry, n) => {
      const where = `mapa: ${kind}[${n}]`;
      if (entry === null || typeof entry !== 'object' || typeof entry.pack !== 'string' || typeof entry.file !== 'string') {
        fail(`${where} ma mieć tekstowe pola "pack" i "file"`);
      }
      if (!PACKS.includes(entry.pack)) fail(`${where}: nieznana paczka "${entry.pack}" (dozwolone: ${PACKS.join(', ')})`);
      if (!entry.file.endsWith('.ogg') || isAbsolute(entry.file) || entry.file.split(/[\\/]/).includes('..')) {
        fail(`${where}: "file" ma być ścieżką względną do pliku .ogg wewnątrz paczki, jest "${entry.file}"`);
      }
      jobs.push({ kind, n, pack: entry.pack, file: entry.file });
    });
  }
  return jobs;
}

function findFfmpeg() {
  const candidates = [process.env.FFMPEG, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean);
  let foundWithoutMp3 = null;
  for (const bin of candidates) {
    const r = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (r.status !== 0) continue;
    if (/libmp3lame/.test(r.stdout)) return bin;
    foundWithoutMp3 = bin;
  }
  if (foundWithoutMp3) fail(`ffmpeg (${foundWithoutMp3}) nie ma enkodera libmp3lame. Zainstaluj pełny ffmpeg (brew install ffmpeg).`);
  fail('nie znaleziono ffmpeg. Zainstaluj go (brew install ffmpeg) albo podaj ścieżkę w zmiennej FFMPEG.');
}

/** Dekoduje dowolny plik audio do mono, RATE Hz, float32. */
function decode(ffmpeg, file) {
  const r = spawnSync(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) fail(`ffmpeg nie zdekodował ${file}: ${String(r.stderr).trim() || `kod ${r.status}`}`);
  const bytes = r.stdout;
  if (bytes.length < 4 || bytes.length % 4 !== 0) fail(`ffmpeg zwrócił pusty lub uszkodzony dźwięk dla ${file}`);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function encode(ffmpeg, samples, file) {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const r = spawnSync(ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0',
    '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', String(MP3_VBR_QUALITY),
    '-id3v2_version', '0', '-write_id3v1', '0', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    file,
  ], { input, maxBuffer: 1 << 26 });
  if (r.status !== 0) fail(`ffmpeg nie zakodował ${file}: ${String(r.stderr).trim() || `kod ${r.status}`}`);
}

// --- DSP --------------------------------------------------------------------------------------------------------------

/** Jednobiegunowy filtr górnoprzepustowy (blokada składowej stałej): y[n] = x[n] − x[n−1] + R·y[n−1]. */
function dcBlock(x) {
  const r = 1 - (2 * Math.PI * DC_BLOCK_HZ) / RATE;
  const y = new Float32Array(x.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < x.length; i++) {
    prevOut = x[i] - prevIn + r * prevOut;
    prevIn = x[i];
    y[i] = prevOut;
  }
  return y;
}

function biquad(x, [b0, b1, b2], [a1, a2]) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i];
    y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** Filtr „K” z ITU-R BS.1770: półka wysokich tonów (+4 dB od ok. 1,7 kHz), potem górnoprzepustowy ok. 38 Hz; współczynniki jak w libebur128. */
function kWeight(x) {
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const k1 = Math.tan((Math.PI * 1681.974450955533) / RATE);
  const q1 = 0.7071752369554196;
  const a01 = 1 + k1 / q1 + k1 * k1;
  const shelf = biquad(
    x,
    [(vh + (vb * k1) / q1 + k1 * k1) / a01, (2 * (k1 * k1 - vh)) / a01, (vh - (vb * k1) / q1 + k1 * k1) / a01],
    [(2 * (k1 * k1 - 1)) / a01, (1 - k1 / q1 + k1 * k1) / a01],
  );
  const k2 = Math.tan((Math.PI * 38.13547087602444) / RATE);
  const q2 = 0.5003270373238773;
  const a02 = 1 + k2 / q2 + k2 * k2;
  return biquad(shelf, [1, -2, 1], [(2 * (k2 * k2 - 1)) / a02, (1 - k2 / q2 + k2 * k2) / a02]);
}

/** Maksimum głośności „momentary” (okno 400 ms co 25 ms) w LUFS; sygnał krótszy niż okno jest dopełniany ciszą. */
function momentaryMaxLufs(x) {
  const k = kWeight(x);
  const win = Math.round(0.4 * RATE);
  const hop = Math.round(0.025 * RATE);
  const len = Math.max(k.length, win);
  const cum = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) cum[i + 1] = cum[i] + (i < k.length ? k[i] * k[i] : 0);
  let best = -Infinity;
  const measure = (end) => {
    const lufs = -0.691 + 10 * Math.log10(Math.max((cum[end] - cum[end - win]) / win, 1e-12));
    if (lufs > best) best = lufs;
  };
  for (let end = win; end <= len; end += hop) measure(end);
  measure(len);
  return best;
}

const peakOf = (x) => x.reduce((max, v) => Math.max(max, Math.abs(v)), 0);

/** Indeks pierwszej / ostatniej próbki o module ≥ progu (−1, gdy nie ma żadnej). */
function firstAbove(x, threshold) { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= threshold) return i; return -1; }
function lastAbove(x, threshold) { for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) >= threshold) return i; return -1; }

/** Cos²: 0 → 1 gładko i bez załamań na obu końcach (t ∈ [0, 1]). */
const ramp = (t) => 0.5 * (1 - Math.cos(Math.PI * t));

/** Wzmocnienie i granice cięcia próbki po filtrze DC. */
function planSample(x, name) {
  const peak = peakOf(x);
  if (!(peak > 1e-4)) fail(`${name}: próbka jest (prawie) cicha, nie ma czego normalizować`);
  const lufs = momentaryMaxLufs(x);
  const byLoudness = TARGET_LUFS - lufs;
  const byPeak = PEAK_CEILING_DB - toDb(peak);
  const gainDb = Math.min(byLoudness, byPeak);
  const gain = fromDb(gainDb);
  const threshold = fromDb(TRIM_DB) / gain;
  const first = firstAbove(x, threshold);
  const last = lastAbove(x, threshold);
  const start = Math.max(0, first - ms(PRE_ROLL_MS));
  const end = Math.min(x.length, last + 1 + ms(FADE_OUT_MS));
  return { lufs, gainDb, gain, start, end, limitedByPeak: byPeak < byLoudness };
}

/** Wycina [start, end), wzmacnia i nakłada wejście oraz wyciszenie końca. */
function renderSample(x, { start, end, gain }) {
  const n = end - start;
  const fadeIn = Math.min(ms(FADE_IN_MS), n >> 1);
  const fadeOut = Math.min(ms(FADE_OUT_MS), n >> 1);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let g = gain;
    if (i < fadeIn) g *= ramp(i / fadeIn);
    const fromEnd = n - 1 - i;   // ostatnia próbka ma dokładnie 0
    if (fromEnd < fadeOut) g *= ramp(fromEnd / fadeOut);
    y[i] = x[start + i] * g;
  }
  return y;
}

// --- praca ----------------------------------------------------------------------------------------------------------------

function processJob(ffmpeg, job, src, stage) {
  const name = `${job.kind}-${job.n}.mp3`;
  const source = join(src, job.pack, 'files', job.file);
  if (!existsSync(source)) {
    fail(`brak pliku źródłowego ${source}\n  (rodzaj "${job.kind}", paczka ${job.pack}, plik ${job.file}; katalog źródeł: ${src}, zmienisz go przez --src)`);
  }
  const decoded = decode(ffmpeg, source);
  const clean = dcBlock(decoded);
  const plan = planSample(clean, `${job.pack}/${job.file}`);
  const samples = renderSample(clean, plan);
  const out = join(stage, name);
  encode(ffmpeg, samples, out);

  // kontrola: to, co usłyszy przeglądarka po zdekodowaniu MP3
  const back = decode(ffmpeg, out);
  const peakDb = toDb(peakOf(back));
  const tailDb = toDb(Math.max(peakOf(back.subarray(Math.max(0, back.length - ms(1)))), 1e-9));
  const warnings = [];
  if (Math.abs(back.length - samples.length) > LENGTH_TOLERANCE) warnings.push(`długość po MP3 ${back.length} zamiast ${samples.length} próbek`);
  if (peakDb > -0.3) warnings.push(`szczyt po MP3 ${fmt(peakDb)} dBFS (ryzyko przesterowania)`);
  if (tailDb > -50) warnings.push(`koniec nie jest cichy (${fmt(tailDb)} dBFS)`);
  return {
    name, kind: job.kind, source: `${job.pack}/${job.file}`,
    bytes: statSync(out).size,
    msBefore: (decoded.length / RATE) * 1000, msAfter: (back.length / RATE) * 1000,
    gainDb: plan.gainDb, lufsBefore: plan.lufs, lufsAfter: momentaryMaxLufs(back), peakDb,
    note: [plan.limitedByPeak ? 'ogr. szczytem' : '', ...warnings].filter(Boolean).join('; '),
  };
}

function report(rows) {
  const pad = (value, width) => String(value).padEnd(width);
  const padL = (value, width) => String(value).padStart(width);
  console.log(`\n${pad('plik', 16)}${pad('źródło', 66)}${padL('ms', 11)}${padL('wzm. dB', 9)}${padL('LUFS-M przed→po', 18)}${padL('szczyt dBFS', 13)}${padL('KB', 7)}  uwagi`);
  for (const r of rows) {
    console.log([
      pad(r.name, 16), pad(r.source, 66),
      padL(`${Math.round(r.msBefore)}→${Math.round(r.msAfter)}`, 11), padL(fmt(r.gainDb), 9),
      padL(`${fmt(r.lufsBefore)}→${fmt(r.lufsAfter)}`, 18), padL(fmt(r.peakDb), 13), padL((r.bytes / 1024).toFixed(1), 7), r.note ? `  ${r.note}` : '',
    ].join(''));
  }
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  console.log(`${pad('RAZEM', 16)}${rows.length} plików, ${(total / 1024).toFixed(1)} KB (budżet ${MAX_TOTAL_BYTES / 1024} KB, plik do ${MAX_FILE_BYTES / 1024} KB)`);
}

function main() {
  const { src } = parseArgs(process.argv.slice(2));
  const jobs = readMap();
  if (jobs.length > 0 && !existsSync(src)) {
    fail(`brak katalogu źródeł dźwięków: ${src}\n  Paczki mają leżeć w <katalog>/<paczka>/files/Audio/... Podaj katalog przez --src.`);
  }
  const ffmpeg = findFfmpeg();
  const stage = mkdtempSync(join(tmpdir(), 'traszka-audio-'));
  try {
    const rows = jobs.map((job) => processJob(ffmpeg, job, src, stage));
    report(rows);

    const total = rows.reduce((sum, r) => sum + r.bytes, 0);
    const tooBig = rows.filter((r) => r.bytes > MAX_FILE_BYTES);
    if (tooBig.length > 0) fail(`przekroczony budżet pliku (${MAX_FILE_BYTES / 1024} KB): ${tooBig.map((r) => `${r.name} ${(r.bytes / 1024).toFixed(1)} KB`).join(', ')}. Nic nie zapisano.`);
    if (total > MAX_TOTAL_BYTES) fail(`przekroczony budżet łączny: ${(total / 1024).toFixed(1)} KB przy limicie ${MAX_TOTAL_BYTES / 1024} KB. Nic nie zapisano.`);

    // zapis dopiero po wszystkich kontrolach: stare pliki (próbki i manifest) znikają, nowe wchodzą na ich miejsce
    mkdirSync(OUT, { recursive: true });
    for (const name of readdirSync(OUT)) if (name.endsWith('.mp3') || name === 'manifest.json') rmSync(join(OUT, name));
    const manifest = {};
    for (const r of rows) {
      copyFileSync(join(stage, r.name), join(OUT, r.name));
      (manifest[r.kind] ??= []).push(r.name);
    }
    writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`zapisano ${rows.length} plików i manifest.json w ${relative(ROOT, OUT)}/`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  if (err instanceof UserError) console.error(`npm run audio: ${err.message}`);
  else console.error(err);
  process.exitCode = 1;
}

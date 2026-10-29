// Pomiar najgorszego przypadku czasu i pamięci sędziego rankingu: odtworzenie biegu z maksymalnym dziennikiem (100 000 wpisów,
// tyle ile dopuszcza parser: RUN_MAX_LOG_ENTRIES) przez zbudowany bundle. Uruchamiany ręcznie, nie wchodzi do `npm test`:
//
//   npm run build:judge && node --expose-gc scripts/judge-worst-case.mjs [plik-bundla] [--repeat N]
//
// Bez argumentu mierzy `src/server/judgeBundle.js`. `--expose-gc` jest opcjonalne (daje dokładniejszy odczyt sterty).
// Każdy scenariusz to osobny bieg z 100 000 wpisów zgodnych z regułami parsera (`src/server/runs.ts`): minuty niemalejące i przed
// końcem sezonu, `seq` rosnące, typ polecenia krótki, polecenie do 512 znaków JSON. Zgodność sprawdza `tests/judgeWorstCase.test.ts`
// (przepuszcza każdy scenariusz przez `parseSubmission`). Sezon trwa pełne trzy miesiące gry, jeśli bieg nie kończy się bankructwem,
// więc najdroższe są biegi, które przeżywają. Bieg zakończony bankructwem przed końcem sezonu sędzia i tak odrzuca (`season-bankrupt`),
// a odtwarzanie staje na minucie bankructwa, więc taki scenariusz niczego nie mierzy: każdy scenariusz ma przeżyć sezon w `SEED`
// (pilnuje tego `tests/judgeWorstCase.test.ts`). Ekonomia z granicą debetu jest ciasna, dlatego polecenia, które kosztują
// (zakupy, zatrudnienie, remont), są w scenariuszach jednego typu tak dobrane, żeby ekonomia je odrzucała albo żeby kosztowały mało.
//
// Limit z założeń (8 s na jedno zgłoszenie) jest tylko progiem ostrzeżenia: skrypt kończy się kodem 2, gdy go przekroczono.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/** Sklep, w którym bierny bieg przeżywa sezon z zapasem gotówki (w wielu sklepach, np. `kiełbasa-42`, schodzi poniżej granicy debetu w ostatniej minucie). */
export const SEED = 'szarlotka-380';
/** Liczba wpisów dziennika w każdym scenariuszu: `RUN_MAX_LOG_ENTRIES` z src/server/config.ts (pilnuje tego test). */
export const LOG_ENTRIES = 100_000;
/** Ciało żądania najwyżej tyle bajtów: `RUN_MAX_BODY_BYTES` z src/server/config.ts (pilnuje tego test). */
export const BODY_LIMIT_BYTES = 4_000_000;
/** Próg ostrzeżenia: ile ms może trwać jedno odtworzenie. */
export const BUDGET_MS = 8_000;

const MINUTES_PER_DAY = 24 * 60;
/** Minuta gry: dzień od startu (dzień 0 = 1 września), godzina i minuta. */
const at = (day, hour, minute = 0) => day * MINUTES_PER_DAY + hour * 60 + minute;

/**
 * Plan zakupów i decyzji, który ekonomia przyjmuje i który nie wywraca sklepu: profil i przypięcia załogi, przesunięcie palety, ulotki
 * (800 zł), kampania i zamówienie automatyczne. Droższe zakupy (sprzęt, kolejne ulepszenia, remont) w `SEED` kończą grę poniżej granicy
 * debetu po pierwszym raporcie, a bieg ma przeżyć sezon i mieć pełny dziennik, więc ich tu nie ma. Przeżywanie sprawdza
 * `tests/judgeWorstCase.test.ts`.
 */
const PLAN = [
  [0, 6, 0, { type: 'setStaffProfile', profile: 'kolejka' }],
  [0, 6, 1, { type: 'movePallet', palletId: 1, loc: 'backroom' }],
  [0, 6, 3, { type: 'tapPallet', palletId: 1 }],
  [2, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
  [3, 7, 0, { type: 'setOrder', auto: true }],
  [20, 12, 0, { type: 'setStaffProfile', profile: 'porzadek' }],
  [40, 12, 0, { type: 'campaign' }],
  [48, 12, 0, { type: 'pinStaff', task: 'kasa', count: 1 }],
  [50, 12, 5, { type: 'setStaffProfile', profile: 'kolejka' }],
  [78, 12, 0, { type: 'campaign' }],
].map(([day, hour, minute, cmd]) => ({ minute: at(day, hour, minute), cmd }));

/**
 * Ulepszenia, które ekonomia odrzuca w biegu, w którym nikt nie kupuje ich poprzedników (wymagają innego ulepszenia, kasy
 * samoobsługowej albo poziomu remontu): wpisy dochodzą do `buyUpgrade`, ale nic nie kosztują.
 */
const LOCKED_UPGRADES = ['drugaKasa', 'nocne', 'rampa', 'traszkapka', 'scoSoft', 'kamery', 'wykladacz', 'dostawy2', 'humanoid'];
const EQUIPMENT = ['sco', 'bankomat', 'piec', 'paczkownik'];

/**
 * Każdy typ polecenia osobno: `i` to numer wpisu w scenariuszu. Pola dobrane tak, żeby polecenie przechodziło `isCommand` (nie było
 * odrzucone na wejściu) i dochodziło do logiki ekonomii: numery palet i kart z zakresu, które się trafiają, id z katalogów. Polecenia,
 * które kosztowałyby sklep bankructwem przy tysiącach powtórzeń, mają argumenty odrzucane przez ekonomię (zablokowane ulepszenie,
 * slot, którego nie ma) albo nie zmieniają tego, co kosztuje (`setOrder` zostaje przy zamówieniu automatycznym).
 */
export const COMMANDS = {
  tapPallet: (i) => ({ type: 'tapPallet', palletId: 1 + (i % 40) }),
  tapPalletAny: () => ({ type: 'tapPallet' }),
  tapTill: () => ({ type: 'tapTill' }),
  movePallet: (i) => ({ type: 'movePallet', palletId: 1 + (i % 6), loc: ['sidewalk', 'backroom', 'floor'][i % 3] }),
  returnPallet: (i) => ({ type: 'returnPallet', palletId: 1 + (i % 6) }),
  setOrder: (i) => ({ type: 'setOrder', auto: true, manual: i % 31 }),
  hire: () => ({ type: 'hire' }),
  fire: () => ({ type: 'fire' }),
  setStaffProfile: (i) => ({ type: 'setStaffProfile', profile: ['kolejka', 'dostawa', 'porzadek'][i % 3] }),
  pinStaff: (i) => ({ type: 'pinStaff', task: ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie'][i % 4], count: i % 3 }),
  buyUpgrade: (i) => ({ type: 'buyUpgrade', id: LOCKED_UPGRADES[i % LOCKED_UPGRADES.length] }),
  buyEquipment: (i) => ({ type: 'buyEquipment', id: EQUIPMENT[i % EQUIPMENT.length], slotId: 'brak-slotu' }),
  startRemont: () => ({ type: 'startRemont' }),
  campaign: () => ({ type: 'campaign' }),
  rushRemont: () => ({ type: 'rushRemont' }),
  answerCard: (i) => ({ type: 'answerCard', seq: 1 + (i % 120), answer: i % 3 }),
};
const COMMAND_NAMES = Object.keys(COMMANDS);
/**
 * Polecenia do wypełniacza w mieszance i do scenariusza „jedna minuta”: bez tych, które w `SEED` kończą grę przy tysiącach powtórek
 * (zatrudnienie bez końca, remont, odsyłanie palet co dostawę).
 */
const SAFE_NAMES = COMMAND_NAMES.filter((n) => !['hire', 'startRemont', 'returnPallet'].includes(n));
/** Dni na końcu sezonu, w które idzie scenariusz „tylko hire”: zatrudnienie do `STAFF_MAX` kosztuje kilka tysięcy, ale nie zdąży zrujnować sklepu. */
const HIRE_DAYS = 3;
/** Dni na początku sezonu, w które idzie scenariusz „tylko startRemont”: sklep ma wtedy za mało gotówki i za niski poziom, więc ekonomia odrzuca każdy wpis. */
const REMONT_DAYS = 5;

/** Dziennik z listy `{ minute, cmd }`: stabilne ułożenie po minucie i kolejne `seq` (parser wymaga rosnących par minuta-`seq`). */
const logOf = (entries) => entries
  .map((e, order) => ({ ...e, order }))
  .sort((a, b) => a.minute - b.minute || a.order - b.order)
  .map((e, seq) => ({ minute: e.minute, seq, cmd: e.cmd }));

/** `count` wpisów rozłożonych równomiernie między minutami `from` i `endMinute` (domyślnie na całym sezonie), polecenie z `make(i)`. */
const spread = (count, endMinute, make, from = 0) => Array.from({ length: count }, (_, i) => ({ minute: from + Math.floor((i * (endMinute - 1 - from)) / count), cmd: make(i) }));

/**
 * Scenariusze najgorszego przypadku, jeden po drugim (generator: każdy dziennik to 100 000 obiektów, więc nie trzymamy ich naraz).
 * `bieg bierny` to punkt odniesienia (pusty dziennik); reszta ma `LOG_ENTRIES` wpisów:
 * - `mieszanka z planem`: plan decyzji, które ekonomia przyjmuje, plus wypełniacz z bezpiecznych typów poleceń rozłożony na sezon;
 * - `jedna minuta`: wszystkie wpisy w jednej minucie (parser dopuszcza, bo `seq` rośnie), bezpieczne typy po kolei;
 * - `tylko <typ>`: sam jeden typ polecenia na całym sezonie, dla każdego typu osobno (`hire` w ostatnich trzech dniach, `startRemont`
 *   w pierwszych pięciu: patrz `HIRE_DAYS` i `REMONT_DAYS`).
 * @param {{ generatorVersion: number, simVersion: number, endMinute: number }} opts wersje i koniec sezonu z bundla sędziego
 */
export function* worstCaseRuns({ generatorVersion, simVersion, endMinute }) {
  const run = (log) => ({ seed: SEED, gameVersion: '0.0.0+abc123def456', generatorVersion, simVersion, mode: 'ranked', log });
  yield { name: 'bieg bierny', run: run([]) };
  const fill = SAFE_NAMES.map((n) => COMMANDS[n]);
  yield {
    name: 'mieszanka z planem',
    run: run(logOf([...PLAN, ...spread(LOG_ENTRIES - PLAN.length, endMinute, (i) => fill[i % fill.length](i))])),
  };
  yield {
    name: 'jedna minuta',
    run: run(logOf(Array.from({ length: LOG_ENTRIES }, (_, i) => ({ minute: at(10, 12), cmd: COMMANDS[SAFE_NAMES[i % SAFE_NAMES.length]](i) })))),
  };
  for (const name of COMMAND_NAMES) {
    // zatrudnienie idzie w ostatnich dniach (wcześniej płace nowych ludzi zjadłyby sklep), remont w pierwszych (potem sklep stać na 25 tys. zł)
    const log = name === 'hire' ? spread(LOG_ENTRIES, endMinute, COMMANDS.hire, endMinute - HIRE_DAYS * MINUTES_PER_DAY)
      : name === 'startRemont' ? spread(LOG_ENTRIES, REMONT_DAYS * MINUTES_PER_DAY, COMMANDS.startRemont)
        : spread(LOG_ENTRIES, endMinute, COMMANDS[name]);
    yield { name: `tylko ${name}`, run: run(logOf(log)) };
  }
}

// --- pomiar (tylko po uruchomieniu z wiersza poleceń) -------------------------------------------------------------

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure() {
  const args = process.argv.slice(2);
  const repeatAt = args.indexOf('--repeat');
  const repeat = repeatAt === -1 ? 3 : Math.max(1, Number(args[repeatAt + 1]));
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--repeat')
    ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server', 'judgeBundle.js');
  const bundle = await import(pathToFileURL(resolve(file)).href);
  const gc = globalThis.gc ?? (() => undefined);
  console.log(`Bundle: ${resolve(file)}`);
  console.log(`Node ${process.version}, ${process.platform}/${process.arch}; sezon do minuty ${bundle.RANKED_SEASON_END_MINUTE}, powtórzeń: ${repeat}${globalThis.gc ? '' : ' (bez --expose-gc: odczyt sterty przybliżony)'}`);
  console.log('scenariusz'.padEnd(26), 'wpisów'.padStart(7), 'ciało MB'.padStart(9), 'mediana ms'.padStart(11), 'max ms'.padStart(8), 'sterta MB'.padStart(10), 'RSS MB'.padStart(8), ' stan końcowy');
  let worst = { name: '', ms: 0 };
  for (const { name, run } of worstCaseRuns({ generatorVersion: bundle.GENERATOR_VERSION, simVersion: bundle.SIM_VERSION, endMinute: bundle.RANKED_SEASON_END_MINUTE })) {
    const bodyBytes = Buffer.byteLength(JSON.stringify({ key: 'K7QX-9MBD-2HFA-P3WN-8RTE', nick: 'Mateusz', run }));
    const times = [];
    let state;
    let heapGrowth = 0;
    let rss = 0;
    for (let i = 0; i < repeat; i++) {
      gc();
      const before = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      state = bundle.replayRun(run, bundle.RANKED_SEASON_END_MINUTE);
      times.push(performance.now() - t0);
      const after = process.memoryUsage();
      heapGrowth = Math.max(heapGrowth, after.heapUsed - before);
      rss = Math.max(rss, after.rss);
    }
    const ms = median(times);
    if (ms > worst.ms) worst = { name, ms };
    const end = `minuta ${state.minute}${state.gameOver ? ' (koniec gry)' : ''}, wynik ${bundle.seasonScore(state)}, remont ${state.remontLevel}`;
    console.log(name.padEnd(26), String(run.log.length).padStart(7), mb(bodyBytes).padStart(9), ms.toFixed(0).padStart(11), Math.max(...times).toFixed(0).padStart(8), mb(heapGrowth).padStart(10), mb(rss).padStart(8), ' ', end);
  }
  console.log(`\nNajgorszy scenariusz: ${worst.name}, ${worst.ms.toFixed(0)} ms (próg ${BUDGET_MS} ms). Szczytowy RSS procesu: ${mb(process.resourceUsage().maxRSS * 1024)} MB.`);
  console.log(`Uwaga: ciało żądania ma limit ${BODY_LIMIT_BYTES / 1_000_000} MB (RUN_MAX_BODY_BYTES), więc scenariusze powyżej tego limitu serwer odrzuci przed odtwarzaniem; liczą się jako górne ograniczenie.`);
  if (worst.ms > BUDGET_MS) {
    console.error(`PRZEKROCZONO próg ${BUDGET_MS} ms.`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await measure();

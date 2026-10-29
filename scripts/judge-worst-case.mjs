// Pomiar najgorszego przypadku czasu i pamięci sędziego rankingu: odtworzenie biegu z maksymalnym dziennikiem (100 000 wpisów,
// tyle ile dopuszcza parser: RUN_MAX_LOG_ENTRIES) przez zbudowany bundle. Uruchamiany ręcznie, nie wchodzi do `npm test`:
//
//   npm run build:judge && node --expose-gc scripts/judge-worst-case.mjs [plik-bundla] [--repeat N]
//
// Bez argumentu mierzy `src/server/judgeBundle.js`. `--expose-gc` jest opcjonalne (daje dokładniejszy odczyt sterty).
// Każdy scenariusz to osobny bieg z 100 000 wpisów zgodnych z regułami parsera (`src/server/runs.ts`): minuty niemalejące i przed
// końcem sezonu, `seq` rosnące, typ polecenia krótki, polecenie do 512 znaków JSON. Zgodność sprawdza `tests/judgeWorstCase.test.ts`
// (przepuszcza każdy scenariusz przez `parseSubmission`). Sezon trwa pełne trzy miesiące gry, jeśli bieg nie kończy się bankructwem,
// więc najdroższe są biegi, które przeżywają: stąd scenariusze z planem zakupów i remontów przyjętych przez ekonomię.
//
// Limit z założeń (8 s na jedno zgłoszenie) jest tylko progiem ostrzeżenia: skrypt kończy się kodem 2, gdy go przekroczono.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const SEED = 'kiełbasa-42';
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
 * Plan zakupów i decyzji, który ekonomia przyjmuje (ten sam co w `tests/simGolden.test.ts`): ulepszenia, sprzęt, zatrudnienie i cztery
 * remonty z przyspieszeniem. Bieg z tym planem przeżywa sezon i ma duży, rozbudowany sklep, więc każdy krok minuty jest najdroższy.
 */
const PLAN = [
  [0, 6, 0, { type: 'setOrder', auto: false, manual: 6 }], [0, 6, 0, { type: 'movePallet', palletId: 1, loc: 'backroom' }],
  [0, 6, 1, { type: 'returnPallet', palletId: 2 }], [0, 6, 2, { type: 'setPriority', priority: 'klienci' }],
  [0, 6, 3, { type: 'tapPallet', palletId: 1 }], [0, 14, 10, { type: 'claimGift' }],
  [1, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }], [2, 9, 0, { type: 'hire' }], [2, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
  [3, 7, 0, { type: 'setOrder', auto: true }], [4, 12, 0, { type: 'buyEquipment', id: 'sco' }], [5, 12, 0, { type: 'buyUpgrade', id: 'wozek' }],
  [6, 12, 0, { type: 'campaign' }], [6, 12, 30, { type: 'setPriority', priority: 'palety' }], [7, 12, 0, { type: 'buyUpgrade', id: 'regaly' }],
  [9, 12, 0, { type: 'buyEquipment', id: 'bankomat' }], [10, 12, 0, { type: 'buyUpgrade', id: 'kawa' }],
  [11, 12, 0, { type: 'setOrder', auto: false, manual: 40 }], [12, 7, 0, { type: 'setOrder', auto: true, manual: 5.5 }],
  [14, 12, 0, { type: 'buyEquipment', id: 'piec', slotId: 'equipmentSlot-2' }], [16, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
  [18, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }],
  [26, 7, 0, { type: 'startRemont' }], [26, 7, 5, { type: 'rushRemont' }], [30, 7, 0, { type: 'startRemont' }], [30, 7, 5, { type: 'rushRemont' }],
  [34, 12, 0, { type: 'buyUpgrade', id: 'asystent' }], [35, 12, 0, { type: 'buyUpgrade', id: 'klima' }], [36, 12, 0, { type: 'buyUpgrade', id: 'scoSoft' }],
  [37, 12, 0, { type: 'buyUpgrade', id: 'kamery' }], [38, 12, 0, { type: 'buyUpgrade', id: 'drugaKasa' }], [40, 12, 0, { type: 'buyUpgrade', id: 'traszkapka' }],
  [42, 12, 0, { type: 'buyEquipment', id: 'paczkownik' }], [44, 12, 0, { type: 'buyUpgrade', id: 'nocne' }], [46, 12, 0, { type: 'hire' }],
  [48, 12, 0, { type: 'setPriority', priority: 'rowno' }], [50, 12, 0, { type: 'fire' }], [50, 12, 5, { type: 'setPriority', priority: 'klienci' }],
  [52, 12, 0, { type: 'buyUpgrade', id: 'rampa' }], [56, 12, 0, { type: 'buyUpgrade', id: 'tasmociag' }],
  [62, 7, 0, { type: 'startRemont' }], [62, 7, 5, { type: 'rushRemont' }], [66, 7, 0, { type: 'startRemont' }], [66, 7, 5, { type: 'rushRemont' }],
  [68, 12, 0, { type: 'buyUpgrade', id: 'wykladacz' }], [72, 12, 0, { type: 'buyUpgrade', id: 'dostawy2' }], [78, 12, 0, { type: 'campaign' }],
  [80, 12, 0, { type: 'buyEquipment', id: 'sco', slotId: 'equipmentSlot-4' }],
  [84, 7, 0, { type: 'startRemont' }], [84, 7, 5, { type: 'rushRemont' }], [86, 12, 0, { type: 'campaign' }], [87, 12, 0, { type: 'hire' }],
  [88, 7, 0, { type: 'startRemont' }], [88, 7, 5, { type: 'rushRemont' }],
].map(([day, hour, minute, cmd]) => ({ minute: at(day, hour, minute), cmd }));

const SLOTS = ['equipmentSlot-1', 'equipmentSlot-2', 'equipmentSlot-3', 'equipmentSlot-4'];
const UPGRADES = ['szkolenie', 'ulotki', 'wozek', 'regaly', 'kawa', 'klima', 'kamery', 'nocne', 'rampa', 'tasmociag', 'asystent', 'drugaKasa'];
const EQUIPMENT = ['sco', 'bankomat', 'piec', 'paczkownik'];

/**
 * Każdy typ polecenia osobno: `i` to numer wpisu w scenariuszu. Pola dobrane tak, żeby polecenie przechodziło `isCommand` (nie było
 * odrzucone na wejściu) i dochodziło do logiki ekonomii: numery palet i zleceń z zakresu, które się trafiają, id z katalogów.
 */
export const COMMANDS = {
  tapPallet: (i) => ({ type: 'tapPallet', palletId: 1 + (i % 40) }),
  tapPalletAny: () => ({ type: 'tapPallet' }),
  tapTill: () => ({ type: 'tapTill' }),
  claimQuest: (i) => ({ type: 'claimQuest', questId: 1 + (i % 200) }),
  claimGift: () => ({ type: 'claimGift' }),
  movePallet: (i) => ({ type: 'movePallet', palletId: 1 + (i % 6), loc: ['sidewalk', 'backroom', 'floor'][i % 3] }),
  returnPallet: (i) => ({ type: 'returnPallet', palletId: 1 + (i % 6) }),
  setOrder: (i) => ({ type: 'setOrder', auto: i % 2 === 0, manual: i % 31 }),
  hire: () => ({ type: 'hire' }),
  fire: () => ({ type: 'fire' }),
  setPriority: (i) => ({ type: 'setPriority', priority: ['klienci', 'palety', 'rowno'][i % 3] }),
  buyUpgrade: (i) => ({ type: 'buyUpgrade', id: UPGRADES[i % UPGRADES.length] }),
  buyEquipment: (i) => ({ type: 'buyEquipment', id: EQUIPMENT[i % EQUIPMENT.length], slotId: SLOTS[i % SLOTS.length] }),
  startRemont: () => ({ type: 'startRemont' }),
  campaign: () => ({ type: 'campaign' }),
  rushRemont: () => ({ type: 'rushRemont' }),
};
const COMMAND_NAMES = Object.keys(COMMANDS);
/** Polecenia, które nie kończą gry bankructwem (zwolnienie i zatrudnienie bez końca, ręczne zamówienia bez zysku zrujnowałyby sklep przed końcem sezonu). */
const SAFE_NAMES = COMMAND_NAMES.filter((n) => !['setOrder', 'hire', 'fire'].includes(n));

/** Dziennik z listy `{ minute, cmd }`: stabilne ułożenie po minucie i kolejne `seq` (parser wymaga rosnących par minuta-`seq`). */
const logOf = (entries) => entries
  .map((e, order) => ({ ...e, order }))
  .sort((a, b) => a.minute - b.minute || a.order - b.order)
  .map((e, seq) => ({ minute: e.minute, seq, cmd: e.cmd }));

/** `count` wpisów rozłożonych równomiernie na całym sezonie, polecenie z `make(i)`. */
const spread = (count, endMinute, make, offset = 0) => Array.from({ length: count }, (_, i) => ({ minute: Math.floor((i * (endMinute - 1)) / count), cmd: make(i + offset) }));

/**
 * Scenariusze najgorszego przypadku, jeden po drugim (generator: każdy dziennik to 100 000 obiektów, więc nie trzymamy ich naraz).
 * `bieg bierny` to punkt odniesienia (pusty dziennik); reszta ma `LOG_ENTRIES` wpisów:
 * - `mieszanka z planem`: plan zakupów i remontów, które ekonomia przyjmuje, plus wypełniacz z wszystkich typów poleceń rozłożony na sezon;
 * - `jedna minuta`: wszystkie wpisy w jednej minucie (parser dopuszcza, bo `seq` rośnie), typy po kolei;
 * - `tylko <typ>`: sam jeden typ polecenia na całym sezonie, dla każdego typu osobno.
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
    yield { name: `tylko ${name}`, run: run(logOf(spread(LOG_ENTRIES, endMinute, COMMANDS[name]))) };
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

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { subSeed } from '@/sim/rng';
import { freshRun } from '@/sim/run';
import { generateStore } from '@/sim/store/generateStore';
import { LOT_RANGES } from '@/sim/store/lots';
import { takeoverSide } from '@/sim/store/takeover';
import { BLOCK_M, DISTRICTS } from './districts';
import { LOTS_PER_ROW, SLOT_M, STREET_HALF_M, generateCity, lotById, lotNeighbour } from './generateCity';
import { CITY_GENERATOR_VERSION, CITY_SIZE, type CityLot, type CityState, type DistrictId, type StoreDistrict } from './types';

/*
 * Generator miasta: czysta funkcja seeda (`createRng(subSeed(seed, 'city'))`). Testy idą po niezmiennikach z §20.3 specu (lokal
 * startowy na Osiedlu z lokalem sklepu z seeda, 5–8 wolnych lokali, co najmniej jeden w każdej dzielnicy innej niż neutralna,
 * konkurencja daleko od startu, każdy lokal od ulicy, każdy wolny lokal daje sklep z generatora) oraz po regułach rozmieszczenia:
 * wolny lokal nie sąsiaduje w rzędzie z wolnym ani ze startowym, a konkurencja nie stoi w rzędzie obok wolnego ani startowego
 * (lokal obok Twojego sklepu, który zajmuje remont „dokupienie lokalu obok”, nigdy nie jest sklepem konkurencji).
 */

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Skrót kanonicznego JSON-a miasta dla `kiełbasa-42`. Zmiana skrótu to zmiana miast dla tych samych seedów, więc wymaga podbicia
 * `CITY_GENERATOR_VERSION`. Raz zmieniony przed wydaniem (bez podbicia wersji, bo żadne miasto jeszcze nie wyszło do graczy):
 * Zadanie 2 wypełniło `sources` i `hourly`, lokale zostały bit w bit te z Zadania 1.
 */
const CITY_GOLDEN = '2d7d633e095712de121f1281d397acf7ab1e85ba08b678d4cbbdde587e842ea4';

const SEEDS: string[] = [
  'kiełbasa-42', 'kiełbasa-12', 'a', 'b', 'c', 'd',
  ...Array.from({ length: 12 }, (_, i) => `traszka-${i + 1}`),
  ...Array.from({ length: 25 }, (_, i) => `miasto-${i + 1}`),
];

const cities = new Map<string, CityState>();
/** Miasto z pamięci podręcznej testu: generator jest czysty, a testy niczego w stanie nie zmieniają. */
function cityOf(seed: string): CityState {
  let c = cities.get(seed);
  if (!c) { c = generateCity(seed); cities.set(seed, c); }
  return c;
}

const OTHER = { minX: 'maxX', maxX: 'minX' } as const;
const blockIndex = (l: Pick<CityLot, 'bx' | 'by'>): number => l.by * CITY_SIZE + l.bx;
const isNorthRow = (l: CityLot): boolean => l.y - l.by * BLOCK_M < BLOCK_M / 2;

/** Odległość punktu od odcinka ulicy (m). */
function distanceToStreet(l: CityLot, s: CityState['streets'][number]): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const t = Math.max(0, Math.min(1, ((l.x - s.ax) * dx + (l.y - s.ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(l.x - (s.ax + t * dx), l.y - (s.ay + t * dy));
}

/** Kwartały jednej dzielnicy tworzą jeden spójny obszar (sąsiedztwo przez bok, nie przez róg). */
function isConnected(c: CityState, district: DistrictId): boolean {
  const mine = c.blocks.map((d, i) => (d === district ? i : -1)).filter((i) => i >= 0);
  if (mine.length === 0) return false;
  const seen = new Set<number>([mine[0]!]);
  const queue = [mine[0]!];
  while (queue.length > 0) {
    const i = queue.pop()!;
    const bx = i % CITY_SIZE;
    const by = Math.floor(i / CITY_SIZE);
    for (const [nx, ny] of [[bx - 1, by], [bx + 1, by], [bx, by - 1], [bx, by + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= CITY_SIZE || ny >= CITY_SIZE) continue;
      const j = ny * CITY_SIZE + nx;
      if (c.blocks[j] === district && !seen.has(j)) { seen.add(j); queue.push(j); }
    }
  }
  return seen.size === mine.length;
}

describe('generateCity: determinizm, wersja i złoty skrót', () => {
  it('ten sam seed daje ten sam CityState (złoty skrót dla kiełbasa-42)', () => {
    expect(generateCity('kiełbasa-42')).toEqual(generateCity('kiełbasa-42'));
    expect(sha256(JSON.stringify(generateCity('kiełbasa-42')))).toBe(CITY_GOLDEN);
  });

  it('wersja generatora to 1, a różne seedy dają różne miasta', () => {
    expect(CITY_GENERATOR_VERSION).toBe(1);
    const json = new Set<string>();
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      expect(c.version).toBe(CITY_GENERATOR_VERSION);
      expect(c.name.length, seed).toBeGreaterThan(3);
      json.add(JSON.stringify(c));
    }
    expect(json.size).toBe(SEEDS.length);
    expect(new Set(SEEDS.map((s) => cityOf(s).name)).size, 'nazwy miast się różnią').toBeGreaterThan(SEEDS.length / 2);
  });

  it('generateCity nie zmienia sklepu: skrót freshRun(seed) przed i po wywołaniu jest ten sam', () => {
    for (const seed of ['kiełbasa-42', 'traszka-11', 'd', 'miasto-3']) {
      const digest = (): string => { const r = freshRun(seed); return sha256(JSON.stringify({ state: r.state, layout: r.layout, info: r.info })); };
      const before = digest();
      generateCity(seed);
      expect(digest(), seed).toBe(before);
    }
  });
});

describe('generateCity: niezmienniki §20.3', () => {
  it.each(SEEDS)('niezmienniki §20.3 dla %s', (seed) => {
    const c = cityOf(seed);
    expect(c.lots.map((l) => l.id), 'id to kolejne liczby od 0').toEqual(c.lots.map((_, i) => i));

    // lokal startowy: Osiedle, Twój, lokal sklepu z seeda
    const start = lotById(c, c.startLotId);
    expect(start.district).toBe('osiedle');
    expect(start.state).toBe('twoj');
    expect(start.spec).toEqual(generateStore(seed).lot);
    expect(c.lots.filter((l) => l.state === 'twoj')).toEqual([start]);

    // wolne: 5–8, co najmniej jeden w każdej dzielnicy innej niż neutralna
    const free = c.lots.filter((l) => l.state === 'wolny');
    expect(free.length).toBeGreaterThanOrEqual(5);
    expect(free.length).toBeLessThanOrEqual(8);
    for (const d of ['srodmiescie', 'dworzec', 'biurowce'] as const) expect(free.some((l) => l.district === d)).toBe(true);

    // konkurencja: 3–5, marka tylko u konkurencji, ≥ 2 kwartały od startu, tylko w dzielnicach z flagą `rivals` (Osiedle bez konkurencji)
    const rivals = c.lots.filter((l) => l.state === 'konkurencja');
    expect(rivals.length).toBeGreaterThanOrEqual(3);
    expect(rivals.length).toBeLessThanOrEqual(5);
    expect(c.lots.filter((l) => l.brand !== null)).toEqual(rivals);
    for (const r of rivals) {
      expect(Math.max(Math.abs(r.bx - start.bx), Math.abs(r.by - start.by)), `konkurencja ${r.id} blisko startu`).toBeGreaterThanOrEqual(2);
      expect(DISTRICTS[r.district].rivals, `konkurencja ${r.id} w dzielnicy bez flagi rivals`).toBe(true);
      // R3: nie w rzędzie bezpośrednio obok wolnego ani startowego (po żadnej stronie)
      for (const side of ['minX', 'maxX'] as const) {
        const n = lotNeighbour(c, r.id, side);
        expect(n === null || (n.state !== 'wolny' && n.state !== 'twoj'), `konkurencja ${r.id} obok ${n?.state}`).toBe(true);
      }
    }

    // każdy lokal od ulicy, dzielnica lokalu = dzielnica kwartału (nigdy park), współrzędne całkowite w mieście
    for (const l of c.lots) {
      const segment = c.streets.find((s) => s.name === l.street && distanceToStreet(l, s) <= STREET_HALF_M + 1e-9);
      expect(segment, `lokal ${l.id} (${l.street} ${l.number}) nie leży przy ulicy`).toBeDefined();
      expect(c.blocks[blockIndex(l)], `lokal ${l.id}`).toBe(l.district);
      expect(Number.isInteger(l.x) && Number.isInteger(l.y), `lokal ${l.id}: wejście w metrach całkowitych`).toBe(true);
      expect(l.x).toBeGreaterThan(0);
      expect(l.x).toBeLessThan(CITY_SIZE * BLOCK_M);
      expect(l.y).toBeGreaterThan(0);
      expect(l.y).toBeLessThan(CITY_SIZE * BLOCK_M);
    }

    // każdy wolny lokal buduje sklep (seed sklepu w lokalu: subSeed(seed, 'store:' + id))
    for (const l of free) expect(() => generateStore(subSeed(seed, `store:${l.id}`), l.spec), `wolny lokal ${l.id}`).not.toThrow();
  });
});

describe('generateCity: lokal obok', () => {
  it.each(SEEDS)('lokal obok dla %s leży po stronie przejęcia sklepu startowego i jest null tylko przy narożniku', (seed) => {
    const c = cityOf(seed);
    const layout = generateStore(seed);
    const side = takeoverSide(layout, seed);
    const obok = c.lots.filter((l) => l.state === 'obok');
    if (side === null) {
      expect(layout.lot.corner, 'null tylko przy narożniku').toBe(true);
      expect(c.neighbourLotId).toBeNull();
      expect(obok).toEqual([]);
      return;
    }
    expect(layout.lot.corner).toBe(false);
    expect(c.neighbourLotId).not.toBeNull();
    expect(obok.map((l) => l.id)).toEqual([c.neighbourLotId]);
    expect(lotNeighbour(c, c.startLotId, side)?.id).toBe(c.neighbourLotId);
    expect(lotById(c, c.neighbourLotId!).state).toBe('obok');
    // po drugiej stronie zwykły lokal (zajęty), bo lokal startowy nie jest narożny, więc sąsiaduje z obu stron
    expect(['zajety']).toContain(lotNeighbour(c, c.startLotId, OTHER[side])?.state);
  });

  it('seedy testu obejmują oba przypadki: narożnik (brak lokalu obok) i obie strony przejęcia', () => {
    const sides = new Set<string>();
    for (const seed of SEEDS) sides.add(String(takeoverSide(generateStore(seed), seed)));
    expect([...sides].sort()).toEqual(['maxX', 'minX', 'null']);
  });
});

describe('generateCity: rzędy i lokal obok (lotNeighbour)', () => {
  it('każdy rząd (kwartał, pierzeja) ma po równo lokali, ułożonych co SLOT_M, bez dziur', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const rows = new Map<string, CityLot[]>();
      for (const l of cityOf(seed).lots) rows.set(`${l.bx}:${l.by}:${l.y}`, [...(rows.get(`${l.bx}:${l.by}:${l.y}`) ?? []), l]);
      for (const [key, row] of rows) {
        expect(row.length, `${seed} rząd ${key}`).toBe(LOTS_PER_ROW);
        const xs = row.map((l) => l.x).sort((p, q) => p - q);
        xs.forEach((x, i) => expect(x - xs[0]!, `${seed} rząd ${key}`).toBe(i * SLOT_M));
      }
    }
  });

  it('konwencja osi: +x sklepu to lewa ręka patrząc z ulicy; rząd północny (front na północ) ma maxX na wschód, południowy odwrotnie', () => {
    let north = 0;
    let south = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const c = cityOf(seed);
      const rowXs = (l: CityLot): number[] => c.lots.filter((o) => o.bx === l.bx && o.by === l.by && o.y === l.y).map((o) => o.x).sort((p, q) => p - q);
      for (const l of c.lots) {
        const max = lotNeighbour(c, l.id, 'maxX');
        const min = lotNeighbour(c, l.id, 'minX');
        const east = isNorthRow(l) ? max : min;
        const west = isNorthRow(l) ? min : max;
        if (isNorthRow(l)) north++; else south++;
        // sąsiad stoi w tym samym rzędzie (kwartał, pierzeja), o jeden slot dalej na wschód albo zachód
        for (const [n, dx] of [[east, SLOT_M], [west, -SLOT_M]] as const) {
          if (n) expect([n.bx, n.by, n.y, n.x], `lokal ${l.id}`).toEqual([l.bx, l.by, l.y, l.x + dx]);
        }
        // koniec rzędu: brak sąsiada po stronie, gdzie rząd się kończy (ulica poprzeczna nie jest sąsiadem)
        const xs = rowXs(l);
        expect(east === null, `lokal ${l.id}: wschód`).toBe(l.x === xs[xs.length - 1]);
        expect(west === null, `lokal ${l.id}: zachód`).toBe(l.x === xs[0]);
        // symetria
        if (max) expect(lotNeighbour(c, max.id, 'minX')?.id).toBe(l.id);
        if (min) expect(lotNeighbour(c, min.id, 'maxX')?.id).toBe(l.id);
      }
    }
    expect(north).toBeGreaterThan(0);
    expect(south).toBeGreaterThan(0);
  });

  it('żaden wolny lokal nie sąsiaduje w rzędzie z innym wolnym ani ze startowym', () => {
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      for (const l of c.lots.filter((x) => x.state === 'wolny')) {
        for (const side of ['minX', 'maxX'] as const) {
          const n = lotNeighbour(c, l.id, side);
          expect(n === null || (n.state !== 'wolny' && n.state !== 'twoj'), `${seed}: wolny ${l.id} obok ${n?.state}`).toBe(true);
        }
      }
    }
  });

  it('lotById i lotNeighbour: nieistniejący lokal to błąd', () => {
    const c = cityOf('a');
    expect(() => lotById(c, -1)).toThrow(RangeError);
    expect(() => lotById(c, c.lots.length)).toThrow(RangeError);
    expect(() => lotNeighbour(c, c.lots.length, 'minX')).toThrow(RangeError);
  });
});

describe('generateCity: dzielnice i ulice', () => {
  it('dzielnice to spójne obszary kwartałów, park ma 1–3 kwartały i żadnego lokalu', () => {
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      expect(c.blocks, seed).toHaveLength(CITY_SIZE * CITY_SIZE);
      const count = (d: DistrictId): number => c.blocks.filter((b) => b === d).length;
      for (const d of ['osiedle', 'srodmiescie', 'dworzec', 'biurowce'] as const) {
        expect(isConnected(c, d), `${seed}: ${d} spójne`).toBe(true);
        expect(count(d), `${seed}: ${d} ma kilka kwartałów`).toBeGreaterThanOrEqual(4);
      }
      expect(isConnected(c, 'park'), `${seed}: park spójny`).toBe(true);
      expect(count('park')).toBeGreaterThanOrEqual(1);
      expect(count('park')).toBeLessThanOrEqual(3);
      expect(c.lots.filter((l) => c.blocks[blockIndex(l)] === 'park'), `${seed}: park bez lokali`).toEqual([]);
      expect(c.blocks[blockIndex(lotById(c, c.startLotId))]).toBe('osiedle');
    }
  });

  it('ulice: 14 różnych nazw, 84 odcinki z profilem na 24 godziny, adresy lokali się nie powtarzają', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const c = cityOf(seed);
      expect(new Set(c.streets.map((s) => s.name)).size, seed).toBe(2 * (CITY_SIZE + 1));
      expect(c.streets, seed).toHaveLength(2 * CITY_SIZE * (CITY_SIZE + 1));
      expect(c.streets.map((s) => s.id)).toEqual(c.streets.map((_, i) => i));
      for (const s of c.streets) {
        expect(s.hourly, `${seed} ulica ${s.id}`).toHaveLength(24);
        expect(Math.abs(s.bx - s.ax) + Math.abs(s.by - s.ay), 'odcinek to jeden kwartał').toBe(BLOCK_M);
      }
      const addresses = c.lots.map((l) => `${l.street} ${l.number}`);
      expect(new Set(addresses).size, seed).toBe(addresses.length);
      for (const l of c.lots) expect(Number.isInteger(l.number) && l.number >= 1, `lokal ${l.id}`).toBe(true);
    }
  });
});

describe('generateCity: lokale (format, pakiet, budowa)', () => {
  it('format lokalu zgadza się z lotKind dzielnicy, a wymiary mieszczą się w LOT_RANGES (poza startowym, który ma lokal sklepu z seeda)', () => {
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      for (const l of c.lots.filter((x) => x.id !== c.startLotId)) {
        const r = LOT_RANGES[l.spec.kind];
        expect(l.spec.kind, `${seed} lokal ${l.id}`).toBe(DISTRICTS[l.district].lotKind);
        expect(l.spec.interiorWidth).toBeGreaterThanOrEqual(r.interiorWidth[0]);
        expect(l.spec.interiorWidth).toBeLessThanOrEqual(r.interiorWidth[1]);
        expect(l.spec.salesDepth).toBeGreaterThanOrEqual(r.salesDepth[0]);
        expect(l.spec.salesDepth).toBeLessThanOrEqual(r.salesDepth[1]);
        expect(l.spec.backroomDepth).toBeGreaterThanOrEqual(r.backroomDepth[0]);
        expect(l.spec.backroomDepth).toBeLessThanOrEqual(r.backroomDepth[1]);
        if (r.cornerChance === 0) expect(l.spec.corner).toBe(false);
      }
    }
  });

  it('narożnik stoi na końcu rzędu, a lokal startowy stoi na końcu rzędu dokładnie wtedy, gdy jest narożny', () => {
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      for (const l of c.lots) {
        const atEnd = lotNeighbour(c, l.id, 'minX') === null || lotNeighbour(c, l.id, 'maxX') === null;
        if (l.spec.corner) expect(atEnd, `${seed} narożnik ${l.id} nie na końcu rzędu`).toBe(true);
      }
      const start = lotById(c, c.startLotId);
      const startAtEnd = lotNeighbour(c, start.id, 'minX') === null || lotNeighbour(c, start.id, 'maxX') === null;
      expect(startAtEnd, `${seed}: lokal startowy na końcu rzędu dokładnie wtedy, gdy narożny`).toBe(start.spec.corner);
    }
  });

  it('pakiet otwarcia: w widełkach dzielnicy, wielokrotność 100 zł, rośnie z metrażem, najwyższy dla narożnej kamienicy; dni budowy w widełkach', () => {
    let cornerKamienice = 0;
    const byClass = new Map<string, CityLot[]>();
    for (const seed of SEEDS) {
      for (const l of cityOf(seed).lots) {
        const def = DISTRICTS[l.district as StoreDistrict];
        expect(l.package, `lokal ${l.id}`).toBeGreaterThanOrEqual(def.package[0]);
        expect(l.package).toBeLessThanOrEqual(def.package[1]);
        expect(l.package % 100).toBe(0);
        expect(Number.isInteger(l.buildDays)).toBe(true);
        expect(l.buildDays).toBeGreaterThanOrEqual(def.buildDays[0]);
        expect(l.buildDays).toBeLessThanOrEqual(def.buildDays[1]);
        if (l.spec.kind === 'kamienica' && l.spec.corner) {
          cornerKamienice++;
          expect(l.package, `narożna kamienica ${l.id}`).toBe(def.package[1]);
        } else {
          expect(l.package, `lokal ${l.id} nie jest narożną kamienicą`).toBeLessThan(def.package[1]);
        }
        const cls = `${l.district}:${l.spec.kind}:${l.spec.corner}`;
        byClass.set(cls, [...(byClass.get(cls) ?? []), l]);
      }
    }
    expect(cornerKamienice, 'zestaw seedów ma narożne kamienice').toBeGreaterThan(5);
    // w obrębie dzielnicy, rodzaju i narożnika większy metraż (szerokość × głębokość sali) nie jest tańszy
    for (const [cls, lots] of byClass) {
      const sorted = [...lots].sort((p, q) => p.spec.interiorWidth * p.spec.salesDepth - q.spec.interiorWidth * q.spec.salesDepth);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]!.spec;
        const b = sorted[i]!.spec;
        if (a.interiorWidth * a.salesDepth < b.interiorWidth * b.salesDepth) {
          expect(sorted[i]!.package, `${cls}: większy metraż, wyższy pakiet`).toBeGreaterThanOrEqual(sorted[i - 1]!.package);
        }
      }
    }
  });
});

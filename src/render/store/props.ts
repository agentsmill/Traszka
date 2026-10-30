import { Group, IcosahedronGeometry, Mesh, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';
import { PALETTE } from '@/render/style';
import {
  BRAND, FIX, box, cachedTexture, canvasTexture, cyl, fabricMat, font, gloss, matte, painted, plane, texturedMaterial, woodMat,
  wrapLines, type Vec3,
} from './parts';
import { drawNewt } from './signTexture';
import { tr } from '@/i18n';

/**
 * Rekwizyty, które niosą humor i życie sceny (zadanie 16): plakaty Centrali, mata „Witamy w Traszce”, tabliczka
 * „Tylko dla personelu”, hasła na pasie marki, donica z krzewem, stojak z gazetami, potykacz z hasłem dnia, ławka i kosz.
 *
 * Humor (docs/style-guide.md §6): teksty po polsku, satyra na Centralę i absurdy sieci, nigdy na kasjera ani klienta,
 * bez prawdziwych marek. Kolory wyłącznie z PALETTE. Geometrie, tekstury i materiały są współdzielone (cache parts.ts).
 *
 * Rekwizyty uliczne (donica, stojak, potykacz, ławka, kosz) stoją w wierszu 0 chodnika, który symulacja blokuje dla
 * klientów (src/sim/crowd/crowd.ts, ruling R32), więc nikt przez nie nie przechodzi. W sali sklepu nie stawiamy niczego
 * na podłodze: symulacja nie zna rekwizytów, a klient przeszedłby przez donicę.
 */

const INK = BRAND.greenDark;

// --- Plakaty Centrali -----------------------------------------------------------------------------------------------

export interface Poster { title: string; footer: string }

/** Plakaty na ścianach sali: nagłówek ≤ 6 słów (przewodnik §6), stopka podpisuje nadawcę. */
export const POSTERS: readonly Poster[] = [
  { title: 'KPI to stan umysłu.', footer: '— Centrala' },
  { title: 'Promocja: 3 w cenie 3!', footer: 'Tylko w Traszce' },
  { title: 'Nadgodziny budują charakter.', footer: '— Centrala' },
  { title: 'Ogonki: chrupią, więc zdrowe.', footer: 'Ogonki. Chrup i wróć' },
  { title: 'Uśmiech to też procedura.', footer: '— Dział Procedur' },
  { title: 'Nowy regulamin! Stary też obowiązuje.', footer: '— Centrala' },
];

function posterTexture(p: Poster): Texture {
  return cachedTexture(`poster|${p.title}`, () => canvasTexture(256, 352, (ctx, w, h) => {
    ctx.fillStyle = BRAND.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.green;
    ctx.fillRect(0, 0, w, 72);
    drawNewt(ctx, 62, 40, 84, BRAND.orange, BRAND.cream, BRAND.greenDark);
    ctx.fillStyle = BRAND.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(34, '900');
    ctx.fillText('TRASZKA', 168, 40);
    ctx.fillStyle = INK;
    ctx.font = font(40, '900');
    const lines = wrapLines(ctx, tr(p.title), w - 36);
    lines.forEach((l, i) => ctx.fillText(l, w / 2, 160 + (i - (lines.length - 1) / 2) * 46));
    ctx.fillStyle = BRAND.orange;
    ctx.fillRect(0, h - 58, w, 58);
    ctx.fillStyle = BRAND.cream;
    ctx.font = font(22);
    ctx.fillText(tr(p.footer), w / 2, h - 29);
    ctx.strokeStyle = BRAND.greenDark;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  }));
}

/** Plakat na ścianie w układzie linii ściany (u wzdłuż ściany, +z do sali): rama i nadruk. */
export function buildPoster(g: Group, u: number, p: Poster): void {
  box(g, [0.5, 0.68, 0.012], [u, 1.4, 0.006], matte(BRAND.cream), { name: 'poster frame' });
  plane(g, [0.46, 0.64], [u, 1.42 + 0.32, 0.0125], texturedMaterial(`poster|${p.title}`, posterTexture(p), { roughness: 0.6 }), { name: 'poster' });
}

// --- Mata przy wejściu ----------------------------------------------------------------------------------------------

function matTexture(): Texture {
  return cachedTexture('doormat', () => canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = BRAND.greenDark;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = BRAND.orange;
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    drawNewt(ctx, 86, 92, 100, BRAND.orange, BRAND.cream, BRAND.greenDark);
    ctx.fillStyle = BRAND.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(78, '900');
    ctx.fillText(tr('WITAMY'), w / 2 + 52, 82);
    ctx.font = font(50, '900');
    ctx.fillText(tr('W TRASZCE'), w / 2 + 52, 146);
    ctx.fillStyle = BRAND.orange;
    ctx.font = font(30);
    ctx.fillText(tr('Centrala widzi, że wchodzisz'), w / 2, 236);
    ctx.font = font(24);
    ctx.fillText(tr('(i liczy to jako wizytę)'), w / 2, 272);
  }));
}

/**
 * Mata „Witamy w Traszce” na podłodze przy wejściu, w układzie świata: środek (x, z), napis czytelny od wejścia
 * (spód napisu od strony ulicy, −z). Wycieraczka to `fabric` (przewodnik §3).
 */
export function buildDoormat(g: Group, x: number, z: number): void {
  box(g, [1.0, 0.025, 0.62], [x, 0.004, z], fabricMat(BRAND.greenDark), { name: 'doormat', seg: 1, radius: 0.008 });
  plane(g, [0.94, 0.56], [x, 0.0305, z], texturedMaterial('doormat', matTexture(), { roughness: 0.95 }), {
    rot: [-Math.PI / 2, 0, 0], receive: true, name: 'doormat top',
  });
}

// --- Tabliczka „Tylko dla personelu” --------------------------------------------------------------------------------

function staffOnlyTexture(): Texture {
  return cachedTexture('staffOnly', () => canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = BRAND.orange;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.cream;
    ctx.fillRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(30, '900');
    ctx.fillText(tr('TYLKO DLA'), w / 2, 34);
    ctx.fillText(tr('PERSONELU'), w / 2, 66);
    ctx.fillStyle = BRAND.orange;
    ctx.font = font(17);
    ctx.fillText(tr('i dla kontroli z Centrali'), w / 2, 100);
  }));
}

/** Tabliczka na skrzydle drzwi: `at` = środek, zwrócona w −z (do sali) w układzie rodzica. */
export function buildStaffOnlySign(g: Object3D, at: Vec3): void {
  box(g, [0.36, 0.2, 0.012], [at[0], at[1] - 0.1, at[2] + 0.006], painted(BRAND.orange), { name: 'staff sign', seg: 1, radius: 0.005 });
  plane(g, [0.34, 0.17], [at[0], at[1], at[2] - 0.001], texturedMaterial('staffOnly', staffOnlyTexture(), { roughness: 0.5 }), {
    rot: [0, Math.PI, 0], name: 'staff sign face',
  });
}

// --- Hasła na pasie marki (górny pas ścian sali) --------------------------------------------------------------------

/**
 * Hasła na jasnozielonym pasie u góry ścian sali. Duże litery (0,25 m), więc to te żarty czyta się z domyślnego
 * zoomu (przewodnik §6: ≥ 3 żarty w kadrze). Ściany od strony kamery są w przekroju obniżone, więc widać hasła
 * na ścianach dalszych.
 */
export const SLOGANS: readonly string[] = [
  'CENTRALA CZUWA 24/7 (W GODZ. 9–15)',
  'KPI TO STAN UMYSŁU',
  'NOWOŚĆ! STARA CENA W NOWYM KOLORZE',
  'CENTRALA: BLISKO TABELKI',
  'PROMOCJA: 3 W CENIE 3!',
  'TU MIAŁA BYĆ PODWYŻKA',
  'OGONKI: TERAZ 10% WIĘCEJ OGONKA',
  'ZAWSZE OTWARTE. JAK PROCEDURY',
];

const SLOGAN_PX_PER_M = 160;

/**
 * Tekstura pasa z hasłami na odcinek ściany długości `lengthM`: kolejne hasła z `order` (indeksy SLOGANS), rozdzielone
 * logo traszki, wyśrodkowane; mieści tyle, ile wejdzie bez ucinania (`used`: indeksy, które weszły). Tło w kolorze pasa
 * `wall[1]`. Tekstura jest nowa (per sklep): zwalnia ją właściciel.
 */
export function sloganTexture(order: readonly number[], lengthM: number, heightM: number): { texture: Texture; used: number[] } {
  const w = Math.max(64, Math.min(2048, Math.round(lengthM * SLOGAN_PX_PER_M)));
  const h = Math.max(32, Math.round(heightM * SLOGAN_PX_PER_M));
  const used: number[] = [];
  const texture = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = PALETTE.wall[1];
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.green;
    ctx.fillRect(0, h - 6, w, 6);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(Math.round(h * 0.52), '900');
    const icon = h * 0.95;
    const gap = h * 0.35;
    const parts: string[] = [];
    let width = 0;
    for (const i of order) {
      const text = tr(SLOGANS[i % SLOGANS.length]!);
      const tw = ctx.measureText(text).width;
      const add = (parts.length ? icon + 2 * gap : 0) + tw;
      if (width + add > w - 2 * gap) continue;   // za długie na resztę pasa: może zmieści się krótsze
      parts.push(text);
      used.push(i);
      width += add;
    }
    let x = (w - width) / 2;
    parts.forEach((text, i) => {
      if (i > 0) {
        x += gap;
        drawNewt(ctx, x + icon / 2, h * 0.47, icon, BRAND.orange, BRAND.cream, INK);
        x += icon + gap;
      }
      ctx.fillStyle = INK;
      ctx.fillText(text, x, h * 0.5);
      x += ctx.measureText(text).width;
    });
  });
  // w Node (atrapa tekstury) nic nie rysujemy, ale kolejne odcinki i tak mają dostać kolejne hasła
  if (used.length === 0 && typeof document === 'undefined' && order.length) used.push(order[0]!);
  return { texture, used };
}

/**
 * Maska poświaty witryny na chodniku (noc): jasno przy ścianie, zanika na zewnątrz i na końcach odcinka. Biała maska,
 * kolor i siłę daje materiał (addytywny).
 */
export function windowGlowTexture(): Texture {
  return cachedTexture('windowGlow', () => canvasTexture(256, 128, (ctx, w, h) => {
    const v = ctx.createLinearGradient(0, h, 0, 0);
    v.addColorStop(0, 'rgba(255,255,255,0.95)');
    v.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    const u = ctx.createLinearGradient(0, 0, w, 0);
    u.addColorStop(0, 'rgba(255,255,255,0)');
    u.addColorStop(0.18, 'rgba(255,255,255,1)');
    u.addColorStop(0.82, 'rgba(255,255,255,1)');
    u.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = u;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }));
}

// --- Rekwizyty uliczne (wiersz 0 chodnika) ------------------------------------------------------------------------

const leafGeometry = (() => {
  let g: BufferGeometry | null = null;
  return (): BufferGeometry => (g ??= new IcosahedronGeometry(1, 1));
})();

/** Kulista kępka liści (spłaszczony ikosaedr: kanciasto-miękki, jak meble). */
function leafBall(g: Object3D, r: number, at: Vec3, color: string, squash = 0.8): Mesh {
  const mesh = new Mesh(leafGeometry(), matte(color));
  mesh.scale.set(r, r * squash, r);
  mesh.position.set(...at);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'leaves';
  g.add(mesh);
  return mesh;
}

/** Donica miejska z krzewem i kwiatkami (Centrala sponsoruje zieleń, więc donica ma pas marki). Przód to +z. */
export function buildPlanter(): Group {
  const g = new Group();
  g.name = 'prop:planter:0';
  const concrete = matte(PALETTE.street.curb[0]);
  box(g, [1.0, 0.08, 0.5], [0, 0, 0], matte(PALETTE.street.curb[1]), { name: 'planter base' });
  box(g, [0.94, 0.44, 0.44], [0, 0.06, 0], concrete, { name: 'planter' });
  box(g, [0.95, 0.07, 0.45], [0, 0.32, 0], matte(BRAND.green), { name: 'planter band' });
  box(g, [0.84, 0.03, 0.34], [0, 0.48, 0], matte(PALETTE.wall[4]), { name: 'soil' });
  const greens = [BRAND.green, PALETTE.productCategory.napoje[3], PALETTE.productCategory.przekaski[3]];
  // kępki mieszczą się w głębokości donicy (wiersz 0 chodnika ma 0,5 m, za nim chodzą klienci)
  leafBall(g, 0.22, [-0.24, 0.66, 0], greens[0]!);
  leafBall(g, 0.23, [0.08, 0.72, 0.01], greens[1]!);
  leafBall(g, 0.2, [0.32, 0.64, -0.01], greens[2]!);
  leafBall(g, 0.17, [-0.05, 0.9, 0], greens[1]!);
  const flowers = [BRAND.orange, PALETTE.productCategory.slodycze[4], PALETTE.productCategory.przekaski[0]];
  ([[-0.3, 0.8, 0.15], [0.02, 0.96, 0.14], [0.3, 0.78, 0.13], [0.16, 0.86, -0.17], [-0.14, 0.76, -0.17]] as Vec3[])
    .forEach((p, i) => leafBall(g, 0.05, p, flowers[i % flowers.length]!, 1));
  return g;
}

function newspaperTexture(): Texture {
  return cachedTexture('newspapers', () => canvasTexture(384, 192, (ctx, w, h) => {
    const papers = [
      { mast: 'GŁOS OSIEDLA', head: 'CENTRALA: REKORDOWY KWARTAŁ', bg: BRAND.cream },
      { mast: 'KURIER', head: 'OGONKI DROŻSZE O 0,01', bg: PALETTE.wall[0] },
      { mast: 'PLOTKA DNIA', head: 'NAUKOWCY: PONIEDZIAŁEK ISTNIEJE', bg: BRAND.cream },
    ];
    const pw = w / 3;
    papers.forEach((p, i) => {
      const x = i * pw;
      ctx.fillStyle = p.bg;
      ctx.fillRect(x + 4, 4, pw - 8, h - 8);
      ctx.fillStyle = i === 1 ? BRAND.orange : INK;
      ctx.fillRect(x + 4, 4, pw - 8, 34);
      ctx.fillStyle = BRAND.cream;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font(20, '900');
      ctx.fillText(tr(p.mast), x + pw / 2, 22);
      ctx.fillStyle = INK;
      ctx.font = font(19, '900');
      wrapLines(ctx, tr(p.head), pw - 18).forEach((l, k) => ctx.fillText(l, x + pw / 2, 62 + k * 22));
      ctx.fillStyle = PALETTE.street.sidewalk[3];
      for (let r = 0; r < 4; r++) ctx.fillRect(x + 14, 128 + r * 12, pw - 28, 5);
    });
  }));
}

/** Stojak z gazetami: metalowy stelaż w zieleni marki, pochyła półka z trzema tytułami (żarty o Centrali). Przód to +z. */
export function buildNewsStand(): Group {
  const g = new Group();
  g.name = 'prop:newsstand:0';
  const frame = painted(BRAND.greenDark);
  for (const sx of [-0.33, 0.33]) box(g, [0.05, 1.05, 0.05], [sx, 0, -0.1], frame, { name: 'stand post' });
  box(g, [0.76, 0.06, 0.36], [0, 0, 0], frame, { name: 'stand foot' });
  box(g, [0.72, 0.5, 0.04], [0, 0.42, -0.02], matte(BRAND.green), { name: 'stand board', rot: [-0.32, 0, 0] });
  box(g, [0.76, 0.12, 0.06], [0, 1.02, -0.1], matte(BRAND.orange), { name: 'stand header' });
  plane(g, [0.68, 0.34], [0, 0.69, 0.06], texturedMaterial('newspapers', newspaperTexture(), { roughness: 0.8 }), {
    rot: [-0.32, 0, 0], name: 'newspapers',
  });
  for (let i = 0; i < 3; i++) box(g, [0.2, 0.05, 0.16], [-0.22 + i * 0.22, 0.06, 0.06], matte(i === 1 ? PALETTE.wall[0] : BRAND.cream), { name: 'paper stack' });
  return g;
}

/** Hasła dnia na potykaczu (kreda na zielonej tablicy). Krótkie, bo litery mają być duże. */
export const BOARD_LINES: readonly string[][] = [
  ['HOT-DOG', 'DNIA:', 'TEN SAM', 'CO WCZORAJ'],
  ['OTWARTE!', 'CENTRALA', 'KAZAŁA'],
  ['KAWA', '+ DROŻDŻÓWKA', '= SENS', 'ŻYCIA'],
  ['DZIŚ', 'PROMOCJA:', '3 W CENIE 3'],
];

function boardTexture(lines: readonly string[]): Texture {
  return cachedTexture(`board|${lines.join('/')}`, () => canvasTexture(192, 256, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.fixture.fridgeFrame;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = PALETTE.fixture.wood;
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, w - 14, h - 14);
    drawNewt(ctx, w / 2, 40, 76, BRAND.orange, BRAND.cream, PALETTE.fixture.fridgeFrame);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const shown = tr(lines.join('|')).split('|');   // wiersze potykacza w języku gracza (klucz: wiersze sklejone `|`)
    const step = Math.min(44, 176 / shown.length);
    shown.forEach((l, i) => {
      ctx.fillStyle = i % 2 ? BRAND.orange : BRAND.cream;
      ctx.font = font(Math.min(38, Math.floor((w - 30) / Math.max(4, l.length) * 1.7)), '900');
      ctx.fillText(l, w / 2, 90 + i * step);
    });
  }));
}

/** Potykacz (tablica w kształcie litery A) z hasłem dnia po obu stronach. Przód to +z. */
export function buildSandwichBoard(lines: readonly string[]): Group {
  const g = new Group();
  g.name = 'prop:board:0';
  const tilt = 0.2;
  const mat: Material = texturedMaterial(`board|${lines.join('/')}`, boardTexture(lines), { roughness: 0.85 });
  for (const side of [1, -1]) {
    const leg = new Group();
    leg.rotation.x = side * -tilt;
    leg.position.z = side * 0.02;
    box(leg, [0.6, 0.88, 0.035], [0, 0, side * 0.02], woodMat(FIX.wood), { name: 'board frame' });
    plane(leg, [0.5, 0.68], [0, 0.48, side * 0.04], mat, { rot: [0, side === 1 ? 0 : Math.PI, 0], name: 'board face' });
    g.add(leg);
  }
  return g;
}

function drawPylon(ctx: CanvasRenderingContext2D, w: number, h: number, glowOnly: boolean): void {
  ctx.fillStyle = glowOnly ? '#000000' : BRAND.green;
  ctx.fillRect(0, 0, w, h);
  if (!glowOnly) {
    ctx.strokeStyle = BRAND.greenDark;
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  }
  drawNewt(ctx, w / 2, 96, 200, BRAND.orange, BRAND.cream, glowOnly ? BRAND.cream : BRAND.greenDark);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = BRAND.cream;
  ctx.font = font(52, '900');
  ctx.fillText('TRASZKA', w / 2, 196);
  ctx.fillStyle = BRAND.orange;
  ctx.font = font(44, '900');
  ctx.fillText('24h', w / 2, 262);
}

/** Szyld pylonu (dwustronny kaseton): logo, nazwa i „24h”. Mapa koloru i maska świecenia (neon nocą). */
export function pylonTextures(): { map: Texture; glow: Texture } {
  return {
    map: cachedTexture('pylon|map', () => canvasTexture(256, 304, (ctx, w, h) => drawPylon(ctx, w, h, false))),
    glow: cachedTexture('pylon|glow', () => canvasTexture(256, 304, (ctx, w, h) => drawPylon(ctx, w, h, true))),
  };
}

/**
 * Pylon z kasetonem „TRASZKA 24h” przy krawężniku. W przekroju ściana frontowa (z szyldem) jest obniżona, więc to on
 * niesie markę i neon nocą w domyślnym kadrze. `face`: materiał lic kasetonu (per ulica, bo noc zmienia jego świecenie).
 * Wąski (0,9 m) i niski (2,45 m), stoi 1,75 m przed witryną: zasłania co najwyżej pas podłogi tuż za murem frontu.
 */
export function buildPylon(face: Material): Group {
  const g = new Group();
  g.name = 'prop:pylon:0';
  box(g, [0.5, 0.14, 0.36], [0, 0, 0], matte(PALETTE.street.curb[1]), { name: 'pylon base' });
  box(g, [0.14, 1.5, 0.14], [0, 0.12, 0], painted(BRAND.greenDark), { name: 'pylon pole' });
  box(g, [0.94, 1.0, 0.24], [0, 1.45, 0], gloss(BRAND.orange), { name: 'pylon rim' });
  box(g, [0.86, 0.92, 0.25], [0, 1.49, 0], matte(BRAND.green), { name: 'pylon cabinet' });
  for (const side of [1, -1]) {
    plane(g, [0.8, 0.86], [0, 1.95, side * 0.127], face, { rot: [0, side === 1 ? 0 : Math.PI, 0], name: 'pylon face' });
  }
  return g;
}

/** Ławka z deskami: siedzisko drewniane, oparcie w zieleni marki (ławka sponsorowana przez Centralę), stalowe boki. Przód to +z. */
export function buildBench(): Group {
  const g = new Group();
  g.name = 'prop:bench:0';
  const frame = painted(PALETTE.fixture.fridgeFrame);
  for (const sx of [-0.72, 0.72]) {
    box(g, [0.07, 0.42, 0.44], [sx, 0, 0.02], frame);
    box(g, [0.07, 0.4, 0.07], [sx, 0.4, -0.2], frame);
  }
  for (const z of [-0.12, 0.0, 0.12]) box(g, [1.7, 0.04, 0.1], [0, 0.42, z + 0.04], woodMat(FIX.wood));
  for (const y of [0.56, 0.7]) box(g, [1.7, 0.1, 0.03], [0, y, -0.2], matte(BRAND.green), { rot: [-0.12, 0, 0] });
  return g;
}

/** Kosz uliczny: ciemnozielony walec z kremowym pasem i metalowym rantem. */
export function buildBin(): Group {
  const g = new Group();
  g.name = 'prop:bin:0';
  cyl(g, 0.21, 0.74, [0, 0.37, 0], painted(BRAND.greenDark), { segs: 16 });
  cyl(g, 0.215, 0.12, [0, 0.52, 0], matte(BRAND.cream), { segs: 16 });
  cyl(g, 0.24, 0.06, [0, 0.77, 0], painted(FIX.metal), { segs: 16 });
  cyl(g, 0.17, 0.04, [0, 0.82, 0], painted(PALETTE.fixture.fridgeFrame), { segs: 16 });
  return g;
}

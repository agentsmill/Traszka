import { describe, expect, it } from 'vitest';
import { ARROW_INSET, GAP, MARGIN, RING, blockersAround, clipRect, inflate, intersects, placeBubble, type Placement, type Rect, type Size } from './layout';

const PHONE: Size = { w: 390, h: 844 };
const DESK: Size = { w: 1280, h: 800 };
const BUBBLE: Size = { w: 340, h: 150 };
const DESK_BUBBLE: Size = { w: 360, h: 150 };
/** Arkusz zakładki na telefonie (ui.css: od dołu nad zakładkami 60 px, do 62vh) i panel na desktopie (390 px z prawej, od 64 do 728 px). */
const PHONE_SHEET: Rect = { x: 0, y: 261, w: 390, h: 523 };
const DESK_PANEL: Rect = { x: 878, y: 64, w: 390, h: 664 };

const boxOf = (p: Placement, size: Size): Rect => ({ x: p.x, y: p.y, w: size.w, h: size.h });
const inside = (r: Rect, view: Size): boolean => r.x >= MARGIN - 1e-9 && r.y >= MARGIN - 1e-9 && r.x + r.w <= view.w - MARGIN + 1e-9 && r.y + r.h <= view.h - MARGIN + 1e-9;

describe('placeBubble: układy z gry', () => {
  it('bez celu: dymek na środku ekranu', () => {
    const p = placeBubble(null, BUBBLE, PHONE);
    expect(p.side).toBe('center');
    expect(p.x).toBe((PHONE.w - BUBBLE.w) / 2);
    expect(p.y).toBe((PHONE.h - BUBBLE.h) / 2);
    expect(p.covers).toBe(false);
  });

  it('element paska u góry (gotówka, zaufanie, czas): dymek pod nim, strzałka w środek elementu', () => {
    const cash: Rect = { x: 52, y: 8, w: 110, h: 30 };
    const p = placeBubble(cash, BUBBLE, PHONE);
    expect(p.side).toBe('below');
    expect(p.y).toBe(cash.y + cash.h + RING + GAP);
    expect(p.x + p.arrow).toBeCloseTo(cash.x + cash.w / 2, 6);
    expect(intersects(boxOf(p, BUBBLE), cash)).toBe(false);
  });

  it('zakładki na dole: dymek nad nimi', () => {
    const tabs: Rect = { x: 0, y: 784, w: 390, h: 60 };
    const p = placeBubble(tabs, BUBBLE, PHONE);
    expect(p.side).toBe('above');
    expect(p.y + BUBBLE.h).toBe(tabs.y - RING - GAP);
  });

  it('kliker w prawym dolnym rogu: dymek nad nim, docięty do prawego marginesu', () => {
    const clicker: Rect = { x: 316, y: 600, w: 62, h: 172 };
    const p = placeBubble(clicker, BUBBLE, PHONE);
    expect(p.side).toBe('above');
    expect(p.x + BUBBLE.w).toBeLessThanOrEqual(PHONE.w - MARGIN);
    expect(p.arrow).toBeLessThanOrEqual(BUBBLE.w - ARROW_INSET);
  });

  it('cel w arkuszu telefonu („Ręcznie”): dymek nad arkuszem, poza arkuszem, strzałka w stronę celu', () => {
    const manual: Rect = { x: 200, y: 340, w: 170, h: 34 };
    const p = placeBubble(manual, BUBBLE, PHONE, PHONE_SHEET);
    expect(p.side).toBe('above');
    expect(p.y + BUBBLE.h).toBe(PHONE_SHEET.y - GAP);
    expect(intersects(boxOf(p, BUBBLE), PHONE_SHEET)).toBe(false);
    expect(p.x + p.arrow).toBeCloseTo(Math.min(manual.x + manual.w / 2, p.x + BUBBLE.w - ARROW_INSET), 6);
  });

  it('cały arkusz jako cel (Cele): dymek nad arkuszem', () => {
    const p = placeBubble(PHONE_SHEET, BUBBLE, PHONE);
    expect(p.side).toBe('above');
    expect(intersects(boxOf(p, BUBBLE), inflate(PHONE_SHEET, RING))).toBe(false);
    expect(p.covers).toBe(false);
  });

  it('cel w panelu desktopu („Ręcznie” w prawej połowie panelu): dymek po lewej stronie panelu', () => {
    const manual: Rect = { x: 1075, y: 150, w: 170, h: 34 };
    const p = placeBubble(manual, DESK_BUBBLE, DESK, DESK_PANEL);
    expect(p.side).toBe('left');
    expect(p.x + DESK_BUBBLE.w).toBe(DESK_PANEL.x - GAP);
    expect(p.y + p.arrow).toBeCloseTo(manual.y + manual.h / 2, 6);
  });

  it('cały panel desktopu jako cel: dymek po lewej', () => {
    const p = placeBubble(DESK_PANEL, DESK_BUBBLE, DESK);
    expect(p.side).toBe('left');
    expect(p.covers).toBe(false);
  });

  it('cel w kontenerze bez miejsca wokół kontenera: drugie podejście wokół samego celu', () => {
    const full: Rect = { x: 0, y: 0, w: 390, h: 844 };
    const target: Rect = { x: 20, y: 100, w: 100, h: 30 };
    const p = placeBubble(target, BUBBLE, PHONE, full);
    expect(p.side).toBe('below');
    expect(p.covers).toBe(false);
    expect(intersects(boxOf(p, BUBBLE), inflate(target, RING))).toBe(false);
  });

  it('próbuje wszystkich czterech stron: cel na środku wysokiej kolumny ma dymek z boku', () => {
    const column: Rect = { x: 20, y: 10, w: 120, h: 780 };
    const p = placeBubble(column, DESK_BUBBLE, DESK);
    expect(p.side).toBe('right');
    expect(p.covers).toBe(false);
  });

  it('cel bez miejsca dookoła: covers i pozycja w oknie', () => {
    const huge: Rect = { x: 10, y: 10, w: 370, h: 824 };
    const p = placeBubble(huge, BUBBLE, PHONE);
    expect(p.covers).toBe(true);
    expect(inside(boxOf(p, BUBBLE), PHONE)).toBe(true);
  });

  it('mniejszy (zwarty) dymek mieści się tam, gdzie pełny nie', () => {
    const card: Rect = { x: 0, y: 140, w: 390, h: 696 };
    expect(placeBubble(card, BUBBLE, PHONE).covers).toBe(true);
    const compact = placeBubble(card, { w: 340, h: 100 }, PHONE);
    expect(compact.covers).toBe(false);
    expect(compact.side).toBe('above');
  });
});

describe('placeBubble: właściwość', () => {
  it('na 500 losowych celach: bez covers dymek mieści się w oknie i nie przecina celu ani kontenera', () => {
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 500; i++) {
      const view = rnd() < 0.5 ? PHONE : DESK;
      const size = { w: Math.min(360, view.w - 24), h: 80 + Math.floor(rnd() * 120) };
      const w = 10 + rnd() * view.w * 0.6;
      const h = 10 + rnd() * view.h * 0.5;
      const target: Rect = { x: rnd() * (view.w - w), y: rnd() * (view.h - h), w, h };
      const container = rnd() < 0.3 ? (view === PHONE ? PHONE_SHEET : DESK_PANEL) : null;
      const p = placeBubble(target, size, view, container);
      if (p.covers) continue;
      const box = boxOf(p, size);
      expect(inside(box, view), JSON.stringify({ target, view })).toBe(true);
      expect(intersects(box, target), JSON.stringify({ target, view })).toBe(false);
      expect(p.arrow).toBeGreaterThanOrEqual(p.side === 'center' ? 0 : ARROW_INSET);
    }
  });
});

describe('clipRect i intersects', () => {
  it('przycina do przodków, a cel przewinięty w całości daje null', () => {
    const body: Rect = { x: 0, y: 300, w: 390, h: 480 };
    expect(clipRect({ x: 10, y: 280, w: 100, h: 40 }, [body])).toEqual({ x: 10, y: 300, w: 100, h: 20 });
    expect(clipRect({ x: 10, y: 800, w: 100, h: 40 }, [body])).toBeNull();
    expect(clipRect({ x: 10, y: 400, w: 100, h: 40 }, [])).toEqual({ x: 10, y: 400, w: 100, h: 40 });
  });

  it('stykające się prostokąty się nie przecinają', () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
  });
});

describe('blockersAround', () => {
  const area = (rs: Rect[]): number => rs.reduce((n, r) => n + r.w * r.h, 0);

  it('cztery prostokąty pokrywają okno poza dziurą i nie zachodzą na nią', () => {
    const hole: Rect = { x: 100, y: 200, w: 120, h: 40 };
    const rs = blockersAround(hole, PHONE);
    expect(rs).toHaveLength(4);
    for (const r of rs) expect(intersects(r, hole)).toBe(false);
    expect(area(rs) + hole.w * hole.h).toBeCloseTo(PHONE.w * PHONE.h, 6);
  });

  it('dziura wystająca poza okno jest docinana', () => {
    const rs = blockersAround({ x: -20, y: 820, w: 100, h: 60 }, PHONE);
    for (const r of rs) {
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.h).toBeGreaterThanOrEqual(0);
    }
    expect(area(rs) + 80 * 24).toBeCloseTo(PHONE.w * PHONE.h, 6);
  });
});

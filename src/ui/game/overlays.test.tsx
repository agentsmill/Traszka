import type { ComponentChild, VNode } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ephemeral, hints, showHints } from '../state';
import { EPHEMERAL_BADGE, EPHEMERAL_NOTE, FIRST_DAY_HINTS, FirstDayHints, RESTART_CONFIRM, StoreActions, StoreBadge } from './overlays';

/** Wszystkie węzły drzewa vnode zwróconego przez komponent bez hooków (wołamy go jak zwykłą funkcję, bez DOM). */
function walk(node: ComponentChild, out: VNode<Record<string, unknown>>[] = []): VNode<Record<string, unknown>>[] {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  const vnode = node as VNode<Record<string, unknown>>;
  out.push(vnode);
  walk(vnode.props?.children as ComponentChild, out);
  return out;
}
/** Tekst widoczny w drzewie (łączy łańcuchy i liczby ze wszystkich węzłów). */
function textOf(node: ComponentChild): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as VNode<Record<string, unknown>>).props?.children as ComponentChild);
}
const buttonsOf = (tree: ComponentChild): VNode<Record<string, unknown>>[] => walk(tree).filter((v) => v.type === 'button');
const labels = (tree: ComponentChild): string[] => buttonsOf(tree).map((b) => textOf(b));

beforeEach(() => {
  ephemeral.value = false;
  showHints([]);
});
afterEach(() => {
  ephemeral.value = false;
  showHints([]);
  vi.useRealTimers();
});

describe('⚙: Nowy sklep zamiast „Zacznij od nowa” w sklepie tymczasowym (R46, Minor-4)', () => {
  it('zwykły sklep: „Nowy sklep” (ekran startowy) i „Zacznij od nowa” (kasuje zapis, więc z potwierdzeniem w ⚙)', () => {
    const onNewStore = vi.fn();
    const onRestart = vi.fn();
    const tree = StoreActions({ ephemeral: false, onNewStore, onRestart });
    expect(labels(tree)).toEqual(['Nowy sklep', 'Zacznij od nowa']);
    const [newStore, restart] = buttonsOf(tree);
    (newStore!.props.onClick as () => void)();
    expect(onNewStore).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    (restart!.props.onClick as () => void)();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).not.toContain('tymczasow');
  });

  it('sklep tymczasowy: zostaje tylko „Nowy sklep”, a tekst nie mówi, że cokolwiek zostanie usunięte', () => {
    const onNewStore = vi.fn();
    const onRestart = vi.fn();
    const tree = StoreActions({ ephemeral: true, onNewStore, onRestart });
    expect(labels(tree)).toEqual(['Nowy sklep']);
    (buttonsOf(tree)[0]!.props.onClick as () => void)();
    expect(onNewStore).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain(EPHEMERAL_NOTE);
    expect(textOf(tree)).not.toMatch(/usunię/i);
    expect(textOf(tree)).not.toContain('Zacznij od nowa');
  });

  it('potwierdzenie „Zacznij od nowa” mówi prawdę o sklepie zwykłym: zapis zostanie usunięty (w tymczasowym tego przycisku nie ma)', () => {
    expect(RESTART_CONFIRM).toBe('Zacząć od nowa w tym sklepie? Zapis zostanie usunięty.');
    expect(EPHEMERAL_NOTE).toMatch(/nie jest zapisywany|nie zapisuje/);
    expect(EPHEMERAL_NOTE).toMatch(/nietknięt/);
  });

  it('ten sam komponent odpowiada na zmianę rodzaju sklepu (bez stanu własnego)', () => {
    const props = { onNewStore: vi.fn(), onRestart: vi.fn() };
    expect(labels(StoreActions({ ...props, ephemeral: false }))).toHaveLength(2);
    expect(labels(StoreActions({ ...props, ephemeral: true }))).toHaveLength(1);
    expect(labels(StoreActions({ ...props, ephemeral: false }))).toHaveLength(2);
  });
});

describe('plakietka sklepu tymczasowego', () => {
  it('sklep zwykły: nic nie widać', () => {
    ephemeral.value = false;
    expect(StoreBadge()).toBeNull();
  });

  it('sklep tymczasowy: stale widoczna plakietka „Sklep tymczasowy: postęp nie jest zapisywany”', () => {
    ephemeral.value = true;
    const badge = StoreBadge() as VNode<Record<string, unknown>>;
    expect(badge).not.toBeNull();
    expect(EPHEMERAL_BADGE).toBe('Sklep tymczasowy: postęp nie jest zapisywany');
    expect(textOf(badge)).toBe(EPHEMERAL_BADGE);
    expect(badge.props.role).toBe('status');
    ephemeral.value = false;
    expect(StoreBadge()).toBeNull();   // wraca do zwykłego sklepu: znika
  });
});

describe('podpowiedzi pierwszego dnia: dymki zamiast okna powitalnego', () => {
  it('lista krótkich wskazówek z dawnego okna (cel gry, palety, kolejka, zlecenia, paczki, sterowanie), każda krótka i po polsku', () => {
    expect(FIRST_DAY_HINTS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FIRST_DAY_HINTS).size).toBe(FIRST_DAY_HINTS.length);
    for (const hint of FIRST_DAY_HINTS) {
      expect(hint.length, hint).toBeLessThanOrEqual(120);
      expect(hint, hint).toMatch(/[ąćęłńóśźż]/i);
    }
    const all = FIRST_DAY_HINTS.join(' ').toLowerCase();
    for (const word of ['franczyz', 'palet', 'kolejk', 'cele', 'paczk', 'przeciągnij']) expect(all, word).toContain(word);
    expect(FIRST_DAY_HINTS[0]).toContain('Cel');   // najpierw o co chodzi, potem jak grać
  });

  it('bez podpowiedzi nic nie widać; z listą widać pierwszą z przyciskiem „Dalej” (ostatnia: „OK”)', () => {
    expect(FirstDayHints()).toBeNull();
    showHints(['Pierwsza', 'Druga']);
    const first = FirstDayHints();
    expect(textOf(first)).toContain('Pierwsza');
    expect(labels(first)).toEqual(['Dalej']);
    (buttonsOf(first)[0]!.props.onClick as () => void)();
    expect(hints.value).toEqual(['Druga']);
    const last = FirstDayHints();
    expect(textOf(last)).toContain('Druga');
    expect(labels(last)).toEqual(['OK']);
    (buttonsOf(last)[0]!.props.onClick as () => void)();
    expect(hints.value).toEqual([]);
    expect(FirstDayHints()).toBeNull();
  });
});

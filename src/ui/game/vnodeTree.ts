import type { ComponentChild, VNode } from 'preact';

/*
 * Pomocnik testów interfejsu bez DOM: komponent bez hooków wołamy jak zwykłą funkcję, a zwrócone drzewo vnode przeglądamy
 * tutaj (przyciski, ich napisy i `onClick`). Używają go `overlays.test.tsx` i `panels.test.tsx`; gra go nie importuje.
 */

export type Vnode = VNode<Record<string, unknown>>;

/** Wszystkie węzły drzewa vnode zwróconego przez komponent bez hooków (komponenty funkcyjne w drzewie nie są wołane, widać ich `props`). */
export function walk(node: ComponentChild, out: Vnode[] = []): Vnode[] {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  const vnode = node as Vnode;
  out.push(vnode);
  walk(vnode.props?.children as ComponentChild, out);
  return out;
}

/** Tekst widoczny w drzewie (łączy łańcuchy i liczby ze wszystkich węzłów). */
export function textOf(node: ComponentChild): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as Vnode).props?.children as ComponentChild);
}

export const buttonsOf = (tree: ComponentChild): Vnode[] => walk(tree).filter((v) => v.type === 'button');
export const labels = (tree: ComponentChild): string[] => buttonsOf(tree).map((b) => textOf(b));

/** Przycisk o danym napisie (cały napis, bez porównania częściowego); rzuca, gdy go nie ma albo jest ich kilka. */
export function buttonLabelled(tree: ComponentChild, label: string): Vnode {
  const found = buttonsOf(tree).filter((b) => textOf(b) === label);
  if (found.length !== 1) throw new Error(`Przycisków „${label}”: ${found.length}, oczekiwano jednego.`);
  return found[0]!;
}

/** Przycisk o danym `aria-label` (np. „Mniej”, „Zatrudnij”). */
export function buttonAria(tree: ComponentChild, aria: string): Vnode {
  const found = buttonsOf(tree).filter((b) => b.props['aria-label'] === aria);
  if (found.length !== 1) throw new Error(`Przycisków [aria-label="${aria}"]: ${found.length}, oczekiwano jednego.`);
  return found[0]!;
}

/** Sekcja panelu (`<Section title=…>`) po tytule: jej przyciski odróżniają np. remont od zakupów. */
export function sectionTitled(tree: ComponentChild, title: string): Vnode {
  const found = walk(tree).filter((v) => v.props?.title === title);
  if (found.length !== 1) throw new Error(`Sekcji „${title}”: ${found.length}, oczekiwano jednej.`);
  return found[0]!;
}

/** Klika przycisk: woła jego `onClick` (z udawanym zdarzeniem myszy, gdy podano współrzędne). */
export function click(button: Vnode, at?: { clientX: number; clientY: number }): void {
  (button.props.onClick as (e?: unknown) => void)(at);
}

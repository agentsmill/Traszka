/** Pamięciowy odpowiednik `localStorage` do testów (środowisko testowe to node, bez przeglądarki). */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  /** Gdy true, każdy zapis rzuca QuotaExceededError (przepełniona pamięć albo tryb prywatny). */
  failWrites = false;

  get length(): number { return this.items.size; }
  clear(): void { this.items.clear(); }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string): void { this.items.delete(key); }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    this.items.set(key, value);
  }
  keys(): string[] { return [...this.items.keys()]; }
}

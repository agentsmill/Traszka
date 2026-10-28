/**
 * Losowość bez stanu: wynik zależy tylko od hasza seeda i numeru zdarzenia (np. minuty gry), więc zapis gry nie musi
 * przechowywać stanu generatora, a ten sam seed i te same decyzje dają ten sam przebieg (spec §3, determinizm).
 */
export function rand01(seedHash: number, a: number, b = 0): number {
  let h = (seedHash ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

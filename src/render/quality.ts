export type QualityPresetId = 'niska' | 'srednia' | 'wysoka';

export interface QualitySettings {
  /** Górna granica devicePixelRatio (rozdzielczość renderowania względem CSS). */
  maxPixelRatio: number;
  /** Bok mapy cienia słońca w pikselach. */
  shadowMapSize: number;
  /** Ambient occlusion: wyłączone, w połowie rozdzielczości albo pełne. */
  ao: 'off' | 'half' | 'full';
  bloom: boolean;
  smaa: boolean;
}

export const QUALITY: Record<QualityPresetId, QualitySettings> = {
  niska: { maxPixelRatio: 1, shadowMapSize: 1024, ao: 'off', bloom: false, smaa: true },
  srednia: { maxPixelRatio: 1.5, shadowMapSize: 2048, ao: 'half', bloom: true, smaa: true },
  wysoka: { maxPixelRatio: 2, shadowMapSize: 4096, ao: 'full', bloom: true, smaa: true },
};

export interface DeviceCaps { webgl2: boolean; isMobile: boolean }

/** Bez WebGL 2 albo na telefonie zaczynamy od oszczędnego trybu, inaczej od średniego. */
export function pickInitialPreset(caps: DeviceCaps): QualityPresetId {
  return !caps.webgl2 || caps.isMobile ? 'niska' : 'srednia';
}

/** Co udało się uruchomić przy starcie renderera. */
export interface StartSupport { context: boolean; post: boolean; ao: boolean }

/**
 * Preset, na którym faktycznie ruszy renderer, i czy to tryb oszczędny (wtedy gracz dostaje komunikat).
 * Brak kontekstu, brak postprocessingu albo brak AO (tylko gdy preset je zamawia) zmuszają do 'niska'.
 */
export function resolveStartPreset(requested: QualityPresetId, support: StartSupport): { preset: QualityPresetId; reduced: boolean } {
  const needsAo = QUALITY[requested].ao !== 'off';
  const fallback = !support.context || !support.post || (needsAo && !support.ao);
  return fallback ? { preset: 'niska', reduced: true } : { preset: requested, reduced: false };
}

/**
 * Wykrywa możliwości urządzenia w przeglądarce (bez tworzenia kontekstu WebGL, który zajmowałby slot).
 * Poza przeglądarką zwraca wartości zachowawcze.
 */
export function detectDeviceCaps(): DeviceCaps {
  if (typeof navigator === 'undefined') return { webgl2: false, isMobile: true };
  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS podaje się za Maca
  return {
    webgl2: typeof WebGL2RenderingContext !== 'undefined',
    isMobile: /Android|iPhone|iPad|iPod|Mobi/i.test(ua) || touchMac,
  };
}

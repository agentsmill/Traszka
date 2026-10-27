import { MathUtils } from 'three';
import type { CharacterPack } from './characterFactory';

/**
 * Prędkość stopy podporowej w klipach chodu, m/s dla modelu bazowego (zmierzona z klipów w zadaniu 11). Postać
 * skalowana w poziomie o `s` (przód postaci to +z, więc `object.scale.z`) ma na podłodze prędkość stopy `WALK_SPEED_MPS · s`.
 */
export const WALK_SPEED_MPS: Record<CharacterPack, number> = { ubc: 0.95, modular: 1.15 };

/** Granice mnożnika czasu klipu chodu (poza nimi chód wygląda już jak bieg w miejscu albo zwolnione tempo). */
export const WALK_TIME_SCALE_RANGE = { min: 0.5, max: 2 } as const;

/**
 * Mnożnik czasu klipu chodu, przy którym stopa podporowa stoi w miejscu względem podłogi, gdy postać idzie
 * z prędkością `agentSpeedMps` (m/s): prędkość agenta / (prędkość stopy w klipie · skala postaci w poziomie).
 */
export function walkTimeScale(pack: CharacterPack, agentSpeedMps: number, horizontalScale: number): number {
  return MathUtils.clamp(agentSpeedMps / (WALK_SPEED_MPS[pack] * horizontalScale), WALK_TIME_SCALE_RANGE.min, WALK_TIME_SCALE_RANGE.max);
}

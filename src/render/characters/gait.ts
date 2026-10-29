import { IDLE_DELAY_S } from '@/render/crowdView';
import { CELL_SIZE_M } from '@/sim/grid';
import type { CharacterInstance } from './characterFactory';
import { walkTimeScale } from './walkSpeed';

type Anim = 'idle' | 'walk';

/**
 * Wybór klipu `idle`/`walk` i tempa jego odtwarzania dla jednej postaci, której ruch zna ktoś z zewnątrz (personel i kasjer;
 * tłum robi to samo we własnym `CrowdView.animate`, z tą samą regułą i tym samym `IDLE_DELAY_S`). Nie porusza postacią i
 * nie zna siatki: dostaje tylko to, czy w tej klatce idzie.
 *
 * Chód włącza się od razu, w pierwszej klatce z ruchem. Postój wraca do `idle` dopiero po `IDLE_DELAY_S` bez ruchu, żeby
 * krótka przerwa w marszu (np. skręt na ścieżce) nie migała animacją. W marszu klip gra z `walkTimeScale`, tak że stopa
 * podporowa stoi względem podłogi przy prędkości, z jaką postać naprawdę się przesuwa.
 */
export class Gait {
  private anim: Anim = 'idle';
  /** Sekundy ramki od ostatniej klatki z ruchem. */
  private stillFor = 0;
  /** Mnożnik czasu klipu chodu: liczony raz, bo prędkość marszu i skala postaci się nie zmieniają. */
  private readonly walkScale: number;

  /**
   * `footSpeedMps`: prędkość stopy w klipie chodu (`CharacterFactory.walkSpeedMps`), `speedCellsPerSecond`: tempo, z jakim
   * postać faktycznie się przesuwa, w kratkach na sekundę. Zakłada, że postać zaczyna w klipie `idle` (domyślnym w fabryce).
   */
  constructor(
    private readonly character: CharacterInstance,
    footSpeedMps: number,
    speedCellsPerSecond: number,
  ) {
    this.walkScale = walkTimeScale(footSpeedMps, speedCellsPerSecond * CELL_SIZE_M, character.object.scale.z);
  }

  /**
   * Jedna klatka. `moving`: czy postać się w niej przesuwa. `frameDt` (s ramki gry, 0 przy pauzie) liczy postój,
   * `animDt` (s ramki dla animacji, np. przycięte do `ANIM_SPEED_CAP`) napędza klip. Zawsze woła `character.update`.
   */
  update(moving: boolean, frameDt: number, animDt: number): void {
    if (moving) {
      this.stillFor = 0;
      if (this.anim !== 'walk') { this.anim = 'walk'; this.character.setAnim('walk'); }
    } else {
      this.stillFor += frameDt;
      if (this.anim === 'walk' && this.stillFor >= IDLE_DELAY_S) { this.anim = 'idle'; this.character.setAnim('idle'); }
    }
    this.character.update(this.anim === 'walk' ? animDt * this.walkScale : animDt);
  }
}

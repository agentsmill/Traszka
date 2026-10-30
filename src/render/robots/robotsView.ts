import { Group, type Object3D } from 'three';
import type { EconomyState } from '@/sim/economy/economy';
import { robotFleet } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import type { Cell } from '@/sim/grid';
import type { StoreLayout } from '@/sim/store/types';
import type { StaffDuty } from '@/render/staff/types';
import { createConveyor, createPress, createRestocker, type MachineLevel, type MachineRig } from './machines';
import { ActivityTracker, orderOf, robotDuty, type Progress } from './robotActivity';
import { placeRobots, type RobotPlacement } from './robotPlacement';

/** Ile sekund animacji maszyna pracuje po ostatnim postępie: synchronizacja przychodzi co ~100 ms, a postęp nie zawsze w każdej. */
export const WORK_HOLD_S = 1.2;

/** Poziom ulepszenia jako poziom wyglądu (1…3); ulepszenia mają najwyżej 3 poziomy, a wyższy zapis jest przycięty. */
const asLevel = (n: number): MachineLevel => Math.min(3, Math.max(1, Math.floor(n))) as MachineLevel;

/** Maszyna na scenie razem z poziomem, z którego powstała (po zmianie poziomu jest budowana od nowa). */
interface Standing { level: number; rig: MachineRig; cells: readonly Cell[]; hold: number }

/** Co `RobotsView.sync` mówi załodze: czym zajmuje się eDward (`null`, gdy go nie kupiono). */
export interface RobotsSync { edward: StaffDuty | null }

/**
 * Roboty z warsztatu na ekranie (upgrades.ts: grupa `warsztat`): taśmociąg, ramię wykładacza i prasa jako rekwizyty, a eDward jako
 * osoba załogi (patrz `StaffView`: ma w niej numer `EDWARD_ID`, więc chodzi, pracuje i otwiera drzwi jak inni). Widok tylko
 * odgrywa stan: poziomy ulepszeń z `robotFleet`, a to, co właśnie pracuje, z postępu prac między synchronizacjami (`ActivityTracker`).
 * Maszyna pojawia się przy pierwszej synchronizacji po zakupie albo wczytaniu zapisu, rośnie z poziomem i znika z remontem (nowy sklep to
 * nowy widok). Nic stąd nie wraca do symulacji.
 *
 * Koszt: kilka siatek na maszynę (rama jest wypieczona w jedną, ruchome części osobno), bez światła i bez tekstur poza paskiem taśmy.
 */
export class RobotsView {
  readonly root = new Group();
  private readonly placement: RobotPlacement;
  private readonly tracker = new ActivityTracker();
  private conveyor: Standing | null = null;
  private press: Standing | null = null;
  private restocker: Standing | null = null;
  private disposed = false;

  constructor(private readonly layout: StoreLayout, info: StoreInfo, parent: Object3D) {
    this.root.name = 'robots';
    this.placement = placeRobots(layout, info);
    parent.add(this.root);
  }

  /** Kratki zaplecza zajęte przez stojące maszyny: załoga ich omija (`CrewInput.obstacles`). */
  get obstacles(): readonly Cell[] {
    return [...(this.conveyor?.cells ?? []), ...(this.press?.cells ?? [])];
  }

  /** Liczba maszyn na scenie (diagnostyka i testy). */
  get machines(): number {
    return [this.conveyor, this.press, this.restocker].filter(Boolean).length;
  }

  /** Co ~100 ms z ekonomii: stawia maszyny według poziomów ulepszeń i odczytuje, co pracuje. Po `dispose` nic nie robi. */
  sync(s: EconomyState): RobotsSync {
    if (this.disposed) return { edward: null };
    const fleet = robotFleet(s);
    const progress: Progress = this.tracker.update(s);
    const { conveyor, press, restocker } = this.placement;

    // taśmociąg rośnie z poziomem o kratkę (najkrótszy ma 3, ale nie więcej niż miejsca)
    this.conveyor = this.stand(this.conveyor, fleet.tasmociag, !!conveyor, (level) => {
      const cells = conveyor!.slice(0, Math.max(2, Math.min(conveyor!.length, 2 + level)));
      return { cells, rig: createConveyor(this.layout, cells, level) };
    });
    this.press = this.stand(this.press, fleet.prasa, !!press, () => ({ cells: press!, rig: createPress(this.layout, press!) }));
    this.restocker = this.stand(this.restocker, fleet.wykladacz, !!restocker, (level) => ({
      cells: [], rig: createRestocker(this.layout, restocker!, level),
    }));

    if (progress.unload && this.conveyor) this.conveyor.hold = WORK_HOLD_S;
    if (progress.restock && this.restocker) this.restocker.hold = WORK_HOLD_S;
    if (progress.bags && this.press) this.press.hold = WORK_HOLD_S;
    return { edward: fleet.edward > 0 ? robotDuty(progress, orderOf(s)) : null };
  }

  /** Co klatkę: `dt` to czas animacji (s, 0 przy pauzie). */
  update(dt: number): void {
    if (this.disposed) return;
    for (const m of [this.conveyor, this.press, this.restocker]) {
      if (!m) continue;
      m.hold = Math.max(0, m.hold - dt);
      m.rig.update(dt, m.hold > 0);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of [this.conveyor, this.press, this.restocker]) m?.rig.dispose();
    this.conveyor = this.press = this.restocker = null;
    this.root.removeFromParent();
  }

  /**
   * Utrzymuje jedną maszynę zgodnie z poziomem ulepszenia: brak poziomu (albo brak miejsca w tym układzie, `placed` fałsz) to brak
   * maszyny, nowy poziom to nowa maszyna.
   */
  private stand(
    current: Standing | null, level: number, placed: boolean,
    build: (level: MachineLevel) => { cells: readonly Cell[]; rig: MachineRig },
  ): Standing | null {
    if (level <= 0 || !placed) {
      current?.rig.dispose();
      return null;
    }
    if (current && current.level === level) return current;
    const hold = current?.hold ?? 0;
    current?.rig.dispose();
    const made = build(asLevel(level));
    this.root.add(made.rig.object);
    return { level, rig: made.rig, cells: made.cells, hold };
  }
}

import type { SimulationBaseImageSelection } from './SimulationBaseImages';

/** Build target architecture. Defaults to the host arch when unset. */
export type TargetArch = 'amd64' | 'arm64';

export interface SimulationConfig {
  robot: string;
  distro: string;
  middleware: string;
  engine: string;
  /** Base image preset for the simulation Containerfile */
  baseImage: SimulationBaseImageSelection;
  /** Arbitrary parent image reference when baseImage is `custom`. */
  customBaseImage?: string;
  /**
   * Target architecture for the build. When set and different from the host,
   * the build runs under emulation. Cross-arch images get an arch-suffixed tag
   * (e.g. `:noble-amd64`) so they don't collide with native builds.
   * Undefined = build for the host arch with the native tag.
   */
  targetArch?: TargetArch;
}

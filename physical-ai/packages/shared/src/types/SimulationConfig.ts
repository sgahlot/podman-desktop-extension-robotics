import type { SimulationBaseImageId } from './SimulationBaseImages';

export interface SimulationConfig {
  robot: string;
  distro: string;
  middleware: string;
  engine: string;
  /** Base image preset for the simulation Containerfile */
  baseImage: SimulationBaseImageId;
}

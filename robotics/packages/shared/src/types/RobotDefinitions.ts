// The runtime bundle owns the data so standalone container builds and the
// extension consume the same descriptor (not two copies of robot defaults).
import * as catalogModule from '../../../backend/assets/ros2-jazzy-sim/config/robot-definitions.json';
import { loadJsonCatalog } from '../config/loadJsonCatalog';

export interface RobotDefinition {
  id: string;
  displayName: string;
  modelEnvVar: string;
  modelValue: string;
  descriptionPackage: string;
  /** Paths relative to the description package's share directory. */
  urdfPath: string;
  bridgeConfig: string;
  resourcePath: string;
  minimalSimPackage: string;
  minimalSimLaunch: string;
  launchArguments: string;
  navigationPackage: string;
  navigationLaunch: string;
  nav2ParamsTemplate: string;
  navigationMap: string;
}

const catalog = loadJsonCatalog<{ defaultRobot: string; robots: RobotDefinition[] }>(catalogModule);
export const ROBOT_DEFINITIONS: readonly Readonly<RobotDefinition>[] = Object.freeze(
  catalog.robots.map(robot => Object.freeze(robot)),
);
export const DEFAULT_ROBOT_ID = catalog.defaultRobot;

export function resolveRobotDefinition(id: string): Readonly<RobotDefinition> {
  const robot = ROBOT_DEFINITIONS.find(robot => robot.id === id);
  if (!robot) throw new Error(`Unknown robot definition "${id}".`);
  return robot;
}

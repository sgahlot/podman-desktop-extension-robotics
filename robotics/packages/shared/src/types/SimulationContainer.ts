/**
 * Options for launchSimulation.
 * `cmd` is ignored unless it is exactly `['/entrypoint-gazebo.sh']` (custom Cmd is rejected).
 * `env` only allows gazebo-related keys (see assertLaunchEnv); PATH/LD_PRELOAD/etc. are rejected.
 * Simulation role label is always forced server-side and cannot be overridden.
 */
export interface SimLaunchOptions {
  portMappings?: Array<{ hostPort: number; containerPort: number; protocol?: string }>;
  env?: Record<string, string>;
  /** @deprecated Custom Cmd is not allowed; only `/entrypoint-gazebo.sh`. */
  cmd?: string[];
  labels?: Record<string, string>;
}

export interface SimContainerInfo {
  id: string;
  name: string;
  imageTag: string;
  state: 'running' | 'stopped' | 'exited' | 'unknown';
  ports: string[];
  labels: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export const SIM_CONTAINER_LABEL = 'io.physical-ai.role';
export const SIM_CONTAINER_LABEL_VALUE = 'simulation';
export const SIM_CONTAINER_PREFIX = 'pai-sim-';

/** Shown when a simulation is stopped and removed (noVNC tab cannot be closed by the extension). */
export const SIM_STOPPED_BROWSER_HINT =
  'Simulation stopped and removed. Close the Gazebo (noVNC) browser tab if it is still open.';

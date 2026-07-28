export interface SimLaunchOptions {
  portMappings?: Array<{ hostPort: number; containerPort: number; protocol?: string }>;
  env?: Record<string, string>;
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

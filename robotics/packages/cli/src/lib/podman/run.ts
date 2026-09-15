import { runPodman } from './exec';

export interface PortMapping {
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface DeviceMapping {
  pathOnHost: string;
  pathInContainer: string;
  cgroupPermissions: string;
}

export interface RunContainerOptions {
  image: string;
  name: string;
  cmd: string[];
  env: Record<string, string>;
  labels: Record<string, string>;
  portMappings: PortMapping[];
  devices?: DeviceMapping[];
}

/**
 * CLI equivalent of the extension's `createContainer` + `startContainer` pair — collapses
 * to a single `podman run -d`, whose stdout is the new container id.
 */
export async function runContainer(options: RunContainerOptions): Promise<string> {
  const args = ['run', '-d', '--name', options.name];
  for (const port of options.portMappings) {
    args.push('-p', `${port.hostPort}:${port.containerPort}/${port.protocol}`);
  }
  for (const [key, value] of Object.entries(options.env)) {
    args.push('-e', `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(options.labels)) {
    args.push('--label', `${key}=${value}`);
  }
  for (const device of options.devices ?? []) {
    args.push('--device', `${device.pathOnHost}:${device.pathInContainer}:${device.cgroupPermissions}`);
  }
  args.push(options.image, ...options.cmd);
  const { stdout } = await runPodman(args);
  return stdout.trim();
}

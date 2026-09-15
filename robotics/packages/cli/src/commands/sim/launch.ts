import { Command, Flags } from '@oclif/core';
import { assertPodmanAvailable } from '../../lib/podman/preflight';
import { runContainer, type DeviceMapping } from '../../lib/podman/run';
import {
  assertContainerName,
  assertLaunchCmd,
  assertLaunchEnv,
  assertPortMappings,
} from '../../../../shared/src/security/simInput';
import {
  SIM_CONTAINER_LABEL,
  SIM_CONTAINER_LABEL_VALUE,
  SIM_CONTAINER_PREFIX,
} from '../../../../shared/src/types/SimulationContainer';

const DEFAULT_PORTS = ['6080:6080/tcp', '8080:8080/tcp'];

const GPU_DEVICES: DeviceMapping[] = [
  { pathOnHost: '/dev/dri/card0', pathInContainer: '/dev/dri/card0', cgroupPermissions: 'rwm' },
  { pathOnHost: '/dev/dri/renderD128', pathInContainer: '/dev/dri/renderD128', cgroupPermissions: 'rwm' },
];

function parsePortFlag(value: string): { hostPort: number; containerPort: number; protocol?: string } {
  const match = /^(\d+):(\d+)(?:\/(tcp|udp))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid --port "${value}". Use hostPort:containerPort[/tcp|udp].`);
  }
  return { hostPort: Number(match[1]), containerPort: Number(match[2]), protocol: match[3] };
}

function parseEnvFlag(value: string): [string, string] {
  const idx = value.indexOf('=');
  if (idx < 1) {
    throw new Error(`Invalid --env "${value}". Use KEY=VALUE.`);
  }
  return [value.slice(0, idx), value.slice(idx + 1)];
}

/** CLI port of the extension's `launchSimulation` (api-impl.ts). */
export default class SimLaunch extends Command {
  static description = 'Launch a simulation container from a built image.';

  static examples = [
    {
      command: '<%= config.bin %> sim:launch --image quay.io/my-ns/ros2-humble-turtlebot3:sloretz',
      description: 'Launch a simulation container, printing its container id',
    },
    {
      command: '<%= config.bin %> sim:launch --image quay.io/my-ns/ros2-jazzy-sim:noble --name my-sim --no-gpu',
      description: 'Launch with a custom container name and software rendering forced on',
    },
  ];

  static flags = {
    image: Flags.string({ required: true, description: 'Image tag to launch' }),
    name: Flags.string({ description: 'Container name (default: auto-generated)' }),
    port: Flags.string({
      multiple: true,
      default: DEFAULT_PORTS,
      description: 'hostPort:containerPort[/tcp|udp], repeatable',
    }),
    env: Flags.string({ multiple: true, default: [], description: 'KEY=VALUE, repeatable (allowlisted keys only)' }),
    gpu: Flags.boolean({ allowNo: true, description: 'GPU passthrough (default: on for arm64 host, off otherwise)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SimLaunch);
    await assertPodmanAvailable();

    const name = flags.name ? assertContainerName(flags.name) : `${SIM_CONTAINER_PREFIX}${Date.now()}`;
    const portMappings = assertPortMappings(flags.port.map(parsePortFlag)) ?? [];
    const clientEnv = assertLaunchEnv(Object.fromEntries(flags.env.map(parseEnvFlag)));
    const cmd = assertLaunchCmd(undefined);

    const useGpu = flags.gpu ?? process.arch === 'arm64';
    const env: Record<string, string> = { ...clientEnv };
    if (useGpu) {
      env.PHYSICAL_AI_USE_GPU = '1';
    } else {
      env.LIBGL_ALWAYS_SOFTWARE = '1';
      env.GALLIUM_DRIVER = 'llvmpipe';
    }

    const id = await runContainer({
      image: flags.image,
      name,
      cmd,
      env,
      labels: { [SIM_CONTAINER_LABEL]: SIM_CONTAINER_LABEL_VALUE },
      portMappings,
      devices: useGpu ? GPU_DEVICES : undefined,
    });

    this.log(id);
  }
}

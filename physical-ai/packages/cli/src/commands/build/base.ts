import { Command, Flags } from '@oclif/core';
import { assertPodmanAvailable } from '../../lib/podman/preflight';
import { buildImage } from '../../lib/podman/build';
import { resolveBundledAssetDir } from '../../lib/assets';
import { runWithProgress } from '../../lib/progress';
import {
  resolveSimulationProfile,
  formatSimulationConfig,
  platformForArch,
} from '../../../../shared/src/types/SimulationProfiles';
import {
  resolveSimulationBaseImage,
  defaultBaseImageForDistro,
} from '../../../../shared/src/types/SimulationBaseImages';
import type { SimulationConfig } from '../../../../shared/src/types/SimulationConfig';

/** CLI port of the extension's `buildBaseImage` (api-impl.ts). */
export default class BuildBase extends Command {
  static description = 'Build the ROS2 base image (Phase 1) for a simulation profile.';

  static examples = [
    {
      command: '<%= config.bin %> build:base --tag quay.io/my-ns/ros2-humble-base:sloretz',
      description: 'Build the default Humble/TurtleBot3 base image',
    },
    {
      command:
        '<%= config.bin %> build:base --tag quay.io/my-ns/ros2-jazzy-base:noble --distro jazzy --target-arch arm64',
      description: 'Cross-build a Jazzy base image for arm64',
    },
  ];

  static flags = {
    tag: Flags.string({
      required: true,
      description: 'Full image tag to build, e.g. quay.io/ns/ros2-humble-base:sloretz',
    }),
    robot: Flags.string({ default: 'turtlebot3', description: 'Robot type' }),
    distro: Flags.string({ options: ['humble', 'jazzy'], default: 'humble', description: 'ROS distro' }),
    middleware: Flags.string({ options: ['dds', 'zenoh'], default: 'dds', description: 'Middleware' }),
    engine: Flags.string({ default: 'gazebo', description: 'Simulation engine' }),
    'base-image': Flags.string({
      options: ['sloretz', 'osrf', 'jazzy', 'jazzy-noble'],
      description: 'Base image preset (default depends on --distro)',
    }),
    'target-arch': Flags.string({
      options: ['amd64', 'arm64'],
      description: 'Cross-build target architecture (default: host arch)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BuildBase);
    const config: SimulationConfig = {
      robot: flags.robot,
      distro: flags.distro,
      middleware: flags.middleware,
      engine: flags.engine,
      baseImage: (flags['base-image'] ?? defaultBaseImageForDistro(flags.distro)) as SimulationConfig['baseImage'],
      targetArch: flags['target-arch'] as SimulationConfig['targetArch'] | undefined,
    };

    const profile = resolveSimulationProfile(config);
    if (!profile) {
      this.error(
        `No base image profile for ${formatSimulationConfig(config)}. ` +
          'Supported: humble/turtlebot3/dds/gazebo and jazzy/turtlebot3/dds/gazebo.',
      );
    }

    const baseImage = resolveSimulationBaseImage(config.baseImage);
    const contextDir = resolveBundledAssetDir(profile.baseAssetDir);

    await runWithProgress([
      { title: 'Checking podman is available', run: () => assertPodmanAvailable() },
      {
        title: `Building ${flags.tag}`,
        outputBar: 8,
        run: onLine =>
          buildImage(
            {
              contextDir,
              containerFile: 'Containerfile',
              tag: flags.tag,
              buildArgs: { ROS_BASE_IMAGE: baseImage.imageRef },
              platform: platformForArch(config.targetArch),
            },
            onLine,
          ),
      },
    ]);

    this.log(`Built ${flags.tag}`);
  }
}

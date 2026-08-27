import { Command, Flags } from '@oclif/core';
import { assertPodmanAvailable } from '../../lib/podman/preflight';
import { buildImage } from '../../lib/podman/build';
import { resolveBundledAssetDir } from '../../lib/assets';
import { runWithProgress } from '../../lib/progress';
import { hostTargetArch } from '../../lib/hostArch';
import { QUICK_START_PRESET } from '../../lib/quickstart';
import {
  resolveSimulationProfile,
  formatSimulationConfig,
  platformForArch,
} from '../../../../shared/src/types/SimulationProfiles';
import {
  resolveSimulationBaseImage,
  defaultBaseImageForDistro,
  baseImagesForDistro,
} from '../../../../shared/src/types/SimulationBaseImages';
import type { SimulationConfig } from '../../../../shared/src/types/SimulationConfig';

const PROFILE_FLAGS = ['robot', 'distro', 'middleware', 'engine', 'base-image', 'target-arch'];

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
    {
      command: '<%= config.bin %> build:base --quickstart arm64 --tag quay.io/my-ns/ros2-jazzy-base:noble',
      description: "Apply the extension's Quick Start preset (TurtleBot3+Jazzy+DDS+Gazebo, Ubuntu Noble)",
    },
    {
      command: '<%= config.bin %> build:base --quickstart amd64 --tag quay.io/my-ns/ros2-jazzy-base:noble-amd64',
      description: 'Same Quick Start preset, cross-built for amd64 (e.g. for OpenShift)',
    },
  ];

  static flags = {
    tag: Flags.string({
      required: true,
      description: 'Full image tag to build, e.g. quay.io/ns/ros2-humble-base:sloretz',
    }),
    quickstart: Flags.string({
      options: ['arm64', 'amd64'],
      description:
        "Apply the extension's Quick Start preset (TurtleBot3+Jazzy+DDS+Gazebo, Ubuntu Noble) for this target architecture, instead of the profile flags below",
      exclusive: PROFILE_FLAGS,
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
      default: hostTargetArch(),
      description: 'Target architecture to build for',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BuildBase);
    const config: SimulationConfig = flags.quickstart
      ? { ...QUICK_START_PRESET, targetArch: flags.quickstart as SimulationConfig['targetArch'] }
      : {
          robot: flags.robot,
          distro: flags.distro,
          middleware: flags.middleware,
          engine: flags.engine,
          baseImage: (flags['base-image'] ?? defaultBaseImageForDistro(flags.distro)) as SimulationConfig['baseImage'],
          targetArch: flags['target-arch'] as SimulationConfig['targetArch'],
        };

    const profile = resolveSimulationProfile(config);
    if (!profile) {
      this.error(
        `No base image profile for ${formatSimulationConfig(config)}. ` +
          'Supported: humble/turtlebot3/dds/gazebo, jazzy/turtlebot3/dds/gazebo, jazzy/turtlebot3/zenoh/gazebo.',
      );
    }

    // The extension's Base image dropdown only ever lists presets valid for the selected
    // distro (via this same baseImagesForDistro filter) — it's structurally impossible to
    // pick a mismatched pair there. A CLI flag has no such structural constraint, so this
    // check exists to reject e.g. `--distro humble --base-image jazzy-noble` explicitly
    // instead of silently building a "humble"-tagged image from a Jazzy upstream image.
    const availableForDistro = baseImagesForDistro(config.distro);
    if (!availableForDistro.some(p => p.id === config.baseImage)) {
      this.error(
        `--base-image ${config.baseImage} is not available for --distro ${config.distro}. ` +
          `Available: ${availableForDistro.map(p => p.id).join(', ')}.`,
      );
    }

    if (config.targetArch !== hostTargetArch()) {
      this.log(
        `Building for ${config.targetArch} on a ${hostTargetArch()} host — this uses QEMU emulation and will be slower.`,
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

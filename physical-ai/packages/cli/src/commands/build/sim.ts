import { Command, Flags } from '@oclif/core';
import { assertPodmanAvailable } from '../../lib/podman/preflight';
import { buildImage } from '../../lib/podman/build';
import { getImageArchitecture } from '../../lib/podman/inspect';
import { resolveBundledAssetDir } from '../../lib/assets';
import { runWithProgress } from '../../lib/progress';
import { resolveSimulationProfile, formatSimulationConfig } from '../../../../shared/src/types/SimulationProfiles';
import { defaultBaseImageForDistro } from '../../../../shared/src/types/SimulationBaseImages';
import { QUICK_START_PRESET } from '../../lib/quickstart';
import type { SimulationConfig } from '../../../../shared/src/types/SimulationConfig';

const PROFILE_FLAGS = ['robot', 'distro', 'middleware', 'engine'];

/**
 * CLI port of the extension's `buildSimulationImage` (api-impl.ts).
 *
 * Unlike the extension (whose wizard UI drives Phase 1 and Phase 2 from the same
 * namespace/distro/base-image selections, so it can safely reconstruct the expected base
 * image reference), this takes the base image tag directly via `--base-tag` — two separate
 * CLI invocations have no shared state to reconstruct a matching tag from, and guessing it
 * risks a confusing failure (or an unintended `podman` pull from Quay of a same-named image
 * that isn't actually yours) if the tags don't line up exactly.
 *
 * There is deliberately no `--target-arch` flag here (unlike `build:base`): the sim image
 * always builds for whatever architecture `--base-tag` actually is (inspected via `podman`),
 * since building it for any other arch than its own base would be broken. Letting the user
 * specify both independently would just be a second place for the two to drift out of sync.
 */
export default class BuildSim extends Command {
  static description = 'Build the ROS2 simulation image (Phase 2), layered on a base image.';

  static examples = [
    {
      command:
        '<%= config.bin %> build:sim --tag quay.io/my-ns/ros2-humble-turtlebot3:test --base-tag quay.io/my-ns/ros2-humble-base:test',
      description: 'Build the sim image on top of an already-built local base image',
    },
    {
      command:
        '<%= config.bin %> build:sim --tag quay.io/my-ns/ros2-jazzy-sim:test --base-tag quay.io/my-ns/ros2-jazzy-base:test --distro jazzy',
      description: 'Build the Jazzy sim image on top of an already-built local Jazzy base image',
    },
    {
      command:
        '<%= config.bin %> build:sim --quickstart --tag quay.io/my-ns/ros2-jazzy-sim:noble --base-tag quay.io/my-ns/ros2-jazzy-base:noble',
      description: "Apply the extension's Quick Start preset (TurtleBot3+Jazzy+DDS+Gazebo)",
    },
  ];

  static flags = {
    tag: Flags.string({ required: true, description: 'Full image tag to build for the sim image' }),
    'base-tag': Flags.string({
      required: true,
      description: 'Tag of an already-built base image to layer this sim image on (must resolve locally via podman)',
    }),
    quickstart: Flags.boolean({
      description:
        "Apply the extension's Quick Start preset (TurtleBot3+Jazzy+DDS+Gazebo) instead of the profile flags below",
      exclusive: PROFILE_FLAGS,
    }),
    robot: Flags.string({ default: 'turtlebot3', description: 'Robot type' }),
    distro: Flags.string({ options: ['humble', 'jazzy'], default: 'humble', description: 'ROS distro' }),
    middleware: Flags.string({ options: ['dds', 'zenoh'], default: 'dds', description: 'Middleware' }),
    engine: Flags.string({ default: 'gazebo', description: 'Simulation engine' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BuildSim);
    const config: SimulationConfig = flags.quickstart
      ? { ...QUICK_START_PRESET }
      : {
          robot: flags.robot,
          distro: flags.distro,
          middleware: flags.middleware,
          engine: flags.engine,
          // Not user-configurable here — build:sim no longer resolves a base-image preset
          // itself (--base-tag replaces that); this only fills the SimulationConfig type /
          // error text.
          baseImage: defaultBaseImageForDistro(flags.distro),
        };

    const profile = resolveSimulationProfile(config);
    if (!profile) {
      this.error(
        `No simulation image available for ${formatSimulationConfig(config)}. ` +
          'Supported: humble/turtlebot3/dds/gazebo, jazzy/turtlebot3/dds/gazebo, jazzy/turtlebot3/zenoh/gazebo.',
      );
    }
    if (!profile.assetDir) {
      this.error(
        `Simulation images are not yet available for ${config.distro}. ` +
          'Only the base image can be built for this distro.',
      );
    }

    const contextDir = resolveBundledAssetDir(profile.assetDir);
    let baseArch = '';

    await runWithProgress([
      { title: 'Checking podman is available', run: () => assertPodmanAvailable() },
      {
        title: `Resolving architecture of ${flags['base-tag']}`,
        run: async () => {
          baseArch = await getImageArchitecture(flags['base-tag']);
        },
      },
      {
        title: `Building ${flags.tag}`,
        outputBar: 8,
        run: onLine =>
          buildImage(
            {
              contextDir,
              containerFile: 'Containerfile',
              tag: flags.tag,
              buildArgs: { LOCAL_BASE_IMAGE: flags['base-tag'] },
              platform: `linux/${baseArch}`,
            },
            onLine,
          ),
      },
    ]);

    this.log(`Built ${flags.tag}`);
  }
}

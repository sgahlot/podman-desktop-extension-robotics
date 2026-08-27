import { Command, Flags } from '@oclif/core';
import { assertPodmanAvailable } from '../../lib/podman/preflight';
import { buildImage } from '../../lib/podman/build';
import { resolveBundledAssetDir } from '../../lib/assets';
import {
  resolveSimulationProfile,
  formatSimulationConfig,
  platformForArch,
  archTagSuffix,
} from '../../../../shared/src/types/SimulationProfiles';
import {
  resolveSimulationBaseImage,
  defaultBaseImageForDistro,
} from '../../../../shared/src/types/SimulationBaseImages';
import type { SimulationConfig } from '../../../../shared/src/types/SimulationConfig';

/** CLI port of the extension's `buildSimulationImage` (api-impl.ts). */
export default class BuildSim extends Command {
  static description = 'Build the ROS2 simulation image (Phase 2), layered on a base image.';

  static flags = {
    tag: Flags.string({ required: true, description: 'Full image tag to build' }),
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
    namespace: Flags.string({
      default: 'ecosystem-appeng',
      description: 'Quay namespace the base image was tagged under',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BuildSim);
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
        `No simulation image available for ${formatSimulationConfig(config)}. ` +
          'Supported: humble/turtlebot3/dds/gazebo and jazzy/turtlebot3/dds/gazebo.',
      );
    }
    if (!profile.assetDir) {
      this.error(
        `Simulation images are not yet available for ${config.distro}. ` +
          'Only the base image can be built for this distro.',
      );
    }

    await assertPodmanAvailable();
    const baseImage = resolveSimulationBaseImage(config.baseImage);
    const localBaseTag = `quay.io/${flags.namespace}/${profile.baseImageName}:${baseImage.imageTag}${archTagSuffix(config.targetArch)}`;
    const contextDir = resolveBundledAssetDir(profile.assetDir);

    await buildImage(
      {
        contextDir,
        containerFile: 'Containerfile',
        tag: flags.tag,
        buildArgs: { LOCAL_BASE_IMAGE: localBaseTag },
        platform: platformForArch(config.targetArch),
      },
      line => this.log(line),
    );

    this.log(`Built ${flags.tag}`);
  }
}

import { Command, Flags } from '@oclif/core';
import { assertPodmanAvailable } from '../../lib/podman/preflight';
import { buildImage } from '../../lib/podman/build';
import { runWithProgress } from '../../lib/progress';

function parseBuildArgFlag(value: string): [string, string] {
  const idx = value.indexOf('=');
  if (idx < 1) {
    throw new Error(`Invalid --build-arg "${value}". Use KEY=VALUE.`);
  }
  return [value.slice(0, idx), value.slice(idx + 1)];
}

/**
 * CLI port of the extension's `buildFromContainerfile`. Unlike the extension (which accepts
 * Containerfile content pasted from the Layer Composer UI and writes it to a throwaway temp
 * dir), the CLI takes an existing directory with a real Containerfile already on disk — the
 * natural shape for a CLI user. SBOM generation options are deferred, not ported.
 */
export default class BuildFile extends Command {
  static description = 'Build an image from an existing Containerfile in a local directory.';

  static examples = [
    {
      command: '<%= config.bin %> build:file --tag localhost/my-image:latest --context-dir ./my-build-context',
      description: 'Build from a Containerfile in an existing local directory',
    },
    {
      command:
        '<%= config.bin %> build:file --tag localhost/my-image:amd64 --context-dir ./my-build-context --platform linux/amd64',
      description: 'Build for a specific target platform',
    },
    {
      command:
        '<%= config.bin %> build:file --tag localhost/my-sim:latest --context-dir packages/cli/assets/ros2-humble-turtlebot3 --build-arg LOCAL_BASE_IMAGE=quay.io/my-ns/ros2-humble-base:sloretz',
      description:
        "Build a Containerfile that requires a build ARG with no default (e.g. the sim images' LOCAL_BASE_IMAGE)",
    },
  ];

  static flags = {
    tag: Flags.string({ required: true, description: 'Image tag to build' }),
    'context-dir': Flags.string({
      required: true,
      description: 'Directory containing the Containerfile (the build context)',
    }),
    containerfile: Flags.string({
      default: 'Containerfile',
      description: 'Containerfile name, relative to --context-dir',
    }),
    platform: Flags.string({ description: 'Target platform, e.g. linux/amd64' }),
    'build-arg': Flags.string({
      multiple: true,
      default: [],
      description: 'KEY=VALUE build arg, repeatable',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BuildFile);
    const buildArgs = Object.fromEntries(flags['build-arg'].map(parseBuildArgFlag));

    await runWithProgress([
      { title: 'Checking podman is available', run: () => assertPodmanAvailable() },
      {
        title: `Building ${flags.tag}`,
        outputBar: 8,
        run: onLine =>
          buildImage(
            {
              contextDir: flags['context-dir'],
              containerFile: flags.containerfile,
              tag: flags.tag,
              buildArgs,
              platform: flags.platform,
            },
            onLine,
          ),
      },
    ]);

    this.log(`Built ${flags.tag}`);
  }
}

import { Command, Flags } from '@oclif/core';
import { assertPodmanAvailable } from '../../lib/podman/preflight';
import { buildImage } from '../../lib/podman/build';

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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BuildFile);
    await assertPodmanAvailable();
    await buildImage(
      {
        contextDir: flags['context-dir'],
        containerFile: flags.containerfile,
        tag: flags.tag,
        platform: flags.platform,
      },
      line => this.log(line),
    );
    this.log(`Built ${flags.tag}`);
  }
}

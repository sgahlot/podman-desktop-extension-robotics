import { Args, Command, Flags } from '@oclif/core';
import { resolveSimContainer, hostPortForPrivate } from '../../lib/podman/containers';
import { openBrowser } from '../../lib/openBrowser';
import { simulationBrowserUrl } from '../../../../shared/src/security/simInput';

/**
 * CLI port of the extension's `openSimulationInBrowser` (api-impl.ts). Reuses
 * `simulationBrowserUrl` from packages/shared/src/security/simInput.ts unmodified — same
 * URL (noVNC autoconnect/reconnect query string) the extension's "Open in Browser" button
 * builds. Host port resolution matches the extension's `hostPortForPrivate`
 * (packages/frontend/src/LocalSimulation.svelte) exactly.
 */
export default class SimOpen extends Command {
  static description = 'Open a running simulation in your default browser.';

  static examples = [
    {
      command: '<%= config.bin %> sim:open a1b2c3d4',
      description: 'Open the noVNC viewer (port 6080) for a running simulation',
    },
    {
      command: '<%= config.bin %> sim:open a1b2c3d4 --port 8080',
      description: 'Open the plain landing page instead',
    },
  ];

  static args = {
    containerId: Args.string({ required: true, description: 'Container id (or unambiguous prefix)' }),
  };

  static flags = {
    port: Flags.string({
      options: ['6080', '8080'],
      default: '6080',
      description: 'Container port to open: 6080 (noVNC viewer) or 8080 (landing page)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SimOpen);
    const container = await resolveSimContainer(args.containerId);
    const containerPort = Number(flags.port);
    const hostPort = hostPortForPrivate(container.ports, containerPort);
    const url = simulationBrowserUrl(hostPort, containerPort);
    this.log(`Opening ${url}`);
    openBrowser(url);
  }
}

import { Args, Command } from '@oclif/core';
import { stopContainer } from '../../lib/podman/containers';

/** CLI port of the extension's `stopSimulation` (api-impl.ts). */
export default class SimStop extends Command {
  static description = 'Stop a running simulation container.';

  static examples = [
    {
      command: '<%= config.bin %> sim:stop a1b2c3d4',
      description: 'Stop the simulation container with this id (or an unambiguous id prefix)',
    },
  ];

  static args = {
    containerId: Args.string({ required: true, description: 'Container id (or unambiguous prefix)' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SimStop);
    await stopContainer(args.containerId);
    this.log(`Stopped ${args.containerId}`);
  }
}

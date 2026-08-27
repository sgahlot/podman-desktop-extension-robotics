import { Args, Command } from '@oclif/core';
import { stopContainer } from '../../lib/podman/containers';

/** CLI port of the extension's `stopSimulation` (api-impl.ts). */
export default class SimStop extends Command {
  static description = 'Stop a running simulation container.';

  static args = {
    containerId: Args.string({ required: true, description: 'Container id (or unambiguous prefix)' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SimStop);
    await stopContainer(args.containerId);
    this.log(`Stopped ${args.containerId}`);
  }
}

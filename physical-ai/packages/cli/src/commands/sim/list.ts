import { Command, Flags } from '@oclif/core';
import { listSimContainers } from '../../lib/podman/containers';

/** CLI port of the extension's `listSimulationContainers` (api-impl.ts). */
export default class SimList extends Command {
  static description = 'List simulation containers.';

  static examples = [
    {
      command: '<%= config.bin %> sim:list',
      description: 'List simulation containers as a table',
    },
    {
      command: '<%= config.bin %> sim:list --format json',
      description: 'List simulation containers as JSON',
    },
  ];

  static flags = {
    format: Flags.string({ options: ['table', 'json'], default: 'table', description: 'Output format' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SimList);
    const containers = await listSimContainers();

    if (flags.format === 'json') {
      this.log(JSON.stringify(containers, undefined, 2));
      return;
    }

    if (containers.length === 0) {
      this.log('No simulation containers found.');
      return;
    }

    this.log(`${'ID'.padEnd(12)}  ${'STATE'.padEnd(8)}  ${'NAME'.padEnd(24)}  ${'IMAGE'.padEnd(40)}  PORTS`);
    for (const c of containers) {
      this.log(
        `${c.id.slice(0, 12)}  ${c.state.padEnd(8)}  ${c.name.padEnd(24)}  ${c.imageTag.padEnd(40)}  ${c.ports.join(',')}`,
      );
    }
  }
}

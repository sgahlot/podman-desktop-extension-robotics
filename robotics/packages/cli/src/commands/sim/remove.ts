import { Args, Command } from '@oclif/core';
import { resolveSimContainer } from '../../lib/podman/containers';
import { runPodman } from '../../lib/podman/exec';
import { SIM_STOPPED_BROWSER_HINT } from '../../../../shared/src/types/SimulationContainer';

/**
 * CLI port of the extension's `deleteSimulation` (api-impl.ts) — the "Stop & remove" button,
 * which works on both running and already-exited containers as one action.
 *
 * Uses `podman rm -f` directly (stops if running, then removes) rather than a separate
 * stop-then-remove call, matching the extension's own reasoning: `containerEngine.deleteContainer`
 * can leave exited containers listed as stop-only leftovers, whereas `rm -f` reliably handles
 * both cases. "Already gone" (no such container) is treated as success, same as the extension.
 */
export default class SimRemove extends Command {
  static description = 'Stop (if running) and remove a simulation container.';

  static examples = [
    {
      command: '<%= config.bin %> sim:remove a1b2c3d4',
      description: 'Stop and remove a simulation container, whether running or already exited',
    },
  ];

  static args = {
    containerId: Args.string({ required: true, description: 'Container id (or unambiguous prefix)' }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SimRemove);
    const { id } = await resolveSimContainer(args.containerId);

    try {
      await runPodman(['rm', '-f', id]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/no such container|not found/i.test(message)) {
        throw err;
      }
    }

    this.log(SIM_STOPPED_BROWSER_HINT);
  }
}

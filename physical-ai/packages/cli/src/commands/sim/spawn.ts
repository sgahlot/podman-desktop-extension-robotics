import { Args, Command, Flags } from '@oclif/core';
import { spawnRobot } from '../../lib/podman/spawnRobot';

/**
 * CLI port of the extension's `execInSimulation` spawn path (api-impl.ts). The Nav2 pre-warm
 * side effect the extension performs for jazzy images is not ported — nav-goal parity is a
 * later slice.
 */
export default class SimSpawn extends Command {
  static description = 'Spawn a robot in a running simulation.';

  static args = {
    containerId: Args.string({ required: true, description: 'Container id (or unambiguous prefix)' }),
  };

  static flags = {
    robot: Flags.string({ required: true, description: 'Robot name' }),
    x: Flags.string({ required: true, description: 'Spawn X position' }),
    y: Flags.string({ required: true, description: 'Spawn Y position' }),
    yaw: Flags.string({ required: true, description: 'Spawn yaw (radians)' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SimSpawn);
    await spawnRobot(args.containerId, flags.robot, flags.x, flags.y, flags.yaw);
    this.log(`Spawned ${flags.robot} in ${args.containerId}`);
  }
}

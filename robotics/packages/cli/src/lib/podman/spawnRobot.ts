import { runPodman } from './exec';
import { resolveSimContainer } from './containers';
import { assertSpawnExecCommand, SPAWN_ENTRYPOINT } from '../../../../shared/src/security/simInput';

/**
 * CLI equivalent of the extension's `execInSimulation` spawn path. Reuses
 * `assertSpawnExecCommand` unmodified. The Nav2 pre-warm side effect the extension performs
 * for jazzy images is intentionally NOT ported here — nav-goal parity is a later slice.
 */
export async function spawnRobot(containerId: string, robot: string, x: string, y: string, yaw: string): Promise<void> {
  const { id } = await resolveSimContainer(containerId);
  const [, safeRobot, safeX, safeY, safeYaw] = assertSpawnExecCommand([SPAWN_ENTRYPOINT, robot, x, y, yaw]);
  await runPodman(['exec', '-d', id, SPAWN_ENTRYPOINT, safeRobot, safeX, safeY, safeYaw]);
}

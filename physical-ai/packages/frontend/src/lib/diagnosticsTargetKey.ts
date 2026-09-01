/** Stable identity for a local Podman diagnostics target, shared by RobotDiagnosticsPanel and
 * LocalSimulation so both agree on the same key format for the same container. */
export function localTargetKey(containerId: string): string {
  return `podman:${containerId}`;
}

/** Stable identity for an OpenShift diagnostics target, shared by RobotDiagnosticsPanel and
 * OpenShiftSimulation so both agree on the same key format for the same workload. */
export function ocTargetKey(namespace: string, workload: string, context: string | undefined): string {
  return `oc:${namespace}/${workload}/${context ?? ''}`;
}

/** Deep link to the Diagnostics page for a robot in a local Podman simulation container. */
export function localDiagnosticsHref(containerId: string, robotName: string): string {
  const params = new URLSearchParams({ target: 'local', containerId, robot: robotName });
  return `/diagnostics?${params.toString()}`;
}

/**
 * Deep link to the Diagnostics page for a robot in a deployed OpenShift workload. `context` is
 * omitted (not sent as an empty param) when falsy, matching the `selectedContext || undefined`
 * convention already used in OpenShiftSimulation.svelte.
 */
export function openShiftDiagnosticsHref(
  namespace: string,
  workload: string,
  robotName: string,
  context?: string,
): string {
  const params = new URLSearchParams({ target: 'oc', namespace, workload, robot: robotName });
  if (context) params.set('context', context);
  return `/diagnostics?${params.toString()}`;
}

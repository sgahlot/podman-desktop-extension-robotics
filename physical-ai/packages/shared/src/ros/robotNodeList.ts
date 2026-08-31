/**
 * Extract robot identifiers from `ros2 node list` stdout (APPENG-6105/6149/6250) — used
 * to reconcile a UI's spawned-robot list against what's actually running in a container
 * or pod, since spawn state otherwise lives only in frontend memory and forgets robots
 * spawned earlier across a page reload or extension restart.
 *
 * A node under a robot namespace looks like /robot_1/some_node; bare top-level nodes
 * (e.g. /some_node) aren't under any robot and are filtered out. Robot names aren't
 * restricted to `robot_N` (see ROBOT_NAME_RE), so this matches generically on "has at
 * least one namespace segment before further path".
 */
export function parseSpawnedRobotNames(nodeListStdout: string): string[] {
  const names = new Set<string>();
  for (const line of nodeListStdout.trim().split('\n')) {
    const match = line.trim().match(/^\/([^/]+)\/.+/);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

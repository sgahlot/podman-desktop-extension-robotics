/** Declarative, build-time-only SDF profile selected through Podman Desktop. */
export interface EmbeddedRobotProfile {
  id: string;
  displayName: string;
  /** Relative SDF path inside the selected directory. */
  modelFile: string;
  world: string;
  /** Absolute path only kept in the backend selection cache; never sent to a container. */
  sourceId: string;
}

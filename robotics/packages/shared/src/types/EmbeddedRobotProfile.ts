/** Declarative, build-time-only SDF profile selected through Podman Desktop. */
export interface EmbeddedRobotProfile {
  id: string;
  displayName: string;
  /** Relative SDF path inside the selected directory. */
  modelFile: string;
  world: string;
  /** Initial model height in the SDF world; X, Y and yaw are set from Add Robot. */
  z: number;
  /** Absolute path only kept in the backend selection cache; never sent to a container. */
  sourceId: string;
}

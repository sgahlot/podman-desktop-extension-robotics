/** Post-build / pre-build verification hook for managed sim runtime staging. */
export const MANAGED_SIM_VERIFY_HOOK = 'verify-sim-runtime';

/** Relative paths required in the build context for managed sim (Layer 5) images. */
export const MANAGED_SIM_CONTEXT_PATHS = [
  'entrypoint-gazebo.sh',
  'entrypoint-spawn-robot.sh',
  'entrypoint-nav2.sh',
  'lib/load-validate-input.sh',
  'lib/validate-input.sh',
  'lib/patch-nav2-params.py',
  'config/cyclonedds-qos.xml',
  'worlds',
  'www',
] as const;

import type { EmbeddedRobotProfile } from './EmbeddedRobotProfile';

export interface LaunchImageRobotProfile {
  id: string;
  displayName: string;
  kind: 'launch';
  packageName: string;
  launchFile: string;
  launchArguments: string;
  supportsNavigation?: boolean;
}

export interface EmbeddedSdfImageRobotProfile {
  id: string;
  displayName: string;
  kind: 'embedded-sdf';
  /** Image-relative SDF profile; it has no host source id. */
  profile: Omit<EmbeddedRobotProfile, 'sourceId'>;
  /** Launch-equivalent defaults shown for inspection and used if the user customizes the launch. */
  launchDefaults: Pick<LaunchImageRobotProfile, 'packageName' | 'launchFile' | 'launchArguments'>;
}

export type ImageRobotProfile = LaunchImageRobotProfile | EmbeddedSdfImageRobotProfile;

/** User-editable selection seeded from a discovered image profile or custom launch mode. */
export interface RobotProfileSelection {
  profileId: string;
  customized: boolean;
  packageName: string;
  launchFile: string;
  launchArguments: string;
}

export const CUSTOM_LAUNCH_PROFILE_ID = '__custom_launch__';

export const TURTLEBOT3_IMAGE_PROFILE: LaunchImageRobotProfile = {
  id: 'turtlebot3',
  displayName: 'TurtleBot3',
  kind: 'launch',
  packageName: 'nav2_minimal_tb3_sim',
  launchFile: 'launch/spawn_tb3.launch.py',
  launchArguments:
    'use_sim_time:=True\nnamespace:={name}\nrobot_name:={name}\nx_pose:={x}\ny_pose:={y}\nyaw:={yaw}\nz_pose:=0.01',
  supportsNavigation: true,
};

export function defaultRobotProfileSelection(profile: ImageRobotProfile): RobotProfileSelection {
  return {
    profileId: profile.id,
    customized: false,
    packageName: profile.kind === 'launch' ? profile.packageName : profile.launchDefaults.packageName,
    launchFile: profile.kind === 'launch' ? profile.launchFile : profile.launchDefaults.launchFile,
    launchArguments: profile.kind === 'launch' ? profile.launchArguments : profile.launchDefaults.launchArguments,
  };
}

export function customLaunchSelection(customized = false): RobotProfileSelection {
  return {
    profileId: CUSTOM_LAUNCH_PROFILE_ID,
    customized,
    packageName: '',
    launchFile: '',
    launchArguments: '',
  };
}

export function initialRobotProfileSelection(profiles: ImageRobotProfile[]): RobotProfileSelection {
  const preferred = profiles.find(profile => profile.id === 'turtlebot3') ?? profiles[0];
  return preferred ? defaultRobotProfileSelection(preferred) : customLaunchSelection();
}

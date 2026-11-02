import type { EmbeddedRobotProfile } from './EmbeddedRobotProfile';
import { DEFAULT_ROBOT_ID, resolveRobotDefinition } from './RobotDefinitions';

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

const defaultRobot = resolveRobotDefinition(DEFAULT_ROBOT_ID);

export const TURTLEBOT3_IMAGE_PROFILE: LaunchImageRobotProfile = {
  id: defaultRobot.id,
  displayName: defaultRobot.displayName,
  kind: 'launch',
  packageName: defaultRobot.minimalSimPackage,
  launchFile: `launch/${defaultRobot.minimalSimLaunch}`,
  launchArguments: defaultRobot.launchArguments,
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
  const preferred = profiles.find(profile => profile.id === DEFAULT_ROBOT_ID) ?? profiles[0];
  return preferred ? defaultRobotProfileSelection(preferred) : customLaunchSelection();
}

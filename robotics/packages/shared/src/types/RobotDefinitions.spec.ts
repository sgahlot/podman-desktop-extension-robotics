import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_ROBOT_ID, ROBOT_DEFINITIONS, resolveRobotDefinition } from './RobotDefinitions';
import { SIMULATION_PROFILES } from './SimulationProfiles';
import { TURTLEBOT3_IMAGE_PROFILE, initialRobotProfileSelection } from './ImageRobotProfile';

describe('robot definitions', () => {
  it('keeps TurtleBot3 as the only built-in robot and preserves launch defaults', () => {
    expect(ROBOT_DEFINITIONS.map(robot => robot.id)).toEqual(['turtlebot3']);
    const robot = resolveRobotDefinition(DEFAULT_ROBOT_ID);
    expect(robot).toMatchObject({
      id: 'turtlebot3',
      modelEnvVar: 'TURTLEBOT3_MODEL',
      modelValue: 'waffle',
      descriptionPackage: 'nav2_minimal_tb3_sim',
      urdfPath: 'urdf/turtlebot3_waffle.urdf',
      bridgeConfig: 'configs/turtlebot3_waffle_bridge.yaml',
      minimalSimPackage: 'nav2_minimal_tb3_sim',
      minimalSimLaunch: 'spawn_tb3.launch.py',
      nav2ParamsTemplate: 'params/nav2_params.yaml',
    });
    expect(TURTLEBOT3_IMAGE_PROFILE).toEqual({
      id: robot.id,
      displayName: robot.displayName,
      kind: 'launch',
      packageName: robot.minimalSimPackage,
      launchFile: `launch/${robot.minimalSimLaunch}`,
      launchArguments:
        'use_sim_time:=True\nnamespace:={name}\nrobot_name:={name}\nx_pose:={x}\ny_pose:={y}\nyaw:={yaw}\nz_pose:=0.01',
      supportsNavigation: true,
    });
  });

  it('rejects unknown ids rather than silently selecting the default', () => {
    for (const id of ['', 'unknown', '../turtlebot3', 'turtlebot3;id']) {
      expect(() => resolveRobotDefinition(id)).toThrow('Unknown robot definition');
    }
  });

  it('keeps the standalone image container-level model env in sync for direct ROS exec', () => {
    const containerfile = readFileSync(
      new URL('../../../backend/assets/ros2-jazzy-sim/Containerfile', import.meta.url),
      'utf-8',
    );
    const robot = resolveRobotDefinition(DEFAULT_ROBOT_ID);
    expect(containerfile.split('\n')).toContain(`ENV ${robot.modelEnvVar}=${robot.modelValue}`);
  });

  it('keeps the catalog immutable and resolves every bundled simulation profile', () => {
    expect(Object.isFrozen(ROBOT_DEFINITIONS)).toBe(true);
    for (const robot of ROBOT_DEFINITIONS) expect(Object.isFrozen(robot)).toBe(true);
    for (const profile of SIMULATION_PROFILES) expect(resolveRobotDefinition(profile.robot)).toBeDefined();
  });

  it('retains custom profile fallback and default built-in preference', () => {
    const custom = { ...TURTLEBOT3_IMAGE_PROFILE, id: 'custom', displayName: 'Custom' };
    expect(initialRobotProfileSelection([custom, TURTLEBOT3_IMAGE_PROFILE]).profileId).toBe(DEFAULT_ROBOT_ID);
    expect(initialRobotProfileSelection([custom]).profileId).toBe('custom');
    expect(initialRobotProfileSelection([]).profileId).toBe('__custom_launch__');
  });
});

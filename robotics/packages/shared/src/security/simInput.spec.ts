import { describe, it, expect } from 'vitest';
import {
  assertRobotName,
  assertRosTopicName,
  assertRosDistro,
  assertNumericArg,
  assertSpawnExecCommand,
  assertRobotLaunch,
  assertEmbeddedRobotProfile,
  assertLaunchCmd,
  assertLaunchEnv,
  assertRobotsEnv,
  assertBrowserPort,
  simulationBrowserUrl,
  NOVNC_BROWSER_PATH,
  SPAWN_ENTRYPOINT,
  GAZEBO_ENTRYPOINT,
  distroFromImageRef,
  imageSupportsNav2Prewarm,
} from './simInput';

describe('simInput security validators', () => {
  it('accepts valid robot names', () => {
    expect(assertRobotName('robot_1')).toBe('robot_1');
    expect(assertRobotName('tb3-waffle')).toBe('tb3-waffle');
  });

  it('rejects shell-metacharacter robot names', () => {
    expect(() => assertRobotName('robot;id')).toThrow(/Invalid robot name/);
    expect(() => assertRobotName('$(id)')).toThrow(/Invalid robot name/);
    expect(() => assertRobotName('../etc')).toThrow(/Invalid robot name/);
    expect(() => assertRobotName('')).toThrow(/Invalid robot name/);
  });

  it('accepts valid topic names', () => {
    expect(assertRosTopicName('/rosout')).toBe('/rosout');
    expect(assertRosTopicName('/robot_1/cmd_vel')).toBe('/robot_1/cmd_vel');
  });

  it('rejects injectable topic names', () => {
    expect(() => assertRosTopicName('/cmd_vel; id')).toThrow(/Invalid ROS topic/);
    expect(() => assertRosTopicName('cmd_vel')).toThrow(/Invalid ROS topic/);
    expect(() => assertRosTopicName('/foo/../bar')).toThrow(/Invalid ROS topic/);
  });

  it('allows humble, jazzy, and lyrical distros', () => {
    expect(assertRosDistro('humble')).toBe('humble');
    expect(assertRosDistro('jazzy')).toBe('jazzy');
    expect(assertRosDistro('lyrical')).toBe('lyrical');
    expect(() => assertRosDistro('foxy')).toThrow(/Unsupported ROS distro/);
  });

  it('detects Nav2-capable distros from image refs', () => {
    expect(distroFromImageRef('quay.io/ns/ros2-jazzy-sim:noble-amd64')).toBe('jazzy');
    expect(distroFromImageRef('quay.io/ns/robotics-fedora-bootc-43:ros2-lyrical')).toBe('lyrical');
    expect(imageSupportsNav2Prewarm('quay.io/ns/robotics-fedora-bootc-43:ros2-lyrical')).toBe(true);
    expect(imageSupportsNav2Prewarm('quay.io/ns/ros2-humble-turtlebot3:sloretz')).toBe(false);
  });

  it('validates spawn exec commands', () => {
    expect(assertSpawnExecCommand([SPAWN_ENTRYPOINT, 'robot_1', '0', '1.5', '-0.5'])).toEqual([
      SPAWN_ENTRYPOINT,
      'robot_1',
      '0',
      '1.5',
      '-0.5',
    ]);

    expect(() => assertSpawnExecCommand(['bash', '-c', 'id'])).toThrow(/Only/);
    expect(() => assertSpawnExecCommand([SPAWN_ENTRYPOINT, 'robot;x', '0', '0', '0'])).toThrow(/Invalid robot name/);
    expect(() => assertNumericArg('1;id', 'x')).toThrow(/must be a number/);
    expect(() => assertSpawnExecCommand([SPAWN_ENTRYPOINT, 'custom_1', '0', '0', '0', 'unexpected'])).toThrow(
      /exactly/,
    );
  });

  it('validates image-provided package launch configurations', () => {
    expect(
      assertRobotLaunch({
        packageName: 'my_robot_sim',
        launchFile: 'launch/spawn.launch.py',
        arguments: ['robot_name:=robot_1'],
      }),
    ).toEqual({
      packageName: 'my_robot_sim',
      launchFile: 'launch/spawn.launch.py',
      arguments: ['robot_name:=robot_1'],
    });
    expect(() => assertRobotLaunch({ packageName: 'robot;id', launchFile: 'spawn.launch.py', arguments: [] })).toThrow(
      /package/,
    );
    expect(() =>
      assertRobotLaunch({ packageName: 'robot_sim', launchFile: '../spawn.launch.py', arguments: [] }),
    ).toThrow(/launch file/);
    expect(() =>
      assertRobotLaunch({ packageName: 'robot_sim', launchFile: 'spawn.launch.py', arguments: ['x;id:=0'] }),
    ).toThrow(/argument/);
  });

  it('validates embedded SDF profile paths and spawn height', () => {
    expect(
      assertEmbeddedRobotProfile({
        id: 'boxbot',
        displayName: 'Box Bot',
        modelFile: 'robots/boxbot/model.sdf',
        world: 'tb3_sandbox',
        z: 0.15,
        sourceId: 'local-profile',
      }).z,
    ).toBe(0.15);
    expect(() =>
      assertEmbeddedRobotProfile({
        id: '../escape',
        displayName: 'Bad',
        modelFile: 'model.sdf',
        world: 'tb3_sandbox',
        z: 0,
        sourceId: 'local-profile',
      }),
    ).toThrow(/profile id/i);
    expect(() =>
      assertEmbeddedRobotProfile({
        id: 'boxbot',
        displayName: 'Bad',
        modelFile: '../outside.sdf',
        world: 'tb3_sandbox',
        z: 0,
        sourceId: 'local-profile',
      }),
    ).toThrow(/SDF path/i);
    expect(() =>
      assertEmbeddedRobotProfile({
        id: 'boxbot',
        displayName: 'Bad',
        modelFile: 'model.sdf',
        world: 'tb3_sandbox',
        z: Number.NaN,
        sourceId: 'local-profile',
      }),
    ).toThrow(/z/i);
  });

  it('forces gazebo Cmd and rejects custom entrypoints', () => {
    expect(assertLaunchCmd(undefined)).toEqual([GAZEBO_ENTRYPOINT]);
    expect(assertLaunchCmd([GAZEBO_ENTRYPOINT])).toEqual([GAZEBO_ENTRYPOINT]);
    expect(() => assertLaunchCmd(['/bin/sh'])).toThrow(/only allows Cmd/);
    expect(() => assertLaunchCmd([GAZEBO_ENTRYPOINT, 'extra'])).toThrow(/only allows Cmd/);
  });

  it('allowlists launch env keys and validates ROBOTS', () => {
    expect(assertLaunchEnv({ WORLD_NAME: 'empty', ROBOTS: 'a:0:0:0' })).toEqual({
      WORLD_NAME: 'empty',
      ROBOTS: 'a:0:0:0',
    });
    expect(() => assertLaunchEnv({ PATH: '/bin' })).toThrow(/not allowed/);
    expect(() => assertLaunchEnv({ LD_PRELOAD: 'x' })).toThrow(/not allowed/);
    expect(() => assertRobotsEnv('bad;entry')).toThrow(/Invalid ROBOTS entry/);
    expect(() => assertRobotsEnv('robot;x:0:0:0')).toThrow(/Invalid robot name/);
  });

  it('allows RMW_IMPLEMENTATION=rmw_zenoh_cpp for launchSimulation (APPENG-5775) and rejects other values', () => {
    expect(assertLaunchEnv({ RMW_IMPLEMENTATION: 'rmw_zenoh_cpp' })).toEqual({
      RMW_IMPLEMENTATION: 'rmw_zenoh_cpp',
    });
    expect(() => assertLaunchEnv({ RMW_IMPLEMENTATION: 'rmw_fastrtps_cpp' })).toThrow(/Invalid RMW_IMPLEMENTATION/);
    expect(() => assertLaunchEnv({ RMW_IMPLEMENTATION: 'evil; rm -rf /' })).toThrow(/Invalid RMW_IMPLEMENTATION/);
  });

  it('allowlists browser ports for openSimulationInBrowser', () => {
    expect(assertBrowserPort(6080)).toBe(6080);
    expect(assertBrowserPort(8080)).toBe(8080);
    expect(() => assertBrowserPort(22)).toThrow(/not allowed/);
    expect(() => assertBrowserPort(6080.5)).toThrow(/not allowed/);
  });

  it('builds noVNC reconnect URL for port 6080', () => {
    expect(simulationBrowserUrl(6080)).toBe(`http://localhost:6080${NOVNC_BROWSER_PATH}`);
    expect(simulationBrowserUrl(16080, 6080)).toBe(`http://localhost:16080${NOVNC_BROWSER_PATH}`);
    expect(simulationBrowserUrl(8080)).toBe('http://localhost:8080');
    expect(() => simulationBrowserUrl(16080)).toThrow(/not allowed/);
  });
});

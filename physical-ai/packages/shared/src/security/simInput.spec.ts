import { describe, it, expect } from 'vitest';
import {
  assertRobotName,
  assertRosTopicName,
  assertRosDistro,
  assertNumericArg,
  assertSpawnExecCommand,
  assertLaunchCmd,
  assertLaunchEnv,
  assertRobotsEnv,
  SPAWN_ENTRYPOINT,
  GAZEBO_ENTRYPOINT,
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

  it('only allows humble and jazzy distros', () => {
    expect(assertRosDistro('humble')).toBe('humble');
    expect(assertRosDistro('jazzy')).toBe('jazzy');
    expect(() => assertRosDistro('foxy')).toThrow(/Unsupported ROS distro/);
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
    expect(() => assertSpawnExecCommand([SPAWN_ENTRYPOINT, 'robot;x', '0', '0', '0'])).toThrow(
      /Invalid robot name/,
    );
    expect(() => assertNumericArg('1;id', 'x')).toThrow(/must be a number/);
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
});

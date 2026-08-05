import { describe, it, expect } from 'vitest';
import {
  assertRobotName,
  assertRosTopicName,
  assertRosDistro,
  assertNumericArg,
  assertSpawnExecCommand,
  SPAWN_ENTRYPOINT,
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

  it('validates spawn exec command allowlist', () => {
    expect(
      assertSpawnExecCommand([SPAWN_ENTRYPOINT, 'robot_1', '-2.0', '0.5', '0.0']),
    ).toEqual([SPAWN_ENTRYPOINT, 'robot_1', '-2.0', '0.5', '0.0']);

    expect(() => assertSpawnExecCommand(['bash', '-c', 'id'])).toThrow(/Only/);
    expect(() => assertSpawnExecCommand([SPAWN_ENTRYPOINT, 'robot;x', '0', '0', '0'])).toThrow(
      /Invalid robot name/,
    );
    expect(() => assertNumericArg('1;id', 'x')).toThrow(/must be a number/);
  });
});

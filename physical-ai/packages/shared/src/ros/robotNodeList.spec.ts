import { describe, it, expect } from 'vitest';
import { parseSpawnedRobotNames } from './robotNodeList';

describe('parseSpawnedRobotNames', () => {
  it('extracts unique robot names from namespaced nodes', () => {
    const stdout =
      '/robot_1/robot_state_publisher\n/robot_1/amcl\n/robot_2/robot_state_publisher\n/some_top_level_node\n';
    expect(parseSpawnedRobotNames(stdout)).toEqual(['robot_1', 'robot_2']);
  });

  it('returns an empty array when no robots are running', () => {
    expect(parseSpawnedRobotNames('/some_top_level_node\n/another_node\n')).toEqual([]);
  });

  it('returns an empty array for blank output', () => {
    expect(parseSpawnedRobotNames('')).toEqual([]);
    expect(parseSpawnedRobotNames('   \n  \n')).toEqual([]);
  });

  it('dedupes multiple nodes under the same robot namespace', () => {
    expect(parseSpawnedRobotNames('/robot_1/a\n/robot_1/b\n/robot_1/c\n')).toEqual(['robot_1']);
  });

  it('is not restricted to a robot_N naming convention', () => {
    expect(parseSpawnedRobotNames('/leo/amcl\n/leo/robot_state_publisher\n')).toEqual(['leo']);
  });

  it('sorts results', () => {
    expect(parseSpawnedRobotNames('/robot_2/a\n/robot_1/a\n')).toEqual(['robot_1', 'robot_2']);
  });
});

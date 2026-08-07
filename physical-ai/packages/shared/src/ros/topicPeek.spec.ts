import { describe, it, expect } from 'vitest';
import {
  cleanEchoOutput,
  extractMessageStamp,
  parseEchoYamlTree,
  shortMessageType,
  assertRosMessageType,
  assertPeekTimeoutSeconds,
  PEEK_MAX_BYTES,
  PEEK_TIMEOUT_MIN_SEC,
  PEEK_TIMEOUT_MAX_SEC,
  PEEK_TIMEOUT_DEFAULT_SEC,
} from './topicPeek';

describe('assertPeekTimeoutSeconds', () => {
  it('accepts integers in range', () => {
    expect(assertPeekTimeoutSeconds(1)).toBe(1);
    expect(assertPeekTimeoutSeconds(5)).toBe(5);
    expect(assertPeekTimeoutSeconds(30)).toBe(30);
  });

  it('rejects values below the minimum', () => {
    expect(() => assertPeekTimeoutSeconds(0)).toThrow(
      new RegExp(`at least ${PEEK_TIMEOUT_MIN_SEC}`),
    );
  });

  it('rejects values above the maximum', () => {
    expect(() => assertPeekTimeoutSeconds(31)).toThrow(
      new RegExp(`at most ${PEEK_TIMEOUT_MAX_SEC}`),
    );
  });

  it('rejects non-integers', () => {
    expect(() => assertPeekTimeoutSeconds(2.5)).toThrow(/whole number/);
    expect(() => assertPeekTimeoutSeconds('abc')).toThrow(/whole number/);
  });
});

describe('cleanEchoOutput', () => {
  it('strips lost-message and total-count noise', () => {
    const raw = [
      '[WARN] [x]: A message was lost!!!',
      '[WARN] [x]: total count change=5',
      'linear:',
      '  x: 0.2',
      '---',
    ].join('\n');
    const result = cleanEchoOutput(raw);
    expect(result.message).toBe('linear:\n  x: 0.2');
    expect(result.truncated).toBe(false);
  });

  it('extracts header.stamp', () => {
    const raw = [
      'header:',
      '  stamp:',
      '    sec: 21039',
      '    nanosec: 900000000',
      '  frame_id: base',
    ].join('\n');
    const result = cleanEchoOutput(raw);
    expect(result.messageStamp).toBe('sec=21039 nanosec=900000000');
  });

  it('truncates oversized payloads', () => {
    const raw = 'data: ' + 'x'.repeat(PEEK_MAX_BYTES + 100);
    const result = cleanEchoOutput(raw);
    expect(result.truncated).toBe(true);
    expect(result.message).toContain('… (truncated)');
    expect(result.message.length).toBeLessThan(raw.length);
  });
});

describe('extractMessageStamp', () => {
  it('reads inline stamp maps', () => {
    expect(extractMessageStamp('stamp: {sec: 1, nanosec: 2}\ndata: hi')).toBe(
      'sec=1 nanosec=2',
    );
  });
});

describe('parseEchoYamlTree', () => {
  it('builds a nested tree for Twist-like YAML', () => {
    const tree = parseEchoYamlTree('linear:\n  x: 0.2\n  y: 0.0\nangular:\n  z: 0.1\n');
    expect(tree).toHaveLength(2);
    expect(tree[0].key).toBe('linear');
    expect(tree[0].children?.map(c => c.key)).toEqual(['x', 'y']);
    expect(tree[0].children?.[0].value).toBe('0.2');
    expect(tree[1].key).toBe('angular');
  });

  it('returns empty for blank input', () => {
    expect(parseEchoYamlTree('')).toEqual([]);
  });
});

describe('shortMessageType', () => {
  it('returns the last path segment', () => {
    expect(shortMessageType('geometry_msgs/msg/Twist')).toBe('Twist');
    expect(shortMessageType('String')).toBe('String');
  });
});

describe('assertRosMessageType', () => {
  it('accepts ROS 2 message types', () => {
    expect(assertRosMessageType('sensor_msgs/msg/JointState')).toBe(
      'sensor_msgs/msg/JointState',
    );
  });

  it('rejects injectable types', () => {
    expect(() => assertRosMessageType('std_msgs/msg/String; id')).toThrow(/Invalid ROS message/);
    expect(() => assertRosMessageType('std_msgs/String')).toThrow(/Invalid ROS message/);
  });
});

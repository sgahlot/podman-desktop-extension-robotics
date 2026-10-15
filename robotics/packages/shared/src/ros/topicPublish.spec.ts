import { describe, expect, it } from 'vitest';
import {
  assertRosTopicPublishConfirmed,
  assertRosTopicPublishPayload,
  getRosTopicPublishWarning,
  ROS_TOPIC_PUBLISH_MAX_BYTES,
  topicPublishPayloadBytes,
} from './topicPublish';

describe('topicPublish', () => {
  it('counts UTF-8 payload bytes, not JavaScript code units', () => {
    expect(topicPublishPayloadBytes('data: "robot 🤖"')).toBe(new TextEncoder().encode('data: "robot 🤖"').byteLength);
  });

  it('accepts a small YAML payload and rejects empty or oversized payloads', () => {
    expect(assertRosTopicPublishPayload('data: hello')).toBe('data: hello');
    expect(() => assertRosTopicPublishPayload('   ')).toThrow(/must not be empty/);
    expect(() => assertRosTopicPublishPayload('x'.repeat(ROS_TOPIC_PUBLISH_MAX_BYTES + 1))).toThrow(/byte limit/);
  });

  it('requires explicit confirmation', () => {
    expect(() => assertRosTopicPublishConfirmed(false)).toThrow(/Confirm that this one-shot message/);
    expect(() => assertRosTopicPublishConfirmed(true)).not.toThrow();
  });

  it('warns for sensitive topics without restricting developer testing', () => {
    expect(getRosTopicPublishWarning('/test/messages')).toBeUndefined();
    for (const topic of ['/robot_1/cmd_vel', '/robot_1/scan', '/tf', '/clock', '/robot_1/initialpose']) {
      expect(getRosTopicPublishWarning(topic)).toMatch(/may affect/);
    }
  });
});

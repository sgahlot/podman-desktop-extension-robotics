import { describe, it, expect } from 'vitest';
import type { TopicInfo } from '../types/TopicInfo';
import {
  parseRosTopicListDump,
  parseRosTopicListTypes,
  ROS_TOPIC_LIST_INFO_SCRIPT,
  topicSnapshotsEqual,
  mergeTopicSummaries,
  applyTopicCounts,
  ROS_TOPIC_INFO_CONCURRENCY,
} from './topicList';

describe('ROS_TOPIC_LIST_INFO_SCRIPT', () => {
  it('runs topic info with a quoted loop variable (not interpolated names)', () => {
    expect(ROS_TOPIC_LIST_INFO_SCRIPT).toContain('ros2 topic list');
    expect(ROS_TOPIC_LIST_INFO_SCRIPT).toContain('ros2 topic info "$name"');
  });

  it(`runs topic info in batches of ${ROS_TOPIC_INFO_CONCURRENCY}`, () => {
    expect(ROS_TOPIC_LIST_INFO_SCRIPT).toContain(`-ge ${ROS_TOPIC_INFO_CONCURRENCY}`);
    expect(ROS_TOPIC_LIST_INFO_SCRIPT).toContain('mktemp -d');
  });
});

describe('parseRosTopicListDump', () => {
  it('parses name, type, and pub/sub counts from a combined dump', () => {
    const stdout = [
      'T\t/rosout',
      'Type: rcl_interfaces/msg/Log',
      'Publisher count: 2',
      'Subscription count: 0',
      'T\t/robot_1/cmd_vel',
      'Type: geometry_msgs/msg/Twist',
      'Publisher count: 0',
      'Subscription count: 1',
      '',
    ].join('\n');

    expect(parseRosTopicListDump(stdout)).toEqual([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 2, subscribers: 0 },
      { name: '/robot_1/cmd_vel', type: 'geometry_msgs/msg/Twist', publishers: 0, subscribers: 1 },
    ]);
  });

  it('defaults type and counts when topic info produced no lines', () => {
    expect(parseRosTopicListDump('T\t/rosout\n')).toEqual([
      { name: '/rosout', type: 'unknown', publishers: 0, subscribers: 0 },
    ]);
  });

  it('skips injectable / non-allowlisted topic names', () => {
    const stdout =
      'T\t/rosout\nType: rcl_interfaces/msg/Log\nPublisher count: 1\nSubscription count: 0\nT\t/cmd_vel; id\n';
    expect(parseRosTopicListDump(stdout).map(t => t.name)).toEqual(['/rosout']);
  });

  it('returns an empty array for blank output', () => {
    expect(parseRosTopicListDump('')).toEqual([]);
    expect(parseRosTopicListDump('   \n  \n')).toEqual([]);
  });
});

describe('topicSnapshotsEqual', () => {
  const sample = { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 1, subscribers: 0 };

  it('is true for field-equal snapshots even with different array identities', () => {
    expect(topicSnapshotsEqual([sample], [{ ...sample }])).toBe(true);
  });

  it('is false when a count changes', () => {
    expect(topicSnapshotsEqual([sample], [{ ...sample, publishers: 2 }])).toBe(false);
  });

  it('is false when length differs', () => {
    expect(topicSnapshotsEqual([sample], [])).toBe(false);
  });
});

describe('parseRosTopicListTypes', () => {
  it('parses names and types from ros2 topic list -t', () => {
    const stdout = '/rosout [rcl_interfaces/msg/Log]\n/robot_1/cmd_vel [geometry_msgs/msg/Twist]\n';
    expect(parseRosTopicListTypes(stdout)).toEqual([
      {
        name: '/rosout',
        type: 'rcl_interfaces/msg/Log',
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      },
      {
        name: '/robot_1/cmd_vel',
        type: 'geometry_msgs/msg/Twist',
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      },
    ]);
  });

  it('skips injectable names', () => {
    expect(
      parseRosTopicListTypes('/rosout [rcl_interfaces/msg/Log]\n/cmd_vel; id [std_msgs/msg/String]\n').map(t => t.name),
    ).toEqual(['/rosout']);
  });
});

describe('mergeTopicSummaries / applyTopicCounts', () => {
  it('keeps existing counts for names already fetched', () => {
    const previous: TopicInfo[] = [{ name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 2, subscribers: 1 }];
    const summaries: TopicInfo[] = [
      {
        name: '/rosout',
        type: 'rcl_interfaces/msg/Log',
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      },
      {
        name: '/cmd_vel',
        type: 'geometry_msgs/msg/Twist',
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      },
    ];
    expect(mergeTopicSummaries(previous, summaries)).toEqual([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 2, subscribers: 1 },
      {
        name: '/cmd_vel',
        type: 'geometry_msgs/msg/Twist',
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      },
    ]);
  });

  it('applies counts from the info dump onto the visible list', () => {
    const previous: TopicInfo[] = [
      {
        name: '/rosout',
        type: 'rcl_interfaces/msg/Log',
        publishers: 0,
        subscribers: 0,
        countsPending: true,
      },
    ];
    const detailed: TopicInfo[] = [{ name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 4, subscribers: 2 }];
    expect(applyTopicCounts(previous, detailed)).toEqual([
      { name: '/rosout', type: 'rcl_interfaces/msg/Log', publishers: 4, subscribers: 2 },
    ]);
  });
});

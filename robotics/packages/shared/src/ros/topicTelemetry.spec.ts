import { describe, expect, it } from 'vitest';
import {
  parseTopicTelemetryOutput,
  ROS_TOPIC_TELEMETRY_CONCURRENCY,
  ROS_TOPIC_TELEMETRY_MAX_TOPICS,
  ROS_TOPIC_TELEMETRY_SAMPLE_SECONDS,
  ROS_TOPIC_TELEMETRY_SCRIPT,
} from './topicTelemetry';

describe('parseTopicTelemetryOutput', () => {
  it('derives publish rate from bandwidth and mean message size', () => {
    const result = parseTopicTelemetryOutput('__PAI_BW_BEGIN__\naverage: 1.25MB/s\nMessage size mean: 100.00 KB\n');

    expect(result).toEqual({ status: 'active', publishHz: 12.5, bandwidthBytesPerSecond: 1_250_000 });
  });

  it('supports binary size units and scientific notation', () => {
    const result = parseTopicTelemetryOutput('__PAI_BW_BEGIN__\naverage: 2.5KiB/s\nMessage size mean: 512B\n');

    expect(result).toEqual({ status: 'active', publishHz: 5, bandwidthBytesPerSecond: 2560 });
  });

  it('parses the Jazzy ros2 topic bw summary format', () => {
    const result = parseTopicTelemetryOutput(
      '__PAI_BW_BEGIN__\n26.12 KB/s from 5 messages\nMessage size mean: 2.94 KB\n',
    );

    expect(result.status).toBe('active');
    expect(result.bandwidthBytesPerSecond).toBe(26_120);
    expect(result.publishHz).toBeCloseTo(26_120 / 2_940);
  });

  it('uses the latest periodic bandwidth sample', () => {
    const result = parseTopicTelemetryOutput(
      '__PAI_BW_BEGIN__\n15.85 KB/s from 5 messages\nMessage size mean: 2.94 KB\n13.74 KB/s from 9 messages\nMessage size mean: 2.94 KB\n',
    );

    expect(result.bandwidthBytesPerSecond).toBe(13_740);
    expect(result.publishHz).toBeCloseTo(13_740 / 2_940);
  });

  it('marks an observer window with no received samples', () => {
    const result = parseTopicTelemetryOutput(
      '__PAI_BW_BEGIN__\nWARNING: topic [/idle] does not appear to be published yet\n',
    );

    expect(result).toEqual({ status: 'no-samples' });
  });

  it('surfaces missing ROS CLI commands as unavailable', () => {
    const result = parseTopicTelemetryOutput('__PAI_BW_BEGIN__\n', 'ros2: error: command not found: bw');

    expect(result.status).toBe('unavailable');
    expect(result.error).toMatch(/command not found/);
  });

  it('keeps topic collection explicitly bounded', () => {
    expect(ROS_TOPIC_TELEMETRY_MAX_TOPICS).toBe(4);
    expect(ROS_TOPIC_TELEMETRY_CONCURRENCY).toBe(2);
    expect(ROS_TOPIC_TELEMETRY_SAMPLE_SECONDS).toBe(3);
    expect(ROS_TOPIC_TELEMETRY_SCRIPT).toContain('timeout -k 1 "$sample_seconds" ros2 topic bw --window 10');
    expect(ROS_TOPIC_TELEMETRY_SCRIPT).not.toContain('ros2 topic hz');
    expect(ROS_TOPIC_TELEMETRY_SCRIPT.match(/ros2 topic bw/g)).toHaveLength(1);
    expect(ROS_TOPIC_TELEMETRY_SCRIPT).toContain('"$topic"');
  });
});

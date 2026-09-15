import { describe, it, expect } from 'vitest';
import {
  TF_FRAME_PAIRS,
  parseTfEchoOutput,
  parseOccupancyGridEcho,
  parseLaserScanEcho,
  parseImuEcho,
  deriveRobotNamespaces,
  discoverRobotSensorTopics,
  sensorTypeShortLabel,
} from './robotDiagnostics';
import type { TopicInfo } from '../types/TopicInfo';

describe('TF_FRAME_PAIRS', () => {
  it('is the curated map->odom->base_footprint->base_link->base_scan chain', () => {
    expect(TF_FRAME_PAIRS).toEqual([
      ['map', 'odom'],
      ['odom', 'base_footprint'],
      ['base_footprint', 'base_link'],
      ['base_link', 'base_scan'],
    ]);
  });
});

describe('parseTfEchoOutput', () => {
  it('parses translation and quaternion from an available transform', () => {
    const raw = `[INFO] [1787855941.381246561] [tf2_echo]: Waiting for transform map ->  odom: Invalid frame ID "map" passed to canTransform argument target_frame - frame does not exist
At time 41024.400000000
- Translation: [-2.085, -0.571, 0.000]
- Rotation: in Quaternion (xyzw) [0.000, 0.000, 0.014, 1.000]
- Rotation: in RPY (radian) [0.000, -0.000, 0.029]
At time 41025.200000000
- Translation: [-2.100, -0.580, 0.001]
- Rotation: in Quaternion (xyzw) [0.000, 0.000, 0.015, 0.999]
- Rotation: in RPY (radian) [0.000, -0.000, 0.030]
`;
    const result = parseTfEchoOutput(raw);
    expect(result.available).toBe(true);
    // Takes the LAST sample, not the first.
    expect(result.translation).toEqual({ x: -2.1, y: -0.58, z: 0.001 });
    expect(result.rotationQuaternion).toEqual({ x: 0, y: 0, z: 0.015, w: 0.999 });
    expect(result.error).toBeUndefined();
  });

  it('marks a transform unavailable when no sample is ever printed (idle/missing frame)', () => {
    const raw = `[INFO] [1787855941.381246561] [tf2_echo]: Waiting for transform map ->  odom: Invalid frame ID "map" passed to canTransform argument target_frame - frame does not exist
`;
    const result = parseTfEchoOutput(raw);
    expect(result.available).toBe(false);
    expect(result.translation).toBeUndefined();
    expect(result.error).toMatch(/invalid frame id/i);
  });

  it('marks a transform unavailable on malformed/empty output', () => {
    const result = parseTfEchoOutput('');
    expect(result.available).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

describe('parseOccupancyGridEcho', () => {
  it('parses a typical grid with a mix of occupied/free/unknown cells', () => {
    const text = `header:
  stamp:
    sec: 41066
    nanosec: 193000000
  frame_id: odom
info:
  map_load_time:
    sec: 0
    nanosec: 0
  resolution: 0.05000000074505806
  width: 3
  height: 2
  origin:
    position:
      x: 2.199999999627471
      y: 0.6499999996274712
      z: 0.0
    orientation:
      x: 0.0
      y: 0.0
      z: 0.0
      w: 1.0
data: [-1, 0, 100, 99, 0, -1]
`;
    const result = parseOccupancyGridEcho(text);
    expect(result).toEqual({
      width: 3,
      height: 2,
      resolution: 0.05000000074505806,
      originX: 2.199999999627471,
      originY: 0.6499999996274712,
      occupied: 2,
      free: 2,
      unknown: 2,
      total: 6,
    });
  });

  it('treats every cell as unknown when the whole grid is unexplored', () => {
    const text = `info:
  resolution: 0.05
  width: 2
  height: 2
  origin:
    position:
      x: -10.0
      y: -10.0
data: [-1, -1, -1, -1]
`;
    const result = parseOccupancyGridEcho(text);
    expect(result?.unknown).toBe(4);
    expect(result?.occupied).toBe(0);
    expect(result?.free).toBe(0);
    expect(result?.total).toBe(4);
  });

  it('returns undefined for malformed/idle output with no data field', () => {
    expect(parseOccupancyGridEcho('')).toBeUndefined();
    expect(parseOccupancyGridEcho('some unrelated timeout text')).toBeUndefined();
  });

  it('treats out-of-spec negative values (not -1) as unknown, not occupied', () => {
    const text = `info:
  resolution: 0.05
  width: 2
  height: 1
data: [-5, 45]
`;
    const result = parseOccupancyGridEcho(text);
    expect(result?.unknown).toBe(1);
    expect(result?.occupied).toBe(1);
    expect(result?.free).toBe(0);
    expect(result?.total).toBe(2);
  });
});

describe('parseLaserScanEcho', () => {
  it('parses angle/range bounds and reduces a fully-finite ranges array', () => {
    const text = `header:
  stamp:
    sec: 41131
    nanosec: 200000000
  frame_id: base_scan
angle_min: 0.0
angle_max: 6.28000020980835
angle_increment: 0.01749303564429283
time_increment: 0.0
scan_time: 0.0
range_min: 9.999999747378752e-06
range_max: 20.0
ranges: [0.3, 0.5, 0.4]
intensities: [0.0, 0.0, 0.0]
`;
    const result = parseLaserScanEcho(text);
    expect(result).toMatchObject({
      angleMin: 0.0,
      angleMax: 6.28000020980835,
      angleIncrement: 0.01749303564429283,
      rangeMin: 9.999999747378752e-6,
      rangeMax: 20.0,
      min: 0.3,
      max: 0.5,
      finiteCount: 3,
      infCount: 0,
      nanCount: 0,
      totalCount: 3,
    });
    expect(result?.mean).toBeCloseTo(0.4, 10);
  });

  it('counts .inf and .nan entries separately from finite ranges', () => {
    const text = `angle_min: 0.0
angle_max: 6.28
angle_increment: 0.017
range_min: 0.1
range_max: 20.0
ranges: [0.5, .inf, -.inf, .nan, 1.5]
`;
    const result = parseLaserScanEcho(text);
    expect(result?.finiteCount).toBe(2);
    expect(result?.infCount).toBe(2);
    expect(result?.nanCount).toBe(1);
    expect(result?.totalCount).toBe(5);
    expect(result?.min).toBe(0.5);
    expect(result?.max).toBe(1.5);
    expect(result?.mean).toBeCloseTo(1.0, 10);
  });

  it('returns undefined for malformed/idle output with no ranges field', () => {
    expect(parseLaserScanEcho('')).toBeUndefined();
    expect(parseLaserScanEcho('angle_min: 0.0\n')).toBeUndefined();
  });
});

describe('deriveRobotNamespaces', () => {
  function topic(name: string): TopicInfo {
    return { name, type: 'x', publishers: 1, subscribers: 0 };
  }

  it('returns sorted distinct namespaces for a multi-robot topic list', () => {
    const topics = [
      topic('/robot_2/scan'),
      topic('/robot_1/scan'),
      topic('/robot_1/tf'),
      topic('/robot_1/tf_static'),
      topic('/robot_2/local_costmap/costmap'),
      topic('/robot_1/global_costmap/costmap'),
      topic('/rosout'),
    ];
    expect(deriveRobotNamespaces(topics)).toEqual(['robot_1', 'robot_2']);
  });

  it('returns an empty array when no robot-shaped topics are present', () => {
    const topics = [topic('/rosout'), topic('/parameter_events'), topic('/clock')];
    expect(deriveRobotNamespaces(topics)).toEqual([]);
  });

  it('ignores topics that are not the derivation suffixes even if similarly named', () => {
    const topics = [
      topic('/robot_1/scan_matched_points2'),
      topic('/robot_1/local_costmap/footprint'),
      topic('/robot_1/scan'),
    ];
    expect(deriveRobotNamespaces(topics)).toEqual(['robot_1']);
  });
});

describe('parseImuEcho', () => {
  it('parses orientation, angular velocity, and linear acceleration', () => {
    const text = `header:
  stamp:
    sec: 1
    nanosec: 0
  frame_id: imu_link
orientation:
  x: 0.0
  y: 0.0
  z: 0.014
  w: 0.999
angular_velocity:
  x: 0.01
  y: -0.02
  z: 0.03
linear_acceleration:
  x: 0.1
  y: 0.2
  z: 9.81
`;
    const result = parseImuEcho(text);
    expect(result).toMatchObject({
      orientation: { x: 0, y: 0, z: 0.014, w: 0.999 },
      angularVelocity: { x: 0.01, y: -0.02, z: 0.03 },
      linearAcceleration: { x: 0.1, y: 0.2, z: 9.81 },
    });
  });

  it('returns undefined when required blocks are missing', () => {
    expect(parseImuEcho('orientation:\n  x: 0\n  y: 0\n  z: 0\n  w: 1\n')).toBeUndefined();
  });
});

describe('discoverRobotSensorTopics', () => {
  function topic(name: string, type: string): TopicInfo {
    return { name, type, publishers: 1, subscribers: 0 };
  }

  it('returns sensor_msgs topics under the robot namespace, sorted by name', () => {
    const topics = [
      topic('/robot_1/imu', 'sensor_msgs/msg/Imu'),
      topic('/robot_1/scan', 'sensor_msgs/msg/LaserScan'),
      topic('/robot_2/scan', 'sensor_msgs/msg/LaserScan'),
      topic('/robot_1/tf', 'tf2_msgs/msg/TFMessage'),
      topic('/robot_1/camera/image_raw', 'sensor_msgs/msg/Image'),
    ];
    expect(discoverRobotSensorTopics(topics, 'robot_1').map(t => t.name)).toEqual([
      '/robot_1/camera/image_raw',
      '/robot_1/imu',
      '/robot_1/scan',
    ]);
  });
});

describe('sensorTypeShortLabel', () => {
  it('strips the sensor_msgs/msg/ prefix', () => {
    expect(sensorTypeShortLabel('sensor_msgs/msg/LaserScan')).toBe('LaserScan');
    expect(sensorTypeShortLabel('std_msgs/msg/String')).toBe('std_msgs/msg/String');
  });
});

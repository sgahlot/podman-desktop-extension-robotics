import { describe, expect, it } from 'vitest';
import { parseLaserScanVisualization, parsePoseVisualization } from './topicVisualization';

describe('topic visualizations', () => {
  it('converts bounded LaserScan ranges to plot points', () => {
    expect(
      parseLaserScanVisualization('angle_min: 0\nangle_increment: 1.57079632679\nrange_max: 5\nranges: [1, .inf, 2]'),
    ).toEqual({
      rangeMax: 5,
      displayRange: 2.3,
      points: [
        { x: 1, y: 0 },
        { x: -2, y: expect.closeTo(0) },
      ],
    });
  });

  it('supports the block-list YAML output used by ros2 topic echo', () => {
    expect(
      parseLaserScanVisualization(
        'angle_min: 0\nangle_increment: 1\nrange_max: 5\nranges:\n- 1\n- .inf\n- 2\nintensities:\n- 0',
      ),
    ).toMatchObject({
      rangeMax: 5,
      displayRange: 2.3,
      points: [
        { x: 1, y: 0 },
        { x: expect.closeTo(-0.832), y: expect.closeTo(1.819) },
      ],
    });
  });

  it('auto-zooms using the 95th percentile so an isolated max-range return does not flatten the plot', () => {
    const ranges = [...Array(19).fill('2'), '20'].join(', ');
    expect(
      parseLaserScanVisualization(`angle_min: 0\nangle_increment: 0.1\nrange_max: 20\nranges: [${ranges}]`),
    ).toMatchObject({
      rangeMax: 20,
      displayRange: 2.3,
    });
  });

  it('extracts planar pose and yaw from Odometry YAML', () => {
    expect(
      parsePoseVisualization(
        'pose:\n  position:\n    x: 2\n    y: 3\n  orientation:\n    x: 0\n    y: 0\n    z: 0.70710678\n    w: 0.70710678',
      ),
    ).toMatchObject({ x: 2, y: 3, yaw: expect.closeTo(Math.PI / 2) });
  });
});

import { describe, expect, it } from 'vitest';
import { middlewareLabel, middlewareLabelForImage } from './middlewareLabels';

describe('middleware labels', () => {
  it('identifies the default DDS implementation', () => {
    expect(middlewareLabel('dds')).toBe('DDS (Fast DDS / rmw_fastrtps_cpp)');
  });

  it('identifies Zenoh by its RMW implementation', () => {
    expect(middlewareLabel('zenoh')).toBe('Zenoh (rmw_zenoh_cpp)');
  });

  it('identifies parent-provided DDS for Fedora/Lyrical images', () => {
    expect(middlewareLabel('dds', { distro: 'lyrical' })).toBe('DDS (parent image default)');
    expect(middlewareLabelForImage('dds', 'quay.io/example/ros2-lyrical-sim:latest')).toBe(
      'DDS (parent image default)',
    );
  });
});

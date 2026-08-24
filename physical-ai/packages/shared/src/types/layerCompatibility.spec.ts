import { describe, it, expect } from 'vitest';
import { evaluateStack, type LayerSelection } from './layerCompatibility';

function sel(overrides: Partial<LayerSelection>): LayerSelection {
  return {
    baseOs: 'ubuntu-noble',
    hardened: 'none',
    ros: 'none',
    sim: 'none',
    ...overrides,
  };
}

describe('evaluateStack', () => {
  it('ubuntu + jazzy + sim is a known-good combination', () => {
    const result = evaluateStack(sel({ baseOs: 'ubuntu-noble', ros: 'ros2-jazzy', sim: 'gazebo-nav2-tb3' }));
    expect(result.level).toBe('ok');
    expect(result.buildable).toBe(true);
    expect(result.failsAtStep).toBeUndefined();
    expect(result.messages.some(m => m.text.includes('Known-good combination'))).toBe(true);
  });

  it('ubuntu + jazzy with no sim is also ok', () => {
    const result = evaluateStack(sel({ baseOs: 'ubuntu-noble', ros: 'ros2-jazzy', sim: 'none' }));
    expect(result.level).toBe('ok');
    expect(result.buildable).toBe(true);
  });

  it('centos bootc + jazzy + sim is blocked at the ROS install step', () => {
    const result = evaluateStack(sel({ baseOs: 'centos-bootc-stream9', ros: 'ros2-jazzy', sim: 'gazebo-nav2-tb3' }));
    expect(result.level).toBe('blocked');
    expect(result.buildable).toBe(false);
    expect(result.failsAtStep).toBe('ros-install');
    expect(result.messages.some(m => m.level === 'error' && m.text.includes('ROS install step'))).toBe(true);
    expect(result.messages.some(m => m.level === 'error' && m.text.includes('simulation install step'))).toBe(true);
  });

  it('fedora bootc + jazzy is blocked', () => {
    const result = evaluateStack(sel({ baseOs: 'fedora-bootc-43', ros: 'ros2-jazzy' }));
    expect(result.level).toBe('blocked');
    expect(result.buildable).toBe(false);
    expect(result.failsAtStep).toBe('ros-install');
    expect(result.messages.some(m => m.text.includes('no official ROS repository'))).toBe(true);
  });

  it('centos bootc with no ROS and no sim warns that it is not a robotics image yet', () => {
    const result = evaluateStack(sel({ baseOs: 'centos-bootc-stream9', ros: 'none', sim: 'none' }));
    expect(result.level).toBe('warn');
    expect(result.buildable).toBe(true);
    expect(result.failsAtStep).toBeUndefined();
    expect(result.messages.some(m => m.text.includes('no ROS layer'))).toBe(true);
  });

  it('sim without ros is blocked at the sim install step', () => {
    const result = evaluateStack(sel({ baseOs: 'ubuntu-noble', ros: 'none', sim: 'gazebo-nav2-tb3' }));
    expect(result.level).toBe('blocked');
    expect(result.buildable).toBe(false);
    expect(result.failsAtStep).toBe('sim-install');
    expect(result.messages.some(m => m.text.includes('needs a ROS layer beneath it'))).toBe(true);
  });

  it('hummingbird-app + ubuntu + jazzy warns but stays buildable', () => {
    const result = evaluateStack(
      sel({ baseOs: 'ubuntu-noble', hardened: 'hummingbird-app', ros: 'ros2-jazzy', sim: 'none' }),
    );
    expect(result.level).toBe('warn');
    expect(result.buildable).toBe(true);
    expect(result.messages.some(m => m.text.includes('hardened application images'))).toBe(true);
  });

  it('rhel bootc with no ros/sim warns about the subscription requirement', () => {
    const result = evaluateStack(sel({ baseOs: 'rhel-bootc', ros: 'none', sim: 'none' }));
    expect(result.level).toBe('warn');
    expect(result.buildable).toBe(true);
    expect(result.messages.some(m => m.text.includes('Red Hat subscription'))).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { evaluateStack, generateLayerContainerfile, type LayerSelection } from './layerCompatibility';

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

  it('hummingbird-app + ubuntu + jazzy is ok — hummingbird is an informational side component', () => {
    const result = evaluateStack(
      sel({ baseOs: 'ubuntu-noble', hardened: 'hummingbird-app', ros: 'ros2-jazzy', sim: 'none' }),
    );
    expect(result.level).toBe('ok');
    expect(result.buildable).toBe(true);
    expect(
      result.messages.some(m => m.level === 'info' && m.text.includes('optional hardened application images')),
    ).toBe(true);
  });

  it('ubuntu + hummingbird-app + jazzy + sim evaluates to ok with an info-level hummingbird message', () => {
    const result = evaluateStack({
      baseOs: 'ubuntu-noble',
      hardened: 'hummingbird-app',
      ros: 'ros2-jazzy',
      sim: 'gazebo-nav2-tb3',
      hummingbirdApps: ['nginx'],
    });
    expect(result.level).toBe('ok');
    expect(result.messages.some(m => m.level === 'info' && m.text.toLowerCase().includes('hummingbird'))).toBe(true);
  });

  it('rhel bootc with no ros/sim warns about the subscription requirement', () => {
    const result = evaluateStack(sel({ baseOs: 'rhel-bootc', ros: 'none', sim: 'none' }));
    expect(result.level).toBe('warn');
    expect(result.buildable).toBe(true);
    expect(result.messages.some(m => m.text.includes('Red Hat subscription'))).toBe(true);
  });

  it('centos bootc stream10 + jazzy is blocked at the ROS install step, same as stream9', () => {
    const result = evaluateStack(sel({ baseOs: 'centos-bootc-stream10', ros: 'ros2-jazzy' }));
    expect(result.level).toBe('blocked');
    expect(result.buildable).toBe(false);
    expect(result.failsAtStep).toBe('ros-install');
  });

  it('fedora-bootc-42 + jazzy is blocked and includes the Fedora-no-repo warning', () => {
    const result = evaluateStack(sel({ baseOs: 'fedora-bootc-42', ros: 'ros2-jazzy' }));
    expect(result.level).toBe('blocked');
    expect(result.buildable).toBe(false);
    expect(result.failsAtStep).toBe('ros-install');
    expect(result.messages.some(m => m.text.includes('no official ROS repository'))).toBe(true);
  });

  it('rhel10-bootc alone warns about the subscription requirement', () => {
    const result = evaluateStack(sel({ baseOs: 'rhel10-bootc', ros: 'none', sim: 'none' }));
    expect(result.level).toBe('warn');
    expect(result.buildable).toBe(true);
    expect(result.messages.some(m => m.text.includes('Red Hat subscription'))).toBe(true);
  });

  it('bare ubuntu with no ROS/sim builds but warns it is not a robotics image yet', () => {
    const result = evaluateStack(sel({ baseOs: 'ubuntu-noble', ros: 'none', sim: 'none' }));
    expect(result.level).toBe('warn');
    expect(result.buildable).toBe(true);
    expect(result.failsAtStep).toBeUndefined();
    expect(result.messages.some(m => m.level === 'warn' && m.text.includes('no ROS layer'))).toBe(true);
    // the non-bootc phrasing — it is not a bootc base
    expect(result.messages.some(m => m.text.includes('bootc base image'))).toBe(false);
  });

  it('ubuntu + hummingbird app but no ROS still warns it is not a robotics image yet', () => {
    const result = evaluateStack(
      sel({
        baseOs: 'ubuntu-noble',
        hardened: 'hummingbird-app',
        ros: 'none',
        sim: 'none',
        hummingbirdApps: ['nginx'],
      }),
    );
    expect(result.level).toBe('warn');
    expect(result.buildable).toBe(true);
    expect(result.messages.some(m => m.text.includes('no ROS layer'))).toBe(true);
    // the hummingbird side-component note only applies when a ROS layer is present
    expect(result.messages.some(m => m.text.includes('optional hardened application images'))).toBe(false);
  });
});

describe('generateLayerContainerfile', () => {
  it('ubuntu + jazzy + sim contains the ubuntu FROM ref and the nav2 RUN line', () => {
    const containerfile = generateLayerContainerfile(
      sel({ baseOs: 'ubuntu-noble', ros: 'ros2-jazzy', sim: 'gazebo-nav2-tb3' }),
    );
    expect(containerfile).toContain('FROM docker.io/library/ubuntu:24.04');
    expect(containerfile).toContain('ros-jazzy-nav2-bringup');
  });

  it('bootc base contains the centos FROM ref', () => {
    const containerfile = generateLayerContainerfile(sel({ baseOs: 'centos-bootc-stream9' }));
    expect(containerfile).toContain('FROM quay.io/centos-bootc/centos-bootc:stream9');
  });

  it("ros='none' omits the ROS RUN line", () => {
    const containerfile = generateLayerContainerfile(sel({ baseOs: 'ubuntu-noble', ros: 'none' }));
    expect(containerfile).not.toContain('ros-desktop');
    expect(containerfile).not.toContain('apt-get install -y ros-');
  });

  it('hummingbird hardened with no apps selected renders a placeholder note', () => {
    const containerfile = generateLayerContainerfile(sel({ baseOs: 'ubuntu-noble', hardened: 'hummingbird-app' }));
    expect(containerfile).toContain('Hardened application layer');
    expect(containerfile).toContain('no hardened app images selected yet');
  });

  it('hummingbird hardened with nginx + nodejs selected renders both hummingbird image refs', () => {
    const containerfile = generateLayerContainerfile(
      sel({ baseOs: 'ubuntu-noble', hardened: 'hummingbird-app', hummingbirdApps: ['nginx', 'nodejs'] }),
    );
    expect(containerfile).toContain('quay.io/hummingbird/nginx');
    expect(containerfile).toContain('quay.io/hummingbird/nodejs');
  });

  it('hummingbird hardened with postgresql selected renders the postgresql hummingbird image ref', () => {
    const containerfile = generateLayerContainerfile(
      sel({ baseOs: 'ubuntu-noble', hardened: 'hummingbird-app', hummingbirdApps: ['postgresql'] }),
    );
    expect(containerfile).toContain('quay.io/hummingbird/postgresql');
  });

  it('centos-bootc-stream10 resolves the stream10 FROM ref', () => {
    const containerfile = generateLayerContainerfile(sel({ baseOs: 'centos-bootc-stream10' }));
    expect(containerfile).toContain('FROM quay.io/centos-bootc/centos-bootc:stream10');
  });

  it('fedora-bootc-42 resolves the fedora 42 FROM ref', () => {
    const containerfile = generateLayerContainerfile(sel({ baseOs: 'fedora-bootc-42' }));
    expect(containerfile).toContain('FROM quay.io/fedora/fedora-bootc:42');
  });

  it('fedora-bootc-44 resolves the fedora 44 FROM ref', () => {
    const containerfile = generateLayerContainerfile(sel({ baseOs: 'fedora-bootc-44' }));
    expect(containerfile).toContain('FROM quay.io/fedora/fedora-bootc:44');
  });

  it('rhel10-bootc resolves the rhel10 FROM ref', () => {
    const containerfile = generateLayerContainerfile(sel({ baseOs: 'rhel10-bootc' }));
    expect(containerfile).toContain('FROM registry.redhat.io/rhel10/rhel-bootc:latest');
  });
});

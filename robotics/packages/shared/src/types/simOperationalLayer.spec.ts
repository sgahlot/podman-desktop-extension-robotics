import { describe, expect, it } from 'vitest';
import type { LayerSelection } from './layerCompatibility';
import { selectionNeedsBundledSimRuntime } from './stackConfigResolver';
import {
  SIM_RUNTIME_LAYER_MARKER,
  containerfileNeedsBundledSimRuntime,
  generateSimOperationalLayerFragment,
} from './simOperationalLayer';

function sel(overrides: Partial<LayerSelection> = {}): LayerSelection {
  return {
    baseOs: 'fedora-bootc-43',
    customBaseImage: '',
    customBaseOsFamily: '',
    customBaseOsVersion: '',
    customBaseRosDistro: '',
    hardened: 'none',
    ros: 'ros2-lyrical',
    sim: 'gazebo-nav2-tb3',
    customSimulationTemplateId: 'fedora43-lyrical-dnf',
    hummingbirdApps: [],
    ...overrides,
  };
}

describe('selectionNeedsBundledSimRuntime', () => {
  it('is true for Fedora Lyrical + Gazebo', () => {
    expect(selectionNeedsBundledSimRuntime(sel())).toBe(true);
  });

  it('is true for Ubuntu Noble + Jazzy + Gazebo (Customize one-shot managed sim)', () => {
    expect(
      selectionNeedsBundledSimRuntime(sel({ baseOs: 'ubuntu-noble', ros: 'ros2-jazzy', sim: 'gazebo-nav2-tb3' })),
    ).toBe(true);
  });

  it('is false when sim is none', () => {
    expect(selectionNeedsBundledSimRuntime(sel({ sim: 'none' }))).toBe(false);
  });
});

describe('generateSimOperationalLayerFragment', () => {
  it('emits lyrical env overrides and entrypoint COPY instructions for dnf bases', () => {
    const fragment = generateSimOperationalLayerFragment(sel(), 'dnf');
    expect(fragment).toContain(SIM_RUNTIME_LAYER_MARKER);
    expect(fragment).toContain('io.physical-ai.simulation.capability="managed"');
    expect(fragment).toContain('ENV ROBOTICS_ROS_SETUP=/opt/ros/lyrical/setup.bash');
    expect(fragment).toContain('ENV PHYSICAL_AI_ROBOT_ID=turtlebot3');
    expect(fragment).toContain('ENV ROBOTICS_SIM_DIR=/opt/ros/lyrical/share/nav2_minimal_tb3_sim');
    expect(fragment).toContain('COPY config/robot-definitions.json /opt/ros2-demo/config/robot-definitions.json');
    expect(fragment).toContain('COPY lib/robot-definition.py /usr/local/lib/robotics/robot-definition.py');
    expect(fragment).toContain('ENV TURTLEBOT3_MODEL=waffle');
    expect(fragment).toContain('COPY entrypoint-gazebo.sh /entrypoint-gazebo.sh');
    expect(fragment).toContain('xorg-x11-server-Xvfb');
    expect(fragment).toContain('mesa-demos');
    expect(fragment).not.toContain('mesa-utils');
    expect(fragment).toContain('VirtualGL-${VIRTUALGL_VERSION}.${VGL_ARCH}.rpm');
    expect(fragment).not.toContain('virtualgl_${VIRTUALGL_VERSION}_${VGL_ARCH}.rpm');
    expect(fragment).toContain('COPY worlds/ /opt/ros2-demo/worlds/');
  });

  it('is detected by containerfileNeedsBundledSimRuntime', () => {
    const fragment = generateSimOperationalLayerFragment(sel(), 'dnf');
    expect(containerfileNeedsBundledSimRuntime(fragment)).toBe(true);
  });
});

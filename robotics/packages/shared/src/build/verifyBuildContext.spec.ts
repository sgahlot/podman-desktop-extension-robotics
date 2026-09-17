import { describe, expect, it } from 'vitest';
import {
  containerfileIsManagedSimImage,
  parseContainerfileCopySources,
  verifyBuildContext,
} from './verifyBuildContext';
import { generateSimOperationalLayerFragment } from '../types/simOperationalLayer';
import type { LayerSelection } from '../types/layerCompatibility';

function sel(): LayerSelection {
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
  };
}

describe('parseContainerfileCopySources', () => {
  it('collects host-context COPY paths and skips --from', () => {
    const sources = parseContainerfileCopySources(`
FROM scratch
COPY --from=quay.io/hi/syft:latest /syft /usr/local/bin/syft
COPY entrypoint-gazebo.sh /entrypoint-gazebo.sh
COPY lib/load-validate-input.sh /usr/local/lib/robotics/load-validate-input.sh
COPY worlds/ /opt/ros2-demo/worlds/
`);
    expect(sources).toEqual(['entrypoint-gazebo.sh', 'lib/load-validate-input.sh', 'worlds']);
  });
});

describe('verifyBuildContext', () => {
  const managedFragment = generateSimOperationalLayerFragment(sel(), 'dnf');
  const managedContainerfile = `FROM fedora\n\n${managedFragment}`;

  const fullRuntimeContext = new Set([
    'Containerfile',
    'entrypoint-gazebo.sh',
    'entrypoint-spawn-robot.sh',
    'entrypoint-nav2.sh',
    'lib/load-validate-input.sh',
    'lib/validate-input.sh',
    'lib/patch-nav2-params.py',
    'config/cyclonedds-qos.xml',
    'worlds/tb3_sandbox.world',
    'www/index.html',
  ]);

  it('passes for a complete managed sim context', () => {
    expect(verifyBuildContext(managedContainerfile, fullRuntimeContext, { bundleSimRuntime: true })).toEqual([]);
    expect(containerfileIsManagedSimImage(managedContainerfile)).toBe(true);
  });

  it('fails when COPY source is missing (preset path mismatch)', () => {
    const presetLike = `
COPY entrypoint-gazebo.sh /entrypoint-gazebo.sh
COPY lib/load-validate-input.sh /usr/local/lib/robotics/load-validate-input.sh
`;
    const issues = verifyBuildContext(presetLike, new Set(['entrypoint-gazebo.sh']));
    expect(issues.some(i => i.kind === 'missing-copy-source')).toBe(true);
  });

  it('flags legacy physical-ai lib COPY targets', () => {
    const legacy = `
COPY lib/load-validate-input.sh /usr/local/lib/physical-ai/load-validate-input.sh
`;
    const issues = verifyBuildContext(legacy, new Set(['lib/load-validate-input.sh']));
    expect(issues.some(i => i.kind === 'legacy-lib-path')).toBe(true);
  });

  it('flags customize Layer 4 without runtime', () => {
    const packagesOnly = `
# Layer 4 — Simulation: Gazebo + Nav2 + TurtleBot3
RUN dnf install -y ros-jazzy-navigation2
`;
    const issues = verifyBuildContext(packagesOnly, new Set(['Containerfile']));
    expect(issues.some(i => i.kind === 'sim-packages-without-runtime')).toBe(true);
  });

  it('fails when runtime is staged but entrypoints are absent', () => {
    const issues = verifyBuildContext(managedContainerfile, new Set(['Containerfile', 'lib']), {
      bundleSimRuntime: true,
    });
    expect(issues.some(i => i.kind === 'sim-runtime-incomplete')).toBe(true);
  });
});

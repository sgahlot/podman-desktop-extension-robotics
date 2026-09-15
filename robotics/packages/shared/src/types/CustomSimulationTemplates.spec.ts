import { describe, expect, it } from 'vitest';
import {
  CUSTOM_SIMULATION_TEMPLATES,
  generateCustomSimulationContainerfile,
  resolveCustomSimulationTemplate,
} from './CustomSimulationTemplates';

describe('custom simulation templates', () => {
  it('contains the Fedora 43 / Lyrical packages-only template', () => {
    const template = resolveCustomSimulationTemplate('fedora43-lyrical-dnf');
    expect(template).toBe(CUSTOM_SIMULATION_TEMPLATES[0]);
    expect(template?.packages).toEqual(['ros-lyrical-nav2-minimal-tb3-sim', 'ros-lyrical-ros-gz-sim']);
    expect(template).toMatchObject({
      version: '1',
      osFamily: 'Fedora',
      osVersion: '43',
      rosDistro: 'lyrical',
      architectures: ['amd64'],
      capability: 'packages-only',
    });
  });

  it('generates a fixed, labeled Containerfile', () => {
    const template = CUSTOM_SIMULATION_TEMPLATES[0];
    const output = generateCustomSimulationContainerfile('quay.io/example/ros:f43', template);
    expect(output).toContain('FROM quay.io/example/ros:f43');
    expect(output).toContain('dnf install -y');
    expect(output).toContain('io.physical-ai.simulation.capability="packages-only"');
    expect(output).toContain('io.physical-ai.simulation.template-version="1"');
    expect(output).toContain('io.physical-ai.simulation.os-family="Fedora"');
    expect(output).not.toContain('noVNC');
  });

  it('rejects image-reference injection', () => {
    expect(() =>
      generateCustomSimulationContainerfile('fedora\nRUN touch /tmp/pwned', CUSTOM_SIMULATION_TEMPLATES[0]),
    ).toThrow(/valid OCI image reference/);
  });
});

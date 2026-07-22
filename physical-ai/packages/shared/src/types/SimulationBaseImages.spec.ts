import { describe, it, expect } from 'vitest';
import {
  resolveSimulationBaseImage,
  SIMULATION_BASE_IMAGES,
  DEFAULT_SIMULATION_BASE_IMAGE,
} from './SimulationBaseImages';

describe('SimulationBaseImages', () => {
  it('defines both presets with digest-pinned image refs', () => {
    expect(SIMULATION_BASE_IMAGES).toHaveLength(2);
    for (const preset of SIMULATION_BASE_IMAGES) {
      expect(preset.imageRef).toMatch(/@sha256:[a-f0-9]{64}$/);
      expect(preset.id.length).toBeLessThanOrEqual(8);
    }
  });

  it('resolves known ids', () => {
    expect(resolveSimulationBaseImage('osrf').id).toBe('osrf');
    expect(resolveSimulationBaseImage('sloretz').imageRef).toContain('ghcr.io/sloretz');
  });

  it('maps legacy ids to the shortened preset ids', () => {
    expect(resolveSimulationBaseImage('sloretz-multiarch').id).toBe('sloretz');
    expect(resolveSimulationBaseImage('osrf-official').id).toBe('osrf');
  });

  it('falls back to the default preset for unknown ids', () => {
    expect(resolveSimulationBaseImage('nope').id).toBe(DEFAULT_SIMULATION_BASE_IMAGE);
    expect(resolveSimulationBaseImage(undefined).id).toBe(DEFAULT_SIMULATION_BASE_IMAGE);
  });

  it('marks official as amd64-only and sloretz as multi-arch', () => {
    expect(resolveSimulationBaseImage('osrf').architectures).toEqual(['amd64']);
    expect(resolveSimulationBaseImage('sloretz').architectures).toContain('arm64');
  });
});

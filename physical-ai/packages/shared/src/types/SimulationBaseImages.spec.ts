import { describe, it, expect } from 'vitest';
import {
  resolveSimulationBaseImage,
  SIMULATION_BASE_IMAGES,
  DEFAULT_SIMULATION_BASE_IMAGE,
  baseImagesForDistro,
  defaultBaseImageForDistro,
} from './SimulationBaseImages';

describe('SimulationBaseImages', () => {
  it('defines all presets with digest-pinned image refs', () => {
    expect(SIMULATION_BASE_IMAGES).toHaveLength(3);
    for (const preset of SIMULATION_BASE_IMAGES) {
      expect(preset.imageRef).toMatch(/@sha256:[a-f0-9]{64}$/);
      expect(preset.id.length).toBeLessThanOrEqual(8);
      expect(preset.distro).toBeTruthy();
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

  it('resolves the jazzy preset', () => {
    const preset = resolveSimulationBaseImage('jazzy');
    expect(preset.id).toBe('jazzy');
    expect(preset.distro).toBe('jazzy');
    expect(preset.imageRef).toContain('ros:jazzy-ros-base');
    expect(preset.architectures).toEqual(['amd64']);
  });

  it('filters presets by distro', () => {
    const humble = baseImagesForDistro('humble');
    expect(humble).toHaveLength(2);
    expect(humble.every(p => p.distro === 'humble')).toBe(true);

    const jazzy = baseImagesForDistro('jazzy');
    expect(jazzy).toHaveLength(1);
    expect(jazzy[0].id).toBe('jazzy');

    expect(baseImagesForDistro('rolling')).toHaveLength(0);
  });

  it('returns distro-appropriate default base image', () => {
    expect(defaultBaseImageForDistro('humble')).toBe('sloretz');
    expect(defaultBaseImageForDistro('jazzy')).toBe('jazzy');
    expect(defaultBaseImageForDistro('rolling')).toBe(DEFAULT_SIMULATION_BASE_IMAGE);
  });
});

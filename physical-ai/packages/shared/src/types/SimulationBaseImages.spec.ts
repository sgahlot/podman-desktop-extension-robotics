import { describe, it, expect } from 'vitest';
import {
  resolveSimulationBaseImage,
  SIMULATION_BASE_IMAGES,
  DEFAULT_SIMULATION_BASE_IMAGE,
  baseImagesForDistro,
  defaultBaseImageForDistro,
} from './SimulationBaseImages';

describe('SimulationBaseImages', () => {
  it('defines presets with image refs and tags', () => {
    expect(SIMULATION_BASE_IMAGES.length).toBeGreaterThanOrEqual(4);
    for (const preset of SIMULATION_BASE_IMAGES) {
      expect(preset.imageRef.length).toBeGreaterThan(0);
      expect(preset.imageTag.length).toBeGreaterThan(0);
      expect(preset.distro).toBeTruthy();
      // Digest-pinned presets end with @sha256:…; jazzy-noble uses a floating tag for multi-arch.
      if (preset.id !== 'jazzy-noble') {
        expect(preset.imageRef).toMatch(/@sha256:[a-f0-9]{64}$/);
      }
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

  it('resolves the jazzy amd64 preset', () => {
    const preset = resolveSimulationBaseImage('jazzy');
    expect(preset.id).toBe('jazzy');
    expect(preset.distro).toBe('jazzy');
    expect(preset.imageRef).toContain('ros:jazzy-ros-base');
    expect(preset.architectures).toEqual(['amd64']);
    expect(preset.imageTag).toBe('latest');
  });

  it('resolves the jazzy-noble preset', () => {
    const preset = resolveSimulationBaseImage('jazzy-noble');
    expect(preset.id).toBe('jazzy-noble');
    expect(preset.architectures).toContain('arm64');
    expect(preset.imageTag).toBe('noble');
  });

  it('maps legacy jazzy-arm64 id to jazzy-noble', () => {
    const preset = resolveSimulationBaseImage('jazzy-arm64');
    expect(preset.id).toBe('jazzy-noble');
    expect(preset.imageTag).toBe('noble');
  });

  it('filters presets by distro', () => {
    const humble = baseImagesForDistro('humble');
    expect(humble).toHaveLength(2);
    expect(humble.every(p => p.distro === 'humble')).toBe(true);

    const jazzy = baseImagesForDistro('jazzy');
    expect(jazzy).toHaveLength(2);
    expect(jazzy.map(p => p.id)).toEqual(['jazzy-noble', 'jazzy']);

    expect(baseImagesForDistro('rolling')).toHaveLength(0);
  });

  it('returns distro-appropriate default base image', () => {
    expect(defaultBaseImageForDistro('humble')).toBe('sloretz');
    expect(defaultBaseImageForDistro('jazzy')).toBe('jazzy-noble');
    expect(defaultBaseImageForDistro('rolling')).toBe(DEFAULT_SIMULATION_BASE_IMAGE);
  });
});

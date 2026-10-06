import { describe, expect, it } from 'vitest';
import {
  assertContainerfileParseableByPodman,
  assertLyricalRepoBeforeRosDesktopInstall,
  lyricalTestingRepoConfiguredBeforeFirstDesktopInstall,
  normalizeContainerfileForSnapshot,
} from './containerfileSemantics';
import {
  buildLayerStackContainerfile,
  buildLyricalRosDesktopSmokeContainerfile,
  buildPresetContainerfile,
  ensureFedoraLyricalContainerfile,
  layerSelectionFromQuickStart,
} from './presetContainerfile';
import { QUICK_STARTS } from '../types/QuickStarts';
import type { LayerSelection } from '../types/layerCompatibility';

describe('ensureFedoraLyricalContainerfile', () => {
  const sel: LayerSelection = {
    baseOs: 'fedora-bootc-43',
    hardened: 'none',
    ros: 'ros2-lyrical',
    sim: 'gazebo-nav2-tb3',
  };

  it('inserts the repo before the first lyrical dnf when baseurl is missing', () => {
    const generated =
      'FROM quay.io/fedora/fedora-bootc:43\n\n' +
      'RUN dnf --releasever=43 install -y ros-lyrical-desktop-runtime ros-lyrical-desktop-devel\n';
    const fixed = ensureFedoraLyricalContainerfile(sel, generated);
    expect(lyricalTestingRepoConfiguredBeforeFirstDesktopInstall(fixed)).toBe(true);
    expect(fixed.indexOf('ros2-lyrical-testing.repo')).toBeLessThan(fixed.indexOf('ros-lyrical-desktop'));
    expect(fixed).not.toMatch(/\nRUN dnf[\s\S]*\n\n# ROS 2 Lyrical/);
  });
});

describe('buildPresetContainerfile', () => {
  it('matches buildLayerStackContainerfile for the Lyrical quick start', () => {
    const id = 'fedora-bootc43-lyrical-amd64';
    const fromPreset = buildPresetContainerfile(id, 'amd64');
    const fromLayers = buildLayerStackContainerfile(layerSelectionFromQuickStart(id), 'amd64');
    expect(fromPreset).toBe(fromLayers);
    assertLyricalRepoBeforeRosDesktopInstall(fromPreset);
  });

  it('golden snapshot for fedora-bootc43-lyrical-amd64', () => {
    const containerfile = normalizeContainerfileForSnapshot(
      buildPresetContainerfile('fedora-bootc43-lyrical-amd64', 'amd64'),
    );
    expect(containerfile).toMatchSnapshot();
  });

  it('rejects ubuntu quick starts', () => {
    expect(() => buildPresetContainerfile('ubuntu-jazzy-amd64', 'amd64')).toThrow(
      /does not use the layer Containerfile/,
    );
  });
});

describe('fedora-layers quick starts', () => {
  it('each fedora-layers preset produces a buildable lyrical containerfile', () => {
    for (const quickStart of QUICK_STARTS) {
      if (quickStart.buildMode !== 'fedora-layers') continue;
      const containerfile = buildPresetContainerfile(quickStart.id, quickStart.targetArch);
      expect(containerfile.length).toBeGreaterThan(100);
      assertContainerfileParseableByPodman(containerfile);
      assertLyricalRepoBeforeRosDesktopInstall(containerfile);
      expect(containerfile).toContain('FROM quay.io/fedora/fedora-bootc:43');
    }
  });
});

describe('buildLyricalRosDesktopSmokeContainerfile', () => {
  it('configures the testing repo before a minimal desktop-runtime install', () => {
    const containerfile = buildLyricalRosDesktopSmokeContainerfile();
    assertContainerfileParseableByPodman(containerfile);
    assertLyricalRepoBeforeRosDesktopInstall(containerfile);
    expect(containerfile).toContain('ros-lyrical-desktop-runtime');
    expect(containerfile).not.toContain('ros-lyrical-desktop-devel');
    expect(containerfile).not.toContain('Layer 5 — Sim runtime');
  });
});

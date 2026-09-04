import { describe, it, expect } from 'vitest';
import { generateLayerContainerfile } from './layerCompatibility';
import {
  BuildCacheStreamParser,
  formatLayerCacheSummary,
  isBuildCacheHitLogLine,
  isLayerCompositionContainerfile,
  parseBuildStepLayerIds,
} from './buildLayerCache';

describe('buildLayerCache', () => {
  const fullStack = generateLayerContainerfile({
    baseOs: 'ubuntu-noble',
    hardened: 'hummingbird-app',
    hummingbirdApps: ['cosign'],
    ros: 'ros2-jazzy',
    sim: 'gazebo-nav2-tb3',
  });

  const noSimStack = generateLayerContainerfile({
    baseOs: 'ubuntu-noble',
    hardened: 'hummingbird-app',
    hummingbirdApps: ['cosign'],
    ros: 'ros2-jazzy',
    sim: 'none',
  });

  it('detects layer-composition containerfiles', () => {
    expect(isLayerCompositionContainerfile(fullStack)).toBe(true);
    expect(isLayerCompositionContainerfile('FROM scratch\n')).toBe(false);
  });

  it('maps build steps to composition layers', () => {
    expect(parseBuildStepLayerIds(fullStack)).toEqual(['base-os', 'hardened', 'ros', 'ros', 'sim']);
    expect(parseBuildStepLayerIds(noSimStack)).toEqual(['base-os', 'hardened', 'ros', 'ros']);
  });

  it('aggregates cache hits per layer from Podman stream lines', () => {
    const parser = new BuildCacheStreamParser(fullStack);

    parser.processLine('STEP 1/5: FROM docker.io/library/ubuntu:24.04');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 2/5: COPY --from=registry.access.redhat.com/hi/cosign:latest');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 3/5: RUN apt-get update && apt-get install -y curl');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 4/5: RUN apt-get install -y ros-jazzy-desktop');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 5/5: RUN apt-get install -y ros-jazzy-navigation2');
    // Step 5 runs fresh — no "Using cache" before the build ends.

    const status = parser.finalize();
    expect(status).toEqual([
      { layer: 'Base OS', cached: true },
      { layer: 'Hummingbird app', cached: true },
      { layer: 'ROS Jazzy', cached: true },
      { layer: 'Gazebo + Nav2 + TurtleBot3', cached: false },
    ]);
    expect(formatLayerCacheSummary(status)).toBe(
      'Base OS ✓ cached · Hummingbird app ✓ cached · ROS Jazzy ✓ cached · Gazebo + Nav2 + TurtleBot3 ↻ rebuilt',
    );
  });

  it('marks a layer rebuilt when any of its steps missed cache', () => {
    const parser = new BuildCacheStreamParser(noSimStack);

    parser.processLine('STEP 1/4: FROM docker.io/library/ubuntu:24.04');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 2/4: COPY --from=registry.access.redhat.com/hi/cosign:latest');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 3/4: RUN apt-get update');
    parser.processLine('STEP 4/4: RUN apt-get install -y ros-jazzy-desktop');
    parser.processLine('--> Using cache');

    const status = parser.finalize();
    expect(status.find(s => s.layer === 'ROS Jazzy')?.cached).toBe(false);
  });

  it('highlights cache-hit log lines but not the truncation marker', () => {
    expect(isBuildCacheHitLogLine('--> Using cache')).toBe(true);
    expect(isBuildCacheHitLogLine('… earlier log lines truncated …')).toBe(false);
  });

  it('infers Base OS cached when FROM has no Using cache line but all later steps hit cache', () => {
    const parser = new BuildCacheStreamParser(fullStack);

    parser.processLine('STEP 1/5: FROM docker.io/library/ubuntu:24.04');
    parser.processLine('STEP 2/5: COPY --from=registry.access.redhat.com/hi/cosign:latest');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 3/5: RUN apt-get update && apt-get install -y curl');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 4/5: RUN apt-get install -y ros-jazzy-desktop');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 5/5: RUN apt-get install -y ros-jazzy-navigation2');
    parser.processLine('--> Using cache');

    const status = parser.finalize();
    expect(status[0]).toEqual({ layer: 'Base OS', cached: true });
    expect(status.every(s => s.cached)).toBe(true);
  });

  it('aggregates preset base image builds with the same layer labels as the wizard', () => {
    const presetBase = `ARG ROS_BASE_IMAGE=docker.io/ros:jazzy\nFROM \${ROS_BASE_IMAGE}\nRUN apt-get\nCOPY f /f\n`;
    const plan = [
      { layerId: 'base-os' as const, label: 'Base OS' },
      { layerId: 'ros' as const, label: 'ROS Jazzy' },
    ];
    const parser = new BuildCacheStreamParser(presetBase, { kind: 'preset-base', plan });

    parser.processLine('STEP 1/3: FROM docker.io/ros:jazzy');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 2/3: RUN apt-get');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 3/3: COPY f /f');

    expect(parser.finalize()).toEqual([
      { layer: 'Base OS', cached: true },
      { layer: 'ROS Jazzy', cached: false },
    ]);
  });

  it('aggregates preset sim builds across the full wizard layer plan', () => {
    const presetSim = `ARG LOCAL_BASE_IMAGE\nFROM \${LOCAL_BASE_IMAGE}\nRUN apt-get\nCOPY worlds /w\n`;
    const plan = [
      { layerId: 'base-os' as const, label: 'Base OS' },
      { layerId: 'ros' as const, label: 'ROS Jazzy' },
      { layerId: 'sim' as const, label: 'Gazebo + Nav2 + TurtleBot3' },
    ];
    const parser = new BuildCacheStreamParser(presetSim, { kind: 'preset-sim', plan });

    parser.processLine('STEP 1/3: FROM quay.io/org/ros2-jazzy-base:noble');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 2/3: RUN apt-get');
    parser.processLine('--> Using cache');
    parser.processLine('STEP 3/3: COPY worlds /w');
    parser.processLine('--> Using cache');

    expect(parser.finalize()).toEqual([
      { layer: 'Base OS', cached: true },
      { layer: 'ROS Jazzy', cached: true },
      { layer: 'Gazebo + Nav2 + TurtleBot3', cached: true },
    ]);
  });
});

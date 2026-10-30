import { describe, expect, it } from 'vitest';
import { serializeDiagnosticsSnapshot } from './DiagnosticsExport';

describe('serializeDiagnosticsSnapshot', () => {
  it('creates a stable, bounded local snapshot and preserves unavailable reasons', () => {
    const document = JSON.parse(
      serializeDiagnosticsSnapshot({
        capturedAt: '2026-10-26T12:00:00.000Z',
        target: { kind: 'local', identity: 'container-1' },
        robot: 'robot_1',
        tfResult: undefined,
        tfError: 'TF probe timed out.',
        costmapResult: { local: undefined, global: undefined },
        costmapError: '',
        sensorResult: undefined,
        sensorError: 'Sensor probe failed.',
      }),
    );

    expect(document).toEqual({
      version: 1,
      capturedAt: '2026-10-26T12:00:00.000Z',
      target: { kind: 'local', identity: 'container-1' },
      robot: 'robot_1',
      tf: { unavailable: 'TF probe timed out.' },
      costmap: { local: undefined, global: undefined },
      navigation: { unavailable: 'No Nav2 runtime result captured.' },
      sensors: { unavailable: 'Sensor probe failed.' },
    });
  });

  it('retains the explicit OpenShift target identity and typed diagnostic data', () => {
    const document = JSON.parse(
      serializeDiagnosticsSnapshot({
        capturedAt: '2026-10-26T12:00:00.000Z',
        target: { kind: 'openshift', identity: 'demo/ros-sim', context: 'dev' },
        robot: 'robot_2',
        tfResult: { robotNamespace: 'robot_2', capturedAt: '2026-10-26T11:59:59.000Z', frames: [] },
        tfError: '',
        costmapResult: undefined,
        costmapError: 'No costmap result captured.',
        navigationResult: {
          robotNamespace: 'robot_2',
          capturedAt: '2026-10-26T11:59:59.000Z',
          navigateToPoseAvailable: true,
          controllerServerAvailable: true,
          behaviorServerAvailable: true,
          cmdVel: { topic: '/robot_2/cmd_vel', messagesPerSecond: 10 },
        },
        sensorResult: { robotNamespace: 'robot_2', capturedAt: '2026-10-26T11:59:59.000Z', sensors: [] },
        sensorError: '',
      }),
    );

    expect(document.target).toEqual({ kind: 'openshift', identity: 'demo/ros-sim', context: 'dev' });
    expect(document.tf.frames).toEqual([]);
    expect(document.sensors.sensors).toEqual([]);
    expect(document.costmap).toEqual({ unavailable: 'No costmap result captured.' });
    expect(document.navigation).toEqual({
      robotNamespace: 'robot_2',
      capturedAt: '2026-10-26T11:59:59.000Z',
      navigateToPoseAvailable: true,
      controllerServerAvailable: true,
      behaviorServerAvailable: true,
      cmdVel: { topic: '/robot_2/cmd_vel', messagesPerSecond: 10 },
    });
  });

  it('preserves a Nav2 runtime probe failure', () => {
    const document = JSON.parse(
      serializeDiagnosticsSnapshot({
        capturedAt: '2026-10-26T12:00:00.000Z',
        target: { kind: 'local', identity: 'container-1' },
        robot: 'robot_1',
        tfResult: undefined,
        tfError: '',
        costmapResult: undefined,
        costmapError: '',
        navigationError: 'Nav2 runtime probe failed.',
        sensorResult: undefined,
        sensorError: '',
      }),
    );

    expect(document.navigation).toEqual({ unavailable: 'Nav2 runtime probe failed.' });
  });
});

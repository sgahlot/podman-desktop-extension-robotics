import { describe, it, expect } from 'vitest';
import { localDiagnosticsHref, openShiftDiagnosticsHref } from './diagnosticsLink';

describe('localDiagnosticsHref', () => {
  it('builds a local target query string', () => {
    expect(localDiagnosticsHref('c1', 'robot_1')).toBe('/diagnostics?target=local&containerId=c1&robot=robot_1');
  });

  it('encodes special characters in the container id and robot name', () => {
    const href = localDiagnosticsHref('c 1', 'robot 1');
    expect(href).toBe('/diagnostics?target=local&containerId=c+1&robot=robot+1');
  });
});

describe('openShiftDiagnosticsHref', () => {
  it('builds an oc target query string without context when omitted', () => {
    expect(openShiftDiagnosticsHref('ns1', 'ros2-jazzy-sim', 'robot_1')).toBe(
      '/diagnostics?target=oc&namespace=ns1&workload=ros2-jazzy-sim&robot=robot_1',
    );
  });

  it('omits context when falsy rather than sending an empty param', () => {
    const href = openShiftDiagnosticsHref('ns1', 'ros2-jazzy-sim', 'robot_1', '');
    expect(href).not.toContain('context');
  });

  it('includes context when provided', () => {
    const href = openShiftDiagnosticsHref('ns1', 'ros2-jazzy-sim', 'robot_1', 'my-context');
    expect(href).toBe('/diagnostics?target=oc&namespace=ns1&workload=ros2-jazzy-sim&robot=robot_1&context=my-context');
  });
});

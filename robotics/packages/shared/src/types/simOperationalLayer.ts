import type { BaseOsLayer, LayerSelection, RosLayer } from './layerCompatibility';

const ROS_DISTRO: Record<Exclude<RosLayer, 'none' | 'provided-by-parent'>, string> = {
  'ros2-jazzy': 'jazzy',
  'ros2-humble': 'humble',
  'ros2-lyrical': 'lyrical',
};

/** Bundled asset dir under `packages/backend/assets/` (reused across distros via env overrides). */
export const SIM_RUNTIME_BUNDLE_ASSET_DIR = 'ros2-jazzy-sim';

/** Marker comment in generated Containerfiles — backend stages bundled assets when present. */
export const SIM_RUNTIME_LAYER_MARKER = '# Layer 5 — Sim runtime:';

/**
 * Any Customize build with Gazebo + Nav2 + TurtleBot3 needs the operational layer
 * appended and bundled assets staged into the throwaway build context.
 *
 * Preset mode still uses `buildSimulationImage` + the full asset Containerfile (separate
 * code path); this gate applies to `buildFromContainerfile` / generated Containerfiles.
 */
export function selectionNeedsBundledSimRuntime(sel: LayerSelection): boolean {
  return sel.sim === 'gazebo-nav2-tb3';
}

export function containerfileNeedsBundledSimRuntime(containerfile: string): boolean {
  return containerfile.includes(SIM_RUNTIME_LAYER_MARKER);
}

function resolveRosDistro(sel: LayerSelection): string {
  if (sel.ros === 'provided-by-parent') {
    return sel.customBaseRosDistro?.trim().toLowerCase() ?? 'jazzy';
  }
  if (sel.ros in ROS_DISTRO) {
    return ROS_DISTRO[sel.ros as RosLayer & keyof typeof ROS_DISTRO];
  }
  return 'jazzy';
}

function dnfInstallCmd(baseOs: BaseOsLayer): string {
  return baseOs === 'fedora-bootc-43' ? 'dnf --releasever=43 install -y' : 'dnf install -y';
}

function dnfCleanup(baseOs: BaseOsLayer): string {
  return baseOs === 'fedora-bootc-43' ? ' && dnf clean all' : '';
}

/**
 * Containerfile fragment for noVNC + extension entrypoints on top of a packages layer.
 * Requires `SIM_RUNTIME_BUNDLE_ASSET_DIR` files in the build context (staged by the backend).
 */
export function generateSimOperationalLayerFragment(sel: LayerSelection, packaging: 'apt' | 'dnf'): string {
  const distro = resolveRosDistro(sel);
  const rosSetup = `/opt/ros/${distro}/setup.bash`;
  const simDir = `/opt/ros/${distro}/share/nav2_minimal_tb3_sim`;
  const nav2Map = `/opt/ros/${distro}/share/nav2_bringup/maps/tb3_sandbox.yaml`;

  const lines: string[] = [
    `${SIM_RUNTIME_LAYER_MARKER} noVNC display stack + extension entrypoints`,
    'LABEL io.physical-ai.simulation.capability="managed"',
    `ENV ROBOTICS_ROS_SETUP=${rosSetup}`,
    `ENV ROBOTICS_SIM_DIR=${simDir}`,
    `ENV ROBOTICS_NAV2_MAP=${nav2Map}`,
  ];

  if (packaging === 'dnf') {
    const install = dnfInstallCmd(sel.baseOs);
    const cleanup = dnfCleanup(sel.baseOs);
    lines.push(
      '# Display stack: Xvfb + VNC + noVNC + Mesa software GL/EGL for in-cluster sensors',
      `RUN ${install} ` +
        'mesa-libGL mesa-libEGL mesa-dri-drivers mesa-libgbm mesa-demos ' +
        'xorg-x11-server-Xvfb x11vnc openbox xterm python3 novnc python3-websockify wget' +
        cleanup,
      '# VirtualGL: optional GPU-rendered GUI viewport on NVIDIA headless EGL clusters (APPENG-6083)',
      'ARG VIRTUALGL_VERSION=3.1.5',
      `RUN ${install} wget && ` +
        'VGL_ARCH="$(uname -m)" && ' +
        // RPM release assets use VirtualGL-<ver>.<arch>.rpm (not the deb-style virtualgl_<ver>_<arch>.rpm)
        'wget -q "https://github.com/VirtualGL/virtualgl/releases/download/${VIRTUALGL_VERSION}/VirtualGL-${VIRTUALGL_VERSION}.${VGL_ARCH}.rpm" ' +
        '-O /tmp/virtualgl.rpm && ' +
        `${install} /tmp/virtualgl.rpm && rm -f /tmp/virtualgl.rpm${cleanup}`,
      'ENV PATH="/opt/VirtualGL/bin:${PATH}"',
    );
  } else if (packaging === 'apt') {
    lines.push(
      '# Display stack (Ubuntu/Debian)',
      'RUN apt-get update && apt-get install -y --no-install-recommends \\',
      '    libgl1 libegl1 libgl1-mesa-dri libegl-mesa0 libgbm1 mesa-utils \\',
      '    xvfb x11vnc novnc python3-websockify openbox xterm python3 wget \\',
      '    && rm -rf /var/lib/apt/lists/*',
      'ARG VIRTUALGL_VERSION=3.1.5',
      'RUN apt-get update \\',
      '    && VGL_ARCH="$(dpkg --print-architecture)" \\',
      '    && wget -q "https://github.com/VirtualGL/virtualgl/releases/download/${VIRTUALGL_VERSION}/virtualgl_${VIRTUALGL_VERSION}_${VGL_ARCH}.deb" \\',
      '         -O /tmp/virtualgl.deb \\',
      '    && apt-get install -y --no-install-recommends /tmp/virtualgl.deb \\',
      '    && rm -f /tmp/virtualgl.deb \\',
      '    && rm -rf /var/lib/apt/lists/*',
      'ENV PATH="/opt/VirtualGL/bin:${PATH}"',
    );
  } else {
    throw new Error(`Unsupported base OS packaging for sim runtime layer: ${packaging}`);
  }

  lines.push(
    'RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix',
    '# noVNC landing: autoconnect + auto-reconnect for background browser tabs',
    'RUN printf \'<!DOCTYPE html>\\n<html><head><meta http-equiv="refresh" content="0;url=vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale"></head></html>\\n\' \\',
    '    > /usr/share/novnc/index.html',
    'WORKDIR /opt/ros2-demo',
    'COPY entrypoint-gazebo.sh /entrypoint-gazebo.sh',
    'COPY entrypoint-spawn-robot.sh /entrypoint-spawn-robot.sh',
    'COPY entrypoint-nav2.sh /entrypoint-nav2.sh',
    'COPY lib/validate-input.sh /usr/local/lib/robotics/validate-input.sh',
    'COPY lib/load-validate-input.sh /usr/local/lib/robotics/load-validate-input.sh',
    'COPY lib/patch-nav2-params.py /usr/local/lib/robotics/patch-nav2-params.py',
    'COPY config/cyclonedds-qos.xml /opt/ros2-demo/config/cyclonedds-qos.xml',
    'COPY worlds/ /opt/ros2-demo/worlds/',
    'COPY www/ /opt/ros2-demo/www/',
    'RUN chmod +x /entrypoint-gazebo.sh /entrypoint-spawn-robot.sh /entrypoint-nav2.sh \\',
    '    && chmod 644 /usr/local/lib/robotics/validate-input.sh \\',
    '                 /usr/local/lib/robotics/load-validate-input.sh \\',
    '                 /usr/local/lib/robotics/patch-nav2-params.py',
    'ENV TURTLEBOT3_MODEL=waffle',
    'EXPOSE 6080 8080',
    'ENTRYPOINT ["/bin/bash"]',
  );

  return lines.join('\n') + '\n';
}

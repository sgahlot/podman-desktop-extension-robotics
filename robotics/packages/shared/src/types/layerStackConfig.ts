import type { BaseOsLayer, RosLayer } from './layerCompatibility';

export interface BaseOsCapability {
  isBootc: boolean;
  packaging: 'apt' | 'dnf';
  requiresSubscription: boolean;
  supportedRosDistros: readonly string[];
  supportedSimDistros: readonly string[];
  hasRosRepo: boolean;
}

export const BASE_OS_CAPABILITY: Record<BaseOsLayer, BaseOsCapability> = {
  custom: {
    isBootc: false,
    packaging: 'apt',
    requiresSubscription: false,
    supportedRosDistros: ['jazzy', 'humble'],
    supportedSimDistros: ['jazzy', 'humble'],
    hasRosRepo: true,
  },
  'ubuntu-noble': {
    isBootc: false,
    packaging: 'apt',
    requiresSubscription: false,
    supportedRosDistros: ['jazzy', 'humble'],
    supportedSimDistros: ['jazzy', 'humble'],
    hasRosRepo: true,
  },
  'centos-bootc-stream9': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportedRosDistros: [],
    supportedSimDistros: [],
    hasRosRepo: true,
  },
  'centos-bootc-stream10': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportedRosDistros: [],
    supportedSimDistros: [],
    hasRosRepo: true,
  },
  'fedora-bootc-42': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportedRosDistros: [],
    supportedSimDistros: [],
    hasRosRepo: false,
  },
  'fedora-bootc-43': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportedRosDistros: ['lyrical'],
    supportedSimDistros: ['lyrical'],
    hasRosRepo: true,
  },
  'fedora-bootc-44': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: false,
    supportedRosDistros: [],
    supportedSimDistros: [],
    hasRosRepo: false,
  },
  'rhel-bootc': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: true,
    supportedRosDistros: [],
    supportedSimDistros: [],
    hasRosRepo: true,
  },
  'rhel10-bootc': {
    isBootc: true,
    packaging: 'dnf',
    requiresSubscription: true,
    supportedRosDistros: [],
    supportedSimDistros: [],
    hasRosRepo: true,
  },
};

export const BASE_OS_IMAGE_REF: Record<Exclude<BaseOsLayer, 'custom'>, string> = {
  'ubuntu-noble': 'docker.io/library/ubuntu:24.04',
  'centos-bootc-stream9': 'quay.io/centos-bootc/centos-bootc:stream9',
  'centos-bootc-stream10': 'quay.io/centos-bootc/centos-bootc:stream10',
  'fedora-bootc-42': 'quay.io/fedora/fedora-bootc:42',
  'fedora-bootc-43': 'quay.io/fedora/fedora-bootc:43',
  'fedora-bootc-44': 'quay.io/fedora/fedora-bootc:44',
  'rhel-bootc': 'registry.redhat.io/rhel9/rhel-bootc:latest',
  'rhel10-bootc': 'registry.redhat.io/rhel10/rhel-bootc:latest',
};

export type RosDistro = 'jazzy' | 'humble' | 'lyrical';
export const ROS_DISTRO: Record<Exclude<RosLayer, 'none' | 'provided-by-parent'>, RosDistro> = {
  'ros2-jazzy': 'jazzy',
  'ros2-humble': 'humble',
  'ros2-lyrical': 'lyrical',
};

export const INSTALL_COMMAND: Record<BaseOsLayer, string> = {
  custom: 'apt-get update && apt-get install -y',
  'ubuntu-noble': 'apt-get update && apt-get install -y',
  'centos-bootc-stream9': 'dnf install -y',
  'centos-bootc-stream10': 'dnf install -y',
  'fedora-bootc-42': 'dnf install -y',
  'fedora-bootc-43': 'dnf --releasever=43 install -y',
  'fedora-bootc-44': 'dnf install -y',
  'rhel-bootc': 'dnf install -y',
  'rhel10-bootc': 'dnf install -y',
};
export const INSTALL_CLEANUP: Record<BaseOsLayer, string> = {
  custom: '',
  'ubuntu-noble': '',
  'centos-bootc-stream9': '',
  'centos-bootc-stream10': '',
  'fedora-bootc-42': '',
  'fedora-bootc-43': ' && dnf clean all',
  'fedora-bootc-44': '',
  'rhel-bootc': '',
  'rhel10-bootc': '',
};

export const ROS_DESKTOP_PACKAGES: Record<RosDistro, readonly string[]> = {
  jazzy: ['desktop'],
  humble: ['desktop'],
  lyrical: ['desktop-runtime', 'desktop-devel'],
};
export const SIMULATION_PACKAGES: Record<RosDistro, readonly string[]> = {
  jazzy: ['navigation2', 'nav2-bringup', 'nav2-minimal-tb3-sim', 'ros-gz-sim'],
  humble: ['navigation2', 'nav2-bringup', 'nav2-minimal-tb3-sim', 'ros-gz-sim'],
  lyrical: [
    'navigation2-runtime',
    'navigation2-devel',
    'nav2-bringup-runtime',
    'nav2-bringup-devel',
    'nav2-minimal-tb3-sim-runtime',
    'nav2-minimal-tb3-sim-devel',
    'turtlebot3-gazebo-runtime',
    'turtlebot3-gazebo-devel',
    'ros-gz-sim-runtime',
    'ros-gz-sim-devel',
  ],
};

export const FEDORA_LYRICAL_REPOSITORY =
  '# ROS 2 Lyrical Fedora 43 x86_64 testing repository\n' +
  "RUN cat > /etc/yum.repos.d/ros2-lyrical-testing.repo <<'EOF'\n" +
  '[ros2-lyrical-testing]\n' +
  'name=ROS 2 Lyrical Fedora 43 x86_64 (testing)\n' +
  'baseurl=https://repo.ros2.org/fedora/testing/43/x86_64/\n' +
  'enabled=1\n' +
  'gpgcheck=0\n' +
  'gpgkey=https://repo.ros2.org/repos.key\n' +
  'EOF';

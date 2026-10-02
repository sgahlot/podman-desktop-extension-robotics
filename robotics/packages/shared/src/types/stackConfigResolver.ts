import type { LayerSelection } from './layerCompatibility';
import {
  BASE_OS_CAPABILITY,
  BASE_OS_IMAGE_REF,
  FEDORA_LYRICAL_REPOSITORY,
  INSTALL_CLEANUP,
  INSTALL_COMMAND,
  ROS_DESKTOP_PACKAGES,
  ROS_DISTRO,
  SIMULATION_PACKAGES,
  type BaseOsCapability,
} from './layerStackConfig';
import { MANAGED_SIM_CONTEXT_PATHS, MANAGED_SIM_VERIFY_HOOK } from './managedSimRuntime';

export function packageManagerCleanCommand(packaging: 'apt' | 'dnf'): string {
  return packaging === 'dnf' ? 'dnf clean all' : 'apt-get clean';
}

export interface ResolvedStackConfig {
  baseImageRef: string;
  capability: BaseOsCapability;
  packaging: 'apt' | 'dnf';
  installCommand: string;
  installCleanup: string;
  rosDistro: string | undefined;
  rosPackages: readonly string[];
  simulationPackages: readonly string[];
  repositoryFragments: readonly string[];
  layerOrder: readonly ('base-os' | 'hardened' | 'ros' | 'sim')[];
  copySources: readonly string[];
  verifyHooks: readonly string[];
  managedSimEligible: boolean;
}

const ROS_REPOSITORY =
  '# ROS 2 apt repository (required before installing any ros-* package on Ubuntu)\n' +
  'RUN apt-get update && apt-get install -y curl gnupg lsb-release && ' +
  "if ! grep -Rqs 'packages.ros.org/ros2/ubuntu' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then " +
  '/usr/bin/curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key ' +
  '-o /usr/share/keyrings/ros-archive-keyring.gpg && ' +
  'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] ' +
  'http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" ' +
  '| tee /etc/apt/sources.list.d/ros2.list > /dev/null; ' +
  'fi';

const ROS_DISTRO_BY_FAMILY: Record<string, readonly string[]> = {
  ubuntu: ['jazzy', 'humble'],
  debian: ['jazzy', 'humble'],
  fedora: ['lyrical'],
  rhel: ['lyrical'],
  centos: ['lyrical'],
};

function customNeedsOsContract(selection: LayerSelection): boolean {
  return selection.ros !== 'none' || selection.sim !== 'none';
}

function customPackaging(selection: LayerSelection): 'apt' | 'dnf' {
  if (selection.customBasePackaging) return selection.customBasePackaging;
  const family = selection.customBaseOsFamily?.trim().toLowerCase();
  if (!family) {
    if (!customNeedsOsContract(selection)) return 'apt';
    throw new Error('Declare the custom parent OS family or packaging before adding ROS or simulation layers.');
  }
  if (['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].some(name => family.includes(name))) return 'dnf';
  if (['ubuntu', 'debian'].some(name => family.includes(name))) return 'apt';
  throw new Error(`Unsupported custom base OS family "${selection.customBaseOsFamily}"; declare its packaging.`);
}

function customDnfInstallCommand(selection: LayerSelection, familyLower: string): string {
  const version = selection.customBaseOsVersion?.trim();
  if (familyLower.includes('fedora') && version === '43') {
    return 'dnf --releasever=43 install -y';
  }
  return 'dnf install -y';
}

function customCapability(selection: LayerSelection): BaseOsCapability {
  const family = selection.customBaseOsFamily?.trim().toLowerCase() ?? '';
  const packaging = customPackaging(selection);
  const declaredDistro = selection.customBaseRosDistro?.trim().toLowerCase();
  const supported = declaredDistro
    ? [declaredDistro]
    : (Object.entries(ROS_DISTRO_BY_FAMILY).find(([name]) => family.includes(name))?.[1] ??
      (packaging === 'apt' ? ['jazzy', 'humble'] : []));

  return {
    isBootc: false,
    packaging,
    requiresSubscription: family.includes('rhel'),
    supportedRosDistros: supported,
    supportedSimDistros: supported,
    hasRosRepo: packaging === 'apt' || supported.length > 0,
  };
}

export function resolveStackConfig(selection: LayerSelection): ResolvedStackConfig {
  const customFamilyLower = selection.customBaseOsFamily?.trim().toLowerCase() ?? '';
  const capability = selection.baseOs === 'custom' ? customCapability(selection) : BASE_OS_CAPABILITY[selection.baseOs];
  const baseImageRef =
    selection.baseOs === 'custom' ? (selection.customBaseImage?.trim() ?? '') : BASE_OS_IMAGE_REF[selection.baseOs];
  if (!baseImageRef) throw new Error('A custom base image reference is required before resolving the stack.');

  const rosDistro =
    selection.ros === 'provided-by-parent'
      ? selection.customBaseRosDistro?.trim()
        ? selection.customBaseRosDistro.trim().toLowerCase()
        : undefined
      : selection.ros in ROS_DISTRO
        ? ROS_DISTRO[selection.ros as keyof typeof ROS_DISTRO]
        : undefined;
  const baseVersion = selection.customBaseOsVersion ?? (selection.baseOs === 'fedora-bootc-43' ? '43' : undefined);
  const hasRosPackages = selection.ros !== 'none' && selection.ros !== 'provided-by-parent' && rosDistro;
  const hasSimulationPackages = selection.sim === 'gazebo-nav2-tb3' && rosDistro;
  const repositoryFragments: string[] = [];
  if (capability.packaging === 'apt' && (selection.ros !== 'none' || selection.sim !== 'none')) {
    repositoryFragments.push(ROS_REPOSITORY);
  }
  if (capability.packaging === 'dnf' && rosDistro === 'lyrical' && baseVersion === '43') {
    repositoryFragments.push(FEDORA_LYRICAL_REPOSITORY);
  }

  const layerOrder: ('base-os' | 'hardened' | 'ros' | 'sim')[] = ['base-os'];
  if (selection.hardened !== 'none') layerOrder.push('hardened');
  if (selection.ros !== 'none') layerOrder.push('ros');
  if (selection.sim !== 'none') layerOrder.push('sim');

  const managedSimEligible = selection.sim === 'gazebo-nav2-tb3' && Boolean(rosDistro);

  return {
    baseImageRef,
    capability,
    packaging: capability.packaging,
    installCommand:
      selection.baseOs === 'custom' && capability.packaging === 'dnf'
        ? customDnfInstallCommand(selection, customFamilyLower)
        : INSTALL_COMMAND[selection.baseOs],
    installCleanup:
      selection.baseOs === 'custom' && capability.packaging === 'dnf'
        ? customFamilyLower.includes('fedora') && selection.customBaseOsVersion?.trim() === '43'
          ? ' && dnf clean all'
          : ''
        : INSTALL_CLEANUP[selection.baseOs],
    rosDistro,
    rosPackages: hasRosPackages ? ROS_DESKTOP_PACKAGES[rosDistro as keyof typeof ROS_DESKTOP_PACKAGES] : [],
    simulationPackages: hasSimulationPackages ? SIMULATION_PACKAGES[rosDistro as keyof typeof SIMULATION_PACKAGES] : [],
    repositoryFragments,
    layerOrder,
    copySources: managedSimEligible ? [...MANAGED_SIM_CONTEXT_PATHS] : [],
    verifyHooks: managedSimEligible ? [MANAGED_SIM_VERIFY_HOOK] : [],
    managedSimEligible,
  };
}

/** Whether the selection should bundle managed sim runtime assets into the build context. */
export function selectionNeedsBundledSimRuntime(selection: LayerSelection): boolean {
  try {
    return resolveStackConfig(selection).managedSimEligible;
  } catch {
    return false;
  }
}

/** Managed-sim verification hooks for build-context checks (Layers wizard / API). */
export function managedSimVerifyHooks(selection: LayerSelection): readonly string[] {
  try {
    return resolveStackConfig(selection).verifyHooks;
  } catch {
    return [];
  }
}

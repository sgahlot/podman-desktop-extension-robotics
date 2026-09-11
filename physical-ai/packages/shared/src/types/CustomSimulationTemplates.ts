export type CustomSimulationCapability = 'packages-only';
export type SupportedArchitecture = 'amd64' | 'arm64';

export interface CustomSimulationTemplate {
  id: string;
  version: string;
  label: string;
  osFamily: string;
  osVersion: string;
  rosDistro: string;
  packageManager: 'dnf' | 'apt';
  packages: readonly string[];
  rosSetupPath: string;
  architectures: readonly SupportedArchitecture[];
  capability: CustomSimulationCapability;
  description: string;
  validationGuidance: string;
}

export const CUSTOM_SIMULATION_TEMPLATES: readonly CustomSimulationTemplate[] = [
  {
    id: 'fedora43-lyrical-dnf',
    version: '1',
    label: 'Fedora 43 + ROS 2 Lyrical (dnf)',
    osFamily: 'Fedora',
    osVersion: '43',
    rosDistro: 'lyrical',
    packageManager: 'dnf',
    packages: ['ros-lyrical-nav2-minimal-tb3-sim', 'ros-lyrical-ros-gz-sim'],
    rosSetupPath: '/opt/ros/lyrical/setup.bash',
    architectures: ['amd64'],
    capability: 'packages-only',
    description: 'Adds fixed TurtleBot3, Gazebo, and Nav2 packages to a ROS-ready Fedora parent.',
    validationGuidance: 'Use a Fedora 43 parent with ROS 2 Lyrical and the Lyrical testing repository configured.',
  },
];

export function resolveCustomSimulationTemplate(id: string): CustomSimulationTemplate | undefined {
  return CUSTOM_SIMULATION_TEMPLATES.find(template => template.id === id);
}

export function assertCustomBaseImageRef(value: string): string {
  const ref = value.trim();
  if (!ref || ref.length > 512 || /[\s\\'"`;$()\n\r]/.test(ref)) {
    throw new Error('Custom base image must be a single valid OCI image reference.');
  }
  return ref;
}

export function generateCustomSimulationContainerfile(baseImage: string, template: CustomSimulationTemplate): string {
  const ref = assertCustomBaseImageRef(baseImage);
  const packages = template.packages.join(' ');
  return [
    `# Layer 1 — Base OS: ${template.osFamily} ${template.osVersion} custom parent`,
    `FROM ${ref}`,
    '',
    `# Layer 3 — ROS: ROS ${template.rosDistro} (provided by parent)`,
    `# Layer 4 — Simulation: ${template.label}`,
    `LABEL io.physical-ai.simulation.template="${template.id}"`,
    `LABEL io.physical-ai.simulation.template-version="${template.version}"`,
    `LABEL io.physical-ai.simulation.os-family="${template.osFamily}"`,
    `LABEL io.physical-ai.simulation.os-version="${template.osVersion}"`,
    `LABEL io.physical-ai.simulation.ros-distro="${template.rosDistro}"`,
    `LABEL io.physical-ai.simulation.capability="${template.capability}"`,
    `LABEL io.physical-ai.simulation.ros-setup="${template.rosSetupPath}"`,
    `RUN ${template.packageManager} install -y ${packages} && ${template.packageManager} clean all`,
    '',
  ].join('\n');
}

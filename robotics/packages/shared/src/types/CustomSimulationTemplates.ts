import { packageManagerCleanCommand, resolveStackConfig } from './stackConfigResolver';

export type {
  CustomSimulationCapability,
  SupportedArchitecture,
  CustomSimulationTemplate,
} from '../config/customSimulationTemplateCatalog';
export {
  CUSTOM_SIMULATION_TEMPLATES,
  resolveCustomSimulationTemplate,
} from '../config/customSimulationTemplateCatalog';

import type { CustomSimulationTemplate } from '../config/customSimulationTemplateCatalog';

export function assertCustomBaseImageRef(value: string): string {
  const ref = value.trim();
  if (!ref || ref.length > 512 || /[\s\\'"`;$()\n\r]/.test(ref)) {
    throw new Error('Custom base image must be a single valid OCI image reference.');
  }
  return ref;
}

export function generateCustomSimulationContainerfile(baseImage: string, template: CustomSimulationTemplate): string {
  const ref = assertCustomBaseImageRef(baseImage);
  const stack = resolveStackConfig({
    baseOs: 'custom',
    customBaseImage: ref,
    customBaseOsFamily: template.osFamily,
    customBaseOsVersion: template.osVersion,
    customBaseRosDistro: template.rosDistro,
    customBasePackaging: template.packageManager,
    hardened: 'none',
    ros: 'provided-by-parent',
    sim: 'custom-template',
  });
  const packages = template.packages.join(' ');
  const installCleanupSuffix = stack.installCleanup || ` && ${packageManagerCleanCommand(stack.packaging)}`;
  return [
    `# Layer 1 — Base OS: ${template.osFamily} ${template.osVersion} custom parent`,
    `FROM ${stack.baseImageRef}`,
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
    `RUN ${stack.installCommand} ${packages}${installCleanupSuffix}`,
    '',
  ].join('\n');
}

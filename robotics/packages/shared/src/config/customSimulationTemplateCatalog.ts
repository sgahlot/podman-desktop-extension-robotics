import * as catalogModule from './custom-simulation-templates.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';

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

const catalog = loadJsonCatalog<{ templates?: CustomSimulationTemplate[] }>(catalogModule);

function templates(): CustomSimulationTemplate[] {
  if (!Array.isArray(catalog.templates)) invalidCatalog('custom-simulation-templates.json', 'templates');
  return catalog.templates;
}

export const CUSTOM_SIMULATION_TEMPLATES: readonly CustomSimulationTemplate[] = Object.freeze(templates());

export function resolveCustomSimulationTemplate(id: string): CustomSimulationTemplate | undefined {
  return CUSTOM_SIMULATION_TEMPLATES.find(template => template.id === id);
}

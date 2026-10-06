import * as catalogModule from './hummingbird-apps.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';

export type HummingbirdKind = 'companion' | 'tool';

export interface HummingbirdAppDefinition {
  id: string;
  label: string;
  note: string;
  kind: HummingbirdKind;
  binPath?: string;
}

const catalog = loadJsonCatalog<{
  registryImageTemplate?: string;
  apps?: HummingbirdAppDefinition[];
}>(catalogModule);

function apps(): HummingbirdAppDefinition[] {
  if (!catalog.registryImageTemplate?.includes('{id}') || !Array.isArray(catalog.apps)) {
    invalidCatalog('hummingbird-apps.json');
  }
  return catalog.apps;
}

export const HUMMINGBIRD_REGISTRY_IMAGE_TEMPLATE = catalog.registryImageTemplate!;

export const HUMMINGBIRD_APP_DEFINITIONS: readonly HummingbirdAppDefinition[] = Object.freeze(apps());

export function hummingbirdImageRefFromCatalog(appId: string): string {
  return HUMMINGBIRD_REGISTRY_IMAGE_TEMPLATE.replace('{id}', appId);
}

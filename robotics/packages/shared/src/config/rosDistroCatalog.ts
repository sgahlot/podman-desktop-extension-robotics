import * as catalogModule from './ros-distros.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';

export interface RosDistroDefinition {
  label: string;
  shortLabel: string;
  layerRosOptionId: string;
  imageRefHints: readonly string[];
  nav2: boolean;
  nav2Prewarm: boolean;
}

const catalog = loadJsonCatalog<{ distros?: Record<string, RosDistroDefinition> }>(catalogModule);

function distros(): Record<string, RosDistroDefinition> {
  if (!catalog.distros || typeof catalog.distros !== 'object') invalidCatalog('ros-distros.json', 'distros');
  return catalog.distros;
}

export const ROS_DISTRO_IDS = Object.freeze(Object.keys(distros()) as (keyof typeof catalog.distros & string)[]);

export type CatalogRosDistroId = (typeof ROS_DISTRO_IDS)[number];

export function getRosDistroDefinition(id: string): RosDistroDefinition | undefined {
  return distros()[id];
}

export function assertCatalogRosDistro(id: string): CatalogRosDistroId {
  const def = getRosDistroDefinition(id);
  if (!def) throw new Error(`Unsupported ROS distro "${id}".`);
  return id as CatalogRosDistroId;
}

export function distroFromImageRefHints(image: string): CatalogRosDistroId {
  for (const distroId of ROS_DISTRO_IDS) {
    const def = distros()[distroId];
    if (def.imageRefHints.some(hint => image.includes(hint))) return distroId as CatalogRosDistroId;
  }
  throw new Error(
    `Unsupported ROS distro for image "${image}". Tag must include one of: ${ROS_DISTRO_IDS.flatMap(
      id => distros()[id].imageRefHints,
    ).join(', ')}.`,
  );
}

export function distroSupportsNav2FromCatalog(id: string): boolean {
  return getRosDistroDefinition(id)?.nav2 ?? false;
}

export function distroSupportsNav2PrewarmFromCatalog(id: string): boolean {
  return getRosDistroDefinition(id)?.nav2Prewarm ?? false;
}

export function rosDistroDisplayLabel(id: string): string {
  return getRosDistroDefinition(id)?.label ?? `ROS ${id}`;
}

export function rosLayerOptionToDistroId(rosLayerId: string): string | undefined {
  for (const distroId of ROS_DISTRO_IDS) {
    if (distros()[distroId].layerRosOptionId === rosLayerId) return distroId;
  }
  return undefined;
}

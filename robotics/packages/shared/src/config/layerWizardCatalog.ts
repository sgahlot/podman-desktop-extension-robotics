import * as catalogModule from './layer-wizard-options.json';
import { invalidCatalog, loadJsonCatalog } from './loadJsonCatalog';
import { CATALOG_BASE_OS_LAYERS, loadLayerRecipe } from '../types/layerRecipe';

export interface WizardLayerOption<TId extends string = string> {
  id: TId;
  label: string;
  note: string;
}

interface LayerWizardCatalog {
  customBaseOs?: { label?: string; note?: string };
  hardened?: Array<{ id: string; label: string; note: string }>;
  ros?: Array<{ id: string; label: string; note: string; rosDistroId?: string }>;
  sim?: Array<{ id: string; label: string; note: string }>;
}

const catalog = loadJsonCatalog<LayerWizardCatalog>(catalogModule);

function layerOptions<TId extends string>(
  rows: Array<{ id: string; label: string; note: string }>,
): WizardLayerOption<TId>[] {
  return rows.map(row => ({ id: row.id as TId, label: row.label, note: row.note }));
}

export function buildBaseOsOptions(): readonly WizardLayerOption[] {
  const custom = catalog.customBaseOs;
  if (!custom?.label || !custom.note) invalidCatalog('layer-wizard-options.json', 'customBaseOs');
  const curated = CATALOG_BASE_OS_LAYERS.map(id => {
    const ui = loadLayerRecipe(id).ui;
    if (!ui) invalidCatalog('layer-recipes.json', `recipes.${id}.ui`);
    return { id, label: ui.label, note: ui.note };
  });
  return [{ id: 'custom', label: custom.label, note: custom.note }, ...curated];
}

export function buildHardenedOptions(): readonly WizardLayerOption[] {
  if (!catalog.hardened?.length) invalidCatalog('layer-wizard-options.json', 'hardened');
  return layerOptions(catalog.hardened);
}

export function buildRosOptions(): readonly WizardLayerOption[] {
  if (!catalog.ros?.length) invalidCatalog('layer-wizard-options.json', 'ros');
  return layerOptions(catalog.ros);
}

export function buildSimOptions(): readonly WizardLayerOption[] {
  if (!catalog.sim?.length) invalidCatalog('layer-wizard-options.json', 'sim');
  return layerOptions(catalog.sim);
}

export interface NavItem {
  label: string;
  /** Route to navigate to; absent = non-interactive (Fleet). */
  to?: string;
  /** Shown as a title/tooltip; the Fleet "Coming soon" caption. */
  tooltip?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', to: '/' },
  { label: 'Image Builder', to: '/build' },
  { label: 'Image Catalog', to: '/images' },
  { label: 'Simulation', to: '/simulation' },
  { label: 'Topic Monitor', to: '/topics' },
  { label: 'Diagnostics', to: '/diagnostics' },
  { label: 'Fleet', tooltip: 'Coming soon — scale to a multi-robot local fleet' },
  { label: 'Help', to: '/help' },
] as const;

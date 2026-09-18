/** Walkthrough GIFs live at `robotics/docs/img/`; Vite bundles them into extension `media/` for Help. */
import dashboardOverviewCards from '/@docs/dashboard-overview-cards.gif?url';
import imageBuilder from '/@docs/image-builder.gif?url';
import imageCatalogPull from '/@docs/image-catalog-pull.gif?url';
import openshiftDeployShowViewer from '/@docs/openshift-deploy-show-viewer.gif?url';
import showViewerToggle from '/@docs/show-viewer-toggle.gif?url';
import topicMonitor from '/@docs/topic-monitor.gif?url';
import diagnostics from '/@docs/diagnostics.gif?url';

export const helpScreenshots = {
  dashboardOverviewCards,
  imageBuilder,
  imageCatalogPull,
  openshiftDeployShowViewer,
  showViewerToggle,
  topicMonitor,
  diagnostics,
} as const;

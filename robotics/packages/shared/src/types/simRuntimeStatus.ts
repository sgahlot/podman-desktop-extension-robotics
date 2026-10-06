/** Path written by `entrypoint-gazebo.sh` for UI / `oc exec` status probes (OpenShift transparency). */
export const SIM_RUNTIME_STATUS_PATH = '/tmp/robotics-sim-runtime-status.env';

export type GuiRenderMode = 'virtualgl' | 'software' | 'unknown';

export interface SimRuntimeStatusSnapshot {
  gpuRequested: boolean;
  guiRenderMode: GuiRenderMode;
  guiRenderNote?: string;
}

/** Parse the key=value file emitted by the managed sim entrypoint. */
export function parseSimRuntimeStatusEnv(content: string): SimRuntimeStatusSnapshot | undefined {
  if (!content?.trim()) return undefined;
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  const modeRaw = vars.ROBOTICS_GUI_RENDER_MODE?.trim().toLowerCase();
  let guiRenderMode: GuiRenderMode = 'unknown';
  if (modeRaw === 'virtualgl' || modeRaw === 'software') {
    guiRenderMode = modeRaw;
  }
  return {
    gpuRequested: vars.ROBOTICS_GPU_REQUESTED === '1',
    guiRenderMode,
    guiRenderNote: vars.ROBOTICS_GUI_RENDER_NOTE?.trim() || undefined,
  };
}

/** Fields the OpenShift deployed-workload card uses for GPU GUI status. */
export interface GpuGuiWorkloadFields {
  clusterGpuRequested?: boolean;
  ready?: boolean;
  guiRenderMode?: GuiRenderMode;
  guiRenderNote?: string;
  pinNodeHostname?: string;
  scheduledNodeName?: string;
}

export type GpuGuiWorkloadUiTone = 'success' | 'error' | 'pending' | 'none';

/** Drives the deployed-workload GPU status banner (OpenShift tab). */
export function gpuGuiWorkloadUiTone(w: GpuGuiWorkloadFields): GpuGuiWorkloadUiTone {
  if (!w.clusterGpuRequested) return 'none';
  if (!w.ready) return 'pending';
  if (w.guiRenderMode === 'virtualgl') return 'success';
  if (w.guiRenderMode === 'software') return 'error';
  return 'pending';
}

function shortNodeName(node: string): string {
  const dot = node.indexOf('.');
  return dot > 0 ? node.slice(0, dot) : node;
}

function nodeLine(w: GpuGuiWorkloadFields): string {
  const parts: string[] = [];
  if (w.pinNodeHostname) {
    parts.push(`Pinned to ${shortNodeName(w.pinNodeHostname)}`);
  }
  if (w.scheduledNodeName) {
    parts.push(`Running on ${shortNodeName(w.scheduledNodeName)}`);
  }
  return parts.join(' · ');
}

/** Green banner when GPU GUI (VirtualGL) is active. */
export function gpuGuiSuccessUserMessage(w: GpuGuiWorkloadFields): string {
  const node = nodeLine(w);
  const base = 'GPU GUI is active (VirtualGL hardware viewport).';
  return node ? `${base} ${node}.` : base;
}

/** Red banner when GPU was requested but the GUI is on CPU. */
export function gpuGuiFallbackWorkloadMessage(w: GpuGuiWorkloadFields): string {
  const node = nodeLine(w);
  const body = gpuGuiFallbackUserMessage({
    gpuRequested: true,
    guiRenderMode: 'software',
    guiRenderNote: w.guiRenderNote,
  });
  return node ? `${body} ${node}.` : body;
}

/** Banner when GPU is on but the sim image has not reported render mode yet. */
export function gpuGuiPendingUserMessage(w: GpuGuiWorkloadFields): string {
  const node = nodeLine(w);
  const base =
    'GPU is enabled for this deployment, but GUI render mode is not available yet. ' +
    'Rebuild and redeploy the simulation image with the current extension, then refresh this list.';
  return node ? `${base} ${node}.` : base;
}

/** User-facing summary when GPU deploy uses software GUI (VirtualGL unavailable on the node). */
export function gpuGuiFallbackUserMessage(snapshot: SimRuntimeStatusSnapshot): string {
  if (!snapshot.gpuRequested || snapshot.guiRenderMode !== 'software') return '';
  if (snapshot.guiRenderNote === 'vgl_egl_unavailable') {
    return (
      'GPU is enabled for this deployment, but the Gazebo GUI is software-rendered on this node ' +
      '(VirtualGL could not use headless EGL). The world map should still appear; expect higher CPU use for the viewer. ' +
      'Gazebo sensors stay on the configured render path.'
    );
  }
  return (
    'GPU is enabled for this deployment, but the Gazebo GUI is software-rendered. ' +
    'The world map should still appear; expect higher CPU use for the viewer.'
  );
}

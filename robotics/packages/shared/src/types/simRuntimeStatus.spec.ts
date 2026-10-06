import { describe, expect, it } from 'vitest';
import { gpuGuiFallbackUserMessage, gpuGuiWorkloadUiTone, parseSimRuntimeStatusEnv } from './simRuntimeStatus';

describe('parseSimRuntimeStatusEnv', () => {
  it('parses GPU + software GUI fallback', () => {
    const snap = parseSimRuntimeStatusEnv(
      'ROBOTICS_GPU_REQUESTED=1\nROBOTICS_GUI_RENDER_MODE=software\nROBOTICS_GUI_RENDER_NOTE=vgl_egl_unavailable\n',
    );
    expect(snap).toEqual({
      gpuRequested: true,
      guiRenderMode: 'software',
      guiRenderNote: 'vgl_egl_unavailable',
    });
    expect(gpuGuiFallbackUserMessage(snap!)).toContain('VirtualGL');
  });

  it('parses virtualgl GUI', () => {
    const snap = parseSimRuntimeStatusEnv('ROBOTICS_GPU_REQUESTED=1\nROBOTICS_GUI_RENDER_MODE=virtualgl\n');
    expect(snap?.guiRenderMode).toBe('virtualgl');
    expect(gpuGuiFallbackUserMessage(snap!)).toBe('');
  });
});

describe('gpuGuiWorkloadUiTone', () => {
  const base = { ready: true, clusterGpuRequested: true };

  it('flags software GUI as error when GPU was requested', () => {
    expect(gpuGuiWorkloadUiTone({ ...base, clusterGpuRequested: true, guiRenderMode: 'software' })).toBe('error');
  });

  it('flags virtualgl as success', () => {
    expect(gpuGuiWorkloadUiTone({ ...base, clusterGpuRequested: true, guiRenderMode: 'virtualgl' })).toBe('success');
  });
});

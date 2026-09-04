import { get } from 'svelte/store';
import { physicalAiClient } from '../api/client';
import type { OpenShiftContext } from '/@shared/src/types/OpenShiftDeploy';
import { lastOpenShiftSelection } from './simSelection';

/**
 * Resolves an OpenShift namespace/context to try, in order: (a) the last one used on the
 * Simulation page (lastOpenShiftSelection); (b) the current kube context, if it's bound to a
 * real (non-'default') namespace; (c) the configured default namespace setting; (d) none.
 */
export async function resolveOpenShiftNamespace(): Promise<{ namespace: string; context?: string } | null> {
  const stored = get(lastOpenShiftSelection);
  if (stored) return { namespace: stored.namespace, context: stored.context };

  let context: OpenShiftContext | undefined;
  try {
    context = await physicalAiClient.getOpenShiftContext();
  } catch {
    context = undefined;
  }
  if (context?.namespace && context.namespace !== 'default') {
    return { namespace: context.namespace, context: context.context };
  }

  try {
    const fallback = await physicalAiClient.getDefaultOpenShiftNamespace();
    if (fallback) return { namespace: fallback, context: context?.context };
  } catch {
    // Fail soft — callers show empty/zero state instead of surfacing the error.
  }

  return null;
}

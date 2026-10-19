export interface MiddlewareLabelContext {
  distro?: string;
  parentProvided?: boolean;
}

/** Display the RMW implementation selected by the runtime middleware choice. */
export function middlewareLabel(middleware: string, context: MiddlewareLabelContext = {}): string {
  if (middleware === 'dds') {
    return context.parentProvided || context.distro === 'lyrical'
      ? 'DDS (parent image default)'
      : 'DDS (Fast DDS / rmw_fastrtps_cpp)';
  }
  if (middleware === 'zenoh') return 'Zenoh (rmw_zenoh_cpp)';
  return middleware;
}

export function middlewareLabelForImage(middleware: string, imageRef: string): string {
  return middlewareLabel(middleware, { parentProvided: /fedora|lyrical|bootc/i.test(imageRef) });
}

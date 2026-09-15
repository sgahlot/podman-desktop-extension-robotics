declare global {
  export interface PodmanDesktopApi {
    getState: () => unknown;
    postMessage: (msg: unknown) => void;
    setState: (newState: unknown) => void;
  }

  function acquirePodmanDesktopApi(): PodmanDesktopApi;
}

export { PodmanDesktopApi };

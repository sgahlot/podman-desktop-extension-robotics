export interface QuayRepository {
  namespace: string;
  name: string;
  description: string | null;
  is_public: boolean;
  kind: string;
  state: string;
}

export interface QuayTag {
  name: string;
  size: number;
  last_modified: string;
  manifest_digest: string;
  is_manifest_list: boolean;
}

export interface PullProgress {
  image: string;
  status: string;
  currentMB?: number;
  totalMB?: number;
  done?: boolean;
  error?: string;
}

export interface BuildProgress {
  tag: string;
  status: string;
  currentStep?: number;
  totalSteps?: number;
  logs: string[];
  done?: boolean;
  error?: string;
  cancelled?: boolean;
  /** Epoch ms when the build started. */
  startedAt?: number;
  /** Epoch ms when the build finished (success, error, or cancel). */
  finishedAt?: number;
}

export interface PushProgress {
  tag: string;
  status: string;
  logs: string[];
  done?: boolean;
  error?: string;
  cancelled?: boolean;
  /** Epoch ms when the push started. */
  startedAt?: number;
  /** Epoch ms when the push finished (success, error, or cancel). */
  finishedAt?: number;
}

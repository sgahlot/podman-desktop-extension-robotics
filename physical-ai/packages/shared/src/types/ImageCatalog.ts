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


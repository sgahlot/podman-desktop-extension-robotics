/** Normalize ESM/CJS JSON module imports across tooling. */
export function loadJsonCatalog<T>(module: unknown): T {
  return ((module as { default?: T }).default ?? module) as T;
}

export function invalidCatalog(field: string, detail?: string): never {
  const suffix = detail ? `: ${detail}` : '';
  throw new Error(`Invalid shared config (${field})${suffix}`);
}

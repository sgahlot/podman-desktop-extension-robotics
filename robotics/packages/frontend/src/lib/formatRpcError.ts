/** Turn an RPC rejection (Error, string, or unknown) into user-visible text. */
export function formatRpcError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === 'string' && err.length > 0) {
    return err;
  }
  return fallback;
}

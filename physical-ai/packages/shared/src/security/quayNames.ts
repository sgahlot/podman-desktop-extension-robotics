/**
 * Quay.io namespace and repository name format.
 * @see https://docs.quay.io/glossary/repository.html
 */

/** Quay organization / user / repo name segment. */
export const QUAY_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,254}$/;

export function assertQuayName(value: string, label: string): string {
  if (!value || typeof value !== 'string' || !QUAY_NAME_RE.test(value)) {
    throw new Error(
      `Invalid Quay ${label} "${value}". Use lowercase letters, digits, underscore, period, hyphen.`,
    );
  }
  return value;
}
